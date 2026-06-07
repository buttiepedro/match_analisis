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
│ [Juego] [Lines & Scrum] [Cambios] │  ← 3 tabs (swipe para navegar)
├─────────────────────────────┤
│    CONTENIDO DEL TAB        │
├─────────────────────────────┤
│    REGISTRO DE EVENTOS      │  ← Log al final de cada tab (eliminable)
└─────────────────────────────┘
```

Navegación por swipe horizontal disponible entre los 3 tabs (umbral: 50px).

---

## Tab 1: Juego

Registra eventos de ataque y defensa. El equipo se deriva automáticamente del modo activo — no hay selector manual:

```typescript
const activeTeam = mode === "attack" ? "home" : "away";
```

No hay granularidad por jugador.

### Toggle de modo

Un toggle Ataque / Defensa controla qué botones se muestran. Se auto-cambia:
- Perdida registrada → cambia a **Defensa**
- Pelota Ganada registrada → cambia a **Ataque**
- Try / Penal / Drop NO cambian el modo

### Vista Ataque

| event_type | team | Descripción | Modal |
|---|---|---|---|
| `line_break` | `home` | Quiebre de línea | Ninguno — registra directo |
| `offload` | `home` | Offload | Ninguno — registra directo |
| `possession_lost` | `home` | Posesión perdida | Popup motivo (ver abajo) |
| `penalty` | `home` | Penal | Popup motivo → opcional conversión |
| `try` | `home` | Try | Popup conversión |
| `drop` | `home` | Drop | Ninguno — registra directo |

### Vista Defensa

| event_type | team | Descripción | Modal |
|---|---|---|---|
| `tackle_effective` | `away` | Tackle concretado | Ninguno — registra directo |
| `tackle_missed` | `away` | Tackle errado | Ninguno — registra directo |
| `tackle_positive` | `away` | Tackle positivo | Ninguno — registra directo |
| `ball_won` | `away` | Pelota ganada | Popup motivo (ver abajo) |
| `penalty` | `away` | Penal | Popup motivo → opcional conversión |
| `try` | `away` | Try | Popup conversión |
| `drop` | `away` | Drop | Ninguno — registra directo |

### Popup de motivo (Perdida / Pelota Ganada)

Opciones compartidas: `ruck` | `maul` | `contacto` | `pesca` | `patada` | `knock_on`

```
event:   possession_lost | ball_won
payload: { event_type, team: activeTeam, reason: <motivo> }
```

### Flujo Penal

```
Tap "Penal"
  → Paso "reason": [Line] [Scrum] [Juega] [A los palos]
    - Si Line/Scrum/Juega → submit inmediato
    - Si "A los palos" → paso "conversion"
  → Paso "conversion": [Convertido] [No] + "← Volver"
  → submit: { event_type:"penalty", team:activeTeam, reason, metadata:{converted} }
```

### Flujo Try

```
Tap "Try"
  → [Convertido] [No]
  → submit: { event_type:"try", team:activeTeam, metadata:{converted} }
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

## Tab 3: Cambios

Tab simplificado — exclusivo para disciplina y cambios de jugadores. Los eventos de puntuación (Try, Penal, Drop) se registran desde Tab 1 (Juego).

### Header de estadísticas

Card con:
- **Marcador**: puntos por equipo calculados desde eventos de Juego (izquierda = local, derecha = visitante)
- **Tarjetas**: Amarillas y Rojas por equipo

### Disciplina
```
[Amarilla]  →  De {local} / De {visitante}  → submit: event_type="yellow_card", team
[Roja]      →  De {local} / De {visitante}  → submit: event_type="red_card", team
```

### Registrar Cambio

Botón "Registrar Cambio" abre `SubstitutionModal`. Selecciona jugador que sale (on_field) y entra (bench). Registra `event_type="substitution"` con `metadata: { player_out_name, player_out_number, player_in_name, player_in_number }`. Actualiza el estado del lineup en tiempo real.

### Tabla de eventos del tab

| event_type | reason | metadata |
|---|---|---|
| `yellow_card` | — | — |
| `red_card` | — | — |
| `substitution` | — | `{player_out_name, player_out_number, player_in_name, player_in_number}` |

### Cálculo de puntos (desde eventos de Juego)

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

**Tackles** (solo club): bar horizontal con 3 barras — Concretado / Errado / Positivo. Se omite si no hay tackles registrados.

**Ataque** (solo club): bar horizontal con 2 barras — Quiebres (`line_break`) / Offloads (`offload`). Se omite si no hay datos.

**Posesión por motivo** (solo club): bar agrupado — dos series "Perdidas" (`possession_lost`) vs "Ganadas" (`ball_won`) × motivo en eje Y (Ruck / Maul / Contacto / Pesca / Patada / Knock On). Se omite si no hay datos.

**Line-outs**, **Scrums**, **Salidas** (`exit_favor`/`exit_against`): bar chart apilado por obtención (Con / Sin). Eje X: Propios / Ajenos. Cada sección se omite si no hay eventos del tipo.

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
