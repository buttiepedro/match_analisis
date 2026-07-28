"""registro de capacidades ya vistas

Tapa un agujero que ya se llevó puestos **tres módulos**: socios, gimnasio y
bolsa de trabajo se desplegaron y no los vio nadie.

El motivo: sembrar roles es idempotente y no toca un rol existente, a propósito,
para no pisarle al club una capacidad que sacó a mano. Pero eso congela los roles
en el juego de capacidades que existía el día que se sembraron, y una capacidad
agregada después no entra en ningún rol. El código queda desplegado, el permiso
no, y el menú —que filtra por capacidad— no muestra la pantalla. Sin un solo
error en ningún log.

La línea de base es **el catálogo completo de hoy**: al aplicar esta migración,
todo lo que existe queda marcado como visto. Consecuencia buscada: esta migración
**no cambia un solo permiso de ningún rol**. El mecanismo empieza a actuar recién
con las capacidades que se agreguen de acá en adelante, que es para lo que está.

Se evaluó tomar la línea de base de la propia base —las capacidades presentes en
algún rol— para que además arreglara sola el agujero histórico. Se descartó: una
capacidad que hoy no está en **ningún** rol se vería como nueva y el arranque se
la daría a los presets, pisando una configuración que el club puede haber dejado
así a propósito. Rellenar automáticamente vale menos que no tocar lo que alguien
ya decidió; el agujero se arregla una vez, a mano, mirando la pantalla de roles.

Revision ID: 0021
Revises: 0020
Create Date: 2026-07-28

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0021"
down_revision: Union[str, None] = "0020"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "known_permissions",
        sa.Column("permission", sa.String(50), primary_key=True),
        sa.Column(
            "first_seen_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )

    # Todo el catálogo actual queda marcado como visto, así que esta migración
    # no cambia ni un permiso de ningún rol. Ver la nota de arriba.
    from app.core.permissions import ALL_PERMISSIONS

    conexion = op.get_bind()
    for permission in sorted(ALL_PERMISSIONS):
        conexion.execute(
            sa.text(
                "INSERT INTO known_permissions (permission) VALUES (:p) "
                "ON CONFLICT DO NOTHING"
            ),
            {"p": permission},
        )


def downgrade() -> None:
    op.drop_table("known_permissions")
