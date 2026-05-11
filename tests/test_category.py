"""
Testes do category_engine — Sprint 7.
Cobre Art. 16 (movement_count), Art. 17 (compute_movements + apply atomically),
Art. 18 (tie-break na zona de corte) e Art. 19 (fusão < 4 atletas).
"""
import pytest
from engines.category_engine import (
    apply_movements_atomic,
    check_fusion_needed,
    compute_movements,
    movement_count,
    movement_summary,
    resolve_boundary_tie,
)


# ---------------------------------------------------------------------------
# Art. 16 — movement_count
# ---------------------------------------------------------------------------

def test_movement_count_min():
    assert movement_count(4) == 1

def test_movement_count_mid():
    assert movement_count(7) == 1

def test_movement_count_eight():
    assert movement_count(8) == 2

def test_movement_count_large():
    assert movement_count(16) == 2


# ---------------------------------------------------------------------------
# Art. 18 — resolve_boundary_tie
# ---------------------------------------------------------------------------

def test_boundary_tie_selects_correct_count():
    selected, excluded = resolve_boundary_tie(["a1","a2","a3"], needed=1, seed=0)
    assert len(selected) == 1
    assert len(excluded) == 2
    assert set(selected) | set(excluded) == {"a1","a2","a3"}

def test_boundary_tie_deterministic_with_seed():
    s1, _ = resolve_boundary_tie(["a1","a2","a3"], needed=2, seed=42)
    s2, _ = resolve_boundary_tie(["a1","a2","a3"], needed=2, seed=42)
    assert s1 == s2

def test_boundary_tie_different_seeds():
    results = set()
    for seed in range(20):
        s, _ = resolve_boundary_tie(["a1","a2"], needed=1, seed=seed)
        results.add(s[0])
    # Com seeds variados, ambos devem aparecer às vezes
    assert len(results) == 2


# ---------------------------------------------------------------------------
# Art. 17 — compute_movements básico
# ---------------------------------------------------------------------------

def _rank(aids):
    """Cria lista de ranking simples com pontos decrescentes."""
    return [{"athlete_id": a, "rank": i+1, "points": 10 - i} for i, a in enumerate(aids)]


def test_compute_no_promotions_for_cat_a():
    """Cat A não tem promoção (topo da hierarquia); pode ter rebaixamento se Cat B existe."""
    rankings = {
        "A": _rank(["a1","a2","a3","a4"]),
        "B": _rank(["b1","b2","b3","b4"]),
    }
    mv = compute_movements(rankings)
    assert not any(v["from"] == "A" for v in mv["promotions"].values())
    # Cat A rebaixa pior para B
    assert mv["relegations"].get("a4") == {"from": "A", "to": "B"}


def test_compute_no_relegations_for_cat_d():
    """Cat D não tem rebaixamento (base da hierarquia)."""
    rankings = {"D": _rank(["d1","d2","d3","d4"])}
    mv = compute_movements(rankings)
    assert not mv["relegations"]
    # mas pode ter promoções para Cat C
    assert "d1" in mv["promotions"]


def test_compute_movements_4_athletes_promotes_1_relegates_1():
    """4 atletas em Cat B → 1 promovido para A, 1 rebaixado para C."""
    rankings = {
        "A": _rank(["a1","a2","a3","a4"]),
        "B": _rank(["b1","b2","b3","b4"]),
        "C": _rank(["c1","c2","c3","c4"]),
    }
    mv = compute_movements(rankings)

    # B melhor sobe para A
    assert mv["promotions"].get("b1") == {"from": "B", "to": "A"}
    # B pior desce para C
    assert mv["relegations"].get("b4") == {"from": "B", "to": "C"}
    # b2, b3 ficam
    assert mv["stays"].get("b2") == "B"
    assert mv["stays"].get("b3") == "B"


def test_compute_movements_8_athletes_promotes_2():
    """8 atletas em Cat B → 2 promovidos, 2 rebaixados."""
    rankings = {
        "A": _rank(["a1","a2","a3","a4"]),
        "B": _rank([f"b{i}" for i in range(1,9)]),
        "C": _rank(["c1","c2","c3","c4"]),
    }
    mv = compute_movements(rankings)
    promoted_from_b = [a for a, v in mv["promotions"].items() if v["from"] == "B"]
    relegated_from_b = [a for a, v in mv["relegations"].items() if v["from"] == "B"]
    assert len(promoted_from_b) == 2
    assert len(relegated_from_b) == 2
    assert "b1" in promoted_from_b
    assert "b2" in promoted_from_b
    assert "b7" in relegated_from_b
    assert "b8" in relegated_from_b


def test_compute_movements_all_categories():
    """Fluxo completo A→D: promoções e rebaixamentos encadeados."""
    rankings = {
        "A": _rank(["a1","a2","a3","a4"]),
        "B": _rank(["b1","b2","b3","b4"]),
        "C": _rank(["c1","c2","c3","c4"]),
        "D": _rank(["d1","d2","d3","d4"]),
    }
    mv = compute_movements(rankings)

    # B melhor sobe para A; B pior desce para C
    assert mv["promotions"]["b1"]["to"] == "A"
    assert mv["relegations"]["b4"]["to"] == "C"
    # C melhor sobe para B; C pior desce para D
    assert mv["promotions"]["c1"]["to"] == "B"
    assert mv["relegations"]["c4"]["to"] == "D"
    # D melhor sobe para C (sem rebaixamento)
    assert mv["promotions"]["d1"]["to"] == "C"
    assert not any(v["from"] == "D" for v in mv["relegations"].values())
    # A pior desce para B (sem promoção de A)
    assert mv["relegations"]["a4"]["to"] == "B"
    assert not any(v["from"] == "A" for v in mv["promotions"].values())


def test_compute_movements_projected_sizes_unchanged():
    """Tamanhos projetados: com todos os cats, entradas e saídas se equilibram."""
    rankings = {
        "A": _rank(["a1","a2","a3","a4"]),
        "B": _rank(["b1","b2","b3","b4"]),
        "C": _rank(["c1","c2","c3","c4"]),
        "D": _rank(["d1","d2","d3","d4"]),
    }
    mv = compute_movements(rankings)
    # Cada cat: perde 1 para cima e 1 para baixo, mas recebe 1 de cada → estável
    assert mv["projected_sizes"]["A"] == 4
    assert mv["projected_sizes"]["B"] == 4
    assert mv["projected_sizes"]["C"] == 4
    assert mv["projected_sizes"]["D"] == 4


def test_compute_movements_empty_category_skipped():
    """Categorias sem atletas são ignoradas."""
    rankings = {"B": _rank(["b1","b2","b3","b4"]), "C": []}
    mv = compute_movements(rankings)
    # Sem Cat C para receber b4 rebaixado → b4 não deve ser rebaixado
    assert "b4" not in mv["relegations"]


# ---------------------------------------------------------------------------
# Art. 19 — check_fusion_needed
# ---------------------------------------------------------------------------

def test_fusion_needed_below_4():
    fusions = check_fusion_needed({"A": 4, "B": 3, "C": 4, "D": 4})
    assert ("B", "C") in fusions or ("B", "A") in fusions

def test_no_fusion_needed():
    assert check_fusion_needed({"A": 4, "B": 4, "C": 4, "D": 4}) == []

def test_fusion_cat_d_goes_up():
    """Cat D com < 4 funde com Cat C (sobe, já que D não tem abaixo)."""
    fusions = check_fusion_needed({"D": 2})
    assert fusions[0] == ("D", "C")

def test_fusion_cat_a_goes_down():
    """Cat A com < 4 funde com Cat B (desce, já que A não tem acima)."""
    fusions = check_fusion_needed({"A": 1})
    assert fusions[0] == ("A", "B")


# ---------------------------------------------------------------------------
# Art. 17 — apply_movements_atomic
# ---------------------------------------------------------------------------

def _make_season(cat_setup):
    return {
        "category_setup": {
            cat: {"titular_ids": list(ids), "reserva_ids": []}
            for cat, ids in cat_setup.items()
        }
    }


def test_apply_movements_promotes_and_relegates():
    season = _make_season({
        "A": ["a1","a2","a3","a4"],
        "B": ["b1","b2","b3","b4"],
        "C": ["c1","c2","c3","c4"],
    })
    movements = {
        "promotions":  {"b1": {"from": "B", "to": "A"}},
        "relegations": {"b4": {"from": "B", "to": "C"}},
        "stays": {},
    }
    new_setup = apply_movements_atomic(season, movements)

    assert "b1" in new_setup["A"]["titular_ids"]
    assert "b1" not in new_setup["B"]["titular_ids"]
    assert "b4" in new_setup["C"]["titular_ids"]
    assert "b4" not in new_setup["B"]["titular_ids"]
    # Others unchanged
    assert "b2" in new_setup["B"]["titular_ids"]
    assert "b3" in new_setup["B"]["titular_ids"]


def test_apply_movements_atomic_no_double_insert():
    """Atleta não aparece duas vezes na categoria de destino."""
    season = _make_season({
        "A": ["a1","a2","a3","a4"],
        "B": ["b1","b2","b3","b4"],
    })
    movements = {
        "promotions": {"b1": {"from": "B", "to": "A"}, "b2": {"from": "B", "to": "A"}},
        "relegations": {},
        "stays": {},
    }
    new_setup = apply_movements_atomic(season, movements)
    a_ids = new_setup["A"]["titular_ids"]
    assert a_ids.count("b1") == 1
    assert a_ids.count("b2") == 1


# ---------------------------------------------------------------------------
# movement_summary
# ---------------------------------------------------------------------------

def test_movement_summary_fields():
    movements = {
        "promotions": {"b1": {"from": "B", "to": "A"}},
        "relegations": {"b4": {"from": "B", "to": "C"}},
        "stays": {"b2": "B"},
    }
    names = {"b1": "Bruno", "b4": "Dani", "b2": "Carlos"}
    summary = movement_summary(movements, names)
    actions = {e["athlete_id"]: e["action"] for e in summary}
    assert actions["b1"] == "promoted"
    assert actions["b4"] == "relegated"
    assert actions["b2"] == "stays"
    assert next(e for e in summary if e["athlete_id"] == "b1")["nome"] == "Bruno"
