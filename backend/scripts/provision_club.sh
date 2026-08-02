#!/bin/sh
# Da de alta un club nuevo: fila en la base compartida + su propia instancia.
#
#   PLATFORM_URL=https://dominio.com \
#   SUPERADMIN_EMAIL=admin@dominio.com SUPERADMIN_PASSWORD=... \
#   ADMIN_EMAIL=admin@clubequis.com ADMIN_PASSWORD=... ADMIN_FULL_NAME="Nombre" \
#     ./backend/scripts/provision_club.sh "Club Equis" clubequis.dominio.com
#
# No automatizado de punta a punta a propósito: automatizar el paso 3 desde
# la propia app significaría darle a un endpoint acceso al socket de Docker
# del host. Es el operador quien lo corre a mano. Ver
# openspec/specs/multi-tenant.md.
#
# Tres pasos:
#   1. POST /clubs contra la instancia de PLATAFORMA (no una conexión directa
#      a la base — reusa toda la validación que ya existe: formato de slug,
#      reservados, alta del admin, siembra de roles).
#   2. Genera docker-compose.club.<slug>.yml desde la plantilla.
#   3. docker compose up -d — salvo que se pase --no-up, para poder revisar
#      el archivo generado antes de levantarlo.
#
# NO VERIFICADO CONTRA UN DESPLIEGUE REAL — ver
# openspec/specs/multi-tenant.md, "Qué se verificó y qué no".
set -eu

CLUB_NAME="${1:?uso: provision_club.sh <nombre del club> <dominio> [--no-up]}"
DOMAIN="${2:?uso: provision_club.sh <nombre del club> <dominio> [--no-up]}"
NO_UP="${3:-}"

: "${PLATFORM_URL:?falta PLATFORM_URL, ej: https://dominio.com}"
: "${SUPERADMIN_EMAIL:?falta SUPERADMIN_EMAIL}"
: "${SUPERADMIN_PASSWORD:?falta SUPERADMIN_PASSWORD}"
: "${ADMIN_EMAIL:?falta ADMIN_EMAIL — el admin del club nuevo}"
: "${ADMIN_PASSWORD:?falta ADMIN_PASSWORD}"
: "${ADMIN_FULL_NAME:?falta ADMIN_FULL_NAME}"

REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"

command -v curl >/dev/null || { echo "Hace falta curl." >&2; exit 1; }
command -v python3 >/dev/null || { echo "Hace falta python3 (para leer el JSON de la respuesta)." >&2; exit 1; }

echo "Pidiendo token de superadmin..."
token=$(
	curl -sf -X POST "$PLATFORM_URL/auth/login" \
		-H 'Content-Type: application/json' \
		-d "{\"email\":\"$SUPERADMIN_EMAIL\",\"password\":\"$SUPERADMIN_PASSWORD\"}" \
	| python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])'
) || { echo "No se pudo loguear como superadmin en $PLATFORM_URL" >&2; exit 1; }

echo "Creando el club \"$CLUB_NAME\"..."
response=$(
	curl -sf -X POST "$PLATFORM_URL/clubs" \
		-H "Authorization: Bearer $token" \
		-H 'Content-Type: application/json' \
		-d "{\"name\":\"$CLUB_NAME\",\"admin_email\":\"$ADMIN_EMAIL\",\"admin_password\":\"$ADMIN_PASSWORD\",\"admin_full_name\":\"$ADMIN_FULL_NAME\"}"
) || { echo "Falló POST /clubs — ¿nombre repetido, o slug reservado?" >&2; exit 1; }

slug=$(printf '%s' "$response" | python3 -c 'import json,sys; print(json.load(sys.stdin)["slug"])')
echo "Club creado: slug=\"$slug\""

# ── Genera el compose del club a partir de la plantilla ─────────────────────
target="$REPO_ROOT/docker-compose.club.$slug.yml"
if [ -f "$target" ]; then
	echo "Ya existe $target — no se pisa. Revisalo a mano si hace falta regenerarlo." >&2
	exit 1
fi

sed -e "s/{{SLUG}}/$slug/g" -e "s/{{DOMAIN}}/$DOMAIN/g" \
	"$REPO_ROOT/docker-compose.club.yml.tmpl" >"$target"
echo "Generado: $target"

if [ "$NO_UP" = "--no-up" ]; then
	echo "Con --no-up: no se levantó el contenedor. Revisá $target y corré:"
	echo "  docker compose -f $target --env-file .env.platform up -d --build"
	exit 0
fi

echo "Levantando la instancia de \"$slug\"..."
(cd "$REPO_ROOT" && docker compose -f "$target" --env-file .env.platform up -d --build)

echo ""
echo "Listo. $CLUB_NAME va a quedar alcanzable en https://$DOMAIN"
echo "(unos minutos, mientras el contenedor levanta y Caddy emite el certificado)."
