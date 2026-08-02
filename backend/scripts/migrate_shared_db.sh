#!/bin/sh
#
# Corre `alembic upgrade head` UNA VEZ contra la base Neon compartida, antes
# de levantar o reiniciar cualquier instancia de club.
#
# Con una instancia por club compartiendo una sola base
# (add-club-subdominios-y-marca), si cada contenedor migrara solo al
# arrancar, un release que reinicia varias instancias a la vez las haría
# correr `alembic upgrade head` en paralelo contra la misma base — una
# carrera evitable. Por eso `entrypoint.sh` respeta `SKIP_MIGRATIONS=true`
# en el compose por club, y la migración pasa a ser este paso aparte.
#
# Uso, antes de tocar ninguna instancia:
#   ./backend/scripts/migrate_shared_db.sh .env.production
#
# El archivo de entorno tiene que traer DATABASE_URL_DIRECT (el endpoint sin
# pooler — Alembic no sostiene locks de advisory ni SET de sesión contra un
# pooler en modo transacción) y el resto de las variables que exige
# `Settings` (SECRET_KEY, SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD): las lee
# igual al construirse, aunque este paso no las use para nada más.
#
# NO VERIFICADO CONTRA UNA NEON REAL — ver openspec/specs/multi-tenant.md,
# "Qué se verificó y qué no".
set -eu

ENV_FILE="${1:?uso: migrate_shared_db.sh <archivo-de-entorno>}"

if [ ! -f "$ENV_FILE" ]; then
  echo "No existe '$ENV_FILE'" >&2
  exit 1
fi

if ! grep -q '^DATABASE_URL_DIRECT=' "$ENV_FILE"; then
  echo "'$ENV_FILE' no define DATABASE_URL_DIRECT — sin eso, Alembic migraría" >&2
  echo "contra el endpoint pooled, que no sostiene lo que necesita." >&2
  exit 1
fi

docker run --rm \
  --env-file "$ENV_FILE" \
  --entrypoint python \
  match-analisis-backend:latest \
  migrate.py
