"""alcance por división y usuario del jugador

`user_divisions` limita a un usuario a ciertas divisiones. **Sin filas = todas**,
que es lo que hace que esta migración no le saque acceso a nadie: todos los
usuarios existentes arrancan sin alcance asignado y siguen viendo lo mismo.

`players.user_id` habilita el portal del jugador. Nullable porque la enorme
mayoría del plantel nunca va a tener acceso.

Revision ID: 0014
Revises: 0013
Create Date: 2026-07-26

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0014"
down_revision: Union[str, None] = "0013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table: str, column: str) -> bool:
    return any(c["name"] == column for c in sa.inspect(op.get_bind()).get_columns(table))


def upgrade() -> None:
    if not _has_table("user_divisions"):
        op.create_table(
            "user_divisions",
            sa.Column(
                "user_id",
                sa.Uuid(),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                primary_key=True,
            ),
            sa.Column(
                "division_id",
                sa.Uuid(),
                sa.ForeignKey("divisions.id", ondelete="CASCADE"),
                primary_key=True,
            ),
        )

    if not _has_column("players", "user_id"):
        # El unique va como índice aparte: en Postgres agregar la columna con
        # UNIQUE inline sobre una tabla con datos es más frágil.
        op.add_column("players", sa.Column("user_id", sa.Uuid(), nullable=True))
        op.create_foreign_key(
            "fk_players_user", "players", "users", ["user_id"], ["id"]
        )
        op.create_index("uq_players_user", "players", ["user_id"], unique=True)

    # El rol `player` se suma al enum. En Postgres los enums no admiten ALTER
    # dentro de una transacción en versiones viejas, así que se hace explícito.
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'player'")


def downgrade() -> None:
    if _has_column("players", "user_id"):
        op.drop_index("uq_players_user", table_name="players")
        op.drop_constraint("fk_players_user", "players", type_="foreignkey")
        op.drop_column("players", "user_id")

    if _has_table("user_divisions"):
        op.drop_table("user_divisions")

    # El valor `player` del enum no se saca: Postgres no soporta quitar valores de
    # un enum, y dejarlo es inofensivo.
