"""
Infraestructura de tests.

Se corre contra SQLite en archivo temporal en vez de Postgres: las migraciones
de Alembic no participan (el schema sale de `Base.metadata`), así que los tests
verifican el comportamiento de la API, no el de las migraciones.
"""
import os
import uuid
from pathlib import Path

# Las settings se leen al importar la app: el entorno tiene que estar armado antes.
TEST_DB = Path(__file__).parent / "test.db"
os.environ.setdefault("DATABASE_URL", f"sqlite+aiosqlite:///{TEST_DB}")
os.environ.setdefault("SECRET_KEY", "test-secret-key-not-for-production")
os.environ.setdefault("SUPERADMIN_EMAIL", "root@example.com")
os.environ.setdefault("SUPERADMIN_PASSWORD", "rootpass123")
os.environ.setdefault("CORS_ORIGINS", "http://localhost:3000")

import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402

from app.core.database import AsyncSessionLocal, engine  # noqa: E402
from app.core.roles import assign_preset_for_legacy_role, seed_club_roles  # noqa: E402
from app.core.security import get_password_hash  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Base, Club, Division, Tournament, User, UserRole  # noqa: E402


@pytest_asyncio.fixture(autouse=True)
async def _fresh_schema():
    """Cada test arranca con una base vacía: sin orden implícito entre tests."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest_asyncio.fixture
async def db():
    async with AsyncSessionLocal() as session:
        yield session


# ── Factories ─────────────────────────────────────────────────────────────────

PASSWORD = "secret123"


async def make_user(
    session,
    *,
    email: str,
    role: UserRole,
    club_id: uuid.UUID | None = None,
    password: str = PASSWORD,
) -> User:
    user = User(
        id=uuid.uuid4(),
        email=email,
        password_hash=get_password_hash(password),
        full_name=email.split("@")[0],
        role=role,
        club_id=club_id,
    )
    session.add(user)
    await session.flush()
    # Mismo camino que usa la app al crear un usuario: si la factory no sembrara
    # el rol, los tests correrían contra un modelo de permisos que en producción
    # no existe.
    await assign_preset_for_legacy_role(user, session)
    await session.commit()
    return user


async def make_club(session, name: str = "Club Test", slug: str = "club-test") -> Club:
    club = Club(id=uuid.uuid4(), name=name, slug=slug)
    session.add(club)
    await session.flush()
    await seed_club_roles(club.id, session)
    await session.commit()
    return club


async def make_division(session, club_id: uuid.UUID, name: str = "Primera") -> Division:
    division = Division(id=uuid.uuid4(), club_id=club_id, name=name)
    session.add(division)
    await session.commit()
    return division


async def make_tournament(
    session, club_id: uuid.UUID, division_id: uuid.UUID, name: str = "Torneo Test"
) -> Tournament:
    tournament = Tournament(
        id=uuid.uuid4(), club_id=club_id, division_id=division_id, name=name, season="2026"
    )
    session.add(tournament)
    await session.commit()
    return tournament


async def login(client: AsyncClient, email: str, password: str = PASSWORD) -> dict:
    res = await client.post("/auth/login", json={"email": email, "password": password})
    assert res.status_code == 200, res.text
    return res.json()


def auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def club_admin_ctx(db, client):
    """Club + admin logueado. El caso base de casi todos los tests."""
    club = await make_club(db)
    admin = await make_user(db, email="admin@example.com", role=UserRole.club_admin, club_id=club.id)
    tokens = await login(client, admin.email)
    return {
        "club": club,
        "user": admin,
        "token": tokens["access_token"],
        "refresh_token": tokens["refresh_token"],
        "headers": auth_header(tokens["access_token"]),
    }


@pytest.fixture(scope="session", autouse=True)
def _cleanup_db_file():
    yield
    if TEST_DB.exists():
        TEST_DB.unlink()
