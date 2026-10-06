# Jalankan klien desktop Electron BasDrive
$ErrorActionPreference = "Stop"
$nodeDir = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe\node-v24.19.0-win-x64"
if (Test-Path $nodeDir) { $env:Path = "$nodeDir;" + $env:Path }
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location "$root\desktop"
if (-not (Test-Path "node_modules\electron\dist\electron.exe")) {
  $env:NODE_OPTIONS = "--use-system-ca"
  npm.cmd install --no-audit --no-fund
  node node_modules\electron\install.js
  Remove-Item Env:NODE_OPTIONS -ErrorAction SilentlyContinue
}
Write-Host "Membuka BasDrive Desktop (http://127.0.0.1:8000)"
Remove-Item Env:NODE_OPTIONS -ErrorAction SilentlyContinue
npm.cmd start
