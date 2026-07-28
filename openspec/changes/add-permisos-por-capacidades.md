---
title: Permisos por capacidades
type: refactor
status: proposed
spec: permisos
created: 2026-07-27
---

# Permisos por capacidades

## Descripción del Cambio

`UserRole` es un enum de 5 valores y un usuario tiene exactamente uno. Los chequeos
son cuatro dependencias fijas, y una de ellas —`require_club_admin`— guarda **48
endpoints**: crear divisiones, cargar lesiones, invitar jugadores, definir lineup y
armar torneos son, para el sistema, la misma cosa.

Con tesorería, moderación de bolsa de trabajo y planes de gimnasio en camino, ese
cajón deja de tener sentido. Y hay algo que el modelo actual directamente no puede
expresar: **una persona es varias cosas a la vez**. El entrenador de M17 también es
socio. El tesorero también es padre de un jugador.

Este cambio reemplaza el enum por **roles con capacidades**, muchos por usuario.

> **No agrega ni saca ningún permiso.** Es un refactor: el día del deploy, cada
> usuario puede exactamente lo que podía el día anterior. Todo lo nuevo llega después,
> encima de esta base.

---

## Modelo

```sql
roles
  id          UUID PK
  club_id     UUID FK → clubs.id
  name        VARCHAR(50) NOT NULL
  is_preset   BOOLEAN NOT NULL DEFAULT FALSE   -- preset: se puede editar, no borrar
  created_at  TIMESTAMP
  UNIQUE (club_id, name)

role_permissions
  role_id     UUID FK → roles.id ON DELETE CASCADE
  permission  VARCHAR(50) NOT NULL
  PRIMARY KEY (role_id, permission)

user_roles
  user_id     UUID FK → users.id ON DELETE CASCADE
  role_id     UUID FK → roles.id ON DELETE CASCADE
  PRIMARY KEY (user_id, role_id)
```

**Los roles son del club, no globales.** Un club que quiera un "Entrenador" que además
cargue lesiones tiene que poder cambiarlo sin afectar a los demás. Al crear un club se
siembran los presets; a partir de ahí son suyos.

**Las capacidades son constantes en código, no una tabla.** El conjunto lo define el
código —cada endpoint referencia una— así que una tabla agregaría un join para
almacenar algo que ya está fijo en el binario.

**`users.role` no se borra en este cambio.** Se deja de leer, pero sacar la columna en
la misma migración que introduce el sistema nuevo elimina la posibilidad de volver
atrás sin restaurar un backup.

---

## Catálogo de capacidades

```
plantel.ver          plantel.editar        plantel.mover        plantel.importar
asistencia.ver       asistencia.cargar     entrenamiento.gestionar
partido.ver          partido.gestionar     partido.timer        partido.eventos
                     partido.lineup
medico.ver           medico.editar
mediciones.ver       mediciones.cargar
club.divisiones      club.torneos          club.usuarios        club.rivales
```

`dominio.acción`. Las de socios, bolsa y gimnasio se agregan cuando lleguen sus
módulos: inventarlas ahora sería adivinar su forma.

### `superadmin` queda afuera

No es un rol de club: es una capacidad de la plataforma —crear clubes— y no pertenece
a ninguno. Sigue siendo un chequeo directo sobre `users.role`. Meterlo al sistema de
roles obligaría a un club dueño de un rol que puede crear otros clubes, que es un
sinsentido.

---

## El mapeo que hace segura la migración

Cada rol actual pasa a un preset con **exactamente** lo que ya tenía. Sale de medir el
código, no de suponer:

| Preset | Capacidades | Equivale a |
|--------|-------------|------------|
| **Administrador** | Todas | `club_admin` |
| **Entrenador** | Todo menos `club.*` y `medico.editar` | `match_director` |
| **Analista** | `*.ver`, `partido.eventos`, `asistencia.cargar`, `mediciones.cargar` | `analyst` |
| **Jugador** | Ninguna | `player` |

**Jugador sin ninguna capacidad no es un error.** Un `player` hoy no accede a ningún
endpoint de club: llega a su ficha por `require_player_self`, que es acceso a lo propio
y no una capacidad sobre el club. Ese mecanismo no se toca.

Preparador físico, Nutricionista, Tesorero y Socio se siembran como presets **vacíos o
mínimos** para que el club los complete. No se le asignan a nadie automáticamente:
adivinar quién es tesorero sería peor que dejarlo sin asignar.

---

## Compatibilidad

La migración de 111 call sites no se hace de un saque.

1. `require_club_admin`, `require_timer_control` y `get_current_user` **siguen
   existiendo** y pasan a resolverse por capacidades.
2. Los endpoints se migran por módulo a `require(Permission.x)`.
3. Las dependencias viejas se borran cuando no queden usos.

Así cada paso es reversible y la suite corre verde en todos.

---

## Fases de Implementación

### Fase A: Modelo y catálogo
- [ ] `app/core/permissions.py` con el enum `Permission` y los presets
- [ ] Modelos `Role`, `role_permissions`, `user_roles`
- [ ] Migración `0016`: tablas + seed de presets por club + asignación según `users.role`
- [ ] `users.role` se conserva, sin leerse

### Fase B: Resolución
- [ ] `user_permissions(user)` con las capacidades efectivas de todos sus roles
- [ ] `require(*permissions)` como dependencia de FastAPI
- [ ] `require_club_admin` y `require_timer_control` reimplementadas sobre capacidades
- [ ] `superadmin` sigue salteando todo chequeo

### Fase C: Migración de call sites
- [ ] Por módulo: trainings, injuries, players, performance, lineup, sessions,
      tournaments, divisions, clubs, import, competition
- [ ] Suite verde después de cada módulo
- [ ] Borrar las dependencias viejas cuando queden sin uso

### Fase D: Administración
- [ ] `GET/POST/PATCH/DELETE /clubs/{id}/roles`
- [ ] `PUT /clubs/{id}/users/{uid}/roles`
- [ ] Config: asignar varios roles por usuario y editar las capacidades de cada rol
- [ ] Un preset se edita pero no se borra

### Fase E: Tests
- [ ] **El test que importa**: por cada rol viejo, la misma matriz de endpoints
      permitidos y denegados que antes del cambio
- [ ] Usuario con dos roles suma capacidades
- [ ] Quitar un rol quita sus capacidades salvo que otro las dé
- [ ] Los roles de un club no se ven ni se asignan desde otro
- [ ] El alcance por división sigue aplicándose **además** de la capacidad

### Fase F: Documentación
- [ ] `openspec/specs/permisos.md`
- [ ] `auth-and-users.md`, `data-model.md`, `README.md`

---

## Decisiones Técnicas

| Decisión | Elección | Razón |
|----------|----------|-------|
| Roles | Por club, sembrados al crearlo | Un club tiene que poder ajustar sin afectar a otros |
| Capacidades | Constantes en código | El set lo define el código; una tabla agrega un join sin ganar nada |
| `users.role` | Se conserva sin leer | Poder volver atrás sin restaurar un backup |
| `superadmin` | Fuera del sistema de roles | Es de plataforma, no de club |
| Jugador | Preset sin capacidades | Su acceso es a lo propio, vía `require_player_self` |
| Migración | Por módulo, con alias | 111 call sites de una sola vez no se revisan bien |
| Capacidad y alcance | Ortogonales | Una dice *qué*, la otra *sobre qué divisiones* |
| Presets nuevos | Vacíos y sin asignar | Adivinar quién es tesorero es peor que no asignarlo |

---

## Criterios de Aceptación

- [ ] **Cada rol viejo conserva exactamente su matriz de accesos**, verificado por test
- [ ] Un usuario con Entrenador + Tesorero tiene la unión de ambas capacidades
- [ ] El alcance por división se sigue aplicando además de la capacidad
- [ ] Un rol de un club no es visible ni asignable desde otro
- [ ] Un preset se puede editar y no se puede borrar
- [ ] `superadmin` sigue creando clubes
- [ ] Un usuario sin ningún rol no accede a nada del club — y eso **no** le pasa a nadie
      al migrar, porque todos reciben su preset equivalente
- [ ] Migraciones limpias en ambas direcciones contra Postgres
- [ ] Suite completa verde

---

## Riesgos

| Riesgo | Mitigación |
|--------|-----------|
| **Alguien queda sin acceso al deployar** | El mapeo sale de medir el código, no de suponerlo, y hay un test por rol que compara la matriz completa antes/después |
| El seed no corre para clubes existentes | La migración siembra presets y asigna roles a todos los usuarios ya cargados, no sólo a los nuevos |
| Migrar 111 call sites a mano deja alguno mal | Se migra por módulo con la suite verde en cada paso; las dependencias viejas quedan como alias hasta que no haya usos |
| Un club se borra un rol y deja gente sin acceso | Los presets no se borran; borrar un rol custom pide confirmación y avisa a cuántos afecta |
| Aparece la tentación de sumar permisos "ya que estamos" | Este cambio **no agrega ni saca** ninguno. Lo nuevo va en el módulo que lo necesite |

---

## Relacionado

- [[add-plataforma-club-roadmap]] — el programa; este es su cambio 1
- [[add-socios-padron]] — depende de esto para el rol Socio
- [[auth-and-users]] — modelo de roles que este cambio reemplaza
- [[club-operativo]] — alcance por división, ortogonal y ya implementado
