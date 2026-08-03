"""
Agenda de turnos con la nutricionista.

Horario y reserva son el **mismo registro** en distinto estado — un turno
libre y uno reservado nunca dejan de ser el mismo slot, así que separarlos en
dos tablas obligaría a un join en cada lectura para algo que siempre es 1 a 1.
"""
import enum
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, Enum, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class NutritionSlotStatus(str, enum.Enum):
    libre = "libre"
    reservado = "reservado"
    cancelado = "cancelado"


class NutritionSlot(Base):
    __tablename__ = "nutrition_slots"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    club_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clubs.id"), nullable=False)
    #: Nullable: turnos publicados antes de que existiera el alcance por
    #: división quedan sin dato en vez de con uno inventado.
    division_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("divisions.id"), nullable=True)
    nutritionist_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[NutritionSlotStatus] = mapped_column(
        Enum(NutritionSlotStatus), nullable=False, default=NutritionSlotStatus.libre,
        server_default="libre",
    )
    #: Quién reservó. Nullable: la enorme mayoría de los slots nunca tiene reserva.
    player_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("players.id"), nullable=True)
    #: Motivo de la consulta — lo escribe el jugador al reservar, opcional.
    notes: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    booked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_by: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("users.id"), nullable=True)
    cancelled_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    #: Se escribe **después** de notificar, no antes — si el proceso se
    #: reinicia entre el envío y la escritura, en el peor caso el
    #: recordatorio se manda dos veces, no cero.
    reminder_sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    player: Mapped[Optional["Player"]] = relationship()
    #: `selectin`: `_to_response` la lee siempre, en endpoints (book/cancel)
    #: que no la piden explícita — igual que `User.divisions`, evita que
    #: acceder a `.division` dispare un lazy-load fuera de contexto async.
    division: Mapped[Optional["Division"]] = relationship(lazy="selectin")
