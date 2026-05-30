import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import decode_token
from app.models import Club, User, UserRole

bearer_scheme = HTTPBearer()


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(bearer_scheme)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_token(credentials.credentials)
        user_id = uuid.UUID(payload["sub"])
    except (JWTError, KeyError, ValueError):
        raise unauthorized

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise unauthorized
    return user


async def require_superadmin(
    current_user: Annotated[User, Depends(get_current_user)],
) -> User:
    if current_user.role != UserRole.superadmin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Superadmin required")
    return current_user


async def require_club_admin(
    current_user: Annotated[User, Depends(get_current_user)],
) -> User:
    if current_user.role not in (UserRole.superadmin, UserRole.club_admin):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Club admin required")
    return current_user


async def require_timer_control(
    current_user: Annotated[User, Depends(get_current_user)],
) -> User:
    if current_user.role not in (UserRole.superadmin, UserRole.club_admin, UserRole.match_director):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Match director or higher required")
    return current_user


# ── Club access helpers (shared across routers) ────────────────────────────────

async def get_club_or_404(club_id: uuid.UUID, db: AsyncSession) -> Club:
    club = await db.scalar(select(Club).where(Club.id == club_id))
    if not club:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Club not found")
    return club


def assert_club_access(club: Club, current_user: User) -> None:
    if current_user.role != UserRole.superadmin and current_user.club_id != club.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
