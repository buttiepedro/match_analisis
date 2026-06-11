#!/bin/sh
set -e

echo "Waiting for database..."
until python - <<'EOF'
import os, sys
import psycopg2

url = os.environ.get("DATABASE_URL", "")
url = (url
    .replace("postgresql+asyncpg://", "postgresql://")
    .replace("postgresql+psycopg2://", "postgresql://")
    .replace("postgres://", "postgresql://")
)
try:
    conn = psycopg2.connect(url, connect_timeout=3)
    conn.close()
    sys.exit(0)
except Exception as e:
    print(f"  db not ready: {e}", flush=True)
    sys.exit(1)
EOF
do
    sleep 2
done

echo "Database ready. Running migrations..."
alembic upgrade head

echo "Starting FastAPI..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
