---
title: Plan de gimnasio
status: active
created: 2026-07-27
---

# Plan de gimnasio

> Refleja lo implementado en `api/v1/gym.py`, `models/gym.py` y la migración `0018`.

## La decisión que hace útil al módulo

La carga de un ejercicio puede ser **relativa a un test del jugador**:

```
Sentadilla · 4×5 · 75% de Sentadilla 3RM
```

El preparador físico escribe **un** plan para la división y cada jugador ve **sus**
kilos, calculados contra su propio test. Sin eso hay que cargar el plan jugador por
jugador, y eso no se hace dos veces.

Los 3RM se habían agregado al catálogo de tests en [[club-operativo]] justamente para
esto.

### Reglas de la resolución

- Se usa el test **más reciente** de ese tipo.
- El resultado se redondea a **2.5 kg**, que es el disco más chico de un gimnasio.
  Decir "levantá 83.7 kg" es dar un número que nadie puede armar.
- Si **falta el test**, no se inventa un kilaje: se devuelve `resolved_load_kg = null`
  y un motivo legible ("Te falta el test de Sentadilla 3RM"). Un número inventado es
  peor que un aviso, porque el jugador lo levanta.
- La vista del cuerpo técnico **no** resuelve: muestra el porcentaje, porque los kilos
  dependen de quién levanta.

## Modelo

```
gym_plans      club_id, division_id, name, weeks, is_active
gym_days       plan_id, week, day, name          UNIQUE (plan_id, week, day)
gym_exercises  day_id, position, name, sets, reps,
               load_type (absoluta|porcentaje_test|libre), load_value, load_test_type
gym_logs       player_id, day_id, logged_on      UNIQUE (player_id, day_id, logged_on)
```

**Un plan activo por división.** Activar uno desactiva el anterior: el jugador tiene
que ver un plan, no elegir entre tres.

## Edición

`PUT /gym-plans/{id}/structure` reemplaza días y ejercicios en una transacción. Es un
`PUT` de la estructura completa y no un ABM por ejercicio porque el PF escribe la
semana entera de una sentada; cargarla de a un ejercicio serían treinta requests y
otros tantos estados intermedios inválidos.

Se valida **todo antes de escribir**: una semana fuera del plan, un `porcentaje_test`
sin test, o un test desconocido rechazan el request y dejan la estructura anterior
intacta.

> **Detalle de implementación que costó encontrar**: el `delete()` masivo borra en la
> base pero no toca el identity map de SQLAlchemy, así que la respuesta devolvía los
> días viejos. Se relee con `populate_existing=True`, acotado al plan — un
> `expire_all()` alcanzaría también a `current_user`, y leer sus divisiones fuera de un
> await rompe con `MissingGreenlet`.

## Adherencia

`gym_logs` registra las sesiones marcadas como hechas, idempotente por
(jugador, día, fecha). `GET /divisions/{id}/gym-adherence` devuelve sesiones por
jugador en la ventana, **incluyendo a los que no fueron nunca**: son justamente a
quienes hay que mirar.

Es a la sala de pesas lo que la asistencia es al entrenamiento.

## Permisos

| Capacidad | Quién |
|-----------|-------|
| `gimnasio.ver_propio` | preset **Jugador** |
| `gimnasio.ver` | **Entrenador**, **Preparador físico** |
| `gimnasio.editar` | **Preparador físico** |

`gimnasio.ver_propio` es capacidad **sobre lo propio**, no sobre el club: el jugador
sigue sin poder leer datos de nadie más.

## Relacionado

- [[permisos]] — capacidades y presets
- [[club-operativo]] — catálogo de tests, incluidos los 3RM
- [[add-plataforma-club-roadmap]] — el programa
