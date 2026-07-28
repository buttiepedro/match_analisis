"""
Permisos por capacidades.

El test que importa es `test_each_legacy_role_keeps_its_access_matrix`: verifica que
después del cambio cada rol pueda **exactamente** lo que podía antes. Todo lo demás
del módulo puede fallar y se arregla; si falla ese, alguien se quedó sin acceso o
ganó uno que no tenía.
"""
import pytest
from sqlalchemy import select

from app.core.permissions import (
    ADMINISTRADOR,
    ANALISTA,
    ENTRENADOR,
    JUGADOR,
    PRESET_PERMISSIONS,
    Permission,
)
from app.models import Role, UserRole, user_roles

from tests.conftest import auth_header, login, make_club, make_division, make_user


@pytest.fixture
async def perm_ctx(client, db, club_admin_ctx):
    """Un usuario por cada rol viejo, todos en el mismo club."""
    club = club_admin_ctx["club"]
    division = await make_division(db, club.id)

    users = {}
    for role in (UserRole.match_director, UserRole.analyst, UserRole.player):
        user = await make_user(
            db, email=f"{role.value}@example.com", role=role, club_id=club.id
        )
        tokens = await login(client, user.email)
        users[role.value] = {
            "user": user,
            "headers": auth_header(tokens["access_token"]),
        }

    users["club_admin"] = {
        "user": club_admin_ctx["user"],
        "headers": club_admin_ctx["headers"],
    }
    return {"club": club, "division": division, "users": users}


# ── La garantía central ───────────────────────────────────────────────────────

#: Matriz medida sobre el código **antes** del cambio. `True` = tenía acceso.
ACCESS_MATRIX = {
    # (método, plantilla de ruta): {rol: permitido}
    ("GET", "/clubs/{club}/divisions"): {
        "club_admin": True, "match_director": True, "analyst": True, "player": True,
    },
    ("POST", "/clubs/{club}/divisions"): {
        "club_admin": True, "match_director": False, "analyst": False, "player": False,
    },
    ("POST", "/clubs/{club}/tournaments"): {
        "club_admin": True, "match_director": False, "analyst": False, "player": False,
    },
    ("POST", "/divisions/{division}/players"): {
        "club_admin": True, "match_director": False, "analyst": False, "player": False,
    },
    ("POST", "/divisions/{division}/trainings"): {
        "club_admin": True, "match_director": True, "analyst": False, "player": False,
    },
    ("GET", "/clubs/{club}/users"): {
        "club_admin": True, "match_director": False, "analyst": False, "player": False,
    },
}


async def test_each_legacy_role_keeps_its_access_matrix(client, perm_ctx):
    """
    Cada rol conserva exactamente sus accesos.

    Si este test falla, alguien se quedó sin entrar a algo que usaba, o ganó acceso
    a algo que no le correspondía.
    """
    club = perm_ctx["club"].id
    division = perm_ctx["division"].id

    bodies = {
        "POST /clubs/{club}/divisions": {"name": "Nueva"},
        "POST /clubs/{club}/tournaments": {"name": "Torneo", "division_id": str(division)},
        "POST /divisions/{division}/players": {"name": "Jugador"},
        "POST /divisions/{division}/trainings": {"date": "2026-07-27"},
    }

    failures = []
    for (method, template), expected in ACCESS_MATRIX.items():
        path = template.format(club=club, division=division)
        body = bodies.get(f"{method} {template}")

        for role, allowed in expected.items():
            headers = perm_ctx["users"][role]["headers"]
            res = await client.request(method, path, json=body, headers=headers)
            got = res.status_code != 403

            if got != allowed:
                failures.append(
                    f"{method} {template} con rol {role}: "
                    f"esperado {'permitido' if allowed else '403'}, "
                    f"obtenido {res.status_code}"
                )

    assert not failures, "\n".join(failures)


# ── Composición de roles ──────────────────────────────────────────────────────

async def test_two_roles_add_up(client, db, perm_ctx):
    """Lo que el enum de un solo rol no podía expresar: el entrenador que además administra."""
    analyst = perm_ctx["users"]["analyst"]["user"]
    headers = perm_ctx["users"]["analyst"]["headers"]

    res = await client.post(
        f"/clubs/{perm_ctx['club'].id}/divisions",
        json={"name": "Prohibida"},
        headers=headers,
    )
    assert res.status_code == 403

    admin_role = await db.scalar(
        select(Role).where(Role.club_id == perm_ctx["club"].id, Role.name == ADMINISTRADOR)
    )
    await db.execute(
        user_roles.insert().values(user_id=analyst.id, role_id=admin_role.id)
    )
    await db.commit()

    res = await client.post(
        f"/clubs/{perm_ctx['club'].id}/divisions",
        json={"name": "Ahora sí"},
        headers=headers,
    )
    assert res.status_code == 201, res.text


async def test_removing_a_role_removes_its_permissions(client, db, perm_ctx):
    admin = perm_ctx["users"]["club_admin"]["user"]
    headers = perm_ctx["users"]["club_admin"]["headers"]

    await db.execute(user_roles.delete().where(user_roles.c.user_id == admin.id))
    await db.commit()

    res = await client.post(
        f"/clubs/{perm_ctx['club'].id}/divisions",
        json={"name": "Sin rol"},
        headers=headers,
    )
    assert res.status_code == 403


# ── Presets ───────────────────────────────────────────────────────────────────

async def test_a_new_club_gets_its_preset_roles(client, db):
    club = await make_club(db, name="Nuevo", slug="nuevo-presets")
    roles = (
        await db.execute(Role.__table__.select().where(Role.club_id == club.id))
    ).fetchall()
    assert {r.name for r in roles} == set(PRESET_PERMISSIONS)
    assert all(r.is_preset for r in roles)


async def test_presets_belong_to_their_club(client, db, perm_ctx):
    """Los roles son del club: dos clubes tienen juegos distintos, no compartidos."""
    other = await make_club(db, name="Otro", slug="otro-roles")

    own = (
        await db.execute(Role.__table__.select().where(Role.club_id == perm_ctx["club"].id))
    ).fetchall()
    theirs = (
        await db.execute(Role.__table__.select().where(Role.club_id == other.id))
    ).fetchall()

    assert {r.id for r in own}.isdisjoint({r.id for r in theirs})


async def test_the_player_preset_has_no_club_permissions(client, db, perm_ctx):
    """
    No es un olvido: el acceso del jugador es a lo propio, y eso lo resuelve
    `require_player_self`, que no es una capacidad sobre el club.
    """
    assert PRESET_PERMISSIONS[JUGADOR] == frozenset()


async def test_the_admin_preset_covers_every_permission(client):
    """Si mañana se agrega una capacidad y nadie la concede, el club queda trabado."""
    assert PRESET_PERMISSIONS[ADMINISTRADOR] == frozenset(p.value for p in Permission)


async def test_coach_cannot_touch_club_configuration(client, perm_ctx):
    """La diferencia que justifica separar Entrenador de Administrador."""
    headers = perm_ctx["users"]["match_director"]["headers"]

    res = await client.post(
        f"/divisions/{perm_ctx['division'].id}/trainings",
        json={"date": "2026-07-27"},
        headers=headers,
    )
    assert res.status_code == 201, res.text

    res = await client.get(f"/clubs/{perm_ctx['club'].id}/users", headers=headers)
    assert res.status_code == 403


async def test_analyst_can_load_attendance_but_not_manage_trainings(client, perm_ctx):
    headers = perm_ctx["users"]["analyst"]["headers"]
    assert Permission.asistencia_cargar.value in PRESET_PERMISSIONS[ANALISTA]
    assert Permission.entrenamiento_gestionar.value not in PRESET_PERMISSIONS[ANALISTA]
    assert Permission.entrenamiento_gestionar.value in PRESET_PERMISSIONS[ENTRENADOR]

    res = await client.post(
        f"/divisions/{perm_ctx['division'].id}/trainings",
        json={"date": "2026-07-27"},
        headers=headers,
    )
    assert res.status_code == 403


async def test_superadmin_bypasses_the_role_system(client, db):
    """No es un rol de club: crear clubes no pertenece a ningún club."""
    root = await make_user(db, email="root2@example.com", role=UserRole.superadmin)
    tokens = await login(client, root.email)

    res = await client.get("/clubs", headers=auth_header(tokens["access_token"]))
    assert res.status_code == 200


# ── ABM de roles ──────────────────────────────────────────────────────────────

async def test_a_preset_cannot_be_deleted(client, db, perm_ctx, club_admin_ctx):
    """La red que evita que un club se quede sin ningún rol que lo administre."""
    role = await db.scalar(
        select(Role).where(Role.club_id == perm_ctx["club"].id, Role.name == ADMINISTRADOR)
    )
    res = await client.delete(
        f"/clubs/{perm_ctx['club'].id}/roles/{role.id}", headers=club_admin_ctx["headers"]
    )
    assert res.status_code == 409


async def test_a_preset_can_be_edited(client, db, perm_ctx, club_admin_ctx):
    role = await db.scalar(
        select(Role).where(Role.club_id == perm_ctx["club"].id, Role.name == ENTRENADOR)
    )
    res = await client.patch(
        f"/clubs/{perm_ctx['club'].id}/roles/{role.id}",
        json={"permissions": [Permission.plantel_ver.value, Permission.medico_editar.value]},
        headers=club_admin_ctx["headers"],
    )
    assert res.status_code == 200, res.text
    assert set(res.json()["permissions"]) == {
        Permission.plantel_ver.value,
        Permission.medico_editar.value,
    }


async def test_a_custom_role_in_use_cannot_be_deleted(client, perm_ctx, club_admin_ctx):
    """Borrarlo dejaría a esa gente sin acceso sin que nadie se entere."""
    club = perm_ctx["club"].id
    res = await client.post(
        f"/clubs/{club}/roles",
        json={"name": "Kinesiólogo", "permissions": [Permission.medico_editar.value]},
        headers=club_admin_ctx["headers"],
    )
    assert res.status_code == 201, res.text
    role_id = res.json()["id"]

    analyst = perm_ctx["users"]["analyst"]["user"]
    await client.put(
        f"/clubs/{club}/users/{analyst.id}/roles",
        json={"role_ids": [role_id]},
        headers=club_admin_ctx["headers"],
    )

    res = await client.delete(f"/clubs/{club}/roles/{role_id}", headers=club_admin_ctx["headers"])
    assert res.status_code == 409
    assert "asignado" in res.json()["detail"]


async def test_unknown_permissions_are_rejected(client, perm_ctx, club_admin_ctx):
    res = await client.post(
        f"/clubs/{perm_ctx['club'].id}/roles",
        json={"name": "Inventado", "permissions": ["magia.total"]},
        headers=club_admin_ctx["headers"],
    )
    assert res.status_code == 422


async def test_a_role_from_another_club_cannot_be_assigned(client, db, perm_ctx, club_admin_ctx):
    other = await make_club(db, name="Ajeno", slug="ajeno-roles")
    foreign = await db.scalar(
        select(Role).where(Role.club_id == other.id, Role.name == ADMINISTRADOR)
    )
    analyst = perm_ctx["users"]["analyst"]["user"]

    res = await client.put(
        f"/clubs/{perm_ctx['club'].id}/users/{analyst.id}/roles",
        json={"role_ids": [str(foreign.id)]},
        headers=club_admin_ctx["headers"],
    )
    assert res.status_code == 422
