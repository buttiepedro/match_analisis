"""
Turnos con nutricionista.

Lo que más importa: la reserva se resuelve con un `UPDATE` condicionado al
estado actual, no lectura-y-después-escritura — dos reservas simultáneas del
mismo horario tienen que dar una ganadora y un `409`, nunca las dos "ganan".
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.core.permissions import NUTRICIONISTA
from app.core.scheduler import send_nutrition_reminders
from app.models import Notification, NutritionSlot, Role, UserRole, user_roles

from tests.conftest import auth_header, login, make_division, make_user


@pytest.fixture
async def nutrition_ctx(client, db, club_admin_ctx):
    club = club_admin_ctx["club"]
    division = await make_division(db, club.id)

    nutri = await make_user(db, email="nutri@example.com", role=UserRole.analyst, club_id=club.id)
    nutri_role = await db.scalar(
        select(Role).where(Role.club_id == club.id, Role.name == NUTRICIONISTA)
    )
    await db.execute(user_roles.insert().values(user_id=nutri.id, role_id=nutri_role.id))
    await db.commit()
    nutri_tokens = await login(client, nutri.email)

    res = await client.post(
        f"/divisions/{division.id}/players",
        json={"name": "Jugador Uno"},
        headers=club_admin_ctx["headers"],
    )
    player = res.json()
    res = await client.post(
        f"/divisions/{division.id}/players/{player['id']}/invite",
        json={"email": "jugador1.nutricion@example.com", "password": "secret123"},
        headers=club_admin_ctx["headers"],
    )
    player_user_id = res.json()["user_id"]
    player_tokens = await login(client, "jugador1.nutricion@example.com")

    return {
        "club": club,
        "division": division,
        "player": player,
        "player_user_id": player_user_id,
        "nutri": nutri,
        "nutri_headers": auth_header(nutri_tokens["access_token"]),
        "player_headers": auth_header(player_tokens["access_token"]),
        "admin_headers": club_admin_ctx["headers"],
    }


def _iso(dt: datetime) -> str:
    return dt.isoformat()


async def _publish_slot(client, ctx, *, starts_in_hours=48):
    starts_at = datetime.now(timezone.utc) + timedelta(hours=starts_in_hours)
    ends_at = starts_at + timedelta(minutes=30)
    res = await client.post(
        f"/clubs/{ctx['club'].id}/nutrition-slots",
        json={"slots": [{"starts_at": _iso(starts_at), "ends_at": _iso(ends_at)}]},
        headers=ctx["nutri_headers"],
    )
    assert res.status_code == 201, res.text
    return res.json()[0]


# ── Publicar y listar ─────────────────────────────────────────────────────────

async def test_the_nutritionist_publishes_several_slots_in_one_batch(client, nutrition_ctx):
    starts = datetime.now(timezone.utc) + timedelta(days=1)
    slots = [
        {"starts_at": _iso(starts + timedelta(hours=h)), "ends_at": _iso(starts + timedelta(hours=h, minutes=30))}
        for h in (9, 10, 11)
    ]
    res = await client.post(
        f"/clubs/{nutrition_ctx['club'].id}/nutrition-slots",
        json={"slots": slots},
        headers=nutrition_ctx["nutri_headers"],
    )
    assert res.status_code == 201, res.text
    assert len(res.json()) == 3
    assert all(s["status"] == "libre" for s in res.json())


async def test_an_end_before_the_start_is_rejected(client, nutrition_ctx):
    starts = datetime.now(timezone.utc) + timedelta(days=1)
    res = await client.post(
        f"/clubs/{nutrition_ctx['club'].id}/nutrition-slots",
        json={"slots": [{"starts_at": _iso(starts), "ends_at": _iso(starts - timedelta(minutes=1))}]},
        headers=nutrition_ctx["nutri_headers"],
    )
    assert res.status_code == 400


async def test_a_player_only_sees_free_slots_by_default(client, nutrition_ctx):
    free_slot = await _publish_slot(client, nutrition_ctx, starts_in_hours=24)
    taken_slot = await _publish_slot(client, nutrition_ctx, starts_in_hours=48)
    await client.post(
        f"/nutrition-slots/{taken_slot['id']}/book", json={}, headers=nutrition_ctx["player_headers"]
    )

    res = await client.get(
        f"/clubs/{nutrition_ctx['club'].id}/nutrition-slots", headers=nutrition_ctx["player_headers"]
    )
    assert res.status_code == 200, res.text
    ids = {s["id"] for s in res.json()}
    assert free_slot["id"] in ids
    assert taken_slot["id"] not in ids


async def test_the_nutritionist_sees_every_status_by_default(client, nutrition_ctx):
    slot = await _publish_slot(client, nutrition_ctx)
    await client.post(f"/nutrition-slots/{slot['id']}/book", json={}, headers=nutrition_ctx["player_headers"])

    res = await client.get(
        f"/clubs/{nutrition_ctx['club'].id}/nutrition-slots", headers=nutrition_ctx["nutri_headers"]
    )
    body = res.json()
    assert any(s["id"] == slot["id"] and s["status"] == "reservado" for s in body)


# ── Reserva ───────────────────────────────────────────────────────────────────

async def test_booking_a_free_slot_notifies_the_player_and_the_nutritionist(client, db, nutrition_ctx):
    slot = await _publish_slot(client, nutrition_ctx)
    res = await client.post(
        f"/nutrition-slots/{slot['id']}/book",
        json={"notes": "Quiero revisar el plan"},
        headers=nutrition_ctx["player_headers"],
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "reservado"
    assert body["player_name"] == "Jugador Uno"
    assert body["notes"] == "Quiero revisar el plan"

    player_notifs = (
        await db.execute(
            select(Notification).where(Notification.user_id == uuid.UUID(nutrition_ctx["player_user_id"]))
        )
    ).scalars().all()
    assert len(player_notifs) == 1

    nutri_notifs = (
        await db.execute(select(Notification).where(Notification.user_id == nutrition_ctx["nutri"].id))
    ).scalars().all()
    assert len(nutri_notifs) == 1
    assert "Jugador Uno" in nutri_notifs[0].body


async def test_two_players_racing_for_the_same_slot_only_one_wins(client, db, nutrition_ctx):
    """El segundo request tiene que ver 409, no una lectura vieja que diga 'libre'."""
    slot = await _publish_slot(client, nutrition_ctx)

    other_res = await client.post(
        f"/divisions/{nutrition_ctx['division'].id}/players",
        json={"name": "Jugador Dos"},
        headers=nutrition_ctx["admin_headers"],
    )
    other_player = other_res.json()
    await client.post(
        f"/divisions/{nutrition_ctx['division'].id}/players/{other_player['id']}/invite",
        json={"email": "jugador2.nutricion@example.com", "password": "secret123"},
        headers=nutrition_ctx["admin_headers"],
    )
    other_tokens = await login(client, "jugador2.nutricion@example.com")
    other_headers = auth_header(other_tokens["access_token"])

    first = await client.post(
        f"/nutrition-slots/{slot['id']}/book", json={}, headers=nutrition_ctx["player_headers"]
    )
    second = await client.post(f"/nutrition-slots/{slot['id']}/book", json={}, headers=other_headers)

    assert first.status_code == 200
    assert second.status_code == 409


async def test_booking_an_already_taken_slot_is_409(client, nutrition_ctx):
    slot = await _publish_slot(client, nutrition_ctx)
    await client.post(f"/nutrition-slots/{slot['id']}/book", json={}, headers=nutrition_ctx["player_headers"])
    res = await client.post(f"/nutrition-slots/{slot['id']}/book", json={}, headers=nutrition_ctx["player_headers"])
    assert res.status_code == 409


async def test_a_user_without_the_capability_cannot_book(client, db, nutrition_ctx):
    outsider = await make_user(
        db, email="analista.sin.nutricion@example.com", role=UserRole.analyst, club_id=nutrition_ctx["club"].id
    )
    tokens = await login(client, outsider.email)
    slot = await _publish_slot(client, nutrition_ctx)
    res = await client.post(
        f"/nutrition-slots/{slot['id']}/book", json={}, headers=auth_header(tokens["access_token"])
    )
    assert res.status_code == 403


# ── Cancelación ───────────────────────────────────────────────────────────────

async def test_a_player_cancelling_their_own_slot_does_not_free_a_new_one(client, db, nutrition_ctx):
    slot = await _publish_slot(client, nutrition_ctx)
    await client.post(f"/nutrition-slots/{slot['id']}/book", json={}, headers=nutrition_ctx["player_headers"])

    res = await client.post(
        f"/nutrition-slots/{slot['id']}/cancel", headers=nutrition_ctx["player_headers"]
    )
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "cancelado"

    rows = (
        await db.execute(
            select(NutritionSlot).where(NutritionSlot.starts_at == datetime.fromisoformat(slot["starts_at"]))
        )
    ).scalars().all()
    assert len(rows) == 1, "el jugador cancela, la nutricionista decide si vuelve a publicar"


async def test_the_nutritionist_cancelling_a_booked_slot_frees_a_new_one_and_notifies(
    client, db, nutrition_ctx
):
    slot = await _publish_slot(client, nutrition_ctx)
    await client.post(f"/nutrition-slots/{slot['id']}/book", json={}, headers=nutrition_ctx["player_headers"])

    res = await client.post(f"/nutrition-slots/{slot['id']}/cancel", headers=nutrition_ctx["nutri_headers"])
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "cancelado"

    rows = (
        await db.execute(
            select(NutritionSlot).where(NutritionSlot.starts_at == datetime.fromisoformat(slot["starts_at"]))
        )
    ).scalars().all()
    assert len(rows) == 2
    assert {r.status.value for r in rows} == {"cancelado", "libre"}

    player_notifs = (
        await db.execute(
            select(Notification).where(Notification.user_id == uuid.UUID(nutrition_ctx["player_user_id"]))
        )
    ).scalars().all()
    assert any("cancelado" in n.title.lower() for n in player_notifs)


async def test_the_nutritionist_cancelling_a_free_slot_removes_it(client, db, nutrition_ctx):
    slot = await _publish_slot(client, nutrition_ctx)
    res = await client.post(f"/nutrition-slots/{slot['id']}/cancel", headers=nutrition_ctx["nutri_headers"])
    assert res.status_code == 200
    assert res.json() is None

    row = await db.scalar(select(NutritionSlot).where(NutritionSlot.id == uuid.UUID(slot["id"])))
    assert row is None


async def test_a_player_cannot_cancel_someone_elses_slot(client, nutrition_ctx):
    slot = await _publish_slot(client, nutrition_ctx)
    await client.post(f"/nutrition-slots/{slot['id']}/book", json={}, headers=nutrition_ctx["player_headers"])

    res = await client.post(
        f"/divisions/{nutrition_ctx['division'].id}/players",
        json={"name": "Jugador Tres"},
        headers=nutrition_ctx["admin_headers"],
    )
    other_player = res.json()
    await client.post(
        f"/divisions/{nutrition_ctx['division'].id}/players/{other_player['id']}/invite",
        json={"email": "jugador3.nutricion@example.com", "password": "secret123"},
        headers=nutrition_ctx["admin_headers"],
    )
    tokens = await login(client, "jugador3.nutricion@example.com")

    res = await client.post(
        f"/nutrition-slots/{slot['id']}/cancel", headers=auth_header(tokens["access_token"])
    )
    assert res.status_code == 403


# ── Mis turnos ────────────────────────────────────────────────────────────────

async def test_my_appointments_lists_only_my_own(client, nutrition_ctx):
    slot = await _publish_slot(client, nutrition_ctx)
    await client.post(f"/nutrition-slots/{slot['id']}/book", json={}, headers=nutrition_ctx["player_headers"])
    await _publish_slot(client, nutrition_ctx, starts_in_hours=72)  # libre, de nadie

    res = await client.get("/me/nutrition-appointments", headers=nutrition_ctx["player_headers"])
    assert res.status_code == 200, res.text
    assert len(res.json()) == 1
    assert res.json()[0]["id"] == slot["id"]


# ── Recordatorio (APScheduler) ───────────────────────────────────────────────

async def test_reminder_sent_inside_the_window_and_not_twice(client, db, nutrition_ctx):
    slot = await _publish_slot(client, nutrition_ctx, starts_in_hours=22)
    await client.post(f"/nutrition-slots/{slot['id']}/book", json={}, headers=nutrition_ctx["player_headers"])

    sent = await send_nutrition_reminders()
    assert sent == 1

    row = await db.scalar(select(NutritionSlot).where(NutritionSlot.id == uuid.UUID(slot["id"])))
    assert row.reminder_sent_at is not None

    reminder_notifs = (
        await db.execute(
            select(Notification).where(
                Notification.user_id == uuid.UUID(nutrition_ctx["player_user_id"]),
                Notification.type == "turno_recordatorio",
            )
        )
    ).scalars().all()
    assert len(reminder_notifs) == 1

    # Corre de nuevo (el job corre cada hora): no se manda un segundo aviso.
    sent_again = await send_nutrition_reminders()
    assert sent_again == 0
    reminder_notifs_after = (
        await db.execute(
            select(Notification).where(
                Notification.user_id == uuid.UUID(nutrition_ctx["player_user_id"]),
                Notification.type == "turno_recordatorio",
            )
        )
    ).scalars().all()
    assert len(reminder_notifs_after) == 1


async def test_reminder_ignores_slots_outside_the_window(client, nutrition_ctx):
    too_soon = await _publish_slot(client, nutrition_ctx, starts_in_hours=5)
    too_far = await _publish_slot(client, nutrition_ctx, starts_in_hours=72)
    await client.post(f"/nutrition-slots/{too_soon['id']}/book", json={}, headers=nutrition_ctx["player_headers"])
    await client.post(f"/nutrition-slots/{too_far['id']}/book", json={}, headers=nutrition_ctx["player_headers"])

    sent = await send_nutrition_reminders()
    assert sent == 0


async def test_reminder_ignores_free_and_cancelled_slots(client, nutrition_ctx):
    free_slot = await _publish_slot(client, nutrition_ctx, starts_in_hours=22)
    cancelled_slot = await _publish_slot(client, nutrition_ctx, starts_in_hours=23)
    await client.post(
        f"/nutrition-slots/{cancelled_slot['id']}/book", json={}, headers=nutrition_ctx["player_headers"]
    )
    await client.post(f"/nutrition-slots/{cancelled_slot['id']}/cancel", headers=nutrition_ctx["player_headers"])

    sent = await send_nutrition_reminders()
    assert sent == 0
