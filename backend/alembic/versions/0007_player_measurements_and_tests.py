"""player division history, measurements and physical tests

Revision ID: 0007
Revises: 0006
Create Date: 2026-06-16

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(name)


def _has_index(table: str, index: str) -> bool:
    return any(
        i["name"] == index
        for i in sa.inspect(op.get_bind()).get_indexes(table)
    )


def upgrade() -> None:
    # ── player_division_history ──────────────────────────────────────────────────
    if not _has_table("player_division_history"):
        op.create_table(
            "player_division_history",
            sa.Column("id", sa.UUID(), primary_key=True),
            sa.Column("player_id", sa.UUID(), sa.ForeignKey("players.id"), nullable=False),
            sa.Column("division_id", sa.UUID(), sa.ForeignKey("divisions.id"), nullable=False),
            sa.Column("from_date", sa.Date(), nullable=False),
            sa.Column("to_date", sa.Date(), nullable=True),
            sa.Column("moved_by", sa.UUID(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        )

    if not _has_index("player_division_history", "idx_pdh_player"):
        op.create_index("idx_pdh_player", "player_division_history", ["player_id"])
    if not _has_index("player_division_history", "idx_pdh_division"):
        op.create_index("idx_pdh_division", "player_division_history", ["division_id"])

    # ── player_measurements ──────────────────────────────────────────────────────
    if not _has_table("player_measurements"):
        op.create_table(
            "player_measurements",
            sa.Column("id", sa.UUID(), primary_key=True),
            sa.Column("player_id", sa.UUID(), sa.ForeignKey("players.id"), nullable=False),
            sa.Column("measured_at", sa.Date(), nullable=False),
            sa.Column("weight_kg", sa.Numeric(5, 2), nullable=True),
            sa.Column("height_cm", sa.Numeric(5, 1), nullable=True),
            sa.Column("bmi", sa.Numeric(4, 2), nullable=True),
            sa.Column("fat_fold_tricep_mm", sa.Numeric(4, 1), nullable=True),
            sa.Column("fat_fold_subscapular_mm", sa.Numeric(4, 1), nullable=True),
            sa.Column("fat_fold_suprailiac_mm", sa.Numeric(4, 1), nullable=True),
            sa.Column("fat_fold_abdominal_mm", sa.Numeric(4, 1), nullable=True),
            sa.Column("body_fat_percent", sa.Numeric(4, 1), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("recorded_by", sa.UUID(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        )

    if not _has_index("player_measurements", "idx_pm_player"):
        op.create_index("idx_pm_player", "player_measurements", ["player_id"])
    if not _has_index("player_measurements", "idx_pm_player_date"):
        op.create_index("idx_pm_player_date", "player_measurements", ["player_id", "measured_at"])

    # ── physical_tests ───────────────────────────────────────────────────────────
    if not _has_table("physical_tests"):
        op.create_table(
            "physical_tests",
            sa.Column("id", sa.UUID(), primary_key=True),
            sa.Column("player_id", sa.UUID(), sa.ForeignKey("players.id"), nullable=False),
            sa.Column("test_date", sa.Date(), nullable=False),
            sa.Column("test_type", sa.String(50), nullable=False),
            sa.Column("value", sa.Numeric(8, 3), nullable=False),
            sa.Column("unit", sa.String(20), nullable=False),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("recorded_by", sa.UUID(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        )

    if not _has_index("physical_tests", "idx_pt_player"):
        op.create_index("idx_pt_player", "physical_tests", ["player_id"])
    if not _has_index("physical_tests", "idx_pt_player_type"):
        op.create_index("idx_pt_player_type", "physical_tests", ["player_id", "test_type"])
    if not _has_index("physical_tests", "idx_pt_player_type_date"):
        op.create_index("idx_pt_player_type_date", "physical_tests", ["player_id", "test_type", "test_date"])


def downgrade() -> None:
    if _has_index("physical_tests", "idx_pt_player_type_date"):
        op.drop_index("idx_pt_player_type_date", "physical_tests")
    if _has_index("physical_tests", "idx_pt_player_type"):
        op.drop_index("idx_pt_player_type", "physical_tests")
    if _has_index("physical_tests", "idx_pt_player"):
        op.drop_index("idx_pt_player", "physical_tests")
    if _has_table("physical_tests"):
        op.drop_table("physical_tests")

    if _has_index("player_measurements", "idx_pm_player_date"):
        op.drop_index("idx_pm_player_date", "player_measurements")
    if _has_index("player_measurements", "idx_pm_player"):
        op.drop_index("idx_pm_player", "player_measurements")
    if _has_table("player_measurements"):
        op.drop_table("player_measurements")

    if _has_index("player_division_history", "idx_pdh_division"):
        op.drop_index("idx_pdh_division", "player_division_history")
    if _has_index("player_division_history", "idx_pdh_player"):
        op.drop_index("idx_pdh_player", "player_division_history")
    if _has_table("player_division_history"):
        op.drop_table("player_division_history")
