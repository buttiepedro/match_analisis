"""entrenamientos y asistencia

La capa que faltaba entre partido y partido. `attendance` lleva un único registro
por (entrenamiento, jugador) para que la cola offline pueda reenviar la planilla
sin duplicar nada.

Revision ID: 0011
Revises: 0010
Create Date: 2026-07-26

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0011"
down_revision: Union[str, None] = "0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TRAINING_TYPE_VALUES = ("entrenamiento", "gimnasio", "fisico", "amistoso", "otro")
ATTENDANCE_STATUS_VALUES = ("presente", "ausente", "justificado", "lesionado", "tarde")


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def _enum(name: str, values: tuple[str, ...]) -> sa.types.TypeEngine:
    """
    Enum listo para usar dentro de `create_table`.

    En Postgres el tipo se crea aparte (con `checkfirst`, para tolerar un intento
    anterior a medio camino) y la columna lo referencia con `create_type=False`:
    si no, `create_table` emite un segundo `CREATE TYPE` y la migración explota.
    En el resto de los motores `sa.Enum` es un VARCHAR con CHECK y no hay tipo que
    crear.
    """
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
    if not _has_table("trainings"):
        op.create_table(
            "trainings",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("club_id", sa.Uuid(), sa.ForeignKey("clubs.id"), nullable=False),
            sa.Column("division_id", sa.Uuid(), sa.ForeignKey("divisions.id"), nullable=False),
            sa.Column("date", sa.Date(), nullable=False),
            sa.Column(
                "type",
                _enum("trainingtype", TRAINING_TYPE_VALUES),
                nullable=False,
                server_default="entrenamiento",
            ),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column(
                "created_at", sa.DateTime(timezone=True), server_default=sa.func.now()
            ),
        )
        op.create_index("ix_trainings_division_date", "trainings", ["division_id", "date"])

    if not _has_table("attendance"):
        op.create_table(
            "attendance",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column(
                "training_id",
                sa.Uuid(),
                sa.ForeignKey("trainings.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("player_id", sa.Uuid(), sa.ForeignKey("players.id"), nullable=False),
            sa.Column(
                "status",
                _enum("attendancestatus", ATTENDANCE_STATUS_VALUES),
                nullable=False,
                server_default="presente",
            ),
            sa.Column("notes", sa.String(200), nullable=True),
            sa.Column("recorded_by", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column(
                "recorded_at", sa.DateTime(timezone=True), server_default=sa.func.now()
            ),
            sa.UniqueConstraint(
                "training_id", "player_id", name="uq_attendance_training_player"
            ),
        )
        op.create_index("ix_attendance_player", "attendance", ["player_id"])


def downgrade() -> None:
    if _has_table("attendance"):
        op.drop_index("ix_attendance_player", table_name="attendance")
        op.drop_table("attendance")
        _drop_enum("attendancestatus", ATTENDANCE_STATUS_VALUES)

    if _has_table("trainings"):
        op.drop_index("ix_trainings_division_date", table_name="trainings")
        op.drop_table("trainings")
        _drop_enum("trainingtype", TRAINING_TYPE_VALUES)
