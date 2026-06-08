"""add dni to players

Revision ID: 0005
Revises: 0004
Create Date: 2026-06-07

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(table: str, column: str) -> bool:
    return any(
        c["name"] == column
        for c in sa.inspect(op.get_bind()).get_columns(table)
    )


def upgrade() -> None:
    if not _has_column("players", "dni"):
        op.add_column(
            "players",
            sa.Column("dni", sa.String(20), nullable=True),
        )


def downgrade() -> None:
    if _has_column("players", "dni"):
        op.drop_column("players", "dni")
