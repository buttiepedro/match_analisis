"""
Planes de gimnasio.

Lo que más importa es la **carga relativa**: que `75% de Sentadilla 3RM` se
resuelva contra el test de cada jugador, y que cuando falta el test no se invente
un kilaje — porque el jugador lo levanta.
"""
import pytest
from sqlalchemy import select

from app.core.permissions import PREPARADOR_FISICO
from app.models import Role, UserRole, user_roles

from tests.conftest import auth_header, login, make_division, make_user


@pytest.fixture
async def gym_ctx(client, db, club_admin_ctx):
    club = club_admin_ctx["club"]
    division = await make_division(db, club.id)

    pf = await make_user(db, email="pf@example.com", role=UserRole.analyst, club_id=club.id)
    role = await db.scalar(
        select(Role).where(Role.club_id == club.id, Role.name == PREPARADOR_FISICO)
    )
    await db.execute(user_roles.insert().values(user_id=pf.id, role_id=role.id))
    await db.commit()
    tokens = await login(client, pf.email)

    res = await client.post(
        f"/divisions/{division.id}/players",
        json={"name": "Ana Perez"},
        headers=club_admin_ctx["headers"],
    )
    player = res.json()

    return {
        "club": club,
        "division": division,
        "player": player,
        "pf_headers": auth_header(tokens["access_token"]),
        "admin_headers": club_admin_ctx["headers"],
    }


async def _make_plan(client, ctx, weeks=4):
    res = await client.post(
        f"/divisions/{ctx['division'].id}/gym-plans",
        json={"name": "Pretemporada", "weeks": weeks},
        headers=ctx["pf_headers"],
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


async def _set_structure(client, ctx, plan_id, exercises):
    return await client.put(
        f"/gym-plans/{plan_id}/structure",
        json={"days": [{"week": 1, "day": 1, "name": "Tren inferior", "exercises": exercises}]},
        headers=ctx["pf_headers"],
    )


async def _invite(client, ctx, email="ana@example.com"):
    res = await client.post(
        f"/divisions/{ctx['division'].id}/players/{ctx['player']['id']}/invite",
        json={"email": email, "password": "secret123"},
        headers=ctx["admin_headers"],
    )
    assert res.status_code == 200, res.text
    tokens = await login(client, email)
    return auth_header(tokens["access_token"])


# ── Carga relativa: el punto del módulo ───────────────────────────────────────

async def test_a_relative_load_resolves_against_the_players_own_test(client, gym_ctx):
    """El PF escribe un plan para la división y cada uno ve sus kilos."""
    await client.post(
        f"/players/{gym_ctx['player']['id']}/tests",
        json={"test_date": "2026-07-01", "test_type": "squat_3rm", "value": 100},
        headers=gym_ctx["admin_headers"],
    )

    plan_id = await _make_plan(client, gym_ctx)
    res = await _set_structure(client, gym_ctx, plan_id, [
        {
            "name": "Sentadilla", "sets": 4, "reps": "5",
            "load_type": "porcentaje_test", "load_value": 75,
            "load_test_type": "squat_3rm",
        }
    ])
    assert res.status_code == 200, res.text

    headers = await _invite(client, gym_ctx)
    res = await client.get("/me/gym-plan", headers=headers)
    assert res.status_code == 200, res.text

    exercise = res.json()["plan"]["days"][0]["exercises"][0]
    assert exercise["resolved_load_kg"] == 75.0
    assert exercise["unresolved_reason"] is None


async def test_the_resolved_load_rounds_to_a_plate(client, gym_ctx):
    """Decirle a alguien "levantá 83.7 kg" es darle un número que no puede armar."""
    await client.post(
        f"/players/{gym_ctx['player']['id']}/tests",
        json={"test_date": "2026-07-01", "test_type": "squat_3rm", "value": 112},
        headers=gym_ctx["admin_headers"],
    )
    plan_id = await _make_plan(client, gym_ctx)
    await _set_structure(client, gym_ctx, plan_id, [
        {
            "name": "Sentadilla", "load_type": "porcentaje_test",
            "load_value": 75, "load_test_type": "squat_3rm",
        }
    ])

    headers = await _invite(client, gym_ctx)
    res = await client.get("/me/gym-plan", headers=headers)
    # 112 * 0.75 = 84 exacto; con 2.5 de paso queda en 85.
    assert res.json()["plan"]["days"][0]["exercises"][0]["resolved_load_kg"] == 85.0


async def test_a_missing_test_explains_instead_of_inventing_a_load(client, gym_ctx):
    """Un kilaje inventado es peor que un aviso: el jugador lo levanta."""
    plan_id = await _make_plan(client, gym_ctx)
    await _set_structure(client, gym_ctx, plan_id, [
        {
            "name": "Sentadilla", "load_type": "porcentaje_test",
            "load_value": 75, "load_test_type": "squat_3rm",
        }
    ])

    headers = await _invite(client, gym_ctx)
    res = await client.get("/me/gym-plan", headers=headers)

    exercise = res.json()["plan"]["days"][0]["exercises"][0]
    assert exercise["resolved_load_kg"] is None
    assert "Sentadilla 3RM" in exercise["unresolved_reason"]


async def test_the_most_recent_test_wins(client, gym_ctx):
    for date_, value in (("2026-05-01", 90), ("2026-07-01", 120)):
        await client.post(
            f"/players/{gym_ctx['player']['id']}/tests",
            json={"test_date": date_, "test_type": "squat_3rm", "value": value},
            headers=gym_ctx["admin_headers"],
        )

    plan_id = await _make_plan(client, gym_ctx)
    await _set_structure(client, gym_ctx, plan_id, [
        {
            "name": "Sentadilla", "load_type": "porcentaje_test",
            "load_value": 50, "load_test_type": "squat_3rm",
        }
    ])

    headers = await _invite(client, gym_ctx)
    res = await client.get("/me/gym-plan", headers=headers)
    assert res.json()["plan"]["days"][0]["exercises"][0]["resolved_load_kg"] == 60.0


async def test_an_absolute_load_is_the_same_for_everyone(client, gym_ctx):
    plan_id = await _make_plan(client, gym_ctx)
    await _set_structure(client, gym_ctx, plan_id, [
        {"name": "Remo", "load_type": "absoluta", "load_value": 60}
    ])

    headers = await _invite(client, gym_ctx)
    res = await client.get("/me/gym-plan", headers=headers)
    assert res.json()["plan"]["days"][0]["exercises"][0]["resolved_load_kg"] == 60.0


async def test_the_coach_view_does_not_resolve_loads(client, gym_ctx):
    """El PF ve el porcentaje: los kilos dependen de quién lo levanta."""
    plan_id = await _make_plan(client, gym_ctx)
    await _set_structure(client, gym_ctx, plan_id, [
        {
            "name": "Sentadilla", "load_type": "porcentaje_test",
            "load_value": 75, "load_test_type": "squat_3rm",
        }
    ])

    res = await client.get(f"/gym-plans/{plan_id}", headers=gym_ctx["pf_headers"])
    exercise = res.json()["days"][0]["exercises"][0]
    assert exercise["resolved_load_kg"] is None
    assert exercise["load_value"] == 75.0
    assert exercise["load_test_label"] == "Sentadilla 3RM"


# ── Validación de la estructura ───────────────────────────────────────────────

async def test_a_percentage_without_a_test_is_rejected(client, gym_ctx):
    plan_id = await _make_plan(client, gym_ctx)
    res = await _set_structure(client, gym_ctx, plan_id, [
        {"name": "Sentadilla", "load_type": "porcentaje_test", "load_value": 75}
    ])
    assert res.status_code == 422
    assert "no dice de cuál" in res.json()["detail"]


async def test_an_unknown_test_is_rejected(client, gym_ctx):
    plan_id = await _make_plan(client, gym_ctx)
    res = await _set_structure(client, gym_ctx, plan_id, [
        {
            "name": "Sentadilla", "load_type": "porcentaje_test",
            "load_value": 75, "load_test_type": "levantar_el_auto",
        }
    ])
    assert res.status_code == 422


async def test_a_week_outside_the_plan_is_rejected(client, gym_ctx):
    plan_id = await _make_plan(client, gym_ctx, weeks=2)
    res = await client.put(
        f"/gym-plans/{plan_id}/structure",
        json={"days": [{"week": 9, "day": 1, "name": "Fantasma", "exercises": []}]},
        headers=gym_ctx["pf_headers"],
    )
    assert res.status_code == 422


async def test_the_structure_is_replaced_not_accumulated(client, gym_ctx):
    plan_id = await _make_plan(client, gym_ctx)
    await _set_structure(client, gym_ctx, plan_id, [{"name": "Uno"}, {"name": "Dos"}])
    res = await _set_structure(client, gym_ctx, plan_id, [{"name": "Solo este"}])

    exercises = res.json()["days"][0]["exercises"]
    assert [e["name"] for e in exercises] == ["Solo este"]


async def test_a_rejected_structure_leaves_the_previous_one_intact(client, gym_ctx):
    """Validar todo antes de escribir: el plan anterior no se pierde."""
    plan_id = await _make_plan(client, gym_ctx)
    await _set_structure(client, gym_ctx, plan_id, [{"name": "El bueno"}])

    res = await _set_structure(client, gym_ctx, plan_id, [
        {"name": "Roto", "load_type": "porcentaje_test", "load_value": 75}
    ])
    assert res.status_code == 422

    res = await client.get(f"/gym-plans/{plan_id}", headers=gym_ctx["pf_headers"])
    assert [e["name"] for e in res.json()["days"][0]["exercises"]] == ["El bueno"]


# ── Un plan activo por división ───────────────────────────────────────────────

async def test_activating_a_plan_deactivates_the_previous_one(client, gym_ctx):
    """El jugador tiene que ver un plan, no elegir entre tres."""
    first = await _make_plan(client, gym_ctx)
    second = await _make_plan(client, gym_ctx)

    res = await client.get(
        f"/divisions/{gym_ctx['division'].id}/gym-plans", headers=gym_ctx["pf_headers"]
    )
    active = [p["id"] for p in res.json() if p["is_active"]]
    assert active == [second]
    assert first not in active


async def test_a_division_without_an_active_plan_returns_none(client, gym_ctx):
    headers = await _invite(client, gym_ctx)
    res = await client.get("/me/gym-plan", headers=headers)
    assert res.status_code == 200
    assert res.json()["plan"] is None


# ── Registro y adherencia ─────────────────────────────────────────────────────

async def test_a_player_logs_a_session_and_it_shows_as_completed(client, gym_ctx):
    plan_id = await _make_plan(client, gym_ctx)
    res = await _set_structure(client, gym_ctx, plan_id, [{"name": "Sentadilla"}])
    day_id = res.json()["days"][0]["id"]

    headers = await _invite(client, gym_ctx)
    res = await client.post("/me/gym-logs", json={"day_id": day_id, "rpe": 8}, headers=headers)
    assert res.status_code == 201, res.text

    res = await client.get("/me/gym-plan", headers=headers)
    assert res.json()["completed_day_ids"] == [day_id]


async def test_logging_the_same_session_twice_does_not_duplicate(client, gym_ctx):
    plan_id = await _make_plan(client, gym_ctx)
    res = await _set_structure(client, gym_ctx, plan_id, [{"name": "Sentadilla"}])
    day_id = res.json()["days"][0]["id"]

    headers = await _invite(client, gym_ctx)
    for rpe in (7, 9):
        await client.post("/me/gym-logs", json={"day_id": day_id, "rpe": rpe}, headers=headers)

    res = await client.get(
        f"/divisions/{gym_ctx['division'].id}/gym-adherence", headers=gym_ctx["pf_headers"]
    )
    ana = next(r for r in res.json() if r["player_name"] == "Ana Perez")
    assert ana["sessions"] == 1


async def test_adherence_lists_players_with_no_sessions_too(client, gym_ctx):
    """Los que no van son justamente a quienes hay que mirar."""
    res = await client.get(
        f"/divisions/{gym_ctx['division'].id}/gym-adherence", headers=gym_ctx["pf_headers"]
    )
    assert res.status_code == 200, res.text
    assert [r["player_name"] for r in res.json()] == ["Ana Perez"]
    assert res.json()[0]["sessions"] == 0


async def test_a_player_cannot_log_a_day_from_another_division(client, db, gym_ctx):
    other = await make_division(db, gym_ctx["club"].id, name="Otra")
    res = await client.post(
        f"/divisions/{other.id}/gym-plans",
        json={"name": "Ajeno", "weeks": 1},
        headers=gym_ctx["pf_headers"],
    )
    other_plan = res.json()["id"]
    res = await client.put(
        f"/gym-plans/{other_plan}/structure",
        json={"days": [{"week": 1, "day": 1, "name": "Ajeno", "exercises": []}]},
        headers=gym_ctx["pf_headers"],
    )
    foreign_day = res.json()["days"][0]["id"]

    headers = await _invite(client, gym_ctx)
    res = await client.post("/me/gym-logs", json={"day_id": foreign_day}, headers=headers)
    assert res.status_code == 404


# ── Permisos ──────────────────────────────────────────────────────────────────

async def test_a_player_cannot_edit_plans(client, gym_ctx):
    plan_id = await _make_plan(client, gym_ctx)
    headers = await _invite(client, gym_ctx)

    res = await client.put(
        f"/gym-plans/{plan_id}/structure",
        json={"days": []},
        headers=headers,
    )
    assert res.status_code == 403


async def test_a_player_cannot_read_the_division_adherence(client, gym_ctx):
    headers = await _invite(client, gym_ctx)
    res = await client.get(
        f"/divisions/{gym_ctx['division'].id}/gym-adherence", headers=headers
    )
    assert res.status_code == 403
