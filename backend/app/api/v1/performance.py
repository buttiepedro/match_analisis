"""
Endpoints for player measurements (anthropometric data) and physical tests.
Also includes batch-move players between divisions.
"""
import uuid
from datetime import date
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.anthropometry import calculate_bmi, calculate_body_fat
from app.core.database import get_db
from app.core.deps import assert_club_access, get_club_or_404, get_current_user, require_club_admin
from app.models import Division, Player, User
from app.models.player import PhysicalTest, PlayerDivisionHistory, PlayerMeasurement
from app.schemas.measurement import (
    BatchMoveRequest,
    MeasurementCreate,
    MeasurementResponse,
    PhysicalTestCreate,
    PhysicalTestRankingEntry,
    PhysicalTestResponse,
    TEST_TYPES,
)

router = APIRouter()


# ─── Helpers ──────────────────────────────────────────────────────────────────

async def _get_player_with_access(
    player_id: uuid.UUID,
    current_user: User,
    db: AsyncSession,
) -> Player:
    player = await db.scalar(select(Player).where(Player.id == player_id, Player.is_active.is_(True)))
    if not player:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Player not found")
    div = await db.scalar(select(Division).where(Division.id == player.division_id))
    club = await get_club_or_404(div.club_id, db)
    assert_club_access(club, current_user)
    return player


# ─── Measurements ─────────────────────────────────────────────────────────────

@router.post(
    "/players/{player_id}/measurements",
    response_model=MeasurementResponse,
    status_code=status.HTTP_201_CREATED,
    tags=["performance"],
)
async def create_measurement(
    player_id: uuid.UUID,
    body: MeasurementCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    player = await _get_player_with_access(player_id, current_user, db)

    bmi = calculate_bmi(body.weight_kg, body.height_cm)
    body_fat, body_fat_method = calculate_body_fat(
        tricep_mm=body.fat_fold_tricep_mm,
        subscapular_mm=body.fat_fold_subscapular_mm,
        suprailiac_mm=body.fat_fold_suprailiac_mm,
        biceps_mm=body.fat_fold_biceps_mm,
        abdominal_mm=body.fat_fold_abdominal_mm,
        date_of_birth=player.date_of_birth,
        sex=player.sex,
        measured_at=body.measured_at,
    )

    m = PlayerMeasurement(
        player_id=player.id,
        measured_at=body.measured_at,
        weight_kg=body.weight_kg,
        height_cm=body.height_cm,
        bmi=bmi,
        fat_fold_tricep_mm=body.fat_fold_tricep_mm,
        fat_fold_subscapular_mm=body.fat_fold_subscapular_mm,
        fat_fold_suprailiac_mm=body.fat_fold_suprailiac_mm,
        fat_fold_abdominal_mm=body.fat_fold_abdominal_mm,
        fat_fold_biceps_mm=body.fat_fold_biceps_mm,
        body_fat_percent=body_fat,
        body_fat_method=body_fat_method,
        notes=body.notes,
        recorded_by=current_user.id,
    )
    db.add(m)
    await db.commit()
    await db.refresh(m)
    return m


@router.get(
    "/players/{player_id}/measurements",
    response_model=list[MeasurementResponse],
    tags=["performance"],
)
async def list_measurements(
    player_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    await _get_player_with_access(player_id, current_user, db)
    result = await db.execute(
        select(PlayerMeasurement)
        .where(PlayerMeasurement.player_id == player_id)
        .order_by(PlayerMeasurement.measured_at.desc())
    )
    return result.scalars().all()


@router.delete(
    "/players/{player_id}/measurements/{measurement_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    tags=["performance"],
)
async def delete_measurement(
    player_id: uuid.UUID,
    measurement_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_club_admin)],
):
    await _get_player_with_access(player_id, current_user, db)
    m = await db.scalar(
        select(PlayerMeasurement).where(
            PlayerMeasurement.id == measurement_id,
            PlayerMeasurement.player_id == player_id,
        )
    )
    if not m:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Measurement not found")
    await db.delete(m)
    await db.commit()


# ─── Physical Tests ────────────────────────────────────────────────────────────

@router.post(
    "/players/{player_id}/tests",
    response_model=PhysicalTestResponse,
    status_code=status.HTTP_201_CREATED,
    tags=["performance"],
)
async def create_physical_test(
    player_id: uuid.UUID,
    body: PhysicalTestCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    player = await _get_player_with_access(player_id, current_user, db)
    unit = TEST_TYPES[body.test_type]["unit"]

    t = PhysicalTest(
        player_id=player.id,
        test_date=body.test_date,
        test_type=body.test_type,
        value=body.value,
        unit=unit,
        notes=body.notes,
        recorded_by=current_user.id,
    )
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return t


@router.get(
    "/players/{player_id}/tests",
    response_model=list[PhysicalTestResponse],
    tags=["performance"],
)
async def list_physical_tests(
    player_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    test_type: Optional[str] = Query(None),
):
    await _get_player_with_access(player_id, current_user, db)
    filters = [PhysicalTest.player_id == player_id]
    if test_type:
        filters.append(PhysicalTest.test_type == test_type)
    result = await db.execute(
        select(PhysicalTest).where(and_(*filters)).order_by(PhysicalTest.test_date.desc())
    )
    return result.scalars().all()


@router.delete(
    "/players/{player_id}/tests/{test_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    tags=["performance"],
)
async def delete_physical_test(
    player_id: uuid.UUID,
    test_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_club_admin)],
):
    await _get_player_with_access(player_id, current_user, db)
    t = await db.scalar(
        select(PhysicalTest).where(
            PhysicalTest.id == test_id,
            PhysicalTest.player_id == player_id,
        )
    )
    if not t:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Test not found")
    await db.delete(t)
    await db.commit()


@router.get(
    "/divisions/{division_id}/tests/ranking",
    response_model=list[PhysicalTestRankingEntry],
    tags=["performance"],
)
async def division_test_ranking(
    division_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    test_type: str = Query(...),
    test_date: Optional[date] = Query(None),
):
    div = await db.scalar(select(Division).where(Division.id == division_id))
    if not div:
        raise HTTPException(status_code=404, detail="Division not found")
    club = await get_club_or_404(div.club_id, db)
    assert_club_access(club, current_user)

    players_result = await db.execute(
        select(Player).where(Player.division_id == division_id, Player.is_active.is_(True))
    )
    players = {p.id: p for p in players_result.scalars().all()}

    filters = [
        PhysicalTest.player_id.in_(players.keys()),
        PhysicalTest.test_type == test_type,
    ]
    if test_date:
        filters.append(PhysicalTest.test_date == test_date)

    tests_result = await db.execute(
        select(PhysicalTest).where(and_(*filters)).order_by(PhysicalTest.test_date.desc())
    )
    all_tests = tests_result.scalars().all()

    # Keep best (most recent) result per player
    seen: set[uuid.UUID] = set()
    best: list[PhysicalTest] = []
    for t in all_tests:
        if t.player_id not in seen:
            seen.add(t.player_id)
            best.append(t)

    # Sort: ascending for time-based tests, descending for strength/jump
    time_units = {"seconds"}
    reverse = TEST_TYPES.get(test_type, {}).get("unit") not in time_units
    best.sort(key=lambda t: float(t.value), reverse=reverse)

    return [
        PhysicalTestRankingEntry(
            player_id=t.player_id,
            player_name=players[t.player_id].name,
            value=t.value,
            unit=t.unit,
            test_date=t.test_date,
            rank=i + 1,
        )
        for i, t in enumerate(best)
    ]


# ─── Batch Move Players ────────────────────────────────────────────────────────

@router.patch(
    "/players/batch-move",
    status_code=status.HTTP_200_OK,
    tags=["squad"],
)
async def batch_move_players(
    body: BatchMoveRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require_club_admin)],
):
    if not body.player_ids:
        raise HTTPException(status_code=400, detail="player_ids no puede estar vacío")

    to_div = await db.scalar(select(Division).where(Division.id == body.to_division_id))
    if not to_div:
        raise HTTPException(status_code=404, detail="División destino no encontrada")
    club = await get_club_or_404(to_div.club_id, db)
    assert_club_access(club, current_user)

    players_result = await db.execute(
        select(Player).where(
            Player.id.in_(body.player_ids),
            Player.is_active.is_(True),
        )
    )
    players = players_result.scalars().all()

    if len(players) != len(body.player_ids):
        raise HTTPException(status_code=404, detail="Uno o más jugadores no encontrados")

    # Verify all players belong to the same club
    for p in players:
        p_div = await db.scalar(select(Division).where(Division.id == p.division_id))
        if not p_div or p_div.club_id != club.id:
            raise HTTPException(status_code=403, detail=f"Jugador {p.id} no pertenece al club")

    today = date.today()
    for p in players:
        if p.division_id == body.to_division_id:
            continue
        # Close current history entry
        open_history = await db.scalar(
            select(PlayerDivisionHistory).where(
                PlayerDivisionHistory.player_id == p.id,
                PlayerDivisionHistory.to_date.is_(None),
            )
        )
        if open_history:
            open_history.to_date = today

        # Create new history entry
        db.add(
            PlayerDivisionHistory(
                player_id=p.id,
                division_id=body.to_division_id,
                from_date=today,
                moved_by=current_user.id,
            )
        )
        p.division_id = body.to_division_id

    await db.commit()
    return {"moved": len(players), "to_division_id": str(body.to_division_id)}


# ─── Player division history ───────────────────────────────────────────────────

@router.get(
    "/players/{player_id}/history",
    tags=["squad"],
)
async def get_player_history(
    player_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    await _get_player_with_access(player_id, current_user, db)
    result = await db.execute(
        select(PlayerDivisionHistory, Division.name)
        .join(Division, PlayerDivisionHistory.division_id == Division.id)
        .where(PlayerDivisionHistory.player_id == player_id)
        .order_by(PlayerDivisionHistory.from_date.desc())
    )
    rows = result.all()
    return [
        {
            "id": str(h.id),
            "division_id": str(h.division_id),
            "division_name": name,
            "from_date": str(h.from_date),
            "to_date": str(h.to_date) if h.to_date else None,
        }
        for h, name in rows
    ]
