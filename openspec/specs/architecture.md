---
title: Arquitectura General del Sistema
status: active
created: 2026-05-29
---

# Arquitectura General del Sistema

## Visión General

match_analisis es una web app mobile-first para registrar estadísticas en tiempo real de partidos de rugby. Funciona como un tablero de anotaciones colaborativo donde un administrador controla el timer y múltiples participantes registran eventos desde sus dispositivos.

## Stack Tecnológico

| Capa | Tecnología |
|------|------------|
| Frontend | React (Vite), TailwindCSS, mobile-first |
| Backend | FastAPI (Python) |
| Base de datos | PostgreSQL |
| Migraciones | Alembic (auto-apply en startup) |
| Contenedores | Docker + Docker Compose |
| Tiempo real | WebSockets (FastAPI nativo) |

## Estructura de Directorios

```
match_analisis/
├── frontend/
│   ├── Dockerfile
│   ├── package.json
│   └── src/
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── alembic/
│   └── app/
├── docker-compose.yml
└── .env.example
```

## Comunicación entre Servicios

```
[Mobile Browser]
      │
      ├── HTTP REST  ──► [FastAPI Backend :8000]
      │                        │
      └── WebSocket ──►        ├── PostgreSQL :5432
                               └── Alembic (auto-migrate on startup)
```

- **REST API**: operaciones CRUD (crear clubes, usuarios, torneos, registrar eventos)
- **WebSockets**: sincronización del timer en tiempo real entre todos los participantes de una sesión

## Principios de Diseño

1. **Mobile-first**: UI diseñada para pantallas de 375px en adelante
2. **Offline-tolerante**: eventos locales con sync posterior (fase futura)
3. **Multi-tenant**: aislamiento por club, sin mezcla de datos entre clubes
4. **Auto-migración**: Alembic corre `upgrade head` al iniciar el backend
5. **Config por .env**: superadmin, conexión DB y secrets en variables de entorno

## Docker Compose

- `db`: PostgreSQL 15, volumen persistente
- `backend`: FastAPI, depende de `db`, ejecuta migraciones al iniciar
- `frontend`: Nginx sirviendo el build de React, proxy a `backend`

## Relacionado

- [[auth-and-users]] — jerarquía de usuarios y permisos
- [[data-model]] — entidades de base de datos
- [[match-session]] — sesión de partido y timer
- [[statistics-screens]] — pantallas de registro de estadísticas
