---
title: Portal completo de socio/jugador, notificaciones, app móvil y multi-tenant — roadmap
type: roadmap
status: proposed
created: 2026-07-29
---

# Portal completo de socio/jugador, notificaciones, app móvil y multi-tenant — roadmap

## De qué se trata este cambio de rumbo

El [[add-plataforma-club-roadmap]] le dio a la app tres usuarios que no se pisan.
Pero el socio y el jugador todavía ven poco:

- El socio de [[socios]] entra y ve **una sola pantalla**: si está al día o no.
- El jugador de [[club-operativo]] ve **su propia división**: resumen, tests y físico.

Nada de eso es un bug — fue lo mínimo para que cada uno *entrara* a la app. El club
ahora pide lo siguiente: que ese mismo socio y jugador vean **el club entero** —
fixture, tablas y quién fue citado en todas las divisiones, no sólo en la propia—,
que el jugador reciba un aviso cuando sale la formación, y que tenga un lugar donde
agendar con la nutricionista.

A eso se le suma algo que no es una feature: un **segundo frontend** en React
Native, para App Store y Play Store, con la misma información que el web. Y un
cambio de infraestructura: que cada club creado corra su propia instancia de
una app genérica en `{club}.dominio.com`, con su marca propia, sobre una única
base Postgres serverless compartida en Neon — **no** una base por club.

Este documento es el **programa**: seis cambios, con el orden y el porqué de ese
orden. Cada uno se escribe en detalle en su propio archivo — ya están escritos,
listos para ejecutarse en orden — salvo el último (app móvil), que **depende del
resultado** de los otros cinco y por eso se deja más abierto.

---

## Dos programas distintos que conviene no confundir

| | Qué es | Cambios |
|---|---|---|
| **A. Producto** | Lo que el socio y el jugador ven y hacen | 1, 2, 3, 4 |
| **B. Plataforma** | Cómo se sirve la app a cada club, y en qué dispositivo | 5, 6 |

Es tentador tratarlos como una sola lista porque el pedido llegó junto, pero **A no
necesita a B**. El fixture de todas las divisiones se ve igual de bien en el
dominio único de hoy que en un subdominio por club. Separarlos evita el error
clásico de este tipo de pedido grande: que la parte de infraestructura, que es la
más cara y la más lenta de aprobar, bloquee valor que podría estar en producción
la semana que viene.

---

## Los seis cambios, en orden

### 1. Portal multidivisión — fixture, tablas, citados y lugar de entrenamiento — ✅ hecho (2026-08-01)

Extiende lo que ya existe (`standings`, `calendar`, `match_squad`) para que un
socio o jugador vea **todas** las divisiones, no sólo la propia — no tiene una
división propia, así que "sólo la propia" ni siquiera aplica. Suma el lugar de
entrenamiento a lo que ya se muestra.

Es lectura pura sobre datos que ya existen. Va primero porque no tiene
dependencias, es el que más rápido se ve en producción, y establece el patrón de
"lectura club-entero" que **2** y el resto del portal van a reusar.

Ver [[add-portal-multidivision]] (archivado en
`archive/2026-08-01-portal-multidivision.md`). Verificado en vivo contra un
club sembrado con `scripts/seed_demo.py`: un socio sin división propia ve las
tres pantallas nuevas con las cuatro divisiones del club.

### 2. Perfil completo del jugador — ✅ hecho (2026-08-01)

Todo lo que la ficha del jugador ya tiene —contacto, apto médico, obra social,
historial de división, lesiones cerradas— pero que el portal de [[club-operativo]]
nunca terminó de mostrar. Mayormente agregación de endpoints existentes.

Va segundo por la misma razón que 1: sin dependencias, bajo riesgo, alto valor
percibido — es lo que hace que el jugador sienta que la app es "de él", no sólo
una planilla del entrenador.

Ver [[add-perfil-jugador-completo]] (archivado en
`archive/2026-08-01-perfil-jugador-completo.md`). La Fase C (edición de
contacto y foto), que el documento dejaba condicionada a que el club la
confirmara, se implementó igual — es reversible sacando el botón del
frontend, sin tocar el backend, así que no valía la pena bloquear el resto
del cambio esperando esa confirmación. Verificado en vivo contra el club
Demo: un jugador editó su teléfono y vio su apto médico, historial de
divisiones y una lesión cerrada, todo calculado igual que en la grilla del
cuerpo técnico. La verificación en vivo encontró y corrigió dos bugs que
ningún test hubiera visto (detalle en el documento archivado): un email
vacío rechazado por la validación de formato, y un error de foto que borraba
toda la pantalla del jugador por compartir el state de error con la carga
inicial.

### 3. Notificaciones — infraestructura, primer uso: formación cargada — ✅ hecho (2026-08-01)

Hoy no existe **ningún** canal de push. [[club-operativo]] eligió texto para
copiar en vez de push justamente porque no había infraestructura y armarla para
un solo aviso no se justificaba. Ahora sí: un aviso cuando se carga la formación
es el primero de varios que van a aparecer (turnos de nutrición, después
probablemente asistencia y cuotas).

Se construyó **una vez**, como servicio de notificaciones con destino
intercambiable — push web (VAPID + service worker) primero, push nativo (FCM/APNs)
cuando exista **6**. El primer disparador es la formación; el modelo ya queda
listo para el resto.

Ver [[add-notificaciones-push]] (archivado en
`archive/2026-08-01-notificaciones-push.md`). **Lo que 4 necesita saber si
reusa `notify()`**: el `data.url` de una notificación tiene que apuntar a
algo que el destinatario pueda realmente abrir — la verificación en vivo
encontró que la propuesta original apuntaba al editor del cuerpo técnico
(`/sessions/{id}/lineup`, exige `partido.lineup`) para una notificación
dirigida a jugadores, que no tienen esa capacidad. Se corrigió con un
endpoint y una pantalla de sólo lectura nuevos
(`GET /me/player/sessions/{id}/lineup`, `/mi-formacion/:id`). Antes de armar
el recordatorio de turno de **4**, confirmar que la pantalla a la que apunta
sea una que el jugador pueda abrir con su capacidad real, no la que usa el
cuerpo técnico para gestionarlo.

### 4. Turnos con nutricionista — ✅ hecho (2026-08-02)

Agenda: la nutricionista publica disponibilidad, el jugador reserva, cualquiera
de los dos cancela. Usa **3** para el recordatorio, pero el flujo de reserva en sí
no depende de nada.

Va después de 3 porque un turno sin recordatorio es la mitad del valor, y
construirlo dos veces —una sin push, otra con— es trabajo de más.

Ver [[add-turnos-nutricion]] (archivado en
`archive/2026-08-02-turnos-nutricion.md`). Primer módulo con un job disparado
por reloj (`APScheduler` en proceso, no una cola aparte — un solo backend no
lo necesita) y primera capacidad de club de verdad en el preset Jugador
(`nutricion.turnos_reservar`, directo en el preset, no heredada de Socio).
**Lo que encontró la verificación en vivo, y que 6 debería saber**: hasta
este cambio, todo lo que un jugador veía se resolvía por acceso propio
(`require_player_self`), nunca por una capacidad de verdad — así que
`POST /divisions/{id}/players/{id}/invite` llevaba desde que existe el
sistema de capacidades ([[permisos]]) sin llamar a
`assign_preset_for_legacy_role()`, y todo jugador invitado por ese camino
quedaba con **cero** capacidades, sin ningún error visible. Se encontró recién
al escribir los tests de este módulo, no en producción — pero cualquier
cambio futuro que agregue la primera capacidad de club de verdad a un preset
que hoy sólo tiene acceso propio corre el mismo riesgo de exponer un agujero
similar en otro punto de alta de usuarios. Corregido, con test de regresión
dedicado (detalle en [[turnos-nutricion]]).

### 5. Subdominios por club y marca propia

Cada club creado pasa a tener `{club}.dominio.com`. La app se vuelve
**genérica** —misma imagen, mismo código— y se despliega **una instancia por
club**, todas contra una única base **Postgres serverless compartida en
Neon, con pooling** — no una base por club, eso sigue descartado. Cada
instancia resuelve su propio logo y colores sola, leyéndolos de su fila en
la base al arrancar.

Es el cambio de infraestructura más grande del programa. No bloquea a 1–4, pero
**si** se hace, conviene que esté resuelto antes de **6**: la app móvil necesita
saber una sola vez cómo resuelve el club de cada usuario, no dos.

Ver [[add-club-subdominios-y-marca]].

### 6. App móvil — React Native

Segundo frontend, mismo backend, alcance inicial acotado al portal de socio y
jugador (lo que dejaron listo 1–4), no al tablero de partido del cuerpo técnico.
Necesita el contrato de push de **3** definido y, si se aprueba 5, el contrato de
resolución de club definido también — de ahí que vaya último.

Ver [[add-app-movil-react-native]].

---

## Orden y por qué

```
1. Portal multidivisión ─┐
2. Perfil de jugador ────┼──→ (en paralelo, sin dependencias entre sí)
                         │
3. Notificaciones ───────┴──→ 4. Turnos nutrición
                                       │
5. Subdominios y marca ───────────────┼──→ 6. App móvil
(independiente de 1-4)                │
                                       └──→ (6 también consume 1, 2 y 4)
```

- **1 y 2 primero**: no dependen de nada, y son la parte del pedido que un socio o
  jugador nota mañana mismo.
- **3 antes que 4**: un turno sin recordatorio es un cuarto de producto.
- **5 puede arrancar en cualquier momento**, pero conviene **no** hacerlo en
  paralelo con 1 y 2: los tres tocan navegación y layout del portal, y repartir la
  atención entre infraestructura y producto en simultáneo es la receta para que
  ninguno de los dos termine bien. Mismo criterio que usó
  [[add-plataforma-club-roadmap]] al recomendar no arrancar dos frentes de UI
  grandes juntos.
- **6 al final**: es el más caro de rehacer. Construirlo contra una API y un
  contrato de push que todavía se están definiendo en 1–5 significa reescribir
  pantallas de la app publicada en la tienda, que es mucho más caro que reescribir
  una pantalla web.

---

## Fuera de alcance de todo el programa

| Qué | Por qué no |
|-----|-----------|
| **Tablero de partido / timer en el móvil** | Es trabajo de cancha, con WebSocket y cola offline ya resueltos en web ([[offline-resilience]]); llevarlo a móvil es su propio programa, no una fase de este |
| **Chat interno, cobro online, AFIP** | Ya descartados en [[add-plataforma-club-roadmap]]; nada de este programa los reabre |
| **Ranking del jugador contra compañeros** | El club ya dijo que no en el roadmap anterior |
| **Notificaciones para el cuerpo técnico** (asistencia floja, apto por vencer) | El primer disparador es la formación porque es lo que pidió el club; el resto del catálogo se agrega cambio por cambio sobre la infraestructura de 3, no de una |
| **Multi-idioma** | Nadie lo pidió; agregarlo ahora es diseñar para un requisito que no existe |

---

## Riesgos del programa

| Riesgo | Mitigación |
|--------|-----------|
| **La parte de infraestructura (5) se alarga y bloquea todo lo demás** | Está separada a propósito (ver "Dos programas"); 1–4 no dependen de 5 |
| **La app móvil se construye contra una API que todavía cambia** | Va última, y sólo arranca cuando 1–4 (y 5, si se aprueba) están en producción, no en desarrollo |
| **Notificaciones sin infraestructura previa se resuelven mal dos veces** (una para formación, otra para turnos) | 3 se diseña como servicio genérico desde el primer disparador, no como "push de formación" a secas |
| **Una instancia por club multiplica procesos a medida que crece la cantidad de clubes** | Aceptable a la escala actual; [[add-club-subdominios-y-marca]] deja escrito qué señal amerita revisar esto (RAM del servidor), no antes |
| **Seis cambios grandes a la vez diluyen foco** | Se secuencian, no se abren todos juntos; cada uno es útil por sí solo si el programa se corta después de él |

---

## Relacionado

- [[add-plataforma-club-roadmap]] — el programa anterior, que le dio a la app sus tres usuarios
- [[add-portal-multidivision]] — cambio 1
- [[add-perfil-jugador-completo]] — cambio 2
- [[add-notificaciones-push]] — cambio 3
- [[add-turnos-nutricion]] — cambio 4
- [[add-club-subdominios-y-marca]] — cambio 5
- [[add-app-movil-react-native]] — cambio 6
- [[socios]], [[club-operativo]], [[permisos]] — lo que este programa extiende
- [[architecture]], [[despliegue]] — lo que el cambio 5 pone en cuestión
