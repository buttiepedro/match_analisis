"""
Socios: padrón, sincronización e ingreso por DNI.

Lo que más importa acá es que la **re-importación semanal** no rompa nada: que sea
idempotente, que no le saque la contraseña a nadie y que no dé de baja medio padrón
por un archivo equivocado.
"""
import io

import pytest
from openpyxl import Workbook
from sqlalchemy import select

from app.core.permissions import SOCIO, TESORERO
from app.models import Member, Role, User, user_roles

from tests.conftest import auth_header, login, make_club, make_user


def padron_xlsx(rows: list[dict]) -> bytes:
    """Arma un Excel como el que exporta el sistema contable del club."""
    wb = Workbook()
    ws = wb.active
    ws.append(["DNI", "Apellido y Nombre", "Al día", "Categoría", "N° Socio", "Email"])
    for r in rows:
        ws.append([
            r["dni"], r["nombre"], r.get("al_dia", "SI"),
            r.get("categoria", "activo"), r.get("nro"), r.get("email"),
        ])
    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


@pytest.fixture
async def tesorero_ctx(client, db, club_admin_ctx):
    """Un usuario con el preset Tesorero, que es quien sincroniza el padrón."""
    club = club_admin_ctx["club"]
    user = await make_user(db, email="tesorero@example.com", role=__import__(
        "app.models", fromlist=["UserRole"]).UserRole.analyst, club_id=club.id)

    role = await db.scalar(select(Role).where(Role.club_id == club.id, Role.name == TESORERO))
    await db.execute(user_roles.insert().values(user_id=user.id, role_id=role.id))
    await db.commit()

    tokens = await login(client, user.email)
    return {"club": club, "user": user, "headers": auth_header(tokens["access_token"])}


async def _import(client, ctx, rows, **params):
    return await client.post(
        f"/clubs/{ctx['club'].id}/members/import",
        params=params,
        files={"file": ("padron.xlsx", padron_xlsx(rows), "application/vnd.ms-excel")},
        data={"default_password": "clubsecreto2026"},
        headers=ctx["headers"],
    )


# ── Sincronización ────────────────────────────────────────────────────────────

async def test_import_creates_members_and_their_accounts(client, db, tesorero_ctx):
    res = await _import(client, tesorero_ctx, [
        {"dni": "30111222", "nombre": "Ana Perez"},
        {"dni": "30333444", "nombre": "Bruno Diaz", "al_dia": "NO"},
    ])
    assert res.status_code == 200, res.text
    body = res.json()
    assert len(body["created"]) == 2
    assert body["deactivated"] == []

    members = (await db.execute(select(Member))).scalars().all()
    assert {m.full_name for m in members} == {"Ana Perez", "Bruno Diaz"}
    assert {m.dues_up_to_date for m in members} == {True, False}
    # Cada socio recibe cuenta con cambio de contraseña forzado.
    for m in members:
        user = await db.scalar(select(User).where(User.id == m.user_id))
        assert user.must_change_password is True
        assert user.document_id in ("30111222", "30333444")


async def test_importing_the_same_file_twice_is_idempotent(client, db, tesorero_ctx):
    """La sincronización es semanal: correrla dos veces no puede duplicar nada."""
    rows = [{"dni": "30111222", "nombre": "Ana Perez"}]
    first = await _import(client, tesorero_ctx, rows)
    second = await _import(client, tesorero_ctx, rows)

    assert len(first.json()["created"]) == 1
    assert len(second.json()["created"]) == 0
    assert len(second.json()["updated"]) == 1

    members = (await db.execute(select(Member))).scalars().all()
    assert len(members) == 1


async def test_reimport_does_not_reset_passwords(client, db, tesorero_ctx):
    """Re-importar el padrón no puede sacarle el acceso a nadie."""
    rows = [{"dni": "30111222", "nombre": "Ana Perez"}]
    await _import(client, tesorero_ctx, rows)

    member = await db.scalar(select(Member))
    user = await db.scalar(select(User).where(User.id == member.user_id))
    original_hash = user.password_hash

    await _import(client, tesorero_ctx, rows)

    await db.refresh(user)
    assert user.password_hash == original_hash


async def test_a_member_absent_from_the_file_is_deactivated_not_deleted(
    client, db, tesorero_ctx
):
    """Una baja se revierte; un borrado no."""
    await _import(client, tesorero_ctx, [
        {"dni": "30111222", "nombre": "Ana Perez"},
        {"dni": "30333444", "nombre": "Bruno Diaz"},
        {"dni": "30555666", "nombre": "Carla Gomez"},
        {"dni": "30777888", "nombre": "Diego Ruiz"},
        {"dni": "30999000", "nombre": "Elena Sosa"},
    ])

    res = await _import(client, tesorero_ctx, [
        {"dni": "30111222", "nombre": "Ana Perez"},
        {"dni": "30333444", "nombre": "Bruno Diaz"},
        {"dni": "30555666", "nombre": "Carla Gomez"},
        {"dni": "30777888", "nombre": "Diego Ruiz"},
    ])
    assert res.status_code == 200, res.text
    assert res.json()["deactivated"] == ["Elena Sosa"]

    elena = await db.scalar(select(Member).where(Member.full_name == "Elena Sosa"))
    assert elena is not None, "no se borra, se marca inactiva"
    assert elena.is_active is False


async def test_the_sync_timestamp_updates_even_when_nothing_changed(
    client, db, tesorero_ctx
):
    """Responde "¿de cuándo es este dato?", no "¿cuándo cambió?"."""
    rows = [{"dni": "30111222", "nombre": "Ana Perez"}]
    await _import(client, tesorero_ctx, rows)
    member = await db.scalar(select(Member))
    first_sync = member.dues_synced_at

    await _import(client, tesorero_ctx, rows)
    await db.refresh(member)
    assert member.dues_synced_at >= first_sync


# ── Freno de mano ─────────────────────────────────────────────────────────────

async def test_an_import_deactivating_most_of_the_padron_is_rejected(
    client, db, tesorero_ctx
):
    """El error probable de una sincronización semanal es el archivo equivocado."""
    await _import(client, tesorero_ctx, [
        {"dni": f"3011{i:04d}", "nombre": f"Socio {i}"} for i in range(10)
    ])

    res = await _import(client, tesorero_ctx, [{"dni": "30110000", "nombre": "Socio 0"}])
    assert res.status_code == 409
    assert "force" in res.json()["detail"]

    activos = (await db.execute(select(Member).where(Member.is_active.is_(True)))).scalars().all()
    assert len(activos) == 10, "no se escribió nada"


async def test_force_lets_a_legitimate_mass_deactivation_through(client, db, tesorero_ctx):
    await _import(client, tesorero_ctx, [
        {"dni": f"3011{i:04d}", "nombre": f"Socio {i}"} for i in range(10)
    ])
    res = await _import(
        client, tesorero_ctx, [{"dni": "30110000", "nombre": "Socio 0"}], force=True
    )
    assert res.status_code == 200, res.text
    assert len(res.json()["deactivated"]) == 9


async def test_dry_run_reports_without_writing(client, db, tesorero_ctx):
    res = await _import(
        client, tesorero_ctx, [{"dni": "30111222", "nombre": "Ana Perez"}], dry_run=True
    )
    assert res.status_code == 200, res.text
    assert res.json()["created"] == ["Ana Perez"]
    assert res.json()["dry_run"] is True

    assert (await db.execute(select(Member))).scalars().first() is None


# ── Parser ────────────────────────────────────────────────────────────────────

async def test_bad_rows_are_reported_without_discarding_the_import(client, tesorero_ctx):
    res = await _import(client, tesorero_ctx, [
        {"dni": "30111222", "nombre": "Ana Perez"},
        {"dni": "", "nombre": "Sin Documento"},
        {"dni": "30333444", "nombre": ""},
        {"dni": "30555666", "nombre": "Carla Gomez", "al_dia": "quizás"},
    ])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["created"] == ["Ana Perez"]
    assert len(body["errors"]) == 3
    assert all("row" in e for e in body["errors"])


async def test_the_dues_column_accepts_the_shapes_a_contable_writes(client, db, tesorero_ctx):
    await _import(client, tesorero_ctx, [
        {"dni": "30000001", "nombre": "Uno", "al_dia": "SI"},
        {"dni": "30000002", "nombre": "Dos", "al_dia": "no"},
        {"dni": "30000003", "nombre": "Tres", "al_dia": 1},
        {"dni": "30000004", "nombre": "Cuatro", "al_dia": "DEUDOR"},
        {"dni": "30000005", "nombre": "Cinco", "al_dia": "AL DIA"},
    ])
    members = {
        m.full_name: m.dues_up_to_date
        for m in (await db.execute(select(Member))).scalars().all()
    }
    assert members == {"Uno": True, "Dos": False, "Tres": True, "Cuatro": False, "Cinco": True}


# ── Ingreso por DNI ───────────────────────────────────────────────────────────

async def test_a_member_logs_in_with_dni_and_must_change_the_password(
    client, db, tesorero_ctx
):
    await _import(client, tesorero_ctx, [{"dni": "30111222", "nombre": "Ana Perez"}])

    res = await client.post(
        "/auth/login", json={"document_id": "30111222", "password": "clubsecreto2026"}
    )
    assert res.status_code == 200, res.text
    assert res.json()["must_change_password"] is True

    headers = auth_header(res.json()["access_token"])
    res = await client.post(
        "/auth/change-password",
        json={"current_password": "clubsecreto2026", "new_password": "miclave2026"},
        headers=headers,
    )
    assert res.status_code == 204

    res = await client.post(
        "/auth/login", json={"document_id": "30111222", "password": "miclave2026"}
    )
    assert res.json()["must_change_password"] is False


async def test_the_new_password_cannot_be_the_same_as_the_old_one(client, db, tesorero_ctx):
    await _import(client, tesorero_ctx, [{"dni": "30111222", "nombre": "Ana Perez"}])
    res = await client.post(
        "/auth/login", json={"document_id": "30111222", "password": "clubsecreto2026"}
    )
    headers = auth_header(res.json()["access_token"])

    res = await client.post(
        "/auth/change-password",
        json={"current_password": "clubsecreto2026", "new_password": "clubsecreto2026"},
        headers=headers,
    )
    assert res.status_code == 422


async def test_staff_still_logs_in_with_email(client, club_admin_ctx):
    """El staff ya entra así y no hay razón para migrarlo."""
    res = await client.post(
        "/auth/login", json={"email": "admin@example.com", "password": "secret123"}
    )
    assert res.status_code == 200, res.text
    assert res.json()["must_change_password"] is False


async def test_the_same_dni_in_two_clubs_asks_which_one(client, db, tesorero_ctx):
    """La misma persona puede ser socia de dos clubes."""
    await _import(client, tesorero_ctx, [{"dni": "30111222", "nombre": "Ana Perez"}])

    other = await make_club(db, name="Otro Club", slug="otro-socios")
    from app.core.members import MemberRow, sync_members

    await sync_members(
        other.id,
        [MemberRow(document_id="30111222", full_name="Ana Perez", dues_up_to_date=True)],
        db,
        default_password="otraclave2026",
    )
    await db.commit()

    res = await client.post(
        "/auth/login", json={"document_id": "30111222", "password": "clubsecreto2026"}
    )
    assert res.status_code == 409
    assert len(res.json()["detail"]["clubs"]) == 2

    res = await client.post(
        "/auth/login",
        json={
            "document_id": "30111222",
            "password": "clubsecreto2026",
            "club_slug": tesorero_ctx["club"].slug,
        },
    )
    assert res.status_code == 200, res.text


# ── Lo que ve el socio ────────────────────────────────────────────────────────

async def test_a_member_sees_their_status_with_the_sync_date(client, db, tesorero_ctx):
    """La fecha no es opcional: sin ella "estás al día" es un dato sin contexto."""
    await _import(client, tesorero_ctx, [
        {"dni": "30111222", "nombre": "Ana Perez", "al_dia": "NO", "nro": "1234"}
    ])
    res = await client.post(
        "/auth/login", json={"document_id": "30111222", "password": "clubsecreto2026"}
    )
    headers = auth_header(res.json()["access_token"])

    res = await client.get("/me/membership", headers=headers)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["full_name"] == "Ana Perez"
    assert body["dues_up_to_date"] is False
    assert body["member_number"] == "1234"
    assert body["dues_synced_at"], "la fecha del dato es obligatoria"


async def test_a_member_cannot_read_the_whole_padron(client, db, tesorero_ctx):
    await _import(client, tesorero_ctx, [
        {"dni": "30111222", "nombre": "Ana Perez"},
        {"dni": "30333444", "nombre": "Bruno Diaz"},
    ])
    res = await client.post(
        "/auth/login", json={"document_id": "30111222", "password": "clubsecreto2026"}
    )
    headers = auth_header(res.json()["access_token"])

    res = await client.get(f"/clubs/{tesorero_ctx['club'].id}/members", headers=headers)
    assert res.status_code == 403


async def test_the_socio_preset_never_grants_access_to_other_members(client, db, tesorero_ctx):
    """
    El socio ve **su** estado y nada del padrón ajeno.

    El preset puede crecer con beneficios de ser socio —hoy tiene la bolsa de
    trabajo—, pero nunca con capacidades sobre los datos de los demás. Si algún
    día alguien le agrega `socios.ver_todas`, este test lo frena.
    """
    role = await db.scalar(
        select(Role).where(Role.club_id == tesorero_ctx["club"].id, Role.name == SOCIO)
    )
    granted = {p.permission for p in role.permissions}

    assert "socios.ver_propia" in granted
    assert granted.isdisjoint({"socios.ver_todas", "socios.importar"})


async def test_the_treasurer_sees_the_padron_and_can_filter_debtors(client, tesorero_ctx):
    await _import(client, tesorero_ctx, [
        {"dni": "30111222", "nombre": "Ana Perez", "al_dia": "SI"},
        {"dni": "30333444", "nombre": "Bruno Diaz", "al_dia": "NO"},
    ])

    res = await client.get(
        f"/clubs/{tesorero_ctx['club'].id}/members", headers=tesorero_ctx["headers"]
    )
    assert res.status_code == 200, res.text
    assert len(res.json()) == 2

    res = await client.get(
        f"/clubs/{tesorero_ctx['club'].id}/members",
        params={"only_debtors": True},
        headers=tesorero_ctx["headers"],
    )
    assert [m["full_name"] for m in res.json()] == ["Bruno Diaz"]


async def test_every_import_is_logged(client, tesorero_ctx):
    """Sin esto, cuando aparezcan 200 bajas nadie va a saber qué archivo las hizo."""
    await _import(client, tesorero_ctx, [{"dni": "30111222", "nombre": "Ana Perez"}])

    res = await client.get(
        f"/clubs/{tesorero_ctx['club'].id}/member-imports", headers=tesorero_ctx["headers"]
    )
    assert res.status_code == 200, res.text
    log = res.json()
    assert len(log) == 1
    assert log[0]["created_count"] == 1
    assert log[0]["source"] == "xlsx"
