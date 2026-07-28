"""
Socios: padrón importable y estado de cuota.

La app **espeja** el estado que le da el sistema contable del club; no lo calcula
ni registra pagos.
"""
import io
import unicodedata
import uuid
from datetime import date, datetime
from typing import Annotated, Any, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.deps import assert_club_access, get_club_or_404, get_current_user, require
from app.core.members import MassDeactivation, MemberRow, sync_members
from app.core.permissions import Permission
from app.models import Member, MemberImport, User
from app.schemas.member import (
    MemberImportResult,
    MemberImportLogEntry,
    MemberResponse,
    MyMembershipResponse,
)

router = APIRouter()


# ── Parser de Excel ───────────────────────────────────────────────────────────

def _normalize(text: Any) -> str:
    """
    Minúsculas, sin acentos y **sin puntuación**, para machear encabezados.

    La puntuación importa: un padrón real trae `N° Socio` y `Nro.`, y el `°` no es
    un acento —sobrevive a NFD— así que sin sacarlo la columna no matchea nunca.
    """
    s = str(text or "").strip().lower()
    s = "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")
    s = "".join(c if c.isalnum() else " " for c in s)
    return " ".join(s.split())


#: Encabezados reconocidos por campo. El club exporta desde su sistema y nadie va
#: a renombrar columnas para que la app las lea.
HEADERS = {
    "document_id": {"dni", "documento", "nro documento", "n documento", "num documento"},
    "full_name": {"apellido y nombre", "nombre", "nombre y apellido", "socio"},
    "dues_up_to_date": {"al dia", "estado cuota", "estado", "cuota"},
    "category": {"categoria", "tipo socio", "tipo"},
    "member_number": {"n socio", "nro socio", "numero socio", "socio nro", "n de socio"},
    "email": {"email", "e mail", "correo"},
    "joined_on": {"fecha alta", "alta", "fecha de alta"},
}

#: Lo que el sistema contable puede escribir para "está al día".
TRUTHY = {"si", "sí", "s", "1", "true", "verdadero", "al dia", "ok", "x"}
FALSY = {"no", "n", "0", "false", "falso", "deudor", "debe", "moroso"}


def _parse_bool(raw: Any) -> Optional[bool]:
    value = _normalize(raw)
    if value in TRUTHY:
        return True
    if value in FALSY:
        return False
    return None


def _parse_date(raw: Any) -> Optional[date]:
    if raw in (None, ""):
        return None
    if isinstance(raw, datetime):
        return raw.date()
    if isinstance(raw, date):
        return raw
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(str(raw).strip(), fmt).date()
        except ValueError:
            continue
    return None


def parse_padron(content: bytes) -> tuple[list[MemberRow], list[dict]]:
    """
    Excel → filas normalizadas + errores por fila.

    Una fila mala **no descarta el import**: se importa el resto y se reporta qué
    quedó afuera con su número de fila.
    """
    try:
        from openpyxl import load_workbook
    except ImportError:  # pragma: no cover
        raise HTTPException(status_code=501, detail="openpyxl no está instalado")

    try:
        wb = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    except Exception:
        raise HTTPException(status_code=400, detail="No se pudo leer el archivo como Excel")

    sheet = wb[wb.sheetnames[0]]
    rows_iter = sheet.iter_rows(values_only=True)

    try:
        header = next(rows_iter)
    except StopIteration:
        raise HTTPException(status_code=400, detail="El archivo está vacío")

    column_of: dict[str, int] = {}
    for index, cell in enumerate(header):
        name = _normalize(cell)
        for field, aliases in HEADERS.items():
            if name in aliases and field not in column_of:
                column_of[field] = index

    missing = [f for f in ("document_id", "full_name", "dues_up_to_date") if f not in column_of]
    if missing:
        raise HTTPException(
            status_code=400,
            detail=(
                "Faltan columnas obligatorias en el archivo: "
                + ", ".join({"document_id": "DNI", "full_name": "Nombre",
                             "dues_up_to_date": "Al día"}[f] for f in missing)
            ),
        )

    def cell(row: tuple, field: str) -> Any:
        index = column_of.get(field)
        return row[index] if index is not None and index < len(row) else None

    parsed: list[MemberRow] = []
    errors: list[dict] = []
    seen: set[str] = set()

    for number, row in enumerate(rows_iter, start=2):
        if row is None or all(c in (None, "") for c in row):
            continue

        document_id = str(cell(row, "document_id") or "").strip().replace(".", "")
        full_name = str(cell(row, "full_name") or "").strip()
        dues = _parse_bool(cell(row, "dues_up_to_date"))

        if not document_id:
            errors.append({"row": number, "reason": "Sin DNI"})
            continue
        if not full_name:
            errors.append({"row": number, "reason": "Sin nombre"})
            continue
        if dues is None:
            errors.append({"row": number, "reason": "Estado de cuota ilegible"})
            continue
        if document_id in seen:
            errors.append({"row": number, "reason": f"DNI {document_id} repetido en el archivo"})
            continue

        seen.add(document_id)
        parsed.append(
            MemberRow(
                document_id=document_id,
                full_name=full_name,
                dues_up_to_date=dues,
                category=str(cell(row, "category") or "").strip() or None,
                member_number=str(cell(row, "member_number") or "").strip() or None,
                email=str(cell(row, "email") or "").strip() or None,
                joined_on=_parse_date(cell(row, "joined_on")),
            )
        )

    return parsed, errors


# ── Import ────────────────────────────────────────────────────────────────────

@router.post("/clubs/{club_id}/members/import", response_model=MemberImportResult)
async def import_members(
    club_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.socios_importar))],
    file: Annotated[UploadFile, File()],
    default_password: Annotated[str, Form()] = "",
    dry_run: Annotated[bool, Query()] = False,
    force: Annotated[bool, Query()] = False,
):
    """
    Sincroniza el padrón desde un Excel.

    Con `dry_run` devuelve qué haría **sin escribir**. Un import que daría de baja
    a más del 20% se rechaza salvo `force`: el error probable en una sincronización
    semanal es el archivo equivocado.
    """
    club = await get_club_or_404(club_id, db)
    assert_club_access(club, current_user)

    if not dry_run and len(default_password) < 8:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="La contraseña por defecto necesita al menos 8 caracteres",
        )

    rows, errors = parse_padron(await file.read())

    try:
        preview = await sync_members(
            club.id,
            rows,
            db,
            default_password=default_password,
            run_by=current_user.id,
            dry_run=dry_run,
            force=force,
        )
    except MassDeactivation as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"{exc}. Si el archivo es correcto, reintentá con force=true. "
                f"Se darían de baja: {', '.join(exc.preview.deactivated[:10])}"
            ),
        )

    preview.errors = errors

    if not dry_run:
        db.add(
            MemberImport(
                id=uuid.uuid4(),
                club_id=club.id,
                source="xlsx",
                created_count=len(preview.created),
                updated_count=len(preview.updated),
                deactivated_count=len(preview.deactivated),
                total_rows=preview.total_rows,
                errors=errors or None,
                run_by=current_user.id,
            )
        )
        await db.commit()

    return MemberImportResult(
        dry_run=dry_run,
        created=preview.created,
        updated=preview.updated,
        deactivated=preview.deactivated,
        total_rows=preview.total_rows,
        errors=errors,
    )


@router.get("/clubs/{club_id}/member-imports", response_model=list[MemberImportLogEntry])
async def list_member_imports(
    club_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.socios_importar))],
):
    club = await get_club_or_404(club_id, db)
    assert_club_access(club, current_user)
    result = await db.execute(
        select(MemberImport)
        .where(MemberImport.club_id == club.id)
        .order_by(MemberImport.created_at.desc())
        .limit(30)
    )
    return result.scalars().all()


# ── Padrón ────────────────────────────────────────────────────────────────────

@router.get("/clubs/{club_id}/members", response_model=list[MemberResponse])
async def list_members(
    club_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.socios_ver_todas))],
    search: Annotated[Optional[str], Query()] = None,
    only_debtors: Annotated[bool, Query()] = False,
):
    club = await get_club_or_404(club_id, db)
    assert_club_access(club, current_user)

    query = (
        select(Member)
        .where(Member.club_id == club.id, Member.is_active.is_(True))
        .options(selectinload(Member.user))
    )
    if only_debtors:
        query = query.where(Member.dues_up_to_date.is_(False))

    members = (await db.execute(query.order_by(Member.full_name))).scalars().all()

    if search:
        needle = _normalize(search)
        members = [
            m
            for m in members
            if needle in _normalize(m.full_name)
            or needle in (m.member_number or "")
            or needle in (m.user.document_id or "")
        ]

    return [
        MemberResponse(
            id=m.id,
            full_name=m.full_name,
            document_id=m.user.document_id,
            category=m.category,
            member_number=m.member_number,
            dues_up_to_date=m.dues_up_to_date,
            dues_synced_at=m.dues_synced_at,
        )
        for m in members
    ]


@router.get("/me/membership", response_model=MyMembershipResponse)
async def my_membership(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """
    Estado propio del socio.

    Devuelve **siempre** `dues_synced_at`: sin la fecha, "estás al día" es un dato
    sin contexto que el socio puede tomar por actual cuando tiene tres semanas.
    """
    member = await db.scalar(select(Member).where(Member.user_id == current_user.id))
    if not member:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Este usuario no está vinculado a ningún socio",
        )
    return MyMembershipResponse(
        full_name=member.full_name,
        member_number=member.member_number,
        category=member.category,
        dues_up_to_date=member.dues_up_to_date,
        dues_synced_at=member.dues_synced_at,
        is_active=member.is_active,
    )
