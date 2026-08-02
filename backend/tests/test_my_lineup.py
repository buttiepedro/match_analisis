"""
`GET /me/player/sessions/{id}/lineup` — el destino real del deep link de
"salió la formación".

No reusa `GET /sessions/{id}/lineup`: ese exige `partido.lineup`, capacidad
que ningún jugador tiene, y la pantalla que lo consume es el editor del
cuerpo técnico. Esto es sólo lectura, resuelto contra la propia división.
"""
import pytest

from tests.conftest import auth_header, login, make_division, make_tournament


@pytest.fixture
async def my_lineup_ctx(client, db, club_admin_ctx):
    club = club_admin_ctx["club"]
    division = await make_division(db, club.id)
    other_division = await make_division(db, club.id, name="Otra")
    tournament = await make_tournament(db, club.id, division.id)
    headers = club_admin_ctx["headers"]

    res = await client.post(
        f"/tournaments/{tournament.id}/sessions",
        json={"home_team": "Club Test", "away_team": "Rival"},
        headers=headers,
    )
    session_id = res.json()["id"]

    res = await client.post(
        f"/divisions/{division.id}/players", json={"name": "Titular"}, headers=headers
    )
    titular = res.json()
    res = await client.post(
        f"/divisions/{division.id}/players/{titular['id']}/invite",
        json={"email": "titular@example.com", "password": "secret123"},
        headers=headers,
    )
    titular_user_id = res.json()["user_id"]

    res = await client.post(
        f"/divisions/{division.id}/players", json={"name": "Suplente"}, headers=headers
    )
    suplente = res.json()

    await client.put(
        f"/sessions/{session_id}/lineup",
        json={
            "team": "user",
            "entries": [
                {"player_id": titular["id"], "jersey_number": 1, "status": "on_field"},
                {"player_id": suplente["id"], "jersey_number": 16, "status": "bench"},
            ],
        },
        headers=headers,
    )

    tokens = await login(client, "titular@example.com")

    return {
        "club": club,
        "division": division,
        "other_division": other_division,
        "session_id": session_id,
        "titular_user_id": titular_user_id,
        "headers": auth_header(tokens["access_token"]),
        "admin_headers": headers,
    }


async def test_a_player_sees_the_full_lineup_with_their_own_row_marked(client, my_lineup_ctx):
    res = await client.get(
        f"/me/player/sessions/{my_lineup_ctx['session_id']}/lineup", headers=my_lineup_ctx["headers"]
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["away_team"] == "Rival"
    assert len(body["entries"]) == 2

    by_number = {e["jersey_number"]: e for e in body["entries"]}
    assert by_number[1]["player_name"] == "Titular"
    assert by_number[1]["is_me"] is True
    assert by_number[16]["is_me"] is False


async def test_a_player_cannot_see_a_match_from_another_division(client, db, my_lineup_ctx):
    other_tournament = await make_tournament(
        db, my_lineup_ctx["club"].id, my_lineup_ctx["other_division"].id, name="Otro torneo"
    )
    res = await client.post(
        f"/tournaments/{other_tournament.id}/sessions",
        json={"home_team": "Club Test", "away_team": "Ajeno"},
        headers=my_lineup_ctx["admin_headers"],
    )
    other_session_id = res.json()["id"]

    res = await client.get(
        f"/me/player/sessions/{other_session_id}/lineup", headers=my_lineup_ctx["headers"]
    )
    assert res.status_code == 403


async def test_a_nonexistent_session_is_404(client, my_lineup_ctx):
    res = await client.get(
        "/me/player/sessions/00000000-0000-0000-0000-000000000000/lineup",
        headers=my_lineup_ctx["headers"],
    )
    assert res.status_code == 404
