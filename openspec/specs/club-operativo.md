---
title: Club operativo
status: active
created: 2026-07-26
---

# Club operativo

> Refleja lo **implementado** en `core/deps.py`, `dashboard.py`, `competition.py`,
> `players.py` y las migraciones `0014`–`0015`.

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
- El portal es de **lectura**. Qué puede editar un jugador de su propia ficha es
  una decisión del club, no un default técnico.

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
- [[data-model]] — schema
