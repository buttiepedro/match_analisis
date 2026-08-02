from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from app.core.config import settings


def _async_url(url: str) -> str:
    """Ensure the URL always uses the asyncpg driver."""
    for prefix in ("postgresql://", "postgres://"):
        if url.startswith(prefix):
            return "postgresql+asyncpg://" + url[len(prefix):]
    return url


#: SQLite (tests, dev sin Postgres) no acepta `pool_size`/`max_overflow` — usa
#: su propio pool por archivo, y NullPool rompe la base en memoria entre
#: conexiones.
_pool_kwargs = (
    {}
    if _async_url(settings.DATABASE_URL).startswith("sqlite")
    else {"pool_size": settings.DB_POOL_SIZE, "max_overflow": settings.DB_MAX_OVERFLOW}
)

engine = create_async_engine(_async_url(settings.DATABASE_URL), echo=False, **_pool_kwargs)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session
