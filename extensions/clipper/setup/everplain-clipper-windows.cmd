@echo off
setlocal
cd /d "%~dp0"
echo Everplain Clipper - prepare files; browser installation stays manual.
powershell.exe -NoLogo -NoProfile -File "%~dp0everplain-clipper-windows.ps1"
if errorlevel 1 (
  echo.
  echo Setup did not finish. If Windows blocked the script, keep that protection.
  echo Use the manual ZIP option at https://e.qunxue.xyz/imports
)
echo.
pause
