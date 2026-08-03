---
title: Navegación
status: active
created: 2026-07-26
---

# Navegación

## Problema que resuelve

La app usaba una **barra inferior de 5 ítems** en teléfono y una barra superior en
escritorio. Cinco era el techo real a 360px: con seis, etiquetas como "Asistencia"
no entran.

Ese techo convirtió cada pantalla nueva en un desalojo. Al agregar "Hoy" hubo que
sacar "Mediciones" del menú del administrador, y ni Calendario ni Estadísticas
llegaron a tener entrada. El resultado, verificable cruzando rutas contra quién las
linkea:

| Ruta | Antes |
|------|-------|
| `/mediciones` | sin entrada para `club_admin` |
| `/calendario` | sin entrada para **ningún** rol |
| `/stats` | sin entrada para **ningún** rol |

Tres pantallas construidas y desplegadas, inalcanzables salvo escribiendo la URL.
El problema no era la asignación de los cinco lugares: era que hubiera cinco lugares.

## Decisión

**Una barra lateral, en dos presentaciones según el ancho.** Una lista vertical
scrollea, así que no hay techo: la próxima pantalla entra sin desalojar a nadie.

### Escritorio (≥ 768px) — barra fija colapsable

- Expandida (224px): ícono + etiqueta, agrupadas por sección.
- Colapsada (68px): sólo íconos, con `title` para el nombre.
- El estado se guarda en `localStorage` (`match_analisis:nav_collapsed`): a quien
  trabaja en una notebook chica no se le puede pedir que colapse en cada visita.

### Teléfono (< 768px) — cajón off-canvas

- Encabezado fijo con botón de menú y **el nombre de la pantalla actual**, que
  informa más que repetir la marca en cada vista.
- El cajón entra desde la izquierda sobre un fondo oscurecido.
- Se cierra al navegar, con Escape, y tocando el fondo.
- Mientras está abierto se bloquea el scroll del fondo.

## Estructura del menú

Dos lógicas de agrupación conviven en la misma lista, según a quién sirve cada
grupo:

| Grupo | Ítems | Para quién |
|-------|-------|-----------|
| Día a día | Hoy, Calendario | Staff |
| Partido | Partidos, Estadísticas de partidos | Staff |
| Plantel | Plantel, Asistencia, Mediciones, Gimnasio, Nutrición | Staff |
| Datos | Mi ficha, Tests, Mediciones físicas, Mi cuota | Jugador / socio |
| Entrenamiento | Gimnasio, Turno de nutrición | Jugador |
| Estadísticas | Mis estadísticas | Jugador |
| Comunicación | Comunicados, Fixture, Tablas, Citados, Bolsa de trabajo | Todos |
| Administración | Socios, Configuración | Staff con permiso de club |

Los primeros tres grupos son **por tarea** (qué hace el cuerpo técnico) y ya
existían. Los cuatro del medio son **por audiencia** (qué necesita ver un
jugador o un socio de sí mismo y del club) — la misma taxonomía que ya usa la
app móvil ([[app-movil]]) para su portal de socio y jugador. "Datos" y
"Entrenamiento" no son pantallas nuevas: son deep-links a las tabs de "Mi
ficha" (`/mi-ficha?tab=tests`, `?tab=fisico`, `?tab=gimnasio`,
`?tab=estadisticas`) que antes sólo eran alcanzables entrando primero a "Mi
ficha" y navegando adentro — un click de más para algo que un jugador mira
todas las semanas. `PlayerPortal` lee `?tab` al montar y en cada cambio de
`searchParams`, porque los cuatro ítems comparten pathname y React Router no
remonta la página al pasar de uno a otro.

"Turno de nutrición" (`nutricion.turnos_reservar`) y "Nutrición"
(`nutricion.turnos_publicar`) son la misma agenda mirada por el jugador que
reserva y por la nutricionista que la administra — ver [[turnos-nutricion]].
Desde el alcance por división ([[turnos-nutricion]]), publicar toma
`division_id` en la ruta (`POST /divisions/{id}/nutrition-slots`) igual que
`entrenamiento.gestionar`; una nutricionista con alcance restringido en Config
sólo ve y publica en sus divisiones.

Fixture, Tablas y Citados —el portal multidivisión de
[[add-portal-multidivision]]— comparten grupo, y el mismo permiso
`club.ver_competencia`, con Comunicados y Bolsa de trabajo: son la misma
pregunta ("¿cómo le va al club, y qué está pasando?") mirada desde varios
ángulos, y las ve también quien no administra nada. El backend de
Comunicados es más permisivo que el ítem del menú a propósito —
`GET /clubs/{id}/announcements` no exige ninguna capacidad, cualquier
autenticado del club la puede pedir, igual que la campana— pero el ítem sí
pide `club.ver_competencia`, para no romper la regla de que sin capacidades
el menú queda vacío en vez de mostrar cosas que no abren.
"Comunicados" es el MVP de novedades del club: texto simple, del club entero
o de una división, sin adjuntos ni moderación — eso ya lo resuelve Bolsa de
trabajo para su propio caso de uso.

Por rol:

| Rol | Ve |
|-----|-----|
| `superadmin` | Clubes |
| `club_admin` | Todo |
| `match_director` | Todo menos Administración |
| `analyst` | Todo menos Administración |
| `player` | Datos, Entrenamiento, Estadísticas, y lo de Comunicación que el rol real (Jugador o Socio) tenga habilitado |

Director y analista comparten menú: ninguno de los dos configura el club, y las
diferencias de permiso entre ambos son de acción dentro de cada pantalla, no de
acceso a la pantalla. `player` es el enum viejo: agrupa tanto a jugadores como
a socios importados del padrón, que se distinguen por las capacidades de su
rol preset real (Jugador vs. Socio), no por este valor.

## La campana no es un ítem del menú

`GET /me/notifications/unread-count` ([[notificaciones]]) se sondea cada 60
segundos y se muestra como un ícono con contador, fijo en el encabezado de
teléfono y en la barra de escritorio (arriba del `navList`, no adentro). No
está en `NAV` ni pasa por `navFor`, a propósito: recibir avisos propios no es
una capacidad sobre el club, así que no tiene sentido que dependa de una —
todo usuario autenticado la ve, incluido un rol sin ninguna capacidad de
club. Lleva a `/notificaciones`.

## Reglas

- **Toda ruta bajo el layout tiene entrada en el menú de al menos un rol.** Es la
  regla que se rompió y produjo las tres pantallas huérfanas. Al agregar una ruta,
  agregar el ítem.
- **El tablero de partido no lleva navegación.** `/sessions/:id` y
  `/sessions/:id/lineup` viven fuera del layout: durante el partido la pantalla es
  para el partido.
- **Las rutas viejas redirigen, no se borran.** `/performance` → `/mediciones`
  sigue funcionando para links ya guardados, y `/mediciones` también se marca
  activo entrando por la ruta vieja.
- **Estado activo por prefijo.** `/squad/:id` marca Plantel, `/trainings/:id`
  marca Asistencia. Los alias (`/torneos` → Partidos) se declaran en el ítem.

## Compromiso conocido

En teléfono el disparador del menú queda **arriba a la izquierda**, que es la
esquina menos alcanzable con el pulgar — la barra inferior anterior era mejor en
eso. Se aceptó a cambio de que ninguna pantalla quede fuera del menú: navegar es
algo que pasa al principio de una tarea, no durante. El registro de eventos en
cancha, que sí es de pulgar y repetitivo, ocurre en el tablero, que no tiene
navegación y no se ve afectado.

Si el alcance con el pulgar resulta un problema en uso real, la salida es mover el
disparador abajo, no volver a la barra de cinco.

## Relacionado

- [[ux-redesign-v2]] — define las pantallas; su sección de navegación quedó superada
- [[auth-and-users]] — roles y permisos
- [[offline-resilience]] — el tablero, que queda fuera de la navegación
- [[notificaciones]] — la campana y la bandeja
- [[turnos-nutricion]] — agenda de la nutricionista, ítems "Nutrición" y "Turno de nutrición"
- [[app-movil]] — mismo techo de "cinco es el límite" aplicado a los tabs de la app móvil
