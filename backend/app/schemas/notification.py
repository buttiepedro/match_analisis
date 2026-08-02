import uuid
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict


class VapidPublicKeyResponse(BaseModel):
    public_key: str


class NotificationDeviceCreate(BaseModel):
    channel: Literal["web_push"] = "web_push"
    #: URL de push del navegador (`PushSubscription.endpoint`).
    endpoint: str
    p256dh: Optional[str] = None
    auth_secret: Optional[str] = None


class NotificationDeviceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    channel: str
    is_active: bool


class NotificationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    type: str
    title: str
    body: str
    data: dict
    read_at: Optional[datetime] = None
    created_at: datetime


class NotificationPreferenceItem(BaseModel):
    type: str
    enabled: bool


class NotificationPreferencesUpdate(BaseModel):
    preferences: list[NotificationPreferenceItem]
