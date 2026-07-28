import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.permissions import ALL_PERMISSIONS, Permission
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


# ── Capacidades ────────────────────────────────────────────────────────────────

def user_permissions(user: User) -> set[str]:
    """
    Capacidades efectivas: la **unión** de las de todos sus roles.

    Un usuario con Entrenador y Tesorero puede lo de los dos. Es justamente lo que
    el enum de un solo rol no podía expresar.
    """
    if user.role == UserRole.superadmin:
        return set(ALL_PERMISSIONS)
    return {p for role in user.roles for p in role.permission_values}


def has_permission(user: User, *permissions: Permission) -> bool:
    """True si tiene **alguna** de las capacidades pedidas."""
    if user.role == UserRole.superadmin:
        return True
    granted = user_permissions(user)
    return any(p.value in granted for p in permissions)


def require(*permissions: Permission):
    """
    Dependencia de FastAPI que exige **alguna** de las capacidades.

        current_user: Annotated[User, Depends(require(Permission.asistencia_cargar))]

    Varias capacidades significan "o", no "y": un endpoint que sirve a dos roles
    distintos por motivos distintos es lo normal; uno que exige dos capacidades a
    la vez casi siempre son dos endpoints.
    """

    async def dependency(
        current_user: Annotated[User, Depends(get_current_user)],
    ) -> User:
        if not has_permission(current_user, *permissions):
            faltantes = ", ".join(p.value for p in permissions)
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Te falta permiso: {faltantes}",
            )
        return current_user

    return dependency


# Las dos dependencias de abajo son de la etapa anterior y ahora resuelven por
# capacidad. Se conservan mientras queden call sites sin migrar; cuando no queden,
# se borran.

async def require_club_admin(
    current_user: Annotated[User, Depends(get_current_user)],
) -> User:
    """Equivalente al viejo `club_admin`: quien administra la configuración del club."""
    if not has_permission(current_user, Permission.club_divisiones):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Club admin required")
    return current_user


async def require_timer_control(
    current_user: Annotated[User, Depends(get_current_user)],
) -> User:
    if not has_permission(current_user, Permission.partido_timer):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Match director or higher required"
        )
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
