#!/bin/sh
set -e

# SKIP_MIGRATIONS=true: una instancia por club (add-club-subdominios-y-marca)
# comparte una sola base Neon entre N contenedores — si todos migraran al
# arrancar, un release que reinicia varias instancias a la vez las hace
# correr `alembic upgrade head` en paralelo contra la misma base. La
# migración pasa a ser un paso aparte, corrido una sola vez antes de tocar
# cualquier instancia (ver scripts/migrate_shared_db.sh). Sin configurar,
# el comportamiento de siempre: esta instancia migra sola al arrancar.
if [ "$SKIP_MIGRATIONS" != "true" ]; then
  python /app/migrate.py
fi

exec uvicorn app.main:app --host 0.0.0.0 --port 8000
