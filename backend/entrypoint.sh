#!/bin/sh

MAX_RETRIES=40
COUNT=0

echo "Running Alembic migrations (with retry)..."
until alembic upgrade head; do
    COUNT=$((COUNT + 1))
    if [ "$COUNT" -ge "$MAX_RETRIES" ]; then
        echo "ERROR: migrations failed after $MAX_RETRIES attempts. Exiting."
        exit 1
    fi
    echo "Attempt $COUNT/$MAX_RETRIES failed, retrying in 5s..."
    sleep 5
done

echo "Migrations complete. Starting FastAPI..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
