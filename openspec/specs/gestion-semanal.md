---
title: Gestión semanal del club
status: active
created: 2026-07-26
---

# Gestión semanal del club

> Refleja el comportamiento **realmente implementado** en `app/api/v1/trainings.py`,
> `injuries.py`, `season.py` y `lineup.py`, y las migraciones `0010`–`0013`.

Cubre lo que pasa entre partido y partido: quién viene a entrenar, quién está
disponible y cómo se arma el equipo.

---

## Entrenamientos y asistencia

### Modelo

`trainings` cuelga de una división. `attendance` lleva **un único registro por
(entrenamiento, jugador)** — el `UNIQUE` no es cosmético, es lo que hace que el
`PUT` sea idempotente.

Estados: `presente`, `ausente`, `justificado`, `lesionado`, `tarde`.
`presente` y `tarde` cuentan como asistencia efectiva.

### Toma de asistencia

`PUT /trainings/{id}/attendance` reemplaza la planilla completa. Reenviar el mismo
cuerpo deja el mismo estado, que es lo que permite que la cola offline reintente
sin coordinación.

`GET /trainings/{id}/attendance` devuelve **todo el plantel activo de la división**,
con `status: null` para quien no tenga registro. La UI muestra a todos en
`presente` por defecto: en un club normal la mayoría asiste, así que se marca la
excepción y no la regla.

Un jugador de otra división en el cuerpo del `PUT` devuelve `422`.

### Métricas

`GET /divisions/{id}/attendance/summary?days=N` — porcentaje por jugador dentro de
la ventana, ordenado de mayor a menor, más el promedio de la división.

Un jugador se marca **en riesgo** con 3 ausencias consecutivas o menos de 50% en
la ventana. Reglas que importan:

- La racha cuenta **sólo `ausente`**. Una falta justificada no es deserción, y
  contarla llenaría la pantalla de falsos positivos.
- Un jugador **sin ningún registro** nunca está en riesgo: eso no es una señal, es
  falta de datos.

`GET /players/{id}/attendance` — porcentajes a 30, 90 días y temporada, racha
actual e histórico completo.

---

## Disponibilidad, apto médico y lesiones

### `players.availability`

Enum `disponible | lesionado | suspendido | baja_temporal`, **desnormalizado a
propósito**: es derivable de las lesiones abiertas, pero la grilla de armado lo
consulta para 40 jugadores a la vez.

Lo escriben **únicamente** los endpoints de `injuries.py`. Cualquier otro camino de
escritura lo desincroniza.

Reglas de sincronización:

- Crear, cerrar o borrar una lesión recalcula `availability` desde las lesiones
  abiertas que queden.
- Cerrar una de dos lesiones abiertas **no** devuelve al jugador a `disponible`.
- Una **suspensión gana siempre**: la decide el club por tarjeta roja y no se toca
  al cerrar un parte médico.

### Apto médico

`medical_clearance_expires` en `players`. La API marca `clearance_expired` y
`clearance_expiring` (30 días de aviso).

El apto vencido **advierte, no bloquea**. El sistema informa; la responsabilidad
reglamentaria es del club.

---

## Armado de equipo

### Grilla de 23

`PUT /sessions/{id}/lineup` reemplaza el lineup de **un equipo** en una sola
transacción. Se valida todo antes de escribir nada:

- Número de camiseta repetido → `409`
- Jugador repetido → `409`
- Jugador de otro club → `404`
- **Partido ya empezado → `409`**

Ese último caso importa: con el partido en curso hay jugadores en
`substituted_out`, y reemplazar el lineup entero borraría el registro de quién
entró y salió. Para corregir a mitad de partido están los endpoints por jugador,
que siguen existiendo.

Si la validación falla, el lineup anterior queda intacto.

### Camiseta única

`match_lineup` tiene `UNIQUE (session_id, team, jersey_number)`. Los eventos se
asocian al jugador por `player_number`: dos camisetas iguales atribuyen mal las
estadísticas sin que nadie se entere.

El mismo número **sí** puede repetirse entre equipos rivales.

### Lineup sugerido

`GET /sessions/{id}/lineup/suggested?team=` devuelve el lineup del último partido
de la misma división. Cada entrada trae `available: false` si el jugador ya no está
activo o cambió de club, para que la UI lo deje afuera y avise.

### Convocatoria

`match_squad` — el paso de la semana, previo al lineup. `PUT /sessions/{id}/squad`
reemplaza la lista completa. Estados: `convocado`, `confirmado`, `baja`.

---

## Minutos y acumulados de temporada

**No se persisten.** Salen de `match_lineup` + eventos de sustitución + timer.
Guardarlos sería una segunda fuente de verdad que se desincroniza en cuanto
alguien corrige un evento.

### Cálculo de minutos

Por jugador y partido:

1. **Arranca** si no aparece como `player_in` en ninguna sustitución.
2. **Sale** cuando aparece como `player_out`, o al final del partido.
3. Un suplente que nunca aparece como `player_in` jugó **0 minutos**.
4. Cada amarilla propia dentro de su ventana en cancha descuenta 10 minutos,
   **acotado a lo que quedaba por jugar** — no se puede deber más tiempo del que
   había.

El tiempo absoluto del segundo tiempo es `half_duration * 60 + timer_seconds`.
La duración del partido es el tiempo reglamentario si terminó, o el último evento
registrado si sigue abierto.

`matches` cuenta sólo partidos con minutos > 0: figurar en la planilla no es haber
jugado.

### Endpoints

- `GET /players/{id}/season-stats` — partidos, minutos, tries, tackles, tarjetas y
  detalle por partido. `?season=` filtra por temporada del torneo.
- `GET /divisions/{id}/minutes` — carga de trabajo del plantel, ordenada por
  minutos. Incluye a los que no jugaron, en cero: son justamente los que hay que
  rotar.

Tackles suma `tackle_effective` y `tackle_positive`; el errado no cuenta.

---

## Cola offline generalizada

`lib/offlineQueue.ts` dejó de ser específica de eventos. Cada ítem lleva `method`,
`url` y `scope`.

- Los ítems **sin** esos campos son del formato anterior y se envían como `POST` a
  `/sessions/{sessionId}/events`. Descartarlos sería perder los eventos de un
  partido jugado sin señal.
- `enqueueRequest` **reemplaza** un ítem previo del mismo `scope` + `url`: quince
  correcciones de asistencia offline no deben ser quince requests al reconectar.
- Sólo se encolan escrituras idempotentes. La asistencia usa `PUT` de la planilla
  completa justamente por eso.

---

## Relacionado

- [[data-model]] — schema completo
- [[offline-resilience]] — comportamiento de la cola
- [[match-session]] — lineup, sustituciones y timer
- [[statistics-screens]] — stats por partido, que esto extiende a temporada
