from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from app.api.v1.auth import router as auth_router
from app.api.v1.clubs import router as clubs_router
from app.api.v1.divisions import router as divisions_router
from app.api.v1.health import router as health_router
from app.api.v1.lineup import router as lineup_router
from app.api.v1.players import router as players_router
from app.api.v1.sessions import session_router, sessions_router, ws_router
from app.api.v1.tournaments import router as tournaments_router
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.core.security import get_password_hash
from app.models import User, UserRole


async def seed_superadmin() -> None:
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(User).where(User.email == settings.SUPERADMIN_EMAIL))
        if result.scalar_one_or_none() is None:
            admin = User(
                email=settings.SUPERADMIN_EMAIL,
                password_hash=get_password_hash(settings.SUPERADMIN_PASSWORD),
                full_name="Super Admin",
                role=UserRole.superadmin,
            )
            session.add(admin)
            await session.commit()
            print(f"[seed] Superadmin created: {settings.SUPERADMIN_EMAIL}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await seed_superadmin()
    yield


app = FastAPI(title="match_analisis API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router, tags=["health"])
app.include_router(auth_router, tags=["auth"])
app.include_router(clubs_router, tags=["clubs"])
app.include_router(divisions_router, tags=["divisions"])
app.include_router(tournaments_router, tags=["tournaments"])
app.include_router(sessions_router, tags=["sessions"])
app.include_router(session_router, tags=["sessions"])
app.include_router(ws_router, tags=["websocket"])
app.include_router(players_router, tags=["players"])
app.include_router(lineup_router, tags=["lineup"])
