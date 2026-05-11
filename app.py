import os
import json
import uuid
import hashlib
import functools
from datetime import datetime
from flask import Flask, jsonify, render_template, request, session
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY", "dev-secret")

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
CATEGORIES = ["A", "B", "C", "D"]


# ---------------------------------------------------------------------------
# Helpers de persistência
# ---------------------------------------------------------------------------

def read_json(filename):
    path = os.path.join(DATA_DIR, filename)
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def write_json(filename, payload):
    """Lê, modifica em memória e grava atomicamente — nunca grava parcial."""
    path = os.path.join(DATA_DIR, filename)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def now_iso():
    return datetime.utcnow().isoformat()


def hash_pin(pin: str) -> str:
    return hashlib.sha256(pin.encode()).hexdigest()


# ---------------------------------------------------------------------------
# Decorators de autenticação
# ---------------------------------------------------------------------------

def require_admin(f):
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        if not session.get("is_admin"):
            return jsonify({"error": "Não autorizado"}), 403
        return f(*args, **kwargs)
    return decorated


def require_atleta(f):
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        if not session.get("atleta_id"):
            return jsonify({"error": "Não autenticado"}), 401
        return f(*args, **kwargs)
    return decorated


# ---------------------------------------------------------------------------
# Rota principal
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

@app.route("/api/auth/admin", methods=["POST"])
def auth_admin():
    body = request.get_json(silent=True) or {}
    if body.get("password") == os.getenv("ADMIN_PASSWORD"):
        session["is_admin"] = True
        return jsonify({"ok": True})
    return jsonify({"ok": False, "error": "Senha incorreta"}), 401


@app.route("/api/auth/atleta", methods=["POST"])
def auth_atleta():
    body = request.get_json(silent=True) or {}
    nome = (body.get("nome") or "").strip()
    pin = (body.get("pin") or "").strip()

    if not nome or not pin:
        return jsonify({"error": "Nome e PIN são obrigatórios"}), 400

    db = read_json("athletes.json")
    ph = hash_pin(pin)
    atleta = next(
        (a for a in db["data"]
         if a["nome"].lower() == nome.lower() and a["pin_hash"] == ph and a["status"] == "ativo"),
        None,
    )
    if not atleta:
        return jsonify({"error": "Nome ou PIN inválidos"}), 401

    session["atleta_id"] = atleta["id"]
    session["atleta_nome"] = atleta["nome"]
    return jsonify({"ok": True, "atleta": {"id": atleta["id"], "nome": atleta["nome"]}})


@app.route("/api/auth/logout", methods=["POST"])
def auth_logout():
    session.clear()
    return jsonify({"ok": True})


@app.route("/api/auth/me")
def auth_me():
    return jsonify({
        "is_admin": session.get("is_admin", False),
        "atleta": {
            "id": session.get("atleta_id"),
            "nome": session.get("atleta_nome"),
        } if session.get("atleta_id") else None,
    })


# ---------------------------------------------------------------------------
# Atletas
# ---------------------------------------------------------------------------

@app.route("/api/athletes", methods=["GET"])
def athletes_list():
    db = read_json("athletes.json")
    # Nunca expõe o pin_hash
    safe = [{k: v for k, v in a.items() if k != "pin_hash"} for a in db["data"]]
    return jsonify(safe)


@app.route("/api/athletes", methods=["POST"])
def athletes_create():
    """Cadastro público (self-registro) ou criação pelo admin."""
    body = request.get_json(silent=True) or {}
    nome = (body.get("nome") or "").strip()
    pin = (body.get("pin") or "").strip()
    tipo = body.get("type", "reserva")
    desired = body.get("desired_category")  # B/C/D ou None — Art. 6

    # Validações
    if not nome:
        return jsonify({"error": "Nome é obrigatório"}), 400
    if tipo not in ("titular", "reserva", "visitante"):
        return jsonify({"error": "Tipo inválido"}), 400
    if tipo in ("titular", "reserva") and (not pin or not pin.isdigit() or len(pin) != 4):
        return jsonify({"error": "PIN deve ter 4 dígitos numéricos"}), 400
    # Art. 6: Cat A não está disponível para auto-declaração
    if desired and desired not in ("B", "C", "D"):
        return jsonify({"error": "Categoria desejada deve ser B, C ou D"}), 400

    # Admin pode atribuir Cat A diretamente; não-admin não pode
    is_admin_request = session.get("is_admin", False)
    admin_cat = body.get("admin_category")  # apenas admin pode enviar
    if admin_cat and not is_admin_request:
        return jsonify({"error": "Apenas admin pode definir categoria diretamente"}), 403
    if admin_cat and admin_cat not in CATEGORIES:
        return jsonify({"error": "Categoria inválida"}), 400

    db = read_json("athletes.json")

    # Nome duplicado
    if any(a["nome"].lower() == nome.lower() for a in db["data"]):
        return jsonify({"error": "Já existe um atleta com este nome"}), 409

    atleta = {
        "id": str(uuid.uuid4()),
        "nome": nome,
        "pin_hash": hash_pin(pin) if pin else None,
        "type": tipo,
        "current_category": admin_cat if admin_cat else None,
        "desired_category": desired,
        "admin_confirmed": bool(admin_cat),
        "status": "ativo",
        "created_at": now_iso(),
        "category_history": [],
    }
    db["data"].append(atleta)
    write_json("athletes.json", db)

    safe = {k: v for k, v in atleta.items() if k != "pin_hash"}
    return jsonify(safe), 201


@app.route("/api/athletes/<athlete_id>", methods=["PUT"])
@require_admin
def athletes_update(athlete_id):
    body = request.get_json(silent=True) or {}
    db = read_json("athletes.json")
    atleta = next((a for a in db["data"] if a["id"] == athlete_id), None)
    if not atleta:
        return jsonify({"error": "Atleta não encontrado"}), 404

    # Campos editáveis
    if "nome" in body:
        nome = body["nome"].strip()
        if not nome:
            return jsonify({"error": "Nome não pode ser vazio"}), 400
        if any(a["nome"].lower() == nome.lower() and a["id"] != athlete_id for a in db["data"]):
            return jsonify({"error": "Nome já em uso"}), 409
        atleta["nome"] = nome

    if "pin" in body:
        pin = (body["pin"] or "").strip()
        if pin and (not pin.isdigit() or len(pin) != 4):
            return jsonify({"error": "PIN deve ter 4 dígitos numéricos"}), 400
        if pin:
            atleta["pin_hash"] = hash_pin(pin)

    if "type" in body:
        if body["type"] not in ("titular", "reserva", "visitante"):
            return jsonify({"error": "Tipo inválido"}), 400
        atleta["type"] = body["type"]

    if "status" in body:
        if body["status"] not in ("ativo", "inativo"):
            return jsonify({"error": "Status inválido"}), 400
        atleta["status"] = body["status"]

    if "current_category" in body:
        cat = body["current_category"]
        if cat is not None and cat not in CATEGORIES:
            return jsonify({"error": "Categoria inválida"}), 400
        atleta["current_category"] = cat
        atleta["admin_confirmed"] = True

    if "desired_category" in body:
        desired = body["desired_category"]
        if desired is not None and desired not in ("B", "C", "D"):
            return jsonify({"error": "Categoria desejada inválida (A proibida para auto-declaração)"}), 400
        atleta["desired_category"] = desired

    write_json("athletes.json", db)
    safe = {k: v for k, v in atleta.items() if k != "pin_hash"}
    return jsonify(safe)


@app.route("/api/athletes/<athlete_id>", methods=["DELETE"])
@require_admin
def athletes_delete(athlete_id):
    db = read_json("athletes.json")
    before = len(db["data"])
    db["data"] = [a for a in db["data"] if a["id"] != athlete_id]
    if len(db["data"]) == before:
        return jsonify({"error": "Atleta não encontrado"}), 404
    write_json("athletes.json", db)
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Temporadas
# ---------------------------------------------------------------------------

@app.route("/api/seasons", methods=["GET"])
def seasons_list():
    db = read_json("seasons.json")
    return jsonify(db["data"])


@app.route("/api/seasons", methods=["POST"])
@require_admin
def seasons_create():
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    year = body.get("year")
    start_date = (body.get("start_date") or "").strip()
    end_date = (body.get("end_date") or "").strip()
    rounds_total = body.get("rounds_total", 4)  # Art. 13: default 4 rodadas
    location_mode = body.get("location_mode", "single")
    location = (body.get("location") or "Clube do Play").strip()

    if not name:
        return jsonify({"error": "Nome da temporada é obrigatório"}), 400
    if not year or not isinstance(year, int) or year < 2020:
        return jsonify({"error": "Ano inválido"}), 400
    if not start_date or not end_date:
        return jsonify({"error": "Datas de início e fim são obrigatórias"}), 400
    if start_date >= end_date:
        return jsonify({"error": "Data de fim deve ser posterior à de início"}), 400
    if not isinstance(rounds_total, int) or rounds_total < 1:
        return jsonify({"error": "Número de rodadas inválido"}), 400
    if location_mode not in ("single", "multiple"):
        return jsonify({"error": "Modo de local inválido"}), 400

    season = {
        "id": str(uuid.uuid4()),
        "name": name,
        "year": year,
        "rounds_total": rounds_total,
        "start_date": start_date,
        "end_date": end_date,
        "status": "pending",
        "location_mode": location_mode,
        "location": location,
        # Art. 5: cada categoria começa vazia; admin preenche via /categories
        "category_setup": {
            cat: {"titular_ids": [], "reserva_ids": []}
            for cat in CATEGORIES
        },
        "created_at": now_iso(),
    }
    db = read_json("seasons.json")
    db["data"].append(season)
    write_json("seasons.json", db)
    return jsonify(season), 201


@app.route("/api/seasons/<season_id>", methods=["GET"])
def seasons_get(season_id):
    db = read_json("seasons.json")
    season = next((s for s in db["data"] if s["id"] == season_id), None)
    if not season:
        return jsonify({"error": "Temporada não encontrada"}), 404
    return jsonify(season)


@app.route("/api/seasons/<season_id>", methods=["PUT"])
@require_admin
def seasons_update(season_id):
    body = request.get_json(silent=True) or {}
    db = read_json("seasons.json")
    season = next((s for s in db["data"] if s["id"] == season_id), None)
    if not season:
        return jsonify({"error": "Temporada não encontrada"}), 404

    for field in ("name", "start_date", "end_date", "location", "location_mode", "status"):
        if field in body:
            season[field] = body[field]
    if "rounds_total" in body:
        season["rounds_total"] = int(body["rounds_total"])

    write_json("seasons.json", db)
    return jsonify(season)


# ---------------------------------------------------------------------------
# Configuração de categorias da temporada
# ---------------------------------------------------------------------------

@app.route("/api/seasons/<season_id>/categories/<cat>", methods=["GET"])
def category_get(season_id, cat):
    if cat not in CATEGORIES:
        return jsonify({"error": "Categoria inválida"}), 400
    db = read_json("seasons.json")
    season = next((s for s in db["data"] if s["id"] == season_id), None)
    if not season:
        return jsonify({"error": "Temporada não encontrada"}), 404
    return jsonify(season["category_setup"][cat])


@app.route("/api/seasons/<season_id>/categories/<cat>", methods=["PUT"])
@require_admin
def category_update(season_id, cat):
    if cat not in CATEGORIES:
        return jsonify({"error": "Categoria inválida"}), 400

    body = request.get_json(silent=True) or {}
    titular_ids = body.get("titular_ids", [])
    reserva_ids = body.get("reserva_ids", [])

    # Art. 5: titulares devem ser múltiplo de 4 (exceto temporada sem atletas ainda)
    if titular_ids and len(titular_ids) % 4 != 0:
        return jsonify({"error": f"Cat {cat}: número de titulares deve ser múltiplo de 4 (atual: {len(titular_ids)})"}), 400
    if titular_ids and len(titular_ids) < 4:
        return jsonify({"error": f"Cat {cat}: mínimo de 4 titulares"}), 400

    # Valida IDs de atletas
    athletes_db = read_json("athletes.json")
    all_ids = {a["id"] for a in athletes_db["data"]}
    bad = [aid for aid in titular_ids + reserva_ids if aid not in all_ids]
    if bad:
        return jsonify({"error": f"IDs de atletas inválidos: {bad}"}), 400

    # Titular não pode ser reserva na mesma categoria
    overlap = set(titular_ids) & set(reserva_ids)
    if overlap:
        return jsonify({"error": "Atleta não pode ser titular e reserva na mesma categoria"}), 400

    seasons_db = read_json("seasons.json")
    season = next((s for s in seasons_db["data"] if s["id"] == season_id), None)
    if not season:
        return jsonify({"error": "Temporada não encontrada"}), 404

    # Um titular não pode aparecer em outra categoria como titular na mesma temporada
    new_titulares = set(titular_ids)
    for other_cat, setup in season["category_setup"].items():
        if other_cat == cat:
            continue
        conflicting = new_titulares & set(setup["titular_ids"])
        if conflicting:
            athletes_db_map = {a["id"]: a["nome"] for a in athletes_db["data"]}
            names = [athletes_db_map.get(aid, aid) for aid in conflicting]
            return jsonify({"error": f"Atleta(s) já titular(es) em Cat {other_cat}: {', '.join(names)}"}), 400

    season["category_setup"][cat] = {
        "titular_ids": titular_ids,
        "reserva_ids": reserva_ids,
    }
    write_json("seasons.json", seasons_db)

    # Atualiza current_category dos atletas titulares
    changed = False
    for atleta in athletes_db["data"]:
        if atleta["id"] in new_titulares and atleta["current_category"] != cat:
            atleta["current_category"] = cat
            atleta["admin_confirmed"] = True
            changed = True
    if changed:
        write_json("athletes.json", athletes_db)

    return jsonify(season["category_setup"][cat])


# ---------------------------------------------------------------------------
# Rodadas
# ---------------------------------------------------------------------------

def _enrich_round(rnd: dict, athletes_by_id: dict) -> dict:
    """Adiciona nomes dos atletas aos grupos e aos sets para consumo do frontend."""
    enriched = dict(rnd)

    enriched["groups_named"] = {
        cat: [
            [athletes_by_id.get(aid, {}).get("nome", aid) for aid in group]
            for group in groups
        ]
        for cat, groups in rnd.get("groups", {}).items()
    }

    enriched["groups_sets_named"] = {
        cat: [
            [
                {
                    "set": s["set"],
                    "team_a": [athletes_by_id.get(aid, {}).get("nome", aid) for aid in s["team_a"]],
                    "team_b": [athletes_by_id.get(aid, {}).get("nome", aid) for aid in s["team_b"]],
                }
                for s in set_list
            ]
            for set_list in sets_per_group
        ]
        for cat, sets_per_group in rnd.get("groups_sets", {}).items()
    }

    return enriched


@app.route("/api/seasons/<season_id>/rounds", methods=["GET"])
def rounds_list(season_id):
    db = read_json("rounds.json")
    rounds = [r for r in db["data"] if r["season_id"] == season_id]
    athletes_by_id = {a["id"]: a for a in read_json("athletes.json")["data"]}
    enriched = [_enrich_round(r, athletes_by_id) for r in sorted(rounds, key=lambda r: r["round_number"])]
    return jsonify(enriched)


@app.route("/api/seasons/<season_id>/rounds", methods=["POST"])
@require_admin
def rounds_create(season_id):
    """Art. 25: Cria rodada e dispara sorteio greedy para todas as categorias."""
    from engines.draw_engine import draw_all_categories

    seasons_db = read_json("seasons.json")
    season = next((s for s in seasons_db["data"] if s["id"] == season_id), None)
    if not season:
        return jsonify({"error": "Temporada não encontrada"}), 404

    rounds_db = read_json("rounds.json")
    athletes_db = read_json("athletes.json")

    season_rounds = [r for r in rounds_db["data"] if r["season_id"] == season_id]
    round_number = len(season_rounds) + 1

    if round_number > season["rounds_total"]:
        return jsonify({"error": f"Temporada já atingiu o máximo de {season['rounds_total']} rodadas"}), 400

    body = request.get_json(silent=True) or {}
    deadline_slots = body.get("deadline_slots")
    target_date = body.get("target_date")  # Art. 28: data da rodada para slots elegíveis

    # Art. 25: sorteio greedy com mínima repetição
    draw_result = draw_all_categories(season, rounds_db["data"])

    groups_flat: dict[str, list] = {}
    groups_sets: dict[str, list] = {}
    draw_errors: dict[str, dict] = {}
    cancelled_categories: list[str] = []

    for cat, val in draw_result.items():
        if isinstance(val, list):
            groups_flat[cat] = [g["athletes"] for g in val]
            groups_sets[cat] = [g["sets"] for g in val]
        else:
            # Art. 14: tamanho quebrado — registra para tratamento posterior
            draw_errors[cat] = val
            cancelled_categories.append(cat)

    # Inicializa official_slots com status pending para cada grupo formado
    official_slots_init = {
        cat: [
            {"slot": None, "status": "pending", "resolved_by": None, "wo_athlete_ids": []}
            for _ in groups_flat[cat]
        ]
        for cat in groups_flat
    }

    round_obj = {
        "id": str(uuid.uuid4()),
        "season_id": season_id,
        "round_number": round_number,
        "status": "pending",
        "target_date": target_date,
        "deadline_slots": deadline_slots,
        "groups": groups_flat,
        "groups_sets": groups_sets,
        "official_slots": official_slots_init,
        "wildcards": [],
        "cancelled_categories": cancelled_categories,
        "draw_errors": draw_errors,
        "created_at": now_iso(),
    }

    rounds_db["data"].append(round_obj)
    write_json("rounds.json", rounds_db)

    athletes_by_id = {a["id"]: a for a in athletes_db["data"]}
    return jsonify(_enrich_round(round_obj, athletes_by_id)), 201


@app.route("/api/rounds/<round_id>", methods=["GET"])
def rounds_get(round_id):
    rounds_db = read_json("rounds.json")
    rnd = next((r for r in rounds_db["data"] if r["id"] == round_id), None)
    if not rnd:
        return jsonify({"error": "Rodada não encontrada"}), 404
    athletes_by_id = {a["id"]: a for a in read_json("athletes.json")["data"]}
    return jsonify(_enrich_round(rnd, athletes_by_id))


@app.route("/api/rounds/<round_id>", methods=["PUT"])
@require_admin
def rounds_update(round_id):
    """Permite atualizar status e deadline_slots de uma rodada."""
    body = request.get_json(silent=True) or {}
    rounds_db = read_json("rounds.json")
    rnd = next((r for r in rounds_db["data"] if r["id"] == round_id), None)
    if not rnd:
        return jsonify({"error": "Rodada não encontrada"}), 404

    valid_statuses = {"pending", "slots_open", "scheduled", "in_progress", "closed", "cancelled"}
    if "status" in body:
        if body["status"] not in valid_statuses:
            return jsonify({"error": "Status inválido"}), 400
        rnd["status"] = body["status"]

    for field in ("deadline_slots", "target_date"):
        if field in body:
            rnd[field] = body[field]

    write_json("rounds.json", rounds_db)
    athletes_by_id = {a["id"]: a for a in read_json("athletes.json")["data"]}
    return jsonify(_enrich_round(rnd, athletes_by_id))


# ---------------------------------------------------------------------------
# Slots — Art. 26 + Art. 27
# ---------------------------------------------------------------------------

def _find_athlete_group(rnd: dict, athlete_id: str) -> tuple[str | None, int | None]:
    """Retorna (categoria, group_index) do atleta na rodada, ou (None, None)."""
    for cat, groups in rnd.get("groups", {}).items():
        for idx, group in enumerate(groups):
            if athlete_id in group:
                return cat, idx
    return None, None


@app.route("/api/rounds/<round_id>/slots", methods=["GET"])
def slots_get(round_id):
    """Admin vê todos os slots; atleta vê apenas os seus."""
    slots_db = read_json("slots.json")
    round_slots = [s for s in slots_db["data"] if s["round_id"] == round_id]

    if session.get("is_admin"):
        return jsonify(round_slots)

    atleta_id = session.get("atleta_id")
    if not atleta_id:
        return jsonify({"error": "Não autenticado"}), 401

    my_slots = next((s for s in round_slots if s["athlete_id"] == atleta_id), None)
    return jsonify(my_slots or {"round_id": round_id, "athlete_id": atleta_id, "slots": []})


@app.route("/api/rounds/<round_id>/slots", methods=["PUT"])
@require_atleta
def slots_put(round_id):
    """Art. 26: atleta marca/atualiza seus slots de disponibilidade."""
    from engines.schedule_engine import eligible_slots, check_deadline_passed, validate_slot

    rounds_db = read_json("rounds.json")
    rnd = next((r for r in rounds_db["data"] if r["id"] == round_id), None)
    if not rnd:
        return jsonify({"error": "Rodada não encontrada"}), 404
    if rnd["status"] in ("closed", "cancelled"):
        return jsonify({"error": "Rodada encerrada — não é possível marcar slots"}), 400

    # Art. 26: verifica prazo
    if check_deadline_passed(rnd.get("deadline_slots")):
        return jsonify({"error": "Prazo para marcar slots encerrado (Art. 26)"}), 400

    athlete_id = session["atleta_id"]
    cat, group_idx = _find_athlete_group(rnd, athlete_id)
    if cat is None:
        return jsonify({"error": "Atleta não pertence a nenhum grupo nesta rodada"}), 403

    body = request.get_json(silent=True) or {}
    submitted_slots = body.get("slots", [])

    # Valida slots contra os elegíveis (Art. 28), se target_date definido
    target_date = rnd.get("target_date")
    if target_date and submitted_slots:
        invalid = [s for s in submitted_slots if not validate_slot(s, target_date)]
        if invalid:
            return jsonify({"error": f"Slots inelegíveis para {target_date}: {invalid}"}), 400

    # Remove duplicatas e ordena
    submitted_slots = sorted(set(submitted_slots))

    slots_db = read_json("slots.json")
    existing = next(
        (s for s in slots_db["data"] if s["round_id"] == round_id and s["athlete_id"] == athlete_id),
        None,
    )

    if existing:
        existing["slots"] = submitted_slots
        existing["submitted_at"] = now_iso()
    else:
        slots_db["data"].append({
            "id": str(uuid.uuid4()),
            "round_id": round_id,
            "athlete_id": athlete_id,
            "category": cat,
            "group_index": group_idx,
            "slots": submitted_slots,
            "submitted_at": now_iso(),
        })

    write_json("slots.json", slots_db)
    return jsonify({"ok": True, "slots": submitted_slots})


@app.route("/api/rounds/<round_id>/resolve", methods=["POST"])
@require_admin
def slots_resolve(round_id):
    """Art. 27: computa o horário oficial de cada grupo via algoritmo de interseção."""
    from engines.schedule_engine import resolve_group_slot

    rounds_db = read_json("rounds.json")
    rnd = next((r for r in rounds_db["data"] if r["id"] == round_id), None)
    if not rnd:
        return jsonify({"error": "Rodada não encontrada"}), 404

    slots_db = read_json("slots.json")
    round_slots = [s for s in slots_db["data"] if s["round_id"] == round_id]

    # Monta mapa {athlete_id: [slots]} para todos os grupos
    slots_by_athlete: dict[str, list] = {
        s["athlete_id"]: s["slots"] for s in round_slots
    }

    official_slots = rnd.setdefault("official_slots", {})
    summary = {}

    for cat, groups in rnd.get("groups", {}).items():
        if cat not in official_slots:
            official_slots[cat] = [
                {"slot": None, "status": "pending", "resolved_by": None, "wo_athlete_ids": []}
                for _ in groups
            ]

        for idx, group in enumerate(groups):
            group_slots_map = {aid: slots_by_athlete.get(aid, []) for aid in group}
            result = resolve_group_slot(group, group_slots_map)

            official_slots[cat][idx] = {
                "slot": result["slot"],
                "status": result["status"],
                "resolved_by": "algorithm" if result["slot"] else None,
                "wo_athlete_ids": result["wo_athlete_ids"],
                "participating_ids": result["participating_ids"],
            }

        summary[cat] = {
            "resolved": sum(1 for g in official_slots[cat] if g["status"] == "resolved"),
            "needs_mediation": sum(1 for g in official_slots[cat] if g["status"] == "needs_mediation"),
            "all_wo": sum(1 for g in official_slots[cat] if g["status"] == "all_wo"),
        }

    write_json("rounds.json", rounds_db)

    athletes_by_id = {a["id"]: a for a in read_json("athletes.json")["data"]}
    return jsonify({"round": _enrich_round(rnd, athletes_by_id), "summary": summary})


@app.route("/api/rounds/<round_id>/groups/<cat>/<int:group_idx>/slot", methods=["PUT"])
@require_admin
def slots_mediate(round_id, cat, group_idx):
    """Art. 27: admin define manualmente o horário quando não há interseção."""
    from engines.schedule_engine import validate_slot

    if cat not in CATEGORIES:
        return jsonify({"error": "Categoria inválida"}), 400

    body = request.get_json(silent=True) or {}
    slot = (body.get("slot") or "").strip()
    if not slot:
        return jsonify({"error": "slot é obrigatório"}), 400

    rounds_db = read_json("rounds.json")
    rnd = next((r for r in rounds_db["data"] if r["id"] == round_id), None)
    if not rnd:
        return jsonify({"error": "Rodada não encontrada"}), 404

    groups = rnd.get("groups", {}).get(cat, [])
    if group_idx >= len(groups):
        return jsonify({"error": f"Grupo {group_idx} não existe em Cat {cat}"}), 404

    # Valida o slot contra a data da rodada
    target_date = rnd.get("target_date")
    if target_date and not validate_slot(slot, target_date):
        return jsonify({"error": f"Slot {slot} não é elegível para {target_date} (Art. 28)"}), 400

    official_slots = rnd.setdefault("official_slots", {})
    if cat not in official_slots:
        official_slots[cat] = [
            {"slot": None, "status": "pending", "resolved_by": None, "wo_athlete_ids": []}
            for _ in groups
        ]

    official_slots[cat][group_idx]["slot"] = slot
    official_slots[cat][group_idx]["status"] = "resolved"
    official_slots[cat][group_idx]["resolved_by"] = "admin"

    write_json("rounds.json", rounds_db)
    athletes_by_id = {a["id"]: a for a in read_json("athletes.json")["data"]}
    return jsonify(_enrich_round(rnd, athletes_by_id))


@app.route("/api/rounds/<round_id>/apply-wo", methods=["POST"])
@require_admin
def apply_wo(round_id):
    """Art. 26: aplica WO automático a todos os atletas sem slots passado o prazo."""
    from engines.schedule_engine import check_deadline_passed

    rounds_db = read_json("rounds.json")
    rnd = next((r for r in rounds_db["data"] if r["id"] == round_id), None)
    if not rnd:
        return jsonify({"error": "Rodada não encontrada"}), 404

    body = request.get_json(silent=True) or {}
    force = body.get("force", False)  # admin pode forçar mesmo antes do prazo

    if not force and not check_deadline_passed(rnd.get("deadline_slots")):
        return jsonify({"error": "Prazo ainda não encerrou. Use force=true para aplicar agora."}), 400

    slots_db = read_json("slots.json")
    round_slots_by_athlete = {
        s["athlete_id"]: s["slots"]
        for s in slots_db["data"]
        if s["round_id"] == round_id
    }

    wo_applied: list[str] = []
    official_slots = rnd.setdefault("official_slots", {})

    for cat, groups in rnd.get("groups", {}).items():
        if cat not in official_slots:
            official_slots[cat] = [
                {"slot": None, "status": "pending", "resolved_by": None, "wo_athlete_ids": []}
                for _ in groups
            ]
        for idx, group in enumerate(groups):
            without_slots = [
                aid for aid in group
                if not round_slots_by_athlete.get(aid)
            ]
            if without_slots:
                official_slots[cat][idx]["wo_athlete_ids"] = without_slots
                wo_applied.extend(without_slots)

    write_json("rounds.json", rounds_db)
    athletes_by_id = {a["id"]: a for a in read_json("athletes.json")["data"]}
    wo_names = [athletes_by_id.get(aid, {}).get("nome", aid) for aid in wo_applied]
    return jsonify({"ok": True, "wo_applied": wo_applied, "wo_names": wo_names})


# ---------------------------------------------------------------------------
# Ranking (Sprint 6)
# ---------------------------------------------------------------------------

@app.route("/api/seasons/<season_id>/ranking")
def get_ranking(season_id):
    """Ranking de uma temporada, por categoria. ?cat=A|B|C|D filtra uma só."""
    from engines.ranking_engine import compute_ranking

    seasons_db = read_json("seasons.json")
    season = next((s for s in seasons_db["data"] if s["id"] == season_id), None)
    if not season:
        return jsonify({"error": "Temporada não encontrada"}), 404

    cat_filter = request.args.get("cat")  # opcional

    athletes_db = read_json("athletes.json")
    results_db  = read_json("results.json")

    category_setup = season.get("category_setup", {})
    cats = [cat_filter] if cat_filter else CATEGORIES

    response: dict[str, list] = {}
    for cat in cats:
        setup = category_setup.get(cat, {})
        titular_ids = setup.get("titular_ids", [])
        athletes_in_cat = [a for a in athletes_db["data"] if a["id"] in titular_ids]
        response[cat] = compute_ranking(
            athletes_in_cat,
            results_db["data"],
            category=cat,
            season_id=season_id,
        )

    return jsonify(response)


@app.route("/api/seasons/<season_id>/ranking/full")
def get_ranking_full(season_id):
    """Ranking sem filtro de categoria (todos os resultados da temporada)."""
    from engines.ranking_engine import compute_ranking

    seasons_db = read_json("seasons.json")
    season = next((s for s in seasons_db["data"] if s["id"] == season_id), None)
    if not season:
        return jsonify({"error": "Temporada não encontrada"}), 404

    athletes_db = read_json("athletes.json")
    results_db  = read_json("results.json")

    all_athletes = [a for a in athletes_db["data"] if a.get("status") == "ativo"]
    ranking = compute_ranking(all_athletes, results_db["data"], season_id=season_id)
    return jsonify(ranking)


# ---------------------------------------------------------------------------
# Resultados (Sprint 5)
# ---------------------------------------------------------------------------

@app.route("/api/rounds/<round_id>/results", methods=["GET"])
def get_round_results(round_id):
    """Lista todos os resultados de uma rodada."""
    results_db = read_json("results.json")
    round_results = [r for r in results_db["data"] if r["round_id"] == round_id]
    return jsonify(round_results)


@app.route("/api/rounds/<round_id>/results", methods=["POST"])
@require_admin
def submit_result(round_id):
    """Admin lança resultado de um grupo (Art. 7+8+9). Body: {cat, group_idx, sets}."""
    from engines.score_engine import validate_group_scores, calculate_group_result

    rounds_db = read_json("rounds.json")
    rnd = next((r for r in rounds_db["data"] if r["id"] == round_id), None)
    if not rnd:
        return jsonify({"error": "Rodada não encontrada"}), 404

    body = request.get_json(silent=True) or {}
    cat = body.get("cat")
    group_idx = body.get("group_idx")
    sets = body.get("sets")  # lista de 3 dicts com score

    if cat not in (rnd.get("groups") or {}):
        return jsonify({"error": "Categoria inválida"}), 400

    groups_cat = rnd["groups"][cat]
    if not isinstance(group_idx, int) or group_idx < 0 or group_idx >= len(groups_cat):
        return jsonify({"error": "Índice de grupo inválido"}), 400

    if not isinstance(sets, list):
        return jsonify({"error": "Campo 'sets' é obrigatório"}), 400

    errors = validate_group_scores(sets)
    if errors:
        return jsonify({"error": "Placar inválido", "details": errors}), 400

    group = groups_cat[group_idx]
    score_result = calculate_group_result(group, sets)

    results_db = read_json("results.json")

    # Remove resultado anterior do mesmo grupo se existir
    results_db["data"] = [
        r for r in results_db["data"]
        if not (r["round_id"] == round_id and r["cat"] == cat and r["group_idx"] == group_idx)
    ]

    result_record = {
        "id": str(uuid.uuid4()),
        "round_id": round_id,
        "season_id": rnd["season_id"],
        "cat": cat,
        "group_idx": group_idx,
        "group": group,
        "sets": sets,
        "scores": score_result,  # {athlete_id: {sets:[...], total: N}}
        "status": "pending_confirmation",  # pending_confirmation | confirmed | contested
        "submitted_by": "admin",
        "submitted_at": now_iso(),
        "confirmations": {},  # {athlete_id: "confirmed"|"contested"}
        "contest_reason": None,
    }
    results_db["data"].append(result_record)
    write_json("results.json", results_db)

    athletes_by_id = {a["id"]: a for a in read_json("athletes.json")["data"]}
    return jsonify(_enrich_result(result_record, athletes_by_id)), 201


@app.route("/api/results/<result_id>/confirm", methods=["POST"])
@require_atleta
def confirm_result(result_id):
    """Atleta confirma ou contesta um resultado (Art. 11)."""
    athlete_id = session["atleta_id"]
    body = request.get_json(silent=True) or {}
    action = body.get("action")  # "confirmed" | "contested"
    reason = body.get("reason", "")

    if action not in ("confirmed", "contested"):
        return jsonify({"error": "action deve ser 'confirmed' ou 'contested'"}), 400

    results_db = read_json("results.json")
    result = next((r for r in results_db["data"] if r["id"] == result_id), None)
    if not result:
        return jsonify({"error": "Resultado não encontrado"}), 404

    if athlete_id not in result["group"]:
        return jsonify({"error": "Você não faz parte deste grupo"}), 403

    if result["status"] == "confirmed":
        return jsonify({"error": "Resultado já confirmado"}), 400

    result["confirmations"][athlete_id] = action
    if action == "contested":
        result["status"] = "contested"
        result["contest_reason"] = reason
    else:
        # Confirma se todos os 4 atletas confirmaram (ou maioria — Admin resolve contests)
        if all(result["confirmations"].get(aid) == "confirmed" for aid in result["group"]):
            result["status"] = "confirmed"

    write_json("results.json", results_db)
    athletes_by_id = {a["id"]: a for a in read_json("athletes.json")["data"]}
    return jsonify(_enrich_result(result, athletes_by_id))


@app.route("/api/results/<result_id>/override", methods=["PUT"])
@require_admin
def override_result(result_id):
    """Admin confirma ou edita resultado contestado."""
    from engines.score_engine import validate_group_scores, calculate_group_result

    results_db = read_json("results.json")
    result = next((r for r in results_db["data"] if r["id"] == result_id), None)
    if not result:
        return jsonify({"error": "Resultado não encontrado"}), 404

    body = request.get_json(silent=True) or {}
    action = body.get("action")  # "confirm" | "edit"

    if action == "confirm":
        result["status"] = "confirmed"
    elif action == "edit":
        sets = body.get("sets")
        if not sets:
            return jsonify({"error": "Campo 'sets' é obrigatório para edição"}), 400
        errors = validate_group_scores(sets)
        if errors:
            return jsonify({"error": "Placar inválido", "details": errors}), 400
        result["sets"] = sets
        result["scores"] = calculate_group_result(result["group"], sets)
        result["status"] = "confirmed"
        result["contest_reason"] = None
    else:
        return jsonify({"error": "action deve ser 'confirm' ou 'edit'"}), 400

    write_json("results.json", results_db)
    athletes_by_id = {a["id"]: a for a in read_json("athletes.json")["data"]}
    return jsonify(_enrich_result(result, athletes_by_id))


@app.route("/api/rounds/<round_id>/results/wo", methods=["POST"])
@require_admin
def submit_wo_result(round_id):
    """Lança WO total (Art. 10.1): um atleta ausente, demais recebem 3×3."""
    from engines.score_engine import apply_wo_total

    rounds_db = read_json("rounds.json")
    rnd = next((r for r in rounds_db["data"] if r["id"] == round_id), None)
    if not rnd:
        return jsonify({"error": "Rodada não encontrada"}), 404

    body = request.get_json(silent=True) or {}
    cat = body.get("cat")
    group_idx = body.get("group_idx")
    absent_athlete_id = body.get("absent_athlete_id")

    if cat not in (rnd.get("groups") or {}):
        return jsonify({"error": "Categoria inválida"}), 400

    groups_cat = rnd["groups"][cat]
    if not isinstance(group_idx, int) or group_idx < 0 or group_idx >= len(groups_cat):
        return jsonify({"error": "Índice de grupo inválido"}), 400

    group = groups_cat[group_idx]
    if absent_athlete_id not in group:
        return jsonify({"error": "Atleta ausente não pertence ao grupo"}), 400

    score_result = apply_wo_total(group, absent_athlete_id)

    results_db = read_json("results.json")
    results_db["data"] = [
        r for r in results_db["data"]
        if not (r["round_id"] == round_id and r["cat"] == cat and r["group_idx"] == group_idx)
    ]

    result_record = {
        "id": str(uuid.uuid4()),
        "round_id": round_id,
        "season_id": rnd["season_id"],
        "cat": cat,
        "group_idx": group_idx,
        "group": group,
        "sets": [],
        "scores": score_result,
        "status": "confirmed",  # WO não precisa de confirmação
        "submitted_by": "admin",
        "submitted_at": now_iso(),
        "wo_type": "total",
        "absent_athlete_id": absent_athlete_id,
        "confirmations": {},
        "contest_reason": None,
    }
    results_db["data"].append(result_record)
    write_json("results.json", results_db)

    athletes_by_id = {a["id"]: a for a in read_json("athletes.json")["data"]}
    return jsonify(_enrich_result(result_record, athletes_by_id)), 201


def _enrich_result(result: dict, athletes_by_id: dict) -> dict:
    """Adiciona nomes aos athlete_ids no resultado."""
    enriched = dict(result)
    enriched["group_named"] = [
        athletes_by_id.get(aid, {}).get("nome", aid) for aid in result["group"]
    ]
    enriched["scores_named"] = {
        athletes_by_id.get(aid, {}).get("nome", aid): v
        for aid, v in result.get("scores", {}).items()
    }
    enriched["confirmations_named"] = {
        athletes_by_id.get(aid, {}).get("nome", aid): v
        for aid, v in result.get("confirmations", {}).items()
    }
    return enriched


# ---------------------------------------------------------------------------
# Contexto do atleta (mesa screens)
# ---------------------------------------------------------------------------

@app.route("/api/mesa/context")
@require_atleta
def mesa_context():
    """Retorna o contexto completo do atleta logado para as telas de mesa."""
    athlete_id = session["atleta_id"]
    athletes_db = read_json("athletes.json")
    athlete = next((a for a in athletes_db["data"] if a["id"] == athlete_id), None)
    if not athlete:
        return jsonify({"error": "Atleta não encontrado"}), 404

    seasons_db = read_json("seasons.json")
    rounds_db = read_json("rounds.json")
    slots_db = read_json("slots.json")
    athletes_by_id = {a["id"]: a for a in athletes_db["data"]}

    # Temporada ativa ou a mais recente
    seasons_sorted = sorted(seasons_db["data"], key=lambda s: s["created_at"], reverse=True)
    season = next((s for s in seasons_sorted if s["status"] == "active"), None) or (
        seasons_sorted[0] if seasons_sorted else None
    )

    if not season:
        return jsonify({"athlete": _safe_athlete(athlete), "season": None, "round": None,
                        "group": None, "official_slot": None, "my_slots": []})

    # Rodada mais recente da temporada
    season_rounds = sorted(
        [r for r in rounds_db["data"] if r["season_id"] == season["id"]],
        key=lambda r: r["round_number"], reverse=True,
    )
    current_round = season_rounds[0] if season_rounds else None

    if not current_round:
        return jsonify({"athlete": _safe_athlete(athlete), "season": _safe_season(season),
                        "round": None, "group": None, "official_slot": None, "my_slots": []})

    # Grupo do atleta nesta rodada
    cat, group_idx = _find_athlete_group(current_round, athlete_id)
    group_info = None
    official_slot = None

    if cat is not None:
        group = current_round["groups"][cat][group_idx]
        group_info = {
            "athlete_ids": group,
            "names": [athletes_by_id.get(aid, {}).get("nome", aid) for aid in group],
            "category": cat,
            "group_index": group_idx,
            "sets": current_round.get("groups_sets", {}).get(cat, [[]])[group_idx],
            "sets_named": _enrich_round(current_round, athletes_by_id)
                          .get("groups_sets_named", {}).get(cat, [[]])[group_idx],
            "location": season.get("location", "—"),
        }

        official_slots_cat = current_round.get("official_slots", {}).get(cat, [])
        if group_idx < len(official_slots_cat):
            official_slot = official_slots_cat[group_idx]

    # Slots marcados pelo atleta nesta rodada
    my_slot_record = next(
        (s for s in slots_db["data"] if s["round_id"] == current_round["id"] and s["athlete_id"] == athlete_id),
        None,
    )

    # Resultado pendente de confirmação do atleta
    results_db = read_json("results.json")
    pending_result = None
    if cat is not None:
        pending_result = next(
            (r for r in results_db["data"]
             if r["round_id"] == current_round["id"]
             and r["cat"] == cat
             and r["group_idx"] == group_idx
             and r["status"] == "pending_confirmation"
             and athlete_id not in r.get("confirmations", {})),
            None,
        )
        if pending_result:
            pending_result = _enrich_result(pending_result, athletes_by_id)

    return jsonify({
        "athlete": _safe_athlete(athlete),
        "season": _safe_season(season),
        "round": {
            "id": current_round["id"],
            "round_number": current_round["round_number"],
            "rounds_total": season["rounds_total"],
            "target_date": current_round.get("target_date"),
            "deadline_slots": current_round.get("deadline_slots"),
            "status": current_round["status"],
        },
        "group": group_info,
        "official_slot": official_slot,
        "my_slots": my_slot_record["slots"] if my_slot_record else [],
        "eligible_slots": _eligible_for_round(current_round),
        "pending_result": pending_result,
    })


def _safe_athlete(a: dict) -> dict:
    return {k: v for k, v in a.items() if k != "pin_hash"}


def _safe_season(s: dict) -> dict:
    return {"id": s["id"], "name": s["name"], "status": s["status"], "rounds_total": s["rounds_total"]}


def _eligible_for_round(rnd: dict) -> list:
    """Retorna slots elegíveis para a target_date da rodada, ou lista completa se sem data."""
    from engines.schedule_engine import eligible_slots, SLOTS_WEEKDAY
    target = rnd.get("target_date")
    if not target:
        return SLOTS_WEEKDAY  # fallback para dia útil padrão
    return eligible_slots(target)


# ---------------------------------------------------------------------------
# Fechamento de Temporada (Sprint 7)
# ---------------------------------------------------------------------------

@app.route("/api/seasons/<season_id>/fechamento/preview", methods=["GET"])
@require_admin
def fechamento_preview(season_id):
    """Retorna o plano de movimentação calculado sem aplicar."""
    from engines.category_engine import compute_movements, movement_summary
    from engines.ranking_engine import compute_ranking

    seasons_db = read_json("seasons.json")
    season = next((s for s in seasons_db["data"] if s["id"] == season_id), None)
    if not season:
        return jsonify({"error": "Temporada não encontrada"}), 404

    athletes_db = read_json("athletes.json")
    results_db  = read_json("results.json")
    athletes_by_id = {a["id"]: a for a in athletes_db["data"]}

    category_setup = season.get("category_setup", {})

    # Monta rankings por categoria
    season_rankings: dict[str, list] = {}
    for cat in CATEGORIES:
        titular_ids = category_setup.get(cat, {}).get("titular_ids", [])
        athletes_in_cat = [a for a in athletes_db["data"] if a["id"] in titular_ids]
        if athletes_in_cat:
            season_rankings[cat] = compute_ranking(
                athletes_in_cat,
                results_db["data"],
                category=cat,
                season_id=season_id,
            )

    movements = compute_movements(season_rankings)
    names = {a["id"]: a.get("nome", a["id"]) for a in athletes_db["data"]}
    summary = movement_summary(movements, names)

    return jsonify({
        "season_id": season_id,
        "season_name": season["name"],
        "rankings": season_rankings,
        "movements": movements,
        "summary": summary,
    })


@app.route("/api/seasons/<season_id>/fechamento/apply", methods=["POST"])
@require_admin
def fechamento_apply(season_id):
    """Aplica o fechamento: movimenta atletas e marca temporada como 'closed'."""
    from engines.category_engine import compute_movements, apply_movements_atomic
    from engines.ranking_engine import compute_ranking

    seasons_db = read_json("seasons.json")
    season = next((s for s in seasons_db["data"] if s["id"] == season_id), None)
    if not season:
        return jsonify({"error": "Temporada não encontrada"}), 404

    if season.get("status") == "closed":
        return jsonify({"error": "Temporada já encerrada"}), 400

    athletes_db = read_json("athletes.json")
    results_db  = read_json("results.json")

    category_setup = season.get("category_setup", {})
    season_rankings: dict[str, list] = {}
    for cat in CATEGORIES:
        titular_ids = category_setup.get(cat, {}).get("titular_ids", [])
        athletes_in_cat = [a for a in athletes_db["data"] if a["id"] in titular_ids]
        if athletes_in_cat:
            season_rankings[cat] = compute_ranking(
                athletes_in_cat,
                results_db["data"],
                category=cat,
                season_id=season_id,
            )

    movements = compute_movements(season_rankings)
    new_setup = apply_movements_atomic(season, movements)

    # Atualiza category_setup na temporada e registra histórico de movimentação
    season["category_setup"] = new_setup
    season["status"] = "closed"
    season["closed_at"] = now_iso()
    season["movements"] = {
        "promotions": movements["promotions"],
        "relegations": movements["relegations"],
        "warnings": movements["warnings"],
        "applied_at": now_iso(),
    }
    write_json("seasons.json", seasons_db)

    # Atualiza category_history de cada atleta que se moveu
    athletes_db = read_json("athletes.json")  # re-read após leitura anterior
    moved = {**movements["promotions"], **movements["relegations"]}
    for athlete in athletes_db["data"]:
        aid = athlete["id"]
        if aid in moved:
            mv = moved[aid]
            if "category_history" not in athlete:
                athlete["category_history"] = []
            athlete["category_history"].append({
                "season_id": season_id,
                "from": mv["from"],
                "to": mv["to"],
                "moved_at": now_iso(),
            })
            athlete["current_category"] = mv["to"]
    write_json("athletes.json", athletes_db)

    names = {a["id"]: a.get("nome", a["id"]) for a in athletes_db["data"]}
    from engines.category_engine import movement_summary
    return jsonify({
        "ok": True,
        "season_id": season_id,
        "movements_applied": len(moved),
        "summary": movement_summary(movements, names),
        "warnings": movements["warnings"],
    })


# ---------------------------------------------------------------------------
# Ranking Anual e Títulos (Sprint 8)
# ---------------------------------------------------------------------------

@app.route("/api/annual/<int:year>/ranking")
def annual_ranking(year):
    """Ranking anual ponderado de todos os atletas elegíveis."""
    from engines.annual_engine import compute_annual_ranking

    athletes_db = read_json("athletes.json")
    seasons_db  = read_json("seasons.json")
    results_db  = read_json("results.json")

    ranking = compute_annual_ranking(
        athletes_db["data"],
        year,
        seasons_db["data"],
        results_db["data"],
    )
    return jsonify({"year": year, "ranking": ranking})


@app.route("/api/annual/<int:year>/titles")
def annual_titles(year):
    """Calcula (sem gravar) Super Rei, Super Pato e Patos por categoria."""
    from engines.annual_engine import compute_titles

    athletes_db = read_json("athletes.json")
    seasons_db  = read_json("seasons.json")
    results_db  = read_json("results.json")

    titles = compute_titles(
        athletes_db["data"],
        year,
        seasons_db["data"],
        results_db["data"],
    )
    return jsonify(titles)


@app.route("/api/annual/<int:year>/titles/apply", methods=["POST"])
@require_admin
def annual_titles_apply(year):
    """Persiste os títulos do ano na galeria (titles.json)."""
    from engines.annual_engine import compute_titles

    athletes_db = read_json("athletes.json")
    seasons_db  = read_json("seasons.json")
    results_db  = read_json("results.json")

    titles = compute_titles(
        athletes_db["data"],
        year,
        seasons_db["data"],
        results_db["data"],
    )

    titles_db = read_json("titles.json")
    # Remove entrada anterior do mesmo ano se existir
    titles_db["data"] = [t for t in titles_db["data"] if t.get("year") != year]
    titles_db["data"].append({
        "year": year,
        "recorded_at": now_iso(),
        "super_rei": titles["super_rei"],
        "super_pato": titles["super_pato"],
        "pato_por_categoria": titles["pato_por_categoria"],
        "ranking_anual": titles["ranking_anual"],
        "eligible_count": titles["eligible_count"],
    })
    write_json("titles.json", titles_db)
    return jsonify({"ok": True, "year": year, "eligible_count": titles["eligible_count"]})


@app.route("/api/titles")
def get_titles():
    """Galeria de títulos históricos."""
    titles_db = read_json("titles.json")
    sorted_titles = sorted(titles_db["data"], key=lambda t: t["year"], reverse=True)
    return jsonify({"titles": sorted_titles})


# ---------------------------------------------------------------------------
# Contestações (Sprint 13)
# ---------------------------------------------------------------------------

@app.route("/api/admin/contested")
@require_admin
def admin_contested():
    """Lista de resultados contestados com detalhes para resolução pelo admin."""
    from engines.contest_engine import compute_contested_summary, count_contested
    results_db  = read_json("results.json")
    athletes_by_id = {a["id"]: a for a in read_json("athletes.json")["data"]}
    summaries = compute_contested_summary(results_db["data"], athletes_by_id)
    return jsonify({
        "contested": summaries,
        "count": count_contested(results_db["data"]),
    })


# ---------------------------------------------------------------------------
# Relatório de Temporada + Busca Global (Sprint 12)
# ---------------------------------------------------------------------------

@app.route("/api/seasons/<season_id>/report")
def season_report(season_id):
    """Relatório completo de uma temporada: top performers, participação, médias."""
    from engines.report_engine import compute_season_report
    seasons_db  = read_json("seasons.json")
    season = next((s for s in seasons_db["data"] if s["id"] == season_id), None)
    if not season:
        return jsonify({"error": "Temporada não encontrada"}), 404
    rounds_db   = read_json("rounds.json")
    results_db  = read_json("results.json")
    athletes_by_id = {a["id"]: a for a in read_json("athletes.json")["data"]}
    report = compute_season_report(
        season, rounds_db["data"], results_db["data"], athletes_by_id
    )
    return jsonify(report)


@app.route("/api/search")
def global_search():
    """Busca global em atletas e temporadas. ?q=<termo> (mín. 2 chars)."""
    from engines.report_engine import compute_search_results
    q = request.args.get("q", "").strip()
    athletes_db = read_json("athletes.json")
    seasons_db  = read_json("seasons.json")
    results = compute_search_results(q, athletes_db["data"], seasons_db["data"])
    return jsonify(results)


# ---------------------------------------------------------------------------
# Histórico de Resultados (Sprint 11)
# ---------------------------------------------------------------------------

@app.route("/api/seasons/<season_id>/history")
def season_history(season_id):
    """Histórico de rodadas da temporada com resultados por grupo."""
    from engines.history_engine import compute_season_history
    rounds_db  = read_json("rounds.json")
    results_db = read_json("results.json")
    athletes_db = read_json("athletes.json")
    athletes_by_id = {a["id"]: a for a in athletes_db["data"]}
    history = compute_season_history(
        rounds_db["data"], results_db["data"], athletes_by_id, season_id=season_id
    )
    return jsonify({"season_id": season_id, "rounds": history})


@app.route("/api/rounds/<round_id>/summary")
def round_summary(round_id):
    """Sumário detalhado de uma rodada: todos os grupos com scores."""
    from engines.history_engine import compute_round_summary
    rounds_db  = read_json("rounds.json")
    rnd = next((r for r in rounds_db["data"] if r["id"] == round_id), None)
    if not rnd:
        return jsonify({"error": "Rodada não encontrada"}), 404
    results_db  = read_json("results.json")
    athletes_by_id = {a["id"]: a for a in read_json("athletes.json")["data"]}
    summary = compute_round_summary(rnd, results_db["data"], athletes_by_id)
    return jsonify(summary)


@app.route("/api/mesa/history")
@require_atleta
def mesa_history():
    """Histórico pessoal de partidas do atleta logado."""
    from engines.history_engine import compute_athlete_match_history
    atleta_id = session["atleta_id"]
    rounds_db   = read_json("rounds.json")
    results_db  = read_json("results.json")
    athletes_db = read_json("athletes.json")
    athletes_by_id = {a["id"]: a for a in athletes_db["data"]}
    history = compute_athlete_match_history(
        atleta_id, rounds_db["data"], results_db["data"], athletes_by_id
    )
    return jsonify({"history": history})


# ---------------------------------------------------------------------------
# Admin Tools (Sprint 10)
# ---------------------------------------------------------------------------

@app.route("/api/admin/stats")
@require_admin
def admin_stats():
    """Dashboard stats agregadas: atletas, temporadas, resultados, rodadas."""
    from engines.stats_engine import compute_dashboard_stats
    athletes_db = read_json("athletes.json")
    seasons_db  = read_json("seasons.json")
    results_db  = read_json("results.json")
    rounds_db   = read_json("rounds.json")
    stats = compute_dashboard_stats(
        athletes_db["data"],
        seasons_db["data"],
        results_db["data"],
        rounds_db["data"],
    )
    return jsonify(stats)


@app.route("/api/athletes/<athlete_id>/reset-pin", methods=["POST"])
@require_admin
def athlete_reset_pin(athlete_id):
    """Admin gera um PIN temporário para o atleta (retornado em texto claro uma única vez)."""
    import random
    athletes_db = read_json("athletes.json")
    athlete = next((a for a in athletes_db["data"] if a["id"] == athlete_id), None)
    if not athlete:
        return jsonify({"error": "Atleta não encontrado"}), 404
    temp_pin = f"{random.randint(0, 9999):04d}"
    athlete["pin_hash"] = hash_pin(temp_pin)
    write_json("athletes.json", athletes_db)
    return jsonify({"ok": True, "temp_pin": temp_pin, "nome": athlete.get("nome")})


@app.route("/api/athletes/<athlete_id>/public")
def athlete_public_profile(athlete_id):
    """Perfil público de um atleta (sem autenticação, sem pin_hash)."""
    from engines.profile_engine import compute_athlete_profile
    athletes_db = read_json("athletes.json")
    athlete = next((a for a in athletes_db["data"] if a["id"] == athlete_id), None)
    if not athlete:
        return jsonify({"error": "Atleta não encontrado"}), 404
    seasons_db = read_json("seasons.json")
    results_db = read_json("results.json")
    profile = compute_athlete_profile(athlete, seasons_db["data"], results_db["data"])
    return jsonify(profile)


@app.route("/api/admin/export")
@require_admin
def admin_export():
    """Exporta todos os dados do sistema como JSON (backup/auditoria)."""
    export = {
        "exported_at": now_iso(),
        "version": 1,
        "athletes": read_json("athletes.json")["data"],
        "seasons":  read_json("seasons.json")["data"],
        "rounds":   read_json("rounds.json")["data"],
        "results":  read_json("results.json")["data"],
        "titles":   read_json("titles.json")["data"],
    }
    # Strip pin_hashes before exporting
    for a in export["athletes"]:
        a.pop("pin_hash", None)
    from flask import Response
    import json as _json
    payload = _json.dumps(export, ensure_ascii=False, indent=2)
    return Response(
        payload,
        mimetype="application/json",
        headers={"Content-Disposition": f"attachment; filename=superrank_export_{now_iso()[:10]}.json"},
    )


# ---------------------------------------------------------------------------
# Perfil do Atleta (Sprint 9)
# ---------------------------------------------------------------------------

@app.route("/api/mesa/profile")
@require_atleta
def mesa_profile():
    """Perfil completo do atleta logado: stats por temporada e histórico."""
    from engines.profile_engine import compute_athlete_profile
    atleta_id = session["atleta_id"]
    athletes_db = read_json("athletes.json")
    athlete = next((a for a in athletes_db["data"] if a["id"] == atleta_id), None)
    if not athlete:
        return jsonify({"error": "Atleta não encontrado"}), 404
    seasons_db = read_json("seasons.json")
    results_db = read_json("results.json")
    profile = compute_athlete_profile(athlete, seasons_db["data"], results_db["data"])
    return jsonify(profile)


@app.route("/api/mesa/profile/pin", methods=["PUT"])
@require_atleta
def mesa_profile_pin():
    """Atleta altera seu próprio PIN."""
    atleta_id = session["atleta_id"]
    data = request.get_json() or {}
    current_pin = data.get("current_pin", "")
    new_pin = str(data.get("new_pin", ""))
    if not current_pin or not new_pin:
        return jsonify({"error": "PIN atual e novo PIN são obrigatórios"}), 400
    if not new_pin.isdigit() or len(new_pin) != 4:
        return jsonify({"error": "Novo PIN deve ter exatamente 4 dígitos"}), 400
    athletes_db = read_json("athletes.json")
    athlete = next((a for a in athletes_db["data"] if a["id"] == atleta_id), None)
    if not athlete:
        return jsonify({"error": "Atleta não encontrado"}), 404
    if athlete.get("pin_hash") != hash_pin(current_pin):
        return jsonify({"error": "PIN atual incorreto"}), 400
    athlete["pin_hash"] = hash_pin(new_pin)
    write_json("athletes.json", athletes_db)
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Healthcheck
# ---------------------------------------------------------------------------

@app.route("/api/health")
def health():
    return jsonify({"status": "ok", "app": "SuperRank Rei do Play", "version": "1.0.0"})


if __name__ == "__main__":
    app.run(debug=True, port=5001)
