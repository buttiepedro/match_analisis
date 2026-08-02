import uuid
from datetime import date
from typing import Literal, Optional
from pydantic import BaseModel, ConfigDict, EmailStr


class PlayerCreate(BaseModel):
    name: str
    position: Optional[str] = None
    dni: Optional[str] = None
    date_of_birth: Optional[date] = None
    sex: Optional[Literal["M", "F"]] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    emergency_phone: Optional[str] = None
    obra_social: Optional[str] = None


class PlayerUpdate(BaseModel):
    name: Optional[str] = None
    position: Optional[str] = None
    dni: Optional[str] = None
    date_of_birth: Optional[date] = None
    sex: Optional[Literal["M", "F"]] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    emergency_phone: Optional[str] = None
    obra_social: Optional[str] = None
    is_active: Optional[bool] = None
    division_id: Optional[uuid.UUID] = None


class PlayerResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    division_id: uuid.UUID
    name: str
    position: Optional[str]
    dni: Optional[str]
    date_of_birth: Optional[date] = None
    sex: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    emergency_phone: Optional[str] = None
    obra_social: Optional[str] = None
    profile_photo_url: Optional[str] = None
    is_active: bool
    availability: str = "disponible"
    medical_clearance_date: Optional[date] = None
    medical_clearance_expires: Optional[date] = None


class PlayerWithDivisionResponse(BaseModel):
    id: uuid.UUID
    division_id: uuid.UUID
    division_name: str
    name: str
    position: Optional[str]
    is_active: bool
    # La grilla de armado arma el equipo con esta lista: sin disponibilidad acá,
    # convocar a un lesionado no se puede advertir sin un request por jugador.
    availability: str = "disponible"
    medical_clearance_expires: Optional[date] = None


class LineupEntryCreate(BaseModel):
    player_id: uuid.UUID
    jersey_number: int
    position: Optional[str] = None
    team: Literal["user", "rival"] = "user"
    status: Literal["on_field", "bench"] = "on_field"


class LineupEntryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    player_id: uuid.UUID
    jersey_number: int
    position: Optional[str]
    team: str
    status: str
    player: PlayerResponse


class LineupEntryUpdate(BaseModel):
    jersey_number: Optional[int] = None
    position: Optional[str] = None


class SubstituteRequest(BaseModel):
    lineup_out_id: uuid.UUID
    lineup_in_id: uuid.UUID


class LineupBulkEntry(BaseModel):
    player_id: uuid.UUID
    jersey_number: int
    position: Optional[str] = None
    status: Literal["on_field", "bench"] = "on_field"


class LineupBulkRequest(BaseModel):
    """
    Reemplaza el lineup completo de **un equipo** en una sola transacción.

    Se hace de a un equipo por request para no obligar a mandar el rival cuando
    sólo se está armando el equipo propio.
    """

    team: Literal["user", "rival"] = "user"
    entries: list[LineupBulkEntry]


class SuggestedLineupEntry(BaseModel):
    player_id: uuid.UUID
    player_name: str
    jersey_number: int
    position: Optional[str] = None
    status: str
    #: False cuando el jugador ya no está activo o cambió de división.
    available: bool


class SuggestedLineupResponse(BaseModel):
    #: None cuando no hay partido anterior del que copiar.
    source_session_id: Optional[uuid.UUID] = None
    source_label: Optional[str] = None
    entries: list[SuggestedLineupEntry]


class SquadEntry(BaseModel):
    player_id: uuid.UUID
    status: Literal["convocado", "confirmado", "baja"] = "convocado"


class SquadBulkRequest(BaseModel):
    """Reemplaza la convocatoria completa; mismo criterio que el lineup bulk."""

    entries: list[SquadEntry]


class SquadMemberResponse(BaseModel):
    player_id: uuid.UUID
    player_name: str
    position: Optional[str] = None
    status: str


class SquadMessage(BaseModel):
    """Convocatoria como texto plano, para pegar en el grupo."""

    text: str
    count: int


class MyPlayerProfileResponse(PlayerResponse):
    """
    `/me/player` agrega los dos flags que ya calcula la grilla de armado
    ([[gestion-semanal]]) para que el jugador no tenga que restar fechas él
    mismo para saber si su apto está por vencer.
    """

    clearance_expired: bool
    clearance_expiring: bool


class PlayerDivisionHistoryResponse(BaseModel):
    division_id: uuid.UUID
    division_name: str
    from_date: date
    #: None = división actual.
    to_date: Optional[date] = None


class MyPlayerUpdate(BaseModel):
    """
    Whitelist de lo que un jugador puede tocar de su propia ficha.

    `extra="forbid"` en vez de ignorar en silencio: un jugador que manda `dni`
    en el body tiene que ver el `422`, no un 200 que no cambió nada. La foto
    **no** está acá a propósito — se sube por `POST /me/player/photo`, igual
    que la carga el cuerpo técnico.
    """

    model_config = ConfigDict(extra="forbid")

    phone: Optional[str] = None
    emergency_phone: Optional[str] = None
    email: Optional[EmailStr] = None
