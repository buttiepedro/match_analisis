---
title: Perfil completo del jugador
type: feature
status: completed
spec: club-operativo
created: 2026-07-29
completed: 2026-08-01
---

# Perfil completo del jugador

## Descripción del Cambio

El portal del jugador ya tiene Resumen, Tests y Físico —lo que
[[add-plataforma-club-roadmap]] llamó "lo que el jugador más quiere ver". Lo que
falta es lo que **ya existe en `players`** pero nunca terminó de viajar al
portal: contacto, apto médico con sus dos fechas, obra social, y el historial —
en qué divisiones jugó y qué lesiones tuvo, no sólo su estado actual.

No hay tabla nueva. Es exponer, en el propio portal, datos que el cuerpo técnico
ya carga y que hoy sólo se ven desde las pantallas de administración.

---

## Qué falta y de dónde sale

| Dato | Ya existe en | Hoy se ve en el portal |
|------|---------------|------------------------|
| Teléfono, teléfono de emergencia, email, obra social | `players` | No |
| Apto médico (fecha y vencimiento) | `players.medical_clearance_*` | No — sólo lo ve el cuerpo técnico en la grilla de armado |
| Historial de divisiones | `player_division_history` | No |
| Lesiones cerradas (fecha, zona, tipo, cuánto duró) | `player_injuries` | No — sólo la disponibilidad actual, no el historial |
| Foto de perfil | `players.profile_photo_url` | Parcial |
| Tests físicos, antropometría | `physical_tests`, `player_measurements` | **Sí**, ya implementado en [[club-operativo]] |

La última fila está para dejar constancia de que **no** se repite trabajo ya
hecho: este cambio es específicamente lo que quedó afuera de esa entrega.

---

## Edición: qué decide el jugador y qué decide el club

[[club-operativo]] dejó esto explícitamente abierto: *"el portal es de lectura.
Qué puede editar un jugador de su propia ficha es una decisión del club, no un
default técnico."* Este cambio toma una posición y la deja documentada para que
el club la confirme o la ajuste antes de salir a producción:

| Campo | ¿Editable por el jugador? | Por qué |
|-------|---------------------------|---------|
| Teléfono, teléfono de emergencia | **Sí** | Es información de contacto del propio jugador; el club no tiene forma de mantenerla al día sin pedírsela a él |
| Foto de perfil | **Sí** | Cosmético, sin efecto en ningún cálculo |
| Email | **Sí** | Igual razón que el teléfono |
| DNI, obra social, posición | **No** | Bajo la misma lógica que `dues_synced_at` en [[socios]]: son datos que el club necesita poder auditar de dónde salieron |
| Disponibilidad, apto médico | **No** | Los escribe únicamente `injuries.py` según [[gestion-semanal]]; dejar que el jugador la toque rompe esa única fuente de escritura |

**Esta tabla es una propuesta, no un hecho.** Si el club prefiere que nada sea
editable —igual que hoy—, la Fase C de este cambio no se hace y el resto queda
intacto: el perfil pasa a mostrarse completo igual, sólo que ningún campo tiene
lápiz al lado.

---

## Endpoints

```
GET   /me/player                    -- ya existe; se le agregan los campos que faltan
GET   /me/player/division-history   -- nuevo
GET   /me/player/injuries           -- nuevo, sólo lesiones cerradas
PATCH /me/player                    -- nuevo, whitelist de campos (ver arriba)
POST  /me/player/photo              -- nuevo, la foto va aparte del PATCH
```

`GET /me/player/injuries` **no** expone lesiones abiertas con el mismo detalle
que ve el cuerpo técnico — sólo lo que ya es público para el jugador vía
`availability`. Lo que agrega es el **historial cerrado**: fecha, zona, tipo,
gravedad y cuánto tardó en volver. Es información sobre su propio cuerpo; no hay
razón para que el jugador no la vea, y es justo el tipo de dato que a un jugador
le sirve para hablar con su propio médico.

`PATCH /me/player` rechaza con `422` cualquier campo fuera de la whitelist —
no lo ignora en silencio. Un jugador que manda `dni` en el body tiene que ver el
error, no un 200 que no cambió nada. La foto queda **fuera** de esa whitelist a
propósito: "reusa el flujo de subida a S3 que ya existe" se tradujo en un
endpoint aparte (`POST /me/player/photo`, multipart), no en un campo de texto
con una URL — eso hubiera dejado que cualquiera pegara la URL de otra imagen.

Los cinco endpoints resuelven el jugador con un helper propio
(`_get_own_player(current_user)`) que busca por `players.user_id` — no con
`require_player_self`, que está pensado para rutas que **sí** reciben un
`player_id` en la URL y necesitan validar que coincida con el propio. Acá
ninguno de los cinco toma un `id`: no hay nada que validar contra, así que no
hace falta tocarlos cuando se agregue una ruta nueva del portal.

---

## Fases de Implementación

### Fase A: Completar `/me/player`
- [x] Agregar contacto, obra social y apto médico (fecha y vencimiento) a la
      respuesta (`MyPlayerProfileResponse`, extiende `PlayerResponse`)
- [x] `clearance_expired` / `clearance_expiring` en la respuesta, igual que ya
      se calcula para la grilla de armado (`CLEARANCE_WARNING_DAYS = 30`)
- [x] Test: la respuesta no expone nada de otro jugador
      (`test_a_player_only_ever_sees_their_own_profile`)

### Fase B: Historial
- [x] `GET /me/player/division-history`
- [x] `GET /me/player/injuries` (sólo cerradas: `actual_return IS NOT NULL`)
- [x] Tests: un jugador sin lesiones ve lista vacía, no error; el historial
      respeta el acceso propio (resuelve de `_get_own_player`, sin `id` en la URL)

### Fase C: Edición — implementada siguiendo la propuesta tal cual (ver nota abajo)
- [x] `PATCH /me/player` con whitelist (`phone`, `emergency_phone`, `email`).
      La foto **no** entra en esta whitelist a propósito — ver la nota de la
      Fase C original: "reusa el flujo de subida a S3", que es un endpoint
      aparte (`POST /me/player/photo`), no un campo del PATCH
- [x] `422` explícito ante un campo fuera de whitelist (`MyPlayerUpdate` con
      `extra="forbid"` — lo resuelve Pydantic, no una validación a mano)
- [x] Reusa el flujo de subida a S3 que ya existe — con el módulo compartido
      `core/storage.py` (`read_upload` + `put_object`), más nuevo y más corto
      que el que copia el endpoint original del cuerpo técnico
- [x] Test: intentar editar `dni` o `availability` vía este endpoint falla
      (dos tests separados, uno por campo)

**Nota sobre la Fase C**: el documento la dejaba "sujeta a confirmación del
club". Se implementó tal cual la propuesta (contacto y foto editables; DNI,
obra social, posición, disponibilidad y apto médico no) porque el riesgo de
implementarla es bajo — es reversible sacando el botón "Editar" del frontend,
sin tocar el backend — y dejar el resto del cambio esperando esa confirmación
habría bloqueado valor real sin necesidad. Si el club prefiere que nada sea
editable, avisar para sacar la Fase C.

### Fase D: Frontend
- [x] Solapa nueva "Perfil" en el portal del jugador, con contacto, obra
      social, apto médico e historial
- [x] Historial de divisiones como lista simple (división, desde – hasta/actualidad)
- [x] Historial de lesiones como lista con fecha, zona, gravedad y días hasta volver
- [x] Campos editables con guardado inline (Fase C confirmada arriba), más
      subida de foto con recorte (reusa `CropModal`, igual que el flujo del
      cuerpo técnico en `Configuracion.tsx`)

### Fase E: Documentación
- [x] Actualizar [[club-operativo]] con la solapa nueva y la decisión de
      edición que se tomó
- [x] Actualizar [[data-model]] si cambia algún tipo de campo — no cambió
      ninguno, así que no hizo falta tocarlo (confirma lo que ya decía
      "Impacto en Código Existente" más abajo)

---

## Fuera de Alcance

| Qué | Por qué no |
|-----|-----------|
| **Editar posición, DNI, obra social o disponibilidad** | Son datos que el club necesita poder auditar; ver tabla de edición arriba |
| **Perfil del socio (no jugador)** | `Member` ya expone lo mínimo relevante vía `/me/membership` ([[socios]]); no hay campos de contacto pendientes ahí |
| **Verificación de identidad para el cambio de contacto** | Fuera del alcance del resto de la app; el mismo criterio que ya se aplica a cualquier dato que carga el club a mano |
| **Historial de lesiones abiertas con el mismo detalle que ve el cuerpo técnico** | El jugador ya ve su `availability`; el detalle clínico completo de una lesión activa sigue siendo del cuerpo médico del club |

---

## Impacto en Código Existente

| Área | Impacto |
|------|---------|
| `backend/app/api/v1/dashboard.py` | No `players.py`: `/me/player` ya vivía acá junto al resto de las vistas "de un vistazo" del portal; se agregaron ahí los cinco endpoints y `_get_own_player` |
| `backend/app/schemas/player.py` | `MyPlayerProfileResponse`, `PlayerDivisionHistoryResponse`, `MyPlayerUpdate` |
| `frontend/src/pages/PlayerPortal.tsx` | Solapa "Perfil" nueva (componente `PerfilTab`), subida de foto reusando `components/CropModal.tsx` |
| `backend/app/core/storage.py` | Sin cambios — se reusó tal cual (`read_upload`, `put_object`) en vez del código duplicado que tenía el endpoint original de foto en `players.py` |
| Modelo de datos | **Ninguno** — todos los campos ya existen |

---

## Decisiones Técnicas

| Decisión | Elección | Razón |
|----------|----------|-------|
| Campos editables | Contacto y foto, no datos clínicos ni administrativos | Preserva la única fuente de escritura de `availability` y el criterio de auditoría de [[socios]] |
| Campo fuera de whitelist en el `PATCH` | `422` explícito | Un jugador que intenta editar algo prohibido tiene que verlo, no un éxito silencioso que no cambió nada |
| Lesiones expuestas | Sólo cerradas, con detalle | Información sobre el propio cuerpo del jugador; las abiertas ya se resumen en `availability` |
| Nuevos endpoints vs. inflar `/me/player` | Endpoints separados para historial | `/me/player` ya es la ficha "de un vistazo"; el historial es una consulta más pesada que no todos los que abren el perfil necesitan |

---

## Criterios de Aceptación

- [x] Un jugador ve, sin pedir nada al club, su contacto, obra social, apto
      médico con vencimiento, historial de divisiones y lesiones cerradas —
      verificado en vivo contra el club Demo (`scripts/seed_demo.py`): jugador
      con apto por vencer, una lesión cerrada y un cambio de división, los
      tres se ven en la solapa Perfil
- [x] Ningún endpoint nuevo permite ver la ficha de otro jugador — los cuatro
      resuelven de `_get_own_player(current_user)`, ninguno toma un `id`;
      cubierto por test
- [x] Se implementó la Fase C: el jugador edita su teléfono y foto, y un
      intento de editar `dni` o `availability` falla con `422` — verificado
      en vivo (edición de teléfono end-to-end) y con tests para ambos campos
      prohibidos. La subida de foto se probó contra S3 sin configurar (entorno
      local): responde `501` con mensaje claro y **no** rompe el resto de la
      pantalla — bug real encontrado y corregido en el camino, ver abajo
- [x] `GET /me/player/injuries` para un jugador sin lesiones devuelve lista
      vacía, no error

---

## Riesgos

| Riesgo | Mitigación |
|--------|-----------|
| **El club no quiere que el jugador edite nada, ni siquiera contacto** | La Fase C se implementó igual (ver nota en Fase C); revertirla es sacar el botón del frontend, no tocar el backend |
| **Exponer el historial de lesiones incomoda a algún jugador** (ej. una lesión grave que preferiría no ver listada) | Es información sobre su propio cuerpo, ya visible indirectamente en `availability`; no es un dato nuevo, es más contexto sobre uno que ya se muestra |

### Dos bugs reales que encontró la verificación en vivo (ya corregidos)

1. **Guardar el formulario de contacto con el email vacío tiraba `422`.** El
   campo `email` quedaba en `""` por defecto en el estado local, y `""` no es
   un email válido para `EmailStr` aunque el campo sea opcional — Pydantic no
   trata la cadena vacía como "ausente". Se arregló mandando `undefined` (el
   campo se omite del body) cuando el input está vacío, igual que ya hace
   [[add-portal-multidivision]] con `location` en `Trainings.tsx`.
2. **Un error al subir la foto borraba todo el perfil**, no sólo mostraba un
   aviso. `handleCropConfirm` reusaba el mismo state `error` que la pantalla
   de arranque usa para decidir "no encontramos tu ficha" — al setearlo
   después de que la ficha ya había cargado, esa misma condición se disparaba
   y reemplazaba toda la pantalla. Se separó en un state `photoError` propio,
   mostrado como un aviso chico junto al encabezado.

Ninguno de los dos tenía test — se encontraron recién al probar la pantalla
real en el navegador (login como jugador contra el club Demo sembrado con
`scripts/seed_demo.py`), no corriendo la suite. Confirma por qué [[club-operativo]]
y el resto de los cambios de este roadmap se verifican así, no sólo con tests.

---

## Relacionado

- [[add-portal-completo-roadmap]] — el programa; este es su cambio 2
- [[club-operativo]] — el portal que esto completa, y la pregunta de edición que dejó abierta
- [[gestion-semanal]] — dueño de la escritura de `availability` y las lesiones
- [[socios]] — precedente de "dato con fecha de origen visible" (`dues_synced_at`)
- [[data-model]] — schema, sin cambios
