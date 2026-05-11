"""
Testes do schedule_engine — Sprint 4.
Cobre Art. 26 (deadline e WO), Art. 27 (interseção e slot oficial) e Art. 28 (elegibilidade).
"""
import pytest

from engines.schedule_engine import (
    SLOTS_WEEKDAY,
    SLOTS_WEEKEND,
    brazilian_holidays,
    check_deadline_passed,
    eligible_slots,
    intersect_slots,
    pick_official_slot,
    resolve_group_slot,
    validate_slot,
)

# ---------------------------------------------------------------------------
# Art. 28 — eligible_slots
# ---------------------------------------------------------------------------

def test_eligible_weekday_monday():
    """Segunda-feira retorna 13 slots (4 manhã + 9 tarde)."""
    slots = eligible_slots("2026-06-01")  # 01/06/2026 = segunda
    assert slots == SLOTS_WEEKDAY
    assert len(slots) == 13


def test_eligible_weekday_friday():
    """Sexta-feira retorna slots de dia útil."""
    slots = eligible_slots("2026-06-05")  # sexta
    assert slots == SLOTS_WEEKDAY


def test_eligible_saturday():
    """Sábado retorna 6 slots (07:00-09:30)."""
    slots = eligible_slots("2026-06-06")  # sábado
    assert slots == SLOTS_WEEKEND
    assert len(slots) == 6


def test_eligible_sunday():
    """Domingo retorna slots de fim de semana."""
    slots = eligible_slots("2026-06-07")  # domingo
    assert slots == SLOTS_WEEKEND


def test_eligible_holiday_on_weekday():
    """Feriado em dia útil retorna slots de fim de semana (Art. 28)."""
    # 01/01/2026 = quinta-feira, mas é feriado
    holidays = ["2026-01-01"]
    slots = eligible_slots("2026-01-01", holidays=holidays)
    assert slots == SLOTS_WEEKEND


def test_eligible_no_holiday_list():
    """Sem lista de feriados, sexta é tratada como dia útil."""
    slots = eligible_slots("2026-09-07")  # Independência — sexta em 2026
    assert slots == SLOTS_WEEKDAY  # sem holidays informados, trata como útil


def test_eligible_holiday_explicit():
    """Com feriado informado, dia útil vira fim-de-semana."""
    slots = eligible_slots("2026-09-07", holidays=["2026-09-07"])
    assert slots == SLOTS_WEEKEND


def test_eligible_weekday_morning_slots():
    """Manhã de dia útil: 06:00, 06:30, 07:00, 07:30."""
    slots = eligible_slots("2026-06-01")
    assert "06:00" in slots
    assert "07:30" in slots
    assert "08:00" not in slots  # 08:00 não é slot elegível


def test_eligible_weekday_afternoon_slots():
    """Tarde de dia útil: inicia em 16:30, termina em 20:30."""
    slots = eligible_slots("2026-06-01")
    assert "16:30" in slots
    assert "20:30" in slots
    assert "21:00" not in slots


def test_eligible_weekend_boundaries():
    """Fim de semana: 07:00 até 09:30; 10:00 não incluído."""
    slots = eligible_slots("2026-06-06")
    assert "07:00" in slots
    assert "09:30" in slots
    assert "10:00" not in slots
    assert "06:30" not in slots  # 06:30 é só de dia útil


def test_brazilian_holidays_has_8_fixed():
    holidays = brazilian_holidays(2026)
    assert "2026-01-01" in holidays
    assert "2026-04-21" in holidays
    assert "2026-05-01" in holidays
    assert "2026-09-07" in holidays
    assert "2026-10-12" in holidays
    assert "2026-11-02" in holidays
    assert "2026-11-15" in holidays
    assert "2026-12-25" in holidays
    assert len(holidays) == 8


# ---------------------------------------------------------------------------
# Art. 27 — intersect_slots e pick_official_slot
# ---------------------------------------------------------------------------

def test_intersect_all_agree():
    """Todos com o mesmo slot → interseção = esse slot."""
    athletes = {"a1": ["06:00", "06:30"], "a2": ["06:00", "07:00"], "a3": ["06:00", "16:30"], "a4": ["06:00"]}
    common = intersect_slots(athletes)
    assert common == ["06:00"]


def test_intersect_multiple_common():
    """Múltiplos slots em comum → todos retornados, ordenados."""
    athletes = {
        "a1": ["06:00", "06:30", "07:00"],
        "a2": ["06:00", "06:30", "16:30"],
        "a3": ["06:00", "06:30", "20:30"],
        "a4": ["06:00", "06:30"],
    }
    common = intersect_slots(athletes)
    assert common == ["06:00", "06:30"]


def test_intersect_no_common():
    """Sem slot em comum → lista vazia."""
    athletes = {"a1": ["06:00"], "a2": ["06:30"], "a3": ["07:00"], "a4": ["16:30"]}
    assert intersect_slots(athletes) == []


def test_intersect_empty_dict():
    assert intersect_slots({}) == []


def test_intersect_single_athlete():
    """1 atleta → retorna os próprios slots."""
    athletes = {"a1": ["06:00", "06:30"]}
    assert intersect_slots(athletes) == ["06:00", "06:30"]


def test_intersect_ignores_empty_lists():
    """Atletas sem slots são ignorados na interseção (se passados com lista vazia)."""
    athletes = {"a1": ["06:00"], "a2": ["06:00"], "a3": []}
    # Lista vazia é ignorada; interseção de a1 e a2 = ["06:00"]
    common = intersect_slots(athletes)
    assert common == ["06:00"]


def test_pick_official_slot_earliest():
    """Art. 27: escolhe o slot mais cedo."""
    assert pick_official_slot(["16:30", "06:00", "06:30"]) == "06:00"


def test_pick_official_slot_empty():
    assert pick_official_slot([]) is None


def test_pick_official_slot_single():
    assert pick_official_slot(["17:00"]) == "17:00"


# ---------------------------------------------------------------------------
# Art. 27 + Art. 26 — resolve_group_slot
# ---------------------------------------------------------------------------

def test_resolve_group_slot_resolved():
    """Grupo com slot em comum → status resolved com slot mais cedo."""
    group = ["a1", "a2", "a3", "a4"]
    slots_map = {
        "a1": ["06:00", "06:30"],
        "a2": ["06:00", "07:00"],
        "a3": ["06:00", "16:30"],
        "a4": ["06:00", "17:00"],
    }
    result = resolve_group_slot(group, slots_map)
    assert result["status"] == "resolved"
    assert result["slot"] == "06:00"
    assert result["wo_athlete_ids"] == []
    assert set(result["participating_ids"]) == {"a1", "a2", "a3", "a4"}


def test_resolve_group_slot_needs_mediation():
    """Sem slot em comum → status needs_mediation."""
    group = ["a1", "a2", "a3", "a4"]
    slots_map = {
        "a1": ["06:00"],
        "a2": ["06:30"],
        "a3": ["07:00"],
        "a4": ["16:30"],
    }
    result = resolve_group_slot(group, slots_map)
    assert result["status"] == "needs_mediation"
    assert result["slot"] is None
    assert result["wo_athlete_ids"] == []


def test_resolve_group_slot_with_wo():
    """Art. 26: atleta sem slot → WO; interseção dos demais."""
    group = ["a1", "a2", "a3", "a4"]
    slots_map = {
        "a1": ["06:00", "06:30"],
        "a2": ["06:00"],
        "a3": ["06:00"],
        # a4 não marcou slots → WO automático
    }
    result = resolve_group_slot(group, slots_map)
    assert result["status"] == "resolved"
    assert result["slot"] == "06:00"
    assert result["wo_athlete_ids"] == ["a4"]
    assert "a4" not in result["participating_ids"]


def test_resolve_group_slot_all_wo():
    """Nenhum atleta marcou slots → all_wo."""
    group = ["a1", "a2", "a3", "a4"]
    slots_map = {}
    result = resolve_group_slot(group, slots_map)
    assert result["status"] == "all_wo"
    assert result["slot"] is None
    assert set(result["wo_athlete_ids"]) == set(group)


def test_resolve_group_slot_3_wo_1_participates():
    """3 WO: 1 atleta marcou → ainda needs_mediation (só 1 atleta, sem outros para intersetar)."""
    group = ["a1", "a2", "a3", "a4"]
    slots_map = {"a1": ["06:00"]}
    result = resolve_group_slot(group, slots_map)
    # 1 atleta com slot → interseção de 1 conjunto = o próprio slot
    assert result["status"] == "resolved"
    assert result["slot"] == "06:00"
    assert len(result["wo_athlete_ids"]) == 3


# ---------------------------------------------------------------------------
# Art. 26 — check_deadline_passed e validate_slot
# ---------------------------------------------------------------------------

def test_deadline_passed_old_date():
    assert check_deadline_passed("2020-01-01T00:00:00") is True


def test_deadline_not_passed_future():
    assert check_deadline_passed("2099-12-31T23:59:59") is False


def test_deadline_empty_string():
    assert check_deadline_passed("") is False


def test_deadline_none():
    assert check_deadline_passed(None) is False


def test_validate_slot_weekday_valid():
    assert validate_slot("06:00", "2026-06-01") is True
    assert validate_slot("16:30", "2026-06-01") is True
    assert validate_slot("20:30", "2026-06-01") is True


def test_validate_slot_weekday_invalid():
    assert validate_slot("08:00", "2026-06-01") is False   # não está na lista
    assert validate_slot("16:00", "2026-06-01") is False   # antes de 16:30
    assert validate_slot("21:00", "2026-06-01") is False   # fora do range


def test_validate_slot_weekend_valid():
    assert validate_slot("07:00", "2026-06-06") is True
    assert validate_slot("09:30", "2026-06-06") is True


def test_validate_slot_weekend_invalid():
    assert validate_slot("06:00", "2026-06-06") is False   # só em dia útil
    assert validate_slot("10:00", "2026-06-06") is False
