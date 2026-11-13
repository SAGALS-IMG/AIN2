@echo off
setlocal
cd /d "%~dp0"
set "PROJECT_ROOT=%cd%"

echo ========================================================
echo  AIN2 Automated Installer - Windows
echo  Target Directory: %PROJECT_ROOT%
echo ========================================================

rem 1. Search for existing Conda installation
set "CONDA_ROOT="
if exist "%USERPROFILE%\miniforge3\Scripts\conda.exe" set "CONDA_ROOT=%USERPROFILE%\miniforge3"
if not defined CONDA_ROOT if exist "%LOCALAPPDATA%\miniforge3\Scripts\conda.exe" set "CONDA_ROOT=%LOCALAPPDATA%\miniforge3"
if not defined CONDA_ROOT if exist "%USERPROFILE%\miniconda3\Scripts\conda.exe" set "CONDA_ROOT=%USERPROFILE%\miniconda3"
if not defined CONDA_ROOT if exist "%USERPROFILE%\anaconda3\Scripts\conda.exe" set "CONDA_ROOT=%USERPROFILE%\anaconda3"
if not defined CONDA_ROOT if exist "C:\ProgramData\miniforge3\Scripts\conda.exe" set "CONDA_ROOT=C:\ProgramData\miniforge3"
if not defined CONDA_ROOT if exist "C:\ProgramData\miniconda3\Scripts\conda.exe" set "CONDA_ROOT=C:\ProgramData\miniconda3"

if defined CONDA_ROOT goto :conda_ready

rem 2. Download and silently install Miniforge if Conda is not found
echo --^> Conda not found. Starting automatic Miniforge setup.
set "INSTALLER_EXE=%TEMP%\miniforge_installer.exe"
set "TARGET_DIR=%USERPROFILE%\miniforge3"

echo --^> Downloading Miniforge installer.
curl.exe -fL "https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-Windows-x86_64.exe" -o "%INSTALLER_EXE%"
if errorlevel 1 (
    echo [ERROR] Failed to download Miniforge installer. Please check your network connection.
    pause
    exit /b 1
)

echo --^> Running silent installation - this may take 1 to 2 minutes.
start /wait "" "%INSTALLER_EXE%" /InstallationType=JustMe /RegisterPython=0 /S /D=%TARGET_DIR%
del /f /q "%INSTALLER_EXE%" 2>nul
set "CONDA_ROOT=%TARGET_DIR%"

:conda_ready
set "CONDA_EXE=%CONDA_ROOT%\Scripts\conda.exe"
if not exist "%CONDA_EXE%" (
    echo [ERROR] Conda installation failed.
    pause
    exit /b 1
)

echo --^> Conda ready: %CONDA_ROOT%
set "CONDA_PLUGINS_AUTO_ACCEPT_TOS=yes"

rem 3. Create 'ain2' virtual environment via conda-forge only
set "ENV_DIR=%CONDA_ROOT%\envs\ain2"
set "ENV_PYTHON=%ENV_DIR%\python.exe"
if not exist "%ENV_PYTHON%" (
    echo --^> Creating virtual environment 'ain2' with Python 3.11.
    "%CONDA_EXE%" create -y -n ain2 --override-channels -c conda-forge python=3.11
)

if not exist "%ENV_PYTHON%" (
    echo [ERROR] Failed to create virtual environment 'ain2'.
    pause
    exit /b 1
)

set "PATH=%ENV_DIR%;%ENV_DIR%\Library\bin;%ENV_DIR%\Scripts;%PATH%"

rem 4. Install dependencies directly into ain2 environment
echo --^> Installing dependencies.
"%ENV_PYTHON%" -m pip install --upgrade pip
"%ENV_PYTHON%" -m pip install fastapi "uvicorn[standard]" pydantic opencv-python-headless numpy requests python-multipart aiofiles pywebview pythonnet
"%CONDA_EXE%" install -y -n ain2 --override-channels -c conda-forge xraylib tesseract
rem 5. Generate launcher batch file and desktop shortcut
set "RUN_BAT=%PROJECT_ROOT%\run_app.bat"
echo @echo off > "%RUN_BAT%"
echo cd /d "%PROJECT_ROOT%" >> "%RUN_BAT%"
echo set "PATH=%ENV_DIR%;%ENV_DIR%\Library\bin;%ENV_DIR%\Scripts;%%PATH%%" >> "%RUN_BAT%"
echo set "TESSDATA_PREFIX=%ENV_DIR%\share\tessdata" >> "%RUN_BAT%"
echo "%ENV_PYTHON%" main.py >> "%RUN_BAT%"


if exist "requirements.txt" (
    "%ENV_PYTHON%" -m pip install -r requirements.txt
)
"%CONDA_EXE%" install -y -n ain2 --override-channels -c conda-forge xraylib


if not exist "tmp_imagej" mkdir "tmp_imagej"
if not exist "Log\default" mkdir "Log\default"

rem 5. Generate launcher batch file and desktop shortcut
set "RUN_BAT=%PROJECT_ROOT%\run_app.bat"
echo @echo off > "%RUN_BAT%"
echo cd /d "%PROJECT_ROOT%" >> "%RUN_BAT%"
echo set "PATH=%ENV_DIR%;%ENV_DIR%\Library\bin;%ENV_DIR%\Scripts;%%PATH%%" >> "%RUN_BAT%"
echo "%ENV_PYTHON%" main.py >> "%RUN_BAT%"

set "DESKTOP_DIR=%USERPROFILE%\Desktop"
set "ICON_PATH=%PROJECT_ROOT%\static\icon\AIN2.ico"

powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%DESKTOP_DIR%\AIN2.lnk'); $s.TargetPath = '%RUN_BAT%'; $s.WorkingDirectory = '%PROJECT_ROOT%'; $s.WindowStyle = 7; if (Test-Path '%ICON_PATH%') { $s.IconLocation = '%ICON_PATH%' }; $s.Save()"

echo ========================================================
echo  [Installation Complete!]
echo  Created desktop shortcut 'AIN2'.
echo  Double-click the 'AIN2' icon on your desktop to launch.
echo ========================================================
pause
