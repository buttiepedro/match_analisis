import uuid
from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel

LoadTypeLiteral = Literal["absoluta", "porcentaje_test", "libre"]


class GymExerciseInput(BaseModel):
    name: str
    sets: Optional[int] = None
    reps: Optional[str] = None
    load_type: LoadTypeLiteral = "libre"
    #: Kilos si es absoluta, porcentaje si es relativa al test.
    load_value: Optional[float] = None
    load_test_type: Optional[str] = None
    notes: Optional[str] = None


class GymDayInput(BaseModel):
    week: int
    #: 1 = lunes.
    day: int
    name: str
    exercises: list[GymExerciseInput] = []


class GymPlanStructure(BaseModel):
    """Días y ejercicios completos. Reemplaza, no acumula."""

    days: list[GymDayInput] = []


class GymPlanCreate(BaseModel):
    name: str
    weeks: int = 4
    notes: Optional[str] = None
    is_active: bool = True


class GymExerciseResponse(BaseModel):
    id: uuid.UUID
    position: int
    name: str
    sets: Optional[int] = None
    reps: Optional[str] = None
    load_type: str
    load_value: Optional[float] = None
    load_test_type: Optional[str] = None
    load_test_label: Optional[str] = None
    #: Kilos ya calculados para **este** jugador. `None` en la vista del PF, o
    #: cuando falta el test.
    resolved_load_kg: Optional[float] = None
    #: Por qué no se pudo calcular. Un kilaje inventado es peor que un aviso,
    #: porque el jugador lo levanta.
    unresolved_reason: Optional[str] = None
    notes: Optional[str] = None


class GymDayResponse(BaseModel):
    id: uuid.UUID
    week: int
    day: int
    name: str
    exercises: list[GymExerciseResponse]


class GymPlanResponse(BaseModel):
    id: uuid.UUID
    name: str
    division_id: uuid.UUID
    weeks: int
    notes: Optional[str] = None
    is_active: bool
    days: list[GymDayResponse]


class GymPlanSummary(BaseModel):
    id: uuid.UUID
    name: str
    weeks: int
    is_active: bool
    days: int


class MyGymPlanResponse(BaseModel):
    #: `None` si la división no tiene plan activo.
    plan: Optional[GymPlanResponse] = None
    completed_day_ids: list[uuid.UUID] = []


class GymLogCreate(BaseModel):
    day_id: uuid.UUID
    logged_on: Optional[date] = None
    #: Esfuerzo percibido 1-10.
    rpe: Optional[int] = None
    notes: Optional[str] = None


class GymAdherenceRow(BaseModel):
    player_id: uuid.UUID
    player_name: str
    sessions: int
    days: int
