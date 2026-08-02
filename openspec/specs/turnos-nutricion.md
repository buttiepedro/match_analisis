---
title: Turnos con nutricionista
status: active
created: 2026-08-02
---

# Turnos con nutricionista

> Refleja lo implementado en `api/v1/nutrition.py`, `models/nutrition_slot.py`,
> `core/scheduler.py` y la migración `0025`.

## Una tabla, no dos

Un horario y una reserva son el mismo registro en distinto `status`
(`libre` → `reservado` → `cancelado`). La relación entre horario y reserva es
siempre 1 a 1, así que separar "horario" de "turno" sólo agregaría un join en
cada lectura sin ganar nada a cambio.

```
nutrition_slots
  id                UUID PK
  club_id           UUID FK → clubs.id
  nutritionist_id   UUID FK → users.id
  starts_at         TIMESTAMP NOT NULL
  ends_at           TIMESTAMP NOT NULL
  status            ENUM('libre', 'reservado', 'cancelado') DEFAULT 'libre'
  player_id         UUID FK → players.id NULL   -- quién reservó
  notes             VARCHAR(300) NULL           -- motivo de la consulta
  booked_at         TIMESTAMP NULL
  cancelled_by      UUID FK → users.id NULL
  cancelled_at      TIMESTAMP NULL
  reminder_sent_at  TIMESTAMP NULL              -- se escribe después de notificar
  created_at        TIMESTAMP

  INDEX (club_id, starts_at)
  INDEX (nutritionist_id, starts_at)
```

## Reserva sin choque

`POST /nutrition-slots/{id}/book` no lee y después escribe: hace un `UPDATE`
condicionado al estado actual —

```sql
UPDATE nutrition_slots
SET status = 'reservado', player_id = :player_id, booked_at = now()
WHERE id = :id AND status = 'libre'
```

— y si actualiza **cero filas**, responde `409`: alguien reservó ese horario
un instante antes. La base arbitra la carrera, no un chequeo previo en la
aplicación que puede perder contra otro request. Mismo principio que el
`UNIQUE (session_id, team, jersey_number)` de [[data-model]].

## Cancelar no es lo mismo según quién cancela

| Quién cancela | Estado `libre` | Estado `reservado` |
|---|---|---|
| Nutricionista | Se borra (nunca se publicó a nadie) | Pasa a `cancelado` **y libera un slot nuevo** con el mismo horario, para que otro jugador lo tome |
| Jugador | — (no puede cancelar lo que no es suyo) | Pasa a `cancelado`. No libera nada: la nutricionista decide si ese horario se vuelve a publicar |

La asimetría es a propósito: si el jugador cancela y el slot se reabriera
solo, la nutricionista perdería el control de su propia agenda —capaz ese
horario ya no le sirve—. Si la nutricionista cancela un turno reservado, en
cambio, el horario en sí seguía siendo válido; lo único que cambió es quién
lo ocupaba.

`response_model=Optional[NutritionSlotResponse]`: cancelar un libre devuelve
`null` (se borró), cancelar un reservado devuelve el slot cancelado.

## Endpoints

```
POST   /clubs/{id}/nutrition-slots        -- alta en lote, nutricionista
GET    /clubs/{id}/nutrition-slots        -- ?from=&to=&status=&nutritionist_id=
POST   /nutrition-slots/{id}/book         -- jugador reserva
POST   /nutrition-slots/{id}/cancel       -- jugador cancela el propio; nutricionista cancela cualquiera
GET    /me/nutrition-appointments         -- mis turnos (jugador)
```

`POST /clubs/{id}/nutrition-slots` acepta una lista de `{starts_at, ends_at}`:
la nutricionista bloquea la mañana del jueves en una sola carga, no horario
por horario.

`GET /clubs/{id}/nutrition-slots` sin `status` filtra a `libre` para quien
sólo puede reservar —no tiene sentido que un jugador vea turnos ya tomados
por otro— y muestra la agenda completa para quien puede publicar, porque la
necesita entera.

## Recordatorio: primer trabajo del backend que se dispara por tiempo

Ningún módulo hasta ahora necesitó correr **por reloj** en vez de por un
request. [[bolsa-trabajo]] evitó explícitamente necesitar un scheduler
haciendo que "vencido" fuera un estado calculado al leer. Acá no hay vuelta:
un recordatorio que nadie mira hasta que ya pasó el turno no sirve.

**Elección**: `APScheduler` (`AsyncIOScheduler`) en el mismo proceso del
backend, arrancado y frenado desde el `lifespan` de FastAPI — no una cola ni
un contenedor aparte. [[despliegue]] corre un solo backend; sumar Redis y un
worker para un job que corre una vez por hora sería infraestructura para un
problema que no la necesita.

- Corre cada hora. Busca `nutrition_slots` con `status = 'reservado'`,
  `starts_at` entre 20 y 24 horas en el futuro, y `reminder_sent_at IS NULL`.
- Por cada uno, llama a `notify(type=turno_recordatorio)` y **recién después**
  escribe `reminder_sent_at`. Si el proceso se reinicia entre el envío y la
  escritura, en el peor caso se manda dos veces —no cero—. Preferible a
  perderlo.
- Con un solo backend corriendo ([[despliegue]]) no hay riesgo de que dos
  instancias disparen el mismo job en paralelo. Si el despliegue algún día
  escala a más de un proceso, este job pasa a necesitar un lock (`SELECT ...
  FOR UPDATE SKIP LOCKED` sobre los slots candidatos alcanza) — documentado
  como límite conocido, no resuelto porque hoy no aplica.

## Notificaciones que dispara

Vía [[notificaciones]], dos tipos nuevos en `NotificationType`:

```python
turno_confirmado    # al reservar y al cancelar
turno_recordatorio  # 20-24h antes, sólo al jugador
```

`turno_confirmado` le llega a **las dos partes**: al jugador cuando reserva o
cuando la nutricionista cancela su turno, y a la nutricionista cuando alguien
reserva o cancela. Es su agenda, y enterarse por la app es mejor que
encontrarse con un consultorio vacío o con alguien que no tenía turno.

## Permisos

```
nutricion.turnos_publicar    -- crear/cancelar horarios, ver la agenda completa
nutricion.turnos_reservar    -- reservar y cancelar el turno propio
```

- **Preset Nutricionista**: `nutricion.turnos_publicar`.
- **Preset Jugador**: `nutricion.turnos_reservar`, agregada **directamente al
  preset**, no heredada de Socio — el pedido del club es "como jugador", y un
  socio que no juega no tiene ficha física que la nutricionista siga. Es la
  única capacidad de club, hoy, que tiene el preset Jugador; sigue siendo
  sobre lo propio porque `book_nutrition_slot` y `cancel_nutrition_slot`
  resuelven siempre el jugador del token (`_get_own_player`), nunca un `id`
  de otro. Ver [[permisos]].
- **Administrador**: ambas.

## Pantallas

- `/nutricion` (nutricionista): publica horarios en lote —fecha/hora +
  duración, "+ Agregar" arma una lista y "Publicar N horarios" la manda de
  una— y ve la agenda agrupada por día con quién reservó cada uno.
- `/mi-turno-nutricion` (jugador): "Tu turno" si tiene uno reservado, con
  botón de cancelar; debajo, los horarios libres con reserva inline (nota
  opcional de motivo de consulta). Un `409` al reservar ("alguien se
  adelantó") se muestra tal cual — no se reintenta solo.

## Bug real que encontró este cambio: `invite_player` no otorgaba ningún preset

`nutricion.turnos_reservar` es la primera capacidad del preset Jugador que un
endpoint **de verdad chequea** con `require()` — todo lo anterior que veía un
jugador (`/me/player`, `gimnasio.ver_propio` incluido) resolvía por acceso
propio (`require_player_self` / `_get_own_player`) sin pasar por
`Permission`. Eso mantuvo oculto, desde que existe el sistema de capacidades
([[permisos]]), que `POST /divisions/{id}/players/{id}/invite` creaba el
usuario con `role=player` pero **nunca** llamaba a
`assign_preset_for_legacy_role()` —a diferencia de `POST /clubs/{id}/users`,
que sí la llama para club_admin/analyst/match_director—. Todo jugador
invitado por ese camino quedaba con cero capacidades, sin ningún error en
ningún log: el jugador entraba al portal igual porque el portal nunca
necesitó una.

Se encontró recién al escribir los tests de este módulo (un jugador
invitado, con el preset ya actualizado para incluir
`nutricion.turnos_reservar`, seguía recibiendo `403`). Corregido agregando el
mismo llamado en `invite_player`. Hay test de regresión dedicado
(`test_inviting_a_player_actually_grants_the_jugador_preset`).

## Relacionado

- [[add-turnos-nutricion]] — la propuesta, cambio 4 de [[add-portal-completo-roadmap]]
- [[notificaciones]] — `turno_confirmado` y `turno_recordatorio`
- [[permisos]] — preset Nutricionista, preset Jugador, `assign_preset_for_legacy_role`
- [[bolsa-trabajo]] — el módulo que evitó necesitar scheduler; acá sí hizo falta
- [[despliegue]] — un solo backend, supuesto detrás de correr `APScheduler` en proceso
- [[gimnasio]] — mismo patrón de capacidad "sobre lo propio" en el preset Jugador
- [[data-model]] — schema
- [[navigation]] — ítems "Nutrición" y "Turno de nutrición"
