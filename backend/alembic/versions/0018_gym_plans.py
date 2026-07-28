"""planes de gimnasio

La carga de un ejercicio puede ser absoluta o **relativa a un test del jugador**
(`75% de Sentadilla 3RM`). Eso es lo que permite escribir un plan por división y
que cada uno vea sus propios kilos.

Revision ID: 0018
Revises: 0017
Create Date: 2026-07-27

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0018"
down_revision: Union[str, None] = "0017"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

LOAD_TYPE_VALUES = ("absoluta", "porcentaje_test", "libre")


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def _enum(name: str, values: tuple[str, ...]) -> sa.types.TypeEngine:
    """En Postgres el tipo se crea aparte; `create_type=False` evita el segundo
    CREATE TYPE que emitiría `create_table`."""
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
    if not _has_table("gym_plans"):
        op.create_table(
            "gym_plans",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("club_id", sa.Uuid(), sa.ForeignKey("clubs.id"), nullable=False),
            sa.Column("division_id", sa.Uuid(), sa.ForeignKey("divisions.id"), nullable=False),
            sa.Column("name", sa.String(100), nullable=False),
            sa.Column("weeks", sa.SmallInteger(), nullable=False, server_default="4"),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
            sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index("ix_gym_plans_division", "gym_plans", ["division_id"])

    if not _has_table("gym_days"):
        op.create_table(
            "gym_days",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column(
                "plan_id", sa.Uuid(), sa.ForeignKey("gym_plans.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("week", sa.SmallInteger(), nullable=False),
            sa.Column("day", sa.SmallInteger(), nullable=False),
            sa.Column("name", sa.String(80), nullable=False),
            sa.UniqueConstraint("plan_id", "week", "day", name="uq_gym_day_plan_week_day"),
        )

    if not _has_table("gym_exercises"):
        op.create_table(
            "gym_exercises",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column(
                "day_id", sa.Uuid(), sa.ForeignKey("gym_days.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("name", sa.String(100), nullable=False),
            sa.Column("sets", sa.SmallInteger(), nullable=True),
            sa.Column("reps", sa.String(20), nullable=True),
            sa.Column(
                "load_type", _enum("loadtype", LOAD_TYPE_VALUES),
                nullable=False, server_default="libre",
            ),
            sa.Column("load_value", sa.Numeric(6, 2), nullable=True),
            sa.Column("load_test_type", sa.String(30), nullable=True),
            sa.Column("notes", sa.String(200), nullable=True),
        )

    if not _has_table("gym_logs"):
        op.create_table(
            "gym_logs",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("player_id", sa.Uuid(), sa.ForeignKey("players.id"), nullable=False),
            sa.Column(
                "day_id", sa.Uuid(), sa.ForeignKey("gym_days.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("logged_on", sa.Date(), nullable=False),
            sa.Column("rpe", sa.SmallInteger(), nullable=True),
            sa.Column("notes", sa.String(200), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.UniqueConstraint(
                "player_id", "day_id", "logged_on", name="uq_gym_log_player_day_date"
            ),
        )
        op.create_index("ix_gym_logs_player", "gym_logs", ["player_id"])


def downgrade() -> None:
    for table in ("gym_logs", "gym_exercises", "gym_days", "gym_plans"):
        if _has_table(table):
            op.drop_table(table)
    _drop_enum("loadtype", LOAD_TYPE_VALUES)
