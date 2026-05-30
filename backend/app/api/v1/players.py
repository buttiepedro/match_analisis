import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import assert_club_access, get_club_or_404, get_current_user, require_club_admin
from app.models import Division, Player, User
from app.schemas.player import PlayerCreate, PlayerResponse, PlayerUpdate

router = APIRouter(prefix="/divisions")


async def _get_division_or_404(division_id: uuid.UUID, db: AsyncSession) -> Division:
    d = await db.scalar(select(Division).where(Division.id == division_id))
    if not d:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Division not found")
    return d


@router.post("/{division_id}/players", response_model=PlayerResponse, status_code=status.HTTP_201_CREATED)
async def create_player(
    division_id: uuid.UUID,
    body: PlayerCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_club_admin)],
):
    division = await _get_division_or_404(division_id, db)
    club = await get_club_or_404(division.club_id, db)
    assert_club_access(club, current_user)

    player = Player(
        id=uuid.uuid4(),
        division_id=division.id,
        name=body.name,
        position=body.position,
    )
    db.add(player)
    await db.commit()
    await db.refresh(player)
    return player


@router.get("/{division_id}/players", response_model=list[PlayerResponse])
async def list_players(
    division_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    division = await _get_division_or_404(division_id, db)
    club = await get_club_or_404(division.club_id, db)
    assert_club_access(club, current_user)

    result = await db.execute(
        select(Player)
        .where(Player.division_id == division.id, Player.is_active.is_(True))
        .order_by(Player.name)
    )
    return result.scalars().all()


@router.patch("/{division_id}/players/{player_id}", response_model=PlayerResponse)
async def update_player(
    division_id: uuid.UUID,
    player_id: uuid.UUID,
    body: PlayerUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_club_admin)],
):
    division = await _get_division_or_404(division_id, db)
    club = await get_club_or_404(division.club_id, db)
    assert_club_access(club, current_user)

    player = await db.scalar(
        select(Player).where(Player.id == player_id, Player.division_id == division.id)
    )
    if not player:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Player not found")

    if body.name is not None:
        player.name = body.name
    if body.position is not None:
        player.position = body.position
    if body.is_active is not None:
        player.is_active = body.is_active

    await db.commit()
    await db.refresh(player)
    return player


@router.delete("/{division_id}/players/{player_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_player(
    division_id: uuid.UUID,
    player_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_club_admin)],
):
    division = await _get_division_or_404(division_id, db)
    club = await get_club_or_404(division.club_id, db)
    assert_club_access(club, current_user)

    player = await db.scalar(
        select(Player).where(Player.id == player_id, Player.division_id == division.id)
    )
    if not player:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Player not found")

    player.is_active = False
    await db.commit()
