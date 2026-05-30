"""add player_id to events

Revision ID: 0003
Revises: 0002
Create Date: 2026-05-30

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(table: str, column: str) -> bool:
    return any(
        c["name"] == column
        for c in sa.inspect(op.get_bind()).get_columns(table)
    )


def _has_index(table: str, index: str) -> bool:
    return any(
        i["name"] == index
        for i in sa.inspect(op.get_bind()).get_indexes(table)
    )


def upgrade() -> None:
    if not _has_column("events", "player_id"):
        op.add_column(
            "events",
            sa.Column(
                "player_id",
                sa.UUID(),
                sa.ForeignKey("players.id"),
                nullable=True,
            ),
        )
        op.create_index("idx_events_player", "events", ["player_id"])


def downgrade() -> None:
    if _has_index("events", "idx_events_player"):
        op.drop_index("idx_events_player", "events")
    if _has_column("events", "player_id"):
        op.drop_column("events", "player_id")
