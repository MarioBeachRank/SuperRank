"""Testes da camada transacional (snapshot/rollback) de escrita."""
import pytest


@pytest.fixture
def appmod(tmp_path, monkeypatch):
    monkeypatch.setenv("SECRET_KEY", "k")
    monkeypatch.setenv("SENHA_DE_ADMINISTRADOR", "x")
    import app
    monkeypatch.setattr(app, "DATA_DIR", str(tmp_path))
    return app


def test_reverte_em_falha(appmod):
    app = appmod
    app.write_json("seasons.json", {"version": 1, "data": [{"id": "S1"}]})

    @app.transactional
    def op():
        app.write_json("seasons.json", {"version": 1, "data": []})            # apaga
        app.write_json("rounds.json", {"version": 1, "data": [{"id": "R1"}]})  # cria novo
        raise RuntimeError("falha no meio")

    with pytest.raises(RuntimeError):
        op()

    # seasons volta ao original; rounds (criado na transação) é removido
    assert app.read_json("seasons.json")["data"] == [{"id": "S1"}]
    assert app.read_json("rounds.json")["data"] == []  # arquivo removido -> default vazio


def test_confirma_em_sucesso(appmod):
    app = appmod
    app.write_json("seasons.json", {"version": 1, "data": [{"id": "S1"}]})

    @app.transactional
    def op():
        app.write_json("seasons.json", {"version": 1, "data": [{"id": "S1"}, {"id": "S2"}]})
        return "ok"

    assert op() == "ok"
    assert len(app.read_json("seasons.json")["data"]) == 2
