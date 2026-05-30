---
title: Divisiones y Torneos
type: feature
status: done
archived: 2026-05-30
spec: auth-and-users
created: 2026-05-30
---

# Divisiones y Torneos

## Objetivo

Permitir al club_admin crear las divisiones (ej: "M17", "Primera", "Femenino") y los torneos dentro de cada división (ej: "Torneo Apertura 2026"). Estas entidades son el contenedor donde se crearán las sesiones de partido.

## Alcance

### Backend
- [x] `POST /clubs/{club_id}/divisions` — crear división
- [x] `GET /clubs/{club_id}/divisions` — listar divisiones activas del club
- [x] `POST /clubs/{club_id}/tournaments` — crear torneo (requiere division_id)
- [x] `GET /clubs/{club_id}/tournaments` — listar torneos del club
- [x] `GET /clubs/{club_id}/tournaments/{tournament_id}` — detalle de torneo
- [x] `schemas/division.py` — DivisionCreate, DivisionResponse
- [x] `schemas/tournament.py` — TournamentCreate, TournamentResponse (incluye división anidada)

### Frontend
- [ ] Pantalla de divisiones (club_admin)
- [ ] Pantalla de torneos por división (club_admin)

## Reglas de Negocio

1. La división debe pertenecer al mismo club que el torneo
2. Solo el club_admin (o superadmin) puede crear divisiones y torneos en un club
3. Un tournament_id válido es requisito para crear una sesión de partido
4. Los torneos y divisiones se listan solo si is_active = true

## Dependencias

- `club-management` completado

## Próxima Tarea

`session-timer` — sesión de partido + WebSocket del timer
