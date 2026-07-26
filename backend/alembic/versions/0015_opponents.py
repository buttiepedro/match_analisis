"""rival como entidad

`away_team` es un string libre, así que comparar dos fechas contra el mismo club
era imposible. Se agrega `opponents` y se hace backfill de lo ya cargado.

`home_team` / `away_team` **se conservan**: son el registro de cómo se llamó ese
partido y hay estadísticas que dependen de ellos.

Revision ID: 0015
Revises: 0014
Create Date: 2026-07-26

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0015"
down_revision: Union[str, None] = "0014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table: str, column: str) -> bool:
    return any(c["name"] == column for c in sa.inspect(op.get_bind()).get_columns(table))


def _backfill() -> None:
    """
    Un rival por (club, nombre) a partir de los `away_team` ya cargados.

    Se normaliza por nombre exacto dentro del club: unir por similitud uniría
    clubes homónimos de uniones distintas, que es peor que dejar dos filas para
    que alguien las unifique a mano.
    """
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            """
            SELECT DISTINCT t.club_id, TRIM(s.away_team) AS name
            FROM sessions s
            JOIN tournaments t ON t.id = s.tournament_id
            WHERE s.away_team IS NOT NULL AND TRIM(s.away_team) <> ''
            """
        )
    ).fetchall()

    for club_id, name in rows:
        existing = bind.execute(
            sa.text("SELECT id FROM opponents WHERE club_id = :club AND name = :name"),
            {"club": club_id, "name": name},
        ).fetchone()
        if existing:
            opponent_id = existing[0]
        else:
            opponent_id = __import__("uuid").uuid4()
            bind.execute(
                sa.text(
                    "INSERT INTO opponents (id, club_id, name) VALUES (:id, :club, :name)"
                ),
                {"id": str(opponent_id), "club": club_id, "name": name},
            )

        bind.execute(
            sa.text(
                """
                UPDATE sessions SET opponent_id = :oid
                WHERE TRIM(away_team) = :name
                  AND tournament_id IN (SELECT id FROM tournaments WHERE club_id = :club)
                """
            ),
            {"oid": str(opponent_id), "name": name, "club": club_id},
        )

    if rows:
        print(f"[0015] {len(rows)} rival(es) normalizados desde away_team", flush=True)


def upgrade() -> None:
    if not _has_table("opponents"):
        op.create_table(
            "opponents",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("club_id", sa.Uuid(), sa.ForeignKey("clubs.id"), nullable=False),
            sa.Column("name", sa.String(100), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.UniqueConstraint("club_id", "name", name="uq_opponent_club_name"),
        )

    if not _has_column("sessions", "opponent_id"):
        op.add_column("sessions", sa.Column("opponent_id", sa.Uuid(), nullable=True))
        op.create_foreign_key(
            "fk_sessions_opponent", "sessions", "opponents", ["opponent_id"], ["id"]
        )
        _backfill()


def downgrade() -> None:
    if _has_column("sessions", "opponent_id"):
        op.drop_constraint("fk_sessions_opponent", "sessions", type_="foreignkey")
        op.drop_column("sessions", "opponent_id")
    if _has_table("opponents"):
        op.drop_table("opponents")
