import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import decode_token
from app.models import Club, Division, Player, User, UserRole

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


# ── Alcance por división ───────────────────────────────────────────────────────

def scoped_division_ids(current_user: User) -> set[uuid.UUID] | None:
    """
    Divisiones a las que el usuario está limitado, o `None` si no está limitado.

    `None` es "sin restricción", que **no** es lo mismo que un conjunto vacío. Un
    usuario sin alcance asignado ve todo el club: así asignar alcance es opcional y
    ningún usuario existente pierde acceso al migrar.
    """
    if current_user.role in (UserRole.superadmin, UserRole.club_admin):
        return None
    ids = {d.id for d in current_user.divisions}
    return ids or None


def assert_division_access(division: "Division", current_user: User) -> None:
    """
    Valida club **y** división.

    Validar sólo el club dejaba que el entrenador de M17 tocara los entrenamientos
    y la asistencia de Primera.
    """
    if current_user.role == UserRole.superadmin:
        return
    if current_user.club_id != division.club_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    scope = scoped_division_ids(current_user)
    if scope is not None and division.id not in scope:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tenés acceso a esta división",
        )


async def get_division_or_404(
    division_id: uuid.UUID, db: AsyncSession, current_user: User
) -> "Division":
    """Busca la división y valida club + alcance. El helper que usan los routers."""
    division = await db.scalar(select(Division).where(Division.id == division_id))
    if not division:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="División no encontrada")
    assert_division_access(division, current_user)
    return division


async def visible_division_ids(club_id: uuid.UUID, db: AsyncSession, current_user: User) -> list[uuid.UUID]:
    """Divisiones activas del club que este usuario puede ver, ya filtradas."""
    result = await db.execute(
        select(Division.id).where(Division.club_id == club_id, Division.is_active.is_(True))
    )
    all_ids = list(result.scalars().all())

    scope = scoped_division_ids(current_user)
    if scope is None:
        return all_ids
    return [d for d in all_ids if d in scope]


async def require_player_self(
    player_id: uuid.UUID, db: AsyncSession, current_user: User
) -> None:
    """
    Un `player` sólo llega a su propia ficha.

    Se valida acá y no en cada endpoint para que agregar una ruta nueva de jugador
    no abra por olvido la ficha de todo el plantel.
    """
    if current_user.role != UserRole.player:
        return
    own = await db.scalar(select(Player.id).where(Player.user_id == current_user.id))
    if own != player_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
