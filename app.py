import os
import re
import json
import glob
import uuid
import fcntl
import hashlib
import functools
import urllib.parse
from datetime import datetime
from flask import Flask, jsonify, render_template, request, session, g, send_from_directory
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY", "dev-secret")

DATA_DIR = os.getenv("DATA_DIR", os.path.join(os.path.dirname(__file__), "data"))
os.makedirs(DATA_DIR, exist_ok=True)
CATEGORIES = ["A", "B", "C", "D"]


# ---------------------------------------------------------------------------
# Helpers de persistência
# ---------------------------------------------------------------------------

def read_json(filename):
    path = os.path.join(DATA_DIR, filename)
    if not os.path.exists(path):
        return {"version": 1, "data": []}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def write_json(filename, payload):
    """Lê, modifica em memória e grava atomicamente — nunca grava parcial."""
    path = os.path.join(DATA_DIR, filename)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


# ---------------------------------------------------------------------------
# Robustez de escrita: lock entre workers + transação (snapshot/rollback)
# ---------------------------------------------------------------------------

def _acquire_write_lock():
    """Lock exclusivo (flock) num arquivo do data dir. Serializa mutações
    entre os workers do gunicorn, evitando lost-update em read-modify-write."""
    fd = open(os.path.join(DATA_DIR, ".write.lock"), "w")
    fcntl.flock(fd, fcntl.LOCK_EX)
    return fd


@app.before_request
def _serialize_mutations():
    if request.method in ("POST", "PUT", "DELETE", "PATCH"):
        try:
            g._write_lock_fd = _acquire_write_lock()
        except Exception:
            g._write_lock_fd = None


@app.teardown_request
def _release_mutations(exc):
    fd = getattr(g, "_write_lock_fd", None)
    if fd is not None:
        try:
            fcntl.flock(fd, fcntl.LOCK_UN)
            fd.close()
        except Exception:
            pass


def _snapshot_data_dir():
    """Lê o conteúdo de todos os *.json do data dir (para rollback)."""
    snap = {}
    for path in glob.glob(os.path.join(DATA_DIR, "*.json")):
        try:
            with open(path, "rb") as f:
                snap[path] = f.read()
        except Exception:
            pass
    return snap


def _restore_data_dir(snap):
    # Remove *.json criados durante a transação (não existiam no snapshot).
    for path in glob.glob(os.path.join(DATA_DIR, "*.json")):
        if path not in snap:
            try:
                os.remove(path)
            except Exception:
                pass
    # Restaura o conteúdo original dos demais.
    for path, content in snap.items():
        tmp = path + ".restore.tmp"
        with open(tmp, "wb") as f:
            f.write(content)
        os.replace(tmp, path)


def transactional(fn):
    """Snapshot do data dir antes; se a função lançar, reverte tudo e
    repropaga. Para operações que gravam vários arquivos (fechamento,
    exclusão em cascata) — evita estado parcial em falha no meio.
    Roda sob o lock global de mutação (before_request)."""
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        snap = _snapshot_data_dir()
        try:
            return fn(*args, **kwargs)
        except Exception:
            _restore_data_dir(snap)
            raise
    return wrapper


def now_iso():
    return datetime.utcnow().isoformat()


def hash_pin(pin: str) -> str:
    return hashlib.sha256(pin.encode()).hexdigest()


def compute_age(birth_date_str: str | None) -> int | None:
    if not birth_date_str:
        return None
    try:
        from datetime import date as _date
        bd = _date.fromisoformat(birth_date_str)
        today = _date.today()
        return today.year - bd.year - ((today.month, today.day) < (bd.month, bd.day))
    except (ValueError, TypeError):
        return None


def read_settings() -> dict:
    path = os.path.join(DATA_DIR, "settings.json")
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except Exception:
        return {}

def write_settings(settings: dict):
    path = os.path.join(DATA_DIR, "settings.json")
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(settings, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)

def log_audit(action: str, details: dict = None):
    """Registra uma ação administrativa no log de auditoria."""
    from engines.audit_engine import build_entry
    actor = session.get("admin_name", "admin")
    db = read_json("audit.json")
    db["data"].append(build_entry(action, actor, details or {}))
    write_json("audit.json", db)


def _create_notification(athlete_id: str, ntype: str, title: str, body: str, link: str = None):
    db = read_json("notifications.json")
    notif = {
        "id": str(uuid.uuid4()),
        "athlete_id": athlete_id,
        "type": ntype,
        "title": title,
        "body": body,
        "link": link,
        "created_at": now_iso(),
        "read": False,
    }
    db["data"].append(notif)
    write_json("notifications.json", db)


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


def require_super(f):
    """Endpoint exclusivo para admins com role 'super'."""
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        if not session.get("is_admin"):
            return jsonify({"error": "Não autorizado"}), 403
        if session.get("admin_role") != "super":
            return jsonify({"error": "Requer role super-admin"}), 403
        return f(*args, **kwargs)
    return decorated


def _hash_password(pw: str) -> str:
    return hashlib.sha256(pw.encode()).hexdigest()


def _ensure_super_admin() -> None:
    """Garante que exista um super-admin em admins.json sincronizado com SENHA_DE_ADMINISTRADOR."""
    env_pw = os.getenv("SENHA_DE_ADMINISTRADOR", "")
    if not env_pw:
        return
    env_hash = _hash_password(env_pw)
    admins_db = read_json("admins.json")
    super_admin = next((a for a in admins_db["data"] if a.get("role") == "super"), None)
    if super_admin is None:
        admins_db["data"].append({
            "id": str(uuid.uuid4()),
            "nome": "Super Admin",
            "username": "admin",
            "password_hash": env_hash,
            "role": "super",
            "created_at": now_iso(),
            "last_login": None,
        })
        write_json("admins.json", admins_db)
    elif super_admin.get("password_hash") != env_hash:
        # Sincroniza hash com o env var atual (ex.: senha trocada no Railway)
        super_admin["password_hash"] = env_hash
        write_json("admins.json", admins_db)


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

_BUILD_ID = os.getenv("RAILWAY_DEPLOYMENT_ID", str(int(datetime.now().timestamp())))

@app.route("/")
def index():
    return render_template("index.html", build_id=_BUILD_ID)


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

@app.route("/api/auth/admin", methods=["POST"])
def auth_admin():
    body = request.get_json(silent=True) or {}
    username = (body.get("username") or "").strip()
    password = (body.get("password") or "").strip()

    if not password:
        return jsonify({"ok": False, "error": "Senha obrigatória"}), 400

    _ensure_super_admin()
    admins_db = read_json("admins.json")

    # Se não passou username, tenta autenticar como o admin legado do .env
    if not username:
        if password == os.getenv("SENHA_DE_ADMINISTRADOR", ""):
            env_admin = next(
                (a for a in admins_db["data"] if a.get("role") == "super"),
                None,
            )
            admin_id = env_admin["id"] if env_admin else "legacy"
            session["is_admin"]       = True
            session["admin_id"]       = admin_id
            session["admin_role"]     = "super"
            session["admin_username"] = env_admin["username"] if env_admin else "admin"
            return jsonify({"ok": True, "role": "super", "username": session["admin_username"]})
        return jsonify({"ok": False, "error": "Senha incorreta"}), 401

    # Autenticação com username + password
    admin = next((a for a in admins_db["data"] if a.get("username") == username), None)
    if not admin or admin.get("password_hash") != _hash_password(password):
        return jsonify({"ok": False, "error": "Usuário ou senha incorretos"}), 401

    admin["last_login"] = now_iso()
    write_json("admins.json", admins_db)

    session["is_admin"]       = True
    session["admin_id"]       = admin["id"]
    session["admin_role"]     = admin.get("role", "staff")
    session["admin_username"] = admin["username"]
    return jsonify({"ok": True, "role": admin["role"], "username": admin["username"]})


@app.route("/api/auth/atleta", methods=["POST"])
def auth_atleta():
    body = request.get_json(silent=True) or {}
    telefone = re.sub(r'\D', '', str(body.get("telefone") or ""))
    pin = (body.get("pin") or "").strip()

    if not telefone or not pin:
        return jsonify({"error": "Telefone e PIN são obrigatórios"}), 400

    db = read_json("athletes.json")
    ph = hash_pin(pin)
    # Procura por telefone (qualquer status) para dar erro específico.
    by_phone = next(
        (a for a in db["data"]
         if re.sub(r'\D', '', str(a.get("telefone") or "")) == telefone),
        None,
    )
    if by_phone:
        if by_phone.get("status") != "ativo":
            return jsonify({"error": "Esta conta está inativa. Fale com o admin."}), 403
        if by_phone["pin_hash"] != ph:
            return jsonify({"error": "PIN incorreto."}), 401
        session["atleta_id"] = by_phone["id"]
        session["atleta_nome"] = by_phone["nome"]
        return jsonify({"ok": True, "atleta": {
            "id": by_phone["id"],
            "nome": by_phone["nome"],
            "apelido": by_phone.get("apelido") or by_phone["nome"],
        }})

    # Sem atleta com esse telefone: tenta convidado registrado.
    gr_db = read_json("guest_requests.json")
    for gr in gr_db["data"]:
        cg = gr.get("confirmed_guest") or {}
        if (cg.get("telefone") == telefone
                and cg.get("pin_hash") == ph
                and cg.get("registered")):
            session["atleta_id"] = cg["guest_id"]
            session["is_guest"]  = True
            session["is_admin"]  = False
            return jsonify({"ok": True, "atleta": {
                "id":     cg["guest_id"],
                "nome":   cg["nome_display"],
                "apelido": cg["nome_display"],
            }})
    return jsonify({"error": "Telefone não cadastrado."}), 401


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
# Gestão de admins (multi-admin)
# ---------------------------------------------------------------------------

def _safe_admin(a: dict) -> dict:
    return {k: v for k, v in a.items() if k != "password_hash"}


@app.route("/api/admins", methods=["GET"])
@require_super
def admins_list():
    _ensure_super_admin()
    admins_db = read_json("admins.json")
    return jsonify([_safe_admin(a) for a in admins_db["data"]])


@app.route("/api/admins", methods=["POST"])
@require_super
def admins_create():
    body = request.get_json(silent=True) or {}
    nome     = (body.get("nome") or "").strip()
    username = (body.get("username") or "").strip().lower()
    password = (body.get("password") or "").strip()
    role     = body.get("role", "staff")

    if not nome or not username or not password:
        return jsonify({"error": "nome, username e password são obrigatórios"}), 400
    if role not in ("super", "staff"):
        return jsonify({"error": "role deve ser 'super' ou 'staff'"}), 400
    if len(password) < 6:
        return jsonify({"error": "Senha deve ter pelo menos 6 caracteres"}), 400
    if not re.match(r'^[a-z0-9_.-]+$', username):
        return jsonify({"error": "Username inválido (letras minúsculas, números, _ . -)"}), 400

    admins_db = read_json("admins.json")
    if any(a["username"] == username for a in admins_db["data"]):
        return jsonify({"error": "Username já existe"}), 409

    new_admin = {
        "id":            str(uuid.uuid4()),
        "nome":          nome,
        "username":      username,
        "password_hash": _hash_password(password),
        "role":          role,
        "created_at":    now_iso(),
        "last_login":    None,
    }
    admins_db["data"].append(new_admin)
    write_json("admins.json", admins_db)
    log_audit("admin_created", {"username": username, "role": role,
                                 "by": session.get("admin_username")})
    return jsonify(_safe_admin(new_admin)), 201


@app.route("/api/admins/<admin_id>", methods=["PUT"])
@require_super
def admins_update(admin_id):
    admins_db = read_json("admins.json")
    admin = next((a for a in admins_db["data"] if a["id"] == admin_id), None)
    if not admin:
        return jsonify({"error": "Admin não encontrado"}), 404

    body = request.get_json(silent=True) or {}
    if "nome" in body:
        admin["nome"] = (body["nome"] or "").strip() or admin["nome"]
    if "role" in body:
        if body["role"] not in ("super", "staff"):
            return jsonify({"error": "role deve ser 'super' ou 'staff'"}), 400
        # Não pode rebaixar a si mesmo
        if admin_id == session.get("admin_id") and body["role"] != "super":
            return jsonify({"error": "Você não pode rebaixar a si mesmo"}), 400
        admin["role"] = body["role"]
    if body.get("password"):
        pw = body["password"].strip()
        if len(pw) < 6:
            return jsonify({"error": "Senha deve ter pelo menos 6 caracteres"}), 400
        admin["password_hash"] = _hash_password(pw)

    write_json("admins.json", admins_db)
    log_audit("admin_updated", {"admin_id": admin_id, "by": session.get("admin_username")})
    return jsonify(_safe_admin(admin))


@app.route("/api/admins/<admin_id>", methods=["DELETE"])
@require_super
def admins_delete(admin_id):
    if admin_id == session.get("admin_id"):
        return jsonify({"error": "Você não pode remover a si mesmo"}), 400

    admins_db = read_json("admins.json")
    before = len(admins_db["data"])
    admins_db["data"] = [a for a in admins_db["data"] if a["id"] != admin_id]
    if len(admins_db["data"]) == before:
        return jsonify({"error": "Admin não encontrado"}), 404

    write_json("admins.json", admins_db)
    log_audit("admin_deleted", {"admin_id": admin_id, "by": session.get("admin_username")})
    return jsonify({"ok": True})


@app.route("/api/auth/admin/me")
@require_admin
def admin_me():
    """Retorna dados do admin logado (para o frontend saber o role)."""
    return jsonify({
        "id":       session.get("admin_id"),
        "role":     session.get("admin_role", "staff"),
        "username": session.get("admin_username", "admin"),
    })


# ---------------------------------------------------------------------------
# Atletas
# ---------------------------------------------------------------------------

_ATHLETE_SENSITIVE_FIELDS = {"pin_hash", "telefone", "birth_date", "category_history"}

@app.route("/api/athletes", methods=["GET"])
def athletes_list():
    db = read_json("athletes.json")
    is_admin = session.get("is_admin", False)
    is_athlete = bool(session.get("atleta_id"))
    if is_admin or is_athlete:
        # Autenticado: retorna tudo exceto pin_hash
        safe = [{k: v for k, v in a.items() if k != "pin_hash"} for a in db["data"]]
    else:
        # Público: omite campos sensíveis
        safe = [{k: v for k, v in a.items()
                 if k not in _ATHLETE_SENSITIVE_FIELDS} for a in db["data"]]
    return jsonify(safe)


@app.route("/api/athletes", methods=["POST"])
def athletes_create():
    """Cadastro público (self-registro) ou criação pelo admin."""
    body = request.get_json(silent=True) or {}
    nome = (body.get("nome") or "").strip()
    apelido = (body.get("apelido") or "").strip()
    pin = (body.get("pin") or "").strip()
    tipo = body.get("type", "reserva")
    desired = body.get("desired_category")  # B/C/D ou None — Art. 6

    # Validações
    if not nome:
        return jsonify({"error": "Nome completo é obrigatório"}), 400
    if not apelido:
        return jsonify({"error": "Apelido é obrigatório"}), 400
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

    if any(a["nome"].lower() == nome.lower() for a in db["data"]):
        return jsonify({"error": "Já existe um atleta com este nome completo"}), 409
    if any((a.get("apelido") or "").lower() == apelido.lower() for a in db["data"]):
        return jsonify({"error": "Este apelido já está em uso"}), 409

    telefone = re.sub(r'\D', '', str(body.get("telefone") or ""))
    if not telefone:
        return jsonify({"error": "Telefone (WhatsApp) é obrigatório"}), 400
    if not (10 <= len(telefone) <= 15):
        return jsonify({"error": "Telefone inválido (10-15 dígitos com código do país)"}), 400
    if any(re.sub(r'\D', '', str(a.get("telefone") or "")) == telefone for a in db["data"]):
        return jsonify({"error": "Este número de telefone já está cadastrado"}), 409

    birth_date = (body.get("birth_date") or "").strip() or None
    if birth_date:
        try:
            from datetime import date as _date
            _bd = _date.fromisoformat(birth_date)
            if _bd >= _date.today():
                return jsonify({"error": "Data de nascimento deve ser no passado"}), 400
        except ValueError:
            return jsonify({"error": "Data de nascimento inválida (use YYYY-MM-DD)"}), 400

    atleta = {
        "id": str(uuid.uuid4()),
        "nome": nome,
        "apelido": apelido,
        "pin_hash": hash_pin(pin) if pin else None,
        "type": tipo,
        "current_category": admin_cat if admin_cat else None,
        "desired_category": desired,
        "admin_confirmed": bool(admin_cat),
        "status": "ativo",
        "telefone": telefone,
        "birth_date": birth_date,
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

    if "apelido" in body:
        apelido = body["apelido"].strip()
        if not apelido:
            return jsonify({"error": "Apelido não pode ser vazio"}), 400
        if any((a.get("apelido") or "").lower() == apelido.lower() and a["id"] != athlete_id for a in db["data"]):
            return jsonify({"error": "Apelido já em uso"}), 409
        atleta["apelido"] = apelido

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
        was_unconfirmed = not atleta.get("admin_confirmed")
        atleta["current_category"] = cat
        atleta["admin_confirmed"] = True
        if was_unconfirmed:
            log_audit("athlete_confirmed", {
                "athlete_id": athlete_id,
                "nome": atleta.get("nome"),
                "category": cat,
                "type": atleta.get("type"),
            })

    if "desired_category" in body:
        desired = body["desired_category"]
        if desired is not None and desired not in ("B", "C", "D"):
            return jsonify({"error": "Categoria desejada inválida (A proibida para auto-declaração)"}), 400
        atleta["desired_category"] = desired

    if "telefone" in body:
        telefone = re.sub(r'\D', '', str(body["telefone"] or ""))
        if telefone and not (10 <= len(telefone) <= 15):
            return jsonify({"error": "Telefone inválido (10-15 dígitos com código do país)"}), 400
        atleta["telefone"] = telefone or None

    if "birth_date" in body:
        bd_val = (body["birth_date"] or "").strip() or None
        if bd_val:
            try:
                from datetime import date as _date
                _bd = _date.fromisoformat(bd_val)
                if _bd >= _date.today():
                    return jsonify({"error": "Data de nascimento deve ser no passado"}), 400
                atleta["birth_date"] = bd_val
            except ValueError:
                return jsonify({"error": "Data de nascimento inválida (use YYYY-MM-DD)"}), 400
        else:
            atleta["birth_date"] = None

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

    # Proteção referencial: bloqueia se atleta tem resultados ou está em grupos de rodadas
    results_refs = [r for r in read_json("results.json")["data"]
                    if athlete_id in (r.get("group") or [])]
    if results_refs:
        return jsonify({"error": f"Atleta possui {len(results_refs)} resultado(s) registrado(s). Inative-o em vez de deletar."}), 400

    rounds_refs = [
        r for r in read_json("rounds.json")["data"]
        if any(athlete_id in grp
               for grps in (r.get("groups") or {}).values()
               for grp in grps)
    ]
    if rounds_refs:
        return jsonify({"error": f"Atleta está em {len(rounds_refs)} rodada(s). Inative-o em vez de deletar."}), 400

    write_json("athletes.json", db)
    return jsonify({"ok": True})


@app.route("/api/athletes/export.csv")
@require_admin
def athletes_export_csv():
    """Exporta lista de atletas em CSV."""
    import csv, io
    db = read_json("athletes.json")
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Nome", "Apelido", "Tipo", "Categoria", "Status",
                     "Confirmado", "Telefone", "Cadastro"])
    for a in db["data"]:
        writer.writerow([
            a.get("nome", ""),
            a.get("apelido", ""),
            a.get("type", ""),
            a.get("current_category", ""),
            a.get("status", ""),
            "sim" if a.get("admin_confirmed") else "não",
            a.get("telefone", ""),
            (a.get("created_at") or "")[:10],
        ])
    from flask import Response
    return Response(
        output.getvalue(),
        mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename=atletas_{now_iso()[:10]}.csv"},
    )


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
    rounds_total = int(body.get("rounds_total", 4))
    round_duration_days = int(body.get("round_duration_days", 10))
    location_mode = body.get("location_mode", "single")
    location = (body.get("location") or "Clube do Play").strip()
    liga_id = (body.get("liga_id") or "").strip() or None

    if not name:
        return jsonify({"error": "Nome da temporada é obrigatório"}), 400
    if not year or not isinstance(year, int) or year < 2020:
        return jsonify({"error": "Ano inválido"}), 400
    if not start_date:
        return jsonify({"error": "Data de início é obrigatória"}), 400
    if not (2 <= rounds_total <= 5):
        return jsonify({"error": "Número de rodadas deve ser entre 2 e 5"}), 400
    if not (1 <= round_duration_days <= 60):
        return jsonify({"error": "Duração de rodada deve ser entre 1 e 60 dias"}), 400
    from datetime import timedelta as _td2
    _auto_end = (datetime.strptime(start_date, "%Y-%m-%d") + _td2(days=rounds_total * round_duration_days - 1)).strftime("%Y-%m-%d")
    if not end_date:
        end_date = _auto_end
    if start_date >= end_date:
        return jsonify({"error": "Data de fim deve ser posterior à de início"}), 400
    if location_mode not in ("single", "multiple"):
        return jsonify({"error": "Modo de local inválido"}), 400

    if liga_id:
        ligas_db = read_json("ligas.json")
        liga_obj = next((l for l in ligas_db["data"] if l["id"] == liga_id), None)
        if not liga_obj:
            return jsonify({"error": "Liga não encontrada"}), 404

    season = {
        "id": str(uuid.uuid4()),
        "name": name,
        "year": year,
        "rounds_total": rounds_total,
        "round_duration_days": round_duration_days,
        "start_date": start_date,
        "end_date": end_date,
        "status": "pending",
        "location_mode": location_mode,
        "location": location,
        "liga_id": liga_id,
        "category_setup": {
            cat: {"titular_ids": [], "reserva_ids": []}
            for cat in CATEGORIES
        },
        "created_at": now_iso(),
    }
    db = read_json("seasons.json")
    db["data"].append(season)
    write_json("seasons.json", db)

    if liga_id:
        ligas_db = read_json("ligas.json")
        liga_obj = next((l for l in ligas_db["data"] if l["id"] == liga_id), None)
        if liga_obj:
            liga_obj.setdefault("seasons", [])
            if season["id"] not in liga_obj["seasons"]:
                liga_obj["seasons"].append(season["id"])
            write_json("ligas.json", ligas_db)

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

    _VALID_SEASON_STATUS = {"pending", "active", "closed"}
    if "status" in body:
        new_status = body["status"]
        if new_status not in _VALID_SEASON_STATUS:
            return jsonify({"error": f"Status inválido. Use: {sorted(_VALID_SEASON_STATUS)}"}), 400
        if new_status == "active" and season.get("status") != "active":
            already = next((s for s in db["data"]
                            if s["id"] != season_id and s.get("status") == "active"), None)
            if already:
                return jsonify({"error": f"Já existe uma temporada ativa: '{already.get('name', already['id'])}'. Encerre-a antes de ativar outra."}), 409

    for field in ("name", "start_date", "end_date", "location", "location_mode", "status"):
        if field in body:
            season[field] = body[field]
    if "rounds_total" in body:
        season["rounds_total"] = int(body["rounds_total"])
    if "round_duration_days" in body:
        season["round_duration_days"] = int(body["round_duration_days"])

    # Recalculate end_date if structural fields changed and end_date not explicitly set in this request
    if any(k in body for k in ("start_date", "rounds_total", "round_duration_days")) and "end_date" not in body:
        from datetime import timedelta as _td3
        _sd = season.get("start_date")
        _rt = season.get("rounds_total", 4)
        _rd = season.get("round_duration_days", 10)
        if _sd:
            season["end_date"] = (datetime.strptime(_sd, "%Y-%m-%d") + _td3(days=_rt * _rd - 1)).strftime("%Y-%m-%d")

    write_json("seasons.json", db)
    log_audit("season_edited", {
        "season_id": season_id,
        "season_name": season.get("name"),
        "changed_fields": list(body.keys()),
    })
    return jsonify(season)


def _cascade_delete_season(season_id: str) -> dict:
    """Apaga uma temporada e TODOS os registros dependentes. Retorna contagens.

    Não apaga atletas — apenas remove as entradas de category_history daquela
    temporada. Desvincula a temporada de qualquer liga.
    """
    counts: dict[str, int] = {}

    rounds_db = read_json("rounds.json")
    round_ids = {r["id"] for r in rounds_db["data"] if r.get("season_id") == season_id}
    counts["rounds"] = len(round_ids)
    rounds_db["data"] = [r for r in rounds_db["data"] if r.get("season_id") != season_id]
    write_json("rounds.json", rounds_db)

    def _purge(filename, pred):
        db = read_json(filename)
        before = len(db["data"])
        db["data"] = [x for x in db["data"] if not pred(x)]
        removed = before - len(db["data"])
        if removed:
            write_json(filename, db)
        return removed

    counts["results"]           = _purge("results.json",           lambda x: x.get("season_id") == season_id or x.get("round_id") in round_ids)
    counts["ranking_snapshots"] = _purge("ranking_snapshots.json", lambda x: x.get("season_id") == season_id or x.get("round_id") in round_ids)
    counts["slots"]             = _purge("slots.json",             lambda x: x.get("round_id") in round_ids)
    counts["guest_requests"]    = _purge("guest_requests.json",    lambda x: x.get("season_id") == season_id or x.get("round_id") in round_ids)
    counts["injuries"]          = _purge("injuries.json",          lambda x: x.get("season_id") == season_id)
    counts["payments"]          = _purge("payments.json",          lambda x: x.get("season_id") == season_id)

    # Atletas: nunca apagados — só limpa o histórico de movimentação desta temporada.
    ath = read_json("athletes.json")
    ch_removed = 0
    for a in ath["data"]:
        hist = a.get("category_history")
        if isinstance(hist, list):
            new = [h for h in hist if h.get("season_id") != season_id]
            ch_removed += len(hist) - len(new)
            a["category_history"] = new
    counts["category_history_entries"] = ch_removed
    if ch_removed:
        write_json("athletes.json", ath)

    # Desvincula de qualquer liga.
    ligas = read_json("ligas.json")
    changed = False
    for l in ligas["data"]:
        if isinstance(l.get("seasons"), list) and season_id in l["seasons"]:
            l["seasons"] = [s for s in l["seasons"] if s != season_id]
            changed = True
    if changed:
        write_json("ligas.json", ligas)

    # Por fim, remove a própria temporada.
    seasons_db = read_json("seasons.json")
    seasons_db["data"] = [s for s in seasons_db["data"] if s["id"] != season_id]
    write_json("seasons.json", seasons_db)

    return counts


@app.route("/api/seasons/<season_id>", methods=["DELETE"])
@require_admin
@transactional
def seasons_delete(season_id):
    db = read_json("seasons.json")
    season = next((s for s in db["data"] if s["id"] == season_id), None)
    if not season:
        return jsonify({"error": "Temporada não encontrada"}), 404

    body = request.get_json(silent=True) or {}
    # Temporada pendente: exclusão direta. Com dados (active/closed): exige confirmação.
    if season.get("status") != "pending" and body.get("confirm") is not True:
        return jsonify({
            "error": "Esta temporada tem dados (rodadas, resultados). "
                     "Envie {\"confirm\": true} para excluí-la em cascata.",
            "status": season.get("status"),
        }), 400

    counts = _cascade_delete_season(season_id)
    log_audit("season_deleted", {
        "season_id": season_id,
        "season_name": season.get("name"),
        "cascade": counts,
    })
    return jsonify({"ok": True, "deleted": counts})


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

    # Art. 5: número de titulares deve ser múltiplo de 4 (mín 4) ou 0 (categoria vazia)
    n_titulares = len(titular_ids)
    if n_titulares > 0 and (n_titulares < 4 or n_titulares % 4 != 0):
        return jsonify({"error": f"Art. 5: número de titulares ({n_titulares}) deve ser múltiplo de 4 (mínimo 4)."}), 400

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


@app.route("/api/seasons/<season_id>/categories/<cat>/bulk", methods=["POST"])
@require_admin
def categories_bulk(season_id, cat):
    """Adiciona ou remove múltiplos atletas de uma categoria em bloco.
    Body: { action: 'add'|'remove', role: 'titular'|'reserva', athlete_ids: [...] }
    """
    if cat not in CATEGORIES:
        return jsonify({"error": "Categoria inválida"}), 400

    body = request.get_json(silent=True) or {}
    action      = body.get("action")
    role        = body.get("role")
    athlete_ids = body.get("athlete_ids", [])

    if action not in ("add", "remove"):
        return jsonify({"error": "action deve ser 'add' ou 'remove'"}), 400
    if role not in ("titular", "reserva"):
        return jsonify({"error": "role deve ser 'titular' ou 'reserva'"}), 400
    if not isinstance(athlete_ids, list) or not athlete_ids:
        return jsonify({"error": "athlete_ids deve ser lista não-vazia"}), 400

    athletes_db = read_json("athletes.json")
    all_ids     = {a["id"] for a in athletes_db["data"]}
    bad = [aid for aid in athlete_ids if aid not in all_ids]
    if bad:
        return jsonify({"error": f"IDs de atletas inválidos: {bad}"}), 400

    seasons_db = read_json("seasons.json")
    season = next((s for s in seasons_db["data"] if s["id"] == season_id), None)
    if not season:
        return jsonify({"error": "Temporada não encontrada"}), 404

    setup     = season["category_setup"][cat]
    key       = f"{role}_ids"
    other_key = "reserva_ids" if role == "titular" else "titular_ids"
    ids_set   = set(athlete_ids)

    if action == "add":
        existing = list(setup[key])
        new_ids  = existing + [aid for aid in athlete_ids if aid not in set(existing)]
        # Remove estes atletas do papel oposto para evitar sobreposição
        other_ids = [x for x in setup[other_key] if x not in ids_set]
        # Verificar conflito de titular em outras categorias
        if role == "titular":
            for other_cat, other_setup in season["category_setup"].items():
                if other_cat == cat:
                    continue
                conflict = ids_set & set(other_setup["titular_ids"])
                if conflict:
                    nm = {a["id"]: a["nome"] for a in athletes_db["data"]}
                    names = [nm.get(aid, aid) for aid in conflict]
                    return jsonify({"error": f"Atleta(s) já titular(es) em Cat {other_cat}: {', '.join(names)}"}), 400
    else:  # remove
        new_ids   = [x for x in setup[key] if x not in ids_set]
        other_ids = list(setup[other_key])

    if role == "titular":
        season["category_setup"][cat] = {"titular_ids": new_ids, "reserva_ids": other_ids}
    else:
        season["category_setup"][cat] = {"titular_ids": other_ids, "reserva_ids": new_ids}

    write_json("seasons.json", seasons_db)

    # Atualiza current_category dos titulares adicionados
    if action == "add" and role == "titular":
        changed = False
        for atleta in athletes_db["data"]:
            if atleta["id"] in ids_set and atleta["current_category"] != cat:
                atleta["current_category"] = cat
                atleta["admin_confirmed"]   = True
                changed = True
        if changed:
            write_json("athletes.json", athletes_db)

    return jsonify({
        "ok":     True,
        "cat":    cat,
        "action": action,
        "role":   role,
        "count":  len(athlete_ids),
        "setup":  season["category_setup"][cat],
    })


# ---------------------------------------------------------------------------
# Rodadas
# ---------------------------------------------------------------------------

def _guest_display_map() -> dict:
    """Retorna {guest_id: {'nome': nome_display, 'apelido': nome_display}} de todos os convidados."""
    try:
        gr_db = read_json("guest_requests.json")
    except Exception:
        return {}
    result = {}
    for gr in gr_db.get("data", []):
        cg = gr.get("confirmed_guest") or {}
        gid = cg.get("guest_id")
        if gid:
            result[gid] = {"nome": cg.get("nome_display", gid), "apelido": cg.get("nome_display", gid),
                           "telefone": cg.get("telefone")}
    return result


def _enrich_round(rnd: dict, athletes_by_id: dict) -> dict:
    """Adiciona nomes dos atletas aos grupos e aos sets para consumo do frontend."""
    # Merge guest names so guest_* IDs resolve correctly
    combined = {**athletes_by_id, **_guest_display_map()}
    athletes_by_id = combined
    enriched = dict(rnd)

    enriched["groups_named"] = {
        cat: [
            [_display_name(athletes_by_id.get(aid, {"nome": aid})) for aid in group]
            for group in groups
        ]
        for cat, groups in rnd.get("groups", {}).items()
    }

    enriched["groups_telefones"] = {
        cat: [
            [athletes_by_id.get(aid, {}).get("telefone") for aid in group]
            for group in groups
        ]
        for cat, groups in rnd.get("groups", {}).items()
    }

    enriched["groups_sets_named"] = {
        cat: [
            [
                {
                    "set": s["set"],
                    "team_a": [_display_name(athletes_by_id.get(aid, {"nome": aid})) for aid in s["team_a"]],
                    "team_b": [_display_name(athletes_by_id.get(aid, {"nome": aid})) for aid in s["team_b"]],
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

    # Calcula start_date / end_date da rodada a partir da temporada
    from datetime import timedelta as _td
    round_duration_days = season.get("round_duration_days", 10)
    season_start = season.get("start_date")
    if season_start:
        _start_dt = datetime.strptime(season_start, "%Y-%m-%d")
        _round_start_dt = _start_dt + _td(days=(round_number - 1) * round_duration_days)
        _round_end_dt = _round_start_dt + _td(days=round_duration_days - 1)
        round_start_date = _round_start_dt.strftime("%Y-%m-%d")
        round_end_date = _round_end_dt.strftime("%Y-%m-%d")
    else:
        round_start_date = None
        round_end_date = None

    # Prazo padrão: último dia da rodada às 22:00 BRT
    if not deadline_slots and round_end_date:
        deadline_slots = f"{round_end_date}T22:00:00-03:00"

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
        "start_date": round_start_date,
        "end_date": round_end_date,
        "deadline_slots": deadline_slots,
        "draw_authorized": False,
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

    # Notifica todos os atletas participantes da rodada
    all_athlete_ids: set[str] = set()
    for cat_groups in groups_flat.values():
        for group in cat_groups:
            all_athlete_ids.update(group)
    period = ""
    if round_start_date and round_end_date:
        period = f" ({round_start_date} a {round_end_date})"
    for aid in all_athlete_ids:
        try:
            _create_notification(
                aid, "round_drawn",
                f"Rodada {round_number} sorteada!",
                f"Você foi sorteado para a Rodada {round_number}{period}. Marque seus horários disponíveis.",
                "#mesa/home",
            )
        except Exception:
            pass

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


@app.route("/api/rounds/<round_id>/authorize-draw", methods=["POST"])
@require_admin
def authorize_draw(round_id):
    """Admin autoriza sorteio da próxima rodada antes do dia final."""
    rounds_db = read_json("rounds.json")
    rnd = next((r for r in rounds_db["data"] if r["id"] == round_id), None)
    if not rnd:
        return jsonify({"error": "Rodada não encontrada"}), 404
    if rnd["status"] == "closed":
        return jsonify({"error": "Rodada já encerrada"}), 400
    rnd["draw_authorized"] = True
    rnd["draw_authorized_at"] = now_iso()
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
    from engines.schedule_engine import check_deadline_passed, validate_slot_datetime

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

    # Trava: se o grupo já teve horário confirmado automaticamente, bloqueia edição
    cat_pre, group_idx_pre = _find_athlete_group(rnd, athlete_id)
    if cat_pre is not None:
        os_cat = rnd.get("official_slots", {}).get(cat_pre, [])
        if group_idx_pre < len(os_cat):
            os_entry = os_cat[group_idx_pre]
            if os_entry.get("status") == "resolved" and os_entry.get("resolved_by") == "auto":
                if not os_entry.get("unlock_approved"):
                    return jsonify({
                        "error": "Horário do grupo já confirmado automaticamente. Para alterar, solicite desbloqueio ao admin.",
                        "locked": True,
                        "slot": os_entry.get("slot"),
                    }), 423
    cat, group_idx = _find_athlete_group(rnd, athlete_id)
    if cat is None:
        return jsonify({"error": "Atleta não pertence a nenhum grupo nesta rodada"}), 403

    body = request.get_json(silent=True) or {}
    submitted_slots = body.get("slots", [])

    # Valida slots contra a janela de datas da rodada (Art. 28)
    start_date = rnd.get("start_date")
    end_date = rnd.get("end_date")
    if start_date and end_date and submitted_slots:
        invalid = [s for s in submitted_slots if not validate_slot_datetime(s, start_date, end_date)]
        if invalid:
            return jsonify({"error": f"Slots inválidos para a rodada: {invalid}"}), 400

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

    # Sprint B: verificar se agora todos os membros do grupo têm interseção
    # Se sim, resolver automaticamente sem precisar de ação do admin
    auto_resolved = False
    auto_slot = None
    all_have_slots = False
    try:
        from engines.schedule_engine import resolve_group_slot
        group = rnd["groups"][cat][group_idx]
        slots_db_fresh = read_json("slots.json")
        round_slots_all = [s for s in slots_db_fresh["data"] if s["round_id"] == round_id]
        slots_by_athlete = {s["athlete_id"]: s["slots"] for s in round_slots_all}
        group_slots_map = {aid: slots_by_athlete.get(aid, []) for aid in group}

        # Só auto-resolve se TODOS os atletas não-convidado do grupo já têm slots
        real_members = [aid for aid in group if not aid.startswith("guest_")]
        all_have_slots = all(group_slots_map.get(aid) for aid in real_members)

        if all_have_slots:
            result = resolve_group_slot(group, group_slots_map)
            if result["status"] == "resolved":
                official_slots = rnd.setdefault("official_slots", {})
                if cat not in official_slots:
                    official_slots[cat] = [
                        {"slot": None, "status": "pending", "resolved_by": None, "wo_athlete_ids": []}
                        for _ in rnd["groups"][cat]
                    ]
                current = official_slots[cat][group_idx]
                # Só auto-resolve se ainda não estava resolvido por admin
                if current.get("status") != "resolved" or current.get("resolved_by") != "admin":
                    official_slots[cat][group_idx] = {
                        "slot":              result["slot"],
                        "status":            "resolved",
                        "resolved_by":       "auto",
                        "wo_athlete_ids":    result["wo_athlete_ids"],
                        "participating_ids": result["participating_ids"],
                    }
                    write_json("rounds.json", rounds_db)
                    auto_resolved = True
                    auto_slot = result["slot"]
    except Exception:
        pass  # falha silenciosa — não prejudica o save do slot

    return jsonify({"ok": True, "slots": submitted_slots,
                    "auto_resolved": auto_resolved, "auto_slot": auto_slot,
                    "all_submitted": all_have_slots})


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


@app.route("/api/rounds/<round_id>/slots/unlock-request", methods=["POST"])
@require_atleta
def slots_unlock_request(round_id):
    """Atleta solicita desbloqueio de edição de slots após auto_resolve."""
    athlete_id = session["atleta_id"]
    rounds_db = read_json("rounds.json")
    rnd = next((r for r in rounds_db["data"] if r["id"] == round_id), None)
    if not rnd:
        return jsonify({"error": "Rodada não encontrada"}), 404

    cat, group_idx = _find_athlete_group(rnd, athlete_id)
    if cat is None:
        return jsonify({"error": "Atleta não pertence a nenhum grupo nesta rodada"}), 403

    os_cat = rnd.get("official_slots", {}).get(cat, [])
    if group_idx >= len(os_cat) or os_cat[group_idx].get("status") != "resolved":
        return jsonify({"error": "Grupo não possui horário confirmado"}), 400
    if os_cat[group_idx].get("resolved_by") != "auto":
        return jsonify({"error": "Apenas horários confirmados automaticamente podem ser contestados"}), 400

    body = request.get_json(silent=True) or {}
    reason = (body.get("reason") or "").strip()
    if not reason:
        return jsonify({"error": "Informe o motivo da solicitação"}), 400

    os_cat[group_idx]["unlock_request"] = {
        "requested_by": athlete_id,
        "reason": reason,
        "requested_at": now_iso(),
        "status": "pending",
    }
    write_json("rounds.json", rounds_db)

    athletes_db = read_json("athletes.json")
    nome = _display_name(next((a for a in athletes_db["data"] if a["id"] == athlete_id), {"nome": athlete_id}))
    return jsonify({"ok": True, "message": f"Solicitação de {nome} registrada. O admin será notificado."})


@app.route("/api/rounds/<round_id>/groups/<cat>/<int:group_idx>/unlock", methods=["POST"])
@require_admin
def slots_unlock(round_id, cat, group_idx):
    """Admin aprova ou rejeita solicitação de desbloqueio de slots."""
    if cat not in CATEGORIES:
        return jsonify({"error": "Categoria inválida"}), 400

    body = request.get_json(silent=True) or {}
    decision = body.get("decision")  # "approve" | "reject"
    if decision not in ("approve", "reject"):
        return jsonify({"error": "decision deve ser 'approve' ou 'reject'"}), 400

    rounds_db = read_json("rounds.json")
    rnd = next((r for r in rounds_db["data"] if r["id"] == round_id), None)
    if not rnd:
        return jsonify({"error": "Rodada não encontrada"}), 404

    os_cat = rnd.get("official_slots", {}).get(cat, [])
    if group_idx >= len(os_cat):
        return jsonify({"error": "Grupo não encontrado"}), 404

    entry = os_cat[group_idx]
    if not entry.get("unlock_request"):
        return jsonify({"error": "Nenhuma solicitação de desbloqueio pendente"}), 400

    if decision == "approve":
        # Reseta o slot para pending, permitindo nova edição
        os_cat[group_idx] = {
            "slot": None,
            "status": "pending",
            "resolved_by": None,
            "wo_athlete_ids": [],
            "unlock_approved": True,
            "unlock_history": entry.get("unlock_request"),
        }
        # Notifica membros do grupo
        group = rnd.get("groups", {}).get(cat, [[]])[group_idx] if group_idx < len(rnd.get("groups", {}).get(cat, [])) else []
        for aid in group:
            try:
                _create_notification(aid, "slot_unlocked",
                    "Desbloqueio de slots aprovado",
                    f"O admin aprovou a revisão do horário — Cat {cat} Grupo {group_idx+1} Rod {rnd['round_number']}. Atualize sua disponibilidade.",
                    "#mesa/slots")
            except Exception:
                pass
        msg = "Desbloqueio aprovado. O grupo pode remarcar os horários."
    else:
        entry["unlock_request"]["status"] = "rejected"
        requester = entry["unlock_request"].get("requested_by")
        if requester:
            try:
                _create_notification(requester, "slot_unlock_rejected",
                    "Solicitação de desbloqueio negada",
                    f"O admin manteve o horário confirmado — Cat {cat} G{group_idx+1} Rod {rnd['round_number']}.",
                    "#mesa/slots")
            except Exception:
                pass
        msg = "Solicitação rejeitada. Horário original mantido."

    write_json("rounds.json", rounds_db)
    return jsonify({"ok": True, "decision": decision, "message": msg})


@app.route("/api/rounds/<round_id>/groups/<cat>/<int:group_idx>/slot", methods=["PUT"])
@require_admin
def slots_mediate(round_id, cat, group_idx):
    """Art. 27: admin define manualmente o horário quando não há interseção."""
    from engines.schedule_engine import validate_slot_datetime

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

    # Valida o slot contra a janela de datas da rodada
    start_date = rnd.get("start_date")
    end_date = rnd.get("end_date")
    if start_date and end_date and not validate_slot_datetime(slot, start_date, end_date):
        return jsonify({"error": f"Slot {slot!r} não é elegível para esta rodada (Art. 28)"}), 400

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

    # Notify group about the confirmed slot
    try:
        _group_ids = rnd.get("groups", {}).get(cat, [[]])[group_idx] if group_idx < len(rnd.get("groups", {}).get(cat, [])) else []
        for _aid in _group_ids:
            _create_notification(
                _aid, "slot_confirmed",
                f"Horário confirmado — Rodada {rnd['round_number']}",
                f"Horário oficial: {slot} (Cat {cat} G{group_idx+1}). Acesse o app.",
                "#mesa/grupo"
            )
    except Exception:
        pass

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

    rounds_db    = read_json("rounds.json")
    round_num_map = {r["id"]: r.get("round_number", 0) for r in rounds_db["data"]}

    response: dict[str, list] = {}
    for cat in cats:
        setup = category_setup.get(cat, {})
        titular_ids = setup.get("titular_ids", [])
        athletes_in_cat = [
            {**a, "nome": _display_name(a)}
            for a in athletes_db["data"] if a["id"] in titular_ids
        ]

        current = compute_ranking(
            athletes_in_cat, results_db["data"], category=cat, season_id=season_id,
        )

        # Ranking anterior: exclui os resultados da última rodada disputada nesta cat
        cat_confirmed = [
            r for r in results_db["data"]
            if r.get("status") == "confirmed"
            and r.get("season_id") == season_id
            and r.get("cat") == cat
        ]
        prev_rank_map: dict[str, int] = {}
        if cat_confirmed:
            max_rnd = max(round_num_map.get(r.get("round_id", ""), 0) for r in cat_confirmed)
            latest_round_ids = {
                r["id"] for r in cat_confirmed
                if round_num_map.get(r.get("round_id", ""), 0) == max_rnd
            }
            prev_results = [r for r in results_db["data"] if r["id"] not in latest_round_ids]
            prev_ranking = compute_ranking(
                athletes_in_cat, prev_results, category=cat, season_id=season_id,
            )
            prev_rank_map = {e["athlete_id"]: e["rank"] for e in prev_ranking}

        for entry in current:
            prev = prev_rank_map.get(entry["athlete_id"])
            entry["rank_delta"] = (prev - entry["rank"]) if prev is not None else None

        response[cat] = current

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

    all_athletes = [
        {**a, "nome": _display_name(a)}
        for a in athletes_db["data"] if a.get("status") == "ativo"
    ]
    ranking = compute_ranking(all_athletes, results_db["data"], season_id=season_id)
    return jsonify(ranking)


# ---------------------------------------------------------------------------
# Resultados (Sprint 5)
# ---------------------------------------------------------------------------

@app.route("/api/rounds/<round_id>/results", methods=["GET"])
def get_round_results(round_id):
    """Lista todos os resultados de uma rodada (enriquecidos com nomes)."""
    results_db = read_json("results.json")
    round_results = [r for r in results_db["data"] if r["round_id"] == round_id]
    athletes_by_id = {a["id"]: a for a in read_json("athletes.json")["data"]}
    return jsonify([_enrich_result(r, athletes_by_id) for r in round_results])


@app.route("/api/rounds/<round_id>/results", methods=["POST"])
def submit_result(round_id):
    """Atleta ou admin lança resultado de um grupo (Art. 7+8+9). Body: {cat, group_idx, sets}."""
    from engines.score_engine import validate_group_scores, calculate_group_result

    is_admin = session.get("is_admin", False)
    athlete_id = session.get("atleta_id")
    if not is_admin and not athlete_id:
        return jsonify({"error": "Autenticação necessária"}), 401

    rounds_db = read_json("rounds.json")
    rnd = next((r for r in rounds_db["data"] if r["id"] == round_id), None)
    if not rnd:
        return jsonify({"error": "Rodada não encontrada"}), 404
    if rnd.get("status") == "closed":
        return jsonify({"error": "Rodada encerrada — use o endpoint de override para corrigir resultados"}), 400

    body = request.get_json(silent=True) or {}
    cat = body.get("cat")
    group_idx = body.get("group_idx")
    sets = body.get("sets")

    if cat not in (rnd.get("groups") or {}):
        return jsonify({"error": "Categoria inválida"}), 400

    groups_cat = rnd["groups"][cat]
    if not isinstance(group_idx, int) or group_idx < 0 or group_idx >= len(groups_cat):
        return jsonify({"error": "Índice de grupo inválido"}), 400

    group = groups_cat[group_idx]

    if not is_admin and athlete_id not in group:
        return jsonify({"error": "Você não pertence a este grupo"}), 403

    if not isinstance(sets, list):
        return jsonify({"error": "Campo 'sets' é obrigatório"}), 400

    errors = validate_group_scores(sets)
    if errors:
        return jsonify({"error": "Placar inválido", "details": errors}), 400

    results_db = read_json("results.json")
    existing = next(
        (r for r in results_db["data"]
         if r["round_id"] == round_id and r["cat"] == cat and r["group_idx"] == group_idx),
        None,
    )

    # Atleta só lança se ainda não existe resultado; admin sempre pode sobrescrever
    if existing and not is_admin:
        return jsonify({"error": "Resultado já lançado. Use a contestação se discordar."}), 409

    score_result = calculate_group_result(group, sets)

    results_db["data"] = [
        r for r in results_db["data"]
        if not (r["round_id"] == round_id and r["cat"] == cat and r["group_idx"] == group_idx)
    ]

    submitted_by = "admin" if is_admin else athlete_id
    # Quem lança já confirma o próprio resultado; convidados são auto-confirmados
    initial_confirmations = {} if is_admin else {athlete_id: "confirmed"}
    for _aid in group:
        if _aid.startswith("guest_") and _aid not in initial_confirmations:
            initial_confirmations[_aid] = "confirmed"

    result_record = {
        "id": str(uuid.uuid4()),
        "round_id": round_id,
        "season_id": rnd["season_id"],
        "cat": cat,
        "group_idx": group_idx,
        "group": group,
        "sets": sets,
        "scores": score_result,
        "status": "pending_confirmation",
        "submitted_by": submitted_by,
        "submitted_at": now_iso(),
        "confirmations": initial_confirmations,
        "contests": {},   # {athlete_id: {reason, sets, scores, submitted_at}}
    }
    results_db["data"].append(result_record)
    write_json("results.json", results_db)

    # In-app notification to group members about the new result
    try:
        _athl_db = read_json("athletes.json")
        _amap = {a["id"]: a for a in _athl_db["data"]}
        _submitter = _display_name(_amap.get(submitted_by, {"nome": "Admin"})) if not is_admin else "Admin"
        for _aid in group:
            if _aid != athlete_id:
                _create_notification(
                    _aid, "result_submitted",
                    f"Resultado lançado — Rodada {rnd['round_number']}",
                    f"{_submitter} lançou o placar do Grupo {group_idx+1} Cat {cat}. Confirme no SuperRank.",
                    "#mesa/resultado"
                )
    except Exception:
        pass

    athletes_by_id = {a["id"]: a for a in read_json("athletes.json")["data"]}
    return jsonify(_enrich_result(result_record, athletes_by_id)), 201


@app.route("/api/rounds/<round_id>/results/batch", methods=["POST"])
@require_admin
@transactional
def submit_results_batch(round_id):
    """Admin lança vários resultados de uma rodada de uma vez.

    Body: {"results": [{"cat", "group_idx", "sets"}, ...]}.
    Valida cada grupo; aplica os válidos numa só gravação e retorna os que
    falharam (placar inválido etc.). Admin sobrescreve resultados existentes.
    """
    from engines.score_engine import validate_group_scores, calculate_group_result

    rounds_db = read_json("rounds.json")
    rnd = next((r for r in rounds_db["data"] if r["id"] == round_id), None)
    if not rnd:
        return jsonify({"error": "Rodada não encontrada"}), 404
    if rnd.get("status") == "closed":
        return jsonify({"error": "Rodada encerrada — use o override para corrigir."}), 400

    body = request.get_json(silent=True) or {}
    items = body.get("results")
    if not isinstance(items, list) or not items:
        return jsonify({"error": "Campo 'results' (lista) é obrigatório"}), 400

    groups_all = rnd.get("groups") or {}
    results_db = read_json("results.json")
    saved, failed = [], []

    for it in items:
        cat = (it or {}).get("cat")
        gi  = (it or {}).get("group_idx")
        sets = (it or {}).get("sets")
        if cat not in groups_all:
            failed.append({"cat": cat, "group_idx": gi, "error": "Categoria inválida"}); continue
        groups_cat = groups_all[cat]
        if not isinstance(gi, int) or gi < 0 or gi >= len(groups_cat):
            failed.append({"cat": cat, "group_idx": gi, "error": "Índice de grupo inválido"}); continue
        if not isinstance(sets, list):
            failed.append({"cat": cat, "group_idx": gi, "error": "Placar ausente"}); continue
        errs = validate_group_scores(sets)
        if errs:
            failed.append({"cat": cat, "group_idx": gi, "error": "; ".join(errs)}); continue

        group = groups_cat[gi]
        score_result = calculate_group_result(group, sets)
        # Admin sobrescreve: remove resultado anterior do mesmo grupo.
        results_db["data"] = [
            r for r in results_db["data"]
            if not (r["round_id"] == round_id and r["cat"] == cat and r["group_idx"] == gi)
        ]
        confirmations = {aid: "confirmed" for aid in group if aid.startswith("guest_")}
        results_db["data"].append({
            "id": str(uuid.uuid4()),
            "round_id": round_id,
            "season_id": rnd["season_id"],
            "cat": cat,
            "group_idx": gi,
            "group": group,
            "sets": sets,
            "scores": score_result,
            "status": "pending_confirmation",
            "submitted_by": "admin",
            "submitted_at": now_iso(),
            "confirmations": confirmations,
            "contests": {},
        })
        saved.append({"cat": cat, "group_idx": gi})

    if saved:
        write_json("results.json", results_db)
        log_audit("results_batch_submitted", {
            "round_id": round_id,
            "round_number": rnd.get("round_number"),
            "season_id": rnd.get("season_id"),
            "saved": len(saved),
            "failed": len(failed),
        })
        # Notifica os membros dos grupos salvos para confirmarem.
        try:
            for s in saved:
                for _aid in groups_all[s["cat"]][s["group_idx"]]:
                    _create_notification(
                        _aid, "result_submitted",
                        f"Resultado lançado — Rodada {rnd['round_number']}",
                        f"Admin lançou o placar do Grupo {s['group_idx']+1} Cat {s['cat']}. Confirme no SuperRank.",
                        "#mesa/resultado",
                    )
        except Exception:
            pass

    return jsonify({"saved": len(saved), "failed": failed, "saved_groups": saved})


@app.route("/api/results/<result_id>/confirm", methods=["POST"])
@require_atleta
def confirm_result(result_id):
    """Atleta confirma ou contesta um resultado. Contest inclui motivo + placar correto."""
    from engines.score_engine import validate_group_scores, calculate_group_result

    athlete_id = session["atleta_id"]
    body = request.get_json(silent=True) or {}
    action = body.get("action")  # "confirmed" | "contested"
    reason = (body.get("reason") or "").strip()
    contested_sets = body.get("sets")  # versão do atleta (opcional na contestação)

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

    # Convidados não podem contestar — apenas confirmar
    if athlete_id.startswith("guest_") and action == "contested":
        action = "confirmed"

    result["confirmations"][athlete_id] = action

    if action == "contested":
        if not reason:
            return jsonify({"error": "Motivo da contestação é obrigatório"}), 400
        contest_entry = {"reason": reason, "submitted_at": now_iso()}
        if contested_sets:
            errors = validate_group_scores(contested_sets)
            if errors:
                return jsonify({"error": "Placar contestado inválido", "details": errors}), 400
            contest_entry["sets"] = contested_sets
            contest_entry["scores"] = calculate_group_result(result["group"], contested_sets)
        if "contests" not in result:
            result["contests"] = {}
        result["contests"][athlete_id] = contest_entry
        result["status"] = "contested"
    else:
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
    log_audit("result_override", {
        "result_id": result_id,
        "action": action,
        "cat": result.get("cat"),
        "group_idx": result.get("group_idx"),
    })

    # Notify group about contest resolution
    try:
        for _aid in result.get("group", []):
            _create_notification(
                _aid, "contest_resolved",
                f"Contestação resolvida",
                f"O admin decidiu sobre o resultado (Cat {result.get('cat')} G{result.get('group_idx',0)+1}). Acesse o app.",
                "#mesa/resultado"
            )
    except Exception:
        pass

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
    if rnd.get("status") == "closed":
        return jsonify({"error": "Rodada encerrada — não é possível lançar WO em rodada fechada"}), 400

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
        _display_name(athletes_by_id.get(aid, {"nome": aid})) for aid in result["group"]
    ]
    enriched["scores_named"] = {
        _display_name(athletes_by_id.get(aid, {"nome": aid})): v
        for aid, v in result.get("scores", {}).items()
    }
    enriched["confirmations_named"] = {
        _display_name(athletes_by_id.get(aid, {"nome": aid})): v
        for aid, v in result.get("confirmations", {}).items()
    }
    # Enriquece contestações com nomes
    enriched["contests_named"] = {
        _display_name(athletes_by_id.get(aid, {"nome": aid})): contest
        for aid, contest in result.get("contests", {}).items()
    }
    # Nome de quem lançou
    submitted_by = result.get("submitted_by", "admin")
    if submitted_by == "admin":
        enriched["submitted_by_name"] = "Admin"
    else:
        enriched["submitted_by_name"] = _display_name(
            athletes_by_id.get(submitted_by, {"nome": submitted_by})
        )
    return enriched


# ---------------------------------------------------------------------------
# Contexto do atleta (mesa screens)
# ---------------------------------------------------------------------------

def _mesa_context_guest(athlete_id: str):
    """Contexto simplificado para convidados — dados em guest_requests.json."""
    gr_db = read_json("guest_requests.json")
    gr = next(
        (g for g in gr_db["data"] if (g.get("confirmed_guest") or {}).get("guest_id") == athlete_id),
        None,
    )
    if not gr:
        return jsonify({"error": "Convidado não encontrado"}), 404

    cg = gr["confirmed_guest"]
    athlete = {
        "id": athlete_id,
        "nome": cg["nome_display"],
        "apelido": cg["nome_display"],
        "telefone": cg.get("telefone", ""),
        "is_guest": True,
        "current_category": gr.get("cat"),
        "status": "ativo",
    }

    rounds_db  = read_json("rounds.json")
    seasons_db = read_json("seasons.json")
    slots_db   = read_json("slots.json")

    rnd    = next((r for r in rounds_db["data"]  if r["id"] == gr["round_id"]),  None)
    season = next((s for s in seasons_db["data"] if s["id"] == gr["season_id"]), None)

    if not rnd:
        return jsonify({"athlete": athlete, "season": None, "round": None, "group": None,
                        "official_slot": None, "my_slots": [], "is_guest": True,
                        "group_slots_status": [], "pending_result": None, "eligible_slots": []})

    athletes_db   = read_json("athletes.json")
    athletes_by_id = {a["id"]: a for a in athletes_db["data"]}
    athletes_by_id.update(_guest_display_map())

    cat       = gr["cat"]
    group_idx = gr["group_idx"]
    groups    = rnd.get("groups", {}).get(cat, [])
    group     = groups[group_idx] if group_idx < len(groups) else []

    sets_per_group = rnd.get("groups_sets", {}).get(cat, [])
    sets_raw       = sets_per_group[group_idx] if group_idx < len(sets_per_group) else []
    enriched_rnd   = _enrich_round(rnd, athletes_by_id)
    sets_named_per_group = enriched_rnd.get("groups_sets_named", {}).get(cat, [])
    sets_named     = sets_named_per_group[group_idx] if group_idx < len(sets_named_per_group) else []

    group_info = {
        "athlete_ids": group,
        "names": [_display_name(athletes_by_id.get(aid, {"nome": aid})) for aid in group],
        "category": cat,
        "group_index": group_idx,
        "sets": sets_raw,
        "sets_named": sets_named,
        "location": season.get("location", "—") if season else "—",
    }

    official_slots_cat = rnd.get("official_slots", {}).get(cat, [])
    official_slot = official_slots_cat[group_idx] if group_idx < len(official_slots_cat) else None

    group_slots_status = []
    for aid in group:
        slot_record = next(
            (s for s in slots_db["data"] if s["round_id"] == rnd["id"] and s["athlete_id"] == aid),
            None,
        )
        a_data = athletes_by_id.get(aid, {})
        group_slots_status.append({
            "athlete_id": aid,
            "nome": _display_name(a_data),
            "has_slots": bool(slot_record and slot_record.get("slots")),
            "telefone": a_data.get("telefone"),
        })

    my_slot_record = next(
        (s for s in slots_db["data"] if s["round_id"] == rnd["id"] and s["athlete_id"] == athlete_id),
        None,
    )

    return jsonify({
        "athlete": athlete,
        "season": _safe_season(season) if season else None,
        "round": {
            "id": rnd["id"],
            "round_number": rnd["round_number"],
            "rounds_total": season["rounds_total"] if season else 0,
            "start_date": rnd.get("start_date"),
            "end_date": rnd.get("end_date"),
            "deadline_slots": rnd.get("deadline_slots"),
            "draw_authorized": rnd.get("draw_authorized", False),
            "status": rnd["status"],
        },
        "group": group_info,
        "official_slot": official_slot,
        "my_slots": my_slot_record["slots"] if my_slot_record else [],
        "eligible_slots": _eligible_for_round(rnd),
        "pending_result": None,
        "group_slots_status": group_slots_status,
        "is_guest": True,
    })


@app.route("/api/mesa/context")
@require_atleta
def mesa_context():
    """Retorna o contexto completo do atleta logado para as telas de mesa."""
    athlete_id = session["atleta_id"]

    if session.get("is_guest"):
        return _mesa_context_guest(athlete_id)

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
            "names": [_display_name(athletes_by_id.get(aid, {"nome": aid})) for aid in group],
            "category": cat,
            "group_index": group_idx,
            "sets": (current_round.get("groups_sets", {}).get(cat, []) or [[]])[group_idx]
                    if group_idx < len(current_round.get("groups_sets", {}).get(cat, [])) else [],
            "sets_named": (_enrich_round(current_round, athletes_by_id)
                          .get("groups_sets_named", {}).get(cat, []) or [[]])[group_idx]
                    if group_idx < len(_enrich_round(current_round, athletes_by_id)
                          .get("groups_sets_named", {}).get(cat, [])) else [],
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
    confirmed_result = None
    result_status = "none"  # none | pending_mine | pending_peers | contested | confirmed
    if cat is not None:
        group_result_raw = next(
            (r for r in results_db["data"]
             if r["round_id"] == current_round["id"]
             and r["cat"] == cat
             and r["group_idx"] == group_idx),
            None,
        )
        if group_result_raw:
            rs = group_result_raw.get("status", "")
            already_acted = athlete_id in group_result_raw.get("confirmations", {})
            if rs == "confirmed":
                result_status = "confirmed"
            elif rs == "contested":
                result_status = "contested"
            elif rs == "pending_confirmation":
                if already_acted:
                    result_status = "pending_peers"
                else:
                    result_status = "pending_mine"
                    pending_result = _enrich_result(group_result_raw, athletes_by_id)

        confirmed_raw = next(
            (r for r in results_db["data"]
             if r["round_id"] == current_round["id"]
             and r["cat"] == cat
             and r["group_idx"] == group_idx
             and r["status"] == "confirmed"),
            None,
        )
        if confirmed_raw:
            confirmed_result = _enrich_result(confirmed_raw, athletes_by_id)

    # Status de slots de cada colega do grupo
    group_slots_status = []
    group_slots_map = {}  # slot -> contagem de membros que já marcaram
    if cat is not None and group_info:
        for aid in group_info["athlete_ids"]:
            slot_record = next(
                (s for s in slots_db["data"]
                 if s["round_id"] == current_round["id"] and s["athlete_id"] == aid),
                None,
            )
            has = bool(slot_record and slot_record.get("slots"))
            group_slots_status.append({
                "athlete_id": aid,
                "nome": _display_name(athletes_by_id.get(aid, {"nome": aid})),
                "has_slots": has,
                "telefone": athletes_by_id.get(aid, {}).get("telefone"),
            })
            if has and aid != athlete_id:
                for s in slot_record["slots"]:
                    group_slots_map[s] = group_slots_map.get(s, 0) + 1

    # Evolução de posição no ranking (rank_delta)
    rank_delta = None
    if cat is not None:
        from engines.ranking_engine import compute_ranking
        cat_setup = season.get("category_setup", {})
        titular_ids = cat_setup.get(cat, {}).get("titular_ids", [])
        cat_athletes = [
            {**a, "nome": _display_name(a)}
            for a in athletes_db["data"] if a["id"] in titular_ids
        ]
        confirmed_all = [r for r in results_db["data"] if r.get("status") == "confirmed"]
        ranking_now = compute_ranking(cat_athletes, confirmed_all, category=cat, season_id=season["id"])
        my_now = next((r for r in ranking_now if r["athlete_id"] == athlete_id), None)
        if my_now:
            my_season_results = [
                r for r in confirmed_all
                if athlete_id in r.get("group", [])
                and r.get("season_id") == season["id"]
                and r.get("cat") == cat
            ]
            if len(my_season_results) >= 2:
                rounds_num_map = {r["id"]: r.get("round_number", 0) for r in rounds_db["data"]}
                latest = max(my_season_results, key=lambda r: rounds_num_map.get(r.get("round_id", ""), 0))
                prev_confirmed = [r for r in confirmed_all if r["id"] != latest["id"]]
                ranking_prev = compute_ranking(cat_athletes, prev_confirmed, category=cat, season_id=season["id"])
                my_prev = next((r for r in ranking_prev if r["athlete_id"] == athlete_id), None)
                if my_prev:
                    rank_delta = my_prev["rank"] - my_now["rank"]  # positivo = melhorou

    # Round progress: confirmed results vs total groups
    total_groups_count = sum(len(g) for g in current_round.get("groups", {}).values())
    confirmed_count = sum(
        1 for r in results_db["data"]
        if r.get("round_id") == current_round["id"] and r.get("status") == "confirmed"
    )
    round_progress = {"confirmed": confirmed_count, "total": total_groups_count} if total_groups_count > 0 else None

    return jsonify({
        "athlete": _safe_athlete(athlete),
        "season": _safe_season(season),
        "round": {
            "id": current_round["id"],
            "round_number": current_round["round_number"],
            "rounds_total": season["rounds_total"],
            "start_date": current_round.get("start_date"),
            "end_date": current_round.get("end_date"),
            "deadline_slots": current_round.get("deadline_slots"),
            "draw_authorized": current_round.get("draw_authorized", False),
            "status": current_round["status"],
        },
        "group": group_info,
        "official_slot": official_slot,
        "my_slots": my_slot_record["slots"] if my_slot_record else [],
        "eligible_slots": _eligible_for_round(current_round),
        "pending_result": pending_result,
        "confirmed_result": confirmed_result,
        "result_status": result_status,
        "group_slots_status": group_slots_status,
        "group_slots_map": group_slots_map,
        "rank_delta": rank_delta,
        "round_progress": round_progress,
    })


def _display_name(atleta: dict) -> str:
    """Apelido para exibição; fallback para nome completo em cadastros antigos."""
    return atleta.get("apelido") or atleta.get("nome", "")


def _safe_athlete(a: dict) -> dict:
    return {k: v for k, v in a.items() if k != "pin_hash"}


def _safe_season(s: dict) -> dict:
    return {"id": s["id"], "name": s["name"], "status": s["status"], "rounds_total": s["rounds_total"]}


def _save_ranking_snapshot(rnd: dict, all_results: list) -> None:
    """Salva snapshot do ranking de cada categoria ao fechar uma rodada."""
    from engines.ranking_engine import compute_ranking
    season_id = rnd.get("season_id")
    round_id = rnd["id"]
    round_number = rnd.get("round_number", 0)
    closed_at = rnd.get("closed_at", now_iso())

    if not season_id:
        return

    # Load season to know which athletes are in each category
    seasons_db = read_json("seasons.json")
    season = next((s for s in seasons_db["data"] if s["id"] == season_id), None)
    if not season:
        return

    athletes_db = read_json("athletes.json")
    athletes_map = {a["id"]: a for a in athletes_db["data"]}
    cat_setup = season.get("category_setup", {})

    snapshots_db = read_json("ranking_snapshots.json")
    # Only keep one snapshot per (round_id, cat) — idempotent on double-close
    existing_keys = {(s["round_id"], s["cat"]) for s in snapshots_db["data"]}

    confirmed_results = [r for r in all_results if r.get("status") == "confirmed"]

    for cat in CATEGORIES:
        if (round_id, cat) in existing_keys:
            continue
        titular_ids = cat_setup.get(cat, {}).get("titular_ids", [])
        if not titular_ids:
            continue
        cat_athletes = [
            {**athletes_map[aid], "nome": _display_name(athletes_map[aid])}
            for aid in titular_ids if aid in athletes_map
        ]
        ranking = compute_ranking(cat_athletes, confirmed_results, category=cat, season_id=season_id)
        snapshots_db["data"].append({
            "id": str(uuid.uuid4()),
            "round_id": round_id,
            "season_id": season_id,
            "cat": cat,
            "round_number": round_number,
            "closed_at": closed_at,
            "rankings": [
                {
                    "rank": r["rank"],
                    "athlete_id": r["athlete_id"],
                    "nome": r["nome"],
                    "points": r["points"],
                    "wins": r["wins"],
                }
                for r in ranking
            ],
        })

    write_json("ranking_snapshots.json", snapshots_db)


def _eligible_for_round(rnd: dict) -> list:
    """Retorna todos os slots 'YYYY-MM-DD HH:MM' válidos para a janela da rodada."""
    from engines.schedule_engine import eligible_slots_for_round, SLOTS_WEEKDAY
    start_date = rnd.get("start_date")
    end_date = rnd.get("end_date")
    if start_date and end_date:
        return eligible_slots_for_round(start_date, end_date)
    return SLOTS_WEEKDAY  # fallback sem datas


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
    rounds_db   = read_json("rounds.json")

    # Rodadas abertas desta temporada (bloqueio). Rodadas canceladas não bloqueiam.
    open_rounds = [
        r for r in rounds_db["data"]
        if r.get("season_id") == season_id and r.get("status") not in ("closed", "cancelled")
    ]

    category_setup = season.get("category_setup", {})

    # Monta rankings por categoria com notas de desempate
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
                include_tiebreak_notes=True,
            )

    movements = compute_movements(season_rankings)
    names = {a["id"]: a.get("nome", a["id"]) for a in athletes_db["data"]}
    summary = movement_summary(movements, names)

    # Sinaliza atletas com 0 rodadas jogadas que estão em zona de movimento
    from engines.category_engine import movement_count
    ineligible_warnings = []
    moved_ids = set(movements.get("promotions", {}).keys()) | set(movements.get("relegations", {}).keys())
    for cat, ranking in season_rankings.items():
        n = len(ranking)
        m = movement_count(n)
        boundary_ids = (
            {r["athlete_id"] for r in ranking[:m]} |
            {r["athlete_id"] for r in ranking[max(0, n - m):]}
        )
        for entry in ranking:
            if entry["athlete_id"] in boundary_ids and entry["results_count"] == 0:
                ineligible_warnings.append({
                    "athlete_id": entry["athlete_id"],
                    "nome": entry["nome"],
                    "cat": cat,
                    "rank": entry["rank"],
                    "action": "promoted" if entry["athlete_id"] in movements.get("promotions", {}) else
                              "relegated" if entry["athlete_id"] in movements.get("relegations", {}) else "stays",
                })

    return jsonify({
        "season_id":          season_id,
        "season_name":        season["name"],
        "open_rounds_count":  len(open_rounds),
        "open_rounds":        [{"round_number": r.get("round_number"), "end_date": r.get("end_date")} for r in open_rounds],
        "rankings":           season_rankings,
        "movements":          movements,
        "summary":            summary,
        "ineligible_warnings": ineligible_warnings,
    })


@app.route("/api/seasons/<season_id>/ranking/impact")
@require_admin
def ranking_impact(season_id):
    """
    Preview de impacto de um resultado no ranking.
    ?result_id=X — compara ranking sem vs. com o resultado confirmado.
    """
    from engines.ranking_engine import compute_ranking

    result_id = request.args.get("result_id")
    if not result_id:
        return jsonify({"error": "result_id obrigatório"}), 400

    seasons_db  = read_json("seasons.json")
    season = next((s for s in seasons_db["data"] if s["id"] == season_id), None)
    if not season:
        return jsonify({"error": "Temporada não encontrada"}), 404

    results_db  = read_json("results.json")
    target = next((r for r in results_db["data"] if r["id"] == result_id), None)
    if not target:
        return jsonify({"error": "Resultado não encontrado"}), 404

    cat = target.get("cat")
    athletes_db = read_json("athletes.json")
    titular_ids = season.get("category_setup", {}).get(cat, {}).get("titular_ids", [])
    athletes_in_cat = [a for a in athletes_db["data"] if a["id"] in titular_ids]

    # Ranking ANTES: exclui o resultado em questão (independente do status atual)
    results_before = [r for r in results_db["data"] if r["id"] != result_id]
    ranking_before = compute_ranking(athletes_in_cat, results_before, category=cat, season_id=season_id)

    # Ranking DEPOIS: inclui o resultado como confirmed
    target_as_confirmed = {**target, "status": "confirmed"}
    results_after = [r if r["id"] != result_id else target_as_confirmed for r in results_db["data"]]
    ranking_after = compute_ranking(athletes_in_cat, results_after, category=cat, season_id=season_id)

    before_map = {e["athlete_id"]: e["rank"] for e in ranking_before}
    impact = []
    for entry in ranking_after:
        prev_rank = before_map.get(entry["athlete_id"])
        delta = (prev_rank - entry["rank"]) if prev_rank is not None else None
        impact.append({
            "athlete_id":   entry["athlete_id"],
            "nome":         entry["nome"],
            "rank_before":  prev_rank,
            "rank_after":   entry["rank"],
            "delta":        delta,
            "points_after": entry["points"],
        })

    return jsonify({
        "result_id":  result_id,
        "cat":        cat,
        "impact":     impact,
    })


@app.route("/api/seasons/<season_id>/fechamento/apply", methods=["POST"])
@require_admin
@transactional
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

    rounds_db = read_json("rounds.json")
    open_rounds = [
        r for r in rounds_db["data"]
        if r.get("season_id") == season_id and r.get("status") not in ("closed", "cancelled")
    ]
    if open_rounds:
        nums = ", ".join(str(r.get("round_number", "?")) for r in open_rounds)
        return jsonify({
            "error": f"Existem {len(open_rounds)} rodada(s) ainda abertas (Rodada {nums}). "
                     "Feche todas as rodadas antes de encerrar a temporada."
        }), 400

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
    log_audit("season_closed", {
        "season_id": season_id,
        "season_name": season.get("name"),
        "promotions": len(movements["promotions"]),
        "relegations": len(movements["relegations"]),
    })

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
    rounds_by_id   = {r["id"]: r for r in read_json("rounds.json")["data"]}
    summaries = compute_contested_summary(results_db["data"], athletes_by_id, rounds_by_id)
    return jsonify({
        "contested": summaries,
        "count": count_contested(results_db["data"]),
    })


@app.route("/api/results/<result_id>/admin-confirm", methods=["POST"])
@require_admin
def admin_confirm_result(result_id):
    """Admin força confirmação de um resultado pendente de confirmação pelos atletas."""
    results_db = read_json("results.json")
    result = next((r for r in results_db["data"] if r["id"] == result_id), None)
    if not result:
        return jsonify({"error": "Resultado não encontrado"}), 404
    if result.get("status") not in ("pending_confirmation", "pending"):
        return jsonify({"error": f"Resultado com status '{result.get('status')}' não pode ser forçado"}), 400
    result["status"] = "confirmed"
    result["admin_confirmed_at"] = now_iso()
    write_json("results.json", results_db)
    log_audit("result_admin_confirm", {
        "result_id": result_id,
        "cat": result.get("cat"),
        "group_idx": result.get("group_idx"),
        "round_id": result.get("round_id"),
    })
    return jsonify({"ok": True, "result_id": result_id})


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
    from engines.ranking_engine import compute_ranking
    athletes_db = read_json("athletes.json")
    athlete = next((a for a in athletes_db["data"] if a["id"] == athlete_id), None)
    if not athlete:
        return jsonify({"error": "Atleta não encontrado"}), 404
    seasons_db = read_json("seasons.json")
    results_db = read_json("results.json")
    profile = compute_athlete_profile(athlete, seasons_db["data"], results_db["data"], athletes_db["data"])

    # Sprint 19: posição atual no ranking da temporada ativa
    active_season = next((s for s in seasons_db["data"] if s.get("status") == "active"), None)
    current_rank = None
    cat = athlete.get("current_category")
    if active_season and cat and athlete.get("tipo") == "titular" and athlete.get("status") == "ativo":
        all_athletes = [
            {**a, "nome": _display_name(a)}
            for a in athletes_db["data"] if a.get("status") == "ativo"
        ]
        ranking = compute_ranking(all_athletes, results_db["data"], category=cat, season_id=active_season["id"])
        entry = next((r for r in ranking if r["athlete_id"] == athlete_id), None)
        if entry:
            current_rank = {
                "rank":          entry["rank"],
                "total":         len(ranking),
                "results_count": entry["results_count"],
                "season_name":   active_season["name"],
                "cat":           cat,
            }
    profile["current_rank"] = current_rank
    profile["apelido"] = athlete.get("apelido") or None
    profile["age"] = compute_age(athlete.get("birth_date"))
    profile["photo_url"] = athlete.get("photo_url") or None
    return jsonify(profile)


@app.route("/api/athletes/<athlete_id>/history")
def athlete_public_history(athlete_id):
    """Histórico público de partidas de um atleta (sem autenticação)."""
    from engines.history_engine import compute_athlete_match_history
    athletes_db = read_json("athletes.json")
    athlete = next((a for a in athletes_db["data"] if a["id"] == athlete_id), None)
    if not athlete:
        return jsonify({"error": "Atleta não encontrado"}), 404
    rounds_db   = read_json("rounds.json")
    results_db  = read_json("results.json")
    athletes_by_id = {a["id"]: a for a in athletes_db["data"]}
    limit = min(int(request.args.get("limit", 20)), 50)
    history = compute_athlete_match_history(
        athlete_id, rounds_db["data"], results_db["data"], athletes_by_id
    )
    return jsonify({"history": history[:limit]})


@app.route("/api/athletes/<athlete_id>/ranking-history")
def athlete_ranking_history(athlete_id):
    """Histórico de posição no ranking por rodada (para gráfico de evolução)."""
    athletes_db = read_json("athletes.json")
    athlete = next((a for a in athletes_db["data"] if a["id"] == athlete_id), None)
    if not athlete:
        return jsonify({"error": "Atleta não encontrado"}), 404

    season_id = request.args.get("season_id")
    cat_filter = request.args.get("cat")

    snapshots_db = read_json("ranking_snapshots.json")
    snaps = snapshots_db["data"]

    if season_id:
        snaps = [s for s in snaps if s.get("season_id") == season_id]
    if cat_filter:
        snaps = [s for s in snaps if s.get("cat") == cat_filter]

    # One entry per (season_id, cat, round_number) for this athlete
    history = []
    for snap in sorted(snaps, key=lambda s: (s.get("season_id", ""), s.get("cat", ""), s.get("round_number", 0))):
        entry = next((r for r in snap["rankings"] if r["athlete_id"] == athlete_id), None)
        if entry:
            history.append({
                "round_id": snap["round_id"],
                "season_id": snap["season_id"],
                "cat": snap["cat"],
                "round_number": snap["round_number"],
                "closed_at": snap["closed_at"],
                "rank": entry["rank"],
                "total": len(snap["rankings"]),
                "points": entry["points"],
                "wins": entry["wins"],
            })

    return jsonify({"athlete_id": athlete_id, "history": history})


_PHOTO_ALLOWED_MIMES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
_PHOTO_MAX_BYTES = 10 * 1024 * 1024  # 10 MB (rede de segurança; o cliente já reduz a foto antes de enviar)


def _photo_upload_dir():
    # Fotos no DATA_DIR (volume persistente), NÃO no diretório de código do app
    # (que é efêmero no Railway e some a cada deploy).
    path = os.path.join(DATA_DIR, "uploads", "photos")
    os.makedirs(path, exist_ok=True)
    return path


@app.route("/uploads/photos/<path:filename>")
def serve_photo(filename):
    """Serve as fotos a partir do volume persistente (DATA_DIR/uploads/photos).
    send_from_directory protege contra path traversal."""
    return send_from_directory(_photo_upload_dir(), filename)


def _photo_auth(athlete_id):
    """Returns True if current session may upload/delete this athlete's photo."""
    return session.get("is_admin") or session.get("atleta_id") == athlete_id


@app.route("/api/athletes/<athlete_id>/photo", methods=["POST"])
def athlete_photo_upload(athlete_id):
    """Upload de foto de perfil (admin ou próprio atleta)."""
    if not _photo_auth(athlete_id):
        return jsonify({"error": "Não autorizado"}), 403

    athletes_db = read_json("athletes.json")
    athlete = next((a for a in athletes_db["data"] if a["id"] == athlete_id), None)
    if not athlete:
        return jsonify({"error": "Atleta não encontrado"}), 404

    if "photo" not in request.files:
        return jsonify({"error": "Nenhum arquivo enviado (campo: photo)"}), 400

    file = request.files["photo"]
    if not file.filename:
        return jsonify({"error": "Nome de arquivo vazio"}), 400

    mime = file.content_type or ""
    if mime not in _PHOTO_ALLOWED_MIMES:
        return jsonify({"error": "Formato inválido. Use JPEG, PNG ou WebP."}), 400

    file.seek(0, 2)
    size = file.tell()
    file.seek(0)
    if size > _PHOTO_MAX_BYTES:
        return jsonify({"error": "Arquivo muito grande. Máximo 10 MB."}), 400

    ext = _PHOTO_ALLOWED_MIMES[mime]
    upload_dir = _photo_upload_dir()

    # Remove any old photo for this athlete (possibly different extension)
    for old_ext in _PHOTO_ALLOWED_MIMES.values():
        old_path = os.path.join(upload_dir, f"{athlete_id}.{old_ext}")
        if os.path.exists(old_path):
            os.remove(old_path)

    filename = f"{athlete_id}.{ext}"
    file.save(os.path.join(upload_dir, filename))

    photo_url = f"/uploads/photos/{filename}"
    athlete["photo_url"] = photo_url
    write_json("athletes.json", athletes_db)
    return jsonify({"ok": True, "photo_url": photo_url})


@app.route("/api/athletes/<athlete_id>/photo", methods=["DELETE"])
def athlete_photo_delete(athlete_id):
    """Remove foto de perfil (admin ou próprio atleta)."""
    if not _photo_auth(athlete_id):
        return jsonify({"error": "Não autorizado"}), 403

    athletes_db = read_json("athletes.json")
    athlete = next((a for a in athletes_db["data"] if a["id"] == athlete_id), None)
    if not athlete:
        return jsonify({"error": "Atleta não encontrado"}), 404

    upload_dir = _photo_upload_dir()
    for ext in _PHOTO_ALLOWED_MIMES.values():
        path = os.path.join(upload_dir, f"{athlete_id}.{ext}")
        if os.path.exists(path):
            os.remove(path)

    athlete.pop("photo_url", None)
    write_json("athletes.json", athletes_db)
    return jsonify({"ok": True})


@app.route("/api/h2h/<id_a>/<id_b>")
def h2h(id_a, id_b):
    """Confronto direto entre dois atletas (público, sem auth)."""
    athletes_db = read_json("athletes.json")
    athletes_by_id = {a["id"]: a for a in athletes_db["data"]}

    ath_a = athletes_by_id.get(id_a)
    ath_b = athletes_by_id.get(id_b)
    if not ath_a or not ath_b:
        return jsonify({"error": "Atleta não encontrado"}), 404

    rounds_db = read_json("rounds.json")
    rounds_by_id = {r["id"]: r for r in rounds_db["data"]}
    results_db = read_json("results.json")

    encounters = []
    a_wins = b_wins = 0
    direct_sets_a = direct_sets_b = 0

    for result in results_db["data"]:
        group = result.get("group", [])
        if id_a not in group or id_b not in group:
            continue

        scores = result.get("scores", {})
        sc_a = scores.get(id_a, {})
        sc_b = scores.get(id_b, {})
        total_a = sc_a.get("total", 0)
        total_b = sc_b.get("total", 0)

        if total_a > total_b:
            winner = "a"
            a_wins += 1
        elif total_b > total_a:
            winner = "b"
            b_wins += 1
        else:
            winner = "draw"

        enc_direct_a = enc_direct_b = 0
        for s in result.get("sets", []):
            team_a_ids = s.get("team_a", [])
            team_b_ids = s.get("team_b", [])
            a_in_ta = id_a in team_a_ids
            b_in_tb = id_b in team_b_ids
            a_in_tb = id_a in team_b_ids
            b_in_ta = id_b in team_a_ids
            if (a_in_ta and b_in_tb) or (a_in_tb and b_in_ta):
                sa = s.get("score_a", 0)
                sb = s.get("score_b", 0)
                if a_in_ta:
                    if sa > sb:
                        enc_direct_a += 1
                    else:
                        enc_direct_b += 1
                else:
                    if sb > sa:
                        enc_direct_a += 1
                    else:
                        enc_direct_b += 1

        direct_sets_a += enc_direct_a
        direct_sets_b += enc_direct_b

        rnd = rounds_by_id.get(result.get("round_id", ""), {})
        encounters.append({
            "round_id":      result["round_id"],
            "round_number":  rnd.get("round_number"),
            "season_id":     result.get("season_id"),
            "cat":           result.get("cat"),
            "group_idx":     result.get("group_idx"),
            "date":          rnd.get("date"),
            "submitted_at":  result.get("submitted_at"),
            "sets_a":        sc_a.get("sets", []),
            "sets_b":        sc_b.get("sets", []),
            "total_a":       total_a,
            "total_b":       total_b,
            "direct_sets_a": enc_direct_a,
            "direct_sets_b": enc_direct_b,
            "winner":        winner,
            "status":        result.get("status"),
        })

    encounters.sort(key=lambda e: e.get("submitted_at") or "", reverse=True)

    return jsonify({
        "athlete_a": {
            "id":               id_a,
            "nome":             _display_name(ath_a),
            "current_category": ath_a.get("current_category"),
        },
        "athlete_b": {
            "id":               id_b,
            "nome":             _display_name(ath_b),
            "current_category": ath_b.get("current_category"),
        },
        "summary": {
            "encounters":    len(encounters),
            "a_wins":        a_wins,
            "b_wins":        b_wins,
            "draws":         len(encounters) - a_wins - b_wins,
            "direct_sets_a": direct_sets_a,
            "direct_sets_b": direct_sets_b,
        },
        "encounters": encounters,
    })


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
# Sprint 15 — Log de auditoria
# ---------------------------------------------------------------------------

@app.route("/api/admin/audit")
@require_admin
def admin_audit_log():
    """Retorna as últimas entradas do log de auditoria."""
    from engines.audit_engine import recent_entries
    limit = min(int(request.args.get("limit", 200)), 500)
    action_filter = request.args.get("action")
    db = read_json("audit.json")
    entries = recent_entries(db["data"], limit=limit)
    if action_filter:
        entries = [e for e in entries if e.get("action") == action_filter]
    return jsonify(entries)


@app.route("/api/rounds/<round_id>/reopen", methods=["POST"])
@require_admin
def round_reopen(round_id):
    """Reabre uma rodada encerrada para correções."""
    rounds_db = read_json("rounds.json")
    rnd = next((r for r in rounds_db["data"] if r["id"] == round_id), None)
    if not rnd:
        return jsonify({"error": "Rodada não encontrada"}), 404
    if rnd.get("status") != "closed":
        return jsonify({"error": "Apenas rodadas encerradas podem ser reabertas"}), 400
    rnd["status"] = "in_progress"
    rnd["reopened_at"] = now_iso()
    write_json("rounds.json", rounds_db)
    log_audit("round_reopened", {
        "round_id": round_id,
        "round_number": rnd.get("round_number"),
        "season_id": rnd.get("season_id"),
    })
    athletes_by_id = {a["id"]: a for a in read_json("athletes.json")["data"]}
    return jsonify(_enrich_round(rnd, athletes_by_id))


@app.route("/api/rounds/<round_id>/close", methods=["POST"])
@require_admin
def round_close(round_id):
    """Encerra manualmente uma rodada aberta."""
    rounds_db   = read_json("rounds.json")
    results_db  = read_json("results.json")
    rnd = next((r for r in rounds_db["data"] if r["id"] == round_id), None)
    if not rnd:
        return jsonify({"error": "Rodada não encontrada"}), 404
    if rnd.get("status") == "closed":
        return jsonify({"error": "Rodada já encerrada"}), 400
    if rnd.get("status") == "cancelled":
        return jsonify({"error": "Rodada cancelada não pode ser encerrada"}), 400

    # Bloqueia se houver resultados contestados (precisam ser resolvidos antes de fechar)
    round_results = [r for r in results_db["data"] if r.get("round_id") == round_id]
    contested = [r for r in round_results if r.get("status") == "contested"]
    if contested:
        return jsonify({
            "error": f"{len(contested)} resultado(s) contestado(s) nesta rodada. Resolva as disputas antes de encerrar.",
            "contested_count": len(contested),
        }), 400

    # Conta grupos sem resultado confirmado (aviso, não bloqueio)
    groups_map = rnd.get("groups", {})
    total_groups = sum(len(g) for g in groups_map.values())
    confirmed = sum(1 for r in round_results if r.get("status") == "confirmed")
    missing = total_groups - confirmed

    rnd["status"] = "closed"
    rnd["closed_at"] = now_iso()
    write_json("rounds.json", rounds_db)
    log_audit("round_closed", {
        "round_id": round_id,
        "round_number": rnd.get("round_number"),
        "season_id": rnd.get("season_id"),
        "groups_missing_result": missing,
    })

    # Save ranking snapshot for each active category
    _save_ranking_snapshot(rnd, results_db["data"])

    athletes_by_id = {a["id"]: a for a in read_json("athletes.json")["data"]}
    return jsonify({
        "round": _enrich_round(rnd, athletes_by_id),
        "warning": f"{missing} grupo(s) sem resultado confirmado." if missing else None,
    })


@app.route("/api/seasons/<season_id>/rounds/close-pending", methods=["POST"])
@require_admin
@transactional
def close_pending_rounds(season_id):
    """Fecha todas as rodadas pendentes (abertas) da temporada de uma vez.

    Pula rodadas com resultados contestados (precisam de resolução antes).
    Retorna quantas fechou e quais ficaram bloqueadas.
    """
    rounds_db  = read_json("rounds.json")
    results_db = read_json("results.json")
    pending = [
        r for r in rounds_db["data"]
        if r.get("season_id") == season_id and r.get("status") not in ("closed", "cancelled")
    ]
    closed, blocked, closed_objs = [], [], []
    for rnd in pending:
        contested = [
            r for r in results_db["data"]
            if r.get("round_id") == rnd["id"] and r.get("status") == "contested"
        ]
        if contested:
            blocked.append({
                "round_number": rnd.get("round_number"),
                "reason": f"{len(contested)} resultado(s) contestado(s)",
            })
            continue
        rnd["status"] = "closed"
        rnd["closed_at"] = now_iso()
        closed.append(rnd.get("round_number"))
        closed_objs.append(rnd)

    if closed_objs:
        write_json("rounds.json", rounds_db)
        for rnd in closed_objs:
            _save_ranking_snapshot(rnd, results_db["data"])
        log_audit("rounds_close_pending", {
            "season_id": season_id,
            "closed": closed,
            "blocked_count": len(blocked),
        })
    return jsonify({"closed": len(closed), "closed_rounds": closed, "blocked": blocked})


@app.route("/api/rounds/<round_id>/cancel", methods=["POST"])
@require_admin
def round_cancel(round_id):
    """Cancela uma rodada vazia (sem resultados lançados).

    Uma rodada cancelada não bloqueia o fechamento da temporada e não conta
    para o ranking. Só é permitido cancelar rodadas que não tenham nenhum
    resultado confirmado ou contestado.
    """
    rounds_db  = read_json("rounds.json")
    results_db = read_json("results.json")
    rnd = next((r for r in rounds_db["data"] if r["id"] == round_id), None)
    if not rnd:
        return jsonify({"error": "Rodada não encontrada"}), 404
    if rnd.get("status") == "cancelled":
        return jsonify({"error": "Rodada já cancelada"}), 400
    if rnd.get("status") == "closed":
        return jsonify({"error": "Rodada encerrada não pode ser cancelada. Reabra-a primeiro."}), 400

    # Só permite cancelar rodada vazia: sem resultados confirmados ou contestados.
    played = [
        r for r in results_db["data"]
        if r.get("round_id") == round_id and r.get("status") in ("confirmed", "contested")
    ]
    if played:
        return jsonify({
            "error": f"Esta rodada tem {len(played)} resultado(s) lançado(s) e não pode ser cancelada. "
                     "Encerre a rodada normalmente.",
            "played_count": len(played),
        }), 400

    rnd["status"] = "cancelled"
    rnd["cancelled_at"] = now_iso()
    write_json("rounds.json", rounds_db)
    log_audit("round_cancelled", {
        "round_id": round_id,
        "round_number": rnd.get("round_number"),
        "season_id": rnd.get("season_id"),
    })
    athletes_by_id = {a["id"]: a for a in read_json("athletes.json")["data"]}
    return jsonify(_enrich_round(rnd, athletes_by_id))


@app.route("/api/rounds/<round_id>/discard", methods=["POST"])
@require_admin
def round_discard(round_id):
    """Descarta uma rodada por completo: APAGA os resultados lançados e marca
    a rodada como cancelada.

    Diferente de /cancel (que se recusa a destruir pontuação), este endpoint é
    para rodadas de teste/engano. Ação destrutiva: exige confirmação explícita
    (body {"confirm": true}). O ranking recalcula sem os resultados removidos.
    """
    body = request.get_json(silent=True) or {}
    if body.get("confirm") is not True:
        return jsonify({"error": "Confirmação obrigatória. Envie {\"confirm\": true}."}), 400

    rounds_db = read_json("rounds.json")
    rnd = next((r for r in rounds_db["data"] if r["id"] == round_id), None)
    if not rnd:
        return jsonify({"error": "Rodada não encontrada"}), 404
    if rnd.get("status") == "cancelled":
        return jsonify({"error": "Rodada já cancelada"}), 400

    # Remove os resultados desta rodada (qualquer status).
    results_db = read_json("results.json")
    removed = [r for r in results_db["data"] if r.get("round_id") == round_id]
    results_db["data"] = [r for r in results_db["data"] if r.get("round_id") != round_id]
    write_json("results.json", results_db)

    # Remove snapshots de ranking gerados por esta rodada.
    snapshots_db = read_json("ranking_snapshots.json")
    snap_before = len(snapshots_db["data"])
    snapshots_db["data"] = [s for s in snapshots_db["data"] if s.get("round_id") != round_id]
    snap_removed = snap_before - len(snapshots_db["data"])
    if snap_removed:
        write_json("ranking_snapshots.json", snapshots_db)

    rnd["status"] = "cancelled"
    rnd["cancelled_at"] = now_iso()
    rnd["discarded_at"] = now_iso()
    rnd["discarded_results_count"] = len(removed)
    write_json("rounds.json", rounds_db)
    log_audit("round_discarded", {
        "round_id": round_id,
        "round_number": rnd.get("round_number"),
        "season_id": rnd.get("season_id"),
        "results_removed": len(removed),
        "snapshots_removed": snap_removed,
    })
    athletes_by_id = {a["id"]: a for a in read_json("athletes.json")["data"]}
    return jsonify({
        "round": _enrich_round(rnd, athletes_by_id),
        "results_removed": len(removed),
    })


@app.route("/api/seasons/<season_id>/ranking/export.csv")
@require_admin
def ranking_export_csv(season_id):
    """Exporta o ranking da temporada como CSV."""
    from engines.ranking_engine import compute_ranking
    import csv, io

    seasons_db = read_json("seasons.json")
    season = next((s for s in seasons_db["data"] if s["id"] == season_id), None)
    if not season:
        return jsonify({"error": "Temporada não encontrada"}), 404

    athletes_db = read_json("athletes.json")
    results_db  = read_json("results.json")
    cat_filter  = request.args.get("cat")
    categories  = [cat_filter] if cat_filter else CATEGORIES

    category_setup = season.get("category_setup", {})
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Categoria", "Posição", "Nome", "Pontos", "Sets Vencidos",
                     "Games Ganhos", "Games Perdidos", "Saldo", "Partidas"])

    for cat in categories:
        titular_ids = category_setup.get(cat, {}).get("titular_ids", [])
        athletes_in_cat = [a for a in athletes_db["data"] if a["id"] in titular_ids]
        if not athletes_in_cat:
            continue
        ranking = compute_ranking(athletes_in_cat, results_db["data"], category=cat, season_id=season_id)
        for r in ranking:
            writer.writerow([
                cat, r["rank"], r["nome"], r["points"], r["wins"],
                r["games_won"], r["games_lost"], r["saldo"], r["results_count"],
            ])

    from flask import Response
    return Response(
        output.getvalue(),
        mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename=ranking_{season_id[:8]}_{now_iso()[:10]}.csv"},
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
    profile = compute_athlete_profile(athlete, seasons_db["data"], results_db["data"], athletes_db["data"])
    profile["id"] = athlete["id"]
    profile["apelido"] = athlete.get("apelido") or None
    profile["birth_date"] = athlete.get("birth_date") or None
    profile["age"] = compute_age(athlete.get("birth_date"))
    profile["photo_url"] = athlete.get("photo_url") or None
    return jsonify(profile)


@app.route("/api/mesa/profile", methods=["PUT"])
@require_atleta
def mesa_profile_update():
    """Atleta edita seu próprio apelido e data de nascimento."""
    atleta_id = session["atleta_id"]
    data = request.get_json(silent=True) or {}

    apelido = (data.get("apelido") or "").strip()
    if not apelido:
        return jsonify({"error": "Apelido não pode ser vazio"}), 400

    # birth_date só é tocado se o campo foi enviado (evita zerar valor existente).
    birth_provided = "birth_date" in data
    birth_date = (data.get("birth_date") or "").strip() or None
    if birth_provided and birth_date:
        try:
            from datetime import date as _date
            _date.fromisoformat(birth_date)
        except ValueError:
            return jsonify({"error": "Data de nascimento inválida. Use o formato YYYY-MM-DD"}), 400

    athletes_db = read_json("athletes.json")
    athlete = next((a for a in athletes_db["data"] if a["id"] == atleta_id), None)
    if not athlete:
        return jsonify({"error": "Atleta não encontrado"}), 404

    if any(
        (a.get("apelido") or "").lower() == apelido.lower() and a["id"] != atleta_id
        for a in athletes_db["data"]
    ):
        return jsonify({"error": "Este apelido já está em uso"}), 409

    athlete["apelido"] = apelido
    if birth_provided:
        athlete["birth_date"] = birth_date
    write_json("athletes.json", athletes_db)
    return jsonify({"ok": True, "apelido": apelido, "birth_date": athlete.get("birth_date")})


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
# Config pública + Settings admin
# ---------------------------------------------------------------------------

@app.route("/api/config")
def public_config():
    s = read_settings()
    return jsonify({
        "admin_whatsapp": s.get("admin_whatsapp", ""),
        "app_name":       s.get("club_name", "SuperRank"),
        "club_name":      s.get("club_name", "SuperRank"),
        "court_location": s.get("court_location", ""),
        "app_url":        s.get("app_url", ""),
    })


@app.route("/api/admin/settings", methods=["GET", "PUT"])
@require_admin
def admin_settings_route():
    if request.method == "GET":
        return jsonify(read_settings())
    body = request.get_json(silent=True) or {}
    s = read_settings()
    for field in ("admin_whatsapp", "club_name", "court_location", "app_url"):
        if field in body:
            s[field] = str(body[field])
    if "payment_amount" in body:
        s["payment_amount"] = float(body["payment_amount"] or 0)
    if "payment_due_day" in body:
        s["payment_due_day"] = int(body["payment_due_day"] or 10)
    if "payments_enabled" in body:
        s["payments_enabled"] = bool(body["payments_enabled"])
    write_settings(s)
    return jsonify(s)


@app.route("/api/seasons/<season_id>/schedule")
def season_schedule(season_id):
    """Cronograma de rodadas de uma temporada (público)."""
    seasons_db = read_json("seasons.json")
    season = next((s for s in seasons_db["data"] if s["id"] == season_id), None)
    if not season:
        return jsonify({"error": "Temporada não encontrada"}), 404
    rounds_db = read_json("rounds.json")
    rounds = [
        r for r in rounds_db["data"]
        if r.get("season_id") == season_id and r.get("status") != "cancelled"
    ]
    schedule = [
        {
            "round_id":     r["id"],
            "round_number": r.get("round_number"),
            "start_date":   r.get("start_date"),
            "end_date":     r.get("end_date") or r.get("target_date"),
            "status":       r.get("status"),
        }
        for r in sorted(rounds, key=lambda x: x.get("round_number") or 0)
    ]
    return jsonify({"rounds_total": season.get("rounds_total", 0), "schedule": schedule})


@app.route("/api/seasons/<season_id>/comms-checklist")
@require_admin
def season_comms_checklist(season_id):
    """Lista de atletas com situação pendente numa rodada, para comunicação."""
    round_id = request.args.get("round_id")
    cat_filter = request.args.get("cat")

    rounds_db = read_json("rounds.json")
    rnd = next((r for r in rounds_db["data"] if r["id"] == round_id), None) if round_id else None
    if not rnd:
        return jsonify({"error": "Rodada não encontrada"}), 404

    results_db = read_json("results.json")
    slots_db   = read_json("slots.json")
    athletes_db = read_json("athletes.json")
    athletes_by_id = {a["id"]: a for a in athletes_db["data"]}

    round_results = {
        f"{r.get('cat')}-{r.get('group_idx')}": r
        for r in results_db["data"] if r.get("round_id") == round_id
    }
    slots_by_athlete = {
        s["athlete_id"]: s["slots"]
        for s in slots_db["data"] if s["round_id"] == round_id
    }

    checklist = []
    for cat, groups in rnd.get("groups", {}).items():
        if cat_filter and cat != cat_filter:
            continue
        for gi, group in enumerate(groups):
            result = round_results.get(f"{cat}-{gi}")
            for aid in group:
                athlete = athletes_by_id.get(aid, {})
                has_slots = bool(slots_by_athlete.get(aid))
                result_status = result.get("status") if result else None
                pending_confirm = (
                    result_status == "pending_confirmation"
                    and result.get("confirmations", {}).get(aid) not in ("confirmed", "contested")
                ) if result else False

                issues = []
                if not has_slots:
                    issues.append("sem_slots")
                if pending_confirm:
                    issues.append("resultado_pendente")

                if issues:
                    checklist.append({
                        "athlete_id":  aid,
                        "nome":        athlete.get("nome", aid),
                        "telefone":    athlete.get("telefone", ""),
                        "cat":         cat,
                        "group_idx":   gi,
                        "issues":      issues,
                    })

    return jsonify({"round_id": round_id, "checklist": checklist})


# ---------------------------------------------------------------------------
# Notificações in-app (atleta)
# ---------------------------------------------------------------------------

@app.route("/api/mesa/notifications")
@require_atleta
def mesa_notifications():
    athlete_id = session["atleta_id"]
    db = read_json("notifications.json")
    mine = sorted(
        [n for n in db["data"] if n["athlete_id"] == athlete_id],
        key=lambda n: n["created_at"], reverse=True,
    )[:50]
    unread = sum(1 for n in mine if not n.get("read"))
    return jsonify({"notifications": mine, "unread": unread})


@app.route("/api/mesa/notifications/read", methods=["PUT"])
@require_atleta
def mark_notifications_read():
    athlete_id = session["atleta_id"]
    db = read_json("notifications.json")
    for n in db["data"]:
        if n["athlete_id"] == athlete_id:
            n["read"] = True
    write_json("notifications.json", db)
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Ligas / Ranking Contínuo
# ---------------------------------------------------------------------------

@app.route("/api/ligas", methods=["GET"])
def ligas_list():
    db = read_json("ligas.json")
    return jsonify(db["data"])


@app.route("/api/ligas", methods=["POST"])
@require_admin
def ligas_create():
    from engines.annual_engine import ALL_AWARDS
    from datetime import timedelta as _td4

    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    year = body.get("year")
    close_date   = (body.get("close_date") or "").strip()
    reopen_date  = (body.get("reopen_date") or "").strip()
    active_awards = body.get("active_awards")

    if not name:
        return jsonify({"error": "Nome é obrigatório"}), 400
    if not year or not isinstance(year, int) or year < 2020:
        return jsonify({"error": "Ano inválido"}), 400

    if not close_date:
        close_date = f"{year}-12-10"
    if not reopen_date:
        reopen_date = f"{year + 1}-01-20"

    start_date = (body.get("start_date") or "").strip()
    default_rounds_total = int(body.get("default_rounds_total", 4))
    default_round_duration_days = int(body.get("default_round_duration_days", 10))

    if not start_date:
        start_date = f"{year}-01-20"  # padrão: reabertura em 20/jan

    if active_awards is None:
        active_awards = list(ALL_AWARDS)
    else:
        invalid = [a for a in active_awards if a not in ALL_AWARDS]
        if invalid:
            return jsonify({"error": f"Prêmios inválidos: {invalid}"}), 400

    liga = {
        "id": str(uuid.uuid4()),
        "name": name,
        "year": year,
        "start_date": start_date,
        "close_date": close_date,
        "reopen_date": reopen_date,
        "status": "active",
        "active_awards": active_awards,
        "default_rounds_total": default_rounds_total,
        "default_round_duration_days": default_round_duration_days,
        "seasons": [],
        "created_at": now_iso(),
    }
    db = read_json("ligas.json")
    db["data"].append(liga)
    write_json("ligas.json", db)
    return jsonify(liga), 201


@app.route("/api/ligas/<liga_id>", methods=["GET"])
def ligas_get(liga_id):
    db = read_json("ligas.json")
    liga = next((l for l in db["data"] if l["id"] == liga_id), None)
    if not liga:
        return jsonify({"error": "Liga não encontrada"}), 404
    return jsonify(liga)


@app.route("/api/ligas/<liga_id>", methods=["PUT"])
@require_admin
def ligas_update(liga_id):
    from engines.annual_engine import ALL_AWARDS
    db = read_json("ligas.json")
    liga = next((l for l in db["data"] if l["id"] == liga_id), None)
    if not liga:
        return jsonify({"error": "Liga não encontrada"}), 404
    body = request.get_json(silent=True) or {}
    for field in ("name", "start_date", "close_date", "reopen_date", "status"):
        if field in body:
            liga[field] = body[field]
    if "default_rounds_total" in body:
        liga["default_rounds_total"] = int(body["default_rounds_total"])
    if "default_round_duration_days" in body:
        liga["default_round_duration_days"] = int(body["default_round_duration_days"])
    if "active_awards" in body:
        invalid = [a for a in body["active_awards"] if a not in ALL_AWARDS]
        if invalid:
            return jsonify({"error": f"Prêmios inválidos: {invalid}"}), 400
        liga["active_awards"] = body["active_awards"]
    write_json("ligas.json", db)
    return jsonify(liga)


@app.route("/api/ligas/<liga_id>", methods=["DELETE"])
@require_admin
@transactional
def ligas_delete(liga_id):
    db = read_json("ligas.json")
    liga = next((l for l in db["data"] if l["id"] == liga_id), None)
    if not liga:
        return jsonify({"error": "Liga não encontrada"}), 404

    body = request.get_json(silent=True) or {}
    # Temporadas vinculadas: via liga.seasons e via season.liga_id (defensivo).
    seasons_db = read_json("seasons.json")
    linked = set(liga.get("seasons") or [])
    linked |= {s["id"] for s in seasons_db["data"] if s.get("liga_id") == liga_id}

    if linked and body.get("confirm") is not True:
        return jsonify({
            "error": f"Esta liga tem {len(linked)} temporada(s) vinculada(s). "
                     "Envie {\"confirm\": true} para excluir a liga e todas as temporadas em cascata.",
            "seasons_count": len(linked),
        }), 400

    details = [{"season_id": sid, **_cascade_delete_season(sid)} for sid in linked]

    # Remove títulos/premiações desta liga.
    titles_db = read_json("titles.json")
    before = len(titles_db["data"])
    titles_db["data"] = [t for t in titles_db["data"] if t.get("liga_id") != liga_id]
    titles_removed = before - len(titles_db["data"])
    if titles_removed:
        write_json("titles.json", titles_db)

    # Recarrega ligas.json (o cascade pode tê-lo reescrito ao desvincular) e remove a liga.
    db = read_json("ligas.json")
    db["data"] = [l for l in db["data"] if l["id"] != liga_id]
    write_json("ligas.json", db)
    log_audit("liga_deleted", {
        "liga_id": liga_id,
        "liga_name": liga.get("name"),
        "seasons_deleted": len(linked),
        "titles_removed": titles_removed,
    })
    return jsonify({
        "ok": True,
        "seasons_deleted": len(linked),
        "titles_removed": titles_removed,
        "details": details,
    })


@app.route("/api/ligas/<liga_id>/ranking")
def ligas_ranking(liga_id):
    from engines.annual_engine import compute_annual_ranking
    db = read_json("ligas.json")
    liga = next((l for l in db["data"] if l["id"] == liga_id), None)
    if not liga:
        return jsonify({"error": "Liga não encontrada"}), 404
    athletes_db = read_json("athletes.json")
    seasons_db  = read_json("seasons.json")
    results_db  = read_json("results.json")
    ranking = compute_annual_ranking(
        athletes_db["data"], liga["year"], seasons_db["data"], results_db["data"]
    )
    return jsonify({"liga": liga, "ranking": ranking})


@app.route("/api/ligas/<liga_id>/awards")
def ligas_awards(liga_id):
    from engines.annual_engine import compute_awards, compute_annual_ranking
    db = read_json("ligas.json")
    liga = next((l for l in db["data"] if l["id"] == liga_id), None)
    if not liga:
        return jsonify({"error": "Liga não encontrada"}), 404
    athletes_db = read_json("athletes.json")
    seasons_db  = read_json("seasons.json")
    results_db  = read_json("results.json")
    awards = compute_awards(
        athletes_db["data"], liga["year"],
        seasons_db["data"], results_db["data"],
        liga.get("active_awards"),
    )
    ranking = compute_annual_ranking(
        athletes_db["data"], liga["year"], seasons_db["data"], results_db["data"]
    )
    return jsonify({"liga": liga, **awards, "ranking": ranking})


@app.route("/api/ligas/<liga_id>/awards/apply", methods=["POST"])
@require_admin
def ligas_awards_apply(liga_id):
    from engines.annual_engine import compute_awards, compute_annual_ranking
    db = read_json("ligas.json")
    liga = next((l for l in db["data"] if l["id"] == liga_id), None)
    if not liga:
        return jsonify({"error": "Liga não encontrada"}), 404
    athletes_db = read_json("athletes.json")
    seasons_db  = read_json("seasons.json")
    results_db  = read_json("results.json")
    year = liga["year"]
    awards = compute_awards(
        athletes_db["data"], year,
        seasons_db["data"], results_db["data"],
        liga.get("active_awards"),
    )
    ranking = compute_annual_ranking(
        athletes_db["data"], year, seasons_db["data"], results_db["data"]
    )
    titles_db = read_json("titles.json")
    titles_db["data"] = [
        t for t in titles_db["data"]
        if not (t.get("year") == year and t.get("liga_id") == liga_id)
    ]
    titles_db["data"].append({
        "year": year,
        "liga_id": liga_id,
        "liga_name": liga["name"],
        "recorded_at": now_iso(),
        "awards": awards["awards"],
        "award_names": awards["award_names"],
        "award_icons": awards.get("award_icons", {}),
        "active_awards": awards["active_awards"],
        "ranking": ranking,
        "eligible_count": len(ranking),
    })
    write_json("titles.json", titles_db)
    return jsonify({"ok": True, "year": year, "eligible_count": len(ranking)})


# ---------------------------------------------------------------------------
# Lesões e Pedidos de Convidado
# ---------------------------------------------------------------------------

def _recovery_date(start_date: str, duration_days: int) -> str:
    from datetime import timedelta
    dt = datetime.strptime(start_date, "%Y-%m-%d") + timedelta(days=duration_days)
    return dt.strftime("%Y-%m-%d")


def _last_place_points(season_id: str, category: str) -> int:
    """Retorna pontos do último colocado na categoria/temporada via resultados confirmados."""
    from engines.ranking_engine import compute_ranking
    athletes_db = read_json("athletes.json")
    results_db  = read_json("results.json")
    # Identifica atletas que efetivamente jogaram nessa cat/temporada
    played_ids = {
        aid
        for r in results_db["data"]
        if r.get("season_id") == season_id
        and r.get("cat") == category
        and r.get("status") == "confirmed"
        for aid in r.get("group", [])
    }
    cat_athletes = [a for a in athletes_db["data"] if a["id"] in played_ids]
    ranking = compute_ranking(cat_athletes, results_db["data"], category=category, season_id=season_id)
    if not ranking:
        return 0
    return ranking[-1]["points"]


def _promote_reserva_for_injury(injury: dict, seasons_db: dict, athletes_db: dict) -> str | None:
    """
    Tenta promover o primeiro reserva SAUDÁVEL da categoria do atleta lesionado.
    Retorna athlete_id do reserva promovido ou None.
    Atualiza season.category_setup e athlete.current_category in-place.
    """
    season = next((s for s in seasons_db["data"] if s["id"] == injury["season_id"]), None)
    if not season:
        return None

    cat  = injury["category"]
    setup = season.get("category_setup", {}).get(cat, {})
    reserva_ids = setup.get("reserva_ids", [])
    if not reserva_ids:
        return None

    # Filtra reservas que estão atualmente lesionados (não podem ser promovidos)
    injuries_db = read_json("injuries.json")
    injured_ids = {
        i["athlete_id"]
        for i in injuries_db["data"]
        if i.get("status") == "active" and i["athlete_id"] != injury["athlete_id"]
    }
    healthy_reservas = [rid for rid in reserva_ids if rid not in injured_ids]
    if not healthy_reservas:
        return None

    reserva_id = healthy_reservas[0]
    entry_points = _last_place_points(season["id"], cat)

    # Promove reserva → titular
    setup.setdefault("titular_ids", []).append(reserva_id)
    setup["reserva_ids"] = reserva_ids[1:]

    # Move injured → reserva
    injured_id = injury["athlete_id"]
    if injured_id in setup.get("titular_ids", []):
        setup["titular_ids"].remove(injured_id)
        setup.setdefault("reserva_ids", []).insert(0, injured_id)

    # Marca pontos de entrada do reserva
    setup.setdefault("entry_points", {})[reserva_id] = entry_points

    # Atualiza athlete.current_category
    for a in athletes_db["data"]:
        if a["id"] == reserva_id:
            a["current_category"] = cat
    return reserva_id


@app.route("/api/injuries", methods=["GET"])
def injuries_list():
    db = read_json("injuries.json")
    season_id  = request.args.get("season_id")
    athlete_id = request.args.get("athlete_id")
    items = db["data"]
    if season_id:
        items = [i for i in items if i.get("season_id") == season_id]
    if athlete_id:
        items = [i for i in items if i.get("athlete_id") == athlete_id]
    return jsonify(items)


@app.route("/api/injuries", methods=["POST"])
def injuries_create():
    """Declara lesão — pode ser chamado pelo atleta (mesa) ou pelo admin."""
    body = request.get_json(silent=True) or {}

    athlete_id   = (body.get("athlete_id") or "").strip()
    season_id    = (body.get("season_id")  or "").strip()
    start_date   = (body.get("start_date") or datetime.utcnow().strftime("%Y-%m-%d")).strip()
    duration_days = int(body.get("duration_days") or 0)
    tipo         = body.get("tipo", "lesao")   # lesao | viagem | outro
    notes        = (body.get("notes") or "").strip()

    if not athlete_id or not season_id:
        return jsonify({"error": "athlete_id e season_id obrigatórios"}), 400
    if duration_days < 1:
        return jsonify({"error": "duration_days deve ser ≥ 1"}), 400
    if tipo not in ("lesao", "viagem", "outro"):
        return jsonify({"error": "tipo inválido"}), 400

    # Valida quem está chamando
    is_admin  = session.get("is_admin", False)
    mesa_id   = session.get("atleta_id")
    if not is_admin and mesa_id != athlete_id:
        return jsonify({"error": "Não autorizado"}), 403

    athletes_db = read_json("athletes.json")
    seasons_db  = read_json("seasons.json")

    athlete = next((a for a in athletes_db["data"] if a["id"] == athlete_id), None)
    if not athlete:
        return jsonify({"error": "Atleta não encontrado"}), 404
    season = next((s for s in seasons_db["data"] if s["id"] == season_id), None)
    if not season:
        return jsonify({"error": "Temporada não encontrada"}), 404

    # Encontra categoria do atleta na temporada
    cat = None
    for c in CATEGORIES:
        setup = season.get("category_setup", {}).get(c, {})
        if athlete_id in setup.get("titular_ids", []) or athlete_id in setup.get("reserva_ids", []):
            cat = c
            break
    if not cat:
        return jsonify({"error": "Atleta não está nesta temporada"}), 400

    recovery_date = _recovery_date(start_date, duration_days)

    injury = {
        "id":               str(uuid.uuid4()),
        "athlete_id":       athlete_id,
        "athlete_nome":     athlete.get("nome", athlete_id),
        "season_id":        season_id,
        "category":         cat,
        "start_date":       start_date,
        "duration_days":    duration_days,
        "recovery_date":    recovery_date,
        "declared_by":      "admin" if is_admin else athlete_id,
        "tipo":             tipo,
        "notes":            notes,
        "status":           "active",
        "vacancy_filled_by": None,
        "created_at":       now_iso(),
    }

    # Tenta promover reserva
    reserva_id = _promote_reserva_for_injury(injury, seasons_db, athletes_db)
    if reserva_id:
        injury["vacancy_filled_by"] = reserva_id
        write_json("seasons.json", seasons_db)
        write_json("athletes.json", athletes_db)

    injuries_db = read_json("injuries.json")
    injuries_db["data"].append(injury)
    write_json("injuries.json", injuries_db)

    return jsonify({"ok": True, "injury": injury, "reserva_promoted": reserva_id})


@app.route("/api/injuries/<injury_id>", methods=["PUT"])
@require_admin
def injuries_update(injury_id):
    db = read_json("injuries.json")
    injury = next((i for i in db["data"] if i["id"] == injury_id), None)
    if not injury:
        return jsonify({"error": "Lesão não encontrada"}), 404
    body = request.get_json(silent=True) or {}
    for field in ("duration_days", "notes", "status", "tipo"):
        if field in body:
            injury[field] = body[field]
    if "duration_days" in body:
        injury["recovery_date"] = _recovery_date(injury["start_date"], int(body["duration_days"]))
    write_json("injuries.json", db)
    return jsonify({"ok": True, "injury": injury})


@app.route("/api/injuries/<injury_id>", methods=["DELETE"])
@require_admin
def injuries_delete(injury_id):
    db = read_json("injuries.json")
    before = len(db["data"])
    db["data"] = [i for i in db["data"] if i["id"] != injury_id]
    if len(db["data"]) == before:
        return jsonify({"error": "Lesão não encontrada"}), 404
    write_json("injuries.json", db)
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Pedidos de Convidado (guest_requests)
# ---------------------------------------------------------------------------

@app.route("/api/guest-requests", methods=["GET"])
@require_admin
def guest_requests_list():
    db = read_json("guest_requests.json")
    round_id  = request.args.get("round_id")
    season_id = request.args.get("season_id")
    status    = request.args.get("status")
    items = db["data"]
    if round_id:
        items = [r for r in items if r.get("round_id") == round_id]
    if season_id:
        items = [r for r in items if r.get("season_id") == season_id]
    if status:
        items = [r for r in items if r.get("status") == status]
    return jsonify(items)


@app.route("/api/guest-requests", methods=["POST"])
@require_admin
def guest_requests_create():
    """Admin cria pedido de convidado para um grupo afetado por lesão."""
    body = request.get_json(silent=True) or {}
    round_id   = (body.get("round_id")   or "").strip()
    season_id  = (body.get("season_id")  or "").strip()
    cat        = (body.get("cat")        or "").strip().upper()
    group_idx  = body.get("group_idx")
    injury_id  = (body.get("injury_id")  or "").strip()

    if not all([round_id, season_id, cat, group_idx is not None]):
        return jsonify({"error": "round_id, season_id, cat, group_idx obrigatórios"}), 400

    gr = {
        "id":          str(uuid.uuid4()),
        "round_id":    round_id,
        "season_id":   season_id,
        "cat":         cat,
        "group_idx":   int(group_idx),
        "injury_id":   injury_id or None,
        "status":      "pending",
        "suggestions": [],
        "confirmed_guest": None,
        "created_at":  now_iso(),
    }
    db = read_json("guest_requests.json")
    db["data"].append(gr)
    write_json("guest_requests.json", db)
    return jsonify({"ok": True, "guest_request": gr}), 201


@app.route("/api/guest-requests/<gr_id>/suggest", methods=["POST"])
def guest_requests_suggest(gr_id):
    """Atleta ou admin sugere um convidado para o grupo."""
    is_admin = session.get("is_admin", False)
    mesa_id  = session.get("atleta_id")
    if not is_admin and not mesa_id:
        return jsonify({"error": "Não autorizado"}), 403

    db = read_json("guest_requests.json")
    gr = next((r for r in db["data"] if r["id"] == gr_id), None)
    if not gr:
        return jsonify({"error": "Pedido não encontrado"}), 404
    if gr["status"] != "pending":
        return jsonify({"error": "Pedido já resolvido"}), 400

    body = request.get_json(silent=True) or {}
    athlete_id   = (body.get("athlete_id")   or "").strip() or None
    nome_externo = (body.get("nome_externo") or "").strip() or None
    telefone     = re.sub(r'\D', '', str(body.get("telefone") or "")) or None
    if not athlete_id and not nome_externo:
        return jsonify({"error": "Informe athlete_id ou nome_externo"}), 400

    suggestion = {
        "id":           str(uuid.uuid4()),
        "suggested_by": "admin" if is_admin else mesa_id,
        "athlete_id":   athlete_id,
        "nome_externo": nome_externo,
        "telefone":     telefone,
        "created_at":   now_iso(),
    }
    gr["suggestions"].append(suggestion)
    write_json("guest_requests.json", db)
    return jsonify({"ok": True, "suggestion": suggestion})


@app.route("/api/guest-requests/<gr_id>/confirm", methods=["POST"])
@require_admin
def guest_requests_confirm(gr_id):
    """
    Admin confirma convidado e gera token de cadastro descartável.
    Aceita suggestion_id (aprova uma sugestão) ou nome_externo+telefone direto.
    Retorna link de cadastro para enviar ao convidado.
    """
    db = read_json("guest_requests.json")
    gr = next((r for r in db["data"] if r["id"] == gr_id), None)
    if not gr:
        return jsonify({"error": "Pedido não encontrado"}), 404

    body          = request.get_json(silent=True) or {}
    suggestion_id = (body.get("suggestion_id") or "").strip() or None
    nome_externo  = (body.get("nome_externo")  or "").strip() or None
    telefone      = re.sub(r'\D', '', str(body.get("telefone") or "")) or None
    guest_type    = body.get("guest_type", "convidado")

    # Resolve nome + telefone — de sugestão ou direto
    if suggestion_id:
        sug = next((s for s in gr.get("suggestions", []) if s["id"] == suggestion_id), None)
        if not sug:
            return jsonify({"error": "Sugestão não encontrada"}), 404
        nome_externo = nome_externo or sug.get("nome_externo") or ""
        telefone     = telefone     or sug.get("telefone")     or ""

    if not nome_externo:
        return jsonify({"error": "Nome do convidado obrigatório"}), 400

    # Gera token único e guest_id descartável
    token    = str(uuid.uuid4()).replace("-", "")[:24]
    guest_id = f"guest_{str(uuid.uuid4())}"

    gr["confirmed_guest"] = {
        "guest_id":     guest_id,
        "nome_display": nome_externo,
        "telefone":     telefone,
        "guest_type":   guest_type,
        "is_guest":     True,
        "token":        token,
        "registered":   False,   # True após o convidado criar PIN
        "pin_hash":     None,
    }
    gr["status"] = "filled"
    write_json("guest_requests.json", db)

    base_url = request.host_url.rstrip("/")
    register_link = f"{base_url}/#cadastro?convidado={token}"

    return jsonify({"ok": True, "guest_request": gr, "register_link": register_link, "token": token})


@app.route("/api/guest-requests/<gr_id>/wo", methods=["POST"])
@require_admin
def guest_requests_wo(gr_id):
    """Admin decide que o grupo leva W.O. (sem convidado encontrado)."""
    db = read_json("guest_requests.json")
    gr = next((r for r in db["data"] if r["id"] == gr_id), None)
    if not gr:
        return jsonify({"error": "Pedido não encontrado"}), 404
    gr["status"] = "wo"
    write_json("guest_requests.json", db)
    return jsonify({"ok": True})


@app.route("/api/guest-token/<token>", methods=["GET"])
def guest_token_lookup(token):
    """Retorna dados do convidado pelo token (para pré-preencher o formulário de cadastro)."""
    db = read_json("guest_requests.json")
    for gr in db["data"]:
        cg = gr.get("confirmed_guest") or {}
        if cg.get("token") == token:
            return jsonify({
                "ok":        True,
                "guest_id":  cg["guest_id"],
                "nome":      cg["nome_display"],
                "telefone":  cg.get("telefone", ""),
                "cat":       gr.get("cat"),
                "registered": cg.get("registered", False),
            })
    return jsonify({"error": "Token inválido ou expirado"}), 404


@app.route("/api/guest-token/<token>/register", methods=["POST"])
def guest_token_register(token):
    """Convidado define seu PIN usando o token de cadastro."""
    db = read_json("guest_requests.json")
    gr = next(
        (r for r in db["data"] if (r.get("confirmed_guest") or {}).get("token") == token),
        None,
    )
    if not gr:
        return jsonify({"error": "Token inválido ou expirado"}), 404

    cg = gr["confirmed_guest"]
    if cg.get("registered"):
        return jsonify({"error": "Convidado já registrado"}), 400

    body = request.get_json(silent=True) or {}
    pin  = str(body.get("pin") or "").strip()
    if not re.fullmatch(r'\d{4}', pin):
        return jsonify({"error": "PIN deve ter exatamente 4 dígitos"}), 400

    cg["pin_hash"]   = hash_pin(pin)
    cg["registered"] = True
    write_json("guest_requests.json", db)
    return jsonify({"ok": True, "guest_id": cg["guest_id"], "nome": cg["nome_display"]})


@app.route("/api/auth/convidado", methods=["POST"])
def auth_convidado():
    """Login do convidado usando telefone + PIN definidos no cadastro descartável."""
    body     = request.get_json(silent=True) or {}
    telefone = re.sub(r'\D', '', str(body.get("telefone") or ""))
    pin      = str(body.get("pin") or "").strip()

    if not telefone or not pin:
        return jsonify({"error": "Telefone e PIN obrigatórios"}), 400

    ph = hash_pin(pin)
    db = read_json("guest_requests.json")
    for gr in db["data"]:
        cg = gr.get("confirmed_guest") or {}
        if (cg.get("telefone") == telefone
                and cg.get("pin_hash") == ph
                and cg.get("registered")):
            session["atleta_id"]  = cg["guest_id"]
            session["is_guest"]   = True
            session["is_admin"]   = False
            return jsonify({
                "ok":       True,
                "guest_id": cg["guest_id"],
                "nome":     cg["nome_display"],
                "cat":      gr.get("cat"),
                "round_id": gr.get("round_id"),
            })
    return jsonify({"error": "Telefone ou PIN incorretos"}), 401


@app.route("/api/rounds/<round_id>/substitute", methods=["POST"])
@require_admin
def round_substitute(round_id):
    """
    Substitui um atleta por um convidado (ou outro atleta) no grupo de uma rodada.
    Body: { cat, group_idx, old_athlete_id, new_athlete_id, guest_request_id? }
    """
    body         = request.get_json(silent=True) or {}
    cat          = (body.get("cat") or "").upper()
    group_idx    = body.get("group_idx")
    old_id       = (body.get("old_athlete_id") or "").strip()
    new_id       = (body.get("new_athlete_id")  or "").strip()
    gr_id        = (body.get("guest_request_id") or "").strip() or None

    if not all([cat, group_idx is not None, old_id, new_id]):
        return jsonify({"error": "cat, group_idx, old_athlete_id e new_athlete_id são obrigatórios"}), 400

    rounds_db = read_json("rounds.json")
    rnd = next((r for r in rounds_db["data"] if r["id"] == round_id), None)
    if not rnd:
        return jsonify({"error": "Rodada não encontrada"}), 404

    groups = rnd.get("groups", {}).get(cat, [])
    if group_idx >= len(groups):
        return jsonify({"error": "Grupo não encontrado"}), 400

    group_list = groups[group_idx]
    if old_id not in group_list:
        return jsonify({"error": f"Atleta {old_id} não está neste grupo"}), 400
    if new_id in group_list:
        return jsonify({"error": "Convidado já está no grupo"}), 400

    idx = group_list.index(old_id)
    group_list[idx] = new_id
    rnd["groups"][cat][group_idx] = group_list
    write_json("rounds.json", rounds_db)

    # Marca o guest_request como 'added'
    if gr_id:
        gr_db = read_json("guest_requests.json")
        gr = next((g for g in gr_db["data"] if g["id"] == gr_id), None)
        if gr:
            gr["status"] = "added"
            write_json("guest_requests.json", gr_db)

    return jsonify({"ok": True, "round_id": round_id, "cat": cat,
                    "group_idx": group_idx, "replaced": old_id, "added": new_id})


@app.route("/api/rounds/<round_id>/check-deadline", methods=["POST"])
@require_admin
def rounds_check_deadline(round_id):
    """
    Lazy W.O. check: após deadline de slots, atletas sem disponibilidade
    registrada levam W.O. automático por omissão.
    Retorna lista de atletas marcados.
    """
    rounds_db = read_json("rounds.json")
    rnd = next((r for r in rounds_db["data"] if r["id"] == round_id), None)
    if not rnd:
        return jsonify({"error": "Rodada não encontrada"}), 404

    deadline = rnd.get("deadline_slots")
    if not deadline:
        return jsonify({"error": "Rodada sem deadline configurado"}), 400

    now_str = datetime.utcnow().isoformat()
    if now_str < deadline.replace("-03:00", "").replace("T", " ")[:16]:
        return jsonify({"error": "Deadline ainda não passou"}), 400

    injuries_db = read_json("injuries.json")
    active_injuries = {
        i["athlete_id"]
        for i in injuries_db["data"]
        if i.get("status") == "active"
        and i.get("season_id") == rnd.get("season_id")
    }

    slots_db = read_json("slots.json")
    season_id = rnd.get("season_id")

    # Quais atletas submeteram slots para esta rodada
    submitted = {
        s["athlete_id"]
        for s in slots_db.get("data", [])
        if s.get("round_id") == round_id
    }

    wo_athletes = []
    for cat, groups in (rnd.get("groups") or {}).items():
        for gi, group in enumerate(groups):
            for aid in group:
                if aid in submitted or aid in active_injuries:
                    continue
                wo_athletes.append({"athlete_id": aid, "cat": cat, "group_idx": gi})

    return jsonify({"ok": True, "wo_athletes": wo_athletes, "count": len(wo_athletes)})


# ---------------------------------------------------------------------------
# Admin: Rebuild de Snapshots Retroativos
# ---------------------------------------------------------------------------

@app.route("/api/admin/rebuild-snapshots", methods=["POST"])
@require_admin
def admin_rebuild_snapshots():
    """Gera snapshots de ranking para rodadas fechadas que não os possuem (idempotente)."""
    rounds_db  = read_json("rounds.json")
    results_db = read_json("results.json")
    closed = [r for r in rounds_db["data"] if r.get("status") == "closed"]
    rebuilt, skipped = 0, 0
    for rnd in sorted(closed, key=lambda r: (r.get("season_id",""), r.get("round_number", 0))):
        prev_count = len(read_json("ranking_snapshots.json")["data"])
        _save_ranking_snapshot(rnd, results_db["data"])
        new_count = len(read_json("ranking_snapshots.json")["data"])
        if new_count > prev_count:
            rebuilt += 1
        else:
            skipped += 1
    log_audit("snapshots_rebuilt", {"rebuilt": rebuilt, "skipped_already_exist": skipped})
    return jsonify({"ok": True, "rebuilt": rebuilt, "skipped_already_exist": skipped})


# ---------------------------------------------------------------------------
# Gestão de Pagamentos
# ---------------------------------------------------------------------------

@app.route("/api/seasons/<season_id>/payments", methods=["GET"])
@require_admin
def payments_list(season_id):
    athletes_db = read_json("athletes.json")
    payments_db = read_json("payments.json")
    season_pmts = {p["athlete_id"]: p for p in payments_db["data"]
                   if p.get("season_id") == season_id}
    result = []
    for a in athletes_db["data"]:
        p = season_pmts.get(a["id"])
        result.append({
            "athlete_id":       a["id"],
            "nome":             a.get("nome", ""),
            "apelido":          a.get("apelido", ""),
            "current_category": a.get("current_category", ""),
            "status":           a.get("status", "inativo"),
            "paid":             p is not None,
            "paid_at":          p.get("paid_at") if p else None,
            "amount":           p.get("amount", 0) if p else 0,
            "note":             p.get("note", "") if p else "",
        })
    result.sort(key=lambda x: (x["status"] != "ativo",
                                x["current_category"] or "Z",
                                x["nome"].lower()))
    return jsonify(result)


@app.route("/api/seasons/<season_id>/payments/<athlete_id>", methods=["POST"])
@require_admin
def payment_mark_paid(season_id, athlete_id):
    body = request.get_json(silent=True) or {}
    payments_db = read_json("payments.json")
    payments_db["data"] = [p for p in payments_db["data"]
                            if not (p.get("season_id") == season_id and
                                    p.get("athlete_id") == athlete_id)]
    entry = {
        "id":             str(uuid.uuid4()),
        "season_id":      season_id,
        "athlete_id":     athlete_id,
        "amount":         float(body.get("amount", 0)),
        "note":           (body.get("note") or "").strip(),
        "paid_at":        datetime.utcnow().isoformat(),
        "admin_id":       session.get("admin_id", ""),
        "admin_username": session.get("admin_username", "admin"),
    }
    payments_db["data"].append(entry)
    write_json("payments.json", payments_db)
    return jsonify(entry), 201


@app.route("/api/seasons/<season_id>/payments/<athlete_id>", methods=["DELETE"])
@require_admin
def payment_mark_unpaid(season_id, athlete_id):
    payments_db = read_json("payments.json")
    payments_db["data"] = [p for p in payments_db["data"]
                            if not (p.get("season_id") == season_id and
                                    p.get("athlete_id") == athlete_id)]
    write_json("payments.json", payments_db)
    return jsonify({"ok": True})


@app.route("/api/mesa/payment-status", methods=["GET"])
def mesa_payment_status():
    athlete_id = session.get("atleta_id")
    if not athlete_id:
        return jsonify({"error": "Não autenticado"}), 403
    seasons_db   = read_json("seasons.json")
    active       = next((s for s in seasons_db["data"] if s.get("status") == "active"), None)
    if not active:
        return jsonify({"season_id": None, "paid": None, "payment_amount": 0})
    payments_db  = read_json("payments.json")
    payment      = next((p for p in payments_db["data"]
                         if p.get("season_id") == active["id"] and
                            p.get("athlete_id") == athlete_id), None)
    settings     = read_settings()
    return jsonify({
        "season_id":        active["id"],
        "season_name":      active.get("name", ""),
        "paid":             payment is not None,
        "paid_at":          payment.get("paid_at") if payment else None,
        "amount":           payment.get("amount", 0) if payment else 0,
        "payment_amount":   float(settings.get("payment_amount", 0) or 0),
        "payment_due_day":  int(settings.get("payment_due_day", 10) or 10),
        "payments_enabled": bool(settings.get("payments_enabled", True)),
    })


# ---------------------------------------------------------------------------
# WhatsApp em Lote
# ---------------------------------------------------------------------------

_WA_TEMPLATES = {
    "draw_published": {
        "label": "Sorteio Publicado",
        "text": "Olá {nome}! 🎾 O sorteio da *Rodada {rodada}* (Cat {categoria}) foi publicado no SuperRank. Acesse para ver seus grupos e marcar seus horários.",
        "extra_vars": ["rodada", "categoria"],
    },
    "slot_reminder": {
        "label": "Lembrete de Slot",
        "text": "Olá {nome}! ⏰ Não esqueça de marcar seu horário para a *Rodada {rodada}* (Cat {categoria}) até *{data_limite}*. Acesse o SuperRank.",
        "extra_vars": ["rodada", "categoria", "data_limite"],
    },
    "result_pending": {
        "label": "Resultado Pendente",
        "text": "Olá {nome}! 📋 Você tem resultado(s) pendentes de confirmação na *Rodada {rodada}* (Cat {categoria}). Acesse o SuperRank para confirmar.",
        "extra_vars": ["rodada", "categoria"],
    },
    "ranking_updated": {
        "label": "Ranking Atualizado",
        "text": "Olá {nome}! 🏆 O ranking da Cat {categoria} foi atualizado no SuperRank. Confira sua posição!",
        "extra_vars": ["categoria"],
    },
    "custom": {
        "label": "Mensagem Personalizada",
        "text": "Olá {nome}! {mensagem}",
        "extra_vars": ["mensagem"],
    },
}


class _SafeDict(dict):
    def __missing__(self, key):
        return f"{{{key}}}"


def _phone_to_wa(raw: str) -> str:
    digits = re.sub(r"\D", "", raw or "")
    if not digits:
        return ""
    if not digits.startswith("55"):
        digits = "55" + digits
    return digits


@app.route("/api/whatsapp/templates", methods=["GET"])
@require_admin
def wa_templates():
    return jsonify([
        {"key": k, "label": v["label"], "extra_vars": v["extra_vars"]}
        for k, v in _WA_TEMPLATES.items()
    ])


@app.route("/api/whatsapp/compose", methods=["POST"])
@require_admin
def wa_compose():
    body       = request.get_json(silent=True) or {}
    tpl_key    = body.get("template_key", "custom")
    athlete_ids = body.get("athlete_ids") or []
    extra_vars  = {k: v for k, v in body.items()
                   if k not in ("template_key", "athlete_ids")}

    tpl = _WA_TEMPLATES.get(tpl_key)
    if not tpl:
        return jsonify({"error": "Template inválido"}), 400

    athletes_db = read_json("athletes.json")
    athlete_map = {a["id"]: a for a in athletes_db["data"]}

    results = []
    for aid in athlete_ids:
        a = athlete_map.get(aid)
        if not a:
            continue
        phone = _phone_to_wa(a.get("telefone") or "")
        if not phone:
            continue
        ctx  = _SafeDict(nome=a.get("nome", ""), **extra_vars)
        text = tpl["text"].format_map(ctx)
        wa_url = f"https://wa.me/{phone}?text={urllib.parse.quote(text)}"
        results.append({
            "athlete_id": aid,
            "nome":  a.get("nome", ""),
            "phone": phone,
            "message_text": text,
            "wa_url": wa_url,
        })

    return jsonify(results)


@app.route("/api/whatsapp/log", methods=["POST"])
@require_admin
def wa_log_create():
    body    = request.get_json(silent=True) or {}
    log_db  = read_json("wa_log.json")
    entry   = {
        "id":             str(uuid.uuid4()),
        "timestamp":      datetime.utcnow().isoformat(),
        "template_key":   body.get("template_key", ""),
        "template_label": body.get("template_label", ""),
        "admin_id":       session.get("admin_id", ""),
        "admin_username": session.get("admin_username", session.get("username", "admin")),
        "athlete_count":  int(body.get("athlete_count", 0)),
        "vars":           body.get("vars", {}),
    }
    log_db["data"].append(entry)
    write_json("wa_log.json", log_db)
    return jsonify(entry), 201


@app.route("/api/whatsapp/log", methods=["GET"])
@require_admin
def wa_log_list():
    log_db  = read_json("wa_log.json")
    entries = sorted(log_db["data"], key=lambda x: x.get("timestamp", ""), reverse=True)
    page    = int(request.args.get("page", 1))
    per_pg  = 20
    start   = (page - 1) * per_pg
    return jsonify({"data": entries[start:start + per_pg], "total": len(entries), "page": page})


# ---------------------------------------------------------------------------
# Healthcheck
# ---------------------------------------------------------------------------

@app.route("/api/health")
def health():
    return jsonify({"status": "ok", "app": "SuperRank Rei do Play", "version": "1.0.0"})


def _migrate_groups_sets():
    """Migração: garante que todas as rodadas com grupos têm groups_sets calculados (Art. 7)."""
    from engines.draw_engine import compute_group_sets
    rounds_db = read_json("rounds.json")
    changed = False
    for rnd in rounds_db["data"]:
        if rnd.get("groups") and not rnd.get("groups_sets"):
            groups_sets = {}
            for cat, groups in rnd["groups"].items():
                groups_sets[cat] = [
                    compute_group_sets(g) for g in groups if len(g) == 4
                ]
            rnd["groups_sets"] = groups_sets
            changed = True
    if changed:
        write_json("rounds.json", rounds_db)


_migrate_groups_sets()


if __name__ == "__main__":
    app.run(debug=True, port=5001)
