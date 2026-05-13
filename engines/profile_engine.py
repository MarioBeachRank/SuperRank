# Sprint 9: Perfil do Atleta — estatísticas por temporada e histórico de categorias.

from __future__ import annotations


def compute_season_stats(
    athlete_id: str,
    season: dict,
    results_data: list[dict],
    athletes_data: list[dict] | None = None,
) -> dict:
    """
    Estatísticas do atleta em uma temporada.
    Conta apenas resultados confirmados onde o atleta estava no grupo.

    Retorna: {season_id, season_name, year, status, rounds_played, total_points, set_wins, final_rank}
    """
    season_id = season["id"]
    season_results = [
        r for r in results_data
        if r.get("season_id") == season_id
        and r.get("status") == "confirmed"
        and athlete_id in r.get("group", [])
    ]

    rounds = len(season_results)
    total_pts = 0
    set_wins = 0

    for r in season_results:
        sc = r.get("scores", {}).get(athlete_id, {})
        total_pts += sc.get("total", 0)
        set_wins += sum(1 for s in sc.get("sets", []) if s == 3)

    # Posição final na temporada (requer dados de atletas)
    final_rank = None
    if athletes_data and rounds > 0:
        from engines.ranking_engine import compute_ranking
        category_setup = season.get("category_setup", {})
        for cat, setup in category_setup.items():
            if athlete_id in setup.get("titular_ids", []):
                cat_athletes = [
                    {**a, "nome": a.get("nome", a["id"])}
                    for a in athletes_data if a["id"] in setup.get("titular_ids", [])
                ]
                ranking = compute_ranking(
                    cat_athletes, results_data, category=cat, season_id=season_id
                )
                entry = next((r for r in ranking if r["athlete_id"] == athlete_id), None)
                if entry:
                    final_rank = {"rank": entry["rank"], "total": len(ranking), "cat": cat}
                break

    return {
        "season_id": season_id,
        "season_name": season.get("name", season_id),
        "year": season.get("year"),
        "status": season.get("status"),
        "rounds_played": rounds,
        "total_points": total_pts,
        "set_wins": set_wins,
        "final_rank": final_rank,
    }


def compute_athlete_profile(
    athlete: dict,
    seasons_data: list[dict],
    results_data: list[dict],
    athletes_data: list[dict] | None = None,
) -> dict:
    """
    Perfil completo do atleta:
    - Dados básicos (nome, categoria, status)
    - Histórico de categorias (category_history)
    - Stats por temporada (apenas temporadas com ≥1 rodada jogada)
    - Stats globais (totais de rodadas, pontos, set_wins)

    Retorna: {athlete_id, nome, current_category, status, type, category_history,
              created_at, season_summaries, stats}
    """
    athlete_id = athlete["id"]

    season_summaries = []
    for season in seasons_data:
        stats = compute_season_stats(athlete_id, season, results_data, athletes_data)
        if stats["rounds_played"] > 0:
            season_summaries.append(stats)

    season_summaries.sort(key=lambda s: (s.get("year") or 0, s["season_id"]))

    total_rounds   = sum(s["rounds_played"] for s in season_summaries)
    total_points   = sum(s["total_points"]  for s in season_summaries)
    total_set_wins = sum(s["set_wins"]      for s in season_summaries)

    return {
        "athlete_id": athlete_id,
        "nome": athlete.get("nome", ""),
        "current_category": athlete.get("current_category") or athlete.get("category"),
        "status": athlete.get("status"),
        "type": athlete.get("type"),
        "category_history": athlete.get("category_history", []),
        "created_at": athlete.get("created_at"),
        "season_summaries": season_summaries,
        "stats": {
            "total_rounds": total_rounds,
            "total_points": total_points,
            "total_set_wins": total_set_wins,
            "seasons_with_activity": len(season_summaries),
        },
    }
