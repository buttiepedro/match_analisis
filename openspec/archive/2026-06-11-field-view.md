---
title: Vista de Cancha — Formación + Export PDF + Restyling de Sesiones
type: feature
status: done
spec: match-session
created: 2026-06-10
---

# Vista de Cancha

Dos cambios relacionados:

1. **Restyling de la lista de sesiones** — los partidos en Tournaments.tsx tienen demasiados botones; se compactan en un diseño card más cómodo
2. **Vista de cancha** — visualización SVG del campo con los 15 titulares en sus posiciones, suplentes al costado, info del partido, swap entre jugadores y export a PDF

---

## 1. Restyling de la lista de sesiones

### Problema actual

Cada sesión tiene 3 botones inline: "Alineación →", "Planilla ↓" y un botón de eliminar. Con el botón nuevo de "Vista de cancha" serían 4, lo cual es demasiado para una fila.

### Nuevo diseño — card de sesión

Cada partido se muestra como un card compacto:

```
┌──────────────────────────────────────────────────────────────┐
│  CLUB LOCAL  17 — 12  RIVAL         vie 21/03  ·  13:00      │
│  URBA 2026 · Intermedia                                       │
│                                                               │
│  [Cancha]  [Alineación]  [Planilla]  [···]                   │
└──────────────────────────────────────────────────────────────┘
```

- Marcador o estado ("En curso", "Programado", "Finalizado") en la línea superior
- Torneo + División en la segunda línea (subtítulo pequeño)
- 3 botones primarios visibles + menú "···" para acciones secundarias (eliminar, editar)
- Botón **[Cancha]** abre el modal de vista de cancha (nuevo)
- Botón **[Alineación]** navega a `/sessions/{id}/lineup` (existente)
- Botón **[Planilla]** dispara el export Excel (existente)
- Menú "···" contiene: Eliminar partido (con confirmación)

---

## 2. Vista de cancha

### Acceso

Botón **[Cancha]** en el card de sesión → abre modal `FieldViewModal`.

### Layout general del modal

```
┌──────────────────────────────────────────────────────────────────┐
│  Vista de Cancha — CLUB LOCAL vs RIVAL           [×]             │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──── Info partido ──────────────────────────────────────────┐  │
│  │  CLUB LOCAL  17 — 12  RIVAL                                │  │
│  │  Torneo URBA 2026 · Intermedia · vie 21/03/2026 · 13:00    │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──── Campo (SVG) ───────┐  ┌──── Suplentes ────────────────┐  │
│  │                        │  │  16  Mario García    Hooker    │  │
│  │   [SVG del campo]      │  │  17  Luis Torres     Pilar     │  │
│  │   con jugadores        │  │  18  Carlos Díaz     Pilar     │  │
│  │   en sus posiciones    │  │  19  Pedro López     Lock      │  │
│  │                        │  │  20  Martín Ruiz     Ala       │  │
│  └────────────────────────┘  │  21  Sergio Vega     M.Scrum   │  │
│                              │  22  Diego Mora      Apertura  │  │
│                              │  23  Facundo Gil     Wing      │  │
│                              └──────────────────────────────────┘  │
│                                                                  │
│  [Cancelar]                               [Exportar PDF]         │
└──────────────────────────────────────────────────────────────────┘
```

### SVG del campo — formación

El campo SVG ocupa el espacio central izquierdo. Fondo verde oscuro con líneas de campo en verde más claro. Orientación: **vertical** (portrait), ataque hacia arriba.

**Posiciones fijas de los 15 jugadores** (coordenadas en % del SVG, x=horizontal, y=vertical):

| N° | Posición          | x%  | y%  |
|----|-------------------|-----|-----|
| 1  | Pilar Izquierdo   | 35  | 20  |
| 2  | Hooker            | 50  | 18  |
| 3  | Pilar Derecho     | 65  | 20  |
| 4  | Segunda Línea     | 40  | 28  |
| 5  | Segunda Línea     | 60  | 28  |
| 6  | Ala               | 30  | 36  |
| 7  | Ala               | 70  | 36  |
| 8  | Ocho              | 50  | 38  |
| 9  | Medio Scrum       | 50  | 48  |
| 10 | Apertura          | 65  | 56  |
| 11 | Wing              | 15  | 64  |
| 12 | Primer Centro     | 42  | 64  |
| 13 | Segundo Centro    | 58  | 64  |
| 14 | Wing              | 85  | 64  |
| 15 | Fullback          | 50  | 78  |

Cada jugador se renderiza como un círculo (`<circle>`) con:
- Fondo verde oscuro con borde verde claro
- Número de camiseta en blanco (bold, grande)
- Nombre abreviado debajo del círculo (iniciales + apellido) — ej. "J. López"
- Posición del jersey en texto pequeño sobre el círculo

### Swap de jugadores

El usuario puede intercambiar dos jugadores de posición (ej. el que ocupa el N°15 pasa a la posición del N°14 y viceversa). **Solo visual / client-side** — no persiste en BD.

**Interacción:**
1. Click en un jugador → se resalta (borde amarillo pulsante)
2. Click en otro jugador → se intercambian sus posiciones en el SVG
3. El SVG se re-renderiza con los jugadores en sus nuevas posiciones
4. Si se vuelve a hacer click en el mismo jugador resaltado → se des-selecciona

**Alcance**: Solo titulares (`on_field`). No se puede swappear un titular con un suplente desde esta vista (eso es la pantalla de cambios/lineup).

### Info del partido

Header del modal con:
- Nombre del equipo local y rival
- Marcador (si la sesión está `finished` o `active`) o "vs" (si está `scheduled`)
- Fecha y hora formateada
- Torneo + División

### Suplentes

Lista a la derecha del campo, ordenada por `jersey_number` (16–23). Para cada suplente:
- Número de camiseta
- Nombre completo
- Posición habitual (`position` del lineup o `positionByJersey` como fallback)

Si hay menos de 8 suplentes, mostrar las filas disponibles con "—" en las vacías.

---

## Export PDF

### Librería

`jspdf` + `html2canvas` — se renderiza el contenido del modal como canvas y se convierte a PDF.

```bash
npm install jspdf html2canvas
```

Alternativamente, `jspdf` solo con dibujado manual si html2canvas genera problemas de fuentes.

### Contenido del PDF

- **Página única**, A4 apaisado (landscape)
- **Header**: Escudo/nombre de club, "Formación" + nombre del torneo
- **Info del partido**: equipo local / marcador / rival, fecha, hora, cancha/sede
- **Campo SVG exportado como imagen** (renderizado previo a PNG con `html2canvas`)
- **Lista de suplentes** a la derecha del campo
- **Footer**: fecha de generación

### Nombre del archivo

```
formacion_[home_team]_vs_[away_team]_[YYYY-MM-DD].pdf
```

---

## Estado de jugadores

El modal toma el lineup completo de la sesión (ya existe `GET /sessions/{id}/lineup`). El mapeo es:

- `status === "on_field"` → titular (aparece en el campo)
- `status === "bench"` → suplente (aparece en lista lateral)
- `status === "substituted_out"` → no se muestra (ya fue reemplazado)

Si un jugador titular no tiene `position` en el lineup, se usa `positionByJersey(jersey_number)` como fallback.

Si hay jugadores en el campo con `jersey_number > 15` o `status === "bench"` mal asignado, se muestran en la lista de suplentes igualmente.

---

## Datos de ubicación/sede

El campo de `Session` no tiene `venue`. Para esta feature se muestra `home_team` como indicador de sede implícito. Si en el futuro se agrega un campo `venue` al modelo, se puede incorporar.

> **Nota**: Agregar `venue: Optional[str]` a `Session` es deseable pero fuera del alcance de este spec. Se puede hacer en un follow-up.

---

## Archivos a modificar

### Restyling sesiones
- `frontend/src/pages/Tournaments.tsx` — rediseño del card de sesión

### Vista de cancha
- `frontend/src/components/FieldViewModal.tsx` — (nuevo) modal completo con SVG + suplentes + export PDF
- `frontend/src/pages/Tournaments.tsx` — importar y montar `FieldViewModal`
- `frontend/package.json` — añadir `jspdf` y `html2canvas`

---

## Checklist

### Restyling sesiones
- [ ] Rediseñar card de sesión: marcador/estado + torneo+división + 3 botones + menú "···"
- [ ] Mover "Eliminar partido" al menú "···" con confirmación inline

### Vista de cancha — componente
- [ ] `FieldViewModal.tsx`: layout modal con header info partido + SVG campo + lista suplentes
- [ ] SVG campo con 15 posiciones fijas y jugadores como círculos con número y nombre
- [ ] Lógica de swap: selección y swappeo visual client-side
- [ ] Lista de suplentes (jersey 16–23)

### Export PDF
- [ ] Instalar `jspdf` + `html2canvas`
- [ ] Botón "Exportar PDF" captura el SVG + info y genera PDF landscape A4
- [ ] Nombre de archivo con equipos y fecha
