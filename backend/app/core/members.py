"""
Sincronización del padrón de socios.

El importador de Excel y el futuro cliente de API **no** son dos
implementaciones: los dos arman una lista de `MemberRow` y llaman a
`sync_members`. Cuando el sistema contable exponga el endpoint, lo que se escribe
es un parser — no una reescritura.
"""
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.permissions import SOCIO
from app.core.roles import seed_club_roles
from app.core.security import get_password_hash
from app.models import Member, User, UserRole, user_roles

#: Un import que desactive más de esta proporción del padrón se rechaza sin
#: `force`. El error probable en una sincronización semanal es el archivo
#: equivocado, y es el más caro.
MASS_DEACTIVATION_THRESHOLD = 0.20


@dataclass
class MemberRow:
    """Una fila del padrón, ya normalizada. La produce el parser, sea cual sea."""

    document_id: str
    full_name: str
    dues_up_to_date: bool
    category: Optional[str] = None
    member_number: Optional[str] = None
    email: Optional[str] = None
    joined_on: Optional[date] = None


@dataclass
class SyncPreview:
    """Qué haría el import. Con `dry_run` se devuelve sin escribir nada."""

    created: list[str] = field(default_factory=list)
    updated: list[str] = field(default_factory=list)
    #: Por **nombre**, no por id: quien confirma tiene que poder reconocerlos.
    deactivated: list[str] = field(default_factory=list)
    total_rows: int = 0
    errors: list[dict] = field(default_factory=list)

    @property
    def deactivation_ratio(self) -> float:
        total = len(self.created) + len(self.updated) + len(self.deactivated)
        return len(self.deactivated) / total if total else 0.0


class MassDeactivation(Exception):
    """Freno de mano: el import daría de baja a demasiada gente."""

    def __init__(self, preview: SyncPreview):
        self.preview = preview
        super().__init__(
            f"El import daría de baja a {len(preview.deactivated)} socio(s), "
            f"{preview.deactivation_ratio:.0%} del padrón."
        )


async def sync_members(
    club_id: uuid.UUID,
    rows: list[MemberRow],
    db: AsyncSession,
    *,
    default_password: str,
    run_by: Optional[uuid.UUID] = None,
    dry_run: bool = False,
    force: bool = False,
) -> SyncPreview:
    """
    Sincroniza el padrón. **Idempotente**: correr el mismo archivo dos veces deja
    el mismo estado.

    Reglas:
    - Match por DNI dentro del club.
    - Existe → se actualiza. **La contraseña no se toca**: re-importar no puede
      sacarle el acceso a nadie.
    - No existe → se crea el socio y su cuenta, con cambio de contraseña forzado.
    - Está en la base y no en el archivo → inactivo. Nunca se borra.
    """
    preview = SyncPreview(total_rows=len(rows))

    # `selectinload` y no `join`: el join filtra pero no trae la relación, y
    # tocarla después dispara lazy loading, que en async explota.
    existing = {
        m.user.document_id: m
        for m in (
            await db.execute(
                select(Member)
                .where(Member.club_id == club_id)
                .options(selectinload(Member.user))
            )
        ).scalars().all()
        if m.user.document_id
    }

    incoming = {r.document_id for r in rows}
    now = datetime.now(timezone.utc)

    for row in rows:
        member = existing.get(row.document_id)
        if member:
            preview.updated.append(row.full_name)
        else:
            preview.created.append(row.full_name)

    for document_id, member in existing.items():
        if document_id not in incoming and member.is_active:
            preview.deactivated.append(member.full_name)

    if not force and preview.deactivation_ratio > MASS_DEACTIVATION_THRESHOLD:
        raise MassDeactivation(preview)

    if dry_run:
        return preview

    socio_role_id = await _socio_role_id(club_id, db)

    for row in rows:
        member = existing.get(row.document_id)
        if member:
            member.full_name = row.full_name
            member.category = row.category or member.category
            member.member_number = row.member_number or member.member_number
            member.dues_up_to_date = row.dues_up_to_date
            # Se actualiza **siempre**, cambie o no el estado: la pregunta que
            # responde es "¿de cuándo es este dato?", no "¿cuándo cambió?".
            member.dues_synced_at = now
            member.is_active = True
            if row.email and not member.user.email:
                member.user.email = row.email
        else:
            account = User(
                id=uuid.uuid4(),
                club_id=club_id,
                email=row.email or None,
                document_id=row.document_id,
                password_hash=get_password_hash(default_password),
                must_change_password=True,
                full_name=row.full_name,
                role=UserRole.player,  # placeholder del enum viejo; manda el rol Socio
            )
            db.add(account)
            await db.flush()

            if socio_role_id:
                await db.execute(
                    user_roles.insert().values(user_id=account.id, role_id=socio_role_id)
                )

            db.add(
                Member(
                    id=uuid.uuid4(),
                    club_id=club_id,
                    user_id=account.id,
                    full_name=row.full_name,
                    category=row.category,
                    member_number=row.member_number,
                    joined_on=row.joined_on,
                    dues_up_to_date=row.dues_up_to_date,
                    dues_synced_at=now,
                    is_active=True,
                )
            )

    for document_id, member in existing.items():
        if document_id not in incoming and member.is_active:
            member.is_active = False

    await db.flush()
    return preview


async def _socio_role_id(club_id: uuid.UUID, db: AsyncSession) -> Optional[uuid.UUID]:
    roles = await seed_club_roles(club_id, db)
    role = roles.get(SOCIO)
    return role.id if role else None
