#!/bin/sh
# Restaura un backup sobre la base de producción.
#
#   docker compose -f docker-compose.prod.yml --env-file .env.production stop backend
#   docker compose -f docker-compose.prod.yml --env-file .env.production \
#     run --rm --entrypoint /bin/sh -T backup \
#     /ops/restore.sh /backups/match_analisis-20260728T030000Z.sql.gz
#   docker compose -f docker-compose.prod.yml --env-file .env.production start backend
#
# Un backup que nadie restauró nunca no es un backup, es un archivo. Este script
# existe para que la primera vez que se corra no sea el día del incidente.
#
# **Destruye la base actual.** Pide confirmación explícita salvo que se pase
# --force, y antes de tocar nada saca un dump de seguridad de lo que hay: si el
# backup elegido resulta ser el equivocado, todavía hay a dónde volver.
set -eu

FILE="${1:-}"
FORCE="${2:-}"

if [ -z "$FILE" ]; then
	echo "Uso: restore.sh <archivo.sql.gz> [--force]" >&2
	echo "" >&2
	echo "Backups disponibles:" >&2
	ls -1t /backups/*.sql.gz 2>/dev/null >&2 || echo "  (ninguno)" >&2
	exit 1
fi

[ -f "$FILE" ] || { echo "No existe: $FILE" >&2; exit 1; }

gzip -t "$FILE" || { echo "El archivo está corrupto, no se restaura nada." >&2; exit 1; }

# ── El backend tiene que estar apagado ────────────────────────────────────────
#
# Con el backend prendido pasan dos cosas, y la segunda es la grave:
#
# 1. `DROP SCHEMA` puede quedarse esperando. Las conexiones ociosas del pool no
#    tienen locks —medido: quedan en `idle`, fuera de transacción—, así que
#    muchas veces pasa de largo. Pero cualquier request en vuelo abre una
#    transacción y ahí sí bloquea. Es una carrera, no una garantía.
# 2. El backend **sigue atendiendo** durante el restore. Escribe sobre un schema
#    a medio reemplazar y les contesta a los usuarios con datos que están a punto
#    de desaparecer. Eso no da error en ningún lado.
#
# Por (2) no alcanza con matar las conexiones y seguir: el pool reconecta solo a
# los pocos segundos y vuelve a escribir. Hay que apagarlo.
otras=$(psql --quiet --tuples-only --no-align --command \
	"SELECT count(*) FROM pg_stat_activity
	  WHERE datname = current_database() AND pid <> pg_backend_pid()")

if [ "${otras:-0}" -gt 0 ]; then
	cat >&2 <<-EOF

		Hay $otras conexión/es abiertas contra "$PGDATABASE" además de esta.

		Casi siempre es el backend. Apagalo, restaurá, y volvé a prenderlo:

		  DC="docker compose -f docker-compose.prod.yml --env-file .env.production"

		  \$DC stop backend
		  \$DC run --rm --entrypoint /bin/sh -T backup /ops/restore.sh $FILE --force
		  \$DC start backend

		El \`--entrypoint /bin/sh\` no es opcional: sin eso, \`run\` pisa el *command*
		del servicio pero no el entrypoint, y termina corriendo el backup en loop
		mientras estos argumentos se ignoran en silencio.

		Restaurar con el backend prendido lo deja atendiendo sobre un schema a
		medio reemplazar, contestando con datos que están por desaparecer.
	EOF
	exit 1
fi

if [ "$FORCE" != "--force" ]; then
	printf 'Esto REEMPLAZA la base "%s" con %s.\nEscribí "si" para seguir: ' "$PGDATABASE" "$(basename "$FILE")"
	read -r answer
	[ "$answer" = "si" ] || { echo "Cancelado."; exit 1; }
fi

safety="/backups/.pre-restore-$(date -u '+%Y%m%dT%H%M%SZ').sql.gz"
echo "Guardando el estado actual en $safety antes de pisarlo..."
pg_dump --format=plain --no-owner --no-privileges | gzip -9 >"$safety"

echo "Restaurando..."
# El dump es de una sola base, así que se recrea el schema public en vez de la
# base entera: `dropdb` fallaría por estar conectado a ella.
psql --quiet --set ON_ERROR_STOP=1 <<-'SQL'
	DROP SCHEMA public CASCADE;
	CREATE SCHEMA public;
SQL

gunzip -c "$FILE" | psql --quiet --set ON_ERROR_STOP=1

echo "Listo. Restaurado desde $(basename "$FILE")."
echo "El estado anterior quedó en $safety por si hace falta volver."
