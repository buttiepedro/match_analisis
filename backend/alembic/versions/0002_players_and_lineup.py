"""players and match lineup

Revision ID: 0002
Revises: 0001
Create Date: 2026-05-30

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_lineupstatus = sa.Enum("on_field", "bench", "substituted_out", name="lineupstatus", create_type=False)


def upgrade() -> None:
    op.execute("""
        DO $$ BEGIN
            CREATE TYPE lineupstatus AS ENUM ('on_field', 'bench', 'substituted_out');
        EXCEPTION WHEN duplicate_object THEN null;
        END $$
    """)

    op.create_table(
        "players",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("division_id", sa.UUID(), sa.ForeignKey("divisions.id"), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("position", sa.String(50), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    op.create_table(
        "match_lineup",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("session_id", sa.UUID(), sa.ForeignKey("sessions.id"), nullable=False),
        sa.Column("player_id", sa.UUID(), sa.ForeignKey("players.id"), nullable=False),
        sa.Column("jersey_number", sa.SmallInteger(), nullable=False),
        sa.Column("position", sa.String(50), nullable=True),
        sa.Column("team", sa.String(10), nullable=False, server_default="home"),
        sa.Column("status", _lineupstatus, nullable=False, server_default="on_field"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    op.create_index("idx_players_division", "players", ["division_id"])
    op.create_index("idx_lineup_session", "match_lineup", ["session_id"])
    op.create_index("idx_lineup_session_team", "match_lineup", ["session_id", "team"])


def downgrade() -> None:
    op.drop_index("idx_lineup_session_team", "match_lineup")
    op.drop_index("idx_lineup_session", "match_lineup")
    op.drop_index("idx_players_division", "players")
    op.drop_table("match_lineup")
    op.drop_table("players")
    op.execute("DROP TYPE IF EXISTS lineupstatus")
