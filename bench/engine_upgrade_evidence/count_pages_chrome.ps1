$pats = @('*chrome-pages*', '*chrome-pages*')
$n = @(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object {
    $_.CommandLine -and ($_.CommandLine -like $pats[0] -or $_.CommandLine -like $pats[1])
}).Count
Write-Output $n
