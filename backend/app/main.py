from contextlib import asynccontextmanager

import boto3
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from app.api.v1.auth import router as auth_router
from app.api.v1.clubs import router as clubs_router
from app.api.v1.competition import router as competition_router
from app.api.v1.dashboard import router as dashboard_router
from app.api.v1.divisions import router as divisions_router
from app.api.v1.gym import router as gym_router
from app.api.v1.health import router as health_router
from app.api.v1.import_ import router as import_router
from app.api.v1.injuries import router as injuries_router
from app.api.v1.job_board import router as job_board_router
from app.api.v1.lineup import router as lineup_router
from app.api.v1.members import router as members_router
from app.api.v1.performance import router as performance_router
from app.api.v1.players import router as players_router
from app.api.v1.roles import router as roles_router
from app.api.v1.season import router as season_router
from app.api.v1.sessions import session_router, sessions_router, ws_router
from app.api.v1.tournaments import router as tournaments_router
from app.api.v1.trainings import router as trainings_router
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.core.security import get_password_hash
from app.models import User, UserRole


def _configure_s3_cors() -> None:
    if not (settings.AWS_S3_BUCKET and settings.AWS_ACCESS_KEY_ID):
        return
    try:
        s3 = boto3.client(
            "s3",
            region_name=settings.AWS_REGION,
            aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
            aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
        )
        s3.put_bucket_cors(
            Bucket=settings.AWS_S3_BUCKET,
            CORSConfiguration={
                "CORSRules": [{
                    "AllowedHeaders": ["*"],
                    "AllowedMethods": ["GET", "HEAD"],
                    "AllowedOrigins": ["*"],
                    "MaxAgeSeconds": 86400,
                }]
            },
        )
        print("[s3] CORS policy configured.", flush=True)
    except Exception as e:
        print(f"[s3] Could not configure CORS (non-fatal): {e}", flush=True)


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
    _configure_s3_cors()
    await seed_superadmin()
    yield


app = FastAPI(title="match_analisis API", version="0.1.0", lifespan=lifespan)

_cors_origins = settings.cors_origins
if _cors_origins == ["*"]:
    print(
        "[cors] ADVERTENCIA: CORS_ORIGINS no está definido — se acepta cualquier origen. "
        "Definí CORS_ORIGINS con la URL del frontend en producción.",
        flush=True,
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    # La API se autentica con Bearer token, no con cookies: habilitar
    # credentials junto a un origen comodín es además una combinación que la
    # spec de CORS prohíbe y que los browsers rechazan.
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router, tags=["health"])
app.include_router(auth_router, tags=["auth"])
app.include_router(import_router, tags=["import"])
app.include_router(clubs_router, tags=["clubs"])
app.include_router(divisions_router, tags=["divisions"])
app.include_router(tournaments_router, tags=["tournaments"])
app.include_router(sessions_router, tags=["sessions"])
app.include_router(session_router, tags=["sessions"])
app.include_router(ws_router, tags=["websocket"])
app.include_router(players_router, tags=["players"])
app.include_router(lineup_router, tags=["lineup"])
app.include_router(performance_router, tags=["performance"])
app.include_router(trainings_router, tags=["trainings"])
app.include_router(injuries_router, tags=["injuries"])
app.include_router(season_router, tags=["season"])
app.include_router(dashboard_router, tags=["dashboard"])
app.include_router(competition_router, tags=["competition"])
app.include_router(roles_router, tags=["roles"])
app.include_router(members_router, tags=["members"])
app.include_router(gym_router, tags=["gym"])
app.include_router(job_board_router, tags=["job-board"])
