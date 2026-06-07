import io
import re
import uuid
from datetime import datetime, timezone
from typing import Annotated, Literal, Optional

import pdfplumber
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user, require_club_admin
from app.models import Event, MatchLineup, Player, Session, TimerState, Tournament, User, UserRole
from app.models.player import LineupStatus

router = APIRouter(prefix="/import")


# ─── PDF Parser helpers ───────────────────────────────────────────────────────


def _normalize_name(raw: str) -> str:
    parts = raw.split(",", 1)
    if len(parts) == 2:
        return f"{parts[1].strip()} {parts[0].strip()}".lower()
    return raw.strip().lower()


def _parse_lineup_table(rows: list) -> list[dict]:
    players = []
    header_found = False
    for row in rows:
        if not row:
            continue
        cells = [str(c or "").strip() for c in row]
        if not header_found:
            if cells and cells[0].lower() == "pos":
                header_found = True
            continue
        if all(not c for c in cells):
            continue
        try:
            pos = int(cells[0])
            dor = int(cells[1]) if len(cells) > 1 and cells[1] else pos
        except (ValueError, IndexError):
            continue
        nombre_raw = cells[2] if len(cells) > 2 else ""
        if not nombre_raw:
            continue
        players.append({
            "pos": pos,
            "dor": dor,
            "nombre_pdf": nombre_raw,
            "nombre_norm": _normalize_name(nombre_raw),
            "status": "on_field" if pos <= 15 else "bench",
        })
    return players


def _parse_incidencias(rows: list) -> list[dict]:
    events = []
    i = 0
    while i < len(rows):
        row = rows[i]
        if not row:
            i += 1
            continue
        cells = [str(c or "").strip() for c in row]
        tiempo = cells[0] if cells else ""
        if tiempo not in ("1T", "2T"):
            i += 1
            continue
        try:
            minuto = int(cells[1])
        except (ValueError, IndexError):
            i += 1
            continue
        tipo = cells[2] if len(cells) > 2 else ""
        ptos_str = cells[3] if len(cells) > 3 else ""
        dorsal_str = cells[4] if len(cells) > 4 else ""
        obs = cells[5] if len(cells) > 5 else ""
        try:
            ptos = int(ptos_str) if ptos_str else 0
        except ValueError:
            ptos = 0
        try:
            dorsal = int(dorsal_str) if dorsal_str else None
        except ValueError:
            dorsal = None

        if tipo == "Try":
            converted = False
            if i + 1 < len(rows):
                nxt = rows[i + 1]
                if nxt and str(nxt[2] if len(nxt) > 2 else "").strip() == "Conversión":
                    converted = True
                    i += 1
            events.append({
                "tiempo": tiempo, "minuto": minuto, "tipo": "try",
                "dorsal": dorsal, "metadata": {"converted": converted},
            })
        elif tipo == "Penal" and ptos == 3:
            events.append({
                "tiempo": tiempo, "minuto": minuto, "tipo": "penalty",
                "dorsal": dorsal, "reason": "a_los_palos", "metadata": {"converted": True},
            })
        elif tipo == "Amarilla":
            events.append({
                "tiempo": tiempo, "minuto": minuto, "tipo": "yellow_card",
                "dorsal": dorsal, "observaciones": obs,
            })
        elif tipo == "Roja":
            events.append({
                "tiempo": tiempo, "minuto": minuto, "tipo": "red_card",
                "dorsal": dorsal,
            })
        elif tipo == "Se retiró":
            dorsal_in = None
            if i + 1 < len(rows):
                nxt = rows[i + 1]
                if nxt and str(nxt[2] if len(nxt) > 2 else "").strip() == "Ingresó":
                    try:
                        dorsal_in = int(str(nxt[4] if len(nxt) > 4 else "").strip())
                    except (ValueError, TypeError):
                        pass
                    i += 1
            if dorsal_in is not None:
                events.append({
                    "tiempo": tiempo, "minuto": minuto, "tipo": "substitution",
                    "dorsal_out": dorsal, "dorsal_in": dorsal_in,
                })
        i += 1
    return events


# ─── POST /import/lineup-pdf ──────────────────────────────────────────────────


@router.post("/lineup-pdf")
async def import_lineup_pdf(
    file: UploadFile = File(...),
    current_user: Annotated[User, Depends(get_current_user)] = None,
):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Se requiere un archivo PDF")

    content = await file.read()
    try:
        with pdfplumber.open(io.BytesIO(content)) as pdf:
            if not pdf.pages:
                raise HTTPException(status_code=422, detail="PDF vacío")
            page = pdf.pages[0]
            text = page.extract_text() or ""
            tables = page.extract_tables()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"No se pudo leer el PDF: {e}")

    lines = [ln.strip() for ln in text.split("\n") if ln.strip()]

    match_number = ""
    for line in lines:
        m = re.match(r"Tarjeta de partido\s+N[°o]?[:\s]*(\d+)", line, re.IGNORECASE)
        if m:
            match_number = m.group(1)
            break

    fecha_iso = None
    for line in lines:
        dm = re.search(r"(\d{4}-\d{2}-\d{2})", line)
        tm = re.search(r"\b(\d{2}:\d{2})\b", line)
        if dm and tm:
            fecha_iso = f"{dm.group(1)}T{tm.group(1)}:00"
            break

    local_team = visitante_team = ""
    local_score = visitante_score = 0
    skip_kws = {"Cancha", "Torneo", "División", "Tarjeta", "Pos", "Dor", "Tie.", "Instancia"}
    for line in lines:
        if any(kw in line for kw in skip_kws):
            continue
        m = re.match(r"^(.+?)\s+(\d+)\s+(.+?)\s+(\d+)\s*$", line)
        if m:
            s1, s2 = int(m.group(2)), int(m.group(4))
            if 0 <= s1 <= 200 and 0 <= s2 <= 200:
                local_team = m.group(1).strip()
                local_score = s1
                visitante_team = m.group(3).strip()
                visitante_score = s2
                break

    lineup_tables: list = []
    incidencias_tables: list = []
    for tbl in (tables or []):
        if not tbl:
            continue
        first_cells = [str(c or "").strip() for c in tbl[0]]
        if "Pos" in first_cells and "Dor" in first_cells:
            lineup_tables.append(tbl)
        elif "Tie." in first_cells or "Incid." in first_cells:
            incidencias_tables.append(tbl)
        else:
            for row in tbl[1:4]:
                if row and any(str(c or "").strip() in ("1T", "2T") for c in row):
                    incidencias_tables.append(tbl)
                    break

    return {
        "match_number": match_number,
        "local_team": local_team,
        "visitante_team": visitante_team,
        "local_score": local_score,
        "visitante_score": visitante_score,
        "fecha": fecha_iso,
        "lineup_local": _parse_lineup_table(lineup_tables[0]) if lineup_tables else [],
        "lineup_visitante": _parse_lineup_table(lineup_tables[1]) if len(lineup_tables) > 1 else [],
        "incidencias_local": _parse_incidencias(incidencias_tables[0]) if incidencias_tables else [],
        "incidencias_visitante": _parse_incidencias(incidencias_tables[1]) if len(incidencias_tables) > 1 else [],
    }


# ─── POST /import/confirm ─────────────────────────────────────────────────────


class _LineupEntry(BaseModel):
    player_id: uuid.UUID
    jersey_number: int
    position: Optional[str] = None
    team: Literal["user", "rival"] = "user"
    status: Literal["on_field", "bench"] = "on_field"


class _EventEntry(BaseModel):
    tiempo: str
    minuto: int
    tipo: str
    team: Literal["user", "rival"]
    reason: Optional[str] = None
    metadata: dict = {}


class ImportConfirmRequest(BaseModel):
    tournament_id: uuid.UUID
    home_team: str
    away_team: str
    scheduled_at: Optional[datetime] = None
    lineup: list[_LineupEntry]
    events: list[_EventEntry]


@router.post("/confirm")
async def import_confirm(
    body: ImportConfirmRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_club_admin)],
):
    tournament = await db.scalar(select(Tournament).where(Tournament.id == body.tournament_id))
    if not tournament:
        raise HTTPException(status_code=404, detail="Torneo no encontrado")
    if current_user.role != UserRole.superadmin and current_user.club_id != tournament.club_id:
        raise HTTPException(status_code=403, detail="Acceso denegado")

    session = Session(
        id=uuid.uuid4(),
        tournament_id=tournament.id,
        home_team=body.home_team,
        away_team=body.away_team,
        scheduled_at=body.scheduled_at,
        half_duration_minutes=40,
        created_by=current_user.id,
    )
    db.add(session)
    await db.flush()

    db.add(TimerState(id=uuid.uuid4(), session_id=session.id))

    for entry in body.lineup:
        player = await db.scalar(
            select(Player).where(Player.id == entry.player_id, Player.is_active.is_(True))
        )
        if not player:
            raise HTTPException(status_code=404, detail=f"Jugador {entry.player_id} no encontrado")
        db.add(MatchLineup(
            id=uuid.uuid4(),
            session_id=session.id,
            player_id=player.id,
            jersey_number=entry.jersey_number,
            position=entry.position,
            team=entry.team,
            status=LineupStatus(entry.status),
        ))

    now = datetime.now(timezone.utc)
    for ev in body.events:
        half = 1 if ev.tiempo == "1T" else 2
        db.add(Event(
            id=uuid.uuid4(),
            session_id=session.id,
            event_type=ev.tipo,
            half=half,
            timer_seconds=ev.minuto * 60,
            team=ev.team,
            reason=ev.reason,
            metadata_=ev.metadata,
            recorded_by=current_user.id,
            recorded_at=now,
        ))

    await db.commit()
    return {
        "session_id": str(session.id),
        "lineup_count": len(body.lineup),
        "event_count": len(body.events),
    }
