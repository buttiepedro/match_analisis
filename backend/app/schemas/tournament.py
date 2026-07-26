import uuid
from typing import Optional
from pydantic import BaseModel, ConfigDict

from app.schemas.division import DivisionResponse


class TournamentCreate(BaseModel):
    name: str
    division_id: uuid.UUID
    season: Optional[str] = None


class TournamentUpdate(BaseModel):
    name: Optional[str] = None
    division_id: Optional[uuid.UUID] = None
    season: Optional[str] = None
    is_active: Optional[bool] = None


class TournamentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    club_id: uuid.UUID
    division_id: uuid.UUID
    name: str
    season: Optional[str]
    is_active: bool
    division: DivisionResponse
