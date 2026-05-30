import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.deps import assert_club_access, get_club_or_404, get_current_user, require_club_admin
from app.models import Division, Tournament, User
from app.schemas.tournament import TournamentCreate, TournamentResponse

router = APIRouter(prefix="/clubs")


@router.post("/{club_id}/tournaments", response_model=TournamentResponse, status_code=status.HTTP_201_CREATED)
async def create_tournament(
    club_id: uuid.UUID,
    body: TournamentCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_club_admin)],
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
    current_user: Annotated[User, Depends(get_current_user)],
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
