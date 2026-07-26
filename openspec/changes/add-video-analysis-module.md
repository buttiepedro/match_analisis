---
title: Módulo de Análisis Automático de Video (Vision Engine)
type: feature
status: proposed
spec: video-analysis-engine
created: 2026-07-25
---

# Módulo de Análisis Automático de Video (Vision Engine)

## Descripción del Cambio

Crear un módulo **nuevo y separado** que analiza video de partidos y extrae automáticamente datos estructurados: detección y tracking de jugadores, calibración de la cancha, poses, trayectoria de pelota y eventos de juego.

Corre en **su propio contenedor Docker con GPU**, con su propia base de datos y su propio `docker-compose.vision.yml`. **No toca** el backend, el frontend ni la base de datos actuales. La comunicación con el panel de estadísticas se define como contrato pero **se implementa más adelante**.

Se construye como **motor genérico de análisis deportivo**: el core (detección → tracking → campo → poses → estado → razonamiento temporal) es agnóstico al deporte, y rugby es el primer *sport pack*.

> **Nota de alcance**: el material de origen describe Fases 1 a 4 (hasta predicción táctica y resúmenes con IA). Esta propuesta implementa **solo la Fase 1** y deja Fases 2–4 documentadas en la spec como trabajo futuro. Cada fase posterior será su propia propuesta de cambio.

---

## Fases de Implementación

### Fase A: Scaffold del módulo e infraestructura
- [ ] Crear directorio `vision/` en la raíz del repo (hermano de `backend/` y `frontend/`)
- [ ] `vision/docker-compose.vision.yml` con: `vision-api`, `vision-worker`, `vision-db`, `vision-queue` (Redis), `vision-storage` (MinIO)
- [ ] `vision/Dockerfile.api` (CPU, FastAPI) y `vision/Dockerfile.worker` (base `nvidia/cuda`, PyTorch + Ultralytics)
- [ ] Reserva de GPU en el worker (`deploy.resources.reservations.devices`, `driver: nvidia`)
- [ ] `vision/.env.example` con credenciales de `vision-db`, MinIO, Redis y rutas de pesos
- [ ] Estructura de paquetes: `core/` (agnóstico) + `sports/rugby/` (pack)
- [ ] `GET /health` en `vision-api` y verificación de GPU (`GET /health/gpu` → `torch.cuda.is_available()`)
- [ ] Verificar que `docker compose up` del stack principal sigue funcionando **sin GPU y sin este módulo**

### Fase B: Base de datos y orquestación de jobs
- [ ] Alembic propio del módulo (`vision/alembic/`), independiente del backend
- [ ] Tablas: `video_assets`, `analysis_jobs`, `job_stages`, `tracks`, `detected_events`, `model_registry`
- [ ] `POST /videos` — upload a MinIO + registro del asset (mp4)
- [ ] `POST /jobs` — encolar análisis con `pipeline_config`
- [ ] `GET /jobs/{id}` — estado, progreso y métricas por etapa
- [ ] `DELETE /jobs/{id}` — cancelar job en curso
- [ ] Worker con cola Redis, actualización de `progress` por etapa
- [ ] Artifacts de cada etapa persistidos en MinIO (Parquet/JSON) con `artifact_uri` en `job_stages`

### Fase C: Dataset y etiquetado
- [ ] Definir formato de dataset (YOLO/COCO) y layout en MinIO
- [ ] Pre-etiquetado con Grounding DINO (texto → cajas) sobre 2–3 partidos
- [ ] Revisión y corrección manual del pre-etiquetado
- [ ] Split train/val/test por partido (no por frame, para evitar leakage)
- [ ] Documentar el proceso de etiquetado en `vision/docs/dataset.md`

### Fase D: Etapa 1 — Detección de jugadores
- [ ] Entrenar YOLO11 con clases `player` y `referee`
- [ ] Baseline comparativo contra RT-DETR
- [ ] Registrar pesos y métricas en `model_registry`
- [ ] Etapa `detect` del worker: inferencia por lotes de frames
- [ ] **Objetivo**: mAP@50 ≥ 0.85 en el set de validación

### Fase E: Etapa 2 — Tracking
- [ ] Integrar ByteTrack sobre las detecciones
- [ ] Evaluar BoT-SORT (con ReID) si los ID switches superan el umbral
- [ ] Asignación de equipo por color de camiseta (crop de torso → HSV/embedding → k-means k=2)
- [ ] Suavizado temporal de la asignación de equipo por `track_id`
- [ ] Persistir `tracks` (resumen en Postgres) + puntos por frame (Parquet)
- [ ] **Objetivo**: HOTA ≥ 0.60, < 5 ID switches por minuto

### Fase F: Etapa 3 — Detección y calibración del campo
- [ ] Modelo de segmentación de líneas (YOLO-Seg como baseline; Mask2Former si falta precisión)
- [ ] Geometría de cancha de rugby en `sports/rugby/field.yaml` (100×70, 22, 5, 15, ingoal)
- [ ] Cálculo de homografía imagen ↔ cancha, por keyframe + propagación
- [ ] Detección de corte de plano (broadcast) para forzar recalibración
- [ ] Conversión de todas las posiciones a **metros**
- [ ] **Objetivo**: error de reproyección < 1.0 m en el 90% de los frames

### Fase G: Etapa 5 — Detección de pelota
- [ ] Modelo dedicado de una sola clase (`ball`), alta resolución + tile inference
- [ ] Filtro de Kalman + interpolación de trayectoria en oclusiones
- [ ] Marcar frames interpolados (`is_interpolated`) para no inventar datos
- [ ] **Objetivo**: recall ≥ 0.70 en frames con pelota visible

### Fase H: Etapa 6 — Estado del partido
- [ ] Ensamblar features por frame: posición (m), velocidad, dirección, equipo, distancia a pelota, distancia al rival más cercano
- [ ] Asignación de `carrier_track_id` (portador de la pelota)
- [ ] Persistencia en Parquet particionado por partido
- [ ] Esquema versionado del formato de estado (`state_schema_version`)

### Fase I: Debug visual y cierre de Fase 1
- [ ] Render de video overlay: cajas + `track_id` + color de equipo + pelota + líneas de cancha proyectadas
- [ ] Vista cenital 2D (minimapa) generada desde la homografía
- [ ] `GET /jobs/{id}/artifacts` — descarga de overlay y Parquet
- [ ] Reporte de métricas por job (fps de proceso, HOTA, mAP, reproj_error)
- [ ] `vision/README.md` con setup, requisitos de GPU y cómo correr un análisis

---

## Fuera de Alcance (fases posteriores, cada una su propio cambio)

| Fase | Contenido | Estado |
|------|-----------|--------|
| Fase 2 | Velocidad/distancia agregadas, mapas de calor, posesión, detección de pases | Documentado en spec |
| Fase 3 | Etapa 4 (pose estimation), tackles, lineouts, scrums, rucks, mauls, OCR de números, UI de revisión | Documentado en spec |
| Fase 4 | Reconstrucción 2D/3D, predicción táctica, sistemas ofensivos/defensivos, resúmenes con IA | Documentado en spec |
| Integración | Webhooks, import de eventos al panel, mapeo a `event_type`, revisión humana | Contrato definido en spec |
| Multi-deporte | `sports/football/`, `sports/hockey/`, etc. | Arquitectura preparada |

Los modelos temporales (VideoMAE, TimeSformer, MViTv2, Video Swin, InternVideo) y NVIDIA Cosmos **no se implementan** en este cambio: Fase 1 no detecta ningún evento. TensorRT y DeepStream tampoco — en Fase 1 se prioriza velocidad de iteración con PyTorch.

---

## Impacto en Código Existente

| Área | Impacto |
|------|---------|
| `backend/` | **Ninguno** |
| `frontend/` | **Ninguno** |
| `docker-compose.yml` | **Ninguno** — el módulo usa `vision/docker-compose.vision.yml` aparte |
| Base de datos actual | **Ninguno** — `vision-db` es una instancia separada |
| `.gitignore` | Agregar `vision/models/*.pt`, `vision/data/`, `vision/runs/` |
| `README.md` | Sección nueva describiendo el módulo y que es opcional |
| `vision/` | **Nuevo** — todo el módulo |

**Regla dura**: si al terminar este cambio `docker compose up` (el principal) no levanta igual que antes en una máquina sin GPU, el cambio está mal implementado.

---

## Decisiones Técnicas

| Decisión | Elección | Razón |
|----------|----------|-------|
| Detector | YOLO11 | Mejor relación velocidad/precisión; RT-DETR como comparativa |
| Pre-etiquetado | Grounding DINO + SAM2 | No existe dataset propio de rugby; zero-shot para arrancar |
| Tracker | ByteTrack → BoT-SORT | ByteTrack es más simple; se escala a BoT-SORT solo si hace falta ReID |
| Campo | YOLO-Seg → Mask2Former | Empezar rápido, escalar precisión si el error supera 1 m |
| Almacenamiento por frame | Parquet en MinIO | ~3.6M filas por partido: Postgres no es el lugar |
| DB del módulo | Postgres propio | Aislamiento total; sin FKs cruzadas al panel |
| Cola | Redis | Simple, suficiente para jobs de larga duración |
| Sin FK al panel | `external_ref` como string | Los módulos pueden desplegarse y versionarse por separado |

---

## Criterios de Aceptación

- [ ] `docker compose -f vision/docker-compose.vision.yml up` levanta los 5 servicios sin errores
- [ ] `GET /health/gpu` confirma que el worker ve la GPU
- [ ] Se puede subir un video, crear un job y ver el progreso avanzar por etapa
- [ ] Un partido de 80 min se procesa end-to-end sin intervención manual
- [ ] Tiempo de proceso < 40 min en una RTX 5090 (o se documenta el tiempo real medido)
- [ ] mAP@50 ≥ 0.85 en detección de jugadores
- [ ] HOTA ≥ 0.60 y < 5 ID switches por minuto en tracking
- [ ] Error de reproyección de cancha < 1.0 m en el 90% de los frames
- [ ] Recall de pelota ≥ 0.70 en frames con pelota visible
- [ ] El video overlay permite verificar visualmente tracking, equipos y calibración
- [ ] El minimapa 2D muestra las posiciones proyectadas en metros
- [ ] El stack principal levanta sin cambios en una máquina sin GPU

---

## Dependencias y Requisitos Previos

- GPU NVIDIA con drivers CUDA y NVIDIA Container Toolkit instalados en la máquina de desarrollo
- Al menos 2–3 partidos grabados disponibles para etiquetar (idealmente cámara fija wide, no broadcast)
- Espacio en disco: ~50 GB por partido entre video, frames y artifacts

---

## Riesgos

| Riesgo | Mitigación |
|--------|-----------|
| No hay dataset de rugby etiquetado | Pre-etiquetado automático + 2–3 partidos como base mínima |
| Video broadcast con zoom/cortes rompe la homografía | Detección de corte de plano; preferir cámara fija wide en Fase 1 |
| Oclusiones en ruck/maul rompen el tracking | Aceptar pérdida de ID dentro del contacto y re-asociar a la salida |
| Sin GPU disponible el desarrollo se frena | Modo CPU degradado para tests de integración (sin métricas de precisión) |
| Scope creep hacia detección de eventos | Fase 1 **no detecta ningún evento**; es una regla, no una preferencia |

---

## Relacionado

- [[video-analysis-engine]] — spec principal de este módulo
- [[architecture]] — stack del panel, que este módulo no modifica
- [[data-model]] — catálogo de `event_type` destino de la integración futura
