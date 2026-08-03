"""
Portal multidivisión: fixture, tablas y citados de **todo** el club.

A diferencia del resto de [[club-operativo]], estas tres vistas no se filtran
por el alcance por división del usuario — `club.ver_competencia` es una
capacidad de club, no de división, del mismo modo en que `socios.ver_propia`
tampoco se filtra. Un socio no tiene división propia, así que "sólo la propia"
ni siquiera aplica acá.

Sin modelo nuevo: agregación de sólo lectura sobre `sessions`, `standings`
([[competition]]) y `match_squad` ([[lineup]]).
"""
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.v1.competition import compute_standings, score_from_events
from app.core.database import get_db
from app.core.deps import assert_club_access, get_club_or_404, require
from app.core.permissions import Permission
from app.models import Division, Event, MatchSquad, Session, SessionStatus, Tournament, User
from app.schemas.club_competencia import (
    DivisionConvocatoria,
    DivisionFixture,
    DivisionStandings,
    FixtureMatch,
)
from app.schemas.player import SquadMemberResponse

router = APIRouter(prefix="/clubs/{club_id}")


async def _active_divisions(club_id: uuid.UUID, db: AsyncSession) -> list[Division]:
    return (
        (
            await db.execute(
                select(Division)
                .where(Division.club_id == club_id, Division.is_active.is_(True))
                .order_by(Division.name)
            )
        )
        .scalars()
        .all()
    )


@router.get("/fixture", response_model=list[DivisionFixture])
async def club_fixture(
    club_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.club_ver_competencia))],
    upcoming: Annotated[bool, Query()] = False,
):
    """
    Partidos de todas las divisiones, con resultado si terminaron.

    Reusa la misma consulta que arma `GET /divisions/{id}/calendar`, sin el
    filtro de división: es sacar un `WHERE`, no lógica nueva.
    """
    club = await get_club_or_404(club_id, db)
    assert_club_access(club, current_user)

    divisions = await _active_divisions(club.id, db)
    if not divisions:
        return []

    matches = (
        await db.execute(
            select(Session, Tournament)
            .join(Tournament, Tournament.id == Session.tournament_id)
            .where(Tournament.division_id.in_([d.id for d in divisions]))
            .order_by(Session.scheduled_at.is_(None), Session.scheduled_at)
        )
    ).all()

    finished_ids = [s.id for s, _ in matches if s.status == SessionStatus.finished]
    events_by_session: dict[uuid.UUID, list[Event]] = {}
    if finished_ids:
        all_events = (
            await db.execute(select(Event).where(Event.session_id.in_(finished_ids)))
        ).scalars().all()
        for e in all_events:
            events_by_session.setdefault(e.session_id, []).append(e)

    # `status != finished` no alcanza para "próximo": un partido viejo sin
    # resultado (p.ej. un bye "vs LIBRE" que nunca se juega) queda eternamente
    # pendiente y aparecería como próximo aunque sea de hace meses. Un partido
    # sin fecha todavía puede ser genuinamente futuro (no se cargó la fecha
    # todavía) — sólo se excluye el que tiene una fecha *pasada* concreta. Ver
    # mismo fix en `dashboard.py::club_today`.
    now = datetime.now(timezone.utc)

    by_division: dict[uuid.UUID, list[FixtureMatch]] = {d.id: [] for d in divisions}
    for s, t in matches:
        if upcoming:
            if s.status == SessionStatus.finished:
                continue
            if s.scheduled_at is not None and s.scheduled_at < now:
                continue
        home_score = away_score = None
        if s.status == SessionStatus.finished:
            events = events_by_session.get(s.id, [])
            home_score, _ = score_from_events(events, "user")
            away_score, _ = score_from_events(events, "rival")
        by_division[t.division_id].append(
            FixtureMatch(
                session_id=s.id,
                home_team=s.home_team,
                away_team=s.away_team,
                scheduled_at=s.scheduled_at,
                status=s.status.value,
                home_score=home_score,
                away_score=away_score,
                tournament_id=t.id,
                tournament_name=t.name,
                season=t.season,
            )
        )

    return [
        DivisionFixture(division_id=d.id, division_name=d.name, matches=by_division[d.id])
        for d in divisions
    ]


@router.get("/standings", response_model=list[DivisionStandings])
async def club_standings(
    club_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.club_ver_competencia))],
):
    """
    Tabla de cada división con torneo activo.

    Una división sin torneo activo aparece con estado vacío, no se omite: que
    una división no tenga torneo cargado hoy es información, no un error.
    """
    club = await get_club_or_404(club_id, db)
    assert_club_access(club, current_user)

    divisions = await _active_divisions(club.id, db)
    if not divisions:
        return []

    tournaments = (
        await db.execute(
            select(Tournament)
            .where(
                Tournament.division_id.in_([d.id for d in divisions]),
                Tournament.is_active.is_(True),
            )
            # Por temporada, no por cuándo se cargó el registro: una carga masiva
            # (import histórico) inserta todo en el mismo lote, así que
            # `created_at` no dice nada sobre qué torneo es el vigente.
            # `season` nulo se manda al final en vez de ganar por default.
            .order_by(
                Tournament.season.is_(None),
                Tournament.season.desc(),
                Tournament.created_at.desc(),
            )
        )
    ).scalars().all()
    # Si una división tiene más de un torneo activo, se muestra el de la
    # temporada más reciente: la tabla es por competencia, y mezclar dos
    # competiciones daría una tabla sin sentido deportivo. Entre torneos de la
    # misma temporada, el orden de arriba ya viene por `created_at`, pero eso
    # es arbitrario en una carga masiva — así que dentro de cada división se
    # prueba en ese orden y se queda con el primero que realmente tenga
    # partidos terminados, no con el que ganó la moneda al voleo.
    candidates_by_division: dict[uuid.UUID, list[Tournament]] = {}
    for t in tournaments:
        candidates_by_division.setdefault(t.division_id, []).append(t)

    result: list[DivisionStandings] = []
    for d in divisions:
        tournament = None
        rows: list = []
        for candidate in candidates_by_division.get(d.id, []):
            candidate_rows = await compute_standings(candidate.id, db)
            if candidate_rows:
                tournament, rows = candidate, candidate_rows
                break
            if tournament is None:
                # Ninguno tuvo partidos todavía: nos quedamos con el primero
                # (temporada más reciente) para que la división muestre "sin
                # resultados" de SU torneo, no una tabla vacía sin contexto.
                tournament = candidate
        result.append(
            DivisionStandings(
                division_id=d.id,
                division_name=d.name,
                tournament_id=tournament.id if tournament else None,
                rows=rows,
            )
        )
    return result


@router.get("/convocatorias", response_model=list[DivisionConvocatoria])
async def club_convocatorias(
    club_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.club_ver_competencia))],
):
    """
    Convocatoria del próximo partido con convocatoria cargada, por división.

    A diferencia de `GET /sessions/{id}/squad/message` —que devuelve 404 sin
    convocatoria porque ahí el pedido es sobre un partido puntual— acá una
    división sin cargar se omite con motivo, no rompe el índice.
    """
    club = await get_club_or_404(club_id, db)
    assert_club_access(club, current_user)

    divisions = await _active_divisions(club.id, db)
    if not divisions:
        return []

    sessions = (
        await db.execute(
            select(Session, Tournament)
            .join(Tournament, Tournament.id == Session.tournament_id)
            .where(
                Tournament.division_id.in_([d.id for d in divisions]),
                Tournament.is_active.is_(True),
                Session.status != SessionStatus.finished,
            )
            .order_by(Session.scheduled_at.is_(None), Session.scheduled_at)
        )
    ).all()

    sessions_with_squad: set[uuid.UUID] = set(
        (
            await db.execute(
                select(MatchSquad.session_id)
                .where(MatchSquad.session_id.in_([s.id for s, _ in sessions]))
                .distinct()
            )
        ).scalars().all()
    ) if sessions else set()

    result: list[DivisionConvocatoria] = []
    seen_divisions: set[uuid.UUID] = set()
    for s, t in sessions:
        if t.division_id in seen_divisions or s.id not in sessions_with_squad:
            continue
        seen_divisions.add(t.division_id)
        members = (
            await db.execute(
                select(MatchSquad)
                .where(MatchSquad.session_id == s.id)
                .options(selectinload(MatchSquad.player))
            )
        ).scalars().all()
        result.append(
            DivisionConvocatoria(
                division_id=t.division_id,
                division_name=next(d.name for d in divisions if d.id == t.division_id),
                session_id=s.id,
                home_team=s.home_team,
                away_team=s.away_team,
                scheduled_at=s.scheduled_at,
                members=sorted(
                    (
                        SquadMemberResponse(
                            player_id=m.player_id,
                            player_name=m.player.name,
                            position=m.player.position,
                            status=m.status.value,
                        )
                        for m in members
                    ),
                    key=lambda m: m.player_name,
                ),
            )
        )

    for d in divisions:
        if d.id not in seen_divisions:
            result.append(
                DivisionConvocatoria(division_id=d.id, division_name=d.name, reason="sin_convocatoria")
            )

    order = {d.id: i for i, d in enumerate(divisions)}
    result.sort(key=lambda r: order[r.division_id])
    return result
