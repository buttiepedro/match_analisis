---
title: Subdominio por club y marca propia — con decisión pendiente sobre base de datos
type: feature
status: proposed
spec: despliegue
created: 2026-07-29
---

# Subdominio por club y marca propia

## Descripción del Cambio

Hoy toda la app cuelga de **un dominio único** ([[despliegue]]: "Un solo
origen"). Un club nuevo se crea y sus socios entran por la misma URL que
cualquier otro, distinguidos por login. El pedido es que cada club creado
obtenga automáticamente `{club}.dominio.com`, con su logo y sus colores, y que
el dominio principal quede reservado para crear clubes — el socio ya entra
directo al link del suyo.

Este cambio tiene **dos partes de tamaño muy distinto**:

1. **Subdominio y marca** (este documento, con fases listas para ejecutar).
2. **Si conviene una base de datos por club en Neon** — el roadmap la pidió
   evaluada explícitamente. Trae una **recomendación**, no una implementación:
   ver la sección dedicada antes de las fases. Nada de este cambio depende de
   esa decisión — se puede subdominizar sin tocar la base de datos.

---

## Qué preserva y qué rompe de la arquitectura actual

[[despliegue]] documenta una decisión que vale la pena proteger: **un solo
origen, sin CORS**, porque Caddy le saca el prefijo `/api` antes de pasarlo al
backend, y frontend y API comparten dominio. Ese diseño **se mantiene
intacto por subdominio**: `nuevoclub.dominio.com/` sirve el frontend,
`nuevoclub.dominio.com/api/*` la API, sin CORS — el wildcard no obliga a romper
esa propiedad, sólo agrega una capa de resolución de *cuál* club es antes de
todo lo demás.

Lo que sí cambia:

- **Cómo se resuelve el club de un request.** Hoy es implícito en el JWT del
  usuario. De acá en más, el `Host` header dice qué club **espera** ver el
  request, y eso se valida contra el club del JWT — no lo reemplaza, lo cruza.
- **Cómo se sirve la marca.** Hoy hay un tema único (`#211E67` / `#FF1B20`,
  [[architecture]]). Pasa a resolverse en runtime por club.
- **TLS deja de ser un certificado, pasa a ser uno por subdominio** (ver Fase C).

---

## Modelo

```sql
clubs
+ logo_url          VARCHAR(300) NULL   -- S3, igual que profile_photo_url de Player
+ primary_color     VARCHAR(7) NULL     -- hex; NULL = usa el tema por defecto
+ secondary_color   VARCHAR(7) NULL
```

Sin tabla nueva: la marca es del club, y `clubs` ya es donde vive `slug`.

**`slug` pasa a tener reglas de formato** que hoy no tiene, porque hoy es sólo un
desambiguador de login y a partir de este cambio es un nombre de host:

- Minúsculas, dígitos y guiones. Sin punto, sin empezar ni terminar en guión.
- Lista de reservados que no se pueden usar como `slug` de un club:
  `www`, `api`, `app`, `admin`, `mail`, `ftp` y el propio nombre que use el
  dominio principal (`main`, si se lo llama así). Un club nuevo no puede
  pisar una ruta de la plataforma.
- Los clubes existentes se validan al migrar; uno con un `slug` que no cumple
  el formato nuevo (mayúsculas, espacios) se normaliza una vez, a mano, no en
  la migración automática — es dato de producción y una normalización
  automática puede generar colisiones que nadie previó.

---

## Resolución de tenant

Middleware nuevo, antes de cualquier router:

```python
async def resolve_tenant(request: Request, call_next):
    host = request.headers.get("host", "")
    subdomain = extract_subdomain(host, settings.APP_DOMAIN)
    request.state.club_slug = subdomain  # None en el dominio principal
    return await call_next(request)
```

- **Endpoints que dependen de un club** (casi todos) leen `request.state.club_slug`,
  resuelven el `Club` y lo comparan contra `current_user.club_id`. Si no
  coinciden, `403` — un token de un club no sirve en el subdominio de otro. Es
  el mismo espíritu que el `409` de DNI ambiguo en [[socios]], pero acá el error
  es un intento de cruce entre clubes, no una ambigüedad legítima.
- **Endpoints de plataforma** (crear club, `superadmin`) no dependen del
  subdominio: `users.role == superadmin` ya salta todo chequeo de capacidad
  según [[permisos]], y sigue siendo así.
- `GET /public/club-branding` — **sin autenticación**, resuelve por
  `request.state.club_slug` y devuelve `{name, logo_url, primary_color,
  secondary_color}`. Es lo que el frontend pide antes de mostrar nada.

### Por qué el JWT no alcanza solo

Si el club se resolviera **únicamente** por el JWT (como hoy) y el subdominio
fuera cosmético, un socio de un club vería la marca de otro con sólo cambiar la
URL, y el subdominio dejaría de ser una frontera real. Cruzarlo contra el JWT es
lo que lo convierte en control de acceso y no en decoración.

---

## Infraestructura

### DNS

Un único registro wildcard, `*.dominio.com → IP del servidor`. Crear un club no
toca DNS — el wildcard ya cubre cualquier `slug` futuro.

### TLS: on-demand, no wildcard

Un certificado wildcard (`*.dominio.com`) exige validación **DNS-01**, que
depende de que el proveedor de DNS tenga API (Cloudflare, Route53) y de darle a
Caddy credenciales para escribir registros TXT — una dependencia externa nueva
que hoy no existe.

**Se recomienda TLS on-demand en su lugar**: Caddy emite un certificado
individual la primera vez que alguien pide un subdominio, vía HTTP-01, sin
necesitar wildcard ni credenciales de DNS. El riesgo de on-demand TLS —que
cualquiera pida un subdominio inexistente y agote el rate limit de Let's
Encrypt— se cierra con el `ask` de Caddy: antes de emitir, le pregunta al
backend si ese `slug` es un club activo.

```caddyfile
*.dominio.com {
	tls {
		on_demand
	}
	handle_path /api/* {
		reverse_proxy backend:8000
	}
	handle {
		reverse_proxy frontend:80
	}
}

# Endpoint interno que Caddy consulta antes de emitir cada certificado
tls.on_demand.ask http://backend:8000/internal/valid-clubs?domain={query.domain}
```

`GET /internal/valid-clubs` sólo responde `200` si el subdominio pedido
corresponde a un `club.is_active = true`; cualquier otro caso, `404`. Sin este
`ask`, on-demand TLS es un vector de abuso conocido — con él, es exactamente la
misma garantía que un wildcard, sin la dependencia de un proveedor de DNS con
API.

Costo del lado de: cada club nuevo dispara una emisión de certificado la
primera vez que alguien entra — unos segundos, una sola vez, y Let's Encrypt
permite 50 certificados por dominio registrable por semana, que alcanza de
sobra al ritmo real de altas de clubes.

### Dominio principal

`dominio.com` (sin subdominio) sirve **sólo**: login de `superadmin`, alta de
clubes, y un buscador de "¿cuál es mi club?" por DNI para quien perdió el link
— reusa el `409` con lista de clubes que [[socios]] ya resuelve en el login.
No es una landing de marketing nueva; eso es contenido, no ingeniería, y queda
fuera de este cambio.

---

## Frontend: una sola build, marca en runtime

**No** se compila un build por club — no escala a "cada vez que se crea un
club". Al cargar, el frontend pide `GET /public/club-branding` y aplica:

- `logo_url` en el header
- `primary_color` / `secondary_color` como variables CSS (`--brand`, ...),
  con el tema actual (`#211E67`, [[architecture]]) como default si el club no
  configuró nada
- `name` en el `<title>` y como `favicon` si el club subió uno

Un club recién creado, sin configurar nada, se ve **exactamente** como hoy —
la marca es opt-in, no una pantalla más que hay que completar para poder usar
la app.

---

## Migración de clubes existentes

El `slug` ya es único por club, así que **no hace falta reasignar nada** — cada
club existente ya tiene el nombre que va a usar como subdominio. Lo que cambia
es el link que sus socios usan para entrar.

Mientras dure la transición, el dominio actual (sin subdominio) puede seguir
resolviendo al club existente si hoy sólo hay uno en producción — evita
romper links ya compartidos por WhatsApp el mismo día del despliegue. Con más
de un club en producción al momento de este cambio, hace falta decidir a mano
qué pasa con el dominio pelado (redirect a un club por defecto, o página de
selección) — **es una pregunta operativa, no técnica, y depende de cuántos
clubes estén corriendo cuando esto se implemente**.

---

## Decisión pendiente: ¿base de datos por club en Neon?

El roadmap ofreció una API key de Neon para crear una base por club
automáticamente. Antes de construir eso, vale la pena decir con qué se
compara.

### Cómo es hoy

Multi-tenant de **schema compartido**: una sola base, cada tabla llega al
club por `club_id` (o lo deriva de `division_id`). Es el patrón que atraviesa
todo [[data-model]] y que [[despliegue]] ya sabe respaldar, migrar y
restaurar con un runbook probado.

### Qué cuesta una base por club

| Área | Hoy (schema compartido) | Con una base por club |
|------|--------------------------|------------------------|
| **Migraciones** | `alembic upgrade head` una vez, al arrancar | La misma migración corre contra **N** bases; una que falla a mitad de un despliegue deja al club 47 en una versión de schema distinta a los otros 46 |
| **Conexión** | Un `DATABASE_URL`, un pool | El backend necesita resolver, por request, a qué base conectarse — un router de conexión que hoy no existe, y N pools en vez de uno |
| **Backups** | Un `pg_dump`, una política de retención ([[despliegue]]) | N backups, N restauraciones a probar; el runbook actual no generaliza solo |
| **Alta de club** | Un `INSERT` | Alta de club **depende de que la API de Neon responda** — un fallo de red externo ahora puede bloquear crear un club |
| **Secretos** | Uno (`DATABASE_URL` en `.env`) | Un connection string por club, que hay que guardar cifrado en algún lado — y ese "algún lado" es, otra vez, una base compartida: el problema no desaparece, se duplica |
| **Consultas de plataforma** (listar clubes, soporte a `superadmin`) | Una query | Necesitan un **registro central** de qué base corresponde a qué club — que es exactamente el problema que el schema compartido ya resuelve hoy |

### Recomendación

**No** provisionar una base de Neon por club de forma automática. El schema
compartido ya resuelve el aislamiento que hace falta hoy —ningún club ve datos
de otro, en cada tabla y cada query— sin ninguno de los costos de la tabla de
arriba. Nada en el pedido señala un motivo real para pagarlos: no hay requisito
de compliance, ni un cliente que exija sus datos físicamente separados, ni un
plan de exportar la base de un club de forma independiente.

**Dónde sí tiene sentido Neon**: como herramienta de *desarrollo*, no de
*multi-tenancy* — una rama de base (branch) por PR o por entorno de prueba,
que Neon hace barato y rápido, para probar migraciones antes de que lleguen a
producción. Es una mejora real, pero es un cambio de flujo de CI, no de
arquitectura de datos, y es un documento aparte si se decide perseguirlo.

**Cuándo reconsiderar esto**: si en el futuro un club puntual necesita
aislamiento fuerte por un motivo concreto (un contrato, una ley), la salida es
migrar **ese club, a mano, una vez** — no construir el mecanismo automático
para todos desde el día uno a cambio de un problema que hoy nadie tiene.

Esta sección **no** se traduce en fases: es la respuesta a la pregunta, no una
tarea. Si el club decide lo contrario después de leer esto, es un cambio nuevo,
con su propio documento — no una fase agregada acá.

---

## Fases de Implementación

> Todas asumen la base de datos compartida actual — ninguna depende de la
> decisión de Neon de arriba.

### Fase A: Modelo
- [ ] Migración: `clubs.logo_url`, `clubs.primary_color`, `clubs.secondary_color`
- [ ] Validación de formato de `slug` (regex + lista de reservados) en alta y edición de club
- [ ] Auditoría de los `slug` existentes contra el formato nuevo, normalización manual si hace falta

### Fase B: Resolución de tenant
- [ ] Middleware `resolve_tenant`, extrae subdominio de `Host`
- [ ] Cruce contra `current_user.club_id` en los endpoints autenticados; `403` ante mismatch
- [ ] `GET /public/club-branding`, sin autenticación
- [ ] `GET /internal/valid-clubs`, sólo para el `ask` de Caddy — no expuesto fuera de la red interna de compose
- [ ] Tests: token de un club en el subdominio de otro → `403`; subdominio inexistente → `404` antes de llegar a ningún router de negocio

### Fase C: Infraestructura
- [ ] Registro DNS wildcard `*.dominio.com`
- [ ] `Caddyfile` con bloque wildcard, `tls on_demand` y `ask` apuntando a `/internal/valid-clubs`
- [ ] Verificar que `docker compose up` sigue funcionando en desarrollo sin wildcard (un solo host, como hoy)

### Fase D: Frontend
- [ ] `GET /public/club-branding` al cargar, antes de renderizar el layout
- [ ] Variables CSS de marca con el tema actual como default
- [ ] Favicon y `<title>` dinámicos

### Fase E: Alta de club
- [ ] Pantalla de `superadmin` para subir logo y elegir colores al crear o editar un club
- [ ] El club queda alcanzable en su subdominio inmediatamente después del alta (primer request dispara la emisión del certificado)

### Fase F: Migración de clubes existentes
- [ ] Confirmar con el club cuántos clubes hay en producción al momento de implementar esto (determina si el dominio pelado redirige a uno solo o necesita selector)
- [ ] Comunicar el link nuevo a los socios existentes

### Fase G: Documentación
- [ ] Actualizar [[despliegue]] con la sección de TLS on-demand y el `ask`
- [ ] Actualizar [[data-model]] con las columnas de marca
- [ ] `openspec/specs/multi-tenant.md`

---

## Fuera de Alcance

| Qué | Por qué no |
|-----|-----------|
| **Base de datos por club en Neon** | Ver "Decisión pendiente" arriba — recomendación en contra, no implementada |
| **Landing de marketing en el dominio principal** | Es contenido, no arquitectura; el dominio principal de este cambio sólo resuelve alta de club y soporte |
| **Dominios propios del club** (`clubequis.com.ar` en vez de `clubequis.dominio.com`) | Requiere que cada club administre su propio DNS y certificado; es un cambio de infraestructura mayor que un subdominio, y no se pidió |
| **Theming más allá de logo y dos colores** (tipografía, layout) | No se pidió; dos colores y un logo son lo que "personalización de logos, colores" describe |
| **Migrar clubes existentes a una base separada** | Consecuencia directa de la recomendación en contra de Neon-por-club |

---

## Impacto en Código Existente

| Área | Impacto |
|------|---------|
| `backend/app/models/club.py` | Tres columnas nuevas |
| `backend/app/middleware/tenant.py` | Nuevo |
| `backend/app/api/v1/public.py` | Nuevo — branding, sin auth |
| `backend/app/api/internal.py` | Nuevo — `valid-clubs`, sólo red interna |
| `Caddyfile` | Reescrito para wildcard + on-demand TLS |
| `frontend/src/App.tsx` | Fetch de branding antes del layout |
| `frontend/src/theme/` | Variables CSS dinámicas |
| Base de datos | **Ninguno** más allá de las tres columnas — se mantiene compartida |

---

## Decisiones Técnicas

| Decisión | Elección | Razón |
|----------|----------|-------|
| Base de datos | Compartida, `club_id` como hoy | Ver "Decisión pendiente"; ningún requisito actual justifica el costo de N bases |
| TLS | On-demand con `ask`, no wildcard DNS-01 | Evita depender de la API de un proveedor de DNS; el `ask` cierra el vector de abuso conocido |
| Resolución de tenant | Subdominio **cruzado** contra el JWT, no lo reemplaza | Un subdominio que sólo decora no es una frontera real |
| Marca | Runtime, una sola build | No escala compilar un frontend por club |
| Formato de `slug` | Reglas de host + reservados | El `slug` pasa de desambiguador de login a nombre de host; hoy no tiene esas restricciones |

---

## Criterios de Aceptación

- [ ] Un club nuevo es alcanzable en `{slug}.dominio.com` sin ninguna acción
      manual de infraestructura después del alta
- [ ] Un token de un club usado en el subdominio de otro recibe `403`, no acceso
- [ ] Un subdominio que no corresponde a ningún club activo no obtiene
      certificado TLS (verificable con el `ask` respondiendo `404`)
- [ ] El logo y los colores configurados por un club se ven en su subdominio y
      en ningún otro
- [ ] Un club sin marca configurada se ve exactamente como hoy
- [ ] El dominio principal sigue sirviendo login de `superadmin` y alta de club
- [ ] `docker compose up` de desarrollo sigue funcionando sin wildcard ni DNS real

---

## Riesgos

| Riesgo | Mitigación |
|--------|-----------|
| **On-demand TLS sin `ask` es un vector de abuso** | El `ask` gatea cada emisión contra `clubs.is_active`; sin club real, sin certificado |
| **Un `slug` mal formado rompe DNS o pisa una ruta de la plataforma** | Validación de formato + lista de reservados en alta y edición |
| **Links ya compartidos del dominio actual dejan de andar el día del corte** | Fase F explícita: depende de cuántos clubes hay en producción al momento de implementar, se decide entonces |
| **El middleware de tenant agrega latencia a cada request** | Es una consulta indexada por `slug` (ya `UNIQUE`); mismo costo que cualquier lookup por clave única que ya existe en el sistema |
| **Se termina construyendo Neon-por-club igual, por presión de tener la API key ya disponible** | La recomendación está documentada con su razonamiento; si el club insiste después de leerla, es una decisión informada y no un default por comodidad |

---

## Relacionado

- [[add-portal-completo-roadmap]] — el programa; este es su cambio 5
- [[despliegue]] — "un solo origen", que este cambio extiende a wildcard sin romper
- [[socios]] — precedente del `409` de ambigüedad que el buscador del dominio principal reusa
- [[permisos]] — `superadmin` salta todo chequeo de capacidad, incluido el de tenant
- [[add-app-movil-react-native]] — necesita que la resolución de tenant esté decidida antes de construir su propio flujo de login
- [[data-model]] — schema
- [[architecture]] — tema por defecto que la marca por club sobreescribe
