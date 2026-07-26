import uuid
from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, ConfigDict, Field


class EventCreate(BaseModel):
    event_type: str
    team: Literal["user", "rival"]
    player_id: Optional[uuid.UUID] = None
    reason: Optional[str] = None
    metadata: dict = {}
    # Marca temporal del cliente. Sólo se usa cuando el evento se registró sin
    # conectividad y se envía diferido: sin esto el backend lo sellaría con el
    # tiempo del timer al momento de recibirlo, que ya no es el del hecho real.
    timer_seconds: Optional[int] = Field(default=None, ge=0)
    half: Optional[int] = Field(default=None, ge=1, le=2)


class EventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    session_id: uuid.UUID
    event_type: str
    half: int
    timer_seconds: int
    team: str
    player_id: Optional[uuid.UUID]
    player_number: Optional[int]
    reason: Optional[str]
    metadata: dict = Field(default={}, validation_alias="metadata_")
    recorded_by: uuid.UUID
    recorded_at: datetime
