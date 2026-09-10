$desktop = Join-Path $env:USERPROFILE "OneDrive\Desktop"
$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut((Join-Path $desktop "Start AHD LiveStream.lnk"))
$sc.TargetPath = "C:\AHD\Start AHD LiveStream.bat"
$sc.WorkingDirectory = "C:\AHD"
$ico = "C:\AHD\traccar-overlay\altitude-hd.ico"
if (-not (Test-Path $ico)) { $ico = "C:\AHD\ahd-icon.ico" }
$sc.IconLocation = $ico + ",0"
$sc.Description = "Start all AHD LiveStream services (local C:\AHD)"
$sc.Save()
Write-Host "Shortcut created pointing to C:\AHD"
