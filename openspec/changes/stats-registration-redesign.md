---
title: Rediseño pantallas de registro de stats
type: feature
status: completed
spec: statistics-screens
created: 2026-06-02
---

# Rediseño pantallas de registro de stats

## Cambios implementados

### 1. Tab "Lines & Scrum" — nueva sección Salidas

Se agregó tracking de salidas (propias y rival) con/sin recepción, tanto para line como para scrum.

Nuevos event types:
- `line_exit` — `metadata: { team: "own"|"rival", reception: boolean }`
- `scrum_exit` — `metadata: { team: "own"|"rival", reception: boolean }`

Archivos modificados: `LinesScrum.tsx`

### 2. Tab "Tackles" → "Juego" — pantalla de eventos de ataque y defensa

Se reemplazó la pantalla de tackles por jugador por una pantalla de eventos por equipo.

#### Eventos de ataque (por equipo activo)
- `line_break` — Quiebre
- `offload` — Offload
- `possession_lost` + reason — Perdida (auto-cambia equipo activo al registrar)

#### Eventos de defensa (por equipo activo)
- `tackle_effective` — Concretado
- `tackle_missed` — Errado
- `tackle_positive` — Positivo
- `ball_won` + reason — Pelota Ganada

#### Motivos compartidos (para Perdida y Pelota Ganada)
`ruck` | `maul` | `contacto` | `pesca` | `patada` | `knock_on`

#### Toggle de equipo
Manual (Propia / Rival) + auto-switch a equipo contrario al registrar "Perdida".

#### Cambios (substituciones)
El botón "Registrar Cambio" se trasladó a esta pantalla.

Archivos creados: `JuegoEventos.tsx`
Archivos modificados: `Session.tsx`

### 3. EventLog

Se agregaron labels para todos los nuevos tipos de eventos y reasons.

Archivos modificados: `EventLog.tsx`

## Checklist

- [x] `EventLog.tsx`: nuevos EVENT_LABELS, REASON_LABELS, rama isExit
- [x] `LinesScrum.tsx`: sección Salidas con ExitModal y ExitCounter
- [x] `JuegoEventos.tsx`: componente nuevo con toggle, ataque, defensa, modal de motivos
- [x] `Session.tsx`: swap de Tackles → JuegoEventos, label "Juego"
