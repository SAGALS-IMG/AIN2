import json
from pathlib import Path
from fastapi import APIRouter
from pydantic import BaseModel
from core.config import BASE_DIR, get_app_state

router = APIRouter()


def get_timer_config_file(account: str = None) -> Path:
    acc = account or get_app_state().get("current_account", "default")
    acc_dir = BASE_DIR / "Log" / acc
    acc_dir.mkdir(parents=True, exist_ok=True)
    return acc_dir / "timer_config.json"


class TimerConfigPayload(BaseModel):
    presets: list[int]  # 秒単位のプリセットリスト (例: [60, 180, 300, 600])
    last_seconds: int = 300
    sound_enabled: bool = True


DEFAULT_CONFIG = {
    "presets": [60, 180, 300, 600, 1800],
    "last_seconds": 300,
    "sound_enabled": True
}


@router.get("/config")
def get_timer_config(account: str = None):
    f = get_timer_config_file(account)
    if not f.exists():
        with open(f, "w", encoding="utf-8") as fp:
            json.dump(DEFAULT_CONFIG, fp, ensure_ascii=False, indent=2)
        return DEFAULT_CONFIG

    try:
        with open(f, "r", encoding="utf-8") as fp:
            data = json.load(fp)
            return {
                "presets": data.get("presets", DEFAULT_CONFIG["presets"]),
                "last_seconds": data.get("last_seconds", 300),
                "sound_enabled": data.get("sound_enabled", True),
            }
    except Exception:
        return DEFAULT_CONFIG


@router.post("/config")
def save_timer_config(payload: TimerConfigPayload, account: str = None):
    f = get_timer_config_file(account)
    data = {
        "presets": payload.presets,
        "last_seconds": max(1, payload.last_seconds),
        "sound_enabled": payload.sound_enabled,
    }
    with open(f, "w", encoding="utf-8") as fp:
        json.dump(data, fp, ensure_ascii=False, indent=2)
    return {"status": "ok"}