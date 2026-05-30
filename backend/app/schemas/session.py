import uuid
from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, ConfigDict


class SessionCreate(BaseModel):
    home_team: str
    away_team: str
    scheduled_at: Optional[datetime] = None
    half_duration_minutes: int = 40


class TimerStateResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    current_half: int
    status: str
    elapsed_seconds: int
    started_at: Optional[datetime]


class SessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tournament_id: uuid.UUID
    home_team: str
    away_team: str
    scheduled_at: Optional[datetime]
    status: str
    half_duration_minutes: int
    timer_state: Optional[TimerStateResponse]


class TimerControlRequest(BaseModel):
    action: Literal["start", "pause", "resume", "halftime", "finish"]
