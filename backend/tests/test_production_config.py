"""
Lo que tiene que pasar cuando esto se despliega de verdad.

El modo de falla que estos tests previenen no es un bug: es un despliegue
apurado que copia `.env.example`, cambia lo que rompe al arrancar, y deja lo que
no rompe. Con la clave de ejemplo la app **funciona perfecto** — firma tokens con
un secreto que está publicado en el repo.
"""
import pytest
from pydantic import ValidationError

from app.core.config import MIN_SECRET_LENGTH, Settings

BASE = {
    "DATABASE_URL": "postgresql+asyncpg://u:p@db:5432/d",
    "SUPERADMIN_EMAIL": "admin@club.com",
    # Explícito: `conftest` deja CORS_ORIGINS en el entorno del proceso y
    # pydantic-settings lee variables reales, no sólo el .env. Sin esto, los
    # tests del default estarían midiendo la config de los tests.
    "CORS_ORIGINS": "",
}

GOOD_KEY = "k" * MIN_SECRET_LENGTH
GOOD_PASSWORD = "una-contraseña-larga"


def build(**overrides) -> Settings:
    # `_env_file=None` para que no se cuele el .env del repo en el test.
    return Settings(_env_file=None, **{**BASE, **overrides})


# ── Producción rechaza secretos de ejemplo ────────────────────────────────────

@pytest.mark.parametrize(
    "key",
    ["super-secret-key-change-in-production", "changeme", "CHANGEME", "secret"],
)
def test_production_refuses_a_placeholder_secret_key(key):
    with pytest.raises(ValidationError, match="SECRET_KEY"):
        build(ENVIRONMENT="production", SECRET_KEY=key, SUPERADMIN_PASSWORD=GOOD_PASSWORD)


def test_production_refuses_a_short_secret_key():
    with pytest.raises(ValidationError, match="mínimo"):
        build(ENVIRONMENT="production", SECRET_KEY="corta", SUPERADMIN_PASSWORD=GOOD_PASSWORD)


def test_production_refuses_a_placeholder_superadmin_password():
    with pytest.raises(ValidationError, match="SUPERADMIN_PASSWORD"):
        build(ENVIRONMENT="production", SECRET_KEY=GOOD_KEY, SUPERADMIN_PASSWORD="changeme123")


def test_the_error_says_how_to_generate_a_good_one():
    """Un error que sólo dice "no" manda a la persona a buscar en el README."""
    with pytest.raises(ValidationError) as exc:
        build(ENVIRONMENT="production", SECRET_KEY="changeme", SUPERADMIN_PASSWORD="changeme")
    mensaje = str(exc.value)
    assert "secrets.token_urlsafe" in mensaje


def test_production_starts_with_real_secrets():
    settings = build(
        ENVIRONMENT="production", SECRET_KEY=GOOD_KEY, SUPERADMIN_PASSWORD=GOOD_PASSWORD
    )
    assert settings.is_production is True


# ── Desarrollo no molesta ─────────────────────────────────────────────────────

def test_development_still_starts_with_the_example_values():
    """Si esto fallara, nadie podría levantar el proyecto siguiendo el README."""
    settings = build(SECRET_KEY="changeme", SUPERADMIN_PASSWORD="changeme123")
    assert settings.is_production is False


# ── CORS se invierte según el entorno ─────────────────────────────────────────

def test_cors_allows_everything_in_development():
    settings = build(SECRET_KEY="changeme", SUPERADMIN_PASSWORD="changeme123")
    assert settings.cors_origins == ["*"]


def test_cors_allows_nothing_in_production_by_default():
    """
    Frontend y API comparten dominio: no hay pedido cruzado que permitir.

    Un `*` acá sería dejar que cualquier página del mundo le hable a la API con
    el token del socio.
    """
    settings = build(
        ENVIRONMENT="production", SECRET_KEY=GOOD_KEY, SUPERADMIN_PASSWORD=GOOD_PASSWORD
    )
    assert settings.cors_origins == []


def test_an_explicit_origin_is_respected_in_production():
    settings = build(
        ENVIRONMENT="production",
        SECRET_KEY=GOOD_KEY,
        SUPERADMIN_PASSWORD=GOOD_PASSWORD,
        CORS_ORIGINS="https://app.club.com, https://otro.club.com",
    )
    assert settings.cors_origins == ["https://app.club.com", "https://otro.club.com"]
