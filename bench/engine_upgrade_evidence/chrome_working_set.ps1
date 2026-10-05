# chrome_working_set.ps1 — total working set (MB) + count of chrome.exe processes whose command line
# matches a profile marker. Pass the marker so unrelated Chrome (the user's browser, other test
# profiles) is not counted.
#   usage: powershell -NoProfile -ExecutionPolicy Bypass -File chrome_working_set.ps1 '*chrome-pages-mem*'
param([string]$Pattern = '*chrome*')
$pats = @($Pattern, $Pattern)
$p = @(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object {
    $_.CommandLine -and ($_.CommandLine -like $pats[0] -or $_.CommandLine -like $pats[1])
})
$sum = 0
foreach ($x in $p) { $sum += $x.WorkingSetSize }
$mb = [math]::Round($sum / 1MB, 1)
Write-Output ("{0} {1}" -f $mb.ToString([System.Globalization.CultureInfo]::InvariantCulture), $p.Count)
