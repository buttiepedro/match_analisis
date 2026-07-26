"""
Vistas transversales del club: la foto del día y el calendario.

No agregan modelo: reúnen en un request lo que hoy vive repartido en cinco
pantallas. Todo respeta el alcance por división del usuario.
"""
import uuid
from datetime import date, timedelta
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import (
    assert_club_access,
    get_club_or_404,
    get_current_user,
    get_division_or_404,
    visible_division_ids,
)
from app.models import (
    Attendance,
    AttendanceStatus,
    Availability,
    Division,
    Event,
    Player,
    Session,
    SessionStatus,
    Tournament,
    Training,
    User,
)
from app.schemas.player import PlayerResponse
from app.schemas.dashboard import (
    CalendarEntry,
    TodayAlert,
    TodayResponse,
    TodayTraining,
    UpcomingMatch,
)

router = APIRouter()

#: Ventana de aviso del apto médico, igual que en `injuries.py`.
CLEARANCE_WARNING_DAYS = 30
AT_RISK_STREAK = 3
ATTENDED = (AttendanceStatus.presente, AttendanceStatus.tarde)


def _streak_of_absences(statuses: list[AttendanceStatus]) -> int:
    streak = 0
    for st in statuses:
        if st == AttendanceStatus.ausente:
            streak += 1
        else:
            break
    return streak


@router.get("/me/player", response_model=PlayerResponse)
async def my_player_profile(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Ficha del jugador logueado. El portal arranca acá y no toma ningún id."""
    player = await db.scalar(select(Player).where(Player.user_id == current_user.id))
    if not player:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Este usuario no está vinculado a ningún jugador",
        )
    return player


@router.get("/clubs/{club_id}/at-risk", response_model=list[uuid.UUID])
async def club_at_risk(
    club_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    days: Annotated[int, Query(ge=1, le=365)] = 30,
):
    """
    Ids en riesgo de deserción de todo el club, en **un** request.

    El plantel hacía uno por división cuando el filtro estaba en "Todos".
    """
    club = await get_club_or_404(club_id, db)
    assert_club_access(club, current_user)
    division_ids = await visible_division_ids(club.id, db, current_user)
    if not division_ids:
        return []

    since = date.today() - timedelta(days=days)
    trainings = (
        await db.execute(
            select(Training.id, Training.date)
            .where(Training.division_id.in_(division_ids), Training.date >= since)
            .order_by(Training.date.desc())
        )
    ).all()
    if not trainings:
        return []

    order = {t_id: i for i, (t_id, _) in enumerate(trainings)}
    records = (
        await db.execute(
            select(Attendance).where(Attendance.training_id.in_(list(order)))
        )
    ).scalars().all()

    by_player: dict[uuid.UUID, list[Attendance]] = {}
    for r in records:
        by_player.setdefault(r.player_id, []).append(r)

    at_risk: list[uuid.UUID] = []
    for player_id, rows in by_player.items():
        rows.sort(key=lambda r: order[r.training_id])
        total = len(rows)
        if not total:
            continue
        attended = sum(1 for r in rows if r.status in ATTENDED)
        percent = attended / total * 100
        if _streak_of_absences([r.status for r in rows]) >= AT_RISK_STREAK or percent < 50:
            at_risk.append(player_id)

    return at_risk


@router.get("/clubs/{club_id}/today", response_model=TodayResponse)
async def club_today(
    club_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """La foto del día: qué pasa hoy y qué hay que mirar antes de convocar."""
    club = await get_club_or_404(club_id, db)
    assert_club_access(club, current_user)
    division_ids = await visible_division_ids(club.id, db, current_user)

    if not division_ids:
        return TodayResponse(
            date=date.today(), trainings=[], upcoming_matches=[], alerts=[]
        )

    division_names = dict(
        (
            await db.execute(
                select(Division.id, Division.name).where(Division.id.in_(division_ids))
            )
        ).all()
    )
    today = date.today()

    # ── Entrenamientos de hoy ────────────────────────────────────────────────
    todays = (
        await db.execute(
            select(Training)
            .where(Training.division_id.in_(division_ids), Training.date == today)
            .order_by(Training.date)
        )
    ).scalars().all()

    loaded = set()
    if todays:
        loaded = set(
            (
                await db.execute(
                    select(Attendance.training_id).where(
                        Attendance.training_id.in_([t.id for t in todays])
                    )
                )
            ).scalars().all()
        )

    trainings = [
        TodayTraining(
            id=t.id,
            division_id=t.division_id,
            division_name=division_names.get(t.division_id, ""),
            type=t.type.value,
            attendance_loaded=t.id in loaded,
        )
        for t in todays
    ]

    # ── Próximos partidos ────────────────────────────────────────────────────
    matches = (
        await db.execute(
            select(Session, Tournament)
            .join(Tournament, Tournament.id == Session.tournament_id)
            .where(
                Tournament.division_id.in_(division_ids),
                Session.status != SessionStatus.finished,
            )
            .order_by(Session.scheduled_at.is_(None), Session.scheduled_at)
            .limit(5)
        )
    ).all()

    upcoming = [
        UpcomingMatch(
            id=s.id,
            home_team=s.home_team,
            away_team=s.away_team,
            scheduled_at=s.scheduled_at,
            status=s.status.value,
            division_name=division_names.get(t.division_id, ""),
        )
        for s, t in matches
    ]

    # ── Avisos ───────────────────────────────────────────────────────────────
    alerts: list[TodayAlert] = []
    players = (
        await db.execute(
            select(Player)
            .where(Player.division_id.in_(division_ids), Player.is_active.is_(True))
            .order_by(Player.name)
        )
    ).scalars().all()

    unavailable = [p for p in players if p.availability != Availability.disponible]
    if unavailable:
        alerts.append(
            TodayAlert(
                kind="no_disponibles",
                label=f"{len(unavailable)} jugador(es) no disponibles",
                detail=", ".join(p.name for p in unavailable[:6]),
                count=len(unavailable),
            )
        )

    expired = [
        p
        for p in players
        if p.medical_clearance_expires and p.medical_clearance_expires < today
    ]
    if expired:
        alerts.append(
            TodayAlert(
                kind="apto_vencido",
                label=f"{len(expired)} con apto médico vencido",
                detail=", ".join(p.name for p in expired[:6]),
                count=len(expired),
            )
        )

    expiring = [
        p
        for p in players
        if p.medical_clearance_expires
        and today <= p.medical_clearance_expires <= today + timedelta(days=CLEARANCE_WARNING_DAYS)
    ]
    if expiring:
        alerts.append(
            TodayAlert(
                kind="apto_por_vencer",
                label=f"{len(expiring)} con apto por vencer",
                detail=", ".join(p.name for p in expiring[:6]),
                count=len(expiring),
            )
        )

    # Rojas sin suspensión cargada.
    red_rows = (
        await db.execute(
            select(Player.name)
            .join(Event, Event.player_id == Player.id)
            .join(Session, Session.id == Event.session_id)
            .join(Tournament, Tournament.id == Session.tournament_id)
            .where(
                Event.event_type == "red_card",
                Tournament.division_id.in_(division_ids),
                Player.availability != Availability.suspendido,
                Player.is_active.is_(True),
            )
            .distinct()
        )
    ).scalars().all()
    if red_rows:
        alerts.append(
            TodayAlert(
                kind="roja_sin_sancion",
                label=f"{len(red_rows)} roja(s) sin suspensión cargada",
                detail=", ".join(red_rows[:6]),
                count=len(red_rows),
            )
        )

    at_risk = await club_at_risk(club_id, db, current_user)
    if at_risk:
        names = (
            await db.execute(select(Player.name).where(Player.id.in_(at_risk)))
        ).scalars().all()
        alerts.append(
            TodayAlert(
                kind="en_riesgo",
                label=f"{len(at_risk)} jugador(es) en riesgo de deserción",
                detail=", ".join(names[:6]),
                count=len(at_risk),
            )
        )

    return TodayResponse(
        date=today, trainings=trainings, upcoming_matches=upcoming, alerts=alerts
    )


@router.get("/divisions/{division_id}/calendar", response_model=list[CalendarEntry])
async def division_calendar(
    division_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    date_from: Annotated[Optional[date], Query(alias="from")] = None,
    date_to: Annotated[Optional[date], Query(alias="to")] = None,
):
    """Partidos y entrenamientos en una sola serie, ordenada por fecha."""
    await get_division_or_404(division_id, db, current_user)

    entries: list[CalendarEntry] = []

    training_query = select(Training).where(Training.division_id == division_id)
    if date_from:
        training_query = training_query.where(Training.date >= date_from)
    if date_to:
        training_query = training_query.where(Training.date <= date_to)

    for t in (await db.execute(training_query)).scalars().all():
        entries.append(
            CalendarEntry(
                id=t.id,
                kind="entrenamiento",
                date=t.date,
                label=t.type.value,
                status=None,
            )
        )

    match_query = (
        select(Session)
        .join(Tournament, Tournament.id == Session.tournament_id)
        .where(Tournament.division_id == division_id, Session.scheduled_at.isnot(None))
    )
    for s in (await db.execute(match_query)).scalars().all():
        day = s.scheduled_at.date()
        if date_from and day < date_from:
            continue
        if date_to and day > date_to:
            continue
        entries.append(
            CalendarEntry(
                id=s.id,
                kind="partido",
                date=day,
                label=f"{s.home_team} vs {s.away_team}",
                status=s.status.value,
            )
        )

    entries.sort(key=lambda e: (e.date, e.kind))
    return entries
