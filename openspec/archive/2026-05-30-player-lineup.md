---
title: Jugadores, Lineup y Rediseño de Pantallas
type: feature
status: done
archived: 2026-05-30
spec: statistics-screens
created: 2026-05-30
---

# Jugadores, Lineup y Rediseño de Pantallas

## Objetivo

Agregar gestión de jugadores por división y lineup por partido. Rediseñar las pantallas de Tackles y Lines & Scrum para que reflejen la realidad del partido.

## Nuevas Entidades

### Player (pertenece a una División)
- `name`, `position` (puesto libre), `is_active`
- Se definen desde el panel del club_admin

### MatchLineup (jugadores de UN partido)
- Relaciona un Player con una Session
- `jersey_number`: número de camiseta para ese partido (puede diferir del número habitual)
- `position`: posición jugada en ese partido
- `team`: "home" | "away" (de cuál equipo es el jugador)
- `status`: "on_field" | "bench" | "substituted_out"

## Alcance

### Backend
- [x] `Player` model + `MatchLineup` model
- [x] Migración `0002_players_and_lineup`
- [x] `POST /divisions/{id}/players` — agregar jugador a división
- [x] `GET /divisions/{id}/players` — listar jugadores de la división
- [x] `PATCH /divisions/{id}/players/{player_id}` — editar jugador
- [x] `DELETE /divisions/{id}/players/{player_id}` — soft delete
- [x] `POST /sessions/{id}/lineup` — agregar jugador al lineup del partido
- [x] `GET /sessions/{id}/lineup` — obtener lineup completo
- [x] `POST /sessions/{id}/lineup/substitute` — cambio de jugador (actualiza status + registra evento `substitution`)

### Frontend
- [x] Pantalla Tackles rediseñada: lista de 15 jugadores en cancha con [Errado] / [Efectivo]
- [x] `SubstitutionModal.tsx`: modal para registrar cambios
- [x] Sección de suplentes en Tackles con jugadores en banco
- [x] Pantalla Lines & Scrum: 4 botones → popup `Con obtención` / `Sin obtención`

## Nuevos Event Types

| Tipo | Descripción |
|------|-------------|
| `tackle_effective` | Tackle efectivo (por jugador) |
| `tackle_missed` | Tackle errado (por jugador) |
| `lineout_favor` | Line a favor — metadata.obtained: bool |
| `lineout_against` | Line en contra — metadata.obtained: bool |
| `scrum_favor` | Scrum a favor — metadata.obtained: bool |
| `scrum_against` | Scrum en contra — metadata.obtained: bool |
| `substitution` | Cambio — metadata.player_out_id, player_in_id, numbers |

## Rediseño: Pantalla Tackles

```
EN CANCHA
#7  Juan Pérez    [Errado]  [Efectivo]
#2  Carlos Soto   [Errado]  [Efectivo]
... (15 jugadores)

[Registrar Cambio]

SUPLENTES
#16 Diego Ruiz    (bench)
```

## Rediseño: Lines & Scrum

```
[LINE A FAVOR]       → popup: [Con obtención] / [Sin obtención]
[LINE EN CONTRA]     → popup: [Con obtención] / [Sin obtención]
[SCRUM A FAVOR]      → popup: [Con obtención] / [Sin obtención]
[SCRUM EN CONTRA]    → popup: [Con obtención] / [Sin obtención]
```

## Dependencias

- `statistics-screens` completado
