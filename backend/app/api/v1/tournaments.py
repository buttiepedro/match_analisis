import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.permissions import Permission
from app.core.deps import assert_club_access, get_club_or_404, get_current_user, require, require_club_admin
from app.models import Division, Session, Tournament, User
from app.schemas.tournament import TournamentCreate, TournamentResponse, TournamentUpdate

router = APIRouter(prefix="/clubs")


async def _get_tournament_in_club(
    club_id: uuid.UUID,
    tournament_id: uuid.UUID,
    db: AsyncSession,
    current_user: User,
) -> Tournament:
    club = await get_club_or_404(club_id, db)
    assert_club_access(club, current_user)

    tournament = await db.scalar(
        select(Tournament)
        .where(Tournament.id == tournament_id, Tournament.club_id == club.id)
        .options(selectinload(Tournament.division))
    )
    if not tournament:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Torneo no encontrado")
    return tournament


@router.post("/{club_id}/tournaments", response_model=TournamentResponse, status_code=status.HTTP_201_CREATED)
async def create_tournament(
    club_id: uuid.UUID,
    body: TournamentCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.club_torneos))],
):
    club = await get_club_or_404(club_id, db)
    assert_club_access(club, current_user)

    division = await db.scalar(
        select(Division).where(Division.id == body.division_id, Division.club_id == club.id)
    )
    if not division:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Division not found in this club")

    tournament = Tournament(
        id=uuid.uuid4(),
        club_id=club.id,
        division_id=division.id,
        name=body.name,
        season=body.season,
    )
    db.add(tournament)
    await db.commit()

    result = await db.scalar(
        select(Tournament).where(Tournament.id == tournament.id).options(selectinload(Tournament.division))
    )
    return result


@router.get("/{club_id}/tournaments", response_model=list[TournamentResponse])
async def list_tournaments(
    club_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.partido_ver))],
):
    club = await get_club_or_404(club_id, db)
    assert_club_access(club, current_user)

    result = await db.execute(
        select(Tournament)
        .where(Tournament.club_id == club.id, Tournament.is_active.is_(True))
        .options(selectinload(Tournament.division))
        .order_by(Tournament.season.desc(), Tournament.name)
    )
    return result.scalars().all()


@router.get("/{club_id}/tournaments/{tournament_id}", response_model=TournamentResponse)
async def get_tournament(
    club_id: uuid.UUID,
    tournament_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    club = await get_club_or_404(club_id, db)
    assert_club_access(club, current_user)

    tournament = await db.scalar(
        select(Tournament)
        .where(Tournament.id == tournament_id, Tournament.club_id == club.id)
        .options(selectinload(Tournament.division))
    )
    if not tournament:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")
    return tournament


@router.patch("/{club_id}/tournaments/{tournament_id}", response_model=TournamentResponse)
async def update_tournament(
    club_id: uuid.UUID,
    tournament_id: uuid.UUID,
    body: TournamentUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.club_torneos))],
):
    tournament = await _get_tournament_in_club(club_id, tournament_id, db, current_user)

    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="El nombre no puede estar vacío")
        tournament.name = name
    if body.season is not None:
        tournament.season = body.season or None
    if body.is_active is not None:
        tournament.is_active = body.is_active
    if body.division_id is not None:
        division = await db.scalar(
            select(Division).where(
                Division.id == body.division_id,
                Division.club_id == tournament.club_id,
            )
        )
        if not division:
            raise HTTPException(status_code=404, detail="División no encontrada en este club")
        tournament.division_id = division.id

    await db.commit()
    # La sesión no expira al commitear, así que un re-select devolvería la
    # instancia del identity map con la división anterior todavía cargada.
    await db.refresh(tournament, attribute_names=["division"])
    return tournament


@router.delete("/{club_id}/tournaments/{tournament_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tournament(
    club_id: uuid.UUID,
    tournament_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.club_torneos))],
):
    """
    Baja lógica. Se rechaza si el torneo tiene partidos: son la estadística
    histórica del club y borrar el torneo los dejaría inalcanzables.
    """
    tournament = await _get_tournament_in_club(club_id, tournament_id, db, current_user)

    sessions = await db.scalar(
        select(func.count()).select_from(Session).where(Session.tournament_id == tournament.id)
    )
    if sessions:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"El torneo tiene {sessions} partido(s) cargado(s). Eliminalos primero.",
        )

    tournament.is_active = False
    await db.commit()
