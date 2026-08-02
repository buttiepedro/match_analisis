import secrets

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

#: Valores que vienen en `.env.example` y en la documentación. Que alguno llegue
#: a producción es el modo de falla más común de un despliegue apurado: se copia
#: el ejemplo, se cambia lo que rompe al arrancar, y lo que no rompe queda.
PLACEHOLDER_SECRETS = {
    "super-secret-key-change-in-production",
    "changeme",
    "changeme123",
    "change-me",
    "secret",
    "test-secret-key-not-for-production",
}

#: Piso razonable para una clave HS256.
MIN_SECRET_LENGTH = 32
MIN_PASSWORD_LENGTH = 12


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    #: `production` enciende las validaciones de abajo. Lo pone el compose de
    #: producción; en desarrollo y en los tests queda en `development`.
    ENVIRONMENT: str = "development"

    #: Qué club es esta instancia (ver [[add-club-subdominios-y-marca]]). Sin
    #: configurar, es la instancia de plataforma: sirve el login de
    #: `superadmin` y el alta de clubes, no un club en particular.
    CLUB_SLUG: str | None = None

    DATABASE_URL: str
    #: Sólo la usa Alembic. Neon separa el endpoint pooled (runtime) del
    #: directo (migraciones) — un pooler en modo transacción no sostiene lo
    #: que Alembic necesita. Sin configurar, Alembic usa `DATABASE_URL`: es lo
    #: que ya pasa hoy contra una base propia, sin pooler de por medio.
    DATABASE_URL_DIRECT: str | None = None
    #: Conservador a propósito: con una instancia por club, cada una mantiene
    #: su propio pool contra la misma base compartida — el pooler de Neon ya
    #: multiplexa del lado del servidor, apilar un pool grande por instancia
    #: no suma nada.
    DB_POOL_SIZE: int = 5
    DB_MAX_OVERFLOW: int = 5
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    SUPERADMIN_EMAIL: str
    SUPERADMIN_PASSWORD: str

    # Orígenes permitidos por CORS, separados por coma.
    # Ej: "https://app.miclub.com,http://localhost:3000"
    CORS_ORIGINS: str = ""

    AWS_ACCESS_KEY_ID: str | None = None
    AWS_SECRET_ACCESS_KEY: str | None = None
    AWS_REGION: str = "us-east-1"
    AWS_S3_BUCKET: str | None = None
    # Optional CDN/custom base URL. If unset, uses the standard S3 public URL.
    AWS_S3_PUBLIC_URL: str | None = None

    # Claves VAPID para Web Push. Son del origen (la instalación), no del club:
    # se generan una vez, no por tenant. Opcionales: sin ellas, el push queda
    # apagado y la bandeja sigue funcionando igual (ver core/notifications.py).
    VAPID_PUBLIC_KEY: str | None = None
    VAPID_PRIVATE_KEY: str | None = None
    VAPID_SUBJECT: str | None = None

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT.strip().lower() == "production"

    @property
    def cors_origins(self) -> list[str]:
        """
        Sin configurar, el comportamiento se **invierte** según el entorno.

        En desarrollo, cualquier origen: es lo cómodo y no hay nada que perder.
        En producción, ninguno — el despliegue estándar sirve frontend y API
        desde el mismo dominio, así que no hace falta ni un origen cruzado. Un
        `*` acá sería dejar que cualquier página del mundo le hable a la API con
        el token del socio.
        """
        origins = [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]
        if origins:
            return origins
        return [] if self.is_production else ["*"]

    @model_validator(mode="after")
    def _refuse_to_start_with_placeholder_secrets(self) -> "Settings":
        """
        En producción, un secreto de ejemplo tira el arranque.

        Fallar al arrancar es incómodo pero se ve. Arrancar con la clave del
        README es una app firmando tokens con un secreto público, y eso no se ve
        hasta que alguien entra con un token que se firmó solo.
        """
        if not self.is_production:
            return self

        problems = []
        key = self.SECRET_KEY.strip()
        password = self.SUPERADMIN_PASSWORD.strip()

        if key.lower() in PLACEHOLDER_SECRETS:
            problems.append("SECRET_KEY es uno de los valores de ejemplo")
        elif len(key) < MIN_SECRET_LENGTH:
            problems.append(
                f"SECRET_KEY tiene {len(key)} caracteres y el mínimo es {MIN_SECRET_LENGTH}"
            )

        if password.lower() in PLACEHOLDER_SECRETS:
            problems.append("SUPERADMIN_PASSWORD es uno de los valores de ejemplo")
        elif len(password) < MIN_PASSWORD_LENGTH:
            problems.append(
                f"SUPERADMIN_PASSWORD tiene {len(password)} caracteres y el mínimo "
                f"es {MIN_PASSWORD_LENGTH}"
            )

        if problems:
            listado = "\n".join(f"  - {p}" for p in problems)
            raise ValueError(
                "\n\nEl backend no arranca en producción con secretos de ejemplo:\n"
                f"{listado}\n\n"
                "Generá uno con:\n"
                '  python -c "import secrets; print(secrets.token_urlsafe(48))"\n\n'
                f"Uno recién generado, listo para copiar:\n  {secrets.token_urlsafe(48)}\n"
            )

        return self


settings = Settings()
