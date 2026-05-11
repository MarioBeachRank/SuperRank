# Art. 8: Vitória=3pts, Derrota=1pt, WO=0pts.
# Art. 9: Set até 6 games; 5×5 → super tie-break 10pts diff≥2; NO-AD.
# Art. 10: WO total (0pts) e WO parcial (sets concluídos mantêm resultado).

from __future__ import annotations

# ---------------------------------------------------------------------------
# Validação de placar (Art. 9)
# ---------------------------------------------------------------------------

def validate_set_score(games_a: int, games_b: int, is_super_tiebreak: bool = False) -> bool:
    """Valida se um placar de set é legítimo conforme Art. 9."""
    if not isinstance(games_a, int) or not isinstance(games_b, int):
        return False
    if games_a < 0 or games_b < 0:
        return False

    if is_super_tiebreak:
        # STB: primeiro a 10 com diff ≥ 2; mín de games = 10 (0-10 válido? não — vencedor ≥10)
        winner = max(games_a, games_b)
        loser  = min(games_a, games_b)
        if winner < 10:
            return False
        if winner - loser < 2:
            return False
        return True

    # Set normal: max 6 games por lado
    hi = max(games_a, games_b)
    lo = min(games_a, games_b)

    if hi > 6:
        return False
    if hi < 6:
        return False  # precisa chegar a 6

    # 6-x  valido apenas se x <= 4 (vitória clara) ou x == 5 (era 5x5, jogou STB → nunca cai aqui)
    # No contexto do regulamento, se chegou 5x5 deve jogar STB e registrar com is_super_tiebreak=True.
    # Portanto: 6-5 NÃO é placar válido num set normal (nunca chegará assim com regras corretas).
    if lo > 4:
        return False  # 6-5 inválido (deveria ter marcado STB), 6-6 impossível
    return True


def is_stb_needed(games_a: int, games_b: int) -> bool:
    """Retorna True se o placar parcial 5×5 indica que STB é necessário."""
    return games_a == 5 and games_b == 5


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
            errors.append(f"Set {set_num}: placar {sa}x{sb} inválido{'(STB)' if is_stb else ''}")

    return errors
