import enum
import uuid
from datetime import date, datetime
from typing import Optional

from sqlalchemy import Date, DateTime, Enum, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class TrainingType(str, enum.Enum):
    entrenamiento = "entrenamiento"
    gimnasio = "gimnasio"
    fisico = "fisico"
    amistoso = "amistoso"
    otro = "otro"


class AttendanceStatus(str, enum.Enum):
    presente = "presente"
    ausente = "ausente"
    justificado = "justificado"
    lesionado = "lesionado"
    tarde = "tarde"


#: Estados que cuentan como asistencia efectiva al calcular porcentajes.
PRESENT_STATUSES = (AttendanceStatus.presente, AttendanceStatus.tarde)


class Training(Base):
    __tablename__ = "trainings"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    club_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clubs.id"), nullable=False)
    division_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("divisions.id"), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    type: Mapped[TrainingType] = mapped_column(
        Enum(TrainingType), nullable=False, default=TrainingType.entrenamiento,
        server_default="entrenamiento",
    )
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    division: Mapped["Division"] = relationship()
    attendance: Mapped[list["Attendance"]] = relationship(
        back_populates="training", cascade="all, delete-orphan"
    )


class Attendance(Base):
    __tablename__ = "attendance"
    # Habilita el upsert idempotente: la cola offline puede reenviar la misma
    # asistencia varias veces y no debe duplicar registros.
    __table_args__ = (
        UniqueConstraint("training_id", "player_id", name="uq_attendance_training_player"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    training_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("trainings.id", ondelete="CASCADE"), nullable=False
    )
    player_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("players.id"), nullable=False)
    status: Mapped[AttendanceStatus] = mapped_column(
        Enum(AttendanceStatus), nullable=False, default=AttendanceStatus.presente,
        server_default="presente",
    )
    notes: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    recorded_by: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("users.id"), nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    training: Mapped["Training"] = relationship(back_populates="attendance")
    player: Mapped["Player"] = relationship()
