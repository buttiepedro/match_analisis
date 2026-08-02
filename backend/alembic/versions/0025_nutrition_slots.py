"""turnos con nutricionista

Horario y reserva son el mismo registro en distinto estado: un turno libre y
uno reservado nunca dejan de ser el mismo slot. `reminder_sent_at` evita
mandar el recordatorio dos veces si el job de APScheduler corre más de una
vez sobre la misma ventana.

Revision ID: 0025
Revises: 0024
Create Date: 2026-08-02

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0025"
down_revision: Union[str, None] = "0024"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

STATUS_VALUES = ("libre", "reservado", "cancelado")


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def _enum(name: str, values: tuple[str, ...]) -> sa.types.TypeEngine:
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
    if _has_table("nutrition_slots"):
        return

    op.create_table(
        "nutrition_slots",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("club_id", sa.Uuid(), sa.ForeignKey("clubs.id"), nullable=False),
        sa.Column("nutritionist_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "status", _enum("nutritionslotstatus", STATUS_VALUES),
            nullable=False, server_default="libre",
        ),
        sa.Column("player_id", sa.Uuid(), sa.ForeignKey("players.id"), nullable=True),
        sa.Column("notes", sa.String(300), nullable=True),
        sa.Column("booked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_by", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reminder_sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_nutrition_slots_club_starts", "nutrition_slots", ["club_id", "starts_at"])
    op.create_index(
        "ix_nutrition_slots_nutritionist_starts", "nutrition_slots", ["nutritionist_id", "starts_at"]
    )


def downgrade() -> None:
    if _has_table("nutrition_slots"):
        op.drop_index("ix_nutrition_slots_nutritionist_starts", table_name="nutrition_slots")
        op.drop_index("ix_nutrition_slots_club_starts", table_name="nutrition_slots")
        op.drop_table("nutrition_slots")
    _drop_enum("nutritionslotstatus", STATUS_VALUES)
