import os
import json
import re
import math
import time
import platform
import subprocess
import webbrowser
import uuid
import threading
from pathlib import Path
from typing import Optional, List

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import requests
import cv2
import numpy as np
import pytesseract
import xraylib

from core.config import (
    AccountPaths,
    load_account_config,
    save_account_config,
    get_account_list,
    set_current_account,
    get_app_state
)

# ★ ルーター定義はファイル内でこの1つだけに統一する！
router = APIRouter(prefix="/api", tags=["tools"])

# macOS の Tesseract パス対応
if platform.system() == "Darwin" and os.path.exists("/opt/homebrew/bin/tesseract"):
    pytesseract.pytesseract.tesseract_cmd = "/opt/homebrew/bin/tesseract"

# ==========================================
# 1. アカウント管理
# ==========================================
class AccountActionPayload(BaseModel):
    account: str

@router.get("/accounts")
def get_accounts():
    accounts = get_account_list()
    current = get_app_state().get("current_account", "default")
    return {
        "accounts": accounts,
        "current_account": current,
        "max_reached": len(accounts) >= 5
    }

@router.post("/accounts/switch")
def switch_account(payload: AccountActionPayload):
    target = payload.account.strip()
    accounts = get_account_list()
    if target not in accounts:
        raise HTTPException(status_code=400, detail="存在しないアカウントです。")
    set_current_account(target)
    return {"status": "ok", "current_account": target}

@router.post("/accounts/create")
def create_account(payload: AccountActionPayload):
    accounts = get_account_list()
    new_acc = payload.account.strip()

    if len(accounts) >= 5:
        raise HTTPException(status_code=400, detail="アカウントは最大5つまで作成可能です。")

    if not re.match(r'^[a-zA-Z0-9_\-]{1,20}$', new_acc):
        raise HTTPException(status_code=400, detail="アカウント名は半角英数字・ハイフン・アンダースコアのみ（1〜20文字）です。")

    if new_acc in accounts:
        raise HTTPException(status_code=400, detail="既に存在するアカウント名です。")

    # フォルダと基本ファイルの初期化
    paths = AccountPaths(new_acc)
    paths.ensure_dirs()
    load_account_config(new_acc)
    set_current_account(new_acc)

    return {
        "status": "ok",
        "accounts": get_account_list(),
        "current_account": new_acc
    }


# ==========================================
# 3. 計算機メモ (アカウント別 scratchpad.txt)
# ==========================================
class CalcContentPayload(BaseModel):
    content: str
    account: str = None

@router.get("/calc_content")
def get_calc_content(account: str = None):
    paths = AccountPaths(account)
    if paths.scratchpad_file.exists():
        try:
            return {"content": paths.scratchpad_file.read_text(encoding="utf-8"), "account": paths.account}
        except Exception:
            pass
    default_text = "# AIN Calculator & Scratchpad\n# (Type ?? and press Enter for help)\n\n"
    return {"content": default_text, "account": paths.account}

@router.post("/calc_content")
def save_calc_content(payload: CalcContentPayload):
    paths = AccountPaths(payload.account)
    paths.ensure_dirs()
    try:
        paths.scratchpad_file.write_text(payload.content, encoding="utf-8")
        return {"status": "ok", "account": paths.account}
    except Exception as e:
        return {"status": "error", "message": str(e)}

# ==========================================
# 4. xraylib 元素吸収計算
# ==========================================
@router.get("/calc/xray")
def get_xray_physics(element: str, energy_kev: float):
    sym = element.strip().capitalize()
    try:
        z = xraylib.SymbolToAtomicNumber(sym)
        if z <= 0 or z > 100:
            raise ValueError()
    except Exception:
        raise HTTPException(status_code=400, detail=f"不明な元素記号です: {element}")

    try:
        density = xraylib.ElementDensity(z)
        mass_att = xraylib.CS_Total(z, energy_kev)
        mu_cm1 = mass_att * density
        mu_mm1 = mu_cm1 / 10.0
        att_len_mm = (1.0 / mu_mm1) if mu_mm1 > 0 else 0
        hvl_mm = (math.log(2.0) / mu_mm1) if mu_mm1 > 0 else 0

        edge_k = None
        try:
            k_val = xraylib.EdgeEnergy(z, xraylib.K_SHELL)
            if k_val > 0:
                edge_k = round(k_val, 3)
        except Exception:
            pass

        return {
            "element": sym,
            "energy_kev": round(energy_kev, 3),
            "mu_mm1": round(mu_mm1, 3),
            "attenuation_len_mm": round(att_len_mm, 4),
            "hvl_mm": round(hvl_mm, 4),
            "k_edge_kev": edge_k
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==========================================
# 5. リング電流取得 (OCR)
# ==========================================
def fetch_ring_current_by_facility(facility: str, cfg: dict) -> str:
    # 1. URLの解決（新形式 ring_url -> ring_facilities リスト -> 旧設定の順で探索）
    base_url = cfg.get("ring_url", "").strip()
    if not base_url:
        for item in cfg.get("ring_facilities", []):
            if item.get("name") == facility:
                base_url = item.get("url", "").strip()
                break
    if not base_url:
        legacy_map = {
            "SAGA-LS": cfg.get("ring_url_sagals", "https://www.saga-ls.jp/acc/accstatus.jpg"),
            "SPring-8": cfg.get("ring_url_spring8", "https://spring8.jp/status/sr_status_en.png"),
            "PF": cfg.get("ring_url_pf", "https://www-pfring.kek.jp/PF/status/pf_status.png")
        }
        base_url = legacy_map.get(facility, "")

    if not base_url:
        return "URL未設定"

    sep = "&" if "?" in base_url else "?"
    target_url = f"{base_url}{sep}t={int(time.time() * 1000)}"

    headers = {"User-Agent": "Mozilla/5.0"}
    try:
        resp = requests.get(target_url, headers=headers, timeout=5.0)
        if resp.status_code != 200:
            return f"HTTP {resp.status_code}"

        content_type = resp.headers.get("Content-Type", "").lower()

        # ① 画像以外（JSON / テキスト / HTML）が返ってきた場合
        if "image" not in content_type:
            # 1) JSON としてパースできるか試みる（NanoTerasu 等に対応）
            try:
                data = resp.json()
                if isinstance(data, dict):
                    for k, v in data.items():
                        # キー名に "current" を含むものを探索
                        if "current" in k.lower():
                            # NanoTerasu形式: {"res": [["timestamp", 400.1, ...]]}
                            if isinstance(v, dict) and "res" in v:
                                res_list = v.get("res")
                                if isinstance(res_list, list) and len(res_list) > 0:
                                    first_item = res_list[0]
                                    if isinstance(first_item, list) and len(first_item) >= 2:
                                        return f"{float(first_item[1]):.2f} mA"
                            # シンプルなJSON形式: {"current": 400.1} または {"beam_current": "400.1"}
                            elif isinstance(v, (int, float)):
                                return f"{float(v):.2f} mA"
                            elif isinstance(v, str):
                                m_num = re.search(r'\d+(?:\.\d+)?', v)
                                if m_num:
                                    return f"{float(m_num.group()):.2f} mA"
            except Exception:
                pass

            # 2) JSON以外のテキスト / HTML からの「数値 + mA」抽出フォールバック
            clean_text = re.sub(r'<[^>]+>', ' ', resp.text)
            for m in re.finditer(r'(\d+(?:\.\d+)?)\s*mA', clean_text, re.IGNORECASE):
                val = float(m.group(1))
                if val > 0:
                    return f"{val:.2f} mA"

            return "---.- mA"

        # ② 画像の場合はこれまで通り OpenCV でデコード
        img_array = np.asarray(bytearray(resp.content), dtype=np.uint8)
        img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
        if img is None:
            return "デコード失敗"
    except Exception as e:
        return f"通信エラー: {str(e)}"
    h, w, _ = img.shape
    text = ""

    try:
        if facility == "PF":
            ymin, ymax = int(h * 0.69), int(h * 0.76)
            xmin, xmax = int(w * 0.23), int(w * 0.38)
            roi = img[ymin:ymax, xmin:xmax]
            r_channel = roi[:, :, 2]
            resized = cv2.resize(r_channel, None, fx=3.0, fy=3.0, interpolation=cv2.INTER_CUBIC)
            _, thresh = cv2.threshold(resized, 180, 255, cv2.THRESH_BINARY)
            custom_config = r'--psm 7 -c tessedit_char_whitelist=0123456789.'
            text = pytesseract.image_to_string(thresh, config=custom_config).strip()

        elif facility == "SAGA-LS":
            ymin, ymax = int(h * 0.05), int(h * 0.14)
            xmin, xmax = int(w * 0.39), int(w * 0.57)
            roi = img[ymin:ymax, xmin:xmax]
            gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
            resized = cv2.resize(gray, None, fx=2.5, fy=2.5, interpolation=cv2.INTER_CUBIC)
            _, thresh = cv2.threshold(resized, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
            custom_config = r'--psm 7 -c tessedit_char_whitelist=0123456789.'
            text = pytesseract.image_to_string(thresh, config=custom_config).strip()

        elif facility == "SPring-8":
            ymin, ymax = int(h * 0.62), int(h * 0.69)
            xmin, xmax = int(w * 0.005), int(w * 0.18)
            roi = img[ymin:ymax, xmin:xmax]
            gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
            resized = cv2.resize(gray, None, fx=2.5, fy=2.5, interpolation=cv2.INTER_CUBIC)
            _, thresh = cv2.threshold(resized, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
            custom_config = r'--psm 7 -c tessedit_char_whitelist=0123456789.'
            text = pytesseract.image_to_string(thresh, config=custom_config).strip()

        else:
            # ユーザー追加施設向け：画像全体から「数値 + mA」を自動探索
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            full_text = pytesseract.image_to_string(gray, config=r'--psm 6')
            ma_match = re.search(r'(\d+(?:\.\d+)?)\s*mA', full_text, re.IGNORECASE)
            if ma_match:
                return f"{float(ma_match.group(1)):.2f} mA"
            return "---.- mA"

    except pytesseract.TesseractNotFoundError:
        return "OCR未導入 (Tesseract)"
    except Exception as e:
        return f"OCRエラー: {str(e)}"

    match = re.search(r'\d+\.\d+|\d+', text)
    if match:
        return f"{float(match.group()):.2f} mA"
    return f"{text} mA" if text else "---.- mA"


@router.get("/ring_current")
def get_ring_current_api(account: str = None):
    cfg = load_account_config(account)
    facility = cfg.get("ring_facility", "SAGA-LS")
    current_val = fetch_ring_current_by_facility(facility, cfg)
    return {"facility": facility, "current": current_val}

# ==========================================
# 6. OSファイル選択ダイアログ ＆ ヘルプ表示
# ==========================================
@router.post("/select_folder")
def select_folder():
    current_os = platform.system()
    if current_os == "Darwin":
        script = '''
        tell application "System Events"
            activate
            set selectedFolder to choose folder with prompt "ログの保存先フォルダを選択してください"
            return POSIX path of selectedFolder
        end tell
        '''
        try:
            result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, check=True)
            folder_path = result.stdout.strip()
            if folder_path and not folder_path.endswith("/"):
                folder_path += "/"
            return {"folder": folder_path, "os": "macOS"}
        except subprocess.CalledProcessError:
            return {"folder": None, "canceled": True, "os": "macOS"}
        except Exception as e:
            return JSONResponse(status_code=500, content={"error": str(e), "folder": None, "os": "macOS"})
    elif current_os == "Windows":
        ps_cmd = "[System.Reflection.Assembly]::LoadWithPartialName('System.windows.forms') | Out-Null;$dialog = New-Object System.Windows.Forms.FolderBrowserDialog;$dialog.Description = 'フォルダを選択してください';if ($dialog.ShowDialog() -eq 'OK') { Write-Output $dialog.SelectedPath }"
        try:
            result = subprocess.run(["powershell", "-NoProfile", "-Command", ps_cmd], capture_output=True, text=True, check=True)
            folder_path = result.stdout.strip()
            if not folder_path:
                return {"folder": None, "canceled": True, "os": "Windows"}
            if not folder_path.endswith("\\"):
                folder_path += "\\"
            return {"folder": folder_path, "os": "Windows"}
        except Exception as e:
            return JSONResponse(status_code=500, content={"error": str(e), "folder": None, "os": "Windows"})
    return {"folder": None, "os": current_os}

@router.post("/select_app_file")
def select_app_file():
    current_os = platform.system()
    if current_os == "Darwin":
        apple_script = '''
        try
            tell application "Finder"
                activate
                set chosenItem to choose file of type {"app", "com.apple.application-bundle"} with prompt "ImageJ または Fiji.app を選択してください" default location (path to applications folder)
                return POSIX path of chosenItem
            end tell
        on error
            return ""
        end try
        '''
        try:
            result = subprocess.run(["osascript", "-e", apple_script], capture_output=True, text=True, check=True)
            app_path = result.stdout.strip().rstrip("/")
            return {"file": app_path}
        except Exception as e:
            return JSONResponse(status_code=500, content={"error": str(e)})
    elif current_os == "Windows":
        ps_cmd = (
            "[System.Reflection.Assembly]::LoadWithPartialName('System.windows.forms') | Out-Null;"
            "$dialog = New-Object System.Windows.Forms.OpenFileDialog;"
            "$dialog.Filter = 'Executable (*.exe)|*.exe|All files (*.*)|*.*';"
            "$dialog.Title = 'ImageJ.exe を選択してください';"
            "if ($dialog.ShowDialog() -eq 'OK') { Write-Output $dialog.FileName }"
        )
        try:
            result = subprocess.run(["powershell", "-NoProfile", "-Command", ps_cmd], capture_output=True, text=True, check=True)
            return {"file": result.stdout.strip()}
        except Exception as e:
            return JSONResponse(status_code=500, content={"error": str(e)})
    return {"file": ""}

@router.get("/open_help")
def open_help(account: Optional[str] = None):
  try:
    cfg = load_account_config(account)
    help_path_str = cfg.get("help_file", "./AIN2_Manual_JP.pdf")

    # 相対パスを絶対パスに変換
    base_dir = Path(__file__).resolve().parent.parent
    help_path = Path(help_path_str)
    if not help_path.is_absolute():
      help_path = (base_dir / help_path).resolve()

    # 指定されたファイルが存在しない場合、プロジェクト直下の *.pdf をフォールバック検索
    if not help_path.exists():
      pdfs = list(base_dir.glob("*.pdf"))
      if pdfs:
        help_path = pdfs[0].resolve()
      else:
        return JSONResponse(
            status_code=404, content={"error": "Help PDF not found"}
        )

    # OSごとの起動（macOSなら open コマンドを使用）
    current_os = platform.system()
    if current_os == "Darwin":
      subprocess.run(["open", str(help_path)], check=True)
    elif current_os == "Windows":
      os.startfile(str(help_path))
    else:
      webbrowser.open(f"file://{help_path}")

    return {"status": "ok", "path": str(help_path)}

  except Exception as e:
    return JSONResponse(status_code=500, content={"error": str(e)})

@router.post("/select_file")
def select_file():
    current_os = platform.system()
    if current_os == "Darwin":
        apple_script = '''
        tell application "System Events"
            activate
        end tell
        tell application "Finder"
            activate
            try
                set chosenFile to choose file of type {"pdf"} with prompt "ヘルプPDFファイルを選択してください"
                return POSIX path of chosenFile
            on error
                return ""
            end try
        end tell
        '''
        try:
            result = subprocess.run(["osascript", "-e", apple_script], capture_output=True, text=True, check=True)
            file_path = result.stdout.strip()
            return {"file": file_path}
        except Exception as e:
            return JSONResponse(status_code=500, content={"error": str(e), "file": ""})
    elif current_os == "Windows":
        ps_cmd = (
            "[System.Reflection.Assembly]::LoadWithPartialName('System.windows.forms') | Out-Null;"
            "$dialog = New-Object System.Windows.Forms.OpenFileDialog;"
            "$dialog.Filter = 'PDF Files (*.pdf)|*.pdf|All files (*.*)|*.*';"
            "$dialog.Title = 'ヘルプPDFファイルを選択してください';"
            "if ($dialog.ShowDialog() -eq 'OK') { Write-Output $dialog.FileName }"
        )
        try:
            result = subprocess.run(["powershell", "-NoProfile", "-Command", ps_cmd], capture_output=True, text=True, check=True)
            return {"file": result.stdout.strip()}
        except Exception as e:
            return JSONResponse(status_code=500, content={"error": str(e), "file": ""})
    return {"file": ""}

# ==========================================
# 7. アカウント設定読み書き API
# ==========================================
@router.get("/config")
def get_config_endpoint(account: str = None):
    return load_account_config(account)

@router.post("/config")
def save_config_endpoint(cfg: dict):
    acc = cfg.get("account_name")
    save_account_config(cfg, acc)
    return {"status": "ok"}



