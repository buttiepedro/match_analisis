"""lugar de entrenamiento

El jugador que ve el fixture del club no sabe a dónde ir si el entrenamiento no
dice dónde es. Texto libre porque el club nombra sus lugares como quiere, y
nullable porque una migración no puede completar el historial de entrenamientos
que ya existen.

Revision ID: 0023
Revises: 0022
Create Date: 2026-07-30

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0023"
down_revision: Union[str, None] = "0022"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("trainings", sa.Column("location", sa.String(150), nullable=True))


def downgrade() -> None:
    op.drop_column("trainings", "location")
