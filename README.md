# SuperRank — Rei do Play

Ranking contínuo de Beach Tennis para o **Clube do Play** (Feira de Santana, BA).

## Stack

- **Backend:** Python 3.11+ · Flask 3.x · JSON em `data/`
- **Frontend:** Vanilla JS SPA (hash routing) · CSS puro · PWA (manifest + service worker)
- **Testes:** pytest 8.x · 261 testes

## Instalação local

```bash
# 1. Clone e entre no diretório
git clone <url> superrank && cd superrank

# 2. Crie e ative um virtualenv
python3 -m venv .venv && source .venv/bin/activate

# 3. Instale dependências
pip install -r requirements.txt

# 4. Configure variáveis de ambiente
cp .env.example .env
# Edite .env: defina ADMIN_PASSWORD e SECRET_KEY

# 5. (opcional) Carregue dados de demonstração
python3 seed.py

# 6. Inicie o servidor de desenvolvimento
flask run --port 5001
```

Acesse [http://localhost:5001](http://localhost:5001).

## Variáveis de ambiente

| Variável         | Obrigatória | Descrição                                         |
|------------------|-------------|---------------------------------------------------|
| `ADMIN_PASSWORD` | Sim         | Senha do painel de administração                  |
| `SECRET_KEY`     | Sim         | Chave secreta Flask para sessões                  |

Gere uma `SECRET_KEY` segura com:
```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

## Testes

```bash
pytest tests/ -v
```

## Deploy (Railway / Render)

1. Suba o repositório para o GitHub
2. Crie um novo serviço apontando para o repositório
3. Defina as variáveis `ADMIN_PASSWORD` e `SECRET_KEY` no painel do serviço
4. O `Procfile` já configura o gunicorn automaticamente:
   ```
   web: gunicorn app:app --bind 0.0.0.0:$PORT --workers 2 --timeout 60
   ```

## Estrutura do projeto

```
superrank/
├── app.py              # Servidor Flask + todas as rotas
├── engines/            # Lógica de negócio pura (testável)
│   ├── draw_engine.py      # Sorteio de grupos (Art. 25)
│   ├── score_engine.py     # Placar e pontuação (Art. 8–9)
│   ├── ranking_engine.py   # Ranking ao vivo (Art. 12)
│   ├── category_engine.py  # Fechamento / promoção (Art. 16–17)
│   ├── annual_engine.py    # Ranking anual (Art. 21–23)
│   ├── schedule_engine.py  # Agendamento de slots (Art. 27–28)
│   ├── profile_engine.py   # Perfil do atleta
│   ├── stats_engine.py     # Estatísticas admin
│   ├── history_engine.py   # Histórico de resultados
│   ├── report_engine.py    # Relatório de temporada + busca
│   └── contest_engine.py   # Fluxo de contestação
├── static/
│   ├── css/style.css   # Design tokens + componentes
│   ├── js/app.js       # SPA router + todas as telas
│   ├── manifest.json   # PWA manifest
│   ├── sw.js           # Service worker
│   └── offline.html    # Página offline
├── templates/index.html  # Shell HTML único
├── tests/              # 261 testes pytest
├── data/               # Arquivos JSON (gitignore em produção)
├── seed.py             # Dados de demonstração
├── create_icons.py     # Gera ícones PNG para o PWA
├── Procfile            # Configuração gunicorn
├── requirements.txt
└── .env.example
```

## Fluxo básico

1. **Admin** cria temporada → configura categorias → cria rodada (sorteio automático)
2. **Atletas** marcam slots de horário via "Mesa" → sistema calcula o slot comum (Art. 27)
3. **Admin** lança resultado → atletas confirmam ou contestam
4. **Admin** resolve contestações pelo painel **Contestações**
5. Ao final da temporada: **Fechamento** promove/rebaixa atletas (Art. 16)
6. Ao final do ano: **Anual** calcula Super Rei e galeria de títulos (Art. 21–23)
