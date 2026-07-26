"""measurement: pliegue bicipital + método de estimación de grasa

Durnin-Womersley usa bíceps, tríceps, subescapular y suprailíaco. La app venía
midiendo abdominal en lugar de bíceps, así que se agrega el pliegue faltante
(opcional) y una columna que registra con qué juego de pliegues, sexo y banda
etaria se calculó cada medición.

Revision ID: 0009
Revises: 0008
Create Date: 2026-07-25

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(table: str, column: str) -> bool:
    return any(
        c["name"] == column
        for c in sa.inspect(op.get_bind()).get_columns(table)
    )


def upgrade() -> None:
    cols = [
        ("fat_fold_biceps_mm", sa.Column("fat_fold_biceps_mm", sa.Numeric(4, 1), nullable=True)),
        ("body_fat_method",    sa.Column("body_fat_method",    sa.String(30),    nullable=True)),
    ]
    for col_name, col_def in cols:
        if not _has_column("player_measurements", col_name):
            op.add_column("player_measurements", col_def)


def downgrade() -> None:
    for col_name in ["body_fat_method", "fat_fold_biceps_mm"]:
        if _has_column("player_measurements", col_name):
            op.drop_column("player_measurements", col_name)
