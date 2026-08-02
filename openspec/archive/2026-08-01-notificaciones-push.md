---
title: Notificaciones — infraestructura genérica, primer disparador es la formación
type: feature
status: completed
spec: notificaciones
created: 2026-07-29
completed: 2026-08-01
---

# Notificaciones — infraestructura genérica, primer disparador es la formación

## Descripción del Cambio

Hoy no existe **ningún** canal de push en la app. [[club-operativo]] lo evaluó
para la convocatoria y eligió texto para copiar al grupo de WhatsApp,
explícitamente porque armar push para un solo aviso no se justificaba.

Dejó de ser un solo aviso. El club pide avisar al jugador cuando sale la
**formación** (`match_lineup`, la grilla de 23), y ya se sabe que van a venir más
—turno de nutrición confirmado en [[add-turnos-nutricion]], y probablemente
asistencia y cuotas más adelante—. Construir push por avisos, uno a la vez, es
rehacer el mismo trabajo cada vez. Este cambio construye el **servicio genérico**
una sola vez, con la formación como primer disparador.

---

## Principio

**Todo aviso se guarda en una bandeja del usuario, y además se intenta empujar.**
La bandeja no es un respaldo del push — es el canal primario, porque el push
**puede no llegar** por motivos que nada tienen que ver con un bug: el usuario no
dio permiso, el navegador no lo soporta, o —el caso que más importa acá— es
iPhone y no agregó la app a la pantalla de inicio.

Push que falla no pierde el aviso. Lo pierde sólo si tampoco se guardó.

---

## Modelo

```sql
notification_devices
  id             UUID PK
  user_id        UUID FK → users.id
  channel        ENUM('web_push', 'fcm', 'apns')
  endpoint       TEXT NOT NULL        -- URL de push (web) o token (nativo)
  p256dh         VARCHAR(255)         -- clave pública de la suscripción, sólo web_push
  auth_secret    VARCHAR(255)         -- sólo web_push
  is_active      BOOLEAN DEFAULT TRUE
  last_seen_at   TIMESTAMP
  created_at     TIMESTAMP

  UNIQUE (user_id, endpoint)

notifications
  id          UUID PK
  club_id     UUID FK → clubs.id
  user_id     UUID FK → users.id
  type        VARCHAR(50) NOT NULL   -- catálogo en código, ver abajo
  title       VARCHAR(150) NOT NULL
  body        VARCHAR(300) NOT NULL
  data        JSONB DEFAULT '{}'     -- ej. {"session_id": "..."} para deep link
  read_at     TIMESTAMP NULL
  created_at  TIMESTAMP

  INDEX (user_id, created_at)

notification_preferences
  user_id     UUID FK → users.id
  type        VARCHAR(50) NOT NULL
  enabled     BOOLEAN DEFAULT TRUE

  UNIQUE (user_id, type)
```

`channel` es lo que hace que `fcm`/`apns` (nativos, de
[[add-app-movil-react-native]]) sean **agregar una fila al enum y un sender**, no
un sistema aparte. `notifications` y `notification_preferences` no cambian nada
el día que se sume el canal nativo.

Sin `notification_preferences` explícita, `enabled = true`: opt-in por defecto,
opt-out a mano, igual que el resto de la app no obliga a configurar nada para
funcionar.

---

## El catálogo de tipos vive en código

Igual que `Permission` en [[permisos]]: los tipos de notificación son constantes,
no filas. Este cambio agrega uno solo:

```python
class NotificationType(str, enum.Enum):
    formacion_cargada = "formacion_cargada"
```

Cada tipo posterior ([[add-turnos-nutricion]] va a sumar `turno_confirmado` y
`turno_recordatorio`) se agrega ahí, sin tocar el modelo.

---

## Servicio de despacho

```python
async def notify(db, *, user_id: UUID, club_id: UUID, type: NotificationType,
                  title: str, body: str, data: dict = {}) -> None:
    ...
```

1. Si `notification_preferences` tiene ese `type` en `false` para el usuario,
   **no hace nada** — ni guarda ni empuja. Es la regla de opt-out: apagado es
   apagado, no "apagado del push pero igual aparece en la bandeja".
2. Inserta en `notifications`.
3. Por cada `notification_devices` activo del usuario, delega al sender de su
   `channel`. Hoy sólo existe `WebPushSender`; es la interfaz que
   [[add-app-movil-react-native]] implementa para `fcm`/`apns`.
4. Un sender que falla con **410/404** (suscripción vencida o revocada por el
   navegador) marca ese device `is_active = false`. Cualquier otro error se
   loguea y no reintenta: un push es best-effort, y reintentar un aviso de
   "salió la formación" media hora después ya no tiene sentido.

Nunca lanza sobre el flujo que lo llama: `notify()` corre en un `try` propio
dentro de `PUT /sessions/{id}/lineup`, para que un fallo del servicio de push no
tire abajo el guardado de la formación, que es lo que el entrenador vino a hacer.

---

## Web push

- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` en el `.env` del
  backend, generadas una vez por instalación (no por club: las claves VAPID son
  del origen, no del tenant).
- `GET /push/vapid-public-key` — el frontend la necesita para suscribir.
- `frontend/public/sw.js`: service worker mínimo, sólo `push` (muestra la
  notificación) y `notificationclick` (navega a `data.url` si vino). No cachea
  nada — no es este cambio el que convierte la app en PWA offline-first, sólo
  registra el canal de push.
- `POST /me/notification-devices` — el frontend manda la `PushSubscription` del
  navegador después de que el usuario acepta el permiso.

### El permiso no se pide al entrar

Pedir el permiso de notificaciones en el primer segundo de la sesión es la forma
más confiable de que el usuario lo rechace y no se lo vuelva a preguntar el
navegador. Se pide **en contexto**: un banner en el perfil del jugador
("activá avisos para enterarte cuando salga la formación"), con explicación de
qué va a avisar antes de que el navegador muestre su propio diálogo.

### La limitación de iOS Safari, dicha de frente

Web push en iOS **sólo** funciona si Safari es 16.4+ y la app está agregada a la
pantalla de inicio — no funciona en una pestaña normal del navegador. Es una
limitación de Apple, no de esta implementación, y no tiene vuelta: para un
jugador con iPhone que no instaló la app a su pantalla de inicio, el aviso va a
llegar **sólo** a la bandeja dentro de la app, no como push del sistema.

Esta limitación es la razón concreta por la que [[add-app-movil-react-native]]
importa: una app nativa en el iPhone recibe push por APNs sin esa condición.
Mientras tanto, la bandeja en la app es lo que evita que ese jugador se quede sin
enterarse.

---

## Disparador: formación cargada

Se dispara desde `PUT /sessions/{id}/lineup`, **sólo** en la transición de "sin
lineup" a "con lineup" para el equipo propio de esa sesión — no en cada
corrección posterior.

**Por qué no en cada `PUT`.** [[gestion-semanal]] deja clara la razón de fondo:
el lineup se corrige durante el partido (sustituciones, un número mal cargado).
Si cada guardado avisara, un jugador recibiría cuatro notificaciones el mismo
sábado por correcciones que no le cambian nada. El aviso que el jugador quiere es
uno: *"ya está la formación, andá a mirar si estás"*.

Destinatarios: todos los `players.user_id` **no nulos** de la división del
partido — no sólo los 23 que quedaron en la grilla. Un jugador que quedó afuera
también quiere enterarse, y antes que nadie se lo cuente.

```
title: "Formación de {división}"
body:  "Ya está la formación para {rival} del {fecha}. Fijate si estás."
data:  { "session_id": "...", "url": "/sessions/{id}/lineup" }
```

---

## Bandeja y preferencias

- `GET /me/notifications?unread=true` — paginada, más reciente primero.
- `POST /me/notifications/{id}/read`
- `GET|PUT /me/notification-preferences` — un toggle por tipo. Con un solo tipo
  hoy (`formacion_cargada`) es una lista de un ítem; queda listo para crecer.
- Ícono de campana en [[navigation]], con contador de no leídas, visible para
  todo usuario autenticado — no depende de una capacidad nueva: recibir avisos
  propios no es un permiso sobre el club.

---

## Fases de Implementación

### Fase A: Modelo y servicio
- [x] Migración: `notification_devices`, `notifications`, `notification_preferences` (`0024`)
- [x] `NotificationType` enum, con `formacion_cargada`
- [x] `notify()` con opt-out, inserción en bandeja, y despacho a devices activos
- [x] `WebPushSender` — `pywebpush` (`webpush()` corre en `asyncio.to_thread`
      porque es sync)
- [x] Tests (`test_notifications.py`): opt-out no guarda ni empuja, un sender
      que tira 410 desactiva el device, un fallo del sender no rompe el flujo
      que llamó a `notify()`, devices inactivos no reciben push, sin fila de
      preferencia = habilitado

### Fase B: Web push
- [x] Generación y configuración de claves VAPID — script dedicado
      (`backend/scripts/generate_vapid_keys.py`; el primer intento de
      documentar un one-liner con `py_vapid` no daba las claves en el formato
      que espera `pywebpush`, así que quedó un script probado en vez de una
      receta en un comentario)
- [x] `GET /push/vapid-public-key` — sin auth a propósito: una clave pública
      VAPID es información pública por diseño, no un secreto
- [x] `POST /me/notification-devices` (reactiva si el `endpoint` ya existía),
      `DELETE /me/notification-devices/{id}`
- [x] `frontend/public/sw.js` — registro, `push`, `notificationclick`
      (con `postMessage` a la pestaña abierta para navegar sin recarga)
- [x] Banner de opt-in contextual en la solapa Perfil del portal del jugador
- [x] Tests: suscripción reactiva en vez de duplicar, des-suscripción sólo del
      dueño, el device se asocia al usuario correcto

### Fase C: Disparador de formación
- [x] Hook en `PUT /sessions/{id}/lineup`: detecta transición vacío → con
      datos (mirando `MatchLineup` **antes** de tocar la base)
- [x] Notifica a todos los `players.user_id` de la división, convocados o no
- [x] Test: dos `PUT` seguidos (carga + corrección) generan **una sola**
      notificación; el lineup del rival no notifica; un fallo de `notify()`
      no impide guardar el lineup

### Fase D: Bandeja
- [x] `GET /me/notifications` (+`unread-count`), `POST /me/notifications/{id}/read`
- [x] `GET|PUT /me/notification-preferences`
- [x] Campana en [[navigation]] con contador de no leídas — sondea cada 60s,
      no depende de ninguna capacidad
- [x] Pantalla de bandeja (`/notificaciones`), con deep link a `data.url`

**Hallazgo de la verificación en vivo, fuera de las fases originales**: el
`data.url` que proponía este documento (`/sessions/{id}/lineup`) devuelve
`403` para el destinatario real — ese endpoint exige `partido.lineup`, capacidad
que ningún jugador tiene. Se agregó `GET /me/player/sessions/{id}/lineup`
(sólo lectura, resuelve por `_get_own_player`) y la pantalla
`/mi-formacion/:id`, y el disparador se actualizó para apuntar ahí. Ver
[[notificaciones]] para el detalle. Sin la verificación en navegador esto no
lo hubiera encontrado ningún test, porque los tests llamaban a `notify()`
directamente y nunca abrieron el link que un jugador realmente recibe.

### Fase E: Documentación
- [x] `openspec/specs/notificaciones.md`
- [x] Actualizar [[data-model]] y [[navigation]]
- [x] Además: `.env.example`, `.env.production.example` y `README.md` con las
      variables VAPID y el listado de endpoints — no estaban en el plan
      original pero son la puerta de entrada real para quien despliega esto

---

## Fuera de Alcance

| Qué | Por qué no |
|-----|-----------|
| **Email / SMS como canal** | No pedido; el catálogo de canales queda abierto a sumarlos si hace falta, pero no se construyen sin un caso de uso |
| **Notificaciones para el cuerpo técnico** (asistencia floja, apto por vencer) | El pedido del club es la formación; el resto del catálogo se agrega cambio por cambio sobre esta infraestructura |
| **Catálogo de tipos configurable por club** | Igual que `Permission`, el catálogo es de código. Un club que no quiere avisar de la formación usa `notification_preferences` a nivel de cada jugador, no una opción de club |
| **Notificaciones nativas (FCM/APNs)** | Es [[add-app-movil-react-native]]; este cambio deja `channel` como enum abierto para que ese cambio agregue las filas y los senders, no reescriba el servicio |
| **PWA offline-first / instalación guiada** | `sw.js` acá sólo sirve al push; convertir la app en instalable con caché offline es un cambio aparte si se decide perseguir la limitación de iOS por ese lado |

---

## Impacto en Código Existente

| Área | Impacto |
|------|---------|
| `backend/app/models/notification.py` | Nuevo — tres tablas |
| `backend/app/core/notifications.py` | Nuevo — `notify()`, `WebPushSender`. No `services/`: ese directorio no existe en el proyecto, `core/` es donde ya vive la lógica compartida (`core/roles.py`, `core/storage.py`) |
| `backend/app/api/v1/lineup.py` | Hook de despacho tras el `PUT` exitoso, más `GET /me/player/sessions/{id}/lineup` (agregado en `dashboard.py`, no acá — ver nota de la Fase C) |
| `backend/app/api/v1/dashboard.py` | Nuevo endpoint `GET /me/player/sessions/{id}/lineup`, junto al resto de `/me/player*` |
| `backend/app/api/v1/notifications.py` | Nuevo — bandeja, preferencias, devices, `GET /push/vapid-public-key` |
| `backend/scripts/generate_vapid_keys.py` | Nuevo — genera el par de claves en el formato que espera `pywebpush` |
| `frontend/public/sw.js` | Nuevo |
| `frontend/src/lib/push.ts` | Nuevo — suscripción del navegador |
| `frontend/src/pages/Notificaciones.tsx`, `MiFormacion.tsx` | Nuevas — bandeja y formación propia |
| `frontend/src/components/Layout.tsx` | Campana con contador (no hay `components/Sidebar`, la navegación vive en `Layout.tsx`) |
| `requirements.txt` | `pywebpush==2.3.0` |

---

## Decisiones Técnicas

| Decisión | Elección | Razón |
|----------|----------|-------|
| Persistencia del aviso | Bandeja **siempre**, push **best-effort** | El push puede no llegar por motivos ajenos a un bug (permiso, iOS, soporte del navegador) |
| Canal | Enum abierto (`web_push` hoy, `fcm`/`apns` después) | Evita rediseñar el servicio cuando llegue la app nativa |
| Catálogo de tipos | Constantes de código, como `Permission` | Consistente con cómo ya se modelan capacidades en [[permisos]] |
| Disparador de formación | Sólo en la transición vacío → cargado | Evita notificar en cada corrección durante el partido |
| Permiso del navegador | Se pide en contexto, no al entrar | Pedirlo de entrada maximiza el rechazo permanente |
| Sender que falla | 410/404 desactiva el device; otros errores sólo se loguean | Un push es best-effort; reintentar un aviso de horas atrás no aporta nada |

---

## Criterios de Aceptación

- [x] Un jugador que activa notificaciones recibe un push al cargarse por primera
      vez la formación de su división — verificado el guardado en bandeja
      end-to-end en vivo (login como jugador, la notificación aparece en la
      campana y en `/notificaciones`); el envío real del push está cubierto
      por tests con el sender simulado, no probado contra un push service
      real (no hay forma de hacerlo en este entorno)
- [x] Correcciones posteriores al mismo lineup **no** generan un segundo aviso — test
- [x] Un jugador sin push (permiso denegado, o iPhone sin instalar la app) sigue
      viendo el aviso en la bandeja — es el diseño mismo de `notify()`: guarda
      primero, empuja después: y se confirmó en vivo que el intento de
      suscripción falla con gracia (mensaje de error, la pantalla sigue
      entera) cuando el navegador no puede suscribirse
- [x] Apagar un tipo en preferencias corta tanto el push como la entrada en
      bandeja para ese tipo — test
- [x] Una suscripción vencida se desactiva sola tras un 410, sin reintentos eternos — test
- [x] Un fallo del servicio de notificaciones no impide guardar la formación — test
      + verificado que el disparador entero está en un `try/except` propio
- [x] Un jugador no ve notificaciones de otro usuario — test

---

## Riesgos

| Riesgo | Mitigación |
|--------|-----------|
| **iOS Safari no entrega push fuera de la app instalada** | Documentado de frente; la bandeja cubre el caso, y la app nativa (cambio 6) lo resuelve del todo |
| **El disparador de formación se vuelve spam** | Sólo en la transición vacío→cargado, con test dedicado |
| **Claves VAPID filtradas** | Viven en `.env`, mismo tratamiento que `SECRET_KEY` en [[despliegue]] |
| **El catálogo de tipos crece sin control** | Es código, no una tabla — cada tipo nuevo pasa por revisión como cualquier cambio |

---

## Relacionado

- [[add-portal-completo-roadmap]] — el programa; este es su cambio 3
- [[add-turnos-nutricion]] — segundo consumidor del servicio de notificaciones
- [[add-app-movil-react-native]] — agrega los canales `fcm`/`apns`
- [[club-operativo]] — descartó push para la convocatoria por falta de esta infraestructura; ya no aplica
- [[gestion-semanal]] — `match_lineup`, el disparador
- [[permisos]] — el patrón de catálogo-en-código que este cambio repite
- [[despliegue]] — manejo de secretos, extendido a las claves VAPID
