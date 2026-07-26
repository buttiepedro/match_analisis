"""
Alcance por división.

Dos garantías, y la segunda importa tanto como la primera:

1. Un usuario con alcance asignado no toca las divisiones que no le tocan.
2. Un usuario **sin** alcance sigue viendo todo — es lo que hace que la migración
   no le saque acceso a nadie y que un club chico no tenga que configurar nada.
"""
from datetime import date

import pytest

from app.models import UserRole, user_divisions

from tests.conftest import auth_header, login, make_division, make_user


@pytest.fixture
async def scope_ctx(client, db, club_admin_ctx):
    club = club_admin_ctx["club"]
    m17 = await make_division(db, club.id, name="M17")
    primera = await make_division(db, club.id, name="Primera")

    coach = await make_user(
        db, email="coach.m17@example.com", role=UserRole.match_director, club_id=club.id
    )
    tokens = await login(client, coach.email)

    return {
        "club": club,
        "m17": m17,
        "primera": primera,
        "coach": coach,
        "coach_headers": auth_header(tokens["access_token"]),
        "admin_headers": club_admin_ctx["headers"],
    }


async def _scope_to(client, ctx, division_ids):
    res = await client.put(
        f"/clubs/{ctx['club'].id}/users/{ctx['coach'].id}/divisions",
        json={"division_ids": [str(d) for d in division_ids]},
        headers=ctx["admin_headers"],
    )
    assert res.status_code == 200, res.text
    return res.json()


# ── Sin alcance: nada cambia ──────────────────────────────────────────────────

async def test_a_user_without_scope_sees_every_division(client, scope_ctx):
    """La garantía de la migración: nadie pierde acceso al actualizar."""
    for division in (scope_ctx["m17"], scope_ctx["primera"]):
        res = await client.get(
            f"/divisions/{division.id}/players", headers=scope_ctx["coach_headers"]
        )
        assert res.status_code == 200, res.text


async def test_clearing_the_scope_restores_full_access(client, scope_ctx):
    """Lista vacía es "sin restricción", no "sin acceso"."""
    await _scope_to(client, scope_ctx, [scope_ctx["m17"].id])
    res = await client.get(
        f"/divisions/{scope_ctx['primera'].id}/players", headers=scope_ctx["coach_headers"]
    )
    assert res.status_code == 403

    await _scope_to(client, scope_ctx, [])
    res = await client.get(
        f"/divisions/{scope_ctx['primera'].id}/players", headers=scope_ctx["coach_headers"]
    )
    assert res.status_code == 200


# ── Con alcance: se respeta ───────────────────────────────────────────────────

async def test_a_scoped_coach_cannot_read_another_division(client, scope_ctx):
    await _scope_to(client, scope_ctx, [scope_ctx["m17"].id])

    res = await client.get(
        f"/divisions/{scope_ctx['m17'].id}/players", headers=scope_ctx["coach_headers"]
    )
    assert res.status_code == 200

    res = await client.get(
        f"/divisions/{scope_ctx['primera'].id}/players", headers=scope_ctx["coach_headers"]
    )
    assert res.status_code == 403


async def test_a_scoped_coach_cannot_create_trainings_elsewhere(client, scope_ctx):
    """El caso que motivó el cambio: entrenamientos de una división ajena."""
    await _scope_to(client, scope_ctx, [scope_ctx["m17"].id])

    res = await client.post(
        f"/divisions/{scope_ctx['m17'].id}/trainings",
        json={"date": date.today().isoformat()},
        headers=scope_ctx["coach_headers"],
    )
    assert res.status_code == 201, res.text

    res = await client.post(
        f"/divisions/{scope_ctx['primera'].id}/trainings",
        json={"date": date.today().isoformat()},
        headers=scope_ctx["coach_headers"],
    )
    assert res.status_code == 403


async def test_a_scoped_coach_cannot_touch_attendance_of_another_division(
    client, scope_ctx
):
    """Pisar la asistencia ajena era el peor caso: borra trabajo de otro."""
    res = await client.post(
        f"/divisions/{scope_ctx['primera'].id}/trainings",
        json={"date": date.today().isoformat()},
        headers=scope_ctx["admin_headers"],
    )
    training_id = res.json()["id"]

    await _scope_to(client, scope_ctx, [scope_ctx["m17"].id])

    res = await client.get(
        f"/trainings/{training_id}/attendance", headers=scope_ctx["coach_headers"]
    )
    assert res.status_code == 403

    res = await client.put(
        f"/trainings/{training_id}/attendance",
        json={"entries": []},
        headers=scope_ctx["coach_headers"],
    )
    assert res.status_code == 403


async def test_a_scoped_coach_cannot_read_another_divisions_attendance_summary(
    client, scope_ctx
):
    await _scope_to(client, scope_ctx, [scope_ctx["m17"].id])
    res = await client.get(
        f"/divisions/{scope_ctx['primera'].id}/attendance/summary",
        headers=scope_ctx["coach_headers"],
    )
    assert res.status_code == 403


async def test_a_scoped_coach_cannot_read_another_divisions_minutes(client, scope_ctx):
    await _scope_to(client, scope_ctx, [scope_ctx["m17"].id])
    res = await client.get(
        f"/divisions/{scope_ctx['primera'].id}/minutes", headers=scope_ctx["coach_headers"]
    )
    assert res.status_code == 403


async def test_a_scoped_coach_cannot_read_another_divisions_availability(client, scope_ctx):
    await _scope_to(client, scope_ctx, [scope_ctx["m17"].id])
    res = await client.get(
        f"/divisions/{scope_ctx['primera'].id}/availability",
        headers=scope_ctx["coach_headers"],
    )
    assert res.status_code == 403


async def test_scope_covering_both_divisions_grants_both(client, scope_ctx):
    await _scope_to(client, scope_ctx, [scope_ctx["m17"].id, scope_ctx["primera"].id])
    for division in (scope_ctx["m17"], scope_ctx["primera"]):
        res = await client.get(
            f"/divisions/{division.id}/players", headers=scope_ctx["coach_headers"]
        )
        assert res.status_code == 200


# ── club_admin ignora el alcance ──────────────────────────────────────────────

async def test_a_club_admin_is_never_scoped(client, db, scope_ctx, club_admin_ctx):
    """Aunque tenga filas asignadas: administra el club entero, por definición."""
    await db.execute(
        user_divisions.insert().values(
            user_id=club_admin_ctx["user"].id, division_id=scope_ctx["m17"].id
        )
    )
    await db.commit()

    res = await client.get(
        f"/divisions/{scope_ctx['primera'].id}/players", headers=club_admin_ctx["headers"]
    )
    assert res.status_code == 200


# ── Administración del alcance ────────────────────────────────────────────────

async def test_scope_round_trips(client, scope_ctx):
    await _scope_to(client, scope_ctx, [scope_ctx["m17"].id])
    res = await client.get(
        f"/clubs/{scope_ctx['club'].id}/users/{scope_ctx['coach'].id}/divisions",
        headers=scope_ctx["admin_headers"],
    )
    assert res.json() == [str(scope_ctx["m17"].id)]


async def test_scope_rejects_a_division_from_another_club(client, db, scope_ctx):
    from tests.conftest import make_club

    other_club = await make_club(db, name="Otro", slug="otro-scope")
    foreign = await make_division(db, other_club.id, name="Ajena")

    res = await client.put(
        f"/clubs/{scope_ctx['club'].id}/users/{scope_ctx['coach'].id}/divisions",
        json={"division_ids": [str(foreign.id)]},
        headers=scope_ctx["admin_headers"],
    )
    assert res.status_code == 422
