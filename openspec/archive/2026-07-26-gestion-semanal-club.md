---
title: Gestión semanal del club — asistencia, disponibilidad y armado de equipos
type: feature
status: completed
spec: gestion-semanal
created: 2026-07-26
completed: 2026-07-26
---

# Gestión semanal del club — asistencia, disponibilidad y armado de equipos

## Descripción del Cambio

Hoy el software cubre **el partido** con mucha profundidad (timer, eventos, stats,
resiliencia offline, importación UAR) y **el plantel** como ficha estática (datos, físico,
tests). Falta casi todo lo que pasa **entre partido y partido**: la semana del club.

En `backend/app/models/` no existe ninguna entidad de entrenamiento, asistencia, lesión,
disponibilidad ni convocatoria. `Session` cuelga siempre de un `tournament_id`, así que el
modelo actual no puede representar nada que no sea un partido de torneo.

Este cambio agrega esa capa: **entrenamientos con asistencia**, **disponibilidad real del
jugador** (apto médico, lesiones, suspensiones) y un **flujo de armado de equipo** que
reemplaza el actual, que exige 23 formularios y 23 requests para cargar un lineup.

> **Nota de alcance**: el relevamiento identificó más faltantes de los que entran en un
> cambio (calendario unificado, rival como entidad, tabla de posiciones, roles por
> división, cuotas). Esta propuesta implementa las Fases A–F y deja el resto documentado
> en *Fuera de Alcance*, cada uno como cambio futuro propio.

> **Numeración real de migraciones**: durante la implementación las Fases A, B, D y E
> tomaron una migración cada una — `0010` (camiseta única), `0011` (entrenamientos y
> asistencia), `0012` (convocatoria) y `0013` (disponibilidad y lesiones). El plan
> original las agrupaba distinto.

---

## Motivación

Tres cosas que un club necesita todas las semanas y hoy no puede hacer:

1. **Saber quién viene a entrenar.** Es el dato que más usa un entrenador y el único que
   permite detectar deserción antes de que el jugador ya se haya ido.
2. **Saber quién está disponible.** Hoy `Player` tiene solo `is_active` booleano. Lesionado,
   suspendido y sin apto médico son todos "activo".
3. **Armar el equipo sin sufrir.** El flujo actual de `SessionLineup.tsx` es el punto más
   doloroso del producto (ver Fase D).

El cruce entre 1 y el partido es lo que un club nunca puede hacer en papel y acá sale
casi gratis, porque los datos de partido ya están cargados.

---

## Fases de Implementación

### Fase A: Correcciones previas en lineup
Dos bugs encontrados en el relevamiento de `app/api/v1/lineup.py`. Van primero porque la
Fase D reescribe ese flujo y no conviene construir encima.

- [x] **Fuga multi-tenant en `add_to_lineup`**: se valida el club de la sesión, pero el
      jugador se busca solo por `id` + `is_active`, sin verificar que pertenezca al club
      del usuario. Con el UUID de un jugador ajeno se lo puede meter en un lineup propio.
      Validar que `player.division.club_id` coincida con el club de la sesión → `404`.
- [x] **Número de camiseta duplicado**: ni `add_to_lineup` ni `update_lineup_entry`
      chequean unicidad por `(session_id, team, jersey_number)`. Se pueden cargar dos `#10`
      y, como los eventos se asocian por `player_number`, eso ensucia las estadísticas sin
      avisar. Agregar constraint en DB + `409` con mensaje claro.
- [x] Tests de regresión para ambos casos

### Fase B: Entrenamientos y asistencia
- [x] Migración `0010`: tablas `trainings` y `attendance` (esquema abajo)
- [x] Modelos `Training` y `Attendance` en `app/models/training.py`
- [x] `app/api/v1/trainings.py` con el CRUD de entrenamientos
- [x] `PUT /trainings/{id}/attendance` — **upsert bulk idempotente** de toda la lista
- [x] Pantalla `/trainings` — lista por división, filtro por rango de fechas, alta rápida
- [x] Pantalla `/trainings/:id/attendance` — lista de jugadores de la división, **todos en
      `presente` por defecto**, un tap para cambiar de estado. Sin formularios.
- [x] Integración con `lib/offlineQueue.ts`: la asistencia se toma en la cancha, sin señal
- [x] Ítem "Entrenamientos" en el nav de `Layout.tsx` para `club_admin` y `match_director`
- [x] Tests: backend (CRUD + upsert idempotente + aislamiento por club), frontend (toggle
      de estado, reenvío desde la cola)

### Fase C: Métricas derivadas de asistencia
El valor no es la lista, son los agregados.

- [x] `GET /divisions/{id}/attendance/summary?days=30` — % por jugador, ordenable
- [x] `GET /players/{id}/attendance` — histórico y racha del jugador
- [x] Solapa **Asistencia** en `PlayerProfile.tsx` (% 30/90 días/temporada + histórico)
- [x] Ranking de asistencia por división, visible en la pantalla de entrenamientos
- [x] **Alerta de deserción**: jugador con 3 ausencias consecutivas o < 50% en 30 días se
      marca "en riesgo" en el plantel
- [x] Asistencia promedio por división y por día de semana

### Fase D: Armado de equipo
El flujo actual exige, por cada jugador: buscar por nombre → tap → completar 4 campos
(número, posición, equipo, titular/suplente) → confirmar. **23 veces, con 23 POST
separados**, y sin forma de reusar nada de la fecha anterior.

- [x] Migración `0011`: tabla `match_squad` (convocatoria) + constraint de camiseta de Fase A
- [x] `PUT /sessions/{id}/lineup` — **bulk, reemplaza el lineup completo en una
      transacción**, valida numeración y duplicados antes de escribir
- [x] `GET /sessions/{id}/lineup/suggested?from=previous` — devuelve el lineup del último
      partido de la misma división, listo para editar
- [x] `POST /sessions/{id}/squad` — convocatoria: el entrenador marca ~25 durante la semana
- [x] Reescribir `SessionLineup.tsx` como **grilla de 23 casilleros**: los puestos 1–15 y
      16–23 ya dibujados con su posición (`positionByJersey`), tap en el casillero → picker
      filtrado por posición natural del jugador. Un solo guardado al final.
- [x] Botón **"Traer lineup de la última fecha"** que precarga los 23
- [x] Botón **"Copiar convocatoria"** → texto plano al portapapeles para pegar en WhatsApp
- [x] Dejar en la grilla el espacio para los chips de disponibilidad de Fase E
- [x] Tests: bulk transaccional, rechazo de numeración duplicada, precarga desde partido
      anterior

> **Dependencia**: la grilla luce mejor con los datos de Fase E (mostrar lesionados y
> jugadores sin apto en el picker). Se construye con el hueco reservado para no rehacer el
> componente cuando llegue.

### Fase E: Disponibilidad, apto médico y lesiones
- [x] Migración `0012`: columnas nuevas en `players` + tabla `player_injuries`
- [x] `GET/POST/PATCH /players/{id}/injuries`
- [x] `GET /divisions/{id}/availability` — estado de todo el plantel de un vistazo
- [x] Solapa **Lesiones** en `PlayerProfile.tsx`
- [x] Chips de disponibilidad en `Squad.tsx` y en el picker de la grilla de Fase D
- [x] **Alerta de apto médico**: aviso a 30 días de vencer y advertencia al convocar a un
      jugador con el apto vencido (advertencia, no bloqueo — la decisión es del club)
- [x] Suspensión automática sugerida al registrar una tarjeta roja (el evento ya existe)

### Fase F: Minutos jugados y acumulados por jugador
Sin modelo nuevo: los datos ya están en `match_lineup` + eventos de sustitución + timer.

- [x] `GET /players/{id}/season-stats` — partidos, minutos, tries, tackles, tarjetas
- [x] `GET /divisions/{id}/minutes?tournament_id=` — carga de trabajo del plantel
- [x] Solapa de temporada en `PlayerProfile.tsx`
- [x] **Cruce asistencia ↔ minutos**: señalar jugadores con muchos minutos y poca asistencia
- [x] Tests de cálculo de minutos con sustituciones, tarjetas amarillas y segundo tiempo

### Fase G: Documentación
- [x] `openspec/specs/gestion-semanal.md` con el comportamiento definitivo
- [x] Actualizar `openspec/specs/data-model.md` con las tablas nuevas
- [x] Actualizar `README.md`: funcionalidades, API principal y roles

---

## Modelo de Datos Nuevo

```sql
trainings
  id            UUID PK
  club_id       UUID FK → clubs.id
  division_id   UUID FK → divisions.id
  date          DATE NOT NULL
  type          ENUM('entrenamiento','gimnasio','fisico','amistoso','otro')
  notes         TEXT
  created_by    UUID FK → users.id
  created_at    TIMESTAMP
```

```sql
attendance
  id            UUID PK
  training_id   UUID FK → trainings.id ON DELETE CASCADE
  player_id     UUID FK → players.id
  status        ENUM('presente','ausente','justificado','lesionado','tarde')
  notes         VARCHAR(200)
  recorded_by   UUID FK → users.id
  recorded_at   TIMESTAMP
  UNIQUE (training_id, player_id)   -- habilita el upsert idempotente
```

```sql
match_squad                          -- convocatoria, paso previo al lineup
  id            UUID PK
  session_id    UUID FK → sessions.id ON DELETE CASCADE
  player_id     UUID FK → players.id
  status        ENUM('convocado','confirmado','baja')
  created_at    TIMESTAMP
  UNIQUE (session_id, player_id)
```

```sql
player_injuries
  id                UUID PK
  player_id         UUID FK → players.id
  injury_date       DATE NOT NULL
  body_zone         VARCHAR(50)
  injury_type       VARCHAR(50)
  severity          ENUM('leve','moderada','grave')
  expected_return   DATE
  actual_return     DATE
  notes             TEXT
  recorded_by       UUID FK → users.id
  created_at        TIMESTAMP
```

```sql
players                              -- columnas nuevas
+ availability                ENUM('disponible','lesionado','suspendido','baja_temporal')
                              NOT NULL DEFAULT 'disponible'
+ medical_clearance_date      DATE
+ medical_clearance_expires   DATE
```

```sql
match_lineup                         -- constraint nuevo (Fase A)
+ UNIQUE (session_id, team, jersey_number)
```

---

## API Nueva

| Método | Ruta | Descripción | Acceso |
|--------|------|-------------|--------|
| POST/GET | `/divisions/{id}/trainings` | Entrenamientos de la división | match_director+ |
| PATCH/DELETE | `/trainings/{id}` | Editar / eliminar entrenamiento | match_director+ |
| PUT | `/trainings/{id}/attendance` | Upsert bulk de asistencia | analyst+ |
| GET | `/divisions/{id}/attendance/summary` | % de asistencia por jugador | analyst+ |
| GET | `/players/{id}/attendance` | Histórico y racha | analyst+ |
| PUT | `/sessions/{id}/lineup` | Reemplazo bulk del lineup | club_admin |
| GET | `/sessions/{id}/lineup/suggested` | Lineup del partido anterior | club_admin |
| POST/GET | `/sessions/{id}/squad` | Convocatoria | club_admin |
| GET/POST | `/players/{id}/injuries` | Lesiones | analyst+ |
| GET | `/divisions/{id}/availability` | Disponibilidad del plantel | analyst+ |
| GET | `/players/{id}/season-stats` | Acumulados de temporada | analyst+ |
| GET | `/divisions/{id}/minutes` | Minutos jugados del plantel | analyst+ |

---

## Fuera de Alcance

Documentado, no implementado. Cada uno es un cambio futuro.

| Faltante | Por qué importa | Costo |
|----------|-----------------|-------|
| **Calendario unificado del club** | `scheduled_at` existe pero no hay agenda; con entrenamientos cargados tiene sentido una vista única por división | Medio |
| **Rival como entidad** | `home_team`/`away_team` son strings libres, así que el análisis histórico contra un mismo rival es imposible | Medio |
| **Tabla de posiciones del torneo** | El torneo tiene partidos pero no resultados acumulados | Medio |
| **Roles con alcance por división** | Gap arquitectónico: editar lineup exige `require_club_admin`, que da acceso a **todo el club**. El entrenador de M17 no debería administrar Plantel Superior | Medio/alto |
| **Rol jugador / padre** | Autoconsulta de ficha, tests y asistencia. Hoy los 4 roles son de staff | Alto |
| **Datos de menores** | Con divisiones M14–M17 falta tutor responsable y consentimiento de imagen. Consideración legal | Bajo |
| **Cuotas y pagos** | Común en software de club, pero es otro dominio entero | Alto |
| **Categoría automática por año de nacimiento** | Los jugadores tienen DOB; validar que estén en la división que les corresponde | Bajo |
| **Notificaciones push / PWA instalable** | Convocatoria y recordatorio de entrenamiento | Medio |
| **Exportación total de datos del club** | El club es dueño de sus datos | Bajo |

---

## Impacto en Código Existente

| Área | Impacto |
|------|---------|
| `app/models/` | **Nuevo**: `training.py`, `injury.py`. **Modificado**: `player.py` (3 columnas + relaciones) |
| `app/api/v1/lineup.py` | **Reescrito parcialmente**: 2 fixes de seguridad + endpoint bulk + sugerido |
| `app/api/v1/` | **Nuevo**: `trainings.py`, `attendance.py`, `injuries.py` |
| `alembic/versions/` | 3 migraciones nuevas: `0010`, `0011`, `0012` |
| `SessionLineup.tsx` | **Reescrito** — de formulario por jugador a grilla de 23 |
| `PlayerProfile.tsx` | 2 solapas nuevas (Asistencia, Lesiones) + acumulados de temporada |
| `Squad.tsx` | Chips de disponibilidad y marca "en riesgo" |
| `Layout.tsx` | Ítem de nav nuevo (pasa de 4 a 5 en el bottom nav mobile) |
| `lib/offlineQueue.ts` | **Generalizado**: hoy es específico de eventos, tiene que aceptar asistencia |
| Datos existentes | **Ninguna pérdida** — todo lo nuevo es aditivo. `availability` arranca en `disponible` para todo el plantel |

**Regla dura**: el tablero de partido y el flujo de eventos no se tocan. Si al terminar
este cambio registrar un evento en cancha funciona distinto que antes, el cambio está mal
implementado.

---

## Decisiones Técnicas

| Decisión | Elección | Razón |
|----------|----------|-------|
| Asistencia por defecto | `presente` para todos | En un club normal la mayoría asiste; se marca la excepción, no la regla |
| Escritura de asistencia | `PUT` bulk de la lista completa | Un solo request por entrenamiento y, con el `UNIQUE`, idempotente ante reintentos de la cola offline |
| Reuso de la cola offline | Generalizar la existente, no crear otra | Ya resuelve backoff, persistencia y reenvío; duplicarla es deuda |
| `availability` en `players` | Columna desnormalizada | Es derivable de lesiones + suspensiones, pero la grilla de armado la consulta para 30 jugadores a la vez; se mantiene sincronizada desde los endpoints de lesión |
| Apto médico vencido | Advertencia, no bloqueo | El sistema informa; la responsabilidad reglamentaria es del club |
| Lineup bulk | `PUT` que reemplaza todo | Evita estados intermedios inválidos (dos #10 a mitad de carga) |
| Convocatoria separada del lineup | Tabla propia | Ocurren en momentos distintos de la semana y con distinta gente decidiendo |
| Minutos jugados | Calculado, no persistido | Los datos ya están; persistir sería una fuente de verdad duplicada |

---

## Criterios de Aceptación

- [x] Un `club_admin` crea un entrenamiento y toma asistencia de 30 jugadores en menos de
      un minuto, sin escribir nada
- [x] La asistencia tomada **sin señal** se envía sola al recuperar conectividad, y
      reenviarla dos veces no duplica registros
- [x] El perfil del jugador muestra su % de asistencia a 30, 90 días y temporada
- [x] Un jugador con 3 ausencias consecutivas aparece marcado "en riesgo" en el plantel
- [x] Cargar un lineup de 23 usando "traer de la última fecha" toma menos de 5 taps
- [x] El backend rechaza con `409` un lineup con dos jugadores del mismo equipo y número
- [x] Un `club_admin` **no** puede agregar a su lineup un jugador de otro club
- [x] Al convocar a un jugador lesionado o con apto vencido, la UI advierte antes de guardar
- [x] El perfil del jugador muestra minutos jugados y partidos de la temporada, calculados
      correctamente con sustituciones y segundo tiempo
- [x] El tablero de partido, el timer y el registro de eventos funcionan igual que antes
- [x] Migraciones `0010`–`0012` corren `upgrade` y `downgrade` limpio contra Postgres en CI
- [x] Suite de tests verde, con cobertura nueva para asistencia, lineup bulk y minutos

---

## Riesgos

| Riesgo | Mitigación |
|--------|-----------|
| La cola offline generalizada rompe el registro de eventos, que hoy funciona | Refactor con los tests de `offlineQueue.test.ts` verdes en todo momento; la generalización es aditiva |
| Reescribir `SessionLineup.tsx` rompe el lineup de un partido en curso | El endpoint viejo por jugador se mantiene hasta que la grilla esté probada en un partido real |
| El `UNIQUE` de camiseta falla al migrar si ya hay duplicados en producción | La migración detecta duplicados y los renumera antes de crear el índice, dejando log de lo que cambió |
| `availability` desnormalizada se desincroniza | Se escribe únicamente desde los endpoints de lesión/suspensión; test que verifica la sincronía |
| Scope creep hacia gestión administrativa (cuotas, socios) | Está en *Fuera de Alcance* como regla, no como preferencia |
| 5 ítems en el bottom nav mobile aprietan la pantalla | Validar en 360px antes de cerrar la Fase B; si no entra, agrupar Plantel/Físico/Entrenamientos |

---

## Resultado de la implementación

| Métrica | Antes | Después |
|---------|-------|---------|
| Tests backend | 99 | **153** |
| Tests frontend | 41 | **48** |
| Migraciones | `0009` | `0013` |

Verificado además fuera de la suite:

- `alembic upgrade head` y `downgrade base` contra Postgres 15 real, en ambas
  direcciones, limpio.
- La renumeración de camisetas duplicadas de `0010` probada con datos sembrados: el
  registro más viejo conserva el `#10`, el duplicado pasa a `#100`, el resto no se
  toca y el `UNIQUE` queda creado.

### Auditoría de cierre

Al revisar el cambio contra sus propios criterios de aceptación aparecieron **seis
items marcados como hechos que no lo estaban**. Se completaron antes de archivar:

| Faltaba | Estado |
|---------|--------|
| Chips de disponibilidad en el picker de la grilla y advertencia al guardar — criterio de aceptación explícito | Hecho: chip en el casillero y en el picker, `confirm` con el detalle antes de guardar |
| Marca "en riesgo" **en el plantel** (estaba sólo en la pantalla de asistencia) | Hecho: `Squad.tsx` consulta el summary de la división visible |
| UI de convocatoria — `PUT/GET /sessions/{id}/squad` no lo llamaba nadie | Hecho: modo Convocatoria en el lineup; los convocados salen primero en el picker |
| Sugerencia de suspensión por tarjeta roja | Hecho: `GET /divisions/{id}/suspension-candidates` + aviso en la pantalla de asistencia |
| Asistencia promedio por día de semana | Hecho: `by_weekday` en el summary + barras en la UI |
| Cruce asistencia ↔ minutos — el dato que más se vendió en el relevamiento | Hecho: aviso en la solapa Temporada cuando juega y no entrena |

La lección para el próximo cambio: marcar los checkboxes en lote al final no es
verificar. Cada criterio se contrasta contra el código.

### Desvíos del plan

Dos, ambos por algo que apareció al implementar:

1. **`PUT /sessions/{id}/lineup` rechaza el partido ya empezado** (`409`). No estaba
   en la propuesta: con el partido en curso hay jugadores en `substituted_out` y el
   reemplazo masivo borraría el registro de quién entró y salió. La grilla se apaga
   sola en ese estado.
2. **El perfil del jugador quedó con 6 solapas** y la tira pasó a scrollear. Repartidas
   a 360px no entraban. Asistencia y minutos se unieron en **Temporada**, que además
   es mejor información: las dos mitades del año del jugador en una pantalla.

## Relacionado

- [[gestion-semanal]] — spec del comportamiento implementado
- [[data-model]] — schema actual, que este cambio extiende
- [[offline-resilience]] — cola offline que se generaliza para asistencia
- [[match-session]] — lineup y sustituciones, que la Fase D reescribe
- [[auth-and-users]] — roles actuales; el alcance por división queda fuera de este cambio
- [[statistics-screens]] — stats por partido, que la Fase F extiende a temporada
