import uuid
from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel

KindLiteral = Literal["ofrece", "busca"]


class JobPostCreate(BaseModel):
    kind: KindLiteral
    title: str
    description: str
    #: Cómo contactar al autor. Lo escribe él: puede no querer dar su teléfono.
    contact: str
    category: Optional[str] = None


class JobPostUpdate(BaseModel):
    kind: Optional[KindLiteral] = None
    title: Optional[str] = None
    description: Optional[str] = None
    contact: Optional[str] = None
    category: Optional[str] = None


class JobPostModeration(BaseModel):
    approve: bool
    #: Motivo del rechazo. Sin él, el autor vuelve a mandar lo mismo.
    note: Optional[str] = None
    #: Días de vigencia al aprobar.
    days: Optional[int] = None


class JobPostResponse(BaseModel):
    id: uuid.UUID
    kind: str
    title: str
    description: str
    #: `None` en avisos que no están vigentes y no son propios: un teléfono de un
    #: socio no circula sin motivo.
    contact: Optional[str] = None
    category: Optional[str] = None
    #: `vencido` es derivado de la fecha, no un estado guardado.
    status: str
    #: Sólo lo ve el autor: es la explicación de por qué se rechazó.
    moderation_note: Optional[str] = None
    author_name: str
    is_mine: bool
    published_at: Optional[datetime] = None
    expires_on: Optional[date] = None
