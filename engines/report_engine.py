# Sprint 12: Relatório de temporada e busca global.

from __future__ import annotations
from collections import defaultdict

CATEGORIES = ("A", "B", "C", "D")


def compute_season_report(
    season: dict,
    rounds: list[dict],
    results: list[dict],
    athletes_by_id: dict,
) -> dict:
    """
    Relatório completo de uma temporada.

    Retorna:
    - total_rounds, rounds_with_results, total_confirmed_results
    - athletes_who_played, total_titulares, participation_rate (%)
    - avg_points_per_athlete
    - top_per_cat: {cat: {athlete_id, nome, total_points, rounds, set_wins} | None}
    - most_active: entrada com mais rodadas jogadas
    - results_per_round: {round_number: confirmed_count}
    - athlete_stats: lista ordenada por total_points desc
    """
    season_id = season["id"]
    season_results = [
        r for r in results
        if r.get("season_id") == season_id and r.get("status") == "confirmed"
    ]
    season_rounds = [r for r in rounds if r.get("season_id") == season_id]

    # Acumula stats por atleta
    raw: dict[str, dict] = defaultdict(lambda: {
        "rounds": 0, "total_points": 0, "set_wins": 0, "category": None
    })
    for result in season_results:
        cat = result.get("cat")
        for aid in result.get("group", []):
            sc = result.get("scores", {}).get(aid, {})
            raw[aid]["rounds"] += 1
            raw[aid]["total_points"] += sc.get("total") or 0
            raw[aid]["set_wins"] += sum(1 for s in sc.get("sets", []) if s == 3)
            if raw[aid]["category"] is None:
                raw[aid]["category"] = cat

    # Top scorer por categoria (somente titulares do setup)
    setup = season.get("category_setup", {})
    top_per_cat: dict[str, dict | None] = {}
    for cat in CATEGORIES:
        titular_ids = setup.get(cat, {}).get("titular_ids", [])
        candidates = [(aid, raw[aid]) for aid in titular_ids if aid in raw]
        if candidates:
            best_id, best = max(candidates, key=lambda x: x[1]["total_points"])
            top_per_cat[cat] = {
                "athlete_id": best_id,
                "nome": athletes_by_id.get(best_id, {}).get("nome", best_id),
                **best,
            }
        else:
            top_per_cat[cat] = None

    # Atleta mais ativo (mais rodadas)
    most_active = None
    if raw:
        best_id = max(raw, key=lambda aid: raw[aid]["rounds"])
        most_active = {
            "athlete_id": best_id,
            "nome": athletes_by_id.get(best_id, {}).get("nome", best_id),
            **raw[best_id],
        }

    # Resultados confirmados por número de rodada
    results_per_round: dict[int, int] = {}
    for rnd in season_rounds:
        rn = rnd.get("round_number") or 0
        results_per_round[rn] = sum(
            1 for r in season_results if r.get("round_id") == rnd["id"]
        )
    results_per_round = dict(sorted(results_per_round.items()))

    # Taxa de participação
    total_titulares = sum(
        len(setup.get(cat, {}).get("titular_ids", []))
        for cat in CATEGORIES
    )
    athletes_who_played = len(raw)
    participation_rate = (
        round(athletes_who_played / total_titulares * 100, 1)
        if total_titulares else 0.0
    )

    # Média de pontos por atleta
    avg_points = (
        round(sum(s["total_points"] for s in raw.values()) / len(raw), 1)
        if raw else 0.0
    )

    rounds_with_results = sum(
        1 for rnd in season_rounds
        if any(r.get("round_id") == rnd["id"] for r in season_results)
    )

    # Lista de stats de atletas ordenada por pontos
    athlete_stats_list = sorted(
        [
            {
                "athlete_id": aid,
                "nome": athletes_by_id.get(aid, {}).get("nome", aid),
                **stats,
            }
            for aid, stats in raw.items()
        ],
        key=lambda x: x["total_points"],
        reverse=True,
    )

    return {
        "season_id": season_id,
        "season_name": season.get("name"),
        "total_rounds": len(season_rounds),
        "rounds_with_results": rounds_with_results,
        "total_confirmed_results": len(season_results),
        "athletes_who_played": athletes_who_played,
        "total_titulares": total_titulares,
        "participation_rate": participation_rate,
        "avg_points_per_athlete": avg_points,
        "top_per_cat": top_per_cat,
        "most_active": most_active,
        "results_per_round": results_per_round,
        "athlete_stats": athlete_stats_list,
    }


def compute_search_results(
    query: str,
    athletes: list[dict],
    seasons: list[dict],
) -> dict:
    """
    Busca textual case-insensitive em atletas (nome) e temporadas (nome).
    Requer ao menos 2 caracteres. Retorna no máximo 10 atletas e 5 temporadas.
    """
    q = query.strip().lower()
    if len(q) < 2:
        return {"query": query, "athletes": [], "seasons": []}

    matched_athletes = [
        {
            "id": a["id"],
            "nome": a.get("nome", ""),
            "current_category": a.get("current_category"),
            "status": a.get("status"),
        }
        for a in athletes
        if q in a.get("nome", "").lower()
    ]

    matched_seasons = [
        {
            "id": s["id"],
            "name": s.get("name", ""),
            "status": s.get("status"),
            "year": s.get("year"),
        }
        for s in seasons
        if q in s.get("name", "").lower()
    ]

    return {
        "query": query,
        "athletes": matched_athletes[:10],
        "seasons": matched_seasons[:5],
    }
