"""
Planes de gimnasio.

Lo que hace valioso el módulo es la **carga relativa**: un ejercicio puede pedir
`75% de Sentadilla 3RM` en vez de kilos fijos. Así el preparador físico escribe un
plan para la división y cada jugador ve sus propios kilos, calculados de su propio
test. Sin eso hay que cargar el plan jugador por jugador, y eso no se hace dos veces.
"""
import uuid
from datetime import date
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.deps import (
    assert_club_access,
    get_club_or_404,
    get_current_user,
    get_division_or_404,
    require,
)
from app.core.permissions import Permission
from app.models import Division, GymDay, GymExercise, GymLog, GymPlan, Player, User
from app.models.gym import LoadType
from app.models.player import PhysicalTest
from app.schemas.gym import (
    GymAdherenceRow,
    GymDayResponse,
    GymExerciseResponse,
    GymLogCreate,
    GymPlanCreate,
    GymPlanResponse,
    GymPlanStructure,
    GymPlanSummary,
    MyGymPlanResponse,
)
from app.schemas.measurement import TEST_TYPES

router = APIRouter()


def _round_to_plate(kilos: float) -> float:
    """
    Redondea a 2.5 kg, que es el disco más chico de un gimnasio normal.

    Decirle a un jugador "levantá 83.7 kg" es darle un número que no puede armar.
    """
    return round(kilos / 2.5) * 2.5


async def _latest_tests(player_id: uuid.UUID, db: AsyncSession) -> dict[str, float]:
    """Último valor de cada tipo de test del jugador."""
    rows = (
        await db.execute(
            select(PhysicalTest)
            .where(PhysicalTest.player_id == player_id)
            .order_by(PhysicalTest.test_date.desc())
        )
    ).scalars().all()

    latest: dict[str, float] = {}
    for t in rows:
        latest.setdefault(t.test_type, float(t.value))
    return latest


def _exercise_response(
    exercise: GymExercise, tests: Optional[dict[str, float]] = None
) -> GymExerciseResponse:
    """
    Arma la respuesta, resolviendo la carga si se pasaron los tests del jugador.

    Cuando la carga es relativa y **falta el test**, no se inventa un número: se
    devuelve `resolved_load = None` y un motivo. Un kilaje inventado es peor que
    un "falta tu test", porque el jugador lo levanta.
    """
    resolved: Optional[float] = None
    reason: Optional[str] = None

    if exercise.load_type == LoadType.absoluta and exercise.load_value is not None:
        resolved = float(exercise.load_value)
    elif exercise.load_type == LoadType.porcentaje_test:
        if tests is None:
            reason = None  # vista del PF: no corresponde resolver
        elif not exercise.load_test_type:
            reason = "El ejercicio no dice contra qué test se calcula"
        elif exercise.load_test_type not in tests:
            label = TEST_TYPES.get(exercise.load_test_type, {}).get(
                "label", exercise.load_test_type
            )
            reason = f"Te falta el test de {label}"
        elif exercise.load_value is not None:
            resolved = _round_to_plate(
                tests[exercise.load_test_type] * float(exercise.load_value) / 100
            )

    return GymExerciseResponse(
        id=exercise.id,
        position=exercise.position,
        name=exercise.name,
        sets=exercise.sets,
        reps=exercise.reps,
        load_type=exercise.load_type.value,
        load_value=float(exercise.load_value) if exercise.load_value is not None else None,
        load_test_type=exercise.load_test_type,
        load_test_label=(
            TEST_TYPES.get(exercise.load_test_type, {}).get("label")
            if exercise.load_test_type
            else None
        ),
        resolved_load_kg=resolved,
        unresolved_reason=reason,
        notes=exercise.notes,
    )


def _plan_response(plan: GymPlan, tests: Optional[dict[str, float]] = None) -> GymPlanResponse:
    days = sorted(plan.days, key=lambda d: (d.week, d.day))
    return GymPlanResponse(
        id=plan.id,
        name=plan.name,
        division_id=plan.division_id,
        weeks=plan.weeks,
        notes=plan.notes,
        is_active=plan.is_active,
        days=[
            GymDayResponse(
                id=d.id,
                week=d.week,
                day=d.day,
                name=d.name,
                exercises=[
                    _exercise_response(e, tests)
                    for e in sorted(d.exercises, key=lambda e: e.position)
                ],
            )
            for d in days
        ],
    )


async def _get_plan_or_404(
    plan_id: uuid.UUID, db: AsyncSession, current_user: User, *, fresh: bool = False
) -> GymPlan:
    """
    `fresh=True` relee ignorando lo cacheado en la sesión.

    Hace falta después de reemplazar la estructura: el `delete()` masivo borra en
    la base pero no toca el identity map, así que sin esto la respuesta devolvería
    los días viejos. Se acota al plan a propósito — un `expire_all()` alcanzaría
    también a `current_user`, y leer sus divisiones fuera de un await explota.
    """
    query = (
        select(GymPlan)
        .where(GymPlan.id == plan_id)
        .options(selectinload(GymPlan.days).selectinload(GymDay.exercises))
    )
    if fresh:
        query = query.execution_options(populate_existing=True)

    plan = await db.scalar(query)
    if not plan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan no encontrado")
    await get_division_or_404(plan.division_id, db, current_user)
    return plan


# ── Administración de planes ──────────────────────────────────────────────────

@router.get("/divisions/{division_id}/gym-plans", response_model=list[GymPlanSummary])
async def list_plans(
    division_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.gimnasio_ver))],
):
    await get_division_or_404(division_id, db, current_user)
    plans = (
        await db.execute(
            select(GymPlan)
            .where(GymPlan.division_id == division_id)
            .order_by(GymPlan.is_active.desc(), GymPlan.created_at.desc())
        )
    ).scalars().all()
    return [
        GymPlanSummary(
            id=p.id, name=p.name, weeks=p.weeks, is_active=p.is_active, days=len(p.days)
        )
        for p in plans
    ]


@router.post(
    "/divisions/{division_id}/gym-plans",
    response_model=GymPlanResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_plan(
    division_id: uuid.UUID,
    body: GymPlanCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.gimnasio_editar))],
):
    division = await get_division_or_404(division_id, db, current_user)

    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="El plan necesita un nombre")

    # Sólo un plan activo por división: el jugador tiene que ver uno, no elegir.
    if body.is_active:
        await db.execute(
            GymPlan.__table__.update()
            .where(GymPlan.division_id == division.id)
            .values(is_active=False)
        )

    plan = GymPlan(
        id=uuid.uuid4(),
        club_id=division.club_id,
        division_id=division.id,
        name=name,
        weeks=body.weeks,
        notes=body.notes,
        is_active=body.is_active,
        created_by=current_user.id,
    )
    db.add(plan)
    await db.commit()
    await db.refresh(plan)
    return _plan_response(plan)


@router.get("/gym-plans/{plan_id}", response_model=GymPlanResponse)
async def get_plan(
    plan_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.gimnasio_ver))],
):
    """Vista del cuerpo técnico: la carga relativa se muestra como porcentaje."""
    return _plan_response(await _get_plan_or_404(plan_id, db, current_user))


@router.put("/gym-plans/{plan_id}/structure", response_model=GymPlanResponse)
async def replace_structure(
    plan_id: uuid.UUID,
    body: GymPlanStructure,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.gimnasio_editar))],
):
    """
    Reemplaza días y ejercicios en una transacción.

    Es un `PUT` de la estructura completa y no un ABM por ejercicio porque el PF
    escribe la semana entera de una sentada; cargarla de a un ejercicio serían
    treinta requests y otros tantos estados intermedios inválidos.
    """
    plan = await _get_plan_or_404(plan_id, db, current_user)

    # Validar todo antes de escribir: si falla, el plan anterior queda intacto.
    for day in body.days:
        if day.week < 1 or day.week > plan.weeks:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"La semana {day.week} está fuera del plan, que tiene {plan.weeks}",
            )
        for exercise in day.exercises:
            if exercise.load_type == "porcentaje_test":
                if not exercise.load_test_type:
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                        detail=f"'{exercise.name}' usa % de test pero no dice de cuál",
                    )
                if exercise.load_test_type not in TEST_TYPES:
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                        detail=f"Test desconocido: {exercise.load_test_type}",
                    )

    await db.execute(delete(GymDay).where(GymDay.plan_id == plan.id))
    await db.flush()

    for day in body.days:
        gym_day = GymDay(
            id=uuid.uuid4(),
            plan_id=plan.id,
            week=day.week,
            day=day.day,
            name=day.name,
        )
        db.add(gym_day)
        await db.flush()
        for position, exercise in enumerate(day.exercises):
            db.add(
                GymExercise(
                    id=uuid.uuid4(),
                    day_id=gym_day.id,
                    position=position,
                    name=exercise.name,
                    sets=exercise.sets,
                    reps=exercise.reps,
                    load_type=LoadType(exercise.load_type),
                    load_value=exercise.load_value,
                    load_test_type=exercise.load_test_type,
                    notes=exercise.notes,
                )
            )

    await db.commit()
    return _plan_response(
        await _get_plan_or_404(plan_id, db, current_user, fresh=True)
    )


@router.delete("/gym-plans/{plan_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_plan(
    plan_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.gimnasio_editar))],
):
    plan = await _get_plan_or_404(plan_id, db, current_user)
    await db.delete(plan)
    await db.commit()


# ── Lo que ve el jugador ──────────────────────────────────────────────────────

@router.get("/me/gym-plan", response_model=MyGymPlanResponse)
async def my_gym_plan(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """
    El plan activo de la división del jugador, **con los kilos ya calculados**
    contra sus propios tests.
    """
    player = await db.scalar(select(Player).where(Player.user_id == current_user.id))
    if not player:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Este usuario no está vinculado a ningún jugador",
        )

    plan = await db.scalar(
        select(GymPlan)
        .where(GymPlan.division_id == player.division_id, GymPlan.is_active.is_(True))
        .options(selectinload(GymPlan.days).selectinload(GymDay.exercises))
    )
    if not plan:
        return MyGymPlanResponse(plan=None, completed_day_ids=[])

    tests = await _latest_tests(player.id, db)

    logs = (
        await db.execute(select(GymLog.day_id).where(GymLog.player_id == player.id))
    ).scalars().all()

    return MyGymPlanResponse(
        plan=_plan_response(plan, tests), completed_day_ids=sorted(set(logs))
    )


@router.post("/me/gym-logs", status_code=status.HTTP_201_CREATED)
async def log_gym_session(
    body: GymLogCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Marca una sesión como hecha. Idempotente por (jugador, día, fecha)."""
    player = await db.scalar(select(Player).where(Player.user_id == current_user.id))
    if not player:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Jugador no encontrado")

    day = await db.scalar(
        select(GymDay).join(GymPlan).where(
            GymDay.id == body.day_id, GymPlan.division_id == player.division_id
        )
    )
    if not day:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Ese día no pertenece al plan de tu división",
        )

    logged_on = body.logged_on or date.today()
    existing = await db.scalar(
        select(GymLog).where(
            GymLog.player_id == player.id,
            GymLog.day_id == day.id,
            GymLog.logged_on == logged_on,
        )
    )
    if existing:
        existing.rpe = body.rpe
        existing.notes = body.notes
    else:
        db.add(
            GymLog(
                id=uuid.uuid4(),
                player_id=player.id,
                day_id=day.id,
                logged_on=logged_on,
                rpe=body.rpe,
                notes=body.notes,
            )
        )
    await db.commit()
    return {"status": "ok"}


@router.get("/divisions/{division_id}/gym-adherence", response_model=list[GymAdherenceRow])
async def gym_adherence(
    division_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.gimnasio_ver))],
    days: Annotated[int, Query(ge=1, le=365)] = 30,
):
    """
    Adherencia al gimnasio: sesiones marcadas por jugador en la ventana.

    Es a la sala de pesas lo que la asistencia es al entrenamiento.
    """
    await get_division_or_404(division_id, db, current_user)
    since = date.today() - __import__("datetime").timedelta(days=days)

    players = (
        await db.execute(
            select(Player)
            .where(Player.division_id == division_id, Player.is_active.is_(True))
            .order_by(Player.name)
        )
    ).scalars().all()
    if not players:
        return []

    logs = (
        await db.execute(
            select(GymLog).where(
                GymLog.player_id.in_([p.id for p in players]), GymLog.logged_on >= since
            )
        )
    ).scalars().all()

    counts: dict[uuid.UUID, int] = {}
    for log in logs:
        counts[log.player_id] = counts.get(log.player_id, 0) + 1

    rows = [
        GymAdherenceRow(
            player_id=p.id, player_name=p.name, sessions=counts.get(p.id, 0), days=days
        )
        for p in players
    ]
    rows.sort(key=lambda r: (-r.sessions, r.player_name))
    return rows
