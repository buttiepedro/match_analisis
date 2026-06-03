---
title: Mejoras Post-V1 (Timer, Lineup, EventLog, Stats, Delete)
type: feature
status: done
spec: match-session
created: 2026-05-30
archived: 2026-05-30
---

# Mejoras Post-V1

Features implementadas después del scaffold inicial, no cubiertas en los changes originales.

## Cambios Implementados

### Timer
- [x] Acción `reset` — vuelve el timer a 00:00 stopped (botón ↺ cuando pausado)
- [x] Acción `set` — ajusta el tiempo exacto via inputs mm:ss (corrección de errores)
- [x] Coerción de `seconds` a `int` en el handler WebSocket (fix bug float→DB)
- [x] Reset de estado `correcting` en Timer.tsx cuando el timer reanuda

### Jugadores en Eventos
- [x] Campo `player_id` (UUID FK a players) en tabla `events`
- [x] `EventCreate` acepta `player_id` en lugar de `player_number`
- [x] El endpoint de registro resuelve `player_number` desde el lineup automáticamente
- [x] `EventResponse` expone `player_id` y `metadata`
- [x] Migration 0003: columna `player_id` + índice (downgrade idempotente)

### Gestión de Lineup Pre-Partido
- [x] Página `/sessions/:id/lineup` separada del tablero de partido
- [x] Búsqueda de jugadores por nombre (filtro client-side)
- [x] Edición de número de camiseta inline (`PATCH /sessions/:id/lineup/:id`)
- [x] Eliminación de jugador del lineup (`DELETE /sessions/:id/lineup/:id`)
- [x] Updates optimistas en frontend (sin refetch innecesario)
- [x] `LineupEntryUpdate` limitado a `jersey_number` y `position` — status solo via `/substitute`
- [x] Botón "Alineación →" en cards de partidos (Dashboard y Torneos)

### Eliminación de Partidos
- [x] `DELETE /sessions/:id` — elimina eventos, lineup y timer_state en cascada
- [x] Limpieza del timer en memoria (`manager.remove_session`)
- [x] Confirmación inline en Dashboard y Torneos antes de eliminar

### Event Log por Tab
- [x] Componente `EventLog` — muestra eventos del tab en orden inverso
- [x] `DELETE /sessions/:id/events/:id` — eliminar eventos (disponible para ANALYST+)
- [x] `removeEvent` en sessionStore para update optimista
- [x] Tab Tackles: `tackle_effective`, `tackle_missed`, `substitution`
- [x] Tab Lines & Scrum: `lineout_*`, `scrum_*`
- [x] Tab Penales: penales, tarjetas, posesión

### Pantalla de Estadísticas
- [x] Ruta `/stats` con dos vistas: Por jugador y Por partido
- [x] Carga en paralelo de eventos y lineup para todas las sesiones del club
- [x] Manejo de error: muestra mensaje si la carga falla
- [x] Agregado en cliente — no requiere endpoint nuevo en backend

### Menú de Navegación
- [x] Sidebar fijo (desktop) + drawer hamburger (mobile)
- [x] Nav items por rol: superadmin (Clubes), club_admin (5 páginas + Stats), match_director/analyst (Partidos + Stats)
- [x] Estadísticas visible para club_admin, match_director y analyst

## Code Review Fixes

- [x] WS `seconds` coerción a int (previene float→DB Integer error)
- [x] `correcting` state reset en Timer cuando timer reanuda
- [x] `LineupEntryUpdate.status` eliminado (bypass de substitution)
- [x] `handleDelete` en SessionLineup: update optimista sin refetch
- [x] Migration 0003 downgrade idempotente con `_has_index` guard
- [x] Stats.tsx error handling (catch + loadError state)
- [x] `delete_event` usa `get_current_user` (analysts pueden eliminar sus errores)

## Impacto en Specs

- `match-session.md` — actualizado con acciones `reset`/`set`, `player_id` en eventos, endpoint DELETE
- `statistics-screens.md` — actualizado con EventLog, player picker, Stats page, Lineup pre-partido
