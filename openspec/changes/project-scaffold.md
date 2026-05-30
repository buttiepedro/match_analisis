---
title: Scaffolding inicial del proyecto
type: feature
status: in-progress
spec: architecture
created: 2026-05-29
---

# Scaffolding Inicial del Proyecto

## Objetivo

Crear la estructura base del monorepo con frontend (React + Vite) y backend (FastAPI), ambos dockerizados y el backend conectado a PostgreSQL con migraciones automáticas via Alembic.

## Alcance

### Backend (`/backend/`)
- [x] Estructura de paquetes FastAPI (`app/`, `app/api/`, `app/models/`, `app/schemas/`, `app/core/`)
- [x] Configuración de settings via `pydantic-settings` + `.env`
- [x] Conexión a PostgreSQL con SQLAlchemy async
- [x] Setup de Alembic con auto-migración en startup
- [x] Modelo inicial: `Club`, `User`, `Division`, `Tournament`, `Session`, `TimerState`, `Event`, `RefreshToken`
- [x] Endpoint de healthcheck: `GET /health`
- [x] Seed de superadmin al iniciar si no existe
- [x] `Dockerfile` con entrypoint que corre migraciones antes de iniciar uvicorn
- [x] `requirements.txt`

### Frontend (`/frontend/`)
- [x] Vite + React + TypeScript
- [x] TailwindCSS configurado (mobile-first, breakpoint `sm: 640px`)
- [x] React Router v6 con rutas: `/login`, `/dashboard`, `/sessions/:id`
- [x] Axios client con interceptor para JWT
- [x] Zustand para estado global (auth, timer)
- [x] Pantalla de login funcional conectada al backend
- [x] `Dockerfile` (build + Nginx para servir estáticos con proxy a backend)

### Raíz del proyecto
- [x] `docker-compose.yml` con servicios: `db`, `backend`, `frontend`
- [x] `.env.example` con todas las variables requeridas
- [x] `.gitignore`

## Variables de Entorno Requeridas

```env
# Base de datos
POSTGRES_USER=match_user
POSTGRES_PASSWORD=changeme
POSTGRES_DB=match_analisis
DATABASE_URL=postgresql+asyncpg://match_user:changeme@db:5432/match_analisis

# Backend
SECRET_KEY=super-secret-key-change-in-production
ACCESS_TOKEN_EXPIRE_MINUTES=60
REFRESH_TOKEN_EXPIRE_DAYS=7

# Superadmin
SUPERADMIN_EMAIL=admin@example.com
SUPERADMIN_PASSWORD=changeme123

# Frontend
VITE_API_URL=http://localhost:8000
```

## Definición de "Hecho"

- `docker-compose up` levanta los tres servicios sin errores
- Las migraciones corren automáticamente al iniciar el backend
- El superadmin se crea si no existe
- `GET /health` retorna `{"status": "ok"}`
- El frontend carga en `http://localhost:3000` y la pantalla de login conecta al backend

## Dependencias

- Ninguna (es la primera tarea)

## Próximas Tareas (post-scaffold)

1. `auth-endpoints` — implementar login/refresh/logout
2. `club-management` — CRUD de clubes y usuarios
3. `tournament-setup` — divisiones y torneos
4. `session-timer` — sesión de partido + WebSocket del timer
5. `statistics-screens` — tabs de registro de eventos
