# Art. 11: Pontos acumulados por temporada/categoria.
# Art. 12: Cascata de 5 desempates; confronto direto com detecção de ciclo via grafo.

from __future__ import annotations
import random
from collections import defaultdict


# ---------------------------------------------------------------------------
# Stats internos por atleta
# ---------------------------------------------------------------------------

def _empty_stats(athlete_id: str) -> dict:
    return {
        "athlete_id": athlete_id,
        "points": 0,
        "wins": 0,
        "games_won": 0,
        "games_lost": 0,
        "results_ids": [],
    }


def _accumulate(stats: dict, athlete_id: str, result: dict) -> None:
    """Adiciona pontos e games de um resultado confirmado ao stats do atleta."""
    scores = result.get("scores", {})
    sc = scores.get(athlete_id)
    if not sc:
        return

    pts_list = sc.get("sets", [0, 0, 0])
    stats["points"] += sc.get("total", 0)
    stats["results_ids"].append(result["id"])

    for idx, set_def in enumerate(result.get("sets", [])):
        if idx >= len(pts_list):
            break
        pts = pts_list[idx]
        in_team_a = athlete_id in set_def.get("team_a", [])
        score_mine = set_def.get("score_a" if in_team_a else "score_b", 0)
        score_opp  = set_def.get("score_b" if in_team_a else "score_a", 0)
        if pts == 3:
            stats["wins"] += 1
            stats["games_won"]  += score_mine
            stats["games_lost"] += score_opp
        elif pts == 1:
            stats["games_won"]  += score_mine
            stats["games_lost"] += score_opp
        # pts == 0 (WO): sem games


# ---------------------------------------------------------------------------
# Art. 12 critério 2 — ciclo via DFS
# ---------------------------------------------------------------------------

def detect_cycle(athletes: list[str], direct_results: dict[str, set]) -> bool:
    """
    Retorna True se há ciclo A→B→C→A no grafo de vitórias diretas.
    direct_results: {winner_id: {loser_id, ...}}
    """
    visited: set[str] = set()
    rec_stack: set[str] = set()

    def dfs(node: str) -> bool:
        visited.add(node)
        rec_stack.add(node)
        for neighbor in direct_results.get(node, set()):
            if neighbor not in athletes:
                continue
            if neighbor not in visited:
                if dfs(neighbor):
                    return True
            elif neighbor in rec_stack:
                return True
        rec_stack.discard(node)
        return False

    for a in athletes:
        if a not in visited:
            if dfs(a):
                return True
    return False


def _build_direct_graph(tied: list[str], all_results: list[dict]) -> dict[str, set]:
    """Monta grafo winner→{losers} considerando só atletas do grupo empatado."""
    tied_set = set(tied)
    graph: dict[str, set] = {a: set() for a in tied}

    for result in all_results:
        for set_def in result.get("sets", []):
            team_a = [a for a in set_def.get("team_a", []) if a in tied_set]
            team_b = [a for a in set_def.get("team_b", []) if a in tied_set]
            sa, sb = set_def.get("score_a", 0), set_def.get("score_b", 0)
            if sa == sb:
                continue
            winners = team_a if sa > sb else team_b
            losers  = team_b if sa > sb else team_a
            for w in winners:
                for lo in losers:
                    if w != lo:
                        graph[w].add(lo)

    return graph


# ---------------------------------------------------------------------------
# Art. 12 — cascata de 5 desempates
# ---------------------------------------------------------------------------

def apply_tiebreak_cascade(
    tied: list[str],
    all_results: list[dict],
    stats_map: dict[str, dict],
    seed: int | None = None,
) -> list[str]:
    """
    Desempata `tied` usando os 5 critérios do Art. 12.
    Retorna lista ordenada do melhor ao pior dentro do grupo.
    """
    if len(tied) <= 1:
        return list(tied)

    # Critério 1: sets vencidos
    max_wins = max(stats_map[a]["wins"] for a in tied)
    top1 = [a for a in tied if stats_map[a]["wins"] == max_wins]
    rest1 = [a for a in tied if a not in top1]
    if len(top1) == 1:
        return top1 + (apply_tiebreak_cascade(rest1, all_results, stats_map, seed) if rest1 else [])

    # Critério 2: confronto direto (sem ciclo)
    graph = _build_direct_graph(top1, all_results)
    if not detect_cycle(top1, graph):
        def direct_win_count(a):
            return len(graph.get(a, set()) & set(top1))
        max_dw = max(direct_win_count(a) for a in top1)
        top2 = [a for a in top1 if direct_win_count(a) == max_dw]
        rest2 = [a for a in top1 if a not in top2]
        if len(top2) == 1:
            sub = (apply_tiebreak_cascade(rest2, all_results, stats_map, seed) if rest2 else [])
            return top2 + sub + (apply_tiebreak_cascade(rest1, all_results, stats_map, seed) if rest1 else [])
        top1 = top2  # continua desempatando o subgrupo

    # Critério 3: saldo de games
    def saldo(a): return stats_map[a]["games_won"] - stats_map[a]["games_lost"]
    max_sal = max(saldo(a) for a in top1)
    top3 = [a for a in top1 if saldo(a) == max_sal]
    rest3 = [a for a in top1 if a not in top3]
    if len(top3) == 1:
        sub = (apply_tiebreak_cascade(rest3, all_results, stats_map, seed) if rest3 else [])
        return top3 + sub + (apply_tiebreak_cascade(rest1, all_results, stats_map, seed) if rest1 else [])

    # Critério 4: games ganhos
    max_gw = max(stats_map[a]["games_won"] for a in top3)
    top4 = [a for a in top3 if stats_map[a]["games_won"] == max_gw]
    rest4 = [a for a in top3 if a not in top4]
    if len(top4) == 1:
        sub = (apply_tiebreak_cascade(rest4, all_results, stats_map, seed) if rest4 else [])
        return top4 + sub + (apply_tiebreak_cascade(rest1, all_results, stats_map, seed) if rest1 else [])

    # Critério 5: sorteio
    rng = random.Random(seed)
    shuffled = list(top4)
    rng.shuffle(shuffled)
    sub_rest = (apply_tiebreak_cascade(rest4, all_results, stats_map, seed) if rest4 else [])
    return shuffled + sub_rest + (apply_tiebreak_cascade(rest1, all_results, stats_map, seed) if rest1 else [])


# ---------------------------------------------------------------------------
# compute_ranking — ponto de entrada principal
# ---------------------------------------------------------------------------

def compute_ranking(
    athletes: list[dict],
    results: list[dict],
    category: str | None = None,
    season_id: str | None = None,
) -> list[dict]:
    """
    Retorna ranking ordenado para uma categoria/temporada.

    athletes: [{"id":..., "nome":...}]
    results: result records (apenas os confirmed são considerados)
    category: filtra por cat (None = todos)
    season_id: filtra por temporada (None = todos)
    """
    relevant = [
        r for r in results
        if r.get("status") == "confirmed"
        and (category is None or r.get("cat") == category)
        and (season_id is None or r.get("season_id") == season_id)
    ]

    athlete_ids = [a["id"] for a in athletes]
    stats_map: dict[str, dict] = {aid: _empty_stats(aid) for aid in athlete_ids}

    for result in relevant:
        for aid in result.get("group", []):
            if aid in stats_map:
                _accumulate(stats_map[aid], aid, result)

    sorted_ids = _sort_with_tiebreak(athlete_ids, stats_map, relevant)

    names = {a["id"]: a.get("nome", a["id"]) for a in athletes}
    ranking = []
    for rank, aid in enumerate(sorted_ids, start=1):
        s = stats_map[aid]
        ranking.append({
            "rank": rank,
            "athlete_id": aid,
            "nome": names.get(aid, aid),
            "points": s["points"],
            "wins": s["wins"],
            "games_won": s["games_won"],
            "games_lost": s["games_lost"],
            "saldo": s["games_won"] - s["games_lost"],
            "results_count": len(s["results_ids"]),
        })
    return ranking


def _sort_with_tiebreak(
    athlete_ids: list[str],
    stats_map: dict[str, dict],
    all_results: list[dict],
) -> list[str]:
    by_pts: dict[int, list[str]] = defaultdict(list)
    for aid in athlete_ids:
        by_pts[stats_map[aid]["points"]].append(aid)

    ordered: list[str] = []
    for pts in sorted(by_pts.keys(), reverse=True):
        group = by_pts[pts]
        if len(group) == 1:
            ordered.extend(group)
        else:
            ordered.extend(apply_tiebreak_cascade(group, all_results, stats_map))
    return ordered
