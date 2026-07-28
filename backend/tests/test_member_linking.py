"""
Dar de alta un socio sin pasar por el padrón, y asociarlo a un usuario que ya existe.

El padrón es la fuente de verdad, pero no puede ser la única puerta: un club que
todavía no importó nada no tiene un solo socio, y hay un caso permanente —el
administrador del club también es socio, y su usuario ya existe—.

Lo que más importa acá: que el socio cargado a mano sea **el mismo** que va a
venir en el próximo export del contable. El match es por DNI, así que un alta sin
DNI se daría de baja por ausente en la primera importación y crearía otra al lado.
"""
import pytest
from sqlalchemy import select

from app.core.permissions import SOCIO, TESORERO
from app.core.members import MemberRow, sync_members
from app.models import Member, Role, User, UserRole, user_roles

from tests.conftest import auth_header, login, make_user


@pytest.fixture
async def tesorero_ctx(client, db, club_admin_ctx):
    club = club_admin_ctx["club"]
    user = await make_user(
        db, email="tesorero@example.com", role=UserRole.analyst, club_id=club.id
    )
    role = await db.scalar(select(Role).where(Role.club_id == club.id, Role.name == TESORERO))
    await db.execute(user_roles.insert().values(user_id=user.id, role_id=role.id))
    await db.commit()
    tokens = await login(client, user.email)
    return {"club": club, "headers": auth_header(tokens["access_token"])}


async def crear(client, ctx, **body):
    return await client.post(
        f"/clubs/{ctx['club'].id}/members", json=body, headers=ctx["headers"]
    )


# ── Asociar un usuario que ya existe ──────────────────────────────────────────

async def test_an_existing_user_can_be_made_a_member(client, db, tesorero_ctx):
    """El caso que faltaba: hay usuarios y ningún socio."""
    club = tesorero_ctx["club"]
    usuario = await make_user(
        db, email="presidente@example.com", role=UserRole.analyst, club_id=club.id
    )

    res = await crear(client, tesorero_ctx, user_id=str(usuario.id), document_id="30111222")
    assert res.status_code == 201, res.text
    assert res.json()["document_id"] == "30111222"

    member = await db.scalar(select(Member).where(Member.user_id == usuario.id))
    assert member is not None
    # Y le queda el DNI, o el padrón no lo va a reconocer después.
    await db.refresh(usuario)
    assert usuario.document_id == "30111222"


async def test_the_linked_user_gets_the_socio_role(client, db, tesorero_ctx):
    """Sin el rol, el socio entra y no ve ni su cuota ni la bolsa."""
    club = tesorero_ctx["club"]
    usuario = await make_user(
        db, email="socio1@example.com", role=UserRole.analyst, club_id=club.id
    )
    await crear(client, tesorero_ctx, user_id=str(usuario.id), document_id="30111222")

    tokens = await login(client, usuario.email)
    res = await client.get("/auth/me", headers=auth_header(tokens["access_token"]))
    assert "socios.ver_propia" in res.json()["permissions"]
    assert "bolsa.ver" in res.json()["permissions"]


async def test_the_linked_user_can_read_their_own_membership(client, db, tesorero_ctx):
    club = tesorero_ctx["club"]
    usuario = await make_user(
        db, email="socio2@example.com", role=UserRole.analyst, club_id=club.id
    )
    await crear(
        client, tesorero_ctx, user_id=str(usuario.id), document_id="30111222",
        dues_up_to_date=True,
    )

    tokens = await login(client, usuario.email)
    res = await client.get("/me/membership", headers=auth_header(tokens["access_token"]))
    assert res.status_code == 200, res.text
    assert res.json()["dues_up_to_date"] is True


async def test_a_dni_that_already_belongs_to_a_user_links_instead_of_duplicating(
    client, db, tesorero_ctx
):
    """Dos cuentas para la misma persona, y la buena es la que no usa."""
    club = tesorero_ctx["club"]
    usuario = await make_user(
        db, email="conocido@example.com", role=UserRole.analyst, club_id=club.id
    )
    usuario.document_id = "30111222"
    await db.commit()

    res = await crear(client, tesorero_ctx, document_id="30111222", full_name="Otro Nombre")
    assert res.status_code == 201, res.text

    member = await db.scalar(select(Member))
    assert member.user_id == usuario.id
    assert len((await db.execute(select(User).where(User.club_id == club.id))).scalars().all()) == 3


# ── Alta de alguien que no tiene cuenta ───────────────────────────────────────

async def test_a_member_without_an_account_gets_one(client, db, tesorero_ctx):
    res = await crear(
        client, tesorero_ctx,
        document_id="30999888", full_name="Ana Perez", default_password="clave-del-club",
    )
    assert res.status_code == 201, res.text

    member = await db.scalar(select(Member).where(Member.full_name == "Ana Perez"))
    user = await db.scalar(select(User).where(User.id == member.user_id))
    assert user.document_id == "30999888"
    assert user.must_change_password is True


async def test_creating_an_account_needs_a_password(client, tesorero_ctx):
    res = await crear(client, tesorero_ctx, document_id="30999888", full_name="Ana Perez")
    assert res.status_code == 400
    assert "contraseña" in res.json()["detail"]


# ── Lo que no se acepta ───────────────────────────────────────────────────────

async def test_the_dni_is_required(client, tesorero_ctx):
    res = await crear(client, tesorero_ctx, document_id="", full_name="Sin Documento")
    assert res.status_code == 400


async def test_a_user_cannot_be_a_member_twice(client, db, tesorero_ctx):
    club = tesorero_ctx["club"]
    usuario = await make_user(db, email="dup@example.com", role=UserRole.analyst, club_id=club.id)
    await crear(client, tesorero_ctx, user_id=str(usuario.id), document_id="30111222")

    res = await crear(client, tesorero_ctx, user_id=str(usuario.id), document_id="30111222")
    assert res.status_code == 409


async def test_a_conflicting_dni_is_refused_instead_of_overwritten(client, db, tesorero_ctx):
    """Pisarle el DNI a alguien en silencio es peor que no dejar seguir."""
    club = tesorero_ctx["club"]
    usuario = await make_user(db, email="otro@example.com", role=UserRole.analyst, club_id=club.id)
    usuario.document_id = "11111111"
    await db.commit()

    res = await crear(client, tesorero_ctx, user_id=str(usuario.id), document_id="22222222")
    assert res.status_code == 409
    assert "11111111" in res.json()["detail"]


async def test_a_user_from_another_club_cannot_be_linked(client, db, tesorero_ctx):
    from tests.conftest import make_club

    otro = await make_club(db, name="Ajeno", slug="ajeno-socios")
    ajeno = await make_user(db, email="ajeno@example.com", role=UserRole.analyst, club_id=otro.id)

    res = await crear(client, tesorero_ctx, user_id=str(ajeno.id), document_id="30111222")
    assert res.status_code == 422


async def test_creating_a_member_needs_the_capability(client, db, tesorero_ctx):
    club = tesorero_ctx["club"]
    cualquiera = await make_user(
        db, email="nadie@example.com", role=UserRole.player, club_id=club.id
    )
    tokens = await login(client, cualquiera.email)

    res = await client.post(
        f"/clubs/{club.id}/members",
        json={"document_id": "30111222", "full_name": "X"},
        headers=auth_header(tokens["access_token"]),
    )
    assert res.status_code == 403


# ── Convivencia con el padrón ─────────────────────────────────────────────────

async def test_the_padron_recognises_a_manually_created_member(client, db, tesorero_ctx):
    """
    La razón por la que el DNI es obligatorio.

    Sin él, la primera importación lo daría de baja por ausente y crearía otro
    socio al lado con la misma persona adentro.
    """
    club = tesorero_ctx["club"]
    usuario = await make_user(db, email="pres@example.com", role=UserRole.analyst, club_id=club.id)
    await crear(client, tesorero_ctx, user_id=str(usuario.id), document_id="30111222")

    resultado = await sync_members(
        club.id,
        [MemberRow(document_id="30111222", full_name="Presidente Del Club", dues_up_to_date=True)],
        db,
        default_password="x" * 12,
    )

    assert resultado.deactivated == [], "no lo puede dar de baja"
    assert len(resultado.created) == 0, "ni crear otro al lado"
    assert len((await db.execute(select(Member))).scalars().all()) == 1


# ── Corregir a mano ───────────────────────────────────────────────────────────

async def test_marking_someone_up_to_date_moves_the_date_too(client, db, tesorero_ctx):
    """
    "Estás al día" sin fecha es un dato que el socio puede tomar por actual
    cuando tiene tres semanas.
    """
    res = await crear(
        client, tesorero_ctx,
        document_id="30999888", full_name="Ana Perez", default_password="clave-del-club",
    )
    member_id = res.json()["id"]
    antes = res.json()["dues_synced_at"]

    res = await client.patch(
        f"/clubs/{tesorero_ctx['club'].id}/members/{member_id}",
        json={"dues_up_to_date": True},
        headers=tesorero_ctx["headers"],
    )
    assert res.status_code == 200, res.text
    assert res.json()["dues_up_to_date"] is True
    assert res.json()["dues_synced_at"] >= antes


async def test_linkable_users_leaves_out_the_ones_already_members(client, db, tesorero_ctx):
    club = tesorero_ctx["club"]
    usuario = await make_user(db, email="libre@example.com", role=UserRole.analyst, club_id=club.id)

    res = await client.get(f"/clubs/{club.id}/linkable-users", headers=tesorero_ctx["headers"])
    assert str(usuario.id) in [u["id"] for u in res.json()]

    await crear(client, tesorero_ctx, user_id=str(usuario.id), document_id="30111222")

    res = await client.get(f"/clubs/{club.id}/linkable-users", headers=tesorero_ctx["headers"])
    assert str(usuario.id) not in [u["id"] for u in res.json()]
