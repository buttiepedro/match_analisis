"""
Vistas transversales del club: la foto del día y el calendario.

No agregan modelo: reúnen en un request lo que hoy vive repartido en cinco
pantallas. Todo respeta el alcance por división del usuario.
"""
import uuid
from datetime import date, datetime, timedelta
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.deps import (
    assert_club_access,
    get_club_or_404,
    get_current_user,
    get_division_or_404,
    visible_division_ids,
)
from app.core.storage import IMAGE_TYPES, MAX_IMAGE_BYTES, put_object, read_upload
from app.models import (
    Attendance,
    AttendanceStatus,
    Availability,
    Division,
    Event,
    MatchLineup,
    Player,
    PlayerDivisionHistory,
    PlayerInjury,
    Session,
    SessionStatus,
    Tournament,
    Training,
    User,
)
from app.schemas.injury import InjuryResponse
from app.schemas.player import (
    MyLineupEntry,
    MyMatchLineupResponse,
    MyPlayerProfileResponse,
    MyPlayerUpdate,
    PlayerDivisionHistoryResponse,
    PlayerResponse,
)
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
#: Ventana para la alerta de "roja sin suspensión" — de sobra para cualquier
#: sanción real, evita que una tarjeta de hace años quede como pendiente para
#: siempre.
RED_CARD_WINDOW_DAYS = 60
ATTENDED = (AttendanceStatus.presente, AttendanceStatus.tarde)


def _streak_of_absences(statuses: list[AttendanceStatus]) -> int:
    streak = 0
    for st in statuses:
        if st == AttendanceStatus.ausente:
            streak += 1
        else:
            break
    return streak


async def _get_own_player(current_user: User, db: AsyncSession) -> Player:
    """
    El jugador vinculado al usuario logueado, o `404`.

    Todos los endpoints `/me/player*` resuelven acá: nunca toman un `id`, así
    que agregar una ruta nueva del portal no puede abrir por olvido la ficha
    de otro jugador.
    """
    player = await db.scalar(select(Player).where(Player.user_id == current_user.id))
    if not player:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Este usuario no está vinculado a ningún jugador",
        )
    return player


def _my_player_response(player: Player) -> MyPlayerProfileResponse:
    today = date.today()
    expires = player.medical_clearance_expires
    return MyPlayerProfileResponse(
        **PlayerResponse.model_validate(player).model_dump(),
        clearance_expired=bool(expires and expires < today),
        clearance_expiring=bool(
            expires and today <= expires <= today + timedelta(days=CLEARANCE_WARNING_DAYS)
        ),
    )


@router.get("/me/player", response_model=MyPlayerProfileResponse)
async def my_player_profile(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Ficha del jugador logueado. El portal arranca acá y no toma ningún id."""
    player = await _get_own_player(current_user, db)
    return _my_player_response(player)


@router.patch("/me/player", response_model=MyPlayerProfileResponse)
async def update_my_player_profile(
    body: MyPlayerUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """
    El jugador edita su propio contacto — nada más.

    `MyPlayerUpdate` rechaza con `422` cualquier campo fuera de la whitelist
    (`dni`, `availability`, etc.): son datos que el club necesita poder
    auditar, o que tienen una única fuente de escritura ([[gestion-semanal]]).
    """
    player = await _get_own_player(current_user, db)
    if body.phone is not None:
        player.phone = body.phone
    if body.emergency_phone is not None:
        player.emergency_phone = body.emergency_phone
    if body.email is not None:
        player.email = body.email

    await db.commit()
    await db.refresh(player)
    return _my_player_response(player)


@router.post("/me/player/photo", response_model=MyPlayerProfileResponse)
async def upload_my_player_photo(
    file: Annotated[UploadFile, File(...)],
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Mismo flujo de subida que usa el cuerpo técnico al cargar un jugador."""
    player = await _get_own_player(current_user, db)
    content, content_type, ext = await read_upload(
        file, allowed=IMAGE_TYPES, max_bytes=MAX_IMAGE_BYTES
    )
    # Clave determinística, no aleatoria: es la foto de perfil, no un álbum —
    # la próxima subida tiene que reemplazar a la anterior, no acumularse.
    player.profile_photo_url = put_object(f"players/{player.id}.{ext}", content, content_type)

    await db.commit()
    await db.refresh(player)
    return _my_player_response(player)


@router.get("/me/player/division-history", response_model=list[PlayerDivisionHistoryResponse])
async def my_division_history(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """En qué divisiones jugó, no sólo en cuál está ahora."""
    player = await _get_own_player(current_user, db)
    rows = (
        await db.execute(
            select(PlayerDivisionHistory, Division.name)
            .join(Division, Division.id == PlayerDivisionHistory.division_id)
            .where(PlayerDivisionHistory.player_id == player.id)
            .order_by(PlayerDivisionHistory.from_date.desc())
        )
    ).all()
    return [
        PlayerDivisionHistoryResponse(
            division_id=history.division_id,
            division_name=division_name,
            from_date=history.from_date,
            to_date=history.to_date,
        )
        for history, division_name in rows
    ]


@router.get("/me/player/injuries", response_model=list[InjuryResponse])
async def my_closed_injuries(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """
    Sólo lesiones **cerradas**: fecha, zona, tipo, gravedad y cuánto tardó en
    volver. Las abiertas ya se resumen en `availability`; el detalle clínico
    completo de una lesión activa sigue siendo del cuerpo médico del club.
    """
    player = await _get_own_player(current_user, db)
    result = await db.execute(
        select(PlayerInjury)
        .where(PlayerInjury.player_id == player.id, PlayerInjury.actual_return.isnot(None))
        .order_by(PlayerInjury.injury_date.desc())
    )
    return result.scalars().all()


@router.get("/me/player/sessions/{session_id}/lineup", response_model=MyMatchLineupResponse)
async def my_session_lineup(
    session_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """
    La formación de un partido de la propia división, de sólo lectura.

    Es el destino del deep link de la notificación "salió la formación"
    ([[add-notificaciones-push]]) — a propósito **no** reusa
    `GET /sessions/{id}/lineup`: ese endpoint exige `partido.ver`, una
    capacidad que ningún jugador tiene, y la pantalla que lo consume trae
    controles de edición pensados para el cuerpo técnico.
    """
    player = await _get_own_player(current_user, db)

    session = await db.scalar(select(Session).where(Session.id == session_id))
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Partido no encontrado")

    tournament = await db.scalar(select(Tournament).where(Tournament.id == session.tournament_id))
    if not tournament or tournament.division_id != player.division_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Este partido no es de tu división",
        )

    rows = (
        await db.execute(
            select(MatchLineup)
            .where(MatchLineup.session_id == session.id, MatchLineup.team == "user")
            .options(selectinload(MatchLineup.player))
            .order_by(MatchLineup.jersey_number)
        )
    ).scalars().all()

    return MyMatchLineupResponse(
        session_id=session.id,
        home_team=session.home_team,
        away_team=session.away_team,
        scheduled_at=session.scheduled_at,
        entries=[
            MyLineupEntry(
                jersey_number=r.jersey_number,
                position=r.position,
                player_name=r.player.name,
                is_me=r.player_id == player.id,
            )
            for r in rows
        ],
    )


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
            location=t.location,
            attendance_loaded=t.id in loaded,
        )
        for t in todays
    ]

    # ── Próximos partidos ────────────────────────────────────────────────────
    # `status != finished` no alcanza: un partido viejo sin resultado (p.ej. un
    # bye "vs LIBRE" que nunca se juega) queda eternamente pendiente y gana el
    # primer lugar aunque sea de hace meses. Un partido sin fecha todavía puede
    # ser genuinamente futuro (no se cargó la fecha todavía) — sólo se excluye
    # el que tiene una fecha *pasada* concreta.
    today_start = datetime.combine(today, datetime.min.time())
    matches = (
        await db.execute(
            select(Session, Tournament)
            .join(Tournament, Tournament.id == Session.tournament_id)
            .where(
                Tournament.division_id.in_(division_ids),
                Session.status != SessionStatus.finished,
                or_(Session.scheduled_at >= today_start, Session.scheduled_at.is_(None)),
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

    # Rojas sin suspensión cargada, de partidos recientes.
    #
    # Sin ventana de tiempo, una roja de hace 5 años sigue apareciendo acá para
    # siempre — la suspensión ya se cumplió en la vida real, solo que nadie
    # vuelve a tocar `availability` una vez pasado el partido. RED_CARD_WINDOW_DAYS
    # cubre de sobra cualquier sanción real (semanas, no años).
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
                Session.scheduled_at >= today_start - timedelta(days=RED_CARD_WINDOW_DAYS),
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
                location=t.location,
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
