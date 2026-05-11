"""
Testes do history_engine — Sprint 11.
Cobre compute_round_summary, compute_season_history e compute_athlete_match_history.
"""
import pytest
from engines.history_engine import (
    compute_athlete_match_history,
    compute_round_summary,
    compute_season_history,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _round(rid, season_id, number, groups_map, status="pending", target_date=None):
    return {
        "id": rid,
        "season_id": season_id,
        "round_number": number,
        "status": status,
        "target_date": target_date,
        "groups": groups_map,
    }


def _result(rid, round_id, season_id, cat, group_idx, group, scores_map, status="confirmed"):
    return {
        "id": rid,
        "round_id": round_id,
        "season_id": season_id,
        "cat": cat,
        "group_idx": group_idx,
        "group": group,
        "status": status,
        "scores": {
            aid: {"sets": pts_list, "total": sum(pts_list)}
            for aid, pts_list in scores_map.items()
        },
    }


ATHLETES = {
    "a1": {"id": "a1", "nome": "Ana"},
    "a2": {"id": "a2", "nome": "Bruno"},
    "a3": {"id": "a3", "nome": "Carlos"},
    "a4": {"id": "a4", "nome": "Dani"},
}

GROUP_B = ["a1", "a2", "a3", "a4"]


# ---------------------------------------------------------------------------
# compute_round_summary
# ---------------------------------------------------------------------------

def test_round_summary_no_results():
    rnd = _round("r1", "s1", 1, {"B": [GROUP_B]})
    summary = compute_round_summary(rnd, [], ATHLETES)
    assert summary["round_id"] == "r1"
    assert summary["round_number"] == 1
    assert len(summary["groups"]) == 1
    grp = summary["groups"][0]
    assert grp["cat"] == "B"
    assert grp["has_result"] is False
    assert grp["result_status"] is None
    assert len(grp["athletes"]) == 4


def test_round_summary_with_result():
    rnd = _round("r1", "s1", 1, {"B": [GROUP_B]})
    res = _result("res1", "r1", "s1", "B", 0, GROUP_B, {"a1":[3,3,3],"a2":[1,1,1],"a3":[3,1,3],"a4":[1,3,1]})
    summary = compute_round_summary(rnd, [res], ATHLETES)
    grp = summary["groups"][0]
    assert grp["has_result"] is True
    assert grp["result_status"] == "confirmed"
    # Sorted by total desc: a1=9, a3=7, a4=5, a2=3
    assert grp["athletes"][0]["athlete_id"] == "a1"
    assert grp["athletes"][0]["total"] == 9


def test_round_summary_athlete_names_populated():
    rnd = _round("r1", "s1", 1, {"B": [GROUP_B]})
    summary = compute_round_summary(rnd, [], ATHLETES)
    names = [a["nome"] for a in summary["groups"][0]["athletes"]]
    assert "Ana" in names
    assert "Bruno" in names


def test_round_summary_unknown_athlete():
    rnd = _round("r1", "s1", 1, {"B": [["a1","unknown"]]})
    summary = compute_round_summary(rnd, [], ATHLETES)
    names = [a["nome"] for a in summary["groups"][0]["athletes"]]
    assert "unknown" in names  # Falls back to athlete_id


def test_round_summary_multiple_categories():
    rnd = _round("r1", "s1", 1, {"A": [["a1","a2"]], "B": [["a3","a4"]]})
    summary = compute_round_summary(rnd, [], ATHLETES)
    cats = [g["cat"] for g in summary["groups"]]
    assert "A" in cats
    assert "B" in cats


def test_round_summary_metadata():
    rnd = _round("r1", "s1", 3, {"B": [GROUP_B]}, status="closed", target_date="2026-05-10")
    summary = compute_round_summary(rnd, [], ATHLETES)
    assert summary["season_id"] == "s1"
    assert summary["status"] == "closed"
    assert summary["target_date"] == "2026-05-10"
    assert summary["round_number"] == 3


def test_round_summary_wrong_round_id_not_included():
    rnd = _round("r1", "s1", 1, {"B": [GROUP_B]})
    res = _result("res1", "r2", "s1", "B", 0, GROUP_B, {"a1":[3,3,3],"a2":[1,1,1],"a3":[3,1,3],"a4":[1,3,1]})
    summary = compute_round_summary(rnd, [res], ATHLETES)
    assert summary["groups"][0]["has_result"] is False


# ---------------------------------------------------------------------------
# compute_season_history
# ---------------------------------------------------------------------------

def test_season_history_empty():
    assert compute_season_history([], [], ATHLETES) == []


def test_season_history_filtered_by_season():
    r1 = _round("r1", "s1", 1, {"B": [GROUP_B]})
    r2 = _round("r2", "s2", 1, {"B": [GROUP_B]})
    history = compute_season_history([r1, r2], [], ATHLETES, season_id="s1")
    assert len(history) == 1
    assert history[0]["season_id"] == "s1"


def test_season_history_sorted_by_round_number():
    r3 = _round("r3", "s1", 3, {"B": [GROUP_B]})
    r1 = _round("r1", "s1", 1, {"B": [GROUP_B]})
    r2 = _round("r2", "s1", 2, {"B": [GROUP_B]})
    history = compute_season_history([r3, r1, r2], [], ATHLETES, season_id="s1")
    numbers = [h["round_number"] for h in history]
    assert numbers == [1, 2, 3]


def test_season_history_no_filter_includes_all():
    r1 = _round("r1", "s1", 1, {"B": [GROUP_B]})
    r2 = _round("r2", "s2", 1, {"B": [GROUP_B]})
    history = compute_season_history([r1, r2], [], ATHLETES)
    assert len(history) == 2


# ---------------------------------------------------------------------------
# compute_athlete_match_history
# ---------------------------------------------------------------------------

def test_match_history_empty():
    assert compute_athlete_match_history("a1", [], [], ATHLETES) == []


def test_match_history_not_in_result():
    rnd = _round("r1", "s1", 1, {})
    res = _result("res1", "r1", "s1", "B", 0, ["a2","a3","a4","x"], {"a2":[3,3,3],"a3":[1,1,1],"a4":[1,3,1],"x":[3,1,3]})
    history = compute_athlete_match_history("a1", [rnd], [res], ATHLETES)
    assert history == []


def test_match_history_one_result():
    rnd = _round("r1", "s1", 1, {})
    res = _result("res1", "r1", "s1", "B", 0, GROUP_B,
                  {"a1":[3,3,3],"a2":[1,1,1],"a3":[3,1,3],"a4":[1,3,1]})
    history = compute_athlete_match_history("a1", [rnd], [res], ATHLETES)
    assert len(history) == 1
    entry = history[0]
    assert entry["my_total"] == 9
    assert entry["my_sets"] == [3, 3, 3]
    assert entry["cat"] == "B"
    assert entry["season_id"] == "s1"


def test_match_history_rank_in_group():
    rnd = _round("r1", "s1", 1, {})
    # a1=9pts (1st), a2=3pts (4th)
    res = _result("res1", "r1", "s1", "B", 0, GROUP_B,
                  {"a1":[3,3,3],"a2":[1,1,1],"a3":[3,1,3],"a4":[1,3,1]})
    h_a1 = compute_athlete_match_history("a1", [rnd], [res], ATHLETES)
    h_a2 = compute_athlete_match_history("a2", [rnd], [res], ATHLETES)
    assert h_a1[0]["rank_in_group"] == 1
    assert h_a2[0]["rank_in_group"] == 4


def test_match_history_group_members_excludes_self():
    rnd = _round("r1", "s1", 1, {})
    res = _result("res1", "r1", "s1", "B", 0, GROUP_B,
                  {"a1":[3,3,3],"a2":[1,1,1],"a3":[3,1,3],"a4":[1,3,1]})
    history = compute_athlete_match_history("a1", [rnd], [res], ATHLETES)
    member_ids = [m["athlete_id"] for m in history[0]["group_members"]]
    assert "a1" not in member_ids
    assert len(member_ids) == 3


def test_match_history_sorted_by_round_number():
    r1 = _round("r1", "s1", 1, {})
    r2 = _round("r2", "s1", 2, {})
    res1 = _result("res1", "r2", "s1", "B", 0, GROUP_B, {"a1":[3,3,3],"a2":[1,1,1],"a3":[3,1,3],"a4":[1,3,1]})
    res2 = _result("res2", "r1", "s1", "B", 0, GROUP_B, {"a1":[1,1,1],"a2":[3,3,3],"a3":[1,3,1],"a4":[3,1,3]})
    history = compute_athlete_match_history("a1", [r1, r2], [res1, res2], ATHLETES)
    round_numbers = [h["round_number"] for h in history]
    assert round_numbers == sorted(round_numbers)


def test_match_history_pending_result_included():
    rnd = _round("r1", "s1", 1, {})
    res = _result("res1", "r1", "s1", "B", 0, GROUP_B,
                  {"a1":[3,3,3],"a2":[1,1,1],"a3":[3,1,3],"a4":[1,3,1]}, status="pending")
    history = compute_athlete_match_history("a1", [rnd], [res], ATHLETES)
    assert len(history) == 1
    assert history[0]["result_status"] == "pending"
