# Art. 26: Atleta marca slots até 48h antes da rodada; sem slot = WO automático.
# Art. 27: Interseção dos slots dos 4 atletas → slot mais cedo; sem interseção → admin media.
# Art. 28: Seg-Sex 06:00-08:00 e 16:30-21:00; Sáb/Dom/Feriado 07:00-10:00 (slots 30min).

from datetime import datetime, timezone

# ---------------------------------------------------------------------------
# Art. 28 — Slots elegíveis por tipo de dia
# ---------------------------------------------------------------------------

# Seg-Sex manhã: 06:00-08:00 (4 slots)
_WEEKDAY_MORNING = ["06:00", "06:30", "07:00", "07:30"]
# Seg-Sex tarde/noite: 16:30-21:00 (9 slots)
_WEEKDAY_AFTERNOON = [
    "16:30", "17:00", "17:30", "18:00", "18:30",
    "19:00", "19:30", "20:00", "20:30",
]
# Sáb/Dom/Feriado: 07:00-10:00 (6 slots)
_WEEKEND = ["07:00", "07:30", "08:00", "08:30", "09:00", "09:30"]

SLOTS_WEEKDAY = _WEEKDAY_MORNING + _WEEKDAY_AFTERNOON
SLOTS_WEEKEND = _WEEKEND

ALL_VALID_SLOTS = set(SLOTS_WEEKDAY + SLOTS_WEEKEND)


def eligible_slots(date_str: str, holidays: list[str] = None) -> list[str]:
    """Art. 28: slots elegíveis para a data; feriados tratados como fim de semana."""
    if holidays is None:
        holidays = []
    date = datetime.strptime(date_str, "%Y-%m-%d")
    # weekday(): 0=Seg … 4=Sex, 5=Sáb, 6=Dom
    if date_str in holidays or date.weekday() >= 5:
        return list(SLOTS_WEEKEND)
    return list(SLOTS_WEEKDAY)


def brazilian_holidays(year: int) -> list[str]:
    """Feriados nacionais fixos do Brasil. Variáveis (Carnaval, etc.) devem ser informados pelo admin."""
    return [
        f"{year}-01-01",  # Confraternização Universal
        f"{year}-04-21",  # Tiradentes
        f"{year}-05-01",  # Dia do Trabalho
        f"{year}-09-07",  # Independência
        f"{year}-10-12",  # Nossa Senhora Aparecida
        f"{year}-11-02",  # Finados
        f"{year}-11-15",  # Proclamação da República
        f"{year}-12-25",  # Natal
    ]


# ---------------------------------------------------------------------------
# Art. 27 — Algoritmo de interseção
# ---------------------------------------------------------------------------

def intersect_slots(athlete_slots: dict[str, list[str]]) -> list[str]:
    """
    Art. 27: calcula interseção dos slots de todos os atletas presentes no dict.
    Apenas atletas com lista não-vazia participam da interseção.
    """
    non_empty = [set(slots) for slots in athlete_slots.values() if slots]
    if not non_empty:
        return []
    common = non_empty[0]
    for s in non_empty[1:]:
        common = common & s
    return sorted(common)


def pick_official_slot(common_slots: list[str]) -> str | None:
    """Art. 27: escolhe o slot mais cedo cronologicamente; None se vazio."""
    if not common_slots:
        return None
    return sorted(common_slots)[0]


def resolve_group_slot(group: list[str], athlete_slots_map: dict[str, list[str]]) -> dict:
    """
    Art. 27: resolução completa do horário de um grupo.
    group: lista de IDs dos 4 atletas.
    athlete_slots_map: {athlete_id: [slots_marcados]} — lista vazia = sem slots.

    Retorna:
    {
      "slot": "06:00" | None,
      "status": "resolved" | "needs_mediation" | "all_wo",
      "wo_athlete_ids": [ids sem slots → WO automático — Art. 26],
      "participating_ids": [ids que marcaram slots]
    }
    """
    # Art. 26: atletas sem slots marcados recebem WO automático
    wo_athlete_ids = [aid for aid in group if not athlete_slots_map.get(aid)]
    participating = {aid: athlete_slots_map[aid] for aid in group if athlete_slots_map.get(aid)}

    if not participating:
        return {
            "slot": None,
            "status": "all_wo",
            "wo_athlete_ids": wo_athlete_ids,
            "participating_ids": [],
        }

    # Art. 27: interseção dos slots dos atletas participantes
    common = intersect_slots(participating)
    official = pick_official_slot(common)

    return {
        "slot": official,
        "status": "resolved" if official else "needs_mediation",
        "wo_athlete_ids": wo_athlete_ids,
        "participating_ids": list(participating.keys()),
    }


# ---------------------------------------------------------------------------
# Art. 26 — Prazo e WO automático
# ---------------------------------------------------------------------------

def check_deadline_passed(deadline_str: str) -> bool:
    """Art. 26: True se o prazo de marcação de slots já passou (compara com UTC agora)."""
    if not deadline_str:
        return False
    try:
        deadline = datetime.fromisoformat(deadline_str.replace("Z", "+00:00"))
        if deadline.tzinfo is None:
            deadline = deadline.replace(tzinfo=timezone.utc)
        return datetime.now(timezone.utc) > deadline
    except ValueError:
        return False


def validate_slot(slot: str, date_str: str, holidays: list[str] = None) -> bool:
    """Retorna True se o slot é elegível para a data informada."""
    return slot in eligible_slots(date_str, holidays or [])
