"""
Testes de integração — Sprint 13.
Usa Flask test client com diretório temporário de dados.
"""
import json
import os
import pytest
import importlib


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

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
def client(tmp_path, monkeypatch):
    for name, content in DATA_FILES.items():
        (tmp_path / name).write_text(json.dumps(content), encoding="utf-8")

    monkeypatch.setenv("ADMIN_PASSWORD", "testpass")
    monkeypatch.setenv("SECRET_KEY", "test-secret-key")

    import app as flask_app
    monkeypatch.setattr(flask_app, "DATA_DIR", str(tmp_path))
    flask_app.app.config.update(TESTING=True, SECRET_KEY="test-secret-key")

    with flask_app.app.test_client() as c:
        yield c


def _admin_login(client):
    return client.post(
        "/api/auth/admin",
        json={"password": "testpass"},
        content_type="application/json",
    )


def _create_athlete(client, nome="João Teste", pin="1234"):
    return client.post(
        "/api/athletes",
        json={"nome": nome, "pin": pin, "type": "titular"},
        content_type="application/json",
    )


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    data = r.get_json()
    assert data["status"] == "ok"


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

def test_admin_login_success(client):
    r = _admin_login(client)
    assert r.status_code == 200
    assert r.get_json()["ok"] is True


def test_admin_login_wrong_password(client):
    r = client.post("/api/auth/admin", json={"password": "errado"},
                    content_type="application/json")
    assert r.status_code == 401


def test_auth_me_not_logged_in(client):
    r = client.get("/api/auth/me")
    assert r.status_code == 200
    data = r.get_json()
    assert data["is_admin"] is False
    assert data["atleta"] is None


def test_admin_me_after_login(client):
    _admin_login(client)
    r = client.get("/api/auth/me")
    assert r.get_json()["is_admin"] is True


# ---------------------------------------------------------------------------
# Athletes
# ---------------------------------------------------------------------------

def test_athletes_list_empty(client):
    r = client.get("/api/athletes")
    assert r.status_code == 200
    assert r.get_json() == []


def test_delete_athlete_requires_admin(client):
    """Exclusão de atleta requer admin — sem login retorna 403."""
    # Sem login admin, DELETE deve ser barrado
    r = client.delete("/api/athletes/qualquer-id")
    assert r.status_code == 403


def test_create_athlete_success(client):
    _admin_login(client)
    r = _create_athlete(client)
    assert r.status_code == 201
    data = r.get_json()
    assert data["nome"] == "João Teste"
    assert "pin_hash" not in data


def test_create_athlete_duplicate_name(client):
    _admin_login(client)
    _create_athlete(client, nome="Duplicado")
    r = _create_athlete(client, nome="Duplicado")
    assert r.status_code == 409


def test_create_athlete_invalid_pin(client):
    _admin_login(client)
    r = _create_athlete(client, pin="abc")
    assert r.status_code == 400


def test_athletes_list_after_create(client):
    _admin_login(client)
    _create_athlete(client, nome="Maria")
    _create_athlete(client, nome="João")
    r = client.get("/api/athletes")
    assert len(r.get_json()) == 2


# ---------------------------------------------------------------------------
# Public routes
# ---------------------------------------------------------------------------

def test_search_short_query(client):
    r = client.get("/api/search?q=a")
    assert r.status_code == 200
    data = r.get_json()
    assert data["athletes"] == []


def test_search_finds_athlete(client):
    _admin_login(client)
    _create_athlete(client, nome="Fernanda Lima")
    r = client.get("/api/search?q=fern")
    data = r.get_json()
    assert any(a["nome"] == "Fernanda Lima" for a in data["athletes"])


def test_public_athlete_not_found(client):
    r = client.get("/api/athletes/nao-existe/public")
    assert r.status_code == 404


def test_public_athlete_profile(client):
    _admin_login(client)
    created = _create_athlete(client).get_json()
    r = client.get(f"/api/athletes/{created['id']}/public")
    assert r.status_code == 200
    data = r.get_json()
    assert data["nome"] == "João Teste"
    assert "pin_hash" not in data


# ---------------------------------------------------------------------------
# Admin stats + export
# ---------------------------------------------------------------------------

def test_admin_stats_requires_admin(client):
    r = client.get("/api/admin/stats")
    assert r.status_code == 403


def test_admin_stats_structure(client):
    _admin_login(client)
    r = client.get("/api/admin/stats")
    assert r.status_code == 200
    data = r.get_json()
    assert "total_athletes" in data
    assert "active_seasons" in data
    assert data["total_athletes"] == 0


def test_admin_export_requires_admin(client):
    r = client.get("/api/admin/export")
    assert r.status_code == 403


def test_admin_export_structure(client):
    _admin_login(client)
    r = client.get("/api/admin/export")
    assert r.status_code == 200
    data = r.get_json()
    assert "athletes" in data
    assert "seasons" in data
    assert "exported_at" in data
    for a in data["athletes"]:
        assert "pin_hash" not in a


# ---------------------------------------------------------------------------
# Titles (annual)
# ---------------------------------------------------------------------------

def test_annual_titles_empty(client):
    r = client.get("/api/annual/2026/titles")
    assert r.status_code == 200
    data = r.get_json()
    assert data["eligible_count"] == 0
    assert data["super_rei"] is None


def test_titles_gallery_empty(client):
    r = client.get("/api/titles")
    assert r.status_code == 200
    assert r.get_json()["titles"] == []


# ---------------------------------------------------------------------------
# Contested endpoint
# ---------------------------------------------------------------------------

def test_contested_requires_admin(client):
    r = client.get("/api/admin/contested")
    assert r.status_code == 403


def test_contested_empty(client):
    _admin_login(client)
    r = client.get("/api/admin/contested")
    assert r.status_code == 200
    data = r.get_json()
    assert data["contested"] == []
    assert data["count"] == 0
