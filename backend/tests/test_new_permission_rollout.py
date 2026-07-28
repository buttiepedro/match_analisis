"""
Qué pasa cuando se agrega una capacidad **después** de que un club ya existe.

Este es el agujero que se llevó puestos tres módulos seguidos: socios, gimnasio y
bolsa de trabajo se desplegaron y no los vio nadie. Sembrar roles es idempotente y
no toca un rol existente —a propósito, para no pisarle al club lo que editó—, así
que la capacidad nueva no entraba en ningún rol. El menú filtra por capacidad, así
que la pantalla no aparecía. Sin un error en ningún log.

La línea que no hay que cruzar: rellenar lo que el club **nunca vio**, sin volver a
poner lo que el club **sacó**. En la base las dos se ven igual — un rol sin la
capacidad — y por eso existe el registro de capacidades conocidas.
"""
import pytest
from sqlalchemy import delete, select
from sqlalchemy.orm import selectinload

from app.core.permissions import ADMINISTRADOR, ALL_PERMISSIONS, SOCIO, TESORERO
from app.core.roles import grant_newly_added_permissions
from app.models import KnownPermission, Role, RolePermission

BOLSA = {"bolsa.ver", "bolsa.publicar", "bolsa.moderar"}


async def marcar_conocidas(db, permisos: set[str]) -> None:
    """
    Deja registrado que la instalación ya vio estas capacidades.

    Es lo que hace la migración `0021` al desplegarse: toma como línea de base las
    que ya están en algún rol. Los tests corren sobre un schema creado desde los
    modelos, sin migraciones, así que la línea de base hay que ponerla a mano — y
    sin ella estos tests medirían otra cosa: con la tabla vacía **todo** es nuevo.
    """
    for permission in sorted(permisos):
        db.add(KnownPermission(permission=permission))
    await db.commit()


@pytest.fixture
async def club_de_antes_de_la_bolsa(db, club_admin_ctx):
    """
    Un club sembrado antes de que existieran las capacidades de la bolsa.

    Es el estado real de cualquier instalación que venía andando: sus roles se
    escribieron con el catálogo de aquel momento.
    """
    club = club_admin_ctx["club"]
    await db.execute(delete(RolePermission).where(RolePermission.permission.in_(BOLSA)))
    await db.commit()
    await marcar_conocidas(db, ALL_PERMISSIONS - BOLSA)
    return {**club_admin_ctx, "club": club}


async def own(db, club_id, role_name) -> set[str]:
    # `selectinload` explícito: tras un `commit()` la colección queda expirada y
    # se recargaría con la estrategia perezosa, que en código sync revienta.
    role = await db.scalar(
        select(Role)
        .where(Role.club_id == club_id, Role.name == role_name)
        .options(selectinload(Role.permissions))
        .execution_options(populate_existing=True)
    )
    return role.own_permission_values if role else set()


# ── Rellenar lo que nunca se vio ──────────────────────────────────────────────

async def test_a_capability_added_later_reaches_the_presets_that_should_have_it(
    db, club_de_antes_de_la_bolsa
):
    club = club_de_antes_de_la_bolsa["club"]
    assert "bolsa.ver" not in await own(db, club.id, ADMINISTRADOR)

    nuevas = await grant_newly_added_permissions(db)

    assert set(nuevas) == BOLSA
    # El Administrador puede todo dentro del club: le llegan las tres.
    assert BOLSA <= await own(db, club.id, ADMINISTRADOR)
    # El Socio, sólo las que le da su preset.
    socio = await own(db, club.id, SOCIO)
    assert {"bolsa.ver", "bolsa.publicar"} <= socio
    assert "bolsa.moderar" not in socio, "moderar no es de socios"
    # El Tesorero, ninguna: su preset no las tiene.
    assert not (await own(db, club.id, TESORERO) & BOLSA)


async def test_running_it_twice_changes_nothing(db, club_de_antes_de_la_bolsa):
    """Corre en cada arranque: la segunda vez tiene que ser un no-op."""
    await grant_newly_added_permissions(db)
    antes = await own(db, club_de_antes_de_la_bolsa["club"].id, ADMINISTRADOR)

    assert await grant_newly_added_permissions(db) == []
    assert await own(db, club_de_antes_de_la_bolsa["club"].id, ADMINISTRADOR) == antes


async def test_it_reaches_every_club_not_just_one(db, club_de_antes_de_la_bolsa):
    from tests.conftest import make_club

    otro = await make_club(db, name="Segundo", slug="segundo-rollout")
    await db.execute(delete(RolePermission).where(RolePermission.permission.in_(BOLSA)))
    await db.commit()

    await grant_newly_added_permissions(db)

    assert BOLSA <= await own(db, otro.id, ADMINISTRADOR)


# ── No pisar lo que el club decidió ───────────────────────────────────────────

async def test_a_capability_the_club_removed_is_not_put_back(db, club_admin_ctx):
    """
    La línea que no se cruza.

    Si el club le sacó una capacidad al Administrador, volver a ponérsela en el
    próximo arranque sería pisarle una decisión, y encima en silencio.
    """
    club = club_admin_ctx["club"]
    await marcar_conocidas(db, ALL_PERMISSIONS)  # la instalación ya las vio todas

    role = await db.scalar(
        select(Role).where(Role.club_id == club.id, Role.name == ADMINISTRADOR)
    )
    await db.execute(
        delete(RolePermission).where(
            RolePermission.role_id == role.id,
            RolePermission.permission == "bolsa.moderar",
        )
    )
    await db.commit()

    assert await grant_newly_added_permissions(db) == []
    assert "bolsa.moderar" not in await own(db, club.id, ADMINISTRADOR)


async def test_a_renamed_preset_is_left_alone(db, club_de_antes_de_la_bolsa):
    """Renombrado, no hay forma de saber a qué preset correspondía."""
    club = club_de_antes_de_la_bolsa["club"]
    role = await db.scalar(select(Role).where(Role.club_id == club.id, Role.name == SOCIO))
    role.name = "Asociado"
    await db.commit()

    await grant_newly_added_permissions(db)

    assert not (await own(db, club.id, "Asociado") & BOLSA)


async def test_custom_roles_are_never_touched(db, club_de_antes_de_la_bolsa):
    """Un rol que armó el club es suyo: nadie le agrega nada por su cuenta."""
    club = club_de_antes_de_la_bolsa["club"]
    # Las capacidades se arman **antes** de persistirlo: una vez que el objeto es
    # persistente, tocar `.permissions` dispara una carga, y una carga en código
    # sync revienta con MissingGreenlet.
    role = Role(club_id=club.id, name="Utilero", is_preset=False)
    role.permissions.append(RolePermission(permission="plantel.ver"))
    db.add(role)
    await db.commit()

    await grant_newly_added_permissions(db)

    assert await own(db, club.id, "Utilero") == {"plantel.ver"}


# ── Herencia ──────────────────────────────────────────────────────────────────

async def test_children_of_a_touched_role_get_the_new_capability_too(
    db, client, club_de_antes_de_la_bolsa
):
    """Si el rol que recibe la capacidad nueva tiene hijos, les tiene que bajar."""
    club = club_de_antes_de_la_bolsa["club"]
    socio = await db.scalar(select(Role).where(Role.club_id == club.id, Role.name == SOCIO))

    res = await client.post(
        f"/clubs/{club.id}/roles",
        json={"name": "Cadete", "permissions": [], "parent_role_id": str(socio.id)},
        headers=club_de_antes_de_la_bolsa["headers"],
    )
    assert res.status_code == 201, res.text

    await grant_newly_added_permissions(db)

    cadete = await db.scalar(
        select(Role)
        .where(Role.club_id == club.id, Role.name == "Cadete")
        .options(selectinload(Role.permissions))
        .execution_options(populate_existing=True)
    )
    assert "bolsa.ver" in cadete.permission_values
    assert "bolsa.ver" not in cadete.own_permission_values, "heredada, no propia"


# ── Lo que queda registrado ───────────────────────────────────────────────────

async def test_every_capability_ends_up_registered_as_known(db, club_de_antes_de_la_bolsa):
    """Si no quedaran registradas, el próximo arranque las repartiría de nuevo."""
    await grant_newly_added_permissions(db)

    conocidas = set((await db.execute(select(KnownPermission.permission))).scalars().all())
    assert ALL_PERMISSIONS <= conocidas
