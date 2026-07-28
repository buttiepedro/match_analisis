"""
Lesiones y disponibilidad del jugador.

`players.availability` está desnormalizado: lo escriben **únicamente** los
endpoints de este módulo, a partir de las lesiones abiertas. Cualquier otro
camino de escritura lo desincronizaría.
"""
import uuid
from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.permissions import Permission
from app.core.deps import (
    assert_division_access,
    get_current_user,
    get_division_or_404,
    require,
    require_club_admin,
    require_player_self,
)
from app.models import (
    Availability,
    Division,
    Event,
    InjurySeverity,
    Player,
    PlayerInjury,
    Session,
    Tournament,
    User,
    UserRole,
)
from app.schemas.injury import (
    AvailabilityUpdate,
    DivisionAvailabilityRow,
    InjuryCreate,
    InjuryResponse,
    InjuryUpdate,
    SuspensionCandidate,
)

router = APIRouter()

#: Ventana de aviso para el vencimiento del apto médico.
CLEARANCE_WARNING_DAYS = 30


async def _get_division_or_404(
    division_id: uuid.UUID, db: AsyncSession, current_user: User
) -> Division:
    return await get_division_or_404(division_id, db, current_user)


async def _get_player_or_404(
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


async def _sync_availability(player: Player, db: AsyncSession) -> None:
    """
    Recalcula `availability` desde las lesiones abiertas.

    Una suspensión no se toca acá: la decide el club por tarjeta roja y no tiene
    nada que ver con el estado médico.
    """
    if player.availability == Availability.suspendido:
        return

    open_injury = await db.scalar(
        select(PlayerInjury).where(
            PlayerInjury.player_id == player.id, PlayerInjury.actual_return.is_(None)
        )
    )
    player.availability = Availability.lesionado if open_injury else Availability.disponible


@router.get("/players/{player_id}/injuries", response_model=list[InjuryResponse])
async def list_injuries(
    player_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    await _get_player_or_404(player_id, db, current_user)
    result = await db.execute(
        select(PlayerInjury)
        .where(PlayerInjury.player_id == player_id)
        .order_by(PlayerInjury.injury_date.desc())
    )
    return result.scalars().all()


@router.post(
    "/players/{player_id}/injuries",
    response_model=InjuryResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_injury(
    player_id: uuid.UUID,
    body: InjuryCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.medico_editar))],
):
    player = await _get_player_or_404(player_id, db, current_user)

    injury = PlayerInjury(
        id=uuid.uuid4(),
        player_id=player.id,
        injury_date=body.injury_date,
        body_zone=body.body_zone,
        injury_type=body.injury_type,
        severity=InjurySeverity(body.severity),
        expected_return=body.expected_return,
        actual_return=body.actual_return,
        notes=body.notes,
        recorded_by=current_user.id,
    )
    db.add(injury)
    await db.flush()
    await _sync_availability(player, db)
    await db.commit()
    await db.refresh(injury)
    return injury


@router.patch("/injuries/{injury_id}", response_model=InjuryResponse)
async def update_injury(
    injury_id: uuid.UUID,
    body: InjuryUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.medico_editar))],
):
    injury = await db.scalar(select(PlayerInjury).where(PlayerInjury.id == injury_id))
    if not injury:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lesión no encontrada")
    player = await _get_player_or_404(injury.player_id, db, current_user)

    for field in ("injury_date", "body_zone", "injury_type", "expected_return", "notes"):
        value = getattr(body, field)
        if value is not None:
            setattr(injury, field, value)
    if body.severity is not None:
        injury.severity = InjurySeverity(body.severity)
    # `actual_return` se distingue por `model_fields_set`: mandarlo en null es
    # reabrir la lesión, no "no lo toques".
    if "actual_return" in body.model_fields_set:
        injury.actual_return = body.actual_return

    await db.flush()
    await _sync_availability(player, db)
    await db.commit()
    await db.refresh(injury)
    return injury


@router.delete("/injuries/{injury_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_injury(
    injury_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.medico_editar))],
):
    injury = await db.scalar(select(PlayerInjury).where(PlayerInjury.id == injury_id))
    if not injury:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lesión no encontrada")
    player = await _get_player_or_404(injury.player_id, db, current_user)

    await db.delete(injury)
    await db.flush()
    await _sync_availability(player, db)
    await db.commit()


@router.patch("/players/{player_id}/availability", response_model=DivisionAvailabilityRow)
async def set_availability(
    player_id: uuid.UUID,
    body: AvailabilityUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.medico_editar))],
):
    """Suspensión y baja temporal se cargan a mano; lesionado sale de las lesiones."""
    player = await _get_player_or_404(player_id, db, current_user)

    if body.availability is not None:
        player.availability = Availability(body.availability)
    if "medical_clearance_date" in body.model_fields_set:
        player.medical_clearance_date = body.medical_clearance_date
    if "medical_clearance_expires" in body.model_fields_set:
        player.medical_clearance_expires = body.medical_clearance_expires

    await db.commit()
    await db.refresh(player)
    return _availability_row(player)


def _availability_row(player: Player) -> DivisionAvailabilityRow:
    today = date.today()
    expires = player.medical_clearance_expires
    return DivisionAvailabilityRow(
        player_id=player.id,
        player_name=player.name,
        position=player.position,
        availability=player.availability.value,
        medical_clearance_expires=expires,
        clearance_expired=bool(expires and expires < today),
        clearance_expiring=bool(
            expires and today <= expires <= today + timedelta(days=CLEARANCE_WARNING_DAYS)
        ),
    )


@router.get("/divisions/{division_id}/suspension-candidates", response_model=list[SuspensionCandidate])
async def suspension_candidates(
    division_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.medico_ver))],
    days: Annotated[int, Query(ge=1, le=365)] = 60,
):
    """
    Jugadores con roja reciente que **todavía no** están suspendidos.

    Es una sugerencia, no una acción: la suspensión y su duración las define el
    tribunal de la unión, no el sistema. Acá sólo se evita que una roja se
    traspapele y el tipo termine convocado.
    """
    division = await _get_division_or_404(division_id, db, current_user)
    since = date.today() - timedelta(days=days)

    rows = (
        await db.execute(
            select(Event, Session, Player)
            .join(Session, Session.id == Event.session_id)
            .join(Tournament, Tournament.id == Session.tournament_id)
            .join(Player, Player.id == Event.player_id)
            .where(
                Event.event_type == "red_card",
                Tournament.division_id == division.id,
                Player.availability != Availability.suspendido,
                Player.is_active.is_(True),
                func.date(Event.recorded_at) >= since,
            )
            .order_by(Event.recorded_at.desc())
        )
    ).all()

    seen: set[uuid.UUID] = set()
    candidates: list[SuspensionCandidate] = []
    for event, session, player in rows:
        if player.id in seen:
            continue
        seen.add(player.id)
        candidates.append(
            SuspensionCandidate(
                player_id=player.id,
                player_name=player.name,
                session_id=session.id,
                match_label=f"{session.home_team} vs {session.away_team}",
                card_date=event.recorded_at.date(),
            )
        )
    return candidates


@router.get("/divisions/{division_id}/availability", response_model=list[DivisionAvailabilityRow])
async def division_availability(
    division_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.medico_ver))],
    only_unavailable: Annotated[bool, Query()] = False,
):
    await _get_division_or_404(division_id, db, current_user)

    players = (
        await db.execute(
            select(Player)
            .where(Player.division_id == division_id, Player.is_active.is_(True))
            .order_by(Player.name)
        )
    ).scalars().all()

    rows = [_availability_row(p) for p in players]
    if only_unavailable:
        rows = [
            r
            for r in rows
            if r.availability != Availability.disponible.value or r.clearance_expired
        ]
    return rows
