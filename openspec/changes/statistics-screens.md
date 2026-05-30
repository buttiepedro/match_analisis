---
title: Pantallas de Estadísticas (Frontend)
type: feature
status: in-progress
spec: statistics-screens
created: 2026-05-30
---

# Pantallas de Estadísticas — Frontend

## Objetivo

Implementar el tablero de sesión mobile-first con timer en tiempo real y tres tabs de registro de eventos.

## Alcance

- [x] `store/sessionStore.ts` — estado global de sesión, timer y eventos (Zustand)
- [x] `lib/ws.ts` — cliente WebSocket con reconexión automática
- [x] `components/Timer.tsx` — display del timer + controles para admin/match_director
- [x] `components/EventButton.tsx` — botón de acción con modal de confirmación
- [x] `components/tabs/Tackles.tsx` — tab de tackles y rucks
- [x] `components/tabs/LinesScrum.tsx` — tab de line-outs y scrums
- [x] `components/tabs/PenaltiesPossession.tsx` — tab de penales y posesión
- [x] `pages/Session.tsx` — tablero principal: timer + tabs
- [x] `App.tsx` — conectar ruta `/sessions/:id` al componente real

## UX del EventButton

1. Usuario toca un botón grande (ej: "✓ TACKLE — LOCAL")
2. Aparece un bottom-sheet con timer actual + campo opcional de jugador/razón
3. Confirma → POST /sessions/{id}/events
4. Toast de confirmación → contadores actualizados

## Dependencias

- `session-timer` completado (backend WebSocket corriendo)

## Notas

- WS se conecta al montar Session.tsx, desconecta al desmontar
- El timer local se interpola desde `elapsed_seconds` + `server_timestamp` del último mensaje WS
- Los contadores por tab se computan de los eventos acumulados en el store
