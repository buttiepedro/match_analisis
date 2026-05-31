---
title: Rediseño Tab Eventos + Estadísticas completas
type: feature
status: done
spec: statistics-screens
created: 2026-05-31
archived: 2026-05-31
---

# Rediseño Tab Eventos + Estadísticas

## Contexto

El tab "Penales" original usaba una grilla 2 columnas (Local/Visitante) con botones planos. Las estadísticas solo tenían gráficos básicos de penales, scrums y lines. Se rediseñó completamente para soportar un modelo de eventos rugby más completo y una pantalla de estadísticas interactiva.

## Cambios Implementados

### Tab Eventos (ex "Penales")

- [x] Renombrar tab "Penales" → "Eventos" (`Session.tsx`)
- [x] Nueva UI: botones full-width (Try / Penal / Error / Drop) + grid 2 columnas para Disciplina
- [x] Bottom-sheet multi-paso para cada evento:
  - Try → equipo → Convertido/No
  - Penal → equipo → Line/Scrum/Juega/A los palos → (si A los palos) Convertido/No
  - Error → equipo → Knock-on/Forward/Perdida en contacto
  - Drop → equipo (auto-submit)
  - Disciplina → equipo (auto-submit)
- [x] Navegación back/cancel en todos los pasos
- [x] Nuevos event_types: `try`, `penalty`, `drop`, `lost_in_contact`
- [x] `reason` en penalty: `line | scrum | juega | a_los_palos`
- [x] `metadata.converted` en try y penalty a_los_palos

### Contadores en Eventos (header)

- [x] Marcador de puntos por equipo calculado en tiempo real desde el store
- [x] Desglose: try=5+2, penal a palos=3, drop=3
- [x] Contadores de amarillas y rojas por equipo

### Contadores en Lines & Scrum

- [x] Card de contadores sobre los botones de Lines y Scrums
- [x] Ganados/Perdidos para "A favor" y "En contra" via `metadata.obtained`

### EventLog actualizado

- [x] Labels: `try`, `penalty`, `drop`, `lost_in_contact`
- [x] Reason labels: `line`, `scrum`, `juega`, `a_los_palos`
- [x] Muestra `· Convertido` / `· No convertido` para try y penalty

### Rediseño Stats (`/stats`)

- [x] Filtro de categoría: pills `Todos | Puntos | Juego | Errores | Disciplina`
- [x] Marcador con desglose (ScoreSummary — stat cards, sin ECharts)
- [x] Nuevo chart: **Tries** — stacked bar Convertidos/No convertidos por equipo
- [x] Nuevo chart: **Penales por destino** — bar horizontal por reason, tooltip con conversiones
- [x] Nuevo chart: **Drops** — bar simple (solo si hay datos)
- [x] Nuevo chart: **Errores** — Knock-on/Forward/Perdida por equipo
- [x] Timeline: categoría "Penales" renombrada a "Puntos"; incluye try/penalty/drop
- [x] `reason` agregado a `RawEvent` interface

### Normalización por club en Stats

- [x] `GET /clubs/{id}` para obtener nombre del club al cargar
- [x] `userTeam: "home" | "away"` en cada `LoadedSession`
- [x] `NormalizedEvent` con `isUserClub: bool` — eventos etiquetados por club real
- [x] Todos los charts usan `isUserClub` en lugar de `team === "home"`
- [x] Club del usuario siempre a la izquierda; rival = "Rivales" en agregado
- [x] Dropdown de sesiones muestra `{club} vs {rival}` (no "local vs visitante")

## Archivos modificados

| Archivo | Cambio |
|---------|--------|
| `frontend/src/components/tabs/PenaltiesPossession.tsx` | Reescritura completa → componente `Events` |
| `frontend/src/components/tabs/LinesScrum.tsx` | Contadores de obtención |
| `frontend/src/components/EventLog.tsx` | Nuevos labels y lógica de conversión |
| `frontend/src/pages/Session.tsx` | Tab renombrado, props limpiadas |
| `frontend/src/pages/Stats.tsx` | Reescritura completa |

## No requirió cambios en backend

Los nuevos `event_type` y `reason` son strings VARCHAR libres — sin migraciones ni cambios en schemas Pydantic.

## Relacionado

- [[statistics-screens]] — spec actualizada
- [[match-session]] — tabla de event_types actualizada
