---
title: Pantallas de Estadísticas y Registro
status: active
created: 2026-05-29
updated: 2026-05-31
---

# Pantallas de Estadísticas y Registro

## Visión General

El tablero de una sesión tiene tres tabs de registro de eventos más el timer siempre visible arriba. El diseño es mobile-first (375px base), botones grandes aptos para uso en campo. Adicionalmente existe una pantalla de estadísticas agregadas accesible desde el menú lateral.

## Layout del Tablero (Session)

```
┌─────────────────────────────┐
│  [1T]  23:45  ▶ ⏸ ⏹  ↺     │  ← Timer + controles (solo admin/director)
│  Equipo Local  vs  Visitante│
├─────────────────────────────┤
│ [Tackles] [Lines/Scrum] [Eventos] │  ← 3 tabs
├─────────────────────────────┤
│    CONTENIDO DEL TAB        │
├─────────────────────────────┤
│    REGISTRO DE EVENTOS      │  ← Log al final de cada tab (eliminable)
└─────────────────────────────┘
```

---

## Tab 1: Tackles

### Eventos

| event_type | Descripción |
|---|---|
| `tackle_effective` | Tackle completado |
| `tackle_missed` | Tackle fallado |

**UI:** Lista de jugadores en cancha (del lineup). Botones "Efectivo" y "Errado" por jugador. El jugador se asocia por `player_id`.

**Cambio de jugadores:** botón "Registrar Cambio" abre modal que registra `substitution` y actualiza el estado del lineup en tiempo real.

---

## Tab 2: Lines & Scrum

### Eventos

| event_type | Descripción | Con obtención |
|---|---|---|
| `lineout_favor` | Line a favor | Sí (popup) |
| `lineout_against` | Line en contra | Sí (popup) |
| `scrum_favor` | Scrum a favor | Sí (popup) |
| `scrum_against` | Scrum en contra | Sí (popup) |

**UI:** 4 botones grandes (2 lines, 2 scrums). Al tocar abre modal "¿Con obtención?" → registra con `metadata: {obtained: bool}`.

**Contadores (sobre los botones):** para cada sección (Lines / Scrums) se muestran contadores en tiempo real:
```
A favor    Ganados: N  Perdidos: N
En contra  Ganados: N  Perdidos: N
```
Calculados desde los eventos ya registrados en el store local.

---

## Tab 3: Eventos

Reemplaza al antiguo tab "Penales". Cubre todos los eventos de puntuación, errores y disciplina.

### Header de estadísticas

Al inicio del tab se muestra un card con:
- **Marcador**: puntos por equipo (izquierda = local, derecha = visitante)
- **Desglose**: Amarillas y Rojas por equipo

### Eventos y flujo multi-paso

Cada botón abre un bottom-sheet que guía paso a paso. El último paso auto-submite (sin botón "Confirmar" separado). Siempre hay botón "← Volver" y "Cancelar".

#### Try
```
Botón "Try"
  → Paso 1: De {local} / De {visitante}
  → Paso 2: Convertido / No
  → submit: event_type="try", team, metadata={converted: bool}
```
Puntuación: 5 pts + 2 pts si convertido.

#### Penal
```
Botón "Penal"
  → Paso 1: De {local} / De {visitante}
  → Paso 2: Line / Scrum / Juega / A los palos
     - Si "A los palos": Paso 3: Convertido / No
  → submit: event_type="penalty", team, reason, metadata={converted: bool} (solo a_los_palos)
```
Puntuación: 3 pts solo si `reason="a_los_palos"` y `converted=true`.

#### Drop
```
Botón "Drop"
  → Paso 1: De {local} / De {visitante}
  → submit: event_type="drop", team
```
Puntuación: 3 pts.

#### Error
```
Botón "Error"
  → Paso 1: De {local} / De {visitante}
  → Paso 2: Knock-on / Forward / Perdida en contacto
  → submit: event_type="knock_on"|"forward_pass"|"lost_in_contact", team
```

#### Disciplina
Dos botones directos:
```
[Amarilla]  →  De {local} / De {visitante}  → submit: event_type="yellow_card"
[Roja]      →  De {local} / De {visitante}  → submit: event_type="red_card"
```

### Tabla de eventos del tab

| event_type | Flujo | reason | metadata |
|---|---|---|---|
| `try` | Try → equipo → conversión | — | `{converted: bool}` |
| `penalty` | Penal → equipo → razón → (conversión) | `line\|scrum\|juega\|a_los_palos` | `{converted: bool}` si a_los_palos |
| `drop` | Drop → equipo | — | — |
| `knock_on` | Error → equipo → tipo | — | — |
| `forward_pass` | Error → equipo → tipo | — | — |
| `lost_in_contact` | Error → equipo → tipo | — | — |
| `yellow_card` | Disciplina → equipo | — | — |
| `red_card` | Disciplina → equipo | — | — |

### Cálculo de puntos

```
pts(try)              = 5 + (converted ? 2 : 0)
pts(penalty a palos)  = converted ? 3 : 0
pts(drop)             = 3
```

---

## Registro de Eventos (Event Log)

Al final de cada tab aparece un log de los eventos de ese tab, en orden inverso. Cada fila:

```
T1 23:45  [L]  Try · Convertido  ×
T1 18:22  [V]  Penal · A los palos · Convertido  ×
```

- `×` elimina el evento via `DELETE /sessions/:id/events/:id`
- Solo visible si hay eventos del tipo del tab

---

## Pantalla de Estadísticas (`/stats`)

Accesible desde el menú lateral para CLUB_ADMIN, MATCH_DIRECTOR, ANALYST.

### Filtros

- **Partido**: selector desplegable — "Todos los partidos" o partido específico
- **Categoría**: pills horizontales — `Todos | Puntos | Juego | Errores | Disciplina`

### Perspectiva normalizada por club

El club del usuario es siempre el protagonista (columna izquierda). Los eventos se normalizan independientemente de si el club jugó de local o visitante en cada partido:

1. Al cargar, se obtiene el nombre del club via `GET /clubs/{club_id}`
2. Por cada sesión se determina `userTeam: "home" | "away"` comparando `session.home_team === clubName`
3. Los eventos se etiquetan con `isUserClub: bool` → `event.team === session.userTeam`
4. Todos los gráficos y el marcador filtran por `isUserClub` en lugar de `team === "home"`

En la vista agregada ("Todos los partidos"), el rival aparece como **"Rivales"**.

### Sección Puntos

**Marcador con desglose** (stat cards, sin gráfico ECharts):

```
 Club             Rivales
   14  pts           10  pts

                  Club  Rivales
Tries (×5)          2       1
Conversiones (×2)   1       1
Penales a palos(×3) 0       1
Drops (×3)          0       0
```

**Gráfico Tries**: bar horizontal apilado por equipo — Convertidos / No convertidos.

**Gráfico Penales por destino**: bar horizontal por razón (Line / Scrum / Juega / A los palos). Tooltip muestra conversiones en "A los palos".

**Gráfico Drops**: bar horizontal simple. Se omite si no hay drops.

### Sección Juego

**Line-outs** y **Scrums**: bar chart con stack "Propios/Ajenos" × "Con obtención/Sin obtención".

### Sección Errores

Bar horizontal por tipo (Knock-on / Forward / Perdida en contacto) × equipo (club / rivales).

### Sección Disciplina

Bar horizontal de **tarjetas por jugador** (Amarillas + Rojas apiladas). Solo muestra jugadores con `player_id` en el evento.

### Línea de tiempo

Scatter plot de eventos sobre el tiempo del partido. Solo visible cuando hay un partido específico seleccionado. Categorías en el eje Y:

```
Tackles | Lines | Scrums | Puntos | Tarjetas | Posesión | Cambios
```

Puntos azules = local, triángulos naranja = visitante.

### Carga de datos

```
GET /clubs/{id}                         → nombre del club
GET /clubs/{id}/tournaments             → lista torneos
GET /tournaments/{id}/sessions          → por cada torneo
GET /sessions/{id}/events               → por cada sesión (paralelo)
GET /sessions/{id}/lineup               → por cada sesión (paralelo)
```

Todo el cómputo ocurre en el cliente — no se requieren endpoints de agregación nuevos.

---

## Gestión de Lineup Pre-Partido (`/sessions/:id/lineup`)

Pantalla separada del tablero. Accesible desde los cards de sesión.

- **Toggle Local/Visitante** — vista por equipo
- **Buscar jugador** — filtro client-side por nombre
- **Agregar:** click en jugador disponible → camiseta + posición + titular/suplente → `POST /sessions/:id/lineup`
- **Editar camiseta:** botón ✎ → input inline → `PATCH /sessions/:id/lineup/:entry_id`
- **Eliminar:** botón × → `DELETE /sessions/:id/lineup/:entry_id`

---

## Relacionado

- [[match-session]] — timer y modelo de evento
- [[data-model]] — entidades Event, MatchLineup, Player
- [[auth-and-users]] — permisos por pantalla
