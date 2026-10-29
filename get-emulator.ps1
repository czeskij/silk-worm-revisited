# Download FS-UAE 3.1.66 for Windows (official GitHub release) into Emulator\FS-UAE.
# Run: right-click -> "Run with PowerShell", or: powershell -ExecutionPolicy Bypass -File get-emulator.ps1
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$url = "https://github.com/FrodeSolheim/fs-uae/releases/download/v3.1.66/FS-UAE_3.1.66_Windows_x86-64.zip"
$zip = Join-Path $env:TEMP "FS-UAE_3.1.66_Windows_x86-64.zip"
Write-Host "Downloading $url"
Invoke-WebRequest -Uri $url -OutFile $zip
New-Item -ItemType Directory -Force -Path Emulator | Out-Null
Expand-Archive -Path $zip -DestinationPath Emulator -Force
Remove-Item $zip
Write-Host "FS-UAE installed in Emulator\FS-UAE"
