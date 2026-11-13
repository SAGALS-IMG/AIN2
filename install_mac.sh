#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
PROJECT_ROOT="$(pwd)"

echo "========================================================"
echo " AIN2 全自動インストーラ (macOS)"
echo " 対象フォルダ: ${PROJECT_ROOT}"
echo "========================================================"

# 1. 既存の Conda を探索
CONDA_EXE=""
for p in "$HOME/miniforge3/bin/conda" "$HOME/miniconda3/bin/conda" "$HOME/anaconda3/bin/conda" "/opt/homebrew/bin/conda" "/usr/local/bin/conda"; do
  if [ -x "$p" ]; then CONDA_EXE="$p"; break; fi
done
if [ -z "$CONDA_EXE" ] && command -v conda &> /dev/null; then
  CONDA_EXE="$(which conda)"
fi

# 2. Conda が見つからない場合は自動サイレントダウンロード＆インストール
if [ -z "$CONDA_EXE" ]; then
  echo "--> Conda が見つかりません。自動セットアップを開始します..."
  ARCH="$(uname -m)"
  INSTALL_DIR="$HOME/miniforge3"

  if [ "$ARCH" = "arm64" ]; then
    INSTALLER_URL="https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-MacOSX-arm64.sh"
  else
    INSTALLER_URL="https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-MacOSX-x86_64.sh"
  fi

  TMP_INSTALLER="/tmp/miniforge_installer.sh"
  echo "--> インストーラをダウンロード中 (${ARCH})..."
  curl -fL "$INSTALLER_URL" -o "$TMP_INSTALLER"

  echo "--> サイレントインストールを実行中 (${INSTALL_DIR})..."
  bash "$TMP_INSTALLER" -b -u -p "$INSTALL_DIR"
  rm -f "$TMP_INSTALLER"

  CONDA_EXE="${INSTALL_DIR}/bin/conda"
fi

echo "--> Conda 準備完了: ${CONDA_EXE}"
export CONDA_PLUGINS_AUTO_ACCEPT_TOS=yes
CONDA_BASE="$("$CONDA_EXE" info --base)"
source "${CONDA_BASE}/etc/profile.d/conda.sh"

# 3. 仮想環境 ain2 の作成
ENV_NAME="ain2"
if ! conda info --envs | grep -q "^${ENV_NAME} "; then
  echo "--> 仮想環境 '${ENV_NAME}' (Python 3.11) を作成中..."
  conda create -y -n "${ENV_NAME}" --override-channels -c conda-forge python=3.11
fi
conda activate "${ENV_NAME}"

# 4. 依存ライブラリのインストール
echo "--> 依存ライブラリをインストール中..."
pip install --upgrade pip
pip install fastapi "uvicorn[standard]" pydantic opencv-python-headless numpy requests python-multipart aiofiles pywebview pyobjc-framework-WebKit

if [ -f "requirements.txt" ]; then
  pip install -r requirements.txt
fi

conda install -y --override-channels -c conda-forge xraylib tesseract

mkdir -p tmp_imagej Log/default

# 5. デスクトップショートカット生成
DESKTOP_SHORTCUT="$HOME/Desktop/AIN2.command"
cat << 'EOF' > "$DESKTOP_SHORTCUT"
#!/bin/bash
PROJECT_DIR="__PROJECT_DIR__"
cd "$PROJECT_DIR"

CONDA_EXE=""
for p in "$HOME/miniforge3/bin/conda" "$HOME/miniconda3/bin/conda" "$HOME/anaconda3/bin/conda" "/opt/homebrew/bin/conda" "/usr/local/bin/conda"; do
  if [ -x "$p" ]; then CONDA_EXE="$p"; break; fi
done
if [ -z "$CONDA_EXE" ]; then CONDA_EXE="$(which conda)"; fi

CONDA_BASE="$("$CONDA_EXE" info --base)"
source "${CONDA_BASE}/etc/profile.d/conda.sh"
conda activate ain2

python main.py
EOF

sed -i '' "s|__PROJECT_DIR__|${PROJECT_ROOT}|g" "$DESKTOP_SHORTCUT"
chmod +x "$DESKTOP_SHORTCUT"

# ★ アイコン画像の適用（Cocoa API経由）
ICON_FILE="${PROJECT_ROOT}/static/icon/AIN2.icns"
if [ -f "$ICON_FILE" ]; then
  python -c "
import sys
from AppKit import NSImage, NSWorkspace
icon_path = sys.argv[1]
target_path = sys.argv[2]
img = NSImage.alloc().initWithContentsOfFile_(icon_path)
if img:
    NSWorkspace.sharedWorkspace().setIcon_forFile_options_(img, target_path, 0)
" "$ICON_FILE" "$DESKTOP_SHORTCUT"
fi

echo "========================================================"
echo " [インストール完了！]"
echo " デスクトップに 'AIN2.command' を作成しました。"
echo " 次回からはそのアイコンをダブルクリックするだけで起動します。"
echo "========================================================"
read -p "Enterキーを押して終了してください..."