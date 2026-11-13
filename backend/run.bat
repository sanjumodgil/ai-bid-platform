@echo off
REM AI-Powered Bid Platform — Windows startup script
REM Activates the virtual environment and starts the backend API server.
REM Run this instead of "python run.py" directly.

cd /d "%~dp0"

REM Create virtual environment if it doesn't exist
IF NOT EXIST ".venv" (
    echo Creating virtual environment...
    python -m venv .venv
    IF ERRORLEVEL 1 (
        echo ERROR: Could not create virtual environment.
        echo Make sure Python 3.12+ is installed and on your PATH.
        pause
        exit /b 1
    )
)

REM Activate virtual environment
call .venv\Scripts\activate.bat

REM Install / update dependencies
echo Installing dependencies...
pip install -r requirements.txt --quiet

REM Start the server
echo.
python run.py

pause
