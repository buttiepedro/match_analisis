"""
Notificaciones: bandeja siempre, push best-effort.

`channel` es lo que hace que un canal nativo (`fcm`/`apns`, de
[[add-app-movil-react-native]]) sea agregar una fila al enum y un sender, no un
sistema aparte. `Notification` y `NotificationPreference` no cambian el día que
se sume ese canal.
"""
import enum
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, JSON, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class NotificationChannel(str, enum.Enum):
    web_push = "web_push"
    fcm = "fcm"
    apns = "apns"


class NotificationType(str, enum.Enum):
    """
    Catálogo de tipos, en código y no en tabla — igual que `Permission` en
    `core/permissions.py`. Cada tipo nuevo se agrega acá, sin tocar el modelo.
    """

    formacion_cargada = "formacion_cargada"


class NotificationDevice(Base):
    """Una suscripción de push de un usuario en un dispositivo/navegador."""

    __tablename__ = "notification_devices"
    __table_args__ = (
        UniqueConstraint("user_id", "endpoint", name="uq_notification_device_user_endpoint"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    channel: Mapped[NotificationChannel] = mapped_column(
        Enum(NotificationChannel), nullable=False, default=NotificationChannel.web_push,
        server_default="web_push",
    )
    #: URL de push (web) o token del canal nativo.
    endpoint: Mapped[str] = mapped_column(Text, nullable=False)
    #: Sólo `web_push`: claves de la `PushSubscription` del navegador.
    p256dh: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    auth_secret: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    last_seen_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Notification(Base):
    """La bandeja. Se escribe siempre, aunque el push falle o no haya devices."""

    __tablename__ = "notifications"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    club_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clubs.id"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    type: Mapped[str] = mapped_column(String(50), nullable=False)
    title: Mapped[str] = mapped_column(String(150), nullable=False)
    body: Mapped[str] = mapped_column(String(300), nullable=False)
    #: Ej. `{"session_id": "...", "url": "/sessions/{id}/lineup"}` para el deep link.
    data: Mapped[dict] = mapped_column(JSON, default=dict, server_default="{}")
    read_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class NotificationPreference(Base):
    """
    Opt-out por tipo. Sin fila = habilitado — opt-in por defecto, igual que el
    resto de la app no obliga a configurar nada para funcionar.
    """

    __tablename__ = "notification_preferences"
    __table_args__ = (
        UniqueConstraint("user_id", "type", name="uq_notification_preference_user_type"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    type: Mapped[str] = mapped_column(String(50), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
