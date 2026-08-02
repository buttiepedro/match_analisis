"""notificaciones — bandeja, dispositivos de push y preferencias

Infraestructura genérica: `channel` es un enum abierto (`web_push` hoy,
`fcm`/`apns` cuando exista la app nativa) para que sumar un canal sea agregar
una fila y un sender, no un sistema aparte. El primer disparador es la
formación cargada.

`notification_preferences` no lleva fila por defecto: sin fila = habilitado,
opt-in por defecto igual que el resto de la app.

Revision ID: 0024
Revises: 0023
Create Date: 2026-08-01

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0024"
down_revision: Union[str, None] = "0023"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CHANNEL_VALUES = ("web_push", "fcm", "apns")


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def _enum(name: str, values: tuple[str, ...]) -> sa.types.TypeEngine:
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
    if not _has_table("notification_devices"):
        op.create_table(
            "notification_devices",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column(
                "channel", _enum("notificationchannel", CHANNEL_VALUES),
                nullable=False, server_default="web_push",
            ),
            sa.Column("endpoint", sa.Text(), nullable=False),
            sa.Column("p256dh", sa.String(255), nullable=True),
            sa.Column("auth_secret", sa.String(255), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
            sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        # `endpoint` es TEXT (puede ser largo): un UNIQUE sin acotar falla en
        # MySQL, pero en Postgres —el único motor real de este proyecto— es
        # válido tal cual.
        op.create_unique_constraint(
            "uq_notification_device_user_endpoint",
            "notification_devices",
            ["user_id", "endpoint"],
        )
        op.create_index("ix_notification_devices_user", "notification_devices", ["user_id"])

    if not _has_table("notifications"):
        op.create_table(
            "notifications",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("club_id", sa.Uuid(), sa.ForeignKey("clubs.id"), nullable=False),
            sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("type", sa.String(50), nullable=False),
            sa.Column("title", sa.String(150), nullable=False),
            sa.Column("body", sa.String(300), nullable=False),
            sa.Column("data", sa.JSON(), nullable=False, server_default="{}"),
            sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index("ix_notifications_user_created", "notifications", ["user_id", "created_at"])

    if not _has_table("notification_preferences"):
        op.create_table(
            "notification_preferences",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("type", sa.String(50), nullable=False),
            sa.Column("enabled", sa.Boolean(), nullable=False, server_default="true"),
        )
        op.create_unique_constraint(
            "uq_notification_preference_user_type",
            "notification_preferences",
            ["user_id", "type"],
        )


def downgrade() -> None:
    if _has_table("notification_preferences"):
        op.drop_table("notification_preferences")
    if _has_table("notifications"):
        op.drop_index("ix_notifications_user_created", table_name="notifications")
        op.drop_table("notifications")
    if _has_table("notification_devices"):
        op.drop_index("ix_notification_devices_user", table_name="notification_devices")
        op.drop_table("notification_devices")
    _drop_enum("notificationchannel", CHANNEL_VALUES)
