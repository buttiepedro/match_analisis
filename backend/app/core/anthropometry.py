"""
Composición corporal a partir de pliegues cutáneos.

Durnin & Womersley (1974) estiman la densidad corporal desde el logaritmo de la
suma de cuatro pliegues; Siri (1961) la convierte a porcentaje de grasa. Los
coeficientes dependen de **edad y sexo**: aplicar los de un solo grupo a todo el
plantel (como hacía la versión anterior, fija en varón 17-19) sesga el resultado
de cualquier jugadora y de cualquier jugador adulto.

Los cuatro pliegues canónicos de Durnin-Womersley son bíceps, tríceps,
subescapular y suprailíaco. La app venía midiendo abdominal en lugar de bíceps,
así que se admiten ambos juegos y el método efectivo queda registrado en cada
medición para que nadie compare peras con manzanas.
"""
import math
from datetime import date
from decimal import Decimal
from typing import Optional

# (constante, pendiente) de D = c - m * log10(suma de pliegues en mm)
_MALE: dict[str, tuple[float, float]] = {
    "<17":   (1.1533, 0.0643),
    "17-19": (1.1620, 0.0630),
    "20-29": (1.1631, 0.0632),
    "30-39": (1.1422, 0.0544),
    "40-49": (1.1620, 0.0700),
    "50+":   (1.1715, 0.0779),
}

_FEMALE: dict[str, tuple[float, float]] = {
    "<17":   (1.1369, 0.0598),
    "17-19": (1.1549, 0.0678),
    "20-29": (1.1599, 0.0717),
    "30-39": (1.1423, 0.0632),
    "40-49": (1.1333, 0.0612),
    "50+":   (1.1339, 0.0645),
}

# Banda usada cuando el jugador no tiene fecha de nacimiento cargada.
_DEFAULT_BAND = "20-29"
_DEFAULT_SEX = "M"


def age_at(date_of_birth: Optional[date], on_date: date) -> Optional[int]:
    """Edad cumplida a la fecha de la medición."""
    if date_of_birth is None:
        return None
    years = on_date.year - date_of_birth.year
    if (on_date.month, on_date.day) < (date_of_birth.month, date_of_birth.day):
        years -= 1
    return max(0, years)


def age_band(age: Optional[int]) -> tuple[str, bool]:
    """Devuelve (banda, es_asumida)."""
    if age is None:
        return _DEFAULT_BAND, True
    if age < 17:
        return "<17", False
    if age <= 19:
        return "17-19", False
    if age <= 29:
        return "20-29", False
    if age <= 39:
        return "30-39", False
    if age <= 49:
        return "40-49", False
    return "50+", False


def normalize_sex(sex: Optional[str]) -> tuple[str, bool]:
    """Devuelve (sexo, es_asumido). Cualquier valor no reconocido cae al default."""
    if sex and sex.strip().upper().startswith("F"):
        return "F", False
    if sex and sex.strip().upper().startswith("M"):
        return "M", False
    return _DEFAULT_SEX, True


def calculate_bmi(
    weight_kg: Optional[Decimal], height_cm: Optional[Decimal]
) -> Optional[Decimal]:
    if not weight_kg or not height_cm or height_cm <= 0:
        return None
    height_m = height_cm / Decimal("100")
    return round(weight_kg / (height_m * height_m), 2)


def siri_body_fat(density: float) -> float:
    """Siri (1961): % grasa a partir de la densidad corporal."""
    return (4.95 / density - 4.50) * 100


def calculate_body_fat(
    *,
    tricep_mm: Optional[Decimal],
    subscapular_mm: Optional[Decimal],
    suprailiac_mm: Optional[Decimal],
    biceps_mm: Optional[Decimal] = None,
    abdominal_mm: Optional[Decimal] = None,
    date_of_birth: Optional[date] = None,
    sex: Optional[str] = None,
    measured_at: Optional[date] = None,
) -> tuple[Optional[Decimal], Optional[str]]:
    """
    Devuelve (porcentaje_de_grasa, método).

    El método tiene forma ``dw4c/M/20-29`` — juego de pliegues, sexo y banda
    etaria efectivamente usados. Un ``*`` marca un valor asumido por falta de
    dato en la ficha del jugador (``dw4c/M*/20-29*``).
    """
    if tricep_mm is None or subscapular_mm is None or suprailiac_mm is None:
        return None, None

    if biceps_mm is not None:
        fourth, fold_set = biceps_mm, "dw4c"
    elif abdominal_mm is not None:
        fourth, fold_set = abdominal_mm, "dw4a"
    else:
        return None, None

    total = float(tricep_mm) + float(subscapular_mm) + float(suprailiac_mm) + float(fourth)
    if total <= 0:
        return None, None

    resolved_sex, sex_assumed = normalize_sex(sex)
    age = age_at(date_of_birth, measured_at or date.today())
    band, band_assumed = age_band(age)

    constant, slope = (_FEMALE if resolved_sex == "F" else _MALE)[band]
    density = constant - slope * math.log10(total)
    percent = siri_body_fat(density)

    # Fuera de este rango la estimación no es fisiológicamente creíble: es más
    # honesto no devolver nada que mostrar un número que nadie puede usar.
    if not 1.0 <= percent <= 60.0:
        return None, None

    method = (
        f"{fold_set}/{resolved_sex}{'*' if sex_assumed else ''}"
        f"/{band}{'*' if band_assumed else ''}"
    )
    return round(Decimal(str(percent)), 1), method
