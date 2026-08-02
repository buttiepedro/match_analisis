"""
Entrenamientos y asistencia.

El foco está en la idempotencia del `PUT`: la planilla se carga en la cancha y
la cola offline puede reenviarla varias veces sin que nadie se entere.
"""
from datetime import date, timedelta

import pytest

from app.models import UserRole

from tests.conftest import auth_header, login, make_club, make_division, make_user


@pytest.fixture
async def training_ctx(client, db, club_admin_ctx):
    club = club_admin_ctx["club"]
    division = await make_division(db, club.id)

    players = []
    for name in ("Ana Perez", "Bruno Diaz", "Carla Gomez"):
        res = await client.post(
            f"/divisions/{division.id}/players",
            json={"name": name},
            headers=club_admin_ctx["headers"],
        )
        assert res.status_code == 201, res.text
        players.append(res.json())

    return {
        "club": club,
        "division": division,
        "players": players,
        "headers": club_admin_ctx["headers"],
    }


async def _create_training(client, ctx, day: date, type_: str = "entrenamiento") -> str:
    res = await client.post(
        f"/divisions/{ctx['division'].id}/trainings",
        json={"date": day.isoformat(), "type": type_},
        headers=ctx["headers"],
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


# ── CRUD ──────────────────────────────────────────────────────────────────────

async def test_create_and_list_trainings(client, training_ctx):
    await _create_training(client, training_ctx, date.today())
    await _create_training(client, training_ctx, date.today() - timedelta(days=2), "gimnasio")

    res = await client.get(
        f"/divisions/{training_ctx['division'].id}/trainings", headers=training_ctx["headers"]
    )
    assert res.status_code == 200
    body = res.json()
    assert len(body) == 2
    # Más reciente primero.
    assert body[0]["date"] == date.today().isoformat()
    assert body[0]["total_count"] == 0


async def test_list_trainings_filters_by_date_range(client, training_ctx):
    await _create_training(client, training_ctx, date.today())
    await _create_training(client, training_ctx, date.today() - timedelta(days=60))

    res = await client.get(
        f"/divisions/{training_ctx['division'].id}/trainings",
        params={"from": (date.today() - timedelta(days=7)).isoformat()},
        headers=training_ctx["headers"],
    )
    assert res.status_code == 200
    assert len(res.json()) == 1


async def test_location_is_nullable_and_editable(client, training_ctx):
    """Texto libre: el club nombra sus lugares como quiere, y puede no cargarlo."""
    training_id = await _create_training(client, training_ctx, date.today())

    res = await client.get(f"/trainings/{training_id}", headers=training_ctx["headers"])
    assert res.json()["location"] is None

    res = await client.patch(
        f"/trainings/{training_id}",
        json={"location": "Cancha 2"},
        headers=training_ctx["headers"],
    )
    assert res.status_code == 200, res.text
    assert res.json()["location"] == "Cancha 2"

    res = await client.get(
        f"/divisions/{training_ctx['division'].id}/trainings", headers=training_ctx["headers"]
    )
    assert res.json()[0]["location"] == "Cancha 2"


async def test_location_shows_up_in_today_and_calendar(client, training_ctx):
    """El jugador necesita saber a dónde ir sin entrar a Config a buscarlo."""
    res = await client.post(
        f"/divisions/{training_ctx['division'].id}/trainings",
        json={"date": date.today().isoformat(), "type": "entrenamiento", "location": "Gimnasio del club"},
        headers=training_ctx["headers"],
    )
    assert res.status_code == 201, res.text

    today = await client.get(
        f"/clubs/{training_ctx['club'].id}/today", headers=training_ctx["headers"]
    )
    assert today.json()["trainings"][0]["location"] == "Gimnasio del club"

    calendar = await client.get(
        f"/divisions/{training_ctx['division'].id}/calendar", headers=training_ctx["headers"]
    )
    entrenamiento = next(e for e in calendar.json() if e["kind"] == "entrenamiento")
    assert entrenamiento["location"] == "Gimnasio del club"


async def test_deleting_a_training_removes_its_attendance(client, training_ctx):
    training_id = await _create_training(client, training_ctx, date.today())
    await client.put(
        f"/trainings/{training_id}/attendance",
        json={"entries": [{"player_id": training_ctx["players"][0]["id"], "status": "presente"}]},
        headers=training_ctx["headers"],
    )

    res = await client.delete(f"/trainings/{training_id}", headers=training_ctx["headers"])
    assert res.status_code == 204

    res = await client.get(f"/trainings/{training_id}", headers=training_ctx["headers"])
    assert res.status_code == 404


# ── Asistencia ────────────────────────────────────────────────────────────────

async def test_attendance_lists_the_whole_squad_even_before_loading(client, training_ctx):
    """La planilla arranca con todos los jugadores, sin estado: se marca la excepción."""
    training_id = await _create_training(client, training_ctx, date.today())

    res = await client.get(f"/trainings/{training_id}/attendance", headers=training_ctx["headers"])
    assert res.status_code == 200
    body = res.json()
    assert len(body) == 3
    assert all(row["status"] is None for row in body)
    assert [row["player_name"] for row in body] == ["Ana Perez", "Bruno Diaz", "Carla Gomez"]


async def test_saving_attendance_twice_does_not_duplicate(client, training_ctx):
    """La cola offline reenvía sin coordinación: el PUT tiene que ser idempotente."""
    training_id = await _create_training(client, training_ctx, date.today())
    payload = {
        "entries": [
            {"player_id": training_ctx["players"][0]["id"], "status": "presente"},
            {"player_id": training_ctx["players"][1]["id"], "status": "ausente"},
        ]
    }

    first = await client.put(
        f"/trainings/{training_id}/attendance", json=payload, headers=training_ctx["headers"]
    )
    assert first.status_code == 200

    second = await client.put(
        f"/trainings/{training_id}/attendance", json=payload, headers=training_ctx["headers"]
    )
    assert second.status_code == 200
    assert first.json() == second.json()

    res = await client.get(f"/trainings/{training_id}/attendance", headers=training_ctx["headers"])
    loaded = [r for r in res.json() if r["status"] is not None]
    assert len(loaded) == 2


async def test_resending_attendance_with_a_changed_status_overwrites(client, training_ctx):
    training_id = await _create_training(client, training_ctx, date.today())
    player_id = training_ctx["players"][0]["id"]

    await client.put(
        f"/trainings/{training_id}/attendance",
        json={"entries": [{"player_id": player_id, "status": "ausente"}]},
        headers=training_ctx["headers"],
    )
    await client.put(
        f"/trainings/{training_id}/attendance",
        json={"entries": [{"player_id": player_id, "status": "presente"}]},
        headers=training_ctx["headers"],
    )

    res = await client.get(f"/trainings/{training_id}/attendance", headers=training_ctx["headers"])
    row = next(r for r in res.json() if r["player_id"] == player_id)
    assert row["status"] == "presente"


async def test_cannot_load_attendance_for_a_player_of_another_division(
    client, db, training_ctx, club_admin_ctx
):
    training_id = await _create_training(client, training_ctx, date.today())
    other_division = await make_division(db, training_ctx["club"].id, name="M17")
    res = await client.post(
        f"/divisions/{other_division.id}/players",
        json={"name": "Ajeno"},
        headers=club_admin_ctx["headers"],
    )
    outsider_id = res.json()["id"]

    res = await client.put(
        f"/trainings/{training_id}/attendance",
        json={"entries": [{"player_id": outsider_id, "status": "presente"}]},
        headers=training_ctx["headers"],
    )
    assert res.status_code == 422


# ── Aislamiento entre clubes ──────────────────────────────────────────────────

async def test_another_club_cannot_read_trainings(client, db, training_ctx):
    other_club = await make_club(db, name="Otro", slug="otro")
    await make_user(db, email="otro@example.com", role=UserRole.club_admin, club_id=other_club.id)
    tokens = await login(client, "otro@example.com")

    res = await client.get(
        f"/divisions/{training_ctx['division'].id}/trainings",
        headers=auth_header(tokens["access_token"]),
    )
    assert res.status_code == 403


# ── Métricas ──────────────────────────────────────────────────────────────────

async def test_summary_computes_percentages_and_average(client, training_ctx):
    ana, bruno, carla = training_ctx["players"]
    for offset in range(4):
        training_id = await _create_training(
            client, training_ctx, date.today() - timedelta(days=offset)
        )
        await client.put(
            f"/trainings/{training_id}/attendance",
            json={
                "entries": [
                    {"player_id": ana["id"], "status": "presente"},
                    # Bruno viene la mitad de las veces.
                    {"player_id": bruno["id"], "status": "presente" if offset % 2 else "ausente"},
                    {"player_id": carla["id"], "status": "ausente"},
                ]
            },
            headers=training_ctx["headers"],
        )

    res = await client.get(
        f"/divisions/{training_ctx['division'].id}/attendance/summary",
        params={"days": 30},
        headers=training_ctx["headers"],
    )
    assert res.status_code == 200
    body = res.json()
    assert body["trainings_count"] == 4

    by_name = {p["player_name"]: p for p in body["players"]}
    assert by_name["Ana Perez"]["percent"] == 100.0
    assert by_name["Bruno Diaz"]["percent"] == 50.0
    assert by_name["Carla Gomez"]["percent"] == 0.0
    # Ordenado de mayor a menor asistencia.
    assert [p["player_name"] for p in body["players"]][0] == "Ana Perez"


async def test_three_consecutive_absences_flags_at_risk(client, training_ctx):
    ana, bruno, _ = training_ctx["players"]
    # Bruno viene el más viejo y falta los tres siguientes.
    for offset, bruno_status in enumerate(["ausente", "ausente", "ausente", "presente"]):
        training_id = await _create_training(
            client, training_ctx, date.today() - timedelta(days=offset)
        )
        await client.put(
            f"/trainings/{training_id}/attendance",
            json={
                "entries": [
                    {"player_id": ana["id"], "status": "presente"},
                    {"player_id": bruno["id"], "status": bruno_status},
                ]
            },
            headers=training_ctx["headers"],
        )

    res = await client.get(
        f"/divisions/{training_ctx['division'].id}/attendance/summary",
        headers=training_ctx["headers"],
    )
    by_name = {p["player_name"]: p for p in res.json()["players"]}
    assert by_name["Bruno Diaz"]["current_absence_streak"] == 3
    assert by_name["Bruno Diaz"]["at_risk"] is True
    assert by_name["Ana Perez"]["at_risk"] is False


async def test_a_justified_absence_does_not_count_toward_the_streak(client, training_ctx):
    """Justificado no es deserción: contarlo llenaría la pantalla de falsos positivos."""
    ana = training_ctx["players"][0]
    for offset, status_ in enumerate(["ausente", "justificado", "ausente"]):
        training_id = await _create_training(
            client, training_ctx, date.today() - timedelta(days=offset)
        )
        await client.put(
            f"/trainings/{training_id}/attendance",
            json={"entries": [{"player_id": ana["id"], "status": status_}]},
            headers=training_ctx["headers"],
        )

    res = await client.get(
        f"/divisions/{training_ctx['division'].id}/attendance/summary",
        headers=training_ctx["headers"],
    )
    by_name = {p["player_name"]: p for p in res.json()["players"]}
    assert by_name["Ana Perez"]["current_absence_streak"] == 1


async def test_a_player_with_no_records_is_not_flagged_at_risk(client, training_ctx):
    """Sin datos cargados no hay riesgo que reportar, solo ignorancia."""
    ana = training_ctx["players"][0]
    training_id = await _create_training(client, training_ctx, date.today())
    await client.put(
        f"/trainings/{training_id}/attendance",
        json={"entries": [{"player_id": ana["id"], "status": "presente"}]},
        headers=training_ctx["headers"],
    )

    res = await client.get(
        f"/divisions/{training_ctx['division'].id}/attendance/summary",
        headers=training_ctx["headers"],
    )
    by_name = {p["player_name"]: p for p in res.json()["players"]}
    assert by_name["Carla Gomez"]["total"] == 0
    assert by_name["Carla Gomez"]["at_risk"] is False


async def test_player_attendance_detail_has_windowed_percentages(client, training_ctx):
    ana = training_ctx["players"][0]
    # Presente hace 100 días (fuera de 30 y 90), ausente hoy.
    old = await _create_training(client, training_ctx, date.today() - timedelta(days=100))
    await client.put(
        f"/trainings/{old}/attendance",
        json={"entries": [{"player_id": ana["id"], "status": "presente"}]},
        headers=training_ctx["headers"],
    )
    recent = await _create_training(client, training_ctx, date.today())
    await client.put(
        f"/trainings/{recent}/attendance",
        json={"entries": [{"player_id": ana["id"], "status": "ausente"}]},
        headers=training_ctx["headers"],
    )

    res = await client.get(f"/players/{ana['id']}/attendance", headers=training_ctx["headers"])
    assert res.status_code == 200
    body = res.json()
    assert body["percent_30"] == 0.0
    assert body["percent_90"] == 0.0
    assert body["percent_season"] == 50.0
    assert len(body["records"]) == 2


async def test_summary_breaks_attendance_down_by_weekday(client, training_ctx):
    """Elegir el horario con un dato, no con la sensación de que 'los martes viene poca gente'."""
    ana, bruno, _ = training_ctx["players"]

    # Dos entrenamientos el mismo día de semana (hoy y hace 7 días) y uno ayer.
    same_weekday = [date.today(), date.today() - timedelta(days=7)]
    for day in same_weekday:
        training_id = await _create_training(client, training_ctx, day)
        await client.put(
            f"/trainings/{training_id}/attendance",
            json={
                "entries": [
                    {"player_id": ana["id"], "status": "presente"},
                    {"player_id": bruno["id"], "status": "ausente"},
                ]
            },
            headers=training_ctx["headers"],
        )

    other_day = date.today() - timedelta(days=1)
    training_id = await _create_training(client, training_ctx, other_day)
    await client.put(
        f"/trainings/{training_id}/attendance",
        json={
            "entries": [
                {"player_id": ana["id"], "status": "presente"},
                {"player_id": bruno["id"], "status": "presente"},
            ]
        },
        headers=training_ctx["headers"],
    )

    res = await client.get(
        f"/divisions/{training_ctx['division'].id}/attendance/summary",
        headers=training_ctx["headers"],
    )
    by_weekday = {row["weekday"]: row for row in res.json()["by_weekday"]}

    assert by_weekday[date.today().weekday()]["trainings_count"] == 2
    assert by_weekday[date.today().weekday()]["average_percent"] == 50.0
    assert by_weekday[other_day.weekday()]["average_percent"] == 100.0


async def test_weekday_breakdown_ignores_trainings_without_attendance(client, training_ctx):
    """Un entrenamiento sin planilla cargada no es 0% de asistencia, es sin datos."""
    await _create_training(client, training_ctx, date.today())

    res = await client.get(
        f"/divisions/{training_ctx['division'].id}/attendance/summary",
        headers=training_ctx["headers"],
    )
    assert res.json()["by_weekday"] == []


async def test_late_counts_as_attended(client, training_ctx):
    ana = training_ctx["players"][0]
    training_id = await _create_training(client, training_ctx, date.today())
    await client.put(
        f"/trainings/{training_id}/attendance",
        json={"entries": [{"player_id": ana["id"], "status": "tarde"}]},
        headers=training_ctx["headers"],
    )

    res = await client.get(f"/players/{ana['id']}/attendance", headers=training_ctx["headers"])
    assert res.json()["percent_season"] == 100.0
