"""convocatoria del partido

Paso intermedio entre "toda la división" y "los 23": el entrenador convoca ~25
durante la semana y el sábado el lineup sale de ahí.

Revision ID: 0012
Revises: 0011
Create Date: 2026-07-26

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0012"
down_revision: Union[str, None] = "0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SQUAD_STATUS_VALUES = ("convocado", "confirmado", "baja")


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def _enum(name: str, values: tuple[str, ...]) -> sa.types.TypeEngine:
    """En Postgres el tipo se crea aparte; `create_type=False` evita que
    `create_table` emita un segundo `CREATE TYPE` y haga fallar la migración."""
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        from sqlalchemy.dialects import postgresql

        postgresql.ENUM(*values, name=name).create(bind, checkfirst=True)
        return postgresql.ENUM(*values, name=name, create_type=False)
    return sa.Enum(*values, name=name)


def _drop_enum(name: str, values: tuple[str, ...]) -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        from sqlalchemy.dialects import postgresql

        postgresql.ENUM(*values, name=name).drop(bind, checkfirst=True)


def upgrade() -> None:
    if _has_table("match_squad"):
        return

    op.create_table(
        "match_squad",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "session_id",
            sa.Uuid(),
            sa.ForeignKey("sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("player_id", sa.Uuid(), sa.ForeignKey("players.id"), nullable=False),
        sa.Column(
            "status",
            _enum("squadstatus", SQUAD_STATUS_VALUES),
            nullable=False,
            server_default="convocado",
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("session_id", "player_id", name="uq_squad_session_player"),
    )


def downgrade() -> None:
    if not _has_table("match_squad"):
        return
    op.drop_table("match_squad")
    _drop_enum("squadstatus", SQUAD_STATUS_VALUES)
