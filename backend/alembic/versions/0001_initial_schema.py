"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-05-29

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ENUM as PGENUM

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_userrole = PGENUM(name="userrole", create_type=False)
_sessionstatus = PGENUM(name="sessionstatus", create_type=False)
_timerstatus = PGENUM(name="timerstatus", create_type=False)
_teamside = PGENUM(name="teamside", create_type=False)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _has_table(name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(name)


def _has_index(table: str, index: str) -> bool:
    return any(
        i["name"] == index
        for i in sa.inspect(op.get_bind()).get_indexes(table)
    )


def _safe_create_enum(name: str, *values: str) -> None:
    vals = ", ".join(f"'{v}'" for v in values)
    op.execute(f"""
        DO $$ BEGIN
            CREATE TYPE {name} AS ENUM ({vals});
        EXCEPTION WHEN duplicate_object THEN null;
        END $$
    """)


# ── Upgrade ───────────────────────────────────────────────────────────────────

def upgrade() -> None:
    _safe_create_enum("userrole", "superadmin", "club_admin", "match_director", "analyst")
    _safe_create_enum("sessionstatus", "scheduled", "active", "halftime", "finished")
    _safe_create_enum("timerstatus", "stopped", "running", "paused", "halftime", "finished")
    _safe_create_enum("teamside", "home", "away")

    if not _has_table("clubs"):
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

    if not _has_table("users"):
        op.create_table(
            "users",
            sa.Column("id", sa.UUID(), primary_key=True),
            sa.Column("club_id", sa.UUID(), sa.ForeignKey("clubs.id"), nullable=True),
            sa.Column("email", sa.String(255), nullable=False),
            sa.Column("password_hash", sa.String(), nullable=False),
            sa.Column("full_name", sa.String(100), nullable=False),
            sa.Column("role", _userrole, nullable=False),
            sa.Column("is_active", sa.Boolean(), server_default=sa.text("true")),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
            sa.UniqueConstraint("email", name="uq_users_email"),
        )

    if not _has_table("divisions"):
        op.create_table(
            "divisions",
            sa.Column("id", sa.UUID(), primary_key=True),
            sa.Column("club_id", sa.UUID(), sa.ForeignKey("clubs.id"), nullable=False),
            sa.Column("name", sa.String(100), nullable=False),
            sa.Column("is_active", sa.Boolean(), server_default=sa.text("true")),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        )

    if not _has_table("tournaments"):
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

    if not _has_table("sessions"):
        op.create_table(
            "sessions",
            sa.Column("id", sa.UUID(), primary_key=True),
            sa.Column("tournament_id", sa.UUID(), sa.ForeignKey("tournaments.id"), nullable=False),
            sa.Column("home_team", sa.String(100), nullable=False),
            sa.Column("away_team", sa.String(100), nullable=False),
            sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("status", _sessionstatus, nullable=False, server_default="scheduled"),
            sa.Column("half_duration_minutes", sa.Integer(), server_default="40"),
            sa.Column("created_by", sa.UUID(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        )

    if not _has_table("timer_states"):
        op.create_table(
            "timer_states",
            sa.Column("id", sa.UUID(), primary_key=True),
            sa.Column("session_id", sa.UUID(), sa.ForeignKey("sessions.id"), nullable=False),
            sa.Column("current_half", sa.SmallInteger(), server_default="1"),
            sa.Column("status", _timerstatus, nullable=False, server_default="stopped"),
            sa.Column("elapsed_seconds", sa.Integer(), server_default="0"),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
            sa.UniqueConstraint("session_id", name="uq_timer_states_session_id"),
        )

    if not _has_table("events"):
        op.create_table(
            "events",
            sa.Column("id", sa.UUID(), primary_key=True),
            sa.Column("session_id", sa.UUID(), sa.ForeignKey("sessions.id"), nullable=False),
            sa.Column("event_type", sa.String(50), nullable=False),
            sa.Column("half", sa.SmallInteger(), nullable=False),
            sa.Column("timer_seconds", sa.Integer(), nullable=False),
            sa.Column("team", _teamside, nullable=False),
            sa.Column("player_number", sa.SmallInteger(), nullable=True),
            sa.Column("reason", sa.String(50), nullable=True),
            sa.Column("metadata", sa.JSON(), server_default="{}"),
            sa.Column("recorded_by", sa.UUID(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("recorded_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        )

    if not _has_table("refresh_tokens"):
        op.create_table(
            "refresh_tokens",
            sa.Column("id", sa.UUID(), primary_key=True),
            sa.Column("user_id", sa.UUID(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("token_hash", sa.String(), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("revoked", sa.Boolean(), server_default=sa.text("false")),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        )

    if not _has_index("events", "idx_events_session_id"):
        op.create_index("idx_events_session_id", "events", ["session_id"])
    if not _has_index("events", "idx_events_session_type"):
        op.create_index("idx_events_session_type", "events", ["session_id", "event_type"])
    if not _has_index("sessions", "idx_sessions_tournament"):
        op.create_index("idx_sessions_tournament", "sessions", ["tournament_id"])
    if not _has_index("users", "idx_users_club"):
        op.create_index("idx_users_club", "users", ["club_id"])
    if not _has_index("refresh_tokens", "idx_refresh_tokens_user"):
        op.create_index("idx_refresh_tokens_user", "refresh_tokens", ["user_id"])


# ── Downgrade ─────────────────────────────────────────────────────────────────

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

    op.execute("DROP TYPE IF EXISTS teamside")
    op.execute("DROP TYPE IF EXISTS timerstatus")
    op.execute("DROP TYPE IF EXISTS sessionstatus")
    op.execute("DROP TYPE IF EXISTS userrole")
