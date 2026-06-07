---
title: Reestructura del Tablero — Scoring a Juego, Cambios simplificado, Swipe
type: feature
status: in-progress
spec: statistics-screens
created: 2026-06-07
---

# Reestructura del Tablero

## Cambios

### Tab Juego (`JuegoEventos.tsx`)

- `activeTeam` derivado del modo: `mode === "attack" ? "home" : "away"` (antes siempre `"home"`)
- Penal / Try / Drop agregados al pie de **ambos** modos (Ataque y Defensa)
- Flujo Penal: razón (Line/Scrum/Juega/A los palos) → si A los palos → conversión
- Flujo Try: conversión directa
- Drop: registra sin modal
- `JUEGO_EVENT_TYPES` actualizado con `"try"`, `"penalty"`, `"drop"`

### Tab Cambios (`PenaltiesPossession.tsx`, ex-Eventos)

- Eliminados: Try, Penal, Drop, Error y sus flujos multi-paso
- Conservados: score card (lee eventos de Juego), Amarilla, Roja, Registrar Cambio
- EventLog simplificado: `["yellow_card", "red_card", "substitution"]`

### Session.tsx

- Label "Eventos" → "Cambios"
- Swipe horizontal entre los 3 tabs (umbral 50px, `onTouchStart`/`onTouchEnd`)

## Archivos modificados

- `frontend/src/components/tabs/JuegoEventos.tsx`
- `frontend/src/components/tabs/PenaltiesPossession.tsx`
- `frontend/src/pages/Session.tsx`
- `openspec/specs/statistics-screens.md`

## Checklist

- [x] Penal/Try/Drop en modo Ataque → `team: "home"`
- [x] Penal/Try/Drop en modo Defensa → `team: "away"`
- [x] Penal "A los palos" muestra paso de conversión con botón "← Volver"
- [x] Penal Line/Scrum/Juega → submit directo sin paso extra
- [x] Try → conversión → registra con `metadata.converted`
- [x] Drop → registro inmediato
- [x] Auto-switch Perdida→Defensa y Pelota Ganada→Ataque sigue funcionando
- [x] Tab "Cambios": Amarilla/Roja muestran selector de equipo
- [x] Score card muestra puntos de tries/penales de Juego
- [x] Swipe izquierda/derecha navega entre tabs
- [x] Spec `statistics-screens.md` actualizado
