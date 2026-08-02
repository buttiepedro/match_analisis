---
title: Portal multidivisión — fixture, tablas, citados y lugar de entrenamiento
type: feature
status: completed
spec: club-operativo
created: 2026-07-29
completed: 2026-08-01
---

# Portal multidivisión — fixture, tablas, citados y lugar de entrenamiento

## Descripción del Cambio

Hoy un socio o jugador que entra a la app ve, como mucho, **su propia división** —
y el socio ni eso, porque no tiene una. Todo lo demás (fixture, tabla de
posiciones, quién fue citado) vive en pantallas de [[club-operativo]] pensadas
para el cuerpo técnico, con el alcance por división limitando a cada entrenador a
la suya.

Este cambio agrega tres vistas **de sólo lectura, del club entero**, y una columna
nueva:

1. **Fixture de todas las divisiones**: próximos partidos y resultados, no sólo
   los de la división del jugador.
2. **Tablas de posiciones de todas las divisiones**.
3. **Planteles citados de todas las divisiones**: quién fue convocado para el
   próximo partido, división por división.
4. **Lugar de entrenamiento**: un dato que hoy no existe en `trainings` y que el
   jugador necesita para saber a dónde ir.

No hay lógica nueva de cálculo: `standings` ya se calcula en
[[club-operativo]], `match_squad` ya existe en [[gestion-semanal]]. Este cambio
es **agregación club-entero** sobre datos que ya están, más una columna.

---

## Por qué el alcance por división no sirve acá

`user_divisions` ([[club-operativo]]) fue diseñado para **restringir**: un
entrenador ve sólo lo suyo. Acá el problema es el inverso — un socio no tiene
división y necesita ver **todas**, y un jugador quiere ver la suya *además de* las
demás, no en lugar de ellas.

Por eso esto no es "sacarle el alcance a `partido_ver`" — es una capacidad nueva
que por definición no se filtra por división, del mismo modo en que `socios.ver_propia`
tampoco se filtra: es un permiso de club, no de división.

---

## Modelo

### `Training` — una columna

```sql
trainings
+ location   VARCHAR(150) NULL   -- "Cancha 2", "Gimnasio del club", una dirección
```

Nullable y libre: el club nombra sus lugares como quiera, y una migración no
puede inventar valores para los entrenamientos que ya existen.

### Sin tablas nuevas

Fixture, tablas y citados son **lecturas nuevas** sobre `sessions`, `tournaments`
y `match_squad`. No se persiste nada que no exista.

---

## Endpoints nuevos

```
GET /clubs/{id}/fixture
GET /clubs/{id}/standings
GET /clubs/{id}/convocatorias
```

### `GET /clubs/{id}/fixture`

Devuelve, agrupados por división, los partidos de todos los torneos activos del
club — programados y jugados, con resultado si terminaron. `?upcoming=true`
recorta a los que faltan jugar.

Reusa la misma consulta que ya arma `GET /divisions/{id}/calendar`, sin el filtro
de división. No hay lógica nueva: es sacar un `WHERE`.

### `GET /clubs/{id}/standings`

Por cada división con un torneo activo, su tabla — la misma que calcula
`GET /tournaments/{id}/standings`, resuelta división por división. Una división
sin torneo activo aparece con estado vacío, no se omite: que "Femenino" no tenga
torneo cargado hoy es información, no un error.

### `GET /clubs/{id}/convocatorias`

Por cada división, la convocatoria (`match_squad`) del **próximo** partido con
convocatoria cargada. A diferencia de `GET /sessions/{id}/squad/message` — que
devuelve `404` sin convocatoria porque ahí el pedido es sobre un partido puntual —
este índice **no falla** por una división sin cargar: la omite de la lista con
un motivo (`sin_convocatoria`), porque acá el pedido es "mostrame lo que haya".

No expone teléfono ni DNI: `match_squad` sólo tiene nombre y estado
(`convocado`/`confirmado`/`baja`), así que no hay el problema de datos personales
que sí tiene [[bolsa-trabajo]].

---

## Permisos

Una capacidad nueva, no tres. Fixture, tabla y citados son la misma pregunta —
"¿cómo le va al club?"— y separarlas en capacidades distintas sería una
distinción que el club nunca va a usar: no existe el caso de alguien que deba ver
el fixture pero no la tabla.

```
club.ver_competencia
```

- **Preset Socio**: la recibe. Como **Jugador hereda de Socio**
  ([[permisos]]), la hereda automáticamente — no hay que tocar el preset
  Jugador a mano.
- **Presets Administrador, Entrenador, Analista**: la reciben también, porque hoy
  ya ven esto sin restricción (es lo que hacían las pantallas de
  [[club-operativo]]); no se les saca nada.
- El mecanismo de `known_permissions` de [[permisos]] se encarga de repartirla a
  los clubes que ya existen sin tocar roles custom.

El menú agrega **Fixture**, **Tablas** y **Citados** bajo el grupo "Club" de
[[navigation]], visibles con `club.ver_competencia`.

---

## Diferencia de presentación entre socio y jugador

Mismos endpoints, mismo permiso — la diferencia es de **orden**, no de acceso:

- Un **jugador** ve su propia división primero, y el resto debajo, colapsado.
- Un **socio** —que no tiene división— ve las divisiones en el orden que
  configuró el club (el mismo orden que ya usa el selector de división en el
  resto de la app).

No es una regla de permisos, es una decisión de UI: `players.division_id` del
usuario logueado, si existe, define qué sección abre primero.

---

## Fases de Implementación

### Fase A: Backend
- [x] Migración: `trainings.location` nullable (`0023`)
- [x] `GET /clubs/{id}/fixture` (agrega sobre `sessions`+`tournaments` sin filtro
      de división; incluye resultado vía `score_from_events` cuando terminó)
- [x] `GET /clubs/{id}/standings` (reusa `compute_standings`, extraída de
      `tournament_standings` para no duplicar el cálculo)
- [x] `GET /clubs/{id}/convocatorias` (agrega sobre `match_squad`, con estado
      `sin_convocatoria` por división en vez de `404`)
- [x] Capacidad `club.ver_competencia`, agregada a los presets Administrador,
      Entrenador, Analista y Socio
- [x] `location` en los schemas de creación/edición de `trainings` y en las
      respuestas de `today` y `calendar`
- [x] Tests (`test_club_competencia.py`, `test_trainings.py`): los tres
      endpoints devuelven todas las divisiones sin alcance —incluso a un
      entrenador con alcance restringido—, `convocatorias` no rompe con una
      división sin convocatoria cargada, `location` nullable no rompe
      entrenamientos existentes. Suite completa corrida: 343 passed.

### Fase B: Frontend — pantallas nuevas
- [x] Pantalla Fixture: lista por división, con filtro "Próximos"/"Todos"
- [x] Pantalla Tablas: una tabla por división, estado vacío si no hay torneo activo
- [x] Pantalla Citados: por división, lista de convocados con su estado
- [x] Orden: división propia primero para el jugador (`useOwnDivisionId`), orden
      de club para el socio (ya es el orden que devuelve la API)
- [x] Entradas nuevas en el menú bajo "Club", con permiso `club.ver_competencia`
      (`Layout.test.ts` actualizado y en verde)

### Fase C: Frontend — lugar de entrenamiento
- [x] Campo `location` en el formulario de alta y edición de entrenamiento
      (alta en `Trainings.tsx`, edición inline en `TrainingAttendance.tsx`)
- [x] Se muestra en "Hoy" y en el calendario. **No** en Fixture: por diseño esa
      pantalla es sólo partidos (ver "Descripción del Cambio" más arriba), así
      que el lugar de entrenamiento no aplica ahí — el criterio de aceptación
      original lo nombraba de más.

### Fase D: Documentación
- [x] Actualizar [[club-operativo]] con las tres pantallas y `location`
- [x] Actualizar [[data-model]] con la columna nueva
- [x] Actualizar [[navigation]] con las entradas de menú nuevas

---

## Fuera de Alcance

| Qué | Por qué no |
|-----|-----------|
| **Editar el fixture o la convocatoria desde el portal** | Sigue siendo del cuerpo técnico; esto es sólo lectura, igual que el resto del portal |
| **Notificación al cargarse la convocatoria** | Es [[add-notificaciones-push]]; este cambio deja el dato disponible, no avisa de nada |
| **Geolocalización o mapa del lugar de entrenamiento** | `location` es texto libre; un mapa es una feature aparte que no se pidió |
| **Historial de tablas de temporadas pasadas** | `standings` ya sólo mira el torneo activo por división, igual que hoy; no se agrega selector de temporada |

---

## Impacto en Código Existente

| Área | Impacto |
|------|---------|
| `backend/app/models/training.py` | Columna `location` |
| `backend/app/api/v1/clubs.py` (o módulo nuevo `competencia.py`) | Tres endpoints nuevos |
| `backend/app/core/permissions.py` | `club.ver_competencia` |
| `frontend/src/pages/` | Tres pantallas nuevas, lazy-loaded como el resto del portal |
| `frontend/src/components/Sidebar` (o equivalente de [[navigation]]) | Tres ítems nuevos |
| `docker-compose.yml`, backend existente | Ninguno |

---

## Decisiones Técnicas

| Decisión | Elección | Razón |
|----------|----------|-------|
| Capacidad | Una sola (`club.ver_competencia`) | Fixture, tabla y citados se conceden siempre juntos; separarlas es una distinción sin caso de uso |
| Convocatorias sin cargar | Se omiten con motivo, no `404` | El pedido es un índice del club, no de un partido puntual |
| `location` | Texto libre, nullable | El club nombra sus lugares como quiere; una migración no puede completar el historial |
| Orden de divisiones | Propia primero para el jugador, orden de club para el socio | Decisión de UI, no de permisos — mismo endpoint, mismo dato |

---

## Criterios de Aceptación

- [x] Un socio ve fixture, tablas y citados de **todas** las divisiones del club
      — verificado en vivo: club Demo sembrado con `scripts/seed_demo.py`,
      login como socia (Fernández Marta, DNI) muestra Fixture/Tablas/Citados
      con las 4 divisiones del club, sin tener ninguna propia
- [x] Un jugador ve lo mismo, con su división primero — `withOwnFirst` cubierto
      por test unitario; el seed no crea logins de jugador para probarlo en
      vivo, pero la lógica es la misma que ya se probó con el socio más el
      ordenamiento, que es puro y no depende del rol
- [x] Una división sin torneo activo aparece con estado vacío, no rota la
      pantalla — test + verificado en vivo (M17/M19/Primera sin torneo activo
      en el seed, título de división visible igual)
- [x] Una división sin convocatoria cargada aparece marcada como tal, sin `404`
      — test + verificado en vivo
- [x] El entrenador puede cargar/editar el lugar de un entrenamiento, y se ve en
      "Hoy" y el calendario — verificado en vivo end-to-end. **No** en el
      fixture: por diseño esa pantalla es sólo partidos (ver arriba), el
      criterio original lo nombraba de más
- [x] Un socio o jugador **sin** `club.ver_competencia` (si el club se la sacó a
      mano) no ve las tres pantallas nuevas ni sus entradas de menú — por
      construcción (`require()` en el backend, `navFor` filtrando por
      capacidad en el frontend), cubierto por test de cada lado
- [x] Los roles de club existentes conservan exactamente el acceso que tenían
      — capacidad nueva agregada, ninguna existente tocada; suite completa de
      backend (343 tests) y frontend (89 tests) en verde

---

## Riesgos

| Riesgo | Mitigación |
|--------|-----------|
| **Sobrecargar `GET /clubs/{id}/*` con tres consultas pesadas en un club grande** | Cada endpoint reusa las consultas ya indexadas de [[club-operativo]]; no hay agregación nueva sobre eventos |
| **El socio ve datos de una división que preferiría mantener interna** (ej. un torneo de menores) | El club decide con `club.ver_competencia`: se le puede sacar el permiso al preset Socio sin tocar código |

---

## Relacionado

- [[add-portal-completo-roadmap]] — el programa; este es su cambio 1
- [[club-operativo]] — `standings`, `calendar`, alcance por división
- [[gestion-semanal]] — `match_squad`, convocatoria
- [[permisos]] — capacidades y herencia Jugador-de-Socio
- [[socios]] — el socio, que no tiene división propia
- [[navigation]] — dónde entran las pantallas nuevas
- [[data-model]] — schema
