"""
Administración de roles del club.

Los roles son **del club**: cada uno tiene su juego, sembrado al crearlo. Un preset
se puede editar pero no borrar — es la red que evita que un club se quede sin ningún
rol capaz de administrarlo.
"""
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import assert_club_access, get_club_or_404, require
from app.core.permissions import ALL_PERMISSIONS, Permission
from app.models import Role, RolePermission, User, user_roles
from app.schemas.role import (
    PermissionCatalogEntry,
    RoleCreate,
    RoleResponse,
    RoleUpdate,
    UserRolesUpdate,
)

router = APIRouter()


def _to_response(role: Role, user_count: int = 0) -> RoleResponse:
    return RoleResponse(
        id=role.id,
        name=role.name,
        is_preset=role.is_preset,
        permissions=sorted(role.permission_values),
        user_count=user_count,
    )


async def _get_club_role_or_404(
    club_id: uuid.UUID, role_id: uuid.UUID, db: AsyncSession, current_user: User
) -> Role:
    club = await get_club_or_404(club_id, db)
    assert_club_access(club, current_user)
    role = await db.scalar(select(Role).where(Role.id == role_id, Role.club_id == club.id))
    if not role:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rol no encontrado")
    return role


def _validate_permissions(permissions: list[str]) -> set[str]:
    unknown = set(permissions) - ALL_PERMISSIONS
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Capacidades desconocidas: {', '.join(sorted(unknown))}",
        )
    return set(permissions)


@router.get("/permissions", response_model=list[PermissionCatalogEntry])
async def permission_catalog(
    _: Annotated[User, Depends(require(Permission.club_usuarios))],
):
    """Catálogo completo, agrupado por dominio, para que la UI no lo hardcodee."""
    return [
        PermissionCatalogEntry(
            value=p.value,
            domain=p.value.split(".")[0],
            action=p.value.split(".")[1],
        )
        for p in Permission
    ]


@router.get("/clubs/{club_id}/roles", response_model=list[RoleResponse])
async def list_roles(
    club_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.club_usuarios))],
):
    club = await get_club_or_404(club_id, db)
    assert_club_access(club, current_user)

    roles = (
        await db.execute(select(Role).where(Role.club_id == club.id).order_by(Role.name))
    ).scalars().all()

    counts = dict(
        (
            await db.execute(
                select(user_roles.c.role_id, func.count())
                .where(user_roles.c.role_id.in_([r.id for r in roles] or [uuid.uuid4()]))
                .group_by(user_roles.c.role_id)
            )
        ).all()
    )
    return [_to_response(r, counts.get(r.id, 0)) for r in roles]


@router.post(
    "/clubs/{club_id}/roles", response_model=RoleResponse, status_code=status.HTTP_201_CREATED
)
async def create_role(
    club_id: uuid.UUID,
    body: RoleCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.club_usuarios))],
):
    club = await get_club_or_404(club_id, db)
    assert_club_access(club, current_user)

    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="El nombre no puede estar vacío")

    taken = await db.scalar(select(Role).where(Role.club_id == club.id, Role.name == name))
    if taken:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=f"Ya existe un rol '{name}'"
        )

    permissions = _validate_permissions(body.permissions)
    role = Role(id=uuid.uuid4(), club_id=club.id, name=name, is_preset=False)
    db.add(role)
    await db.flush()
    for permission in sorted(permissions):
        db.add(RolePermission(role_id=role.id, permission=permission))

    await db.commit()
    await db.refresh(role)
    return _to_response(role)


@router.patch("/clubs/{club_id}/roles/{role_id}", response_model=RoleResponse)
async def update_role(
    club_id: uuid.UUID,
    role_id: uuid.UUID,
    body: RoleUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.club_usuarios))],
):
    """Un preset se edita: el club puede ajustar qué hace su Entrenador."""
    role = await _get_club_role_or_404(club_id, role_id, db, current_user)

    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="El nombre no puede estar vacío")
        role.name = name

    if body.permissions is not None:
        permissions = _validate_permissions(body.permissions)
        await db.execute(
            delete(RolePermission).where(RolePermission.role_id == role.id)
        )
        await db.flush()
        for permission in sorted(permissions):
            db.add(RolePermission(role_id=role.id, permission=permission))

    await db.commit()
    await db.refresh(role)
    return _to_response(role)


@router.delete("/clubs/{club_id}/roles/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_role(
    club_id: uuid.UUID,
    role_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.club_usuarios))],
):
    role = await _get_club_role_or_404(club_id, role_id, db, current_user)

    if role.is_preset:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Un rol preset no se borra. Editá sus capacidades o dejalo sin asignar.",
        )

    assigned = await db.scalar(
        select(func.count()).select_from(user_roles).where(user_roles.c.role_id == role.id)
    )
    if assigned:
        # Borrarlo dejaría a esa gente sin acceso sin que nadie se entere.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"El rol está asignado a {assigned} usuario(s). Quitáselo primero.",
        )

    await db.delete(role)
    await db.commit()


@router.get("/clubs/{club_id}/users/{user_id}/roles", response_model=list[uuid.UUID])
async def get_user_roles(
    club_id: uuid.UUID,
    user_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.club_usuarios))],
):
    club = await get_club_or_404(club_id, db)
    assert_club_access(club, current_user)
    user = await db.scalar(select(User).where(User.id == user_id, User.club_id == club.id))
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return [r.id for r in user.roles]


@router.put("/clubs/{club_id}/users/{user_id}/roles", response_model=list[uuid.UUID])
async def set_user_roles(
    club_id: uuid.UUID,
    user_id: uuid.UUID,
    body: UserRolesUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.club_usuarios))],
):
    """Reemplaza los roles del usuario. Las capacidades de todos se suman."""
    club = await get_club_or_404(club_id, db)
    assert_club_access(club, current_user)
    user = await db.scalar(select(User).where(User.id == user_id, User.club_id == club.id))
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if body.role_ids:
        valid = set(
            (
                await db.execute(
                    select(Role.id).where(
                        Role.id.in_(body.role_ids), Role.club_id == club.id
                    )
                )
            ).scalars().all()
        )
        unknown = set(body.role_ids) - valid
        if unknown:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Hay roles que no pertenecen a este club",
            )

    await db.execute(delete(user_roles).where(user_roles.c.user_id == user.id))
    for role_id in set(body.role_ids):
        await db.execute(user_roles.insert().values(user_id=user.id, role_id=role_id))
    await db.commit()

    refreshed = await db.scalar(select(User).where(User.id == user.id))
    return [r.id for r in refreshed.roles]
