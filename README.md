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

## Levantar el proyecto

```bash
# 1. Clonar y configurar variables de entorno
cp .env.example .env
# Editar .env con tus valores (contraseñas, secret key, etc.)

# 2. Levantar todo
docker compose up --build
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- Docs interactivas: http://localhost:8000/docs

El backend corre las migraciones de Alembic y crea el superadmin automáticamente al iniciar.

## Variables de entorno

Ver `.env.example` para la lista completa. Las más importantes:

```env
SUPERADMIN_EMAIL=admin@example.com
SUPERADMIN_PASSWORD=changeme123
SECRET_KEY=cambia-esto-en-produccion
DATABASE_URL=postgresql+asyncpg://match_user:changeme@db:5432/match_analisis
```

## Estructura

```
match_analisis/
├── backend/
│   ├── app/
│   │   ├── api/v1/        # Routers: auth, clubs, divisions, tournaments, sessions, lineup, players
│   │   ├── core/          # Config, DB, seguridad, dependencias
│   │   ├── models/        # SQLAlchemy ORM
│   │   ├── schemas/       # Pydantic
│   │   └── ws/            # WebSocket manager + timer en memoria
│   ├── alembic/           # Migraciones
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── components/    # Timer, EventButton, SubstitutionModal, tabs
│   │   ├── pages/         # Login, Dashboard, Session
│   │   ├── store/         # Zustand (auth, session/timer/lineup)
│   │   └── lib/           # Axios client, WebSocket client
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

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/auth/login` | Login → tokens JWT |
| GET | `/auth/me` | Usuario actual |
| POST | `/clubs` | Crear club + admin (superadmin) |
| POST | `/clubs/{id}/users` | Crear usuario en club |
| POST | `/clubs/{id}/divisions` | Crear división |
| POST | `/clubs/{id}/tournaments` | Crear torneo |
| POST | `/divisions/{id}/players` | Agregar jugador a división |
| POST | `/tournaments/{id}/sessions` | Crear sesión/partido |
| POST | `/sessions/{id}/lineup` | Definir lineup del partido |
| POST | `/sessions/{id}/lineup/substitute` | Registrar cambio de jugador |
| PATCH | `/sessions/{id}/timer` | Controlar timer (REST fallback) |
| POST | `/sessions/{id}/events` | Registrar evento |
| GET | `/health` | Healthcheck |

Documentación interactiva completa en `/docs` cuando el backend está corriendo.

## Migraciones

Alembic corre `upgrade head` automáticamente al iniciar el contenedor del backend. Para generar una nueva migración en desarrollo:

```bash
docker compose exec backend alembic revision --autogenerate -m "descripcion"
```
