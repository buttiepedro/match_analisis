---
title: Modelo de Datos
status: active
created: 2026-05-29
updated: 2026-07-26
---

# Modelo de Datos

> Este documento refleja el schema **realmente implementado** en
> `backend/app/models/` y `backend/alembic/versions/` (migración `0013`).

## Entidades Principales

### Club
```sql
clubs
  id            UUID PK
  name          VARCHAR(100) NOT NULL
  slug          VARCHAR(50) UNIQUE NOT NULL
  is_active     BOOLEAN DEFAULT TRUE
  created_at    TIMESTAMP
  updated_at    TIMESTAMP
```

### User
```sql
users
  id            UUID PK
  club_id       UUID FK → clubs.id (NULL para superadmin)
  email         VARCHAR(255) UNIQUE NOT NULL
  password_hash VARCHAR NOT NULL
  full_name     VARCHAR(100) NOT NULL
  role          ENUM('superadmin', 'club_admin', 'match_director', 'analyst')
  is_active     BOOLEAN DEFAULT TRUE
  created_at    TIMESTAMP
  updated_at    TIMESTAMP
```

### Division
```sql
divisions
  id            UUID PK
  club_id       UUID FK → clubs.id
  name          VARCHAR(100) NOT NULL  -- ej: "M17", "Primera", "Femenino"
  is_active     BOOLEAN DEFAULT TRUE   -- baja lógica
  created_at    TIMESTAMP
```

### Tournament
```sql
tournaments
  id            UUID PK
  club_id       UUID FK → clubs.id
  division_id   UUID FK → divisions.id
  name          VARCHAR(100) NOT NULL  -- ej: "Torneo Apertura 2026"
  season        VARCHAR(20)            -- ej: "2026"
  is_active     BOOLEAN DEFAULT TRUE   -- baja lógica
  created_at    TIMESTAMP
  updated_at    TIMESTAMP
```

### Session (Partido)
```sql
sessions
  id              UUID PK
  tournament_id   UUID FK → tournaments.id
  home_team       VARCHAR(100) NOT NULL   -- club del usuario
  away_team       VARCHAR(100) NOT NULL   -- rival
  scheduled_at    TIMESTAMP
  status          ENUM('scheduled', 'active', 'halftime', 'finished')
  half_duration_minutes INT DEFAULT 40    -- tiempo reglamentario por período
  created_by      UUID FK → users.id
  created_at      TIMESTAMP
  updated_at      TIMESTAMP
```

### TimerState
```sql
timer_states
  id              UUID PK
  session_id      UUID FK → sessions.id UNIQUE
  current_half    SMALLINT DEFAULT 1     -- 1 o 2
  status          ENUM('stopped', 'running', 'paused', 'halftime', 'finished')
  elapsed_seconds INT DEFAULT 0          -- acumulado del período actual
  started_at      TIMESTAMP NULL         -- último start/resume
  updated_at      TIMESTAMP
```
> El tiempo vivo es `elapsed_seconds + (NOW() - started_at)` mientras `status = 'running'`.
> El timer autoritativo vive en memoria del proceso (`app/ws/manager.py`) y se persiste
> en esta tabla en cada transición, de modo que sobreviva a un reinicio del backend.

### Event (Evento de partido)
```sql
events
  id              UUID PK
  session_id      UUID FK → sessions.id
  event_type      VARCHAR(50) NOT NULL
  half            SMALLINT NOT NULL       -- 1 o 2
  timer_seconds   INT NOT NULL            -- tiempo de partido del hecho
  team            ENUM('user', 'rival') NOT NULL
  player_id       UUID FK → players.id NULL
  player_number   SMALLINT NULL           -- se copia del lineup al registrar
  reason          VARCHAR(50) NULL
  metadata        JSONB DEFAULT '{}'
  recorded_by     UUID FK → users.id
  recorded_at     TIMESTAMP DEFAULT NOW() -- auditoría, en UTC
```
> `timer_seconds` / `half` describen **cuándo pasó en el partido**; `recorded_at`
> describe **cuándo llegó al servidor**. Se separan porque un evento registrado sin
> conexión puede enviarse minutos después (ver [[offline-resilience]]).

### RefreshToken
```sql
refresh_tokens
  id          UUID PK
  user_id     UUID FK → users.id
  token_hash  VARCHAR NOT NULL   -- SHA-256 del token, nunca el token en claro
  expires_at  TIMESTAMP NOT NULL
  revoked     BOOLEAN DEFAULT FALSE
  created_at  TIMESTAMP
```

---

## Plantel

### Player
```sql
players
  id                 UUID PK
  division_id        UUID FK → divisions.id   -- división actual (no hay club_id:
                                              -- el club se deriva de la división)
  name               VARCHAR(100) NOT NULL
  position           VARCHAR(50)
  dni                VARCHAR(20)
  date_of_birth      DATE                     -- alimenta el cálculo de % graso
  sex                VARCHAR(1)               -- 'M' | 'F'
  email              VARCHAR(100)
  phone              VARCHAR(30)
  emergency_phone    VARCHAR(30)
  obra_social        VARCHAR(100)
  profile_photo_url  VARCHAR(300)             -- S3
  is_active          BOOLEAN DEFAULT TRUE     -- baja lógica
  availability       ENUM('disponible', 'lesionado', 'suspendido', 'baja_temporal')
                                              -- desnormalizado: lo escriben sólo
                                              -- los endpoints de lesión
  medical_clearance_date     DATE
  medical_clearance_expires  DATE             -- apto médico; avisa a 30 días
  created_at         TIMESTAMP
```
> El número de camiseta **no** vive en `players`: es por partido y está en `match_lineup`.

### MatchLineup
```sql
match_lineup
  id             UUID PK
  session_id     UUID FK → sessions.id
  player_id      UUID FK → players.id
  jersey_number  SMALLINT NOT NULL
  position       VARCHAR(50)
  team           VARCHAR(10) DEFAULT 'user'   -- 'user' | 'rival'
  status         ENUM('on_field', 'bench', 'substituted_out')
  created_at     TIMESTAMP
  updated_at     TIMESTAMP

  UNIQUE (session_id, team, jersey_number)
```
> El `UNIQUE` no es cosmético: los eventos se asocian al jugador por
> `player_number`, así que dos camisetas iguales en un equipo atribuyen mal las
> estadísticas sin avisar. El mismo número **sí** puede repetirse entre rivales.

### MatchSquad (Convocatoria)
```sql
match_squad
  id          UUID PK
  session_id  UUID FK → sessions.id  ON DELETE CASCADE
  player_id   UUID FK → players.id
  status      ENUM('convocado', 'confirmado', 'baja')
  created_at  TIMESTAMP

  UNIQUE (session_id, player_id)
```
> Paso de la semana, previo al lineup: el entrenador convoca ~25 y el sábado salen
> 23. Vive aparte de `match_lineup` porque ocurren en momentos distintos.

### Training (Entrenamiento)
```sql
trainings
  id           UUID PK
  club_id      UUID FK → clubs.id
  division_id  UUID FK → divisions.id
  date         DATE NOT NULL
  type         ENUM('entrenamiento', 'gimnasio', 'fisico', 'amistoso', 'otro')
  notes        TEXT
  location     VARCHAR(150)              -- "Cancha 2", nullable, texto libre
  created_by   UUID FK → users.id
  created_at   TIMESTAMP

  INDEX (division_id, date)
```
> `location` (migración `0023`): texto libre porque el club nombra sus lugares
> como quiere, nullable porque una migración no puede completar el historial de
> entrenamientos que ya existen. Ver [[add-portal-multidivision]].

### Attendance (Asistencia)
```sql
attendance
  id           UUID PK
  training_id  UUID FK → trainings.id  ON DELETE CASCADE
  player_id    UUID FK → players.id
  status       ENUM('presente', 'ausente', 'justificado', 'lesionado', 'tarde')
  notes        VARCHAR(200)
  recorded_by  UUID FK → users.id
  recorded_at  TIMESTAMP

  UNIQUE (training_id, player_id)
```
> El `UNIQUE` habilita el upsert idempotente: la cola offline reenvía la planilla
> sin coordinación y no debe duplicar nada. `presente` y `tarde` cuentan como
> asistencia efectiva.

### PlayerInjury (Lesión)
```sql
player_injuries
  id               UUID PK
  player_id        UUID FK → players.id
  injury_date      DATE NOT NULL
  body_zone        VARCHAR(50)
  injury_type      VARCHAR(50)
  severity         ENUM('leve', 'moderada', 'grave')
  expected_return  DATE
  actual_return    DATE          -- cargada = lesión cerrada
  notes            TEXT
  recorded_by      UUID FK → users.id
  created_at       TIMESTAMP

  INDEX (player_id)
```
> `actual_return NULL` es lo que define una lesión activa, y de eso se deriva
> `players.availability`.

### PlayerDivisionHistory
```sql
player_division_history
  id           UUID PK
  player_id    UUID FK → players.id
  division_id  UUID FK → divisions.id
  from_date    DATE NOT NULL
  to_date      DATE NULL   -- NULL = división actual
  moved_by     UUID FK → users.id
  created_at   TIMESTAMP
```

### PlayerMeasurement
```sql
player_measurements
  id                      UUID PK
  player_id               UUID FK → players.id
  measured_at             DATE NOT NULL
  weight_kg               DECIMAL(5,2)
  height_cm               DECIMAL(5,1)
  bmi                     DECIMAL(4,2)   -- calculado en el backend
  fat_fold_tricep_mm      DECIMAL(4,1)
  fat_fold_subscapular_mm DECIMAL(4,1)
  fat_fold_suprailiac_mm  DECIMAL(4,1)
  fat_fold_abdominal_mm   DECIMAL(4,1)
  fat_fold_biceps_mm      DECIMAL(4,1)   -- pliegue canónico de Durnin-Womersley
  body_fat_percent        DECIMAL(4,1)   -- calculado en el backend
  body_fat_method         VARCHAR(30)    -- ver abajo
  notes                   TEXT
  recorded_by             UUID FK → users.id
  created_at              TIMESTAMP
```

**`body_fat_method`** deja registro de cómo se calculó cada medición, con formato
`<juego de pliegues>/<sexo>/<banda etaria>` — por ejemplo `dw4c/F/20-29`:

| Parte | Valores | Significado |
|-------|---------|-------------|
| juego | `dw4c` | 4 pliegues canónicos: bíceps, tríceps, subescapular, suprailíaco |
| juego | `dw4a` | abdominal en lugar de bíceps (el bicipital no se cargó) |
| sexo | `M` / `F` | coeficientes de Durnin-Womersley aplicados |
| banda | `<17`, `17-19`, `20-29`, `30-39`, `40-49`, `50+` | banda etaria a la fecha de la medición |

Un `*` marca un dato **asumido** por ficha incompleta: `dw4a/M*/20-29*` significa que
el jugador no tenía sexo ni fecha de nacimiento cargados. Series con distinto juego de
pliegues no son comparables entre sí.

### PhysicalTest
```sql
physical_tests
  id          UUID PK
  player_id   UUID FK → players.id
  test_date   DATE NOT NULL
  test_type   VARCHAR(50) NOT NULL   -- catálogo en app/schemas/measurement.py
  value       DECIMAL(8,3) NOT NULL
  unit        VARCHAR(20) NOT NULL   -- 'seconds' | 'kg' | 'cm' | 'm' | 'ml_kg_min'
  notes       TEXT
  recorded_by UUID FK → users.id
  created_at  TIMESTAMP
```

### NotificationDevice
```sql
notification_devices
  id             UUID PK
  user_id        UUID FK → users.id
  channel        ENUM('web_push', 'fcm', 'apns')
  endpoint       TEXT NOT NULL        -- URL de push (web) o token (nativo)
  p256dh         VARCHAR(255)         -- clave pública de la suscripción, sólo web_push
  auth_secret    VARCHAR(255)         -- sólo web_push
  is_active      BOOLEAN DEFAULT TRUE
  last_seen_at   TIMESTAMP
  created_at     TIMESTAMP

  UNIQUE (user_id, endpoint)
```

### Notification
```sql
notifications
  id          UUID PK
  club_id     UUID FK → clubs.id
  user_id     UUID FK → users.id
  type        VARCHAR(50) NOT NULL   -- catálogo en app/models/notification.py
  title       VARCHAR(150) NOT NULL
  body        VARCHAR(300) NOT NULL
  data        JSON DEFAULT '{}'      -- ej. {"session_id": "...", "url": "..."} para deep link
  read_at     TIMESTAMP NULL
  created_at  TIMESTAMP

  INDEX (user_id, created_at)
```

### NotificationPreference
```sql
notification_preferences
  id          UUID PK
  user_id     UUID FK → users.id
  type        VARCHAR(50) NOT NULL
  enabled     BOOLEAN DEFAULT TRUE

  UNIQUE (user_id, type)
```
> Sin fila = habilitado. Ver [[notificaciones]].

### NutritionSlot
```sql
nutrition_slots
  id                UUID PK
  club_id           UUID FK → clubs.id
  nutritionist_id   UUID FK → users.id
  starts_at         TIMESTAMP NOT NULL
  ends_at           TIMESTAMP NOT NULL
  status            ENUM('libre', 'reservado', 'cancelado') DEFAULT 'libre'
  player_id         UUID FK → players.id NULL   -- quién reservó
  notes             VARCHAR(300) NULL           -- motivo de la consulta
  booked_at         TIMESTAMP NULL
  cancelled_by      UUID FK → users.id NULL
  cancelled_at      TIMESTAMP NULL
  reminder_sent_at  TIMESTAMP NULL              -- se escribe después de notificar
  created_at        TIMESTAMP

  INDEX (club_id, starts_at)
  INDEX (nutritionist_id, starts_at)
```
> Un horario y una reserva son el mismo registro en distinto `status`. Ver
> [[turnos-nutricion]].

---

## Catálogo de Tipos de Evento (`event_type`)

### Juego — ataque
| Valor | Descripción |
|-------|-------------|
| `line_break` | Quiebre |
| `offload` | Offload |
| `possession_lost` | Perdida (con `reason`) |

### Juego — defensa
| Valor | Descripción |
|-------|-------------|
| `tackle_effective` | Tackle concretado |
| `tackle_missed` | Tackle errado |
| `tackle_positive` | Tackle positivo |
| `ball_won` | Pelota ganada (con `reason`) |

`reason` para `possession_lost` / `ball_won`: `ruck`, `maul`, `contacto`, `pesca`,
`patada`, `knock_on`.

### Anotaciones
| Valor | Descripción | Puntos |
|-------|-------------|--------|
| `try` | Try — `metadata.converted` indica la conversión | 5 (+2) |
| `penalty` | Penal — `reason`: `line`, `scrum`, `juega`, `a_los_palos` | 3 sólo si `a_los_palos` y `metadata.converted` |
| `drop` | Drop | 3 |

### Formaciones fijas
| Valor | Descripción |
|-------|-------------|
| `lineout_favor` / `lineout_against` | Line-out a favor / en contra |
| `scrum_favor` / `scrum_against` | Scrum a favor / en contra |
| `exit_favor` / `exit_against` | Salida a favor / en contra |

Todas llevan `metadata.obtained` (booleano) indicando obtención del balón.

### Disciplina y cambios
| Valor | Descripción |
|-------|-------------|
| `yellow_card` | Tarjeta amarilla |
| `red_card` | Tarjeta roja |
| `substitution` | Cambio — nombres y números en `metadata` |

---

## Relaciones (Diagrama)

```
Club
 ├── Users (1:N)
 ├── Divisions (1:N)
 │    ├── Players (1:N)  ──┬── PlayerDivisionHistory (1:N)
 │    │                    ├── PlayerMeasurement (1:N)
 │    │                    └── PhysicalTest (1:N)
 │    └── Tournaments (1:N)
 └── Tournaments (1:N)
      └── Sessions (1:N)
           ├── TimerState (1:1)
           ├── Events (1:N)
           └── MatchLineup (1:N) ──→ Player
```

## Índices

```sql
-- 0001
CREATE INDEX idx_events_session_id     ON events(session_id);
CREATE INDEX idx_events_session_type   ON events(session_id, event_type);
CREATE INDEX idx_sessions_tournament   ON sessions(tournament_id);
CREATE INDEX idx_users_club            ON users(club_id);
CREATE INDEX idx_refresh_tokens_user   ON refresh_tokens(user_id);
-- 0002 / 0003
CREATE INDEX idx_players_division      ON players(division_id);
CREATE INDEX idx_lineup_session        ON match_lineup(session_id);
CREATE INDEX idx_lineup_session_team   ON match_lineup(session_id, team);
CREATE INDEX idx_events_player         ON events(player_id);
-- 0007
CREATE INDEX idx_pdh_player            ON player_division_history(player_id);
CREATE INDEX idx_pdh_division          ON player_division_history(division_id);
CREATE INDEX idx_pm_player             ON player_measurements(player_id);
CREATE INDEX idx_pm_player_date        ON player_measurements(player_id, measured_at);
CREATE INDEX idx_pt_player             ON physical_tests(player_id);
CREATE INDEX idx_pt_player_type        ON physical_tests(player_id, test_type);
CREATE INDEX idx_pt_player_type_date   ON physical_tests(player_id, test_type, test_date);
```

## Convenciones

- **Bajas lógicas, no borrados.** `clubs`, `users`, `divisions`, `tournaments` y `players`
  usan `is_active`. Divisiones y torneos rechazan la baja con `409` si todavía tienen
  contenido activo colgando.
- **Defaults del lado del ORM.** Toda columna con `server_default` lleva también un
  `default=` de Python. Depender sólo del default del motor rompe en cualquier backend
  que no sea Postgres (SQLite guarda `server_default="true"` como el texto `'true'`).
- **UTC siempre** en las columnas `TIMESTAMP WITH TIME ZONE`.

## Migraciones

- Gestionadas con **Alembic**; el backend ejecuta `alembic upgrade head` al iniciar.
- Idempotentes: chequean existencia de tabla/columna/índice antes de actuar.
- CI corre `upgrade head` y `downgrade base` contra Postgres real en cada push.

## Relacionado

- [[architecture]] — stack tecnológico y Docker
- [[auth-and-users]] — roles y permisos
- [[match-session]] — lógica del timer y eventos
- [[offline-resilience]] — cola offline, reconexión y sellado de tiempo
- [[statistics-screens]] — pantallas de registro y análisis
- [[notificaciones]] — bandeja, dispositivos de push y preferencias
- [[turnos-nutricion]] — agenda de la nutricionista
