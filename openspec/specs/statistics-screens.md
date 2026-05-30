---
title: Pantallas de Estadísticas y Registro
status: active
created: 2026-05-29
updated: 2026-05-30
---

# Pantallas de Estadísticas y Registro

## Visión General

El tablero de una sesión tiene tres tabs de registro de eventos más el timer siempre visible arriba. El diseño es mobile-first (375px base), botones grandes aptos para uso en campo. Adicionalmente existe una pantalla de estadísticas agregadas accesible desde el menú lateral.

## Layout del Tablero (Session)

```
┌─────────────────────────────┐
│  [1T]  23:45  ▶ ⏸ ⏹  ↺     │  ← Timer + controles (solo admin/director)
│  Equipo Local  vs  Visitante│  ← Botón "Corregir tiempo" cuando pausado
├─────────────────────────────┤
│ [Tackles] [Lines/Scrum] [Pen]│  ← 3 tabs
├─────────────────────────────┤
│                             │
│    CONTENIDO DEL TAB        │
│                             │
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

**UI:** Lista de jugadores en cancha (del lineup). Botones "Efectivo" y "Errado" por jugador. El jugador se asocia por `player_id`, no por número de camiseta.

**Cambio de jugadores:** botón "Registrar Cambio" abre modal que registra `substitution` event y actualiza el estado del lineup en tiempo real.

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

---

## Tab 3: Penales & Posesión

### Eventos

| event_type | Con jugador |
|---|---|
| `penalty_conceded` | Opcional |
| `penalty_won` | No |
| `yellow_card` | Opcional |
| `red_card` | Opcional |
| `turnover_conceded` | No |
| `turnover_won` | No |
| `knock_on` | Opcional |
| `forward_pass` | Opcional |

**Player picker:** cuando hay lineup cargado, el selector de jugador muestra nombre + camiseta y guarda `player_id`. Si no hay lineup, muestra input numérico de fallback.

---

## Registro de Eventos (Event Log)

Al final de cada tab aparece un log de los eventos de ese tab, en orden inverso (más reciente primero). Cada fila:

```
T1 23:45  [L]  Tackle efectivo · #7 Nombre Jugador · (razón opcional)  ×
```

- `×` elimina el evento via `DELETE /sessions/:id/events/:id`
- Solo visible si hay eventos del tipo del tab

---

## Pantalla de Estadísticas (`/stats`)

Accesible desde el menú lateral para CLUB_ADMIN, MATCH_DIRECTOR, ANALYST.

### Vista "Por jugador"

Agrega eventos de todos los partidos del club, por `player_id`.

| Jugador | Tk. Ef. | Tk. Err. | Amarillas | Rojas | Errores |
|---|---|---|---|---|---|

- Errores = knock-ons + pases adelantados
- Solo aparecen jugadores con al menos un evento con `player_id` asociado
- Ordenado por tackles totales

### Vista "Por partido"

Una fila por sesión, todas las sesiones del club.

| Partido | Fecha | Tk. Ef. | Tk. Err. | Amarillas | Rojas | Errores | Scrum + | Scrum − | Line + | Line − |
|---|---|---|---|---|---|---|---|---|---|---|

- Ordenado por fecha descendente
- Scroll horizontal en mobile

### Carga de datos

1. `GET /clubs/:id/tournaments` → lista torneos
2. Para cada torneo: `GET /tournaments/:id/sessions`
3. Para cada sesión: `GET /sessions/:id/events` + `GET /sessions/:id/lineup` (en paralelo)
4. Cómputo en cliente

---

## Gestión de Lineup Pre-Partido (`/sessions/:id/lineup`)

Pantalla separada del tablero de partido. Accesible desde los cards de sesión en Partidos y Torneos.

- **Toggle Local/Visitante** — vista por equipo
- **Buscar jugador** — filtro por nombre (client-side)
- **Agregar:** click en jugador disponible → formulario inline con camiseta + posición + titular/suplente → `POST /sessions/:id/lineup`
- **Editar camiseta:** botón ✎ por jugador → input inline → `PATCH /sessions/:id/lineup/:entry_id`
- **Eliminar del lineup:** botón × → `DELETE /sessions/:id/lineup/:entry_id`

---

## Relacionado

- [[match-session]] — timer y modelo de evento
- [[data-model]] — entidades Event, MatchLineup, Player
- [[auth-and-users]] — permisos por pantalla
