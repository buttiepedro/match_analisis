"""
Aislamiento entre clubes: la garantía central del modelo multi-tenant. Un club
nunca debe poder leer ni tocar datos de otro.
"""
from app.models import UserRole

from tests.conftest import (
    auth_header,
    login,
    make_club,
    make_division,
    make_tournament,
    make_user,
)


async def two_clubs(db, client):
    club_a = await make_club(db, name="Club A", slug="club-a")
    club_b = await make_club(db, name="Club B", slug="club-b")
    await make_user(db, email="a@example.com", role=UserRole.club_admin, club_id=club_a.id)
    await make_user(db, email="b@example.com", role=UserRole.club_admin, club_id=club_b.id)
    tokens_a = await login(client, "a@example.com")
    tokens_b = await login(client, "b@example.com")
    return {
        "a": {"club": club_a, "headers": auth_header(tokens_a["access_token"])},
        "b": {"club": club_b, "headers": auth_header(tokens_b["access_token"])},
    }


async def test_cannot_list_another_clubs_divisions(db, client):
    ctx = await two_clubs(db, client)
    res = await client.get(f"/clubs/{ctx['b']['club'].id}/divisions", headers=ctx["a"]["headers"])
    assert res.status_code == 403


async def test_cannot_create_a_division_in_another_club(db, client):
    ctx = await two_clubs(db, client)
    res = await client.post(
        f"/clubs/{ctx['b']['club'].id}/divisions",
        json={"name": "Infiltrada"},
        headers=ctx["a"]["headers"],
    )
    assert res.status_code == 403


async def test_cannot_read_another_clubs_tournaments(db, client):
    ctx = await two_clubs(db, client)
    res = await client.get(f"/clubs/{ctx['b']['club'].id}/tournaments", headers=ctx["a"]["headers"])
    assert res.status_code == 403


async def test_cannot_read_another_clubs_players(db, client):
    ctx = await two_clubs(db, client)
    division_b = await make_division(db, ctx["b"]["club"].id)
    res = await client.get(f"/divisions/{division_b.id}/players", headers=ctx["a"]["headers"])
    assert res.status_code == 403


async def test_cannot_create_a_session_in_another_clubs_tournament(db, client):
    ctx = await two_clubs(db, client)
    division_b = await make_division(db, ctx["b"]["club"].id)
    tournament_b = await make_tournament(db, ctx["b"]["club"].id, division_b.id)

    res = await client.post(
        f"/tournaments/{tournament_b.id}/sessions",
        json={"home_team": "A", "away_team": "B"},
        headers=ctx["a"]["headers"],
    )
    assert res.status_code == 403


async def test_cannot_read_another_clubs_session_events(db, client):
    ctx = await two_clubs(db, client)
    division_b = await make_division(db, ctx["b"]["club"].id)
    tournament_b = await make_tournament(db, ctx["b"]["club"].id, division_b.id)

    created = await client.post(
        f"/tournaments/{tournament_b.id}/sessions",
        json={"home_team": "Club B", "away_team": "Rival"},
        headers=ctx["b"]["headers"],
    )
    session_id = created.json()["id"]

    res = await client.get(f"/sessions/{session_id}/events", headers=ctx["a"]["headers"])
    assert res.status_code == 403


async def test_superadmin_crosses_club_boundaries(db, client):
    ctx = await two_clubs(db, client)
    await make_user(db, email="root@example.com", role=UserRole.superadmin)
    tokens = await login(client, "root@example.com")

    for key in ("a", "b"):
        res = await client.get(
            f"/clubs/{ctx[key]['club'].id}/divisions",
            headers=auth_header(tokens["access_token"]),
        )
        assert res.status_code == 200


async def test_analyst_cannot_create_divisions(db, client):
    club = await make_club(db)
    await make_user(db, email="analyst@example.com", role=UserRole.analyst, club_id=club.id)
    tokens = await login(client, "analyst@example.com")

    res = await client.post(
        f"/clubs/{club.id}/divisions",
        json={"name": "No debería"},
        headers=auth_header(tokens["access_token"]),
    )
    assert res.status_code == 403


async def test_analyst_cannot_control_the_timer(db, client):
    club = await make_club(db)
    admin = await make_user(db, email="admin@example.com", role=UserRole.club_admin, club_id=club.id)
    await make_user(db, email="analyst@example.com", role=UserRole.analyst, club_id=club.id)
    division = await make_division(db, club.id)
    tournament = await make_tournament(db, club.id, division.id)

    admin_tokens = await login(client, admin.email)
    created = await client.post(
        f"/tournaments/{tournament.id}/sessions",
        json={"home_team": "Local", "away_team": "Visita"},
        headers=auth_header(admin_tokens["access_token"]),
    )
    session_id = created.json()["id"]

    analyst_tokens = await login(client, "analyst@example.com")
    res = await client.patch(
        f"/sessions/{session_id}/timer",
        json={"action": "start"},
        headers=auth_header(analyst_tokens["access_token"]),
    )
    assert res.status_code == 403
