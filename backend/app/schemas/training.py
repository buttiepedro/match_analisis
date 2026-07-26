import uuid
from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict

TrainingTypeLiteral = Literal["entrenamiento", "gimnasio", "fisico", "amistoso", "otro"]
AttendanceStatusLiteral = Literal["presente", "ausente", "justificado", "lesionado", "tarde"]


class TrainingCreate(BaseModel):
    date: date
    type: TrainingTypeLiteral = "entrenamiento"
    notes: Optional[str] = None


class TrainingUpdate(BaseModel):
    date: Optional[date] = None
    type: Optional[TrainingTypeLiteral] = None
    notes: Optional[str] = None


class TrainingResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    division_id: uuid.UUID
    date: date
    type: str
    notes: Optional[str] = None


class TrainingWithCountsResponse(TrainingResponse):
    """Lista de entrenamientos: alcanza con el recuento, sin traer la nómina."""

    present_count: int
    total_count: int


class AttendancePlayerResponse(BaseModel):
    """Un renglón de la planilla: el jugador y su estado, si ya se cargó."""

    player_id: uuid.UUID
    player_name: str
    position: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None


class AttendanceEntry(BaseModel):
    player_id: uuid.UUID
    status: AttendanceStatusLiteral
    notes: Optional[str] = None


class AttendanceBulkRequest(BaseModel):
    """
    Reemplaza la planilla completa del entrenamiento. Es idempotente a propósito:
    la cola offline puede reenviar el mismo PUT varias veces.
    """

    entries: list[AttendanceEntry]


class PlayerAttendanceSummary(BaseModel):
    player_id: uuid.UUID
    player_name: str
    attended: int
    total: int
    percent: float
    #: Ausencias consecutivas más recientes — dispara la marca "en riesgo".
    current_absence_streak: int
    at_risk: bool


class WeekdayAttendance(BaseModel):
    """Promedio por día de semana: sirve para decidir horarios con un dato."""

    #: 0 = lunes, 6 = domingo.
    weekday: int
    label: str
    trainings_count: int
    average_percent: float


class DivisionAttendanceSummary(BaseModel):
    division_id: uuid.UUID
    days: int
    trainings_count: int
    average_percent: float
    players: list[PlayerAttendanceSummary]
    by_weekday: list[WeekdayAttendance] = []


class TrainingAttendanceRecord(BaseModel):
    training_id: uuid.UUID
    date: date
    type: str
    status: str


class PlayerAttendanceDetail(BaseModel):
    player_id: uuid.UUID
    percent_30: float
    percent_90: float
    percent_season: float
    current_absence_streak: int
    records: list[TrainingAttendanceRecord]
