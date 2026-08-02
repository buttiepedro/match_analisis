---
title: Notificaciones
status: active
created: 2026-08-01
---

# Notificaciones

> Refleja lo implementado en `core/notifications.py`, `api/v1/notifications.py`,
> `api/v1/lineup.py` (disparador) y la migración `0024`.

## La bandeja es el canal primario, no un respaldo del push

`notify()` **siempre** escribe en `notifications` y **después** intenta
empujar. El orden importa: el push puede no llegar por motivos que nada
tienen que ver con un bug — el usuario no dio permiso, el navegador no lo
soporta, o es iPhone y no agregó la app a la pantalla de inicio (ver más
abajo). Push que falla no pierde el aviso; lo pierde sólo si tampoco se
guardó.

## Modelo

```
notification_devices  user_id, channel (web_push|fcm|apns), endpoint,
                       p256dh, auth_secret, is_active, last_seen_at
                       UNIQUE (user_id, endpoint)

notifications          club_id, user_id, type, title, body, data (JSON),
                        read_at, created_at
                        INDEX (user_id, created_at)

notification_preferences  user_id, type, enabled
                           UNIQUE (user_id, type)
```

`channel` es lo que hace que un canal nativo (`fcm`/`apns`, de
[[add-app-movil-react-native]]) sea agregar una fila al enum y un sender en
`SENDERS`, no un sistema aparte.

**Sin fila en `notification_preferences` = habilitado.** Opt-in por defecto,
opt-out a mano — igual que el resto de la app no obliga a configurar nada
para funcionar.

## El catálogo de tipos vive en código

`NotificationType`, en `models/notification.py`, es un enum — no una tabla.
Mismo patrón que `Permission` en [[permisos]]: el conjunto lo define el
código porque cada disparador referencia un tipo. Hoy tiene uno solo:

```python
class NotificationType(str, enum.Enum):
    formacion_cargada = "formacion_cargada"
```

## `notify()`

```python
async def notify(db, *, user_id, club_id, type, title, body, data=None) -> None
```

1. Si `notification_preferences` tiene ese `type` en `false` para el
   usuario, **no hace nada** — ni guarda ni empuja. Apagado es apagado, no
   "apagado del push pero igual aparece en la bandeja".
2. Inserta en `notifications` y hace `commit`.
3. Por cada `notification_devices` **activo** del usuario, delega al sender
   de su `channel` (`SENDERS[channel]`). Hoy sólo existe `WebPushSender`.
4. Un sender que falla con **404/410** (suscripción vencida o revocada por
   el navegador) marca ese device `is_active = false`. Cualquier otro error
   se loguea (`logger.exception`) y no reintenta — un push es best-effort, y
   reintentar "salió la formación" media hora después no aporta nada.

`notify()` no atrapa errores de base de datos a propósito: es responsabilidad
de quien la llama desde un flujo que no puede fallar por esto. El disparador
de formación (abajo) es el ejemplo — envuelve el llamado en su propio `try`.

## Web push

- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` en `.env`,
  generadas una vez **por instalación** — son del origen, no del club. Sin
  configurar, `GET /push/vapid-public-key` responde `501` y `WebPushSender`
  no intenta nada (la bandeja sigue funcionando igual). Mismo criterio que
  `AWS_S3_BUCKET` en `core/storage.py`.
- `frontend/public/sw.js`: service worker mínimo. Sólo `push` (muestra la
  notificación) y `notificationclick` (si hay una pestaña abierta, le manda
  un `postMessage` para que navegue con el router de React en vez de hacer
  una recarga completa; si no, abre una ventana). **No cachea nada** — esto
  no es lo que convierte la app en una PWA offline-first.
- `frontend/src/lib/push.ts`: `subscribeToPush()` pide permiso, registra el
  service worker, suscribe al `PushManager` con la clave VAPID pública, y
  manda la suscripción a `POST /me/notification-devices`. El `id` que
  devuelve el backend se guarda en `localStorage` de **ese navegador** (no en
  el store de auth) para poder des-suscribirse después — es información del
  dispositivo, no del usuario.
- `pywebpush` (`webpush()`) es **sync**: corre dentro de `asyncio.to_thread`
  para no bloquear el loop de eventos del resto de la app mientras dura el
  envío.

### El permiso se pide en contexto, no al entrar

Pedirlo en el primer segundo de la sesión es la forma más confiable de que el
navegador lo rechace y no lo vuelva a preguntar nunca más. Por eso vive como
un banner en la solapa **Perfil** del portal del jugador
([[club-operativo]]), con la explicación de qué va a avisar antes de que el
navegador muestre su propio diálogo.

### La limitación de iOS Safari

Web push en iOS **sólo** funciona si Safari es 16.4+ y la app está agregada a
la pantalla de inicio — no en una pestaña normal. Es una limitación de Apple,
no de esta implementación. Para un jugador con iPhone que no instaló la app,
el aviso llega **sólo** a la bandeja dentro de la app, no como push del
sistema. [[add-app-movil-react-native]] importa justamente por esto: una app
nativa recibe push por APNs sin esa condición.

## Disparador: formación cargada

Vive en `_notify_formation_loaded`, llamado desde
`PUT /sessions/{id}/lineup` en `api/v1/lineup.py`.

Se dispara **sólo** en la transición de "sin lineup" a "con lineup" del
equipo **propio** (`team == "user"`) — nunca por el lineup del rival, y nunca
en una corrección posterior. La transición se mira **antes** de tocar la
base (`SELECT ... LIMIT 1` sobre `MatchLineup` del mismo `team`): es la única
forma de distinguir "no había nada" de "ya había lineup y se está
corrigiendo". [[gestion-semanal]] explica por qué esto importa — el lineup se
corrige durante el partido, y si cada guardado avisara, un jugador recibiría
varias notificaciones el mismo sábado por correcciones que no le cambian
nada.

**Destinatarios: todos los `players.user_id` no nulos de la división** — no
sólo los que quedaron en la grilla. Un suplente que quedó afuera también
quiere enterarse, y antes que nadie se lo cuente.

```
title: "Formación de {división}"
body:  "Ya está la formación para {rival} del {fecha}. Fijate si estás."
data:  { "session_id": "...", "url": "/mi-formacion/{id}" }
```

`{rival}` es `session.away_team`: la convención ya establecida en el resto
de la app es que `home_team` es siempre el nombre del club propio (lo
completa el frontend al crear la sesión) y `away_team` el rival.

**El `url` no es `/sessions/{id}/lineup`.** La propuesta original decía que
sí, pero verificarlo en vivo (login como jugador, click en la notificación)
mostró un `403`: esa ruta es el editor del cuerpo técnico, exige
`partido.lineup`, y el preset Jugador no tiene ninguna capacidad de club. Un
jugador que hace click en "fijate si estás" no podía, de hecho, fijarse.

La solución no es aflojar el permiso de esa ruta —trae controles de edición
y otros fetches (`squad`, timer) igual de cerrados para un jugador—, sino
darle un destino propio: `GET /me/player/sessions/{id}/lineup` (sólo lectura,
resuelve el jugador de `_get_own_player` y valida que el partido sea de su
división, `403` si no) y la pantalla `/mi-formacion/:id`
(`frontend/src/pages/MiFormacion.tsx`), que marca con `is_me` la fila del
jugador que la pidió.

Todo el bloque de notificación corre dentro de un `try/except` que sólo
loguea: **un fallo del servicio de notificaciones no puede impedir guardar
la formación**, que es lo que el entrenador vino a hacer.

## Bandeja, dispositivos y preferencias

Todos los endpoints resuelven del usuario logueado (`get_current_user`) y no
piden ninguna capacidad — recibir avisos propios no es un permiso sobre el
club:

```
GET    /push/vapid-public-key
POST   /me/notification-devices           -- reactiva si el endpoint ya existía
DELETE /me/notification-devices/{id}
GET    /me/notifications?unread=true&limit=30
GET    /me/notifications/unread-count      -- liviano, lo sondea la campana
POST   /me/notifications/{id}/read
GET    /me/notification-preferences        -- todo el catálogo, sin fila = habilitado
PUT    /me/notification-preferences        -- tipos desconocidos se ignoran, no 422
```

La campana en [[navigation]] sondea `unread-count` cada 60 segundos —no hay
WebSocket para esto, es deliberadamente un REST simple— y lleva a
`/notificaciones`, que lista todo, marca como leído al abrir y navega a
`data.url` si vino.

## Relacionado

- [[add-notificaciones-push]] — la propuesta, cambio 3 del roadmap
- [[add-portal-completo-roadmap]] — el programa
- [[add-turnos-nutricion]] — segundo consumidor de `notify()`
- [[add-app-movil-react-native]] — agrega los canales `fcm`/`apns`
- [[gestion-semanal]] — `match_lineup`, dueño del disparador
- [[permisos]] — el patrón de catálogo-en-código que este módulo repite
- [[club-operativo]] — el portal del jugador, donde vive el banner de opt-in
- [[despliegue]] — manejo de secretos, extendido a las claves VAPID
- [[data-model]] — schema
