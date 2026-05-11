"""
Testes do stats_engine — Sprint 10.
Cobre compute_dashboard_stats, pending_athletes e athlete_needs_attention.
"""
import pytest
from engines.stats_engine import (
    athlete_needs_attention,
    compute_dashboard_stats,
    pending_athletes,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _athlete(aid, status="ativo", confirmed=True):
    return {"id": aid, "nome": f"A{aid}", "status": status, "admin_confirmed": confirmed}

def _season(sid, status):
    return {"id": sid, "name": f"T{sid}", "status": status}

def _result(rid, status):
    return {"id": rid, "status": status}

def _round(rid, status):
    return {"id": rid, "status": status}


# ---------------------------------------------------------------------------
# compute_dashboard_stats — empty inputs
# ---------------------------------------------------------------------------

def test_stats_all_empty():
    s = compute_dashboard_stats([], [], [], [])
    assert s["total_athletes"] == 0
    assert s["active_athletes"] == 0
    assert s["pending_registration"] == 0
    assert s["total_seasons"] == 0
    assert s["active_season_id"] is None
    assert s["total_results"] == 0
    assert s["total_rounds"] == 0


# ---------------------------------------------------------------------------
# Athletes
# ---------------------------------------------------------------------------

def test_stats_total_athletes():
    athletes = [_athlete("a1"), _athlete("a2"), _athlete("a3")]
    s = compute_dashboard_stats(athletes, [], [], [])
    assert s["total_athletes"] == 3

def test_stats_active_athletes():
    athletes = [_athlete("a1", "ativo"), _athlete("a2", "inativo"), _athlete("a3", "ativo")]
    s = compute_dashboard_stats(athletes, [], [], [])
    assert s["active_athletes"] == 2

def test_stats_pending_registration():
    athletes = [_athlete("a1", confirmed=True), _athlete("a2", confirmed=False), _athlete("a3", confirmed=False)]
    s = compute_dashboard_stats(athletes, [], [], [])
    assert s["pending_registration"] == 2

def test_stats_all_confirmed():
    athletes = [_athlete("a1"), _athlete("a2")]
    s = compute_dashboard_stats(athletes, [], [], [])
    assert s["pending_registration"] == 0


# ---------------------------------------------------------------------------
# Seasons
# ---------------------------------------------------------------------------

def test_stats_seasons_by_status():
    seasons = [_season("s1", "active"), _season("s2", "closed"), _season("s3", "pending")]
    s = compute_dashboard_stats([], seasons, [], [])
    assert s["total_seasons"] == 3
    assert s["active_seasons"] == 1
    assert s["closed_seasons"] == 1

def test_stats_active_season_id():
    seasons = [_season("s1", "closed"), _season("s2", "active")]
    s = compute_dashboard_stats([], seasons, [], [])
    assert s["active_season_id"] == "s2"
    assert s["active_season_name"] == "Ts2"

def test_stats_no_active_season():
    seasons = [_season("s1", "closed")]
    s = compute_dashboard_stats([], seasons, [], [])
    assert s["active_season_id"] is None
    assert s["active_season_name"] is None

def test_stats_multiple_closed_seasons():
    seasons = [_season("s1", "closed"), _season("s2", "closed")]
    s = compute_dashboard_stats([], seasons, [], [])
    assert s["closed_seasons"] == 2
    assert s["active_seasons"] == 0


# ---------------------------------------------------------------------------
# Results
# ---------------------------------------------------------------------------

def test_stats_results():
    results = [_result("r1", "confirmed"), _result("r2", "pending"), _result("r3", "confirmed")]
    s = compute_dashboard_stats([], [], results, [])
    assert s["total_results"] == 3
    assert s["confirmed_results"] == 2
    assert s["pending_results"] == 1


# ---------------------------------------------------------------------------
# Rounds
# ---------------------------------------------------------------------------

def test_stats_rounds():
    rounds = [_round("rd1", "active"), _round("rd2", "done"), _round("rd3", "active")]
    s = compute_dashboard_stats([], [], [], rounds)
    assert s["total_rounds"] == 3
    assert s["active_rounds"] == 2


# ---------------------------------------------------------------------------
# pending_athletes
# ---------------------------------------------------------------------------

def test_pending_athletes_empty():
    assert pending_athletes([]) == []

def test_pending_athletes_all_confirmed():
    athletes = [_athlete("a1"), _athlete("a2")]
    assert pending_athletes(athletes) == []

def test_pending_athletes_filters_unconfirmed():
    a1 = _athlete("a1", confirmed=True)
    a2 = _athlete("a2", confirmed=False)
    a3 = _athlete("a3", confirmed=False)
    result = pending_athletes([a1, a2, a3])
    ids = [a["id"] for a in result]
    assert "a1" not in ids
    assert "a2" in ids
    assert "a3" in ids


# ---------------------------------------------------------------------------
# athlete_needs_attention
# ---------------------------------------------------------------------------

def test_attention_confirmed():
    assert athlete_needs_attention(_athlete("a1", confirmed=True)) is False

def test_attention_not_confirmed():
    assert athlete_needs_attention(_athlete("a1", confirmed=False)) is True

def test_attention_missing_field():
    assert athlete_needs_attention({"id": "a1"}) is True
