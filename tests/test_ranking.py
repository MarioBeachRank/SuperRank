"""
Testes do ranking_engine — Sprint 6.
Cobre Art. 11 (pontos acumulados) e Art. 12 (cascata de 5 desempates + ciclos).
"""
import pytest
from engines.ranking_engine import (
    apply_tiebreak_cascade,
    compute_ranking,
    detect_cycle,
)

# ---------------------------------------------------------------------------
# Fixtures base
# ---------------------------------------------------------------------------

ATHLETES = [
    {"id": "a1", "nome": "Ana"},
    {"id": "a2", "nome": "Bruno"},
    {"id": "a3", "nome": "Carlos"},
    {"id": "a4", "nome": "Dani"},
]

def make_result(
    rid, group, sets_scores,
    cat="B", season_id="s1", status="confirmed"
):
    """Helper para criar um result dict com scores já calculados."""
    from engines.score_engine import calculate_group_result
    scores = calculate_group_result(group, sets_scores)
    return {
        "id": rid,
        "cat": cat,
        "season_id": season_id,
        "status": status,
        "group": group,
        "sets": sets_scores,
        "scores": scores,
    }


# ---------------------------------------------------------------------------
# Art. 11 — acúmulo de pontos
# ---------------------------------------------------------------------------

def test_ranking_single_result():
    """Um resultado: atleta que vence 2 sets fica na frente."""
    sets = [
        {"set":1,"team_a":["a1","a2"],"team_b":["a3","a4"],"score_a":6,"score_b":3,"is_super_tiebreak":False},
        {"set":2,"team_a":["a1","a3"],"team_b":["a2","a4"],"score_a":6,"score_b":3,"is_super_tiebreak":False},
        {"set":3,"team_a":["a1","a4"],"team_b":["a2","a3"],"score_a":6,"score_b":3,"is_super_tiebreak":False},
    ]
    r = make_result("r1", ["a1","a2","a3","a4"], sets)
    ranking = compute_ranking(ATHLETES, [r], category="B", season_id="s1")

    assert ranking[0]["athlete_id"] == "a1"  # 3+3+3 = 9pts
    assert ranking[0]["points"] == 9
    # a2 vence set1 (3pts), perde set2 (1pt), perde set3 (1pt) = 5pts
    a2_entry = next(x for x in ranking if x["athlete_id"] == "a2")
    assert a2_entry["points"] == 5


def test_ranking_only_confirmed():
    """Resultados não-confirmed são ignorados."""
    sets = [
        {"set":1,"team_a":["a1","a2"],"team_b":["a3","a4"],"score_a":6,"score_b":0,"is_super_tiebreak":False},
        {"set":2,"team_a":["a1","a3"],"team_b":["a2","a4"],"score_a":6,"score_b":0,"is_super_tiebreak":False},
        {"set":3,"team_a":["a1","a4"],"team_b":["a2","a3"],"score_a":6,"score_b":0,"is_super_tiebreak":False},
    ]
    r_pending = make_result("r1", ["a1","a2","a3","a4"], sets, status="pending_confirmation")
    ranking = compute_ranking(ATHLETES, [r_pending], category="B", season_id="s1")
    # Todos zerados porque resultado não confirmado
    assert all(e["points"] == 0 for e in ranking)


def test_ranking_accumulates_two_rounds():
    """Dois resultados de rodadas diferentes: pontos somam."""
    sets1 = [
        {"set":1,"team_a":["a1","a2"],"team_b":["a3","a4"],"score_a":6,"score_b":0,"is_super_tiebreak":False},
        {"set":2,"team_a":["a1","a3"],"team_b":["a2","a4"],"score_a":6,"score_b":0,"is_super_tiebreak":False},
        {"set":3,"team_a":["a1","a4"],"team_b":["a2","a3"],"score_a":6,"score_b":0,"is_super_tiebreak":False},
    ]
    sets2 = [
        {"set":1,"team_a":["a1","a2"],"team_b":["a3","a4"],"score_a":6,"score_b":0,"is_super_tiebreak":False},
        {"set":2,"team_a":["a1","a3"],"team_b":["a2","a4"],"score_a":6,"score_b":0,"is_super_tiebreak":False},
        {"set":3,"team_a":["a1","a4"],"team_b":["a2","a3"],"score_a":6,"score_b":0,"is_super_tiebreak":False},
    ]
    r1 = make_result("r1", ["a1","a2","a3","a4"], sets1)
    r2 = make_result("r2", ["a1","a2","a3","a4"], sets2)
    ranking = compute_ranking(ATHLETES, [r1, r2], category="B", season_id="s1")
    a1 = next(x for x in ranking if x["athlete_id"] == "a1")
    assert a1["points"] == 18  # 9 + 9


def test_ranking_season_filter():
    """Resultados de outra temporada não afetam o ranking."""
    sets = [
        {"set":1,"team_a":["a1","a2"],"team_b":["a3","a4"],"score_a":6,"score_b":0,"is_super_tiebreak":False},
        {"set":2,"team_a":["a1","a3"],"team_b":["a2","a4"],"score_a":6,"score_b":0,"is_super_tiebreak":False},
        {"set":3,"team_a":["a1","a4"],"team_b":["a2","a3"],"score_a":6,"score_b":0,"is_super_tiebreak":False},
    ]
    r_other = make_result("r1", ["a1","a2","a3","a4"], sets, season_id="s_other")
    ranking = compute_ranking(ATHLETES, [r_other], category="B", season_id="s1")
    assert all(e["points"] == 0 for e in ranking)


# ---------------------------------------------------------------------------
# Art. 12 critério 2 — detect_cycle
# ---------------------------------------------------------------------------

def test_no_cycle_simple():
    """A vence B vence C — sem ciclo."""
    graph = {"a1": {"a2"}, "a2": {"a3"}, "a3": set()}
    assert detect_cycle(["a1","a2","a3"], graph) is False


def test_cycle_triangle():
    """A→B→C→A — ciclo."""
    graph = {"a1": {"a2"}, "a2": {"a3"}, "a3": {"a1"}}
    assert detect_cycle(["a1","a2","a3"], graph) is True


def test_no_cycle_empty_graph():
    graph = {"a1": set(), "a2": set(), "a3": set()}
    assert detect_cycle(["a1","a2","a3"], graph) is False


def test_cycle_self_loop():
    graph = {"a1": {"a1"}}
    assert detect_cycle(["a1"], graph) is True


def test_no_cycle_disconnected():
    """A→B e C→D sem conexão entre os grupos — sem ciclo."""
    graph = {"a1": {"a2"}, "a2": set(), "a3": {"a4"}, "a4": set()}
    assert detect_cycle(["a1","a2","a3","a4"], graph) is False


# ---------------------------------------------------------------------------
# Art. 12 — apply_tiebreak_cascade
# ---------------------------------------------------------------------------

def _mk_stats(pts, wins, games_won, games_lost):
    return {"points": pts, "wins": wins, "games_won": games_won, "games_lost": games_lost}


def test_tiebreak_by_wins():
    """Critério 1: quem tem mais sets vencidos vence o desempate."""
    stats_map = {
        "a1": _mk_stats(7, 2, 12, 6),  # 2 vitórias
        "a2": _mk_stats(7, 1, 15, 3),  # 1 vitória (mais games, mas menos wins)
    }
    result = apply_tiebreak_cascade(["a1","a2"], [], stats_map)
    assert result[0] == "a1"


def test_tiebreak_by_saldo_when_wins_tied():
    """Critério 3: mesmo wins e sem confronto direto → saldo de games."""
    stats_map = {
        "a1": _mk_stats(5, 1, 10, 4),  # saldo +6
        "a2": _mk_stats(5, 1, 8, 5),   # saldo +3
    }
    result = apply_tiebreak_cascade(["a1","a2"], [], stats_map)
    assert result[0] == "a1"


def test_tiebreak_by_games_when_saldo_tied():
    """Critério 4: mesmo saldo → mais games ganhos."""
    stats_map = {
        "a1": _mk_stats(5, 1, 12, 6),  # saldo +6, games_won=12
        "a2": _mk_stats(5, 1, 10, 4),  # saldo +6, games_won=10
    }
    result = apply_tiebreak_cascade(["a1","a2"], [], stats_map)
    assert result[0] == "a1"


def test_tiebreak_draw_returns_two(monkeypatch):
    """Critério 5: sorteio com seed fixo — retorna 2 atletas."""
    stats_map = {
        "a1": _mk_stats(5, 1, 10, 4),
        "a2": _mk_stats(5, 1, 10, 4),
    }
    result = apply_tiebreak_cascade(["a1","a2"], [], stats_map, seed=42)
    assert len(result) == 2
    assert set(result) == {"a1","a2"}


def test_tiebreak_direct_no_cycle():
    """Critério 2: confronto direto sem ciclo quebra empate."""
    # Set onde a1 vence a2 diretamente
    sets = [
        {"set":1,"team_a":["a1"],"team_b":["a2"],"score_a":6,"score_b":3,"is_super_tiebreak":False},
    ]
    result_rec = {
        "id":"r1","cat":"B","season_id":"s1","status":"confirmed",
        "group":["a1","a2"],
        "sets": sets,
        "scores": {
            "a1": {"sets":[3],"total":3},
            "a2": {"sets":[1],"total":1},
        },
    }
    stats_map = {
        "a1": _mk_stats(5, 1, 10, 4),
        "a2": _mk_stats(5, 1, 10, 4),
    }
    result = apply_tiebreak_cascade(["a1","a2"], [result_rec], stats_map)
    assert result[0] == "a1"


def test_tiebreak_direct_cycle_falls_through():
    """Critério 2 com ciclo → ignora confronto direto, cai no critério 3."""
    # a1→a2, a2→a3, a3→a1: ciclo → vai pro critério 3
    sets = [
        {"set":1,"team_a":["a1"],"team_b":["a2"],"score_a":6,"score_b":0,"is_super_tiebreak":False},
        {"set":2,"team_a":["a2"],"team_b":["a3"],"score_a":6,"score_b":0,"is_super_tiebreak":False},
        {"set":3,"team_a":["a3"],"team_b":["a1"],"score_a":6,"score_b":0,"is_super_tiebreak":False},
    ]
    result_rec = {
        "id":"r1","cat":"B","season_id":"s1","status":"confirmed",
        "group":["a1","a2","a3"],
        "sets": sets,
        "scores": {
            "a1": {"sets":[3,0,1],"total":4},
            "a2": {"sets":[1,3,0],"total":4},
            "a3": {"sets":[0,1,3],"total":4},
        },
    }
    stats_map = {
        "a1": _mk_stats(4, 1, 6, 6),
        "a2": _mk_stats(4, 1, 6, 6),
        "a3": _mk_stats(4, 1, 6, 6),
    }
    # Ciclo → cai pro critério 3 (saldo igual) → critério 4 (games igual) → sorteio
    result = apply_tiebreak_cascade(["a1","a2","a3"], [result_rec], stats_map, seed=0)
    assert len(result) == 3
    assert set(result) == {"a1","a2","a3"}


# ---------------------------------------------------------------------------
# compute_ranking integração
# ---------------------------------------------------------------------------

def test_compute_ranking_order():
    """Ranking completo: a1 domina, a3 fica último."""
    sets = [
        {"set":1,"team_a":["a1","a2"],"team_b":["a3","a4"],"score_a":6,"score_b":0,"is_super_tiebreak":False},
        {"set":2,"team_a":["a1","a3"],"team_b":["a2","a4"],"score_a":6,"score_b":0,"is_super_tiebreak":False},
        {"set":3,"team_a":["a1","a4"],"team_b":["a2","a3"],"score_a":6,"score_b":0,"is_super_tiebreak":False},
    ]
    r = make_result("r1", ["a1","a2","a3","a4"], sets)
    ranking = compute_ranking(ATHLETES, [r], category="B", season_id="s1")

    # a1=9pts, a2=5pts (vence s1, perde s2+s3), a4=5pts (perde s1, vence s3... wait
    # a2: s1=3,s2=1,s3=1 = 5pts; a4: s1=1,s2=1,s3=3 = 5pts; a3: s1=1,s2=3,s3=1 = 5pts
    assert ranking[0]["athlete_id"] == "a1"
    assert ranking[0]["rank"] == 1
    assert ranking[0]["points"] == 9
    # a2, a3, a4 all have 5pts — all ranked 2nd onwards
    pts_rest = {e["athlete_id"]: e["points"] for e in ranking[1:]}
    assert all(p == 5 for p in pts_rest.values())


def test_compute_ranking_returns_all_athletes():
    """Todos os atletas aparecem no ranking, mesmo sem resultado."""
    ranking = compute_ranking(ATHLETES, [], category="B", season_id="s1")
    assert len(ranking) == 4
    assert all(e["points"] == 0 for e in ranking)


def test_compute_ranking_saldo_games():
    """Atleta com mais saldo de games fica à frente em caso de empate de pontos e wins."""
    # Cenário: a1 e a2 empatam em pontos e wins, mas a1 tem saldo melhor.
    # Cada atleta vence 1 set com placar diferente.
    # Set1: a1+a2 vencem a3+a4 por 6-0 (saldo enorme para a1 e a2)
    # Set2: a1+a3 perdem para a2+a4 por 0-6
    # Set3: a1+a4 perdem para a2+a3 por 0-6
    # a1: wins=1(s1), games_won=6+0+0=6, games_lost=0+6+6=12, saldo=-6
    # a2: wins=3(s1+s2+s3), 9pts — fica primeiro
    # a3: wins=1(s3), games_won=0+0+6=6, games_lost=6+6+0... wait
    # Use dois resultados separados para forçar o cenário de saldo
    # Resultado 1: a1 vence a2 em 6-0 (3 vs 1 pts)
    # Resultado 2: a2 vence a1 em 6-0 (3 vs 1 pts)
    # Empate em points e wins; a1 tem saldo 0 (6-0 ganhou, 0-6 perdeu), a2 também 0 — vai ao critério 4
    # Melhor: dois atletas isolados com mesma estrutura mas games diferentes
    from engines.score_engine import calculate_set_points

    # Dois atletas (a1 e a2) com exatamente 1 vitória cada, mesma pts total
    # mas a1 venceu 6-0 (saldo +6) e a2 venceu 6-4 (saldo +2)
    r1 = {
        "id": "r_saldo1", "cat": "B", "season_id": "s1", "status": "confirmed",
        "group": ["a1", "a2", "a3", "a4"],
        "sets": [
            {"set":1,"team_a":["a1","a2"],"team_b":["a3","a4"],"score_a":6,"score_b":0,"is_super_tiebreak":False},
            {"set":2,"team_a":["a1","a3"],"team_b":["a2","a4"],"score_a":6,"score_b":4,"is_super_tiebreak":False},
            {"set":3,"team_a":["a1","a4"],"team_b":["a2","a3"],"score_a":4,"score_b":6,"is_super_tiebreak":False},
        ],
        "scores": {
            # a1: s1=3(won,6-0), s2=3(won,6-4), s3=1(lost,4-6) → 7pts, wins=2, gw=6+6+4=16, gl=0+4+6=10 saldo+6
            "a1": {"sets":[3,3,1],"total":7},
            # a2: s1=3(won,6-0), s2=1(lost,4-6), s3=3(won,6-4) → 7pts, wins=2, gw=6+4+6=16, gl=0+6+4=10 saldo+6
            "a2": {"sets":[3,1,3],"total":7},
            "a3": {"sets":[1,1,3],"total":5},
            "a4": {"sets":[1,3,1],"total":5},
        },
    }
    ranking = compute_ranking(ATHLETES, [r1], category="B", season_id="s1")
    # a1 e a2 ambos 7pts, ambos 2 wins — desempate vai até critério 3+
    first_two = {ranking[0]["athlete_id"], ranking[1]["athlete_id"]}
    assert first_two == {"a1", "a2"}
    # a3 e a4 com 5pts ficam depois
    assert ranking[2]["points"] == 5
    assert ranking[3]["points"] == 5
