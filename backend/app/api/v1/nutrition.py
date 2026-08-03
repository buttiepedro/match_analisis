"""
Agenda de turnos con la nutricionista.

Horario y reserva son el mismo registro en distinto estado. La reserva se
resuelve con un `UPDATE` condicionado al estado actual —no lectura-y-después-
escritura— para que la base arbitre la carrera entre dos jugadores que
apuntan al mismo horario, no un chequeo previo que puede perder contra otro
request.
"""
import logging
import uuid
from datetime import datetime, timezone
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.deps import (
    assert_club_access,
    get_club_or_404,
    get_current_user,
    get_division_or_404,
    has_permission,
    require,
    scoped_division_ids,
)
from app.core.notifications import notify
from app.core.permissions import Permission
from app.models import Division, NotificationType, NutritionSlot, NutritionSlotStatus, Player, User
from app.schemas.nutrition_slot import (
    NutritionSlotBookRequest,
    NutritionSlotResponse,
    NutritionSlotsBatchCreate,
)

logger = logging.getLogger(__name__)

router = APIRouter()


async def _get_own_player(current_user: User, db: AsyncSession) -> Player:
    """Mismo patrón que `dashboard.py`: ningún endpoint acá toma un `player_id`."""
    player = await db.scalar(select(Player).where(Player.user_id == current_user.id))
    if not player:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Este usuario no está vinculado a ningún jugador",
        )
    return player


def _to_response(slot: NutritionSlot) -> NutritionSlotResponse:
    return NutritionSlotResponse(
        id=slot.id,
        starts_at=slot.starts_at,
        ends_at=slot.ends_at,
        status=slot.status.value,
        nutritionist_id=slot.nutritionist_id,
        division_id=slot.division_id,
        division_name=slot.division.name if slot.division else None,
        player_id=slot.player_id,
        player_name=slot.player.name if slot.player else None,
        notes=slot.notes,
        booked_at=slot.booked_at,
        cancelled_at=slot.cancelled_at,
    )


async def _notify_new_slots_published(division: Division, db: AsyncSession) -> None:
    """
    Avisa a los jugadores de la división cuando se publica agenda nueva —
    mismo criterio que `_notify_formation_loaded` en `lineup.py`: nunca se
    deja escapar, un fallo acá no puede tirar abajo la publicación de horarios.
    """
    try:
        recipients = (
            await db.execute(
                select(Player.user_id).where(
                    Player.division_id == division.id, Player.user_id.isnot(None)
                )
            )
        ).scalars().all()

        for user_id in recipients:
            await notify(
                db,
                user_id=user_id,
                club_id=division.club_id,
                type=NotificationType.turnos_publicados,
                title="Nuevos turnos de nutrición",
                body=f"Se publicaron horarios nuevos para {division.name}.",
                data={"url": "/mi-turno-nutricion"},
            )
    except Exception:
        logger.exception("No se pudo notificar los turnos publicados (división %s)", division.id)


def _format_when(starts_at: datetime) -> str:
    return starts_at.strftime("%d/%m a las %H:%M")


@router.post(
    "/divisions/{division_id}/nutrition-slots",
    response_model=list[NutritionSlotResponse],
    status_code=status.HTTP_201_CREATED,
)
async def create_nutrition_slots(
    division_id: uuid.UUID,
    body: NutritionSlotsBatchCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.nutricion_turnos_publicar))],
):
    """
    Alta en lote: la nutricionista bloquea la mañana del jueves en una sola carga.

    Se valida por **división**, no por club — igual que `create_training`: una
    nutricionista con alcance sólo a M17 no puede publicar agenda para Primera.
    """
    division = await get_division_or_404(division_id, db, current_user)

    if not body.slots:
        raise HTTPException(status_code=400, detail="No mandaste ningún horario")

    for entry in body.slots:
        if entry.ends_at <= entry.starts_at:
            raise HTTPException(
                status_code=400, detail="Un horario no puede terminar antes de empezar"
            )

    created = [
        NutritionSlot(
            id=uuid.uuid4(),
            club_id=division.club_id,
            division_id=division.id,
            nutritionist_id=current_user.id,
            starts_at=entry.starts_at,
            ends_at=entry.ends_at,
        )
        for entry in body.slots
    ]
    db.add_all(created)
    await db.commit()
    await _notify_new_slots_published(division, db)
    for s in created:
        await db.refresh(s, attribute_names=["division"])
    return [_to_response(s) for s in created]


@router.get("/clubs/{club_id}/nutrition-slots", response_model=list[NutritionSlotResponse])
async def list_nutrition_slots(
    club_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[
        User, Depends(require(Permission.nutricion_turnos_publicar, Permission.nutricion_turnos_reservar))
    ],
    date_from: Annotated[Optional[datetime], Query(alias="from")] = None,
    date_to: Annotated[Optional[datetime], Query(alias="to")] = None,
    status_filter: Annotated[Optional[str], Query(alias="status")] = None,
    nutritionist_id: Annotated[Optional[uuid.UUID], Query()] = None,
    division_id: Annotated[Optional[uuid.UUID], Query()] = None,
):
    """
    Sin `status`, filtra a `libre` para quien sólo puede reservar — no tiene
    sentido que un jugador vea turnos ya tomados por otro. Quien puede
    publicar ve su agenda completa, porque la necesita entera.

    Sin `division_id`: quien publica ve sus divisiones asignadas (todas si no
    tiene alcance restringido); quien sólo reserva ve la agenda de su propia
    división de jugador — nunca la de otra.
    """
    club = await get_club_or_404(club_id, db)
    assert_club_access(club, current_user)

    can_manage = has_permission(current_user, Permission.nutricion_turnos_publicar)

    query = select(NutritionSlot).where(NutritionSlot.club_id == club.id)
    if date_from:
        query = query.where(NutritionSlot.starts_at >= date_from)
    if date_to:
        query = query.where(NutritionSlot.starts_at <= date_to)
    if nutritionist_id:
        query = query.where(NutritionSlot.nutritionist_id == nutritionist_id)
    if status_filter:
        try:
            query = query.where(NutritionSlot.status == NutritionSlotStatus(status_filter))
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Estado desconocido: {status_filter}")
    elif not can_manage:
        query = query.where(NutritionSlot.status == NutritionSlotStatus.libre)

    if division_id:
        division = await get_division_or_404(division_id, db, current_user)
        query = query.where(NutritionSlot.division_id == division.id)
    elif can_manage:
        # `None` = sin alcance restringido, ve el club entero (incluidos los
        # turnos publicados antes de que existiera el alcance por división).
        scope = scoped_division_ids(current_user)
        if scope is not None:
            query = query.where(NutritionSlot.division_id.in_(scope))
    else:
        player = await _get_own_player(current_user, db)
        query = query.where(NutritionSlot.division_id == player.division_id)

    query = (
        query.order_by(NutritionSlot.starts_at)
        .options(selectinload(NutritionSlot.player), selectinload(NutritionSlot.division))
    )
    rows = (await db.execute(query)).scalars().all()
    return [_to_response(s) for s in rows]


@router.post("/nutrition-slots/{slot_id}/book", response_model=NutritionSlotResponse)
async def book_nutrition_slot(
    slot_id: uuid.UUID,
    body: NutritionSlotBookRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.nutricion_turnos_reservar))],
):
    slot = await db.scalar(select(NutritionSlot).where(NutritionSlot.id == slot_id))
    if not slot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Turno no encontrado")
    club = await get_club_or_404(slot.club_id, db)
    assert_club_access(club, current_user)
    player = await _get_own_player(current_user, db)

    # Un turno con división no es de cualquier jugador del club: es de la
    # nutricionista de esa división. Uno sin división (legacy) queda abierto.
    if slot.division_id is not None and slot.division_id != player.division_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Este turno es de otra división",
        )

    # La base arbitra la carrera: si otro jugador reservó un instante antes,
    # esto afecta cero filas y el segundo request ve el 409, no una lectura
    # obsoleta que hubiera dicho "libre" mintiendo.
    result = await db.execute(
        update(NutritionSlot)
        .where(NutritionSlot.id == slot_id, NutritionSlot.status == NutritionSlotStatus.libre)
        .values(
            status=NutritionSlotStatus.reservado,
            player_id=player.id,
            notes=body.notes,
            booked_at=datetime.now(timezone.utc),
        )
    )
    if result.rowcount == 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Alguien reservó este horario un instante antes",
        )
    await db.commit()
    await db.refresh(slot, attribute_names=["player"])

    when = _format_when(slot.starts_at)
    await notify(
        db,
        user_id=current_user.id,
        club_id=club.id,
        type=NotificationType.turno_confirmado,
        title="Turno confirmado",
        body=f"Tu turno con la nutricionista es el {when}.",
    )
    await notify(
        db,
        user_id=slot.nutritionist_id,
        club_id=club.id,
        type=NotificationType.turno_confirmado,
        title="Nuevo turno reservado",
        body=f"{player.name} reservó el {when}.",
    )

    return _to_response(slot)


@router.post("/nutrition-slots/{slot_id}/cancel", response_model=Optional[NutritionSlotResponse])
async def cancel_nutrition_slot(
    slot_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[
        User, Depends(require(Permission.nutricion_turnos_publicar, Permission.nutricion_turnos_reservar))
    ],
):
    """
    Cancelar un turno **reservado** no lo borra: pasa a `cancelado`. Si lo
    cancela la nutricionista, además libera un slot nuevo con el mismo
    horario para que otro jugador lo pueda tomar — si lo cancela el jugador,
    el horario queda cancelado nomás, y la nutricionista decide si lo vuelve
    a publicar. Cancelar uno **libre** (sólo puede hacerlo la nutricionista)
    lo saca de la lista directamente: no hubo reserva de la que dejar rastro.
    """
    slot = await db.scalar(
        select(NutritionSlot).where(NutritionSlot.id == slot_id).options(selectinload(NutritionSlot.player))
    )
    if not slot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Turno no encontrado")
    club = await get_club_or_404(slot.club_id, db)
    assert_club_access(club, current_user)

    is_nutritionist = has_permission(current_user, Permission.nutricion_turnos_publicar)

    if is_nutritionist:
        if slot.status == NutritionSlotStatus.libre:
            await db.delete(slot)
            await db.commit()
            return None

        if slot.status != NutritionSlotStatus.reservado:
            raise HTTPException(status_code=409, detail="Este turno ya está cancelado")

        cancelled_player = slot.player
        slot.status = NutritionSlotStatus.cancelado
        slot.cancelled_by = current_user.id
        slot.cancelled_at = datetime.now(timezone.utc)
        db.add(
            NutritionSlot(
                id=uuid.uuid4(),
                club_id=slot.club_id,
                division_id=slot.division_id,
                nutritionist_id=slot.nutritionist_id,
                starts_at=slot.starts_at,
                ends_at=slot.ends_at,
            )
        )
        await db.commit()
        await db.refresh(slot)

        if cancelled_player and cancelled_player.user_id:
            await notify(
                db,
                user_id=cancelled_player.user_id,
                club_id=club.id,
                type=NotificationType.turno_confirmado,
                title="Turno cancelado",
                body=f"Tu turno del {_format_when(slot.starts_at)} fue cancelado por la nutricionista.",
            )
        return _to_response(slot)

    # Un jugador sólo cancela el propio.
    player = await _get_own_player(current_user, db)
    if slot.player_id != player.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No es tu turno")
    if slot.status != NutritionSlotStatus.reservado:
        raise HTTPException(status_code=409, detail="Este turno no está reservado")

    slot.status = NutritionSlotStatus.cancelado
    slot.cancelled_by = current_user.id
    slot.cancelled_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(slot)

    await notify(
        db,
        user_id=slot.nutritionist_id,
        club_id=club.id,
        type=NotificationType.turno_confirmado,
        title="Turno cancelado",
        body=f"{player.name} canceló su turno del {_format_when(slot.starts_at)}.",
    )
    return _to_response(slot)


@router.get("/me/nutrition-appointments", response_model=list[NutritionSlotResponse])
async def my_nutrition_appointments(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    player = await _get_own_player(current_user, db)
    rows = (
        await db.execute(
            select(NutritionSlot)
            .where(NutritionSlot.player_id == player.id)
            .order_by(NutritionSlot.starts_at.desc())
            .options(selectinload(NutritionSlot.player))
        )
    ).scalars().all()
    return [_to_response(s) for s in rows]
