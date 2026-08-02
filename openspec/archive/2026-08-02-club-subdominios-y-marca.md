---
title: Una instancia por club — app genérica sobre Neon compartido, marca automática
type: feature
status: completed
spec: multi-tenant
created: 2026-07-29
updated: 2026-07-30
completed: 2026-08-02
---

# Una instancia por club — app genérica sobre Neon compartido, marca automática

## Descripción del Cambio

Hoy toda la app cuelga de **un dominio único**, un backend y un Postgres
propios ([[despliegue]]: "Un solo origen", un solo `db` en el compose). El
pedido es que cada club creado tenga su `{club}.dominio.com`, con su logo y
sus colores, y que el dominio principal quede reservado para crear
clubes — el socio ya entra directo al link del suyo.

**Decisión de arquitectura, confirmada el 30/07**: en vez de un backend
único que atiende a todos los clubes y resuelve "cuál es cuál" en cada
request, la app pasa a ser **genérica** — misma imagen Docker, mismo código —
y se **despliega una instancia por club**. Cada instancia se configura con
los datos de conexión a la base y con qué club es; su marca (logo, colores)
la resuelve **sola**, leyéndola de su propia fila en la base al arrancar.

Todas las instancias apuntan a **una sola base Postgres compartida en
Neon** (serverless, con pooling) — **no** una base por club. Es la misma
recomendación que ya estaba en la versión anterior de este documento, ahora
reforzada: no cambia qué tan aislados están los datos de un club respecto de
otro —eso lo sigue resolviendo `club_id`, como siempre—, cambia **cómo se
despliega y opera** cada club.

---

## Por qué una instancia por club y no un backend multi-tenant

La alternativa —un solo backend que lee el header `Host` y resuelve el club
en cada request— funciona, pero le suma al código una responsabilidad nueva
en cada endpoint: además de "¿tiene permiso?", "¿es realmente el club que
dice ser?". Con una instancia por club, esa pregunta **desaparece en vez de
resolverse**: la instancia de `clubequis.dominio.com` literalmente no tiene
forma de servir datos de otro club, porque arranca sabiendo cuál es el suyo y
cada consulta ya sale con ese `club_id` fijo. No hay un cruce que verificar
porque no hay otro club alcanzable desde ahí.

El costo es el inverso de lo que se gana en simpleza: **un proceso backend y
un proceso frontend por club**, en vez de uno compartido. Con la cantidad de
clubes que este producto tiene realmente hoy, es un costo chico; si el
producto llega a tener cientos de clubes, esto es lo primero que hay que
revisar (ver Riesgos).

---

## Qué preserva y qué cambia de la arquitectura actual

[[despliegue]] documenta "un solo origen, sin CORS": Caddy le saca el
prefijo `/api` antes de pasarlo al backend, y frontend y API comparten
dominio. **Se mantiene igual, por instancia**: `clubequis.dominio.com/`
sirve el frontend de esa instancia, `clubequis.dominio.com/api/*` su
backend, sin CORS.

Lo que cambia:

- **La base de datos deja de ser local al servidor** (`db` en el compose) y
  pasa a ser Neon, compartida por todas las instancias.
- **El ruteo por subdominio** ya no lo resuelve una consulta en cada
  request: lo resuelve **qué contenedor está corriendo**, vía etiquetas de
  Docker que Caddy lee solo (ver Infraestructura).
- **Las migraciones** dejan de aplicarse solas al arrancar cada backend —
  con una sola instancia tenía sentido; con N compartiendo una base, N
  arranques simultáneos corriendo `alembic upgrade head` a la vez es una
  carrera que hoy no existe.

---

## Modelo

```sql
clubs
+ logo_url          VARCHAR(300) NULL   -- S3, igual que profile_photo_url de Player
+ primary_color     VARCHAR(7) NULL     -- hex; NULL = usa el tema por defecto
+ secondary_color   VARCHAR(7) NULL
```

Sin tabla nueva: la marca es del club, y `clubs` —fila en la base
compartida— ya es donde vive `slug`. Cada instancia lee **su propia** fila;
el resto de la tabla (los otros clubes) existe en la misma base pero esa
instancia nunca la consulta.

**`slug` sigue necesitando reglas de formato**, porque además de
desambiguador de login pasa a ser nombre de host **y** nombre del stack de
Docker de ese club:

- Minúsculas, dígitos y guiones. Sin punto, sin empezar ni terminar en guión.
- Reservados que ningún club puede usar: `www`, `api`, `app`, `admin`,
  `mail`, `ftp` y el nombre que use el dominio principal.
- Los `slug` existentes se auditan al migrar; uno que no cumpla el formato
  nuevo se normaliza a mano, no en una migración automática — es dato de
  producción.

### Configuración por instancia (no es un modelo de datos — es entorno)

```bash
CLUB_SLUG=clubequis            # qué club es esta instancia
DATABASE_URL=postgresql+asyncpg://...-pooler.neon.tech/main?sslmode=require
DATABASE_URL_DIRECT=postgresql+asyncpg://...neon.tech/main?sslmode=require  # sólo Alembic
```

Todo lo demás —logo, colores, nombre— **no** se configura: la instancia lo
lee de `clubs WHERE slug = :CLUB_SLUG` al arrancar. Configurar la marca a
mano por instancia sería repetir, en variables de entorno, un dato que ya
está en la base — y que además el club edita desde la app, no desde un
archivo `.env` que hay que tocar y redesplegar.

---

## Cómo una instancia sabe quién es

Reemplaza la idea de "resolver tenant por request": acá se resuelve **una
vez, al arrancar**.

```python
@app.on_event("startup")
async def load_club_context():
    club = await get_club_by_slug(settings.CLUB_SLUG)
    if club is None or not club.is_active:
        raise RuntimeError(f"'{settings.CLUB_SLUG}' no es un club activo")
    app.state.club = club  # id, name, logo_url, colores — en memoria
```

- Si el `slug` configurado no existe o el club está inactivo, **la instancia
  no arranca**. Es preferible a arrancar y servir un 500 en el primer
  request: el error aparece en el log de despliegue, no en el celular de un
  socio.
- Todo lo que hoy resuelve `club_id` a partir del JWT del usuario **sigue
  igual** — no se toca `require_club_admin` ni el resto de [[permisos]].
  Lo que se agrega es una capa más abajo: el login de esta instancia
  **sólo busca usuarios con `club_id = app.state.club.id`**. Un DNI o email
  de otro club, aunque exista en la base compartida, no matchea acá — no
  porque se rechace explícitamente, sino porque la consulta nunca lo mira.
- `GET /public/club-branding` — sin autenticación, devuelve
  `app.state.club` tal cual quedó cacheado. No resuelve nada por request;
  es lectura de memoria.

### Lo que esto simplifica de la versión anterior de este documento

La versión anterior de este cambio cruzaba el `Host` del request contra el
`club_id` del JWT en cada endpoint, con un middleware nuevo y un `403`
explícito ante mismatch. Con una instancia por club **ese cruce no hace
falta**: no hay JWT de otro club que pueda llegar a validarse acá, porque el
login que lo emitió nunca pudo encontrar a ese usuario en esta base scopeada.
La frontera pasa de ser una verificación en tiempo de ejecución a ser una
propiedad de qué proceso está corriendo.

---

## Preparación para Neon

Esto es lo que hoy queda **decidido y a construir** — antes era una
recomendación contra una idea (base por club); ahora es la base compartida
real que corre en producción, y hay que dejar la app lista para sus
particularidades.

### Dos connection strings, no una

Neon separa el endpoint **pooled** (PgBouncer en modo transacción) del
**directo**:

- `DATABASE_URL` (pooled) — la usa el backend en runtime. Con N instancias
  cada una manteniendo su propio pool de conexiones contra la misma base,
  el pooler es lo que evita agotar el límite de conexiones directas de
  Neon a medida que se suman clubes. Con una sola instancia esto era
  opcional; con una por club deja de serlo.
- `DATABASE_URL_DIRECT` (sin pooler) — la usa **sólo** Alembic. Un pooler en
  modo transacción no sostiene las funciones de sesión que algunas
  migraciones necesitan (locks de advisory, `SET` de sesión); correr
  migraciones contra el endpoint pooled falla de formas confusas que no
  tienen que ver con la migración en sí.

`sslmode=require` en ambas: Neon lo exige, y hoy el `DATABASE_URL` local no
lo necesitaba.

### El pool de SQLAlchemy, más chico por instancia

Cada instancia sirve un club, típicamente con tráfico bajo. Mantener un
`pool_size` grande en cada una apila una capa de pooling encima de otra sin
necesidad — el pooler de Neon ya multiplexa entre todas las instancias del
lado del servidor. Un pool chico por instancia (o `NullPool` si el volumen es
bajo) alcanza y no compite innecesariamente por conexiones con el resto.

### Cold start

Neon serverless suspende el cómputo tras inactividad; el primer request
después de un rato sin tráfico paga unos cientos de milisegundos a un par de
segundos extra mientras el cómputo despierta. Es una característica del
plan, no un bug de esta implementación — se documenta de frente, igual que
la limitación de iOS Safari en [[add-notificaciones-push]]. Para un club
chico, con tráfico intermitente entre semana, es exactamente el patrón que
hace que aparezca.

### Migraciones: de "cada instancia se automigra" a "se corre una vez"

Hoy ([[despliegue]]) el backend corre `alembic upgrade head` solo al
arrancar — seguro con **un** backend. Con N instancias compartiendo la
misma base, si todas arrancan a la vez tras un release nuevo, todas
intentarían migrar a la vez contra la misma base. Las migraciones ya son
idempotentes ([[data-model]]: "chequean existencia antes de actuar"), así
que en la práctica probablemente no rompan nada — pero es una garantía que
no vale la pena depender de por las dudas, en vez de eliminar la carrera de
raíz.

**Se separa en dos pasos del script de despliegue**:
1. Un job de migración, **uno solo**, corre `alembic upgrade head` contra
   `DATABASE_URL_DIRECT` antes de tocar cualquier instancia de club.
2. Recién después, se actualizan (o se crean) las instancias, que arrancan
   asumiendo el schema ya al día — no vuelven a migrar.

---

## Infraestructura: ruteo por etiquetas, no por wildcard con `ask`

La versión anterior de este documento proponía un backend único con Caddy
wildcard + TLS on-demand + un endpoint `ask` que confirmaba si el slug era
válido. Con una instancia real por club, ese `ask` deja de hacer falta: **el
propio contenedor** declara su subdominio.

### `caddy-docker-proxy`

Un plugin de Caddy que arma la configuración de ruteo leyendo etiquetas de
Docker, sin editar `Caddyfile` a mano ni reiniciar Caddy al sumar un club:

```yaml
# docker-compose.<slug>.yml — generado por instancia, ver "Provisión" abajo
services:
  backend:
    image: match-analisis-backend:latest
    environment:
      CLUB_SLUG: clubequis
      DATABASE_URL: ${NEON_POOLED_URL}
    labels:
      caddy: clubequis.dominio.com
      caddy.handle_path: /api/*
      caddy.handle_path.reverse_proxy: "{{upstreams 8000}}"

  frontend:
    image: match-analisis-frontend:latest
    labels:
      caddy: clubequis.dominio.com
      caddy.reverse_proxy: "{{upstreams 80}}"
```

Caddy pide el certificado TLS con ACME estándar (HTTP-01) apenas ve la
etiqueta — **no** hace falta wildcard ni `ask`: el subdominio existe en la
configuración de Caddy únicamente si hay un contenedor real corriendo con
esa etiqueta. El vector de abuso que el `ask` cerraba en el diseño anterior
directamente no existe acá, porque no hay wildcard que emita certificados
para nombres que nadie declaró.

### DNS

Sigue siendo un único registro wildcard, `*.dominio.com → IP del servidor`
— sólo para que el nombre **resuelva**; la decisión de si hay algo real
detrás la toma Caddy mirando etiquetas, no el wildcard.

### Dominio principal

`dominio.com` (sin subdominio) sirve login de `superadmin` y el
aprovisionamiento de clubes nuevos — corre como **una instancia más**, sin
`CLUB_SLUG` (o con un modo especial de plataforma), separada de las
instancias de cada club.

---

## Provisión de un club nuevo

No automatizado de punta a punta en esta v1. Un script que corre el
operador de la plataforma:

```bash
./scripts/provision_club.sh clubequis "Club Equis"
```

1. Inserta la fila en `clubs` (contra `DATABASE_URL_DIRECT`, compartida).
2. Genera `docker-compose.clubequis.yml` desde una plantilla, con
   `CLUB_SLUG=clubequis`, el `DATABASE_URL` pooled compartido, y las
   etiquetas de Caddy.
3. `docker compose -f docker-compose.clubequis.yml up -d`.

El club queda alcanzable en `clubequis.dominio.com` en el tiempo que tarda
el contenedor en levantar más la emisión del certificado — minutos, no
instantáneo.

### Por qué no un botón de "crear club" que lo haga solo

Automatizar el paso 2 y 3 desde la propia app significa darle a un endpoint
acceso al socket de Docker del host —o a su API— para que pueda levantar
contenedores nuevos. Es un salto real de superficie de ataque: un bug o una
cuenta de `superadmin` comprometida en ese endpoint ya no significa acceso a
datos, significa control del host. [[despliegue]] ya tomó esta misma
posición para el despliegue en general ("Despliegue automático desde CI...
antes de tener a dónde desplegar es adivinar"): con la cantidad de clubes
que este producto tiene hoy, un script que el operador corre a mano es más
seguro que automatizarlo, y automatizarlo es la mejora obvia el día que el
ritmo de alta de clubes lo justifique.

---

## Frontend: una sola imagen, marca en runtime

**No** se compila un build por club — la misma imagen de frontend corre en
todas las instancias. Al cargar, pide `GET /public/club-branding` **a su
propio backend** (mismo origen, sin necesidad de decir para qué club es: la
instancia ya lo sabe) y aplica:

- `logo_url` en el header
- `primary_color` / `secondary_color` como variables CSS, con el tema
  actual (`#211E67`, [[architecture]]) como default si el club no configuró
  nada
- `name` en el `<title>` y como favicon si el club subió uno

Un club recién creado, sin configurar marca, se ve **exactamente** como
hoy — es opt-in, no un paso obligatorio para poder usar la app.

---

## Migración de clubes existentes

Dos movimientos, no uno:

1. **De Postgres self-hosted a Neon.** Un `pg_dump` del `db` actual
   restaurado en la base compartida de Neon — mismo tipo de operación que
   ya sabe hacer el runbook de [[despliegue]], sólo que el destino cambia.
   Se hace **una vez**, con el backend actual apagado durante la restauración
   (mismo cuidado que ya exige un restore hoy).
2. **De un backend único a una instancia por club.** Si hoy sólo hay un club
   en producción, este paso es levantar su `docker-compose.<slug>.yml` y
   apagar el compose viejo. Con más de un club ya corriendo al momento de
   este cambio, se migra club por club, y el dominio actual queda
   redirigiendo al último que falte migrar hasta que no quede ninguno.

**Es una pregunta operativa, no técnica, y depende de cuántos clubes estén
corriendo cuando esto se implemente** — igual que ya lo era en la versión
anterior de este documento.

---

## Fases de Implementación

### Fase A: Modelo
- [x] Migración: `clubs.logo_url`, `clubs.primary_color`, `clubs.secondary_color`
- [x] Validación de formato de `slug` (regex + reservados) en alta
      (no hay edición de slug — ver Decisiones Técnicas actualizado)
- [ ] Auditoría de los `slug` existentes, normalización manual si hace falta
      — no hecha: no ejecutada en este cambio, es un paso operativo sobre
      producción, no de código

### Fase B: La app sabe quién es
- [x] `CLUB_SLUG` en la configuración del backend
- [x] Carga de `app.state.club` al arrancar; falla el arranque si no existe
      o está inactivo — verificado también contra Postgres real en Docker,
      no sólo SQLite
- [x] Login scopeado a `club_id = app.state.club.id`, sin tocar el resto de
      [[permisos]]
- [x] `GET /public/club-branding`, sin autenticación, sirve desde memoria
- [x] Tests: instancia con `CLUB_SLUG` inexistente no arranca; un usuario de
      otro club no matchea en el login de esta instancia (14 tests nuevos,
      `tests/test_club_instance.py`)

### Fase C: Preparación para Neon
- [x] `DATABASE_URL` pooled para runtime, `DATABASE_URL_DIRECT` para Alembic
- [x] `sslmode=require` — documentado en `.env.platform.example` (va en la
      connection string, no necesita código)
- [x] `pool_size` conservador en el engine de SQLAlchemy
- [x] Job de migración separado del arranque de las instancias
      (`entrypoint.sh` + `SKIP_MIGRATIONS` + `migrate_shared_db.sh`)
- [ ] Verificar en un entorno real de Neon — **no hecho**: esta sesión no
      tiene una cuenta de Neon. Ver [[multi-tenant]], "Qué se verificó y
      qué no"

### Fase D: Infraestructura de ruteo
- [x] `caddy-docker-proxy` en el Caddy de la plataforma
      (`docker-compose.platform.yml`, `Caddyfile.platform`)
- [x] Plantilla de `docker-compose.<slug>.yml` con las etiquetas
- [ ] Registro DNS wildcard `*.dominio.com` — no aplica sin un dominio real
- [x] Verificar que `docker compose up` de **desarrollo** sigue funcionando
      igual que hoy: migró las 26 revisiones y arrancó como instancia de
      plataforma sin tocar nada

### Fase E: Frontend
- [x] `GET /public/club-branding` al cargar, antes de renderizar el layout
- [x] Variables CSS de marca con el tema actual como default
- [x] Favicon y `<title>` dinámicos, logo en el header — verificado con
      Playwright contra una instancia escopeada real (Postgres + Docker)

### Fase F: Provisión de un club nuevo
- [x] `backend/scripts/provision_club.sh`: alta vía `POST /clubs`,
      generación del compose, `up -d` — escrito, **no corrido** contra un
      Docker host/registro real
- [ ] Pantalla de `superadmin` para editar logo y colores de un club ya
      creado — el endpoint (`PATCH /clubs/{id}/branding`) está y tiene
      tests; la pantalla queda pendiente, no bloquea el resto del cambio

### Fase G: Migración de lo existente
- [ ] No ejecutada — es una decisión operativa que depende de cuántos
      clubes estén corriendo al momento del corte, documentada en
      [[multi-tenant]] pero deliberadamente no accionada acá

### Fase H: Documentación
- [x] `openspec/specs/multi-tenant.md`, con secciones explícitas de qué se
      verificó y qué no
- [x] Actualizar [[data-model]] con las columnas de marca
- [x] [[despliegue]]: forward-pointer a [[multi-tenant]], sin reescribir la
      sección vigente — `docker-compose.prod.yml` sigue siendo lo real

---

## Fuera de Alcance

| Qué | Por qué no |
|-----|-----------|
| **Base de datos por club en Neon** | Sigue descartado: el aislamiento ya lo da `club_id`, sin los costos de N bases (migraciones, backups, pools) que no cambian por desplegar una instancia por club |
| **Aprovisionamiento de club 100% self-service** | Requiere darle a la app acceso al socket de Docker del host; salto de superficie de ataque que no se justifica con la cantidad de clubes actual |
| **Orquestador (Kubernetes, Nomad) para escalar instancias automáticamente** | Un script y `docker compose` alcanzan al ritmo real de altas de clubes; se reevalúa si eso deja de ser cierto |
| **Landing de marketing en el dominio principal** | Es contenido, no arquitectura |
| **Dominios propios del club** (`clubequis.com.ar`) | Cada club administrando su propio DNS y certificado es un cambio mayor que un subdominio, y no se pidió |
| **Theming más allá de logo y dos colores** | No se pidió |

---

## Impacto en Código Existente

| Área | Impacto |
|------|---------|
| `backend/app/models/club.py` | Tres columnas nuevas |
| `backend/app/core/config.py` | `CLUB_SLUG`, `DATABASE_URL` (pooled), `DATABASE_URL_DIRECT` |
| `backend/app/main.py` | Carga de `app.state.club` al arrancar, falla si no existe |
| `backend/app/api/v1/auth.py` | Login scopeado a `app.state.club.id` |
| `backend/app/api/v1/public.py` | Nuevo — branding, sin auth, servido desde memoria |
| `backend/scripts/provision_club.sh` | Nuevo |
| `backend/scripts/migrate_shared_db.sh` | Nuevo — job de migración separado del arranque, envuelve `backend/migrate.py` existente |
| `backend/entrypoint.sh` | `SKIP_MIGRATIONS` — sin configurar, sigue migrando solo al arrancar |
| `docker-compose.club.yml.tmpl` | Nuevo — plantilla por club |
| `docker-compose.platform.yml`, `Caddyfile.platform` | Nuevos — **no** se tocó `docker-compose.prod.yml` ni `Caddyfile`, que siguen siendo el despliegue real |
| `frontend/src/App.tsx` | Fetch de branding antes del layout |
| `frontend/src/lib/branding.ts`, `frontend/src/store/brandingStore.ts` | Nuevos — aplican `--brand`, título, favicon; estado para el logo del header |
| `frontend/tailwind.config.ts`, `frontend/src/index.css` | `brand.*` pasa a derivarse de la variable CSS `--brand` con `color-mix()` |
| Base de datos | Sin cambios en este cambio — sigue en Postgres self-hosted. Neon es el destino preparado, no ejecutado (fase G) |

---

## Decisiones Técnicas

| Decisión | Elección | Razón |
|----------|----------|-------|
| Base de datos | Compartida en Neon, **no** una por club | El aislamiento ya lo da `club_id`; N bases multiplican migraciones, backups y pools sin necesidad |
| Despliegue | Una instancia (backend + frontend) por club, misma imagen genérica | Elimina la necesidad de resolver tenant por request; la frontera es qué proceso está corriendo |
| Conexión a Neon | Pooled para runtime, directa sólo para Alembic | Un pooler en modo transacción no sostiene lo que Alembic necesita; el runtime sí necesita el pooler con N instancias compartiendo la base |
| Migraciones | Job único, separado del arranque de cada instancia | N instancias automigrando a la vez contra la misma base es una carrera evitable |
| Ruteo | `caddy-docker-proxy` por etiquetas, no wildcard + `ask` | El subdominio existe en Caddy sólo si hay un contenedor real; cierra el vector de abuso sin necesitar un endpoint que lo module |
| Alta de club | Script del operador, no automatizado | Automatizarlo exige acceso al socket de Docker desde la app; no se justifica todavía |
| Marca | Runtime, leída por la propia instancia de su fila en Neon | Configurarla por variable de entorno duplicaría un dato que el club ya edita desde la app |

---

## Criterios de Aceptación

- [ ] Un club nuevo queda alcanzable en `{slug}.dominio.com` corriendo su
      propia instancia, tras el script de aprovisionamiento — **no
      verificado**: el script se escribió pero no se corrió contra un
      Docker host ni un dominio real
- [x] Una instancia con un `CLUB_SLUG` que no existe o está inactivo no
      arranca — verificado contra Postgres real en Docker (`RuntimeError`
      visible, proceso termina)
- [x] Ningún usuario puede autenticarse en la instancia de un club distinto
      al suyo — no por un chequeo que lo bloquea, sino porque el login de
      esa instancia no lo encuentra — verificado en vivo (admin del club
      correcto entra, `superadmin` recibe `401`) y con 14 tests
- [x] El logo y los colores configurados por un club se ven en su
      subdominio — verificado con Playwright (color `bg-brand` computado
      coincide con `primary_color`, logo carga). "Y en ningún otro" no se
      pudo probar con dos instancias corriendo a la vez en esta sesión
- [x] Un club sin marca configurada se ve exactamente como hoy —
      `applyClubBranding(null)` no toca nada; confirmado en la instancia de
      plataforma (`/public/club-branding` → `404`, sin efecto)
- [x] Las migraciones corren una sola vez por release, no una vez por
      instancia — mecanismo construido (`SKIP_MIGRATIONS`,
      `migrate_shared_db.sh`); no verificado con N instancias reales
      arrancando a la vez
- [ ] Alembic corre limpio contra el endpoint directo de Neon; el runtime
      usa el pooled sin agotar conexiones con varias instancias activas —
      **no verificado**: hace falta una cuenta de Neon
- [x] `docker compose up` de desarrollo sigue funcionando igual que hoy,
      sin Caddy, sin wildcard, sin Neon — verificado: migró la `0026` y
      arrancó como instancia de plataforma sin cambios de comportamiento

---

## Riesgos

| Riesgo | Mitigación |
|--------|-----------|
| **Un proceso por club multiplica el uso de RAM del servidor a medida que se suman clubes** | Aceptable a la escala actual; si deja de serlo, es la señal concreta para evaluar un orquestador — no antes |
| **N instancias migrando a la vez contra la base compartida** | Job de migración separado, corrido una sola vez antes de tocar las instancias |
| **Cold start de Neon sorprende al primer socio que entra tras horas sin tráfico** | Documentado de frente; el plan de Neon puede ajustarse (mantener el cómputo activo) si en uso real resulta molesto |
| **`DATABASE_URL` pooled es un secreto compartido repetido en N archivos `.env`** | Mismo tratamiento que `SECRET_KEY` hoy — un secreto por entorno; repetirlo en N instancias del mismo operador no es lo mismo que exponerlo a terceros |
| **Un `slug` mal formado rompe DNS, colisiona con una etiqueta de Caddy, o pisa una ruta de la plataforma** | Validación de formato + lista de reservados en alta. No hay edición de `slug` en el código (nunca la hubo) — cambiarlo sigue siendo una operación manual sobre la base, no una pantalla |
| **Se pierde la posibilidad de una consulta única "todos los clubes" para soporte** | Sigue existiendo: `DATABASE_URL_DIRECT` apunta a la misma base compartida; una consulta de plataforma corre contra ella igual que hoy, sólo que ninguna instancia de club individual la necesita |

---

## Relacionado

- [[add-portal-completo-roadmap]] — el programa; este es su cambio 5
- [[despliegue]] — "un solo origen" y el runbook de backups, que este cambio migra de Postgres self-hosted a Neon
- [[data-model]] — schema, y la idempotencia de las migraciones que hace segura la Fase C
- [[permisos]] — `superadmin` y el resto del modelo de capacidades, sin cambios
- [[socios]] — login por DNI/email, ahora scopeado por instancia en vez de por header
- [[add-notificaciones-push]] — precedente de documentar una limitación de la plataforma de frente (iOS Safari), igual que el cold start de Neon acá
- [[add-app-movil-react-native]] — consume `{slug}.dominio.com` igual que antes; no le cambia nada de este rediseño
- [[architecture]] — tema por defecto que la marca por club sobreescribe
