import os
import glob
import time
import base64
import platform
import subprocess
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.config import AccountPaths, load_account_config

router = APIRouter(prefix="/api/imagej", tags=["imagej"])

# 一時作業領域の定義 (AIN2/tmp_imagej)
BASE_DIR = Path(__file__).resolve().parent.parent
IMAGEJ_WORK_DIR = BASE_DIR / "tmp_imagej"
IMAGEJ_WORK_DIR.mkdir(parents=True, exist_ok=True)

SYNC_IMG_PATH = IMAGEJ_WORK_DIR / "fiji_sync_latest.png"
SYNC_LOG_PATH = IMAGEJ_WORK_DIR / "fiji_sync_latest.txt"

def cleanup_imagej_tmp():
    """一時画像や追跡スクリプトをクリーンアップ"""
    if IMAGEJ_WORK_DIR.exists():
        for f in IMAGEJ_WORK_DIR.glob("*"):
            try:
                if f.is_file():
                    f.unlink()
            except Exception as e:
                print(f"[ImageJ Cleanup Warning] {f.name}: {e}")

class ImageJOpenPayload(BaseModel):
    session_id: str
    image_data: str  # Base64 data URL
    account: Optional[str] = None

def is_fiji_running() -> bool:
    try:
        if platform.system() == "Darwin":
            out = subprocess.check_output(["pgrep", "-if", "imagej"], stderr=subprocess.DEVNULL)
            return bool(out.strip())
        elif platform.system() == "Windows":
            out = subprocess.check_output(["tasklist", "/FI", "IMAGENAME eq ImageJ*"], stderr=subprocess.DEVNULL)
            return b"ImageJ" in out
    except Exception:
        pass
    return False

@router.post("/open")
def open_in_imagej(payload: ImageJOpenPayload):
    """
    選択画像を一時PNG化し、Fijiを自動監視スクリプト付きで起動
    """
    # ★ Fijiが既に起動中なら、多重処理を防ぐためにブロック
    if is_fiji_running():
        raise HTTPException(
            status_code=409,
            detail="Fiji is operated by another image!"
        )

    cfg = load_account_config(payload.account)
    ij_path_str = cfg.get("imagej_path", "").strip()
    if not ij_path_str:
        raise HTTPException(status_code=400, detail="ImageJ/Fiji の実行パスが設定されていません。Option画面で指定してください。")

    ij_path = Path(os.path.expanduser(ij_path_str))
    if not ij_path.exists():
        raise HTTPException(status_code=400, detail=f"指定された ImageJ/Fiji が見つかりません: {ij_path}")

    # 1. Base64 画像をデコードして一時書き出し
    try:
        raw_data = payload.image_data.strip()
        if "," in raw_data:
            _, b64data = raw_data.split(",", 1)
        else:
            b64data = raw_data
        b64data = "".join(b64data.split())
        missing_padding = len(b64data) % 4
        if missing_padding:
            b64data += "=" * (4 - missing_padding)

        img_bytes = base64.b64decode(b64data)
        input_file = IMAGEJ_WORK_DIR / f"ain_in_{int(time.time())}.png"
        input_file.write_bytes(img_bytes)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"一時画像の書き出しに失敗しました: {e}")

    # 古い同期ファイルをリセット
    for p in [SYNC_IMG_PATH, SYNC_LOG_PATH]:
        if p.exists():
            try:
                p.unlink()
            except Exception:
                pass

    # 2. バックグラウンド自動監視 Jython スクリプトの生成
    sync_script = IMAGEJ_WORK_DIR / "ain_watcher.py"
    script_content = f'''import time
import os
from java.lang import Thread, Runnable
from ij import IJ, ImagePlus, WindowManager
from ij.plugin.frame import Recorder

out_img = r"{SYNC_IMG_PATH.resolve()}"
out_log = r"{SYNC_LOG_PATH.resolve()}"

# 初期画像を開く
imp = IJ.openImage(r"{input_file.resolve()}")
if imp:
    imp.show()

# Recorder 起動
if not Recorder.getInstance():
    IJ.run("Record...")

class SyncWorker(Runnable):
    def run(self):
        last_log = ""
        while True:
            try:
                # 最前面画像があれば PNG 保存
                curr_imp = WindowManager.getCurrentImage()
                if curr_imp:
                    IJ.saveAs(curr_imp, "PNG", out_img)
                
                # Recorder ログを取得
                rec = Recorder.getInstance()
                if rec:
                    log_text = rec.getText() or ""
                    if log_text != last_log:
                        last_log = log_text
                        with open(out_log, "w") as f:
                            f.write(log_text)
            except:
                pass
            time.sleep(1.0)

# デーモンスレッドとして常駐開始（Fiji終了で自動終了）
t = Thread(SyncWorker())
t.setDaemon(True)
t.start()
'''
    sync_script.write_text(script_content, encoding="utf-8")

    # 3. OS に応じた Fiji 起動プロセスの構築
    if platform.system() == "Darwin":
        fiji_bin = ij_path / "Contents" / "MacOS" / "ImageJ-macosx"
        if not fiji_bin.exists():
            fiji_bin = ij_path / "Contents" / "MacOS" / "fiji-macosx"

        if fiji_bin.exists():
            cmd = [str(fiji_bin), "--run", str(sync_script.resolve())]
        else:
            cmd = ["open", "-a", str(ij_path), "--args", "--run", str(sync_script.resolve())]
    else:
        cmd = [str(ij_path), "--run", str(sync_script.resolve())]

    try:
        subprocess.Popen(cmd)
        return {"status": "ok", "message": "Fiji を起動し、常駐監視を開始しました。"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ImageJ/Fiji 起動失敗: {e}")

@router.get("/fetch_active")
def fetch_active_from_imagej():
    """
    エディタで右クリック時に呼び出し:
    最前面で編集されていた最新画像と操作ログを取得
    """
    if not SYNC_IMG_PATH.exists() or SYNC_IMG_PATH.stat().st_size == 0:
        raise HTTPException(
            status_code=400,
            detail="Fiji の同期画像が見つかりません。Fiji で画像が開かれているか確認してください。"
        )

    try:
        img_bytes = SYNC_IMG_PATH.read_bytes()
        b64_str = base64.b64encode(img_bytes).decode("utf-8")
        image_data_url = f"data:image/png;base64,{b64_str}"
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"同期画像読み込みエラー: {e}")

    log_content = "(操作ログなし)"
    if SYNC_LOG_PATH.exists():
        try:
            log_content = SYNC_LOG_PATH.read_text(encoding="utf-8").strip() or "(操作ログなし)"
        except Exception:
            pass

    now_str = time.strftime("%H:%M:%S")
    return {
        "status": "ok",
        "image_data": image_data_url,
        "log_text": log_content,
        "timestamp": now_str
    }