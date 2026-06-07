"""Testes do backup completo e restore."""
import json
import pytest


@pytest.fixture
def env(tmp_path, monkeypatch):
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
    w = lambda n, d: (tmp / n).write_text(json.dumps(d), encoding="utf-8")
    w("athletes.json", {"version": 1, "data": [{"id": "a1", "nome": "Ana", "pin_hash": "deadbeef"}]})
    w("ligas.json", {"version": 1, "data": [{"id": "L1", "name": "Liga"}]})
    w("settings.json", {"holidays": ["2026-01-01"]})   # dict plano (sem 'data')
    w("matches.json", [])                               # lista no topo


def test_backup_inclui_tudo_com_pins(env):
    c, tmp = env
    _login(c)
    _seed(tmp)
    resp = c.get("/api/admin/backup")
    assert resp.status_code == 200
    b = resp.get_json()
    assert b["superrank_backup"] is True
    files = b["files"]
    assert "athletes.json" in files and "ligas.json" in files
    assert "settings.json" in files and "matches.json" in files
    # PIN preservado no backup completo (ao contrário do export parcial)
    assert files["athletes.json"]["data"][0]["pin_hash"] == "deadbeef"


def test_restore_round_trip(env):
    c, tmp = env
    _login(c)
    _seed(tmp)
    backup = c.get("/api/admin/backup").get_json()
    # zera tudo
    for n in ("athletes.json", "ligas.json", "settings.json", "matches.json"):
        (tmp / n).write_text(json.dumps({"version": 1, "data": []}), encoding="utf-8")
    resp = c.post("/api/admin/restore", json={**backup, "confirm": True})
    assert resp.status_code == 200, resp.get_json()
    # dados restaurados verbatim, inclusive formatos fora do padrão
    assert json.loads((tmp / "athletes.json").read_text())["data"][0]["pin_hash"] == "deadbeef"
    assert json.loads((tmp / "ligas.json").read_text())["data"][0]["id"] == "L1"
    assert json.loads((tmp / "settings.json").read_text()) == {"holidays": ["2026-01-01"]}
    assert json.loads((tmp / "matches.json").read_text()) == []


def test_restore_exige_confirm(env):
    c, tmp = env
    _login(c)
    _seed(tmp)
    backup = c.get("/api/admin/backup").get_json()
    assert c.post("/api/admin/restore", json=backup).status_code == 400  # sem confirm


def test_restore_rejeita_arquivo_invalido(env):
    c, tmp = env
    _login(c)
    resp = c.post("/api/admin/restore", json={"foo": "bar", "confirm": True})
    assert resp.status_code == 400


def test_backup_e_restore_exigem_admin(env):
    c, tmp = env
    _seed(tmp)
    assert c.get("/api/admin/backup").status_code in (401, 403)
    assert c.post("/api/admin/restore", json={"superrank_backup": True, "files": {}, "confirm": True}).status_code in (401, 403)
