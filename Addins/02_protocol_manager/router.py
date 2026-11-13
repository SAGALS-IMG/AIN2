import json
import uuid
from pathlib import Path
from typing import Optional, List
from fastapi import APIRouter
from pydantic import BaseModel

from core.config import AccountPaths, get_app_state, BASE_DIR

router = APIRouter()

class ProtocolPayload(BaseModel):
    id: str = ""
    title: str
    steps: List[str]
    account: Optional[str] = None

class DeleteProtocolPayload(BaseModel):
    id: str
    account: Optional[str] = None

def _get_protocols_file(account: Optional[str] = None) -> Path:
    acc = account or get_app_state().get("current_account", "default")
    paths = AccountPaths(acc)
    target = paths.protocols_file
    
    # もし指定アカウント配下に無ければ、default や直下もフォールバック検索
    if not target.exists():
        fallback_default = BASE_DIR / "Log" / "default" / "protocols.json"
        fallback_root = BASE_DIR / "protocols.json"
        if fallback_default.exists():
            return fallback_default
        elif fallback_root.exists():
            return fallback_root
            
    return target

def _load_protocols(account: Optional[str] = None):
    proto_file = _get_protocols_file(account)
    if proto_file.exists():
        try:
            with open(proto_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list):
                    print(f"📋 Loaded {len(data)} protocols from: {proto_file}")
                    return data
        except Exception as e:
            print(f"[Protocols Load Error] {proto_file}: {e}")
    print(f"⚠️ No protocols.json found at {proto_file}")
    return []

def _save_protocols(protocols: list, account: Optional[str] = None):
    acc = account or get_app_state().get("current_account", "default")
    paths = AccountPaths(acc)
    proto_file = paths.protocols_file
    proto_file.parent.mkdir(parents=True, exist_ok=True)
    try:
        with open(proto_file, "w", encoding="utf-8") as f:
            json.dump(protocols, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[Protocols Save Error] {proto_file}: {e}")

@router.get("/protocols")
def get_protocols(account: Optional[str] = None):
    acc = account or get_app_state().get("current_account", "default")
    return {"protocols": _load_protocols(acc)}

@router.post("/protocols/save")
def save_protocol(payload: ProtocolPayload):
    acc = payload.account or get_app_state().get("current_account", "default")
    protocols = _load_protocols(acc)
    
    if not payload.id:
        new_id = str(uuid.uuid4())[:8]
        protocols.append({"id": new_id, "title": payload.title, "steps": payload.steps})
    else:
        found = False
        for p in protocols:
            if p["id"] == payload.id:
                p["title"] = payload.title
                p["steps"] = payload.steps
                found = True
                break
        if not found:
            protocols.append({"id": payload.id, "title": payload.title, "steps": payload.steps})
            
    _save_protocols(protocols, acc)
    return {"status": "ok", "protocols": protocols}

@router.post("/protocols/delete")
def delete_protocol(payload: DeleteProtocolPayload):
    acc = payload.account or get_app_state().get("current_account", "default")
    protocols = _load_protocols(acc)
    protocols = [p for p in protocols if p["id"] != payload.id]
    _save_protocols(protocols, acc)
    return {"status": "ok", "protocols": protocols}