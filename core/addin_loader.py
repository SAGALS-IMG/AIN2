import os
import sys
import json
import importlib.util
from pathlib import Path
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse

ADDINS_DIR = Path(__file__).resolve().parent.parent / "Addins"
ADDINS_DIR.mkdir(parents=True, exist_ok=True)

loaded_addins = []

def init_addins(app: FastAPI, create_sub_window_func):
    """Addinsフォルダを走査してルーターと静的ファイルを登録"""
    global loaded_addins
    loaded_addins = []

    for item in sorted(ADDINS_DIR.iterdir()):
        if not item.is_dir() or item.name.startswith("."):
            continue

        manifest_file = item / "manifest.json"
        if not manifest_file.exists():
            continue

        try:
            with open(manifest_file, "r", encoding="utf-8") as f:
                manifest = json.load(f)

            addin_id = manifest.get("id", item.name)
            manifest["folder_name"] = item.name

            # 1. ルーター (router.py) の動的インポート & include
            router_file = item / "router.py"
            if router_file.exists():
                spec = importlib.util.spec_from_file_location(f"addin_{addin_id}", router_file)
                mod = importlib.util.module_from_spec(spec)
                sys.modules[f"addin_{addin_id}"] = mod
                spec.loader.exec_module(mod)
                if hasattr(mod, "router"):
                    app.include_router(mod.router, prefix=f"/api/addin/{addin_id}", tags=[f"Addin: {addin_id}"])

            # core/addin_loader.py の中盤

            # 2. 静的/UIファイル配信マウント (CSS/JS/画像等用)
            app.mount(f"/addin_view/{addin_id}", StaticFiles(directory=str(item), html=True), name=f"addin_{addin_id}")

            # ★ ここを追加: エントリーHTMLを直接確実に返すエンドポイント
            entry_filename = manifest.get("window", {}).get("entry", "window.html")
            entry_filepath = item / entry_filename
            
            def make_page_route(fpath):
                return lambda: FileResponse(fpath) if fpath.exists() else JSONResponse(
                    status_code=404, 
                    content={"error": f"Entry file not found: {fpath}"}
                )

            app.add_api_route(
                f"/addin_page/{addin_id}",
                make_page_route(entry_filepath),
                methods=["GET"]
            )

            # 3. 別窓オープン用エンドポイントの自動生成
            if manifest.get("window", {}).get("type") == "subwindow":
                win_cfg = manifest["window"]
                win_key = f"window_addin_{addin_id}"
                
                # ★ URLを確実な /addin_page/{addin_id} に向ける
                page_url = f"/addin_page/{addin_id}"
                
                def make_opener(w_key, w_title, w_path, w_w, w_h):
                    return lambda: create_sub_window_func(w_key, w_title, w_path, w_w, w_h)

                app.add_api_route(
                    f"/api/addin/{addin_id}/open_window",
                    make_opener(win_key, manifest.get("name", addin_id), page_url, win_cfg.get("width", 600), win_cfg.get("height", 700)),
                    methods=["POST"]
                )

            loaded_addins.append(manifest)
            print(f"✅ Add-in Loaded: {manifest.get('name')} ({addin_id})")

        except Exception as e:
            print(f"❌ Failed to load add-in '{item.name}': {e}")

    # フロントエンド向け: ロード済みアドイン一覧API
    @app.get("/api/addins/list")
    def get_loaded_addins():
        return {"addins": loaded_addins}