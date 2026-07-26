"""
Registro de eventos, con foco en el sellado de tiempo: un evento que se registró
sin conexión y se envía diferido tiene que conservar el minuto real del hecho.
"""
import pytest

from tests.conftest import make_division, make_tournament


@pytest.fixture
async def session_id(client, db, club_admin_ctx):
    club = club_admin_ctx["club"]
    division = await make_division(db, club.id)
    tournament = await make_tournament(db, club.id, division.id)
    res = await client.post(
        f"/tournaments/{tournament.id}/sessions",
        json={"home_team": "Club Test", "away_team": "Rival", "half_duration_minutes": 40},
        headers=club_admin_ctx["headers"],
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


async def test_event_without_client_stamp_uses_the_server_timer(client, session_id, club_admin_ctx):
    res = await client.post(
        f"/sessions/{session_id}/events",
        json={"event_type": "try", "team": "user"},
        headers=club_admin_ctx["headers"],
    )

    assert res.status_code == 201
    body = res.json()
    assert body["timer_seconds"] == 0  # timer sin arrancar
    assert body["half"] == 1


async def test_deferred_event_keeps_the_match_time_it_was_recorded_at(
    client, session_id, club_admin_ctx
):
    """El evento de la cola offline no debe sellarse con la hora de la reconexión."""
    res = await client.post(
        f"/sessions/{session_id}/events",
        json={"event_type": "try", "team": "user", "timer_seconds": 1325, "half": 2},
        headers=club_admin_ctx["headers"],
    )

    assert res.status_code == 201
    body = res.json()
    assert body["timer_seconds"] == 1325
    assert body["half"] == 2


async def test_client_stamp_is_ignored_unless_both_fields_are_present(
    client, session_id, club_admin_ctx
):
    res = await client.post(
        f"/sessions/{session_id}/events",
        json={"event_type": "try", "team": "user", "timer_seconds": 1325},
        headers=club_admin_ctx["headers"],
    )

    assert res.status_code == 201
    assert res.json()["timer_seconds"] == 0


async def test_rejects_a_negative_client_stamp(client, session_id, club_admin_ctx):
    res = await client.post(
        f"/sessions/{session_id}/events",
        json={"event_type": "try", "team": "user", "timer_seconds": -5, "half": 1},
        headers=club_admin_ctx["headers"],
    )
    assert res.status_code == 422


async def test_rejects_an_impossible_half(client, session_id, club_admin_ctx):
    res = await client.post(
        f"/sessions/{session_id}/events",
        json={"event_type": "try", "team": "user", "timer_seconds": 10, "half": 3},
        headers=club_admin_ctx["headers"],
    )
    assert res.status_code == 422


async def test_rejects_a_team_outside_user_rival(client, session_id, club_admin_ctx):
    res = await client.post(
        f"/sessions/{session_id}/events",
        json={"event_type": "try", "team": "home"},
        headers=club_admin_ctx["headers"],
    )
    assert res.status_code == 422


async def test_metadata_and_reason_survive_the_round_trip(client, session_id, club_admin_ctx):
    await client.post(
        f"/sessions/{session_id}/events",
        json={
            "event_type": "penalty",
            "team": "user",
            "reason": "a_los_palos",
            "metadata": {"converted": True},
        },
        headers=club_admin_ctx["headers"],
    )

    events = (await client.get(f"/sessions/{session_id}/events", headers=club_admin_ctx["headers"])).json()

    assert len(events) == 1
    assert events[0]["reason"] == "a_los_palos"
    assert events[0]["metadata"] == {"converted": True}


async def test_events_come_back_ordered_by_match_time(client, session_id, club_admin_ctx):
    for half, seconds in [(2, 100), (1, 500), (1, 20)]:
        await client.post(
            f"/sessions/{session_id}/events",
            json={"event_type": "try", "team": "user", "timer_seconds": seconds, "half": half},
            headers=club_admin_ctx["headers"],
        )

    events = (await client.get(f"/sessions/{session_id}/events", headers=club_admin_ctx["headers"])).json()

    assert [(e["half"], e["timer_seconds"]) for e in events] == [(1, 20), (1, 500), (2, 100)]


async def test_deleting_an_event_removes_it(client, session_id, club_admin_ctx):
    created = await client.post(
        f"/sessions/{session_id}/events",
        json={"event_type": "try", "team": "user"},
        headers=club_admin_ctx["headers"],
    )
    event_id = created.json()["id"]

    res = await client.delete(
        f"/sessions/{session_id}/events/{event_id}", headers=club_admin_ctx["headers"]
    )

    assert res.status_code == 204
    events = (await client.get(f"/sessions/{session_id}/events", headers=club_admin_ctx["headers"])).json()
    assert events == []
