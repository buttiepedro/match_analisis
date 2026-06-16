import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict, computed_field, model_validator


class MeasurementCreate(BaseModel):
    measured_at: date
    weight_kg: Optional[Decimal] = None
    height_cm: Optional[Decimal] = None
    fat_fold_tricep_mm: Optional[Decimal] = None
    fat_fold_subscapular_mm: Optional[Decimal] = None
    fat_fold_suprailiac_mm: Optional[Decimal] = None
    fat_fold_abdominal_mm: Optional[Decimal] = None
    notes: Optional[str] = None


class MeasurementResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    player_id: uuid.UUID
    measured_at: date
    weight_kg: Optional[Decimal]
    height_cm: Optional[Decimal]
    bmi: Optional[Decimal]
    fat_fold_tricep_mm: Optional[Decimal]
    fat_fold_subscapular_mm: Optional[Decimal]
    fat_fold_suprailiac_mm: Optional[Decimal]
    fat_fold_abdominal_mm: Optional[Decimal]
    body_fat_percent: Optional[Decimal]
    notes: Optional[str]
    created_at: datetime


# Catálogo de tipos de test físico
TEST_TYPES = {
    "sprint_10m":    {"label": "Sprint 10m",       "unit": "seconds",    "category": "Velocidad"},
    "sprint_20m":    {"label": "Sprint 20m",       "unit": "seconds",    "category": "Velocidad"},
    "sprint_40m":    {"label": "Sprint 40m",       "unit": "seconds",    "category": "Velocidad"},
    "accel_5m":      {"label": "Aceleración 5m",   "unit": "seconds",    "category": "Aceleración"},
    "bronco":        {"label": "Bronco Test",       "unit": "seconds",    "category": "Aeróbico"},
    "bench_1rm":     {"label": "Press banca 1RM",  "unit": "kg",         "category": "Fuerza"},
    "squat_1rm":     {"label": "Sentadilla 1RM",   "unit": "kg",         "category": "Fuerza"},
    "hip_thrust_1rm":{"label": "Hip Thrust 1RM",   "unit": "kg",         "category": "Fuerza"},
    "shoulder_1rm":  {"label": "Press hombro 1RM", "unit": "kg",         "category": "Fuerza"},
    "cmj":           {"label": "Salto CMJ",         "unit": "cm",         "category": "Salto"},
    "long_jump":     {"label": "Salto horizontal",  "unit": "m",          "category": "Salto"},
    "sit_reach":     {"label": "Sit and reach",     "unit": "cm",         "category": "Flexibilidad"},
    "vo2max":        {"label": "VO2max estimado",   "unit": "ml_kg_min",  "category": "Aeróbico"},
}


class PhysicalTestCreate(BaseModel):
    test_date: date
    test_type: str
    value: Decimal
    notes: Optional[str] = None

    @model_validator(mode="after")
    def validate_test_type(self):
        if self.test_type not in TEST_TYPES:
            raise ValueError(f"test_type inválido. Valores válidos: {list(TEST_TYPES.keys())}")
        return self


class PhysicalTestResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    player_id: uuid.UUID
    test_date: date
    test_type: str
    value: Decimal
    unit: str
    notes: Optional[str]
    created_at: datetime


class PhysicalTestRankingEntry(BaseModel):
    player_id: uuid.UUID
    player_name: str
    value: Decimal
    unit: str
    test_date: date
    rank: int


class BatchMoveRequest(BaseModel):
    player_ids: list[uuid.UUID]
    to_division_id: uuid.UUID
