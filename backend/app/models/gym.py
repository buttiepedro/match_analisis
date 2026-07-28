import enum
import uuid
from datetime import date, datetime
from typing import Optional

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class LoadType(str, enum.Enum):
    """Cómo se expresa la carga de un ejercicio."""

    #: Kilos fijos, iguales para todos.
    absoluta = "absoluta"
    #: Porcentaje de un test del jugador. **Es lo que hace útil al módulo**: el PF
    #: escribe un plan para la división y cada uno ve sus propios kilos.
    porcentaje_test = "porcentaje_test"
    #: Sin carga: propio peso, movilidad, técnica.
    libre = "libre"


class GymPlan(Base):
    __tablename__ = "gym_plans"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    club_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clubs.id"), nullable=False)
    #: El plan es de una división. Personalizar jugador por jugador es lo que la
    #: carga relativa vuelve innecesario.
    division_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("divisions.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    weeks: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=4, server_default="4")
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    #: Sólo un plan activo por división: el jugador tiene que ver uno, no elegir.
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    created_by: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    days: Mapped[list["GymDay"]] = relationship(
        back_populates="plan", cascade="all, delete-orphan", lazy="selectin"
    )


class GymDay(Base):
    __tablename__ = "gym_days"
    __table_args__ = (
        UniqueConstraint("plan_id", "week", "day", name="uq_gym_day_plan_week_day"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    plan_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("gym_plans.id", ondelete="CASCADE"), nullable=False
    )
    week: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    #: 1 = lunes.
    day: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    name: Mapped[str] = mapped_column(String(80), nullable=False)

    plan: Mapped["GymPlan"] = relationship(back_populates="days")
    exercises: Mapped[list["GymExercise"]] = relationship(
        back_populates="day", cascade="all, delete-orphan", lazy="selectin"
    )


class GymExercise(Base):
    __tablename__ = "gym_exercises"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    day_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("gym_days.id", ondelete="CASCADE"), nullable=False
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    sets: Mapped[Optional[int]] = mapped_column(SmallInteger, nullable=True)
    reps: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    load_type: Mapped[LoadType] = mapped_column(
        Enum(LoadType), nullable=False, default=LoadType.libre, server_default="libre"
    )
    #: Kilos si es absoluta, porcentaje si es relativa.
    load_value: Mapped[Optional[float]] = mapped_column(Numeric(6, 2), nullable=True)
    #: Test contra el que se calcula, cuando la carga es relativa.
    load_test_type: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)

    day: Mapped["GymDay"] = relationship(back_populates="exercises")


class GymLog(Base):
    """
    Sesión marcada como hecha.

    Da **adherencia al gimnasio**, que es a la sala de pesas lo que la asistencia
    es al entrenamiento, y se cruza igual contra minutos jugados.
    """

    __tablename__ = "gym_logs"
    __table_args__ = (
        UniqueConstraint("player_id", "day_id", "logged_on", name="uq_gym_log_player_day_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    player_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("players.id"), nullable=False)
    day_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("gym_days.id", ondelete="CASCADE"), nullable=False
    )
    logged_on: Mapped[date] = mapped_column(Date, nullable=False)
    #: Esfuerzo percibido 1-10. Opcional: el que no lo carga igual marca la sesión.
    rpe: Mapped[Optional[int]] = mapped_column(SmallInteger, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
