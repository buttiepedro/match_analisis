"""
Entrenamientos y asistencia.

La asistencia se toma en la cancha, muchas veces sin señal: por eso la escritura
es un `PUT` de la planilla completa e **idempotente**, para que la cola offline
pueda reenviarlo sin duplicar nada.
"""
import uuid
from datetime import date, timedelta
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import case, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.deps import (
    assert_division_access,
    get_current_user,
    get_division_or_404,
    require,
    require_player_self,
)
from app.core.permissions import Permission
from app.models import (
    Attendance,
    AttendanceStatus,
    Division,
    Player,
    Training,
    TrainingType,
    User,
    UserRole,
)
from app.schemas.training import (
    AttendanceBulkRequest,
    AttendancePlayerResponse,
    DivisionAttendanceSummary,
    PlayerAttendanceDetail,
    PlayerAttendanceSummary,
    TrainingAttendanceRecord,
    TrainingCreate,
    TrainingResponse,
    TrainingUpdate,
    TrainingWithCountsResponse,
    WeekdayAttendance,
)

router = APIRouter()

#: Un jugador se marca "en riesgo" con esta racha de ausencias seguidas...
AT_RISK_STREAK = 3
#: ...o por debajo de este porcentaje en la ventana corta.
AT_RISK_PERCENT = 50.0
#: Estados que cuentan como asistencia efectiva.
ATTENDED = (AttendanceStatus.presente, AttendanceStatus.tarde)
#: `date.weekday()`: 0 = lunes.
WEEKDAY_LABELS = ("Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo")


async def _get_division_or_404(
    division_id: uuid.UUID, db: AsyncSession, current_user: User
) -> Division:
    return await get_division_or_404(division_id, db, current_user)


async def _get_training_or_404(
    training_id: uuid.UUID, db: AsyncSession, current_user: User
) -> Training:
    """
    El entrenamiento se valida por su **división**, no por su club.

    Validar sólo el club dejaba que el entrenador de M17 borrara los entrenamientos
    de Primera y pisara su asistencia.
    """
    training = await db.scalar(select(Training).where(Training.id == training_id))
    if not training:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Entrenamiento no encontrado"
        )
    await get_division_or_404(training.division_id, db, current_user)
    return training


# ── Entrenamientos ────────────────────────────────────────────────────────────

@router.post(
    "/divisions/{division_id}/trainings",
    response_model=TrainingResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_training(
    division_id: uuid.UUID,
    body: TrainingCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.entrenamiento_gestionar))],
):
    division = await _get_division_or_404(division_id, db, current_user)

    training = Training(
        id=uuid.uuid4(),
        club_id=division.club_id,
        division_id=division.id,
        date=body.date,
        type=TrainingType(body.type),
        notes=body.notes,
        location=body.location,
        created_by=current_user.id,
    )
    db.add(training)
    await db.commit()
    await db.refresh(training)
    return training


@router.get(
    "/divisions/{division_id}/trainings", response_model=list[TrainingWithCountsResponse]
)
async def list_trainings(
    division_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.asistencia_ver))],
    date_from: Annotated[Optional[date], Query(alias="from")] = None,
    date_to: Annotated[Optional[date], Query(alias="to")] = None,
):
    await _get_division_or_404(division_id, db, current_user)

    query = select(Training).where(Training.division_id == division_id)
    if date_from:
        query = query.where(Training.date >= date_from)
    if date_to:
        query = query.where(Training.date <= date_to)

    result = await db.execute(query.order_by(Training.date.desc()))
    trainings = result.scalars().all()
    if not trainings:
        return []

    counts = await db.execute(
        select(
            Attendance.training_id,
            func.count().label("total"),
            func.sum(
                case((Attendance.status.in_(ATTENDED), 1), else_=0)
            ).label("present"),
        )
        .where(Attendance.training_id.in_([t.id for t in trainings]))
        .group_by(Attendance.training_id)
    )
    by_training = {row.training_id: row for row in counts}

    return [
        TrainingWithCountsResponse(
            id=t.id,
            division_id=t.division_id,
            date=t.date,
            type=t.type.value,
            notes=t.notes,
            location=t.location,
            present_count=int(by_training[t.id].present or 0) if t.id in by_training else 0,
            total_count=int(by_training[t.id].total) if t.id in by_training else 0,
        )
        for t in trainings
    ]


@router.get("/trainings/{training_id}", response_model=TrainingResponse)
async def get_training(
    training_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.asistencia_ver))],
):
    return await _get_training_or_404(training_id, db, current_user)


@router.patch("/trainings/{training_id}", response_model=TrainingResponse)
async def update_training(
    training_id: uuid.UUID,
    body: TrainingUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.entrenamiento_gestionar))],
):
    training = await _get_training_or_404(training_id, db, current_user)

    if body.date is not None:
        training.date = body.date
    if body.type is not None:
        training.type = TrainingType(body.type)
    if body.notes is not None:
        training.notes = body.notes
    if body.location is not None:
        training.location = body.location

    await db.commit()
    await db.refresh(training)
    return training


@router.delete("/trainings/{training_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_training(
    training_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.entrenamiento_gestionar))],
):
    training = await _get_training_or_404(training_id, db, current_user)
    await db.execute(delete(Attendance).where(Attendance.training_id == training.id))
    await db.delete(training)
    await db.commit()


# ── Asistencia ────────────────────────────────────────────────────────────────

@router.get(
    "/trainings/{training_id}/attendance", response_model=list[AttendancePlayerResponse]
)
async def get_attendance(
    training_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.asistencia_ver))],
):
    """Devuelve **todo el plantel** de la división, con el estado ya cargado si lo hay."""
    training = await _get_training_or_404(training_id, db, current_user)

    players = (
        await db.execute(
            select(Player)
            .where(Player.division_id == training.division_id, Player.is_active.is_(True))
            .order_by(Player.name)
        )
    ).scalars().all()

    records = (
        await db.execute(select(Attendance).where(Attendance.training_id == training.id))
    ).scalars().all()
    by_player = {r.player_id: r for r in records}

    return [
        AttendancePlayerResponse(
            player_id=p.id,
            player_name=p.name,
            position=p.position,
            status=by_player[p.id].status.value if p.id in by_player else None,
            notes=by_player[p.id].notes if p.id in by_player else None,
        )
        for p in players
    ]


@router.put(
    "/trainings/{training_id}/attendance", response_model=list[AttendancePlayerResponse]
)
async def save_attendance(
    training_id: uuid.UUID,
    body: AttendanceBulkRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.asistencia_cargar))],
):
    """
    Upsert de la planilla completa. Reenviar el mismo cuerpo dos veces deja el
    mismo estado: es lo que permite que la cola offline reintente sin pensar.
    """
    training = await _get_training_or_404(training_id, db, current_user)

    valid_player_ids = set(
        (
            await db.execute(
                select(Player.id).where(
                    Player.division_id == training.division_id, Player.is_active.is_(True)
                )
            )
        ).scalars().all()
    )

    unknown = [e.player_id for e in body.entries if e.player_id not in valid_player_ids]
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"{len(unknown)} jugador(es) no pertenecen a la división de este entrenamiento",
        )

    existing = {
        r.player_id: r
        for r in (
            await db.execute(select(Attendance).where(Attendance.training_id == training.id))
        ).scalars().all()
    }

    for entry in body.entries:
        record = existing.get(entry.player_id)
        if record:
            record.status = AttendanceStatus(entry.status)
            record.notes = entry.notes
            record.recorded_by = current_user.id
        else:
            db.add(
                Attendance(
                    id=uuid.uuid4(),
                    training_id=training.id,
                    player_id=entry.player_id,
                    status=AttendanceStatus(entry.status),
                    notes=entry.notes,
                    recorded_by=current_user.id,
                )
            )

    await db.commit()
    return await get_attendance(training_id, db, current_user)


# ── Métricas derivadas ────────────────────────────────────────────────────────

def _streak_of_absences(statuses: list[AttendanceStatus]) -> int:
    """
    `statuses` viene del entrenamiento más reciente al más viejo.

    Solo cuenta `ausente`: una falta justificada no es señal de deserción, y
    contarla como tal llenaría la pantalla de falsos positivos.
    """
    streak = 0
    for st in statuses:
        if st == AttendanceStatus.ausente:
            streak += 1
        else:
            break
    return streak


@router.get(
    "/divisions/{division_id}/attendance/summary", response_model=DivisionAttendanceSummary
)
async def attendance_summary(
    division_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.asistencia_ver))],
    days: Annotated[int, Query(ge=1, le=730)] = 30,
):
    await _get_division_or_404(division_id, db, current_user)
    since = date.today() - timedelta(days=days)

    trainings = (
        await db.execute(
            select(Training)
            .where(Training.division_id == division_id, Training.date >= since)
            .order_by(Training.date.desc())
        )
    ).scalars().all()

    players = (
        await db.execute(
            select(Player)
            .where(Player.division_id == division_id, Player.is_active.is_(True))
            .order_by(Player.name)
        )
    ).scalars().all()

    if not trainings or not players:
        return DivisionAttendanceSummary(
            division_id=division_id,
            days=days,
            trainings_count=len(trainings),
            average_percent=0.0,
            players=[],
        )

    training_order = {t.id: i for i, t in enumerate(trainings)}  # 0 = más reciente
    records = (
        await db.execute(
            select(Attendance).where(Attendance.training_id.in_(list(training_order)))
        )
    ).scalars().all()

    by_player: dict[uuid.UUID, list[Attendance]] = {}
    for r in records:
        by_player.setdefault(r.player_id, []).append(r)

    summaries: list[PlayerAttendanceSummary] = []
    for player in players:
        player_records = sorted(
            by_player.get(player.id, []), key=lambda r: training_order[r.training_id]
        )
        total = len(player_records)
        attended = sum(1 for r in player_records if r.status in ATTENDED)
        percent = round(attended / total * 100, 1) if total else 0.0
        streak = _streak_of_absences([r.status for r in player_records])

        summaries.append(
            PlayerAttendanceSummary(
                player_id=player.id,
                player_name=player.name,
                attended=attended,
                total=total,
                percent=percent,
                current_absence_streak=streak,
                # Sin datos cargados no hay riesgo que reportar, solo ignorancia.
                at_risk=bool(total) and (streak >= AT_RISK_STREAK or percent < AT_RISK_PERCENT),
            )
        )

    summaries.sort(key=lambda s: (-s.percent, s.player_name))
    rated = [s for s in summaries if s.total]
    average = round(sum(s.percent for s in rated) / len(rated), 1) if rated else 0.0

    # Promedio por día de semana: con esto se elige el horario con un dato en vez
    # de con la sensación de que "los martes viene poca gente".
    per_training: dict[uuid.UUID, list[Attendance]] = {}
    for r in records:
        per_training.setdefault(r.training_id, []).append(r)

    weekday_buckets: dict[int, list[float]] = {}
    for training in trainings:
        rows_for = per_training.get(training.id, [])
        if not rows_for:
            continue
        attended = sum(1 for r in rows_for if r.status in ATTENDED)
        weekday_buckets.setdefault(training.date.weekday(), []).append(
            attended / len(rows_for) * 100
        )

    by_weekday = [
        WeekdayAttendance(
            weekday=day,
            label=WEEKDAY_LABELS[day],
            trainings_count=len(values),
            average_percent=round(sum(values) / len(values), 1),
        )
        for day, values in sorted(weekday_buckets.items())
    ]

    return DivisionAttendanceSummary(
        division_id=division_id,
        days=days,
        trainings_count=len(trainings),
        average_percent=average,
        players=summaries,
        by_weekday=by_weekday,
    )


@router.get("/players/{player_id}/attendance", response_model=PlayerAttendanceDetail)
async def player_attendance(
    player_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    player = await db.scalar(
        select(Player).where(Player.id == player_id).options(selectinload(Player.division))
    )
    if not player:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Jugador no encontrado")

    # Un `player` sólo llega a su propia asistencia. Validar sólo el club dejaba que
    # cualquier jugador leyera la de todos sus compañeros con sólo cambiar el id.
    await require_player_self(player_id, db, current_user)
    if current_user.role != UserRole.player:
        assert_division_access(player.division, current_user)

    rows = (
        await db.execute(
            select(Attendance, Training)
            .join(Training, Training.id == Attendance.training_id)
            .where(Attendance.player_id == player_id)
            .order_by(Training.date.desc())
        )
    ).all()

    records = [
        TrainingAttendanceRecord(
            training_id=t.id, date=t.date, type=t.type.value, status=a.status.value
        )
        for a, t in rows
    ]

    def percent_since(days: Optional[int]) -> float:
        if days is None:
            window = rows
        else:
            cutoff = date.today() - timedelta(days=days)
            window = [(a, t) for a, t in rows if t.date >= cutoff]
        if not window:
            return 0.0
        attended = sum(1 for a, _ in window if a.status in ATTENDED)
        return round(attended / len(window) * 100, 1)

    return PlayerAttendanceDetail(
        player_id=player_id,
        percent_30=percent_since(30),
        percent_90=percent_since(90),
        percent_season=percent_since(None),
        current_absence_streak=_streak_of_absences([a.status for a, _ in rows]),
        records=records,
    )
