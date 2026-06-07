"""Passo A — vínculo admin↔atleta e sessão dual no login admin."""
import json
import pytest


FILES = ["athletes.json", "seasons.json", "rounds.json", "results.json",
         "admins.json", "guest_requests.json"]


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
        yield c, tmp_path, flask_app


def _login_admin(c):
    return c.post("/api/auth/admin", json={"password": "testpass"}, content_type="application/json")


def _athlete(tmp, **extra):
    a = {"id": "a1", "nome": "Mário Org", "apelido": "Mario", "status": "ativo"}
    a.update(extra)
    (tmp / "athletes.json").write_text(json.dumps({"version": 1, "data": [a]}), encoding="utf-8")


def test_login_admin_vinculado_popula_sessao_atleta(env):
    c, tmp, app = env
    _athlete(tmp)
    # super admin já com athlete_id vinculado
    (tmp / "admins.json").write_text(json.dumps({"version": 1, "data": [
        {"id": "adm1", "username": "admin", "password_hash": app.hash_pin("x"),
         "role": "super", "athlete_id": "a1"}
    ]}), encoding="utf-8")
    _login_admin(c)
    me = c.get("/api/auth/me").get_json()
    assert me["is_admin"] is True
    assert me["atleta"] and me["atleta"]["id"] == "a1"   # sessão dual!


def test_criar_perfil_de_atleta_vincula_e_abre_sessao(env):
    c, tmp, app = env
    _login_admin(c)            # super admin criado sem athlete_id
    resp = c.post("/api/admin/athlete-profile", json={"nome": "João Admin", "apelido": "Joao"})
    assert resp.status_code == 201, resp.get_json()
    assert resp.get_json()["created"] is True
    # agora a sessão tem atleta
    me = c.get("/api/auth/me").get_json()
    assert me["atleta"] is not None
    # admin/me mostra o vínculo
    assert c.get("/api/auth/admin/me").get_json()["athlete"] is not None
    # atleta entrou na lista
    assert any(a["nome"] == "João Admin" for a in json.loads((tmp / "athletes.json").read_text())["data"])


def test_rede_de_seguranca_conflito_oferece_vincular(env):
    c, tmp, app = env
    _athlete(tmp)              # já existe "Mário Org"
    _login_admin(c)
    resp = c.post("/api/admin/athlete-profile", json={"nome": "Mário Org", "apelido": "OutroApelido"})
    assert resp.status_code == 409
    d = resp.get_json()
    assert d.get("conflict") is True and d["athlete"]["id"] == "a1"


def test_vincular_a_existente(env):
    c, tmp, app = env
    _athlete(tmp)
    _login_admin(c)
    resp = c.post("/api/admin/athlete-profile", json={"link_athlete_id": "a1"})
    assert resp.status_code == 200 and resp.get_json()["linked"] is True
    assert c.get("/api/auth/me").get_json()["atleta"]["id"] == "a1"


def test_nao_vincula_duas_vezes(env):
    c, tmp, app = env
    _athlete(tmp)
    _login_admin(c)
    c.post("/api/admin/athlete-profile", json={"link_athlete_id": "a1"})
    again = c.post("/api/admin/athlete-profile", json={"nome": "X", "apelido": "X"})
    assert again.status_code == 409


def test_endpoint_exige_admin(env):
    c, tmp, app = env
    assert c.post("/api/admin/athlete-profile", json={"nome": "X", "apelido": "X"}).status_code in (401, 403)
