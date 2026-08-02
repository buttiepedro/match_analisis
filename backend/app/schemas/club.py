import re
import uuid
from pydantic import BaseModel, ConfigDict, EmailStr, field_validator

_HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")


def _validate_hex_color(value: str | None) -> str | None:
    if value is not None and not _HEX_COLOR.match(value):
        raise ValueError("El color tiene que ser hex de 6 dígitos, ej: #211e67")
    return value


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
    logo_url: str | None = None
    primary_color: str | None = None
    secondary_color: str | None = None


class ClubBrandingUpdate(BaseModel):
    """Sólo lo que un superadmin edita después de creado. El slug no se toca acá."""

    logo_url: str | None = None
    primary_color: str | None = None
    secondary_color: str | None = None

    _validate_primary = field_validator("primary_color")(_validate_hex_color)
    _validate_secondary = field_validator("secondary_color")(_validate_hex_color)


class ClubBrandingResponse(BaseModel):
    """Lo que `GET /public/club-branding` sirve, sin autenticación."""

    model_config = ConfigDict(from_attributes=True)

    name: str
    slug: str
    logo_url: str | None = None
    primary_color: str | None = None
    secondary_color: str | None = None
