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

Agrupada por momento de uso, no por entidad de datos:

| Grupo | Ítems |
|-------|-------|
| Mi cuenta | Mi cuota, Mi ficha |
| Día a día | Hoy, Calendario |
| Partido | Partidos, Estadísticas |
| Plantel | Plantel, Asistencia, Mediciones, Gimnasio |
| Club | Fixture, Tablas, Citados, Socios, Bolsa de trabajo, Configuración |

Fixture, Tablas y Citados —el portal multidivisión de
[[add-portal-multidivision]]— van primero dentro de "Club" porque, a
diferencia de Configuración y Socios, las ve también quien no administra
nada: un socio o un jugador con `club.ver_competencia`. Comparten un único
permiso porque son la misma pregunta ("¿cómo le va al club?") mirada desde
tres ángulos, no tres decisiones de acceso distintas.

Por rol:

| Rol | Ve |
|-----|-----|
| `superadmin` | Clubes |
| `club_admin` | Todo |
| `match_director` | Todo menos Configuración |
| `analyst` | Todo menos Configuración |
| `player` | Mi ficha |

Director y analista comparten menú: ninguno de los dos configura el club, y las
diferencias de permiso entre ambos son de acción dentro de cada pantalla, no de
acceso a la pantalla.

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
