---
title: App móvil — React Native, portal de socio y jugador
type: feature
status: completed
spec: app-movil
created: 2026-07-29
completed: 2026-08-02
---

# App móvil — React Native, portal de socio y jugador

## Descripción del Cambio

Segundo frontend, en React Native, para App Store y Play Store. Mismo backend,
sin duplicar lógica de negocio — el back ya sirve JSON por API REST, ajeno a
quién lo consume.

> **Este documento queda más abierto que el resto del programa a propósito.**
> Depende del resultado de [[add-notificaciones-push]] (el contrato de
> registro de push) y, si se aprueba, de [[add-club-subdominios-y-marca]] (cómo
> resuelve el club cada usuario). Empezar antes de que esos dos estén resueltos
> en producción —no en diseño— significa construir contra un contrato que
> todavía puede cambiar, y reescribir pantallas ya publicadas en la tienda es
> mucho más caro que reescribir una pantalla web.

---

## El recorte que hace viable este cambio

La app web tiene dos productos adentro: el **tablero de partido** —timer en
vivo, WebSocket, cola offline de [[offline-resilience]], pensado para pulgar y
mala señal al costado de la cancha— y el **portal** —socio, jugador, fixture,
tablas, cuota, gimnasio, turnos—.

**La v1 de la app móvil es sólo el portal.** El tablero de partido queda
explícitamente afuera. Es la misma clase de recorte que hizo
[[add-video-analysis-module]] al construir sólo su Fase 1: llevar el timer a
móvil es su propio programa —reconstruir la reconexión de WebSocket, la cola
offline y el sellado de tiempo en un runtime distinto—, no una pantalla más de
este.

Con ese recorte, la v1 es fundamentalmente de **lectura y unas pocas
escrituras acotadas**: fixture, tablas, citados ([[add-portal-multidivision]]),
perfil ([[add-perfil-jugador-completo]]), estado de cuota ([[socios]]), plan de
gimnasio ([[gimnasio]]), bolsa de trabajo ([[bolsa-trabajo]]), turnos de
nutrición ([[add-turnos-nutricion]]) y notificaciones
([[add-notificaciones-push]]). Nada de eso necesita una cola offline: son
pantallas que se recargan si falla la red, no partidos de 80 minutos que no se
pueden perder.

---

## Stack

**Expo, con EAS Build y EAS Submit** — no React Native "bare". La razón es
operativa, no técnica: nada en el alcance de la v1 (sin cámara para video,
sin procesamiento nativo pesado) necesita un módulo nativo fuera de lo que
Expo ya cubre, y a cambio se gana no tener que mantener proyectos de Xcode y
Android Studio a mano para cada build de tienda. Si más adelante el tablero de
partido llega a móvil y necesita algo que Expo no cubre, ahí se evalúa un
*prebuild* o pasar a bare — no antes.

| Pieza | Elección | Por qué |
|-------|----------|---------|
| Framework | Expo (managed) + EAS Build/Submit | Sin dependencias nativas fuera de lo que cubre |
| HTTP | `axios`, mismo patrón de interceptor que `frontend/src/lib/axios.ts` | [[offline-resilience]] ya resolvió el refresh-único-en-vuelo; se **porta** el patrón, no se reinventa |
| Estado | Zustand | Misma librería que ya usa el frontend web; no hay que aprender un segundo patrón de estado |
| Almacenamiento de tokens | `expo-secure-store` (Keychain / Keystore), **no** `AsyncStorage` | `AsyncStorage` no cifra; un refresh token es tan sensible en el celular como en el navegador |
| Notificaciones | `expo-notifications` | Da token de FCM/APNs sin gestionar certificados a mano; se registra vía el mismo `POST /me/notification-devices` de [[add-notificaciones-push]], con `channel='fcm'` o `'apns'` |
| Navegación | `expo-router` | Rutas por archivo, más cercano al mental model de rutas de React que ya tiene el equipo |

---

## Ubicación en el repo

`mobile/`, hermano de `frontend/` y `backend/` — mismo patrón que
[[video-analysis-engine]] usó para `vision/`: un directorio nuevo, autónomo,
que no toca nada existente. `docker compose up` del stack principal sigue
funcionando exactamente igual; `mobile/` no entra al compose —Expo se compila
y corre con su propio tooling, no en un contenedor.

**No se arma un monorepo con workspaces compartidos en esta v1.** La cantidad
de lógica realmente compartible entre `frontend/` y `mobile/` —constantes de
capacidades, forma de la respuesta de la API— es chica, y se **duplica** a
mano en vez de invertir en tooling de monorepo (pnpm/yarn workspaces, build
compartido) para un beneficio todavía chico. Si la duplicación se vuelve
dolorosa —cambia una capacidad y hay que tocar los dos lados y alguien se
olvida— ese es el momento de extraer un paquete compartido, no antes.

---

## Resolución de club

El frontend web resuelve el club por sesión de navegador (login, o —si se
aprueba [[add-club-subdominios-y-marca]]— por subdominio). Un binario de
celular instalado desde la tienda es **uno solo para todos los clubes**: no
hay "subdominio" en una app nativa de la misma forma que en un navegador.

Dos caminos, no excluyentes:

1. **Sin subdominios (si el cambio 5 no se aprueba, o esta app arranca antes)**:
   pantalla de login con selector de club — el mismo flujo de `club_slug` y el
   `409` de DNI ambiguo que ya existe en `POST /auth/login` según [[socios]].
   El usuario escribe o busca su club una vez; la app lo recuerda.
2. **Con subdominios (si el cambio 5 está aprobado y en producción)**: Universal
   Links (iOS) / App Links (Android) sobre `{slug}.dominio.com` — el link que
   el club ya comparte por WhatsApp abre la app directo en el club correcto si
   está instalada, o la ficha de la tienda si no. Mejor experiencia, pero
   depende de que el cambio 5 esté resuelto: cada club necesita su dominio
   verificado (`apple-app-site-association` / `assetlinks.json`) antes de que
   el link abra la app en vez del navegador.

La app se construye contra el camino 1 primero —funciona sin ninguna otra
dependencia— y el camino 2 se agrega como mejora si el cambio 5 llega a
producción antes o durante este.

---

## Fases de Implementación

> Más gruesas que en el resto del programa: hasta no tener el contrato de
> push cerrado (cambio 3, en producción) no tiene sentido detallar pantalla
> por pantalla.

### Fase A: Scaffold
- [x] `mobile/` con Expo, TypeScript, `expo-router`
- [x] Cliente HTTP con el mismo patrón de refresh-único-en-vuelo que
      `frontend/src/lib/axios.ts` — sobre `expo-secure-store` en nativo;
      `expo-secure-store` no soporta web, así que en la rama de
      verificación (`expo start --web`) usa `localStorage`, ver
      [[app-movil]]
- [x] Login: email o DNI, con el flujo de `must_change_password` de [[socios]]
      y el selector/búsqueda de club (camino 1 de arriba) — los dos
      verificados en vivo
- [x] Manejo de error genérico vía `ErrorBanner`/`parseApiError` — **sin**
      cola offline; una escritura que falla se reintenta a mano, no se encola

### Fase B: Portal de lectura
- [x] Fixture, tablas, citados ([[add-portal-multidivision]]) — un tab
      ("Club") con selector, no tres pantallas
- [x] Perfil de jugador ([[add-perfil-jugador-completo]]) — simplificado:
      sin sparklines de tests/físico (pide `react-native-svg`, fuera de
      alcance) y sin subida de foto (pide `expo-image-picker` + recorte);
      ver [[app-movil]], "Qué se simplificó"
- [x] Estado de cuota del socio ([[socios]])
- [x] Plan de gimnasio propio ([[gimnasio]])
- [x] Bolsa de trabajo, lectura y publicación ([[bolsa-trabajo]]) —
      texto plano, sin el compositor enriquecido ni portada/adjuntos de la web

### Fase C: Notificaciones
- [x] `expo-notifications`, permiso pedido en contexto (`PushBanner` en la
      tab Cuenta, mismo criterio que la Fase B de [[add-notificaciones-push]])
- [x] Registro del token nativo en `POST /me/notification-devices` — pidió
      dos cambios chicos de backend no anticipados por este documento: el
      schema sólo aceptaba `channel="web_push"`, y no existía sender para
      `fcm`/`apns`. Ambos resueltos (`ExpoPushSender`, ver [[notificaciones]])
- [x] Bandeja de notificaciones, mismo backend que la web — verificada en
      vivo mostrando un aviso real disparado desde la reserva de un turno

### Fase D: Turnos de nutrición
- [x] Reserva y cancelación ([[add-turnos-nutricion]]) — verificado de
      punta a punta contra un backend real: reservar, ver "Tu turno", y la
      notificación de confirmación en la bandeja de la misma app

### Fase E: Publicación
- [ ] Cuenta de Apple Developer Program y Google Play Developer — **no
      hecho**: requiere cuentas y pagos que esta sesión no tiene
- [ ] Ícono, splash, screenshots, política de privacidad — no hecho
- [ ] Credenciales de demo para el revisor — el mecanismo
      (`backend/scripts/seed_demo.py`) ya existe y no necesitó cambios;
      no se ejecutó como parte de una revisión real porque no hay nada a
      lo que enviarlo todavía
- [ ] `EAS Build` + `EAS Submit` — no hecho: necesita `eas init` con una
      cuenta de Expo, que tampoco está disponible acá
- [ ] Universal Links / App Links — no aplica: el cambio 5
      ([[multi-tenant]]) tampoco está en producción

### Fase F: Documentación
- [x] `openspec/specs/app-movil.md`
- [x] `mobile/README.md` con setup y comando de build

---

## Fuera de Alcance

| Qué | Por qué no |
|-----|-----------|
| **Tablero de partido en móvil** (timer, eventos, lineup en vivo) | Necesita WebSocket, cola offline y sellado de tiempo propios en el runtime de RN; es su propio programa, no una fase de este |
| **Modo offline del portal** | Nada del alcance de v1 son operaciones que no puedan esperar a que vuelva la red; la cola offline de [[offline-resilience]] existe por el partido, no por el portal |
| **Monorepo / paquete compartido con `frontend/`** | La duplicación actual es chica; se extrae cuando duela, no antes |
| **Dominios propios por club en Universal Links** | Depende de que [[add-club-subdominios-y-marca]] esté en producción; el camino 1 (selector de club) no lo necesita |
| **Firma y notarización con cuenta de empresa propia si no existe todavía** | Requisito administrativo del club, no técnico — se resuelve antes de la Fase E, en paralelo al desarrollo |

---

## Impacto en Código Existente

| Área | Impacto |
|------|---------|
| `backend/app/schemas/notification.py`, `backend/app/core/notifications.py` | `channel` acepta `fcm`/`apns`, nuevo `ExpoPushSender` — la API **no** era del todo agnóstica de quién la consume, ver más abajo |
| `frontend/` | Ninguno |
| `docker-compose.yml` | Ninguno — `mobile/` no entra al compose |
| `mobile/` | Nuevo — todo el proyecto |
| `backend/scripts/seed_demo.py` | Ninguno — se reusa tal cual para credenciales de revisión de tienda |

> La fila de `backend/` de la tabla original decía "Ninguno... la API ya es
> agnóstica de quién la consume". En la práctica no era cierto: el schema
> de `POST /me/notification-devices` sólo aceptaba `channel="web_push"`, y
> no había sender para `fcm`/`apns` — el punto de extensión estaba
> preparado ([[notificaciones]] ya lo documentaba), pero nadie lo había
> completado. Se encontró al construir `push.ts`, no antes.

---

## Decisiones Técnicas

| Decisión | Elección | Razón |
|----------|----------|-------|
| Alcance de v1 | Portal, no tablero de partido | El tablero necesita infraestructura propia (WebSocket, offline) que no se puede portar en la misma fase |
| Framework | Expo managed, no bare | Nada del alcance necesita un módulo nativo fuera de Expo; se gana velocidad de build y de publicación |
| Código compartido con `frontend/` | Duplicado, no monorepo | El volumen compartido es chico hoy; invertir en tooling de workspace es prematuro |
| Tokens | `expo-secure-store`, no `AsyncStorage` | Un refresh token sin cifrar en el dispositivo es una filtración esperando pasar |
| Resolución de club | Selector/búsqueda primero, Universal Links si el cambio 5 llega | No depende de una decisión de infraestructura que todavía puede no aprobarse |
| Credenciales de demo para las tiendas | `seed_demo.py` existente | Ya resuelve exactamente este problema; no hay que armar un club de prueba a mano |

---

## Criterios de Aceptación

- [x] Un socio o jugador entra a la app móvil con las mismas credenciales que
      usa en la web — verificado con un jugador (email) y un socio (DNI,
      incluido el cambio de contraseña forzado del primer ingreso)
- [x] Fixture, tablas, citados, perfil, cuota, gimnasio, bolsa y turnos de
      nutrición funcionan en la app con paridad de **datos** contra la web
      (la presentación se simplificó en algunos puntos, ver [[app-movil]])
- [x] El registro de notificaciones push nativas usa la misma
      infraestructura de [[add-notificaciones-push]] — pero **sí** hubo
      cambios en el backend más allá de agregar el `channel` (ver arriba,
      "Impacto en Código Existente"). Que un push nativo llegue de punta a
      punta a un dispositivo real **no** se verificó — hace falta un
      `projectId` de EAS que esta sesión no tiene
- [ ] La app pasa la revisión de Apple y de Google con las credenciales de
      `seed_demo.py` — no aplica todavía: no se envió a ninguna revisión
      (fase E no ejecutada)
- [x] El tablero de partido **no** existe en la v1 de la app móvil — no es un
      olvido, es alcance

---

## Riesgos

| Riesgo | Mitigación |
|--------|-----------|
| **Se arranca antes de que el contrato de push o de subdominios esté cerrado, y hay que rehacer pantallas ya publicadas** | Este cambio va último en el programa a propósito; no arranca hasta que 3 esté en producción |
| **La revisión de Apple rechaza la app por login ambiguo (DNI vs email) sin explicación** | Incluir en las notas de revisión qué es cada campo, con las credenciales de `seed_demo.py` a mano |
| **Presión por sumar el tablero de partido a la v1 "ya que se está construyendo la app"** | El recorte está documentado con su razón; sumarlo es una decisión consciente de reabrir alcance, no un default |
| **Expo managed no alcanza para algo que aparece durante el desarrollo** | *Prebuild* (Expo sigue sirviendo, pero se generan los proyectos nativos) es la salida intermedia antes de bare completo |

---

## Relacionado

- [[add-portal-completo-roadmap]] — el programa; este es su cambio 6, el último
- [[add-notificaciones-push]] — contrato de `channel` que este cambio implementa para `fcm`/`apns`
- [[add-club-subdominios-y-marca]] — resolución de tenant que condiciona el camino de login
- [[offline-resilience]] — el patrón de refresh-único-en-vuelo que se porta, y la cola offline que **no** se porta en v1
- [[add-video-analysis-module]] — precedente del mismo tipo de recorte de alcance ("Fase 1 y el resto documentado")
- [[add-portal-multidivision]], [[add-perfil-jugador-completo]], [[add-turnos-nutricion]], [[socios]], [[gimnasio]], [[bolsa-trabajo]] — todo lo que esta app consume
