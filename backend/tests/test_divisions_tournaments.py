"""
Edición y baja de divisiones y torneos. La regla que importa: no se archiva algo
que todavía tiene contenido activo colgando, porque lo esconde sin borrarlo.
"""
from tests.conftest import make_division, make_tournament


# ── Divisiones ────────────────────────────────────────────────────────────────

async def test_rename_division(client, db, club_admin_ctx):
    club = club_admin_ctx["club"]
    division = await make_division(db, club.id, name="Primeraa")

    res = await client.patch(
        f"/clubs/{club.id}/divisions/{division.id}",
        json={"name": "Primera"},
        headers=club_admin_ctx["headers"],
    )

    assert res.status_code == 200
    assert res.json()["name"] == "Primera"


async def test_rename_rejects_an_empty_name(client, db, club_admin_ctx):
    club = club_admin_ctx["club"]
    division = await make_division(db, club.id)

    res = await client.patch(
        f"/clubs/{club.id}/divisions/{division.id}",
        json={"name": "   "},
        headers=club_admin_ctx["headers"],
    )
    assert res.status_code == 400


async def test_delete_empty_division_hides_it_from_the_list(client, db, club_admin_ctx):
    club = club_admin_ctx["club"]
    division = await make_division(db, club.id)

    res = await client.delete(
        f"/clubs/{club.id}/divisions/{division.id}", headers=club_admin_ctx["headers"]
    )

    assert res.status_code == 204
    listed = (await client.get(f"/clubs/{club.id}/divisions", headers=club_admin_ctx["headers"])).json()
    assert listed == []


async def test_cannot_delete_a_division_with_active_players(client, db, club_admin_ctx):
    club = club_admin_ctx["club"]
    division = await make_division(db, club.id)
    await client.post(
        f"/divisions/{division.id}/players",
        json={"name": "Juan García", "position": "Apertura"},
        headers=club_admin_ctx["headers"],
    )

    res = await client.delete(
        f"/clubs/{club.id}/divisions/{division.id}", headers=club_admin_ctx["headers"]
    )

    assert res.status_code == 409
    assert "jugador" in res.json()["detail"].lower()


async def test_cannot_delete_a_division_with_active_tournaments(client, db, club_admin_ctx):
    club = club_admin_ctx["club"]
    division = await make_division(db, club.id)
    await make_tournament(db, club.id, division.id)

    res = await client.delete(
        f"/clubs/{club.id}/divisions/{division.id}", headers=club_admin_ctx["headers"]
    )

    assert res.status_code == 409
    assert "torneo" in res.json()["detail"].lower()


async def test_delete_unknown_division_is_404(client, club_admin_ctx):
    club = club_admin_ctx["club"]
    res = await client.delete(
        f"/clubs/{club.id}/divisions/00000000-0000-0000-0000-000000000000",
        headers=club_admin_ctx["headers"],
    )
    assert res.status_code == 404


# ── Torneos ───────────────────────────────────────────────────────────────────

async def test_edit_tournament_name_season_and_division(client, db, club_admin_ctx):
    club = club_admin_ctx["club"]
    division = await make_division(db, club.id, name="Primera")
    other = await make_division(db, club.id, name="M17")
    tournament = await make_tournament(db, club.id, division.id, name="Torneo viejo")

    res = await client.patch(
        f"/clubs/{club.id}/tournaments/{tournament.id}",
        json={"name": "Torneo Apertura", "season": "2027", "division_id": str(other.id)},
        headers=club_admin_ctx["headers"],
    )

    assert res.status_code == 200
    body = res.json()
    assert body["name"] == "Torneo Apertura"
    assert body["season"] == "2027"
    assert body["division"]["name"] == "M17"


async def test_cannot_move_a_tournament_to_another_clubs_division(client, db, club_admin_ctx):
    from tests.conftest import make_club

    club = club_admin_ctx["club"]
    division = await make_division(db, club.id)
    tournament = await make_tournament(db, club.id, division.id)

    foreign_club = await make_club(db, name="Otro", slug="otro")
    foreign_division = await make_division(db, foreign_club.id)

    res = await client.patch(
        f"/clubs/{club.id}/tournaments/{tournament.id}",
        json={"division_id": str(foreign_division.id)},
        headers=club_admin_ctx["headers"],
    )
    assert res.status_code == 404


async def test_delete_empty_tournament(client, db, club_admin_ctx):
    club = club_admin_ctx["club"]
    division = await make_division(db, club.id)
    tournament = await make_tournament(db, club.id, division.id)

    res = await client.delete(
        f"/clubs/{club.id}/tournaments/{tournament.id}", headers=club_admin_ctx["headers"]
    )

    assert res.status_code == 204
    listed = (await client.get(f"/clubs/{club.id}/tournaments", headers=club_admin_ctx["headers"])).json()
    assert listed == []


async def test_cannot_delete_a_tournament_that_has_matches(client, db, club_admin_ctx):
    club = club_admin_ctx["club"]
    division = await make_division(db, club.id)
    tournament = await make_tournament(db, club.id, division.id)
    await client.post(
        f"/tournaments/{tournament.id}/sessions",
        json={"home_team": "Club Test", "away_team": "Rival"},
        headers=club_admin_ctx["headers"],
    )

    res = await client.delete(
        f"/clubs/{club.id}/tournaments/{tournament.id}", headers=club_admin_ctx["headers"]
    )

    assert res.status_code == 409
    assert "partido" in res.json()["detail"].lower()
