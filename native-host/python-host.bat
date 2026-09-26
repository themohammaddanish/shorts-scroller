@echo off
rem Finds python.exe and runs the widget. Edit if Python is elsewhere.
set "PY=python"
where python >nul 2>nul || set "PY=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
"%PY%" "%~dp0host.py"
