import re
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.permissions import Permission
from app.core.deps import assert_club_access, get_club_or_404, get_current_user, require, require_superadmin
from app.core.roles import assign_preset_for_legacy_role, seed_club_roles
from app.core.security import get_password_hash
from app.models import Club, Division, Player, User, UserRole, user_divisions
from app.schemas.club import ClubBrandingUpdate, ClubCreate, ClubResponse
from app.schemas.player import PlayerWithDivisionResponse
from app.schemas.user import UserCreate, UserDivisionsUpdate, UserResponse, UserUpdate

router = APIRouter(prefix="/clubs")

#: `slug` no es sólo desambiguador de login: en
#: [[add-club-subdominios-y-marca]] pasa a ser nombre de host y de stack de
#: Docker. Ningún club puede pisar estos.
RESERVED_SLUGS = frozenset({"www", "api", "app", "admin", "mail", "ftp"})
_SLUG_FORMAT = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")


def _slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def _validate_slug(slug: str) -> None:
    """Minúsculas, dígitos y guiones; sin empezar/terminar en guión; sin reservados."""
    if not slug or not _SLUG_FORMAT.match(slug):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="El nombre del club no genera un slug válido (minúsculas, dígitos y guiones)",
        )
    if slug in RESERVED_SLUGS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"'{slug}' es un slug reservado de la plataforma",
        )


# ── Clubs ──────────────────────────────────────────────────────────────────────

@router.post("", response_model=ClubResponse, status_code=status.HTTP_201_CREATED)
async def create_club(
    body: ClubCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_superadmin)],
):
    slug = _slugify(body.name)
    _validate_slug(slug)

    existing = await db.scalar(select(Club).where(Club.slug == slug))
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Slug '{slug}' already in use")

    email_taken = await db.scalar(select(User).where(User.email == body.admin_email))
    if email_taken:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Admin email already in use")

    club = Club(id=uuid.uuid4(), name=body.name, slug=slug)
    db.add(club)
    await db.flush()

    admin = User(
        id=uuid.uuid4(),
        club_id=club.id,
        email=body.admin_email,
        password_hash=get_password_hash(body.admin_password),
        full_name=body.admin_full_name,
        role=UserRole.club_admin,
    )
    db.add(admin)
    await db.flush()

    # Un club sin roles preset es un club donde nadie puede hacer nada.
    await seed_club_roles(club.id, db)
    await assign_preset_for_legacy_role(admin, db)

    await db.commit()
    await db.refresh(club)
    return club


@router.get("", response_model=list[ClubResponse])
async def list_clubs(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_superadmin)],
):
    result = await db.execute(select(Club).order_by(Club.name))
    return result.scalars().all()


@router.get("/{club_id}", response_model=ClubResponse)
async def get_club(
    club_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    club = await get_club_or_404(club_id, db)
    assert_club_access(club, current_user)
    return club


@router.patch("/{club_id}/branding", response_model=ClubResponse)
async def update_club_branding(
    club_id: uuid.UUID,
    body: ClubBrandingUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_superadmin)],
):
    """
    Logo y colores, no el slug: crear el club sigue siendo el único momento en
    que el slug se fija (ver [[add-club-subdominios-y-marca]]) — es nombre de
    host y de stack de Docker, así que cambiarlo en caliente es un cambio de
    infraestructura, no una edición de marca.
    """
    club = await get_club_or_404(club_id, db)

    if body.logo_url is not None:
        club.logo_url = body.logo_url
    if body.primary_color is not None:
        club.primary_color = body.primary_color
    if body.secondary_color is not None:
        club.secondary_color = body.secondary_color

    await db.commit()
    await db.refresh(club)
    return club


# ── Users inside a club ────────────────────────────────────────────────────────

@router.post("/{club_id}/users", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    club_id: uuid.UUID,
    body: UserCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.club_usuarios))],
):
    club = await get_club_or_404(club_id, db)
    assert_club_access(club, current_user)

    email_taken = await db.scalar(select(User).where(User.email == body.email))
    if email_taken:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already in use")

    user = User(
        id=uuid.uuid4(),
        club_id=club.id,
        email=body.email,
        password_hash=get_password_hash(body.password),
        full_name=body.full_name,
        role=UserRole(body.role),
    )
    db.add(user)
    await db.flush()
    await assign_preset_for_legacy_role(user, db)
    await db.commit()
    await db.refresh(user)
    return user


async def _get_club_user_or_404(
    club_id: uuid.UUID, user_id: uuid.UUID, db: AsyncSession, current_user: User
) -> User:
    club = await get_club_or_404(club_id, db)
    assert_club_access(club, current_user)
    user = await db.scalar(select(User).where(User.id == user_id, User.club_id == club.id))
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


@router.get("/{club_id}/users/{user_id}/divisions", response_model=list[uuid.UUID])
async def get_user_divisions(
    club_id: uuid.UUID,
    user_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.club_usuarios))],
):
    """Lista vacía = sin restricción, o sea acceso a todas las divisiones del club."""
    user = await _get_club_user_or_404(club_id, user_id, db, current_user)
    return [d.id for d in user.divisions]


@router.put("/{club_id}/users/{user_id}/divisions", response_model=list[uuid.UUID])
async def set_user_divisions(
    club_id: uuid.UUID,
    user_id: uuid.UUID,
    body: UserDivisionsUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.club_usuarios))],
):
    """
    Reemplaza el alcance del usuario.

    Mandar la lista vacía **quita** la restricción y devuelve al usuario el acceso a
    todo el club — no lo deja sin nada. Es la lectura que hace `scoped_division_ids`
    y conviene que la API se comporte igual.
    """
    club = await get_club_or_404(club_id, db)
    assert_club_access(club, current_user)
    user = await _get_club_user_or_404(club_id, user_id, db, current_user)

    if body.division_ids:
        valid = set(
            (
                await db.execute(
                    select(Division.id).where(
                        Division.id.in_(body.division_ids), Division.club_id == club.id
                    )
                )
            ).scalars().all()
        )
        unknown = set(body.division_ids) - valid
        if unknown:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Hay divisiones que no pertenecen a este club",
            )

    await db.execute(delete(user_divisions).where(user_divisions.c.user_id == user.id))
    for division_id in set(body.division_ids):
        await db.execute(
            user_divisions.insert().values(user_id=user.id, division_id=division_id)
        )
    await db.commit()

    refreshed = await _get_club_user_or_404(club_id, user_id, db, current_user)
    return [d.id for d in refreshed.divisions]


@router.get("/{club_id}/users", response_model=list[UserResponse])
async def list_users(
    club_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.club_usuarios))],
):
    club = await get_club_or_404(club_id, db)
    assert_club_access(club, current_user)

    result = await db.execute(
        select(User).where(User.club_id == club.id).order_by(User.full_name)
    )
    return result.scalars().all()


@router.patch("/{club_id}/users/{user_id}", response_model=UserResponse)
async def update_user(
    club_id: uuid.UUID,
    user_id: uuid.UUID,
    body: UserUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.club_usuarios))],
):
    club = await get_club_or_404(club_id, db)
    assert_club_access(club, current_user)

    user = await db.scalar(
        select(User).where(User.id == user_id, User.club_id == club.id)
    )
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if body.full_name is not None:
        user.full_name = body.full_name
    if body.role is not None:
        user.role = UserRole(body.role)
    if body.is_active is not None:
        user.is_active = body.is_active

    await db.commit()
    await db.refresh(user)
    return user


@router.get("/{club_id}/players", response_model=list[PlayerWithDivisionResponse])
async def list_club_players(
    club_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    club = await get_club_or_404(club_id, db)
    assert_club_access(club, current_user)

    result = await db.execute(
        select(Player, Division.name.label("division_name"))
        .join(Division, Player.division_id == Division.id)
        .where(Division.club_id == club.id, Player.is_active.is_(True))
        .order_by(Player.name)
    )
    return [
        PlayerWithDivisionResponse(
            id=p.id,
            division_id=p.division_id,
            division_name=div_name,
            name=p.name,
            position=p.position,
            is_active=p.is_active,
            availability=p.availability.value,
            medical_clearance_expires=p.medical_clearance_expires,
        )
        for p, div_name in result.all()
    ]


@router.delete("/{club_id}/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def deactivate_user(
    club_id: uuid.UUID,
    user_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.club_usuarios))],
):
    club = await get_club_or_404(club_id, db)
    assert_club_access(club, current_user)

    user = await db.scalar(
        select(User).where(User.id == user_id, User.club_id == club.id)
    )
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    user.is_active = False
    await db.commit()
