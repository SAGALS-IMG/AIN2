import os
import re
import json
import threading
from pathlib import Path

# AIN2 プロジェクトのルートディレクトリ
CORE_DIR = Path(__file__).resolve().parent
BASE_DIR = CORE_DIR.parent
LOG_BASE_DIR = BASE_DIR / "Log"

# ウィンドウ座標などローカル環境固有の退避先
LOCAL_CACHE_DIR = Path(os.path.expanduser("~/.ain"))
LOCAL_CACHE_DIR.mkdir(parents=True, exist_ok=True)
GEOMETRY_FILE = LOCAL_CACHE_DIR / "AIN_geometry.json"
APP_STATE_FILE = LOCAL_CACHE_DIR / "AIN_app_state.json"

config_io_lock = threading.Lock()

def _atomic_json_write(filepath: Path, data: dict):
    """一時ファイルへ書き出してから一瞬で置換するアトミック書き込み"""
    filepath.parent.mkdir(parents=True, exist_ok=True)
    tmp_file = filepath.with_suffix(f".tmp.{os.getpid()}")
    try:
        with open(tmp_file, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_file, filepath)
    except Exception as e:
        print(f"[Atomic Write Error] {filepath}: {e}")
        if tmp_file.exists():
            try:
                tmp_file.unlink()
            except Exception:
                pass

# ==========================================
# アプリ全体の状態管理（現在のアクティブアカウントなど）
# ==========================================
def get_app_state() -> dict:
    default_state = {"current_account": "default"}
    if APP_STATE_FILE.exists():
        try:
            with open(APP_STATE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    default_state.update(data)
        except Exception:
            pass
    return default_state

def set_current_account(account_name: str):
    clean_acc = sanitize_account_name(account_name)
    with config_io_lock:
        state = get_app_state()
        state["current_account"] = clean_acc
        _atomic_json_write(APP_STATE_FILE, state)

def sanitize_account_name(name: str) -> str:
    if not name or name.strip() in ("", "undefined", "null", "None"):
        return "default"
    cleaned = re.sub(r'[^\w\-]', '_', name.strip())
    return cleaned if cleaned not in ("", "undefined", "null", "None") else "default"

# ==========================================
# アカウント別パス解決
# ==========================================
class AccountPaths:
    def __init__(self, account_name: str = None):
        if not account_name:
            account_name = get_app_state().get("current_account", "default")
        self.account = sanitize_account_name(account_name)
        self.root = LOG_BASE_DIR / self.account
        self.log_dir = self.root / "log"
        self.elog_dir = self.root / "elog"
        self.telegram_dir = self.root / "telegram"
        self.cop_dir = self.telegram_dir  # ★ エイリアス
        self.rag_dir = self.root / "rag_index"
        
        self.config_file = self.root / "config.json"
        self.protocols_file = self.root / "protocols.json"
        self.scratchpad_file = self.root / "scratchpad.txt"

    def ensure_dirs(self):
        """必要なフォルダ群を確実に作成"""
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self.elog_dir.mkdir(parents=True, exist_ok=True)
        self.telegram_dir.mkdir(parents=True, exist_ok=True)
        self.rag_dir.mkdir(parents=True, exist_ok=True)

# ==========================================
# アカウント別設定の読み書き
# ==========================================
def load_account_config(account_name: str = None) -> dict:
    paths = AccountPaths(account_name)
    paths.ensure_dirs()
    
    default_cfg = {
        "account_name": paths.account,
        "language": "ja",         
        "ai_url": "https://generativelanguage.googleapis.com/v1beta/openai",
        "ai_url_history": [
            "https://generativelanguage.googleapis.com/v1beta/openai"
        ],        
        "ai_server_type": "vLLM (OpenAI)",
        "ai_model": "mistralai/Mistral-Small-24B-Instruct-2501",
        "ai_api_key": "",  
        "ai_temp": "0.7",
        "ai_timeout": 180.0,
        "ai_system_prompt": (
            "あなたの名前はEli（エリ）で優秀な実験補佐です。\n"
            "理系マインドを持って親しみやすくサポートしてください。"
        ),
        "elog_format_prompt": (
            "あなたは実験ログの構造化アシスタントです。\n"
            "以下のHTMLログからノイズ（base64画像バイナリ、無駄なタグ）を除去し、\n"
            "Frontmatter（日付、施設、BL、Energy、手法）と、\n"
            "【実験条件】【測定手順・操作ログ】【考察・ToDo】のMarkdownセクションに構造化・要約してください。"
        ),        
        "ring_facility": "SAGA-LS",
        "ring_url_sagals": "https://www.saga-ls.jp/acc/accstatus.jpg",
        "ring_url_spring8": "https://spring8.jp/status/sr_status_en.png",
        "ring_url_pf": "https://www-pfring.kek.jp/PF/status/pf_status.png",
        "ring_zoom": 50,
        "telegram_bot_token": "",
        "telegram_allowed_ids": "",
        "imagej_path": "",
        "default_font_size": 12,
        "auto_save_interval_min": 5,
        "backup_on_exit": False,
        "backup_dest_dir": "",

        # 🌟 ここを追加: アカウント毎の SR Info プリセット & 前回使用値
        "sr_info": {
            "last_values": {
                "facility": "SAGA-LS",
                "beamline": "BL07",
                "filter": "Si(111)",
                "energy": "10.0",
                "method": "Abs CT",
                "member": ""
            },
            "presets": {
                "facility": ["SAGA-LS", "PF", "PF AR", "SPring-8"],
                "beamline": ["BL07", "BL-14B", "BL-14C", "BL-20B"],
                "filter": ["Si(111)", "Si(220)", "Ge(111)", "Metal filter", "none"],
                "method": ["Abs CT", "micro CT", "Cryo micro CT", "Interferometry CT", "DEI CT", "STXM"],
                "member": [""]
            }
        }
    }

    if paths.config_file.exists():
        try:
            with open(paths.config_file, "r", encoding="utf-8") as f:
                saved = json.load(f)
                if isinstance(saved, dict):
                    default_cfg.update(saved)
        except Exception as e:
            print(f"[Config Load Error] {paths.config_file}: {e}")

    ij_path = default_cfg.get("imagej_path", "").strip()
    default_cfg["is_imagej_available"] = bool(ij_path and os.path.exists(os.path.expanduser(ij_path)))
    return default_cfg

def save_account_config(cfg: dict, account_name: str = None):
    paths = AccountPaths(account_name)
    paths.ensure_dirs()
    with config_io_lock:
        current = load_account_config(paths.account)
        current.update(cfg)
        _atomic_json_write(paths.config_file, current)

def get_account_list() -> list:
    """Log ディレクトリ配下にあるアカウント一覧を取得"""
    LOG_BASE_DIR.mkdir(parents=True, exist_ok=True)
    accs = [
        d.name for d in LOG_BASE_DIR.iterdir()
        if d.is_dir() and not d.name.startswith(".")
    ]
    if "default" not in accs:
        accs.insert(0, "default")
    return sorted(accs)

# ==========================================
# ウィンドウ座標管理
# ==========================================
def load_geometry() -> dict:
    if GEOMETRY_FILE.exists():
        try:
            with open(GEOMETRY_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    return data
        except Exception:
            pass
    return {}

def save_win_pos(win_key: str, geom: dict):
    with config_io_lock:
        current = load_geometry()
        current[win_key] = geom
        _atomic_json_write(GEOMETRY_FILE, current)