"""
Testes da exclusão em cascata de temporada e liga (hard delete).
"""
import json
import pytest


DATA_FILES = [
    "athletes.json", "seasons.json", "rounds.json", "results.json",
    "slots.json", "titles.json", "matches.json", "ligas.json",
    "ranking_snapshots.json", "guest_requests.json", "injuries.json",
    "payments.json",
]


@pytest.fixture
def env(tmp_path, monkeypatch):
    for name in DATA_FILES:
        (tmp_path / name).write_text(json.dumps({"version": 1, "data": []}), encoding="utf-8")
    monkeypatch.setenv("SENHA_DE_ADMINISTRADOR", "testpass")
    monkeypatch.setenv("SECRET_KEY", "test-secret-key")
    import app as flask_app
    monkeypatch.setattr(flask_app, "DATA_DIR", str(tmp_path))
    flask_app.app.config.update(TESTING=True, SECRET_KEY="test-secret-key")
    with flask_app.app.test_client() as c:
        yield c, tmp_path


def _login(c):
    c.post("/api/auth/admin", json={"password": "testpass"},
           content_type="application/json")


def _seed(tmp, season_status="active", liga_id="L1"):
    w = lambda n, d: (tmp / n).write_text(json.dumps({"version": 1, "data": d}), encoding="utf-8")
    w("ligas.json", [{"id": liga_id, "name": "Liga Teste", "year": 2026, "seasons": ["S1"]}])
    w("seasons.json", [{"id": "S1", "name": "Temp Teste", "status": season_status,
                        "liga_id": liga_id, "category_setup": {}, "rounds_total": 1}])
    w("rounds.json", [{"id": "R1", "season_id": "S1", "round_number": 1, "status": "closed",
                       "groups": {}, "official_slots": {}}])
    w("results.json", [{"id": "RES1", "round_id": "R1", "season_id": "S1", "status": "confirmed"}])
    w("slots.json", [{"id": "SL1", "round_id": "R1"}])
    w("ranking_snapshots.json", [{"id": "SN1", "round_id": "R1", "season_id": "S1", "cat": "A"}])
    w("payments.json", [{"id": "P1", "season_id": "S1"}])
    w("athletes.json", [{"id": "a1", "nome": "X",
                         "category_history": [{"season_id": "S1", "from": "A", "to": "B"},
                                              {"season_id": "OUTRA", "from": "B", "to": "C"}]}])
    w("titles.json", [{"liga_id": liga_id, "year": 2026, "champion": "a1"}])


def _count(tmp, name):
    return len(json.loads((tmp / name).read_text())["data"])


def test_excluir_temporada_ativa_exige_confirm(env):
    c, tmp = env
    _login(c)
    _seed(tmp, season_status="active")
    resp = c.delete("/api/seasons/S1")  # sem confirm
    assert resp.status_code == 400
    assert _count(tmp, "seasons.json") == 1  # nada apagado


def test_excluir_temporada_cascata(env):
    c, tmp = env
    _login(c)
    _seed(tmp, season_status="active")
    resp = c.delete("/api/seasons/S1", json={"confirm": True})
    assert resp.status_code == 200, resp.get_json()
    d = resp.get_json()["deleted"]
    assert d["rounds"] == 1 and d["results"] == 1 and d["slots"] == 1
    assert d["ranking_snapshots"] == 1 and d["payments"] == 1
    assert d["category_history_entries"] == 1
    # tudo dependente foi apagado
    for n in ("seasons.json", "rounds.json", "results.json", "slots.json",
              "ranking_snapshots.json", "payments.json"):
        assert _count(tmp, n) == 0, n
    # atleta permanece, mas só com o histórico da OUTRA temporada
    ath = json.loads((tmp / "athletes.json").read_text())["data"]
    assert len(ath) == 1
    assert [h["season_id"] for h in ath[0]["category_history"]] == ["OUTRA"]
    # liga desvinculada
    liga = json.loads((tmp / "ligas.json").read_text())["data"][0]
    assert liga["seasons"] == []


def test_temporada_pendente_exclui_sem_confirm(env):
    c, tmp = env
    _login(c)
    _seed(tmp, season_status="pending")
    resp = c.delete("/api/seasons/S1")
    assert resp.status_code == 200
    assert _count(tmp, "seasons.json") == 0


def test_excluir_liga_cascata(env):
    c, tmp = env
    _login(c)
    _seed(tmp, season_status="active")
    resp = c.delete("/api/ligas/L1", json={"confirm": True})
    assert resp.status_code == 200, resp.get_json()
    body = resp.get_json()
    assert body["seasons_deleted"] == 1
    assert body["titles_removed"] == 1
    # liga, temporada, rodada, resultado e título sumiram
    for n in ("ligas.json", "seasons.json", "rounds.json", "results.json", "titles.json"):
        assert _count(tmp, n) == 0, n


def test_excluir_liga_com_temporadas_exige_confirm(env):
    c, tmp = env
    _login(c)
    _seed(tmp, season_status="active")
    resp = c.delete("/api/ligas/L1")  # sem confirm
    assert resp.status_code == 400
    assert resp.get_json()["seasons_count"] == 1
    assert _count(tmp, "ligas.json") == 1


def test_delete_exige_admin(env):
    c, tmp = env
    _seed(tmp, season_status="active")
    assert c.delete("/api/seasons/S1", json={"confirm": True}).status_code in (401, 403)
    assert c.delete("/api/ligas/L1", json={"confirm": True}).status_code in (401, 403)
