---
title: Perfil completo del jugador
type: feature
status: proposed
spec: club-operativo
created: 2026-07-29
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
```

`GET /me/player/injuries` **no** expone lesiones abiertas con el mismo detalle
que ve el cuerpo técnico — sólo lo que ya es público para el jugador vía
`availability`. Lo que agrega es el **historial cerrado**: fecha, zona, tipo,
gravedad y cuánto tardó en volver. Es información sobre su propio cuerpo; no hay
razón para que el jugador no la vea, y es justo el tipo de dato que a un jugador
le sirve para hablar con su propio médico.

`PATCH /me/player` rechaza con `422` cualquier campo fuera de la whitelist —
no lo ignora en silencio. Un jugador que manda `dni` en el body tiene que ver el
error, no un 200 que no cambió nada.

Los tres endpoints de lectura reusan `require_player_self`
([[club-operativo]]): no reciben `id`, resuelven del token, y no hace falta
tocarlos cuando se agregue una ruta nueva del portal.

---

## Fases de Implementación

### Fase A: Completar `/me/player`
- [ ] Agregar contacto, obra social y apto médico (fecha y vencimiento) a la
      respuesta
- [ ] `clearance_expired` / `clearance_expiring` en la respuesta, igual que ya
      se calcula para la grilla de armado
- [ ] Test: la respuesta no expone nada de otro jugador

### Fase B: Historial
- [ ] `GET /me/player/division-history`
- [ ] `GET /me/player/injuries` (sólo cerradas: `actual_return IS NOT NULL`)
- [ ] Tests: un jugador sin lesiones ve lista vacía, no error; el historial
      respeta `require_player_self`

### Fase C: Edición (sujeta a confirmación del club, ver arriba)
- [ ] `PATCH /me/player` con whitelist (`phone`, `emergency_phone`, `email`,
      `profile_photo_url`)
- [ ] `422` explícito ante un campo fuera de whitelist
- [ ] Reusa el flujo de subida a S3 que ya existe para la foto (el que usa el
      cuerpo técnico al cargar un jugador)
- [ ] Test: intentar editar `dni` o `availability` vía este endpoint falla

### Fase D: Frontend
- [ ] Solapa nueva "Perfil" (o sección al final de "Resumen") con contacto,
      obra social, apto médico e historial
- [ ] Historial de divisiones como línea de tiempo simple
- [ ] Historial de lesiones como lista con fecha y duración
- [ ] Si la Fase C se confirma: campos editables con guardado inline

### Fase E: Documentación
- [ ] Actualizar [[club-operativo]] con la solapa nueva y la decisión de
      edición que se haya tomado
- [ ] Actualizar [[data-model]] si cambia algún tipo de campo

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
| `backend/app/api/v1/players.py` | Extiende `/me/player`, agrega dos endpoints de historial y el `PATCH` |
| `backend/app/schemas/player.py` | Campos nuevos en la respuesta, schema de whitelist para el `PATCH` |
| `frontend/src/pages/PlayerPortal.tsx` (o equivalente) | Solapa/sección nueva |
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

- [ ] Un jugador ve, sin pedir nada al club, su contacto, obra social, apto
      médico con vencimiento, historial de divisiones y lesiones cerradas
- [ ] Ningún endpoint nuevo permite ver la ficha de otro jugador
- [ ] Si se implementa la Fase C: el jugador edita su teléfono y foto, y un
      intento de editar `dni` o `availability` falla con `422`
- [ ] `GET /me/player/injuries` para un jugador sin lesiones devuelve lista
      vacía, no error

---

## Riesgos

| Riesgo | Mitigación |
|--------|-----------|
| **El club no quiere que el jugador edite nada, ni siquiera contacto** | La Fase C es opcional y está señalada como tal; el resto del cambio no depende de ella |
| **Exponer el historial de lesiones incomoda a algún jugador** (ej. una lesión grave que preferiría no ver listada) | Es información sobre su propio cuerpo, ya visible indirectamente en `availability`; no es un dato nuevo, es más contexto sobre uno que ya se muestra |

---

## Relacionado

- [[add-portal-completo-roadmap]] — el programa; este es su cambio 2
- [[club-operativo]] — el portal que esto completa, y la pregunta de edición que dejó abierta
- [[gestion-semanal]] — dueño de la escritura de `availability` y las lesiones
- [[socios]] — precedente de "dato con fecha de origen visible" (`dues_synced_at`)
- [[data-model]] — schema, sin cambios
