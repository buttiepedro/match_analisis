"""
Bandeja de notificaciones, dispositivos de push y preferencias.

Recibir avisos propios no es un permiso sobre el club: todos estos endpoints
sólo piden sesión (`get_current_user`), igual que el resto del portal.
"""
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models import (
    Notification,
    NotificationChannel,
    NotificationDevice,
    NotificationPreference,
    NotificationType,
    User,
)
from app.schemas.notification import (
    NotificationDeviceCreate,
    NotificationDeviceResponse,
    NotificationPreferenceItem,
    NotificationPreferencesUpdate,
    NotificationResponse,
    VapidPublicKeyResponse,
)

router = APIRouter()

NOTIFICATION_TYPE_VALUES = {t.value for t in NotificationType}


@router.get("/push/vapid-public-key", response_model=VapidPublicKeyResponse)
async def vapid_public_key():
    """La clave pública que el frontend necesita para suscribirse al push."""
    if not settings.VAPID_PUBLIC_KEY:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="Todavía no está configurado el push de esta instalación",
        )
    return VapidPublicKeyResponse(public_key=settings.VAPID_PUBLIC_KEY)


@router.post(
    "/me/notification-devices",
    response_model=NotificationDeviceResponse,
    status_code=status.HTTP_201_CREATED,
)
async def register_device(
    body: NotificationDeviceCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    existing = await db.scalar(
        select(NotificationDevice).where(
            NotificationDevice.user_id == current_user.id,
            NotificationDevice.endpoint == body.endpoint,
        )
    )
    if existing:
        # El navegador puede volver a mandar la misma suscripción (ej. tras
        # limpiar el almacenamiento local): reactivarla es más correcto que
        # duplicarla, y el UNIQUE (user_id, endpoint) tampoco lo permitiría.
        existing.is_active = True
        existing.p256dh = body.p256dh
        existing.auth_secret = body.auth_secret
        existing.last_seen_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(existing)
        return existing

    device = NotificationDevice(
        id=uuid.uuid4(),
        user_id=current_user.id,
        channel=NotificationChannel(body.channel),
        endpoint=body.endpoint,
        p256dh=body.p256dh,
        auth_secret=body.auth_secret,
        last_seen_at=datetime.now(timezone.utc),
    )
    db.add(device)
    await db.commit()
    await db.refresh(device)
    return device


@router.delete("/me/notification-devices/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unregister_device(
    device_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    device = await db.scalar(
        select(NotificationDevice).where(
            NotificationDevice.id == device_id, NotificationDevice.user_id == current_user.id
        )
    )
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device no encontrado")
    await db.delete(device)
    await db.commit()


@router.get("/me/notifications", response_model=list[NotificationResponse])
async def list_notifications(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    unread: Annotated[bool, Query()] = False,
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
):
    query = select(Notification).where(Notification.user_id == current_user.id)
    if unread:
        query = query.where(Notification.read_at.is_(None))
    query = query.order_by(Notification.created_at.desc()).limit(limit)
    return (await db.execute(query)).scalars().all()


@router.get("/me/notifications/unread-count")
async def unread_count(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict[str, int]:
    """La campana del menú sondea acá — liviano a propósito, sin traer la lista."""
    count = await db.scalar(
        select(func.count())
        .select_from(Notification)
        .where(Notification.user_id == current_user.id, Notification.read_at.is_(None))
    )
    return {"count": count or 0}


@router.post("/me/notifications/{notification_id}/read", response_model=NotificationResponse)
async def mark_notification_read(
    notification_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    notification = await db.scalar(
        select(Notification).where(
            Notification.id == notification_id, Notification.user_id == current_user.id
        )
    )
    if not notification:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notificación no encontrada")
    if notification.read_at is None:
        notification.read_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(notification)
    return notification


@router.get("/me/notification-preferences", response_model=list[NotificationPreferenceItem])
async def get_notification_preferences(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    rows = (
        await db.execute(
            select(NotificationPreference).where(NotificationPreference.user_id == current_user.id)
        )
    ).scalars().all()
    by_type = {r.type: r.enabled for r in rows}
    # Todo el catálogo, no sólo lo que el usuario ya tocó: sin fila = habilitado.
    return [
        NotificationPreferenceItem(type=t.value, enabled=by_type.get(t.value, True))
        for t in NotificationType
    ]


@router.put("/me/notification-preferences", response_model=list[NotificationPreferenceItem])
async def set_notification_preferences(
    body: NotificationPreferencesUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    existing = {
        r.type: r
        for r in (
            await db.execute(
                select(NotificationPreference).where(NotificationPreference.user_id == current_user.id)
            )
        ).scalars().all()
    }
    for item in body.preferences:
        # Un tipo desconocido (cliente viejo, o typo) se ignora en vez de
        # tirar un 422 por un catálogo que el usuario no controla.
        if item.type not in NOTIFICATION_TYPE_VALUES:
            continue
        row = existing.get(item.type)
        if row:
            row.enabled = item.enabled
        else:
            db.add(
                NotificationPreference(
                    id=uuid.uuid4(), user_id=current_user.id, type=item.type, enabled=item.enabled
                )
            )
    await db.commit()
    return await get_notification_preferences(db, current_user)
