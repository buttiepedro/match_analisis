"""
Rivales y tabla de posiciones.

Las posiciones se calculan desde los eventos, así que lo que importa es que el
puntaje salga bien y que un partido sin terminar no ensucie la tabla.
"""
import pytest

from tests.conftest import make_division, make_tournament


@pytest.fixture
async def competition_ctx(client, db, club_admin_ctx):
    club = club_admin_ctx["club"]
    division = await make_division(db, club.id)
    tournament = await make_tournament(db, club.id, division.id)
    return {
        "club": club,
        "division": division,
        "tournament": tournament,
        "headers": club_admin_ctx["headers"],
    }


async def _make_session(client, ctx, away="Rival A"):
    res = await client.post(
        f"/tournaments/{ctx['tournament'].id}/sessions",
        json={"home_team": "Club Test", "away_team": away},
        headers=ctx["headers"],
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


async def _score(client, ctx, session_id, team, *, tries=0, converted=0, penalties=0):
    for i in range(tries):
        await client.post(
            f"/sessions/{session_id}/events",
            json={
                "event_type": "try",
                "team": team,
                "timer_seconds": 60 * (i + 1),
                "half": 1,
                "metadata": {"converted": i < converted},
            },
            headers=ctx["headers"],
        )
    for i in range(penalties):
        await client.post(
            f"/sessions/{session_id}/events",
            json={
                "event_type": "penalty",
                "team": team,
                "reason": "a_los_palos",
                "timer_seconds": 1200 + i,
                "half": 2,
                "metadata": {"converted": True},
            },
            headers=ctx["headers"],
        )


async def _finish(client, ctx, session_id):
    for action in ("start", "halftime", "start", "finish"):
        await client.patch(
            f"/sessions/{session_id}/timer",
            json={"action": action},
            headers=ctx["headers"],
        )


# ── Rivales ───────────────────────────────────────────────────────────────────

async def test_creating_the_same_opponent_twice_is_idempotent(client, competition_ctx):
    """El autocompletado va a mandar el mismo nombre más de una vez."""
    first = await client.post(
        f"/clubs/{competition_ctx['club'].id}/opponents",
        json={"name": "Los Matreros"},
        headers=competition_ctx["headers"],
    )
    assert first.status_code == 201

    second = await client.post(
        f"/clubs/{competition_ctx['club'].id}/opponents",
        json={"name": "Los Matreros"},
        headers=competition_ctx["headers"],
    )
    assert second.json()["id"] == first.json()["id"]

    res = await client.get(
        f"/clubs/{competition_ctx['club'].id}/opponents", headers=competition_ctx["headers"]
    )
    assert len(res.json()) == 1


async def test_opponent_history_is_empty_without_finished_matches(client, competition_ctx):
    res = await client.post(
        f"/clubs/{competition_ctx['club'].id}/opponents",
        json={"name": "Los Matreros"},
        headers=competition_ctx["headers"],
    )
    opponent_id = res.json()["id"]

    res = await client.get(
        f"/opponents/{opponent_id}/history", headers=competition_ctx["headers"]
    )
    assert res.status_code == 200
    assert res.json()["played"] == 0


async def test_another_club_cannot_read_an_opponent_history(client, db, competition_ctx):
    from app.models import UserRole
    from tests.conftest import auth_header, login, make_club, make_user

    res = await client.post(
        f"/clubs/{competition_ctx['club'].id}/opponents",
        json={"name": "Los Matreros"},
        headers=competition_ctx["headers"],
    )
    opponent_id = res.json()["id"]

    other = await make_club(db, name="Otro", slug="otro-comp")
    await make_user(db, email="otro5@example.com", role=UserRole.club_admin, club_id=other.id)
    tokens = await login(client, "otro5@example.com")

    res = await client.get(
        f"/opponents/{opponent_id}/history", headers=auth_header(tokens["access_token"])
    )
    assert res.status_code == 403


# ── Tabla de posiciones ───────────────────────────────────────────────────────

async def test_standings_ignore_unfinished_matches(client, competition_ctx):
    """Una tabla que cambia sola durante el segundo tiempo no es una tabla."""
    session_id = await _make_session(client, competition_ctx)
    await _score(client, competition_ctx, session_id, "user", tries=3, converted=3)

    res = await client.get(
        f"/tournaments/{competition_ctx['tournament'].id}/standings",
        headers=competition_ctx["headers"],
    )
    assert res.json() == []


async def test_a_win_gives_four_points(client, competition_ctx):
    session_id = await _make_session(client, competition_ctx)
    # 3 tries convertidos = 21; el rival, 1 sin convertir = 5.
    await _score(client, competition_ctx, session_id, "user", tries=3, converted=3)
    await _score(client, competition_ctx, session_id, "rival", tries=1)
    await _finish(client, competition_ctx, session_id)

    res = await client.get(
        f"/tournaments/{competition_ctx['tournament'].id}/standings",
        headers=competition_ctx["headers"],
    )
    row = res.json()[0]
    assert row["team"] == "Rival A"
    assert row["points_for"] == 21
    assert row["points_against"] == 5
    assert row["won"] == 1
    assert row["points"] == 4  # ganado, sin bonus (3 tries)


async def test_four_tries_add_the_offensive_bonus(client, competition_ctx):
    session_id = await _make_session(client, competition_ctx)
    await _score(client, competition_ctx, session_id, "user", tries=4, converted=4)
    await _finish(client, competition_ctx, session_id)

    res = await client.get(
        f"/tournaments/{competition_ctx['tournament'].id}/standings",
        headers=competition_ctx["headers"],
    )
    row = res.json()[0]
    assert row["bonus"] == 1
    assert row["points"] == 5  # 4 por ganar + 1 ofensivo


async def test_losing_by_seven_or_less_adds_the_defensive_bonus(client, competition_ctx):
    session_id = await _make_session(client, competition_ctx)
    # 5 contra 10: se pierde por 5.
    await _score(client, competition_ctx, session_id, "user", tries=1)
    await _score(client, competition_ctx, session_id, "rival", tries=2)
    await _finish(client, competition_ctx, session_id)

    res = await client.get(
        f"/tournaments/{competition_ctx['tournament'].id}/standings",
        headers=competition_ctx["headers"],
    )
    row = res.json()[0]
    assert row["lost"] == 1
    assert row["bonus"] == 1
    assert row["points"] == 1


async def test_losing_by_more_than_seven_gives_nothing(client, competition_ctx):
    session_id = await _make_session(client, competition_ctx)
    await _score(client, competition_ctx, session_id, "rival", tries=3, converted=3)
    await _finish(client, competition_ctx, session_id)

    res = await client.get(
        f"/tournaments/{competition_ctx['tournament'].id}/standings",
        headers=competition_ctx["headers"],
    )
    row = res.json()[0]
    assert row["points"] == 0
    assert row["difference"] == -21


async def test_a_draw_gives_two_points(client, competition_ctx):
    session_id = await _make_session(client, competition_ctx)
    await _score(client, competition_ctx, session_id, "user", tries=1)
    await _score(client, competition_ctx, session_id, "rival", tries=1)
    await _finish(client, competition_ctx, session_id)

    res = await client.get(
        f"/tournaments/{competition_ctx['tournament'].id}/standings",
        headers=competition_ctx["headers"],
    )
    row = res.json()[0]
    assert row["drawn"] == 1
    assert row["points"] == 2


async def test_standings_sort_by_points_then_difference(client, competition_ctx):
    weak = await _make_session(client, competition_ctx, away="Rival Flojo")
    await _score(client, competition_ctx, weak, "user", tries=5, converted=5)
    await _finish(client, competition_ctx, weak)

    tough = await _make_session(client, competition_ctx, away="Rival Duro")
    await _score(client, competition_ctx, tough, "rival", tries=5, converted=5)
    await _finish(client, competition_ctx, tough)

    res = await client.get(
        f"/tournaments/{competition_ctx['tournament'].id}/standings",
        headers=competition_ctx["headers"],
    )
    assert [r["team"] for r in res.json()] == ["Rival Flojo", "Rival Duro"]


# ── Mensaje de convocatoria ───────────────────────────────────────────────────

async def test_squad_message_lists_the_called_players(client, db, competition_ctx):
    session_id = await _make_session(client, competition_ctx)

    players = []
    for name in ("Ana Perez", "Bruno Diaz"):
        res = await client.post(
            f"/divisions/{competition_ctx['division'].id}/players",
            json={"name": name},
            headers=competition_ctx["headers"],
        )
        players.append(res.json())

    await client.put(
        f"/sessions/{session_id}/squad",
        json={"entries": [{"player_id": p["id"], "status": "convocado"} for p in players]},
        headers=competition_ctx["headers"],
    )

    res = await client.get(
        f"/sessions/{session_id}/squad/message", headers=competition_ctx["headers"]
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["count"] == 2
    assert "Club Test vs Rival A" in body["text"]
    assert "1. Ana Perez" in body["text"]
    assert "2. Bruno Diaz" in body["text"]


async def test_squad_message_without_a_squad_is_404(client, competition_ctx):
    session_id = await _make_session(client, competition_ctx)
    res = await client.get(
        f"/sessions/{session_id}/squad/message", headers=competition_ctx["headers"]
    )
    assert res.status_code == 404
