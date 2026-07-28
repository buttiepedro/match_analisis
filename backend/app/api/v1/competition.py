"""
Rivales y tabla de posiciones.

Las posiciones se **calculan** desde los eventos, igual que los minutos: guardar
el puntaje sería una segunda fuente de verdad que se desincroniza en cuanto
alguien corrige un try.
"""
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.permissions import Permission
from app.core.deps import (
    assert_club_access,
    get_club_or_404,
    get_current_user,
    get_division_or_404,
    require,
)
from app.models import Event, Opponent, Session, SessionStatus, Tournament, User
from app.schemas.competition import (
    OpponentCreate,
    OpponentHistory,
    OpponentHistoryMatch,
    OpponentResponse,
    StandingRow,
)

router = APIRouter()

#: Puntaje URBA por defecto. Configurable por torneo queda para cuando un club
#: juegue un torneo que puntúe distinto — inventarlo antes es adivinar.
WIN_POINTS = 4
DRAW_POINTS = 2
#: Bonus ofensivo: 4 tries o más. Defensivo: perder por 7 o menos.
TRY_BONUS_THRESHOLD = 4
LOSING_BONUS_MARGIN = 7


def _score_from_events(events: list[Event], team: str) -> tuple[int, int]:
    """Devuelve (puntos, tries) de un equipo en un partido."""
    points = 0
    tries = 0
    for e in events:
        if e.team.value != team:
            continue
        if e.event_type == "try":
            points += 5
            tries += 1
            if (e.metadata_ or {}).get("converted") is True:
                points += 2
        elif e.event_type == "penalty" and e.reason == "a_los_palos":
            if (e.metadata_ or {}).get("converted") is True:
                points += 3
        elif e.event_type == "drop":
            points += 3
    return points, tries


# ── Rivales ───────────────────────────────────────────────────────────────────

@router.get("/clubs/{club_id}/opponents", response_model=list[OpponentResponse])
async def list_opponents(
    club_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.partido_ver))],
):
    club = await get_club_or_404(club_id, db)
    assert_club_access(club, current_user)
    result = await db.execute(
        select(Opponent).where(Opponent.club_id == club.id).order_by(Opponent.name)
    )
    return result.scalars().all()


@router.post(
    "/clubs/{club_id}/opponents",
    response_model=OpponentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_opponent(
    club_id: uuid.UUID,
    body: OpponentCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.club_rivales))],
):
    club = await get_club_or_404(club_id, db)
    assert_club_access(club, current_user)

    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="El nombre no puede estar vacío")

    existing = await db.scalar(
        select(Opponent).where(Opponent.club_id == club.id, Opponent.name == name)
    )
    if existing:
        # Alta idempotente: el selector con autocompletado va a mandar el mismo
        # nombre más de una vez y eso no es un error del usuario.
        return existing

    opponent = Opponent(id=uuid.uuid4(), club_id=club.id, name=name)
    db.add(opponent)
    await db.commit()
    await db.refresh(opponent)
    return opponent


@router.get("/opponents/{opponent_id}/history", response_model=OpponentHistory)
async def opponent_history(
    opponent_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.partido_ver))],
):
    """Historial completo contra un rival: lo que los strings sueltos no permitían."""
    opponent = await db.scalar(select(Opponent).where(Opponent.id == opponent_id))
    if not opponent:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rival no encontrado")
    club = await get_club_or_404(opponent.club_id, db)
    assert_club_access(club, current_user)

    sessions = (
        await db.execute(
            select(Session)
            .where(
                Session.opponent_id == opponent.id,
                Session.status == SessionStatus.finished,
            )
            .order_by(Session.created_at.desc())
        )
    ).scalars().all()

    if not sessions:
        return OpponentHistory(
            opponent_id=opponent.id, opponent_name=opponent.name,
            played=0, won=0, drawn=0, lost=0,
            points_for=0, points_against=0, matches=[],
        )

    all_events = (
        await db.execute(
            select(Event).where(Event.session_id.in_([s.id for s in sessions]))
        )
    ).scalars().all()
    by_session: dict[uuid.UUID, list[Event]] = {}
    for e in all_events:
        by_session.setdefault(e.session_id, []).append(e)

    matches: list[OpponentHistoryMatch] = []
    won = drawn = lost = 0
    points_for = points_against = 0

    for s in sessions:
        events = by_session.get(s.id, [])
        own, _ = _score_from_events(events, "user")
        rival, _ = _score_from_events(events, "rival")
        points_for += own
        points_against += rival
        if own > rival:
            won += 1
            outcome = "ganado"
        elif own == rival:
            drawn += 1
            outcome = "empatado"
        else:
            lost += 1
            outcome = "perdido"

        matches.append(
            OpponentHistoryMatch(
                session_id=s.id,
                scheduled_at=s.scheduled_at,
                points_for=own,
                points_against=rival,
                outcome=outcome,
            )
        )

    return OpponentHistory(
        opponent_id=opponent.id,
        opponent_name=opponent.name,
        played=len(sessions),
        won=won,
        drawn=drawn,
        lost=lost,
        points_for=points_for,
        points_against=points_against,
        matches=matches,
    )


# ── Tabla de posiciones ───────────────────────────────────────────────────────

@router.get("/tournaments/{tournament_id}/standings", response_model=list[StandingRow])
async def tournament_standings(
    tournament_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.partido_ver))],
):
    """
    Tabla del torneo desde la perspectiva del club.

    Sólo entran partidos **terminados**: uno en curso no tiene resultado, y
    contarlo mostraría una tabla que cambia sola durante el segundo tiempo.
    """
    tournament = await db.scalar(select(Tournament).where(Tournament.id == tournament_id))
    if not tournament:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Torneo no encontrado")
    await get_division_or_404(tournament.division_id, db, current_user)

    sessions = (
        await db.execute(
            select(Session).where(
                Session.tournament_id == tournament.id,
                Session.status == SessionStatus.finished,
            )
        )
    ).scalars().all()
    if not sessions:
        return []

    all_events = (
        await db.execute(
            select(Event).where(Event.session_id.in_([s.id for s in sessions]))
        )
    ).scalars().all()
    by_session: dict[uuid.UUID, list[Event]] = {}
    for e in all_events:
        by_session.setdefault(e.session_id, []).append(e)

    # Cada rival es una fila; el club propio es otra. Es la tabla que un club
    # arma en la práctica: cómo le fue contra cada uno.
    rows: dict[str, dict] = {}

    def bucket(name: str) -> dict:
        return rows.setdefault(
            name,
            {
                "played": 0, "won": 0, "drawn": 0, "lost": 0,
                "points_for": 0, "points_against": 0, "bonus": 0, "points": 0,
            },
        )

    for s in sessions:
        events = by_session.get(s.id, [])
        own, own_tries = _score_from_events(events, "user")
        rival, _ = _score_from_events(events, "rival")

        row = bucket(s.away_team)
        row["played"] += 1
        row["points_for"] += own
        row["points_against"] += rival

        if own > rival:
            row["won"] += 1
            row["points"] += WIN_POINTS
        elif own == rival:
            row["drawn"] += 1
            row["points"] += DRAW_POINTS
        else:
            row["lost"] += 1
            # Bonus defensivo: perder por 7 o menos.
            if rival - own <= LOSING_BONUS_MARGIN:
                row["bonus"] += 1
                row["points"] += 1

        # Bonus ofensivo: 4 tries o más, se gane o se pierda.
        if own_tries >= TRY_BONUS_THRESHOLD:
            row["bonus"] += 1
            row["points"] += 1

    result = [
        StandingRow(
            team=name,
            played=v["played"],
            won=v["won"],
            drawn=v["drawn"],
            lost=v["lost"],
            points_for=v["points_for"],
            points_against=v["points_against"],
            difference=v["points_for"] - v["points_against"],
            bonus=v["bonus"],
            points=v["points"],
        )
        for name, v in rows.items()
    ]
    result.sort(key=lambda r: (-r.points, -r.difference, r.team))
    return result
