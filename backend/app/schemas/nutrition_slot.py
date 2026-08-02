import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class NutritionSlotCreate(BaseModel):
    starts_at: datetime
    ends_at: datetime


class NutritionSlotsBatchCreate(BaseModel):
    """Alta en lote: la nutricionista bloquea la mañana del jueves de una carga."""

    slots: list[NutritionSlotCreate]


class NutritionSlotBookRequest(BaseModel):
    #: Motivo de la consulta. Opcional — el jugador puede no querer escribir nada.
    notes: Optional[str] = None


class NutritionSlotResponse(BaseModel):
    id: uuid.UUID
    starts_at: datetime
    ends_at: datetime
    status: str
    nutritionist_id: uuid.UUID
    player_id: Optional[uuid.UUID] = None
    player_name: Optional[str] = None
    notes: Optional[str] = None
    booked_at: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None
