"""
Testes do contest_engine — Sprint 13.
"""
import pytest
from engines.contest_engine import (
    can_override,
    compute_contested_summary,
    count_contested,
    pending_confirmation_count,
    resolution_summary,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

ATHLETES = {
    "a1": {"id": "a1", "nome": "Ana"},
    "a2": {"id": "a2", "nome": "Bruno"},
    "a3": {"id": "a3", "nome": "Carlos"},
    "a4": {"id": "a4", "nome": "Dani"},
}
GROUP = ["a1", "a2", "a3", "a4"]
SCORES = {"a1": {"sets": [3,3,3], "total": 9}, "a2": {"sets": [1,1,1], "total": 3},
          "a3": {"sets": [3,1,3], "total": 7}, "a4": {"sets": [1,3,1], "total": 5}}


def _result(rid, status, confirmations=None, group=None):
    return {
        "id": rid, "round_id": "r1", "season_id": "s1",
        "cat": "B", "group_idx": 0,
        "group": group or GROUP,
        "status": status,
        "scores": SCORES,
        "confirmations": confirmations or {},
    }


# ---------------------------------------------------------------------------
# count_contested
# ---------------------------------------------------------------------------

def test_count_contested_empty():
    assert count_contested([]) == 0

def test_count_contested_none():
    results = [_result("r1", "confirmed"), _result("r2", "pending")]
    assert count_contested(results) == 0

def test_count_contested_one():
    results = [_result("r1", "contested"), _result("r2", "confirmed")]
    assert count_contested(results) == 1

def test_count_contested_multiple():
    results = [_result(f"r{i}", "contested") for i in range(3)]
    assert count_contested(results) == 3


# ---------------------------------------------------------------------------
# can_override
# ---------------------------------------------------------------------------

def test_can_override_contested():
    assert can_override(_result("r1", "contested")) is True

def test_can_override_pending_confirmation():
    assert can_override(_result("r1", "pending_confirmation")) is True

def test_can_override_pending():
    assert can_override(_result("r1", "pending")) is True

def test_cannot_override_confirmed():
    assert can_override(_result("r1", "confirmed")) is False


# ---------------------------------------------------------------------------
# compute_contested_summary
# ---------------------------------------------------------------------------

def test_contested_summary_empty():
    assert compute_contested_summary([], ATHLETES) == []

def test_contested_summary_filters_non_contested():
    results = [_result("r1", "confirmed"), _result("r2", "pending")]
    assert compute_contested_summary(results, ATHLETES) == []

def test_contested_summary_returns_details():
    conf = {"a1": "confirmed", "a2": "contested", "a3": "confirmed", "a4": "confirmed"}
    result = _result("r1", "contested", confirmations=conf)
    summaries = compute_contested_summary([result], ATHLETES)
    assert len(summaries) == 1
    s = summaries[0]
    assert s["result_id"] == "r1"
    assert s["cat"] == "B"
    assert len(s["group"]) == 4
    assert "Bruno" in s["contesters"]
    assert len(s["contesters"]) == 1

def test_contested_summary_names_populated():
    result = _result("r1", "contested", confirmations={"a1": "contested"})
    summaries = compute_contested_summary([result], ATHLETES)
    names = [m["nome"] for m in summaries[0]["group"]]
    assert "Ana" in names

def test_contested_summary_unknown_athlete_falls_back():
    result = _result("r1", "contested", group=["a1", "unknown"])
    result["scores"] = {}
    summaries = compute_contested_summary([result], ATHLETES)
    names = [m["nome"] for m in summaries[0]["group"]]
    assert "unknown" in names

def test_contested_summary_multiple_contesters():
    conf = {"a1": "contested", "a2": "contested", "a3": "confirmed", "a4": "confirmed"}
    result = _result("r1", "contested", confirmations=conf)
    s = compute_contested_summary([result], ATHLETES)[0]
    assert len(s["contesters"]) == 2


# ---------------------------------------------------------------------------
# pending_confirmation_count
# ---------------------------------------------------------------------------

def test_pending_confirmation_count():
    results = [
        _result("r1", "pending_confirmation"),
        _result("r2", "confirmed"),
        _result("r3", "pending_confirmation"),
    ]
    assert pending_confirmation_count(results) == 2


# ---------------------------------------------------------------------------
# resolution_summary
# ---------------------------------------------------------------------------

def test_resolution_summary():
    conf = {"a1": "confirmed", "a2": "contested"}
    result = _result("r1", "contested", confirmations=conf)
    summary = resolution_summary(result, ATHLETES)
    assert "Ana" in summary["confirmed"]
    assert "Bruno" in summary["contested"]
    assert "Carlos" in summary["pending"]
    assert "Dani" in summary["pending"]
