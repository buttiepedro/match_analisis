"""bolsa de trabajo

Avisos de socios, con moderación y **expiración obligatoria**: una bolsa llena de
avisos de hace dos años deja de leerse.

`vencido` no es un estado guardado sino una lectura de `expires_on`, así que no
hace falta una tarea programada que lo marque.

Revision ID: 0019
Revises: 0018
Create Date: 2026-07-27

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0019"
down_revision: Union[str, None] = "0018"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

KIND_VALUES = ("ofrece", "busca")
STATUS_VALUES = ("pendiente", "publicado", "rechazado")


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
    if _has_table("job_posts"):
        return

    op.create_table(
        "job_posts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("club_id", sa.Uuid(), sa.ForeignKey("clubs.id"), nullable=False),
        sa.Column("author_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("kind", _enum("jobkind", KIND_VALUES), nullable=False),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("contact", sa.String(200), nullable=False),
        sa.Column("category", sa.String(50), nullable=True),
        sa.Column(
            "status", _enum("jobstatus", STATUS_VALUES),
            nullable=False, server_default="pendiente",
        ),
        sa.Column("moderation_note", sa.String(200), nullable=True),
        sa.Column("moderated_by", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_on", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_job_posts_club_status", "job_posts", ["club_id", "status"])


def downgrade() -> None:
    if _has_table("job_posts"):
        op.drop_index("ix_job_posts_club_status", table_name="job_posts")
        op.drop_table("job_posts")
    _drop_enum("jobstatus", STATUS_VALUES)
    _drop_enum("jobkind", KIND_VALUES)
