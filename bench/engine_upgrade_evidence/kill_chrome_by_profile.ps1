$pat = $args[0]
if (-not $pat) { $pat = 'upg_chrome' }
Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
  Where-Object { $_.CommandLine -and $_.CommandLine -like ("*" + $pat + "*") } |
  ForEach-Object { Write-Output ("kill " + $_.ProcessId); Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Write-Output 'kill done'
