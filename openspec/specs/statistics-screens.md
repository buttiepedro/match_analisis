---
title: Pantallas de Estadísticas y Registro
status: active
created: 2026-05-29
updated: 2026-06-02
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
│ [Juego] [Lines & Scrum] [Eventos] │  ← 3 tabs
├─────────────────────────────┤
│    CONTENIDO DEL TAB        │
├─────────────────────────────┤
│    REGISTRO DE EVENTOS      │  ← Log al final de cada tab (eliminable)
└─────────────────────────────┘
```

---

## Tab 1: Juego

Registra eventos de ataque y defensa **siempre para el equipo del club usuario** (`team: "home"`). No hay granularidad por jugador.

### Toggle de modo

Un toggle Ataque / Defensa controla qué botones se muestran. Se auto-cambia:
- Perdida registrada → cambia a **Defensa**
- Pelota Ganada registrada → cambia a **Ataque**

### Vista Ataque

| event_type | Descripción | Modal |
|---|---|---|
| `line_break` | Quiebre de línea | Ninguno — registra directo |
| `offload` | Offload | Ninguno — registra directo |
| `possession_lost` | Posesión perdida | Popup motivo (ver abajo) |

### Vista Defensa

| event_type | Descripción | Modal |
|---|---|---|
| `tackle_effective` | Tackle concretado | Ninguno — registra directo |
| `tackle_missed` | Tackle errado | Ninguno — registra directo |
| `tackle_positive` | Tackle positivo | Ninguno — registra directo |
| `ball_won` | Pelota ganada | Popup motivo (ver abajo) |

### Popup de motivo (Perdida / Pelota Ganada)

Opciones compartidas: `ruck` | `maul` | `contacto` | `pesca` | `patada` | `knock_on`

```
event:   possession_lost | ball_won
payload: { event_type, team: "home", reason: <motivo> }
```

### Contadores en header

```
{homeTeam} · Ataque — N acciones
{homeTeam} · Defensa — N tackles
```

---

## Tab 2: Lines & Scrum

### Eventos

Todos con `team: "home"` y `metadata: { obtained: bool }` via popup "¿Con obtención?".

| event_type | Descripción |
|---|---|
| `lineout_favor` | Line a favor |
| `lineout_against` | Line en contra |
| `scrum_favor` | Scrum a favor |
| `scrum_against` | Scrum en contra |
| `exit_favor` | Salida a favor |
| `exit_against` | Salida en contra |

**UI:** 3 secciones (Line-outs / Scrums / Salidas), cada una con 2 botones grandes. Al tocar cualquiera abre modal "¿Con obtención del balón?" → registra con `metadata: {obtained: bool}`.

**Contadores (sobre los botones):**
```
A favor    Ganados: N  Perdidos: N
En contra  Ganados: N  Perdidos: N
```
Calculados en tiempo real desde los eventos en el store local.

---

## Tab 3: Eventos

Cubre todos los eventos de puntuación, errores y disciplina. También incluye el registro de cambios de jugadores.

### Header de estadísticas

Card con:
- **Marcador**: puntos por equipo (izquierda = local, derecha = visitante)
- **Tarjetas**: Amarillas y Rojas por equipo

### Eventos y flujo multi-paso

Cada botón abre un bottom-sheet multi-paso. El último paso auto-submite. Siempre hay "← Volver" y "Cancelar".

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
```
[Amarilla]  →  De {local} / De {visitante}  → submit: event_type="yellow_card"
[Roja]      →  De {local} / De {visitante}  → submit: event_type="red_card"
```

#### Registrar Cambio

Botón "Registrar Cambio" abre `SubstitutionModal`. Selecciona jugador que sale (on_field) y entra (bench). Registra `event_type="substitution"` con `metadata: { player_out_name, player_out_number, player_in_name, player_in_number }`. Actualiza el estado del lineup en tiempo real.

### Tabla de eventos del tab

| event_type | reason | metadata |
|---|---|---|
| `try` | — | `{converted: bool}` |
| `penalty` | `line\|scrum\|juega\|a_los_palos` | `{converted: bool}` si a_los_palos |
| `drop` | — | — |
| `knock_on` | — | — |
| `forward_pass` | — | — |
| `lost_in_contact` | — | — |
| `yellow_card` | — | — |
| `red_card` | — | — |
| `substitution` | — | `{player_out_name, player_out_number, player_in_name, player_in_number}` |

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
T1 23:45  [L]  Quiebre  ×
T1 18:22  [L]  Posesión perdida · Ruck  ×
T1 12:10  [L]  Salida a favor · Con obtención  ×
```

- `[L]` = local, `[V]` = visitante
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

**Marcador con desglose** (stat cards):

```
 Club             Rivales
   14  pts           10  pts

                  Club  Rivales
Tries (×5)          2       1
Conversiones (×2)   1       1
Penales a palos(×3) 0       1
Drops (×3)          0       0
```

**Gráfico Tries**: bar horizontal apilado — Convertidos / No convertidos.

**Gráfico Penales por destino**: bar horizontal por razón (Line / Scrum / Juega / A los palos).

**Gráfico Drops**: bar horizontal simple. Se omite si no hay drops.

### Sección Juego

**Line-outs**, **Scrums** y **Salidas**: bar chart con stack por obtención (Con / Sin).

### Sección Errores

Bar horizontal por tipo (Knock-on / Forward / Perdida en contacto) × equipo (club / rivales).

### Sección Disciplina

Bar horizontal de tarjetas por jugador (Amarillas + Rojas apiladas). Solo muestra jugadores con `player_id` en el evento.

### Línea de tiempo

Scatter plot de eventos sobre el tiempo del partido. Solo visible con partido específico seleccionado. Categorías en el eje Y:

```
Tackles | Lines | Scrums | Puntos | Tarjetas | Posesión | Cambios
```

### Carga de datos

```
GET /clubs/{id}                         → nombre del club
GET /clubs/{id}/tournaments             → lista torneos
GET /tournaments/{id}/sessions          → por cada torneo
GET /sessions/{id}/events               → por cada sesión (paralelo)
GET /sessions/{id}/lineup               → por cada sesión (paralelo)
```

Todo el cómputo ocurre en el cliente — no se requieren endpoints de agregación.

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
