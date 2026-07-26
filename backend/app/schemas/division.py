import uuid
from typing import Optional

from pydantic import BaseModel, ConfigDict


class DivisionCreate(BaseModel):
    name: str


class DivisionUpdate(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None


class DivisionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    club_id: uuid.UUID
    name: str
    is_active: bool
