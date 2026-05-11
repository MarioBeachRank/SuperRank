# Art. 25: Sorteio greedy com custo mínimo de encontros — mínima repetição na temporada.
# Art. 7: Grupos de 4 com duplas rotativas; 3 sets por grupo.
# Art. 14: Tamanho quebrado → Reserva → Wildcard → Cancelamento.

import random
from itertools import combinations


# ---------------------------------------------------------------------------
# Rastreamento de encontros
# ---------------------------------------------------------------------------

def build_encounter_matrix(rounds: list, season_id: str, category: str) -> dict:
    """Conta quantas vezes cada par esteve no mesmo grupo em rodadas anteriores."""
    encounters: dict[str, dict[str, int]] = {}
    for rnd in rounds:
        if rnd.get("season_id") != season_id:
            continue
        for group in rnd.get("groups", {}).get(category, []):
            for a, b in combinations(group, 2):
                encounters.setdefault(a, {}).setdefault(b, 0)
                encounters.setdefault(b, {}).setdefault(a, 0)
                encounters[a][b] += 1
                encounters[b][a] += 1
    return encounters


def _group_cost(group: list, encounters: dict) -> int:
    """Custo total de um grupo = soma de encontros passados entre todos os pares."""
    return sum(
        encounters.get(a, {}).get(b, 0)
        for a, b in combinations(group, 2)
    )


# ---------------------------------------------------------------------------
# Art. 25 — Sorteio greedy com múltiplas tentativas
# ---------------------------------------------------------------------------

def draw_groups(athlete_ids: list, past_encounters: dict, seed: int = None) -> list[list]:
    """
    Art. 25: Greedy com custo mínimo de encontros.
    Tenta múltiplos seeds aleatórios e escolhe a partição com menor custo total.
    """
    if len(athlete_ids) % 4 != 0:
        raise ValueError(
            f"Número de atletas ({len(athlete_ids)}) não é múltiplo de 4 — Art. 5"
        )
    if len(athlete_ids) == 0:
        return []

    def greedy_partition(inner_seed: int) -> list[list]:
        rng = random.Random(inner_seed)
        remaining = list(athlete_ids)
        rng.shuffle(remaining)
        groups = []
        while remaining:
            group = [remaining.pop(0)]
            while len(group) < 4:
                # Escolhe o atleta com menor custo acumulado com o grupo já formado
                best = min(
                    remaining,
                    key=lambda a: sum(
                        past_encounters.get(m, {}).get(a, 0) for m in group
                    ),
                )
                remaining.remove(best)
                group.append(best)
            groups.append(group)
        return groups

    def total_cost(groups: list) -> int:
        return sum(_group_cost(g, past_encounters) for g in groups)

    # Art. 25: greedy — tenta N seeds diferentes, escolhe partição de menor custo
    n_attempts = max(1, min(30, len(athlete_ids) * 2))
    outer_rng = random.Random(seed)

    best_groups: list[list] = []
    best_cost = float("inf")

    for _ in range(n_attempts):
        inner_seed = outer_rng.randint(0, 999_999)
        groups = greedy_partition(inner_seed)
        cost = total_cost(groups)
        if cost < best_cost:
            best_cost = cost
            best_groups = groups
            if cost == 0:
                break  # Custo zero = nenhuma repetição, não há como melhorar

    return best_groups


# ---------------------------------------------------------------------------
# Art. 7 — Estrutura de sets dentro de cada grupo
# ---------------------------------------------------------------------------

def compute_group_sets(group: list) -> list[dict]:
    """
    Art. 7: duplas rotativas gerando 3 sets por grupo de 4.
    Set 1: (1+2) vs (3+4)
    Set 2: (1+3) vs (2+4)
    Set 3: (1+4) vs (2+3)
    """
    a1, a2, a3, a4 = group
    return [
        {"set": 1, "team_a": [a1, a2], "team_b": [a3, a4]},
        {"set": 2, "team_a": [a1, a3], "team_b": [a2, a4]},
        {"set": 3, "team_a": [a1, a4], "team_b": [a2, a3]},
    ]


# ---------------------------------------------------------------------------
# Orquestrador: sorteio para todas as categorias da temporada
# ---------------------------------------------------------------------------

def draw_all_categories(season: dict, past_rounds: list) -> dict:
    """
    Executa o sorteio para todas as categorias com atletas.
    Retorna dict por categoria: lista de grupos ou dict de erro.
    Art. 14: categorias com tamanho quebrado recebem error='broken_multiple'.
    """
    result = {}
    for cat in ["A", "B", "C", "D"]:
        setup = season["category_setup"].get(cat, {})
        titular_ids = setup.get("titular_ids", [])

        if not titular_ids:
            continue  # Categoria sem titulares — pula silenciosamente

        # Art. 14 + Art. 5: tamanho deve ser múltiplo de 4
        if len(titular_ids) % 4 != 0:
            result[cat] = {"error": "broken_multiple", "count": len(titular_ids)}
            continue

        encounters = build_encounter_matrix(past_rounds, season["id"], cat)
        groups = draw_groups(titular_ids, encounters)

        result[cat] = [
            {"athletes": group, "sets": compute_group_sets(group)}
            for group in groups
        ]

    return result


# ---------------------------------------------------------------------------
# Art. 14 — Tamanho quebrado e substituições
# ---------------------------------------------------------------------------

def detect_broken_category(titular_count: int) -> bool:
    """Art. 14: True se o número de titulares não é múltiplo de 4 (e há atletas)."""
    return titular_count > 0 and titular_count % 4 != 0


def convoke_reserve(category_setup: dict) -> str | None:
    """Art. 14 tentativa 1: retorna ID da primeira reserva disponível, ou None."""
    reservas = category_setup.get("reserva_ids", [])
    return reservas[0] if reservas else None


def offer_wildcard(ranking_lower_cat: list, already_offered: list) -> str | None:
    """
    Art. 14 tentativa 2: oferece wildcard ao 1º colocado da cat inferior ainda não recusado.
    ranking_lower_cat: IDs de atletas ordenados por posição no ranking (1º primeiro).
    already_offered: IDs que já recusaram nesta tentativa.
    """
    for athlete_id in ranking_lower_cat:
        if athlete_id not in already_offered:
            return athlete_id
    return None  # Nenhum disponível → tentativa 3 (cancelar rodada)
