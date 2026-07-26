import uuid
import enum
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Integer, SmallInteger, DateTime, ForeignKey, Enum, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base


class SessionStatus(str, enum.Enum):
    scheduled = "scheduled"
    active = "active"
    halftime = "halftime"
    finished = "finished"


class TimerStatus(str, enum.Enum):
    stopped = "stopped"
    running = "running"
    paused = "paused"
    halftime = "halftime"
    finished = "finished"


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tournament_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tournaments.id"), nullable=False)
    home_team: Mapped[str] = mapped_column(String(100), nullable=False)
    away_team: Mapped[str] = mapped_column(String(100), nullable=False)
    scheduled_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[SessionStatus] = mapped_column(Enum(SessionStatus), nullable=False, default=SessionStatus.scheduled, server_default="scheduled")
    half_duration_minutes: Mapped[int] = mapped_column(Integer, default=40, server_default="40")
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    tournament: Mapped["Tournament"] = relationship(back_populates="sessions")
    timer_state: Mapped[Optional["TimerState"]] = relationship(back_populates="session", uselist=False)
    events: Mapped[list["Event"]] = relationship(back_populates="session")
    lineup: Mapped[list["MatchLineup"]] = relationship(back_populates="session")


class TimerState(Base):
    __tablename__ = "timer_states"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sessions.id"), unique=True, nullable=False)
    current_half: Mapped[int] = mapped_column(SmallInteger, default=1, server_default="1")
    status: Mapped[TimerStatus] = mapped_column(Enum(TimerStatus), nullable=False, default=TimerStatus.stopped, server_default="stopped")
    elapsed_seconds: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    session: Mapped["Session"] = relationship(back_populates="timer_state")
