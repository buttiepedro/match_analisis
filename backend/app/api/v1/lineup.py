import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.deps import get_current_user, get_division_or_404, require_club_admin
from app.models import (
    Division,
    Event,
    MatchLineup,
    MatchSquad,
    Player,
    Session,
    SessionStatus,
    SquadStatus,
    Tournament,
    User,
    UserRole,
)
from app.models.player import LineupStatus
from app.schemas.player import (
    LineupBulkRequest,
    LineupEntryCreate,
    LineupEntryResponse,
    LineupEntryUpdate,
    SquadBulkRequest,
    SquadMemberResponse,
    SubstituteRequest,
    SuggestedLineupEntry,
    SuggestedLineupResponse,
)
from app.ws.manager import manager

router = APIRouter(prefix="/sessions")


async def _get_session_and_club(
    session_id: uuid.UUID, db: AsyncSession, current_user: User
) -> tuple[Session, uuid.UUID]:
    """Devuelve la sesión y el club dueño del torneo, validando el acceso."""
    session = await db.scalar(select(Session).where(Session.id == session_id))
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    tournament = await db.scalar(select(Tournament).where(Tournament.id == session.tournament_id))
    # El partido cuelga de un torneo, y el torneo de una división: el alcance del
    # usuario se valida ahí, no sólo contra el club.
    await get_division_or_404(tournament.division_id, db, current_user)

    return session, tournament.club_id


async def _get_session_and_check_access(
    session_id: uuid.UUID, db: AsyncSession, current_user: User
) -> Session:
    session, _ = await _get_session_and_club(session_id, db, current_user)
    return session


async def _get_club_player_or_404(
    player_id: uuid.UUID, club_id: uuid.UUID, db: AsyncSession
) -> Player:
    """
    Busca un jugador **dentro del club dueño de la sesión**.

    Sin el join contra `divisions`, cualquier club_admin podía sumar a su lineup
    un jugador de otro club con solo conocer su UUID.
    """
    player = await db.scalar(
        select(Player)
        .join(Division, Division.id == Player.division_id)
        .where(
            Player.id == player_id,
            Player.is_active.is_(True),
            Division.club_id == club_id,
        )
    )
    if not player:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Player not found")
    return player


async def _assert_jersey_free(
    db: AsyncSession,
    session_id: uuid.UUID,
    team: str,
    jersey_number: int,
    *,
    exclude_entry_id: uuid.UUID | None = None,
) -> None:
    """
    El número de camiseta identifica al jugador en los eventos (`player_number`),
    así que un duplicado ensucia las estadísticas sin que nadie se entere.
    """
    query = select(MatchLineup).where(
        MatchLineup.session_id == session_id,
        MatchLineup.team == team,
        MatchLineup.jersey_number == jersey_number,
    )
    if exclude_entry_id is not None:
        query = query.where(MatchLineup.id != exclude_entry_id)

    clash = await db.scalar(query.options(selectinload(MatchLineup.player)))
    if clash:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"El número {jersey_number} ya lo usa {clash.player.name} en este equipo",
        )


@router.post("/{session_id}/lineup", response_model=LineupEntryResponse, status_code=status.HTTP_201_CREATED)
async def add_to_lineup(
    session_id: uuid.UUID,
    body: LineupEntryCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_club_admin)],
):
    session, club_id = await _get_session_and_club(session_id, db, current_user)

    player = await _get_club_player_or_404(body.player_id, club_id, db)
    await _assert_jersey_free(db, session.id, body.team, body.jersey_number)

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


@router.patch("/{session_id}/lineup/{entry_id}", response_model=LineupEntryResponse)
async def update_lineup_entry(
    session_id: uuid.UUID,
    entry_id: uuid.UUID,
    body: LineupEntryUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_club_admin)],
):
    await _get_session_and_check_access(session_id, db, current_user)

    entry = await db.scalar(
        select(MatchLineup)
        .where(MatchLineup.id == entry_id, MatchLineup.session_id == session_id)
        .options(selectinload(MatchLineup.player))
    )
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lineup entry not found")

    if body.jersey_number is not None:
        await _assert_jersey_free(
            db, session_id, entry.team, body.jersey_number, exclude_entry_id=entry.id
        )
        entry.jersey_number = body.jersey_number
    if body.position is not None:
        entry.position = body.position

    await db.commit()
    await db.refresh(entry)
    return entry


@router.delete("/{session_id}/lineup/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_lineup_entry(
    session_id: uuid.UUID,
    entry_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_club_admin)],
):
    await _get_session_and_check_access(session_id, db, current_user)

    entry = await db.scalar(
        select(MatchLineup).where(MatchLineup.id == entry_id, MatchLineup.session_id == session_id)
    )
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lineup entry not found")

    await db.delete(entry)
    await db.commit()


@router.put("/{session_id}/lineup", response_model=list[LineupEntryResponse])
async def replace_lineup(
    session_id: uuid.UUID,
    body: LineupBulkRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_club_admin)],
):
    """
    Reemplaza el lineup de un equipo entero.

    Se valida **todo antes de escribir nada**: cargar 23 jugadores de a uno dejaba
    estados intermedios inválidos (dos #10 a mitad de carga) que después había que
    ir a arreglar a mano.
    """
    session, club_id = await _get_session_and_club(session_id, db, current_user)

    # Con el partido empezado hay jugadores en `substituted_out`: reemplazar el
    # lineup entero borraría el registro de quién entró y salió. Para corregir algo
    # a mitad de partido están los endpoints por jugador.
    if session.status != SessionStatus.scheduled:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="El partido ya empezó: editá el lineup jugador por jugador para no perder los cambios registrados",
        )

    numbers = [e.jersey_number for e in body.entries]
    duplicates = {n for n in numbers if numbers.count(n) > 1}
    if duplicates:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Número de camiseta repetido: {', '.join(str(n) for n in sorted(duplicates))}",
        )

    player_ids = [e.player_id for e in body.entries]
    if len(set(player_ids)) != len(player_ids):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Hay un jugador repetido en el lineup",
        )

    for entry in body.entries:
        await _get_club_player_or_404(entry.player_id, club_id, db)

    # Recién acá se toca la base: si algo falló arriba, el lineup viejo sigue intacto.
    await db.execute(
        delete(MatchLineup).where(
            MatchLineup.session_id == session.id, MatchLineup.team == body.team
        )
    )
    await db.flush()

    for entry in body.entries:
        db.add(
            MatchLineup(
                id=uuid.uuid4(),
                session_id=session.id,
                player_id=entry.player_id,
                jersey_number=entry.jersey_number,
                position=entry.position,
                team=body.team,
                status=LineupStatus(entry.status),
            )
        )

    await db.commit()

    result = await db.execute(
        select(MatchLineup)
        .where(MatchLineup.session_id == session.id, MatchLineup.team == body.team)
        .options(selectinload(MatchLineup.player))
        .order_by(MatchLineup.jersey_number)
    )
    return result.scalars().all()


@router.get("/{session_id}/lineup/suggested", response_model=SuggestedLineupResponse)
async def suggested_lineup(
    session_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_club_admin)],
    team: str = "user",
):
    """
    Devuelve el lineup del último partido de la misma división.

    El lineup real cambia poco entre fechas: partir del anterior y corregir dos o
    tres nombres es muchísimo más rápido que cargar 23 de cero.
    """
    session, club_id = await _get_session_and_club(session_id, db, current_user)
    tournament = await db.scalar(select(Tournament).where(Tournament.id == session.tournament_id))

    previous = await db.scalar(
        select(Session)
        .join(Tournament, Tournament.id == Session.tournament_id)
        .join(MatchLineup, MatchLineup.session_id == Session.id)
        .where(
            Tournament.division_id == tournament.division_id,
            Session.id != session.id,
            Session.created_at < session.created_at,
            MatchLineup.team == team,
        )
        .order_by(Session.created_at.desc())
        .limit(1)
    )
    if not previous:
        return SuggestedLineupResponse(entries=[])

    rows = (
        await db.execute(
            select(MatchLineup)
            .where(MatchLineup.session_id == previous.id, MatchLineup.team == team)
            .options(selectinload(MatchLineup.player).selectinload(Player.division))
            .order_by(MatchLineup.jersey_number)
        )
    ).scalars().all()

    return SuggestedLineupResponse(
        source_session_id=previous.id,
        source_label=f"{previous.home_team} vs {previous.away_team}",
        entries=[
            SuggestedLineupEntry(
                player_id=r.player_id,
                player_name=r.player.name,
                jersey_number=r.jersey_number,
                position=r.position,
                # `substituted_out` en el partido viejo no significa nada acá:
                # lo que se copia es quién arrancó, no cómo terminó.
                status="bench" if r.status == LineupStatus.bench else "on_field",
                available=(
                    r.player.is_active and r.player.division.club_id == club_id
                ),
            )
            for r in rows
        ],
    )


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


# ── Convocatoria ──────────────────────────────────────────────────────────────

@router.put("/{session_id}/squad", response_model=list[SquadMemberResponse])
async def replace_squad(
    session_id: uuid.UUID,
    body: SquadBulkRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_club_admin)],
):
    session, club_id = await _get_session_and_club(session_id, db, current_user)

    for entry in body.entries:
        await _get_club_player_or_404(entry.player_id, club_id, db)

    await db.execute(delete(MatchSquad).where(MatchSquad.session_id == session.id))
    await db.flush()

    for entry in body.entries:
        db.add(
            MatchSquad(
                id=uuid.uuid4(),
                session_id=session.id,
                player_id=entry.player_id,
                status=SquadStatus(entry.status),
            )
        )

    await db.commit()
    return await get_squad(session_id, db, current_user)


@router.get("/{session_id}/squad", response_model=list[SquadMemberResponse])
async def get_squad(
    session_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    await _get_session_and_check_access(session_id, db, current_user)

    rows = (
        await db.execute(
            select(MatchSquad)
            .where(MatchSquad.session_id == session_id)
            .options(selectinload(MatchSquad.player))
        )
    ).scalars().all()

    return sorted(
        (
            SquadMemberResponse(
                player_id=r.player_id,
                player_name=r.player.name,
                position=r.player.position,
                status=r.status.value,
            )
            for r in rows
        ),
        key=lambda m: m.player_name,
    )


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
