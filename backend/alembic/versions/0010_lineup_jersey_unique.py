"""match_lineup: número de camiseta único por sesión y equipo

Los eventos se asocian al jugador por `player_number`. Dos jugadores del mismo
equipo con la misma camiseta hacen que las estadísticas se atribuyan mal, y sin
constraint eso pasaba en silencio.

Antes de crear el índice se renumeran los duplicados que ya existan en la base,
dejando log de lo que se cambió: fallar la migración dejaría al club sin poder
arrancar la app.

Revision ID: 0010
Revises: 0009
Create Date: 2026-07-26

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CONSTRAINT_NAME = "uq_lineup_session_team_jersey"


def _has_constraint(table: str, name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    existing = {c["name"] for c in inspector.get_unique_constraints(table)}
    existing |= {i["name"] for i in inspector.get_indexes(table)}
    return name in existing


def _renumber_duplicates() -> None:
    """Deja un único jugador por (sesión, equipo, camiseta); al resto le asigna
    el primer número libre >= 100 para no pisar suplentes (16-23)."""
    bind = op.get_bind()
    duplicates = bind.execute(
        sa.text(
            """
            SELECT session_id, team, jersey_number, COUNT(*) AS n
            FROM match_lineup
            GROUP BY session_id, team, jersey_number
            HAVING COUNT(*) > 1
            """
        )
    ).fetchall()

    if not duplicates:
        return

    for session_id, team, jersey_number, _ in duplicates:
        rows = bind.execute(
            sa.text(
                """
                SELECT id FROM match_lineup
                WHERE session_id = :sid AND team = :team AND jersey_number = :jersey
                ORDER BY created_at
                """
            ),
            {"sid": session_id, "team": team, "jersey": jersey_number},
        ).fetchall()

        # El primero (más antiguo) conserva el número; los demás se corren.
        for offset, (entry_id,) in enumerate(rows[1:], start=0):
            taken = {
                r[0]
                for r in bind.execute(
                    sa.text(
                        "SELECT jersey_number FROM match_lineup "
                        "WHERE session_id = :sid AND team = :team"
                    ),
                    {"sid": session_id, "team": team},
                ).fetchall()
            }
            new_number = 100
            while new_number in taken:
                new_number += 1

            bind.execute(
                sa.text("UPDATE match_lineup SET jersey_number = :new WHERE id = :id"),
                {"new": new_number, "id": entry_id},
            )
            print(
                f"[0010] Camiseta duplicada renumerada: sesión {session_id} equipo {team} "
                f"#{jersey_number} -> #{new_number} (entry {entry_id})",
                flush=True,
            )


def upgrade() -> None:
    if _has_constraint("match_lineup", CONSTRAINT_NAME):
        return

    _renumber_duplicates()

    with op.batch_alter_table("match_lineup") as batch_op:
        batch_op.create_unique_constraint(
            CONSTRAINT_NAME, ["session_id", "team", "jersey_number"]
        )


def downgrade() -> None:
    if not _has_constraint("match_lineup", CONSTRAINT_NAME):
        return
    with op.batch_alter_table("match_lineup") as batch_op:
        batch_op.drop_constraint(CONSTRAINT_NAME, type_="unique")
