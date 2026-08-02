"""
Qué club es esta instancia — resuelto **una vez, al arrancar**, no por
request. Ver [[add-club-subdominios-y-marca]].

Reemplaza la idea de "resolver tenant por request" (leer el header `Host` y
buscar el club en cada endpoint): acá cada instancia arranca sabiendo cuál es
su club, y esa pregunta no vuelve a hacerse.
"""
from fastapi import FastAPI
from sqlalchemy import select

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models import Club


async def load_club_context(app: FastAPI) -> None:
    """
    Sin `CLUB_SLUG`, esta es la instancia de plataforma (login de
    `superadmin`, alta de clubes) — `app.state.club` queda en `None`.

    Con `CLUB_SLUG` configurado, si el slug no existe o el club está
    inactivo, **la instancia no arranca**. Es preferible a arrancar y servir
    un 500 en el primer request: el error aparece en el log de despliegue,
    no en el celular de un socio.
    """
    if not settings.CLUB_SLUG:
        app.state.club = None
        return

    async with AsyncSessionLocal() as session:
        club = await session.scalar(select(Club).where(Club.slug == settings.CLUB_SLUG))

    if club is None or not club.is_active:
        raise RuntimeError(
            f"CLUB_SLUG='{settings.CLUB_SLUG}' no corresponde a ningún club activo. "
            "Esta instancia no puede arrancar sin saber de qué club es."
        )

    app.state.club = club
