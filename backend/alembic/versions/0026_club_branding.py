"""marca del club: logo y colores

Sin tabla nueva: la marca es del club, y `clubs` ya es donde vive `slug`. Cada
instancia (ver [[add-club-subdominios-y-marca]]) lee su propia fila al
arrancar.

Revision ID: 0026
Revises: 0025
Create Date: 2026-08-02

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0026"
down_revision: Union[str, None] = "0025"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("clubs", sa.Column("logo_url", sa.String(300), nullable=True))
    op.add_column("clubs", sa.Column("primary_color", sa.String(7), nullable=True))
    op.add_column("clubs", sa.Column("secondary_color", sa.String(7), nullable=True))


def downgrade() -> None:
    op.drop_column("clubs", "secondary_color")
    op.drop_column("clubs", "primary_color")
    op.drop_column("clubs", "logo_url")
