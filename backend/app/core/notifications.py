"""
Servicio de notificaciones: bandeja siempre, push best-effort.

La bandeja no es un respaldo del push — es el canal primario. El push puede no
llegar por motivos que nada tienen que ver con un bug: el usuario no dio
permiso, el navegador no lo soporta, o es iPhone y no agregó la app a la
pantalla de inicio. Push que falla no pierde el aviso; lo pierde sólo si
tampoco se guardó.
"""
import asyncio
import json
import logging
import uuid

from pywebpush import WebPushException, webpush
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models import Notification, NotificationChannel, NotificationDevice, NotificationPreference, NotificationType

logger = logging.getLogger(__name__)


class DeviceGone(Exception):
    """La suscripción venció o fue revocada (404/410): el device se desactiva."""


class WebPushSender:
    async def send(self, device: NotificationDevice, *, title: str, body: str, data: dict) -> None:
        if not (settings.VAPID_PRIVATE_KEY and settings.VAPID_SUBJECT):
            # Push sin configurar en esta instalación: la bandeja ya quedó
            # guardada, no hay más que intentar.
            return

        payload = json.dumps({"title": title, "body": body, "data": data})
        try:
            # `webpush()` es sync (usa `requests`): correrla tal cual bloquearía
            # el loop de eventos del resto de la app mientras dura el POST.
            await asyncio.to_thread(
                webpush,
                subscription_info={
                    "endpoint": device.endpoint,
                    "keys": {"p256dh": device.p256dh, "auth": device.auth_secret},
                },
                data=payload,
                vapid_private_key=settings.VAPID_PRIVATE_KEY,
                vapid_claims={"sub": settings.VAPID_SUBJECT},
            )
        except WebPushException as exc:
            status_code = exc.response.status_code if exc.response is not None else None
            if status_code in (404, 410):
                raise DeviceGone from exc
            raise


#: Un sender por canal. Sumar `fcm`/`apns` ([[add-app-movil-react-native]]) es
#: agregar una entrada acá, no reescribir `notify()`.
SENDERS: dict[NotificationChannel, WebPushSender] = {
    NotificationChannel.web_push: WebPushSender(),
}


async def _type_enabled(db: AsyncSession, user_id: uuid.UUID, type_: NotificationType) -> bool:
    pref = await db.scalar(
        select(NotificationPreference).where(
            NotificationPreference.user_id == user_id,
            NotificationPreference.type == type_.value,
        )
    )
    # Sin fila = habilitado: opt-in por defecto, igual que el resto de la app
    # no obliga a configurar nada para funcionar.
    return pref.enabled if pref else True


async def notify(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    club_id: uuid.UUID,
    type: NotificationType,
    title: str,
    body: str,
    data: dict | None = None,
) -> None:
    """
    Guarda el aviso en la bandeja y lo empuja a los dispositivos activos.

    Si el usuario apagó este tipo en sus preferencias, no hace **nada** — ni
    guarda ni empuja: apagado es apagado, no "apagado del push pero igual
    aparece en la bandeja".

    No atrapa errores de base de datos a propósito: quien la llama desde un
    flujo que no puede fallar por esto (ej. `PUT /sessions/{id}/lineup`) es
    responsable de envolver el llamado en su propio `try`.
    """
    if not await _type_enabled(db, user_id, type):
        return

    notification = Notification(
        id=uuid.uuid4(),
        club_id=club_id,
        user_id=user_id,
        type=type.value,
        title=title,
        body=body,
        data=data or {},
    )
    db.add(notification)
    await db.commit()

    devices = (
        await db.execute(
            select(NotificationDevice).where(
                NotificationDevice.user_id == user_id,
                NotificationDevice.is_active.is_(True),
            )
        )
    ).scalars().all()
    if not devices:
        return

    changed = False
    for device in devices:
        sender = SENDERS.get(device.channel)
        if sender is None:
            continue
        try:
            await sender.send(device, title=title, body=body, data=data or {})
        except DeviceGone:
            device.is_active = False
            changed = True
        except Exception:
            # Un push es best-effort: reintentar un aviso de "salió la
            # formación" media hora después ya no tiene sentido.
            logger.exception("No se pudo enviar el push al device %s", device.id)

    if changed:
        await db.commit()
