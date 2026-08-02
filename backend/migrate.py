"""Wait for the database to be reachable, then run Alembic migrations."""
import os
import sys
import time

import psycopg2
from alembic.config import Config
from alembic import command

# DATABASE_URL_DIRECT (sin pooler) si está configurada — es el endpoint que
# Alembic va a usar de verdad (ver alembic/env.py), así que es contra ese que
# hay que esperar. Ver [[add-club-subdominios-y-marca]].
DATABASE_URL = os.environ.get("DATABASE_URL_DIRECT") or os.environ.get("DATABASE_URL", "")
SYNC_URL = (
    DATABASE_URL
    .replace("postgresql+asyncpg://", "postgresql://")
    .replace("postgresql+psycopg2://", "postgresql://")
    .replace("postgres://", "postgresql://")
)

MAX_ATTEMPTS = 40
DELAY = 5
CONNECT_TIMEOUT = 5


def wait_for_db() -> None:
    print("Waiting for database...", flush=True)
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            conn = psycopg2.connect(SYNC_URL, connect_timeout=CONNECT_TIMEOUT)
            conn.close()
            print(f"Database ready (attempt {attempt}/{MAX_ATTEMPTS}).", flush=True)
            return
        except Exception as e:
            print(f"Attempt {attempt}/{MAX_ATTEMPTS} failed: {e}", flush=True)
            if attempt < MAX_ATTEMPTS:
                time.sleep(DELAY)

    print("Database unavailable after all attempts. Exiting.", flush=True)
    sys.exit(1)


def run_migrations() -> None:
    print("Running migrations...", flush=True)
    cfg = Config("/app/alembic.ini")
    command.upgrade(cfg, "head")
    print("Migrations complete.", flush=True)


if __name__ == "__main__":
    wait_for_db()
    run_migrations()
