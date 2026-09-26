@echo off
setlocal
rem Registers the native messaging host for Chrome (current user, no admin needed).
rem Run this AFTER loading the extension in chrome://extensions so you can paste
rem its ID below.

set "HOSTDIR=%~dp0"
set "JSON=%HOSTDIR%com.ytshorts.autoscroll.json"

echo Paste the extension ID from chrome://extensions (32 letters), then press Enter:
set /p EXTID=

if "%EXTID%"=="" (
  echo No extension ID entered. Aborting.
  pause
  exit /b 1
)

rem Build the host manifest with JSON-escaped (doubled) backslashes.
> "%JSON%" (
  echo {
  echo   "name": "com.ytshorts.autoscroll",
  echo   "description": "Shorts Auto-Scroller desktop widget",
  echo   "path": "%HOSTDIR%host.bat",
  echo   "type": "stdio",
  echo   "allowed_origins": [ "chrome-extension://%EXTID%/" ]
  echo }
)

reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.ytshorts.autoscroll" /ve /t REG_SZ /d "%JSON%" /f

echo.
echo Registered. Written manifest:
type "%JSON%"
echo.
echo Done. Reload the extension and open a YouTube Shorts tab.
pause
