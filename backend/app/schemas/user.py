import uuid
from typing import Literal, Optional
from pydantic import BaseModel, ConfigDict, EmailStr


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: Optional[str] = None
    document_id: Optional[str] = None
    must_change_password: bool = False
    full_name: str
    role: str
    club_id: Optional[uuid.UUID]
    is_active: bool
    #: Capacidades efectivas, unión de todos sus roles. El frontend arma el menú
    #: con esto: sin ellas seguiría guiándose por `role`, que ya no manda.
    permissions: list[str] = []


class UserCreate(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    role: Literal["match_director", "analyst"]


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    role: Optional[Literal["match_director", "analyst"]] = None
    is_active: Optional[bool] = None


class UserDivisionsUpdate(BaseModel):
    """Alcance del usuario. **Lista vacía = sin restricción**, no "sin acceso"."""

    division_ids: list[uuid.UUID] = []
