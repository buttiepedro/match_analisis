import uuid
from datetime import datetime, timezone
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import AsyncSessionLocal, get_db
from app.core.deps import get_current_user, require_club_admin, require_timer_control
from app.core.security import decode_token
from app.models import Event, Session, TimerState, Tournament, User, UserRole
from app.models.session import SessionStatus, TimerStatus
from app.schemas.event import EventCreate, EventResponse
from app.schemas.session import SessionCreate, SessionResponse, TimerControlRequest
from app.ws.manager import manager

# ── Routers ───────────────────────────────────────────────────────────────────

sessions_router = APIRouter(prefix="/tournaments")   # /tournaments/{id}/sessions
session_router = APIRouter(prefix="/sessions")       # /sessions/{id}/...
ws_router = APIRouter(prefix="/ws/session")          # /ws/session/{id}

# ── Helpers ───────────────────────────────────────────────────────────────────

_SESSION_STATUS_MAP = {
    "stopped": SessionStatus.scheduled,
    "running": SessionStatus.active,
    "paused": SessionStatus.active,
    "halftime": SessionStatus.halftime,
    "finished": SessionStatus.finished,
}


async def _get_tournament_or_404(tournament_id: uuid.UUID, db: AsyncSession) -> Tournament:
    t = await db.scalar(select(Tournament).where(Tournament.id == tournament_id))
    if not t:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")
    return t


async def _get_session_or_404(session_id: uuid.UUID, db: AsyncSession) -> Session:
    s = await db.scalar(
        select(Session)
        .where(Session.id == session_id)
        .options(selectinload(Session.timer_state))
    )
    if not s:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    return s


async def _persist_timer(session_id: uuid.UUID, timer, db: AsyncSession) -> None:
    ts = await db.scalar(select(TimerState).where(TimerState.session_id == session_id))
    if ts:
        ts.current_half = timer.current_half
        ts.status = TimerStatus(timer.status)
        ts.elapsed_seconds = timer.base_elapsed
        ts.started_at = timer.started_at

    s = await db.scalar(select(Session).where(Session.id == session_id))
    if s:
        s.status = _SESSION_STATUS_MAP.get(timer.status, SessionStatus.active)

    await db.commit()


async def _ws_authenticate(token: str) -> Optional[User]:
    try:
        payload = decode_token(token)
        user_id = uuid.UUID(payload["sub"])
    except (JWTError, KeyError, ValueError):
        return None
    async with AsyncSessionLocal() as db:
        return await db.scalar(select(User).where(User.id == user_id, User.is_active.is_(True)))


# ── Session CRUD ──────────────────────────────────────────────────────────────

@sessions_router.post(
    "/{tournament_id}/sessions",
    response_model=SessionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_session(
    tournament_id: uuid.UUID,
    body: SessionCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_club_admin)],
):
    tournament = await _get_tournament_or_404(tournament_id, db)
    if current_user.role != UserRole.superadmin and current_user.club_id != tournament.club_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    session = Session(
        id=uuid.uuid4(),
        tournament_id=tournament.id,
        home_team=body.home_team,
        away_team=body.away_team,
        scheduled_at=body.scheduled_at,
        half_duration_minutes=body.half_duration_minutes,
        created_by=current_user.id,
    )
    db.add(session)
    await db.flush()

    timer_state = TimerState(id=uuid.uuid4(), session_id=session.id)
    db.add(timer_state)
    await db.commit()

    result = await db.scalar(
        select(Session)
        .where(Session.id == session.id)
        .options(selectinload(Session.timer_state))
    )
    return result


@sessions_router.get("/{tournament_id}/sessions", response_model=list[SessionResponse])
async def list_sessions(
    tournament_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    tournament = await _get_tournament_or_404(tournament_id, db)
    if current_user.role != UserRole.superadmin and current_user.club_id != tournament.club_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    result = await db.execute(
        select(Session)
        .where(Session.tournament_id == tournament.id)
        .options(selectinload(Session.timer_state))
        .order_by(Session.scheduled_at.desc())
    )
    return result.scalars().all()


@session_router.get("/{session_id}", response_model=SessionResponse)
async def get_session(
    session_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    session = await _get_session_or_404(session_id, db)
    tournament = await _get_tournament_or_404(session.tournament_id, db)
    if current_user.role != UserRole.superadmin and current_user.club_id != tournament.club_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    return session


# ── Timer control (REST) ──────────────────────────────────────────────────────

@session_router.patch("/{session_id}/timer", response_model=dict)
async def control_timer(
    session_id: uuid.UUID,
    body: TimerControlRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_timer_control)],
):
    session = await _get_session_or_404(session_id, db)
    tournament = await _get_tournament_or_404(session.tournament_id, db)
    if current_user.role != UserRole.superadmin and current_user.club_id != tournament.club_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    sid = str(session_id)
    timer = manager.init_timer(sid, session.timer_state)
    updated = manager.apply_action(sid, body.action)
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Action '{body.action}' not valid for current timer status '{timer.status}'",
        )

    await _persist_timer(session_id, updated, db)
    await manager.broadcast(sid, {"type": "timer_state", "data": updated.snapshot()})
    return updated.snapshot()


# ── Events ────────────────────────────────────────────────────────────────────

@session_router.post(
    "/{session_id}/events",
    response_model=EventResponse,
    status_code=status.HTTP_201_CREATED,
)
async def register_event(
    session_id: uuid.UUID,
    body: EventCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    session = await _get_session_or_404(session_id, db)
    tournament = await _get_tournament_or_404(session.tournament_id, db)
    if current_user.role != UserRole.superadmin and current_user.club_id != tournament.club_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    sid = str(session_id)
    timer = manager.get_timer(sid)
    if timer:
        timer_seconds = timer.elapsed()
        half = timer.current_half
    else:
        ts = session.timer_state
        timer_seconds = ts.elapsed_seconds if ts else 0
        half = ts.current_half if ts else 1

    event = Event(
        id=uuid.uuid4(),
        session_id=session.id,
        event_type=body.event_type,
        half=half,
        timer_seconds=timer_seconds,
        team=body.team,
        player_number=body.player_number,
        reason=body.reason,
        metadata_=body.metadata,
        recorded_by=current_user.id,
        recorded_at=datetime.now(timezone.utc),
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)

    await manager.broadcast(sid, {
        "type": "event_registered",
        "data": {
            "id": str(event.id),
            "event_type": event.event_type,
            "half": event.half,
            "timer_seconds": event.timer_seconds,
            "team": event.team.value,
            "player_number": event.player_number,
            "reason": event.reason,
        },
    })

    return event


@session_router.get("/{session_id}/events", response_model=list[EventResponse])
async def list_events(
    session_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    session = await _get_session_or_404(session_id, db)
    tournament = await _get_tournament_or_404(session.tournament_id, db)
    if current_user.role != UserRole.superadmin and current_user.club_id != tournament.club_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    result = await db.execute(
        select(Event)
        .where(Event.session_id == session_id)
        .order_by(Event.half, Event.timer_seconds)
    )
    return result.scalars().all()


# ── WebSocket ─────────────────────────────────────────────────────────────────

@ws_router.websocket("/{session_id}")
async def session_ws(
    session_id: uuid.UUID,
    ws: WebSocket,
    token: str = Query(...),
):
    user = await _ws_authenticate(token)
    if not user:
        await ws.close(code=4001)
        return

    async with AsyncSessionLocal() as db:
        session = await db.scalar(
            select(Session)
            .where(Session.id == session_id)
            .options(selectinload(Session.timer_state))
        )
        if not session:
            await ws.close(code=4004)
            return

        tournament = await db.scalar(
            select(Tournament).where(Tournament.id == session.tournament_id)
        )
        if user.role != UserRole.superadmin and user.club_id != tournament.club_id:
            await ws.close(code=4003)
            return

        timer = manager.init_timer(str(session_id), session.timer_state)
        can_control = user.role in (
            UserRole.superadmin, UserRole.club_admin, UserRole.match_director
        )

    await manager.connect(str(session_id), ws)
    await manager.send(ws, {"type": "timer_state", "data": timer.snapshot()})

    try:
        while True:
            data = await ws.receive_json()

            if data.get("type") == "timer_control" and can_control:
                action = data.get("action", "")
                updated = manager.apply_action(str(session_id), action)
                if updated:
                    async with AsyncSessionLocal() as db:
                        await _persist_timer(session_id, updated, db)
                    await manager.broadcast(
                        str(session_id),
                        {"type": "timer_state", "data": updated.snapshot()},
                    )
    except WebSocketDisconnect:
        manager.disconnect(str(session_id), ws)
    except Exception:
        manager.disconnect(str(session_id), ws)
