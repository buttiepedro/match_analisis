"""
Composición corporal: el bug que estos tests fijan es que la versión anterior
usaba siempre los coeficientes de varón 17-19, con lo que el % de grasa era
incorrecto para jugadoras y para cualquier adulto.
"""
from datetime import date
from decimal import Decimal

import pytest

from app.core.anthropometry import (
    age_at,
    age_band,
    calculate_bmi,
    calculate_body_fat,
    normalize_sex,
    siri_body_fat,
)

FOLDS = {
    "tricep_mm": Decimal("12"),
    "subscapular_mm": Decimal("15"),
    "suprailiac_mm": Decimal("18"),
    "biceps_mm": Decimal("8"),
}


# ── Edad ──────────────────────────────────────────────────────────────────────

def test_age_at_before_birthday_does_not_count_the_year():
    assert age_at(date(2000, 12, 31), date(2026, 6, 1)) == 25
    assert age_at(date(2000, 6, 1), date(2026, 6, 1)) == 26


def test_age_at_without_date_of_birth_is_unknown():
    assert age_at(None, date(2026, 6, 1)) is None


@pytest.mark.parametrize(
    "age,expected",
    [(15, "<17"), (17, "17-19"), (19, "17-19"), (25, "20-29"), (35, "30-39"), (45, "40-49"), (62, "50+")],
)
def test_age_band_boundaries(age, expected):
    assert age_band(age) == (expected, False)


def test_age_band_falls_back_and_marks_it_as_assumed():
    band, assumed = age_band(None)
    assert (band, assumed) == ("20-29", True)


# ── Sexo ──────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("value", ["F", "f", "femenino", "Female"])
def test_normalize_sex_female(value):
    assert normalize_sex(value) == ("F", False)


@pytest.mark.parametrize("value", ["M", "m", "masculino"])
def test_normalize_sex_male(value):
    assert normalize_sex(value) == ("M", False)


@pytest.mark.parametrize("value", [None, "", "x", "otro"])
def test_normalize_sex_unknown_is_assumed(value):
    assert normalize_sex(value) == ("M", True)


# ── IMC ───────────────────────────────────────────────────────────────────────

def test_bmi():
    assert calculate_bmi(Decimal("82.4"), Decimal("181")) == Decimal("25.15")


@pytest.mark.parametrize(
    "weight,height",
    [(None, Decimal("181")), (Decimal("82"), None), (Decimal("82"), Decimal("0"))],
)
def test_bmi_needs_both_values(weight, height):
    assert calculate_bmi(weight, height) is None


# ── % de grasa ────────────────────────────────────────────────────────────────

def test_body_fat_differs_by_sex_for_the_same_folds():
    """El bug original: mismos pliegues devolvían el mismo número para todos."""
    male, _ = calculate_body_fat(
        **FOLDS, date_of_birth=date(2000, 1, 1), sex="M", measured_at=date(2026, 1, 1)
    )
    female, _ = calculate_body_fat(
        **FOLDS, date_of_birth=date(2000, 1, 1), sex="F", measured_at=date(2026, 1, 1)
    )
    assert male != female
    assert female > male  # a igualdad de pliegues, la fórmula estima más grasa en mujeres


def test_body_fat_differs_by_age_for_the_same_folds():
    young, _ = calculate_body_fat(
        **FOLDS, date_of_birth=date(2008, 1, 1), sex="M", measured_at=date(2026, 1, 1)
    )
    veteran, _ = calculate_body_fat(
        **FOLDS, date_of_birth=date(1980, 1, 1), sex="M", measured_at=date(2026, 1, 1)
    )
    assert young != veteran


def test_body_fat_method_records_fold_set_sex_and_band():
    _, method = calculate_body_fat(
        **FOLDS, date_of_birth=date(2000, 1, 1), sex="F", measured_at=date(2026, 1, 1)
    )
    assert method == "dw4c/F/20-29"


def test_body_fat_method_marks_assumed_values():
    _, method = calculate_body_fat(
        tricep_mm=Decimal("12"),
        subscapular_mm=Decimal("15"),
        suprailiac_mm=Decimal("18"),
        abdominal_mm=Decimal("20"),
        date_of_birth=None,
        sex=None,
        measured_at=date(2026, 1, 1),
    )
    assert method == "dw4a/M*/20-29*"


def test_body_fat_prefers_the_canonical_biceps_fold_over_abdominal():
    _, method = calculate_body_fat(
        tricep_mm=Decimal("12"),
        subscapular_mm=Decimal("15"),
        suprailiac_mm=Decimal("18"),
        biceps_mm=Decimal("8"),
        abdominal_mm=Decimal("20"),
        sex="M",
        measured_at=date(2026, 1, 1),
    )
    assert method.startswith("dw4c/")


@pytest.mark.parametrize(
    "kwargs",
    [
        {"tricep_mm": None, "subscapular_mm": Decimal("15"), "suprailiac_mm": Decimal("18"), "biceps_mm": Decimal("8")},
        # Sin cuarto pliegue no hay fórmula posible.
        {"tricep_mm": Decimal("12"), "subscapular_mm": Decimal("15"), "suprailiac_mm": Decimal("18")},
    ],
)
def test_body_fat_returns_nothing_when_folds_are_incomplete(kwargs):
    assert calculate_body_fat(**kwargs, sex="M", measured_at=date(2026, 1, 1)) == (None, None)


def test_body_fat_rejects_physiologically_impossible_results():
    """Pliegues absurdos dan densidades fuera de rango: mejor nada que un número inventado."""
    percent, method = calculate_body_fat(
        tricep_mm=Decimal("0.1"),
        subscapular_mm=Decimal("0.1"),
        suprailiac_mm=Decimal("0.1"),
        biceps_mm=Decimal("0.1"),
        sex="M",
        measured_at=date(2026, 1, 1),
    )
    assert (percent, method) == (None, None)


def test_siri_matches_the_published_conversion():
    assert round(siri_body_fat(1.070), 1) == 12.6


def test_body_fat_is_a_plausible_value_for_a_typical_player():
    percent, _ = calculate_body_fat(
        **FOLDS, date_of_birth=date(2004, 5, 10), sex="M", measured_at=date(2026, 7, 1)
    )
    assert Decimal("8") < percent < Decimal("20")
