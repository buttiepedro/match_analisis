"""
Minutos jugados y acumulados de temporada.

Se calculan, no se guardan: salen del lineup, las sustituciones y el timer. Los
casos que importan son los que un cálculo ingenuo se come — el suplente que
nunca entró, el segundo tiempo y la amarilla.
"""
import pytest

from tests.conftest import make_division, make_tournament


@pytest.fixture
async def season_ctx(client, db, club_admin_ctx):
    club = club_admin_ctx["club"]
    division = await make_division(db, club.id)
    tournament = await make_tournament(db, club.id, division.id)

    res = await client.post(
        f"/tournaments/{tournament.id}/sessions",
        json={"home_team": "Club Test", "away_team": "Rival", "half_duration_minutes": 40},
        headers=club_admin_ctx["headers"],
    )
    session_id = res.json()["id"]

    players = []
    for name in ("Titular Uno", "Suplente Dos", "Suplente Tres"):
        res = await client.post(
            f"/divisions/{division.id}/players",
            json={"name": name},
            headers=club_admin_ctx["headers"],
        )
        players.append(res.json())

    return {
        "division": division,
        "tournament": tournament,
        "session_id": session_id,
        "players": players,
        "headers": club_admin_ctx["headers"],
    }


async def _set_lineup(client, ctx, entries):
    res = await client.put(
        f"/sessions/{ctx['session_id']}/lineup",
        json={"team": "user", "entries": entries},
        headers=ctx["headers"],
    )
    assert res.status_code == 200, res.text
    return res.json()


async def _finish(client, ctx):
    """Marca el partido como terminado para que se use el tiempo reglamentario."""
    for action in ("start", "halftime", "start", "finish"):
        await client.patch(
            f"/sessions/{ctx['session_id']}/timer",
            json={"action": action},
            headers=ctx["headers"],
        )


async def test_a_starter_who_plays_the_whole_match_gets_the_full_time(client, season_ctx):
    titular = season_ctx["players"][0]
    await _set_lineup(client, season_ctx, [{"player_id": titular["id"], "jersey_number": 1}])
    await _finish(client, season_ctx)

    res = await client.get(
        f"/players/{titular['id']}/season-stats", headers=season_ctx["headers"]
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["minutes"] == 80
    assert body["matches"] == 1


async def test_a_bench_player_who_never_came_on_has_no_minutes(client, season_ctx):
    """Figurar en la planilla no es haber jugado."""
    titular, suplente, _ = season_ctx["players"]
    await _set_lineup(
        client,
        season_ctx,
        [
            {"player_id": titular["id"], "jersey_number": 1},
            {"player_id": suplente["id"], "jersey_number": 16, "status": "bench"},
        ],
    )
    await _finish(client, season_ctx)

    res = await client.get(
        f"/players/{suplente['id']}/season-stats", headers=season_ctx["headers"]
    )
    body = res.json()
    assert body["minutes"] == 0
    assert body["matches"] == 0


async def test_a_substitution_splits_the_minutes(client, season_ctx):
    titular, suplente, _ = season_ctx["players"]
    entries = await _set_lineup(
        client,
        season_ctx,
        [
            {"player_id": titular["id"], "jersey_number": 1},
            {"player_id": suplente["id"], "jersey_number": 16, "status": "bench"},
        ],
    )
    out_id = next(e["id"] for e in entries if e["player_id"] == titular["id"])
    in_id = next(e["id"] for e in entries if e["player_id"] == suplente["id"])

    # Cambio al minuto 60: 20 del segundo tiempo (2400 + 1200 = 3600s).
    await client.patch(
        f"/sessions/{season_ctx['session_id']}/timer",
        json={"action": "start"},
        headers=season_ctx["headers"],
    )
    await client.patch(
        f"/sessions/{season_ctx['session_id']}/timer",
        json={"action": "halftime"},
        headers=season_ctx["headers"],
    )
    await client.patch(
        f"/sessions/{season_ctx['session_id']}/timer",
        json={"action": "start"},
        headers=season_ctx["headers"],
    )
    res = await client.patch(
        f"/sessions/{season_ctx['session_id']}/timer",
        json={"action": "set", "seconds": 1200},
        headers=season_ctx["headers"],
    )
    assert res.status_code == 200, res.text
    res = await client.post(
        f"/sessions/{season_ctx['session_id']}/lineup/substitute",
        json={"lineup_out_id": out_id, "lineup_in_id": in_id},
        headers=season_ctx["headers"],
    )
    assert res.status_code == 200, res.text
    await client.patch(
        f"/sessions/{season_ctx['session_id']}/timer",
        json={"action": "finish"},
        headers=season_ctx["headers"],
    )

    res = await client.get(
        f"/players/{titular['id']}/season-stats", headers=season_ctx["headers"]
    )
    assert res.json()["minutes"] == 60

    res = await client.get(
        f"/players/{suplente['id']}/season-stats", headers=season_ctx["headers"]
    )
    assert res.json()["minutes"] == 20
    assert res.json()["matches"] == 1


async def test_a_yellow_card_discounts_ten_minutes(client, season_ctx):
    titular = season_ctx["players"][0]
    await _set_lineup(client, season_ctx, [{"player_id": titular["id"], "jersey_number": 1}])

    await client.post(
        f"/sessions/{season_ctx['session_id']}/events",
        json={
            "event_type": "yellow_card",
            "team": "user",
            "player_id": titular["id"],
            "timer_seconds": 600,
            "half": 1,
        },
        headers=season_ctx["headers"],
    )
    await _finish(client, season_ctx)

    res = await client.get(
        f"/players/{titular['id']}/season-stats", headers=season_ctx["headers"]
    )
    body = res.json()
    assert body["minutes"] == 70
    assert body["yellow_cards"] == 1


async def test_a_yellow_card_near_the_end_only_discounts_what_is_left(client, season_ctx):
    """No se puede deber más tiempo del que quedaba por jugar."""
    titular = season_ctx["players"][0]
    await _set_lineup(client, season_ctx, [{"player_id": titular["id"], "jersey_number": 1}])

    # Amarilla en el minuto 76: quedan 4, no 10.
    await client.post(
        f"/sessions/{season_ctx['session_id']}/events",
        json={
            "event_type": "yellow_card",
            "team": "user",
            "player_id": titular["id"],
            "timer_seconds": 2160,
            "half": 2,
        },
        headers=season_ctx["headers"],
    )
    await _finish(client, season_ctx)

    res = await client.get(
        f"/players/{titular['id']}/season-stats", headers=season_ctx["headers"]
    )
    assert res.json()["minutes"] == 76


async def test_tries_and_tackles_accumulate(client, season_ctx):
    titular = season_ctx["players"][0]
    await _set_lineup(client, season_ctx, [{"player_id": titular["id"], "jersey_number": 1}])

    for event_type in ("try", "try", "tackle_effective", "tackle_positive", "tackle_missed"):
        await client.post(
            f"/sessions/{season_ctx['session_id']}/events",
            json={
                "event_type": event_type,
                "team": "user",
                "player_id": titular["id"],
                "timer_seconds": 100,
                "half": 1,
            },
            headers=season_ctx["headers"],
        )
    await _finish(client, season_ctx)

    res = await client.get(
        f"/players/{titular['id']}/season-stats", headers=season_ctx["headers"]
    )
    body = res.json()
    assert body["tries"] == 2
    # El tackle errado no cuenta como tackle hecho.
    assert body["tackles"] == 2


async def test_a_player_with_no_matches_returns_zeros(client, season_ctx):
    nobody = season_ctx["players"][2]
    res = await client.get(
        f"/players/{nobody['id']}/season-stats", headers=season_ctx["headers"]
    )
    assert res.status_code == 200
    body = res.json()
    assert body["matches"] == 0
    assert body["minutes"] == 0
    assert body["matches_detail"] == []


async def test_division_minutes_ranks_the_squad(client, season_ctx):
    titular, suplente, _ = season_ctx["players"]
    await _set_lineup(
        client,
        season_ctx,
        [
            {"player_id": titular["id"], "jersey_number": 1},
            {"player_id": suplente["id"], "jersey_number": 16, "status": "bench"},
        ],
    )
    await _finish(client, season_ctx)

    res = await client.get(
        f"/divisions/{season_ctx['division'].id}/minutes", headers=season_ctx["headers"]
    )
    assert res.status_code == 200, res.text
    rows = res.json()
    assert rows[0]["player_name"] == "Titular Uno"
    assert rows[0]["minutes"] == 80
    assert rows[0]["average_minutes"] == 80.0
    # Los que no jugaron siguen en la lista, en cero: son los que hay que rotar.
    assert {r["player_name"] for r in rows} == {"Titular Uno", "Suplente Dos", "Suplente Tres"}
    assert all(r["minutes"] == 0 for r in rows if r["player_name"] != "Titular Uno")


async def test_another_club_cannot_read_division_minutes(client, db, season_ctx):
    from app.models import UserRole
    from tests.conftest import auth_header, login, make_club, make_user

    other = await make_club(db, name="Otro", slug="otro-season")
    await make_user(db, email="otro4@example.com", role=UserRole.club_admin, club_id=other.id)
    tokens = await login(client, "otro4@example.com")

    res = await client.get(
        f"/divisions/{season_ctx['division'].id}/minutes",
        headers=auth_header(tokens["access_token"]),
    )
    assert res.status_code == 403
