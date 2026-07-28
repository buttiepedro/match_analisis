"""
Siembra y asignación de roles.

Un club sin roles preset es un club donde nadie puede hacer nada, así que sembrarlos
no puede depender de acordarse: lo hacen la creación de club, la creación de usuario
y la migración, todos por acá.
"""
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import LEGACY_ROLE_TO_PRESET, PRESET_PERMISSIONS
from app.models import Role, RolePermission, User, UserRole, user_roles


async def seed_club_roles(club_id: uuid.UUID, db: AsyncSession) -> dict[str, Role]:
    """
    Crea los roles preset del club. Idempotente: los que ya existen no se tocan.

    No se re-siembran las capacidades de un preset existente **a propósito**: si el
    club le sacó una capacidad al Entrenador, volver a agregarla en el próximo
    arranque sería pisarle una decisión.
    """
    existing = {
        r.name: r
        for r in (
            await db.execute(select(Role).where(Role.club_id == club_id))
        ).scalars().all()
    }

    for name, permissions in PRESET_PERMISSIONS.items():
        if name in existing:
            continue
        role = Role(id=uuid.uuid4(), club_id=club_id, name=name, is_preset=True)
        db.add(role)
        await db.flush()
        for permission in sorted(permissions):
            db.add(RolePermission(role_id=role.id, permission=permission))
        existing[name] = role

    await db.flush()
    return existing


async def assign_preset_for_legacy_role(user: User, db: AsyncSession) -> None:
    """
    Le da al usuario el rol preset equivalente a su `users.role`.

    Es el puente mientras el enum siga siendo la forma de crear usuarios. Cuando la
    UI asigne roles directamente, esto queda sólo para la migración.
    """
    if user.club_id is None or user.role == UserRole.superadmin:
        return

    preset_name = LEGACY_ROLE_TO_PRESET.get(user.role.value)
    if not preset_name:
        return

    roles = await seed_club_roles(user.club_id, db)
    role = roles.get(preset_name)
    if not role:
        return

    already = await db.scalar(
        select(user_roles.c.role_id).where(
            user_roles.c.user_id == user.id, user_roles.c.role_id == role.id
        )
    )
    if already:
        return

    await db.execute(user_roles.insert().values(user_id=user.id, role_id=role.id))
