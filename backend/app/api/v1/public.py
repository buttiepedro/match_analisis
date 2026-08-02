"""
Endpoints sin autenticación, servidos desde memoria (`app.state.club`), no
desde una consulta. Ver [[add-club-subdominios-y-marca]].
"""
from fastapi import APIRouter, HTTPException, Request, status

from app.schemas.club import ClubBrandingResponse

router = APIRouter(prefix="/public")


@router.get("/club-branding", response_model=ClubBrandingResponse)
async def club_branding(request: Request):
    """
    404 en la instancia de plataforma (sin `CLUB_SLUG`): no tiene un club
    propio del que informar. El frontend lo trata como "sin marca
    configurada" y usa el tema por defecto — es opt-in, no un paso
    obligatorio para poder usar la app.
    """
    club = request.app.state.club
    if club is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Esta instancia no tiene club propio")
    return club
