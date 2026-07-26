import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class Opponent(Base):
    """
    Rival del club.

    Existe **junto a** `sessions.away_team`, no en su lugar: ese string es el
    registro de cómo se llamó el rival en ese partido y hay estadísticas que
    dependen de él. La entidad es lo que permite cruzar fechas distintas.
    """

    __tablename__ = "opponents"
    __table_args__ = (
        UniqueConstraint("club_id", "name", name="uq_opponent_club_name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    club_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clubs.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    sessions: Mapped[list["Session"]] = relationship(back_populates="opponent")
