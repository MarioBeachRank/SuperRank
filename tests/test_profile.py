"""
Testes do profile_engine — Sprint 9.
Cobre compute_season_stats e compute_athlete_profile.
"""
import pytest
from engines.profile_engine import compute_season_stats, compute_athlete_profile


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _season(sid, year, status="closed"):
    return {"id": sid, "name": f"T{sid}", "year": year, "status": status}


def _result(rid, season_id, group, scores_map, status="confirmed"):
    return {
        "id": rid,
        "season_id": season_id,
        "status": status,
        "group": group,
        "scores": {
            aid: {"sets": pts_list, "total": sum(pts_list)}
            for aid, pts_list in scores_map.items()
        },
    }


ATHLETE = {
    "id": "a1",
    "nome": "Ana",
    "current_category": "B",
    "status": "ativo",
    "type": "titular",
    "category_history": [],
    "created_at": "2026-01-01T00:00:00",
}


# ---------------------------------------------------------------------------
# compute_season_stats
# ---------------------------------------------------------------------------

def test_season_stats_no_results():
    s = _season("s1", 2026)
    stats = compute_season_stats("a1", s, [])
    assert stats["rounds_played"] == 0
    assert stats["total_points"] == 0
    assert stats["set_wins"] == 0


def test_season_stats_confirmed_counted():
    s = _season("s1", 2026)
    r = _result("r1", "s1", ["a1","x","y","z"], {"a1": [3,3,1]})
    stats = compute_season_stats("a1", s, [r])
    assert stats["rounds_played"] == 1
    assert stats["total_points"] == 7
    assert stats["set_wins"] == 2


def test_season_stats_pending_not_counted():
    s = _season("s1", 2026)
    r = _result("r1", "s1", ["a1","x","y","z"], {"a1": [3,3,3]}, status="pending")
    stats = compute_season_stats("a1", s, [r])
    assert stats["rounds_played"] == 0


def test_season_stats_athlete_not_in_group_not_counted():
    s = _season("s1", 2026)
    r = _result("r1", "s1", ["x","y","z","w"], {"x": [3,3,3]})
    stats = compute_season_stats("a1", s, [r])
    assert stats["rounds_played"] == 0


def test_season_stats_wo_zero_points():
    s = _season("s1", 2026)
    r = _result("r1", "s1", ["a1","x","y","z"], {"a1": [0,0,0]})
    stats = compute_season_stats("a1", s, [r])
    assert stats["rounds_played"] == 1
    assert stats["total_points"] == 0
    assert stats["set_wins"] == 0


def test_season_stats_multiple_rounds():
    s = _season("s1", 2026)
    r1 = _result("r1", "s1", ["a1","x","y","z"], {"a1": [3,1,3]})
    r2 = _result("r2", "s1", ["a1","x","y","z"], {"a1": [3,3,3]})
    stats = compute_season_stats("a1", s, [r1, r2])
    assert stats["rounds_played"] == 2
    assert stats["total_points"] == 16      # 7 + 9
    assert stats["set_wins"] == 5           # 2 + 3


def test_season_stats_metadata():
    s = _season("s1", 2026, "active")
    stats = compute_season_stats("a1", s, [])
    assert stats["season_id"] == "s1"
    assert stats["season_name"] == "Ts1"
    assert stats["year"] == 2026
    assert stats["status"] == "active"


def test_season_stats_wrong_season_not_counted():
    s1 = _season("s1", 2026)
    r = _result("r1", "s2", ["a1","x","y","z"], {"a1": [3,3,3]})  # different season
    stats = compute_season_stats("a1", s1, [r])
    assert stats["rounds_played"] == 0


# ---------------------------------------------------------------------------
# compute_athlete_profile
# ---------------------------------------------------------------------------

def test_profile_no_seasons():
    profile = compute_athlete_profile(ATHLETE, [], [])
    assert profile["stats"]["total_rounds"] == 0
    assert profile["stats"]["total_points"] == 0
    assert profile["season_summaries"] == []


def test_profile_basic_fields():
    profile = compute_athlete_profile(ATHLETE, [], [])
    assert profile["athlete_id"] == "a1"
    assert profile["nome"] == "Ana"
    assert profile["current_category"] == "B"
    assert profile["status"] == "ativo"


def test_profile_season_with_no_activity_excluded():
    s = _season("s1", 2026)
    # No results → athlete has 0 rounds → should not appear in summaries
    profile = compute_athlete_profile(ATHLETE, [s], [])
    assert profile["stats"]["seasons_with_activity"] == 0
    assert profile["season_summaries"] == []


def test_profile_single_season():
    s = _season("s1", 2026)
    r = _result("r1", "s1", ["a1","x","y","z"], {"a1": [3,1,3]})
    profile = compute_athlete_profile(ATHLETE, [s], [r])
    assert profile["stats"]["seasons_with_activity"] == 1
    assert profile["stats"]["total_rounds"] == 1
    assert profile["stats"]["total_points"] == 7
    assert profile["stats"]["total_set_wins"] == 2


def test_profile_multiple_seasons_aggregated():
    s1 = _season("s1", 2026)
    s2 = _season("s2", 2026)
    r1 = _result("r1", "s1", ["a1","x","y","z"], {"a1": [3,3,3]})
    r2 = _result("r2", "s2", ["a1","x","y","z"], {"a1": [1,1,1]})
    profile = compute_athlete_profile(ATHLETE, [s1, s2], [r1, r2])
    assert profile["stats"]["total_rounds"] == 2
    assert profile["stats"]["total_points"] == 12   # 9 + 3
    assert profile["stats"]["total_set_wins"] == 3  # 3 + 0
    assert profile["stats"]["seasons_with_activity"] == 2


def test_profile_seasons_sorted_by_year():
    s1 = _season("s1", 2025)
    s2 = _season("s2", 2026)
    r1 = _result("r1", "s1", ["a1","x","y","z"], {"a1": [3,3,3]})
    r2 = _result("r2", "s2", ["a1","x","y","z"], {"a1": [3,3,3]})
    profile = compute_athlete_profile(ATHLETE, [s2, s1], [r1, r2])  # order reversed
    years = [s["year"] for s in profile["season_summaries"]]
    assert years == sorted(years)


def test_profile_category_history_preserved():
    athlete = {**ATHLETE, "category_history": [{"season_id": "s0", "from": "C", "to": "B"}]}
    profile = compute_athlete_profile(athlete, [], [])
    assert len(profile["category_history"]) == 1
    assert profile["category_history"][0]["from"] == "C"


def test_profile_current_category_fallback():
    athlete = {**ATHLETE, "current_category": None, "category": "C"}
    profile = compute_athlete_profile(athlete, [], [])
    assert profile["current_category"] == "C"
