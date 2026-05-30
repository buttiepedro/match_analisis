# match_analisis

Tablero de estadísticas en tiempo real para partidos de rugby. Diseñado para uso en campo, mobile-first, con sincronización de timer via WebSocket.

## Stack

| Capa | Tecnología |
|------|------------|
| Frontend | React 18 + TypeScript + Vite + TailwindCSS |
| Backend | FastAPI (Python 3.12) |
| Base de datos | PostgreSQL 15 |
| Migraciones | Alembic (auto-apply al iniciar) |
| Tiempo real | WebSockets nativos de FastAPI |
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

## Variables de entorno

### Backend

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `DATABASE_URL` | Conexión a PostgreSQL (asyncpg) | `postgresql+asyncpg://user:pass@host:5432/db` |
| `SECRET_KEY` | Clave JWT — cambiar en producción | `una-clave-secreta-larga` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Expiración del access token | `60` |
| `REFRESH_TOKEN_EXPIRE_DAYS` | Expiración del refresh token | `7` |
| `SUPERADMIN_EMAIL` | Email del superadmin (se crea al iniciar) | `admin@example.com` |
| `SUPERADMIN_PASSWORD` | Contraseña del superadmin | `changeme123` |
| `POSTGRES_USER` | Usuario de Postgres (para Docker Compose) | `match_user` |
| `POSTGRES_PASSWORD` | Contraseña de Postgres | `changeme` |
| `POSTGRES_DB` | Nombre de la base de datos | `match_analisis` |

### Frontend

| Variable | Descripción | Tipo |
|----------|-------------|------|
| `VITE_API_URL` | URL pública del backend (con scheme) | Build ARG |

`VITE_API_URL` se bake en el bundle al momento del build. Si no se pasa, las requests van a la misma origin (útil para dev local con `npm run dev`, donde Vite proxy al backend).

**Ejemplos:**

```env
# Railway
VITE_API_URL=https://matchanalisisback-production.up.railway.app

# Docker Compose local (el browser llega al backend por localhost:8000)
VITE_API_URL=http://localhost:8000
```

## Deploy en Railway

### Backend
Variables de entorno del servicio backend:
```env
DATABASE_URL=postgresql+asyncpg://user:pass@host:5432/db
SECRET_KEY=...
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
│   │   ├── api/v1/        # auth, clubs, divisions, tournaments, sessions, lineup, players
│   │   ├── core/          # config, DB, seguridad, dependencias
│   │   ├── models/        # SQLAlchemy ORM
│   │   ├── schemas/       # Pydantic
│   │   └── ws/            # WebSocket manager + timer en memoria
│   ├── alembic/           # Migraciones (auto-run al iniciar)
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── components/    # Timer, EventButton, SubstitutionModal, tabs
│   │   ├── pages/         # Login, Dashboard, Session
│   │   ├── store/         # Zustand (auth, session/timer/lineup)
│   │   └── lib/           # axios (VITE_API_URL), WebSocket client
│   ├── nginx.conf         # Sirve el SPA estático
│   └── Dockerfile
├── openspec/              # Specs y change proposals (SDD)
├── docker-compose.yml
└── .env.example
```

## Roles de usuario

| Rol | Puede |
|-----|-------|
| `superadmin` | Crear clubes (definido en `.env`) |
| `club_admin` | Crear usuarios, divisiones, torneos, sesiones y lineup |
| `match_director` | Controlar el timer + registrar eventos |
| `analyst` | Solo registrar eventos |

## Funcionalidades principales

### Multi-tenant
Cada club está aislado. Un usuario solo puede ver y operar datos de su propio club.

### Timer en tiempo real
El admin/director controla el timer (iniciar, pausar, medio tiempo, finalizar). Todos los participantes conectados via WebSocket ven el timer actualizado cada segundo.

```
WS /ws/session/{session_id}?token=<jwt>
```

### Registro de eventos
Cada evento queda sellado con el tiempo exacto del timer en el momento del registro.

**Pantalla Tackles**: lista de los 15 jugadores en cancha con botones Errado / Efectivo. Soporte para cambios con registro de evento de sustitución.

**Pantalla Lines & Scrum**: 4 botones (line a favor, line en contra, scrum a favor, scrum en contra) con popup de obtención del balón.

**Pantalla Penales & Posesión**: penales, tarjetas, turnovers, knock-ons con campo de razón opcional.

### Jugadores y lineup
- Los jugadores se registran por división con su posición habitual.
- Antes de cada partido se define el lineup con número de camiseta y titular/suplente.
- Los cambios durante el partido actualizan el lineup en tiempo real y registran el evento.

## API principal

| Método | Ruta | Descripción | Acceso |
|--------|------|-------------|--------|
| POST | `/auth/login` | Login → tokens JWT | Público |
| GET | `/auth/me` | Usuario actual | Autenticado |
| POST | `/clubs` | Crear club + admin | superadmin |
| POST | `/clubs/{id}/users` | Crear usuario en club | club_admin |
| POST | `/clubs/{id}/divisions` | Crear división | club_admin |
| POST | `/clubs/{id}/tournaments` | Crear torneo | club_admin |
| POST | `/divisions/{id}/players` | Agregar jugador a división | club_admin |
| POST | `/tournaments/{id}/sessions` | Crear sesión/partido | club_admin |
| POST | `/sessions/{id}/lineup` | Definir lineup del partido | club_admin |
| POST | `/sessions/{id}/lineup/substitute` | Registrar cambio de jugador | club_admin |
| PATCH | `/sessions/{id}/timer` | Controlar timer (REST) | club_admin, match_director |
| POST | `/sessions/{id}/events` | Registrar evento | analyst+ |
| GET | `/health` | Healthcheck | Público |

Documentación interactiva completa en `/docs` cuando el backend está corriendo.

## Migraciones

Alembic corre `upgrade head` automáticamente al iniciar el contenedor. Las migraciones son idempotentes: si las tablas ya existen las saltea, si el schema cambió genera las alteraciones necesarias.

Para generar una nueva migración tras cambiar un modelo:

```bash
docker compose exec backend alembic revision --autogenerate -m "descripcion del cambio"
git add backend/alembic/versions/
git commit -m "feat: nueva migración"
```
