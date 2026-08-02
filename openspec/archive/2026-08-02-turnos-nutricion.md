---
title: Turnos con nutricionista
type: feature
status: completed
spec: turnos-nutricion
created: 2026-07-29
completed: 2026-08-02
---

# Turnos con nutricionista

## Descripción del Cambio

El preset **Nutricionista** existe desde [[permisos]] pero se sembró vacío —
"nuevos, sin asignar"— porque en ese momento no había ninguna pantalla para
darle contenido. Hoy la nutricionista de un club sólo puede cargar mediciones
(`player_measurements`) si alguien le da capacidad de `mediciones.cargar`; no
tiene agenda.

Este cambio agrega una agenda simple: la nutricionista publica horarios libres,
el jugador reserva uno, cualquiera de los dos cancela. Un recordatorio sale por
[[add-notificaciones-push]] antes del turno.

---

## Lo que sí y lo que no

| | |
|---|---|
| ✅ Publicar horarios libres, uno por vez o en lote | ❌ Recurrencia automática ("todos los martes a las 18") |
| ✅ Reservar, cancelar, ver mi agenda | ❌ Lista de espera si no hay horarios libres |
| ✅ Recordatorio antes del turno | ❌ Notas clínicas del turno (eso ya vive en `player_measurements` y `notes`) |
| ✅ Un turno = un jugador | ❌ Turnos grupales o charlas |

La recurrencia automática queda afuera a propósito: la nutricionista de un club
chico atiende horarios que cambian semana a semana según el resto de su agenda.
Publicar en lote (elegir varios horarios de una carga) cubre el caso real sin
construir un motor de reglas de recurrencia que nadie va a terminar de configurar
bien.

---

## Modelo

```sql
nutrition_slots
  id                  UUID PK
  club_id             UUID FK → clubs.id
  nutritionist_id     UUID FK → users.id
  starts_at           TIMESTAMP NOT NULL
  ends_at             TIMESTAMP NOT NULL
  status              ENUM('libre', 'reservado', 'cancelado') DEFAULT 'libre'
  player_id           UUID FK → players.id NULL   -- quién reservó
  notes               VARCHAR(300) NULL            -- motivo de la consulta, opcional
  booked_at           TIMESTAMP NULL
  cancelled_by        UUID FK → users.id NULL
  cancelled_at        TIMESTAMP NULL
  reminder_sent_at    TIMESTAMP NULL
  created_at          TIMESTAMP

  INDEX (club_id, starts_at)
  INDEX (nutritionist_id, starts_at)
```

Una tabla sola. Un turno reservado y uno libre son el mismo registro en distinto
estado — no hay motivo para separar "horario" de "reserva" cuando la relación es
siempre 1 a 1.

`reminder_sent_at` evita mandar el recordatorio dos veces si el job que lo
dispara corre más de una vez sobre la misma ventana (ver más abajo).

---

## Reserva sin choque

`POST /nutrition-slots/{id}/book` no lee-y-después-escribe: hace un `UPDATE`
condicionado al estado actual —

```sql
UPDATE nutrition_slots
SET status = 'reservado', player_id = :player_id, booked_at = now()
WHERE id = :id AND status = 'libre'
```

— y si actualiza **cero filas**, responde `409`: alguien reservó ese horario
un instante antes. Es el mismo principio que el `UNIQUE (session_id, team,
jersey_number)` de [[data-model]]: la base es quien arbitra la carrera, no un
chequeo previo en la aplicación que puede perder contra otro request.

---

## Endpoints

```
POST   /clubs/{id}/nutrition-slots        -- alta en lote, nutricionista
GET    /clubs/{id}/nutrition-slots        -- ?from=&to=&status=&nutritionist_id=
POST   /nutrition-slots/{id}/book         -- jugador reserva
POST   /nutrition-slots/{id}/cancel       -- jugador cancela el propio; nutricionista cancela cualquiera
GET    /me/nutrition-appointments         -- mis turnos (jugador)
```

`POST /clubs/{id}/nutrition-slots` acepta una lista de `{starts_at, ends_at}`: la
nutricionista bloquea la mañana del jueves en una sola carga, no horario por
horario.

`GET /clubs/{id}/nutrition-slots` sin `status` filtra a `libre` para un jugador
(no tiene sentido que vea turnos ya tomados por otro) y sin filtrar para la
nutricionista, que necesita ver su agenda completa.

Cancelar un turno **reservado** no lo borra: pasa a `cancelado` y **libera un
nuevo slot** con el mismo horario si lo cancela la nutricionista (para que otro
jugador lo pueda tomar), o simplemente queda cancelado si lo cancela el jugador
—la nutricionista decide si ese horario vuelve a publicarse—. Cancelar uno
**libre** si lo hace la nutricionista simplemente lo saca de la lista.

---

## Recordatorio: primer trabajo con horario del backend

Ningún módulo hasta ahora necesitó dispararse **por tiempo** en vez de por un
request. [[bolsa-trabajo]] evitó explícitamente necesitar un scheduler haciendo
que "vencido" fuera un estado calculado al leer. Acá no hay vuelta: un
recordatorio que nadie mira hasta que ya pasó el turno no sirve.

**Elección**: un job en proceso con `APScheduler`, corriendo dentro del mismo
contenedor del backend — no una cola ni un contenedor aparte. `docker-compose.yml`
ya corre un solo backend ([[despliegue]]: "un solo servidor"); sumar Redis y un
worker para un job que corre una vez por hora sería infraestructura para un
problema que no la necesita.

- Corre cada hora. Busca `nutrition_slots` con `status = 'reservado'`,
  `starts_at` entre 20 y 24 horas en el futuro, y `reminder_sent_at IS NULL`.
- Por cada uno, llama a `notify(type=turno_recordatorio)` y **recién después**
  escribe `reminder_sent_at`. Si el proceso se reinicia entre el envío y la
  escritura, en el peor caso se manda dos veces — no cero. Preferible a perderlo.
- Con un solo backend corriendo (según [[despliegue]] hoy es así) no hay riesgo
  de que dos instancias disparen el mismo job en paralelo. Si el despliegue algún
  día escala a más de un proceso backend, este job pasa a necesitar un lock
  (`SELECT ... FOR UPDATE SKIP LOCKED` sobre los slots candidatos alcanza) — se
  deja anotado para no repetir el problema, no se resuelve ahora porque hoy no
  existe.

---

## Notificaciones que dispara

Vía [[add-notificaciones-push]], dos tipos nuevos:

```python
turno_confirmado    # al reservar, al jugador
turno_recordatorio  # 20-24h antes, al jugador
```

`turno_confirmado` también le llega a la **nutricionista** cuando alguien
reserva o cancela — es su agenda, y enterarse por la app es mejor que
encontrarse con un consultorio vacío.

---

## Permisos

```
nutricion.turnos_publicar    -- crear/cancelar horarios, ver la agenda completa
nutricion.turnos_reservar    -- reservar y cancelar el propio turno
```

- **Preset Nutricionista**: `nutricion.turnos_publicar`.
- **Preset Jugador**: `nutricion.turnos_reservar`, agregada directamente al
  preset (no llega por herencia de Socio: el pedido del club es "como
  jugador", y un socio que no juega no tiene ficha física que la nutricionista
  siga). Si el club quiere abrirlo a socios en general, es agregar la
  capacidad al preset Socio — una fila, no un cambio de código.
- **Administrador**: ambas, como con el resto de los módulos.

---

## Fases de Implementación

### Fase A: Modelo y reserva
- [x] Migración: `nutrition_slots`
- [x] `POST /clubs/{id}/nutrition-slots` (alta en lote)
- [x] `POST /nutrition-slots/{id}/book` con `UPDATE` condicionado
- [x] `POST /nutrition-slots/{id}/cancel`
- [x] `GET /clubs/{id}/nutrition-slots`, `GET /me/nutrition-appointments`
- [x] Capacidades `nutricion.turnos_publicar` y `nutricion.turnos_reservar`
- [x] Tests: dos reservas simultáneas del mismo slot, una gana y la otra recibe
      `409`; cancelar libera o no según quién cancela

### Fase B: Recordatorio
- [x] `APScheduler` en el proceso del backend, job cada hora
- [x] `reminder_sent_at` se escribe después de notificar, no antes
- [x] Test: el job no reenvía un recordatorio ya marcado

### Fase C: Frontend
- [x] Pantalla de la nutricionista: publicar horarios (selector múltiple),
      agenda del día/semana
- [x] Pantalla del jugador: horarios libres, "mi turno" si tiene uno reservado
- [x] Confirmación y cancelación con feedback inmediato (la reserva puede
      fallar con `409` si alguien se adelantó — mostrarlo, no reintentar solo)

### Fase D: Documentación
- [x] `openspec/specs/turnos-nutricion.md`
- [x] Actualizar [[data-model]], [[permisos]] y [[navigation]]

### No planeado, encontrado en el camino
- [x] `POST /divisions/{id}/players/{id}/invite` nunca llamaba a
      `assign_preset_for_legacy_role`: todo jugador invitado quedaba con cero
      capacidades. Corregido + test de regresión. Ver detalle en
      [[turnos-nutricion]].

---

## Fuera de Alcance

| Qué | Por qué no |
|-----|-----------|
| **Recurrencia automática de horarios** | Cubierto con alta en lote; un motor de reglas es sobreingeniería para una agenda que cambia semana a semana |
| **Lista de espera** | Sin horarios libres, el jugador espera a que se publiquen más — no se pidió, y agrega un estado más para mantener sincronizado |
| **Pago del turno** | Mismo criterio que [[socios]]: cobro está fuera de alcance de toda la plataforma |
| **Turnos grupales** | Un slot es un jugador; una charla grupal no es un "turno" en este sentido |
| **Abrir la reserva a socios no jugadores** | El pedido es "como jugador"; queda a un permiso de distancia si el club lo pide después |

---

## Impacto en Código Existente

| Área | Impacto |
|------|---------|
| `backend/app/models/nutrition_slot.py` | Nuevo |
| `backend/app/api/v1/nutrition.py` | Nuevo |
| `backend/app/core/permissions.py` | Dos capacidades nuevas |
| `backend/app/core/scheduler.py` | Nuevo — primer uso de `APScheduler` en el backend |
| `requirements.txt` | `APScheduler` |
| `frontend/src/pages/` | Dos pantallas nuevas (nutricionista y jugador) |

---

## Decisiones Técnicas

| Decisión | Elección | Razón |
|----------|----------|-------|
| Horario y reserva | Una tabla, no dos | Relación 1 a 1 siempre; separarlas obliga a un join en cada lectura |
| Choque de reserva | `UPDATE` condicionado, `409` si afecta cero filas | La base arbitra la carrera; un chequeo previo puede perder contra otro request |
| Recordatorio | `APScheduler` en proceso, no Celery/Redis | Un job por hora no justifica infraestructura nueva con un solo backend corriendo |
| Reserva de jugador | Directo en preset Jugador, no heredado de Socio | El pedido es específicamente para jugadores con ficha física |
| Recurrencia | No automática, alta en lote | La agenda real cambia semana a semana; un motor de reglas no se va a usar bien |

---

## Criterios de Aceptación

- [x] La nutricionista publica varios horarios en una sola carga
- [x] Un jugador reserva un horario libre y dos jugadores no pueden reservar el
      mismo (uno gana, el otro ve `409` en el momento)
- [x] Cancelar un turno reservado (jugador o nutricionista) actualiza la agenda
      de ambos
- [x] El jugador recibe un recordatorio entre 20 y 24 horas antes de su turno
- [x] El recordatorio no se manda dos veces aunque el job corra varias veces
      sobre la misma ventana
- [x] Un socio sin ficha de jugador no puede reservar (salvo que el club le dé
      la capacidad explícitamente)

---

## Riesgos

| Riesgo | Mitigación |
|--------|-----------|
| **Dos jugadores reservan el mismo horario a la vez** | `UPDATE` condicionado con verificación de filas afectadas, no lectura previa |
| **El recordatorio no sale porque el backend estaba caído en la hora del job** | El job corre cada hora, no una vez al día: la ventana de 20-24h absorbe una caída corta |
| **`APScheduler` duplica el job si el backend escala a más de una instancia** | Documentado como límite conocido; hoy no aplica ([[despliegue]] corre un solo backend) |

---

## Relacionado

- [[add-portal-completo-roadmap]] — el programa; este es su cambio 4
- [[add-notificaciones-push]] — de donde sale el recordatorio y la confirmación
- [[permisos]] — preset Nutricionista, hasta ahora vacío
- [[socios]] — mismo criterio de "cobro fuera de alcance"
- [[bolsa-trabajo]] — el módulo que evitó necesitar scheduler; acá sí hace falta
- [[despliegue]] — un solo backend, supuesto detrás de la elección de `APScheduler`
- [[data-model]] — schema
