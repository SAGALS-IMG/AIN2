import os
import sys
import threading
import time
import shutil
import hashlib
from pathlib import Path
import subprocess

import uvicorn
from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

try:
    import webview
except ImportError:
    webview = None

try:
    from bs4 import BeautifulSoup
except ImportError:
    BeautifulSoup = None

# 分割したコア・ルーター群のインポート
from core.config import (
    BASE_DIR, load_geometry, save_win_pos,
    get_account_list, get_app_state, set_current_account,
    load_account_config, save_account_config
)
from core.addin_loader import init_addins
from routers import logs, tools, imagej

app = FastAPI(title="AILab_Note (AIN2)", version="2.3.1")

# CORS設定
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ルーターの登録
app.include_router(logs.router)
app.include_router(tools.router)
app.include_router(imagej.router)

# 静的ファイルの配信マウント (CSS, JS, アイコン, ロゴ)
STATIC_DIR = BASE_DIR / "static"
STATIC_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

TEMPLATES_DIR = BASE_DIR / "templates"
TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)

# ==========================================
# 1. 単一インスタンス実行用の排他ファイルロック (Mac / Win 両対応)
# ==========================================
LOCK_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".ain_app.lock")
lock_file_handle = None


def bring_existing_ain_to_front():
    """既存AINインスタンスに前面化を依頼する"""
    import urllib.request
    try:
        req = urllib.request.Request(
            "http://127.0.0.1:8000/api/bring_to_front",
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=3.0) as response:
            print(f"[AIN] Existing instance activated: {response.status}")
    except Exception as e:
        print(f"[AIN] Front activation failed: {e}")


def acquire_single_instance_lock():
    global lock_file_handle
    try:
        lock_file_handle = open(LOCK_FILE, "w")
        if sys.platform == "win32":
            import msvcrt
            msvcrt.locking(lock_file_handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(lock_file_handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except (IOError, OSError):
        print("⚠️ 既に AIN が起動しています。既存ウィンドウを前面に表示して終了します。")
        bring_existing_ain_to_front()
        sys.exit(0)


# 起動直後に排他ロックを実行
acquire_single_instance_lock()

def release_single_instance_lock():
    global lock_file_handle
    try:
        if lock_file_handle:
            if sys.platform != "win32":
                import fcntl
                fcntl.flock(lock_file_handle, fcntl.LOCK_UN)
            lock_file_handle.close()
        if os.path.exists(LOCK_FILE):
            os.remove(LOCK_FILE)
    except Exception:
        pass


# ==========================================
# 基本ページ＆アセット配信
# ==========================================
@app.get("/")
def read_root():
    index_file = TEMPLATES_DIR / "index.html"
    if not index_file.exists():
        # 分割作業中のフォールバック（旧 AIN.html がルートにある場合）
        fallback = BASE_DIR.parent / "AIN" / "AIN.html"
        if fallback.exists():
            return FileResponse(fallback)
        return JSONResponse(status_code=404, content={"detail": "index.html not found"})
    return FileResponse(index_file)


@app.get("/memo")
def read_memo_page():
    f = TEMPLATES_DIR / "memo.html"
    return FileResponse(f) if f.exists() else JSONResponse(status_code=404, content={"error": "memo.html not found"})


@app.get("/calc")
def read_calc_page():
    f = TEMPLATES_DIR / "calc.html"
    return FileResponse(f) if f.exists() else JSONResponse(status_code=404, content={"error": "calc.html not found"})


@app.get("/logo")
def get_logo():
    logo_path = STATIC_DIR / "img" / "SAGA_LS.png"
    if logo_path.exists():
        return FileResponse(logo_path, media_type="image/png")
    return JSONResponse(status_code=404, content={"error": "Logo not found"})


# ==========================================
# 独立ウィンドウ管理 (pywebview)
# ==========================================
main_window_instance = None
sub_windows = {}


def _save_geometry(win_key: str, window):
    try:
        if window.x is not None and window.y is not None:
            geom = {
                "x": int(window.x),
                "y": int(window.y),
                "width": int(window.width),
                "height": int(window.height)
            }
            save_win_pos(win_key, geom)
    except Exception as e:
        print(f"[Geometry Error] {win_key}: {e}")


def create_sub_window(win_key: str, title: str, path: str, default_w: int, default_h: int):
    global sub_windows
    if webview is None:
        return {"status": "fallback_browser"}

    win = sub_windows.get(win_key)
    if win is not None:
        try:
            win.show()
            win.restore()
            return {"status": "already_open"}
        except Exception:
            sub_windows[win_key] = None

    try:
        geom = load_geometry().get(win_key, {})
        init_x = geom.get("x")
        init_y = geom.get("y")
        init_w = geom.get("width", default_w)
        init_h = geom.get("height", default_h)

        kwargs = {
            "title": title,
            "url": f"http://127.0.0.1:8000{path}",
            "width": init_w,
            "height": init_h,
            "resizable": True
        }
        if init_x is not None and init_y is not None:
            kwargs["x"] = init_x
            kwargs["y"] = init_y

        new_win = webview.create_window(**kwargs)
        new_win.events.moved += lambda: _save_geometry(win_key, new_win)
        new_win.events.resized += lambda: _save_geometry(win_key, new_win)

        def on_sub_closed():
            sub_windows[win_key] = None
        new_win.events.closed += on_sub_closed

        sub_windows[win_key] = new_win
        return {"status": "ok"}
    except Exception as e:
        print(f"[SubWindow Error] {win_key}: {e}")
        return {"status": "error", "message": str(e)}


@app.post("/api/open_memo_window")
def open_memo():
    return create_sub_window("window_memo", "AIN Memo", "/memo", 680, 750)


@app.post("/api/open_calc_window")
def open_calc():
    return create_sub_window("window_calc", "AIN Calculator", "/calc", 540, 600)


init_addins(app, create_sub_window)


class TitlePayload(BaseModel):
    title: str
    win_key: str = "window_main"


@app.post("/api/set_window_title")
def set_window_title(payload: TitlePayload):
    global main_window_instance, sub_windows
    try:
        if not payload.win_key or payload.win_key == "window_main":
            if main_window_instance is not None:
                main_window_instance.set_title(payload.title)
        else:
            win = sub_windows.get(payload.win_key)
            if win is not None:
                win.set_title(payload.title)
    except Exception as e:
        print(f"[Set Title Error] {payload.win_key}: {e}")
    return {"status": "ok"}


@app.post("/api/bring_to_front")
def api_bring_to_front():
    """既存インスタンスのメインウィンドウを最前面に表示"""
    global main_window_instance

    def _activate():
        try:
            if main_window_instance is None:
                print("[BringToFront] Main window not ready")
                return

            if sys.platform == "darwin":
                from AppKit import NSApplication

                ns_app = NSApplication.sharedApplication()
                ns_app.activateIgnoringOtherApps_(True)

                main_window_instance.restore()
                main_window_instance.show()
                main_window_instance.on_top = True

                def reset_on_top():
                    try:
                        main_window_instance.on_top = False
                    except Exception:
                        pass

                threading.Timer(0.3, reset_on_top).start()
                print("[BringToFront] macOS activation requested")

            else:
                main_window_instance.restore()
                main_window_instance.show()
                main_window_instance.on_top = True
                time.sleep(0.1)
                main_window_instance.on_top = False

        except Exception as e:
            print(f"[BringToFront Error] {e}")

    if sys.platform == "darwin":
        try:
            from PyObjCTools import AppHelper
            AppHelper.callAfter(_activate)
        except Exception as e:
            print(f"[AppHelper Error] {e}")
            threading.Thread(target=_activate, daemon=True).start()
    else:
        threading.Thread(target=_activate, daemon=True).start()

    return {"status": "ok"}


# ==========================================
# アカウント管理 ＆ アカウント別設定 API
# ==========================================
class SwitchAccountPayload(BaseModel):
    account: str


class CreateAccountPayload(BaseModel):
    account: str


@app.get("/api/accounts")
def api_get_accounts():
    accounts = get_account_list()
    state = get_app_state()
    current = state.get("current_account", "default")
    if current not in accounts:
        current = accounts[0] if accounts else "default"
    return {
        "accounts": accounts,
        "current_account": current,
        "max_reached": len(accounts) >= 5
    }


@app.post("/api/accounts/switch")
def api_switch_account(payload: SwitchAccountPayload):
    accounts = get_account_list()
    target = payload.account.strip()
    if target not in accounts:
        return JSONResponse(status_code=400, content={"detail": "存在しないアカウントです"})
    set_current_account(target)
    return {"status": "ok", "current_account": target}


@app.post("/api/accounts/create")
def api_create_account(payload: CreateAccountPayload):
    new_acc = payload.account.strip()
    if not new_acc:
        return JSONResponse(status_code=400, content={"detail": "アカウント名を入力してください"})
    set_current_account(new_acc)
    load_account_config(new_acc)
    return {"status": "ok", "accounts": get_account_list(), "current_account": new_acc}


@app.get("/api/config")
def api_get_config(account: str = None):
    acc = account or get_app_state().get("current_account", "default")
    return load_account_config(acc)


@app.post("/api/config")
def api_save_config(cfg: dict):
    acc = cfg.get("account_name") or get_app_state().get("current_account", "default")
    save_account_config(cfg, acc)
    return {"status": "ok", "config": load_account_config(acc)}


# ==========================================
# 終了処理 ＆ 差分バックアップ（ログ OR マージ対応）
# ==========================================
_exit_backup_done = False


def _extract_body_blocks(html_text: str):
    """HTMLの<body>直下のブロック要素と、それぞれの識別指紋(ハッシュ)を抽出する"""
    soup = BeautifulSoup(html_text, "html.parser")
    body = soup.body if soup.body else soup
    blocks = []

    for child in body.contents:
        if isinstance(child, str):
            text_clean = child.strip()
            if not text_clean:
                continue
            sig = hashlib.sha256(f"TXT:{text_clean}".encode("utf-8")).hexdigest()
            blocks.append((sig, str(child)))
        else:
            txt_part = " ".join(child.get_text().split())
            imgs = [img.get("src", "") for img in child.find_all("img")]
            if child.name == "img":
                imgs.append(child.get("src", ""))
            img_sig = hashlib.sha256("".join(imgs).encode("utf-8")).hexdigest() if imgs else ""

            if not txt_part and not img_sig:
                sig = f"EMPTY_{len(blocks)}_{id(child)}"
            else:
                sig = hashlib.sha256(f"TAG:{child.name}|TXT:{txt_part}|IMG:{img_sig}".encode("utf-8")).hexdigest()
            blocks.append((sig, str(child)))

    return blocks


def merge_html_logs_or(local_file: Path, remote_file: Path):
    """ローカルとバックアップ先のHTMLログを比較し、OR(和集合)で統合して両方に保存する"""
    if not local_file.exists() and not remote_file.exists():
        return
    if local_file.exists() and not remote_file.exists():
        remote_file.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(local_file, remote_file)
        return
    if not local_file.exists() and remote_file.exists():
        local_file.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(remote_file, local_file)
        return

    # BeautifulSoup 未導入環境向けの安全フォールバック
    if BeautifulSoup is None:
        if local_file.stat().st_mtime >= remote_file.stat().st_mtime:
            shutil.copy2(local_file, remote_file)
        else:
            shutil.copy2(remote_file, local_file)
        return

    local_html = local_file.read_text(encoding="utf-8")
    remote_html = remote_file.read_text(encoding="utf-8")

    if local_html.strip() == remote_html.strip():
        return

    local_blocks = _extract_body_blocks(local_html)
    remote_blocks = _extract_body_blocks(remote_html)

    seen_sigs = set()
    merged_html_parts = []

    for sig, raw_block in local_blocks:
        if not sig.startswith("EMPTY_"):
            seen_sigs.add(sig)
        merged_html_parts.append(raw_block)

    added_count = 0
    for sig, raw_block in remote_blocks:
        if sig.startswith("EMPTY_"):
            continue
        if sig not in seen_sigs:
            seen_sigs.add(sig)
            merged_html_parts.append(raw_block)
            added_count += 1

    if added_count > 0 or len(local_blocks) != len(remote_blocks):
        merged_body = "\n".join(merged_html_parts)
        full_html = (
            '<!DOCTYPE html>\n<html><head><meta charset="UTF-8"></head>'
            f'<body style="font-family: sans-serif; padding: 20px;">\n{merged_body}\n</body></html>'
        )
        shutil.copy2(local_file, local_file.with_suffix(".bak"))
        local_file.write_text(full_html, encoding="utf-8")
        remote_file.write_text(full_html, encoding="utf-8")


def sync_logs_with_or_merge(local_log_root: Path, remote_log_root: Path):
    """全アカウントのLogフォルダを走査し、HTMLログはORマージ・その他は新しい方を同期する"""
    if not local_log_root.exists() and not remote_log_root.exists():
        return

    local_log_root.mkdir(parents=True, exist_ok=True)
    remote_log_root.mkdir(parents=True, exist_ok=True)

    rel_files = set()
    for root_dir in (local_log_root, remote_log_root):
        for p in root_dir.rglob("*"):
            if p.is_file() and not p.name.endswith(".tmp") and p.name != ".DS_Store":
                rel_files.add(p.relative_to(root_dir))

    for rel_path in sorted(rel_files):
        l_file = local_log_root / rel_path
        r_file = remote_log_root / rel_path

        if rel_path.suffix.lower() == ".html":
            merge_html_logs_or(l_file, r_file)
        else:
            if l_file.exists() and (not r_file.exists() or l_file.stat().st_mtime > r_file.stat().st_mtime):
                r_file.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(l_file, r_file)
            elif r_file.exists() and (not l_file.exists() or r_file.stat().st_mtime > l_file.stat().st_mtime):
                l_file.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(r_file, l_file)


def run_exit_backup():
    """設定が有効な場合、バックアップを実行する（隠しファイル .ain_full_backup がある場合は全ソースも同期）"""
    global _exit_backup_done
    if _exit_backup_done:
        return
    _exit_backup_done = True

    try:
        acc = get_app_state().get("current_account", "default")
        cfg = load_account_config(acc)
        if not cfg.get("backup_on_exit", False):
            return

        dest_dir = cfg.get("backup_dest_dir", "").strip()
        if not dest_dir:
            return

        dest_path = Path(os.path.expanduser(dest_dir))
        if not dest_path.parent.exists():
            print(f"⚠️ バックアップ先の親フォルダが見つかりません: {dest_path.parent}")
            return

        dest_path.mkdir(parents=True, exist_ok=True)

        # 🔒 開発者用隠しスイッチ: .ain_full_backup が存在する場合のみ全ソースを差分同期
        is_full_backup = (BASE_DIR / ".ain_full_backup").exists()
        if is_full_backup:
            src = str(BASE_DIR).rstrip("/") + "/"
            dst = str(dest_path).rstrip("/") + "/"

            if sys.platform != "win32":
                cmd = [
                    "rsync", "-av", "--update",
                    "--exclude=Log/",
                    "--exclude=.ain_app.lock",
                    "--exclude=.ain_full_backup",
                    "--exclude=*.tmp",
                    "--exclude=tmp_imagej/",
                    "--exclude=__pycache__/",
                    "--exclude=.git/",
                    "--exclude=.DS_Store",
                    src, dst
                ]
                subprocess.run(cmd, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            else:
                exclude_names = {"Log", ".ain_app.lock", ".ain_full_backup", "tmp_imagej", "__pycache__", ".git"}
                for root, dirs, files in os.walk(BASE_DIR):
                    dirs[:] = [d for d in dirs if d not in exclude_names]
                    rel_root = os.path.relpath(root, BASE_DIR)
                    target_root = dest_path if rel_root == "." else dest_path / rel_root
                    target_root.mkdir(parents=True, exist_ok=True)
                    for fname in files:
                        if fname in exclude_names or fname.endswith(".tmp"):
                            continue
                        s_file = Path(root) / fname
                        d_file = target_root / fname
                        if not d_file.exists() or s_file.stat().st_mtime > d_file.stat().st_mtime:
                            shutil.copy2(s_file, d_file)

        # 全ユーザー共通: Log/ 配下は OR マージ＆差分同期
        sync_logs_with_or_merge(BASE_DIR / "Log", dest_path / "Log")

        mode_label = "全ソース＆ログOR統合" if is_full_backup else "ログOR統合"
        print(f"✅ バックアップ完了 ({mode_label}): {dest_path}")
    except Exception as e:
        print(f"[Exit Backup Error] {e}")


@app.post("/api/app_quit")
def app_quit():
    imagej.cleanup_imagej_tmp()
    run_exit_backup()

    def _delayed_exit():
        time.sleep(0.2)
        release_single_instance_lock()
        os._exit(0)

    threading.Thread(target=_delayed_exit, daemon=True).start()
    return {"status": "ok"}


# ==========================================
# メインウィンドウ終了時の未保存チェック制御
# ==========================================
is_checking_exit = False


def _handle_exit_check_async():
    """OSクローズ完了を待ってからJSに未保存判定を問い合わせる"""
    global is_checking_exit, main_window_instance
    time.sleep(0.08)
    try:
        if main_window_instance:
            main_window_instance.evaluate_js('''
                (function() {
                    if (typeof isModified !== "undefined" && isModified) {
                        if (typeof openQuitModal === "function") {
                            openQuitModal();
                        }
                    } else {
                        fetch("/api/app_quit", { method: "POST" });
                    }
                })();
            ''')
    except Exception as e:
        print(f"[Exit Check Error] {e}")
        release_single_instance_lock()
        os._exit(0)
    finally:
        is_checking_exit = False


def on_main_closing():
    global main_window_instance, is_checking_exit
    if main_window_instance:
        _save_geometry("window_main", main_window_instance)

        if not is_checking_exit:
            is_checking_exit = True
            threading.Thread(target=_handle_exit_check_async, daemon=True).start()

        return False


def on_main_closed():
    imagej.cleanup_imagej_tmp()
    run_exit_backup()
    release_single_instance_lock()
    os._exit(0)


# ==========================================
# 起動エントリーポイント
# ==========================================
def start_server():
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="warning")


if __name__ == "__main__":
    server_thread = threading.Thread(target=start_server, daemon=True)
    server_thread.start()
    time.sleep(1.0)

    if webview is not None:
        geom = load_geometry().get("window_main", {})
        init_x = geom.get("x")
        init_y = geom.get("y")
        init_w = geom.get("width", 1150)
        init_h = geom.get("height", 850)

        main_kwargs = {
            "title": "AIN - AILab Note",
            "url": "http://127.0.0.1:8000/",
            "width": init_w,
            "height": init_h,
            "resizable": True
        }
        if init_x is not None and init_y is not None:
            main_kwargs["x"] = init_x
            main_kwargs["y"] = init_y

        main_window_instance = webview.create_window(**main_kwargs)
        main_window_instance.events.moved += lambda: _save_geometry("window_main", main_window_instance)
        main_window_instance.events.resized += lambda: _save_geometry("window_main", main_window_instance)
        main_window_instance.events.closing += on_main_closing
        main_window_instance.events.closed += on_main_closed

        webview.start()
        imagej.cleanup_imagej_tmp()
        release_single_instance_lock()
        sys.exit(0)
    else:
        print("pywebview not installed. Running in server-only mode on http://127.0.0.1:8000")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            imagej.cleanup_imagej_tmp()
            release_single_instance_lock()