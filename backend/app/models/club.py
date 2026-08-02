import uuid
from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base


class Club(Base):
    __tablename__ = "clubs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    slug: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    #: Marca del club — S3, igual que `Player.profile_photo_url`. NULL = sin logo.
    logo_url: Mapped[str | None] = mapped_column(String(300), nullable=True)
    #: Hex (`#211e67`). NULL = usa el tema por defecto de la app.
    primary_color: Mapped[str | None] = mapped_column(String(7), nullable=True)
    secondary_color: Mapped[str | None] = mapped_column(String(7), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    users: Mapped[list["User"]] = relationship(back_populates="club")
    divisions: Mapped[list["Division"]] = relationship(back_populates="club")
    tournaments: Mapped[list["Tournament"]] = relationship(back_populates="club")
