"""
Testes do annual_engine — Sprint 8.
Cobre Art. 21 (weighted_score + Super Rei), Art. 22 (Super Pato),
Art. 23 (Pato por categoria) e elegibilidade (≥ 2 temporadas).
"""
import pytest
from engines.annual_engine import (
    CATEGORY_WEIGHTS,
    compute_annual_ranking,
    compute_pato_anual_by_category,
    compute_super_pato,
    compute_super_rei,
    compute_titles,
    eligible_athletes,
    weighted_score,
)

# ---------------------------------------------------------------------------
# Fixtures helpers
# ---------------------------------------------------------------------------

ATHLETES = [
    {"id": "a1", "nome": "Ana",    "category": "A", "status": "ativo"},
    {"id": "a2", "nome": "Bruno",  "category": "B", "status": "ativo"},
    {"id": "a3", "nome": "Carlos", "category": "C", "status": "ativo"},
    {"id": "a4", "nome": "Dani",   "category": "D", "status": "ativo"},
]

def _season(sid, year, status, cat_setup):
    return {
        "id": sid,
        "name": f"T{sid}",
        "year": year,
        "status": status,
        "category_setup": {
            cat: {"titular_ids": list(ids), "reserva_ids": []}
            for cat, ids in cat_setup.items()
        },
    }

def _result(rid, season_id, cat, group, scores_map, status="confirmed"):
    return {
        "id": rid,
        "season_id": season_id,
        "cat": cat,
        "status": status,
        "group": group,
        "sets": [],
        "scores": {
            aid: {"sets": [], "total": pts}
            for aid, pts in scores_map.items()
        },
    }


# ---------------------------------------------------------------------------
# Art. 21.1 — weighted_score
# ---------------------------------------------------------------------------

def test_weighted_score_single_season_cat_a():
    assert weighted_score([{"category": "A", "points": 10}]) == pytest.approx(10.0)

def test_weighted_score_single_season_cat_b():
    assert weighted_score([{"category": "B", "points": 10}]) == pytest.approx(7.0)

def test_weighted_score_two_seasons():
    seasons = [
        {"category": "A", "points": 10},  # 10 * 1.0 = 10
        {"category": "B", "points": 10},  # 10 * 0.7 = 7
    ]
    assert weighted_score(seasons) == pytest.approx(8.5)  # (10+7)/2

def test_weighted_score_empty():
    assert weighted_score([]) == 0.0

def test_weighted_score_cat_weights():
    for cat, w in CATEGORY_WEIGHTS.items():
        assert weighted_score([{"category": cat, "points": 100}]) == pytest.approx(100 * w)

def test_weighted_score_four_seasons():
    seasons = [
        {"category": "A", "points": 20},  # 20
        {"category": "B", "points": 20},  # 14
        {"category": "C", "points": 20},  # 10
        {"category": "D", "points": 20},  # 6
    ]
    assert weighted_score(seasons) == pytest.approx(12.5)  # 50/4


# ---------------------------------------------------------------------------
# Art. 21.2 — eligible_athletes
# ---------------------------------------------------------------------------

def test_eligible_requires_two_seasons():
    seasons = [_season("s1", 2026, "closed", {"B": ["a2"]})]
    results = [_result("r1", "s1", "B", ["a2","x","y","z"], {"a2": 7})]
    elig = eligible_athletes(ATHLETES, 2026, seasons, results)
    assert not any(e["athlete_id"] == "a2" for e in elig)

def test_eligible_two_seasons_qualifies():
    seasons = [
        _season("s1", 2026, "closed", {"B": ["a2"]}),
        _season("s2", 2026, "closed", {"B": ["a2"]}),
    ]
    results = [
        _result("r1", "s1", "B", ["a2","x","y","z"], {"a2": 7}),
        _result("r2", "s2", "B", ["a2","x","y","z"], {"a2": 5}),
    ]
    elig = eligible_athletes(ATHLETES, 2026, seasons, results)
    assert any(e["athlete_id"] == "a2" for e in elig)

def test_eligible_ignores_wrong_year():
    seasons = [
        _season("s1", 2025, "closed", {"B": ["a2"]}),
        _season("s2", 2025, "closed", {"B": ["a2"]}),
    ]
    results = [
        _result("r1", "s1", "B", ["a2","x","y","z"], {"a2": 7}),
        _result("r2", "s2", "B", ["a2","x","y","z"], {"a2": 5}),
    ]
    assert eligible_athletes(ATHLETES, 2026, seasons, results) == []

def test_eligible_ignores_pending_season():
    seasons = [
        _season("s1", 2026, "closed",  {"B": ["a2"]}),
        _season("s2", 2026, "pending", {"B": ["a2"]}),
    ]
    results = [
        _result("r1", "s1", "B", ["a2","x","y","z"], {"a2": 7}),
        _result("r2", "s2", "B", ["a2","x","y","z"], {"a2": 5}),
    ]
    elig = eligible_athletes(ATHLETES, 2026, seasons, results)
    assert not any(e["athlete_id"] == "a2" for e in elig)

def test_eligible_requires_result_in_season():
    seasons = [
        _season("s1", 2026, "closed", {"B": ["a2"]}),
        _season("s2", 2026, "closed", {"B": ["a2"]}),
    ]
    results = [_result("r1", "s1", "B", ["a2","x","y","z"], {"a2": 7})]
    elig = eligible_athletes(ATHLETES, 2026, seasons, results)
    assert not any(e["athlete_id"] == "a2" for e in elig)

def test_eligible_not_in_titular_ids_doesnt_count():
    seasons = [
        _season("s1", 2026, "closed", {"B": ["a2"]}),
        _season("s2", 2026, "closed", {"B": []}),  # a2 ausente do setup
    ]
    results = [
        _result("r1", "s1", "B", ["a2","x","y","z"], {"a2": 7}),
        _result("r2", "s2", "B", ["a2","x","y","z"], {"a2": 5}),
    ]
    elig = eligible_athletes(ATHLETES, 2026, seasons, results)
    assert not any(e["athlete_id"] == "a2" for e in elig)

def test_eligible_weighted_score_populated():
    seasons = [
        _season("s1", 2026, "closed", {"B": ["a2"]}),
        _season("s2", 2026, "closed", {"B": ["a2"]}),
    ]
    results = [
        _result("r1", "s1", "B", ["a2","x","y","z"], {"a2": 10}),
        _result("r2", "s2", "B", ["a2","x","y","z"], {"a2": 10}),
    ]
    elig = eligible_athletes(ATHLETES, 2026, seasons, results)
    entry = next(e for e in elig if e["athlete_id"] == "a2")
    # 10pts × 0.7 / 1 season = 7.0 per season; avg over 2 = 7.0
    assert entry["weighted_score"] == pytest.approx(7.0)


# ---------------------------------------------------------------------------
# Art. 21.3 + Art. 22 — Super Rei / Super Pato
# ---------------------------------------------------------------------------

def _full_setup():
    seasons = [
        _season("s1", 2026, "closed", {"A":["a1"],"B":["a2"],"C":["a3"],"D":["a4"]}),
        _season("s2", 2026, "closed", {"A":["a1"],"B":["a2"],"C":["a3"],"D":["a4"]}),
    ]
    results = [
        _result("r1a","s1","A",["a1","x","y","z"],{"a1":9}),
        _result("r1b","s1","B",["a2","x","y","z"],{"a2":9}),
        _result("r1c","s1","C",["a3","x","y","z"],{"a3":9}),
        _result("r1d","s1","D",["a4","x","y","z"],{"a4":9}),
        _result("r2a","s2","A",["a1","x","y","z"],{"a1":9}),
        _result("r2b","s2","B",["a2","x","y","z"],{"a2":9}),
        _result("r2c","s2","C",["a3","x","y","z"],{"a3":9}),
        _result("r2d","s2","D",["a4","x","y","z"],{"a4":9}),
    ]
    return seasons, results

def test_super_rei_highest_weighted_score():
    seasons, results = _full_setup()
    rei = compute_super_rei(ATHLETES, 2026, seasons, results)
    assert rei["athlete_id"] == "a1"  # Cat A peso 1.0

def test_super_pato_lowest_weighted_score():
    seasons, results = _full_setup()
    pato = compute_super_pato(ATHLETES, 2026, seasons, results)
    assert pato["athlete_id"] == "a4"  # Cat D peso 0.3

def test_super_rei_none_when_no_eligible():
    assert compute_super_rei(ATHLETES, 2026, [], []) is None

def test_super_pato_none_when_no_eligible():
    assert compute_super_pato(ATHLETES, 2026, [], []) is None

def test_super_rei_weighted_formula_beats_raw_points():
    """Cat B com 9pts (ws=6.3) bate Cat A com 6pts (ws=6.0)."""
    athletes = [{"id":"a1","nome":"Ana","category":"A"}, {"id":"a2","nome":"Bruno","category":"B"}]
    seasons = [
        _season("s1", 2026, "closed", {"A":["a1"],"B":["a2"]}),
        _season("s2", 2026, "closed", {"A":["a1"],"B":["a2"]}),
    ]
    results = [
        _result("r1a","s1","A",["a1","x","y","z"],{"a1":6}),
        _result("r2a","s2","A",["a1","x","y","z"],{"a1":6}),
        _result("r1b","s1","B",["a2","x","y","z"],{"a2":9}),
        _result("r2b","s2","B",["a2","x","y","z"],{"a2":9}),
    ]
    rei = compute_super_rei(athletes, 2026, seasons, results)
    # a2: 9*0.7=6.3 > a1: 6*1.0=6.0
    assert rei["athlete_id"] == "a2"


# ---------------------------------------------------------------------------
# Art. 23 — Pato Anual por Categoria
# ---------------------------------------------------------------------------

def test_pato_por_categoria_each_cat():
    seasons, results = _full_setup()
    patos = compute_pato_anual_by_category(ATHLETES, 2026, seasons, results)
    assert patos["A"]["athlete_id"] == "a1"
    assert patos["B"]["athlete_id"] == "a2"
    assert patos["C"]["athlete_id"] == "a3"
    assert patos["D"]["athlete_id"] == "a4"

def test_pato_por_categoria_none_when_empty():
    patos = compute_pato_anual_by_category(ATHLETES, 2026, [], [])
    assert all(v is None for v in patos.values())

def test_pato_por_categoria_lowest_in_cat():
    athletes = [
        {"id":"b1","nome":"Bruno","category":"B"},
        {"id":"b2","nome":"Bia","category":"B"},
    ]
    seasons = [
        _season("s1", 2026, "closed", {"B":["b1","b2"]}),
        _season("s2", 2026, "closed", {"B":["b1","b2"]}),
    ]
    results = [
        _result("r1","s1","B",["b1","b2","x","y"],{"b1":9,"b2":3}),
        _result("r2","s2","B",["b1","b2","x","y"],{"b1":9,"b2":3}),
    ]
    patos = compute_pato_anual_by_category(athletes, 2026, seasons, results)
    assert patos["B"]["athlete_id"] == "b2"


# ---------------------------------------------------------------------------
# compute_titles — integração
# ---------------------------------------------------------------------------

def test_compute_titles_structure():
    seasons, results = _full_setup()
    titles = compute_titles(ATHLETES, 2026, seasons, results)
    assert titles["year"] == 2026
    assert titles["super_rei"] is not None
    assert titles["super_pato"] is not None
    assert "pato_por_categoria" in titles
    assert "ranking_anual" in titles
    assert titles["eligible_count"] == 4

def test_compute_titles_ranking_ordered():
    seasons, results = _full_setup()
    titles = compute_titles(ATHLETES, 2026, seasons, results)
    scores = [e["weighted_score"] for e in titles["ranking_anual"]]
    assert scores == sorted(scores, reverse=True)

def test_compute_titles_no_eligible():
    titles = compute_titles(ATHLETES, 2026, [], [])
    assert titles["super_rei"] is None
    assert titles["super_pato"] is None
    assert titles["eligible_count"] == 0

def test_compute_titles_super_rei_not_same_as_pato_when_multiple():
    """Com múltiplos atletas elegíveis, Super Rei ≠ Super Pato."""
    seasons, results = _full_setup()
    titles = compute_titles(ATHLETES, 2026, seasons, results)
    if titles["eligible_count"] > 1:
        assert titles["super_rei"]["athlete_id"] != titles["super_pato"]["athlete_id"]
