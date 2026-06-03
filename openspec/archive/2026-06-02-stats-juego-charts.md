---
title: Nuevos gráficos en Sección Juego de Stats
type: feature
status: done
spec: statistics-screens
created: 2026-06-02
archived: 2026-06-02
---

# Nuevos gráficos en Sección Juego de Stats

## Cambios implementados

Se extendió la sección "Juego" de `Stats.tsx` con los nuevos event types registrados en la pantalla de Juego.

### Gráficos nuevos

| Gráfico | Event types | Nota |
|---|---|---|
| Tackles | `tackle_effective`, `tackle_missed`, `tackle_positive` | Solo club (team: home) |
| Ataque | `line_break`, `offload` | Solo club |
| Posesión por motivo | `possession_lost`, `ball_won` × reason | Solo club; motivos: ruck/maul/contacto/pesca/patada/knock_on |
| Salidas | `exit_favor`, `exit_against` | Mismo patrón que Lines/Scrums |

Todos los gráficos nuevos son condicionales — se omiten si no hay datos.

### Timeline

Se agregaron todos los nuevos event types al mapping `EVENT_CATEGORY` / `EVENT_LABEL`:
- `tackle_positive` → Tackles
- `exit_favor`, `exit_against` → Lines
- `possession_lost`, `ball_won`, `line_break`, `offload` → Posesión

## Archivos modificados

- `frontend/src/pages/Stats.tsx`

## Checklist

- [x] `tacklesOption()`: bar horizontal Concretado/Errado/Positivo
- [x] `attackOption()`: bar horizontal Quiebres/Offloads
- [x] `possessionBreakdownOption()`: bar agrupado Perdidas vs Ganadas por motivo
- [x] Salidas usando `setpieceOption("Salidas", "exit_favor", "exit_against", ...)`
- [x] `EVENT_CATEGORY` / `EVENT_LABEL` actualizados para timeline
- [x] `statistics-screens.md` spec actualizado
