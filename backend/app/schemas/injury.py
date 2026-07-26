import uuid
from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict

SeverityLiteral = Literal["leve", "moderada", "grave"]
AvailabilityLiteral = Literal["disponible", "lesionado", "suspendido", "baja_temporal"]


class InjuryCreate(BaseModel):
    injury_date: date
    body_zone: Optional[str] = None
    injury_type: Optional[str] = None
    severity: SeverityLiteral = "leve"
    expected_return: Optional[date] = None
    actual_return: Optional[date] = None
    notes: Optional[str] = None


class InjuryUpdate(BaseModel):
    injury_date: Optional[date] = None
    body_zone: Optional[str] = None
    injury_type: Optional[str] = None
    severity: Optional[SeverityLiteral] = None
    expected_return: Optional[date] = None
    #: Mandarlo explícitamente en null reabre la lesión.
    actual_return: Optional[date] = None
    notes: Optional[str] = None


class InjuryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    player_id: uuid.UUID
    injury_date: date
    body_zone: Optional[str]
    injury_type: Optional[str]
    severity: str
    expected_return: Optional[date]
    actual_return: Optional[date]
    notes: Optional[str]


class AvailabilityUpdate(BaseModel):
    availability: Optional[AvailabilityLiteral] = None
    medical_clearance_date: Optional[date] = None
    medical_clearance_expires: Optional[date] = None


class SuspensionCandidate(BaseModel):
    """Roja registrada sin suspensión cargada. Sugerencia, no acción automática."""

    player_id: uuid.UUID
    player_name: str
    session_id: uuid.UUID
    match_label: str
    card_date: date


class DivisionAvailabilityRow(BaseModel):
    player_id: uuid.UUID
    player_name: str
    position: Optional[str] = None
    availability: str
    medical_clearance_expires: Optional[date] = None
    clearance_expired: bool
    clearance_expiring: bool
