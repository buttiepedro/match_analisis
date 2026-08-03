import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class AnnouncementCreate(BaseModel):
    title: str = Field(min_length=1, max_length=150)
    body: str = Field(min_length=1, max_length=4000)
    #: Nulo = para todo el club.
    division_id: Optional[uuid.UUID] = None


class AnnouncementResponse(BaseModel):
    id: uuid.UUID
    title: str
    body: str
    division_id: Optional[uuid.UUID] = None
    division_name: Optional[str] = None
    created_by: uuid.UUID
    author_name: str
    created_at: datetime
