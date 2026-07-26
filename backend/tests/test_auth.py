"""Login, rotación de access token y revocación del refresh token."""
from app.models import UserRole

from tests.conftest import PASSWORD, auth_header, login, make_club, make_user


async def test_login_returns_both_tokens_and_the_user(client, db):
    club = await make_club(db)
    await make_user(db, email="admin@example.com", role=UserRole.club_admin, club_id=club.id)

    res = await client.post("/auth/login", json={"email": "admin@example.com", "password": PASSWORD})

    assert res.status_code == 200
    body = res.json()
    assert body["access_token"] and body["refresh_token"]
    assert body["user"]["email"] == "admin@example.com"
    assert body["user"]["role"] == "club_admin"
    assert "password_hash" not in body["user"]


async def test_login_rejects_wrong_password(client, db):
    await make_user(db, email="admin@example.com", role=UserRole.club_admin)
    res = await client.post("/auth/login", json={"email": "admin@example.com", "password": "nope"})
    assert res.status_code == 401


async def test_login_rejects_unknown_email(client):
    res = await client.post("/auth/login", json={"email": "ghost@example.com", "password": PASSWORD})
    assert res.status_code == 401


async def test_login_rejects_deactivated_user(client, db):
    user = await make_user(db, email="baja@example.com", role=UserRole.analyst)
    user.is_active = False
    await db.commit()

    res = await client.post("/auth/login", json={"email": "baja@example.com", "password": PASSWORD})
    assert res.status_code == 401


async def test_me_requires_a_token(client):
    assert (await client.get("/auth/me")).status_code == 403


async def test_me_rejects_a_garbage_token(client):
    res = await client.get("/auth/me", headers=auth_header("no-es-un-jwt"))
    assert res.status_code == 401


async def test_me_returns_the_current_user(client, db):
    await make_user(db, email="analyst@example.com", role=UserRole.analyst)
    tokens = await login(client, "analyst@example.com")

    res = await client.get("/auth/me", headers=auth_header(tokens["access_token"]))

    assert res.status_code == 200
    assert res.json()["email"] == "analyst@example.com"


async def test_refresh_issues_a_usable_access_token(client, db):
    """Es lo que evita que el analista se quede afuera a los 60 minutos de partido."""
    await make_user(db, email="analyst@example.com", role=UserRole.analyst)
    tokens = await login(client, "analyst@example.com")

    res = await client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})

    assert res.status_code == 200
    new_token = res.json()["access_token"]
    assert (await client.get("/auth/me", headers=auth_header(new_token))).status_code == 200


async def test_refresh_rejects_an_access_token_used_as_refresh(client, db):
    await make_user(db, email="analyst@example.com", role=UserRole.analyst)
    tokens = await login(client, "analyst@example.com")

    res = await client.post("/auth/refresh", json={"refresh_token": tokens["access_token"]})

    assert res.status_code == 401


async def test_refresh_rejects_an_unknown_token(client):
    res = await client.post("/auth/refresh", json={"refresh_token": "inventado"})
    assert res.status_code == 401


async def test_logout_revokes_the_refresh_token(client, db):
    await make_user(db, email="analyst@example.com", role=UserRole.analyst)
    tokens = await login(client, "analyst@example.com")

    assert (await client.post("/auth/logout", json={"refresh_token": tokens["refresh_token"]})).status_code == 204

    res = await client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert res.status_code == 401
