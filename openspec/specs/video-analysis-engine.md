---
title: Motor de Análisis de Video (Vision Engine)
status: draft
created: 2026-07-25
---

# Motor de Análisis de Video (Vision Engine)

## Visión General

Módulo **independiente** que analiza video de partidos y produce datos estructurados: posiciones de jugadores, tracking persistente, poses, trayectoria de pelota y **eventos detectados automáticamente** (pase, tackle, line, scrum, ruck, try…).

Se diseña como un **motor genérico de análisis deportivo**: la arquitectura base (detección → tracking → calibración → poses → estado del partido → razonamiento temporal) es agnóstica al deporte. *Rugby* es el primer **sport pack**: un conjunto de pesos de modelos + detectores de eventos + reglas de negocio. Fútbol, hockey, handball o básquet se agregarían como packs adicionales sin tocar el core.

### Principio rector

> No se le pide a una sola IA que "mire el video y diga si hubo un tackle".
> Se construye **información intermedia** (tracks, poses, geometría del campo) y recién sobre esa representación se razona temporalmente.

## Alcance y Aislamiento

- Corre en **su propio contenedor Docker**, con su propio `docker-compose.vision.yml`.
- **No comparte proceso, imagen ni base de datos** con el backend FastAPI actual.
- **En esta etapa NO se comunica con el panel de estadísticas.** Se define el contrato de integración, pero la integración efectiva es una fase posterior.
- Requiere **GPU NVIDIA** (CUDA). El stack principal (`db`/`backend`/`frontend`) debe seguir levantando sin GPU y sin este módulo.

## Arquitectura de la Pipeline

```text
Video (mp4 / rtsp / multi-cámara)
   │
   ▼
1. Detección de jugadores y árbitro
   │
   ▼
2. Tracking multi-objeto (ID persistente)
   │
   ▼
3. Detección / calibración del campo (homografía)
   │
   ▼
4. Estimación de pose (keypoints por jugador)
   │
   ▼
5. Detección de pelota
   │
   ▼
6. Grafo espacio-temporal (estado del partido por frame)
   │
   ▼
7. Modelo temporal → eventos
```

### Etapa 1 — Detección de jugadores

| Aspecto | Definición |
|---------|------------|
| Candidatos | YOLO11, RT-DETR, Grounding DINO (zero-shot para bootstrapping del dataset) |
| Clases | `player`, `referee` |
| Salida | bbox + score + clase por frame |
| Métrica objetivo | mAP@50 ≥ 0.85 en set de validación propio |

Grounding DINO se usa para **pre-etiquetar** el dataset (texto → cajas) y luego se destila a YOLO11/RT-DETR para inferencia rápida.

### Etapa 2 — Tracking

| Aspecto | Definición |
|---------|------------|
| Algoritmo | ByteTrack (baseline) → BoT-SORT (con ReID) si hay muchos cruces de ID |
| Objetivo | Mantener el mismo `track_id` durante todo el partido |
| Salida | `(track_id, frame, x, y, w, h)` |
| Métrica objetivo | HOTA ≥ 0.60, ID switches < 5 por minuto de juego |

**Asignación de equipo**: clustering de color de camiseta (crop del torso → histograma HSV / embedding ReID → k-means k=2) + heurística de continuidad temporal por `track_id`. La asignación de **número de camiseta** (OCR) queda para Fase 3.

### Etapa 3 — Detección del campo

Segmentación de líneas + homografía imagen ↔ plano de cancha (coordenadas en metros).

Líneas requeridas:
- línea de mitad de cancha
- líneas de 22
- líneas de 5 y de 15
- líneas de touch
- líneas de ingoal y goal-line

| Aspecto | Definición |
|---------|------------|
| Candidatos | YOLO-Seg (rápido), Mask2Former (preciso), SAM2 (asistido / auto-etiquetado) |
| Salida | matriz de homografía `H` por frame (o por keyframe + tracking de cámara) |
| Métrica objetivo | error de reproyección < 1.0 m en el 90% de los frames |

La homografía es lo que convierte píxeles en **metros**, y sin eso no hay velocidad, distancia ni offside.

### Etapa 4 — Estimación de pose

| Aspecto | Definición |
|---------|------------|
| Candidatos | RTMPose (top-down, preciso), YOLO-Pose (one-stage, rápido) |
| Keypoints | 17 COCO: cabeza, hombros, codos, muñecas, cadera, rodillas, tobillos |
| Salida | `(track_id, frame, [kp_x, kp_y, conf] × 17)` |

Las poses son la señal clave para distinguir **tackle / ruck / maul / scrum**, que geométricamente son "varios jugadores muy juntos" y solo se separan mirando la postura.

### Etapa 5 — Detección de pelota

Modelo **dedicado, una sola clase** (`ball`). Es el subproblema más difícil: objeto chico, rota, se ocluye, sale de cuadro.

| Aspecto | Definición |
|---------|------------|
| Estrategia | detector de alta resolución + tile inference en zona de interés |
| Post-proceso | filtro de Kalman + interpolación de trayectoria en oclusiones |
| Salida | `(frame, x, y, conf, is_interpolated)` |
| Métrica objetivo | recall ≥ 0.70 en frames con pelota visible |

### Etapa 6 — Estado del partido (grafo espacio-temporal)

Cada frame deja de ser una imagen y pasa a ser un **conjunto de features**:

```jsonc
{
  "frame": 15230,
  "t": 634.58,                    // segundos desde inicio del video
  "players": [
    {
      "track_id": 14,
      "team": "home",
      "pos_m": [42.3, 18.7],      // coordenadas de cancha, metros
      "velocity_ms": 6.2,
      "heading_deg": 118.0,
      "pose": [[x, y, c], "..."],
      "dist_to_ball_m": 1.8,
      "dist_to_nearest_opponent_m": 0.9,
      "in_ruck": false
    }
  ],
  "ball": { "pos_m": [43.1, 19.4], "height_est_m": 1.1, "carrier_track_id": 14 },
  "field": { "homography_ok": true, "reproj_error_m": 0.4 }
}
```

Se persiste como **Parquet** particionado por partido (no fila-por-fila en Postgres: 25 fps × 80 min × 30 objetos ≈ 3.6M filas por partido).

### Etapa 7 — Modelo temporal (detección de eventos)

Recién acá entra la IA "grande", y **no** sobre píxeles crudos sino sobre secuencias.

Dos caminos que conviven:

1. **Reglas espacio-temporales** (determinísticas, explicables, baratas) — cubren pase, salida por touch, formación de line, scrum.
2. **Transformer temporal** entrenado sobre clips + features — cubre tackle, ruck, maul y todo lo que las reglas detectan mal.

| Candidatos | Uso |
|-----------|-----|
| VideoMAE v2, TimeSformer, MViTv2, Video Swin, InternVideo | clasificación de clips / detección temporal de acciones |
| GNN / Transformer sobre el grafo de features | alternativa liviana, sin píxeles |
| NVIDIA Cosmos Reason / Embed | **investigación**, no producto: embeddings de clips y razonamiento sobre secuencias |

> Cosmos está orientado a *Physical AI* y simulación, no a reconocimiento deportivo. Se evalúa como fuente de investigación y para *dataset search* / embeddings, **no** como modelo principal.

## Catálogo de Eventos por Dificultad

### Nivel Fácil
`pase`, `tackle`, `try`, `salida por touch`, `conversión`

### Nivel Medio
`ruck`, `maul`, `scrum`, `lineout`

### Nivel Difícil (requieren entender reglas)
`knock on`, `forward pass`, `offside`, `ventaja`

Los de nivel difícil se abordan como **motor de reglas sobre el estado del partido**, no como clasificación de video. Ejemplo: `forward pass` = componente de velocidad de la pelota hacia el ingoal rival, en el sistema de referencia de la cancha, en el instante del release.

### Firmas de detección (ejemplos)

**Tackle** — ventana de ~2 s:
```
jugador A cierra distancia sobre jugador B
   ↓ distancia < 0.5 m
   ↓ poses se intersectan
   ↓ velocidad de ambos → ~0
   ↓ altura de cadera de B desciende
   ↓ pelota baja de altura
```

**Pase** — con tracking alcanza:
```
carrier = jugador A → ball sale del radio de A
   ↓ trayectoria balística
   ↓ ball entra en radio de jugador B (mismo equipo)
```

**Lineout**:
```
salida de pelota por touch
   ↓ ~2 columnas paralelas de jugadores perpendiculares a la línea de touch
   ↓ lanzamiento + salto (keypoints de tobillo suben)
```

**Scrum**:
```
8 vs 8 agrupados
   ↓ torsos inclinados (ángulo hombro-cadera)
   ↓ contacto
   ↓ velocidad global baja y sostenida
   ↓ pelota por debajo del nivel de cadera
```

## Modelo de Datos (base propia del módulo)

Base de datos separada (`vision_db`), **sin** foreign keys hacia el esquema del panel de estadísticas.

```sql
video_assets
  id              UUID PK
  external_ref    VARCHAR(100) NULL   -- session_id del panel, si existe (sin FK)
  sport           VARCHAR(30) NOT NULL DEFAULT 'rugby'
  storage_uri     TEXT NOT NULL       -- s3://bucket/key
  duration_s      NUMERIC
  fps             NUMERIC
  resolution      VARCHAR(20)
  camera_type     ENUM('broadcast','fixed_wide','tactical','drone')
  status          ENUM('uploaded','ready','failed')
  created_at      TIMESTAMP

analysis_jobs
  id              UUID PK
  video_asset_id  UUID FK → video_assets.id
  sport_pack      VARCHAR(30) NOT NULL   -- 'rugby-v1'
  pipeline_config JSONB                  -- modelos, umbrales, etapas habilitadas
  status          ENUM('queued','running','succeeded','failed','cancelled')
  progress        NUMERIC DEFAULT 0
  error           TEXT NULL
  started_at      TIMESTAMP NULL
  finished_at     TIMESTAMP NULL

job_stages
  id              UUID PK
  job_id          UUID FK → analysis_jobs.id
  stage           ENUM('detect','track','field','pose','ball','state','events')
  status          ENUM('pending','running','succeeded','failed','skipped')
  artifact_uri    TEXT NULL           -- parquet/json en object storage
  metrics         JSONB               -- fps, mAP, HOTA, reproj_error
  duration_s      NUMERIC NULL

tracks
  id              UUID PK
  job_id          UUID FK → analysis_jobs.id
  track_id        INT NOT NULL        -- ID del tracker
  team            ENUM('home','away','referee','unknown')
  jersey_number   SMALLINT NULL       -- Fase 3 (OCR)
  player_ref      VARCHAR(100) NULL   -- player_id del panel, asignación manual
  first_frame     INT
  last_frame      INT
  total_distance_m NUMERIC
  max_speed_ms    NUMERIC

detected_events
  id              UUID PK
  job_id          UUID FK → analysis_jobs.id
  event_type      VARCHAR(50) NOT NULL   -- mapeable al catálogo del panel
  t_start_s       NUMERIC NOT NULL
  t_end_s         NUMERIC NOT NULL
  confidence      NUMERIC NOT NULL       -- 0..1
  team            ENUM('home','away','unknown')
  primary_track   INT NULL
  secondary_track INT NULL
  pos_m           JSONB NULL             -- [x, y] en cancha
  evidence        JSONB                  -- features que dispararon la detección
  review_status   ENUM('unreviewed','confirmed','rejected','corrected')
  reviewed_by     VARCHAR(100) NULL

model_registry
  id              UUID PK
  name            VARCHAR(100)        -- 'yolo11-player-rugby'
  stage           VARCHAR(20)
  sport           VARCHAR(30)
  version         VARCHAR(20)
  weights_uri     TEXT
  metrics         JSONB
  is_active       BOOLEAN
```

Los datos por frame (tracks punto a punto, poses, estado) **no van a Postgres**: se guardan en Parquet en object storage y la tabla solo referencia el `artifact_uri`.

## Servicios y Contenedores

`docker-compose.vision.yml` (independiente del compose principal):

| Servicio | Rol |
|----------|-----|
| `vision-api` | FastAPI: upload de video, crear/consultar jobs, exponer eventos. Sin GPU. |
| `vision-worker` | Worker GPU: ejecuta la pipeline. Imagen base `nvidia/cuda`, `deploy.resources.reservations.devices` con `driver: nvidia`. |
| `vision-db` | PostgreSQL propio del módulo. |
| `vision-queue` | Redis — cola de jobs (RQ / Celery / Arq). |
| `vision-storage` | MinIO (S3-compatible) para videos, frames, artifacts y pesos. |

Los workers escalan horizontalmente (`--scale vision-worker=N`), uno por GPU disponible.

## Contrato de Integración Futura (definido, no implementado)

Cuando se integre con el panel de estadísticas:

1. El panel crea un job: `POST /vision/jobs` con `{ external_ref: session_id, storage_uri, sport_pack }`.
2. El módulo notifica por **webhook** `POST {callback_url}` con `{ job_id, status, progress }`.
3. El panel consulta eventos: `GET /vision/jobs/{id}/events?min_confidence=0.7`.
4. El panel importa eventos como **sugerencias** (`source: "vision"`, `review_status: unreviewed`) mapeando a su catálogo de `event_type`, y un analista los confirma o corrige.

Mapeo de eventos (vision → catálogo del panel):

| Vision | Panel |
|--------|-------|
| `tackle` (completado) | `tackle_completed` |
| `tackle` (roto) | `tackle_missed` |
| `ruck` (ganado / perdido) | `breakdown_won` / `breakdown_lost` |
| `lineout` | `lineout_won` / `lineout_lost` |
| `scrum` | `scrum_won` / `scrum_lost` |
| `knock_on` | `knock_on` |
| `forward_pass` | `forward_pass` |
| `turnover` | `turnover_won` / `turnover_conceded` |

**Ningún evento generado por el módulo se escribe directo en la tabla `events` del panel sin revisión humana** mientras la precisión no esté validada.

## Diseño Genérico (multi-deporte)

```
core/                    # agnóstico al deporte
  detect/  track/  field/  pose/  ball/  state/  temporal/
sports/
  rugby/
    models.yaml          # pesos por etapa
    field.yaml           # geometría de cancha (100×70, 22, 5, 15, ingoal)
    events/              # detectores: tackle.py, lineout.py, scrum.py...
    rules.yaml           # mapeo a catálogo del panel
  football/              # futuro
  hockey/                # futuro
```

Agregar un deporte = agregar un directorio en `sports/`. El core no cambia.

## Hardware

| Entorno | Recomendación |
|---------|---------------|
| Desarrollo | RTX 5090 (o RTX 6000 Ada si el presupuesto lo permite) |
| Producción (batch) | 1× RTX 5090 — objetivo: partido de 80 min en < 40 min de proceso |
| Producción (tiempo real / multi-cámara) | 2× RTX 5090 o RTX PRO Blackwell |
| Edge (en el estadio) | Jetson AGX Thor |

Aceleración con **TensorRT** obligatoria en producción. **DeepStream SDK** se evalúa como runtime de pipeline multi-modelo en tiempo real (Fase 4); en Fases 1–3 se usa PyTorch + Ultralytics por velocidad de iteración.

## Fases

### Fase 1 — Fundaciones (MVP)
- Detección de jugadores
- Tracking persistente
- Detección de pelota
- Calibración automática de cancha
- Salida: Parquet de tracks + video overlay de debug

### Fase 2 — Métricas derivadas
- Velocidad y distancia recorrida por jugador
- Mapas de calor
- Tiempo de posesión por equipo
- Detección automática de pases

### Fase 3 — Eventos de contacto
- Tackles, lineouts, scrums, rucks, mauls
- Asignación de número de camiseta (OCR) → vínculo con jugadores reales
- UI de revisión y corrección de eventos

### Fase 4 — Análisis táctico
- Reconstrucción 2D/3D de la jugada
- Predicción táctica
- Clasificación de sistemas ofensivos y defensivos
- Resúmenes generados con IA ("el equipo azul generó superioridad numérica por el canal 2 en el minuto 48")

## No-objetivos (de esta etapa)

- No se modifica el backend, el frontend ni la base de datos actuales.
- No hay inferencia en tiempo real durante el partido (todo es batch, post-partido).
- No hay UI propia más allá de un visor de debug mínimo.
- No se reemplaza el registro manual de estadísticas: lo complementa.

## Criterios de Éxito (Fase 1)

- Un partido completo de 80 min se procesa end-to-end sin intervención manual.
- HOTA ≥ 0.60 y menos de 5 ID switches por minuto en el set de validación.
- Error de reproyección de cancha < 1.0 m en el 90% de los frames.
- El overlay de debug permite verificar visualmente tracking y calibración.
- El stack principal (`docker compose up`) sigue funcionando sin GPU y sin este módulo.

## Riesgos

| Riesgo | Mitigación |
|--------|-----------|
| Dataset propio de rugby inexistente | Grounding DINO + SAM2 para pre-etiquetado; empezar con 2–3 partidos etiquetados |
| Oclusiones masivas en ruck/maul | ReID + interpolación; aceptar pérdida de ID dentro del contacto y re-asociar al salir |
| Cámara broadcast con zoom y cortes | Detección de corte de plano; recalibrar homografía por keyframe |
| Costo de GPU | Fase 1 en batch nocturno sobre una sola GPU |
| Scope creep hacia "IA que entiende rugby" | Fases estrictas; Fase 1 no detecta ningún evento |

## Relacionado

- [[architecture]] — stack del panel de estadísticas (separado de este módulo)
- [[data-model]] — catálogo de `event_type` al que se mapean los eventos detectados
- [[match-session]] — sesión de partido que eventualmente recibirá los eventos sugeridos
- [[add-video-analysis-module]] — propuesta de cambio que crea este módulo
