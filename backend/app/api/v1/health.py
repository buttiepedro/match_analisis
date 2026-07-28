"""
Dos chequeos que responden preguntas distintas.

Confundirlos es lo que hace que un orquestador reinicie en loop un backend sano
porque la base tardó en arrancar, o que le mande tráfico a uno que no puede
responder nada.
"""
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db

router = APIRouter()


@router.get("/health")
async def health():
    """
    ¿El proceso está vivo? Nada más.

    No toca la base a propósito: si esto fallara cuando la base está caída, un
    reinicio automático mataría un backend que no tiene nada malo.
    """
    return {"status": "ok"}


@router.get("/health/ready")
async def ready(response: Response, db: Annotated[AsyncSession, Depends(get_db)]):
    """
    ¿Puede atender un request de verdad?

    Consulta la base, porque un backend sin base atiende igual y devuelve 500 a
    todo. Es el chequeo que mira el healthcheck de compose.
    """
    try:
        await db.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001 — cualquier fallo acá significa "no listo"
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "degraded", "database": "unreachable", "detail": str(exc)[:200]}

    return {"status": "ok", "database": "ok"}
