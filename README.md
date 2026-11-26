# AILab Note 2.0 (AIN2)

[日本語版 README はこちら (README_JA.md)](./README_JA.md)

**AILab Note 2.0 (AIN2)** is a lightweight, extensible desktop electronic laboratory notebook (ELN) designed for experimental researchers—especially in synchrotron radiation imaging, X-ray CT, and materials/biomedical sciences.

Built with **Python**, **FastAPI**, and **pywebview**, AIN2 runs locally with fast HTML-based daily logs, seamless **ImageJ / Fiji** integration, inline scientific calculations, and a modular **Add-in** architecture for Telegram field logging and local LLM/RAG assistance.

---

## ✨ Key Features

- **Daily Lab Logs & Auto-Backup:** Rich HTML-based daily experiment logs with automatic `.tmp`/`.bak` protection and incremental folder backup on exit.
- **ImageJ / Fiji Integration:** Send images directly between your lab notebook and ImageJ/Fiji for immediate image processing and annotation.
- **Image Overlay & Inline Calculator:** Draw annotations directly onto experimental images (`ain_canvas.js`), use inline expression evaluation, or open dedicated Memorandum and Calculator sub-windows.
- **Synchrotron Beamline Utilities:** Built-in ring current OCR and beamline status monitoring presets (`SAGA-LS`, `PF`, `PF AR`, `SPring-8`).
- **Bilingual UI (EN / JP):** Instant switching between English and Japanese interfaces.
- **Modular Add-in System (`Addins/`):** Easily add, remove, or customize independent plugins:
  - `01_links`: Quick-access bookmark manager for beamline and reference URLs.
  - `02_protocol_manager`: Reusable templates for standard experimental protocols.
  - `03_cop_telegram`: Sync field notes and photos directly from a Telegram bot.
  - `04_eli_assistant`: Local LLM & RAG-powered experimental assistant ("Eli") for log formatting and past-experiment search.

---

## 📁 Directory Structure

```text
AIN2/
├── main.py                  # Application entry point & pywebview window manager
├── AIN2_Manual_en.pdf       # User Manual & Add-in Developer Guide (English)
├── AIN2_Manual_JP.pdf       # User Manual & Add-in Developer Guide (Japanese)
├── core/                    # Core configuration, window state & add-in loader
├── routers/                 # FastAPI endpoints (logs, ImageJ/Fiji bridge, beamline tools)
├── templates/               # HTML templates (main log, memorandum, calculator)
├── static/                  # CSS, icons, and frontend JS engines (i18n, calc, canvas)
├── Addins/                  # Independent plug-and-play extensions
├── install_mac.sh           # Automated setup script for macOS
├── install_win.bat          # Automated setup script for Windows
└── requirements.txt         # Python dependencies
```

---

## 🚀 Installation & Quick Start

### Prerequisites
- Python 3.10 or 3.11 (Miniforge / Miniconda recommended; the setup scripts can install Miniforge automatically if not found)
- *(Optional)* [Fiji / ImageJ](https://fiji.sc/) for image analysis integration
- *(Optional)* Tesseract OCR (`brew install tesseract` on macOS) for storage ring current reading

### macOS
1. Clone this repository:
   ```bash
   git clone https://github.com/SAGALS-IMG/AIN2.git
   cd AIN2
   ```
2. Run the automated installer (creates the `ain2` Conda environment and a Desktop shortcut):
   ```bash
   bash install_mac.sh
   ```
   Or install dependencies manually and launch:
   ```bash
   pip install -r requirements.txt
   python main.py
   ```

### Windows 11
1. Clone this repository:
   ```bash
   git clone https://github.com/SAGALS-IMG/AIN2.git
   cd AIN2
   ```
2. Double-click `install_win.bat` (or run it in Command Prompt) to set up the environment and create a Desktop shortcut, or install manually:
   ```bash
   pip install -r requirements.txt
   python main.py
   ```

---

## 📖 Documentation

- **English Manual:** [`AIN2_Manual_en.pdf`](./AIN2_Manual_en.pdf)
- **Japanese Manual:** [`AIN2_Manual_JP.pdf`](./AIN2_Manual_JP.pdf) (also accessible via the **Help / About** menu inside the app)
- **Add-in Development:** Each folder inside `Addins/` contains a `manifest.json`, optional `router.py`, and `window.html`. See Chapter 6 of the manual for plugin specifications.

---
## Feedback & Contributions

Feedback, questions, and bug reports are always welcome! Please feel free to open an issue in **GitHub Issues** to share your thoughts or report any problems.

Please note that due to the maintainer's development workflow, **this repository does not accept Pull Requests (code contributions)**. You are, however, free to fork the repository and modify the code for your own use under the terms of the Apache License 2.0.

---
## 📄 License

This project is licensed under the **Apache License 2.0** — see the [LICENSE](./LICENSE) file for details.

Copyright (c) 2026 **SAGA Light Source (SAGA-LS)**  
Developed by **Akio Yoneyama** (SAGA-LS).

## v2.3.1 (2026-11-14)
- **Multi-Protocol Ring Current Acquisition / 蓄積リング電流取得の高度化**:
  - Added support for arbitrary facility additions alongside the fixed `SAGA-LS` default (`SAGA-LS` 基準固定 ＋ 任意施設の無制限追加に対応).
  - Supported direct JSON/text parsing (e.g., `NanoTerasu` `datafile.json`) in addition to image-based OCR (`NanoTerasu` 等のJSON/テキスト形式のデータ取得と画像OCRの自動判別に対応).
- **3-System Color Palettes / 3系統カラーパレットの実装**:
  - Added customizable color palettes and real-time toolbar indicators for Text (`A`), Highlight (`🖊`), and Callout Box (`▭`) borders/backgrounds (文字色・マーカー・ボックス色のカラーパレットとカーソル連動インジケーターを追加).
- **Account Avatar Badge / アカウント識別バッジ**:
  - Replaced the generic user icon with a color-coded initial badge for quick profile identification (アカウント頭文字と自動配色によるアバターバッジを導入).
- **Documentation / マニュアル更新**:
  - Updated JP/EN manuals to Version 2.3.1 (日英マニュアルを v2.3.1 に更新).

## v2.4.0 (2026-11-26)
* **Timer / Stopwatch Add-in (`05_timer`) / タイマー・ストップウォッチアドインの追加:**
  * Added a modular countdown timer and high-precision stopwatch with lap recording and one-click notebook insertion（プリセット・アラーム音付きタイマーとラップ計測対応ストップウォッチ、ノートへのワンクリック結果挿入機能を追加）。
* **Font Size Control / フォントサイズ指定機能:**
  * Added a toolbar font size selector (8–36 pt) with clean inline span handling and cursor synchronization（8〜36 pt のフォントサイズ変更プルダウンとネスト防止・カーソル連動を追加）。
* **Unified Undo / Redo History / エディタ Undo・Redo の統一:**
  * Implemented a snapshot history stack (`Cmd+Z` / `Cmd+Shift+Z` / `Ctrl+Y`) for consistent text and add-in edit history（テキスト編集・アドイン挿入を統一的に戻せるスナップショット履歴スタックを実装）。
* **Full Offline Support & Window Bounds Clamping / 完全オフライン対応・画面外補正:**
  * Bundled Tailwind CSS locally across all core and add-in views, and added multi-display boundary clamping on startup（全画面・全アドインの Tailwind CSS ローカル同梱化と、マルチディスプレイ解除時の画面外はみ出し補正を適用）。
* **Documentation / マニュアル更新:**
  * Updated JP/EN manuals to Version 2.4.0（日英マニュアルを v2.4.0 に更新）。
