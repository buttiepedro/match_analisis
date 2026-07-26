import enum
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import Boolean, Date, DateTime, Enum, ForeignKey, Numeric, SmallInteger, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class LineupStatus(str, enum.Enum):
    on_field = "on_field"
    bench = "bench"
    substituted_out = "substituted_out"


class Player(Base):
    __tablename__ = "players"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    division_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("divisions.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    position: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    dni: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    date_of_birth: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    sex: Mapped[Optional[str]] = mapped_column(String(1), nullable=True)
    email: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    emergency_phone: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    obra_social: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    profile_photo_url: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    division: Mapped["Division"] = relationship(back_populates="players")
    lineup_entries: Mapped[list["MatchLineup"]] = relationship(back_populates="player")
    division_history: Mapped[list["PlayerDivisionHistory"]] = relationship(back_populates="player")
    measurements: Mapped[list["PlayerMeasurement"]] = relationship(back_populates="player")
    physical_tests: Mapped[list["PhysicalTest"]] = relationship(back_populates="player")


class MatchLineup(Base):
    __tablename__ = "match_lineup"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sessions.id"), nullable=False)
    player_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("players.id"), nullable=False)
    jersey_number: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    position: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    team: Mapped[str] = mapped_column(String(10), nullable=False, default="user", server_default="user")
    status: Mapped[LineupStatus] = mapped_column(
        Enum(LineupStatus), nullable=False, default=LineupStatus.on_field, server_default="on_field"
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    session: Mapped["Session"] = relationship(back_populates="lineup")
    player: Mapped["Player"] = relationship(back_populates="lineup_entries")


class PlayerDivisionHistory(Base):
    __tablename__ = "player_division_history"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    player_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("players.id"), nullable=False)
    division_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("divisions.id"), nullable=False)
    from_date: Mapped[date] = mapped_column(Date, nullable=False)
    to_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    moved_by: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    player: Mapped["Player"] = relationship(back_populates="division_history")
    division: Mapped["Division"] = relationship()


class PlayerMeasurement(Base):
    __tablename__ = "player_measurements"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    player_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("players.id"), nullable=False)
    measured_at: Mapped[date] = mapped_column(Date, nullable=False)
    weight_kg: Mapped[Optional[Decimal]] = mapped_column(Numeric(5, 2), nullable=True)
    height_cm: Mapped[Optional[Decimal]] = mapped_column(Numeric(5, 1), nullable=True)
    bmi: Mapped[Optional[Decimal]] = mapped_column(Numeric(4, 2), nullable=True)
    fat_fold_tricep_mm: Mapped[Optional[Decimal]] = mapped_column(Numeric(4, 1), nullable=True)
    fat_fold_subscapular_mm: Mapped[Optional[Decimal]] = mapped_column(Numeric(4, 1), nullable=True)
    fat_fold_suprailiac_mm: Mapped[Optional[Decimal]] = mapped_column(Numeric(4, 1), nullable=True)
    fat_fold_abdominal_mm: Mapped[Optional[Decimal]] = mapped_column(Numeric(4, 1), nullable=True)
    fat_fold_biceps_mm: Mapped[Optional[Decimal]] = mapped_column(Numeric(4, 1), nullable=True)
    body_fat_percent: Mapped[Optional[Decimal]] = mapped_column(Numeric(4, 1), nullable=True)
    # Juego de pliegues / sexo / banda etaria usados, ej. "dw4c/M/20-29".
    body_fat_method: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    recorded_by: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    player: Mapped["Player"] = relationship(back_populates="measurements")


class PhysicalTest(Base):
    __tablename__ = "physical_tests"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    player_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("players.id"), nullable=False)
    test_date: Mapped[date] = mapped_column(Date, nullable=False)
    test_type: Mapped[str] = mapped_column(String(50), nullable=False)
    value: Mapped[Decimal] = mapped_column(Numeric(8, 3), nullable=False)
    unit: Mapped[str] = mapped_column(String(20), nullable=False)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    recorded_by: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    player: Mapped["Player"] = relationship(back_populates="physical_tests")
