# Art. 21: Super Rei = maior média ponderada anual (A=1.0, B=0.7, C=0.5, D=0.3).
# Art. 22: Super Pato = menor média ponderada (mesma fórmula).
# Art. 23: Pato Anual por categoria.
# Elegibilidade: mín. 2 das 4 temporadas no ano, cada uma com ≥1 rodada como titular.

from __future__ import annotations

CATEGORY_WEIGHTS = {"A": 1.0, "B": 0.7, "C": 0.5, "D": 0.3}
CATEGORIES = ["A", "B", "C", "D"]


# ---------------------------------------------------------------------------
# weighted_score — Art. 21.1
# ---------------------------------------------------------------------------

def weighted_score(seasons_played: list[dict]) -> float:
    """
    soma(pts × peso_categoria) / nº_temporadas_jogadas.

    seasons_played: [{"category": "A"|"B"|"C"|"D", "points": int}, ...]
    """
    if not seasons_played:
        return 0.0
    total = sum(
        s["points"] * CATEGORY_WEIGHTS.get(s["category"], 0.0)
        for s in seasons_played
    )
    return round(total / len(seasons_played), 4)


# ---------------------------------------------------------------------------
# _athlete_seasons — extrai participação de um atleta em temporadas do ano
# ---------------------------------------------------------------------------

def _athlete_seasons(
    athlete_id: str,
    year: int,
    seasons_data: list[dict],
    results_data: list[dict],
) -> list[dict]:
    """
    Retorna lista de participações do atleta em temporadas fechadas do ano.

    Cada entrada: {"season_id", "category", "points", "rounds_played"}

    Uma temporada conta se:
    - season.year == year
    - season.status == "closed"
    - o atleta estava como titular (category_setup[cat].titular_ids)
    - tem ≥ 1 resultado confirmado na temporada (jogou ao menos 1 rodada)
    """
    participations = []
    for season in seasons_data:
        if season.get("year") != year:
            continue
        if season.get("status") != "closed":
            continue

        setup = season.get("category_setup", {})
        athlete_cat = None
        for cat in CATEGORIES:
            if athlete_id in setup.get(cat, {}).get("titular_ids", []):
                athlete_cat = cat
                break

        if not athlete_cat:
            continue

        # Verifica ≥1 resultado confirmado onde o atleta participou
        season_id = season["id"]
        season_results = [
            r for r in results_data
            if r.get("season_id") == season_id
            and r.get("status") == "confirmed"
            and athlete_id in r.get("group", [])
        ]
        if not season_results:
            continue

        # Soma pontos acumulados na temporada
        total_pts = 0
        for r in season_results:
            sc = r.get("scores", {}).get(athlete_id, {})
            total_pts += sc.get("total", 0)

        participations.append({
            "season_id": season_id,
            "season_name": season.get("name", season_id),
            "category": athlete_cat,
            "points": total_pts,
            "rounds_played": len(season_results),
        })

    return participations


# ---------------------------------------------------------------------------
# eligible_athletes — Art. 21.2
# ---------------------------------------------------------------------------

def eligible_athletes(
    athletes: list[dict],
    year: int,
    seasons_data: list[dict],
    results_data: list[dict],
) -> list[dict]:
    """
    Retorna atletas elegíveis: participaram em ≥ 2 temporadas fechadas do ano,
    cada uma com ≥ 1 rodada como titular.

    Retorna lista de dicts enriquecidos:
    {athlete_id, nome, category (final), seasons_played, weighted_score}
    """
    eligible = []
    for athlete in athletes:
        aid = athlete["id"]
        seasons_played = _athlete_seasons(aid, year, seasons_data, results_data)
        if len(seasons_played) < 2:
            continue

        score = weighted_score(seasons_played)
        # Categoria final = a da última temporada em que participou
        final_cat = seasons_played[-1]["category"]

        eligible.append({
            "athlete_id": aid,
            "nome": athlete.get("nome", aid),
            "category": final_cat,
            "seasons_played": seasons_played,
            "seasons_count": len(seasons_played),
            "weighted_score": score,
        })

    return eligible


# ---------------------------------------------------------------------------
# compute_annual_ranking — ranking anual completo
# ---------------------------------------------------------------------------

def compute_annual_ranking(
    athletes: list[dict],
    year: int,
    seasons_data: list[dict],
    results_data: list[dict],
) -> list[dict]:
    """
    Retorna lista ordenada (maior weighted_score primeiro) de atletas elegíveis.
    Inclui rank e título se aplicável.
    """
    elig = eligible_athletes(athletes, year, seasons_data, results_data)
    elig.sort(key=lambda x: x["weighted_score"], reverse=True)
    for i, entry in enumerate(elig):
        entry["rank"] = i + 1
    return elig


# ---------------------------------------------------------------------------
# compute_super_rei — Art. 21
# ---------------------------------------------------------------------------

def compute_super_rei(
    athletes: list[dict],
    year: int,
    seasons_data: list[dict],
    results_data: list[dict],
) -> dict | None:
    """Atleta elegível com maior pontuação ponderada anual."""
    ranking = compute_annual_ranking(athletes, year, seasons_data, results_data)
    return ranking[0] if ranking else None


# ---------------------------------------------------------------------------
# compute_super_pato — Art. 22
# ---------------------------------------------------------------------------

def compute_super_pato(
    athletes: list[dict],
    year: int,
    seasons_data: list[dict],
    results_data: list[dict],
) -> dict | None:
    """Atleta elegível com menor pontuação ponderada anual."""
    ranking = compute_annual_ranking(athletes, year, seasons_data, results_data)
    return ranking[-1] if ranking else None


# ---------------------------------------------------------------------------
# compute_pato_anual_by_category — Art. 23
# ---------------------------------------------------------------------------

def compute_pato_anual_by_category(
    athletes: list[dict],
    year: int,
    seasons_data: list[dict],
    results_data: list[dict],
) -> dict[str, dict | None]:
    """
    Art. 23: pior atleta elegível em cada categoria ao final do ano.
    Considera apenas atletas que terminaram o ano naquela categoria
    (última temporada participada).

    Retorna: {"A": entry|None, "B": entry|None, "C": entry|None, "D": entry|None}
    """
    elig = eligible_athletes(athletes, year, seasons_data, results_data)

    result: dict[str, dict | None] = {cat: None for cat in CATEGORIES}
    for cat in CATEGORIES:
        cat_elig = [e for e in elig if e["category"] == cat]
        if not cat_elig:
            continue
        # Pato = menor weighted_score na categoria
        result[cat] = min(cat_elig, key=lambda x: x["weighted_score"])

    return result


# ---------------------------------------------------------------------------
# compute_titles — consolida todos os títulos do ano
# ---------------------------------------------------------------------------

def compute_titles(
    athletes: list[dict],
    year: int,
    seasons_data: list[dict],
    results_data: list[dict],
) -> dict:
    """
    Retorna todos os títulos do ano:
    - super_rei: dict | None
    - super_pato: dict | None
    - pato_por_categoria: {cat: dict | None}
    - ranking_anual: [dict]
    - year: int
    """
    ranking = compute_annual_ranking(athletes, year, seasons_data, results_data)
    super_rei  = ranking[0] if ranking else None
    super_pato = ranking[-1] if ranking else None

    patos = compute_pato_anual_by_category(athletes, year, seasons_data, results_data)

    # Super Rei e Super Pato são o melhor/pior da lista geral, não por cat
    # (Art. 22 usa mesma fórmula do Art. 21)
    return {
        "year": year,
        "super_rei": super_rei,
        "super_pato": super_pato,
        "pato_por_categoria": patos,
        "ranking_anual": ranking,
        "eligible_count": len(ranking),
    }
