---
title: Rediseño de Planilla — Export Estético + Import Ficha BD UAR
type: feature
status: proposed
spec: statistics-screens
created: 2026-06-07
---

# Rediseño de Planilla

Dos cambios relacionados a la importación/exportación de planillas de partido:

1. **Export**: Planilla Excel estética con estadísticas del partido bien presentadas
2. **Import Ficha BD UAR**: Importar la "Tarjeta de partido" en PDF que genera la plataforma UAR (BD UAR), parsear los datos, confirmar y cargar

---

## 1. Export Redesign

### Cambio de librería: `xlsx` → `exceljs`

La librería actual (`xlsx` / SheetJS) no soporta estilos en su versión open source. Se reemplaza por `exceljs` que permite colores, fuentes, bordes y celdas combinadas.

```bash
npm install exceljs
# xlsx se mantiene solo si el import Excel por compatibilidad sigue en uso
```

### Estructura del workbook

**Sheet "Resumen"** (nueva — hoja principal):

```
┌──────────────────────────────────────────────┐
│           PLANILLA DE PARTIDO                │  ← merge A1:E1, fondo verde oscuro
│   [Club Local]    14  —  10  [Equipo Rival]  │  ← marcador grande, bold
│   Torneo: URBA 2026  ·  Fecha: 15/06/2026   │
├──────────────────────────┬───────┬───────────┤
│  PUNTUACIÓN              │ Local │   Rival   │
│  Tries (×5)              │   2   │     1     │
│  Conversiones (×2)       │   1   │     1     │
│  Penales a los palos (×3)│   0   │     1     │
│  Drops (×3)              │   0   │     0     │
│  TOTAL                   │  14   │    10     │  ← bold + fondo
├──────────────────────────┼───────┼───────────┤
│  DISCIPLINA              │ Local │   Rival   │
│  Amarillas               │   1   │     2     │
│  Rojas                   │   0   │     0     │
├──────────────────────────┴───────┴───────────┤
│  JUEGO (equipo local)                        │
│  Tackles: Concretados 8 · Errados 3 · Pos 2  │
│  Ataque: Quiebres 4 · Offloads 2             │
│  Posesión perdida: Ruck 2 · Contacto 1       │
│  Pelota ganada: Ruck 1 · Patada 1            │
├──────────────────────────────────────────────┤
│  LÍNEAS Y SCRUMS (equipo local)              │
│  Lines a favor: 6  (4 con obtención)         │
│  Lines en contra: 3 (1 con obtención)        │
│  Scrums a favor: 4 (3 con obtención)         │
│  Scrums en contra: 2 (0 con obtención)       │
└──────────────────────────────────────────────┘
```

**Sheet "Plantel"** — mejorada:
- Header fijo con fondo de color (verde para local, naranja para rival)
- Columnas: N° Camiseta | Nombre | Posición | Estado
- Titulares primero (Pos 1–15), luego Suplentes — separados con fila vacía + subheader
- Filas alternadas (striped)

_(Sheet "Eventos" eliminada — el export es solo para informe/envío, no para re-import)_

### Cálculo de estadísticas (client-side)

Extraer la lógica de `calcPoints` de `PenaltiesPossession.tsx` y los contadores de `JuegoEventos.tsx` a un helper compartido en `frontend/src/lib/stats.ts`:

```typescript
export function calcPoints(events: EventData[], team: "user" | "rival"): number
export function countTackles(events: EventData[]): { effective: number; missed: number; positive: number }
export function countAttack(events: EventData[]): { line_break: number; offload: number }
export function countSetpiece(events: EventData[], type: "line" | "scrum"): { favor_con: number; favor_sin: number; contra_con: number; contra_sin: number }
```

---

## 2. Import Ficha BD UAR

### Formato del PDF fuente

La "Tarjeta de partido" que genera la plataforma UAR tiene una estructura fija:

**Encabezado:**
```
Tarjeta de partido N°: 276652
Cancha | Día | Hora | Torneo | División | Instancia | Fecha
LA TABLADA | 2026-03-21 | 13:00 | T. REGION CENTRO ... | Intermedia | CAMPEONATO | Fecha 02
```

**Marcador:**
```
LA TABLADA  25    CORDOBA ATHLETIC  24
```

**Dos tablas de plantel (LOCAL izquierda, VISITANTE derecha):**
```
Pos | Dor | Apellido y Nombre       | N° Doc.  | A1 | A2 | E | Sal. | Ent.
 1  | 26  | Issidoro, Julian        | 39072901 |    |    |   |      | X
 2  |  2  | Ruiz, Juan Pablo        | 46973016 |    |    |   |      |
...
15  | 15  | Pelaez, Felipe          | 44579259 |    |    |   |  X   |
16  | 16  | Reartes Bearzotti, Jer. | 46372715 |    |    |   |      | X
...
```
- `Pos` 1–15 = titulares (`on_field`), 16–23 = suplentes (`bench`)
- `Dor` = número de camiseta (puede diferir de `Pos`)
- Nombres en formato `Apellido, Nombre` (invertido respecto a nuestra BD)

**Incidencias por equipo:**
```
Tie. | Min. | Incid.    | Ptos. | Dorsal | Observaciones
1T   | 21   | Amarilla  |       | 24     | Amarilla Juego General (J. G.)
1T   | 27   | Penal     | 3     | 10     |
1T   | 36   | Try       | 5     | 13     |
1T   | 37   | Conversión| 2     | 10     |
2T   | 40   | Se retiró |       | 8      |
2T   | 40   | Ingresó   |       | 19     |
```

### Mapeo Incidencia → event_type

| Incidencia UAR | event_type nuestro | Lógica extra |
|---|---|---|
| `Try` + siguiente `Conversión` | `try` | `metadata.converted = true` |
| `Try` sin siguiente `Conversión` | `try` | `metadata.converted = false` |
| `Conversión` | _(consumida por Try anterior)_ | No genera evento propio |
| `Penal` (3 pts) | `penalty` | `reason = "a_los_palos"`, `metadata.converted = true` |
| `Amarilla` | `yellow_card` | — |
| `Roja` | `red_card` | — |
| `Se retiró` + `Ingresó` siguiente | `substitution` | par por tiempo+minuto |

### Determinación del equipo `user`/`rival`

El nombre del equipo local en el PDF se compara con `clubName` del usuario (auth store):
```typescript
const isUserLocal = pdfLocalTeam.toLowerCase().includes(clubName.toLowerCase())
                 || clubName.toLowerCase().includes(pdfLocalTeam.toLowerCase());
const userSide = isUserLocal ? "local" : "visitante";
```
→ El equipo que coincide con el club recibe `team: "user"`, el otro `team: "rival"`.

### Matcheo de jugadores (nombre invertido)

El PDF usa "Apellido, Nombre". Nuestra BD usa "Nombre Apellido". Estrategia:

```python
def normalize_name(raw: str) -> str:
    # "Issidoro, Julian" → "julian issidoro"
    parts = raw.split(",", 1)
    if len(parts) == 2:
        return f"{parts[1].strip()} {parts[0].strip()}".lower()
    return raw.strip().lower()
```

En frontend, al confirmar, se hace fuzzy match contra los players de la BD del club para los jugadores de `userSide`. Los del equipo rival no se buscan en BD — se crean como registros temporales solo en el lineup con `player.name` del PDF (sin `player_id` en BD, solo el nombre).

### Arquitectura

**Backend Python endpoint:**
```
POST /api/v1/import/lineup-pdf
Content-Type: multipart/form-data
Body: { file: PDF }

Response 200:
{
  "match_number": "276652",
  "local_team": "LA TABLADA",
  "visitante_team": "CORDOBA ATHLETIC",
  "local_score": 25,
  "visitante_score": 24,
  "fecha": "2026-03-21T13:00:00",
  "torneo": "T. REGION CENTRO (INTERMEDIA) - TOP 10 A - 2026",
  "cancha": "LA TABLADA",
  "lineup_local": [
    { "pos": 1, "dor": 26, "nombre_pdf": "Issidoro, Julian", "nombre_norm": "julian issidoro", "status": "on_field" },
    ...
    { "pos": 16, "dor": 16, "nombre_pdf": "Reartes Bearzotti, Jerónimo", "nombre_norm": "jeronimo reartes bearzotti", "status": "bench" }
  ],
  "lineup_visitante": [ ... ],
  "incidencias_local": [
    { "tiempo": "1T", "minuto": 21, "tipo": "yellow_card", "dorsal": 24, "observaciones": "Amarilla Juego General" },
    { "tiempo": "1T", "minuto": 27, "tipo": "penalty", "dorsal": 10, "reason": "a_los_palos", "metadata": { "converted": true } },
    { "tiempo": "1T", "minuto": 36, "tipo": "try", "dorsal": 13, "metadata": { "converted": true } },
    { "tiempo": "2T", "minuto": 40, "tipo": "substitution", "dorsal_out": 8, "dorsal_in": 19 }
  ],
  "incidencias_visitante": [ ... ]
}
```

```python
# backend/app/api/v1/import_.py
import pdfplumber, re
from fastapi import APIRouter, UploadFile, File, HTTPException
from app.core.deps import get_current_user

router = APIRouter(prefix="/import", tags=["import"])

@router.post("/lineup-pdf")
async def import_lineup_pdf(
    file: UploadFile = File(...),
    current_user = Depends(get_current_user),
):
    content = await file.read()
    # parsear con pdfplumber
    # extraer tablas, incidencias
    # retornar estructura tipada
```

### UI Modal de confirmación

```
┌──────────────────────────────────────────────────────┐
│  Importar Ficha BD UAR — Tarjeta N° 276652           │
│                                                      │
│  Partido identificado                                │
│  ─────────────────────────────────────────────────  │
│  Local:      LA TABLADA (= tu club ✓)               │
│  Visitante:  [CORDOBA ATHLETIC              ]        │  ← editable
│  Fecha:      [2026-03-21  13:00             ]        │  ← editable
│  Torneo:     [— seleccionar torneo —        ]  ▼     │  ← selector de torneos existentes
│                                                      │
│  Plantel LOCAL — 23 jugadores                        │
│  ┌────┬────┬───────────────────────┬────────────┐   │
│  │Pos │Dor │ Nombre                │ En BD      │   │
│  │ 1  │ 26 │ Julian Issidoro       │ ✓ Encontrado│  │  ← verde si match en BD
│  │ 2  │  2 │ Juan Pablo Ruiz       │ ✓ Encontrado│  │
│  │ 7  │  7 │ Juan Cruz Pilotto     │ ⚠ No hallado│  │  ← amarillo si no está
│  └────┴────┴───────────────────────┴────────────┘   │
│  (scroll — muestra todos)                            │
│                                                      │
│  ⚠ 3 jugadores no encontrados — se agregarán a BD   │
│                                                      │
│  Eventos importados: 21 (tries, penales, cambios)   │
│                                                      │
│  [Cancelar]                 [Confirmar e importar]   │
└──────────────────────────────────────────────────────┘
```

### Paso previo — selección de Torneo y División

Antes de parsear el PDF, el usuario elige:
```
┌────────────────────────────────────┐
│  Importar Ficha BD UAR             │
│                                    │
│  Torneo  [— seleccionar —    ] ▼   │
│  División[— seleccionar —    ] ▼   │
│                                    │
│  [Cancelar]     [Seleccionar PDF]  │
└────────────────────────────────────┘
```
El file picker solo se abre después de confirmar torneo+división.

### Manejo de jugadores no encontrados

Si un jugador propio (userSide) no está en la BD del club, antes de cargar aparece un diálogo por cada uno:
```
┌──────────────────────────────────────────┐
│  Jugador no encontrado                   │
│                                          │
│  "Julian Issidoro" (N°26)                │
│  no está en la división seleccionada.    │
│                                          │
│  ¿Qué querés hacer?                      │
│                                          │
│  [Cancelar importación]  [Crear jugador] │
└──────────────────────────────────────────┘
```
- **Cancelar importación**: cancela todo (no se crea ni la sesión)
- **Crear jugador**: `POST /divisions/{divisionId}/players` con el nombre del PDF, luego continúa

### Flujo de importación confirmada

```
0. Usuario elige Torneo + División → selecciona PDF
1. PDF sube al backend → datos extraídos → modal de confirmación

2. Usuario confirma → por cada jugador propio no encontrado:
   → diálogo "Crear o Cancelar"
   → Si cancela: abort completo
   → Si crea: POST /divisions/{divisionId}/players

3. POST /tournaments/{tournamentId}/sessions
   { home_team: clubName, away_team: rival, scheduled_at: fecha, half_duration_minutes: 40 }

4. Para cada jugador LOCAL (userSide):
   → POST /sessions/{id}/lineup con player_id (ya encontrado o recién creado)

5. Para cada jugador RIVAL:
   → Solo nombre en lineup, sin player_id en BD

6. Para cada incidencia (en orden cronológico):
   → POST /sessions/{id}/events { event_type, team, reason?, metadata? }
```

> **Nota**: Los jugadores rivales no tienen `player_id` en nuestra BD — el lineup los guarda con nombre pero sin perfil.

---

## Preguntas resueltas

| Pregunta | Respuesta |
|---|---|
| ¿Fuente del PDF? | UAR "Tarjeta de partido" — formato fijo conocido |
| ¿Qué datos contiene? | Plantel completo de ambos equipos + incidencias (tries, penales, amarillas, cambios) |
| ¿Mantener import Excel? | **No** — eliminado. Export es solo informe/envío; import viene de PDF UAR |
| ¿Jugadores no encontrados? | Se crean automáticamente en BD para el equipo propio |
| ¿Jugadores rival? | Solo al lineup de la sesión, sin perfil en BD |

## Preguntas abiertas

| # | Pregunta | Impacto |
|---|---|---|
| 1 | ¿El parser Python usa `pdfplumber` o `PyMuPDF`? | Dependencia backend |
| 2 | ¿A qué división se asignan los jugadores nuevos auto-creados? | Flujo de creación |

---

## Archivos a modificar

### Export
- `frontend/src/pages/Tournaments.tsx` — `exportPlanilla()` reescrita con `exceljs`
- `frontend/src/lib/stats.ts` — (nuevo) helpers de cálculo compartidos
- `frontend/package.json` — añadir `exceljs`

### Import PDF
- `backend/app/api/v1/import_.py` — (nuevo) endpoint + parser PDF
- `backend/app/api/v1/__init__.py` o `main.py` — registrar router
- `backend/requirements.txt` — añadir `pdfplumber`
- `frontend/src/pages/Tournaments.tsx` — botón "Importar ficha BD UAR" + modal confirmación

---

## Checklist

### Export estético
- [ ] Instalar `exceljs`, extraer helpers a `lib/stats.ts`
- [ ] Sheet "Resumen": marcador + desglose de puntos + disciplina + juego + setpieces
- [ ] Sheet "Plantel": headers con color, titulares/suplentes separados, striped
- [ ] Sheet "Eventos": mantener igual (compat)

### Import Ficha BD UAR
- [ ] Backend: `pdfplumber` en requirements.txt
- [ ] Backend: parser `import_.py` — extrae equipos, plantel, incidencias del PDF UAR
- [ ] Backend: registrar router en app principal
- [ ] Frontend: botón "Importar ficha BD UAR" en Tournaments.tsx
- [ ] Frontend: POST al endpoint, recibir datos parseados
- [ ] Frontend: modal de confirmación con jugadores y eventos resueltos
- [ ] Frontend: flujo de creación — sesión + jugadores nuevos + lineup + eventos
- [ ] Manejo de jugadores rivales (solo lineup, sin perfil)
