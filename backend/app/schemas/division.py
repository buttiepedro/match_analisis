import uuid
from pydantic import BaseModel, ConfigDict


class DivisionCreate(BaseModel):
    name: str


class DivisionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    club_id: uuid.UUID
    name: str
    is_active: bool
