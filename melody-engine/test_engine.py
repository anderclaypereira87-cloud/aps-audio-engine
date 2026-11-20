import pytest
from engine import DEFAULTS, validate_settings


def test_defaults():
    assert validate_settings({}) == DEFAULTS


@pytest.mark.parametrize("value", [-1, 101, float("nan"), True, "65"])
def test_reject_invalid_correction(value):
    with pytest.raises(ValueError):
        validate_settings({"pitchCorrection": value})


def test_preserve_melody_is_boolean():
    with pytest.raises(ValueError):
        validate_settings({"preserveOriginalMelody": "yes"})


def test_explicit_preset():
    assert validate_settings({"pitchCorrection": 65, "naturalness": 85, "preserveOriginalMelody": True}) == DEFAULTS
