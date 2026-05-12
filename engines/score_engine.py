# Art. 8: Vitória=3pts, Derrota=1pt, WO=0pts.
# Art. 9: Set até 6 games (vence quem chegar a 6 com adversário ≤ 4). Se chegar a 5-5 o set
#         continua até 7-5 (vantagem) ou 7-6 (Tie Break). NO-AD.
# Art. 10: WO total (0pts) e WO parcial (sets concluídos mantêm resultado).

from __future__ import annotations

# ---------------------------------------------------------------------------
# Validação de placar (Art. 9)
# ---------------------------------------------------------------------------

def validate_set_score(games_a: int, games_b: int, is_super_tiebreak: bool = False) -> bool:
    """
    Valida placar de set conforme Art. 9.
    Placares válidos:
      6-x  com x ∈ {0,1,2,3,4}  → vitória normal
      7-5                         → set prolongado (chegou a 6-5, jogou mais um game)
      7-6  (is_super_tiebreak=T)  → Tie Break
    """
    if not isinstance(games_a, int) or not isinstance(games_b, int):
        return False
    if games_a < 0 or games_b < 0:
        return False

    hi = max(games_a, games_b)
    lo = min(games_a, games_b)

    if hi == 6 and lo <= 4:
        return True   # 6-0 … 6-4

    if hi == 7 and lo == 5:
        return True   # 7-5

    if hi == 7 and lo == 6:
        return True   # 7-6 (Tie Break)

    return False


def is_tiebreak(games_a: int, games_b: int) -> bool:
    """Retorna True se o placar indica Tie Break (7-6)."""
    return max(games_a, games_b) == 7 and min(games_a, games_b) == 6


# ---------------------------------------------------------------------------
# Cálculo de pontos por set (Art. 8)
# ---------------------------------------------------------------------------

def calculate_set_points(games_a: int, games_b: int) -> tuple[int, int]:
    """Retorna (pts_a, pts_b): vencedor=3, perdedor=1."""
    if games_a == games_b:
        raise ValueError("Empate em games não é permitido num set encerrado")
    if games_a > games_b:
        return (3, 1)
    return (1, 3)


# ---------------------------------------------------------------------------
# WO total (Art. 10.1)
# ---------------------------------------------------------------------------

def apply_wo_total(group: list[str], absent_athlete: str) -> dict:
    """
    Art. 10.1: atleta ausente recebe 0pts em todos os sets.
    Os demais recebem 3pts × 3 sets cada (como se tivessem vencido todos).

    Retorna: {athlete_id: {"sets": [pts_s1, pts_s2, pts_s3], "total": pts}}
    """
    result: dict[str, dict] = {}
    for aid in group:
        if aid == absent_athlete:
            result[aid] = {"sets": [0, 0, 0], "total": 0, "wo": True}
        else:
            result[aid] = {"sets": [3, 3, 3], "total": 9, "wo": False}
    return result


# ---------------------------------------------------------------------------
# WO parcial (Art. 10.2)
# ---------------------------------------------------------------------------

def apply_wo_partial(
    sets_played: list[dict],
    absent_from_set: int,
    absent_athlete: str,
    group: list[str],
) -> dict:
    """
    Art. 10.2: sets já concluídos mantêm resultado.
    Sets restantes (a partir de absent_from_set): ausente recebe 0; demais recebem 3.

    sets_played: lista de dicts com chaves team_a, team_b, score_a, score_b, is_super_tiebreak
                 apenas os sets CONCLUÍDOS antes do abandono (sets 1..absent_from_set-1).
    absent_from_set: número do set (1, 2 ou 3) em que o atleta abandonou.
    absent_athlete: athlete_id que abandonou.
    group: lista ordenada de 4 athlete_ids (posições 0-3 determinam team_a/team_b por set).

    Retorna: {athlete_id: {"sets": [pts_s1, pts_s2, pts_s3], "total": pts, "wo_partial": True}}
    """
    # Inicializa pontos
    pts: dict[str, list[int]] = {aid: [0, 0, 0] for aid in group}

    # Processa sets concluídos
    for s in sets_played:
        set_idx = s["set"] - 1  # 0-indexed
        team_a: list[str] = s["team_a"]
        team_b: list[str] = s["team_b"]
        score_a: int = s["score_a"]
        score_b: int = s["score_b"]

        pts_a, pts_b = calculate_set_points(score_a, score_b)
        for aid in team_a:
            if aid in pts:
                pts[aid][set_idx] = pts_a
        for aid in team_b:
            if aid in pts:
                pts[aid][set_idx] = pts_b

    # Sets não concluídos (a partir do abandono)
    for set_num in range(absent_from_set, 4):  # sets 1-indexed, range usa 0-indexed offset
        set_idx = set_num - 1
        for aid in group:
            if aid == absent_athlete:
                pts[aid][set_idx] = 0
            else:
                pts[aid][set_idx] = 3

    result = {}
    for aid in group:
        total = sum(pts[aid])
        result[aid] = {
            "sets": pts[aid],
            "total": total,
            "wo_partial": aid == absent_athlete,
        }
    return result


# ---------------------------------------------------------------------------
# Cálculo completo do resultado de um grupo (Art. 7 + Art. 8)
# ---------------------------------------------------------------------------

def calculate_group_result(
    group: list[str],
    sets_scores: list[dict],
) -> dict:
    """
    Calcula pontos totais de cada atleta num grupo de 4 após os 3 sets.

    group: lista de 4 athlete_ids em ordem (pos 0-3, define pares por Art. 7).
    sets_scores: lista de 3 dicts:
      {"set": 1|2|3, "team_a": [id,id], "team_b": [id,id],
       "score_a": int, "score_b": int, "is_super_tiebreak": bool}

    Retorna: {athlete_id: {"sets": [pts_s1, pts_s2, pts_s3], "total": pts}}
    """
    pts: dict[str, list[int]] = {aid: [0, 0, 0] for aid in group}

    for s in sets_scores:
        set_idx = s["set"] - 1
        score_a: int = s["score_a"]
        score_b: int = s["score_b"]
        pts_a, pts_b = calculate_set_points(score_a, score_b)
        for aid in s["team_a"]:
            if aid in pts:
                pts[aid][set_idx] = pts_a
        for aid in s["team_b"]:
            if aid in pts:
                pts[aid][set_idx] = pts_b

    return {
        aid: {"sets": pts[aid], "total": sum(pts[aid])}
        for aid in group
    }


# ---------------------------------------------------------------------------
# Validação de um resultado de grupo completo
# ---------------------------------------------------------------------------

def validate_group_scores(sets_scores: list[dict]) -> list[str]:
    """
    Valida uma lista de 3 sets. Retorna lista de erros (vazia = tudo ok).
    """
    errors: list[str] = []
    if len(sets_scores) != 3:
        errors.append(f"Esperados 3 sets, recebidos {len(sets_scores)}")
        return errors

    for s in sets_scores:
        set_num = s.get("set")
        sa = s.get("score_a")
        sb = s.get("score_b")
        is_stb = s.get("is_super_tiebreak", False)

        if not isinstance(sa, int) or not isinstance(sb, int):
            errors.append(f"Set {set_num}: placar inválido ({sa} x {sb})")
            continue

        if not validate_set_score(sa, sb, is_stb):
            errors.append(f"Set {set_num}: placar {sa}×{sb} inválido. Válidos: 6-x (x≤4), 7-5, 7-6")

    return errors
