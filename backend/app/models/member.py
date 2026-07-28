import uuid
from datetime import date, datetime
from typing import Optional

from sqlalchemy import JSON, Boolean, Date, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class Member(Base):
    """
    Socio del club.

    El estado de cuota **no se calcula acá**: llega espejado del sistema contable,
    que ya lo tiene. Modelar cuotas mes a mes sería levantar un contable paralelo
    al que el club usa, y dos fuentes de verdad sobre plata terminan mal siempre.
    """

    __tablename__ = "members"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    club_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clubs.id"), nullable=False)
    #: NOT NULL, a diferencia de `Player.user_id`: cada socio del padrón recibe una
    #: cuenta, porque el punto del módulo es que entre a ver su estado.
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id"), nullable=False, unique=True
    )
    full_name: Mapped[str] = mapped_column(String(150), nullable=False)
    category: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    #: Número de socio del sistema contable, para poder cruzar con ellos.
    member_number: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    joined_on: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    #: Ausencia en el padrón importado lo marca inactivo. Nunca se borra: una baja
    #: se revierte y un borrado no.
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")

    dues_up_to_date: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    #: **La columna más importante de la tabla.** Mostrar "estás al día" sin decir
    #: a qué fecha corresponde el dato es desinformar: un socio que pagó ayer y ve
    #: "no estás al día" sin fecha llama al club enojado.
    dues_synced_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    user: Mapped["User"] = relationship()


class MemberImport(Base):
    """
    Log de cada sincronización del padrón.

    Sin esto, cuando el lunes aparezcan doscientos socios desactivados nadie va a
    poder decir qué archivo lo hizo.
    """

    __tablename__ = "member_imports"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    club_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clubs.id"), nullable=False)
    #: 'xlsx' hoy, 'api' cuando el sistema contable exponga un endpoint.
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="xlsx")
    created_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    deactivated_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_rows: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    errors: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    run_by: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
