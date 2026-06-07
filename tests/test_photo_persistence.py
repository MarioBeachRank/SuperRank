"""Testes de persistência da foto do atleta e proteção de campos."""
import io
import json
import os
import pytest

# PNG 1x1 mínimo válido
_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000a49444154789c6360000002000154a24f5f0000000049454e44ae426082"
)

FILES = ["athletes.json", "seasons.json", "rounds.json", "results.json",
         "slots.json", "titles.json", "matches.json", "guest_requests.json"]


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
    c.post("/api/auth/admin", json={"password": "testpass"}, content_type="application/json")


def _seed_athlete(tmp, app, **extra):
    a = {"id": "a1", "nome": "Ana", "apelido": "Ana", "telefone": "71911110000",
         "pin_hash": app.hash_pin("1234"), "status": "ativo", "type": "titular"}
    a.update(extra)
    (tmp / "athletes.json").write_text(json.dumps({"version": 1, "data": [a]}), encoding="utf-8")


def test_foto_salva_no_DATA_DIR_e_e_servida(env):
    c, tmp, app = env
    _login_admin(c)
    _seed_athlete(tmp, app)
    resp = c.post("/api/athletes/a1/photo",
                  data={"photo": (io.BytesIO(_PNG), "x.png", "image/png")},
                  content_type="multipart/form-data")
    assert resp.status_code == 200, resp.get_json()
    url = resp.get_json()["photo_url"]
    assert url.startswith("/uploads/photos/")            # nova URL persistente
    # arquivo gravado dentro do DATA_DIR (volume), não em static/
    assert os.path.exists(tmp / "uploads" / "photos" / "a1.png")
    # photo_url persistido no athletes.json
    ath = json.loads((tmp / "athletes.json").read_text())["data"][0]
    assert ath["photo_url"] == url
    # a rota serve o arquivo
    assert c.get(url).status_code == 200


def test_foto_sobrevive_a_edicao_do_atleta(env):
    c, tmp, app = env
    _login_admin(c)
    _seed_athlete(tmp, app, photo_url="/uploads/photos/a1.png",
                  category_history=[{"season_id": "S", "from": "A", "to": "B"}])
    # edita só o nome
    resp = c.put("/api/athletes/a1", json={"nome": "Ana Maria"})
    assert resp.status_code == 200
    ath = json.loads((tmp / "athletes.json").read_text())["data"][0]
    assert ath["photo_url"] == "/uploads/photos/a1.png"   # foto preservada
    assert ath["category_history"]                          # histórico preservado


def test_birth_date_nao_e_zerado_quando_omitido(env):
    c, tmp, app = env
    _seed_athlete(tmp, app, birth_date="1990-05-10")
    c.post("/api/auth/atleta", json={"telefone": "71911110000", "pin": "1234"},
           content_type="application/json")
    # atleta edita só o apelido (sem mandar birth_date)
    resp = c.put("/api/mesa/profile", json={"apelido": "Aninha"})
    assert resp.status_code == 200
    ath = json.loads((tmp / "athletes.json").read_text())["data"][0]
    assert ath["birth_date"] == "1990-05-10"               # preservado
    assert ath["apelido"] == "Aninha"
