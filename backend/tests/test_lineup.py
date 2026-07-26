"""
Lineup: aislamiento entre clubes y unicidad del número de camiseta.

Las dos garantías que sostienen la atribución de estadísticas — los eventos se
asocian al jugador por `player_number`, así que un duplicado las ensucia sin
avisar, y un jugador ajeno en el lineup contamina los datos de otro club.
"""
import pytest

from app.models import UserRole

from tests.conftest import (
    auth_header,
    login,
    make_club,
    make_division,
    make_tournament,
    make_user,
)


@pytest.fixture
async def lineup_ctx(client, db, club_admin_ctx):
    """Sesión del club propio + dos jugadores propios listos para convocar."""
    club = club_admin_ctx["club"]
    division = await make_division(db, club.id)
    tournament = await make_tournament(db, club.id, division.id)

    res = await client.post(
        f"/tournaments/{tournament.id}/sessions",
        json={"home_team": "Club Test", "away_team": "Rival"},
        headers=club_admin_ctx["headers"],
    )
    assert res.status_code == 201, res.text
    session_id = res.json()["id"]

    players = []
    for name in ("Jugador Uno", "Jugador Dos"):
        res = await client.post(
            f"/divisions/{division.id}/players",
            json={"name": name},
            headers=club_admin_ctx["headers"],
        )
        assert res.status_code == 201, res.text
        players.append(res.json())

    return {
        "session_id": session_id,
        "division": division,
        "players": players,
        "headers": club_admin_ctx["headers"],
    }


# ── Aislamiento entre clubes ──────────────────────────────────────────────────

async def test_cannot_add_a_player_from_another_club_to_own_lineup(client, db, lineup_ctx):
    """
    El chequeo de acceso valida el club de la *sesión*, pero el jugador se
    buscaba solo por UUID: alcanzaba con conocerlo para sumarlo a un lineup ajeno.
    """
    other_club = await make_club(db, name="Otro Club", slug="otro-club")
    other_division = await make_division(db, other_club.id)
    other_admin = await make_user(
        db, email="otro@example.com", role=UserRole.club_admin, club_id=other_club.id
    )
    other_tokens = await login(client, other_admin.email)

    res = await client.post(
        f"/divisions/{other_division.id}/players",
        json={"name": "Jugador Ajeno"},
        headers=auth_header(other_tokens["access_token"]),
    )
    assert res.status_code == 201, res.text
    foreign_player_id = res.json()["id"]

    res = await client.post(
        f"/sessions/{lineup_ctx['session_id']}/lineup",
        json={"player_id": foreign_player_id, "jersey_number": 10},
        headers=lineup_ctx["headers"],
    )
    assert res.status_code == 404


# ── Unicidad de camiseta ──────────────────────────────────────────────────────

async def test_duplicate_jersey_in_the_same_team_is_rejected(client, lineup_ctx):
    first, second = lineup_ctx["players"]

    res = await client.post(
        f"/sessions/{lineup_ctx['session_id']}/lineup",
        json={"player_id": first["id"], "jersey_number": 10, "team": "user"},
        headers=lineup_ctx["headers"],
    )
    assert res.status_code == 201, res.text

    res = await client.post(
        f"/sessions/{lineup_ctx['session_id']}/lineup",
        json={"player_id": second["id"], "jersey_number": 10, "team": "user"},
        headers=lineup_ctx["headers"],
    )
    assert res.status_code == 409
    # El mensaje dice quién ocupa el número: sin eso hay que ir a buscarlo a mano.
    assert "Jugador Uno" in res.json()["detail"]


async def test_the_same_jersey_is_allowed_in_the_opposing_team(client, lineup_ctx):
    first, second = lineup_ctx["players"]

    res = await client.post(
        f"/sessions/{lineup_ctx['session_id']}/lineup",
        json={"player_id": first["id"], "jersey_number": 10, "team": "user"},
        headers=lineup_ctx["headers"],
    )
    assert res.status_code == 201

    res = await client.post(
        f"/sessions/{lineup_ctx['session_id']}/lineup",
        json={"player_id": second["id"], "jersey_number": 10, "team": "rival"},
        headers=lineup_ctx["headers"],
    )
    assert res.status_code == 201, res.text


async def test_editing_a_jersey_onto_a_taken_number_is_rejected(client, lineup_ctx):
    first, second = lineup_ctx["players"]

    await client.post(
        f"/sessions/{lineup_ctx['session_id']}/lineup",
        json={"player_id": first["id"], "jersey_number": 10},
        headers=lineup_ctx["headers"],
    )
    res = await client.post(
        f"/sessions/{lineup_ctx['session_id']}/lineup",
        json={"player_id": second["id"], "jersey_number": 11},
        headers=lineup_ctx["headers"],
    )
    entry_id = res.json()["id"]

    res = await client.patch(
        f"/sessions/{lineup_ctx['session_id']}/lineup/{entry_id}",
        json={"jersey_number": 10},
        headers=lineup_ctx["headers"],
    )
    assert res.status_code == 409


async def test_bulk_replaces_the_whole_team_lineup(client, lineup_ctx):
    first, second = lineup_ctx["players"]

    res = await client.put(
        f"/sessions/{lineup_ctx['session_id']}/lineup",
        json={
            "team": "user",
            "entries": [
                {"player_id": first["id"], "jersey_number": 1, "position": "01 - Pilar izquierdo"},
                {"player_id": second["id"], "jersey_number": 16, "status": "bench"},
            ],
        },
        headers=lineup_ctx["headers"],
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert [e["jersey_number"] for e in body] == [1, 16]
    assert body[1]["status"] == "bench"

    # Un segundo PUT reemplaza, no acumula.
    res = await client.put(
        f"/sessions/{lineup_ctx['session_id']}/lineup",
        json={"team": "user", "entries": [{"player_id": first["id"], "jersey_number": 10}]},
        headers=lineup_ctx["headers"],
    )
    assert res.status_code == 200
    assert len(res.json()) == 1


async def test_bulk_rejects_duplicate_jersey_before_writing_anything(client, lineup_ctx):
    """Validar todo antes de escribir: si falla, el lineup viejo queda intacto."""
    first, second = lineup_ctx["players"]

    await client.put(
        f"/sessions/{lineup_ctx['session_id']}/lineup",
        json={"team": "user", "entries": [{"player_id": first["id"], "jersey_number": 7}]},
        headers=lineup_ctx["headers"],
    )

    res = await client.put(
        f"/sessions/{lineup_ctx['session_id']}/lineup",
        json={
            "team": "user",
            "entries": [
                {"player_id": first["id"], "jersey_number": 10},
                {"player_id": second["id"], "jersey_number": 10},
            ],
        },
        headers=lineup_ctx["headers"],
    )
    assert res.status_code == 409
    assert "10" in res.json()["detail"]

    # El lineup anterior sobrevivió al rechazo.
    res = await client.get(
        f"/sessions/{lineup_ctx['session_id']}/lineup", headers=lineup_ctx["headers"]
    )
    assert [e["jersey_number"] for e in res.json()] == [7]


async def test_bulk_is_rejected_once_the_match_started(client, lineup_ctx):
    """Reemplazar el lineup entero borraría quién entró y salió."""
    first = lineup_ctx["players"][0]

    res = await client.patch(
        f"/sessions/{lineup_ctx['session_id']}/timer",
        json={"action": "start"},
        headers=lineup_ctx["headers"],
    )
    assert res.status_code == 200, res.text

    res = await client.put(
        f"/sessions/{lineup_ctx['session_id']}/lineup",
        json={"team": "user", "entries": [{"player_id": first["id"], "jersey_number": 1}]},
        headers=lineup_ctx["headers"],
    )
    assert res.status_code == 409
    assert "jugador por jugador" in res.json()["detail"]


async def test_bulk_rejects_a_repeated_player(client, lineup_ctx):
    first = lineup_ctx["players"][0]
    res = await client.put(
        f"/sessions/{lineup_ctx['session_id']}/lineup",
        json={
            "team": "user",
            "entries": [
                {"player_id": first["id"], "jersey_number": 1},
                {"player_id": first["id"], "jersey_number": 2},
            ],
        },
        headers=lineup_ctx["headers"],
    )
    assert res.status_code == 409


async def test_bulk_rejects_a_player_from_another_club(client, db, lineup_ctx):
    other_club = await make_club(db, name="Otro Club", slug="otro-club-bulk")
    other_division = await make_division(db, other_club.id)
    other_admin = await make_user(
        db, email="otro2@example.com", role=UserRole.club_admin, club_id=other_club.id
    )
    tokens = await login(client, other_admin.email)
    res = await client.post(
        f"/divisions/{other_division.id}/players",
        json={"name": "Ajeno"},
        headers=auth_header(tokens["access_token"]),
    )
    foreign_id = res.json()["id"]

    res = await client.put(
        f"/sessions/{lineup_ctx['session_id']}/lineup",
        json={"team": "user", "entries": [{"player_id": foreign_id, "jersey_number": 1}]},
        headers=lineup_ctx["headers"],
    )
    assert res.status_code == 404


async def test_bulk_on_one_team_does_not_touch_the_other(client, lineup_ctx):
    first, second = lineup_ctx["players"]

    await client.put(
        f"/sessions/{lineup_ctx['session_id']}/lineup",
        json={"team": "rival", "entries": [{"player_id": second["id"], "jersey_number": 9}]},
        headers=lineup_ctx["headers"],
    )
    await client.put(
        f"/sessions/{lineup_ctx['session_id']}/lineup",
        json={"team": "user", "entries": [{"player_id": first["id"], "jersey_number": 9}]},
        headers=lineup_ctx["headers"],
    )

    res = await client.get(
        f"/sessions/{lineup_ctx['session_id']}/lineup", headers=lineup_ctx["headers"]
    )
    assert len(res.json()) == 2


# ── Lineup sugerido ───────────────────────────────────────────────────────────

async def test_suggested_lineup_is_empty_without_a_previous_match(client, lineup_ctx):
    res = await client.get(
        f"/sessions/{lineup_ctx['session_id']}/lineup/suggested", headers=lineup_ctx["headers"]
    )
    assert res.status_code == 200
    assert res.json()["entries"] == []
    assert res.json()["source_session_id"] is None


async def test_suggested_lineup_copies_the_previous_match(client, lineup_ctx, club_admin_ctx):
    """El lineup cambia poco entre fechas: partir del anterior ahorra 20 cargas."""
    first, second = lineup_ctx["players"]

    # El partido "anterior" es el de la fixture; se le carga un lineup.
    await client.put(
        f"/sessions/{lineup_ctx['session_id']}/lineup",
        json={
            "team": "user",
            "entries": [
                {"player_id": first["id"], "jersey_number": 10, "position": "10 - Apertura"},
                {"player_id": second["id"], "jersey_number": 16, "status": "bench"},
            ],
        },
        headers=lineup_ctx["headers"],
    )

    # Un partido nuevo en el mismo torneo (misma división).
    res = await client.get(f"/sessions/{lineup_ctx['session_id']}", headers=lineup_ctx["headers"])
    tournament_id = res.json()["tournament_id"]
    res = await client.post(
        f"/tournaments/{tournament_id}/sessions",
        json={"home_team": "Club Test", "away_team": "Otro Rival"},
        headers=club_admin_ctx["headers"],
    )
    new_session_id = res.json()["id"]

    res = await client.get(
        f"/sessions/{new_session_id}/lineup/suggested", headers=lineup_ctx["headers"]
    )
    assert res.status_code == 200
    body = res.json()
    assert body["source_session_id"] == lineup_ctx["session_id"]
    assert [e["jersey_number"] for e in body["entries"]] == [10, 16]
    assert body["entries"][0]["position"] == "10 - Apertura"
    assert body["entries"][1]["status"] == "bench"
    assert all(e["available"] for e in body["entries"])


async def test_suggested_lineup_flags_a_player_who_is_no_longer_active(
    client, lineup_ctx, club_admin_ctx
):
    first = lineup_ctx["players"][0]
    await client.put(
        f"/sessions/{lineup_ctx['session_id']}/lineup",
        json={"team": "user", "entries": [{"player_id": first["id"], "jersey_number": 10}]},
        headers=lineup_ctx["headers"],
    )
    res = await client.patch(
        f"/divisions/{lineup_ctx['division'].id}/players/{first['id']}",
        json={"is_active": False},
        headers=club_admin_ctx["headers"],
    )
    assert res.status_code == 200, res.text

    res = await client.get(f"/sessions/{lineup_ctx['session_id']}", headers=lineup_ctx["headers"])
    tournament_id = res.json()["tournament_id"]
    res = await client.post(
        f"/tournaments/{tournament_id}/sessions",
        json={"home_team": "Club Test", "away_team": "Rival 3"},
        headers=club_admin_ctx["headers"],
    )
    new_session_id = res.json()["id"]

    res = await client.get(
        f"/sessions/{new_session_id}/lineup/suggested", headers=lineup_ctx["headers"]
    )
    assert res.json()["entries"][0]["available"] is False


async def test_saving_an_entry_with_its_own_number_is_not_a_conflict(client, lineup_ctx):
    """Editar la posición sin tocar el número no debe chocar contra sí mismo."""
    first = lineup_ctx["players"][0]

    res = await client.post(
        f"/sessions/{lineup_ctx['session_id']}/lineup",
        json={"player_id": first["id"], "jersey_number": 10},
        headers=lineup_ctx["headers"],
    )
    entry_id = res.json()["id"]

    res = await client.patch(
        f"/sessions/{lineup_ctx['session_id']}/lineup/{entry_id}",
        json={"jersey_number": 10, "position": "10 - Apertura"},
        headers=lineup_ctx["headers"],
    )
    assert res.status_code == 200, res.text
    assert res.json()["position"] == "10 - Apertura"
