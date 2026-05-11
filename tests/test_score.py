"""
Testes do score_engine — Sprint 5.
Cobre Art. 8 (pontos), Art. 9 (validação de placar), Art. 10 (WO total e parcial).
"""
import pytest

from engines.score_engine import (
    apply_wo_partial,
    apply_wo_total,
    calculate_group_result,
    calculate_set_points,
    is_stb_needed,
    validate_group_scores,
    validate_set_score,
)

# ---------------------------------------------------------------------------
# Art. 9 — validate_set_score
# ---------------------------------------------------------------------------

def test_valid_set_scores():
    assert validate_set_score(6, 0) is True
    assert validate_set_score(6, 1) is True
    assert validate_set_score(6, 2) is True
    assert validate_set_score(6, 3) is True
    assert validate_set_score(6, 4) is True
    assert validate_set_score(0, 6) is True
    assert validate_set_score(4, 6) is True


def test_invalid_set_score_six_five():
    """6-5 nunca é válido: 5×5 exige STB."""
    assert validate_set_score(6, 5) is False
    assert validate_set_score(5, 6) is False


def test_invalid_set_score_six_six():
    assert validate_set_score(6, 6) is False


def test_invalid_set_score_negative():
    assert validate_set_score(-1, 6) is False
    assert validate_set_score(6, -1) is False


def test_invalid_set_score_too_high():
    assert validate_set_score(7, 0) is False
    assert validate_set_score(0, 7) is False


def test_invalid_set_score_not_six():
    """Nenhum lado chegou a 6."""
    assert validate_set_score(4, 3) is False
    assert validate_set_score(0, 0) is False


# ---------------------------------------------------------------------------
# Art. 9 — Super Tie-Break
# ---------------------------------------------------------------------------

def test_stb_valid():
    assert validate_set_score(10, 0, is_super_tiebreak=True) is True
    assert validate_set_score(10, 8, is_super_tiebreak=True) is True
    assert validate_set_score(12, 10, is_super_tiebreak=True) is True
    assert validate_set_score(0, 10, is_super_tiebreak=True) is True


def test_stb_diff_less_than_two():
    assert validate_set_score(10, 9, is_super_tiebreak=True) is False
    assert validate_set_score(9, 10, is_super_tiebreak=True) is False
    assert validate_set_score(11, 11, is_super_tiebreak=True) is False


def test_stb_winner_below_ten():
    assert validate_set_score(9, 0, is_super_tiebreak=True) is False
    assert validate_set_score(0, 8, is_super_tiebreak=True) is False


def test_stb_needed_at_five_five():
    assert is_stb_needed(5, 5) is True
    assert is_stb_needed(4, 5) is False
    assert is_stb_needed(6, 0) is False


# ---------------------------------------------------------------------------
# Art. 8 — calculate_set_points
# ---------------------------------------------------------------------------

def test_set_points_a_wins():
    assert calculate_set_points(6, 0) == (3, 1)
    assert calculate_set_points(6, 4) == (3, 1)


def test_set_points_b_wins():
    assert calculate_set_points(0, 6) == (1, 3)
    assert calculate_set_points(3, 6) == (1, 3)


def test_set_points_stb_winner():
    assert calculate_set_points(10, 5) == (3, 1)
    assert calculate_set_points(5, 10) == (1, 3)


def test_set_points_tie_raises():
    with pytest.raises(ValueError):
        calculate_set_points(3, 3)


# ---------------------------------------------------------------------------
# Art. 10.1 — WO total
# ---------------------------------------------------------------------------

GROUP = ["a1", "a2", "a3", "a4"]


def test_wo_total_absent_gets_zero():
    result = apply_wo_total(GROUP, "a1")
    assert result["a1"]["total"] == 0
    assert result["a1"]["sets"] == [0, 0, 0]
    assert result["a1"]["wo"] is True


def test_wo_total_others_get_nine():
    result = apply_wo_total(GROUP, "a1")
    for aid in ["a2", "a3", "a4"]:
        assert result[aid]["total"] == 9
        assert result[aid]["sets"] == [3, 3, 3]
        assert result[aid]["wo"] is False


def test_wo_total_different_absent():
    result = apply_wo_total(GROUP, "a3")
    assert result["a3"]["total"] == 0
    for aid in ["a1", "a2", "a4"]:
        assert result[aid]["total"] == 9


# ---------------------------------------------------------------------------
# Art. 10.2 — WO parcial
# ---------------------------------------------------------------------------

# Sets jogados antes do abandono no set 2:
# Set 1: a1+a2 vs a3+a4; score 6-4 → team_a ganhou
SETS_S1 = [
    {
        "set": 1,
        "team_a": ["a1", "a2"],
        "team_b": ["a3", "a4"],
        "score_a": 6,
        "score_b": 4,
        "is_super_tiebreak": False,
    }
]


def test_wo_partial_set2_absent():
    """a3 abandona no set 2. Set 1 concluído mantém; sets 2 e 3 → ausente 0, demais 3."""
    result = apply_wo_partial(SETS_S1, absent_from_set=2, absent_athlete="a3", group=GROUP)

    # Set 1: a1,a2 ganharam (3pts) vs a3,a4 perderam (1pt)
    assert result["a1"]["sets"][0] == 3
    assert result["a2"]["sets"][0] == 3
    assert result["a3"]["sets"][0] == 1
    assert result["a4"]["sets"][0] == 1

    # Sets 2 e 3: a3 ausente = 0; demais = 3
    assert result["a3"]["sets"][1] == 0
    assert result["a3"]["sets"][2] == 0
    assert result["a1"]["sets"][1] == 3
    assert result["a1"]["sets"][2] == 3

    assert result["a3"]["wo_partial"] is True
    assert result["a1"]["wo_partial"] is False


def test_wo_partial_set1_absent():
    """Abandono no set 1 (sem sets concluídos): todos os 3 sets são WO."""
    result = apply_wo_partial([], absent_from_set=1, absent_athlete="a2", group=GROUP)
    assert result["a2"]["sets"] == [0, 0, 0]
    assert result["a2"]["total"] == 0
    for aid in ["a1", "a3", "a4"]:
        assert result[aid]["sets"] == [3, 3, 3]


def test_wo_partial_set3_absent():
    """Abandono no set 3: sets 1 e 2 concluídos mantêm resultado."""
    sets_played = [
        {"set": 1, "team_a": ["a1", "a2"], "team_b": ["a3", "a4"],
         "score_a": 6, "score_b": 2, "is_super_tiebreak": False},
        {"set": 2, "team_a": ["a1", "a3"], "team_b": ["a2", "a4"],
         "score_a": 3, "score_b": 6, "is_super_tiebreak": False},
    ]
    result = apply_wo_partial(sets_played, absent_from_set=3, absent_athlete="a4", group=GROUP)
    # Set 3 (ausente = a4 → 0; demais = 3)
    assert result["a4"]["sets"][2] == 0
    for aid in ["a1", "a2", "a3"]:
        assert result[aid]["sets"][2] == 3
    assert result["a4"]["wo_partial"] is True


# ---------------------------------------------------------------------------
# Art. 7 + Art. 8 — calculate_group_result
# ---------------------------------------------------------------------------

def test_group_result_full():
    """Resultado completo de 3 sets. Verifica pontos por atleta."""
    sets_scores = [
        {"set": 1, "team_a": ["a1", "a2"], "team_b": ["a3", "a4"],
         "score_a": 6, "score_b": 3, "is_super_tiebreak": False},
        {"set": 2, "team_a": ["a1", "a3"], "team_b": ["a2", "a4"],
         "score_a": 4, "score_b": 6, "is_super_tiebreak": False},
        {"set": 3, "team_a": ["a1", "a4"], "team_b": ["a2", "a3"],
         "score_a": 10, "score_b": 6, "is_super_tiebreak": True},
    ]
    result = calculate_group_result(GROUP, sets_scores)

    # Set 1: a1+a2 vencem (3pts), a3+a4 perdem (1pt)
    assert result["a1"]["sets"][0] == 3
    assert result["a2"]["sets"][0] == 3
    assert result["a3"]["sets"][0] == 1
    assert result["a4"]["sets"][0] == 1

    # Set 2: a2+a4 vencem (3pts), a1+a3 perdem (1pt)
    assert result["a2"]["sets"][1] == 3
    assert result["a4"]["sets"][1] == 3
    assert result["a1"]["sets"][1] == 1
    assert result["a3"]["sets"][1] == 1

    # Set 3: a1+a4 vencem STB 10-6 (3pts), a2+a3 perdem (1pt)
    assert result["a1"]["sets"][2] == 3
    assert result["a4"]["sets"][2] == 3
    assert result["a2"]["sets"][2] == 1
    assert result["a3"]["sets"][2] == 1

    # Totais: a1=7, a2=7, a3=3, a4=7
    assert result["a1"]["total"] == 7
    assert result["a2"]["total"] == 7
    assert result["a3"]["total"] == 3
    assert result["a4"]["total"] == 7


def test_group_result_sweep():
    """Um atleta vence todos os sets junto com pares diferentes."""
    sets_scores = [
        {"set": 1, "team_a": ["a1", "a2"], "team_b": ["a3", "a4"],
         "score_a": 6, "score_b": 0, "is_super_tiebreak": False},
        {"set": 2, "team_a": ["a1", "a3"], "team_b": ["a2", "a4"],
         "score_a": 6, "score_b": 0, "is_super_tiebreak": False},
        {"set": 3, "team_a": ["a1", "a4"], "team_b": ["a2", "a3"],
         "score_a": 6, "score_b": 0, "is_super_tiebreak": False},
    ]
    result = calculate_group_result(GROUP, sets_scores)
    # a1 vence todos os 3 sets: 3+3+3 = 9pts
    assert result["a1"]["total"] == 9
    # a2: vence set1 (parceiro de a1, 3pts) + perde set2 (1pt) + perde set3 (1pt) = 5pts
    assert result["a2"]["total"] == 5


# ---------------------------------------------------------------------------
# validate_group_scores
# ---------------------------------------------------------------------------

def test_validate_group_scores_ok():
    sets = [
        {"set": 1, "team_a": ["a1","a2"], "team_b": ["a3","a4"],
         "score_a": 6, "score_b": 3, "is_super_tiebreak": False},
        {"set": 2, "team_a": ["a1","a3"], "team_b": ["a2","a4"],
         "score_a": 10, "score_b": 4, "is_super_tiebreak": True},
        {"set": 3, "team_a": ["a1","a4"], "team_b": ["a2","a3"],
         "score_a": 6, "score_b": 1, "is_super_tiebreak": False},
    ]
    assert validate_group_scores(sets) == []


def test_validate_group_scores_bad_placar():
    sets = [
        {"set": 1, "team_a": ["a1","a2"], "team_b": ["a3","a4"],
         "score_a": 7, "score_b": 0, "is_super_tiebreak": False},  # inválido
        {"set": 2, "team_a": ["a1","a3"], "team_b": ["a2","a4"],
         "score_a": 6, "score_b": 0, "is_super_tiebreak": False},
        {"set": 3, "team_a": ["a1","a4"], "team_b": ["a2","a3"],
         "score_a": 6, "score_b": 0, "is_super_tiebreak": False},
    ]
    errors = validate_group_scores(sets)
    assert len(errors) == 1
    assert "Set 1" in errors[0]


def test_validate_group_scores_wrong_count():
    errors = validate_group_scores([{"set": 1}])
    assert len(errors) == 1
    assert "3 sets" in errors[0]
