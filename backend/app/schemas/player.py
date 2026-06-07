import uuid
from typing import Literal, Optional
from pydantic import BaseModel, ConfigDict


class PlayerCreate(BaseModel):
    name: str
    position: Optional[str] = None


class PlayerUpdate(BaseModel):
    name: Optional[str] = None
    position: Optional[str] = None
    is_active: Optional[bool] = None
    division_id: Optional[uuid.UUID] = None


class PlayerResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    division_id: uuid.UUID
    name: str
    position: Optional[str]
    is_active: bool


class PlayerWithDivisionResponse(BaseModel):
    id: uuid.UUID
    division_id: uuid.UUID
    division_name: str
    name: str
    position: Optional[str]
    is_active: bool


class LineupEntryCreate(BaseModel):
    player_id: uuid.UUID
    jersey_number: int
    position: Optional[str] = None
    team: Literal["user", "rival"] = "user"
    status: Literal["on_field", "bench"] = "on_field"


class LineupEntryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    player_id: uuid.UUID
    jersey_number: int
    position: Optional[str]
    team: str
    status: str
    player: PlayerResponse


class LineupEntryUpdate(BaseModel):
    jersey_number: Optional[int] = None
    position: Optional[str] = None


class SubstituteRequest(BaseModel):
    lineup_out_id: uuid.UUID
    lineup_in_id: uuid.UUID
