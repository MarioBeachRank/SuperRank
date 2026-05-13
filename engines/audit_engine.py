# Sprint 15: Log de auditoria de ações administrativas.

from __future__ import annotations
from datetime import datetime

AUDIT_ACTIONS = {
    "result_admin_confirm":  "Confirmação forçada de resultado",
    "result_override":       "Override de contestação",
    "result_wo_applied":     "WO aplicado",
    "season_closed":         "Temporada encerrada",
    "round_reopened":        "Rodada reaberta",
    "round_closed":          "Rodada encerrada manualmente",
    "season_edited":         "Temporada editada",
    "athlete_confirmed":     "Cadastro de atleta confirmado",
    "athlete_category_set":  "Categoria de atleta definida",
}


def build_entry(action: str, actor: str, details: dict) -> dict:
    return {
        "action":     action,
        "label":      AUDIT_ACTIONS.get(action, action),
        "actor":      actor,
        "details":    details,
        "created_at": datetime.utcnow().isoformat(),
    }


def recent_entries(entries: list[dict], limit: int = 100) -> list[dict]:
    """Retorna as `limit` entradas mais recentes."""
    return sorted(entries, key=lambda e: e.get("created_at", ""), reverse=True)[:limit]


def filter_by_action(entries: list[dict], action: str) -> list[dict]:
    return [e for e in entries if e.get("action") == action]
