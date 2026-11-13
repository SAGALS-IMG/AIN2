@echo off
chcp 65001 > nul
setlocal enabledelayedexpansion
cd /d "%~dp0"
set "PROJECT_ROOT=%cd%"

echo ========================================================
echo  AIN2 全自動インストーラ (Windows)
echo  対象フォルダ: %PROJECT_ROOT%
echo ========================================================

:: 1. 既存の Conda を探索（miniforge3 にも対応）
set "CONDA_ACTIVATE="
for %%P in (
    "%USERPROFILE%\miniforge3\Scripts\activate.bat"
    "%LOCALAPPDATA%\miniforge3\Scripts\activate.bat"
    "%USERPROFILE%\miniconda3\Scripts\activate.bat"
    "%USERPROFILE%\anaconda3\Scripts\activate.bat"
    "C:\ProgramData\miniforge3\Scripts\activate.bat"
    "C:\ProgramData\miniconda3\Scripts\activate.bat"
) do (
    if exist %%P (
        set "CONDA_ACTIVATE=%%~P"
        goto :found_conda
    )
)

:found_conda
:: 2. Conda が見つからない場合は Miniforge をサイレントダウンロード＆インストール
if "%CONDA_ACTIVATE%"=="" (
    echo --> Conda が見つかりません。Miniforge の自動セットアップを開始します...
    set "INSTALLER_EXE=%TEMP%\miniforge_installer.exe"
    set "TARGET_DIR=%USERPROFILE%\miniforge3"

    echo --> Miniforge インストーラをダウンロード中...
    curl.exe -fL "https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-Windows-x86_64.exe" -o "%INSTALLER_EXE%"
    if !errorlevel! neq 0 (
        echo 【エラー】インストーラのダウンロードに失敗しました。ネットワーク接続またはURLを確認してください。
        pause
        exit /b 1
    )

    echo --> サイレントインストールを実行中 (1〜2分程度かかります)...
    start /wait "" "%INSTALLER_EXE%" /InstallationType=JustMe /RegisterPython=0 /S /D=%TARGET_DIR%
    del /f /q "%INSTALLER_EXE%" 2>nul

    set "CONDA_ACTIVATE=%TARGET_DIR%\Scripts\activate.bat"
)

if not exist "%CONDA_ACTIVATE%" (
    echo 【エラー】Conda のインストールに失敗しました。
    pause
    exit /b 1
)

echo --> Conda 準備完了: %CONDA_ACTIVATE%
call "%CONDA_ACTIVATE%" base

:: 3. 仮想環境 ain2 の作成
set "ENV_NAME=ain2"
conda info --envs | findstr /b /c:"%ENV_NAME% " >nul
if %errorlevel% neq 0 (
    echo --> 仮想環境 '%ENV_NAME%' (Python 3.11) を作成中...
    call conda create -y -n "%ENV_NAME%" python=3.11
)
call conda activate "%ENV_NAME%"

:: 4. 依存ライブラリのインストール
echo --> 依存ライブラリをインストール中...
call python -m pip install --upgrade pip
call pip install fastapi "uvicorn[standard]" pydantic opencv-python-headless numpy requests python-multipart aiofiles pywebview pythonnet

if exist "requirements.txt" (
    call pip install -r requirements.txt
)

if not exist "tmp_imagej" mkdir "tmp_imagej"
if not exist "Log\default" mkdir "Log\default"

:: 5. 起動バッチとデスクトップショートカット (.lnk) の生成（アイコン設定付き）
set "RUN_BAT=%PROJECT_ROOT%\run_app.bat"
(
echo @echo off
echo cd /d "%PROJECT_ROOT%"
echo call "%CONDA_ACTIVATE%" ain2
echo python main.py
) > "%RUN_BAT%"

set "DESKTOP_DIR=%USERPROFILE%\Desktop"
set "ICON_PATH=%PROJECT_ROOT%\static\icon\AIN2.ico"

powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%DESKTOP_DIR%\AIN2.lnk'); $s.TargetPath = '%RUN_BAT%'; $s.WorkingDirectory = '%PROJECT_ROOT%'; $s.WindowStyle = 7; if (Test-Path '%ICON_PATH%') { $s.IconLocation = '%ICON_PATH%' }; $s.Save()"

echo ========================================================
echo  [インストール完了！]
echo  デスクトップにショートカット 'AIN2' を作成しました。
echo  次回からはそのアイコンをダブルクリックするだけで起動します。
echo ========================================================
pause