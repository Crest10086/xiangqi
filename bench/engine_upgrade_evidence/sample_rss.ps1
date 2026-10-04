# sample_rss.ps1 — sample total WorkingSet of chrome processes whose cmdline matches a profile substring
param([string]$pat = 'chrome-upg', [int]$secs = 70, [string]$out = 'rss_samples.txt')
$deadline = (Get-Date).AddSeconds($secs)
$max = 0; $maxN = 0; $maxDetail = ''
"" | Set-Content $out
while ((Get-Date) -lt $deadline) {
  $procs = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -and ($_.CommandLine -like ("*" + $pat + " *") -or $_.CommandLine -like ("*" + $pat + "`"")) }
  $sum = 0; $n = 0; $det = @()
  foreach ($p in $procs) {
    $sum += $p.WorkingSetSize; $n++
    $type = 'browser'
    if ($p.CommandLine -like '*--type=renderer*') { $type = 'renderer' }
    elseif ($p.CommandLine -like '*--type=gpu*') { $type = 'gpu' }
    elseif ($p.CommandLine -like '*--type=utility*') { $type = 'utility' }
    elseif ($p.CommandLine -like '*crashpad*') { $type = 'crashpad' }
    $det += ($type + ':' + [Math]::Round($p.WorkingSetSize / 1MB, 0))
  }
  if ($sum -gt $max) { $max = $sum; $maxN = $n; $maxDetail = ($det -join ' ') }
  Add-Content $out ((Get-Date).ToString('HH:mm:ss') + ' n=' + $n + ' rssMB=' + [Math]::Round($sum / 1MB, 1))
  Start-Sleep -Seconds 2
}
Add-Content $out ('MAX rssMB=' + [Math]::Round($max / 1MB, 1) + ' n=' + $maxN + ' detail[' + $maxDetail + ']')
