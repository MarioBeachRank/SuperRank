"""Testes do lançamento de resultados em lote (admin)."""
import json
import pytest


FILES = ["athletes.json", "seasons.json", "rounds.json", "results.json",
         "slots.json", "titles.json", "matches.json", "notifications.json"]


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
    g = {"A": [["a1", "a2", "a3", "a4"], ["b1", "b2", "b3", "b4"]]}
    (tmp / "rounds.json").write_text(json.dumps({"version": 1, "data": [
        {"id": "R1", "season_id": "S1", "round_number": 1, "status": "pending", "groups": g}
    ]}), encoding="utf-8")


def _sets(g, sa=6, sb=3):
    return [
        {"set": 1, "team_a": [g[0], g[1]], "team_b": [g[2], g[3]], "score_a": sa, "score_b": sb},
        {"set": 2, "team_a": [g[0], g[2]], "team_b": [g[1], g[3]], "score_a": sa, "score_b": sb},
        {"set": 3, "team_a": [g[0], g[3]], "team_b": [g[1], g[2]], "score_a": sa, "score_b": sb},
    ]


def _count_results(tmp):
    return len(json.loads((tmp / "results.json").read_text())["data"])


def test_batch_salva_validos_e_reporta_invalidos(env):
    c, tmp = env
    _login(c)
    _seed(tmp)
    g0 = ["a1", "a2", "a3", "a4"]
    g1 = ["b1", "b2", "b3", "b4"]
    body = {"results": [
        {"cat": "A", "group_idx": 0, "sets": _sets(g0, 6, 3)},          # válido
        {"cat": "A", "group_idx": 1, "sets": _sets(g1, 8, 3)},          # inválido (8-3)
    ]}
    resp = c.post("/api/rounds/R1/results/batch", json=body)
    assert resp.status_code == 200, resp.get_json()
    d = resp.get_json()
    assert d["saved"] == 1
    assert len(d["failed"]) == 1 and d["failed"][0]["group_idx"] == 1
    assert _count_results(tmp) == 1


def test_batch_sobrescreve_existente(env):
    c, tmp = env
    _login(c)
    _seed(tmp)
    g0 = ["a1", "a2", "a3", "a4"]
    c.post("/api/rounds/R1/results/batch", json={"results": [{"cat": "A", "group_idx": 0, "sets": _sets(g0, 6, 1)}]})
    c.post("/api/rounds/R1/results/batch", json={"results": [{"cat": "A", "group_idx": 0, "sets": _sets(g0, 6, 4)}]})
    assert _count_results(tmp) == 1  # não duplicou


def test_batch_exige_admin(env):
    c, tmp = env
    _seed(tmp)
    g0 = ["a1", "a2", "a3", "a4"]
    resp = c.post("/api/rounds/R1/results/batch", json={"results": [{"cat": "A", "group_idx": 0, "sets": _sets(g0)}]})
    assert resp.status_code in (401, 403)


def test_batch_rodada_inexistente(env):
    c, tmp = env
    _login(c)
    _seed(tmp)
    resp = c.post("/api/rounds/NOPE/results/batch", json={"results": [{"cat": "A", "group_idx": 0, "sets": []}]})
    assert resp.status_code == 404
