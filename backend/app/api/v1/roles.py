"""
Administración de roles del club.

Los roles son **del club**: cada uno tiene su juego, sembrado al crearlo. Un preset
se puede editar pero no borrar — es la red que evita que un club se quede sin ningún
rol capaz de administrarlo.

Un rol puede **derivar de otro**: "Jugador hereda de Socio y agrega ver sus tests".
Sin eso, el día que el club le suma un beneficio al socio hay que acordarse de
agregárselo a mano a cada rol que además es socio, y el que se olvida no da error:
simplemente alguien no ve algo que le corresponde.
"""
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import assert_club_access, get_club_or_404, require
from app.core.permissions import ALL_PERMISSIONS, Permission
from app.core.roles import RoleTreeError, assert_valid_parent, resolve_club_role_tree
from app.models import Role, RolePermission, User, user_roles
from app.schemas.role import (
    PermissionCatalogEntry,
    RoleCreate,
    RoleResponse,
    RoleUpdate,
    UserRolesUpdate,
)

router = APIRouter()


def _to_response(
    role: Role,
    user_count: int = 0,
    *,
    parent_name: str | None = None,
    child_count: int = 0,
) -> RoleResponse:
    own = role.own_permission_values
    return RoleResponse(
        id=role.id,
        name=role.name,
        is_preset=role.is_preset,
        permissions=sorted(role.permission_values),
        own_permissions=sorted(own),
        inherited_permissions=sorted(role.permission_values - own),
        parent_role_id=role.parent_role_id,
        parent_name=parent_name,
        user_count=user_count,
        child_count=child_count,
    )


async def _club_roles(club_id: uuid.UUID, db: AsyncSession) -> list[Role]:
    return list(
        (
            await db.execute(select(Role).where(Role.club_id == club_id).order_by(Role.name))
        ).scalars().all()
    )


async def _apply_parent(
    role: Role, parent_id: uuid.UUID | None, club_id: uuid.UUID, db: AsyncSession
) -> None:
    """Valida y asigna el padre. Traduce el error del árbol a un 409 legible."""
    if parent_id is not None:
        parent = await db.scalar(
            select(Role).where(Role.id == parent_id, Role.club_id == club_id)
        )
        if not parent:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="El rol del que querés heredar no es de este club",
            )

    siblings = await _club_roles(club_id, db)
    parents = {r.id: r.parent_role_id for r in siblings}
    names = {r.id: r.name for r in siblings}
    try:
        assert_valid_parent(role.id, parent_id, parents, names)
    except RoleTreeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))

    role.parent_role_id = parent_id


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

    roles = await _club_roles(club.id, db)

    counts = dict(
        (
            await db.execute(
                select(user_roles.c.role_id, func.count())
                .where(user_roles.c.role_id.in_([r.id for r in roles] or [uuid.uuid4()]))
                .group_by(user_roles.c.role_id)
            )
        ).all()
    )
    names = {r.id: r.name for r in roles}
    children: dict[uuid.UUID, int] = {}
    for r in roles:
        if r.parent_role_id:
            children[r.parent_role_id] = children.get(r.parent_role_id, 0) + 1

    return [
        _to_response(
            r,
            counts.get(r.id, 0),
            parent_name=names.get(r.parent_role_id) if r.parent_role_id else None,
            child_count=children.get(r.id, 0),
        )
        for r in roles
    ]


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
        db.add(RolePermission(role_id=role.id, permission=permission, inherited=False))
    await db.flush()

    if body.parent_role_id is not None:
        await _apply_parent(role, body.parent_role_id, club.id, db)

    await resolve_club_role_tree(club.id, db)
    await db.commit()
    await db.refresh(role)

    parent_name = None
    if role.parent_role_id:
        parent_name = await db.scalar(select(Role.name).where(Role.id == role.parent_role_id))
    return _to_response(role, parent_name=parent_name)


@router.patch("/clubs/{club_id}/roles/{role_id}", response_model=RoleResponse)
async def update_role(
    club_id: uuid.UUID,
    role_id: uuid.UUID,
    body: RoleUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(require(Permission.club_usuarios))],
):
    """
    Un preset se edita: el club puede ajustar qué hace su Entrenador.

    `permissions` son siempre las **propias**. Mandar acá una heredada la vuelve
    propia, que es lo razonable: quedó tildada aunque después le saquen el padre.
    """
    role = await _get_club_role_or_404(club_id, role_id, db, current_user)

    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="El nombre no puede estar vacío")
        role.name = name

    if body.permissions is not None:
        permissions = _validate_permissions(body.permissions)
        # Se borran las filas del rol y se reescriben sólo las propias; las
        # heredadas las vuelve a poner `resolve_club_role_tree` unas líneas abajo.
        await db.execute(delete(RolePermission).where(RolePermission.role_id == role.id))
        await db.flush()
        # El delete masivo no toca la colección en memoria y `resolve_club_role_tree`
        # la lee para diferenciar. Sin esto vería filas que ya no existen.
        await db.refresh(role, ["permissions"])
        for permission in sorted(permissions):
            role.permissions.append(
                RolePermission(role_id=role.id, permission=permission, inherited=False)
            )
        await db.flush()

    if body.clear_parent:
        await _apply_parent(role, None, role.club_id, db)
    elif body.parent_role_id is not None:
        await _apply_parent(role, body.parent_role_id, role.club_id, db)

    await resolve_club_role_tree(role.club_id, db)
    await db.commit()
    await db.refresh(role)

    parent_name = None
    if role.parent_role_id:
        parent_name = await db.scalar(select(Role.name).where(Role.id == role.parent_role_id))
    child_count = await db.scalar(
        select(func.count()).select_from(Role).where(Role.parent_role_id == role.id)
    )
    return _to_response(role, parent_name=parent_name, child_count=child_count or 0)


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

    hijos = (
        await db.execute(select(Role.name).where(Role.parent_role_id == role.id))
    ).scalars().all()
    if hijos:
        # Borrarlo les sacaría de golpe a los hijos todo lo que heredaban, que es
        # un cambio de permisos grande disfrazado de borrar un rol.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Heredan de este rol: {', '.join(sorted(hijos))}. "
                "Cambiales el padre antes de borrarlo."
            ),
        )

    club_id = role.club_id
    await db.delete(role)
    await db.flush()
    await resolve_club_role_tree(club_id, db)
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
