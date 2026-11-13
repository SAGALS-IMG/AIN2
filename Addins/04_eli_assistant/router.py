import os
import re
import json
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from bs4 import BeautifulSoup
import chromadb
from chromadb.utils import embedding_functions

from core.config import AccountPaths, load_account_config, get_app_state, BASE_DIR

router = APIRouter()
JST = timezone(timedelta(hours=9))

# ==========================================
# 0. アイコン画像配信
# ==========================================
@router.get("/icon")
def get_eli_icon():
    local_icon = Path(__file__).parent / "eli3.png"
    if local_icon.exists():
        return FileResponse(local_icon, media_type="image/png")
    fallback_icon = BASE_DIR / "static" / "icon" / "eli3.png"
    if fallback_icon.exists():
        return FileResponse(fallback_icon, media_type="image/png")
    raise HTTPException(status_code=404, detail="Eli icon not found")

# ==========================================
# 1. Eli 個別設定管理 (./Log/{account}/eli/config.json)
# ==========================================
def get_eli_config_file(paths: AccountPaths) -> Path:
    eli_dir = BASE_DIR / "Log" / paths.account / "eli"
    eli_dir.mkdir(parents=True, exist_ok=True)
    return eli_dir / "config.json"

def load_eli_config(account: Optional[str] = None) -> dict:
    acc = account or get_app_state().get("current_account", "default")
    paths = AccountPaths(acc)
    cfg_file = get_eli_config_file(paths)
    
    if cfg_file.exists():
        try:
            return json.loads(cfg_file.read_text(encoding="utf-8"))
        except Exception:
            pass

    # 初回自動引き継ぎ：旧 config.json から移行
    legacy_cfg = load_account_config(acc)
    default_cfg = {
        "ai_url": legacy_cfg.get("ai_url", "https://generativelanguage.googleapis.com/v1beta/openai"),
        "ai_url_history": legacy_cfg.get("ai_url_history", [
            "https://generativelanguage.googleapis.com/v1beta/openai",
            "http://localhost:8001"
        ]),
        "ai_api_key": legacy_cfg.get("ai_api_key", ""),
        "ai_server_type": legacy_cfg.get("ai_server_type", "vLLM (OpenAI)"),
        "ai_model": legacy_cfg.get("ai_model", "gemini-3.8-flash"),
        "ai_temp": str(legacy_cfg.get("ai_temp", "0.7")),
        "ai_timeout": float(legacy_cfg.get("ai_timeout", 180.0)),
        "ai_system_prompt": legacy_cfg.get("ai_system_prompt", (
            "あなたの名前はEli（エリ）で優秀な実験補佐です。\n"
            "理系マインドを持って親しみやすくサポートしてください。"
        )),
        "elog_format_prompt": legacy_cfg.get("elog_format_prompt", "")
    }
    save_eli_config(default_cfg, acc)
    return default_cfg

def save_eli_config(cfg: dict, account: Optional[str] = None):
    acc = account or get_app_state().get("current_account", "default")
    paths = AccountPaths(acc)
    cfg_file = get_eli_config_file(paths)
    cfg_file.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")

@router.get("/config")
def get_config_api(account: Optional[str] = None):
    return {"status": "ok", "config": load_eli_config(account)}

@router.post("/config")
def save_config_api(cfg: dict, account: Optional[str] = None):
    acc = cfg.get("account") or account or get_app_state().get("current_account", "default")
    save_eli_config(cfg, acc)
    return {"status": "ok", "config": load_eli_config(acc)}

@router.post("/ai/models")
def fetch_ai_models_endpoint(payload: dict):
    base_url = payload.get("url", "http://localhost:8001").rstrip("/")
    is_vllm = payload.get("is_vllm", True)
    api_key = payload.get("api_key", "").strip()

    if "googleapis.com" in base_url:
        endpoint = "https://generativelanguage.googleapis.com/v1beta/openai/models"
    elif is_vllm:
        endpoint = f"{base_url}/models" if base_url.endswith("/v1") else f"{base_url}/v1/models"
    else:
        endpoint = f"{base_url}/api/tags"

    headers = {"User-Agent": "AILab-ModelFetcher"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    try:
        req = urllib.request.Request(endpoint, headers=headers)
        with urllib.request.urlopen(req, timeout=5.0) as res:
            data = json.loads(res.read().decode("utf-8"))
            models = [m.get("id") for m in data.get("data", [])] if is_vllm or "googleapis.com" in base_url else [m.get("name") for m in data.get("models", [])]
            return {"models": models}
    except Exception as e:
        return {"error": str(e), "models": []}

# ==========================================
# 2. ローカル ChromaDB 管理 (rag.py 統合)
# ==========================================
_CHROMA_CLIENTS = {}
_DEFAULT_EMB_FN = None

def get_chroma_collection(paths: AccountPaths, reset: bool = False):
    global _DEFAULT_EMB_FN
    rag_dir_str = str(paths.rag_dir.resolve())
    
    if rag_dir_str not in _CHROMA_CLIENTS:
        _CHROMA_CLIENTS[rag_dir_str] = chromadb.PersistentClient(path=rag_dir_str)
        
    client = _CHROMA_CLIENTS[rag_dir_str]
    col_name = f"notes_{paths.account}"

    if _DEFAULT_EMB_FN is None:
        _DEFAULT_EMB_FN = embedding_functions.DefaultEmbeddingFunction()

    if reset:
        try:
            client.delete_collection(col_name)
        except Exception:
            pass

    return client.get_or_create_collection(
        name=col_name,
        embedding_function=_DEFAULT_EMB_FN
    )

def fetch_local_rag_context(query: str, account: str = None, top_k: int = 4) -> str:
    try:
        paths = AccountPaths(account)
        col = get_chroma_collection(paths)
        if col.count() == 0:
            return ""

        docs, metas = [], []
        m = re.search(r'(\d{1,2})[-/月](\d{1,2})', query)
        target_date_suffix = f"{int(m.group(1)):02d}{int(m.group(2)):02d}" if m else None

        if target_date_suffix:
            all_meta = col.get(include=["documents", "metadatas"])
            for d, meta in zip(all_meta.get("documents", []), all_meta.get("metadatas", [])):
                if str(meta.get("date", "")).endswith(target_date_suffix):
                    docs.append(d)
                    metas.append(meta)

        if not docs:
            results = col.query(query_texts=[query], n_results=top_k)
            docs = results.get("documents", [[]])[0]
            metas = results.get("metadatas", [[]])[0]

        if not docs:
            return ""

        context_parts = ["【参考：関連する過去の実験記録 (Local RAG)】"]
        for doc, meta in zip(docs[:top_k], metas[:top_k]):
            src = meta.get("source", "unknown")
            context_parts.append(f"--- [出典: {src}] ---\n{doc.strip()}")

        return "\n\n".join(context_parts)
    except Exception as e:
        print(f"[RAG Warning] ChromaDB 検索エラー: {e}")
        return ""

# ==========================================
# 3. Eli チャット & ヘルスチェック API (個別設定参照)
# ==========================================
class ChatMessage(BaseModel):
    role: str
    content: str

class AIChatPayload(BaseModel):
    message: str
    selected_text: str = ""
    account: Optional[str] = None
    history: List[ChatMessage] = []

@router.get("/ai/health")
def check_ai_health(account: Optional[str] = None):
    cfg = load_eli_config(account)
    base_url = (cfg.get("ai_url") or "http://localhost:8001").rstrip("/")
    api_key = (cfg.get("ai_api_key") or "").strip()

    if "googleapis.com" in base_url:
        endpoint = "https://generativelanguage.googleapis.com/v1beta/openai/models"
    elif base_url.endswith("/v1"):
        endpoint = f"{base_url}/models"
    else:
        endpoint = f"{base_url}/v1/models"

    headers = {"User-Agent": "AILab-HealthCheck"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    try:
        req = urllib.request.Request(endpoint, headers=headers)
        with urllib.request.urlopen(req, timeout=3.0) as response:
            if response.status == 200:
                data = json.loads(response.read().decode("utf-8"))
                models = [m.get("id") for m in data.get("data", [])]
                return {
                    "status": "ok",
                    "url": base_url,
                    "model": cfg.get("ai_model") or (models[0] if models else "Unknown")
                }
    except Exception as e:
        return {"status": "error", "url": base_url, "error": str(e), "model": cfg.get("ai_model", "")}

@router.post("/ai/chat")
def chat_with_ai(payload: AIChatPayload):
    acc = payload.account or get_app_state().get("current_account", "default")
    cfg = load_eli_config(acc)
    raw_url = (cfg.get("ai_url") or "http://localhost:8001").strip()
    model_name = cfg.get("ai_model", "gemini-3.8-flash")
    temperature = float(cfg.get("ai_temp") or 0.7)
    ai_timeout = float(cfg.get("ai_timeout") or 180.0)
    api_key = (cfg.get("ai_api_key") or "").strip()

    system_prompt = cfg.get("ai_system_prompt") or (
        "あなたの名前はEli（エリ）で優秀な実験補佐です。\n"
        "理系マインドを持って親しみやすくサポートしてください。"
    )

    user_content = payload.message.strip()
    if payload.selected_text.strip():
        user_content = f"【実験ノートからの引用】:\n{payload.selected_text.strip()}\n\n【質問/指示】:\n{user_content}"

    rag_context = fetch_local_rag_context(f"{payload.selected_text} {payload.message}".strip(), account=acc, top_k=3)
    if rag_context:
        system_prompt += f"\n\n以下の過去の実験記録を参考にして具体的に答えてください。\n{rag_context}"

    messages = [{"role": "system", "content": system_prompt}]
    if payload.history:
        for h in payload.history[-6:]:
            messages.append({"role": h.role, "content": h.content})
    messages.append({"role": "user", "content": user_content})

    clean_url = raw_url.rstrip("/")
    if "googleapis.com" in clean_url:
        if clean_url.endswith("/openai"):
            endpoint = f"{clean_url}/chat/completions"
        elif clean_url.endswith("/v1beta"):
            endpoint = f"{clean_url}/openai/chat/completions"
        else:
            endpoint = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
    elif clean_url.endswith("/v1"):
        endpoint = f"{clean_url}/chat/completions"
    else:
        endpoint = f"{clean_url}/v1/chat/completions"

    req_body = {
        "model": model_name,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": 1024
    }

    headers = {"Content-Type": "application/json", "User-Agent": "AILab-Backend"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    try:
        data_bytes = json.dumps(req_body).encode("utf-8")
        req = urllib.request.Request(endpoint, data=data_bytes, headers=headers)
        with urllib.request.urlopen(req, timeout=ai_timeout) as response:
            res_data = json.loads(response.read().decode("utf-8"))
            return {"reply": res_data["choices"][0]["message"]["content"], "model": model_name}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLMエラー: {e}")

# ==========================================
# 4. eLog (構造化ログ) 整形 ＆ 保存 API
# ==========================================
def clean_html_for_llm(raw_html: str) -> str:
    if not raw_html:
        return ""
    cleaned = re.sub(r'data:image\/[^;]+;base64,[a-zA-Z0-9+/=]+', '[📷 画像データ]', raw_html)
    soup = BeautifulSoup(cleaned, "html.parser")
    for tag in soup(["script", "style", "svg", "noscript"]):
        tag.decompose()
    for img in soup.find_all("img"):
        img.replace_with(" [📷 挿入画像] ")
    text = soup.get_text(separator="\n")
    return re.sub(r'\n{3,}', '\n\n', text).strip()

class ElogFormatPayload(BaseModel):
    date_str: str
    account: Optional[str] = None
    custom_prompt: str = ""
    raw_text_override: str = ""

@router.get("/elog/files")
def get_log_files(account: Optional[str] = None):
    acc = account or get_app_state().get("current_account", "default")
    paths = AccountPaths(acc)
    paths.ensure_dirs()
    raw_files = sorted(paths.log_dir.glob("*.html"), reverse=True)
    existing_elogs = set(f.stem.replace("_elog", "") for f in paths.elog_dir.glob("*_elog.md"))
    result = []
    for f in raw_files:
        if f.name == "memorandum.html":
            continue
        stem = f.stem
        if len(stem) == 8 and stem.isdigit():
            is_converted = stem in existing_elogs
            result.append({
                "name": f.name,
                "date": stem,
                "status": "Converted" if is_converted else "Ready",
                "is_converted": is_converted
            })
    return {"files": result, "account": paths.account}

@router.post("/elog/format")
def format_elog_api(payload: ElogFormatPayload):
    acc = payload.account or get_app_state().get("current_account", "default")
    paths = AccountPaths(acc)
    cfg = load_eli_config(acc)

    if payload.raw_text_override.strip():
        clean_text = payload.raw_text_override.strip()
    else:
        html_file = paths.log_dir / f"{payload.date_str}.html"
        if not html_file.exists():
            raise HTTPException(status_code=404, detail=f"生ログファイルが見つかりません: {payload.date_str}.html")
        clean_text = clean_html_for_llm(html_file.read_text(encoding="utf-8"))

    if not clean_text:
        raise HTTPException(status_code=400, detail="ログ内容が空です。")

    base_url = (cfg.get("ai_url") or "http://localhost:8001").rstrip("/")
    model_name = cfg.get("ai_model", "gemini-3.8-flash")
    ai_timeout = max(300.0, float(cfg.get("ai_timeout") or 180.0))
    api_key = (cfg.get("ai_api_key") or "").strip()

    system_instruction = payload.custom_prompt.strip() or "あなたは実験ログの構造化アシスタントです。"
    user_content = f"【対象ログ日付】: {payload.date_str}\n【生ログテキスト】:\n{clean_text}\n\n上記をFrontmatter付きMarkdownに整形して出力してください。"

    req_body = {
        "model": model_name,
        "messages": [
            {"role": "system", "content": system_instruction},
            {"role": "user", "content": user_content}
        ],
        "temperature": 0.3,
        "max_tokens": 2048
    }

    clean_url = base_url.rstrip("/")
    endpoint = f"{clean_url}/chat/completions" if ("googleapis.com" in clean_url or clean_url.endswith("/v1")) else f"{clean_url}/v1/chat/completions"
    headers = {"Content-Type": "application/json", "User-Agent": "AILab-Formatter"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    try:
        data_bytes = json.dumps(req_body).encode("utf-8")
        req = urllib.request.Request(endpoint, data=data_bytes, headers=headers)
        with urllib.request.urlopen(req, timeout=ai_timeout) as response:
            res_data = json.loads(response.read().decode("utf-8"))
            formatted_md = res_data["choices"][0]["message"]["content"].strip()
            if formatted_md.startswith("```markdown"):
                formatted_md = formatted_md[11:]
            elif formatted_md.startswith("```"):
                formatted_md = formatted_md[3:]
            if formatted_md.endswith("```"):
                formatted_md = formatted_md[:-3]
            return {"status": "ok", "date_str": payload.date_str, "formatted_markdown": formatted_md.strip(), "account": paths.account}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM整形エラー: {e}")

class ElogSavePayload(BaseModel):
    date_str: str
    account: Optional[str] = None
    markdown: str

@router.post("/elog/save")
def save_elog_api(payload: ElogSavePayload):
    acc = payload.account or get_app_state().get("current_account", "default")
    paths = AccountPaths(acc)
    paths.ensure_dirs()
    out_file = paths.elog_dir / f"{payload.date_str}_elog.md"
    tmp_file = out_file.with_suffix(f".tmp.{os.getpid()}")
    try:
        tmp_file.write_text(payload.markdown, encoding="utf-8")
        tmp_file.replace(out_file)
        return {"status": "ok", "saved_path": str(out_file.resolve()), "account": paths.account}
    except Exception as e:
        if tmp_file.exists():
            tmp_file.unlink()
        raise HTTPException(status_code=500, detail=f"eLog保存失敗: {e}")

@router.get("/elog/get/{account}/{date_str}")
def get_elog_api(account: str, date_str: str):
    paths = AccountPaths(account)
    target_file = paths.elog_dir / f"{date_str}_elog.md"
    if not target_file.exists():
        return {"exists": False, "markdown": ""}
    return {"exists": True, "markdown": target_file.read_text(encoding="utf-8")}

# ==========================================
# 5. ローカル RAG 同期 ＆ 全再構築 API
# ==========================================
class RagSyncPayload(BaseModel):
    account: Optional[str] = None
    date_str: Optional[str] = None

@router.get("/rag/status")
def get_rag_status_api(account: Optional[str] = None):
    acc = account or get_app_state().get("current_account", "default")
    paths = AccountPaths(acc)
    paths.ensure_dirs()
    try:
        col = get_chroma_collection(paths)
        doc_count = col.count()
        indexed_files = []
        if doc_count > 0:
            existing = col.get(include=["metadatas"])
            for meta in (existing.get("metadatas") or []):
                if meta and "source" in meta:
                    indexed_files.append(meta["source"])
        return {
            "status": "ok",
            "account": paths.account,
            "chunk_count": doc_count,
            "doc_count": doc_count,
            "indexed_files": sorted(list(set(indexed_files)), reverse=True)
        }
    except Exception as e:
        return {"status": "error", "error": str(e), "chunk_count": 0, "indexed_files": []}

@router.post("/rag/sync")
def sync_diff_rag_api(payload: RagSyncPayload):
    acc = payload.account or get_app_state().get("current_account", "default")
    paths = AccountPaths(acc)
    paths.ensure_dirs()
    try:
        col = get_chroma_collection(paths)
        existing_res = col.get()
        existing_ids = set(existing_res["ids"]) if existing_res and "ids" in existing_res else set()

        documents, metadatas, ids = [], [], []
        if paths.elog_dir.exists():
            for f in sorted(paths.elog_dir.glob("*.md")):
                doc_id = f"elog_{f.stem.replace('_elog', '')}"
                if doc_id in existing_ids:
                    continue
                text = f.read_text(encoding="utf-8").strip()
                if len(text) > 10:
                    documents.append(text)
                    metadatas.append({
                        "source": f.name,
                        "type": "elog_md",
                        "date": f.stem.replace("_elog", ""),
                        "indexed_at": datetime.now(JST).strftime("%Y-%m-%d %H:%M:%S")
                    })
                    ids.append(doc_id)

        added_count = 0
        if documents:
            col.upsert(documents=documents, metadatas=metadatas, ids=ids)
            added_count = len(documents)

        return {"status": "ok", "account": paths.account, "indexed_chunks": added_count, "total_docs": col.count()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/rag/rebuild_all")
def rebuild_all_rag_api(payload: RagSyncPayload):
    acc = payload.account or get_app_state().get("current_account", "default")
    paths = AccountPaths(acc)
    paths.ensure_dirs()
    try:
        col = get_chroma_collection(paths, reset=True)
        documents, metadatas, ids = [], [], []

        if paths.elog_dir.exists():
            for f in sorted(paths.elog_dir.glob("*.md")):
                text = f.read_text(encoding="utf-8").strip()
                if len(text) > 10:
                    documents.append(text)
                    metadatas.append({
                        "source": f.name,
                        "type": "elog_md",
                        "date": f.stem.replace("_elog", ""),
                        "indexed_at": datetime.now(JST).strftime("%Y-%m-%d %H:%M:%S")
                    })
                    ids.append(f"elog_{f.stem.replace('_elog', '')}")

        if documents:
            col.upsert(documents=documents, metadatas=metadatas, ids=ids)

        return {
            "status": "ok",
            "account": paths.account,
            "total_files": len(documents),
            "total_chunks": len(documents)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class PromptSavePayload(BaseModel):
    account: Optional[str] = None
    prompt: str

@router.post("/rag/save_format_prompt")
def save_format_prompt_api(payload: PromptSavePayload):
    acc = payload.account or get_app_state().get("current_account", "default")
    cfg = load_eli_config(acc)
    cfg["elog_format_prompt"] = payload.prompt
    save_eli_config(cfg, acc)
    return {"status": "ok", "account": acc}

class PromptHeightPayload(BaseModel):
    height: int

@router.post("/eli/save_prompt_height")
def save_prompt_height(payload: PromptHeightPayload):
    return {"status": "ok", "height": payload.height}