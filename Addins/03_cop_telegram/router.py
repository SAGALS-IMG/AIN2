import os
import json
import urllib.request
import urllib.parse
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from core.config import AccountPaths, get_app_state, load_account_config

router = APIRouter()
JST = timezone(timedelta(hours=9))

def get_messages_file(paths: AccountPaths) -> Path:
    return paths.cop_dir / "cop_messages.json"

def get_offset_file(paths: AccountPaths) -> Path:
    return paths.cop_dir / "cop_offset.txt"

def get_config_file(paths: AccountPaths) -> Path:
    return paths.cop_dir / "config.json"

def load_tg_config(paths: AccountPaths) -> dict:
    f = get_config_file(paths)
    if f.exists():
        try:
            return json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            pass
    # 初回フォールバック：本体の config.json にトークンがあれば自動引き継ぎ
    legacy_cfg = load_account_config(paths.account)
    cfg = {
        "bot_token": legacy_cfg.get("telegram_bot_token", ""),
        "allowed_ids": legacy_cfg.get("telegram_allowed_ids", "")
    }
    if cfg["bot_token"]:
        save_tg_config(paths, cfg)
    return cfg

def save_tg_config(paths: AccountPaths, cfg: dict):
    paths.ensure_dirs()
    f = get_config_file(paths)
    f.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")

def load_local_messages(paths: AccountPaths) -> list:
    f = get_messages_file(paths)
    if not f.exists():
        return []
    try:
        return json.loads(f.read_text(encoding="utf-8"))
    except Exception:
        return []

def save_local_messages(paths: AccountPaths, msgs: list):
    paths.ensure_dirs()
    f = get_messages_file(paths)
    f.write_text(json.dumps(msgs, ensure_ascii=False, indent=2), encoding="utf-8")

def get_last_offset(paths: AccountPaths) -> int:
    f = get_offset_file(paths)
    if f.exists():
        try:
            return int(f.read_text().strip())
        except Exception:
            pass
    return 0

def save_last_offset(paths: AccountPaths, offset: int):
    paths.ensure_dirs()
    f = get_offset_file(paths)
    f.write_text(str(offset), encoding="utf-8")

# ==========================================
# 1. 設定の取得・保存 API
# ==========================================
class TgConfigPayload(BaseModel):
    bot_token: str
    allowed_ids: str
    account: Optional[str] = None

@router.get("/config")
def get_config_api(account: Optional[str] = None):
    acc = account or get_app_state().get("current_account", "default")
    paths = AccountPaths(acc)
    return {"status": "ok", "config": load_tg_config(paths)}

@router.post("/config")
def save_config_api(payload: TgConfigPayload):
    acc = payload.account or get_app_state().get("current_account", "default")
    paths = AccountPaths(acc)
    cfg = {
        "bot_token": payload.bot_token.strip(),
        "allowed_ids": payload.allowed_ids.strip()
    }
    save_tg_config(paths, cfg)
    return {"status": "ok", "config": cfg}

# ==========================================
# 2. Telegramから最新同期 ＆ 過去1週間分返却
# ==========================================
@router.post("/fetch_updates")
def fetch_cop_updates(account: Optional[str] = None):
    acc = account or get_app_state().get("current_account", "default")
    paths = AccountPaths(acc)
    paths.ensure_dirs()
    cfg = load_tg_config(paths)

    bot_token = cfg.get("bot_token", "").strip()
    allowed_users_raw = cfg.get("allowed_ids", "").strip()

    now = datetime.now(JST)
    one_week_ago = now - timedelta(days=7)
    one_week_ago_ts = int(one_week_ago.timestamp())

    local_msgs = load_local_messages(paths)

    if bot_token:
        allowed_users = [int(u.strip()) for u in allowed_users_raw.split(",") if u.strip().isdigit()]
        last_offset = get_last_offset(paths)

        url = f"https://api.telegram.org/bot{bot_token}/getUpdates?offset={last_offset}&timeout=2"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "AILab-AIN2"})
            with urllib.request.urlopen(req, timeout=5.0) as res:
                data = json.loads(res.read().decode("utf-8"))

            if data.get("ok"):
                updates = data.get("result", [])
                max_update_id = last_offset
                existing_ids = set(m.get("msg_id") for m in local_msgs if "msg_id" in m)

                for item in updates:
                    up_id = item.get("update_id", 0)
                    if up_id >= max_update_id:
                        max_update_id = up_id + 1

                    msg = item.get("message")
                    if not msg:
                        continue

                    sender_id = msg.get("from", {}).get("id")
                    if allowed_users and sender_id not in allowed_users:
                        continue

                    msg_date_ts = msg.get("date", 0)
                    if msg_date_ts < one_week_ago_ts:
                        continue

                    msg_id = f"{sender_id}_{msg_date_ts}_{msg.get('message_id')}"
                    if msg_id in existing_ids:
                        continue

                    dt = datetime.fromtimestamp(msg_date_ts, tz=JST)
                    date_str = dt.strftime("%Y%m%d")
                    time_str = dt.strftime("%H:%M:%S")

                    caption = msg.get("caption", "").strip()
                    text = msg.get("text", "").strip()
                    main_text = caption or text

                    card_type = "text"
                    local_img_name = ""

                    photos = msg.get("photo")
                    if photos and len(photos) > 0:
                        card_type = "photo"
                        best_photo = photos[-1]
                        file_id = best_photo.get("file_id")

                        try:
                            f_url = f"https://api.telegram.org/bot{bot_token}/getFile?file_id={file_id}"
                            f_req = urllib.request.Request(f_url, headers={"User-Agent": "AILab-AIN2"})
                            with urllib.request.urlopen(f_req, timeout=5.0) as f_res:
                                f_data = json.loads(f_res.read().decode("utf-8"))

                            if f_data.get("ok"):
                                tg_file_path = f_data["result"]["file_path"]
                                dl_url = f"https://api.telegram.org/file/bot{bot_token}/{tg_file_path}"
                                ext = os.path.splitext(tg_file_path)[1] or ".jpg"
                                local_img_name = f"cop_{date_str}_{dt.strftime('%H%M%S')}_{msg.get('message_id')}{ext}"
                                save_path = paths.cop_dir / local_img_name

                                dl_req = urllib.request.Request(dl_url, headers={"User-Agent": "AILab-AIN2"})
                                with urllib.request.urlopen(dl_req, timeout=10.0) as dl_res:
                                    raw_bytes = dl_res.read()

                                # ★ ダウンロードした生画像を長辺1200px・JPEG品質85%に最適化して保存
                                try:
                                    img_array = np.frombuffer(raw_bytes, dtype=np.uint8)
                                    img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)

                                    if img is not None:
                                        h, w = img.shape[:2]
                                        max_dim = 1200
                                        if max(h, w) > max_dim:
                                            scale = max_dim / max(h, w)
                                            new_w, new_h = int(w * scale), int(h * scale)
                                            img = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)

                                        cv2.imwrite(str(save_path), img, [cv2.IMWRITE_JPEG_QUALITY, 85])
                                    else:
                                        save_path.write_bytes(raw_bytes)
                                except Exception as resize_err:
                                    print(f"[COP Resize Error] {resize_err}")
                                    save_path.write_bytes(raw_bytes)

                        except Exception as e:
                            print(f"[COP Download Error] {e}")

                    new_card = {
                        "msg_id": msg_id,
                        "type": card_type,
                        "timestamp_ts": msg_date_ts,
                        "timestamp_str": f"{date_str} {time_str}",
                        "date_str": date_str,
                        "time_str": time_str,
                        "text": main_text,
                        "image_filename": local_img_name,
                        "inserted": False
                    }
                    local_msgs.append(new_card)
                    existing_ids.add(msg_id)

                if max_update_id > last_offset:
                    save_last_offset(paths, max_update_id)

        except Exception as e:
            print(f"[COP Sync Warning] Telegram通信スキップ: {e}")

    filtered_msgs = [m for m in local_msgs if m.get("timestamp_ts", 0) >= one_week_ago_ts]
    save_local_messages(paths, filtered_msgs)
    filtered_msgs.sort(key=lambda x: x.get("timestamp_ts", 0), reverse=True)

    cards_out = []
    for m in filtered_msgs:
        item = dict(m)
        if item.get("type") == "photo" and item.get("image_filename"):
            item["image_url"] = f"/api/addin/cop_telegram/image/{paths.account}/{item['image_filename']}"
        cards_out.append(item)

    return {"status": "ok", "account": paths.account, "cards": cards_out}

# ==========================================
# 3. 挿入済みマーク API
# ==========================================
class MarkInsertedPayload(BaseModel):
    msg_id: str
    account: Optional[str] = None

@router.post("/mark_inserted")
def mark_card_inserted(payload: MarkInsertedPayload):
    acc = payload.account or get_app_state().get("current_account", "default")
    paths = AccountPaths(acc)
    local_msgs = load_local_messages(paths)
    found = False
    for m in local_msgs:
        if m.get("msg_id") == payload.msg_id:
            m["inserted"] = True
            found = True
            break
    if found:
        save_local_messages(paths, local_msgs)
    return {"status": "ok", "msg_id": payload.msg_id}

# ==========================================
# 4. 画像配信 API
# ==========================================
@router.get("/image/{account}/{filename}")
def get_cop_image(account: str, filename: str):
    paths = AccountPaths(account)
    img_path = paths.cop_dir / filename
    if not img_path.exists():
        raise HTTPException(status_code=404, detail="Image not found")
    return FileResponse(img_path)