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