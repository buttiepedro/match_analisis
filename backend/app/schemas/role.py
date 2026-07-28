import uuid
from typing import Optional

from pydantic import BaseModel


class PermissionCatalogEntry(BaseModel):
    """Una capacidad del catálogo, partida para que la UI la agrupe por dominio."""

    value: str
    domain: str
    action: str


class RoleResponse(BaseModel):
    id: uuid.UUID
    name: str
    is_preset: bool
    permissions: list[str]
    #: Cuánta gente lo tiene: sin esto, editar un rol es a ciegas.
    user_count: int = 0


class RoleCreate(BaseModel):
    name: str
    permissions: list[str] = []


class RoleUpdate(BaseModel):
    name: Optional[str] = None
    #: `None` deja las capacidades como están; una lista las reemplaza.
    permissions: Optional[list[str]] = None


class UserRolesUpdate(BaseModel):
    role_ids: list[uuid.UUID] = []
