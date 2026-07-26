import uuid
from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel


class TodayTraining(BaseModel):
    id: uuid.UUID
    division_id: uuid.UUID
    division_name: str
    type: str
    #: False = la planilla todavía no se cargó. Es la acción pendiente del día.
    attendance_loaded: bool


class UpcomingMatch(BaseModel):
    id: uuid.UUID
    home_team: str
    away_team: str
    scheduled_at: Optional[datetime] = None
    status: str
    division_name: str


class TodayAlert(BaseModel):
    kind: Literal[
        "no_disponibles",
        "apto_vencido",
        "apto_por_vencer",
        "roja_sin_sancion",
        "en_riesgo",
    ]
    label: str
    #: Primeros nombres, para no obligar a entrar a otra pantalla a ver de quién habla.
    detail: str
    count: int


class TodayResponse(BaseModel):
    date: date
    trainings: list[TodayTraining]
    upcoming_matches: list[UpcomingMatch]
    alerts: list[TodayAlert]


class CalendarEntry(BaseModel):
    id: uuid.UUID
    kind: Literal["entrenamiento", "partido"]
    date: date
    label: str
    status: Optional[str] = None
