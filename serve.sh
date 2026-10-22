#!/bin/sh
# Serve the game locally. Usage: ./serve.sh [port]   (default 8080)
cd "$(dirname "$0")"
python3 serve.py "${1:-8080}"
