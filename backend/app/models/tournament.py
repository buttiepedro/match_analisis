import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Boolean, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base


class Tournament(Base):
    __tablename__ = "tournaments"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    club_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clubs.id"), nullable=False)
    division_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("divisions.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    season: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    club: Mapped["Club"] = relationship(back_populates="tournaments")
    division: Mapped["Division"] = relationship(back_populates="tournaments")
    sessions: Mapped[list["Session"]] = relationship(back_populates="tournament")
