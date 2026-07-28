"""permisos por capacidades

Reemplaza el enum `UserRole` por roles con capacidades, muchos por usuario.

**No agrega ni saca ningún permiso.** Cada usuario existente recibe el rol preset
equivalente a lo que su rol viejo ya podía, así que el día del deploy puede
exactamente lo mismo que el día anterior.

`users.role` **se conserva**: sacar la columna en la misma migración que introduce
el sistema nuevo eliminaría la posibilidad de volver atrás sin restaurar un backup.

Revision ID: 0016
Revises: 0015
Create Date: 2026-07-27

"""
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0016"
down_revision: Union[str, None] = "0015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def _seed(bind) -> None:
    """
    Siembra los presets en cada club y le asigna a cada usuario el equivalente a
    su rol viejo.

    Se importa el catálogo desde el código para que la migración y la aplicación
    no puedan discrepar: si mañana se agrega una capacidad al preset
    Administrador, un club sembrado hoy y otro sembrado mañana difieren, y eso es
    correcto — lo que no puede pasar es que la migración invente un set propio.
    """
    from app.core.permissions import LEGACY_ROLE_TO_PRESET, PRESET_PERMISSIONS

    clubs = bind.execute(sa.text("SELECT id FROM clubs")).fetchall()
    if not clubs:
        return

    for (club_id,) in clubs:
        role_ids: dict[str, str] = {}

        for name, permissions in PRESET_PERMISSIONS.items():
            role_id = str(uuid.uuid4())
            role_ids[name] = role_id
            bind.execute(
                sa.text(
                    "INSERT INTO roles (id, club_id, name, is_preset) "
                    "VALUES (:id, :club, :name, true)"
                ),
                {"id": role_id, "club": club_id, "name": name},
            )
            for permission in sorted(permissions):
                bind.execute(
                    sa.text(
                        "INSERT INTO role_permissions (role_id, permission) "
                        "VALUES (:role, :perm)"
                    ),
                    {"role": role_id, "perm": permission},
                )

        # Cada usuario del club recibe el preset que equivale a su rol viejo.
        users = bind.execute(
            sa.text("SELECT id, role FROM users WHERE club_id = :club"),
            {"club": club_id},
        ).fetchall()

        for user_id, legacy_role in users:
            value = legacy_role.value if hasattr(legacy_role, "value") else str(legacy_role)
            preset = LEGACY_ROLE_TO_PRESET.get(value)
            if not preset:
                # superadmin no es rol de club: no se le asigna ninguno.
                continue
            bind.execute(
                sa.text(
                    "INSERT INTO user_roles (user_id, role_id) VALUES (:user, :role)"
                ),
                {"user": user_id, "role": role_ids[preset]},
            )

        print(
            f"[0016] Club {club_id}: {len(PRESET_PERMISSIONS)} roles preset, "
            f"{len(users)} usuario(s) migrados",
            flush=True,
        )


def upgrade() -> None:
    bind = op.get_bind()

    if _has_table("roles"):
        return

    op.create_table(
        "roles",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("club_id", sa.Uuid(), sa.ForeignKey("clubs.id"), nullable=False),
        sa.Column("name", sa.String(50), nullable=False),
        sa.Column("is_preset", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("club_id", "name", name="uq_role_club_name"),
    )
    op.create_table(
        "role_permissions",
        sa.Column(
            "role_id",
            sa.Uuid(),
            sa.ForeignKey("roles.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("permission", sa.String(50), primary_key=True),
    )
    op.create_table(
        "user_roles",
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "role_id",
            sa.Uuid(),
            sa.ForeignKey("roles.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )

    _seed(bind)


def downgrade() -> None:
    # `users.role` nunca se tocó, así que volver atrás es sacar las tablas nuevas.
    for table in ("user_roles", "role_permissions", "roles"):
        if _has_table(table):
            op.drop_table(table)
