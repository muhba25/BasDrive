@echo off
setlocal
cd /d "%~dp0backend"
if exist ".venv\Scripts\python.exe" (
  set "PY=.venv\Scripts\python.exe"
) else (
  set "PY=python"
)
echo BasDrive local  -^> http://127.0.0.1:8000
echo Jaringan LAN    -^> http://IP-PC-ini:8000
echo Akun            -^> admin / Admin@12345
"%PY%" -m uvicorn app.main:app --host 0.0.0.0 --reload --reload-exclude "storage/*" --reload-exclude "*.db" --port 8000
