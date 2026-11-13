import json
import webbrowser
from pathlib import Path
from fastapi import APIRouter
from pydantic import BaseModel
from core.config import BASE_DIR, get_app_state

router = APIRouter()

def get_links_file(account: str = None):
    acc = account or get_app_state().get("current_account", "default")
    acc_dir = BASE_DIR / "Log" / acc
    acc_dir.mkdir(parents=True, exist_ok=True)
    return acc_dir / "links.json"

class LinksData(BaseModel):
    links: list

class OpenUrlPayload(BaseModel):
    url: str

@router.get("/data")
def get_links(account: str = None):
    f = get_links_file(account)
    if not f.exists():
        default_data = [
            {"title": "SAGA-LS 公式", "url": "https://www.saga-ls.jp/"},
            {"title": "SPring-8", "url": "https://spring8.jp/"},
            {"title": "Photon Factory (KEK)", "url": "https://www-pfring.kek.jp/"}
        ]
        with open(f, "w", encoding="utf-8") as fp:
            json.dump(default_data, fp, ensure_ascii=False, indent=2)
        return {"links": default_data}
    
    with open(f, "r", encoding="utf-8") as fp:
        return {"links": json.load(fp)}

@router.post("/data")
def save_links(data: LinksData, account: str = None):
    f = get_links_file(account)
    with open(f, "w", encoding="utf-8") as fp:
        json.dump(data.links, fp, ensure_ascii=False, indent=2)
    return {"status": "ok"}

# ★★★ ここを追加: OS標準ブラウザでURLを開く ★★★
@router.post("/open_browser")
def open_in_browser(payload: OpenUrlPayload):
    target = payload.url.strip()
    if target:
        if not target.startswith("http://") and not target.startswith("https://"):
            target = "https://" + target
        webbrowser.open(target)
    return {"status": "ok"}