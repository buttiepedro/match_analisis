"""add profile_photo_url to players

Revision ID: 0006
Revises: 0005
Create Date: 2026-06-11

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(table: str, column: str) -> bool:
    return any(
        c["name"] == column
        for c in sa.inspect(op.get_bind()).get_columns(table)
    )


def upgrade() -> None:
    if not _has_column("players", "profile_photo_url"):
        op.add_column(
            "players",
            sa.Column("profile_photo_url", sa.String(300), nullable=True),
        )


def downgrade() -> None:
    if _has_column("players", "profile_photo_url"):
        op.drop_column("players", "profile_photo_url")
