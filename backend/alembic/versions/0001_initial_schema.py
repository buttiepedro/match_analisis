"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-05-29

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

user_role_enum = sa.Enum("superadmin", "club_admin", "match_director", "analyst", name="userrole")
session_status_enum = sa.Enum("scheduled", "active", "halftime", "finished", name="sessionstatus")
timer_status_enum = sa.Enum("stopped", "running", "paused", "halftime", "finished", name="timerstatus")
team_side_enum = sa.Enum("home", "away", name="teamside")


def upgrade() -> None:
    bind = op.get_bind()
    user_role_enum.create(bind, checkfirst=True)
    session_status_enum.create(bind, checkfirst=True)
    timer_status_enum.create(bind, checkfirst=True)
    team_side_enum.create(bind, checkfirst=True)

    op.create_table(
        "clubs",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("slug", sa.String(50), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.UniqueConstraint("slug", name="uq_clubs_slug"),
    )

    op.create_table(
        "users",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("club_id", sa.UUID(), sa.ForeignKey("clubs.id"), nullable=True),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("password_hash", sa.String(), nullable=False),
        sa.Column("full_name", sa.String(100), nullable=False),
        sa.Column("role", user_role_enum, nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.UniqueConstraint("email", name="uq_users_email"),
    )

    op.create_table(
        "divisions",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("club_id", sa.UUID(), sa.ForeignKey("clubs.id"), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    op.create_table(
        "tournaments",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("club_id", sa.UUID(), sa.ForeignKey("clubs.id"), nullable=False),
        sa.Column("division_id", sa.UUID(), sa.ForeignKey("divisions.id"), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("season", sa.String(20), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    op.create_table(
        "sessions",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("tournament_id", sa.UUID(), sa.ForeignKey("tournaments.id"), nullable=False),
        sa.Column("home_team", sa.String(100), nullable=False),
        sa.Column("away_team", sa.String(100), nullable=False),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", session_status_enum, nullable=False, server_default="scheduled"),
        sa.Column("half_duration_minutes", sa.Integer(), server_default="40"),
        sa.Column("created_by", sa.UUID(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    op.create_table(
        "timer_states",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("session_id", sa.UUID(), sa.ForeignKey("sessions.id"), nullable=False),
        sa.Column("current_half", sa.SmallInteger(), server_default="1"),
        sa.Column("status", timer_status_enum, nullable=False, server_default="stopped"),
        sa.Column("elapsed_seconds", sa.Integer(), server_default="0"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.UniqueConstraint("session_id", name="uq_timer_states_session_id"),
    )

    op.create_table(
        "events",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("session_id", sa.UUID(), sa.ForeignKey("sessions.id"), nullable=False),
        sa.Column("event_type", sa.String(50), nullable=False),
        sa.Column("half", sa.SmallInteger(), nullable=False),
        sa.Column("timer_seconds", sa.Integer(), nullable=False),
        sa.Column("team", team_side_enum, nullable=False),
        sa.Column("player_number", sa.SmallInteger(), nullable=True),
        sa.Column("reason", sa.String(50), nullable=True),
        sa.Column("metadata", sa.JSON(), server_default="{}"),
        sa.Column("recorded_by", sa.UUID(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    op.create_table(
        "refresh_tokens",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("user_id", sa.UUID(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("token_hash", sa.String(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked", sa.Boolean(), server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    op.create_index("idx_events_session_id", "events", ["session_id"])
    op.create_index("idx_events_session_type", "events", ["session_id", "event_type"])
    op.create_index("idx_sessions_tournament", "sessions", ["tournament_id"])
    op.create_index("idx_users_club", "users", ["club_id"])
    op.create_index("idx_refresh_tokens_user", "refresh_tokens", ["user_id"])


def downgrade() -> None:
    op.drop_index("idx_refresh_tokens_user", "refresh_tokens")
    op.drop_index("idx_users_club", "users")
    op.drop_index("idx_sessions_tournament", "sessions")
    op.drop_index("idx_events_session_type", "events")
    op.drop_index("idx_events_session_id", "events")

    op.drop_table("refresh_tokens")
    op.drop_table("events")
    op.drop_table("timer_states")
    op.drop_table("sessions")
    op.drop_table("tournaments")
    op.drop_table("divisions")
    op.drop_table("users")
    op.drop_table("clubs")

    bind = op.get_bind()
    team_side_enum.drop(bind, checkfirst=True)
    timer_status_enum.drop(bind, checkfirst=True)
    session_status_enum.drop(bind, checkfirst=True)
    user_role_enum.drop(bind, checkfirst=True)
