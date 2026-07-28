"""socios: padrón, ingreso por DNI y estado de cuota

`users.email` pasa a nullable: un socio del padrón puede no tener email. Postgres
permite varios NULL bajo un UNIQUE, así que la restricción sigue valiendo para los
emails que sí existen.

El estado de cuota es un booleano espejado del sistema contable del club, con la
fecha en que se sincronizó. La app no lleva la contabilidad.

Revision ID: 0017
Revises: 0016
Create Date: 2026-07-27

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0017"
down_revision: Union[str, None] = "0016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table: str, column: str) -> bool:
    return any(c["name"] == column for c in sa.inspect(op.get_bind()).get_columns(table))


def upgrade() -> None:
    if not _has_column("users", "document_id"):
        op.add_column("users", sa.Column("document_id", sa.String(20), nullable=True))
        op.create_unique_constraint(
            "uq_user_club_document", "users", ["club_id", "document_id"]
        )

    if not _has_column("users", "must_change_password"):
        op.add_column(
            "users",
            sa.Column(
                "must_change_password",
                sa.Boolean(),
                nullable=False,
                server_default="false",
            ),
        )

    # Auditado antes de migrar: sólo dos usos de `user.email` en el código y
    # ninguno asume que exista.
    with op.batch_alter_table("users") as batch:
        batch.alter_column("email", existing_type=sa.String(255), nullable=True)

    if not _has_table("members"):
        op.create_table(
            "members",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("club_id", sa.Uuid(), sa.ForeignKey("clubs.id"), nullable=False),
            sa.Column(
                "user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False, unique=True
            ),
            sa.Column("full_name", sa.String(150), nullable=False),
            sa.Column("category", sa.String(50), nullable=True),
            sa.Column("member_number", sa.String(30), nullable=True),
            sa.Column("joined_on", sa.Date(), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
            sa.Column(
                "dues_up_to_date", sa.Boolean(), nullable=False, server_default="false"
            ),
            sa.Column(
                "dues_synced_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index("ix_members_club", "members", ["club_id"])

    if not _has_table("member_imports"):
        op.create_table(
            "member_imports",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("club_id", sa.Uuid(), sa.ForeignKey("clubs.id"), nullable=False),
            sa.Column("source", sa.String(20), nullable=False, server_default="xlsx"),
            sa.Column("created_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("updated_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("deactivated_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("total_rows", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("errors", sa.JSON(), nullable=True),
            sa.Column("run_by", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )


def downgrade() -> None:
    for table in ("member_imports", "members"):
        if _has_table(table):
            op.drop_table(table)

    # `email` vuelve a NOT NULL sólo si no quedó ningún NULL; si quedaron socios
    # sin email, forzarlo rompería la vuelta atrás.
    bind = op.get_bind()
    nulls = bind.execute(sa.text("SELECT COUNT(*) FROM users WHERE email IS NULL")).scalar()
    if not nulls:
        with op.batch_alter_table("users") as batch:
            batch.alter_column("email", existing_type=sa.String(255), nullable=False)
    else:
        print(
            f"[0017] {nulls} usuario(s) sin email: `users.email` queda nullable.",
            flush=True,
        )

    if _has_column("users", "must_change_password"):
        op.drop_column("users", "must_change_password")
    if _has_column("users", "document_id"):
        op.drop_constraint("uq_user_club_document", "users", type_="unique")
        op.drop_column("users", "document_id")
