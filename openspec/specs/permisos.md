---
title: Permisos por capacidades
status: active
created: 2026-07-27
---

# Permisos por capacidades

> Refleja lo implementado en `core/permissions.py`, `core/roles.py`, `core/deps.py`,
> `api/v1/roles.py` y las migraciones `0016` y `0020`.

## Modelo

Un usuario tiene **varios roles**; cada rol concede **capacidades**; las capacidades
de todos sus roles **se suman**. Y un rol puede **derivar de otro**.

```
roles             club_id, name, is_preset, parent_role_id   UNIQUE (club_id, name)
role_permissions  role_id, permission, inherited
user_roles        user_id, role_id
```

Los roles son **del club**, sembrados al crearlo. Un club que quiera un Entrenador que
además cargue lesiones tiene que poder cambiarlo sin afectar a los demás.

Las capacidades son **constantes de código** (`Permission`), no filas: el conjunto lo
define el código, porque cada endpoint referencia una.

## Capacidades

`dominio.acción`. Hoy: `plantel.*`, `asistencia.*`, `entrenamiento.gestionar`,
`partido.*`, `medico.*`, `mediciones.*`, `gimnasio.*`, `socios.*`, `bolsa.*`,
`club.*`.

## Herencia entre roles

Un rol puede derivar de otro: **Jugador hereda de Socio** y le agrega lo suyo.

```
efectivas(rol) = propias(rol) ∪ efectivas(padre)
```

Sin esto, el día que el club le suma un beneficio al socio hay que acordarse de
agregárselo a mano a cada rol que además es socio. Olvidarse **no da error**:
simplemente alguien no ve algo que le corresponde, y eso no se descubre hasta que
alguien reclama.

### Un solo padre

Un rol hereda de uno, no de varios. Así el club queda como un árbol que se puede
dibujar y explicar de una frase — *"Jugador = Socio + 2 propias"*—, cosa que un
grafo no permite.

La suma de dos ramas ya está resuelta en otro lado: el entrenador que además es
tesorero recibe **los dos roles**, y las capacidades se suman. Ese caso pertenece
a la asignación, no a la definición del rol.

### Las heredadas están materializadas

`role_permissions` guarda las propias **y** las heredadas, con un flag. No se
resuelven al leer.

El motivo es concreto: `user_permissions()` es una función **sync** que corre en
el camino de todos los requests, y también la llama `assert_division_access`.
Recorrer ahí la cadena de padres significaría lazy-loading dentro de código sync,
que en este proyecto ya explotó dos veces con `MissingGreenlet`. El precio es
recalcular al editar un rol — un club tiene ocho o quince roles: barato, y pasa
una vez por edición en vez de una vez por request.

Al escribir se recalcula el **club entero**, no sólo los descendientes del rol que
cambió. Cuesta lo mismo y hace imposible que quede uno desincronizado por un caso
de borde del recorrido. Un permiso mal resuelto no se ve hasta que alguien entra a
donde no debía.

### Reglas

- **Propia le gana a heredada.** Si alguien la tildó a mano, sacarle el padre al
  rol no se la quita.
- **Sin ciclos.** Un ciclo no da error: da un resolvedor girando para siempre. Se
  rechaza antes de escribir, con un mensaje que nombra el camino.
- **Máximo 5 niveles.** No hay motivo técnico; cinco ya son más de los que alguien
  puede seguir de cabeza.
- **Un rol con hijos no se borra.** Les sacaría de golpe todo lo heredado, que es
  un cambio de permisos grande disfrazado de borrar un rol. El error dice quiénes
  heredan.
- **La UI no ofrece padres inválidos** (él mismo ni su descendencia), aunque el
  backend igual los rechace.

### Los presets no vienen encadenados

Se siembran sin padre, igual que antes. Poner "Jugador hereda de Socio" en la
siembra le habría dado la bolsa de trabajo a **todos los jugadores existentes** en
el momento de desplegar. Eso es una decisión del club, no un efecto secundario de
actualizar: la herencia se arma desde la pantalla de roles.

## Roles preset

| Preset | Equivale al rol viejo |
|--------|----------------------|
| Administrador | `club_admin` — todas |
| Entrenador | `match_director` |
| Analista | `analyst` |
| Jugador | `player` — **ninguna** |
| Preparador físico · Nutricionista · Tesorero · Socio | nuevos, sin asignar |

**Jugador sin capacidades no es un olvido.** Su acceso es a lo propio y lo resuelve
`require_player_self`, que no es una capacidad sobre el club.

Eso **recortó** lo que un `player` podía: antes llegaba a cualquier endpoint con
`get_current_user` y enumeraba divisiones, plantel, entrenamientos y lesiones del
club entero. El portal nunca lo usó. Sus tres endpoints —`/me/player`,
`/players/{id}/attendance` y `/players/{id}/season-stats`— son de acceso propio y
siguen funcionando; hay un test que lo verifica.

Los cuatro presets nuevos se siembran vacíos o mínimos y **no se le asignan a nadie**:
adivinar quién es tesorero sería peor que dejarlo sin asignar.

## `superadmin` queda afuera

Crear clubes es una capacidad de la plataforma y no pertenece a ningún club. Sigue
siendo un chequeo directo sobre `users.role`, y saltea todo chequeo de capacidad.

## Uso

```python
current_user: Annotated[User, Depends(require(Permission.asistencia_cargar))]
```

Varias capacidades significan **o**, no **y**: un endpoint que sirve a dos roles por
motivos distintos es lo normal; uno que exige dos a la vez casi siempre son dos
endpoints.

## Capacidad y alcance son ortogonales

La capacidad dice **qué** podés hacer; el alcance por división ([[club-operativo]])
dice **sobre qué divisiones**. Los dos se aplican.

## Reglas de administración

- Un **preset se edita pero no se borra**: es la red que evita que un club se quede sin
  ningún rol capaz de administrarlo.
- Un rol custom **asignado a alguien no se borra**: hacerlo dejaría a esa gente sin
  acceso sin que nadie se entere.
- Un rol de un club no es visible ni asignable desde otro.

## Migración

`users.role` **se conserva sin leerse**. Sacar la columna en la misma migración que
introduce el sistema nuevo eliminaría la posibilidad de volver atrás sin restaurar un
backup — verificado: tras `downgrade 0015` los roles viejos siguen intactos.

Las dependencias `require_club_admin` y `require_timer_control` siguen existiendo,
resueltas por capacidad, mientras queden call sites sin migrar.

## Relacionado

- [[add-permisos-por-capacidades]] — la propuesta
- [[club-operativo]] — alcance por división
- [[add-plataforma-club-roadmap]] — el programa
