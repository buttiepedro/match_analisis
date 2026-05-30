---
title: Sesión de Partido y Timer en Tiempo Real
type: feature
status: done
archived: 2026-05-30
spec: match-session
created: 2026-05-30
---

# Sesión de Partido y Timer en Tiempo Real

## Objetivo

Implementar las sesiones de partido con timer sincronizado en tiempo real via WebSocket. El club_admin o match_director controla el timer; todos los participantes conectados lo ven actualizado cada segundo.

## Alcance

### Backend REST
- [x] `POST /tournaments/{tournament_id}/sessions` — crear sesión + TimerState inicial
- [x] `GET /tournaments/{tournament_id}/sessions` — listar sesiones
- [x] `GET /sessions/{session_id}` — detalle con timer_state actual
- [x] `PATCH /sessions/{session_id}/timer` — control REST del timer (fallback)
- [x] `POST /sessions/{session_id}/events` — registrar evento (stampeado con timer actual)
- [x] `GET /sessions/{session_id}/events` — listar eventos

### Backend WebSocket
- [x] `WS /ws/session/{session_id}?token=...` — canal en tiempo real
  - Autenticación por query param (browsers no soportan headers en WS)
  - Al conectar: recibe estado actual del timer
  - Mensajes entrantes (solo CLUB_ADMIN / MATCH_DIRECTOR): `{"type": "timer_control", "action": "..."}`
  - Mensajes salientes: `timer_tick` (cada 1s), `timer_state` (on control), `event_registered`

### WebSocket — In-Memory Timer
- [x] `ws/manager.py` — ConnectionManager + InMemoryTimer
  - Timer vive en memoria, se sincroniza con DB en cada acción de control
  - Background task por sesión activa que emite `timer_tick` cada segundo
  - Al reconectar, el cliente recibe el estado actual inmediatamente

## Acciones del Timer

| Acción | Estado previo requerido | Efecto |
|--------|------------------------|--------|
| `start` | `stopped` | Inicia half 1 desde 00:00 |
| `start` | `halftime` | Inicia half 2 desde 00:00 |
| `pause` | `running` | Congela |
| `resume` | `paused` | Continúa |
| `halftime` | `running` (half 1) | Fin del 1er tiempo |
| `finish` | cualquier estado activo | Finaliza el partido |

## Dependencias

- `tournament-setup` completado

## Próxima Tarea

`statistics-screens` — tabs de registro de eventos en el frontend
