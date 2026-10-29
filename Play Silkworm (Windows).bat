@echo off
rem Double-click in Explorer to play.
cd /d "%~dp0"
start "" "%~dp0Emulator\FS-UAE\Windows\x86-64\fs-uae.exe" "%~dp0Silkworm.fs-uae" %*
