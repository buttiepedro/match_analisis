"""
Comunicados del club — novedades y avisos internos.

Un comunicado es del club entero (`division_id` nulo) o de una división en
particular; nunca de un jugador individual — para eso ya existen las
notificaciones automáticas del sistema (formación, turnos). Es texto simple
a propósito: la Bolsa de trabajo ya cubre el caso de posts con imagen,
adjuntos y moderación, y duplicar ese mecanismo acá sólo para "novedades"
sería construir la misma feature dos veces antes de saber si el club la usa.
"""
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class Announcement(Base):
    __tablename__ = "announcements"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    club_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clubs.id"), nullable=False)
    #: Nulo = para todo el club. Con valor = sólo esa división (y su staff).
    division_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("divisions.id"), nullable=True)
    title: Mapped[str] = mapped_column(String(150), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    #: `selectin`: el feed y la respuesta de alta siempre necesitan el nombre
    #: de la división y del autor — evita repetir `selectinload` en cada query.
    division: Mapped[Optional["Division"]] = relationship(lazy="selectin")
    author: Mapped["User"] = relationship(lazy="selectin")
