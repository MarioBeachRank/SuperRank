# Sprint 10: Estatísticas agregadas para o dashboard do admin.
# Sprint 12: Progresso da rodada ativa, rodadas vencidas, contestações.

from __future__ import annotations
from datetime import date


def _today() -> str:
    return date.today().isoformat()


def compute_round_progress(
    active_season_id: str | None,
    rounds: list[dict],
    results: list[dict],
) -> dict | None:
    """
    Progresso da rodada mais recente (não fechada) da temporada ativa.

    Retorna: {round_number, start_date, end_date, total_groups,
              confirmed, pending_confirmation, contested, not_launched,
              is_overdue}
    ou None se não houver rodada aberta.
    """
    if not active_season_id:
        return None

    season_rounds = [
        r for r in rounds
        if r.get("season_id") == active_season_id and r.get("status") != "closed"
    ]
    if not season_rounds:
        return None

    # Rodada mais recente aberta
    current = max(season_rounds, key=lambda r: r.get("round_number") or 0)

    # Conta grupos totais (grupos sorteados)
    groups_map = current.get("groups", {})
    total_groups = sum(len(g) for g in groups_map.values())

    if total_groups == 0:
        return None

    # Mapeia resultados desta rodada
    round_results = [r for r in results if r.get("round_id") == current["id"]]
    result_map: dict[str, str] = {}  # "cat-idx" -> status
    for r in round_results:
        key = f"{r.get('cat')}-{r.get('group_idx')}"
        result_map[key] = r.get("status", "")

    confirmed = sum(1 for s in result_map.values() if s == "confirmed")
    pending   = sum(1 for s in result_map.values() if s == "pending_confirmation")
    contested = sum(1 for s in result_map.values() if s == "contested")
    launched  = len(result_map)
    not_launched = total_groups - launched

    end_date = current.get("end_date") or current.get("target_date")
    is_overdue = bool(end_date and end_date < _today())

    return {
        "round_id":     current["id"],
        "round_number": current.get("round_number"),
        "start_date":   current.get("start_date"),
        "end_date":     end_date,
        "total_groups": total_groups,
        "confirmed":    confirmed,
        "pending_confirmation": pending,
        "contested":    contested,
        "not_launched": not_launched,
        "is_overdue":   is_overdue,
    }


def compute_overdue_rounds(
    active_season_id: str | None,
    rounds: list[dict],
    results: list[dict],
) -> list[dict]:
    """
    Lista de rodadas vencidas (data fim < hoje) que ainda têm grupos sem resultado confirmado.
    """
    if not active_season_id:
        return []

    today = _today()
    overdue = []
    for r in rounds:
        if r.get("season_id") != active_season_id:
            continue
        if r.get("status") == "closed":
            continue
        end_date = r.get("end_date") or r.get("target_date")
        if not end_date or end_date >= today:
            continue

        groups_map = r.get("groups", {})
        total_groups = sum(len(g) for g in groups_map.values())
        round_results = [res for res in results if res.get("round_id") == r["id"]]
        confirmed = sum(1 for res in round_results if res.get("status") == "confirmed")

        if confirmed < total_groups:
            overdue.append({
                "round_id":     r["id"],
                "round_number": r.get("round_number"),
                "end_date":     end_date,
                "total_groups": total_groups,
                "confirmed":    confirmed,
                "missing":      total_groups - confirmed,
            })

    return sorted(overdue, key=lambda r: r.get("round_number") or 0)


def compute_dashboard_stats(
    athletes: list[dict],
    seasons: list[dict],
    results: list[dict],
    rounds: list[dict],
) -> dict:
    """
    Métricas consolidadas para o painel admin.
    Sprint 12: adiciona round_progress, overdue_rounds, contested_count.
    """
    active_season = next((s for s in seasons if s.get("status") == "active"), None)
    active_season_id = active_season["id"] if active_season else None

    contested_count = sum(1 for r in results if r.get("status") == "contested")

    return {
        "total_athletes":       len(athletes),
        "active_athletes":      sum(1 for a in athletes if a.get("status") == "ativo"),
        "pending_registration": sum(1 for a in athletes if not a.get("admin_confirmed")),
        "total_seasons":        len(seasons),
        "active_seasons":       sum(1 for s in seasons if s.get("status") == "active"),
        "closed_seasons":       sum(1 for s in seasons if s.get("status") == "closed"),
        "active_season_id":     active_season_id,
        "active_season_name":   active_season.get("name") if active_season else None,
        "total_results":        len(results),
        "pending_results":      sum(1 for r in results if r.get("status") == "pending_confirmation"),
        "confirmed_results":    sum(1 for r in results if r.get("status") == "confirmed"),
        "contested_count":      contested_count,
        "total_rounds":         len(rounds),
        "active_rounds":        sum(1 for r in rounds if r.get("status") != "closed"),
        "round_progress":       compute_round_progress(active_season_id, rounds, results),
        "overdue_rounds":       compute_overdue_rounds(active_season_id, rounds, results),
    }


def pending_athletes(athletes: list[dict]) -> list[dict]:
    """Atletas que aguardam confirmação de categoria pelo admin."""
    return [a for a in athletes if not a.get("admin_confirmed")]


def athlete_needs_attention(athlete: dict) -> bool:
    """True se o atleta requer ação do admin (categoria não confirmada)."""
    return not athlete.get("admin_confirmed", False)
