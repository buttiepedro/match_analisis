from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    DATABASE_URL: str
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    SUPERADMIN_EMAIL: str
    SUPERADMIN_PASSWORD: str

    # Orígenes permitidos por CORS, separados por coma.
    # Ej: "https://app.miclub.com,http://localhost:3000"
    # Si queda vacío se permite cualquier origen y se avisa al iniciar.
    CORS_ORIGINS: str = ""

    @property
    def cors_origins(self) -> list[str]:
        origins = [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]
        return origins or ["*"]

    AWS_ACCESS_KEY_ID: str | None = None
    AWS_SECRET_ACCESS_KEY: str | None = None
    AWS_REGION: str = "us-east-1"
    AWS_S3_BUCKET: str | None = None
    # Optional CDN/custom base URL. If unset, uses the standard S3 public URL.
    AWS_S3_PUBLIC_URL: str | None = None


settings = Settings()
