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
Native, para App Store y Play Store, con la misma información que el web. Y una
pregunta de infraestructura: que cada club creado tenga su propio subdominio
(`{club}.dominio.com`) con su marca propia, y si conviene que además tenga su
propia base de datos en Neon.

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

### 1. Portal multidivisión — fixture, tablas, citados y lugar de entrenamiento

Extiende lo que ya existe (`standings`, `calendar`, `match_squad`) para que un
socio o jugador vea **todas** las divisiones, no sólo la propia — no tiene una
división propia, así que "sólo la propia" ni siquiera aplica. Suma el lugar de
entrenamiento a lo que ya se muestra.

Es lectura pura sobre datos que ya existen. Va primero porque no tiene
dependencias, es el que más rápido se ve en producción, y establece el patrón de
"lectura club-entero" que **2** y el resto del portal van a reusar.

Ver [[add-portal-multidivision]].

### 2. Perfil completo del jugador

Todo lo que la ficha del jugador ya tiene —contacto, apto médico, obra social,
historial de división, lesiones cerradas— pero que el portal de [[club-operativo]]
nunca terminó de mostrar. Mayormente agregación de endpoints existentes.

Va segundo por la misma razón que 1: sin dependencias, bajo riesgo, alto valor
percibido — es lo que hace que el jugador sienta que la app es "de él", no sólo
una planilla del entrenador.

Ver [[add-perfil-jugador-completo]].

### 3. Notificaciones — infraestructura, primer uso: formación cargada

Hoy no existe **ningún** canal de push. [[club-operativo]] eligió texto para
copiar en vez de push justamente porque no había infraestructura y armarla para
un solo aviso no se justificaba. Ahora sí: un aviso cuando se carga la formación
es el primero de varios que van a aparecer (turnos de nutrición, después
probablemente asistencia y cuotas).

Se construye **una vez**, como servicio de notificaciones con destino
intercambiable — push web (VAPID + service worker) primero, push nativo (FCM/APNs)
cuando exista **6**. El primer disparador es la formación; el modelo ya queda
listo para el resto.

Ver [[add-notificaciones-push]].

### 4. Turnos con nutricionista

Agenda: la nutricionista publica disponibilidad, el jugador reserva, cualquiera
de los dos cancela. Usa **3** para el recordatorio, pero el flujo de reserva en sí
no depende de nada.

Va después de 3 porque un turno sin recordatorio es la mitad del valor, y
construirlo dos veces —una sin push, otra con— es trabajo de más.

Ver [[add-turnos-nutricion]].

### 5. Subdominios por club y marca propia

Cada club creado pasa a tener `{club}.dominio.com`, resuelto por header `Host`
en vez de por selección manual, con logo y colores propios. Incluye la pregunta
de si conviene una base de datos por club en Neon — **con una recomendación, no
una decisión tomada**: ver el archivo para el detalle.

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
| **El pedido de Neon por club se implementa porque el dueño dio la api key, no porque convenga** | [[add-club-subdominios-y-marca]] trae la recomendación explícita antes de tocar código, y frena ahí hasta la confirmación |
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
