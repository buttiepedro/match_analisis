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


class KnownPermission(Base):
    """
    Capacidades que esta instalación **ya vio alguna vez**.

    Existe para distinguir dos cosas que en la base se ven igual: un rol que no
    tiene una capacidad porque el club se la sacó, y uno que no la tiene porque
    todavía no existía cuando se sembró el rol.

    Lo segundo no es una decisión de nadie: es un agujero. Ya pasó tres veces
    —socios, gimnasio y bolsa de trabajo se desplegaron y **nadie las vio**,
    porque los roles de los clubes existentes se habían sembrado antes de que
    esas capacidades existieran, y sembrar es idempotente a propósito—.

    Con este registro, al arrancar se detecta lo que es genuinamente nuevo y se
    reparte según el preset. Lo que la instalación ya conoce no se toca nunca
    más: eso sí es decisión del club.
    """

    __tablename__ = "known_permissions"

    permission: Mapped[str] = mapped_column(String(50), primary_key=True)
    first_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class RolePermission(Base):
    """
    Una capacidad concedida a un rol. El valor es un `Permission`.

    Guarda las **propias y las heredadas**, distinguidas por `inherited`. Las
    heredadas están materializadas —se recalculan al escribir— y no resueltas al
    leer, porque `user_permissions()` es una función *sync* que corre en el
    camino de todos los requests. Recorrer ahí la cadena de padres significaría
    lazy-loading dentro de código sync, que en este proyecto ya explotó dos veces
    con `MissingGreenlet`.

    El precio es recalcular al editar un rol. Un club tiene ocho o quince roles:
    es barato, y pasa una vez por edición en vez de una vez por request.
    """

    __tablename__ = "role_permissions"

    role_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True
    )
    permission: Mapped[str] = mapped_column(String(50), primary_key=True)
    #: False = la tildó alguien en este rol. True = viene de un ancestro.
    #: Si es las dos cosas gana "propia": sacarle el padre no debe quitársela.
    inherited: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )


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
    #: De quién deriva. "Jugador hereda de Socio" es un `parent_role_id`.
    #:
    #: Un solo padre, no varios: así el club queda como un árbol que se puede
    #: dibujar y explicar ("Jugador = Socio + 2 propias"). La suma de dos ramas
    #: —el entrenador que además es tesorero— ya se resuelve asignándole los dos
    #: roles al usuario, que es donde ese caso pertenece.
    #:
    #: `RESTRICT` y no `CASCADE`: borrar Socio no puede llevarse puesto a Jugador.
    parent_role_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("roles.id", ondelete="RESTRICT"), nullable=True
    )
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
        """Lo que el rol concede de verdad: propias **más** heredadas."""
        return {p.permission for p in self.permissions}

    @property
    def own_permission_values(self) -> set[str]:
        """Sólo las tildadas en este rol. Es lo que se edita."""
        return {p.permission for p in self.permissions if not p.inherited}
