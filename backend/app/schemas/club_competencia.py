"""
Fixture, tablas y citados del club entero.

Ver [[add-portal-multidivision]]: agregación club-entero sobre datos que ya
existen (`sessions`, `standings`, `match_squad`), sin lógica de cálculo nueva.
"""
import uuid
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel

from app.schemas.competition import StandingRow
from app.schemas.player import SquadMemberResponse


class FixtureMatch(BaseModel):
    session_id: uuid.UUID
    home_team: str
    away_team: str
    scheduled_at: Optional[datetime] = None
    status: str
    #: Sólo si `status == "finished"`. Un partido en curso no tiene resultado
    #: todavía, y mostrar un score parcial confundiría con uno final.
    home_score: Optional[int] = None
    away_score: Optional[int] = None


class DivisionFixture(BaseModel):
    division_id: uuid.UUID
    division_name: str
    matches: list[FixtureMatch]


class DivisionStandings(BaseModel):
    division_id: uuid.UUID
    division_name: str
    tournament_id: Optional[uuid.UUID] = None
    rows: list[StandingRow]


class DivisionConvocatoria(BaseModel):
    division_id: uuid.UUID
    division_name: str
    session_id: Optional[uuid.UUID] = None
    home_team: Optional[str] = None
    away_team: Optional[str] = None
    scheduled_at: Optional[datetime] = None
    members: list[SquadMemberResponse] = []
    #: Presente sólo cuando no hay convocatoria que mostrar. El índice no falla
    #: por una división sin cargar — a diferencia de `GET /sessions/{id}/squad/message`,
    #: acá el pedido es "mostrame lo que haya".
    reason: Optional[Literal["sin_convocatoria"]] = None
