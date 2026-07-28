"""
Herencia entre roles: "Jugador hereda de Socio y agrega ver sus tests".

Lo que más importa acá no es que la API devuelva bien la lista, sino que **el
guard del endpoint honre lo heredado**. Una pantalla que muestra una capacidad
heredada mientras el backend la ignora es peor que no tener herencia: el club
cree que le dio acceso a alguien y no se lo dio.
"""
import pytest
from sqlalchemy import select

from app.core.permissions import JUGADOR, SOCIO
from app.core.roles import MAX_INHERITANCE_DEPTH
from app.models import Role, UserRole

from tests.conftest import auth_header, login, make_user


@pytest.fixture
async def roles_ctx(client, db, club_admin_ctx):
    club = club_admin_ctx["club"]
    roles = {
        r.name: r
        for r in (
            await db.execute(select(Role).where(Role.club_id == club.id))
        ).scalars().all()
    }
    return {"club": club, "roles": roles, "headers": club_admin_ctx["headers"]}


async def patch_role(client, ctx, role_id, **body):
    return await client.patch(
        f"/clubs/{ctx['club'].id}/roles/{role_id}", json=body, headers=ctx["headers"]
    )


async def get_role(client, ctx, role_id):
    res = await client.get(f"/clubs/{ctx['club'].id}/roles", headers=ctx["headers"])
    return next(r for r in res.json() if r["id"] == str(role_id))


# ── Resolución ────────────────────────────────────────────────────────────────

async def test_a_role_gains_its_parents_permissions(client, roles_ctx):
    socio = roles_ctx["roles"][SOCIO]
    jugador = roles_ctx["roles"][JUGADOR]

    res = await patch_role(client, roles_ctx, jugador.id, parent_role_id=str(socio.id))
    assert res.status_code == 200, res.text

    body = res.json()
    assert body["parent_name"] == SOCIO
    assert "bolsa.ver" in body["permissions"], "lo del socio tiene que llegar"
    assert "bolsa.ver" in body["inherited_permissions"]
    assert "bolsa.ver" not in body["own_permissions"], "heredada, no propia"
    # Y no perdió lo suyo.
    assert "gimnasio.ver_propio" in body["own_permissions"]


async def test_changing_the_parent_updates_the_children(client, roles_ctx):
    """La razón de existir de la herencia: tocar Socio una vez y que baje sola."""
    socio = roles_ctx["roles"][SOCIO]
    jugador = roles_ctx["roles"][JUGADOR]
    await patch_role(client, roles_ctx, jugador.id, parent_role_id=str(socio.id))

    own = (await get_role(client, roles_ctx, socio.id))["own_permissions"]
    await patch_role(client, roles_ctx, socio.id, permissions=[*own, "plantel.ver"])

    hijo = await get_role(client, roles_ctx, jugador.id)
    assert "plantel.ver" in hijo["permissions"]
    assert "plantel.ver" in hijo["inherited_permissions"]


async def test_inheritance_chains_through_grandparents(client, db, roles_ctx):
    socio = roles_ctx["roles"][SOCIO]
    jugador = roles_ctx["roles"][JUGADOR]

    res = await client.post(
        f"/clubs/{roles_ctx['club'].id}/roles",
        json={"name": "Capitán", "permissions": ["partido.lineup"],
              "parent_role_id": str(jugador.id)},
        headers=roles_ctx["headers"],
    )
    assert res.status_code == 201, res.text
    capitan_id = res.json()["id"]

    await patch_role(client, roles_ctx, jugador.id, parent_role_id=str(socio.id))

    capitan = await get_role(client, roles_ctx, capitan_id)
    assert "partido.lineup" in capitan["own_permissions"]
    assert "gimnasio.ver_propio" in capitan["permissions"], "del padre"
    assert "bolsa.ver" in capitan["permissions"], "del abuelo"


async def test_removing_the_parent_takes_the_inherited_ones_away(client, roles_ctx):
    socio = roles_ctx["roles"][SOCIO]
    jugador = roles_ctx["roles"][JUGADOR]
    await patch_role(client, roles_ctx, jugador.id, parent_role_id=str(socio.id))

    res = await patch_role(client, roles_ctx, jugador.id, clear_parent=True)
    assert res.status_code == 200, res.text
    assert res.json()["parent_role_id"] is None
    assert "bolsa.ver" not in res.json()["permissions"]
    assert "gimnasio.ver_propio" in res.json()["permissions"], "lo propio se queda"


async def test_a_permission_that_is_both_own_and_inherited_survives_losing_the_parent(
    client, roles_ctx
):
    """Si alguien la tildó a mano, sacarle el padre no puede quitársela."""
    socio = roles_ctx["roles"][SOCIO]
    jugador = roles_ctx["roles"][JUGADOR]

    own = (await get_role(client, roles_ctx, jugador.id))["own_permissions"]
    await patch_role(client, roles_ctx, jugador.id, permissions=[*own, "bolsa.ver"])
    await patch_role(client, roles_ctx, jugador.id, parent_role_id=str(socio.id))

    con_padre = await get_role(client, roles_ctx, jugador.id)
    assert "bolsa.ver" in con_padre["own_permissions"], "propia le gana a heredada"

    res = await patch_role(client, roles_ctx, jugador.id, clear_parent=True)
    assert "bolsa.ver" in res.json()["permissions"]


# ── El guard tiene que honrarlo ───────────────────────────────────────────────

async def test_an_inherited_permission_actually_opens_the_endpoint(client, db, roles_ctx):
    """
    El test que importa.

    Que la pantalla muestre la capacidad heredada no sirve de nada si el guard
    del endpoint no la ve: el club creería que le dio acceso a alguien.
    """
    club = roles_ctx["club"]
    socio = roles_ctx["roles"][SOCIO]
    jugador = roles_ctx["roles"][JUGADOR]

    # `make_user` ya le asigna el preset Jugador, igual que la app al crear uno.
    user = await make_user(db, email="jug@example.com", role=UserRole.player, club_id=club.id)
    tokens = await login(client, user.email)
    headers = auth_header(tokens["access_token"])

    # Antes de heredar: la bolsa es sólo de socios.
    assert (await client.get(f"/clubs/{club.id}/job-posts", headers=headers)).status_code == 403

    await patch_role(client, roles_ctx, jugador.id, parent_role_id=str(socio.id))

    tokens = await login(client, user.email)
    headers = auth_header(tokens["access_token"])
    assert (await client.get(f"/clubs/{club.id}/job-posts", headers=headers)).status_code == 200


async def test_the_users_permission_list_includes_the_inherited_ones(client, db, roles_ctx):
    """`/auth/me` alimenta el menú: si no las trae, la pantalla no aparece."""
    club = roles_ctx["club"]
    socio = roles_ctx["roles"][SOCIO]
    jugador = roles_ctx["roles"][JUGADOR]
    await patch_role(client, roles_ctx, jugador.id, parent_role_id=str(socio.id))

    user = await make_user(db, email="jug2@example.com", role=UserRole.player, club_id=club.id)
    tokens = await login(client, user.email)

    res = await client.get("/auth/me", headers=auth_header(tokens["access_token"]))
    assert "bolsa.ver" in res.json()["permissions"]


# ── Lo que no se puede armar ──────────────────────────────────────────────────

async def test_a_role_cannot_inherit_from_itself(client, roles_ctx):
    jugador = roles_ctx["roles"][JUGADOR]
    res = await patch_role(client, roles_ctx, jugador.id, parent_role_id=str(jugador.id))
    assert res.status_code == 409
    assert "sí mismo" in res.json()["detail"]


async def test_a_cycle_is_refused_and_names_the_path(client, roles_ctx):
    """Un ciclo no da error: da un resolvedor girando para siempre."""
    socio = roles_ctx["roles"][SOCIO]
    jugador = roles_ctx["roles"][JUGADOR]
    await patch_role(client, roles_ctx, jugador.id, parent_role_id=str(socio.id))

    res = await patch_role(client, roles_ctx, socio.id, parent_role_id=str(jugador.id))
    assert res.status_code == 409
    assert SOCIO in res.json()["detail"] and JUGADOR in res.json()["detail"]


async def test_a_chain_deeper_than_the_limit_is_refused(client, roles_ctx):
    club_id = roles_ctx["club"].id
    previous = str(roles_ctx["roles"][SOCIO].id)

    for level in range(MAX_INHERITANCE_DEPTH + 2):
        res = await client.post(
            f"/clubs/{club_id}/roles",
            json={"name": f"Nivel {level}", "permissions": [], "parent_role_id": previous},
            headers=roles_ctx["headers"],
        )
        if res.status_code == 409:
            assert "cadena" in res.json()["detail"]
            return
        assert res.status_code == 201, res.text
        previous = res.json()["id"]

    pytest.fail("la cadena creció sin tope")


async def test_you_cannot_inherit_from_another_clubs_role(client, db, roles_ctx):
    from tests.conftest import make_club

    other = await make_club(db, name="Ajeno", slug="ajeno-roles")
    ajeno = await db.scalar(select(Role).where(Role.club_id == other.id, Role.name == SOCIO))

    res = await patch_role(
        client, roles_ctx, roles_ctx["roles"][JUGADOR].id, parent_role_id=str(ajeno.id)
    )
    assert res.status_code == 422


async def test_a_role_with_children_cannot_be_deleted(client, roles_ctx):
    """Borrarlo les sacaría a los hijos todo lo heredado de golpe."""
    club_id = roles_ctx["club"].id
    res = await client.post(
        f"/clubs/{club_id}/roles",
        json={"name": "Base", "permissions": ["plantel.ver"]},
        headers=roles_ctx["headers"],
    )
    base_id = res.json()["id"]
    res = await client.post(
        f"/clubs/{club_id}/roles",
        json={"name": "Derivado", "permissions": [], "parent_role_id": base_id},
        headers=roles_ctx["headers"],
    )
    assert res.status_code == 201, res.text

    res = await client.delete(f"/clubs/{club_id}/roles/{base_id}", headers=roles_ctx["headers"])
    assert res.status_code == 409
    assert "Derivado" in res.json()["detail"]


# ── Nada cambia si nadie usa herencia ─────────────────────────────────────────

async def test_seeded_roles_start_without_a_parent(client, roles_ctx):
    """
    Los presets no vienen encadenados a propósito.

    Poner "Jugador hereda de Socio" en la siembra le daría la bolsa de trabajo a
    todos los jugadores existentes en el momento de desplegar. Es una decisión
    del club, no un efecto secundario de actualizar.
    """
    res = await client.get(
        f"/clubs/{roles_ctx['club'].id}/roles", headers=roles_ctx["headers"]
    )
    for role in res.json():
        assert role["parent_role_id"] is None
        assert role["inherited_permissions"] == []
        assert role["own_permissions"] == role["permissions"]
