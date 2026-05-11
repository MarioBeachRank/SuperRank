"""
Testes do report_engine — Sprint 12.
Cobre compute_season_report e compute_search_results.
"""
import pytest
from engines.report_engine import compute_season_report, compute_search_results


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _season(sid, cat_setup=None):
    return {
        "id": sid,
        "name": f"T{sid}",
        "category_setup": cat_setup or {},
    }


def _round(rid, season_id, number):
    return {"id": rid, "season_id": season_id, "round_number": number}


def _result(rid, round_id, season_id, cat, group, scores_map, status="confirmed"):
    return {
        "id": rid,
        "round_id": round_id,
        "season_id": season_id,
        "cat": cat,
        "group": group,
        "status": status,
        "scores": {
            aid: {"sets": pts, "total": sum(pts)}
            for aid, pts in scores_map.items()
        },
    }


ATHLETES = {
    "a1": {"id": "a1", "nome": "Ana"},
    "a2": {"id": "a2", "nome": "Bruno"},
    "a3": {"id": "a3", "nome": "Carlos"},
    "a4": {"id": "a4", "nome": "Dani"},
}

GROUP = ["a1", "a2", "a3", "a4"]
SCORES = {"a1": [3, 3, 3], "a2": [1, 1, 1], "a3": [3, 1, 3], "a4": [1, 3, 1]}


# ---------------------------------------------------------------------------
# compute_season_report — empty
# ---------------------------------------------------------------------------

def test_report_empty_season():
    s = _season("s1")
    r = compute_season_report(s, [], [], {})
    assert r["total_rounds"] == 0
    assert r["total_confirmed_results"] == 0
    assert r["athletes_who_played"] == 0
    assert r["participation_rate"] == 0.0
    assert r["most_active"] is None
    assert all(v is None for v in r["top_per_cat"].values())


def test_report_total_rounds():
    s = _season("s1")
    rounds = [_round("r1", "s1", 1), _round("r2", "s1", 2)]
    r = compute_season_report(s, rounds, [], {})
    assert r["total_rounds"] == 2


def test_report_confirmed_only():
    s = _season("s1")
    rnd = _round("r1", "s1", 1)
    pending = _result("res1", "r1", "s1", "B", GROUP, SCORES, status="pending")
    r = compute_season_report(s, [rnd], [pending], ATHLETES)
    assert r["total_confirmed_results"] == 0
    assert r["athletes_who_played"] == 0


def test_report_athletes_who_played():
    s = _season("s1")
    rnd = _round("r1", "s1", 1)
    res = _result("res1", "r1", "s1", "B", GROUP, SCORES)
    r = compute_season_report(s, [rnd], [res], ATHLETES)
    assert r["athletes_who_played"] == 4


def test_report_top_per_cat():
    setup = {"B": {"titular_ids": GROUP, "reserva_ids": []}}
    s = _season("s1", cat_setup=setup)
    rnd = _round("r1", "s1", 1)
    res = _result("res1", "r1", "s1", "B", GROUP, SCORES)
    r = compute_season_report(s, [rnd], [res], ATHLETES)
    # a1 = 9pts, a3 = 7pts → a1 is top
    assert r["top_per_cat"]["B"]["athlete_id"] == "a1"
    assert r["top_per_cat"]["B"]["total_points"] == 9
    assert r["top_per_cat"]["A"] is None  # no A setup


def test_report_most_active():
    s = _season("s1")
    r1 = _round("r1", "s1", 1)
    r2 = _round("r2", "s1", 2)
    res1 = _result("res1", "r1", "s1", "B", GROUP, SCORES)
    # a1 plays round 2 too (other 3 don't)
    res2 = _result("res2", "r2", "s1", "B", ["a1", "a2", "a3", "a4"],
                   {"a1": [3, 3, 3], "a2": [1, 1, 1], "a3": [1, 1, 1], "a4": [1, 1, 1]})
    r = compute_season_report(s, [r1, r2], [res1, res2], ATHLETES)
    # All played 2 rounds — first alphabetically or by dict order isn't deterministic,
    # but most_active should exist and have 2 rounds.
    assert r["most_active"]["rounds"] == 2


def test_report_results_per_round():
    s = _season("s1")
    r1 = _round("r1", "s1", 1)
    r2 = _round("r2", "s1", 2)
    res1 = _result("res1", "r1", "s1", "B", GROUP, SCORES)
    r = compute_season_report(s, [r1, r2], [res1], ATHLETES)
    assert r["results_per_round"][1] == 1
    assert r["results_per_round"][2] == 0


def test_report_results_per_round_sorted():
    s = _season("s1")
    rounds = [_round(f"r{i}", "s1", i) for i in range(1, 5)]
    r = compute_season_report(s, rounds, [], {})
    keys = list(r["results_per_round"].keys())
    assert keys == sorted(keys)


def test_report_participation_rate():
    setup = {"B": {"titular_ids": GROUP, "reserva_ids": []}}
    s = _season("s1", cat_setup=setup)
    rnd = _round("r1", "s1", 1)
    res = _result("res1", "r1", "s1", "B", ["a1", "a2"], {"a1": [3, 3, 3], "a2": [1, 1, 1]})
    r = compute_season_report(s, [rnd], [res], ATHLETES)
    # 2 played out of 4 titulares → 50%
    assert r["participation_rate"] == 50.0


def test_report_avg_points():
    s = _season("s1")
    rnd = _round("r1", "s1", 1)
    res = _result("res1", "r1", "s1", "B", GROUP, SCORES)
    r = compute_season_report(s, [rnd], [res], ATHLETES)
    # a1=9, a2=3, a3=7, a4=5 → avg = 24/4 = 6.0
    assert r["avg_points_per_athlete"] == 6.0


def test_report_athlete_stats_sorted_by_points():
    s = _season("s1")
    rnd = _round("r1", "s1", 1)
    res = _result("res1", "r1", "s1", "B", GROUP, SCORES)
    r = compute_season_report(s, [rnd], [res], ATHLETES)
    pts = [e["total_points"] for e in r["athlete_stats"]]
    assert pts == sorted(pts, reverse=True)


def test_report_rounds_with_results():
    s = _season("s1")
    r1 = _round("r1", "s1", 1)
    r2 = _round("r2", "s1", 2)
    res = _result("res1", "r1", "s1", "B", GROUP, SCORES)
    r = compute_season_report(s, [r1, r2], [res], ATHLETES)
    assert r["rounds_with_results"] == 1


# ---------------------------------------------------------------------------
# compute_search_results
# ---------------------------------------------------------------------------

ATHLETES_LIST = [
    {"id": "a1", "nome": "Ana Lima", "current_category": "B", "status": "ativo"},
    {"id": "a2", "nome": "Bruno Souza", "current_category": "A", "status": "ativo"},
    {"id": "a3", "nome": "Carlos Lima", "current_category": "C", "status": "inativo"},
]
SEASONS_LIST = [
    {"id": "s1", "name": "Temporada 2026/1", "status": "active", "year": 2026},
    {"id": "s2", "name": "Temporada 2025/2", "status": "closed", "year": 2025},
]


def test_search_short_query():
    r = compute_search_results("a", ATHLETES_LIST, SEASONS_LIST)
    assert r["athletes"] == []
    assert r["seasons"] == []


def test_search_empty_query():
    r = compute_search_results("", ATHLETES_LIST, SEASONS_LIST)
    assert r["athletes"] == []


def test_search_athlete_by_name():
    r = compute_search_results("ana", ATHLETES_LIST, SEASONS_LIST)
    assert len(r["athletes"]) == 1
    assert r["athletes"][0]["id"] == "a1"


def test_search_case_insensitive():
    r = compute_search_results("BRUNO", ATHLETES_LIST, SEASONS_LIST)
    assert any(a["id"] == "a2" for a in r["athletes"])


def test_search_partial_match():
    r = compute_search_results("lima", ATHLETES_LIST, SEASONS_LIST)
    assert len(r["athletes"]) == 2


def test_search_season_by_name():
    r = compute_search_results("2026", ATHLETES_LIST, SEASONS_LIST)
    assert len(r["seasons"]) == 1
    assert r["seasons"][0]["id"] == "s1"


def test_search_no_match():
    r = compute_search_results("xyz", ATHLETES_LIST, SEASONS_LIST)
    assert r["athletes"] == []
    assert r["seasons"] == []


def test_search_returns_query():
    r = compute_search_results("ana", ATHLETES_LIST, SEASONS_LIST)
    assert r["query"] == "ana"


def test_search_safe_fields_only():
    r = compute_search_results("ana", ATHLETES_LIST, SEASONS_LIST)
    for a in r["athletes"]:
        assert "pin_hash" not in a
