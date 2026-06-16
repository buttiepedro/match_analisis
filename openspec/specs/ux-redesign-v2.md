---
title: Rediseño UX/UI v2 — Módulos de Jugador y Navegación
status: active
created: 2026-06-16
---

# Rediseño UX/UI v2 — Módulos de Jugador y Navegación

## Visión General

La v2 expande match_analisis de una app de registro de partidos a una plataforma integral de gestión de plantel. Se agregan dos módulos nuevos (Datos del Jugador y Tests Físicos), se rediseña la navegación con una barra inferior, y se incorpora la funcionalidad de mover jugadores entre divisiones.

La experiencia está diseñada para entrenadores y analistas que usan el celular en campo y en gimnasio — pantallas limpias, acciones directas, mínimo scroll.

---

## Arquitectura de Información (IA)

### Navegación Principal — Bottom Tab Bar (5 ítems)

```
┌────────────────────────────────────────────────────────────┐
│                                                            │
│                    [CONTENIDO PRINCIPAL]                   │
│                                                            │
├──────────┬──────────┬──────────┬──────────┬───────────────┤
│ Partidos │  Plantel │ Físico   │ Torneos  │  Config       │
│  🏉       │   👥     │   💪     │  🏆      │   ⚙️          │
└──────────┴──────────┴──────────┴──────────┴───────────────┘
```

| Tab | Ruta base | Rol mínimo | Descripción |
|-----|-----------|------------|-------------|
| Partidos | `/sessions` | ANALYST | Lista sesiones + tablero de partido |
| Plantel | `/squad` | ANALYST | Jugadores por división + mover jugadores |
| Físico | `/performance` | ANALYST | Datos antropométricos + tests físicos |
| Torneos | `/tournaments` | CLUB_ADMIN | Gestión torneos/divisiones |
| Config | `/settings` | CLUB_ADMIN | Usuarios, club, exportación |

El ANALYST ve Partidos, Plantel y Físico. CLUB_ADMIN y MATCH_DIRECTOR ven todo.

---

## Módulo 1: Plantel (`/squad`)

### Layout

```
┌───────────────────────────────────────────────────┐
│  Plantel                           [+ Jugador]    │
│  ─────────────────────────────────────────        │
│  [M17 ▼]  [Primera ▼]  [Femenino ▼]  ...         │  ← Division pills
├───────────────────────────────────────────────────┤
│  [🔍 Buscar jugador...]                           │
│  [☐ Todos]   [Mover a... ▼]  (visible en multi)  │
├───────────────────────────────────────────────────┤
│  ☐  #10  Juan García    · Apertura   →            │
│  ☐  #7   Lucía Méndez   · Ala        →            │
│  ☐  #3   Rodrigo López  · Pilar      →            │
│  ☐  #15  Ana Torres     · Fullback   →            │
└───────────────────────────────────────────────────┘
```

### Estados del listado

**Modo normal**: tocar una fila abre el perfil del jugador.

**Modo multi-selección**: se activa con un long-press sobre cualquier fila. Al entrar en este modo:
- Aparece checkbox en cada fila
- Header cambia: muestra "N seleccionados" y botón "Mover a..."
- Ícono "+" desaparece
- Botón "✕ Cancelar" en header

**Chip de división**: filtra la lista. Estado inicial = primera división activa del club. "Todos" muestra todo el plantel.

### Funcionalidad: Mover Jugadores

```
1. Long-press en jugador (o tap en ☐) → activa modo multi-select
2. Seleccionar jugadores (☐ por fila, o [Todos] para todos los visibles)
3. Tap "Mover a..." → bottom sheet con lista de divisiones (excluye la actual)
4. Seleccionar destino → diálogo de confirmación:
   "¿Mover 3 jugadores a M17?"  [Cancelar]  [Confirmar]
5. PATCH /players/batch-move → { player_ids: [...], division_id: "..." }
6. Toast de éxito → vuelve a modo normal
```

**Batch API:**
```
PATCH /api/players/batch-move
Body: { player_ids: UUID[], to_division_id: UUID }
Auth: CLUB_ADMIN o MATCH_DIRECTOR
```

La división anterior queda registrada en `player_division_history`.

### Perfil de Jugador (`/squad/:player_id`)

```
┌──────────────────────────────────────────┐
│  ← Juan García              [✏ Editar]   │
│  #10  ·  Apertura  ·  M17               │
│  ──────────────────────────────────────  │
│  [Datos]  [Físico]  [Historial]          │  ← 3 sub-tabs
├──────────────────────────────────────────┤
│            [CONTENIDO DEL SUB-TAB]       │
└──────────────────────────────────────────┘
```

#### Sub-tab "Datos"
- Foto (circular, 80px), nombre, número, posición, fecha de nacimiento
- División actual
- Botón "Ver historial de divisiones" → abre lista de movimientos

#### Sub-tab "Físico" 
- Vincula a los datos antropométricos más recientes (ver Módulo 2)
- Sparkline de peso de los últimos 6 registros
- Botón "Nueva medición"

#### Sub-tab "Historial"
- Timeline vertical de divisiones: `M17 → Primera (01/03/2026)`, etc.

---

## Módulo 2: Datos Antropométricos (`/performance/:player_id/measurements`)

### Pantalla de detalle del jugador (tab "Físico")

```
┌──────────────────────────────────────────────────┐
│  Datos Físicos — Juan García    [+ Nueva]        │
│  ────────────────────────────────────────────    │
│  Última medición: 10/06/2026                     │
│                                                  │
│  Peso:  82.4 kg   ↑ 1.2 kg vs anterior           │
│  Altura: 181 cm                                  │
│  IMC:   25.1  (Saludable)                        │
│                                                  │
│  Pliegues:                                       │
│  · Tricipital:    12 mm                          │
│  · Subescapular:  15 mm                          │
│  · Suprailíaco:   18 mm                          │
│  · Abdominal:     20 mm                          │
│  % Grasa est.:    14.2%  (Durnin-Womersley)     │
│                                                  │
│  ──── Evolución (Peso) ────                      │
│  [Sparkline de los últimos 6 registros]          │
│                                                  │
│  ──── Historial ────                             │
│  10/06/2026  82.4kg  25.1 IMC  14.2%  →          │
│  15/05/2026  81.2kg  24.7 IMC  14.8%  →          │
└──────────────────────────────────────────────────┘
```

### Formulario: Nueva Medición

```
┌──────────────────────────────────────────────────┐
│  ← Nueva Medición — Juan García                  │
│  ────────────────────────────────────────────    │
│  Fecha *          [ 10/06/2026    📅 ]           │
│                                                  │
│  Peso (kg) *      [ 82.4 ]                      │
│  Altura (cm)      [ 181  ]   (auto del perfil)  │
│  IMC              [ 25.1 ]   (calculado)        │
│                                                  │
│  Pliegues cutáneos (mm)                          │
│  Tricipital       [ 12  ]                       │
│  Subescapular     [ 15  ]                       │
│  Suprailíaco      [ 18  ]                       │
│  Abdominal        [ 20  ]                       │
│  % Grasa          [ 14.2 ]  (Durnin-Womersley) │
│                                                  │
│  Notas            [ _____________________ ]     │
│                                                  │
│                   [  Guardar medición  ]         │
└──────────────────────────────────────────────────┘
```

**Cálculos automáticos:**
- `IMC = peso / (altura_m)²`
- `% grasa = Durnin-Womersley (4 pliegues + edad + sexo)`

---

## Módulo 3: Tests Físicos (`/performance/:player_id/tests`)

### Tipos de test soportados

| Categoría | Test | Unidad | Ejemplo |
|-----------|------|--------|---------|
| Velocidad | Sprint 10m | segundos | 1.72 s |
| Velocidad | Sprint 20m | segundos | 2.88 s |
| Velocidad | Sprint 40m | segundos | 5.12 s |
| Aceleración | Aceleración 5m | segundos | 1.05 s |
| Aeróbico | Bronco Test | minutos:segundos | 4:55 |
| Fuerza | Press banca 1RM | kg | 95 kg |
| Fuerza | Sentadilla 1RM | kg | 120 kg |
| Fuerza | Hip thrust 1RM | kg | 140 kg |
| Fuerza | Press hombro 1RM | kg | 60 kg |
| Salto | Salto vertical (CMJ) | cm | 42 cm |
| Salto | Salto horizontal | metros | 2.30 m |
| Flexibilidad | Sit and reach | cm | 18 cm |
| Resistencia | VO2max estimado | ml/kg/min | 52.4 |

### Pantalla de Tests (tab "Tests" en Perfil)

```
┌──────────────────────────────────────────────────┐
│  Tests Físicos — Juan García    [+ Nuevo test]   │
│  ────────────────────────────────────────────    │
│  [Velocidad ▼] [Fuerza ▼] [Todos]               │  ← filtros
│                                                  │
│  ──── Sprint 10m ────                            │
│  Último: 1.72s (10/06/2026)  ↓ 0.04s mejor      │
│  [Sparkline de evolución]                        │
│                                                  │
│  ──── Bronco Test ────                           │
│  Último: 4:55 (10/06/2026)  ↑ 0:12 mejor        │
│  [Sparkline de evolución]                        │
│                                                  │
│  ──── Press Banca 1RM ────                       │
│  Último: 95 kg (10/06/2026)                     │
│  [Sparkline de evolución]                        │
└──────────────────────────────────────────────────┘
```

### Formulario: Nuevo Test

```
┌──────────────────────────────────────────────────┐
│  ← Nuevo Test                                    │
│  ────────────────────────────────────────────    │
│  Fecha *          [ 10/06/2026    📅 ]           │
│                                                  │
│  Tipo de test *   [ Seleccionar...         ▼ ]  │
│                   (categorías agrupadas)         │
│                                                  │
│  Resultado *      [ _____ ]  unidad: segundos    │
│                   (unidad cambia según test)     │
│                                                  │
│  Notas            [ _____________________ ]     │
│                                                  │
│                   [  Guardar test  ]             │
└──────────────────────────────────────────────────┘
```

---

## Módulo 4: Tests por División (`/performance`)

Vista agregada para el cuerpo técnico — compara todos los jugadores de una división en un test específico.

```
┌──────────────────────────────────────────────────┐
│  Rendimiento                                     │
│  [División: M17 ▼]  [Test: Bronco ▼]            │
│  [Fecha: 10/06/2026 ▼]                          │
│  ────────────────────────────────────────────   │
│  Ranking — Bronco Test (10/06/2026)              │
│                                                  │
│   1.  García, J.      4:55  ████████████████     │
│   2.  Méndez, L.      5:02  ███████████████      │
│   3.  López, R.       5:18  █████████████        │
│   4.  Torres, A.      5:35  ████████████         │
│   ...                                            │
│                                                  │
│  Promedio división:  5:12                        │
└──────────────────────────────────────────────────┘
```

---

## Extensiones al Modelo de Datos

### Tabla: `players`

```sql
players
  id               UUID PK
  club_id          UUID FK → clubs.id
  division_id      UUID FK → divisions.id   -- división actual
  full_name        VARCHAR(100) NOT NULL
  jersey_number    SMALLINT
  position         VARCHAR(50)
  date_of_birth    DATE
  sex              ENUM('M', 'F', 'other')
  photo_url        VARCHAR(500)
  is_active        BOOLEAN DEFAULT TRUE
  created_at       TIMESTAMP
  updated_at       TIMESTAMP
```

### Tabla: `player_division_history`

```sql
player_division_history
  id           UUID PK
  player_id    UUID FK → players.id
  division_id  UUID FK → divisions.id
  from_date    DATE NOT NULL
  to_date      DATE NULL   -- NULL = división actual
  moved_by     UUID FK → users.id
  created_at   TIMESTAMP
```

### Tabla: `player_measurements`

```sql
player_measurements
  id                      UUID PK
  player_id               UUID FK → players.id
  measured_at             DATE NOT NULL
  weight_kg               DECIMAL(5,2)
  height_cm               DECIMAL(5,1)
  bmi                     DECIMAL(4,2)        -- calculado backend
  fat_fold_tricep_mm      DECIMAL(4,1)
  fat_fold_subscapular_mm DECIMAL(4,1)
  fat_fold_suprailiac_mm  DECIMAL(4,1)
  fat_fold_abdominal_mm   DECIMAL(4,1)
  body_fat_percent        DECIMAL(4,1)        -- calculado backend (Durnin-Womersley)
  notes                   TEXT
  recorded_by             UUID FK → users.id
  created_at              TIMESTAMP
```

### Tabla: `physical_tests`

```sql
physical_tests
  id          UUID PK
  player_id   UUID FK → players.id
  test_date   DATE NOT NULL
  test_type   VARCHAR(50) NOT NULL   -- ver catálogo arriba
  value       DECIMAL(8,3) NOT NULL
  unit        VARCHAR(20) NOT NULL   -- 'seconds', 'kg', 'cm', 'm', 'ml_kg_min'
  notes       TEXT
  recorded_by UUID FK → users.id
  created_at  TIMESTAMP
```

---

## API Endpoints Nuevos

### Jugadores

| Método | Ruta | Descripción | Rol |
|--------|------|-------------|-----|
| GET | `/clubs/{id}/players` | Listar jugadores del club | ANALYST |
| GET | `/divisions/{id}/players` | Listar por división | ANALYST |
| POST | `/clubs/{id}/players` | Crear jugador | CLUB_ADMIN |
| GET | `/players/{id}` | Perfil del jugador | ANALYST |
| PATCH | `/players/{id}` | Editar jugador | CLUB_ADMIN |
| PATCH | `/players/batch-move` | Mover al nueva división | CLUB_ADMIN / M_DIRECTOR |

### Mediciones Antropométricas

| Método | Ruta | Descripción | Rol |
|--------|------|-------------|-----|
| GET | `/players/{id}/measurements` | Historial de mediciones | ANALYST |
| POST | `/players/{id}/measurements` | Nueva medición | ANALYST |
| DELETE | `/players/{id}/measurements/{m_id}` | Eliminar medición | CLUB_ADMIN |

### Tests Físicos

| Método | Ruta | Descripción | Rol |
|--------|------|-------------|-----|
| GET | `/players/{id}/tests` | Historial de tests | ANALYST |
| GET | `/players/{id}/tests?type=bronco` | Filtrar por tipo | ANALYST |
| POST | `/players/{id}/tests` | Nuevo resultado | ANALYST |
| DELETE | `/players/{id}/tests/{t_id}` | Eliminar resultado | CLUB_ADMIN |
| GET | `/divisions/{id}/tests/ranking` | Ranking por test y fecha | MATCH_DIRECTOR |

---

## Principios UX de la Revisión

1. **Una acción por pantalla**: cada pantalla tiene un objetivo primario claro (registrar, listar, comparar).
2. **Cero modales innecesarios**: preferir inline editing y bottom sheets sobre modales de diálogo.
3. **Feedback inmediato**: toasts de 2s, indicadores de delta (↑↓) en mediciones vs anterior.
4. **Jerarquía visual en cards**: número de camiseta grande, nombre secundario, posición terciaria.
5. **Colores semánticos**: verde = mejora, naranja = estable, rojo = regresión (para deltas de tests).
6. **Sin estado vacío huérfano**: toda lista vacía tiene un CTA (ej. "Agregar primer jugador →").
7. **Multi-selección discernible**: modo selección cambia fondo de header a color de acento.

---

## Relacionado

- [[data-model]] — entidades base del sistema
- [[auth-and-users]] — permisos por rol
- [[match-session]] — módulo de partidos (sin cambios en v2)
- [[statistics-screens]] — pantalla de estadísticas (sin cambios en v2)
