"""Máquina de estados del timer del partido."""
from datetime import datetime, timedelta, timezone

from app.ws.manager import InMemoryTimer


def timer(**kwargs) -> InMemoryTimer:
    return InMemoryTimer(session_id="s1", **kwargs)


def test_starts_from_stopped():
    t = timer()
    assert t.apply("start") is True
    assert (t.status, t.current_half, t.base_elapsed) == ("running", 1, 0)


def test_cannot_start_twice():
    t = timer()
    t.apply("start")
    assert t.apply("start") is False


def test_pause_freezes_elapsed_time():
    t = timer(status="running", base_elapsed=100)
    t.started_at = datetime.now(timezone.utc) - timedelta(seconds=5)
    assert t.apply("pause") is True
    assert t.status == "paused"
    assert t.base_elapsed >= 105
    assert t.started_at is None


def test_resume_only_from_paused():
    assert timer(status="paused").apply("resume") is True
    assert timer(status="running").apply("resume") is False
    assert timer(status="stopped").apply("resume") is False


def test_halftime_resets_the_clock_for_the_second_half():
    t = timer(status="running", base_elapsed=2400)
    t.started_at = datetime.now(timezone.utc)
    assert t.apply("halftime") is True
    assert t.status == "halftime"

    assert t.apply("start") is True
    assert (t.status, t.current_half, t.base_elapsed) == ("running", 2, 0)


def test_halftime_is_only_valid_in_the_first_half():
    t = timer(status="running", current_half=2)
    assert t.apply("halftime") is False


def test_finish_from_any_live_state_but_not_from_stopped():
    assert timer(status="running").apply("finish") is True
    assert timer(status="paused").apply("finish") is True
    assert timer(status="halftime").apply("finish") is True
    assert timer(status="stopped").apply("finish") is False
    assert timer(status="finished").apply("finish") is False


def test_reset_returns_to_the_initial_state():
    t = timer(status="finished", base_elapsed=2400, current_half=2)
    assert t.apply("reset") is True
    assert (t.status, t.current_half, t.base_elapsed) == ("stopped", 1, 0)


def test_set_corrects_the_clock():
    t = timer(status="paused", base_elapsed=100)
    assert t.apply("set", seconds=725) is True
    assert t.base_elapsed == 725


def test_set_while_running_restarts_counting_from_the_new_value():
    t = timer(status="running", base_elapsed=10)
    t.started_at = datetime.now(timezone.utc) - timedelta(seconds=60)
    t.apply("set", seconds=300)
    assert t.base_elapsed == 300
    assert t.elapsed() < 305  # no arrastra los 60s previos


def test_set_rejects_negative_and_missing_values():
    t = timer(status="paused", base_elapsed=100)
    assert t.apply("set", seconds=-1) is False
    assert t.apply("set") is False
    assert t.base_elapsed == 100


def test_unknown_action_is_rejected():
    assert timer(status="running").apply("teletransportar") is False


def test_elapsed_interpolates_while_running():
    t = timer(status="running", base_elapsed=30)
    t.started_at = datetime.now(timezone.utc) - timedelta(seconds=12)
    assert 41 <= t.elapsed() <= 43


def test_elapsed_is_frozen_when_not_running():
    t = timer(status="paused", base_elapsed=30)
    t.started_at = datetime.now(timezone.utc) - timedelta(seconds=999)
    assert t.elapsed() == 30


def test_snapshot_carries_what_the_client_needs_to_interpolate():
    t = timer(status="running", base_elapsed=30)
    t.started_at = datetime.now(timezone.utc)
    snap = t.snapshot()
    assert set(snap) == {"session_id", "half", "status", "elapsed_seconds", "server_timestamp"}
