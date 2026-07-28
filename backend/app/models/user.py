import uuid
import enum
from datetime import datetime
from typing import Optional
from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, Enum, Table, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base


class UserRole(str, enum.Enum):
    superadmin = "superadmin"
    club_admin = "club_admin"
    match_director = "match_director"
    analyst = "analyst"
    #: Sólo ve su propia ficha. No es un usuario de club con menos permisos.
    player = "player"


#: Alcance del usuario. **Sin filas = todas las divisiones del club**: es lo que
#: hace que asignar alcance sea opcional y que ningún usuario existente pierda
#: acceso al migrar.
user_divisions = Table(
    "user_divisions",
    Base.metadata,
    Column("user_id", ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("division_id", ForeignKey("divisions.id", ondelete="CASCADE"), primary_key=True),
)


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    club_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("clubs.id"), nullable=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
    full_name: Mapped[str] = mapped_column(String(100), nullable=False)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    club: Mapped[Optional["Club"]] = relationship(back_populates="users")
    refresh_tokens: Mapped[list["RefreshToken"]] = relationship(back_populates="user")
    divisions: Mapped[list["Division"]] = relationship(secondary=user_divisions, lazy="selectin")
    #: Varios roles por usuario: sus capacidades se suman.
    roles: Mapped[list["Role"]] = relationship(
        secondary="user_roles", back_populates="users", lazy="selectin"
    )
