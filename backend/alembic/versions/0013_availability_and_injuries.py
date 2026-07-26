"""disponibilidad del jugador, apto médico y lesiones

Hasta acá `is_active` era el único estado: lesionado, suspendido y sin apto
médico eran todos "activo", y armar el equipo se hacía de memoria.

Revision ID: 0013
Revises: 0012
Create Date: 2026-07-26

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0013"
down_revision: Union[str, None] = "0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

AVAILABILITY_VALUES = ("disponible", "lesionado", "suspendido", "baja_temporal")
INJURY_SEVERITY_VALUES = ("leve", "moderada", "grave")


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table: str, column: str) -> bool:
    return any(c["name"] == column for c in sa.inspect(op.get_bind()).get_columns(table))


def _enum(name: str, values: tuple[str, ...]) -> sa.types.TypeEngine:
    """En Postgres el tipo se crea aparte; `create_type=False` evita el segundo
    `CREATE TYPE` que emitirían `create_table` / `add_column`."""
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
    if not _has_column("players", "availability"):
        op.add_column(
            "players",
            sa.Column(
                "availability",
                _enum("availability", AVAILABILITY_VALUES),
                nullable=False,
                server_default="disponible",
            ),
        )

    for column in ("medical_clearance_date", "medical_clearance_expires"):
        if not _has_column("players", column):
            op.add_column("players", sa.Column(column, sa.Date(), nullable=True))

    if not _has_table("player_injuries"):
        op.create_table(
            "player_injuries",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("player_id", sa.Uuid(), sa.ForeignKey("players.id"), nullable=False),
            sa.Column("injury_date", sa.Date(), nullable=False),
            sa.Column("body_zone", sa.String(50), nullable=True),
            sa.Column("injury_type", sa.String(50), nullable=True),
            sa.Column(
                "severity",
                _enum("injuryseverity", INJURY_SEVERITY_VALUES),
                nullable=False,
                server_default="leve",
            ),
            sa.Column("expected_return", sa.Date(), nullable=True),
            sa.Column("actual_return", sa.Date(), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("recorded_by", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index("ix_injuries_player", "player_injuries", ["player_id"])


def downgrade() -> None:
    if _has_table("player_injuries"):
        op.drop_index("ix_injuries_player", table_name="player_injuries")
        op.drop_table("player_injuries")
        _drop_enum("injuryseverity", INJURY_SEVERITY_VALUES)

    for column in ("medical_clearance_expires", "medical_clearance_date"):
        if _has_column("players", column):
            op.drop_column("players", column)

    if _has_column("players", "availability"):
        op.drop_column("players", "availability")
        _drop_enum("availability", AVAILABILITY_VALUES)
