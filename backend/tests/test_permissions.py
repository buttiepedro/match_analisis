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
#:
#: Con **una excepción deliberada**, marcada abajo: el rol `player` perdió la
#: lectura de datos del club. Antes alcanzaba cualquier endpoint con
#: `get_current_user`, o sea que podía enumerar todas las divisiones, todo el
#: plantel y todos los entrenamientos. El portal nunca usó nada de eso —sus tres
#: endpoints son de acceso propio— así que era permiso de más, no una función.
ACCESS_MATRIX = {
    # (método, plantilla de ruta): {rol: permitido}
    ("GET", "/clubs/{club}/divisions"): {
        "club_admin": True, "match_director": True, "analyst": True,
        # Cambio intencional: era True.
        "player": False,
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
    El jugador no tiene **ninguna capacidad sobre el club**.

    Las que puede tener son sobre lo propio: `*.ver_propio` (ver algo propio,
    filtrado por `require_player_self`) o `nutricion.turnos_reservar`
    (reservar/cancelar el turno propio — una acción, no una lectura, así que
    no sigue el sufijo `_propio`, pero tampoco da acceso a nada de nadie más:
    `book_nutrition_slot` resuelve el jugador del token, nunca de un `id`).
    Si algún día un preset Jugador gana una capacidad de club de verdad, este
    test lo frena.
    """
    permitidas_sobre_lo_propio = {Permission.nutricion_turnos_reservar.value}
    del_club = {
        p
        for p in PRESET_PERMISSIONS[JUGADOR]
        if not p.endswith(("_propio", "_propia")) and p not in permitidas_sobre_lo_propio
    }
    assert del_club == set(), f"El jugador ganó capacidades de club: {sorted(del_club)}"


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


# ── El único cambio de comportamiento intencional ─────────────────────────────

async def test_the_player_portal_still_works_without_any_capability(client, db, perm_ctx, club_admin_ctx):
    """
    El jugador perdió la lectura del club, pero **no** perdió su portal.

    Sus tres endpoints son de acceso propio y no piden capacidad. Si este test
    falla, el recorte de la matriz rompió el portal y hay que revertirlo.
    """
    res = await client.post(
        f"/divisions/{perm_ctx['division'].id}/players",
        json={"name": "Portal Test"},
        headers=club_admin_ctx["headers"],
    )
    player_id = res.json()["id"]

    res = await client.post(
        f"/divisions/{perm_ctx['division'].id}/players/{player_id}/invite",
        json={"email": "portal@example.com", "password": "secret123"},
        headers=club_admin_ctx["headers"],
    )
    assert res.status_code == 200, res.text

    tokens = await login(client, "portal@example.com")
    headers = auth_header(tokens["access_token"])

    for path in (
        "/me/player",
        f"/players/{player_id}/attendance",
        f"/players/{player_id}/season-stats",
    ):
        res = await client.get(path, headers=headers)
        assert res.status_code == 200, f"{path} devolvió {res.status_code}: {res.text}"


async def test_inviting_a_player_actually_grants_the_jugador_preset(client, db, perm_ctx, club_admin_ctx):
    """
    Bug real que encontró el cambio 4 (turnos con nutricionista): `POST
    .../invite` creaba el usuario con `role=player` pero nunca llamaba a
    `assign_preset_for_legacy_role`, a diferencia de `POST /clubs/{id}/users`.
    El jugador quedaba con rol `player` y **cero** capacidades — invisible
    hasta que algo del portal necesitó una capacidad de verdad en vez de
    resolver todo por acceso propio (`require_player_self`).
    """
    res = await client.post(
        f"/divisions/{perm_ctx['division'].id}/players",
        json={"name": "Con Preset"},
        headers=club_admin_ctx["headers"],
    )
    player_id = res.json()["id"]
    await client.post(
        f"/divisions/{perm_ctx['division'].id}/players/{player_id}/invite",
        json={"email": "conpreset@example.com", "password": "secret123"},
        headers=club_admin_ctx["headers"],
    )

    tokens = await login(client, "conpreset@example.com")
    assert set(tokens["user"]["permissions"]) == set(PRESET_PERMISSIONS[JUGADOR])


async def test_a_player_cannot_read_another_players_attendance(client, db, perm_ctx, club_admin_ctx):
    """Validar sólo el club dejaba leer la asistencia de todos los compañeros."""
    ids = []
    for name in ("Uno Portal", "Dos Portal"):
        res = await client.post(
            f"/divisions/{perm_ctx['division'].id}/players",
            json={"name": name},
            headers=club_admin_ctx["headers"],
        )
        ids.append(res.json()["id"])

    await client.post(
        f"/divisions/{perm_ctx['division'].id}/players/{ids[0]}/invite",
        json={"email": "uno@example.com", "password": "secret123"},
        headers=club_admin_ctx["headers"],
    )
    tokens = await login(client, "uno@example.com")
    headers = auth_header(tokens["access_token"])

    assert (await client.get(f"/players/{ids[0]}/attendance", headers=headers)).status_code == 200
    assert (await client.get(f"/players/{ids[1]}/attendance", headers=headers)).status_code == 403


async def test_a_player_cannot_enumerate_the_squad(client, db, perm_ctx):
    """El recorte: antes podía listar todo el plantel del club sin usarlo nunca."""
    headers = perm_ctx["users"]["player"]["headers"]
    res = await client.get(f"/divisions/{perm_ctx['division'].id}/players", headers=headers)
    assert res.status_code == 403


async def test_a_player_reads_their_own_tests_and_measurements_only(
    client, db, perm_ctx, club_admin_ctx
):
    """
    Lo que sostiene las solapas Tests y Físico del portal.

    Esos dos endpoints quedaron con `get_current_user` a propósito: el jugador no
    tiene ninguna capacidad, y su control es de acceso propio.
    """
    ids = []
    for name in ("Propio Portal", "Ajeno Portal"):
        res = await client.post(
            f"/divisions/{perm_ctx['division'].id}/players",
            json={"name": name},
            headers=club_admin_ctx["headers"],
        )
        ids.append(res.json()["id"])

    await client.post(
        f"/players/{ids[0]}/tests",
        json={"test_date": "2026-07-01", "test_type": "bronco", "value": 320.5},
        headers=club_admin_ctx["headers"],
    )
    await client.post(
        f"/players/{ids[0]}/measurements",
        json={"measured_at": "2026-07-01", "weight_kg": 92.5, "height_cm": 185},
        headers=club_admin_ctx["headers"],
    )

    await client.post(
        f"/divisions/{perm_ctx['division'].id}/players/{ids[0]}/invite",
        json={"email": "propio@example.com", "password": "secret123"},
        headers=club_admin_ctx["headers"],
    )
    tokens = await login(client, "propio@example.com")
    headers = auth_header(tokens["access_token"])

    res = await client.get(f"/players/{ids[0]}/tests", headers=headers)
    assert res.status_code == 200, res.text
    assert len(res.json()) == 1

    res = await client.get(f"/players/{ids[0]}/measurements", headers=headers)
    assert res.status_code == 200, res.text
    assert len(res.json()) == 1

    for path in (f"/players/{ids[1]}/tests", f"/players/{ids[1]}/measurements"):
        res = await client.get(path, headers=headers)
        assert res.status_code == 403, f"{path} devolvió {res.status_code}"


async def test_a_player_cannot_load_their_own_tests(client, db, perm_ctx, club_admin_ctx):
    """Ver lo propio no es cargarlo: el jugador no se edita sus propias mediciones."""
    res = await client.post(
        f"/divisions/{perm_ctx['division'].id}/players",
        json={"name": "Solo Lectura"},
        headers=club_admin_ctx["headers"],
    )
    player_id = res.json()["id"]

    await client.post(
        f"/divisions/{perm_ctx['division'].id}/players/{player_id}/invite",
        json={"email": "lectura@example.com", "password": "secret123"},
        headers=club_admin_ctx["headers"],
    )
    tokens = await login(client, "lectura@example.com")
    headers = auth_header(tokens["access_token"])

    res = await client.post(
        f"/players/{player_id}/tests",
        json={"test_date": "2026-07-01", "test_type": "bronco", "value": 300},
        headers=headers,
    )
    assert res.status_code == 403
