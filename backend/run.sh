#!/bin/bash
# AI-Powered Bid Platform — Mac/Linux startup script

cd "$(dirname "$0")"

# Create virtual environment if it doesn't exist
if [ ! -d ".venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv .venv
fi

# Activate virtual environment
source .venv/bin/activate

# Install / update dependencies
echo "Installing dependencies..."
pip install -r requirements.txt --quiet

# Start the server
echo ""
python run.py
