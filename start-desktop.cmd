@echo off
setlocal
cd /d "%~dp0"

set "NODEDIR=%LOCALAPPDATA%\Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe\node-v24.19.0-win-x64"
if exist "%NODEDIR%\node.exe" set "PATH=%NODEDIR%;%PATH%"

set "ELECTRON=%~dp0desktop\node_modules\electron\dist\electron.exe"
if not exist "%ELECTRON%" (
  echo Electron belum lengkap. Mengunduh dependensi...
  cd /d "%~dp0desktop"
  set "NODE_OPTIONS=--use-system-ca"
  call npm.cmd install --no-audit --no-fund
  "%NODEDIR%\node.exe" node_modules\electron\install.js
  set "NODE_OPTIONS="
)

echo Membuka BasDrive Desktop ^(http://127.0.0.1:8000^)
echo Pastikan API sudah berjalan.
cd /d "%~dp0desktop"
start "" "%ELECTRON%" .
endlocal
