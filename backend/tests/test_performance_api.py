"""Mediciones antropométricas y tests físicos vistos desde la API."""
import pytest

from tests.conftest import make_division


@pytest.fixture
async def player(client, db, club_admin_ctx):
    division = await make_division(db, club_admin_ctx["club"].id)
    res = await client.post(
        f"/divisions/{division.id}/players",
        json={"name": "Juan García", "position": "Apertura"},
        headers=club_admin_ctx["headers"],
    )
    assert res.status_code == 201, res.text
    return {"id": res.json()["id"], "division_id": str(division.id)}


async def set_player_profile(client, player, division_id, headers, **fields):
    res = await client.patch(
        f"/divisions/{division_id}/players/{player}",
        json=fields,
        headers=headers,
    )
    assert res.status_code == 200, res.text


async def test_measurement_computes_bmi(client, player, club_admin_ctx):
    res = await client.post(
        f"/players/{player['id']}/measurements",
        json={"measured_at": "2026-06-10", "weight_kg": 82.4, "height_cm": 181},
        headers=club_admin_ctx["headers"],
    )

    assert res.status_code == 201
    assert float(res.json()["bmi"]) == pytest.approx(25.15, abs=0.01)


async def test_measurement_uses_the_players_age_and_sex(client, player, club_admin_ctx):
    """Antes se usaban siempre las constantes de varón 17-19."""
    await set_player_profile(
        client, player["id"], player["division_id"], club_admin_ctx["headers"],
        date_of_birth="1985-03-20", sex="F",
    )

    res = await client.post(
        f"/players/{player['id']}/measurements",
        json={
            "measured_at": "2026-06-10",
            "weight_kg": 70,
            "height_cm": 168,
            "fat_fold_tricep_mm": 12,
            "fat_fold_subscapular_mm": 15,
            "fat_fold_suprailiac_mm": 18,
            "fat_fold_biceps_mm": 8,
        },
        headers=club_admin_ctx["headers"],
    )

    assert res.status_code == 201
    assert res.json()["body_fat_method"] == "dw4c/F/40-49"


async def test_measurement_marks_assumed_values_when_the_profile_is_incomplete(
    client, player, club_admin_ctx
):
    res = await client.post(
        f"/players/{player['id']}/measurements",
        json={
            "measured_at": "2026-06-10",
            "weight_kg": 82,
            "fat_fold_tricep_mm": 12,
            "fat_fold_subscapular_mm": 15,
            "fat_fold_suprailiac_mm": 18,
            "fat_fold_abdominal_mm": 20,
        },
        headers=club_admin_ctx["headers"],
    )

    assert res.status_code == 201
    assert res.json()["body_fat_method"] == "dw4a/M*/20-29*"


async def test_measurement_without_folds_has_no_body_fat(client, player, club_admin_ctx):
    res = await client.post(
        f"/players/{player['id']}/measurements",
        json={"measured_at": "2026-06-10", "weight_kg": 82.4, "height_cm": 181},
        headers=club_admin_ctx["headers"],
    )

    body = res.json()
    assert body["body_fat_percent"] is None
    assert body["body_fat_method"] is None


async def test_measurements_are_listed_newest_first(client, player, club_admin_ctx):
    for day in ("2026-04-01", "2026-06-10", "2026-05-15"):
        await client.post(
            f"/players/{player['id']}/measurements",
            json={"measured_at": day, "weight_kg": 80},
            headers=club_admin_ctx["headers"],
        )

    listed = (await client.get(
        f"/players/{player['id']}/measurements", headers=club_admin_ctx["headers"]
    )).json()

    assert [m["measured_at"] for m in listed] == ["2026-06-10", "2026-05-15", "2026-04-01"]


async def test_physical_test_derives_the_unit_from_the_catalogue(client, player, club_admin_ctx):
    res = await client.post(
        f"/players/{player['id']}/tests",
        json={"test_date": "2026-06-10", "test_type": "bronco", "value": 295},
        headers=club_admin_ctx["headers"],
    )

    assert res.status_code == 201
    assert res.json()["unit"] == "seconds"


async def test_physical_test_rejects_an_unknown_type(client, player, club_admin_ctx):
    res = await client.post(
        f"/players/{player['id']}/tests",
        json={"test_date": "2026-06-10", "test_type": "burpees", "value": 30},
        headers=club_admin_ctx["headers"],
    )
    assert res.status_code == 422


async def test_ranking_sorts_time_tests_ascending(client, db, club_admin_ctx):
    division = await make_division(db, club_admin_ctx["club"].id)
    times = {"Lento": 320, "Rápido": 290, "Medio": 305}

    for name, value in times.items():
        created = await client.post(
            f"/divisions/{division.id}/players",
            json={"name": name},
            headers=club_admin_ctx["headers"],
        )
        await client.post(
            f"/players/{created.json()['id']}/tests",
            json={"test_date": "2026-06-10", "test_type": "bronco", "value": value},
            headers=club_admin_ctx["headers"],
        )

    ranking = (await client.get(
        f"/divisions/{division.id}/tests/ranking",
        params={"test_type": "bronco"},
        headers=club_admin_ctx["headers"],
    )).json()

    assert [r["player_name"] for r in ranking] == ["Rápido", "Medio", "Lento"]
    assert [r["rank"] for r in ranking] == [1, 2, 3]


async def test_ranking_sorts_strength_tests_descending(client, db, club_admin_ctx):
    division = await make_division(db, club_admin_ctx["club"].id)
    lifts = {"Fuerte": 140, "Flojo": 90, "Medio": 115}

    for name, value in lifts.items():
        created = await client.post(
            f"/divisions/{division.id}/players",
            json={"name": name},
            headers=club_admin_ctx["headers"],
        )
        await client.post(
            f"/players/{created.json()['id']}/tests",
            json={"test_date": "2026-06-10", "test_type": "bench_1rm", "value": value},
            headers=club_admin_ctx["headers"],
        )

    ranking = (await client.get(
        f"/divisions/{division.id}/tests/ranking",
        params={"test_type": "bench_1rm"},
        headers=club_admin_ctx["headers"],
    )).json()

    assert [r["player_name"] for r in ranking] == ["Fuerte", "Medio", "Flojo"]


async def test_batch_move_updates_division_and_leaves_a_history_entry(
    client, db, club_admin_ctx
):
    club = club_admin_ctx["club"]
    origin = await make_division(db, club.id, name="M17")
    target = await make_division(db, club.id, name="Primera")

    created = await client.post(
        f"/divisions/{origin.id}/players",
        json={"name": "Juan García"},
        headers=club_admin_ctx["headers"],
    )
    player_id = created.json()["id"]

    res = await client.patch(
        "/players/batch-move",
        json={"player_ids": [player_id], "to_division_id": str(target.id)},
        headers=club_admin_ctx["headers"],
    )

    assert res.status_code == 200
    assert res.json()["moved"] == 1

    history = (await client.get(
        f"/players/{player_id}/history", headers=club_admin_ctx["headers"]
    )).json()
    assert history[0]["division_name"] == "Primera"
    assert history[0]["to_date"] is None
