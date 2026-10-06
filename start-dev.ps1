# Jalankan BasDrive (API + UI web)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location "$root\backend"
if (Test-Path .venv\Scripts\Activate.ps1) { . .venv\Scripts\Activate.ps1 }
Write-Host "BasDrive local -> http://127.0.0.1:8000"
Write-Host "Jaringan LAN   -> http://<IP-PC-ini>:8000"
Write-Host "Akun           -> admin / Admin@12345"
python -m uvicorn app.main:app --host 0.0.0.0 --reload --reload-exclude "storage/*" --reload-exclude "*.db" --port 8000
