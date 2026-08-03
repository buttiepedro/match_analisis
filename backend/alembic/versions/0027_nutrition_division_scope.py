"""nutrición: alcance por división

Antes cualquier usuario con nutricion.turnos_publicar armaba la agenda del
club entero, sin distinción de división. Un club con una nutricionista por
división necesita que cada quien publique sólo la suya — reusa el mismo
esquema de alcance (`user_divisions`) que ya scopea entrenamientos y plantel
para Entrenador/Analista, así que acá sólo hace falta que el turno sepa a
qué división pertenece.

Nullable a propósito: los turnos ya publicados no tienen forma confiable de
inferir su división retroactivamente, y forzar un valor inventado sería peor
que dejarlos sin dato — quedan visibles sólo para quien ve el club entero.

Revision ID: 0027
Revises: 0026
Create Date: 2026-08-02

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0027"
down_revision: Union[str, None] = "0026"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(table: str, column: str) -> bool:
    return column in [c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)]


def upgrade() -> None:
    if not _has_column("nutrition_slots", "division_id"):
        op.add_column(
            "nutrition_slots",
            sa.Column("division_id", sa.Uuid(), sa.ForeignKey("divisions.id"), nullable=True),
        )
        op.create_index(
            "ix_nutrition_slots_division_starts", "nutrition_slots", ["division_id", "starts_at"]
        )


def downgrade() -> None:
    if _has_column("nutrition_slots", "division_id"):
        op.drop_index("ix_nutrition_slots_division_starts", table_name="nutrition_slots")
        op.drop_column("nutrition_slots", "division_id")
