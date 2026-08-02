---
title: Una instancia por club
status: active
created: 2026-08-02
---

# Una instancia por club

> Refleja lo implementado en `core/club_context.py`, `api/v1/public.py`,
> `api/v1/auth.py` (login scopeado), `api/v1/clubs.py` (slug y marca), la
> migración `0026`, y los artefactos de infraestructura descritos abajo.
>
> **Todavía no es lo que corre en producción.** [[despliegue]] —
> `docker-compose.prod.yml`, una base Postgres propia, un solo backend—
> sigue siendo el despliegue real hasta que se decida el corte (ver
> "Migración de lo existente", más abajo). Este documento describe lo que
> ya está construido y lo que falta para cortar.

## La decisión

Hoy toda la app cuelga de un dominio único, un backend y un Postgres
propios. El pedido: cada club creado tiene su `{club}.dominio.com`, con su
logo y sus colores.

En vez de un backend único que lee el header `Host` y resuelve "cuál es el
club" en cada request, la app pasa a ser **genérica** —misma imagen, mismo
código— y se **despliega una instancia por club**. Cada instancia se
configura con `CLUB_SLUG` y resuelve su marca sola, leyéndola de su propia
fila en una base **Postgres compartida en Neon** (serverless, con pooling)
— **no** una base por club. El aislamiento entre clubes lo sigue dando
`club_id`, como siempre; lo que cambia es cómo se despliega y opera cada
club.

### Por qué no un chequeo de `Host` contra el JWT

La alternativa —comparar el `Host` del request contra el `club_id` del
JWT en cada endpoint— funciona, pero le agrega a cada ruta una pregunta
nueva. Con una instancia por club, la pregunta **desaparece en vez de
resolverse**: la instancia de `clubequis.dominio.com` no tiene forma de
servir datos de otro club porque arranca sabiendo cuál es el suyo. La
frontera pasa de ser una verificación en tiempo de ejecución a ser una
propiedad de qué proceso está corriendo.

## Cómo una instancia sabe quién es

Se resuelve **una vez, al arrancar** — `core/club_context.py`,
`load_club_context()`, llamado primero que nada en el `lifespan` de
`main.py`:

```python
async def load_club_context(app: FastAPI) -> None:
    if not settings.CLUB_SLUG:
        app.state.club = None   # instancia de plataforma
        return
    club = await session.scalar(select(Club).where(Club.slug == settings.CLUB_SLUG))
    if club is None or not club.is_active:
        raise RuntimeError(...)   # la instancia NO arranca
    app.state.club = club
```

- **Sin `CLUB_SLUG`**: instancia de **plataforma** — login de `superadmin`,
  alta de clubes (`POST /clubs`). `app.state.club` queda en `None`.
- **Con `CLUB_SLUG` inválido o de un club inactivo**: la instancia no
  arranca. Preferible a arrancar y servir un 500 en el primer request — el
  error aparece en el log de despliegue, no en el celular de un socio.
- El cliente de test (`ASGITransport`, en `tests/conftest.py`) **no corre
  `lifespan`** — por eso `app.state.club = None` también se fija como
  default explícito al crear `app` en `main.py`, y los tests que necesitan
  una instancia escopeada llaman `load_club_context()` a mano o pisan
  `app.state.club` directo.

## Login scopeado

`_resolve_login()` en `api/v1/auth.py` recibe `app.state.club` (vía
`request.app.state.club`) y, si no es `None`, agrega
`.where(User.club_id == instance_club.id)` a la consulta por email o DNI —
**no** rechaza explícitamente a un usuario de otro club: la consulta nunca
lo mira.

Con eso, la disambiguación por `club_slug` que ya existía en
`LoginRequest` (para el caso de un DNI que coincide en dos clubes) pasa a
usarse **sólo** en la instancia de plataforma: en una instancia por club,
un DNI nunca puede resolver a más de un club ahí adentro, así que la
pregunta no se llega a hacer.

`superadmin` tiene `club_id = NULL`: en una instancia escopeada, la
condición `club_id == instance_club.id` nunca matchea, así que
**no puede loguearse** en la instancia de ningún club — sólo en la de
plataforma. Es intencional: crear clubes es una capacidad de la
plataforma, no de un club (ver [[permisos]], "`superadmin` queda afuera").

## Marca del club

```sql
clubs
+ logo_url          VARCHAR(300) NULL   -- S3, igual que Player.profile_photo_url
+ primary_color     VARCHAR(7) NULL     -- hex; NULL = tema por defecto
+ secondary_color   VARCHAR(7) NULL
```

Sin tabla nueva: la marca es del club, y `clubs` ya es donde vive `slug`.

- `PATCH /clubs/{id}/branding` — sólo `superadmin`. Edita logo y colores,
  **no** el slug: crear el club sigue siendo el único momento en que el
  slug se fija, porque es nombre de host y de stack de Docker — cambiarlo
  en caliente es un cambio de infraestructura, no una edición de marca.
- `GET /public/club-branding` — sin autenticación, devuelve
  `app.state.club` **tal cual quedó cacheado al arrancar**. No resuelve
  nada por request; es lectura de memoria.

  **Consecuencia verificada en vivo**: editar la marca de un club con
  `PATCH /clubs/{id}/branding` no se refleja hasta que **esa instancia se
  reinicia**. No es un bug — es la misma decisión de "una vez al arrancar"
  que evita una consulta a la base en cada carga del frontend. Un
  superadmin que cambia el logo de un club tiene que reiniciar (o
  redesplegar) la instancia de ese club para que se vea. Documentado acá
  para que no se redescubra como bug.

### `slug`: formato y reservados

`slug` ya no es sólo desambiguador de login: es nombre de host y de stack
de Docker. `_validate_slug()` en `api/v1/clubs.py`, aplicada en
`POST /clubs`:

- Minúsculas, dígitos y guiones; sin empezar ni terminar en guión
  (`_slugify` ya lo garantiza, pero se valida igual por si el criterio de
  generación cambia).
- Reservados que ningún club puede usar: `www`, `api`, `app`, `admin`,
  `mail`, `ftp`.

### Frontend: marca en runtime, una sola imagen

`lib/branding.ts` (`fetchClubBranding` + `applyClubBranding`) corre en
`App.tsx` antes de renderizar cualquier ruta:

- `primary_color` pisa la variable CSS `--brand` (definida en
  `index.css`, default `#211e67`). `tailwind.config.ts` deriva
  `brand.hover/soft/ring` de esa única variable con `color-mix()` en vez
  de guardar un tono por variable — un club que personaliza su marca
  cambia **un** color, no cuatro.
- `secondary_color` pisa `--club-secondary` (hoy sin un uso fijo en la UI
  — theming más allá de logo y dos colores no se pidió, ver "Fuera de
  alcance").
- `name` va al `<title>` y reemplaza "Rugby Analisis" en el header de
  `Layout.tsx` (barra lateral, cajón de teléfono, encabezado de teléfono).
- `logo_url` se pinta en el header (junto al nombre) y como favicon.
- Sin marca configurada (instancia de plataforma, o un club que no subió
  nada), `applyClubBranding(null)` no toca nada — se ve exactamente como
  hoy. Es opt-in.

El estado vive en un store de Zustand chico, `store/brandingStore.ts` —
sólo lo que `Layout.tsx` necesita para pintar el logo; `--brand`, título y
favicon los aplica `lib/branding.ts` directo al DOM, sin pasar por React.

## Preparación para Neon

Construido y **no verificado contra una Neon real** (ver "Qué se verificó
y qué no"):

- **Dos connection strings**: `DATABASE_URL` (pooled, runtime) y
  `DATABASE_URL_DIRECT` (sin pooler, sólo Alembic — un pooler en modo
  transacción no sostiene locks de advisory ni `SET` de sesión).
  `alembic/env.py` usa `DATABASE_URL_DIRECT or DATABASE_URL`; sin
  configurar, se comporta como siempre.
- **Pool conservador por instancia**: `DB_POOL_SIZE` / `DB_MAX_OVERFLOW`
  (default 5/5) en `core/database.py`. SQLite (tests, dev sin Postgres) no
  recibe estos kwargs — no los acepta.
- **Migración separada del arranque**: `entrypoint.sh` respeta
  `SKIP_MIGRATIONS=true`. Sin configurar, cada instancia migra sola al
  arrancar — el comportamiento de siempre, correcto con un solo backend.
  Con N instancias por club compartiendo una base, todas migrando a la vez
  tras un release es una carrera evitable; el compose por club (abajo) fija
  `SKIP_MIGRATIONS=true` y la migración pasa a ser
  `backend/scripts/migrate_shared_db.sh`, corrido **una sola vez** antes de
  tocar cualquier instancia.

## Infraestructura de ruteo

`caddy-docker-proxy` en vez de un Caddyfile estático con 19 rutas: arma la
configuración leyendo etiquetas `caddy.*` de los contenedores en marcha, de
la instancia de plataforma y de cada club. El subdominio de un club existe
en Caddy únicamente si hay un contenedor real corriendo con esa etiqueta —
sin wildcard, sin un endpoint `ask` que confirme si un slug es válido.

Artefactos nuevos:

```
docker-compose.platform.yml    -- Caddy (docker-proxy) + instancia de plataforma
Caddyfile.platform             -- opciones globales + snippet (common) de headers/logging
docker-compose.club.yml.tmpl   -- plantilla por club; provision_club.sh la instancia
backend/scripts/provision_club.sh      -- alta de club: POST /clubs + genera el compose + up
backend/scripts/migrate_shared_db.sh   -- migración única contra DATABASE_URL_DIRECT
.env.platform.example          -- variables compartidas por todas las instancias
```

`docker-compose.prod.yml` y `Caddyfile` (el estático, de rutas fijas)
**no se tocaron** — siguen siendo el despliegue real. Estos son artefactos
paralelos para cuando se decida cortar.

### DNS y dominio principal

Un único registro wildcard `*.dominio.com → IP del servidor` — sólo para
que el nombre resuelva; la decisión de si hay algo real detrás la toma
Caddy mirando etiquetas. `dominio.com` (sin subdominio) es la instancia de
plataforma.

### Provisión de un club nuevo

```sh
PLATFORM_URL=https://dominio.com \
SUPERADMIN_EMAIL=... SUPERADMIN_PASSWORD=... \
ADMIN_EMAIL=admin@clubequis.com ADMIN_PASSWORD=... ADMIN_FULL_NAME="..." \
  ./backend/scripts/provision_club.sh "Club Equis" clubequis.dominio.com
```

Tres pasos: `POST /clubs` contra la instancia de plataforma (reusa toda la
validación existente — formato de slug, reservados, alta del admin, siembra
de roles), genera `docker-compose.club.<slug>.yml` desde la plantilla, y
`docker compose up -d`.

**No automatizado de punta a punta a propósito.** Un botón de "crear club"
que levante el contenedor por su cuenta significa darle a un endpoint
acceso al socket de Docker del host — un salto de superficie de ataque que
no se justifica con la cantidad de clubes actual. Lo corre el operador a
mano.

## Qué se verificó y qué no

Contra una instancia real de Postgres en Docker (no SQLite, no Neon):

- Una instancia con `CLUB_SLUG` de un club válido arranca, sirve
  `GET /public/club-branding` con los datos correctos, y el login sólo
  encuentra usuarios de ese club (el admin del club entra; `superadmin`
  recibe `401`).
- Una instancia con `CLUB_SLUG` desconocido **no arranca** — `RuntimeError`
  visible en el log, el proceso termina.
- Editar la marca vía `PATCH /clubs/{id}/branding` no se refleja hasta
  reiniciar la instancia (comportamiento esperado, no bug — ver arriba).
- El frontend, apuntado a una instancia escopeada, aplica `--brand`, el
  `<title>`, el logo y el nombre en el header — confirmado con Playwright:
  color computado de un elemento `bg-brand` coincidiendo con el
  `primary_color` configurado, logo cargado (`naturalWidth` > 0), cero
  errores de consola.
- `docker compose -f docker-compose.yml up` (desarrollo, sin tocar) sigue
  funcionando igual: migró las 26 revisiones —incluida la `0026` de este
  cambio— y arrancó sin `CLUB_SLUG` como la instancia de plataforma de
  siempre.

**No verificado — hace falta infraestructura real que esta sesión no
tiene**:

- `docker-compose.platform.yml`, `Caddyfile.platform` y
  `docker-compose.club.yml.tmpl` no se levantaron: verificar
  `caddy-docker-proxy` de verdad necesita un dominio público (emisión de
  certificado, igual que ya quedó pendiente en [[despliegue]]) y probar dos
  o más instancias de club coexistiendo detrás del mismo Caddy.
- `backend/scripts/provision_club.sh` y
  `backend/scripts/migrate_shared_db.sh` no se corrieron contra un Docker
  host ni un registro de imágenes real.
- Nada contra una base Neon real: el pool pooled/directo, `sslmode`, y el
  cold start están construidos según la documentación de Neon, no medidos.

## Fuera de alcance

| Qué | Por qué no |
|-----|-----------|
| **Base de datos por club** | El aislamiento ya lo da `club_id`; N bases multiplican migraciones, backups y pools sin necesidad |
| **Aprovisionamiento 100% self-service** | Exige acceso al socket de Docker desde la app; no se justifica con la cantidad de clubes actual |
| **Theming más allá de logo y dos colores** | No se pidió |
| **Dominios propios del club** (`clubequis.com.ar`) | Cada club administrando su propio DNS y certificado es un cambio mayor que un subdominio |
| **Migración de los clubes que ya existen a este modelo** | Ver abajo — depende de cuántos haya al momento del corte, es una decisión operativa, no de código |

## Migración de lo existente

No ejecutada en este cambio — es una pregunta operativa, no técnica, y
depende de cuántos clubes estén corriendo cuando se decida el corte:

1. `pg_dump` del `db` de `docker-compose.prod.yml`, restaurado en Neon —
   mismo tipo de operación que el runbook de [[despliegue]] ya sabe hacer,
   con el backend apagado durante la restauración.
2. Levantar `docker-compose.platform.yml` + un `docker-compose.club.yml`
   por cada club existente, apagar `docker-compose.prod.yml`.

Hasta que esto se decida y se ejecute a mano, **`docker-compose.prod.yml`
sigue siendo la fuente de verdad de producción**.

## Relacionado

- [[add-club-subdominios-y-marca]] — la propuesta, cambio 5 de [[add-portal-completo-roadmap]]
- [[despliegue]] — el despliegue que sigue corriendo hoy; "un solo origen" se preserva por instancia
- [[permisos]] — `superadmin` fuera del sistema de capacidades, sin cambios; por qué no puede loguearse en una instancia escopeada
- [[data-model]] — columnas de marca en `clubs`
- [[architecture]] — tema por defecto que la marca por club sobreescribe
- [[add-app-movil-react-native]] — consume `{slug}.dominio.com` igual que hoy; no le cambia nada de este diseño
