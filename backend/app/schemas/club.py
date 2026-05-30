import uuid
from pydantic import BaseModel, ConfigDict, EmailStr


class ClubCreate(BaseModel):
    name: str
    admin_email: EmailStr
    admin_password: str
    admin_full_name: str


class ClubResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    slug: str
    is_active: bool
