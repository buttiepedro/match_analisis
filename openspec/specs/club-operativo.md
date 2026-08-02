---
title: Club operativo
status: active
created: 2026-07-26
---

# Club operativo

> Refleja lo **implementado** en `core/deps.py`, `dashboard.py`, `competition.py`,
> `club_competencia.py`, `players.py` y las migraciones `0014`–`0015`, `0023`.

Hace operable lo que [[gestion-semanal]] construyó: permisos que respetan la
estructura del club, una foto del día, y competencia con memoria entre fechas.

---

## Alcance por división

`user_divisions` limita a un usuario a ciertas divisiones.

**La regla central: sin filas = todas las divisiones del club.** No es un detalle
de implementación — es lo que hace que asignar alcance sea opcional, que la
migración no le saque acceso a nadie, y que un club de una sola división no tenga
que configurar nada.

- `superadmin` y `club_admin` **ignoran** el alcance: administran el club entero.
- `PUT /clubs/{id}/users/{uid}/divisions` con lista vacía **quita** la
  restricción; no deja al usuario sin acceso.
- Se valida en trainings, injuries, season, players, performance y lineup. Este
  último llega a la división por sesión → torneo.

Antes de esto, `_get_division_or_404` validaba el club y no la división: un
`match_director` borraba entrenamientos ajenos y un `analyst` pisaba la asistencia
de otra división.

---

## Rol `player` y portal

`players.user_id` vincula un jugador con su usuario. El rol es propio, no un
usuario de club con menos permisos.

- `POST /divisions/{id}/players/{pid}/invite` crea el acceso.
- `GET /me/player` no toma id: devuelve la ficha del que está logueado.
- `require_player_self` se aplica en el helper de acceso a jugador, no endpoint
  por endpoint, para que agregar una ruta nueva no abra por olvido la ficha de
  todo el plantel.

### El portal, completo ([[add-perfil-jugador-completo]])

Todos los endpoints `/me/player*` resuelven de `_get_own_player(current_user)` —
ninguno toma un `id`, así que agregar una ruta nueva del portal no puede abrir
por olvido la ficha de otro jugador.

- `GET /me/player` — la ficha completa, incluido lo que ya existía en
  `players` pero nunca había viajado al portal: contacto, obra social, apto
  médico. Suma `clearance_expired`/`clearance_expiring`, calculados igual que
  en la grilla de armado (`CLEARANCE_WARNING_DAYS = 30`), para que el jugador
  no tenga que restar fechas.
- `GET /me/player/division-history` — en qué divisiones jugó, no sólo en cuál
  está ahora. Misma consulta que ya usaba `GET /players/{id}/history`
  (`api/v1/performance.py`) para el cuerpo técnico; acá resuelta del token.
- `GET /me/player/injuries` — sólo lesiones **cerradas**
  (`actual_return IS NOT NULL`): las abiertas ya se resumen en `availability`,
  y el detalle clínico completo de una lesión activa sigue siendo del cuerpo
  médico.
- `PATCH /me/player` — el jugador edita **contacto**: `phone`,
  `emergency_phone`, `email`. El schema (`MyPlayerUpdate`) usa
  `extra="forbid"`: un campo fuera de la whitelist (`dni`, `availability`, la
  foto) responde `422`, no un `200` que no cambió nada. `dni`, obra social y
  posición quedan fuera porque el club necesita poder auditarlos, igual que
  `dues_synced_at` en [[socios]]; disponibilidad y apto médico quedan fuera
  porque los escribe únicamente `injuries.py` — dejar que el jugador los toque
  rompería esa única fuente de escritura.
- `POST /me/player/photo` — la foto se sube aparte, con `core/storage.py`
  (`read_upload` + `put_object`), la misma validación de tipo/tamaño que usa
  el cuerpo técnico. Clave determinística (`players/{id}.{ext}`): es la foto
  de perfil, no un álbum, así que la próxima subida reemplaza a la anterior.

El portal ya **no** es de sólo lectura — la Fase C de
[[add-perfil-jugador-completo]] se implementó siguiendo la propuesta del
documento tal cual, sin haberla confirmado con un club real todavía: si algún
club prefiere que nada sea editable, es cuestión de no exponer el botón
"Editar" en el frontend, el backend no tiene que tocarse.

---

## Hoy y calendario

`GET /clubs/{id}/today` arma la foto del día en un request: entrenamientos de hoy
(marcando si falta cargar la planilla), próximos partidos, y avisos de no
disponibles, apto vencido, apto por vencer, rojas sin sanción y jugadores en
riesgo. Respeta el alcance.

`GET /divisions/{id}/calendar` devuelve partidos y entrenamientos en una serie
única ordenada por fecha.

El estado vacío está redactado a propósito para no leerse como error: un club sin
nada agendado hoy es lo normal.

`trainings.location` (texto libre, nullable) se suma a ambas respuestas y a
`TrainingWithCountsResponse`: el jugador necesita saber a dónde ir, y el club
nombra sus lugares como quiere, así que no hay catálogo que mantener.

---

## Portal multidivisión

`club_competencia.py` agrega tres vistas de **sólo lectura, del club entero**,
detrás de una única capacidad — `club.ver_competencia` — que a propósito **no**
se filtra por `user_divisions`: un socio no tiene división propia, así que el
alcance por división ni siquiera aplica, y un jugador quiere ver las demás
divisiones *además de* la suya, no en lugar de ella. Es el motivo por el que
estas tres rutas no llaman a `assert_division_access` ni a `visible_division_ids`
— sólo a `assert_club_access`.

- `GET /clubs/{id}/fixture` — partidos de todas las divisiones con torneo
  cargado, con el resultado (`home_score`/`away_score`, vía
  `score_from_events`) cuando terminaron. `?upcoming=true` filtra los que ya
  se jugaron.
- `GET /clubs/{id}/standings` — la tabla de [[#Tabla de posiciones]], resuelta
  división por división vía `compute_standings` (extraída de
  `tournament_standings` para no duplicar el cálculo). Una división sin
  torneo activo aparece con `tournament_id: null` y `rows: []`, no se omite.
- `GET /clubs/{id}/convocatorias` — la convocatoria del **próximo** partido
  con `match_squad` cargado, por división. A diferencia de
  `GET /sessions/{id}/squad/message` (`404` sin convocatoria, porque ahí el
  pedido es sobre un partido puntual), acá una división sin cargar se marca
  con `reason: "sin_convocatoria"`: el pedido es un índice del club, no de un
  partido.

El preset Socio recibe `club.ver_competencia` directamente; Entrenador,
Analista y Administrador también (ya veían esto sin restricción desde las
pantallas de cuerpo técnico). Jugador la recibe **si** el club lo configuró
para heredar de Socio ([[permisos]]) — no viene encadenado por defecto.

En el frontend, mismo endpoint para socio y jugador: la diferencia es de
**orden**, no de acceso. Un jugador ve su propia división primero (vía
`GET /me/player`); un socio, sin división propia, ve el orden que ya devuelve
la API (`Division.name`, el mismo que usa el selector de división en el resto
de la app).

---

## Rival como entidad

`opponents` (único por club + nombre) con `sessions.opponent_id` nullable.

`home_team` / `away_team` **se conservan**: son el registro de cómo se llamó ese
partido y hay estadísticas que dependen de ellos. La entidad no los reemplaza,
agrega la capacidad de cruzar fechas.

El backfill de `0015` normaliza por **nombre exacto con trim** dentro del club.
Unir por similitud uniría clubes homónimos de uniones distintas, que es peor que
dejar dos filas para unificar a mano.

`POST /clubs/{id}/opponents` es idempotente: el autocompletado va a mandar el
mismo nombre más de una vez y eso no es un error del usuario.

---

## Tabla de posiciones

`GET /tournaments/{id}/standings`, **calculada** desde los eventos.

- Sólo partidos `finished`. Una tabla que cambia sola durante el segundo tiempo
  no es una tabla.
- Puntaje URBA: ganado 4, empate 2, perdido 0.
- Bonus ofensivo con 4 tries o más, se gane o se pierda.
- Bonus defensivo al perder por 7 o menos.
- Ordena por puntos, después diferencia, después nombre.

Una fila por rival: es la tabla que un club arma en la práctica — cómo le fue
contra cada uno.

---

## Convocatoria: aviso

`GET /sessions/{id}/squad/message` devuelve el texto listo para pegar, con rival y
fecha. Sin convocatoria cargada responde `404`.

Se eligió texto sobre push: el grupo de WhatsApp ya existe y funciona, y push
exigiría service worker, permisos y backend de envío para el mismo resultado.

---

## Mediciones

`/performance` pasó a `/mediciones` (la ruta vieja redirige) y se partió en dos
solapas, porque son dos trabajos que hacen personas distintas:

- **Físico** — ranking por división y test, agrupado por categoría:
  **Potencia** (Test de Salto, salto horizontal), **Resistencia** (Bronco,
  VO2max), **Fuerza** (Press Banca 3RM, Sentadilla 3RM y los 1RM ya existentes).
- **Nutrición** — antropometría del plantel de un vistazo: último peso, % de
  grasa y su variación contra la medición anterior, más quiénes faltan medir.

Velocidad y Flexibilidad siguen existiendo con sus tests ya cargados: renombrar y
recategorizar no puede perder datos históricos.

---

## Bundle

Rutas con `React.lazy` y chunks separados para ECharts, `xlsx` y `jspdf`.

Carga inicial: **3.286 kB → 223 kB**. El tablero de cancha suma 34 kB y ya no baja
librerías que no usa — en una app cuyo argumento es funcionar con mala señal, eso
no era cosmético.

---

## Relacionado

- [[gestion-semanal]] — la capa que esto hace operable
- [[auth-and-users]] — roles, que el alcance por división extiende
- [[permisos]] — capacidades y herencia Jugador-de-Socio, que decide quién
  llega al portal multidivisión
- [[add-portal-multidivision]] — la propuesta del portal multidivisión
- [[navigation]] — dónde entran Fixture, Tablas y Citados en el menú
- [[data-model]] — schema
