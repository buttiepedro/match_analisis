import uuid
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, String, Table, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

#: Un usuario puede tener varios roles: el entrenador de M17 también es socio, y
#: el tesorero también es padre de un jugador. Sus capacidades se suman.
user_roles = Table(
    "user_roles",
    Base.metadata,
    Column("user_id", ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("role_id", ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
)


class RolePermission(Base):
    """Una capacidad concedida a un rol. El valor es un `Permission`."""

    __tablename__ = "role_permissions"

    role_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True
    )
    permission: Mapped[str] = mapped_column(String(50), primary_key=True)


class Role(Base):
    """
    Rol **del club**, no global.

    Un club que quiera un Entrenador que además cargue lesiones tiene que poder
    cambiarlo sin afectar a los demás clubes, así que los presets se siembran por
    club al crearlo y a partir de ahí son suyos.
    """

    __tablename__ = "roles"
    __table_args__ = (UniqueConstraint("club_id", "name", name="uq_role_club_name"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    club_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clubs.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(50), nullable=False)
    #: Un preset se puede editar pero no borrar: es la red que evita que un club
    #: se quede sin ningún rol capaz de administrar.
    is_preset: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    permissions: Mapped[list["RolePermission"]] = relationship(
        primaryjoin="Role.id == RolePermission.role_id",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    users: Mapped[list["User"]] = relationship(secondary=user_roles, back_populates="roles")

    @property
    def permission_values(self) -> set[str]:
        return {p.permission for p in self.permissions}
