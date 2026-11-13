#!/bin/bash
# AI-Powered Bid Platform — Mac/Linux Celery worker startup script

cd "$(dirname "$0")"

if [ ! -d ".venv" ]; then
    echo "Virtual environment not found. Run ./run.sh first."
    exit 1
fi

source .venv/bin/activate

echo "Starting Celery worker..."
celery -A app.celery_app worker --loglevel=info
