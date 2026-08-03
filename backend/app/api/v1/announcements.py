"""
Comunicados del club: novedades de texto simple, del club entero o de una
división puntual.

Leerlos no exige ningún permiso — cualquier autenticado del club los ve,
igual que la bandeja de notificaciones. Lo que varía por usuario es **cuáles**
ve: un socio sin ficha de jugador y sin alcance de staff sólo ve los del club
entero; un jugador suma los de su propia división; el staff suma los de las
divisiones que puede gestionar (todas, si no tiene alcance restringido).
"""
import logging
import uuid
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import (
    assert_club_access,
    get_club_or_404,
    get_current_user,
    get_division_or_404,
    has_permission,
    require,
    scoped_division_ids,
)
from app.core.notifications import notify
from app.core.permissions import Permission
from app.models import Announcement, Division, NotificationType, Player, User, UserRole
from app.schemas.announcement import AnnouncementCreate, AnnouncementResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/clubs")


def _to_response(announcement: Announcement) -> AnnouncementResponse:
    return AnnouncementResponse(
        id=announcement.id,
        title=announcement.title,
        body=announcement.body,
        division_id=announcement.division_id,
        division_name=announcement.division.name if announcement.division else None,
        created_by=announcement.created_by,
        author_name=announcement.author.full_name,
        created_at=announcement.created_at,
    )


async def _visible_division_scope(current_user: User, db: AsyncSession) -> Optional[set[uuid.UUID]]:
    """
    `None` = sin filtro extra, ve comunicados de cualquier división además de
    los del club entero. Si no, el set de divisiones que suma a los del club
    entero (puede ser un set vacío: sólo ve los del club entero).

    Staff (tiene `plantel.ver`, que ni Jugador ni Socio traen en sus presets)
    usa el mismo alcance que el resto del sistema. Jugador suma su propia
    división. Socio sin ficha de jugador no suma ninguna.
    """
    if current_user.role == UserRole.superadmin:
        return None
    if has_permission(current_user, Permission.plantel_ver):
        return scoped_division_ids(current_user)
    division_id = await db.scalar(select(Player.division_id).where(Player.user_id == current_user.id))
    return {division_id} if division_id else set()


async def _notify_announcement(division: Division, announcement: Announcement, db: AsyncSession) -> None:
    """Mismo criterio que `_notify_formation_loaded`: un fallo acá no tira abajo la publicación."""
    try:
        recipients = (
            await db.execute(
                select(Player.user_id).where(
                    Player.division_id == division.id, Player.user_id.isnot(None)
                )
            )
        ).scalars().all()

        for user_id in recipients:
            await notify(
                db,
                user_id=user_id,
                club_id=division.club_id,
                type=NotificationType.comunicado_publicado,
                title=announcement.title,
                body=f"Nuevo comunicado de {division.name}.",
                data={"url": "/comunicados"},
            )
    except Exception:
        logger.exception("No se pudo notificar el comunicado %s", announcement.id)


@router.post(
    "/{club_id}/announcements",
    response_model=AnnouncementResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_announcement(
    club_id: uuid.UUID,
    body: AnnouncementCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.club_comunicados_publicar))],
):
    club = await get_club_or_404(club_id, db)
    assert_club_access(club, current_user)

    division = None
    if body.division_id:
        division = await get_division_or_404(body.division_id, db, current_user)

    announcement = Announcement(
        id=uuid.uuid4(),
        club_id=club.id,
        division_id=division.id if division else None,
        title=body.title.strip(),
        body=body.body.strip(),
        created_by=current_user.id,
    )
    db.add(announcement)
    await db.commit()
    await db.refresh(announcement, attribute_names=["division", "author"])

    if division:
        await _notify_announcement(division, announcement, db)

    return _to_response(announcement)


@router.get("/{club_id}/announcements", response_model=list[AnnouncementResponse])
async def list_announcements(
    club_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    limit: Annotated[int, Query(le=100)] = 30,
):
    club = await get_club_or_404(club_id, db)
    assert_club_access(club, current_user)

    scope = await _visible_division_scope(current_user, db)
    query = select(Announcement).where(Announcement.club_id == club.id)
    if scope is not None:
        query = query.where(or_(Announcement.division_id.is_(None), Announcement.division_id.in_(scope)))

    query = query.order_by(Announcement.created_at.desc()).limit(limit)
    rows = (await db.execute(query)).scalars().all()
    return [_to_response(a) for a in rows]


@router.delete("/{club_id}/announcements/{announcement_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_announcement(
    club_id: uuid.UUID,
    announcement_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.club_comunicados_publicar))],
):
    club = await get_club_or_404(club_id, db)
    assert_club_access(club, current_user)

    announcement = await db.scalar(
        select(Announcement).where(Announcement.id == announcement_id, Announcement.club_id == club.id)
    )
    if not announcement:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comunicado no encontrado")

    # Cualquiera con el permiso publica; borrar el de otro es cosa de quien
    # administra los usuarios del club, no de cualquier publicador.
    if announcement.created_by != current_user.id and not has_permission(current_user, Permission.club_usuarios):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Sólo quien lo publicó, o un administrador, puede borrarlo",
        )

    await db.delete(announcement)
    await db.commit()
