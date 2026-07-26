import uuid
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict


class OpponentCreate(BaseModel):
    name: str


class OpponentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str


class OpponentHistoryMatch(BaseModel):
    session_id: uuid.UUID
    scheduled_at: Optional[datetime] = None
    points_for: int
    points_against: int
    outcome: Literal["ganado", "empatado", "perdido"]


class OpponentHistory(BaseModel):
    opponent_id: uuid.UUID
    opponent_name: str
    played: int
    won: int
    drawn: int
    lost: int
    points_for: int
    points_against: int
    matches: list[OpponentHistoryMatch]


class StandingRow(BaseModel):
    team: str
    played: int
    won: int
    drawn: int
    lost: int
    points_for: int
    points_against: int
    difference: int
    bonus: int
    points: int
