import os
import glob
import re
import shutil
from pathlib import Path
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from core.config import AccountPaths

router = APIRouter(prefix="/api", tags=["logs"])

# ==========================================
# ログモデル定義
# ==========================================
class LogPayload(BaseModel):
    date_str: str
    content_html: str
    account: str = None

class SearchQuery(BaseModel):
    keyword: str = ""
    use_date_range: bool = False
    start_date: str = ""
    end_date: str = ""
    account: str = None

class MemoPayload(BaseModel):
    content_html: str
    account: str = None

# ==========================================
# 生ログ（HTML）の読み書き
# ==========================================
@router.get("/logs/{date_str}")
def get_log(date_str: str, account: str = None):
    """指定日付のログHTMLを取得"""
    paths = AccountPaths(account)
    paths.ensure_dirs()
    target_file = paths.log_dir / f"{date_str}.html"

    if not target_file.exists():
        return {
            "account": paths.account,
            "date_str": date_str,
            "content_html": "",
            "exists": False
        }

    try:
        content = target_file.read_text(encoding="utf-8")
        # <body>タグ内のみを抽出（旧来の互換性を維持）
        start = content.find("<body")
        if start != -1:
            start = content.find(">", start) + 1
            end = content.find("</body>")
            if end != -1:
                content = content[start:end].strip()

        return {
            "account": paths.account,
            "date_str": date_str,
            "content_html": content,
            "exists": True
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ログ読み込みエラー: {e}")

@router.post("/logs")
def save_log(payload: LogPayload):
    """ログHTMLを確定保存（.bakバックアップ生成 ＆ .tmp削除）"""
    paths = AccountPaths(payload.account)
    paths.ensure_dirs()

    file_path = paths.log_dir / f"{payload.date_str}.html"
    bak_path = paths.log_dir / f"{payload.date_str}.bak"
    draft_tmp_path = paths.log_dir / f"{payload.date_str}.tmp"

    full_html = (
        "<!DOCTYPE html>\n"
        "<html><head><meta charset=\"UTF-8\"></head>"
        "<body style=\"font-family: sans-serif; padding: 20px;\">\n"
        f"{payload.content_html}\n"
        "</body></html>"
    )

    try:
        # 既存ログが存在する場合は .bak にリネーム退避
        if file_path.exists():
            if bak_path.exists():
                bak_path.unlink()
            file_path.rename(bak_path)

        # アトミック書き込みで確定HTMLを保存
        atomic_tmp = file_path.with_suffix(f".atomic.{os.getpid()}")
        atomic_tmp.write_text(full_html, encoding="utf-8")
        atomic_tmp.replace(file_path)

        # 確定保存が完了したので一時下書き(.tmp)を削除
        if draft_tmp_path.exists():
            draft_tmp_path.unlink()

        return {
            "status": "ok",
            "account": paths.account,
            "filename": str(file_path.resolve()),
            "mtime": file_path.stat().st_mtime
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ログ保存エラー: {e}")

@router.post("/logs/tmp")
def save_tmp_log(payload: LogPayload):
    """編集中の下書きを .tmp に一時保存（.bakは上書きしない）"""
    paths = AccountPaths(payload.account)
    paths.ensure_dirs()
    draft_tmp_path = paths.log_dir / f"{payload.date_str}.tmp"

    try:
        atomic_tmp = draft_tmp_path.with_suffix(f".atomic.{os.getpid()}")
        atomic_tmp.write_text(payload.content_html, encoding="utf-8")
        atomic_tmp.replace(draft_tmp_path)
        return {
            "status": "ok",
            "mtime": draft_tmp_path.stat().st_mtime
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"TMP保存エラー: {e}")

@router.get("/logs/tmp/{date_str}")
def get_tmp_log(date_str: str, account: str = None):
    """未確定の .tmp が残っているか確認（起動時の誤終了・クラッシュ救済用）"""
    paths = AccountPaths(account)
    draft_tmp_path = paths.log_dir / f"{date_str}.tmp"
    if not draft_tmp_path.exists():
        return {"exists": False, "content_html": ""}
    try:
        return {
            "exists": True,
            "content_html": draft_tmp_path.read_text(encoding="utf-8")
        }
    except Exception:
        return {"exists": False, "content_html": ""}

@router.delete("/logs/tmp/{date_str}")
def delete_tmp_log(date_str: str, account: str = None):
    """不要になった .tmp を明示的に破棄"""
    paths = AccountPaths(account)
    draft_tmp_path = paths.log_dir / f"{date_str}.tmp"
    if draft_tmp_path.exists():
        draft_tmp_path.unlink()
    return {"status": "ok"}

@router.get("/logs/status/{date_str}")
def get_log_status(date_str: str, account: str = None):
    """現在のログ(.tmp優先、なければ.html)の最終更新タイムスタンプを返す"""
    paths = AccountPaths(account)
    draft_tmp_path = paths.log_dir / f"{date_str}.tmp"
    html_path = paths.log_dir / f"{date_str}.html"

    if draft_tmp_path.exists():
        return {
            "source": "tmp",
            "mtime": draft_tmp_path.stat().st_mtime
        }
    elif html_path.exists():
        return {
            "source": "html",
            "mtime": html_path.stat().st_mtime
        }
    return {"source": "none", "mtime": 0}



@router.get("/logs_dates")
def get_all_log_dates(account: str = None):
    """カレンダー表示用：ログが存在する日付（YYYYMMDD）の一覧を取得"""
    paths = AccountPaths(account)
    paths.ensure_dirs()

    dates = set()
    if paths.log_dir.exists():
        for f in paths.log_dir.glob("*.html"):
            if f.name == "memorandum.html":
                continue
            stem = f.stem
            if len(stem) == 8 and stem.isdigit():
                dates.add(stem)

    return {
        "account": paths.account,
        "dates": sorted(list(dates))
    }

# ==========================================
# ログキーワード＆日付範囲検索
# ==========================================
@router.post("/search")
def search_logs(query: SearchQuery):
    """キーワードおよび日付範囲によるログ検索"""
    paths = AccountPaths(query.account)
    paths.ensure_dirs()

    keyword = query.keyword.strip()
    use_range = query.use_date_range
    start_dt = query.start_date.replace("-", "") if query.start_date else ""
    end_dt = query.end_date.replace("-", "") if query.end_date else ""

    results = []
    if not paths.log_dir.exists():
        return {"results": []}

    html_files = sorted(paths.log_dir.glob("*.html"), reverse=True)
    for f in html_files:
        if f.name == "memorandum.html":
            continue

        base_name = f.stem
        date_str = base_name[:8]
        if not (len(date_str) == 8 and date_str.isdigit()):
            continue

        if use_range:
            if start_dt and date_str < start_dt:
                continue
            if end_dt and date_str > end_dt:
                continue

        fmt_date = f"{date_str[:4]}/{date_str[4:6]}/{date_str[6:8]}"
        fmt_time = "--:--"
        if len(base_name) >= 13 and base_name[8] == "_":
            fmt_time = f"{base_name[9:11]}:{base_name[11:13]}"

        try:
            content = f.read_text(encoding="utf-8")
        except Exception:
            continue

        # HTMLタグや画像を除去してプレーンテキスト化
        clean_text = re.sub(r'<img[^>]*>', ' [画像] ', content)
        clean_text = re.sub(r'<[^>]+>', ' ', clean_text)
        clean_text = re.sub(r'\s+', ' ', clean_text).strip()

        if keyword:
            lower_body = clean_text.lower()
            lower_kw = keyword.lower()
            hit_pos = lower_body.find(lower_kw)
            if hit_pos == -1:
                continue
            start_p = max(0, hit_pos - 15)
            end_p = min(len(clean_text), hit_pos + len(keyword) + 20)
            prefix = clean_text[start_p:hit_pos]
            hit_word = clean_text[hit_pos:hit_pos + len(keyword)]
            suffix = clean_text[hit_pos + len(keyword):end_p]
            preview = f"...{prefix}【{hit_word}】{suffix}..."
        else:
            preview = clean_text[:40] + ("..." if len(clean_text) > 40 else "")

        results.append({
            "date": fmt_date,
            "time": fmt_time,
            "preview": preview,
            "raw_date": date_str
        })

    return {"account": paths.account, "results": results}

# ==========================================
# 共通メモ (memorandum.html: アカウント別)
# ==========================================
@router.get("/memo")
def get_memo(account: str = None):
    """アカウント専用 memorandum.html を取得（.origを自動退避）"""
    paths = AccountPaths(account)
    paths.ensure_dirs()

    memo_file = paths.log_dir / "memorandum.html"
    orig_file = paths.log_dir / "memorandum.orig"

    if not memo_file.exists():
        return {"content_html": "", "exists": False}

    try:
        shutil.copy2(memo_file, orig_file)
    except Exception as e:
        print(f"[Memo orig warning] {e}")

    content = memo_file.read_text(encoding="utf-8")
    return {"content_html": content, "exists": True}

@router.post("/memo")
def save_memo(payload: MemoPayload):
    """アカウント専用 memorandum.html を保存（.bakを更新）"""
    paths = AccountPaths(payload.account)
    paths.ensure_dirs()

    memo_file = paths.log_dir / "memorandum.html"
    bak_file = paths.log_dir / "memorandum.bak"

    if memo_file.exists():
        try:
            shutil.copy2(memo_file, bak_file)
        except Exception as e:
            print(f"[Memo bak warning] {e}")

    memo_file.write_text(payload.content_html, encoding="utf-8")
    return {
        "status": "ok",
        "account": paths.account,
        "filename": str(memo_file.resolve())
    }