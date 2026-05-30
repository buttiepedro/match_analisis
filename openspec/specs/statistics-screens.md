---
title: Pantallas de Estadísticas
status: active
created: 2026-05-29
---

# Pantallas de Estadísticas

## Visión General

El tablero de una sesión tiene tres pantallas (tabs) de registro, más el timer siempre visible en la parte superior. Cada acción registra un evento con el timestamp del timer actual. El diseño es mobile-first (375px base), con botones grandes aptos para uso en campo con guantes.

## Layout General del Tablero

```
┌─────────────────────────────┐
│  [1T]  23:45  ▶ ⏸ ⏹        │  ← Timer (siempre visible, solo admin ve controles)
│  Equipo Local  vs  Visitante │
├─────────────────────────────┤
│ [Tackles] [Lines/Scrum] [Pen]│  ← Tabs de navegación
├─────────────────────────────┤
│                             │
│    CONTENIDO DEL TAB        │
│                             │
└─────────────────────────────┘
```

---

## Tab 1: Tackles

### Eventos Registrables

| Evento | Descripción | Equipo |
|--------|-------------|--------|
| `tackle_completed` | Tackle completado (derribó al portador) | equipo que tacleó |
| `tackle_missed` | Tackle fallado | equipo que intentó taclear |
| `dominant_tackle` | Tackle dominante (ganó metros en defensa) | equipo que tacleó |
| `breakdown_won` | Ruck ganado en el tackle | equipo ganador |
| `breakdown_lost` | Ruck perdido en el tackle | equipo que lo perdió |

### Datos del Evento

- Equipo (local / visitante)
- Número de jugador (opcional, input numérico)
- Tipo de tackle

### UI

```
┌─────────────────────────────┐
│     TACKLES                 │
│  [LOCAL]        [VISITANTE] │
│                             │
│  [✓ TACKLE]    [✓ TACKLE]   │
│  [✗ FALLADO]   [✗ FALLADO]  │
│  [★ DOMINANTE] [★ DOMINANTE]│
│  [RUCK ✓]      [RUCK ✓]     │
│  [RUCK ✗]      [RUCK ✗]     │
│                             │
│  Jugador #: [____]          │
└─────────────────────────────┘
```

---

## Tab 2: Lines & Scrum

### Eventos Registrables

| Evento | Descripción | Quién |
|--------|-------------|-------|
| `lineout_won` | Line-out ganado | equipo ganador |
| `lineout_lost` | Line-out perdido (rival tomó la pelota) | equipo perdedor |
| `lineout_steal` | Line-out robado activamente | equipo que robó |
| `scrum_won` | Scrum ganado | equipo ganador |
| `scrum_lost` | Scrum perdido | equipo perdedor |
| `scrum_penalty_won` | Penal a favor por scrum | equipo favorecido |
| `scrum_penalty_lost` | Penal en contra por scrum | equipo penalizado |

### Datos del Evento

- Equipo
- Posición en el campo (sector de campo: izquierda, centro, derecha — opcional)
- Resultado

### UI

```
┌─────────────────────────────┐
│     LINES & SCRUM           │
│  [LOCAL]        [VISITANTE] │
│                             │
│  LINE-OUTS                  │
│  [✓ GANADO]    [✓ GANADO]   │
│  [✗ PERDIDO]   [✗ PERDIDO]  │
│  [⚡ ROBO]      [⚡ ROBO]    │
│                             │
│  SCRUMS                     │
│  [✓ GANADO]    [✓ GANADO]   │
│  [✗ PERDIDO]   [✗ PERDIDO]  │
│  [🔴 PENAL ✓]  [🔴 PENAL ✓] │
│  [🔴 PENAL ✗]  [🔴 PENAL ✗] │
└─────────────────────────────┘
```

---

## Tab 3: Penales & Pérdida de Posesión

### Eventos Registrables

| Evento | Descripción | Quién |
|--------|-------------|-------|
| `penalty_conceded` | Penal cometido | equipo infractor |
| `penalty_won` | Penal recibido a favor | equipo favorecido |
| `yellow_card` | Tarjeta amarilla | jugador/equipo |
| `red_card` | Tarjeta roja | jugador/equipo |
| `turnover_conceded` | Pérdida de posesión por error propio | equipo que perdió |
| `turnover_won` | Posesión ganada por robo | equipo que ganó |
| `knock_on` | Knock-on (pelota al frente) | equipo infractor |
| `forward_pass` | Pase adelantado | equipo infractor |

### Datos del Evento

- Equipo
- Número de jugador (requerido para tarjetas, opcional para el resto)
- Tipo de infracción / razón (dropdown opcional para penales: `offside`, `obstruction`, `high_tackle`, `collapsed_scrum`, `not_rolling_away`, `other`)

### UI

```
┌─────────────────────────────┐
│   PENALES & POSESIÓN        │
│  [LOCAL]        [VISITANTE] │
│                             │
│  PENALES                    │
│  [🔴 COMETIÓ]   [🔴 COMETIÓ]  │
│  [✓ GANÓ]       [✓ GANÓ]    │
│  [🟡 AMARILLA]  [🟡 AMARILLA]│
│  [🔴 ROJA]      [🔴 ROJA]   │
│                             │
│  POSESIÓN                   │
│  [↩ TURNOVER ✗] [↩ TURNOVER ✗]│
│  [↪ TURNOVER ✓] [↪ TURNOVER ✓]│
│  [✋ KNOCK-ON]  [✋ KNOCK-ON] │
│  [→✗ PASE AD.] [→✗ PASE AD.]│
│                             │
│  Jugador #: [____]          │
│  Razón: [__________▾]       │
└─────────────────────────────┘
```

---

## Interacción al Registrar un Evento

1. Usuario toca un botón de acción
2. Se abre un mini-modal de confirmación con:
   - Tipo de evento
   - Timer actual (congelado visualmente para referencia)
   - Campo opcional de número de jugador
   - Campo opcional de razón/tipo (si aplica)
3. Usuario confirma → se envía `POST /sessions/{id}/events`
4. Aparece feedback visual (toast) con el evento registrado
5. Los totales del tab se actualizan en tiempo real

## Vista de Resumen (dentro del tablero)

Cada tab muestra un contador acumulado arriba de los botones:

```
Tackles: Local 14  |  Visitante 11
```

## Pantalla de Estadísticas Post-Partido

Ruta: `/sessions/{id}/stats`

- Tabla comparativa por categoría
- Línea de tiempo de eventos
- Exportable a PDF (fase futura)

## Relacionado

- [[match-session]] — timer y modelo de evento
- [[data-model]] — entidad Event y sus tipos
