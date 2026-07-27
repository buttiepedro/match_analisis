---
title: Socios — padrón importable, ingreso por DNI y estado de cuota
type: feature
status: proposed
spec: socios
created: 2026-07-27
---

# Socios — padrón importable, ingreso por DNI y estado de cuota

## Descripción del Cambio

El club ya tiene un padrón de socios y un **sistema contable que sabe quién está al
día**. La app no va a calcular eso: lo **espeja**.

Cada socio entra con su **DNI** y una contraseña por defecto que cambia en el primer
ingreso, y ve una sola cosa: si está al día o no. El padrón se importa y se
**re-importa** — semanal por Excel al principio, por endpoint si el sistema contable
llega a exponer uno.

> **Cambio de alcance respecto del roadmap.** El [[add-plataforma-club-roadmap]] proponía
> `fees` y `fee_schedules` con períodos, montos y métodos de pago. **Nada de eso va.**
> El estado de cuota es un booleano que llega importado. Modelar cuotas mes a mes sería
> construir un sistema contable paralelo al que el club ya tiene y usa — y dos fuentes
> de verdad sobre plata terminan mal siempre.

---

## Lo que sí y lo que no

| | |
|---|---|
| ✅ Padrón importable y **re-importable** | ❌ Calcular deuda, montos o períodos |
| ✅ Estado al día como booleano espejado | ❌ Cobrar o registrar pagos |
| ✅ Ingreso por DNI + cambio de contraseña | ❌ Socios inactivos (por ahora sólo activos) |
| ✅ Preparado para reemplazar Excel por endpoint | ❌ Historial de cuotas mes a mes |

---

## Modelo

### `User` — cambios

```sql
users
  email             VARCHAR(255) UNIQUE  -- pasa a NULLABLE: un socio puede no tener
  document_id       VARCHAR(20)          -- DNI, credencial de ingreso
+ must_change_password BOOLEAN NOT NULL DEFAULT FALSE

  UNIQUE (club_id, document_id)
```

**El DNI vive en `User`, no en `Member`.** Es la credencial de ingreso, y como cada
socio del padrón recibe una cuenta, no hay socio sin usuario: duplicarlo en las dos
tablas sería crear un riesgo de desincronización sin ganar nada.

> Es la decisión inversa a `Player.user_id`, que es nullable porque la enorme mayoría
> del plantel nunca va a tener acceso. Con socios pasa lo contrario: la cuenta es el
> punto de todo el módulo.

`email` pasa a nullable. Postgres permite múltiples `NULL` bajo un `UNIQUE`, así que la
restricción sobre los emails que sí existen se mantiene.

### `Member` — nuevo

```sql
members
  id                UUID PK
  club_id           UUID FK → clubs.id
  user_id           UUID FK → users.id  NOT NULL UNIQUE
  full_name         VARCHAR(150) NOT NULL
  category          VARCHAR(50)          -- activo, cadete, vitalicio, adherente
  member_number     VARCHAR(30)          -- número de socio del sistema contable
  joined_on         DATE
  is_active         BOOLEAN NOT NULL DEFAULT TRUE

  -- Espejo del sistema contable. La app no lo calcula nunca.
  dues_up_to_date   BOOLEAN NOT NULL DEFAULT FALSE
  dues_synced_at    TIMESTAMP NOT NULL

  created_at        TIMESTAMP
  updated_at        TIMESTAMP
```

**`dues_synced_at` no es opcional y es la columna más importante de la tabla.**

Mostrar "estás al día" sin decir a qué fecha corresponde el dato es desinformar. Si el
último Excel se importó hace tres semanas, el socio tiene que verlo: *"Al día — según
el último dato del club, 12/07"*. Un socio que pagó ayer y ve "no estás al día" sin
fecha llama al club enojado; con fecha, entiende.

### `MemberImport` — log de cada sincronización

```sql
member_imports
  id            UUID PK
  club_id       UUID FK → clubs.id
  source        VARCHAR(20)   -- 'xlsx' | 'api'
  created_count INT
  updated_count INT
  deactivated_count INT
  total_rows    INT
  errors        JSON
  run_by        UUID FK → users.id
  created_at    TIMESTAMP
```

Sin esto, cuando el lunes aparezcan 200 socios desactivados nadie va a poder decir qué
archivo lo hizo.

---

## Sincronización

### Un solo camino de escritura

El importador de Excel y el futuro cliente de API **no** son dos implementaciones: los
dos arman una lista de filas normalizadas y llaman a la misma función.

```
Excel  ─┐
        ├─→  parse → [MemberRow]  →  sync_members(club, rows, source)
API    ─┘
```

Cuando el sistema contable exponga el endpoint, lo que se escribe es el parser, no la
lógica de sincronización. Es la diferencia entre un cambio de un día y una reescritura.

### Reglas de la sincronización

1. **Match por DNI** dentro del club. Es la clave natural del padrón.
2. **Existe → se actualiza.** Nombre, categoría, número de socio y estado de cuota.
   La contraseña **no se toca**: re-importar no puede resetearle el acceso a nadie.
3. **No existe → se crea** el `Member` y su `User` con contraseña por defecto y
   `must_change_password = true`.
4. **Está en la base y no en el archivo → `is_active = false`.** Nunca se borra.
   El padrón trae sólo activos, así que ausencia significa baja — pero una baja se
   revierte y un borrado no.
5. **Idempotente**: correr el mismo archivo dos veces deja el mismo estado.
6. `dues_synced_at` se actualiza en **todas** las filas procesadas, cambien o no. La
   pregunta que responde es "¿de cuándo es este dato?", no "¿cuándo cambió?".

### Preview obligatorio

`POST /clubs/{id}/members/import?dry_run=true` devuelve qué haría **sin escribir**:
cuántos crea, cuántos actualiza y **quiénes se dan de baja, por nombre**.

Un import semanal que desactive medio padrón porque alguien exportó la solapa
equivocada tiene que ser visible antes de confirmarse, no después. La UI muestra el
preview y pide confirmar.

**Freno de mano**: si un import desactivaría más del 20% del padrón, se rechaza salvo
que venga con `force=true`. Es el error más probable y el más caro.

---

## Ingreso por DNI

`POST /auth/login` pasa a aceptar `document_id` además de `email`. El campo `email`
sigue funcionando: el staff ya entra así y no hay razón para migrarlo.

```json
{ "document_id": "30123456", "password": "..." }
```

La respuesta incluye `must_change_password`. Con ese flag el frontend manda a
`/cambiar-password` y **no deja pasar a ninguna otra pantalla** hasta que se cambie.

`POST /auth/change-password` con la contraseña actual, la nueva, y baja el flag.

### El DNI repetido entre clubes

`UNIQUE (club_id, document_id)`: la misma persona puede ser socia de dos clubes.

Si un DNI resuelve a más de un usuario, el login devuelve `409` con la lista de clubes
y el cliente reintenta con `club_slug`. Con un club nunca se dispara, y evita tener que
rehacer el login el día que haya dos.

---

## La contraseña por defecto

Es el punto flojo del diseño y conviene mirarlo de frente.

**La contraseña por defecto no puede ser el DNI.** Si lo fuera, usuario y contraseña
serían el mismo dato, y cualquiera que conozca el DNI de un socio —que está en el
padrón, en una planilla, en un grupo de WhatsApp— entra a su cuenta.

**Propuesta**: una contraseña por defecto **por import**, que elige quien importa
(`default_password` en el request, con un mínimo de 8 caracteres). El club la comunica
por el canal que ya usa. No queda guardada en claro en ningún lado.

**Qué tan grave es la ventana entre el import y el primer ingreso:**

- Lo único que se ve es *si ese socio está al día*. No hay datos de pago, ni domicilio,
  ni forma de modificar nada.
- El flag `must_change_password` corta el paso a cualquier otra pantalla.
- Es información del club sobre un socio, no información sensible de terceros.

Es una exposición real y acotada. Se documenta, no se esconde. Si el club prefiere algo
más fuerte, la alternativa es una contraseña aleatoria por socio impresa en la
comunicación de alta — más seguro y bastante más trabajo de logística para el club.

---

## Fases de Implementación

### Fase A: Modelo y migración
- [ ] Migración: `users.email` a nullable, `users.document_id`, `users.must_change_password`
- [ ] `UNIQUE (club_id, document_id)`
- [ ] Tablas `members` y `member_imports`
- [ ] Rol `socio` con una sola capacidad: ver su propio estado de cuota

### Fase B: Sincronización
- [ ] `MemberRow` normalizada + `sync_members(club, rows, source)` como único camino de escritura
- [ ] Parser de Excel con mapeo flexible de encabezados, siguiendo el importador de jugadores que ya existe
- [ ] `POST /clubs/{id}/members/import` con `dry_run`, `force` y `default_password`
- [ ] Freno del 20% de bajas
- [ ] `GET /clubs/{id}/member-imports` — historial de sincronizaciones
- [ ] Tests: idempotencia, baja por ausencia, la contraseña no se pisa, freno del 20%,
      `dues_synced_at` se actualiza aunque el estado no cambie

### Fase C: Ingreso por DNI
- [ ] `login` acepta `document_id`; `email` sigue funcionando
- [ ] `must_change_password` en la respuesta y en el token
- [ ] `POST /auth/change-password`
- [ ] Guard en el frontend: con el flag arriba, sólo se llega a cambiar la contraseña
- [ ] `409` con lista de clubes ante DNI ambiguo
- [ ] Tests: login por DNI, por email, DNI de otro club, flag que bloquea navegación

### Fase D: Pantalla del socio
- [ ] `GET /me/member` — estado propio
- [ ] Pantalla: al día o no, **con la fecha del dato**, y a quién reclamar si no coincide
- [ ] Landing por rol: un socio que no es jugador entra acá
- [ ] Estado vacío honesto si el padrón nunca se importó

### Fase E: Administración
- [ ] Listado de socios con búsqueda y filtro por estado de cuota
- [ ] Pantalla de import con preview y confirmación
- [ ] Documentación del formato de Excel esperado

### Fase F: Documentación
- [ ] `openspec/specs/socios.md`
- [ ] `data-model.md` y `README.md`

---

## Formato del Excel

Encabezados reconocidos, tolerante a mayúsculas y acentos como el importador de
jugadores:

| Columna | Requerida | Notas |
|---------|-----------|-------|
| DNI / Documento | **Sí** | Clave de match |
| Apellido y Nombre / Nombre | **Sí** | Se concatena si vienen separados |
| Al día / Estado cuota | **Sí** | `SI`/`NO`, `1`/`0`, `TRUE`/`FALSE`, `AL DIA`/`DEUDOR` |
| Categoría | No | activo, cadete, vitalicio, adherente |
| N° Socio | No | Del sistema contable |
| Email | No | Si viene, habilita ingreso por email también |
| Fecha alta | No | |

Una fila sin DNI o sin nombre se rechaza y se reporta con su número de fila. No se
descarta el import entero por una fila mala: se importa el resto y se muestra qué quedó
afuera.

---

## Decisiones Técnicas

| Decisión | Elección | Razón |
|----------|----------|-------|
| Estado de cuota | Booleano espejado | El club ya tiene sistema contable; dos fuentes de verdad sobre plata terminan mal |
| `dues_synced_at` | Obligatorio | "Al día" sin fecha es desinformación |
| DNI | En `User`, no en `Member` | Es credencial de ingreso y todo socio tiene cuenta |
| Ausencia en el padrón | `is_active = false` | Una baja se revierte; un borrado no |
| Excel y API | Mismo `sync_members` | Cambiar de fuente debe ser un parser, no una reescritura |
| Contraseña en re-import | No se toca | Re-importar no puede sacarle el acceso a nadie |
| Contraseña por defecto | Elegida por import, nunca el DNI | Usuario igual a contraseña no es una contraseña |
| Preview + freno del 20% | Obligatorios | El error probable es el archivo equivocado, y es caro |

---

## Criterios de Aceptación

- [ ] Importar el mismo archivo dos veces deja exactamente el mismo estado
- [ ] Un socio que desaparece del archivo queda inactivo, **no borrado**
- [ ] Re-importar **no** resetea la contraseña de nadie
- [ ] `dues_synced_at` se actualiza en todas las filas, cambie o no el estado
- [ ] Un import que daría de baja a más del 20% se rechaza sin `force`
- [ ] El preview muestra los nombres de quiénes se darían de baja
- [ ] Un socio entra con DNI y contraseña por defecto, y **no llega a ninguna pantalla**
      hasta cambiarla
- [ ] El staff sigue entrando por email exactamente como antes
- [ ] La pantalla del socio muestra el estado **y la fecha del dato**
- [ ] Un socio no puede ver el estado de otro socio
- [ ] Migraciones limpias en ambas direcciones contra Postgres

---

## Riesgos

| Riesgo | Mitigación |
|--------|-----------|
| Se importa el archivo equivocado y se da de baja medio padrón | Preview obligatorio, freno del 20% y log de cada import |
| `email` pasa a nullable y algo asumía que existía | Auditar los usos de `user.email` antes de migrar; el login por email no cambia |
| La contraseña por defecto queda sin cambiar por meses | El flag bloquea toda la app salvo el cambio; se puede reportar cuántos siguen sin cambiarla |
| El dato de cuota queda viejo y el socio lo toma por actual | `dues_synced_at` visible siempre, junto al estado |
| El club pide cobrar online al ver el módulo | Está fuera de alcance por decisión, ya conversada en el roadmap |
| DNI repetido entre clubes | `UNIQUE (club_id, document_id)` + resolución por `club_slug` |

---

## Relacionado

- [[add-plataforma-club-roadmap]] — el programa; este es su cambio 2, con alcance recortado
- [[auth-and-users]] — login y roles, que la Fase C toca
- [[club-operativo]] — alcance por división, ortogonal a esto
- [[data-model]] — schema
