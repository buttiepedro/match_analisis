"""
Bolsa de trabajo.

Lo que más importa: que un aviso vencido desaparezca solo, que el contacto de un
socio no circule fuera de un aviso vigente, y que el autor pueda bajar el suyo
cuando quiera.
"""
import uuid
from datetime import date, timedelta

import pytest
from sqlalchemy import select

from app.core.permissions import SOCIO
from app.models import JobPost, Role, UserRole, user_roles

from tests.conftest import auth_header, login, make_user


@pytest.fixture
async def board_ctx(client, db, club_admin_ctx):
    """Dos socios y un admin, que es quien modera."""
    club = club_admin_ctx["club"]
    socio_role = await db.scalar(
        select(Role).where(Role.club_id == club.id, Role.name == SOCIO)
    )

    socios = {}
    for name in ("ana", "bruno"):
        user = await make_user(
            db, email=f"{name}@example.com", role=UserRole.player, club_id=club.id
        )
        await db.execute(user_roles.insert().values(user_id=user.id, role_id=socio_role.id))
        await db.commit()
        tokens = await login(client, user.email)
        socios[name] = {"user": user, "headers": auth_header(tokens["access_token"])}

    return {"club": club, "socios": socios, "admin_headers": club_admin_ctx["headers"]}


async def _publish(client, ctx, who="ana", title="Busco changas de albañilería"):
    res = await client.post(
        f"/clubs/{ctx['club'].id}/job-posts",
        json={
            "kind": "busca",
            "title": title,
            "description": "Tengo herramientas propias.",
            "contact": "11-5555-5555",
        },
        headers=ctx["socios"][who]["headers"],
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


async def _approve(client, ctx, post_id, **body):
    return await client.post(
        f"/job-posts/{post_id}/moderate",
        json={"approve": True, **body},
        headers=ctx["admin_headers"],
    )


# ── Moderación ────────────────────────────────────────────────────────────────

async def test_a_new_post_is_not_visible_until_approved(client, board_ctx):
    await _publish(client, board_ctx)

    res = await client.get(
        f"/clubs/{board_ctx['club'].id}/job-posts",
        headers=board_ctx["socios"]["bruno"]["headers"],
    )
    assert res.json() == []


async def test_an_approved_post_becomes_visible_to_other_members(client, board_ctx):
    post_id = await _publish(client, board_ctx)
    res = await _approve(client, board_ctx, post_id)
    assert res.status_code == 200, res.text

    res = await client.get(
        f"/clubs/{board_ctx['club'].id}/job-posts",
        headers=board_ctx["socios"]["bruno"]["headers"],
    )
    body = res.json()
    assert len(body) == 1
    assert body[0]["contact"] == "11-5555-5555"
    assert body[0]["is_mine"] is False


async def test_a_rejection_tells_the_author_why(client, board_ctx):
    """Sin motivo, el autor vuelve a mandar lo mismo."""
    post_id = await _publish(client, board_ctx)
    await client.post(
        f"/job-posts/{post_id}/moderate",
        json={"approve": False, "note": "Poné un contacto de verdad"},
        headers=board_ctx["admin_headers"],
    )

    res = await client.get(
        f"/clubs/{board_ctx['club'].id}/job-posts",
        params={"mine": True},
        headers=board_ctx["socios"]["ana"]["headers"],
    )
    mine = res.json()[0]
    assert mine["status"] == "rechazado"
    assert mine["moderation_note"] == "Poné un contacto de verdad"


async def test_a_rejected_post_disappears_for_everyone_but_its_author(client, board_ctx):
    """El motivo del rechazo es entre el moderador y el autor."""
    post_id = await _publish(client, board_ctx)
    await client.post(
        f"/job-posts/{post_id}/moderate",
        json={"approve": False, "note": "Motivo interno"},
        headers=board_ctx["admin_headers"],
    )

    # Sale de la cola de moderación: ya se resolvió.
    res = await client.get(
        f"/clubs/{board_ctx['club'].id}/job-posts",
        params={"pending": True},
        headers=board_ctx["admin_headers"],
    )
    assert res.json() == []

    # Y no aparece en el tablero de los demás socios, con motivo ni sin él.
    res = await client.get(
        f"/clubs/{board_ctx['club'].id}/job-posts",
        headers=board_ctx["socios"]["bruno"]["headers"],
    )
    assert res.json() == []


async def test_editing_a_post_sends_it_back_to_moderation(client, board_ctx):
    """Si editar dejara el aviso publicado, moderar no serviría de nada."""
    post_id = await _publish(client, board_ctx)
    await _approve(client, board_ctx, post_id)

    res = await client.patch(
        f"/job-posts/{post_id}",
        json={"title": "Otra cosa completamente distinta"},
        headers=board_ctx["socios"]["ana"]["headers"],
    )
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "pendiente"

    res = await client.get(
        f"/clubs/{board_ctx['club'].id}/job-posts",
        headers=board_ctx["socios"]["bruno"]["headers"],
    )
    assert res.json() == []


async def test_a_member_cannot_moderate(client, board_ctx):
    post_id = await _publish(client, board_ctx)
    res = await client.post(
        f"/job-posts/{post_id}/moderate",
        json={"approve": True},
        headers=board_ctx["socios"]["bruno"]["headers"],
    )
    assert res.status_code == 403


async def test_a_member_cannot_edit_someone_elses_post(client, board_ctx):
    post_id = await _publish(client, board_ctx, who="ana")
    res = await client.patch(
        f"/job-posts/{post_id}",
        json={"title": "Secuestrado"},
        headers=board_ctx["socios"]["bruno"]["headers"],
    )
    assert res.status_code == 403


# ── Expiración ────────────────────────────────────────────────────────────────

async def test_an_approved_post_gets_an_expiry(client, board_ctx):
    post_id = await _publish(client, board_ctx)
    res = await _approve(client, board_ctx, post_id)
    assert res.json()["expires_on"] == (date.today() + timedelta(days=30)).isoformat()


async def test_an_expired_post_disappears_from_the_board(client, db, board_ctx):
    """Una bolsa llena de avisos viejos deja de leerse."""
    post_id = await _publish(client, board_ctx)
    await _approve(client, board_ctx, post_id)

    post = await db.scalar(select(JobPost).where(JobPost.id == uuid.UUID(post_id)))
    post.expires_on = date.today() - timedelta(days=1)
    await db.commit()

    res = await client.get(
        f"/clubs/{board_ctx['club'].id}/job-posts",
        headers=board_ctx["socios"]["bruno"]["headers"],
    )
    assert res.json() == []


async def test_the_author_still_sees_their_expired_post_as_expired(client, db, board_ctx):
    post_id = await _publish(client, board_ctx)
    await _approve(client, board_ctx, post_id)
    post = await db.scalar(select(JobPost).where(JobPost.id == uuid.UUID(post_id)))
    post.expires_on = date.today() - timedelta(days=1)
    await db.commit()

    res = await client.get(
        f"/clubs/{board_ctx['club'].id}/job-posts",
        params={"mine": True},
        headers=board_ctx["socios"]["ana"]["headers"],
    )
    assert res.json()[0]["status"] == "vencido"


async def test_the_author_can_renew_without_asking_again(client, db, board_ctx):
    post_id = await _publish(client, board_ctx)
    await _approve(client, board_ctx, post_id)
    post = await db.scalar(select(JobPost).where(JobPost.id == uuid.UUID(post_id)))
    post.expires_on = date.today() - timedelta(days=1)
    await db.commit()

    res = await client.post(
        f"/job-posts/{post_id}/renew",
        headers=board_ctx["socios"]["ana"]["headers"],
    )
    assert res.status_code == 200, res.text
    assert res.json()["expires_on"] == (date.today() + timedelta(days=30)).isoformat()

    res = await client.get(
        f"/clubs/{board_ctx['club'].id}/job-posts",
        headers=board_ctx["socios"]["bruno"]["headers"],
    )
    assert len(res.json()) == 1


async def test_an_unapproved_post_cannot_be_renewed(client, board_ctx):
    post_id = await _publish(client, board_ctx)
    res = await client.post(
        f"/job-posts/{post_id}/renew", headers=board_ctx["socios"]["ana"]["headers"]
    )
    assert res.status_code == 409


# ── Datos personales ──────────────────────────────────────────────────────────

async def test_the_contact_is_hidden_on_a_post_that_is_not_live(client, db, board_ctx):
    """Un teléfono de un socio no circula fuera de un aviso vigente."""
    post_id = await _publish(client, board_ctx)
    await _approve(client, board_ctx, post_id)
    post = await db.scalar(select(JobPost).where(JobPost.id == uuid.UUID(post_id)))
    post.expires_on = date.today() - timedelta(days=1)
    await db.commit()

    res = await client.get(
        f"/clubs/{board_ctx['club'].id}/job-posts",
        params={"pending": True},
        headers=board_ctx["admin_headers"],
    )
    assert res.json() == []

    # El propio autor sí lo ve: es su dato.
    res = await client.get(
        f"/clubs/{board_ctx['club'].id}/job-posts",
        params={"mine": True},
        headers=board_ctx["socios"]["ana"]["headers"],
    )
    assert res.json()[0]["contact"] == "11-5555-5555"


async def test_the_author_can_take_their_post_down(client, board_ctx):
    """La contracara de publicar un teléfono: arrepentirse sin pedir permiso."""
    post_id = await _publish(client, board_ctx)
    await _approve(client, board_ctx, post_id)

    res = await client.delete(
        f"/job-posts/{post_id}", headers=board_ctx["socios"]["ana"]["headers"]
    )
    assert res.status_code == 204

    res = await client.get(
        f"/clubs/{board_ctx['club'].id}/job-posts",
        headers=board_ctx["socios"]["bruno"]["headers"],
    )
    assert res.json() == []


async def test_a_member_cannot_delete_someone_elses_post(client, board_ctx):
    post_id = await _publish(client, board_ctx, who="ana")
    res = await client.delete(
        f"/job-posts/{post_id}", headers=board_ctx["socios"]["bruno"]["headers"]
    )
    assert res.status_code == 403


async def test_the_board_is_not_visible_without_the_capability(client, db, board_ctx):
    """No es pública: publica contactos de socios."""
    outsider = await make_user(
        db, email="jugador@example.com", role=UserRole.player, club_id=board_ctx["club"].id
    )
    tokens = await login(client, outsider.email)

    res = await client.get(
        f"/clubs/{board_ctx['club'].id}/job-posts",
        headers=auth_header(tokens["access_token"]),
    )
    assert res.status_code == 403


async def test_another_club_cannot_read_the_board(client, db, board_ctx):
    from tests.conftest import make_club

    other = await make_club(db, name="Otro", slug="otro-bolsa")
    other_role = await db.scalar(select(Role).where(Role.club_id == other.id, Role.name == SOCIO))
    user = await make_user(db, email="ajeno@example.com", role=UserRole.player, club_id=other.id)
    await db.execute(user_roles.insert().values(user_id=user.id, role_id=other_role.id))
    await db.commit()
    tokens = await login(client, user.email)

    res = await client.get(
        f"/clubs/{board_ctx['club'].id}/job-posts",
        headers=auth_header(tokens["access_token"]),
    )
    assert res.status_code == 403
