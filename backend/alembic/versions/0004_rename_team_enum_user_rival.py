"""rename team enum home/away to user/rival

Revision ID: 0004
Revises: 0003
Create Date: 2026-06-07

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # events.team is a PostgreSQL ENUM — convert via TEXT (USING required for ENUM→VARCHAR)
    op.execute("ALTER TABLE events ALTER COLUMN team TYPE VARCHAR(10) USING team::text")
    op.execute("UPDATE events SET team = 'user'  WHERE team = 'home'")
    op.execute("UPDATE events SET team = 'rival' WHERE team = 'away'")
    op.execute("DROP TYPE IF EXISTS teamside")
    op.execute("CREATE TYPE teamside AS ENUM ('user', 'rival')")
    op.execute(
        "ALTER TABLE events ALTER COLUMN team TYPE teamside USING team::teamside"
    )

    # match_lineup.team is VARCHAR — just update data + server_default
    op.execute("UPDATE match_lineup SET team = 'user'  WHERE team = 'home'")
    op.execute("UPDATE match_lineup SET team = 'rival' WHERE team = 'away'")
    op.alter_column("match_lineup", "team", server_default=sa.text("'user'"))


def downgrade() -> None:
    op.execute("ALTER TABLE events ALTER COLUMN team TYPE VARCHAR(10) USING team::text")
    op.execute("UPDATE events SET team = 'home' WHERE team = 'user'")
    op.execute("UPDATE events SET team = 'away' WHERE team = 'rival'")
    op.execute("DROP TYPE IF EXISTS teamside")
    op.execute("CREATE TYPE teamside AS ENUM ('home', 'away')")
    op.execute(
        "ALTER TABLE events ALTER COLUMN team TYPE teamside USING team::teamside"
    )

    op.execute("UPDATE match_lineup SET team = 'home'  WHERE team = 'user'")
    op.execute("UPDATE match_lineup SET team = 'away'  WHERE team = 'rival'")
    op.alter_column("match_lineup", "team", server_default=sa.text("'home'"))
