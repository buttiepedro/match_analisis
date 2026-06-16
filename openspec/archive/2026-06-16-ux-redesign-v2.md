---
title: UX/UI Redesign v2 — Plantel, Datos Físicos y Tests
type: feature
status: completed
spec: ux-redesign-v2
created: 2026-06-16
completed: 2026-06-16
---

# UX/UI Redesign v2 — Plantel, Datos Físicos y Tests

## Descripción del Cambio

Expansión de match_analisis de app de partidos a plataforma integral de plantel. Tres áreas de trabajo:

1. **Navegación rediseñada**: reemplazar sidebar por bottom tab bar de 5 ítems
2. **Módulo Plantel**: gestión de jugadores con mover entre divisiones (batch)
3. **Módulo Físico**: datos antropométricos + tests físicos por jugador con evolución temporal

---

## Fases de Implementación

### Fase A: Navegación y Scaffold de Módulos
- [x] Reemplazar sidebar por `<BottomNav>` (5 tabs: Partidos, Plantel, Físico, Torneos, Config)
- [x] Crear rutas base: `/squad`, `/performance`, `/settings`
- [x] Guardar tab activo en Zustand (persiste entre navigaciones)
- [x] Badge en tab Plantel cuando hay jugadores sin división

### Fase B: Módulo Plantel
- [x] Pantalla `/squad`: lista por división con pill-tabs horizontales
- [x] Búsqueda client-side por nombre o número
- [x] Perfil de jugador `/squad/:id` con 4 sub-tabs (Datos / Físico / Tests / Historial)
- [x] Formulario de creación/edición de jugador
- [x] Modo multi-selección (long-press) con checkbox por fila
- [x] Bottom sheet "Mover a..." con lista de divisiones disponibles
- [x] `PATCH /players/batch-move` — backend endpoint
- [x] Toast de confirmación y actualización optimista del store

### Fase C: Modelo de Datos (Backend + Migraciones)
- [x] Alembic: tabla `players` — extendida con 6 campos nuevos (migración 0008)
- [x] Alembic: tabla `player_division_history` (migración 0007)
- [x] Alembic: tabla `player_measurements` (migración 0007)
- [x] Alembic: tabla `physical_tests` (migración 0007)
- [x] Endpoints REST para jugadores (CRUD) — `players.py`
- [x] Endpoints REST para mediciones antropométricas — `performance.py`
- [x] Endpoints REST para tests físicos — `performance.py`
- [x] Endpoint de ranking por división y test

### Fase D: Módulo Físico — Datos Antropométricos
- [x] Sub-tab "Físico" en perfil de jugador
- [x] Formulario nueva medición (fecha, peso, altura, pliegues)
- [x] Cálculo automático de IMC y % grasa (Durnin-Womersley) en backend
- [x] Card de última medición con deltas (↑↓ vs anterior)
- [x] Historial de mediciones ordenado por fecha
- [x] Botón eliminar por medición (club_admin)

### Fase E: Módulo Físico — Tests
- [x] Sub-tab "Tests" en perfil de jugador
- [x] Formulario nuevo test (tipo, fecha, resultado)
- [x] Unidades automáticas según tipo de test (13 tipos definidos)
- [x] Historial por tipo de test con último resultado destacado
- [x] Vista comparativa por división (`/performance`)
- [x] Ranking de jugadores por test con barras horizontales y medallas

### Fase F (adicional): Import de Jugadores desde Excel
- [x] `POST /import/players-xlsx` — acepta `.xlsx` y `.xls`
- [x] Detección automática de columnas con 30+ aliases
- [x] Upsert por DNI a través de divisiones del club
- [x] Crea `PlayerMeasurement` si hay peso/estatura
- [x] Posiciones estándar UAR "NN - Nombre" en todos los formularios
- [x] Modal de import con resultado detallado (creados/actualizados/omitidos/errores)

---

## Impacto en Código Existente

| Área | Impacto |
|------|---------|
| `frontend/src/App.tsx` | Rutas `/squad`, `/squad/:id`, `/performance`, `/torneos` agregadas |
| `frontend/src/components/Layout.tsx` | `<BottomNav>` (mobile) + `<TopNav>` (desktop) reemplaza sidebar |
| `frontend/src/store/squadStore.ts` | Nuevo store completo: players, divisions, measurements, tests |
| `frontend/src/pages/Squad.tsx` | Nueva página con multi-select, move, import |
| `frontend/src/pages/PlayerProfile.tsx` | Nueva página con 4 sub-tabs |
| `frontend/src/pages/Performance.tsx` | Nueva página con ranking y gráfico de barras |
| `frontend/src/lib/rugby.ts` | Reescrito con posiciones UAR canónicas |
| `backend/app/api/v1/performance.py` | Nuevo router con 9 endpoints |
| `backend/app/api/v1/import_.py` | Import Excel agregado |
| `backend/app/models/player.py` | 3 modelos nuevos + 6 campos en Player |
| `backend/alembic/versions/` | Migraciones 0007 y 0008 |
| `backend/requirements.txt` | openpyxl + xlrd |

---

## Criterios de Aceptación

- [x] Un entrenador puede ver el plantel de una división y mover jugadores a otra en < 5 taps
- [x] Un analista puede registrar una medición completa (peso + 4 pliegues) en < 30 segundos
- [x] Los deltas de medición (↑ / ↓) son visibles en la card de última medición
- [x] El ranking de bronco test de una división carga en < 1 segundo (misma sesión)
- [x] La navegación bottom tab persiste correctamente al navegar y volver
- [x] En mobile 375px no hay scroll horizontal en ninguna pantalla principal

---

## Relacionado

- [[ux-redesign-v2]] — spec principal de esta feature
- [[data-model]] — modelo base que se extiende
- [[auth-and-users]] — permisos aplicados en cada endpoint nuevo
