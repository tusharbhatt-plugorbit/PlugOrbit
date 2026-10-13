$ErrorActionPreference = 'Stop'
$taskSdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
$taskApk = Join-Path $PSScriptRoot '..\PlugOrbit-phone-test.apk'
if (-not (Test-Path -LiteralPath $taskSdk)) { throw 'Android SDK adb not found.' }
if (-not (Test-Path -LiteralPath $taskApk)) { throw 'PlugOrbit-phone-test.apk not found.' }
$taskDevices = @(& $taskSdk devices | Select-String '^([^\s]+)\s+device$' | ForEach-Object { $_.Matches[0].Groups[1].Value } | Where-Object { $_ -notlike 'emulator-*' })
if ($taskDevices.Count -ne 1) { throw 'Connect one Android phone by USB, enable USB debugging, and accept the prompt on your phone.' }
$taskSerial = $taskDevices[0]
try { $taskHealth = Invoke-RestMethod -Uri http://127.0.0.1:8000/health -TimeoutSec 5 } catch { throw 'Backend is not running. Start it from Backend: python -m uvicorn app.main:app --host 127.0.0.1 --port 8000' }
if ($taskHealth.status -ne 'ok') { throw 'Backend health check failed.' }
$taskWatcher = Join-Path $PSScriptRoot 'keep-phone-connected.ps1'
$taskExistingWatcher = Get-CimInstance Win32_Process -Filter "name='powershell.exe'" | Where-Object { $_.CommandLine -like '*-File*keep-phone-connected.ps1*' }
if (-not $taskExistingWatcher) {
  Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $taskWatcher + '"')) | Out-Null
}
& $taskSdk -s $taskSerial reverse tcp:8000 tcp:8000
if ($LASTEXITCODE -ne 0) { throw 'Could not connect the phone to the local backend.' }
& $taskSdk -s $taskSerial install -r $taskApk
if ($LASTEXITCODE -ne 0) { throw 'APK install failed.' }
& $taskSdk -s $taskSerial shell am start -n com.loginapp/.MainActivity
Write-Host 'PlugOrbit opened. Keep USB connected and Backend running for email login.'
