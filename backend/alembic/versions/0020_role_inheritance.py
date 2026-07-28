"""herencia entre roles

Un rol puede derivar de otro: "Jugador hereda de Socio y agrega ver sus tests".

`role_permissions` pasa a guardar las propias **y** las heredadas, distinguidas
por `inherited`. Las heredadas quedan materializadas porque `user_permissions()`
es sync y corre en el camino de todos los requests: resolver ahí la cadena de
padres sería lazy-loading dentro de código sync.

Los datos existentes no cambian de significado: todo lo que hay hoy es propio, y
`inherited` arranca en false para todos. Ningún rol nace con padre, así que nadie
gana ni pierde una capacidad al aplicar esta migración.

Revision ID: 0020
Revises: 0019
Create Date: 2026-07-28

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0020"
down_revision: Union[str, None] = "0019"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "role_permissions",
        sa.Column(
            "inherited", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
    )
    op.add_column(
        "roles", sa.Column("parent_role_id", sa.Uuid(), nullable=True)
    )
    op.create_foreign_key(
        "fk_roles_parent_role_id",
        "roles",
        "roles",
        ["parent_role_id"],
        ["id"],
        # RESTRICT y no CASCADE: borrar Socio no puede llevarse puesto a Jugador.
        # La API lo bloquea antes con un mensaje que dice quién hereda, pero la
        # base tiene que sostenerlo igual si alguien escribe por afuera.
        ondelete="RESTRICT",
    )
    # Buscar los hijos de un rol pasa en cada listado y en cada borrado.
    op.create_index("ix_roles_parent_role_id", "roles", ["parent_role_id"])


def downgrade() -> None:
    # Al volver atrás, las filas heredadas quedarían como propias y le darían a
    # cada rol capacidades que nadie le tildó. Se borran primero.
    op.execute("DELETE FROM role_permissions WHERE inherited = true")

    op.drop_index("ix_roles_parent_role_id", table_name="roles")
    op.drop_constraint("fk_roles_parent_role_id", "roles", type_="foreignkey")
    op.drop_column("roles", "parent_role_id")
    op.drop_column("role_permissions", "inherited")
