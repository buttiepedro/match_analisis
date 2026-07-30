"""portada y adjuntos en los avisos de la bolsa

Un aviso con imagen y archivos se lee como una publicación; sin nada, como un
renglón de una lista. Es lo que separa un tablón de un portal.

La clave en S3 es aleatoria y el nombre original del archivo se guarda **sólo
para mostrarlo**: el nombre que eligió quien subió el archivo no decide dónde
queda guardado ni cómo se sirve.

Todo es nullable y arranca vacío: ningún aviso existente cambia.

Revision ID: 0022
Revises: 0021
Create Date: 2026-07-29

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0022"
down_revision: Union[str, None] = "0021"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("job_posts", sa.Column("cover_image_url", sa.String(500), nullable=True))

    op.create_table(
        "job_attachments",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "post_id",
            sa.Uuid(),
            sa.ForeignKey("job_posts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("url", sa.String(500), nullable=False),
        sa.Column("filename", sa.String(200), nullable=False),
        sa.Column("content_type", sa.String(100), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    # Los adjuntos se leen siempre por aviso, nunca sueltos.
    op.create_index("ix_job_attachments_post_id", "job_attachments", ["post_id"])


def downgrade() -> None:
    # Los archivos quedan en S3. Borrarlos desde una migración sería irreversible
    # de verdad: si el downgrade fue un error, el aviso se recupera pero la imagen
    # no vuelve de ningún lado.
    op.drop_index("ix_job_attachments_post_id", table_name="job_attachments")
    op.drop_table("job_attachments")
    op.drop_column("job_posts", "cover_image_url")
