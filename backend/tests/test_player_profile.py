"""
Perfil completo del jugador — lo que `/me/player` no mostraba.

El foco no es "el dato existe" (ya existía en `players`), es que **sólo** el
propio jugador lo vea, que la edición respete la whitelist, y que el apto
vencido/por vencer salga calculado y no obligue al jugador a restar fechas.
"""
from datetime import date, timedelta

import pytest

from tests.conftest import auth_header, login, make_division


@pytest.fixture
async def player_profile_ctx(client, db, club_admin_ctx):
    club = club_admin_ctx["club"]
    division = await make_division(db, club.id)
    admin_headers = club_admin_ctx["headers"]

    res = await client.post(
        f"/divisions/{division.id}/players",
        json={"name": "Portal Jugador"},
        headers=admin_headers,
    )
    assert res.status_code == 201, res.text
    player = res.json()

    # El alta sólo pide nombre/posición/DNI; el contacto se completa después
    # editando la ficha — así lo hace el formulario real de Squad.tsx.
    res = await client.patch(
        f"/divisions/{division.id}/players/{player['id']}",
        json={"phone": "11-0000-0000", "obra_social": "OSDE"},
        headers=admin_headers,
    )
    assert res.status_code == 200, res.text
    player = res.json()

    res = await client.post(
        f"/divisions/{division.id}/players/{player['id']}/invite",
        json={"email": "perfil@example.com", "password": "secret123"},
        headers=admin_headers,
    )
    assert res.status_code == 200, res.text

    tokens = await login(client, "perfil@example.com")

    return {
        "club": club,
        "division": division,
        "player": player,
        "admin_headers": admin_headers,
        "headers": auth_header(tokens["access_token"]),
    }


# ── Fase A: /me/player completo ─────────────────────────────────────────────

async def test_me_player_exposes_contact_and_health_data(client, player_profile_ctx):
    res = await client.get("/me/player", headers=player_profile_ctx["headers"])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["phone"] == "11-0000-0000"
    assert body["obra_social"] == "OSDE"
    assert body["clearance_expired"] is False
    assert body["clearance_expiring"] is False


async def test_me_player_flags_an_expired_clearance(client, db, player_profile_ctx):
    # El apto se carga desde el módulo de lesiones, no desde el ABM de plantel.
    await client.patch(
        f"/players/{player_profile_ctx['player']['id']}/availability",
        json={"medical_clearance_expires": (date.today() - timedelta(days=5)).isoformat()},
        headers=player_profile_ctx["admin_headers"],
    )

    res = await client.get("/me/player", headers=player_profile_ctx["headers"])
    assert res.status_code == 200, res.text
    assert res.json()["clearance_expired"] is True
    assert res.json()["clearance_expiring"] is False


async def test_me_player_flags_a_clearance_expiring_soon(client, player_profile_ctx):
    await client.patch(
        f"/players/{player_profile_ctx['player']['id']}/availability",
        json={"medical_clearance_expires": (date.today() + timedelta(days=10)).isoformat()},
        headers=player_profile_ctx["admin_headers"],
    )

    res = await client.get("/me/player", headers=player_profile_ctx["headers"])
    assert res.json()["clearance_expiring"] is True
    assert res.json()["clearance_expired"] is False


# ── Fase B: historial ────────────────────────────────────────────────────────

async def test_division_history_is_empty_without_a_move(client, player_profile_ctx):
    res = await client.get("/me/player/division-history", headers=player_profile_ctx["headers"])
    assert res.status_code == 200
    assert res.json() == []


async def test_division_history_shows_a_move(client, db, player_profile_ctx):
    other = await make_division(db, player_profile_ctx["club"].id, name="Otra")
    res = await client.patch(
        "/players/batch-move",
        json={
            "player_ids": [player_profile_ctx["player"]["id"]],
            "to_division_id": str(other.id),
        },
        headers=player_profile_ctx["admin_headers"],
    )
    assert res.status_code == 200, res.text

    res = await client.get("/me/player/division-history", headers=player_profile_ctx["headers"])
    assert res.status_code == 200, res.text
    body = res.json()
    assert len(body) == 1
    assert body[0]["division_name"] == "Otra"
    assert body[0]["to_date"] is None


async def test_injuries_only_lists_closed_ones(client, db, player_profile_ctx):
    player_id = player_profile_ctx["player"]["id"]

    await client.post(
        f"/players/{player_id}/injuries",
        json={"injury_date": "2026-06-01", "body_zone": "Rodilla", "severity": "moderada"},
        headers=player_profile_ctx["admin_headers"],
    )
    res = await client.post(
        f"/players/{player_id}/injuries",
        json={
            "injury_date": "2026-01-01",
            "body_zone": "Tobillo",
            "severity": "leve",
            "actual_return": "2026-01-20",
        },
        headers=player_profile_ctx["admin_headers"],
    )
    assert res.status_code == 201, res.text

    res = await client.get("/me/player/injuries", headers=player_profile_ctx["headers"])
    assert res.status_code == 200, res.text
    body = res.json()
    assert len(body) == 1
    assert body[0]["body_zone"] == "Tobillo"
    assert body[0]["actual_return"] == "2026-01-20"


async def test_injuries_is_empty_not_an_error_without_any(client, player_profile_ctx):
    res = await client.get("/me/player/injuries", headers=player_profile_ctx["headers"])
    assert res.status_code == 200
    assert res.json() == []


# ── Fase C: edición ───────────────────────────────────────────────────────────

async def test_a_player_edits_their_own_contact(client, player_profile_ctx):
    res = await client.patch(
        "/me/player",
        json={"phone": "11-9999-9999", "emergency_phone": "11-8888-8888"},
        headers=player_profile_ctx["headers"],
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["phone"] == "11-9999-9999"
    assert body["emergency_phone"] == "11-8888-8888"


async def test_editing_a_field_outside_the_whitelist_is_rejected(client, player_profile_ctx):
    """Un 422 explícito, no un 200 que no cambió nada."""
    res = await client.patch(
        "/me/player", json={"dni": "99999999"}, headers=player_profile_ctx["headers"]
    )
    assert res.status_code == 422


async def test_editing_availability_via_the_profile_endpoint_is_rejected(client, player_profile_ctx):
    """`availability` la escribe únicamente el módulo de lesiones."""
    res = await client.patch(
        "/me/player", json={"availability": "lesionado"}, headers=player_profile_ctx["headers"]
    )
    assert res.status_code == 422


# ── Nadie ve la ficha de otro ─────────────────────────────────────────────────

async def test_a_player_only_ever_sees_their_own_profile(client, db, player_profile_ctx):
    """
    No hay ningún `id` en la URL de estos cuatro endpoints — por diseño, no
    porque el test lo fuerce. Confirma que el segundo jugador invitado no ve
    nada del primero.
    """
    res = await client.post(
        f"/divisions/{player_profile_ctx['division'].id}/players",
        json={"name": "Otro Jugador"},
        headers=player_profile_ctx["admin_headers"],
    )
    other_player = res.json()
    await client.post(
        f"/divisions/{player_profile_ctx['division'].id}/players/{other_player['id']}/invite",
        json={"email": "otro.perfil@example.com", "password": "secret123"},
        headers=player_profile_ctx["admin_headers"],
    )
    tokens = await login(client, "otro.perfil@example.com")
    other_headers = auth_header(tokens["access_token"])

    res = await client.get("/me/player", headers=other_headers)
    assert res.status_code == 200
    assert res.json()["id"] == other_player["id"]
    assert res.json()["id"] != player_profile_ctx["player"]["id"]
