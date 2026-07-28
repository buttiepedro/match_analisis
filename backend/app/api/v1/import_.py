import io
import re
import unicodedata
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Annotated, Literal, Optional

import openpyxl
import pdfplumber
import xlrd
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.permissions import Permission
from app.core.deps import get_current_user, require
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
        raw_doc = cells[3] if len(cells) > 3 else ""
        doc_num = re.sub(r"\D", "", raw_doc)
        players.append({
            "pos": pos,
            "dor": dor,
            "nombre_pdf": nombre_raw,
            "nombre_norm": _normalize_name(nombre_raw),
            "status": "on_field" if pos <= 15 else "bench",
            "doc_num": doc_num,
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
    _date_time_re = re.compile(r"\d{4}-\d{2}-\d{2}|\b\d{2}:\d{2}\b")
    for line in lines:
        if any(kw in line for kw in skip_kws):
            continue
        # skip header info lines that contain date/time patterns (they can false-match)
        if _date_time_re.search(line):
            continue
        m = re.match(r"^([A-ZÁÉÍÓÚÑa-záéíóúñ\s]+?)\s+(\d+)\s+([A-ZÁÉÍÓÚÑa-záéíóúñ\s]+?)\s+(\d+)\s*$", line)
        if m:
            s1, s2 = int(m.group(2)), int(m.group(4))
            if 0 <= s1 <= 150 and 0 <= s2 <= 150:
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
    dni: Optional[str] = None


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
    current_user: Annotated[User, Depends(require(Permission.partido_eventos))],
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
        if entry.dni and not player.dni:
            player.dni = entry.dni
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


# ─── Rugby positions catalogue ────────────────────────────────────────────────

RUGBY_POSITIONS: list[str] = [
    "01 - Pilar izquierdo",
    "02 - Hooker",
    "03 - Pilar derecho",
    "04 - Segundo línea",
    "05 - Segundo línea",
    "06 - Ala",
    "07 - Ala",
    "08 - Octavo",
    "09 - Medio scrum",
    "10 - Apertura",
    "11 - Wing izquierdo",
    "12 - Centro",
    "13 - Centro",
    "14 - Wing derecho",
    "15 - Full back",
]

# Map número (str) → posición estándar
_POS_BY_NUM: dict[str, str] = {p.split(" - ")[0].lstrip("0") or "0": p for p in RUGBY_POSITIONS}
_POS_BY_NUM.update({p.split(" - ")[0]: p for p in RUGBY_POSITIONS})  # con cero: "01", "02" …

# Map nombre normalizado → posición estándar (primera coincidencia gana)
_POS_BY_NAME: dict[str, str] = {}
for _p in RUGBY_POSITIONS:
    _key = unicodedata.normalize("NFKD", _p.split(" - ", 1)[1]).encode("ascii", "ignore").decode().lower()
    if _key not in _POS_BY_NAME:
        _POS_BY_NAME[_key] = _p


def _normalize_str(s: str) -> str:
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower().strip()


def _map_position(raw: str) -> Optional[str]:
    """Convert any position string from the file to a standard RUGBY_POSITIONS entry."""
    raw = raw.strip()
    if not raw:
        return None
    # Format "03 - Pilar derecho" — extract leading number
    m = re.match(r"^0*(\d+)\s*[-–]?\s*(.*)", raw)
    if m:
        num = m.group(1)
        name_part = m.group(2).strip()
        # Try by number first
        candidate = _POS_BY_NUM.get(num) or _POS_BY_NUM.get(num.zfill(2))
        if candidate:
            return candidate
        # Fallback to name
        if name_part:
            norm = _normalize_str(name_part)
            return _POS_BY_NAME.get(norm)
    # Plain name
    return _POS_BY_NAME.get(_normalize_str(raw))


# ─── Excel reader ─────────────────────────────────────────────────────────────

# Column aliases → internal key
_COL_ALIASES: dict[str, str] = {
    "documento": "dni",
    "doc": "dni",
    "dni": "dni",
    "apellido": "last_name",
    "nombre": "first_name",
    "fecha nac.": "date_of_birth",
    "fecha nac": "date_of_birth",
    "fecha de nacimiento": "date_of_birth",
    "nacimiento": "date_of_birth",
    "sexo": "sex",
    "genero": "sex",
    "género": "sex",
    "o.social": "obra_social",
    "obra social": "obra_social",
    "obrasocial": "obra_social",
    "peso": "weight_kg",
    "estatura": "height_cm",
    "altura": "height_cm",
    "talla": "height_cm",
    "puesto": "position",
    "posicion": "position",
    "posición": "position",
    "email": "email",
    "correo": "email",
    "correo electronico": "email",
    "correo electrónico": "email",
    "tel.emergencia": "emergency_phone",
    "tel. emergencia": "emergency_phone",
    "telefono emergencia": "emergency_phone",
    "teléfono emergencia": "emergency_phone",
    "emergencia": "emergency_phone",
    "celular": "phone",
    "telefono": "phone",
    "teléfono": "phone",
    "movil": "phone",
    "móvil": "phone",
}


def _norm_col(s: str) -> str:
    return _normalize_str(s)


def _read_xlsx(content: bytes) -> list[dict]:
    wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    wb.close()
    return rows


def _read_xls(content: bytes) -> list[dict]:
    wb = xlrd.open_workbook(file_contents=content)
    ws = wb.sheet_by_index(0)
    return [ws.row_values(i) for i in range(ws.nrows)]


def _parse_date(val) -> Optional[date]:
    if val is None:
        return None
    if isinstance(val, (datetime,)):
        return val.date()
    if isinstance(val, date):
        return val
    s = str(val).strip()
    if not s:
        return None
    # xlrd stores dates as floats — handle via xlrd if needed (already converted in _read_xls)
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    return None


def _parse_weight(val) -> Optional[Decimal]:
    if val is None:
        return None
    s = re.sub(r"[^\d.,]", "", str(val)).replace(",", ".")
    try:
        return Decimal(s)
    except InvalidOperation:
        return None


def _parse_height(val) -> Optional[Decimal]:
    """Accepts 1.73, 1,73 (meters) or 173 (cm). Always returns cm."""
    if val is None:
        return None
    s = re.sub(r"[^\d.,]", "", str(val)).replace(",", ".")
    try:
        v = Decimal(s)
        # If value looks like meters (< 3), convert to cm
        if v < Decimal("3"):
            v = v * 100
        return v.quantize(Decimal("0.1"))
    except InvalidOperation:
        return None


def _parse_sex(val) -> Optional[str]:
    if val is None:
        return None
    s = str(val).strip().upper()
    if s in ("M", "MASCULINO", "MALE", "H", "HOMBRE"):
        return "M"
    if s in ("F", "FEMENINO", "FEMALE", "MUJER"):
        return "F"
    return None


def _rows_to_dicts(raw_rows: list) -> list[dict]:
    """Map raw rows to list of normalised dicts using column aliases."""
    if not raw_rows:
        return []
    # Find header row (first row with at least 3 non-empty cells)
    header_idx = 0
    for i, row in enumerate(raw_rows[:5]):
        filled = sum(1 for c in row if c is not None and str(c).strip())
        if filled >= 3:
            header_idx = i
            break

    header = [_norm_col(str(c or "")) for c in raw_rows[header_idx]]
    col_map: dict[int, str] = {}
    for idx, h in enumerate(header):
        key = _COL_ALIASES.get(h)
        if key and key not in col_map.values():
            col_map[idx] = key

    records = []
    for row in raw_rows[header_idx + 1:]:
        if not any(c for c in row if c is not None and str(c).strip()):
            continue
        rec: dict = {}
        for idx, key in col_map.items():
            rec[key] = row[idx] if idx < len(row) else None
        records.append(rec)
    return records


# ─── POST /import/players-xlsx ────────────────────────────────────────────────

from app.models import Division  # noqa: E402 — avoids circular at module top


@router.post("/players-xlsx")
async def import_players_xlsx(
    file: Annotated[UploadFile, File(...)],
    division_id: Annotated[uuid.UUID, Form(...)],
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.plantel_importar))],
):
    fname = (file.filename or "").lower()
    if not (fname.endswith(".xlsx") or fname.endswith(".xls")):
        raise HTTPException(status_code=400, detail="Solo se aceptan archivos .xlsx o .xls")

    division = await db.scalar(select(Division).where(Division.id == division_id))
    if not division:
        raise HTTPException(status_code=404, detail="División no encontrada")
    if current_user.role != UserRole.superadmin and current_user.club_id != division.club_id:
        raise HTTPException(status_code=403, detail="Acceso denegado")

    content = await file.read()
    try:
        raw_rows = _read_xlsx(content) if fname.endswith(".xlsx") else _read_xls(content)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"No se pudo leer el archivo: {e}")

    records = _rows_to_dicts(raw_rows)
    if not records:
        raise HTTPException(status_code=422, detail="El archivo no contiene filas de datos")

    created = updated = skipped = 0
    errors: list[dict] = []

    for row_num, rec in enumerate(records, start=2):
        # Compose name from apellido + nombre
        first = str(rec.get("first_name") or "").strip()
        last = str(rec.get("last_name") or "").strip()
        if first and last:
            name = f"{last} {first}"
        elif first:
            name = first
        elif last:
            name = last
        else:
            errors.append({"row": row_num, "reason": "Sin nombre ni apellido"})
            skipped += 1
            continue

        dni_raw = str(rec.get("dni") or "").strip()
        dni = re.sub(r"\D", "", dni_raw) or None

        pos_raw = str(rec.get("position") or "").strip()
        position = _map_position(pos_raw) if pos_raw else None

        dob = _parse_date(rec.get("date_of_birth"))
        sex = _parse_sex(rec.get("sex"))
        email = str(rec.get("email") or "").strip() or None
        phone = str(rec.get("phone") or "").strip() or None
        emergency = str(rec.get("emergency_phone") or "").strip() or None
        obra = str(rec.get("obra_social") or "").strip() or None
        weight = _parse_weight(rec.get("weight_kg"))
        height = _parse_height(rec.get("height_cm"))

        # Try to find existing player by DNI within the club's divisions
        existing: Optional[Player] = None
        if dni:
            # Search all divisions of the same club
            from app.models import Division as DivModel
            club_divisions = (await db.execute(
                select(DivModel.id).where(DivModel.club_id == division.club_id, DivModel.is_active.is_(True))
            )).scalars().all()
            existing = await db.scalar(
                select(Player).where(
                    Player.dni == dni,
                    Player.division_id.in_(club_divisions),
                    Player.is_active.is_(True),
                )
            )

        if existing:
            # Update existing player
            existing.name = name
            if position:
                existing.position = position
            if dob:
                existing.date_of_birth = dob
            if sex:
                existing.sex = sex
            if email:
                existing.email = email
            if phone:
                existing.phone = phone
            if emergency:
                existing.emergency_phone = emergency
            if obra:
                existing.obra_social = obra
            # Move to target division if different
            if existing.division_id != division_id:
                existing.division_id = division_id
            updated += 1
        else:
            player = Player(
                id=uuid.uuid4(),
                division_id=division_id,
                name=name,
                position=position,
                dni=dni,
                date_of_birth=dob,
                sex=sex,
                email=email,
                phone=phone,
                emergency_phone=emergency,
                obra_social=obra,
            )
            db.add(player)
            created += 1

        # If weight or height present, create a measurement for today
        if weight or height:
            from app.models.player import PlayerMeasurement
            db.add(PlayerMeasurement(
                player_id=existing.id if existing else player.id,  # type: ignore[possibly-unbound]
                measured_at=date.today(),
                weight_kg=weight,
                height_cm=height,
                recorded_by=current_user.id,
            ))

    try:
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Error al guardar: {e}")

    return {
        "created": created,
        "updated": updated,
        "skipped": skipped,
        "errors": errors,
        "total_rows": len(records),
    }
