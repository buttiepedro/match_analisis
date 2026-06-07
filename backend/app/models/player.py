import enum
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, SmallInteger, String, func
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
    is_active: Mapped[bool] = mapped_column(Boolean, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    division: Mapped["Division"] = relationship(back_populates="players")
    lineup_entries: Mapped[list["MatchLineup"]] = relationship(back_populates="player")


class MatchLineup(Base):
    __tablename__ = "match_lineup"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sessions.id"), nullable=False)
    player_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("players.id"), nullable=False)
    jersey_number: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    position: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    team: Mapped[str] = mapped_column(String(10), nullable=False, server_default="user")
    status: Mapped[LineupStatus] = mapped_column(
        Enum(LineupStatus), nullable=False, server_default="on_field"
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    session: Mapped["Session"] = relationship(back_populates="lineup")
    player: Mapped["Player"] = relationship(back_populates="lineup_entries")
