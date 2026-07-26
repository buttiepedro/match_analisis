import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class SeasonMatchLine(BaseModel):
    session_id: uuid.UUID
    label: str
    scheduled_at: Optional[datetime] = None
    jersey_number: int
    minutes: int
    tries: int
    tackles: int
    yellow_cards: int
    red_cards: int


class PlayerSeasonStats(BaseModel):
    player_id: uuid.UUID
    player_name: str
    #: Partidos con minutos > 0: figurar en la planilla no es haber jugado.
    matches: int
    minutes: int
    tries: int
    tackles: int
    yellow_cards: int
    red_cards: int
    matches_detail: list[SeasonMatchLine]


class DivisionMinutesRow(BaseModel):
    player_id: uuid.UUID
    player_name: str
    matches: int
    minutes: int
    average_minutes: float
