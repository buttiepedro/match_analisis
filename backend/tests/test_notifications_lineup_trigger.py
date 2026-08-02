"""
Disparador de "formación cargada".

Se dispara desde `PUT /sessions/{id}/lineup`, sólo en la transición de "sin
lineup" a "con lineup" del equipo **propio** — no en cada corrección, y no
por el lineup del rival. Ver [[add-notificaciones-push]].
"""
import uuid

import pytest
from sqlalchemy import select

from app.models import Notification

from tests.conftest import make_division, make_tournament


@pytest.fixture
async def formation_ctx(client, db, club_admin_ctx):
    """
    Una división con tres jugadores invitados al portal (destinatarios
    posibles) y uno sin invitar (no debería recibir nada, no tiene `user_id`).
    """
    club = club_admin_ctx["club"]
    division = await make_division(db, club.id)
    tournament = await make_tournament(db, club.id, division.id)
    headers = club_admin_ctx["headers"]

    res = await client.post(
        f"/tournaments/{tournament.id}/sessions",
        json={"home_team": "Club Test", "away_team": "Boca Rugby"},
        headers=headers,
    )
    assert res.status_code == 201, res.text
    session_id = res.json()["id"]

    invited = []
    for i, name in enumerate(("Convocado", "Suplente afuera", "Sin invitar")):
        res = await client.post(
            f"/divisions/{division.id}/players",
            json={"name": name},
            headers=headers,
        )
        player = res.json()
        if i < 2:  # el tercero se queda sin invitar a propósito
            res = await client.post(
                f"/divisions/{division.id}/players/{player['id']}/invite",
                json={"email": f"jugador{i}.formacion@example.com", "password": "secret123"},
                headers=headers,
            )
            assert res.status_code == 200, res.text
            player["user_id"] = res.json()["user_id"]
        invited.append(player)

    return {
        "club": club,
        "division": division,
        "session_id": session_id,
        "players": invited,
        "headers": headers,
    }


def _entry(player_id, jersey):
    return {"player_id": player_id, "jersey_number": jersey, "status": "on_field"}


async def _notifications_for(db, user_id):
    return (
        await db.execute(
            select(Notification).where(Notification.user_id == uuid.UUID(str(user_id)))
        )
    ).scalars().all()


async def test_loading_the_formation_notifies_every_invited_player_not_only_the_23(
    client, db, formation_ctx
):
    """El suplente que quedó afuera de la grilla también quiere enterarse."""
    convocado, afuera, sin_invitar = formation_ctx["players"]

    res = await client.put(
        f"/sessions/{formation_ctx['session_id']}/lineup",
        json={"team": "user", "entries": [_entry(convocado["id"], 1)]},
        headers=formation_ctx["headers"],
    )
    assert res.status_code == 200, res.text

    convocado_notifs = await _notifications_for(db, convocado["user_id"])
    assert len(convocado_notifs) == 1
    assert "Boca Rugby" in convocado_notifs[0].body
    # No es /sessions/{id}/lineup: ese endpoint exige partido.lineup, que
    # ningún jugador tiene — el link tiene que llevar a algo que pueda abrir.
    assert convocado_notifs[0].data["url"] == f"/mi-formacion/{formation_ctx['session_id']}"

    afuera_notifs = await _notifications_for(db, afuera["user_id"])
    assert len(afuera_notifs) == 1

    # El tercero nunca fue invitado: no tiene user_id, no hay a quién avisarle.
    assert sin_invitar.get("user_id") is None


async def test_a_correction_does_not_send_a_second_notification(client, db, formation_ctx):
    convocado = formation_ctx["players"][0]

    await client.put(
        f"/sessions/{formation_ctx['session_id']}/lineup",
        json={"team": "user", "entries": [_entry(convocado["id"], 1)]},
        headers=formation_ctx["headers"],
    )
    # Corrección: mismo jugador, otro número.
    res = await client.put(
        f"/sessions/{formation_ctx['session_id']}/lineup",
        json={"team": "user", "entries": [_entry(convocado["id"], 8)]},
        headers=formation_ctx["headers"],
    )
    assert res.status_code == 200, res.text

    assert len(await _notifications_for(db, convocado["user_id"])) == 1


async def test_loading_the_rival_lineup_does_not_notify(client, db, formation_ctx):
    convocado = formation_ctx["players"][0]

    res = await client.put(
        f"/sessions/{formation_ctx['session_id']}/lineup",
        json={"team": "rival", "entries": [_entry(convocado["id"], 1)]},
        headers=formation_ctx["headers"],
    )
    assert res.status_code == 200, res.text
    assert await _notifications_for(db, convocado["user_id"]) == []


async def test_a_broken_notification_service_does_not_block_saving_the_lineup(
    client, db, formation_ctx, monkeypatch
):
    """Guardar la formación es lo que el entrenador vino a hacer; un fallo del
    servicio de avisos no puede impedirlo."""
    import app.api.v1.lineup as modulo

    async def boom(*args, **kwargs):
        raise RuntimeError("el servicio de notificaciones está caído")

    monkeypatch.setattr(modulo, "notify", boom)

    convocado = formation_ctx["players"][0]
    res = await client.put(
        f"/sessions/{formation_ctx['session_id']}/lineup",
        json={"team": "user", "entries": [_entry(convocado["id"], 1)]},
        headers=formation_ctx["headers"],
    )
    assert res.status_code == 200, res.text
    assert len(res.json()) == 1
