$ErrorActionPreference = "Stop"

$releaseDir = Join-Path $PWD "release"
$installer = Get-ChildItem -LiteralPath $releaseDir -File -Filter "*-win-x64.exe" | Select-Object -First 1
$portable = Get-ChildItem -LiteralPath $releaseDir -File -Filter "*-win-x64.zip" | Select-Object -First 1
if (-not $installer) { throw "Windows NSIS installer was not produced." }
if (-not $portable) { throw "Windows portable ZIP was not produced." }
if ($installer.Length -lt 50MB) { throw "Installer is unexpectedly small ($($installer.Length) bytes)." }
if ($portable.Length -lt 50MB) { throw "Portable ZIP is unexpectedly small ($($portable.Length) bytes)." }

$tempRoot = Join-Path $env:RUNNER_TEMP "xneon-reborn-smoke"
$installDir = Join-Path $tempRoot "installed"
$profileDir = Join-Path $tempRoot "profile"
$portableDir = Join-Path $tempRoot "portable"
New-Item -ItemType Directory -Force -Path $tempRoot, $profileDir, $portableDir | Out-Null

Write-Host "Testing NSIS silent installation: $($installer.Name)"
$install = Start-Process -FilePath $installer.FullName -ArgumentList @("/S", "/D=$installDir") -Wait -PassThru
if ($install.ExitCode -ne 0) { throw "NSIS installer exited with code $($install.ExitCode)." }

$appExe = Get-ChildItem -LiteralPath $installDir -File -Filter "*.exe" -Recurse |
  Where-Object { $_.Name -eq "Xneon Launcher.exe" } | Select-Object -First 1
if (-not $appExe) { throw "Installed Xneon Launcher.exe was not found." }

Write-Host "Checking portable ZIP contents."
Expand-Archive -LiteralPath $portable.FullName -DestinationPath $portableDir -Force
$portableExe = Get-ChildItem -LiteralPath $portableDir -File -Filter "Xneon Launcher.exe" -Recurse | Select-Object -First 1
if (-not $portableExe) { throw "Portable ZIP does not contain Xneon Launcher.exe." }

Write-Host "Launching installed application in an isolated profile."
$process = Start-Process -FilePath $appExe.FullName -WorkingDirectory $appExe.DirectoryName -ArgumentList @("--disable-gpu", "--no-sandbox", "--user-data-dir=$profileDir") -PassThru
try {
  Start-Sleep -Seconds 20
  $process.Refresh()
  if ($process.HasExited) {
    throw "Xneon Launcher exited during startup with code $($process.ExitCode)."
  }
  Write-Host "Application process remained alive for 20 seconds (PID $($process.Id))."
}
finally {
  if (-not $process.HasExited) {
    & taskkill.exe /PID $process.Id /T /F | Out-Null
  }
}
Write-Host "Windows package smoke test passed."
