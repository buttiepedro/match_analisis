---
title: UX/UI Redesign v2 — Plantel, Datos Físicos y Tests
type: feature
status: in-progress
spec: ux-redesign-v2
created: 2026-06-16
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
- [ ] Reemplazar sidebar por `<BottomNav>` (5 tabs: Partidos, Plantel, Físico, Torneos, Config)
- [ ] Crear rutas base: `/squad`, `/performance`, `/settings`
- [ ] Guardar tab activo en Zustand (persiste entre navigaciones)
- [ ] Badge en tab Plantel cuando hay jugadores sin división

### Fase B: Módulo Plantel
- [ ] Pantalla `/squad`: lista por división con pill-tabs horizontales
- [ ] Búsqueda client-side por nombre o número
- [ ] Perfil de jugador `/squad/:id` con 3 sub-tabs (Datos / Físico / Historial)
- [ ] Formulario de creación/edición de jugador
- [ ] Modo multi-selección (long-press) con checkbox por fila
- [ ] Bottom sheet "Mover a..." con lista de divisiones disponibles
- [ ] `PATCH /players/batch-move` — backend endpoint
- [ ] Toast de confirmación y actualización optimista del store

### Fase C: Modelo de Datos (Backend + Migraciones)
- [ ] Alembic: tabla `players` (con FK a divisions)
- [ ] Alembic: tabla `player_division_history`
- [ ] Alembic: tabla `player_measurements`
- [ ] Alembic: tabla `physical_tests`
- [ ] Endpoints REST para jugadores (CRUD)
- [ ] Endpoints REST para mediciones antropométricas
- [ ] Endpoints REST para tests físicos
- [ ] Endpoint de ranking por división y test

### Fase D: Módulo Físico — Datos Antropométricos
- [ ] Sub-tab "Físico" en perfil de jugador
- [ ] Formulario nueva medición (fecha, peso, altura, pliegues)
- [ ] Cálculo automático de IMC y % grasa (Durnin-Womersley) en backend
- [ ] Card de última medición con deltas (↑↓ vs anterior)
- [ ] Sparkline de evolución de peso (últimos 6 registros)
- [ ] Historial de mediciones con paginación

### Fase E: Módulo Físico — Tests
- [ ] Sub-tab "Tests" en perfil de jugador
- [ ] Formulario nuevo test (tipo, fecha, resultado)
- [ ] Unidades automáticas según tipo de test
- [ ] Sparkline de evolución por tipo de test
- [ ] Vista comparativa por división (`/performance`)
- [ ] Ranking de jugadores por test y fecha

---

## Impacto en Código Existente

| Área | Impacto |
|------|---------|
| `frontend/src/App.tsx` | Agregar rutas nuevas, reemplazar sidebar |
| `frontend/src/components/Layout.tsx` | Nuevo `<BottomNav>` reemplaza `<Sidebar>` |
| `frontend/src/store/` | Nuevo slice para players, measurements, tests |
| `backend/app/routers/` | Nuevos routers: players.py, measurements.py, physical_tests.py |
| `backend/alembic/` | 4 migraciones nuevas (tablas players, history, measurements, tests) |
| `backend/app/models.py` | 4 modelos SQLAlchemy nuevos |

Los módulos existentes (Partidos, Torneos, Stats) **no se modifican** en esta fase.

---

## Criterios de Aceptación

- [ ] Un entrenador puede ver el plantel de una división y mover 3 jugadores a otra en < 5 taps
- [ ] Un analista puede registrar una medición completa (peso + 4 pliegues) en < 30 segundos
- [ ] Los deltas de medición (↑ / ↓) son visibles en la card de última medición
- [ ] El ranking de bronco test de una división carga en < 1 segundo (misma sesión)
- [ ] La navegación bottom tab persiste correctamente al navegar y volver
- [ ] En mobile 375px no hay scroll horizontal en ninguna pantalla principal

---

## Notas de UX

- El long-press para activar multi-selección es la convención estándar en iOS y Android. Alternativamente, un botón "Seleccionar" en el header evita la dependencia de long-press en web.
- La altura se captura en el perfil del jugador (no en cada medición) porque raramente cambia. Se hereda automáticamente al calcular IMC.
- Los pliegues cutáneos son todos opcionales — el % grasa solo se calcula si los 4 están presentes.
- Para el Bronco Test, el valor se registra en segundos totales; la UI lo formatea como MM:SS.

---

## Relacionado

- [[ux-redesign-v2]] — spec principal de esta feature
- [[data-model]] — modelo base que se extiende
- [[auth-and-users]] — permisos aplicados en cada endpoint nuevo
