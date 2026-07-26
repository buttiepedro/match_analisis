"""
Acumulados de temporada por jugador: minutos jugados y estadística de partido.

No hay modelo nuevo — todo sale de `match_lineup`, los eventos de sustitución y
el timer. Persistir estos números sería una segunda fuente de verdad que se
desincroniza en cuanto alguien corrige un evento.
"""
import uuid
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.deps import (
    assert_division_access,
    get_current_user,
    get_division_or_404,
    require_player_self,
)
from app.models import (
    Division,
    Event,
    MatchLineup,
    Player,
    Session,
    Tournament,
    User,
    UserRole,
)
from app.models.player import LineupStatus
from app.schemas.season import (
    DivisionMinutesRow,
    PlayerSeasonStats,
    SeasonMatchLine,
)

router = APIRouter()

#: Minutos que un jugador pasa fuera de la cancha por tarjeta amarilla.
SIN_BIN_SECONDS = 10 * 60


def _absolute(half: int, timer_seconds: int, half_length: int) -> int:
    """Segundos desde el arranque del partido; el 2° tiempo arranca en `half_length`."""
    return timer_seconds if half <= 1 else half_length + timer_seconds


def _match_length(events: list[Event], half_length: int, finished: bool) -> int:
    """
    Duración efectiva del partido.

    Si terminó, se toma el tiempo reglamentario; si sigue abierto se usa el
    último evento registrado, que es lo único que se sabe con certeza.
    """
    if finished:
        return half_length * 2
    if not events:
        return 0
    return max(_absolute(e.half, e.timer_seconds, half_length) for e in events)


def _minutes_for_player(
    player_id: uuid.UUID,
    entry: MatchLineup,
    events: list[Event],
    half_length: int,
    finished: bool,
) -> int:
    """
    Minutos en cancha de un jugador en un partido.

    Arranca si no aparece entrando en ninguna sustitución. Sale cuando lo sacan,
    o al final. A eso se le descuenta el tiempo de amarilla.
    """
    player_key = str(player_id)
    subs = [e for e in events if e.event_type == "substitution"]

    came_in = next(
        (e for e in subs if (e.metadata_ or {}).get("player_in_id") == player_key), None
    )
    went_out = next(
        (e for e in subs if (e.metadata_ or {}).get("player_out_id") == player_key), None
    )

    # Suplente que nunca entró: no jugó.
    if came_in is None and entry.status == LineupStatus.bench:
        return 0

    end = _match_length(events, half_length, finished)
    start_at = (
        _absolute(came_in.half, came_in.timer_seconds, half_length) if came_in else 0
    )
    end_at = (
        _absolute(went_out.half, went_out.timer_seconds, half_length) if went_out else end
    )
    on_field = max(0, end_at - start_at)

    # Amarillas del jugador dentro de su ventana en cancha.
    for card in events:
        if card.event_type != "yellow_card" or card.player_id != player_id:
            continue
        card_at = _absolute(card.half, card.timer_seconds, half_length)
        if start_at <= card_at <= end_at:
            on_field -= min(SIN_BIN_SECONDS, end_at - card_at)

    return max(0, round(on_field / 60))


async def _assert_player_access(
    player_id: uuid.UUID, db: AsyncSession, current_user: User
) -> Player:
    player = await db.scalar(
        select(Player).where(Player.id == player_id).options(selectinload(Player.division))
    )
    if not player:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Jugador no encontrado")
    await require_player_self(player_id, db, current_user)
    if current_user.role != UserRole.player:
        assert_division_access(player.division, current_user)
    return player


@router.get("/players/{player_id}/season-stats", response_model=PlayerSeasonStats)
async def player_season_stats(
    player_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    season: Annotated[Optional[str], Query()] = None,
):
    player = await _assert_player_access(player_id, db, current_user)

    query = (
        select(MatchLineup, Session)
        .join(Session, Session.id == MatchLineup.session_id)
        .join(Tournament, Tournament.id == Session.tournament_id)
        .where(MatchLineup.player_id == player_id)
    )
    if season:
        query = query.where(Tournament.season == season)

    rows = (await db.execute(query.order_by(Session.created_at.desc()))).all()
    if not rows:
        return PlayerSeasonStats(
            player_id=player_id, player_name=player.name, matches=0, minutes=0,
            tries=0, tackles=0, yellow_cards=0, red_cards=0, matches_detail=[],
        )

    session_ids = [s.id for _, s in rows]
    all_events = (
        await db.execute(select(Event).where(Event.session_id.in_(session_ids)))
    ).scalars().all()

    by_session: dict[uuid.UUID, list[Event]] = {}
    for e in all_events:
        by_session.setdefault(e.session_id, []).append(e)

    detail: list[SeasonMatchLine] = []
    totals = {"minutes": 0, "tries": 0, "tackles": 0, "yellow": 0, "red": 0}

    for entry, session in rows:
        events = by_session.get(session.id, [])
        minutes = _minutes_for_player(
            player_id, entry, events, session.half_duration_minutes * 60,
            session.status.value == "finished",
        )
        own = [e for e in events if e.player_id == player_id]
        tries = sum(1 for e in own if e.event_type == "try")
        tackles = sum(
            1 for e in own if e.event_type in ("tackle_effective", "tackle_positive")
        )
        yellow = sum(1 for e in own if e.event_type == "yellow_card")
        red = sum(1 for e in own if e.event_type == "red_card")

        totals["minutes"] += minutes
        totals["tries"] += tries
        totals["tackles"] += tackles
        totals["yellow"] += yellow
        totals["red"] += red

        detail.append(
            SeasonMatchLine(
                session_id=session.id,
                label=f"{session.home_team} vs {session.away_team}",
                scheduled_at=session.scheduled_at,
                jersey_number=entry.jersey_number,
                minutes=minutes,
                tries=tries,
                tackles=tackles,
                yellow_cards=yellow,
                red_cards=red,
            )
        )

    return PlayerSeasonStats(
        player_id=player_id,
        player_name=player.name,
        # Estar en la planilla sin entrar nunca no es haber jugado un partido.
        matches=sum(1 for d in detail if d.minutes > 0),
        minutes=totals["minutes"],
        tries=totals["tries"],
        tackles=totals["tackles"],
        yellow_cards=totals["yellow"],
        red_cards=totals["red"],
        matches_detail=detail,
    )


@router.get("/divisions/{division_id}/minutes", response_model=list[DivisionMinutesRow])
async def division_minutes(
    division_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    tournament_id: Annotated[Optional[uuid.UUID], Query()] = None,
):
    """Carga de trabajo del plantel: quién viene jugando todo y quién nada."""
    await get_division_or_404(division_id, db, current_user)

    players = (
        await db.execute(
            select(Player)
            .where(Player.division_id == division_id, Player.is_active.is_(True))
            .order_by(Player.name)
        )
    ).scalars().all()
    if not players:
        return []

    query = (
        select(MatchLineup, Session)
        .join(Session, Session.id == MatchLineup.session_id)
        .join(Tournament, Tournament.id == Session.tournament_id)
        .where(
            MatchLineup.player_id.in_([p.id for p in players]),
            Tournament.division_id == division_id,
        )
    )
    if tournament_id:
        query = query.where(Session.tournament_id == tournament_id)

    rows = (await db.execute(query)).all()
    if not rows:
        return [
            DivisionMinutesRow(
                player_id=p.id, player_name=p.name, matches=0, minutes=0, average_minutes=0.0
            )
            for p in players
        ]

    all_events = (
        await db.execute(
            select(Event).where(Event.session_id.in_([s.id for _, s in rows]))
        )
    ).scalars().all()
    by_session: dict[uuid.UUID, list[Event]] = {}
    for e in all_events:
        by_session.setdefault(e.session_id, []).append(e)

    tally: dict[uuid.UUID, dict[str, int]] = {p.id: {"matches": 0, "minutes": 0} for p in players}
    for entry, session in rows:
        minutes = _minutes_for_player(
            entry.player_id, entry, by_session.get(session.id, []),
            session.half_duration_minutes * 60, session.status.value == "finished",
        )
        if minutes > 0:
            tally[entry.player_id]["matches"] += 1
            tally[entry.player_id]["minutes"] += minutes

    result = [
        DivisionMinutesRow(
            player_id=p.id,
            player_name=p.name,
            matches=tally[p.id]["matches"],
            minutes=tally[p.id]["minutes"],
            average_minutes=(
                round(tally[p.id]["minutes"] / tally[p.id]["matches"], 1)
                if tally[p.id]["matches"]
                else 0.0
            ),
        )
        for p in players
    ]
    result.sort(key=lambda r: (-r.minutes, r.player_name))
    return result
