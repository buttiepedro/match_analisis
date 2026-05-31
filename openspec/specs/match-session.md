---
title: Sesión de Partido y Timer
status: active
created: 2026-05-29
updated: 2026-05-30
---

# Sesión de Partido y Timer

## Visión General

Una "sesión" representa un partido de rugby en curso o finalizado. El admin controla el timer; todos los participantes lo ven en tiempo real via WebSocket. Cada evento queda sellado con el timestamp del timer en el momento del registro.

## Estructura de una Sesión

- Pertenece a un **torneo** → una **división** → un **club**
- Tiene dos equipos: **local** y **visitante**
- Tiene dos tiempos (halves) de duración configurable (default: 40 min)
- Estado: `scheduled` → `active` → `halftime` → `active` → `finished`

## Timer

### Acciones del Timer

| Acción | Quién puede | Estado previo | Efecto |
|--------|-------------|---------------|--------|
| `start` | CLUB_ADMIN, MATCH_DIRECTOR | `stopped` | Inicia half 1 desde 00:00 |
| `start` | CLUB_ADMIN, MATCH_DIRECTOR | `halftime` | Inicia half 2 desde 00:00 |
| `pause` | CLUB_ADMIN, MATCH_DIRECTOR | `running` | Congela el tiempo |
| `resume` | CLUB_ADMIN, MATCH_DIRECTOR | `paused` | Continúa desde donde pausó |
| `halftime` | CLUB_ADMIN, MATCH_DIRECTOR | `running` (half 1) | Fin del 1er tiempo |
| `finish` | CLUB_ADMIN, MATCH_DIRECTOR | cualquier activo | Finaliza el partido |
| `reset` | CLUB_ADMIN, MATCH_DIRECTOR | cualquiera | Vuelve a 00:00 estado `stopped` |
| `set` | CLUB_ADMIN, MATCH_DIRECTOR | `paused` o `stopped` | Ajusta el tiempo a un valor específico (corrección de errores) |

`reset` y `set` son acciones de corrección — disponibles cuando el timer no está corriendo.  
`set` recibe `seconds: int` como parámetro adicional.

### Estado del Timer (WebSocket)

```json
{
  "session_id": "uuid",
  "half": 1,
  "status": "stopped | running | paused | halftime | finished",
  "elapsed_seconds": 1425,
  "server_timestamp": "2026-05-30T15:23:45Z"
}
```

- El cliente interpola el tiempo local: `elapsed_seconds + (now - server_timestamp)`
- Al reconectar, el cliente recibe el estado actual inmediatamente
- El servidor emite `timer_tick` cada segundo cuando el timer corre

### Mensajes WebSocket

```
Cliente → Servidor (CLUB_ADMIN o MATCH_DIRECTOR):
{ "type": "timer_control", "action": "start|pause|resume|halftime|finish|reset|set", "seconds": 1200 }

Servidor → Cliente:
{ "type": "timer_tick",   "data": { ...estado del timer } }
{ "type": "timer_state",  "data": { ...estado del timer } }   ← on control action
{ "type": "event_registered", "data": { ...evento } }
{ "type": "substitution", "data": { player_out: {...}, player_in: {...} } }
```

## Modelo de Evento

```json
{
  "id": "uuid",
  "session_id": "uuid",
  "event_type": "string",
  "half": 1,
  "timer_seconds": 1425,
  "team": "home | away",
  "player_id": "uuid | null",
  "player_number": 7,
  "reason": "string | null",
  "metadata": {},
  "recorded_by": "uuid",
  "recorded_at": "2026-05-30T15:23:45Z"
}
```

**Importante:** `player_id` es la referencia canónica al jugador (FK a `players`). `player_number` se puebla automáticamente desde el lineup como dato de display — nunca es la fuente de verdad. Eventos sin jugador asociado tienen ambos campos en `null`.

### Tipos de evento implementados

| event_type | Tab | Con player_id | reason | metadata |
|---|---|---|---|---|
| `tackle_effective` | Tackles | Sí (obligatorio) | — | — |
| `tackle_missed` | Tackles | Sí (obligatorio) | — | — |
| `substitution` | — (auto) | Sí | — | `{player_out_*,player_in_*}` |
| `lineout_favor` | Lines & Scrum | No | — | `{obtained: bool}` |
| `lineout_against` | Lines & Scrum | No | — | `{obtained: bool}` |
| `scrum_favor` | Lines & Scrum | No | — | `{obtained: bool}` |
| `scrum_against` | Lines & Scrum | No | — | `{obtained: bool}` |
| `try` | Eventos | No | — | `{converted: bool}` |
| `penalty` | Eventos | No | `line\|scrum\|juega\|a_los_palos` | `{converted: bool}` (solo a_los_palos) |
| `drop` | Eventos | No | — | — |
| `knock_on` | Eventos | No | — | — |
| `forward_pass` | Eventos | No | — | — |
| `lost_in_contact` | Eventos | No | — | — |
| `yellow_card` | Eventos | No | — | — |
| `red_card` | Eventos | No | — | — |

> **Nota de compatibilidad:** los tipos `penalty_conceded`, `penalty_won`, `turnover_conceded`, `turnover_won` pueden existir en datos históricos. El frontend los muestra en el EventLog con sus labels originales, pero ya no se generan desde la UI.

## Endpoints

| Método | Ruta | Descripción | Acceso |
|--------|------|-------------|--------|
| POST | `/tournaments/{t_id}/sessions` | Crear sesión | CLUB_ADMIN |
| GET | `/tournaments/{t_id}/sessions` | Listar sesiones | ANALYST+ |
| GET | `/sessions/{session_id}` | Detalle | ANALYST+ |
| DELETE | `/sessions/{session_id}` | Eliminar + cascada (eventos, lineup, timer) | CLUB_ADMIN |
| PATCH | `/sessions/{session_id}/timer` | Controlar timer (REST) | CLUB_ADMIN, MATCH_DIRECTOR |
| POST | `/sessions/{session_id}/events` | Registrar evento | ANALYST+ |
| GET | `/sessions/{session_id}/events` | Listar eventos | ANALYST+ |
| DELETE | `/sessions/{session_id}/events/{event_id}` | Eliminar evento | ANALYST+ |

**Eliminación de sesión:** borra en cascada todos los eventos, entradas de lineup y el timer_state en una sola transacción.

## Relacionado

- [[statistics-screens]] — pantallas de registro y estadísticas
- [[data-model]] — entidades Session, Event, MatchLineup
- [[auth-and-users]] — permisos de control del timer
