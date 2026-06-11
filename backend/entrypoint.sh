#!/bin/sh
set -e
python /app/migrate.py
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
