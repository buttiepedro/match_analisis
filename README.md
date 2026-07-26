# match_analisis

Plataforma de estadísticas de rugby y gestión de plantel. Diseñada para uso en campo: mobile-first, timer sincronizado por WebSocket y **tolerante a cortes de conectividad** — los eventos registrados sin señal se guardan y se envían solos al recuperarla.

## Stack

| Capa | Tecnología |
|------|------------|
| Frontend | React 18 + TypeScript + Vite + TailwindCSS + ECharts |
| Backend | FastAPI (Python 3.12) |
| Base de datos | PostgreSQL 15 |
| Migraciones | Alembic (auto-apply al iniciar) |
| Tiempo real | WebSockets nativos de FastAPI |
| Almacenamiento | AWS S3 (fotos de jugadores) |
| Tests | pytest (backend) · vitest (frontend) |
| Contenedores | Docker + Docker Compose |

## Levantar con Docker Compose (local)

```bash
cp .env.example .env
# Editar .env con tus valores
docker compose up --build
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- Docs interactivas: http://localhost:8000/docs

El backend corre migraciones y crea el superadmin automáticamente al iniciar.

## Tests

```bash
# Backend — 99 tests, corren sobre SQLite en memoria, sin dependencias externas
cd backend
python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/pytest

# Frontend — 41 tests
cd frontend
npm install
npm test
```

CI en GitHub Actions (`.github/workflows/ci.yml`) corre en cada push y PR:
tests del backend, migraciones de Alembic contra Postgres real (upgrade + downgrade),
y typecheck + tests + build del frontend.

## Variables de entorno

### Backend

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `DATABASE_URL` | Conexión a PostgreSQL (asyncpg) | `postgresql+asyncpg://user:pass@host:5432/db` |
| `SECRET_KEY` | Clave JWT — cambiar en producción | `una-clave-secreta-larga` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Expiración del access token | `60` |
| `REFRESH_TOKEN_EXPIRE_DAYS` | Expiración del refresh token | `7` |
| `CORS_ORIGINS` | Orígenes permitidos, separados por coma | `https://app.miclub.com` |
| `SUPERADMIN_EMAIL` | Email del superadmin (se crea al iniciar) | `admin@example.com` |
| `SUPERADMIN_PASSWORD` | Contraseña del superadmin | `changeme123` |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Credenciales S3 para fotos | — |
| `AWS_REGION` / `AWS_S3_BUCKET` | Bucket de fotos de jugadores | `us-east-1` |
| `AWS_S3_PUBLIC_URL` | Opcional: CDN delante del bucket | `https://cdn.midominio.com` |

> **CORS_ORIGINS sin definir acepta cualquier origen** y el backend lo avisa por log al
> arrancar. En producción conviene listar explícitamente la URL del frontend.

### Frontend

| Variable | Descripción | Tipo |
|----------|-------------|------|
| `VITE_API_URL` | URL pública del backend (con scheme) | Build ARG |

`VITE_API_URL` se bake en el bundle al momento del build. Si no se pasa, las requests van a la misma origin (útil para dev local con `npm run dev`, donde Vite proxy al backend).

## Deploy en Railway

### Backend
```env
DATABASE_URL=postgresql+asyncpg://user:pass@host:5432/db
SECRET_KEY=...
CORS_ORIGINS=https://tu-frontend.up.railway.app
SUPERADMIN_EMAIL=admin@example.com
SUPERADMIN_PASSWORD=...
```

### Frontend
Build ARG del servicio frontend:
```env
VITE_API_URL=https://tu-backend.up.railway.app
```

## Estructura

```
match_analisis/
├── backend/
│   ├── app/
│   │   ├── api/v1/        # auth, clubs, divisions, tournaments, sessions,
│   │   │                  # lineup, players, performance, import,
│   │   │                  # trainings, injuries, season
│   │   ├── core/          # config, DB, seguridad, dependencias, antropometría
│   │   ├── models/        # SQLAlchemy ORM
│   │   ├── schemas/       # Pydantic
│   │   └── ws/            # WebSocket manager + timer en memoria
│   ├── alembic/           # Migraciones (auto-run al iniciar)
│   ├── tests/             # pytest
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── components/    # Timer, EventLog, modales, tabs del tablero
│   │   ├── pages/         # Login, Torneos, Sesión, Lineup, Stats, Plantel, Perfil,
│   │   │                  # Físico, Entrenamientos, Asistencia, Config
│   │   ├── store/         # Zustand (auth, session, squad)
│   │   └── lib/           # axios, tokens, WebSocket, cola offline, timer, stats,
│   │                      # asistencia
│   ├── nginx.conf         # Sirve el SPA estático
│   └── Dockerfile
├── openspec/              # Specs y change proposals (SDD)
├── .github/workflows/     # CI
├── docker-compose.yml
└── .env.example
```

## Roles de usuario

| Rol | Puede |
|-----|-------|
| `superadmin` | Crear clubes (definido en `.env`) |
| `club_admin` | Crear usuarios, divisiones, torneos, sesiones, lineup, lesiones y apto médico |
| `match_director` | Controlar el timer, registrar eventos y crear entrenamientos |
| `analyst` | Registrar eventos y tomar asistencia |

---

# Funcionalidades

## Resiliencia en cancha

Lo que hace que la app sea usable en un club con mala señal:

- **Cola offline.** Si el POST falla por red (o el navegador está offline), el evento se guarda en `localStorage` **junto con el minuto de partido en que ocurrió**. Al volver la conexión se reenvía solo, conservando el tiempo real del hecho en vez del de la reconexión. Los eventos pendientes se muestran con ⧗ y el header indica cuántos faltan enviar. La misma cola transporta la **planilla de asistencia**, que también se carga en la cancha; sólo admite escrituras idempotentes, y por eso la asistencia va como `PUT` de la planilla completa.
- **Reconexión automática del WebSocket** con backoff exponencial (1s → 30s, con jitter) y reintento inmediato al recuperar conectividad. Al reconectar se vacía la cola y se re-sincronizan los eventos que hayan entrado mientras tanto.
- **Refresh token transparente.** Ante un 401 el cliente renueva el access token y reintenta la request, con un único refresh en vuelo aunque fallen diez requests a la vez. Sólo se cierra sesión si el refresh también falla — nadie queda afuera a mitad de partido.

## Multi-tenant

Cada club está aislado. Un usuario solo puede ver y operar datos de su propio club; el `superadmin` es el único que cruza esa frontera.

## Timer en tiempo real

El admin/director controla el timer (iniciar, pausar, medio tiempo, finalizar, corregir). Todos los participantes conectados ven el timer actualizado cada segundo. Al cumplirse el tiempo reglamentario del período el reloj se marca en ámbar y muestra el tiempo adicional corrido (`+2:31`); no se detiene solo, la decisión sigue siendo del director.

```
WS /ws/session/{session_id}?token=<jwt>
```

## Registro de eventos

Cada evento queda sellado con el tiempo exacto de partido del momento del registro.

- **Juego**: modo Ataque/Defensa. Quiebre, offload, perdida (con motivo), tackles concretado/errado/positivo, pelota ganada, y anotaciones (Try + conversión, Penal con destino, Drop).
- **Lines & Scrum**: line, scrum y salidas — a favor y en contra, con obtención del balón y contadores en vivo.
- **Cambios**: disciplina (amarilla/roja) por equipo, sustituciones y marcador de puntos en tiempo real.

## Estadísticas (`/stats`)

Pantalla de análisis post-partido para `club_admin`, `match_director` y `analyst`.

- **Marcador** con desglose por equipo (tries, conversiones, penales a palos, drops)
- **Gráficos**: tries, penales por destino, drops, errores, tarjetas por jugador, line-outs, scrums, salidas, tackles, posesión y ataque
- **Filtro de categoría** y **línea de tiempo** de eventos
- **Perspectiva normalizada por club**: el club del usuario siempre es el protagonista, sin importar si fue local o visitante
- **Objetivos** configurables por métrica
- Exportación a Excel y PDF

## Entrenamientos y asistencia (`/trainings`)

La capa que faltaba entre partido y partido.

- **Toma de asistencia de un tap.** Todo el plantel arranca en *presente* — se marca
  la excepción, no la regla. Cinco estados: presente, ausente, justificado,
  lesionado y tarde.
- **Funciona sin señal.** La planilla usa la misma cola offline que los eventos de
  partido. El `PUT` es idempotente, así que reenviarlo no duplica nada, y una
  planilla nueva reemplaza a la anterior en vez de acumular requests.
- **Ranking de asistencia** por división, con ventana de 30 o 90 días.
- **Alerta de deserción**: 3 ausencias seguidas o menos de 50% marca al jugador
  *en riesgo*. Una falta justificada no corta la racha — no es deserción.

## Armado de equipo (`/sessions/:id/lineup`)

- **Grilla de 23 casilleros** con la numeración reglamentaria ya puesta. Tap en el
  casillero → picker con los jugadores del puesto primero. Un solo guardado.
- **Traer última fecha**: precarga los 23 del partido anterior de la división y
  avisa quién quedó afuera por baja o cambio de división.
- **Copiar convocatoria** al portapapeles, lista para pegar en el grupo.
- El número de camiseta es **único por equipo y partido**: los eventos se asocian
  por número, así que un duplicado ensuciaba las estadísticas en silencio.
- Con el partido empezado la grilla se apaga: reemplazar el lineup entero borraría
  quién entró y salió.

## Plantel (`/squad`)

- Jugadores por división, con búsqueda y multi-selección
- **Mover jugadores entre divisiones** en lote, con historial de movimientos
- Alta manual, importación desde planilla xlsx/xls y unificación de duplicados
- Foto de perfil con recorte, almacenada en S3
- **Disponibilidad a la vista**: lesionado, suspendido, baja temporal y apto médico
  vencido salen como chip en la lista

## Disponibilidad y lesiones

- **Estado del jugador**: disponible, lesionado, suspendido o baja temporal. Antes
  sólo existía `is_active`, así que las tres primeras eran "activo".
- **Ficha de lesión** con zona, gravedad, alta estimada y alta real. El estado del
  jugador se deriva de las lesiones abiertas: cerrar una de dos no lo devuelve a la
  cancha, y una suspensión no se levanta por un parte médico.
- **Apto médico** con vencimiento y aviso a 30 días. Advierte, no bloquea: el
  sistema informa y la responsabilidad reglamentaria sigue siendo del club.

## Perfil del jugador (`/squad/:id`)

Seis solapas: **Datos**, **Físico**, **Tests**, **Temporada**, **Lesiones** e
**Historial** de divisiones.

**Temporada** cruza las dos mitades del año del jugador: partidos, minutos, tries y
tackles por un lado; porcentaje de asistencia a 30, 90 días y temporada por el
otro. Los minutos se calculan a partir del lineup, las sustituciones y el timer —
no se guardan, para no tener una segunda fuente de verdad. Un suplente que nunca
entró tiene 0 minutos, y cada amarilla descuenta 10, acotado a lo que quedaba por
jugar.

## Físico (`/performance`)

- **Mediciones antropométricas**: peso, altura, IMC calculado y pliegues cutáneos.
- **% de grasa corporal** por Durnin-Womersley usando la **edad y el sexo reales del jugador**. Cada medición guarda el método efectivo (`dw4c/F/20-29`): juego de pliegues, sexo y banda etaria. Un `*` marca un dato asumido por ficha incompleta y la UI lo explica.
  - Con el pliegue **bicipital** cargado se usa el juego de pliegues original del método (bíceps, tríceps, subescapular, suprailíaco).
  - Sin él se usa el **abdominal** como reemplazo, y el método guardado lo refleja (`dw4a/...`) para no mezclar series calculadas distinto.
- **Tests físicos**: 13 tipos (velocidad, aceleración, aeróbico, fuerza, salto, flexibilidad) con evolución por jugador.
- **Ranking por división y test**, ordenado según el test (menor tiempo = mejor; mayor carga = mejor).

## Importación

- **Ficha BD UAR (PDF)**: parser de lineup e incidencias con modal de confirmación y resolución de jugadores no encontrados.
- **Planilla de jugadores (xlsx/xls)**: alta masiva con mapeo de posiciones UAR.

---

## API principal

| Método | Ruta | Descripción | Acceso |
|--------|------|-------------|--------|
| POST | `/auth/login` | Login → tokens JWT | Público |
| POST | `/auth/refresh` | Renovar access token | Público |
| POST | `/auth/logout` | Revocar refresh token | Público |
| GET | `/auth/me` | Usuario actual | Autenticado |
| POST | `/clubs` | Crear club + admin | superadmin |
| POST/GET | `/clubs/{id}/users` | Usuarios del club | club_admin |
| POST/GET | `/clubs/{id}/divisions` | Divisiones | club_admin |
| PATCH/DELETE | `/clubs/{id}/divisions/{div_id}` | Renombrar / dar de baja | club_admin |
| POST/GET | `/clubs/{id}/tournaments` | Torneos | club_admin |
| PATCH/DELETE | `/clubs/{id}/tournaments/{t_id}` | Editar / dar de baja | club_admin |
| POST/GET | `/divisions/{id}/players` | Jugadores de la división | club_admin |
| PATCH | `/players/batch-move` | Mover jugadores de división | club_admin |
| GET/POST | `/players/{id}/measurements` | Mediciones antropométricas | analyst+ |
| GET/POST | `/players/{id}/tests` | Tests físicos | analyst+ |
| GET | `/divisions/{id}/tests/ranking` | Ranking por test | analyst+ |
| POST/GET | `/divisions/{id}/trainings` | Entrenamientos de la división | match_director+ |
| PATCH/DELETE | `/trainings/{id}` | Editar / eliminar entrenamiento | match_director+ |
| GET/PUT | `/trainings/{id}/attendance` | Planilla de asistencia (upsert bulk) | analyst+ |
| GET | `/divisions/{id}/attendance/summary` | % de asistencia y ranking | analyst+ |
| GET | `/players/{id}/attendance` | Histórico y racha del jugador | analyst+ |
| GET/POST | `/players/{id}/injuries` | Lesiones | analyst+ / club_admin |
| PATCH/DELETE | `/injuries/{id}` | Editar / cerrar lesión | club_admin |
| PATCH | `/players/{id}/availability` | Estado y apto médico | club_admin |
| GET | `/divisions/{id}/availability` | Disponibilidad del plantel | analyst+ |
| GET | `/players/{id}/season-stats` | Acumulados de temporada | analyst+ |
| GET | `/divisions/{id}/minutes` | Minutos jugados del plantel | analyst+ |
| POST | `/tournaments/{id}/sessions` | Crear partido | club_admin |
| POST | `/sessions/{id}/lineup` | Agregar un jugador al lineup | club_admin |
| PUT | `/sessions/{id}/lineup` | Reemplazar el lineup de un equipo | club_admin |
| GET | `/sessions/{id}/lineup/suggested` | Lineup del partido anterior | club_admin |
| GET/PUT | `/sessions/{id}/squad` | Convocatoria | club_admin |
| PATCH | `/sessions/{id}/timer` | Controlar timer (REST) | match_director+ |
| POST | `/sessions/{id}/events` | Registrar evento | analyst+ |
| GET | `/health` | Healthcheck | Público |

Documentación interactiva completa en `/docs` con el backend corriendo.

### Eventos diferidos

`POST /sessions/{id}/events` acepta `timer_seconds` y `half` opcionales. **Ambos o ninguno**: si vienen los dos, el backend respeta ese sello en lugar de usar su propio timer. Es lo que permite que la cola offline conserve el minuto real del evento. Si falta uno de los dos, se ignora el sello del cliente.

## Bajas lógicas

Divisiones y torneos se archivan (`is_active = false`), no se borran. El backend rechaza con `409` la baja de una división con jugadores o torneos activos, y la de un torneo con partidos cargados — y dice cuántos hay. Archivar algo con contenido activo lo esconde sin borrarlo, que es peor que no poder archivarlo.

## Migraciones

Alembic corre `upgrade head` automáticamente al iniciar el contenedor. Las migraciones son idempotentes: si las tablas ya existen las saltea.

Para generar una nueva migración tras cambiar un modelo:

```bash
docker compose exec backend alembic revision --autogenerate -m "descripcion del cambio"
git add backend/alembic/versions/
git commit -m "feat: nueva migración"
```
