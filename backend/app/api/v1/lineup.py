import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.deps import get_current_user, require_club_admin
from app.models import Event, MatchLineup, Player, Session, Tournament, User, UserRole
from app.models.player import LineupStatus
from app.schemas.player import LineupEntryCreate, LineupEntryResponse, SubstituteRequest
from app.ws.manager import manager

router = APIRouter(prefix="/sessions")


async def _get_session_and_check_access(
    session_id: uuid.UUID, db: AsyncSession, current_user: User
) -> Session:
    session = await db.scalar(select(Session).where(Session.id == session_id))
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    tournament = await db.scalar(select(Tournament).where(Tournament.id == session.tournament_id))
    if current_user.role != UserRole.superadmin and current_user.club_id != tournament.club_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    return session


@router.post("/{session_id}/lineup", response_model=LineupEntryResponse, status_code=status.HTTP_201_CREATED)
async def add_to_lineup(
    session_id: uuid.UUID,
    body: LineupEntryCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_club_admin)],
):
    session = await _get_session_and_check_access(session_id, db, current_user)

    player = await db.scalar(select(Player).where(Player.id == body.player_id, Player.is_active.is_(True)))
    if not player:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Player not found")

    entry = MatchLineup(
        id=uuid.uuid4(),
        session_id=session.id,
        player_id=player.id,
        jersey_number=body.jersey_number,
        position=body.position,
        team=body.team,
        status=LineupStatus(body.status),
    )
    db.add(entry)
    await db.commit()

    result = await db.scalar(
        select(MatchLineup)
        .where(MatchLineup.id == entry.id)
        .options(selectinload(MatchLineup.player))
    )
    return result


@router.get("/{session_id}/lineup", response_model=list[LineupEntryResponse])
async def get_lineup(
    session_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    await _get_session_and_check_access(session_id, db, current_user)

    result = await db.execute(
        select(MatchLineup)
        .where(MatchLineup.session_id == session_id)
        .options(selectinload(MatchLineup.player))
        .order_by(MatchLineup.team, MatchLineup.jersey_number)
    )
    return result.scalars().all()


@router.post("/{session_id}/lineup/substitute", status_code=status.HTTP_200_OK)
async def substitute(
    session_id: uuid.UUID,
    body: SubstituteRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_club_admin)],
):
    session = await _get_session_and_check_access(session_id, db, current_user)

    entry_out = await db.scalar(
        select(MatchLineup)
        .where(MatchLineup.id == body.lineup_out_id, MatchLineup.session_id == session.id)
        .options(selectinload(MatchLineup.player))
    )
    entry_in = await db.scalar(
        select(MatchLineup)
        .where(MatchLineup.id == body.lineup_in_id, MatchLineup.session_id == session.id)
        .options(selectinload(MatchLineup.player))
    )

    if not entry_out or not entry_in:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lineup entry not found")
    if entry_out.status != LineupStatus.on_field:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Player going out is not on field")
    if entry_in.status != LineupStatus.bench:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Player coming in is not on bench")

    entry_out.status = LineupStatus.substituted_out
    entry_in.status = LineupStatus.on_field

    timer = manager.get_timer(str(session_id))
    timer_seconds = timer.elapsed() if timer else 0
    half = timer.current_half if timer else 1

    sub_event = Event(
        id=uuid.uuid4(),
        session_id=session.id,
        event_type="substitution",
        half=half,
        timer_seconds=timer_seconds,
        team=entry_out.team,
        recorded_by=current_user.id,
        recorded_at=datetime.now(timezone.utc),
        metadata_={
            "player_out_id": str(entry_out.player_id),
            "player_out_name": entry_out.player.name,
            "player_out_number": entry_out.jersey_number,
            "player_in_id": str(entry_in.player_id),
            "player_in_name": entry_in.player.name,
            "player_in_number": entry_in.jersey_number,
        },
    )
    db.add(sub_event)
    await db.commit()

    await manager.broadcast(str(session_id), {
        "type": "substitution",
        "data": {
            "player_out": {"id": str(entry_out.player_id), "name": entry_out.player.name, "jersey": entry_out.jersey_number},
            "player_in": {"id": str(entry_in.player_id), "name": entry_in.player.name, "jersey": entry_in.jersey_number},
        },
    })

    return {"status": "ok"}
