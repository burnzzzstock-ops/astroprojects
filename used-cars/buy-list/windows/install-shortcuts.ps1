# Makes the Buy List start (minimized) when you log in, and puts a "Buy List"
# link to the page on the desktop. To undo: delete "Buy List" from
# shell:startup (Win+R, type shell:startup) and the desktop shortcut.
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$ws = New-Object -ComObject WScript.Shell

$startup = [Environment]::GetFolderPath('Startup')
$lnk = $ws.CreateShortcut((Join-Path $startup 'Buy List.lnk'))
$lnk.TargetPath = Join-Path $root 'start.bat'
$lnk.WorkingDirectory = $root
$lnk.WindowStyle = 7   # minimized
$lnk.Save()

$port = 4400
try {
  $cfg = Get-Content (Join-Path $root 'config.json') -Raw | ConvertFrom-Json
  if ($cfg.port) { $port = $cfg.port }
} catch {}
$desktop = [Environment]::GetFolderPath('Desktop')
Set-Content -Path (Join-Path $desktop 'Buy List.url') -Value "[InternetShortcut]`r`nURL=http://localhost:$port/"
Write-Host "Added: starts with Windows, and a 'Buy List' shortcut on the desktop."
