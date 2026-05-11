# Art. 16: Movimentação adaptativa (4-7 atletas: 1+1; 8+ atletas: 2+2).
# Art. 17: Transação atômica — calcula tudo em paralelo, grava de uma vez.
# Art. 18: Empate na zona de limite → sorteio eletrônico.
# Art. 19: Fusão de categorias se alguma ficar com < 4 atletas.

from __future__ import annotations
import random

CATEGORY_ORDER = ["A", "B", "C", "D"]


# ---------------------------------------------------------------------------
# Art. 16 — tamanho do bloco de movimentação
# ---------------------------------------------------------------------------

def movement_count(category_size: int) -> int:
    """Art. 16: 4-7 atletas → 1 sobe/desce; 8+ → 2 sobem/descem."""
    return 2 if category_size >= 8 else 1


# ---------------------------------------------------------------------------
# Art. 18 — resolve empate na zona de corte
# ---------------------------------------------------------------------------

def resolve_boundary_tie(
    tied_athletes: list[str],
    needed: int,
    seed: int | None = None,
) -> tuple[list[str], list[str]]:
    """
    Se há empate na posição de corte (ex: 2 atletas disputam a última vaga de rebaixamento),
    sorteia quem passa para cada lado.

    Retorna (selected, excluded):
    - selected: athlete_ids que ENTRAM na zona de movimento (sobem ou descem)
    - excluded: os que ficam de fora do sorteio
    """
    rng = random.Random(seed)
    shuffled = list(tied_athletes)
    rng.shuffle(shuffled)
    return shuffled[:needed], shuffled[needed:]


# ---------------------------------------------------------------------------
# Art. 17 — compute_movements (somente leitura, não grava)
# ---------------------------------------------------------------------------

def compute_movements(
    season_rankings: dict[str, list[dict]],
    seed: int | None = None,
) -> dict:
    """
    Calcula o plano de movimentação sem aplicar.

    season_rankings: {cat: [{"athlete_id":..., "rank":..., "points":...}, ...]}
                     já ordenados (rank=1 = melhor).

    Retorna:
    {
      "promotions":  {athlete_id: {"from": cat, "to": cat}},
      "relegations": {athlete_id: {"from": cat, "to": cat}},
      "stays":       {athlete_id: cat},
      "tie_breaks":  [{"cat": cat, "position": "top"|"bottom", "athletes": [...], "selected": [...]}],
      "fusions":     [(cat_small, cat_absorb)],  # Art. 19
      "warnings":    [str],
    }
    """
    promotions: dict[str, dict] = {}
    relegations: dict[str, dict] = {}
    tie_breaks: list[dict] = []
    warnings: list[str] = []

    # Coleta os IDs que serão promovidos / rebaixados por categoria
    # (calculado em paralelo, não aplicado ainda — Art. 17)
    promoted_set: set[str] = set()
    relegated_set: set[str] = set()

    for idx, cat in enumerate(CATEGORY_ORDER):
        ranking = season_rankings.get(cat, [])
        if not ranking:
            continue

        n = len(ranking)
        m = movement_count(n)

        upper_cat = CATEGORY_ORDER[idx - 1] if idx > 0 else None
        lower_cat = CATEGORY_ORDER[idx + 1] if idx < len(CATEGORY_ORDER) - 1 else None

        # --- Promoções: m melhores sobem (exceto Cat A) ---
        if upper_cat is not None and n >= 4:
            top_candidates = ranking[:m]
            # Verifica empate no limite m (posição m vs m+1)
            if len(ranking) > m and ranking[m - 1]["points"] == ranking[m]["points"]:
                # Empate: quem mais tem esse placar?
                tied_ids = [
                    r["athlete_id"] for r in ranking
                    if r["points"] == ranking[m - 1]["points"]
                ]
                # Quantos do grupo empatado JÁ estão nos top_candidates?
                already_selected = [r["athlete_id"] for r in top_candidates if r["athlete_id"] in tied_ids]
                need_from_tied = m - (len([r for r in top_candidates if r["athlete_id"] not in tied_ids]))
                tied_not_selected = [a for a in tied_ids if a not in already_selected]
                if tied_not_selected and need_from_tied > 0 and need_from_tied < len(tied_ids):
                    selected, _ = resolve_boundary_tie(tied_ids, m - (m - len(already_selected) - len(tied_not_selected) + need_from_tied), seed)
                    tie_breaks.append({
                        "cat": cat, "position": "top",
                        "athletes": tied_ids, "selected": selected,
                    })
                    top_candidates = [r for r in ranking if r["athlete_id"] not in tied_ids][:m - len(selected)]
                    top_candidates = [{"athlete_id": a} for a in selected] + top_candidates

            for entry in top_candidates[:m]:
                aid = entry["athlete_id"]
                if aid not in promoted_set:
                    promoted_set.add(aid)
                    promotions[aid] = {"from": cat, "to": upper_cat}

        # --- Rebaixamentos: m piores descem (exceto Cat D e se cat inferior existir) ---
        lower_has_athletes = bool(season_rankings.get(lower_cat))
        if lower_cat is not None and n >= 4 and lower_has_athletes:
            bottom_candidates = ranking[-m:]
            bottom_ids = [r["athlete_id"] for r in bottom_candidates]

            # Verifica empate no limite inferior (posição n-m vs n-m-1)
            cutoff_idx = n - m
            if cutoff_idx > 0 and ranking[cutoff_idx]["points"] == ranking[cutoff_idx - 1]["points"]:
                tied_ids = [
                    r["athlete_id"] for r in ranking
                    if r["points"] == ranking[cutoff_idx]["points"]
                ]
                if len(tied_ids) > 1:
                    # Quantos do grupo empatado já estão na zona de rebaixamento?
                    already_down = [a for a in tied_ids if a in bottom_ids]
                    need = m - len([a for a in bottom_ids if a not in tied_ids])
                    if len(already_down) != need and need > 0:
                        selected, _ = resolve_boundary_tie(tied_ids, need, seed)
                        tie_breaks.append({
                            "cat": cat, "position": "bottom",
                            "athletes": tied_ids, "selected": selected,
                        })
                        bottom_ids = [a for a in bottom_ids if a not in tied_ids] + selected

            for aid in bottom_ids[:m]:
                if aid not in relegated_set and aid not in promoted_set:
                    relegated_set.add(aid)
                    relegations[aid] = {"from": cat, "to": lower_cat}

    # --- stays: atletas que ficam na categoria ---
    stays: dict[str, str] = {}
    for cat, ranking in season_rankings.items():
        for entry in ranking:
            aid = entry["athlete_id"]
            if aid not in promoted_set and aid not in relegated_set:
                stays[aid] = cat

    # --- Art. 19: verifica se alguma categoria ficará com < 4 ---
    # Simula tamanhos pós-movimentação
    sizes: dict[str, int] = {}
    for cat, ranking in season_rankings.items():
        incoming = sum(1 for v in promotions.values() if v["to"] == cat)
        incoming += sum(1 for v in relegations.values() if v["to"] == cat)
        outgoing = sum(1 for v in promotions.values() if v["from"] == cat)
        outgoing += sum(1 for v in relegations.values() if v["from"] == cat)
        sizes[cat] = len(ranking) - outgoing + incoming

    fusions = check_fusion_needed(sizes)
    for fcat, absorb in fusions:
        warnings.append(
            f"Cat {fcat} ficará com {sizes[fcat]} atleta(s) após movimentação "
            f"(mín 4 — Art. 5). Fusão com Cat {absorb} necessária."
        )

    return {
        "promotions": promotions,
        "relegations": relegations,
        "stays": stays,
        "tie_breaks": tie_breaks,
        "fusions": fusions,
        "warnings": warnings,
        "projected_sizes": sizes,
    }


# ---------------------------------------------------------------------------
# Art. 17 — apply_movements_atomic
# ---------------------------------------------------------------------------

def apply_movements_atomic(
    season: dict,
    movements: dict,
) -> dict:
    """
    Aplica o plano de movimentação atomicamente na category_setup da temporada.

    Retorna a nova category_setup (não grava; o chamador faz write_json).
    """
    category_setup: dict = {
        cat: {
            "titular_ids": list(data.get("titular_ids", [])),
            "reserva_ids": list(data.get("reserva_ids", [])),
        }
        for cat, data in season.get("category_setup", {}).items()
    }

    promotions = movements.get("promotions", {})
    relegations = movements.get("relegations", {})

    # Remove atletas das categorias de origem
    for aid, mv in {**promotions, **relegations}.items():
        from_cat = mv["from"]
        if aid in category_setup.get(from_cat, {}).get("titular_ids", []):
            category_setup[from_cat]["titular_ids"].remove(aid)

    # Insere nas categorias de destino
    for aid, mv in promotions.items():
        to_cat = mv["to"]
        if to_cat in category_setup and aid not in category_setup[to_cat]["titular_ids"]:
            category_setup[to_cat]["titular_ids"].append(aid)

    for aid, mv in relegations.items():
        to_cat = mv["to"]
        if to_cat in category_setup and aid not in category_setup[to_cat]["titular_ids"]:
            category_setup[to_cat]["titular_ids"].append(aid)

    return category_setup


# ---------------------------------------------------------------------------
# Art. 19 — fusão de categorias
# ---------------------------------------------------------------------------

def check_fusion_needed(category_sizes: dict[str, int]) -> list[tuple[str, str]]:
    """
    Art. 19: retorna pares (cat_pequena, cat_absorvente) onde tamanho < 4.
    A cat menor é fundida na mais próxima na hierarquia.
    """
    fusions: list[tuple[str, str]] = []
    for cat in CATEGORY_ORDER:
        size = category_sizes.get(cat, 0)
        if size > 0 and size < 4:
            idx = CATEGORY_ORDER.index(cat)
            absorb = CATEGORY_ORDER[idx + 1] if idx < len(CATEGORY_ORDER) - 1 else CATEGORY_ORDER[idx - 1]
            fusions.append((cat, absorb))
    return fusions


# ---------------------------------------------------------------------------
# Utilitário: sumário de movimentação legível
# ---------------------------------------------------------------------------

def movement_summary(movements: dict, athlete_names: dict[str, str]) -> list[dict]:
    """
    Converte o plano de movimentação em lista de dicts para exibição.
    athlete_names: {athlete_id: nome}
    """
    summary = []
    for aid, mv in movements.get("promotions", {}).items():
        summary.append({
            "athlete_id": aid,
            "nome": athlete_names.get(aid, aid),
            "action": "promoted",
            "from": mv["from"],
            "to": mv["to"],
        })
    for aid, mv in movements.get("relegations", {}).items():
        summary.append({
            "athlete_id": aid,
            "nome": athlete_names.get(aid, aid),
            "action": "relegated",
            "from": mv["from"],
            "to": mv["to"],
        })
    for aid, cat in movements.get("stays", {}).items():
        summary.append({
            "athlete_id": aid,
            "nome": athlete_names.get(aid, aid),
            "action": "stays",
            "from": cat,
            "to": cat,
        })
    return sorted(summary, key=lambda x: (x["from"], x["action"]))
