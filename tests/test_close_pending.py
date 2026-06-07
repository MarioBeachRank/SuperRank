"""Testes do fechamento em lote de rodadas pendentes."""
import json
import pytest

FILES = ["athletes.json", "seasons.json", "rounds.json", "results.json",
         "slots.json", "titles.json", "matches.json", "ranking_snapshots.json"]


@pytest.fixture
def env(tmp_path, monkeypatch):
    for n in FILES:
        (tmp_path / n).write_text(json.dumps({"version": 1, "data": []}), encoding="utf-8")
    monkeypatch.setenv("SENHA_DE_ADMINISTRADOR", "testpass")
    monkeypatch.setenv("SECRET_KEY", "k")
    import app as flask_app
    monkeypatch.setattr(flask_app, "DATA_DIR", str(tmp_path))
    flask_app.app.config.update(TESTING=True, SECRET_KEY="k")
    with flask_app.app.test_client() as c:
        yield c, tmp_path


def _login(c):
    c.post("/api/auth/admin", json={"password": "testpass"}, content_type="application/json")


def _seed(tmp):
    (tmp / "seasons.json").write_text(json.dumps({"version": 1, "data": [
        {"id": "S1", "name": "T", "status": "active", "category_setup": {}}
    ]}), encoding="utf-8")
    (tmp / "rounds.json").write_text(json.dumps({"version": 1, "data": [
        {"id": "R1", "season_id": "S1", "round_number": 1, "status": "pending", "groups": {}},
        {"id": "R2", "season_id": "S1", "round_number": 2, "status": "pending", "groups": {}},
        {"id": "R3", "season_id": "S1", "round_number": 3, "status": "closed", "groups": {}},
    ]}), encoding="utf-8")


def _statuses(tmp):
    return {r["id"]: r["status"] for r in json.loads((tmp / "rounds.json").read_text())["data"]}


def test_fecha_pendentes(env):
    c, tmp = env
    _login(c)
    _seed(tmp)
    resp = c.post("/api/seasons/S1/rounds/close-pending", json={})
    assert resp.status_code == 200, resp.get_json()
    d = resp.get_json()
    assert d["closed"] == 2 and not d["blocked"]
    st = _statuses(tmp)
    assert st["R1"] == "closed" and st["R2"] == "closed" and st["R3"] == "closed"


def test_pula_rodada_contestada(env):
    c, tmp = env
    _login(c)
    _seed(tmp)
    # R2 tem resultado contestado -> deve ser pulada
    (tmp / "results.json").write_text(json.dumps({"version": 1, "data": [
        {"id": "RES1", "round_id": "R2", "season_id": "S1", "status": "contested"}
    ]}), encoding="utf-8")
    resp = c.post("/api/seasons/S1/rounds/close-pending", json={})
    d = resp.get_json()
    assert d["closed"] == 1                      # só R1
    assert len(d["blocked"]) == 1 and d["blocked"][0]["round_number"] == 2
    st = _statuses(tmp)
    assert st["R1"] == "closed" and st["R2"] == "pending"


def test_exige_admin(env):
    c, tmp = env
    _seed(tmp)
    assert c.post("/api/seasons/S1/rounds/close-pending", json={}).status_code in (401, 403)
