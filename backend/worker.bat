@echo off
REM AI-Powered Bid Platform — Windows Celery worker startup script

cd /d "%~dp0"

IF NOT EXIST ".venv" (
    echo Virtual environment not found. Run run.bat first to set it up.
    pause
    exit /b 1
)

call .venv\Scripts\activate.bat

echo Starting Celery worker...
celery -A app.celery_app worker --loglevel=info --pool=solo

pause
