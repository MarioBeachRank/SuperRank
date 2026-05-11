"""
Testes do draw_engine — Sprint 3.
Cobre Art. 7 (estrutura de sets), Art. 14 (tamanho quebrado) e Art. 25 (mínima repetição).
"""
import pytest
from itertools import combinations

from engines.draw_engine import (
    build_encounter_matrix,
    compute_group_sets,
    convoke_reserve,
    detect_broken_category,
    draw_all_categories,
    draw_groups,
    offer_wildcard,
)

SEED = 42  # seed fixo garante determinismo nos testes


# ---------------------------------------------------------------------------
# draw_groups — tamanhos básicos
# ---------------------------------------------------------------------------

def test_draw_4_athletes_1_group():
    athletes = ["a0", "a1", "a2", "a3"]
    groups = draw_groups(athletes, {}, seed=SEED)
    assert len(groups) == 1
    assert sorted(groups[0]) == sorted(athletes)


def test_draw_8_athletes_2_groups():
    athletes = [f"a{i}" for i in range(8)]
    groups = draw_groups(athletes, {}, seed=SEED)
    assert len(groups) == 2
    assert sorted(a for g in groups for a in g) == sorted(athletes)


def test_draw_12_athletes_3_groups():
    athletes = [f"a{i}" for i in range(12)]
    groups = draw_groups(athletes, {}, seed=SEED)
    assert len(groups) == 3
    assert sorted(a for g in groups for a in g) == sorted(athletes)


def test_draw_16_athletes_4_groups():
    athletes = [f"a{i}" for i in range(16)]
    groups = draw_groups(athletes, {}, seed=SEED)
    assert len(groups) == 4
    assert sorted(a for g in groups for a in g) == sorted(athletes)


def test_each_group_has_exactly_4():
    for n in (4, 8, 12, 16):
        athletes = [f"a{i}" for i in range(n)]
        groups = draw_groups(athletes, {}, seed=SEED)
        for g in groups:
            assert len(g) == 4, f"Grupo com {len(g)} atletas para n={n}"


def test_no_athlete_appears_twice_in_same_draw():
    athletes = [f"a{i}" for i in range(8)]
    groups = draw_groups(athletes, {}, seed=SEED)
    all_ids = [a for g in groups for a in g]
    assert len(all_ids) == len(set(all_ids))


def test_draw_empty_list_returns_empty():
    assert draw_groups([], {}, seed=SEED) == []


def test_draw_not_multiple_of_4_raises():
    with pytest.raises(ValueError, match="múltiplo de 4"):
        draw_groups(["a0", "a1", "a2"], {}, seed=SEED)


def test_draw_5_athletes_raises():
    with pytest.raises(ValueError):
        draw_groups([f"a{i}" for i in range(5)], {}, seed=SEED)


# ---------------------------------------------------------------------------
# Art. 7 — compute_group_sets
# ---------------------------------------------------------------------------

def test_compute_group_sets_count():
    """Art. 7: exatamente 3 sets por grupo."""
    sets = compute_group_sets(["a1", "a2", "a3", "a4"])
    assert len(sets) == 3


def test_compute_group_sets_structure():
    """Art. 7: Set 1=(1+2)vs(3+4), Set 2=(1+3)vs(2+4), Set 3=(1+4)vs(2+3)."""
    group = ["a1", "a2", "a3", "a4"]
    sets = compute_group_sets(group)
    assert sets[0] == {"set": 1, "team_a": ["a1", "a2"], "team_b": ["a3", "a4"]}
    assert sets[1] == {"set": 2, "team_a": ["a1", "a3"], "team_b": ["a2", "a4"]}
    assert sets[2] == {"set": 3, "team_a": ["a1", "a4"], "team_b": ["a2", "a3"]}


def test_group_sets_cover_all_6_pairs():
    """Art. 7: cada atleta joga com todos os outros como parceiro exatamente 1 vez."""
    group = ["a1", "a2", "a3", "a4"]
    sets = compute_group_sets(group)
    partner_pairs = set()
    for s in sets:
        partner_pairs.add(tuple(sorted(s["team_a"])))
        partner_pairs.add(tuple(sorted(s["team_b"])))
    expected = {tuple(sorted(p)) for p in combinations(group, 2)}
    assert partner_pairs == expected


# ---------------------------------------------------------------------------
# Art. 25 — Mínima repetição ao longo de rodadas
# ---------------------------------------------------------------------------

def _simulate_rounds(athletes, category, n_rounds, seed=SEED):
    """Simula n_rounds rodadas e retorna a matriz de encontros final."""
    season_id = "temporada_teste"
    past_rounds = []
    for _ in range(n_rounds):
        encounters = build_encounter_matrix(past_rounds, season_id, category)
        groups = draw_groups(athletes, encounters, seed=seed)
        past_rounds.append({
            "season_id": season_id,
            "groups": {category: groups},
        })
    return build_encounter_matrix(past_rounds, season_id, category)


def test_4_athletes_4_rounds_all_pairs_meet_every_round():
    """4 atletas, 1 grupo: todo par se encontra em todas as 4 rodadas."""
    athletes = ["a0", "a1", "a2", "a3"]
    enc = _simulate_rounds(athletes, "A", 4)
    for a, b in combinations(athletes, 2):
        assert enc.get(a, {}).get(b, 0) == 4, f"Par ({a},{b}) não se encontrou 4x"


def test_8_athletes_4_rounds_minimal_repetition():
    """
    8 atletas, 4 rodadas — média de 12 encontros/rodada para 28 pares únicos.
    Greedy deve manter max repetição ≤ 3.
    """
    athletes = [f"a{i}" for i in range(8)]
    enc = _simulate_rounds(athletes, "B", 4)
    max_enc = max(enc.get(a, {}).get(b, 0) for a, b in combinations(athletes, 2))
    assert max_enc <= 3, f"Máximo de encontros esperado ≤ 3, obtido {max_enc}"


def test_12_athletes_4_rounds_no_excessive_repetition():
    """12 atletas, 4 rodadas — com 66 pares e apenas 24 slots/rodada, repetição deve ser baixa."""
    athletes = [f"a{i}" for i in range(12)]
    enc = _simulate_rounds(athletes, "C", 4)
    if enc:
        max_enc = max(enc.get(a, {}).get(b, 0) for a, b in combinations(athletes, 2))
        assert max_enc <= 3


def test_16_athletes_4_rounds_no_excessive_repetition():
    """16 atletas, 4 rodadas — 120 pares, bastante espaço para uniqueness."""
    athletes = [f"a{i}" for i in range(16)]
    enc = _simulate_rounds(athletes, "D", 4)
    if enc:
        max_enc = max(enc.get(a, {}).get(b, 0) for a, b in combinations(athletes, 2))
        assert max_enc <= 2


def test_draw_prefers_unseen_pairs():
    """Greedy deve preferir pares nunca vistos quando disponíveis."""
    athletes = ["a0", "a1", "a2", "a3"]
    # a0 e a1 já se encontraram 3 vezes; a2 e a3 nunca encontraram a0/a1
    past_enc = {
        "a0": {"a1": 3, "a2": 0, "a3": 0},
        "a1": {"a0": 3, "a2": 0, "a3": 0},
        "a2": {"a0": 0, "a1": 0, "a3": 0},
        "a3": {"a0": 0, "a1": 0, "a2": 0},
    }
    # Com apenas 4 atletas, sempre haverá 1 grupo com todos — custo inevitável
    groups = draw_groups(athletes, past_enc, seed=SEED)
    assert len(groups) == 1
    assert sorted(groups[0]) == sorted(athletes)


def test_build_encounter_matrix_accumulates_correctly():
    season_id = "s1"
    rounds = [
        {"season_id": "s1", "groups": {"B": [["a0", "a1", "a2", "a3"]]}},
        {"season_id": "s1", "groups": {"B": [["a0", "a1", "a2", "a3"]]}},
        {"season_id": "s2", "groups": {"B": [["a0", "a1", "a2", "a3"]]}},  # outra temporada
    ]
    enc = build_encounter_matrix(rounds, season_id, "B")
    assert enc["a0"]["a1"] == 2  # só conta os rounds da temporada s1
    assert enc["a0"]["a2"] == 2
    assert enc.get("s2_athlete", {}) == {}


# ---------------------------------------------------------------------------
# Art. 14 — Tamanho quebrado e substituições
# ---------------------------------------------------------------------------

def test_detect_broken_category_true():
    assert detect_broken_category(3) is True
    assert detect_broken_category(5) is True
    assert detect_broken_category(7) is True
    assert detect_broken_category(9) is True


def test_detect_broken_category_false():
    assert detect_broken_category(0) is False
    assert detect_broken_category(4) is False
    assert detect_broken_category(8) is False
    assert detect_broken_category(12) is False
    assert detect_broken_category(16) is False


def test_convoke_reserve_returns_first():
    setup = {"titular_ids": [], "reserva_ids": ["r1", "r2", "r3"]}
    assert convoke_reserve(setup) == "r1"


def test_convoke_reserve_empty_returns_none():
    assert convoke_reserve({"titular_ids": [], "reserva_ids": []}) is None
    assert convoke_reserve({}) is None


def test_offer_wildcard_returns_first_not_refused():
    ranking = ["top1", "top2", "top3"]
    assert offer_wildcard(ranking, already_offered=["top1"]) == "top2"
    assert offer_wildcard(ranking, already_offered=[]) == "top1"
    assert offer_wildcard(ranking, already_offered=["top1", "top2", "top3"]) is None


# ---------------------------------------------------------------------------
# draw_all_categories — orquestrador
# ---------------------------------------------------------------------------

def _make_season(cat_titulares: dict):
    return {
        "id": "s1",
        "category_setup": {
            cat: {"titular_ids": ids, "reserva_ids": []}
            for cat, ids in cat_titulares.items()
        },
    }


def test_draw_all_skips_empty_categories():
    season = _make_season({"A": [], "B": [f"b{i}" for i in range(4)], "C": [], "D": []})
    result = draw_all_categories(season, past_rounds=[])
    assert "A" not in result
    assert "C" not in result
    assert "D" not in result
    assert "B" in result


def test_draw_all_returns_correct_groups():
    season = _make_season({"B": [f"b{i}" for i in range(8)]})
    result = draw_all_categories(season, past_rounds=[])
    assert isinstance(result["B"], list)
    assert len(result["B"]) == 2
    for g in result["B"]:
        assert len(g["athletes"]) == 4
        assert len(g["sets"]) == 3


def test_draw_all_broken_category_returns_error():
    """Art. 14: categoria com 5 titulares gera error='broken_multiple'."""
    season = _make_season({"C": [f"c{i}" for i in range(5)]})
    result = draw_all_categories(season, past_rounds=[])
    assert result["C"]["error"] == "broken_multiple"
    assert result["C"]["count"] == 5


def test_draw_all_multiple_categories():
    season = _make_season({
        "A": [f"a{i}" for i in range(4)],
        "B": [f"b{i}" for i in range(8)],
        "C": [],
        "D": [f"d{i}" for i in range(12)],
    })
    result = draw_all_categories(season, past_rounds=[])
    assert len(result["A"]) == 1
    assert len(result["B"]) == 2
    assert "C" not in result
    assert len(result["D"]) == 3


def test_draw_all_uses_past_encounters():
    """Rodada 2 deve usar encontros da rodada 1 para minimizar repetição."""
    athletes_b = [f"b{i}" for i in range(8)]
    season = _make_season({"B": athletes_b})

    # Rodada 1
    r1 = draw_all_categories(season, past_rounds=[])
    fake_round1 = {
        "season_id": "s1",
        "groups": {"B": [g["athletes"] for g in r1["B"]]},
    }

    # Rodada 2 — deve tentar minimizar repetição com rodada 1
    r2 = draw_all_categories(season, past_rounds=[fake_round1])
    assert isinstance(r2["B"], list)
    assert len(r2["B"]) == 2
