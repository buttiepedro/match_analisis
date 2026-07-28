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

#: Tope de la cadena de herencia. No hay un motivo técnico: cinco niveles ya son
#: más de lo que alguien puede seguir de cabeza, y una cadena más larga es casi
#: siempre un error de armado que después nadie entiende.
MAX_INHERITANCE_DEPTH = 5


class RoleTreeError(ValueError):
    """La jerarquía pedida no se puede aplicar. El mensaje va tal cual al usuario."""


def assert_valid_parent(
    role_id: uuid.UUID,
    parent_id: uuid.UUID | None,
    parents: dict[uuid.UUID, uuid.UUID | None],
    names: dict[uuid.UUID, str],
) -> None:
    """
    Verifica que poner `parent_id` como padre de `role_id` no rompa el árbol.

    Un ciclo (A hereda de B que hereda de A) no da un error: da un resolvedor que
    gira para siempre. Se corta acá, antes de escribir.
    """
    if parent_id is None:
        return

    if parent_id == role_id:
        raise RoleTreeError("Un rol no puede heredar de sí mismo")

    # Subir desde el padre propuesto. Si aparece el propio rol, se cerraría el ciclo.
    chain = [parent_id]
    current = parents.get(parent_id)
    while current is not None:
        if current == role_id:
            camino = " → ".join(names.get(r, "?") for r in [role_id, *chain])
            raise RoleTreeError(
                f"Eso armaría un círculo: {camino} → {names.get(role_id, '?')}"
            )
        chain.append(current)
        current = parents.get(current)

    if len(chain) >= MAX_INHERITANCE_DEPTH:
        raise RoleTreeError(
            f"La cadena de herencia quedaría de {len(chain) + 1} niveles y el máximo "
            f"es {MAX_INHERITANCE_DEPTH}. Conviene aplanarla."
        )


async def resolve_club_role_tree(club_id: uuid.UUID, db: AsyncSession) -> None:
    """
    Recalcula las capacidades heredadas de **todos** los roles del club.

    Efectivas de un rol = sus propias ∪ las efectivas de su padre.

    Recalcula el club entero y no sólo los descendientes del rol que cambió. Un
    club tiene ocho o quince roles: recalcular todo cuesta lo mismo y hace
    imposible que quede uno desincronizado por un caso de borde del recorrido.
    Un permiso mal resuelto no se ve hasta que alguien entra a donde no debía.
    """
    roles = (
        await db.execute(select(Role).where(Role.club_id == club_id))
    ).scalars().all()

    own = {r.id: r.own_permission_values for r in roles}
    parents = {r.id: r.parent_role_id for r in roles}

    def effective(role_id: uuid.UUID) -> set[str]:
        acc: set[str] = set()
        seen: set[uuid.UUID] = set()
        current: uuid.UUID | None = role_id
        while current is not None and current not in seen:
            seen.add(current)
            acc |= own.get(current, set())
            current = parents.get(current)
        return acc

    for role in roles:
        mine = own[role.id]
        # Si una capacidad es propia y además heredada, gana "propia": sacarle el
        # padre al rol no tiene que quitársela.
        desired = {p: p not in mine for p in effective(role.id)}
        current_rows = {rp.permission: rp for rp in role.permissions}

        # Se ajusta fila por fila en vez de borrar todo y reinsertar: borrar e
        # insertar la misma clave primaria en el mismo flush deja el orden de las
        # sentencias a criterio de SQLAlchemy, y a veces choca contra la PK.
        for permission, row in list(current_rows.items()):
            if permission not in desired:
                role.permissions.remove(row)
            elif row.inherited != desired[permission]:
                row.inherited = desired[permission]

        for permission, inherited in sorted(desired.items()):
            if permission not in current_rows:
                role.permissions.append(
                    RolePermission(
                        role_id=role.id, permission=permission, inherited=inherited
                    )
                )

    await db.flush()


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
