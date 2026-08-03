"""comunicados del club

Primer MVP de "novedades": publicaciones simples de texto, para todo el club
o para una división puntual. Sin adjuntos ni moderación a propósito — eso ya
lo resuelve la Bolsa de trabajo para su propio caso de uso; construirlo de
nuevo acá antes de saber si el club usa esta pantalla sería trabajo tirado.

Revision ID: 0028
Revises: 0027
Create Date: 2026-08-02

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0028"
down_revision: Union[str, None] = "0027"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if _has_table("announcements"):
        return

    op.create_table(
        "announcements",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("club_id", sa.Uuid(), sa.ForeignKey("clubs.id"), nullable=False),
        sa.Column("division_id", sa.Uuid(), sa.ForeignKey("divisions.id"), nullable=True),
        sa.Column("title", sa.String(150), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_announcements_club_created", "announcements", ["club_id", "created_at"])


def downgrade() -> None:
    if _has_table("announcements"):
        op.drop_index("ix_announcements_club_created", table_name="announcements")
        op.drop_table("announcements")
