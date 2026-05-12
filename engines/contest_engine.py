# Sprint 13: Gestão de resultados contestados.

from __future__ import annotations

CONTESTABLE_STATUSES = {"contested", "pending_confirmation", "pending"}


def count_contested(results: list[dict]) -> int:
    """Número de resultados com status 'contested'."""
    return sum(1 for r in results if r.get("status") == "contested")


def can_override(result: dict) -> bool:
    """True se o admin pode fazer override do resultado."""
    return result.get("status") in CONTESTABLE_STATUSES


def compute_contested_summary(
    results: list[dict],
    athletes_by_id: dict,
) -> list[dict]:
    """
    Retorna lista de resultados contestados enriquecidos com nomes e detalhes.

    Cada entrada: {result_id, round_id, season_id, cat, group_idx,
                   group: [{athlete_id, nome, score, confirmation}],
                   contesters: [nome, ...]}
    """
    contested = [r for r in results if r.get("status") == "contested"]
    summaries = []
    for r in contested:
        group_detail = [
            {
                "athlete_id": aid,
                "nome": athletes_by_id.get(aid, {}).get("nome", aid),
                "score": r.get("scores", {}).get(aid, {}),
                "confirmation": r.get("confirmations", {}).get(aid),
            }
            for aid in r.get("group", [])
        ]
        contesters = [
            athletes_by_id.get(aid, {}).get("nome", aid)
            for aid, status in r.get("confirmations", {}).items()
            if status == "contested"
        ]
        contests_detail = [
            {
                "athlete_id": aid,
                "nome": athletes_by_id.get(aid, {}).get("nome", aid),
                "reason": c.get("reason"),
                "sets": c.get("sets"),
                "scores": c.get("scores"),
                "submitted_at": c.get("submitted_at"),
            }
            for aid, c in r.get("contests", {}).items()
        ]
        summaries.append({
            "result_id": r["id"],
            "round_id": r.get("round_id"),
            "season_id": r.get("season_id"),
            "cat": r.get("cat"),
            "group_idx": r.get("group_idx", 0),
            "group": group_detail,
            "contesters": contesters,
            "contests": contests_detail,
            "confirmations_count": len(r.get("confirmations", {})),
            "group_size": len(r.get("group", [])),
        })
    return summaries


def pending_confirmation_count(results: list[dict]) -> int:
    """Resultados que ainda aguardam confirmação de todos os atletas."""
    return sum(1 for r in results if r.get("status") == "pending_confirmation")


def resolution_summary(result: dict, athletes_by_id: dict) -> dict:
    """
    Resumo de resolução para exibição: quem confirmou, quem contestou, quem não respondeu.
    """
    group = result.get("group", [])
    confirmations = result.get("confirmations", {})
    confirmed = [athletes_by_id.get(aid, {}).get("nome", aid) for aid in group if confirmations.get(aid) == "confirmed"]
    contested  = [athletes_by_id.get(aid, {}).get("nome", aid) for aid in group if confirmations.get(aid) == "contested"]
    pending    = [athletes_by_id.get(aid, {}).get("nome", aid) for aid in group if aid not in confirmations]
    return {"confirmed": confirmed, "contested": contested, "pending": pending}
