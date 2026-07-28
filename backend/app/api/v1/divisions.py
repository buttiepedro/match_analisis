import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.permissions import Permission
from app.core.deps import assert_club_access, get_club_or_404, get_current_user, require
from app.models import Division, Player, Tournament, User
from app.schemas.division import DivisionCreate, DivisionResponse, DivisionUpdate

router = APIRouter(prefix="/clubs")


async def _get_division_in_club(
    club_id: uuid.UUID,
    division_id: uuid.UUID,
    db: AsyncSession,
    current_user: User,
) -> Division:
    club = await get_club_or_404(club_id, db)
    assert_club_access(club, current_user)

    division = await db.scalar(
        select(Division).where(Division.id == division_id, Division.club_id == club.id)
    )
    if not division:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="División no encontrada")
    return division


@router.post("/{club_id}/divisions", response_model=DivisionResponse, status_code=status.HTTP_201_CREATED)
async def create_division(
    club_id: uuid.UUID,
    body: DivisionCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.club_divisiones))],
):
    club = await get_club_or_404(club_id, db)
    assert_club_access(club, current_user)

    division = Division(id=uuid.uuid4(), club_id=club.id, name=body.name)
    db.add(division)
    await db.commit()
    await db.refresh(division)
    return division


@router.get("/{club_id}/divisions", response_model=list[DivisionResponse])
async def list_divisions(
    club_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.plantel_ver))],
):
    club = await get_club_or_404(club_id, db)
    assert_club_access(club, current_user)

    result = await db.execute(
        select(Division)
        .where(Division.club_id == club.id, Division.is_active.is_(True))
        .order_by(Division.name)
    )
    return result.scalars().all()


@router.patch("/{club_id}/divisions/{division_id}", response_model=DivisionResponse)
async def update_division(
    club_id: uuid.UUID,
    division_id: uuid.UUID,
    body: DivisionUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.club_divisiones))],
):
    division = await _get_division_in_club(club_id, division_id, db, current_user)

    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="El nombre no puede estar vacío")
        division.name = name
    if body.is_active is not None:
        division.is_active = body.is_active

    await db.commit()
    await db.refresh(division)
    return division


@router.delete("/{club_id}/divisions/{division_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_division(
    club_id: uuid.UUID,
    division_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.club_divisiones))],
):
    """
    Baja lógica. Se rechaza si todavía cuelgan jugadores o torneos: dejar una
    división archivada con contenido activo esconde datos sin borrarlos, que es
    peor que no poder borrarla.
    """
    division = await _get_division_in_club(club_id, division_id, db, current_user)

    players = await db.scalar(
        select(func.count())
        .select_from(Player)
        .where(Player.division_id == division.id, Player.is_active.is_(True))
    )
    if players:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"La división tiene {players} jugador(es) activo(s). Movelos a otra división primero.",
        )

    tournaments = await db.scalar(
        select(func.count())
        .select_from(Tournament)
        .where(Tournament.division_id == division.id, Tournament.is_active.is_(True))
    )
    if tournaments:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"La división tiene {tournaments} torneo(s) activo(s). Eliminalos primero.",
        )

    division.is_active = False
    await db.commit()
