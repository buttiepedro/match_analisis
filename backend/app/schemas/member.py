import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class MemberResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    full_name: str
    document_id: Optional[str] = None
    category: Optional[str] = None
    member_number: Optional[str] = None
    dues_up_to_date: bool
    dues_synced_at: datetime


class MyMembershipResponse(BaseModel):
    """
    Lo que ve el socio.

    `dues_synced_at` **no es opcional**: mostrar "estás al día" sin decir a qué
    fecha corresponde el dato es desinformar.
    """

    full_name: str
    member_number: Optional[str] = None
    category: Optional[str] = None
    dues_up_to_date: bool
    dues_synced_at: datetime
    is_active: bool


class MemberImportResult(BaseModel):
    dry_run: bool
    created: list[str]
    updated: list[str]
    #: Por nombre: quien confirma tiene que poder reconocer a quién da de baja.
    deactivated: list[str]
    total_rows: int
    errors: list[dict]


class MemberImportLogEntry(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    source: str
    created_count: int
    updated_count: int
    deactivated_count: int
    total_rows: int
    created_at: datetime


class MemberCreate(BaseModel):
    """
    Alta de un socio suelto, sin pasar por el padrón.

    El DNI es obligatorio y no por formalismo: la sincronización semanal matchea
    por DNI, así que es lo único que hace que este socio sea **el mismo** que
    aparezca en el próximo export del contable. Sin DNI, la primera importación
    lo daría de baja por ausente y crearía otro al lado.
    """

    document_id: str
    full_name: Optional[str] = None
    #: Para asociar un usuario que ya existe —el administrador que además es
    #: socio— en vez de crearle una cuenta nueva.
    user_id: Optional[uuid.UUID] = None
    category: Optional[str] = None
    member_number: Optional[str] = None
    dues_up_to_date: bool = False
    #: Sólo se usa si hay que crear la cuenta. Se pide cambiarla al primer ingreso.
    default_password: Optional[str] = None


class MemberUpdate(BaseModel):
    category: Optional[str] = None
    member_number: Optional[str] = None
    dues_up_to_date: Optional[bool] = None
    is_active: Optional[bool] = None


class LinkableUser(BaseModel):
    """Un usuario del club que todavía no es socio."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    full_name: str
    email: Optional[str] = None
    document_id: Optional[str] = None
