"""
Fixture, tablas y citados de todo el club.

La garantía central: `club.ver_competencia` no se filtra por alcance de
división. Un entrenador con alcance restringido a una división ve las mismas
tres pantallas que el administrador, porque acá el permiso es de club, no de
división — al revés que el resto de [[club-operativo]].
"""
import pytest

from app.models import UserRole

from tests.conftest import auth_header, login, make_division, make_tournament, make_user


@pytest.fixture
async def club_competencia_ctx(client, db, club_admin_ctx):
    club = club_admin_ctx["club"]
    primera = await make_division(db, club.id, name="Primera")
    m17 = await make_division(db, club.id, name="M17")
    return {
        "club": club,
        "primera": primera,
        "m17": m17,
        "headers": club_admin_ctx["headers"],
    }


async def _make_session(client, tournament_id, headers, *, away="Rival A", scheduled=None):
    body = {"home_team": "Club Test", "away_team": away}
    if scheduled is not None:
        body["scheduled_at"] = scheduled.isoformat()
    res = await client.post(f"/tournaments/{tournament_id}/sessions", json=body, headers=headers)
    assert res.status_code == 201, res.text
    return res.json()["id"]


async def _finish(client, headers, session_id):
    for action in ("start", "halftime", "start", "finish"):
        await client.patch(
            f"/sessions/{session_id}/timer", json={"action": action}, headers=headers
        )


# ── Fixture ───────────────────────────────────────────────────────────────────

async def test_fixture_covers_every_division_not_just_ones_with_matches(
    client, db, club_competencia_ctx
):
    """Una división sin partidos aparece igual, con la lista vacía."""
    tournament = await make_tournament(db, club_competencia_ctx["club"].id, club_competencia_ctx["primera"].id)
    headers = club_competencia_ctx["headers"]
    await _make_session(client, tournament.id, headers)

    res = await client.get(f"/clubs/{club_competencia_ctx['club'].id}/fixture", headers=headers)
    assert res.status_code == 200, res.text
    body = res.json()
    by_division = {row["division_id"]: row for row in body}

    assert len(by_division[str(tournament.division_id)]["matches"]) == 1
    assert by_division[str(club_competencia_ctx["m17"].id)]["matches"] == []


async def test_fixture_shows_the_score_only_for_finished_matches(client, db, club_competencia_ctx):
    tournament = await make_tournament(db, club_competencia_ctx["club"].id, club_competencia_ctx["primera"].id)
    headers = club_competencia_ctx["headers"]

    finished = await _make_session(client, tournament.id, headers, away="Ya jugado")
    await client.post(
        f"/sessions/{finished}/events",
        json={"event_type": "try", "team": "user", "timer_seconds": 60, "half": 1},
        headers=headers,
    )
    await _finish(client, headers, finished)
    upcoming = await _make_session(client, tournament.id, headers, away="Falta jugar")

    res = await client.get(f"/clubs/{club_competencia_ctx['club'].id}/fixture", headers=headers)
    matches = next(
        row for row in res.json() if row["division_id"] == str(tournament.division_id)
    )["matches"]
    by_session = {m["session_id"]: m for m in matches}

    assert by_session[finished]["home_score"] == 5
    assert by_session[finished]["away_score"] == 0
    assert by_session[upcoming]["home_score"] is None
    assert by_session[upcoming]["away_score"] is None


async def test_fixture_upcoming_filters_out_finished_matches(client, db, club_competencia_ctx):
    tournament = await make_tournament(db, club_competencia_ctx["club"].id, club_competencia_ctx["primera"].id)
    headers = club_competencia_ctx["headers"]
    finished = await _make_session(client, tournament.id, headers, away="Ya jugado")
    await _finish(client, headers, finished)
    await _make_session(client, tournament.id, headers, away="Falta jugar")

    res = await client.get(
        f"/clubs/{club_competencia_ctx['club'].id}/fixture",
        params={"upcoming": "true"},
        headers=headers,
    )
    matches = next(
        row for row in res.json() if row["division_id"] == str(tournament.division_id)
    )["matches"]
    assert [m["away_team"] for m in matches] == ["Falta jugar"]


# ── Tablas ────────────────────────────────────────────────────────────────────

async def test_standings_shows_empty_state_for_a_division_without_an_active_tournament(
    client, db, club_competencia_ctx
):
    tournament = await make_tournament(db, club_competencia_ctx["club"].id, club_competencia_ctx["primera"].id)
    headers = club_competencia_ctx["headers"]
    session_id = await _make_session(client, tournament.id, headers)
    await client.post(
        f"/sessions/{session_id}/events",
        json={"event_type": "try", "team": "user", "timer_seconds": 60, "half": 1},
        headers=headers,
    )
    await _finish(client, headers, session_id)

    res = await client.get(f"/clubs/{club_competencia_ctx['club'].id}/standings", headers=headers)
    assert res.status_code == 200, res.text
    by_division = {row["division_id"]: row for row in res.json()}

    con_torneo = by_division[str(tournament.division_id)]
    assert con_torneo["tournament_id"] == str(tournament.id)
    assert len(con_torneo["rows"]) == 1

    sin_torneo = by_division[str(club_competencia_ctx["m17"].id)]
    assert sin_torneo["tournament_id"] is None
    assert sin_torneo["rows"] == []


# ── Citados ───────────────────────────────────────────────────────────────────

async def test_convocatorias_marks_a_division_without_one_loaded(client, db, club_competencia_ctx):
    tournament = await make_tournament(db, club_competencia_ctx["club"].id, club_competencia_ctx["primera"].id)
    headers = club_competencia_ctx["headers"]
    session_id = await _make_session(client, tournament.id, headers)

    res = await client.post(
        f"/divisions/{tournament.division_id}/players",
        json={"name": "Ana Perez"},
        headers=headers,
    )
    player_id = res.json()["id"]
    await client.put(
        f"/sessions/{session_id}/squad",
        json={"entries": [{"player_id": player_id, "status": "convocado"}]},
        headers=headers,
    )

    res = await client.get(f"/clubs/{club_competencia_ctx['club'].id}/convocatorias", headers=headers)
    assert res.status_code == 200, res.text
    by_division = {row["division_id"]: row for row in res.json()}

    con_convocatoria = by_division[str(tournament.division_id)]
    assert con_convocatoria["reason"] is None
    assert [m["player_name"] for m in con_convocatoria["members"]] == ["Ana Perez"]

    sin_convocatoria = by_division[str(club_competencia_ctx["m17"].id)]
    assert sin_convocatoria["reason"] == "sin_convocatoria"
    assert sin_convocatoria["members"] == []


# ── El permiso es de club, no de división ────────────────────────────────────

async def test_a_coach_scoped_to_one_division_still_sees_every_division(
    client, db, club_competencia_ctx
):
    """
    La garantía central del cambio: `club.ver_competencia` no es `partido_ver`
    con alcance. Un entrenador de M17 acotado a su división igual ve Primera acá.
    """
    club = club_competencia_ctx["club"]
    coach = await make_user(
        db, email="coach.m17@example.com", role=UserRole.match_director, club_id=club.id
    )
    tokens = await login(client, coach.email)
    coach_headers = auth_header(tokens["access_token"])

    scope_res = await client.put(
        f"/clubs/{club.id}/users/{coach.id}/divisions",
        json={"division_ids": [str(club_competencia_ctx["m17"].id)]},
        headers=club_competencia_ctx["headers"],
    )
    assert scope_res.status_code == 200, scope_res.text

    # Confirma que el alcance efectivamente restringe una pantalla scoped...
    res = await client.get(
        f"/divisions/{club_competencia_ctx['primera'].id}/players", headers=coach_headers
    )
    assert res.status_code == 403

    # ...pero no ésta: las tres pantallas del portal ven el club entero.
    for path in ("fixture", "standings", "convocatorias"):
        res = await client.get(f"/clubs/{club.id}/{path}", headers=coach_headers)
        assert res.status_code == 200, res.text
        division_ids = {row["division_id"] for row in res.json()}
        assert str(club_competencia_ctx["primera"].id) in division_ids
        assert str(club_competencia_ctx["m17"].id) in division_ids


async def test_a_player_without_the_permission_is_forbidden(client, db, club_competencia_ctx):
    """El preset Jugador no trae `club.ver_competencia` salvo que herede de Socio."""
    club = club_competencia_ctx["club"]
    player = await make_user(
        db, email="jugador@example.com", role=UserRole.player, club_id=club.id
    )
    tokens = await login(client, player.email)

    res = await client.get(
        f"/clubs/{club.id}/fixture", headers=auth_header(tokens["access_token"])
    )
    assert res.status_code == 403


async def test_another_club_cannot_read_the_fixture(client, db, club_competencia_ctx):
    from tests.conftest import make_club

    other = await make_club(db, name="Otro", slug="otro-competencia")
    await make_user(db, email="otro.admin@example.com", role=UserRole.club_admin, club_id=other.id)
    tokens = await login(client, "otro.admin@example.com")

    res = await client.get(
        f"/clubs/{club_competencia_ctx['club'].id}/fixture",
        headers=auth_header(tokens["access_token"]),
    )
    assert res.status_code == 403
