from typing import Optional

from pydantic import BaseModel, EmailStr
from app.schemas.user import UserResponse


class LoginRequest(BaseModel):
    """
    Ingreso por email **o** por DNI.

    `email` se conserva porque el staff ya entra así y no hay razón para migrarlo;
    el socio entra por `document_id`, que es lo que tiene a mano.
    """

    email: Optional[EmailStr] = None
    document_id: Optional[str] = None
    password: str
    #: Sólo hace falta si el mismo DNI existe en más de un club.
    club_slug: Optional[str] = None


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserResponse
    #: Con esto en true el frontend no deja pasar a ninguna otra pantalla.
    must_change_password: bool = False


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class AccessTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class LogoutRequest(BaseModel):
    refresh_token: str
