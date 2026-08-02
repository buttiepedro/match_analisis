import os
import sys
from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool
from alembic import context

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app.core.config import settings
from app.models import Base  # noqa: F401 — imports all models for autogenerate


def _sync_url(url: str) -> str:
    """Convert asyncpg URL to psycopg2 for Alembic (sync migrations only)."""
    return (
        url.replace("postgresql+asyncpg://", "postgresql+psycopg2://")
           .replace("postgresql://", "postgresql+psycopg2://")
           .replace("postgres://", "postgresql+psycopg2://")
    )


config = context.config
# DATABASE_URL_DIRECT (sin pooler) si está configurada — Neon en modo
# transacción no sostiene lo que Alembic necesita (locks de advisory, SET de
# sesión). Sin configurar, se usa DATABASE_URL: es lo que ya pasa hoy contra
# una base propia sin pooler de por medio. Ver [[add-club-subdominios-y-marca]].
config.set_main_option(
    "sqlalchemy.url", _sync_url(settings.DATABASE_URL_DIRECT or settings.DATABASE_URL)
)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
        connect_args={"connect_timeout": 10},
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
