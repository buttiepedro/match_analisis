"""
Lesiones y disponibilidad.

`players.availability` está desnormalizado, así que lo que más importa acá es que
no se desincronice de las lesiones abiertas.
"""
from datetime import date, timedelta

import pytest

from tests.conftest import make_division


@pytest.fixture
async def injury_ctx(client, db, club_admin_ctx):
    division = await make_division(db, club_admin_ctx["club"].id)
    res = await client.post(
        f"/divisions/{division.id}/players",
        json={"name": "Ana Perez"},
        headers=club_admin_ctx["headers"],
    )
    assert res.status_code == 201, res.text
    return {
        "division": division,
        "player": res.json(),
        "headers": club_admin_ctx["headers"],
    }


async def _availability(client, ctx) -> dict:
    res = await client.get(
        f"/divisions/{ctx['division'].id}/availability", headers=ctx["headers"]
    )
    assert res.status_code == 200, res.text
    return {r["player_name"]: r for r in res.json()}


async def test_a_player_starts_available(client, injury_ctx):
    rows = await _availability(client, injury_ctx)
    assert rows["Ana Perez"]["availability"] == "disponible"
    assert rows["Ana Perez"]["clearance_expired"] is False


async def test_an_open_injury_marks_the_player_injured(client, injury_ctx):
    res = await client.post(
        f"/players/{injury_ctx['player']['id']}/injuries",
        json={"injury_date": date.today().isoformat(), "body_zone": "rodilla", "severity": "grave"},
        headers=injury_ctx["headers"],
    )
    assert res.status_code == 201, res.text

    rows = await _availability(client, injury_ctx)
    assert rows["Ana Perez"]["availability"] == "lesionado"


async def test_closing_an_injury_frees_the_player(client, injury_ctx):
    res = await client.post(
        f"/players/{injury_ctx['player']['id']}/injuries",
        json={"injury_date": date.today().isoformat()},
        headers=injury_ctx["headers"],
    )
    injury_id = res.json()["id"]

    res = await client.patch(
        f"/injuries/{injury_id}",
        json={"actual_return": date.today().isoformat()},
        headers=injury_ctx["headers"],
    )
    assert res.status_code == 200, res.text

    rows = await _availability(client, injury_ctx)
    assert rows["Ana Perez"]["availability"] == "disponible"


async def test_a_second_open_injury_keeps_the_player_injured(client, injury_ctx):
    """Cerrar una de dos lesiones no lo devuelve a la cancha."""
    player_id = injury_ctx["player"]["id"]
    res = await client.post(
        f"/players/{player_id}/injuries",
        json={"injury_date": date.today().isoformat(), "body_zone": "rodilla"},
        headers=injury_ctx["headers"],
    )
    first_id = res.json()["id"]
    await client.post(
        f"/players/{player_id}/injuries",
        json={"injury_date": date.today().isoformat(), "body_zone": "hombro"},
        headers=injury_ctx["headers"],
    )

    await client.patch(
        f"/injuries/{first_id}",
        json={"actual_return": date.today().isoformat()},
        headers=injury_ctx["headers"],
    )

    rows = await _availability(client, injury_ctx)
    assert rows["Ana Perez"]["availability"] == "lesionado"


async def test_deleting_the_last_open_injury_frees_the_player(client, injury_ctx):
    res = await client.post(
        f"/players/{injury_ctx['player']['id']}/injuries",
        json={"injury_date": date.today().isoformat()},
        headers=injury_ctx["headers"],
    )
    injury_id = res.json()["id"]

    res = await client.delete(f"/injuries/{injury_id}", headers=injury_ctx["headers"])
    assert res.status_code == 204

    rows = await _availability(client, injury_ctx)
    assert rows["Ana Perez"]["availability"] == "disponible"


async def test_a_suspension_survives_an_injury_being_closed(client, injury_ctx):
    """La suspensión la decide el club por tarjeta roja, no el parte médico."""
    player_id = injury_ctx["player"]["id"]
    res = await client.patch(
        f"/players/{player_id}/availability",
        json={"availability": "suspendido"},
        headers=injury_ctx["headers"],
    )
    assert res.status_code == 200, res.text

    res = await client.post(
        f"/players/{player_id}/injuries",
        json={"injury_date": date.today().isoformat()},
        headers=injury_ctx["headers"],
    )
    injury_id = res.json()["id"]
    await client.patch(
        f"/injuries/{injury_id}",
        json={"actual_return": date.today().isoformat()},
        headers=injury_ctx["headers"],
    )

    rows = await _availability(client, injury_ctx)
    assert rows["Ana Perez"]["availability"] == "suspendido"


# ── Apto médico ───────────────────────────────────────────────────────────────

async def test_an_expired_clearance_is_flagged(client, injury_ctx):
    await client.patch(
        f"/players/{injury_ctx['player']['id']}/availability",
        json={"medical_clearance_expires": (date.today() - timedelta(days=1)).isoformat()},
        headers=injury_ctx["headers"],
    )

    rows = await _availability(client, injury_ctx)
    assert rows["Ana Perez"]["clearance_expired"] is True
    assert rows["Ana Perez"]["clearance_expiring"] is False


async def test_a_clearance_expiring_within_30_days_is_flagged(client, injury_ctx):
    await client.patch(
        f"/players/{injury_ctx['player']['id']}/availability",
        json={"medical_clearance_expires": (date.today() + timedelta(days=10)).isoformat()},
        headers=injury_ctx["headers"],
    )

    rows = await _availability(client, injury_ctx)
    assert rows["Ana Perez"]["clearance_expiring"] is True
    assert rows["Ana Perez"]["clearance_expired"] is False


async def test_a_clearance_far_from_expiring_is_not_flagged(client, injury_ctx):
    await client.patch(
        f"/players/{injury_ctx['player']['id']}/availability",
        json={"medical_clearance_expires": (date.today() + timedelta(days=200)).isoformat()},
        headers=injury_ctx["headers"],
    )

    rows = await _availability(client, injury_ctx)
    assert rows["Ana Perez"]["clearance_expiring"] is False
    assert rows["Ana Perez"]["clearance_expired"] is False


async def test_only_unavailable_filters_out_healthy_players(client, db, injury_ctx):
    await client.post(
        f"/divisions/{injury_ctx['division'].id}/players",
        json={"name": "Bruno Sano"},
        headers=injury_ctx["headers"],
    )
    await client.post(
        f"/players/{injury_ctx['player']['id']}/injuries",
        json={"injury_date": date.today().isoformat()},
        headers=injury_ctx["headers"],
    )

    res = await client.get(
        f"/divisions/{injury_ctx['division'].id}/availability",
        params={"only_unavailable": True},
        headers=injury_ctx["headers"],
    )
    assert [r["player_name"] for r in res.json()] == ["Ana Perez"]


async def test_another_club_cannot_read_availability(client, db, injury_ctx):
    from app.models import UserRole
    from tests.conftest import auth_header, login, make_club, make_user

    other_club = await make_club(db, name="Otro", slug="otro-inj")
    await make_user(db, email="otro3@example.com", role=UserRole.club_admin, club_id=other_club.id)
    tokens = await login(client, "otro3@example.com")

    res = await client.get(
        f"/divisions/{injury_ctx['division'].id}/availability",
        headers=auth_header(tokens["access_token"]),
    )
    assert res.status_code == 403
