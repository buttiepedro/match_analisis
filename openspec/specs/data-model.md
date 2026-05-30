---
title: Modelo de Datos
status: active
created: 2026-05-29
---

# Modelo de Datos

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
  is_active     BOOLEAN DEFAULT TRUE
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
  is_active     BOOLEAN DEFAULT TRUE
  created_at    TIMESTAMP
  updated_at    TIMESTAMP
```

### Session (Partido)
```sql
sessions
  id              UUID PK
  tournament_id   UUID FK → tournaments.id
  home_team       VARCHAR(100) NOT NULL   -- nombre del equipo local
  away_team       VARCHAR(100) NOT NULL   -- nombre visitante
  scheduled_at    TIMESTAMP               -- fecha/hora programada
  status          ENUM('scheduled', 'active', 'halftime', 'finished')
  half_duration_minutes INT DEFAULT 40
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
  elapsed_seconds INT DEFAULT 0          -- segundos acumulados en el half actual
  started_at      TIMESTAMP NULL         -- cuando se inició/reanudó por última vez
  updated_at      TIMESTAMP
```
> `elapsed_seconds` se calcula como: `(NOW() - started_at)` + acumulado previo a la última pausa.

### Event (Evento de partido)
```sql
events
  id              UUID PK
  session_id      UUID FK → sessions.id
  event_type      VARCHAR(50) NOT NULL    -- ver catálogo de tipos abajo
  half            SMALLINT NOT NULL       -- 1 o 2
  timer_seconds   INT NOT NULL            -- tiempo del timer al registrar
  team            ENUM('home', 'away') NOT NULL
  player_number   SMALLINT NULL
  reason          VARCHAR(50) NULL        -- ej: 'offside', 'high_tackle'
  metadata        JSONB DEFAULT '{}'
  recorded_by     UUID FK → users.id
  recorded_at     TIMESTAMP DEFAULT NOW()
```

### RefreshToken
```sql
refresh_tokens
  id          UUID PK
  user_id     UUID FK → users.id
  token_hash  VARCHAR NOT NULL
  expires_at  TIMESTAMP NOT NULL
  revoked     BOOLEAN DEFAULT FALSE
  created_at  TIMESTAMP
```

---

## Catálogo de Tipos de Evento (`event_type`)

### Tackles
| Valor | Descripción |
|-------|-------------|
| `tackle_completed` | Tackle completado |
| `tackle_missed` | Tackle fallado |
| `dominant_tackle` | Tackle dominante |
| `breakdown_won` | Ruck ganado |
| `breakdown_lost` | Ruck perdido |

### Lines & Scrum
| Valor | Descripción |
|-------|-------------|
| `lineout_won` | Line-out ganado |
| `lineout_lost` | Line-out perdido |
| `lineout_steal` | Line-out robado |
| `scrum_won` | Scrum ganado |
| `scrum_lost` | Scrum perdido |
| `scrum_penalty_won` | Penal ganado en scrum |
| `scrum_penalty_lost` | Penal perdido en scrum |

### Penales & Posesión
| Valor | Descripción |
|-------|-------------|
| `penalty_conceded` | Penal cometido |
| `penalty_won` | Penal recibido |
| `yellow_card` | Tarjeta amarilla |
| `red_card` | Tarjeta roja |
| `turnover_conceded` | Pérdida de posesión |
| `turnover_won` | Posesión ganada |
| `knock_on` | Knock-on |
| `forward_pass` | Pase adelantado |

---

## Relaciones (Diagrama)

```
Club
 ├── Users (1:N)
 ├── Divisions (1:N)
 └── Tournaments (1:N, via division)
      └── Sessions (1:N)
           ├── TimerState (1:1)
           └── Events (1:N)
```

## Índices Recomendados

```sql
CREATE INDEX idx_events_session_id ON events(session_id);
CREATE INDEX idx_events_session_type ON events(session_id, event_type);
CREATE INDEX idx_sessions_tournament ON sessions(tournament_id);
CREATE INDEX idx_users_club ON users(club_id);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
```

## Migraciones

- Gestionadas con **Alembic**
- El backend ejecuta `alembic upgrade head` al iniciar (en el entrypoint del Dockerfile)
- Las migraciones se generan con `alembic revision --autogenerate -m "descripcion"`

## Relacionado

- [[architecture]] — stack tecnológico y Docker
- [[auth-and-users]] — roles y permisos
- [[match-session]] — lógica del timer y eventos
