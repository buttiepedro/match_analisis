"""player extended fields: date_of_birth, sex, email, phone, emergency_phone, obra_social

Revision ID: 0008
Revises: 0007
Create Date: 2026-06-16

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(table: str, column: str) -> bool:
    return any(
        c["name"] == column
        for c in sa.inspect(op.get_bind()).get_columns(table)
    )


def upgrade() -> None:
    cols = [
        ("date_of_birth",   sa.Column("date_of_birth",   sa.Date(),        nullable=True)),
        ("sex",             sa.Column("sex",             sa.String(1),     nullable=True)),
        ("email",           sa.Column("email",           sa.String(100),   nullable=True)),
        ("phone",           sa.Column("phone",           sa.String(30),    nullable=True)),
        ("emergency_phone", sa.Column("emergency_phone", sa.String(30),    nullable=True)),
        ("obra_social",     sa.Column("obra_social",     sa.String(100),   nullable=True)),
    ]
    for col_name, col_def in cols:
        if not _has_column("players", col_name):
            op.add_column("players", col_def)


def downgrade() -> None:
    for col_name in ["obra_social", "emergency_phone", "phone", "email", "sex", "date_of_birth"]:
        if _has_column("players", col_name):
            op.drop_column("players", col_name)
