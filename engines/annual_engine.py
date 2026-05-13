# Ranking Contínuo + Premiações Anuais.
# 5 prêmios, cada um com vencedor único garantido via critérios de desempate em cascata.
# Admin configura quais prêmios são ativos por Liga (active_awards).

from __future__ import annotations

AWARD_NAMES: dict[str, str] = {
    "rei_do_play":        "Rei do Play",
    "atleta_revelacao":   "Atleta Revelação",
    "pato_do_play":       "Pato do Play",
    "melhor_performance": "Melhor Performance",
    "maior_virada":       "Maior Virada",
}

AWARD_ICONS: dict[str, str] = {
    "rei_do_play":        "👑",
    "atleta_revelacao":   "🌟",
    "pato_do_play":       "🦆",
    "melhor_performance": "⚡",
    "maior_virada":       "📈",
}

ALL_AWARDS = list(AWARD_NAMES.keys())
CATEGORY_WEIGHTS = {"A": 1.0, "B": 0.7, "C": 0.5, "D": 0.3}
CATEGORIES = ["A", "B", "C", "D"]


# ---------------------------------------------------------------------------
# Helpers internos
# ---------------------------------------------------------------------------

def _athlete_seasons(
    athlete_id: str,
    year: int,
    seasons_data: list[dict],
    results_data: list[dict],
) -> list[dict]:
    """
    Participações do atleta em temporadas FECHADAS do ano.
    Retorna lista de: {season_id, season_name, category, points, rounds_played, start_date}
    """
    participations = []
    for season in seasons_data:
        if season.get("year") != year or season.get("status") != "closed":
            continue
        setup = season.get("category_setup", {})
        athlete_cat = next(
            (cat for cat in CATEGORIES
             if athlete_id in setup.get(cat, {}).get("titular_ids", [])),
            None,
        )
        if not athlete_cat:
            continue
        season_id = season["id"]
        season_results = [
            r for r in results_data
            if r.get("season_id") == season_id
            and r.get("status") == "confirmed"
            and athlete_id in r.get("group", [])
        ]
        if not season_results:
            continue
        total_pts = sum(
            r.get("scores", {}).get(athlete_id, {}).get("total", 0)
            for r in season_results
        )
        participations.append({
            "season_id": season_id,
            "season_name": season.get("name", season_id),
            "category": athlete_cat,
            "points": total_pts,
            "rounds_played": len(season_results),
            "start_date": season.get("start_date", ""),
        })
    return participations


def _weighted_score(seasons_played: list[dict]) -> float:
    if not seasons_played:
        return 0.0
    total = sum(
        s["points"] * CATEGORY_WEIGHTS.get(s["category"], 0.0)
        for s in seasons_played
    )
    return round(total / len(seasons_played), 4)


def _build_results_by_season(results_data: list[dict]) -> dict[str, list[dict]]:
    idx: dict[str, list[dict]] = {}
    for r in results_data:
        if r.get("status") == "confirmed":
            idx.setdefault(r.get("season_id", ""), []).append(r)
    return idx


# ---------------------------------------------------------------------------
# eligible_athletes — elegibilidade mínima (>= 2 temporadas fechadas no ano)
# ---------------------------------------------------------------------------

def eligible_athletes(
    athletes: list[dict],
    year: int,
    seasons_data: list[dict],
    results_data: list[dict],
) -> list[dict]:
    eligible = []
    for athlete in athletes:
        aid = athlete["id"]
        seasons_played = _athlete_seasons(aid, year, seasons_data, results_data)
        if len(seasons_played) < 2:
            continue
        score = _weighted_score(seasons_played)
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
# compute_annual_ranking — ranking anual por pontuação ponderada
# ---------------------------------------------------------------------------

def compute_annual_ranking(
    athletes: list[dict],
    year: int,
    seasons_data: list[dict],
    results_data: list[dict],
) -> list[dict]:
    elig = eligible_athletes(athletes, year, seasons_data, results_data)
    elig.sort(key=lambda x: x["weighted_score"], reverse=True)
    for i, e in enumerate(elig):
        e["rank"] = i + 1
    return elig


# ---------------------------------------------------------------------------
# 1. Rei do Play — maior média de pontos por rodada no ano
#    Desempate 1: mais vitórias (maior total no grupo naquela rodada)
#    Desempate 2: mais rodadas jogadas
# ---------------------------------------------------------------------------

def compute_rei_do_play(
    athletes: list[dict],
    year: int,
    seasons_data: list[dict],
    results_data: list[dict],
) -> dict | None:
    elig = eligible_athletes(athletes, year, seasons_data, results_data)
    if not elig:
        return None

    by_season = _build_results_by_season(results_data)

    for e in elig:
        aid = e["athlete_id"]
        total_rounds = sum(s["rounds_played"] for s in e["seasons_played"])
        total_pts = sum(s["points"] for s in e["seasons_played"])
        pts_per_round = round(total_pts / total_rounds, 4) if total_rounds else 0.0

        wins = 0
        for sp in e["seasons_played"]:
            for r in by_season.get(sp["season_id"], []):
                if aid not in r.get("group", []):
                    continue
                my_pts = r.get("scores", {}).get(aid, {}).get("total", 0)
                others = [
                    r.get("scores", {}).get(other, {}).get("total", 0)
                    for other in r["group"] if other != aid
                ]
                if others and my_pts > max(others):
                    wins += 1

        e["pts_per_round"] = pts_per_round
        e["total_rounds"] = total_rounds
        e["total_wins"] = wins
        e["total_pts"] = total_pts

    elig.sort(key=lambda x: (-x["pts_per_round"], -x["total_wins"], -x["total_rounds"]))
    winner = elig[0]
    return {**winner, "award": "rei_do_play", "award_name": AWARD_NAMES["rei_do_play"]}


# ---------------------------------------------------------------------------
# 2. Atleta Revelação — mais promoções de categoria no ano
#    Desempate 1: maior média de pontos nas temporadas do ano
#    Desempate 2: mais rodadas jogadas
# ---------------------------------------------------------------------------

def compute_atleta_revelacao(
    athletes: list[dict],
    year: int,
    seasons_data: list[dict],
    results_data: list[dict],
) -> dict | None:
    season_year = {s["id"]: s.get("year") for s in seasons_data}

    candidates = []
    for athlete in athletes:
        aid = athlete["id"]
        history = athlete.get("category_history", [])

        promotions = [
            h for h in history
            if season_year.get(h.get("season_id")) == year
            and h.get("from") in CATEGORIES
            and h.get("to") in CATEGORIES
            and CATEGORIES.index(h["to"]) < CATEGORIES.index(h["from"])
        ]
        if not promotions:
            continue

        seasons_played = _athlete_seasons(aid, year, seasons_data, results_data)
        if not seasons_played:
            continue

        total_pts = sum(s["points"] for s in seasons_played)
        total_rounds = sum(s["rounds_played"] for s in seasons_played)
        avg_pts = round(total_pts / len(seasons_played), 4)

        candidates.append({
            "athlete_id": aid,
            "nome": athlete.get("nome", aid),
            "category": seasons_played[-1]["category"],
            "seasons_played": seasons_played,
            "seasons_count": len(seasons_played),
            "weighted_score": _weighted_score(seasons_played),
            "promotions_count": len(promotions),
            "avg_pts": avg_pts,
            "total_rounds": total_rounds,
        })

    if not candidates:
        return None

    candidates.sort(key=lambda x: (-x["promotions_count"], -x["avg_pts"], -x["total_rounds"]))
    winner = candidates[0]
    return {**winner, "award": "atleta_revelacao", "award_name": AWARD_NAMES["atleta_revelacao"]}


# ---------------------------------------------------------------------------
# 3. Pato do Play — mais rebaixamentos de categoria no ano
#    Desempate 1: menor média de pontos
#    Desempate 2: menos rodadas jogadas
# ---------------------------------------------------------------------------

def compute_pato_do_play(
    athletes: list[dict],
    year: int,
    seasons_data: list[dict],
    results_data: list[dict],
) -> dict | None:
    season_year = {s["id"]: s.get("year") for s in seasons_data}

    candidates = []
    for athlete in athletes:
        aid = athlete["id"]
        history = athlete.get("category_history", [])

        demotions = [
            h for h in history
            if season_year.get(h.get("season_id")) == year
            and h.get("from") in CATEGORIES
            and h.get("to") in CATEGORIES
            and CATEGORIES.index(h["to"]) > CATEGORIES.index(h["from"])
        ]
        if not demotions:
            continue

        seasons_played = _athlete_seasons(aid, year, seasons_data, results_data)
        if not seasons_played:
            continue

        total_pts = sum(s["points"] for s in seasons_played)
        total_rounds = sum(s["rounds_played"] for s in seasons_played)
        avg_pts = round(total_pts / len(seasons_played), 4)

        candidates.append({
            "athlete_id": aid,
            "nome": athlete.get("nome", aid),
            "category": seasons_played[-1]["category"],
            "seasons_played": seasons_played,
            "seasons_count": len(seasons_played),
            "weighted_score": _weighted_score(seasons_played),
            "demotions_count": len(demotions),
            "avg_pts": avg_pts,
            "total_rounds": total_rounds,
        })

    if not candidates:
        return None

    # Mais rebaixamentos, depois pior média, depois menos rodadas
    candidates.sort(key=lambda x: (-x["demotions_count"], x["avg_pts"], x["total_rounds"]))
    winner = candidates[0]
    return {**winner, "award": "pato_do_play", "award_name": AWARD_NAMES["pato_do_play"]}


# ---------------------------------------------------------------------------
# 4. Melhor Performance — maior pontuação total numa única rodada do ano
#    Desempate 1: maior saldo de games (games ganhos − games perdidos) naquele resultado
#    Desempate 2: resultado mais recente
# ---------------------------------------------------------------------------

def compute_melhor_performance(
    athletes: list[dict],
    year: int,
    seasons_data: list[dict],
    results_data: list[dict],
) -> dict | None:
    year_season_ids = {s["id"] for s in seasons_data if s.get("year") == year}

    best: dict[str, dict] = {}

    for r in results_data:
        if r.get("status") != "confirmed":
            continue
        if r.get("season_id") not in year_season_ids:
            continue

        submitted_at = r.get("submitted_at", "")
        for aid in r.get("group", []):
            pts = r.get("scores", {}).get(aid, {}).get("total", 0)

            games_won = games_lost = 0
            for s in r.get("sets", []):
                if aid in s.get("team_a", []):
                    games_won += s.get("score_a", 0)
                    games_lost += s.get("score_b", 0)
                elif aid in s.get("team_b", []):
                    games_won += s.get("score_b", 0)
                    games_lost += s.get("score_a", 0)
            saldo = games_won - games_lost

            prev = best.get(aid)
            if (
                prev is None
                or pts > prev["pts"]
                or (pts == prev["pts"] and saldo > prev["saldo"])
                or (pts == prev["pts"] and saldo == prev["saldo"] and submitted_at > prev["submitted_at"])
            ):
                best[aid] = {
                    "pts": pts,
                    "saldo": saldo,
                    "submitted_at": submitted_at,
                    "round_id": r.get("round_id"),
                    "season_id": r.get("season_id"),
                }

    if not best:
        return None

    athletes_by_id = {a["id"]: a for a in athletes}

    candidates = []
    for aid, perf in best.items():
        if aid not in athletes_by_id:
            continue
        a = athletes_by_id[aid]
        seasons_played = _athlete_seasons(aid, year, seasons_data, results_data)
        candidates.append({
            "athlete_id": aid,
            "nome": a.get("nome", aid),
            "category": seasons_played[-1]["category"] if seasons_played else "?",
            "seasons_played": seasons_played,
            "seasons_count": len(seasons_played),
            "weighted_score": _weighted_score(seasons_played),
            "best_round_pts": perf["pts"],
            "best_round_saldo": perf["saldo"],
            "best_round_id": perf["round_id"],
        })

    if not candidates:
        return None

    candidates.sort(key=lambda x: (-x["best_round_pts"], -x["best_round_saldo"]))
    winner = candidates[0]
    return {**winner, "award": "melhor_performance", "award_name": AWARD_NAMES["melhor_performance"]}


# ---------------------------------------------------------------------------
# 5. Maior Virada — maior melhora de pontuação (última vs. primeira temporada, em ordem cronológica)
#    Exige ≥ 2 temporadas. Apenas atletas com melhora positiva são elegíveis.
#    Desempate 1: maior pontuação na última temporada
#    Desempate 2: mais rodadas jogadas no total
# ---------------------------------------------------------------------------

def compute_maior_virada(
    athletes: list[dict],
    year: int,
    seasons_data: list[dict],
    results_data: list[dict],
) -> dict | None:
    """
    Normaliza por rodadas jogadas (pts/rodada) para comparar temporadas de tamanhos diferentes.
    Virada = última_média - primeira_média (cronológico). Exige melhora positiva.
    """
    candidates = []
    for athlete in athletes:
        aid = athlete["id"]
        seasons_played = _athlete_seasons(aid, year, seasons_data, results_data)
        if len(seasons_played) < 2:
            continue

        seasons_sorted = sorted(seasons_played, key=lambda sp: sp.get("start_date", ""))

        def ppr(s):
            return round(s["points"] / s["rounds_played"], 4) if s["rounds_played"] else 0.0

        first_ppr = ppr(seasons_sorted[0])
        last_ppr  = ppr(seasons_sorted[-1])
        virada    = round(last_ppr - first_ppr, 4)
        if virada <= 0:
            continue

        total_rounds = sum(s["rounds_played"] for s in seasons_played)
        candidates.append({
            "athlete_id": aid,
            "nome": athlete.get("nome", aid),
            "category": seasons_sorted[-1]["category"],
            "seasons_played": seasons_played,
            "seasons_count": len(seasons_played),
            "weighted_score": _weighted_score(seasons_played),
            "virada": virada,
            "first_pts": first_ppr,
            "last_pts": last_ppr,
            "total_rounds": total_rounds,
        })

    if not candidates:
        return None

    candidates.sort(key=lambda x: (-x["virada"], -x["last_pts"], -x["total_rounds"]))
    winner = candidates[0]
    return {**winner, "award": "maior_virada", "award_name": AWARD_NAMES["maior_virada"]}


# ---------------------------------------------------------------------------
# compute_awards — entrada principal
# ---------------------------------------------------------------------------

def compute_awards(
    athletes: list[dict],
    year: int,
    seasons_data: list[dict],
    results_data: list[dict],
    active_awards: list[str] | None = None,
) -> dict:
    """
    Calcula todos os prêmios ativos para o ano.
    active_awards=None usa ALL_AWARDS.
    Retorna {"year", "active_awards", "awards": {key: winner|None}, "award_names", "award_icons"}
    """
    if active_awards is None:
        active_awards = ALL_AWARDS

    fns = {
        "rei_do_play":        lambda: compute_rei_do_play(athletes, year, seasons_data, results_data),
        "atleta_revelacao":   lambda: compute_atleta_revelacao(athletes, year, seasons_data, results_data),
        "pato_do_play":       lambda: compute_pato_do_play(athletes, year, seasons_data, results_data),
        "melhor_performance": lambda: compute_melhor_performance(athletes, year, seasons_data, results_data),
        "maior_virada":       lambda: compute_maior_virada(athletes, year, seasons_data, results_data),
    }

    awards_result: dict[str, dict | None] = {}
    for key in ALL_AWARDS:
        awards_result[key] = fns[key]() if key in active_awards else None

    return {
        "year": year,
        "active_awards": active_awards,
        "awards": awards_result,
        "award_names": AWARD_NAMES,
        "award_icons": AWARD_ICONS,
    }


# ---------------------------------------------------------------------------
# Backward-compat shims (usados pelas rotas existentes em app.py)
# ---------------------------------------------------------------------------

def weighted_score(seasons_played: list[dict]) -> float:
    return _weighted_score(seasons_played)


def compute_super_rei(athletes, year, seasons_data, results_data):
    return compute_rei_do_play(athletes, year, seasons_data, results_data)


def compute_super_pato(athletes, year, seasons_data, results_data):
    return compute_pato_do_play(athletes, year, seasons_data, results_data)


def compute_pato_anual_by_category(athletes, year, seasons_data, results_data):
    """Removido — retorna vazio para compatibilidade."""
    return {"A": None, "B": None, "C": None, "D": None}


def compute_titles(athletes, year, seasons_data, results_data) -> dict:
    awards = compute_awards(athletes, year, seasons_data, results_data)
    ranking = compute_annual_ranking(athletes, year, seasons_data, results_data)
    return {
        "year": year,
        "super_rei": awards["awards"].get("rei_do_play"),
        "super_pato": awards["awards"].get("pato_do_play"),
        "pato_por_categoria": {},
        "ranking_anual": ranking,
        "eligible_count": len(ranking),
        "awards": awards,
    }
