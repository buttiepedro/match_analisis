"""
Una instancia por club: la app sabe quién es al arrancar, no por request.
Ver [[add-club-subdominios-y-marca]].
"""
from app.core.club_context import load_club_context
from app.core.config import settings
from app.main import app
from app.models import UserRole

from tests.conftest import auth_header, login, make_club, make_user


# ── Fase A: slug ─────────────────────────────────────────────────────────────

async def test_reserved_slug_is_rejected(client, db):
    admin = await make_user(db, email="root2@example.com", role=UserRole.superadmin)
    tokens = await login(client, admin.email)
    res = await client.post(
        "/clubs",
        json={
            "name": "API",  # slugifica a "api", reservado
            "admin_email": "adminapi@example.com",
            "admin_password": "secret123",
            "admin_full_name": "Admin",
        },
        headers=auth_header(tokens["access_token"]),
    )
    assert res.status_code == 422
    assert "reservado" in res.json()["detail"]


async def test_valid_slug_is_accepted(client, db):
    admin = await make_user(db, email="root3@example.com", role=UserRole.superadmin)
    tokens = await login(client, admin.email)
    res = await client.post(
        "/clubs",
        json={
            "name": "Club Equis",
            "admin_email": "adminequis@example.com",
            "admin_password": "secret123",
            "admin_full_name": "Admin",
        },
        headers=auth_header(tokens["access_token"]),
    )
    assert res.status_code == 201, res.text
    assert res.json()["slug"] == "club-equis"


# ── Fase A: marca ────────────────────────────────────────────────────────────

async def test_update_branding_requires_superadmin(client, club_admin_ctx):
    club = club_admin_ctx["club"]
    res = await client.patch(
        f"/clubs/{club.id}/branding",
        json={"primary_color": "#123456"},
        headers=club_admin_ctx["headers"],
    )
    assert res.status_code == 403


async def test_update_branding_validates_hex_color(client, db):
    club = await make_club(db)
    admin = await make_user(db, email="root4@example.com", role=UserRole.superadmin)
    tokens = await login(client, admin.email)
    res = await client.patch(
        f"/clubs/{club.id}/branding",
        json={"primary_color": "not-a-color"},
        headers=auth_header(tokens["access_token"]),
    )
    assert res.status_code == 422


async def test_update_branding_sets_logo_and_colors(client, db):
    club = await make_club(db)
    admin = await make_user(db, email="root5@example.com", role=UserRole.superadmin)
    tokens = await login(client, admin.email)
    res = await client.patch(
        f"/clubs/{club.id}/branding",
        json={
            "logo_url": "https://cdn.example.com/logo.png",
            "primary_color": "#211e67",
            "secondary_color": "#ff1b20",
        },
        headers=auth_header(tokens["access_token"]),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["logo_url"] == "https://cdn.example.com/logo.png"
    assert body["primary_color"] == "#211e67"
    assert body["secondary_color"] == "#ff1b20"


# ── Fase B: la app sabe quién es ─────────────────────────────────────────────

async def test_load_club_context_sets_app_state_for_valid_active_club(db):
    club = await make_club(db, name="Instancia Test", slug="instancia-test")
    settings.CLUB_SLUG = "instancia-test"
    try:
        await load_club_context(app)
        assert app.state.club is not None
        assert app.state.club.id == club.id
    finally:
        settings.CLUB_SLUG = None
        app.state.club = None


async def test_load_club_context_raises_for_unknown_slug():
    settings.CLUB_SLUG = "no-existe"
    try:
        try:
            await load_club_context(app)
            assert False, "debería haber tirado RuntimeError"
        except RuntimeError as exc:
            assert "no-existe" in str(exc)
    finally:
        settings.CLUB_SLUG = None


async def test_load_club_context_raises_for_inactive_club(db):
    club = await make_club(db, name="Club Inactivo", slug="club-inactivo")
    club.is_active = False
    await db.commit()

    settings.CLUB_SLUG = "club-inactivo"
    try:
        try:
            await load_club_context(app)
            assert False, "debería haber tirado RuntimeError"
        except RuntimeError:
            pass
    finally:
        settings.CLUB_SLUG = None


async def test_load_club_context_leaves_state_none_without_club_slug():
    """Instancia de plataforma: sin CLUB_SLUG, no falla y queda sin club."""
    assert settings.CLUB_SLUG is None
    await load_club_context(app)
    assert app.state.club is None


# ── Fase B: branding público ─────────────────────────────────────────────────

async def test_public_branding_404_without_club_slug(client):
    res = await client.get("/public/club-branding")
    assert res.status_code == 404


async def test_public_branding_returns_club_when_scoped(client, db):
    club = await make_club(db, name="Con Marca", slug="con-marca")
    club.logo_url = "https://cdn.example.com/x.png"
    club.primary_color = "#001122"
    await db.commit()

    app.state.club = club
    try:
        res = await client.get("/public/club-branding")
        assert res.status_code == 200
        body = res.json()
        assert body["slug"] == "con-marca"
        assert body["logo_url"] == "https://cdn.example.com/x.png"
        assert body["primary_color"] == "#001122"
    finally:
        app.state.club = None


# ── Fase B: login scopeado ───────────────────────────────────────────────────

async def test_login_scoped_to_instance_ignores_other_clubs_users(client, db):
    club_a = await make_club(db, name="Club A2", slug="club-a2")
    club_b = await make_club(db, name="Club B2", slug="club-b2")
    await make_user(db, email="mismo@example.com", role=UserRole.club_admin, club_id=club_a.id)

    app.state.club = club_b
    try:
        res = await client.post(
            "/auth/login", json={"email": "mismo@example.com", "password": "secret123"}
        )
        # La instancia de club B nunca mira usuarios de A: no matchea nada.
        assert res.status_code == 401
    finally:
        app.state.club = None

    # La misma credencial, sin escopar (instancia de plataforma), funciona.
    res = await client.post(
        "/auth/login", json={"email": "mismo@example.com", "password": "secret123"}
    )
    assert res.status_code == 200


async def test_login_scoped_to_instance_finds_its_own_users(client, db):
    club = await make_club(db, name="Club Propio", slug="club-propio")
    await make_user(db, email="propio@example.com", role=UserRole.club_admin, club_id=club.id)

    app.state.club = club
    try:
        res = await client.post(
            "/auth/login", json={"email": "propio@example.com", "password": "secret123"}
        )
        assert res.status_code == 200
    finally:
        app.state.club = None


async def test_superadmin_cannot_login_on_a_scoped_instance(client, db):
    club = await make_club(db)
    await make_user(db, email="root6@example.com", role=UserRole.superadmin)

    app.state.club = club
    try:
        res = await client.post(
            "/auth/login", json={"email": "root6@example.com", "password": "secret123"}
        )
        assert res.status_code == 401
    finally:
        app.state.club = None
