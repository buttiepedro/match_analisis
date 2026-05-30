import uuid
from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, ConfigDict


class EventCreate(BaseModel):
    event_type: str
    team: Literal["home", "away"]
    player_number: Optional[int] = None
    reason: Optional[str] = None
    metadata: dict = {}


class EventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    session_id: uuid.UUID
    event_type: str
    half: int
    timer_seconds: int
    team: str
    player_number: Optional[int]
    reason: Optional[str]
    recorded_by: uuid.UUID
    recorded_at: datetime
