---
title: App móvil — React Native, portal de socio y jugador
type: feature
status: proposed
spec: app-movil
created: 2026-07-29
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
- [ ] `mobile/` con Expo, TypeScript, `expo-router`
- [ ] Cliente HTTP con el mismo patrón de refresh-único-en-vuelo que
      `frontend/src/lib/axios.ts`, sobre `expo-secure-store`
- [ ] Login: email o DNI, con el flujo de `must_change_password` de [[socios]]
      y el selector/búsqueda de club (camino 1 de arriba)
- [ ] Pantalla de error de red genérica — **sin** cola offline; una escritura
      que falla se reintenta a mano, no se encola

### Fase B: Portal de lectura
- [ ] Fixture, tablas, citados ([[add-portal-multidivision]])
- [ ] Perfil de jugador completo ([[add-perfil-jugador-completo]])
- [ ] Estado de cuota del socio ([[socios]])
- [ ] Plan de gimnasio propio ([[gimnasio]])
- [ ] Bolsa de trabajo, lectura y publicación ([[bolsa-trabajo]])

### Fase C: Notificaciones
- [ ] `expo-notifications`, permiso pedido en contexto (mismo criterio que la
      Fase B de [[add-notificaciones-push]], no al abrir la app por primera vez)
- [ ] Registro del token nativo en `POST /me/notification-devices`
- [ ] Bandeja de notificaciones, mismo backend que la web

### Fase D: Turnos de nutrición
- [ ] Reserva y cancelación ([[add-turnos-nutricion]])

### Fase E: Publicación
- [ ] Cuenta de Apple Developer Program y Google Play Developer
- [ ] Ícono, splash, screenshots, política de privacidad (requisito de ambas tiendas)
- [ ] Credenciales de demo para el revisor: reusa `backend/scripts/seed_demo.py`
      —ya existe, es idempotente y crea un club completo con socio y jugador—
      en vez de armar un club de prueba a mano para cada revisión
- [ ] `EAS Build` + `EAS Submit` para ambas tiendas
- [ ] Universal Links / App Links si el cambio 5 está en producción (camino 2)

### Fase F: Documentación
- [ ] `openspec/specs/app-movil.md`
- [ ] `mobile/README.md` con setup y comando de build

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
| `backend/` | Ninguno más allá de lo que ya agregan los cambios 1–4: la API ya es agnóstica de quién la consume |
| `frontend/` | Ninguno |
| `docker-compose.yml` | Ninguno — `mobile/` no entra al compose |
| `mobile/` | Nuevo — todo el proyecto |
| `backend/scripts/seed_demo.py` | Ninguno — se reusa tal cual para credenciales de revisión de tienda |

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

- [ ] Un socio o jugador entra a la app móvil con las mismas credenciales que
      usa en la web
- [ ] Fixture, tablas, citados, perfil, cuota, gimnasio, bolsa y turnos de
      nutrición funcionan en la app con paridad de datos contra la web
- [ ] Las notificaciones push nativas llegan usando la misma infraestructura
      de [[add-notificaciones-push]], sin cambios en el backend más allá de
      agregar el `channel`
- [ ] La app pasa la revisión de Apple y de Google con las credenciales de
      `seed_demo.py`
- [ ] El tablero de partido **no** existe en la v1 de la app móvil — no es un
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
