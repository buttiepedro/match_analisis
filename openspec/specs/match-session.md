---
title: Sesión de Partido y Timer
status: active
created: 2026-05-29
---

# Sesión de Partido y Timer

## Visión General

Una "sesión" representa un partido de rugby en curso o finalizado. El admin de la sesión controla el timer, y todos los participantes conectados lo ven en tiempo real via WebSocket. Cada evento registrado (tackle, line-out, scrum, penal, etc.) queda sellado con el timestamp del timer en el momento del registro.

## Estructura de una Sesión

- Pertenece a un **torneo** → una **división** → un **club**
- Tiene dos equipos: **local** y **visitante**
- Tiene dos tiempos de juego (halves) de duración configurable (default: 40 min)
- Estado: `scheduled` → `active` → `halftime` → `active` → `finished`

## Timer

### Comportamiento

| Acción | Quién puede | Efecto |
|--------|-------------|--------|
| Iniciar timer | CLUB_ADMIN, MATCH_DIRECTOR | Empieza a contar desde 00:00 |
| Pausar timer | CLUB_ADMIN, MATCH_DIRECTOR | Congela el tiempo |
| Reanudar timer | CLUB_ADMIN, MATCH_DIRECTOR | Continúa desde donde se pausó |
| Ir al descanso | CLUB_ADMIN, MATCH_DIRECTOR | Congela, marca fin del 1er tiempo |
| Iniciar 2do tiempo | CLUB_ADMIN, MATCH_DIRECTOR | Reinicia desde 00:00 del 2do tiempo |
| Finalizar partido | CLUB_ADMIN, MATCH_DIRECTOR | Estado → `finished`, timer bloqueado |

### Distribución en Tiempo Real (WebSocket)

```
Servidor mantiene estado del timer por sesión:
{
  session_id: uuid,
  half: 1 | 2,
  status: "stopped" | "running" | "paused" | "halftime" | "finished",
  elapsed_seconds: number,
  server_timestamp: ISO8601
}
```

- El cliente se suscribe al canal `ws://backend/ws/session/{session_id}`
- El servidor emite el estado del timer cada segundo cuando está corriendo
- Los clientes calculan el tiempo local interpolando desde `elapsed_seconds` + `server_timestamp`
- Al reconectar, el cliente recibe el estado actual inmediatamente

### Formato de Visualización

```
[1T]  23:45
[2T]  07:12
```

- Minutos y segundos del tiempo transcurrido en el half actual
- Indicador de "1T" o "2T" (primer o segundo tiempo)
- Color verde = corriendo, amarillo = pausado, rojo = finalizado

## Modelo de Evento

Cada evento registrado guarda:

```json
{
  "session_id": "uuid",
  "event_type": "tackle | lineout | scrum | penalty | possession_loss | ...",
  "half": 1,
  "timer_seconds": 1425,
  "recorded_at": "2026-05-29T15:23:45Z",
  "team": "local | visitor",
  "player_number": 7,
  "recorded_by_user_id": "uuid",
  "metadata": {}
}
```

- `timer_seconds`: tiempo del timer en el momento del registro (fuente de verdad para el partido)
- `recorded_at`: timestamp UTC del servidor (para auditoría)
- `metadata`: campo flexible para datos específicos por tipo de evento

## Endpoints REST de Sesión

| Método | Ruta | Descripción | Acceso |
|--------|------|-------------|--------|
| POST | `/tournaments/{t_id}/sessions` | Crear sesión/partido | CLUB_ADMIN |
| GET | `/tournaments/{t_id}/sessions` | Listar sesiones | ANALYST+ |
| GET | `/sessions/{session_id}` | Detalle de sesión | ANALYST+ |
| PATCH | `/sessions/{session_id}/timer` | Controlar timer | CLUB_ADMIN |
| POST | `/sessions/{session_id}/events` | Registrar evento | ANALYST+ |
| GET | `/sessions/{session_id}/events` | Listar eventos | ANALYST+ |
| GET | `/sessions/{session_id}/stats` | Estadísticas calculadas | ANALYST+ |

## Endpoint WebSocket

```
WS /ws/session/{session_id}
Headers: Authorization: Bearer <token>

Mensajes del servidor → cliente:
{ "type": "timer_tick", "data": { ...estado del timer } }
{ "type": "event_registered", "data": { ...evento } }
{ "type": "session_state_change", "data": { "status": "halftime" } }

Mensajes del cliente → servidor (CLUB_ADMIN o MATCH_DIRECTOR):
{ "type": "timer_control", "action": "start" | "pause" | "resume" | "halftime" | "finish" }
```

## Pantallas Frontend

- `/sessions/{id}` — tablero principal de la sesión con timer visible
- Tabs dentro del tablero: Tackles | Lines & Scrum | Penales & Posesión

## Relacionado

- [[statistics-screens]] — pantallas de registro de eventos
- [[data-model]] — entidades Session, Event, Tournament
- [[auth-and-users]] — permisos de control del timer
