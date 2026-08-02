"""
Servicio de notificaciones: bandeja siempre, push best-effort.

Lo que importa acá no es que el push salga bonito — es que el opt-out corte
todo (ni guarda ni empuja), que una suscripción vencida se desactive sola, y
que un sender que explota no se lleve puesta la bandeja ni el flujo que
llamó a `notify()`.
"""
import uuid
from types import SimpleNamespace

import pytest
from pywebpush import WebPushException
from sqlalchemy import select

from app.core.notifications import notify
from app.models import Notification, NotificationDevice, NotificationPreference, NotificationType

from tests.conftest import auth_header, login, make_user


# ── Doble del sender de Web Push ────────────────────────────────────────────

@pytest.fixture
def fake_webpush(monkeypatch):
    """
    Reemplaza `webpush()` de `pywebpush`. Los tests no pueden depender de un
    servidor de push real, pero sí tienen que ejercitar qué hace `notify()`
    con cada resultado posible del sender.
    """
    import app.core.notifications as modulo

    calls: list[dict] = []
    behavior = {"mode": "success"}

    def fake(*, subscription_info, data, vapid_private_key, vapid_claims):
        calls.append({"subscription_info": subscription_info, "data": data})
        if behavior["mode"] == "success":
            return None
        if behavior["mode"] == "expired":
            raise WebPushException("gone", response=SimpleNamespace(status_code=410))
        raise RuntimeError("el servidor de push está caído")

    monkeypatch.setattr(modulo, "webpush", fake)
    # Sin esto `WebPushSender.send` vuelve apenas entra, antes de llamar a
    # `webpush()`, porque interpreta que el push no está configurado.
    monkeypatch.setattr(modulo.settings, "VAPID_PRIVATE_KEY", "test-private-key")
    monkeypatch.setattr(modulo.settings, "VAPID_SUBJECT", "mailto:test@example.com")
    return calls, behavior


@pytest.fixture
async def notif_ctx(client, db, club_admin_ctx):
    # El destinatario de una notificación no necesita ningún rol de club en
    # particular, así que se reusa el admin en vez de armar uno nuevo.
    return {
        "club": club_admin_ctx["club"],
        "user": club_admin_ctx["user"],
        "headers": club_admin_ctx["headers"],
    }


async def _add_device(db, user_id, *, endpoint="https://push.example.com/abc", is_active=True):
    device = NotificationDevice(
        id=uuid.uuid4(),
        user_id=user_id,
        endpoint=endpoint,
        p256dh="p256dh-key",
        auth_secret="auth-secret",
        is_active=is_active,
    )
    db.add(device)
    await db.commit()
    await db.refresh(device)
    return device


# ── notify(): opt-out y bandeja ─────────────────────────────────────────────

async def test_notify_saves_to_the_inbox(db, notif_ctx):
    await notify(
        db,
        user_id=notif_ctx["user"].id,
        club_id=notif_ctx["club"].id,
        type=NotificationType.formacion_cargada,
        title="Formación de Primera",
        body="Ya está la formación.",
        data={"session_id": "s1"},
    )
    rows = (
        await db.execute(select(Notification).where(Notification.user_id == notif_ctx["user"].id))
    ).scalars().all()
    assert len(rows) == 1
    assert rows[0].title == "Formación de Primera"
    assert rows[0].data == {"session_id": "s1"}
    assert rows[0].read_at is None


async def test_opt_out_saves_nothing_and_pushes_nothing(db, notif_ctx, fake_webpush):
    calls, _ = fake_webpush
    await _add_device(db, notif_ctx["user"].id)
    db.add(
        NotificationPreference(
            id=uuid.uuid4(),
            user_id=notif_ctx["user"].id,
            type=NotificationType.formacion_cargada.value,
            enabled=False,
        )
    )
    await db.commit()

    await notify(
        db,
        user_id=notif_ctx["user"].id,
        club_id=notif_ctx["club"].id,
        type=NotificationType.formacion_cargada,
        title="x",
        body="y",
    )

    rows = (
        await db.execute(select(Notification).where(Notification.user_id == notif_ctx["user"].id))
    ).scalars().all()
    assert rows == []
    assert calls == []


async def test_no_preference_row_means_enabled(db, notif_ctx):
    """Sin fila = habilitado: opt-in por defecto."""
    await notify(
        db,
        user_id=notif_ctx["user"].id,
        club_id=notif_ctx["club"].id,
        type=NotificationType.formacion_cargada,
        title="x",
        body="y",
    )
    count = (
        await db.execute(select(Notification).where(Notification.user_id == notif_ctx["user"].id))
    ).scalars().all()
    assert len(count) == 1


# ── notify(): despacho a devices ────────────────────────────────────────────

async def test_a_successful_push_reaches_the_sender(db, notif_ctx, fake_webpush):
    calls, _ = fake_webpush
    await _add_device(db, notif_ctx["user"].id)

    await notify(
        db,
        user_id=notif_ctx["user"].id,
        club_id=notif_ctx["club"].id,
        type=NotificationType.formacion_cargada,
        title="Formación de Primera",
        body="Ya está.",
    )
    assert len(calls) == 1


async def test_an_expired_subscription_deactivates_its_device(db, notif_ctx, fake_webpush):
    _, behavior = fake_webpush
    behavior["mode"] = "expired"
    device = await _add_device(db, notif_ctx["user"].id)

    await notify(
        db,
        user_id=notif_ctx["user"].id,
        club_id=notif_ctx["club"].id,
        type=NotificationType.formacion_cargada,
        title="x",
        body="y",
    )

    await db.refresh(device)
    assert device.is_active is False


async def test_an_unrelated_sender_error_does_not_raise_and_keeps_the_device_active(
    db, notif_ctx, fake_webpush
):
    """Un push es best-effort: un 5xx del lado del servidor de push no reintenta ni tira nada."""
    _, behavior = fake_webpush
    behavior["mode"] = "boom"
    device = await _add_device(db, notif_ctx["user"].id)

    await notify(  # no debe lanzar
        db,
        user_id=notif_ctx["user"].id,
        club_id=notif_ctx["club"].id,
        type=NotificationType.formacion_cargada,
        title="x",
        body="y",
    )

    await db.refresh(device)
    assert device.is_active is True
    # La bandeja se guardó igual: el fallo fue del push, no de guardar el aviso.
    rows = (
        await db.execute(select(Notification).where(Notification.user_id == notif_ctx["user"].id))
    ).scalars().all()
    assert len(rows) == 1


async def test_inactive_devices_are_not_pushed_to(db, notif_ctx, fake_webpush):
    calls, _ = fake_webpush
    await _add_device(db, notif_ctx["user"].id, is_active=False)

    await notify(
        db,
        user_id=notif_ctx["user"].id,
        club_id=notif_ctx["club"].id,
        type=NotificationType.formacion_cargada,
        title="x",
        body="y",
    )
    assert calls == []


# ── Endpoints: VAPID ─────────────────────────────────────────────────────────

async def test_vapid_key_endpoint_is_501_when_unconfigured(client, notif_ctx):
    res = await client.get("/push/vapid-public-key", headers=notif_ctx["headers"])
    assert res.status_code == 501


async def test_vapid_key_endpoint_returns_the_configured_key(client, notif_ctx, monkeypatch):
    import app.api.v1.notifications as modulo

    monkeypatch.setattr(modulo.settings, "VAPID_PUBLIC_KEY", "clave-publica-de-prueba")
    res = await client.get("/push/vapid-public-key", headers=notif_ctx["headers"])
    assert res.status_code == 200
    assert res.json()["public_key"] == "clave-publica-de-prueba"


# ── Endpoints: dispositivos ──────────────────────────────────────────────────

async def test_registering_the_same_endpoint_twice_reactivates_instead_of_duplicating(
    client, db, notif_ctx
):
    body = {"endpoint": "https://push.example.com/xyz", "p256dh": "a", "auth_secret": "b"}
    first = await client.post("/me/notification-devices", json=body, headers=notif_ctx["headers"])
    assert first.status_code == 201, first.text

    second = await client.post("/me/notification-devices", json=body, headers=notif_ctx["headers"])
    assert second.status_code == 201, second.text
    assert second.json()["id"] == first.json()["id"]

    rows = (
        await db.execute(
            select(NotificationDevice).where(NotificationDevice.user_id == notif_ctx["user"].id)
        )
    ).scalars().all()
    assert len(rows) == 1


async def test_a_user_cannot_delete_another_users_device(client, db, notif_ctx):
    other = await make_user(
        db, email="otro.notif@example.com", role=notif_ctx["user"].role, club_id=notif_ctx["club"].id
    )
    device = await _add_device(db, notif_ctx["user"].id)

    tokens = await login(client, other.email)
    res = await client.delete(
        f"/me/notification-devices/{device.id}", headers=auth_header(tokens["access_token"])
    )
    assert res.status_code == 404

    res = await client.delete(f"/me/notification-devices/{device.id}", headers=notif_ctx["headers"])
    assert res.status_code == 204


# ── Endpoints: bandeja ───────────────────────────────────────────────────────

async def test_unread_count_and_list_filter(client, db, notif_ctx):
    for i in range(3):
        await notify(
            db,
            user_id=notif_ctx["user"].id,
            club_id=notif_ctx["club"].id,
            type=NotificationType.formacion_cargada,
            title=f"Aviso {i}",
            body="x",
        )

    res = await client.get("/me/notifications/unread-count", headers=notif_ctx["headers"])
    assert res.json() == {"count": 3}

    all_notifs = (await client.get("/me/notifications", headers=notif_ctx["headers"])).json()
    assert len(all_notifs) == 3

    await client.post(f"/me/notifications/{all_notifs[0]['id']}/read", headers=notif_ctx["headers"])

    res = await client.get("/me/notifications/unread-count", headers=notif_ctx["headers"])
    assert res.json() == {"count": 2}

    unread = (
        await client.get("/me/notifications", params={"unread": True}, headers=notif_ctx["headers"])
    ).json()
    assert len(unread) == 2


async def test_a_user_cannot_mark_another_users_notification_as_read(client, db, notif_ctx):
    other = await make_user(
        db, email="otro.bandeja@example.com", role=notif_ctx["user"].role, club_id=notif_ctx["club"].id
    )
    await notify(
        db,
        user_id=notif_ctx["user"].id,
        club_id=notif_ctx["club"].id,
        type=NotificationType.formacion_cargada,
        title="x",
        body="y",
    )
    mine = (await client.get("/me/notifications", headers=notif_ctx["headers"])).json()[0]

    tokens = await login(client, other.email)
    res = await client.post(
        f"/me/notifications/{mine['id']}/read", headers=auth_header(tokens["access_token"])
    )
    assert res.status_code == 404


# ── Endpoints: preferencias ──────────────────────────────────────────────────

async def test_preferences_default_to_enabled(client, notif_ctx):
    res = await client.get("/me/notification-preferences", headers=notif_ctx["headers"])
    assert res.status_code == 200
    body = res.json()
    assert {"type": "formacion_cargada", "enabled": True} in body


async def test_disabling_a_type_stops_both_the_inbox_and_the_push(client, db, notif_ctx, fake_webpush):
    calls, _ = fake_webpush
    await _add_device(db, notif_ctx["user"].id)

    res = await client.put(
        "/me/notification-preferences",
        json={"preferences": [{"type": "formacion_cargada", "enabled": False}]},
        headers=notif_ctx["headers"],
    )
    assert res.status_code == 200
    assert {"type": "formacion_cargada", "enabled": False} in res.json()

    await notify(
        db,
        user_id=notif_ctx["user"].id,
        club_id=notif_ctx["club"].id,
        type=NotificationType.formacion_cargada,
        title="x",
        body="y",
    )
    assert calls == []
    rows = (
        await db.execute(select(Notification).where(Notification.user_id == notif_ctx["user"].id))
    ).scalars().all()
    assert rows == []


async def test_an_unknown_preference_type_is_ignored_not_rejected(client, notif_ctx):
    res = await client.put(
        "/me/notification-preferences",
        json={"preferences": [{"type": "algo_inventado", "enabled": False}]},
        headers=notif_ctx["headers"],
    )
    assert res.status_code == 200
    assert all(p["type"] != "algo_inventado" for p in res.json())
