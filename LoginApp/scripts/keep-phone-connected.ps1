$ErrorActionPreference = 'Continue'
$taskSdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
# ADB reverse mappings disappear after USB reconnection; restore only this test port.
while ($true) {
  $taskDevices = @(& $taskSdk devices | Select-String '^([^\s]+)\s+device$' | ForEach-Object { $_.Matches[0].Groups[1].Value } | Where-Object { $_ -notlike 'emulator-*' })
  foreach ($taskSerial in $taskDevices) {
    $taskMappings = & $taskSdk -s $taskSerial reverse --list
    if (-not ($taskMappings -match 'tcp:8000 tcp:8000')) {
      & $taskSdk -s $taskSerial reverse tcp:8000 tcp:8000 | Out-Null
    }
  }
  Start-Sleep -Seconds 5
}
