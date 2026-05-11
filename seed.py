"""
seed.py — Popula data/ com dados de demonstração para o SuperRank.
16 atletas (4/cat), 1 temporada ativa, 2 rodadas (1 concluída + 1 pendente).

Uso: python3 seed.py
ATENÇÃO: sobrescreve os arquivos existentes em data/.
"""

import hashlib
import json
import os
import sys
import uuid
from datetime import datetime

ROOT = os.path.dirname(__file__)
sys.path.insert(0, ROOT)

from engines.draw_engine import compute_group_sets, draw_groups, build_encounter_matrix

DATA_DIR = os.path.join(ROOT, "data")


def uid() -> str:
    return str(uuid.uuid4())


def hash_pin(pin: str) -> str:
    return hashlib.sha256(pin.encode()).hexdigest()


def write(filename: str, payload: dict) -> None:
    path = os.path.join(DATA_DIR, filename)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)
    print(f"  ✓ {filename}")


def calc_scores(group: list, sets: list) -> dict:
    """Vitória = 3pts, derrota = 1pt por set (Art. 8)."""
    pts: dict[str, list] = {aid: [] for aid in group}
    for s in sets:
        for aid in s["team_a"]:
            pts[aid].append(3 if s["score_a"] > s["score_b"] else 1)
        for aid in s["team_b"]:
            pts[aid].append(3 if s["score_b"] > s["score_a"] else 1)
    return {aid: {"sets": pts[aid], "total": sum(pts[aid])} for aid in group}


DEFAULT_PIN = "1234"

# ---------------------------------------------------------------------------
# Atletas — 4 por categoria
# ---------------------------------------------------------------------------

ATHLETES_SPEC = [
    ("Rafael Costa",     "A"),
    ("Bruno Almeida",    "A"),
    ("Thiago Martins",   "A"),
    ("Caio Ferraz",      "A"),
    ("Lucas Ferreira",   "B"),
    ("Diego Santos",     "B"),
    ("André Lima",       "B"),
    ("João Paulo",       "B"),
    ("Paulo Mendes",     "C"),
    ("Rodrigo Souza",    "C"),
    ("Fabio Carvalho",   "C"),
    ("Marcelo Teixeira", "C"),
    ("Pedro Nascimento", "D"),
    ("Felipe Rocha",     "D"),
    ("Gustavo Nunes",    "D"),
    ("Eduardo Lima",     "D"),
]

athletes = [
    {
        "id": uid(),
        "nome": nome,
        "pin_hash": hash_pin(DEFAULT_PIN),
        "current_category": cat,
        "status": "ativo",
        "type": "titular",
        "admin_confirmed": True,
        "desired_category": cat,
        "category_history": [{"cat": cat, "since": "2026-01-01"}],
        "created_at": "2026-01-01T00:00:00",
    }
    for nome, cat in ATHLETES_SPEC
]

by_cat = {
    cat: [a["id"] for a in athletes if a["current_category"] == cat]
    for cat in "ABCD"
}

# ---------------------------------------------------------------------------
# Temporada ativa
# ---------------------------------------------------------------------------

season_id = uid()
season = {
    "id": season_id,
    "name": "Temporada 1/2026",
    "year": 2026,
    "rounds_total": 4,
    "start_date": "2026-04-01",
    "end_date": "2026-12-31",
    "status": "active",
    "location_mode": "single",
    "location": "Clube do Play",
    "category_setup": {
        cat: {"titular_ids": by_cat[cat], "reserva_ids": []}
        for cat in "ABCD"
    },
    "created_at": "2026-01-15T00:00:00",
}

# ---------------------------------------------------------------------------
# Rodada 1 (concluída, com resultados)
# ---------------------------------------------------------------------------

round1_id = uid()

draw_r1 = {
    cat: [{"athletes": g, "sets": compute_group_sets(g)}
          for g in draw_groups(by_cat[cat], {}, seed=42)]
    for cat in "ABCD"
}

groups_flat_r1 = {cat: [v["athletes"] for v in draw_r1[cat]] for cat in draw_r1}
groups_sets_r1 = {cat: [v["sets"]     for v in draw_r1[cat]] for cat in draw_r1}

round1 = {
    "id": round1_id,
    "season_id": season_id,
    "round_number": 1,
    "status": "completed",
    "target_date": "2026-04-10",
    "deadline_slots": None,
    "groups": groups_flat_r1,
    "groups_sets": groups_sets_r1,
    "official_slots": {
        cat: [{"slot": None, "status": "confirmed", "resolved_by": None, "wo_athlete_ids": []}
              for _ in groups_flat_r1[cat]]
        for cat in groups_flat_r1
    },
    "wildcards": [],
    "cancelled_categories": [],
    "draw_errors": {},
    "created_at": "2026-04-01T00:00:00",
}

# Placares — variados por categoria para demonstração
SCORES_BY_CAT = {
    "A": [(6, 3), (6, 4), (5, 6)],
    "B": [(6, 2), (4, 6), (6, 3)],
    "C": [(6, 1), (6, 5), (6, 4)],
    "D": [(6, 0), (6, 3), (3, 6)],
}

results = []
for cat in "ABCD":
    for gi, grp in enumerate(groups_flat_r1[cat]):
        scored_sets = [
            {**s,
             "score_a": SCORES_BY_CAT[cat][i][0],
             "score_b": SCORES_BY_CAT[cat][i][1],
             "is_super_tiebreak": False}
            for i, s in enumerate(groups_sets_r1[cat][gi])
        ]
        results.append({
            "id": uid(),
            "round_id": round1_id,
            "season_id": season_id,
            "cat": cat,
            "group_idx": gi,
            "group": grp,
            "sets": scored_sets,
            "scores": calc_scores(grp, scored_sets),
            "status": "confirmed",
            "submitted_by": "admin",
            "submitted_at": "2026-04-10T20:00:00",
            "confirmations": {aid: "confirmed" for aid in grp},
            "contest_reason": None,
        })

# ---------------------------------------------------------------------------
# Rodada 2 (pendente — grupos sorteados, sem resultado)
# ---------------------------------------------------------------------------

round2_id = uid()

draw_r2 = {
    cat: [{"athletes": g, "sets": compute_group_sets(g)}
          for g in draw_groups(by_cat[cat],
                               build_encounter_matrix([round1], season_id, cat),
                               seed=99)]
    for cat in "ABCD"
}

groups_flat_r2 = {cat: [v["athletes"] for v in draw_r2[cat]] for cat in draw_r2}
groups_sets_r2 = {cat: [v["sets"]     for v in draw_r2[cat]] for cat in draw_r2}

round2 = {
    "id": round2_id,
    "season_id": season_id,
    "round_number": 2,
    "status": "pending",
    "target_date": "2026-05-15",
    "deadline_slots": None,
    "groups": groups_flat_r2,
    "groups_sets": groups_sets_r2,
    "official_slots": {
        cat: [{"slot": None, "status": "pending", "resolved_by": None, "wo_athlete_ids": []}
              for _ in groups_flat_r2[cat]]
        for cat in groups_flat_r2
    },
    "wildcards": [],
    "cancelled_categories": [],
    "draw_errors": {},
    "created_at": "2026-04-20T00:00:00",
}

# ---------------------------------------------------------------------------
# Escreve arquivos
# ---------------------------------------------------------------------------

print("\nSuperRank — seed de demonstração")
print("=" * 36)
write("athletes.json", {"version": 1, "data": athletes})
write("seasons.json",  {"version": 1, "data": [season]})
write("rounds.json",   {"version": 1, "data": [round1, round2]})
write("results.json",  {"version": 1, "data": results})
write("slots.json",    {"version": 1, "data": []})
write("titles.json",   {"version": 1, "data": []})
write("matches.json",  {"version": 1, "data": []})
print()
print("  16 atletas (4 por categoria A/B/C/D)")
print("  1 temporada ativa: Temporada 1/2026")
print("  Rodada 1 concluída com resultados confirmados")
print("  Rodada 2 pendente (grupos já sorteados)")
print(f"  PIN padrão para todos os atletas: {DEFAULT_PIN}")
print()
