"""
Testes do cancelamento de rodada vazia e seu efeito no fechamento.
"""
import json
import pytest


DATA_FILES = {
    "athletes.json": {"version": 1, "data": []},
    "seasons.json":  {"version": 1, "data": []},
    "rounds.json":   {"version": 1, "data": []},
    "results.json":  {"version": 1, "data": []},
    "slots.json":    {"version": 1, "data": []},
    "titles.json":   {"version": 1, "data": []},
    "matches.json":  {"version": 1, "data": []},
}


@pytest.fixture
def env(tmp_path, monkeypatch):
    for name, content in DATA_FILES.items():
        (tmp_path / name).write_text(json.dumps(content), encoding="utf-8")
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


def _seed_round(tmp_path, season_id="S1", round_number=1, status="pending"):
    rounds = {"version": 1, "data": [{
        "id": "R1", "season_id": season_id, "round_number": round_number,
        "status": status, "groups": {"Cat A": [["a", "b", "c", "d"]]},
        "official_slots": {}, "wildcards": [],
    }]}
    (tmp_path / "rounds.json").write_text(json.dumps(rounds), encoding="utf-8")


def _seed_result(tmp_path, status="confirmed"):
    results = {"version": 1, "data": [{
        "id": "RES1", "round_id": "R1", "season_id": "S1",
        "cat": "Cat A", "status": status,
    }]}
    (tmp_path / "results.json").write_text(json.dumps(results), encoding="utf-8")


def test_cancela_rodada_vazia(env):
    c, tmp = env
    _login(c)
    _seed_round(tmp)
    resp = c.post("/api/rounds/R1/cancel")
    assert resp.status_code == 200, resp.get_json()
    assert resp.get_json()["status"] == "cancelled"
    data = json.loads((tmp / "rounds.json").read_text())
    assert data["data"][0]["status"] == "cancelled"
    assert "cancelled_at" in data["data"][0]


def test_nao_cancela_rodada_com_resultado(env):
    c, tmp = env
    _login(c)
    _seed_round(tmp)
    _seed_result(tmp, status="confirmed")
    resp = c.post("/api/rounds/R1/cancel")
    assert resp.status_code == 400
    assert "lançado" in resp.get_json()["error"]


def test_nao_cancela_rodada_encerrada(env):
    c, tmp = env
    _login(c)
    _seed_round(tmp, status="closed")
    resp = c.post("/api/rounds/R1/cancel")
    assert resp.status_code == 400


def test_cancel_exige_admin(env):
    c, tmp = env
    _seed_round(tmp)
    resp = c.post("/api/rounds/R1/cancel")
    assert resp.status_code in (401, 403)


def test_discard_apaga_resultados_e_cancela(env):
    c, tmp = env
    _login(c)
    _seed_round(tmp, status="closed")
    _seed_result(tmp, status="confirmed")
    resp = c.post("/api/rounds/R1/discard", json={"confirm": True})
    assert resp.status_code == 200, resp.get_json()
    assert resp.get_json()["results_removed"] == 1
    # rodada vira cancelada
    rounds = json.loads((tmp / "rounds.json").read_text())["data"]
    assert rounds[0]["status"] == "cancelled"
    assert rounds[0]["discarded_results_count"] == 1
    # resultado foi apagado
    results = json.loads((tmp / "results.json").read_text())["data"]
    assert all(r.get("round_id") != "R1" for r in results)


def test_discard_exige_confirmacao(env):
    c, tmp = env
    _login(c)
    _seed_round(tmp, status="closed")
    _seed_result(tmp, status="confirmed")
    resp = c.post("/api/rounds/R1/discard", json={})
    assert resp.status_code == 400
    # nada foi apagado
    results = json.loads((tmp / "results.json").read_text())["data"]
    assert len(results) == 1


def test_discard_exige_admin(env):
    c, tmp = env
    _seed_round(tmp, status="closed")
    resp = c.post("/api/rounds/R1/discard", json={"confirm": True})
    assert resp.status_code in (401, 403)


def test_rodada_cancelada_nao_bloqueia_fechamento(env):
    c, tmp = env
    _login(c)
    # Temporada ativa com uma rodada cancelada e nenhuma aberta.
    seasons = {"version": 1, "data": [{
        "id": "S1", "name": "Teste", "status": "active",
        "category_setup": {}, "rounds_total": 1,
    }]}
    (tmp / "seasons.json").write_text(json.dumps(seasons), encoding="utf-8")
    _seed_round(tmp, status="cancelled")
    resp = c.get("/api/seasons/S1/fechamento/preview")
    assert resp.status_code == 200, resp.get_json()
    assert resp.get_json()["open_rounds_count"] == 0
