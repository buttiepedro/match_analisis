import uuid
import enum
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Integer, SmallInteger, DateTime, ForeignKey, Enum, JSON, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base


class TeamSide(str, enum.Enum):
    home = "home"
    away = "away"


class Event(Base):
    __tablename__ = "events"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sessions.id"), nullable=False)
    event_type: Mapped[str] = mapped_column(String(50), nullable=False)
    half: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    timer_seconds: Mapped[int] = mapped_column(Integer, nullable=False)
    team: Mapped[TeamSide] = mapped_column(Enum(TeamSide), nullable=False)
    player_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("players.id"), nullable=True)
    player_number: Mapped[Optional[int]] = mapped_column(SmallInteger, nullable=True)
    reason: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    metadata_: Mapped[dict] = mapped_column("metadata", JSON, server_default="{}")
    recorded_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    session: Mapped["Session"] = relationship(back_populates="events")
