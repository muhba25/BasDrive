@echo off
setlocal
cd /d "%~dp0desktop"
set "NODEDIR=%LOCALAPPDATA%\Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe\node-v24.19.0-win-x64"
if exist "%NODEDIR%\node.exe" set "PATH=%NODEDIR%;%PATH%"
set "NODE_OPTIONS=--use-system-ca"
echo Membangun installer Windows BasDrive ^(Setup.exe + portable .exe^)...
call npm.cmd run pack:win
if errorlevel 1 goto :fail
echo.
echo Selesai. File ada di folder desktop\release\
dir /b "%~dp0desktop\release\*.exe" 2>nul
goto :eof
:fail
echo Build gagal.
exit /b 1
