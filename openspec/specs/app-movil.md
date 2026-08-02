---
title: App móvil — portal de socio y jugador
status: active
created: 2026-08-02
---

# App móvil — portal de socio y jugador

> Refleja lo implementado en `mobile/` (Expo + expo-router) y, del lado del
> backend, `core/notifications.py` (`ExpoPushSender`) y
> `schemas/notification.py` (canales `fcm`/`apns`).

## El recorte que hace viable este cambio

La web tiene dos productos adentro: el **tablero de partido** (timer en
vivo, WebSocket, cola offline de [[offline-resilience]]) y el **portal**
(socio, jugador, fixture, tablas, cuota, gimnasio, bolsa, turnos). Esta
primera versión de la app móvil es **sólo el portal**. El tablero queda
afuera a propósito: llevar el timer a un runtime nativo es reconstruir la
reconexión de WebSocket, la cola offline y el sellado de tiempo desde cero
— su propio programa, no una pantalla más de éste.

Sin tablero, la app es de **lectura y unas pocas escrituras acotadas**:
nada de lo que cubre necesita una cola offline, porque son pantallas que
se recargan si falla la red, no un partido de 80 minutos que no se puede
perder.

## Stack

Igual que decidió la propuesta original — [[add-app-movil-react-native]]:

| Pieza | Elección | Por qué |
|-------|----------|---------|
| Framework | Expo (managed) + `expo-router` | Sin dependencias nativas fuera de lo que Expo cubre |
| HTTP | `axios`, mismo patrón de interceptor que `frontend/src/lib/axios.ts` | El refresh-único-en-vuelo se **porta**, no se reinventa |
| Estado | Zustand | Misma librería que el frontend web |
| Notificaciones | `expo-notifications` + Expo Push Service | Token sin gestionar certificados de Apple/Firebase a mano |
| Navegación | `expo-router`, `Stack.Protected` para las guardas de auth | Patrón actual de la librería (ver más abajo) |

## Dónde vive el token — y por qué es todo async

`expo-secure-store` (Keychain/Keystore) es el storage en nativo — no
`AsyncStorage`, que no cifra. Pero **no soporta web**: no hay
Keychain/Keystore en un browser, es documentación oficial de Expo, no un
bug de esta app. `src/lib/authTokens.ts` resuelve esto con un chequeo de
plataforma: `SecureStore` en iOS/Android, `localStorage` en web — el web
acá es sólo la herramienta de verificación de esta sesión (ver "Qué se
verificó y qué no"), no un target real de la v1.

Esto también obligó a que todo el módulo sea **async** — la API sync de
`SecureStore` (`getItem`/`setItem`) no existe en el shim de web
(`getValueWithKeySync is not a function`, encontrado en vivo). El
interceptor de `api.ts` que en la web lee el token de forma sincrónica acá
lo espera (`await getAccessToken()`); axios soporta interceptores async sin
cambios de diseño.

## Auth: `Stack.Protected`, no redirects a mano

`app/_layout.tsx` usa `Stack.Protected` (el patrón actual de
`expo-router`, reemplaza los redirects manuales de versiones anteriores)
con tres guardas excluyentes sobre `authStore.status`:

```
autenticado && !must_change_password  → (tabs), nutricion, bolsa, gimnasio
autenticado && must_change_password   → cambiar-password
no autenticado                        → login
```

**Sin persistir `user` entre reinicios de la app** — a diferencia de la
web, que lo guarda en `localStorage`. Acá `bootstrap()` (llamado una vez al
abrir la app) pide `GET /auth/me` con lo que haya en el Keychain: si no hay
token o el refresh falla, es "sin sesión". Evita una segunda copia de los
datos del usuario para mantener sincronizada, y de paso los permisos
quedan al día en cada apertura — no vale la pena instalar
`@react-native-async-storage/async-storage` sólo para cachear algo que se
puede re-pedir en un request.

## Resolución de club: selector, no subdominio

Un binario de tienda es uno solo para todos los clubes — no hay
"subdominio" en una app nativa de la misma forma que en un navegador. Esta
v1 implementa el **camino 1** de la propuesta: `login.tsx` reproduce el
flujo de `club_slug`/`409` que ya existe en `POST /auth/login` (ver
[[socios]]) — si el mismo DNI resuelve a más de un club, aparece un
selector.

El camino 2 (Universal Links/App Links sobre `{slug}.dominio.com`) queda
sin construir: depende de que [[multi-tenant]] esté realmente en
producción, y hoy no lo está (`docker-compose.prod.yml` sigue siendo el
despliegue real).

## Pantallas

Cuatro tabs, no cinco ni seis — mismo techo que [[navigation]] ya midió
para la barra de la web ("cinco era el techo real a 360px"):

| Tab | Contenido |
|-----|-----------|
| **Hoy** | Saludo + accesos a lo que no tiene tab propio (nutrición, gimnasio, bolsa), filtrados por capacidad |
| **Club** | Fixture, Tablas y Citados de **todas** las divisiones ([[add-portal-multidivision]]), en un solo tab con selector — no tres pantallas de la web, tres pestañas más acá |
| **Cuenta** | Reemplaza `/mi-club` + `/mi-ficha` de la web: pide `/me/membership` y `/me/player` y muestra las que respondan. Un jugador que también es socio (caso real, ver [[socios]]) ve las dos secciones — no tiene que elegir cuál mirar |
| **Notificaciones** | Mismo backend que la web (`GET /me/notifications`). Nombrada así y no "Avisos" — colisiona con el vocabulario propio de la bolsa de trabajo, que también tiene sus "avisos" |

Nutrición, gimnasio y bolsa son pantallas *pusheadas* desde Cuenta/Hoy, no
tabs propios — mismo criterio de "no sumar más lugares de los que hacen
falta" que ya aplicó [[navigation]].

## Qué se simplificó contra la web

No son recortes de alcance del cambio (los datos y las acciones son las
mismas) — son simplificaciones de **cómo se muestran**, documentadas para
no perderlas de vista:

- **Sin sparklines de tests y mediciones físicas.** `PlayerPortal.tsx`
  usa SVG para la evolución de cada test; portarlo pide `react-native-svg`,
  que no entró en el alcance de esta v1. Los mismos datos se ven en listas
  con el valor más reciente.
- **Sin subida de foto de perfil.** El flujo de recorte
  (`CropModal.tsx`) es una pieza de UI entera aparte; `expo-image-picker`
  + un recorte nativo quedan para un cambio futuro.
- **Sin compositor de texto enriquecido en la bolsa de trabajo.** Los
  avisos se publican en texto plano.
- **Sin moderación de avisos ni portada/adjuntos.** "Lectura y
  publicación" es lo que pidió la propuesta original; moderar es una
  acción del club, no del socio o jugador que usa esta app.

## Notificaciones nativas: un sender nuevo, no un canal aparte

`expo-notifications` entrega un **token de Expo Push**
(`ExponentPushToken[...]`), no un token de FCM o de APNs directo — Expo
Push Service es el intermediario que le habla a los dos por su cuenta. La
app nunca gestiona certificados de Apple ni credenciales de Firebase.

Del lado del backend, esto llevó a dos cambios chicos sobre
[[notificaciones]] (que ya había dejado el punto de extensión preparado):

- `NotificationDeviceCreate.channel` pasó de `Literal["web_push"]` a
  aceptar también `"fcm"`/`"apns"` — el enum de la base (`fcm`, `apns`) ya
  existía desde la migración `0024`, sólo el schema de entrada lo
  rechazaba.
- `ExpoPushSender` en `core/notifications.py`, registrado en `SENDERS`
  para los dos canales (comparten un sender: la diferencia entre `fcm` y
  `apns` es de qué plataforma vino el token, no de cómo se envía). Manda
  un POST a `https://exp.host/--/api/v2/push/send`; un
  `DeviceNotRegistered` en la respuesta desactiva el device, igual que un
  404/410 desactiva un device de `web_push`.

`src/lib/push.ts` registra el token vía el mismo
`POST /me/notification-devices` que ya usa la web. El permiso se pide en
contexto (`PushBanner`, en la tab Cuenta) — mismo criterio que
`PlayerPortal.tsx`: pedirlo al abrir la app por primera vez es la forma
más confiable de que se rechace para siempre.

## Qué se verificó y qué no

Contra un backend real (SQLite local + `seed_demo.py`), conducido con
Playwright sobre `expo start --web` — la única forma de correr esto en un
browser en esta sesión, sin macOS ni Android SDK para un simulador nativo:

- Login con email (jugador) y con DNI (socio), incluido el flujo forzado
  de `cambiar-password` en el primer ingreso de un socio recién importado.
- Las cuatro tabs cargando datos reales: Fixture/Tablas/Citados con la
  división propia primero, Cuenta mostrando la sección correcta según el
  rol (un jugador ve "Mi ficha", un socio ve "Mi cuota" y nada de lo del
  jugador), Gimnasio con los kilos resueltos contra los tests del jugador,
  Bolsa listando y publicando un aviso.
- **Turnos de nutrición de punta a punta**: reservar un horario libre,
  verlo reflejado como "Tu turno", y la notificación de confirmación
  apareciendo en la bandeja de esta misma app — mismo backend que
  [[turnos-nutricion]], que ya se había probado desde la web.
- Cero errores de consola en las corridas verificadas.

**Encontrado y corregido en el camino** (dos bugs reales, no hipótesis):

1. `SecureStore.getItem`/`setItem` (la API sync) tiran
   `getValueWithKeySync is not a function` en web — la API sync de
   `expo-secure-store` simplemente no está implementada ahí. Se pasó todo
   el módulo de tokens a la API async.
2. `expo-secure-store` no soporta web en absoluto (ni sync ni async, ver
   arriba) — se agregó un chequeo de plataforma con `localStorage` como
   alternativa **sólo para esta verificación**, no para producción.

**No verificado — hace falta lo que esta sesión no tiene**:

- Un simulador de iOS (necesita macOS) o un emulador de Android (necesita
  Android Studio/SDK instalado) — nada del layout específico de
  `react-native` puro (sin la capa `react-native-web`) se vio corriendo de
  verdad.
- Push de punta a punta contra un dispositivo real: sin `eas init` no hay
  `projectId`, así que `getExpoPushTokenAsync` nunca se llegó a ejecutar
  (el código lo detecta y no hace nada — ver `push.ts` — pero eso es
  distinto de "se probó que un push llega a un teléfono").
- Todo lo de Fase E (publicación): no hay cuenta de Apple Developer
  Program ni de Google Play Developer, así que `EAS Build`/`EAS Submit`,
  el ícono/splash/screenshots y el envío a revisión no se hicieron.

## Qué falta para publicar

Nada de esto es código — son pasos administrativos y de cuenta que le
tocan al operador de la plataforma:

1. `eas init` con una cuenta de Expo — da el `projectId` real que
   `app.json` tiene en `null` hoy.
2. Cuenta de Apple Developer Program (u$s99/año) y de Google Play
   Developer (u$s25 una vez).
3. Ícono, splash, screenshots y una política de privacidad — requisito de
   las dos tiendas.
4. Credenciales de demo para el revisor: reusar `backend/scripts/seed_demo.py`
   tal como está, según ya preveía la propuesta original.
5. `EAS Build` + `EAS Submit`.
6. Universal Links/App Links, sólo si [[multi-tenant]] llega a producción
   antes o durante esto.

## Relacionado

- [[add-app-movil-react-native]] — la propuesta, cambio 6 (el último) de [[add-portal-completo-roadmap]]
- [[notificaciones]] — infraestructura de push que este cambio extiende con `ExpoPushSender`
- [[multi-tenant]] — resolución de club condicionaba el diseño; sigue sin estar en producción
- [[turnos-nutricion]], [[gimnasio]], [[bolsa-trabajo]], [[socios]], [[add-portal-multidivision]], [[add-perfil-jugador-completo]] — todo lo que esta app consume
- [[offline-resilience]] — el patrón de refresh-único-en-vuelo que se porta, y la cola offline que **no** se porta en v1
- [[navigation]] — el techo de tabs/ítems, mismo criterio en la barra web y en esta app
