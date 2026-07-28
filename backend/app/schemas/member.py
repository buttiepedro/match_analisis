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
