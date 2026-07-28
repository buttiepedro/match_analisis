---
title: Permisos por capacidades
status: active
created: 2026-07-27
---

# Permisos por capacidades

> Refleja lo implementado en `core/permissions.py`, `core/roles.py`, `core/deps.py`,
> `api/v1/roles.py` y la migración `0016`.

## Modelo

Un usuario tiene **varios roles**; cada rol concede **capacidades**; las capacidades
de todos sus roles **se suman**.

```
roles             club_id, name, is_preset      UNIQUE (club_id, name)
role_permissions  role_id, permission
user_roles        user_id, role_id
```

Los roles son **del club**, sembrados al crearlo. Un club que quiera un Entrenador que
además cargue lesiones tiene que poder cambiarlo sin afectar a los demás.

Las capacidades son **constantes de código** (`Permission`), no filas: el conjunto lo
define el código, porque cada endpoint referencia una.

## Capacidades

`dominio.acción`. Hoy: `plantel.*`, `asistencia.*`, `entrenamiento.gestionar`,
`partido.*`, `medico.*`, `mediciones.*`, `club.*`.

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
