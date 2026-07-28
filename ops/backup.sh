#!/bin/sh
# Backup periódico de Postgres.
#
# Un club pierde acá el padrón de socios y una temporada entera de partidos. Es
# el dato más caro de la app y el único que no se puede volver a generar.
#
# Dos cuidados que hacen la diferencia entre un backup y un archivo:
#
# 1. **Se escribe a un temporal y recién al final se renombra.** Un `pg_dump`
#    cortado a la mitad —el server se reinicia, se llena el disco— deja un .gz
#    truncado. Si ese archivo ya tuviera el nombre definitivo, sería
#    indistinguible de uno bueno hasta el día que hay que restaurarlo.
# 2. **Se verifica antes de aceptarlo.** `gzip -t` sobre el resultado. Un dump
#    que no se puede ni descomprimir no es un backup.
#
# La retención borra sólo backups ya verificados: si el de hoy falló, los viejos
# se quedan.
set -eu

DIR=/backups
EVERY="${BACKUP_EVERY_SECONDS:-86400}"
KEEP="${BACKUP_KEEP:-14}"

mkdir -p "$DIR"

log() { echo "[backup $(date -u '+%Y-%m-%d %H:%M:%SZ')] $*"; }

# En un despliegue nuevo este servicio arranca apenas la base responde, que es
# *antes* de que el backend corra las migraciones. Sin esperar, el primer intento
# dumpea una base sin schema y grita un error que no es un error.
wait_for_schema() {
	waited=0
	while ! psql --quiet --tuples-only --command \
		"SELECT 1 FROM information_schema.tables WHERE table_name = 'alembic_version'" \
		2>/dev/null | grep -q 1; do
		[ "$waited" -eq 0 ] && log "esperando a que el backend cree el schema..."
		sleep 5
		waited=$(( waited + 5 ))
		if [ "$waited" -ge 600 ]; then
			log "ADVERTENCIA: 10 minutos sin schema. Sigo igual: una base vacía"
			log "             también hay que respaldarla si es lo que hay."
			return 0
		fi
	done
	[ "$waited" -gt 0 ] && log "schema listo tras ${waited}s"
	return 0
}

run_backup() {
	stamp=$(date -u '+%Y%m%dT%H%M%SZ')
	tmp="$DIR/.in-progress-$stamp.sql.gz"
	final="$DIR/${PGDATABASE}-$stamp.sql.gz"

	if ! pg_dump --format=plain --no-owner --no-privileges | gzip -9 >"$tmp"; then
		log "ERROR: pg_dump falló, no se deja archivo"
		rm -f "$tmp"
		return 1
	fi

	if ! gzip -t "$tmp" 2>/dev/null; then
		log "ERROR: el dump no pasa la verificación de integridad"
		rm -f "$tmp"
		return 1
	fi

	# Un dump de una base con datos no baja de unos pocos KB. Menos que eso es
	# casi siempre un dump de una base vacía por apuntar mal las credenciales.
	size=$(wc -c <"$tmp")
	if [ "$size" -lt 1024 ]; then
		log "ERROR: el dump pesa ${size} bytes — se descarta por sospechoso"
		rm -f "$tmp"
		return 1
	fi

	mv "$tmp" "$final"
	log "OK $(basename "$final") ($(( size / 1024 )) KB)"
}

prune() {
	# -1 para que ls dé una línea por archivo; el orden por nombre es el orden
	# cronológico porque el stamp es ISO.
	total=$(ls -1 "$DIR"/${PGDATABASE}-*.sql.gz 2>/dev/null | wc -l)
	[ "$total" -le "$KEEP" ] && return 0
	ls -1 "$DIR"/${PGDATABASE}-*.sql.gz | head -n $(( total - KEEP )) | while read -r old; do
		rm -f "$old"
		log "purgado $(basename "$old")"
	done
}

log "arranca — cada ${EVERY}s, guardando los últimos ${KEEP}"
wait_for_schema

while true; do
	if run_backup; then
		prune
	fi
	sleep "$EVERY"
done
