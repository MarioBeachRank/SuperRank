# Sprint 11: Histórico de resultados — sumário de rodada, histórico de temporada,
# histórico pessoal do atleta.

from __future__ import annotations

VALID_RESULT_STATUSES = {"confirmed", "pending", "contested", "overridden"}


def compute_round_summary(
    round_data: dict,
    results_data: list[dict],
    athletes_by_id: dict,
) -> dict:
    """
    Monta visão detalhada de uma rodada: cada grupo com scores dos atletas.

    Retorna: {round_id, round_number, season_id, status, target_date,
              groups: [{cat, group_idx, has_result, result_status, athletes}]}
    cada athletes entry: {athlete_id, nome, sets, total}
    """
    round_id = round_data["id"]
    round_results = [r for r in results_data if r.get("round_id") == round_id]

    group_summaries = []
    for cat in ("A", "B", "C", "D"):
        groups = round_data.get("groups", {}).get(cat, [])
        for idx, group in enumerate(groups):
            result = next(
                (r for r in round_results
                 if r.get("cat") == cat and r.get("group_idx") == idx),
                None,
            )
            athletes_with_scores = []
            for aid in group:
                sc = result.get("scores", {}).get(aid, {}) if result else {}
                athletes_with_scores.append({
                    "athlete_id": aid,
                    "nome": athletes_by_id.get(aid, {}).get("nome", aid),
                    "sets": sc.get("sets", []),
                    "total": sc.get("total"),
                })

            if result:
                athletes_with_scores.sort(
                    key=lambda x: x["total"] if x["total"] is not None else -1,
                    reverse=True,
                )

            group_summaries.append({
                "cat": cat,
                "group_idx": idx,
                "has_result": result is not None,
                "result_status": result.get("status") if result else None,
                "athletes": athletes_with_scores,
                "sets": result.get("sets", []) if result else [],
            })

    return {
        "round_id": round_id,
        "round_number": round_data.get("round_number"),
        "season_id": round_data.get("season_id"),
        "status": round_data.get("status"),
        "start_date": round_data.get("start_date"),
        "end_date": round_data.get("end_date"),
        "groups": group_summaries,
    }


def compute_season_history(
    rounds_data: list[dict],
    results_data: list[dict],
    athletes_by_id: dict,
    season_id: str | None = None,
) -> list[dict]:
    """
    Retorna lista de rodadas (opcionalmente filtradas por season_id),
    ordenadas por round_number, cada uma com sumário de resultados.
    """
    rounds = [r for r in rounds_data if not season_id or r.get("season_id") == season_id]
    rounds = sorted(rounds, key=lambda r: r.get("round_number") or 0)
    return [compute_round_summary(r, results_data, athletes_by_id) for r in rounds]


def compute_athlete_match_history(
    athlete_id: str,
    rounds_data: list[dict],
    results_data: list[dict],
    athletes_by_id: dict,
) -> list[dict]:
    """
    Histórico de participações do atleta em todas as rodadas.

    Cada entrada: {round_id, round_number, season_id, cat, target_date,
                   my_sets, my_total, rank_in_group, group_size, group_members,
                   result_status}

    Ordenado por round_number crescente.
    """
    rounds_by_id = {r["id"]: r for r in rounds_data}
    history = []

    for result in results_data:
        if athlete_id not in result.get("group", []):
            continue
        if result.get("status") not in VALID_RESULT_STATUSES:
            continue

        scores = result.get("scores", {})
        my_score = scores.get(athlete_id, {})

        # Rank inside the group by total points (higher = better)
        group_scores = [
            (aid, scores.get(aid, {}).get("total") or 0)
            for aid in result.get("group", [])
        ]
        group_scores.sort(key=lambda x: x[1], reverse=True)
        rank = next(
            (i + 1 for i, (aid, _) in enumerate(group_scores) if aid == athlete_id),
            None,
        )

        group_members = [
            {
                "athlete_id": aid,
                "nome": athletes_by_id.get(aid, {}).get("nome", aid),
                "total": scores.get(aid, {}).get("total"),
                "sets": scores.get(aid, {}).get("sets", []),
            }
            for aid in result.get("group", [])
            if aid != athlete_id
        ]

        # Placar real por set (score_mine / score_opp)
        my_sets_pts = my_score.get("sets", [])
        set_scores = []
        for i, set_def in enumerate(result.get("sets", [])):
            in_a = athlete_id in set_def.get("team_a", [])
            s_mine = set_def.get("score_a" if in_a else "score_b", 0)
            s_opp  = set_def.get("score_b" if in_a else "score_a", 0)
            pts = my_sets_pts[i] if i < len(my_sets_pts) else 0
            set_scores.append({
                "set": set_def.get("set", i + 1),
                "score_mine": s_mine,
                "score_opp": s_opp,
                "won": pts == 3,
                "wo": pts == 0,
                "is_super_tiebreak": set_def.get("is_super_tiebreak", False),
            })

        games_won  = sum(s["score_mine"] for s in set_scores if not s["wo"])
        games_lost = sum(s["score_opp"]  for s in set_scores if not s["wo"])

        rnd = rounds_by_id.get(result.get("round_id") or "", {})

        history.append({
            "round_id": result.get("round_id"),
            "round_number": rnd.get("round_number"),
            "season_id": result.get("season_id"),
            "cat": result.get("cat"),
            "target_date": rnd.get("target_date"),
            "my_sets": my_score.get("sets", []),
            "set_scores": set_scores,
            "games_won": games_won,
            "games_lost": games_lost,
            "my_total": my_score.get("total"),
            "rank_in_group": rank,
            "group_size": len(result.get("group", [])),
            "group_members": group_members,
            "result_status": result.get("status"),
        })

    history.sort(key=lambda x: x.get("round_number") or 0)
    return history
