/* =====================================================================
   SuperRank · Rei do Play — SPA Router
   Roteamento por hash: #login | #cadastro | #publico | #admin/... | #mesa/...
   ===================================================================== */

const app = document.getElementById('app');

const state = {
  isAdmin: false,
  atleta: null,
  athletes: [],      // cache da lista de atletas
  seasons: [],       // cache da lista de temporadas
};

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

function cloneTemplate(id) {
  const tpl = document.getElementById(id);
  if (!tpl) throw new Error(`Template #${id} não encontrado`);
  return tpl.content.cloneNode(true);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw Object.assign(new Error(json.error || 'Erro'), { status: res.status });
  return json;
}

function catClass(cat) {
  return { A: 'cat-a', B: 'cat-b', C: 'cat-c', D: 'cat-d' }[cat] || '';
}

function catLabel(cat) {
  return cat ? `<span class="category-pill ${catClass(cat)}">Cat ${cat}</span>` : '—';
}

function badge(value, map) {
  const cls = map[value] || 'badge';
  return `<span class="badge ${cls}">${value}</span>`;
}

function typeBadge(type) {
  return badge(type, { titular: 'badge-titular', reserva: 'badge-reserva', visitante: 'badge-visitante' });
}

function statusBadge(status) {
  return badge(status, { ativo: 'badge-ativo', inativo: 'badge-inativo' });
}

function seasonStatusBadge(status) {
  const labels = { pending: 'Pendente', active: 'Ativa', closed: 'Encerrada' };
  return badge(labels[status] || status, { pending: 'badge-pending', active: 'badge-active', closed: 'badge-closed' });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Modal genérico
// ---------------------------------------------------------------------------

function openModal(title, bodyHtml, footerHtml = '') {
  closeModal();
  const frag = cloneTemplate('tpl-modal');
  document.body.appendChild(frag);
  const overlay = document.getElementById('modal-overlay');
  overlay.classList.add('open');
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHtml;
  document.getElementById('modal-footer').innerHTML = footerHtml;
  document.getElementById('modal-close').addEventListener('click', closeModal);
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeModal();
  });
}

function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  if (overlay) overlay.remove();
  // Return focus to the element that opened the modal, if tracked
  if (closeModal._returnFocus) { closeModal._returnFocus.focus(); closeModal._returnFocus = null; }
}

function confirmModal(title, message, onConfirm, confirmLabel = 'Confirmar') {
  openModal(
    title,
    `<p style="font-size:14px;line-height:1.6;">${escapeHtml(message)}</p>`,
    `<button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
     <button class="btn btn-primary" id="btn-confirm-modal" style="margin-left:8px;">${escapeHtml(confirmLabel)}</button>`
  );
  document.getElementById('btn-confirm-modal').addEventListener('click', () => {
    closeModal();
    onConfirm();
  });
}

// ---------------------------------------------------------------------------
// Sprint 12 — Utilitários globais
// ---------------------------------------------------------------------------

const PAGE_TITLES = {
  'admin/dashboard': 'Dashboard — SuperRank',
  'admin/atletas':   'Atletas — SuperRank',
  'admin/categorias':'Categorias — SuperRank',
  'admin/rodada':    'Rodada — SuperRank',
  'admin/mediacao':  'Mediação — SuperRank',
  'admin/resultados':'Resultados — SuperRank',
  'admin/fechamento':'Fechamento — SuperRank',
  'admin/anual':     'Anual — SuperRank',
  'admin/relatorio':     'Relatório — SuperRank',
  'admin/contestacoes':  'Contestações — SuperRank',
  'publico/ranking': 'Ranking — SuperRank',
  'publico/grupos':  'Grupos — SuperRank',
  'publico/resultados': 'Resultados — SuperRank',
  'publico/titulos': 'Títulos — SuperRank',
  'publico/busca':   'Busca — SuperRank',
  'mesa/home':       'Home — SuperRank',
  'mesa/historico':  'Histórico — SuperRank',
  'mesa/perfil':     'Perfil — SuperRank',
};

function setPageTitle(route) {
  document.title = PAGE_TITLES[route] || 'SuperRank — Rei do Play';
}

function renderErrorState(container, message, retryFn = null) {
  container.innerHTML = `
    <div class="error-state">
      <div class="error-state-icon">⚠️</div>
      <p class="error-state-msg">${escapeHtml(message)}</p>
      ${retryFn ? `<button class="btn btn-primary" id="btn-retry">Tentar novamente</button>` : ''}
    </div>`;
  if (retryFn) container.querySelector('#btn-retry')?.addEventListener('click', retryFn);
}

function renderSkeletonCards(container, count = 4) {
  container.innerHTML = Array.from({ length: count }, () =>
    `<div class="skeleton skeleton-card"></div>`
  ).join('');
}

function svgBarChart(dataMap, width = 360, height = 90) {
  const entries = Object.entries(dataMap).map(([k, v]) => ({ label: String(k), value: Number(v) }));
  if (!entries.length) return '<p style="font-size:12px;color:var(--color-text-muted);">Sem dados.</p>';
  const max = Math.max(...entries.map(e => e.value), 1);
  const barW = Math.max(16, Math.floor((width - entries.length * 4) / entries.length));
  const totalW = entries.length * (barW + 4);
  const bars = entries.map((e, i) => {
    const h = Math.round((e.value / max) * (height - 24));
    const x = i * (barW + 4);
    const y = height - 20 - h;
    return `
      <rect x="${x}" y="${y}" width="${barW}" height="${h}" fill="var(--color-primary)" rx="2" opacity=".85"/>
      <text x="${x + barW / 2}" y="${height - 4}" text-anchor="middle" font-size="9" fill="var(--color-text-muted)">${e.label}</text>
      ${e.value > 0 ? `<text x="${x + barW / 2}" y="${y - 3}" text-anchor="middle" font-size="9" fill="var(--color-primary)" font-weight="600">${e.value}</text>` : ''}`;
  }).join('');
  return `<svg width="${totalW}" height="${height}" viewBox="0 0 ${totalW} ${height}" style="display:block;">${bars}</svg>`;
}

// ---------------------------------------------------------------------------
// Toast notifications (Sprint 9)
// ---------------------------------------------------------------------------

function showToast(msg, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', 'alert');
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('toast-out');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, 3200);
}

// ---------------------------------------------------------------------------
// Admin: mobile sidebar toggle (Sprint 9)
// ---------------------------------------------------------------------------

function initAdminSidebar() {
  const sidebar  = document.getElementById('admin-sidebar');
  const overlay  = document.getElementById('sidebar-overlay');
  const toggleBtn = document.getElementById('btn-sidebar-toggle');
  const topbar   = document.getElementById('admin-topbar');
  if (!sidebar || !toggleBtn) return;

  // Hide topbar on desktop (CSS handles it via display:none for .admin-topbar on ≥641px)
  function closeSidebar() {
    sidebar.classList.remove('open');
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    toggleBtn.setAttribute('aria-expanded', 'false');
  }

  toggleBtn.addEventListener('click', () => {
    const isOpen = sidebar.classList.toggle('open');
    overlay.classList.toggle('open', isOpen);
    overlay.setAttribute('aria-hidden', String(!isOpen));
    toggleBtn.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) {
      // Move focus into sidebar for keyboard users
      const firstLink = sidebar.querySelector('.sidebar-link');
      if (firstLink) firstLink.focus();
    }
  });
  overlay.addEventListener('click', closeSidebar);
  // Close sidebar when any nav link is clicked (SPA navigation)
  sidebar.querySelectorAll('.sidebar-link').forEach(link => {
    link.addEventListener('click', closeSidebar);
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

async function route() {
  const hash = location.hash.replace('#', '') || 'publico';
  const [section, ...parts] = hash.split('/');
  const sub = parts.join('/');

  if (section === 'admin') {
    const me = await api('/api/auth/me').catch(() => ({ is_admin: false }));
    if (!me.is_admin) { location.hash = '#login'; return; }
    state.isAdmin = true;
    setPageTitle(`admin/${sub || 'dashboard'}`);
    await renderAdmin(sub);
    return;
  }

  if (section === 'mesa') {
    const me = await api('/api/auth/me').catch(() => ({ atleta: null }));
    if (!me.atleta) { location.hash = '#login'; return; }
    state.atleta = me.atleta;
    setPageTitle(`mesa/${sub || 'home'}`);
    renderMesa(sub);
    return;
  }

  setPageTitle(sub ? `publico/${sub.split('/')[0]}` : 'publico/ranking');
  switch (section) {
    case 'login':    renderLogin(); break;
    case 'cadastro': renderCadastro(); break;
    case 'publico':  await renderPublico(sub); break;
    default:         await renderPublico('');
  }
}

window.addEventListener('hashchange', route);
window.addEventListener('load', route);

// ---------------------------------------------------------------------------
// Tela: Login
// ---------------------------------------------------------------------------

function renderLogin() {
  app.innerHTML = '';
  const frag = cloneTemplate('tpl-login');
  app.appendChild(frag);

  app.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      app.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      app.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      app.querySelector(`.tab-content[data-tab="${btn.dataset.tab}"]`).classList.add('active');
    });
  });

  // Login admin
  app.querySelector('#form-login-admin').addEventListener('submit', async e => {
    e.preventDefault();
    const errorEl = app.querySelector('#login-admin-error');
    try {
      await api('/api/auth/admin', { method: 'POST', body: { password: e.target.password.value } });
      location.hash = '#admin/dashboard';
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
    }
  });

  // Login atleta
  app.querySelector('#form-login-atleta').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Entrando…';
    try {
      const data = await api('/api/auth/atleta', {
        method: 'POST',
        body: { nome: e.target.nome.value.trim(), pin: e.target.pin.value },
      });
      state.atleta = data.atleta;
      location.hash = '#mesa/home';
    } catch (err) {
      // Mostra erro inline
      let errEl = app.querySelector('#login-atleta-error');
      if (!errEl) {
        errEl = document.createElement('p');
        errEl.id = 'login-atleta-error';
        errEl.className = 'field-error';
        btn.insertAdjacentElement('beforebegin', errEl);
      }
      errEl.textContent = err.message;
      btn.disabled = false;
      btn.textContent = 'Entrar';
    }
  });
}

// ---------------------------------------------------------------------------
// Tela: Cadastro público de atleta
// ---------------------------------------------------------------------------

function renderCadastro() {
  app.innerHTML = '';
  const frag = cloneTemplate('tpl-cadastro');
  app.appendChild(frag);

  app.querySelector('#form-cadastro').addEventListener('submit', async e => {
    e.preventDefault();
    const errorEl = app.querySelector('#cadastro-error');
    const successEl = app.querySelector('#cadastro-success');
    errorEl.classList.add('hidden');
    successEl.classList.add('hidden');

    const nome = e.target.nome.value.trim();
    const pin = e.target.pin.value;
    const pinConfirm = e.target.pin_confirm.value;
    const desired = e.target.desired_category.value || null;

    if (pin !== pinConfirm) {
      errorEl.textContent = 'Os PINs não coincidem.';
      errorEl.classList.remove('hidden');
      return;
    }
    if (!/^\d{4}$/.test(pin)) {
      errorEl.textContent = 'PIN deve ter exatamente 4 dígitos numéricos.';
      errorEl.classList.remove('hidden');
      return;
    }

    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Enviando…';

    try {
      await api('/api/athletes', {
        method: 'POST',
        body: { nome, pin, type: 'reserva', desired_category: desired },
      });
      successEl.textContent = 'Solicitação enviada! O admin confirmará sua categoria em breve.';
      successEl.classList.remove('hidden');
      e.target.reset();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Solicitar Cadastro';
    }
  });
}

// ---------------------------------------------------------------------------
// Tela: Pública
// ---------------------------------------------------------------------------

async function renderPublico(sub) {
  app.innerHTML = '';
  const frag = cloneTemplate('tpl-publico');
  app.appendChild(frag);

  // Highlight active bottom-nav item
  const activeHref = sub ? `#publico/${sub}` : '#publico/ranking';
  app.querySelectorAll('.nav-link').forEach(l => {
    const href = l.getAttribute('href');
    if (href === activeHref || (!sub && href === '#publico/ranking'))
      l.classList.add('active');
  });

  let seasons = [];
  try { seasons = await api('/api/seasons'); } catch (_) {}

  const activeSeason = seasons.find(s => s.status === 'active') || seasons[0];
  const container = app.querySelector('#categories-overview');

  if (!activeSeason && !sub?.startsWith('atleta/') && sub !== 'titulos' && sub !== 'busca') {
    container.innerHTML = `
      <div class="empty-state" style="padding:40px 20px;">
        <div class="empty-state-icon">🎾</div>
        <p class="empty-state-title">Nenhuma temporada ativa</p>
        <p>Aguarde o administrador criar e ativar uma temporada.</p>
      </div>`;
    return;
  }

  if (!sub || sub === 'ranking') {
    await renderPublicoRanking(container, activeSeason);
  } else if (sub === 'grupos') {
    await renderPublicoGrupos(container, activeSeason);
  } else if (sub === 'resultados') {
    await renderPublicoResultados(container, activeSeason);
  } else if (sub === 'titulos') {
    await renderPublicoTitulos(container);
  } else if (sub === 'busca') {
    renderPublicoBusca(container);
  } else if (sub.startsWith('atleta/')) {
    const athleteId = sub.slice('atleta/'.length);
    await renderPublicoAtleta(container, athleteId);
  }
}

async function renderPublicoRanking(container, season) {
  container.innerHTML = `<p class="placeholder-text" style="padding:var(--space-md);">Carregando ranking…</p>`;

  let rankingData = {};
  try { rankingData = await api(`/api/seasons/${season.id}/ranking`); } catch (_) {}

  const cats = ['A','B','C','D'].filter(c => (rankingData[c] || []).length > 0);

  if (!cats.length) {
    container.innerHTML = `
      <div class="empty-state" style="padding:40px 20px;">
        <p class="empty-state-title">Nenhum resultado registrado</p>
        <p>O ranking será atualizado após o lançamento dos primeiros resultados.</p>
      </div>`;
    return;
  }

  let activeCat = cats[0];

  const renderTable = (cat) => {
    const rows = rankingData[cat] || [];
    const medals = ['gold','silver','bronze'];
    return `
      <table class="ranking-table">
        <thead>
          <tr>
            <th style="width:44px;">#</th>
            <th>Atleta</th>
            <th class="num">Pts</th>
            <th class="num">W</th>
            <th class="num">Saldo</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td><span class="rank-position ${medals[r.rank-1]||''}">${r.rank}</span></td>
              <td><a href="#publico/atleta/${r.athlete_id}" style="color:inherit;font-weight:600;text-decoration:none;">${escapeHtml(r.nome)}</a></td>
              <td class="num ranking-pts">${r.points}</td>
              <td class="num ranking-stat">${r.wins}</td>
              <td class="num ranking-stat">${r.saldo >= 0 ? '+' : ''}${r.saldo}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  };

  const rebuild = () => {
    container.querySelectorAll('.ranking-cat-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.cat === activeCat));
    container.querySelector('#ranking-table-area').innerHTML = renderTable(activeCat);
  };

  container.innerHTML = `
    <div style="padding:var(--space-md) var(--space-md) 0;">
      <p style="font-size:12px;color:var(--color-text-muted);margin-bottom:12px;">
        ${escapeHtml(season.name)}
      </p>
      <div class="ranking-cat-tabs" id="ranking-tabs">
        ${cats.map(c => `
          <button class="ranking-cat-tab${c === activeCat ? ' active' : ''}" data-cat="${c}">
            Cat ${c}
          </button>`).join('')}
      </div>
    </div>
    <div style="padding:0 var(--space-md);">
      <div class="card" style="padding:0;overflow:hidden;" id="ranking-table-area">
        ${renderTable(activeCat)}
      </div>
    </div>`;

  container.querySelectorAll('.ranking-cat-tab').forEach(btn =>
    btn.addEventListener('click', () => { activeCat = btn.dataset.cat; rebuild(); }));
}

async function renderPublicoGrupos(container, season) {
  container.innerHTML = `<p class="placeholder-text" style="padding:var(--space-md);">Carregando grupos…</p>`;

  let rounds = [];
  try { rounds = await api(`/api/seasons/${season.id}/rounds`); } catch (_) {}

  const latest = rounds.sort((a,b) => b.round_number - a.round_number)[0];
  if (!latest) {
    container.innerHTML = `<div class="empty-state" style="padding:40px 20px;"><p class="empty-state-title">Nenhuma rodada criada</p></div>`;
    return;
  }

  let athletes = [];
  try { athletes = await api('/api/athletes'); } catch (_) {}
  const byId = Object.fromEntries(athletes.map(a => [a.id, a]));

  const catColors = { A: 'var(--color-cat-a)', B: 'var(--color-cat-b)', C: 'var(--color-cat-c)', D: 'var(--color-cat-d)' };

  let html = `<div style="padding:var(--space-md);">
    <p style="font-size:12px;color:var(--color-text-muted);margin-bottom:var(--space-md);">
      Rodada ${latest.round_number}${latest.target_date ? ' · ' + latest.target_date : ''}
    </p>`;

  for (const cat of ['A','B','C','D']) {
    const groups = latest.groups?.[cat];
    if (!groups || !groups.length) continue;
    html += `
      <div style="display:flex;align-items:center;gap:8px;margin:16px 0 8px;">
        <span style="width:3px;height:16px;background:${catColors[cat] || 'var(--color-primary)'};border-radius:2px;flex-shrink:0;"></span>
        <span style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${catColors[cat] || 'var(--color-text-muted)'};">${catLabel(cat)}</span>
      </div>`;
    groups.forEach((group, gi) => {
      const slot = latest.official_slots?.[cat]?.[gi];
      html += `
        <div class="card" style="margin-bottom:10px;padding:var(--space-sm) var(--space-md);">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <strong style="font-size:13px;color:var(--color-text);">Grupo ${gi+1}</strong>
            ${slot?.slot ? `<span style="font-size:12px;color:var(--color-text-muted);">⏰ ${slot.slot}</span>` : '<span style="font-size:11px;color:var(--color-text-muted);">Horário pendente</span>'}
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;">
            ${group.map(aid => `<a href="#publico/atleta/${aid}" class="athlete-chip" style="text-decoration:none;color:inherit;">${escapeHtml(byId[aid]?.nome || aid)}</a>`).join('')}
          </div>
        </div>`;
    });
  }

  html += `</div>`;
  container.innerHTML = html;
}

// ---------------------------------------------------------------------------
// Tela: Admin (shell com sidebar)
// ---------------------------------------------------------------------------

async function renderAdmin(sub) {
  app.innerHTML = '';
  const frag = cloneTemplate('tpl-admin');
  app.appendChild(frag);

  // Destaca link ativo
  const activeHref = `#admin/${sub || 'dashboard'}`;
  app.querySelectorAll('.sidebar-link').forEach(link => {
    if (link.getAttribute('href') === activeHref) link.classList.add('active');
  });

  app.querySelector('#btn-logout').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    state.isAdmin = false;
    location.hash = '#login';
  });

  initAdminSidebar();

  // Badge de contestações
  api('/api/admin/contested').then(data => {
    const badge = app.querySelector('#contested-badge');
    if (badge && data.count > 0) badge.textContent = data.count;
  }).catch(() => {});

  const content = app.querySelector('#admin-content');

  switch (sub) {
    case 'dashboard':
    case '':
      await renderAdminDashboard(content);
      break;
    case 'atletas':
      await renderAdminAtletas(content);
      break;
    case 'categorias':
      await renderAdminCategorias(content);
      break;
    case 'temporada/nova':
      renderAdminTemporadaNova(content);
      break;
    case 'rodada':
      await renderAdminRodada(content);
      break;
    case 'mediacao':
      await renderAdminMediacao(content);
      break;
    case 'resultados':
      await renderAdminResultados(content);
      break;
    case 'fechamento':
      await renderAdminFechamento(content);
      break;
    case 'anual':
      await renderAdminAnual(content);
      break;
    case 'relatorio':
      await renderAdminRelatorio(content);
      break;
    case 'contestacoes':
      await renderAdminContestacoes(content);
      break;
    default:
      content.innerHTML = `<p class="placeholder-text">Tela <code>#admin/${sub}</code> disponível em sprint futuro.</p>`;
  }
}

// ---------------------------------------------------------------------------
// Admin: Dashboard
// ---------------------------------------------------------------------------

async function renderAdminDashboard(content) {
  content.innerHTML = `<p class="placeholder-text">Carregando dashboard…</p>`;

  let stats = {}, rankingData = {};
  try { stats = await api('/api/admin/stats'); } catch (_) {}

  // Ranking preview da temporada ativa
  let rankingPreview = '';
  if (stats.active_season_id) {
    try {
      rankingData = await api(`/api/seasons/${stats.active_season_id}/ranking`);
      const previewCat = ['A','B','C','D'].find(c => rankingData[c]?.length > 0);
      if (previewCat) {
        const top3 = rankingData[previewCat].slice(0, 3);
        const medals = ['🥇','🥈','🥉'];
        rankingPreview = `
          <div class="card" style="margin-top:20px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
              <strong style="font-size:14px;">Ranking ao Vivo ${catLabel(previewCat)}</strong>
              <a href="#publico/ranking" style="font-size:12px;color:var(--color-accent);">Ver completo →</a>
            </div>
            ${top3.map((r, i) => `
              <div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:var(--border);">
                <span style="font-size:20px;">${medals[i]}</span>
                <span style="font-weight:600;flex:1;">${escapeHtml(r.nome)}</span>
                <span class="ranking-pts">${r.points}pts</span>
              </div>`).join('')}
          </div>`;
      }
    } catch (_) {}
  }

  const statCards = [
    { label: 'Atletas Ativos',    value: stats.active_athletes    ?? '—', href: '#admin/atletas',       cls: '' },
    { label: 'Pendentes',         value: stats.pending_registration ?? 0,  href: '#admin/atletas',       cls: stats.pending_registration ? 'warn' : '' },
    { label: 'Temporada Ativa',   value: stats.active_season_name ?? '—', href: '#admin/categorias',    cls: stats.active_season_name ? 'accent' : '' },
    { label: 'Temporadas',        value: stats.total_seasons      ?? '—', href: '#admin/categorias',    cls: '' },
    { label: 'Rodadas',           value: stats.total_rounds       ?? '—', href: '#admin/rodada',        cls: '' },
    { label: 'Resultados Conf.',  value: stats.confirmed_results  ?? '—', href: '#admin/resultados',    cls: '' },
  ];

  content.innerHTML = `
    <div class="section-header">
      <div>
        <h1 class="section-title">Dashboard Admin</h1>
        <p class="section-subtitle">SuperRank · Rei do Play</p>
      </div>
      <a href="/api/admin/export" class="btn btn-ghost btn-sm" title="Exportar todos os dados como JSON" download>
        Exportar dados
      </a>
    </div>

    <div class="stat-grid">
      ${statCards.map(c => `
        <a href="${c.href}" class="stat-counter ${c.cls}">
          <div class="stat-counter-value">${escapeHtml(String(c.value))}</div>
          <div class="stat-counter-label">${c.label}</div>
        </a>`).join('')}
    </div>

    ${stats.pending_registration > 0 ? `
      <div class="alert alert-warning">
        <strong>${stats.pending_registration} atleta(s) aguardando confirmação de categoria.</strong>
        <a href="#admin/atletas" style="margin-left:8px;">Gerenciar atletas →</a>
      </div>` : ''}
    ${!stats.active_season_name ? `
      <div class="alert alert-info">
        Nenhuma temporada ativa. <a href="#admin/temporada/nova">Criar temporada →</a>
      </div>` : ''}
    ${rankingPreview}`;
}

// ---------------------------------------------------------------------------
// Admin: Gestão de Atletas
// ---------------------------------------------------------------------------

async function renderAdminAtletas(content) {
  state.athletes = await api('/api/athletes');
  paintAtletasTable(content);
}

function paintAtletasTable(content) {
  const athletes = state.athletes;

  content.innerHTML = `
    <div class="section-header">
      <div>
        <h1 class="section-title">Gestão de Atletas</h1>
        <p class="section-subtitle">${athletes.length} atleta(s) cadastrado(s)</p>
      </div>
      <button id="btn-novo-atleta" class="btn btn-primary">+ Novo Atleta</button>
    </div>

    <div class="filter-bar">
      <input type="search" id="search-atleta" class="search-input" placeholder="Buscar por nome…" />
      <select id="filter-type" class="field-input" style="width:auto;min-width:140px;">
        <option value="">Todos os tipos</option>
        <option value="titular">Titular</option>
        <option value="reserva">Reserva</option>
        <option value="visitante">Visitante</option>
      </select>
      <select id="filter-cat" class="field-input" style="width:auto;min-width:130px;">
        <option value="">Todas as cats.</option>
        <option value="A">Cat A</option>
        <option value="B">Cat B</option>
        <option value="C">Cat C</option>
        <option value="D">Cat D</option>
        <option value="sem">Sem categoria</option>
      </select>
    </div>

    <div class="card" style="padding:0;overflow:hidden;">
      <table class="data-table" id="atletas-table">
        <thead>
          <tr>
            <th>Nome</th>
            <th>Tipo</th>
            <th>Categoria</th>
            <th>Confirmado</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="atletas-tbody">
          ${renderAtletasRows(athletes)}
        </tbody>
      </table>
    </div>`;

  // Botão novo atleta
  content.querySelector('#btn-novo-atleta').addEventListener('click', () => openAtletaModal());

  // Busca + filtros
  function applyFilters() {
    const q = content.querySelector('#search-atleta').value.toLowerCase();
    const typeF = content.querySelector('#filter-type').value;
    const catF = content.querySelector('#filter-cat').value;
    const filtered = state.athletes.filter(a => {
      const matchName = a.nome.toLowerCase().includes(q);
      const matchType = !typeF || a.type === typeF;
      const matchCat = !catF
        || (catF === 'sem' ? !a.current_category : a.current_category === catF);
      return matchName && matchType && matchCat;
    });
    content.querySelector('#atletas-tbody').innerHTML = renderAtletasRows(filtered);
    attachRowActions();
  }

  content.querySelector('#search-atleta').addEventListener('input', applyFilters);
  content.querySelector('#filter-type').addEventListener('change', applyFilters);
  content.querySelector('#filter-cat').addEventListener('change', applyFilters);

  function attachRowActions() {
    content.querySelectorAll('.btn-editar-atleta').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const atleta = state.athletes.find(a => a.id === id);
        openAtletaModal(atleta);
      });
    });
    content.querySelectorAll('.btn-reset-pin').forEach(btn => {
      btn.addEventListener('click', () => {
        const { id, nome } = btn.dataset;
        confirmModal('Reset de PIN', `Gerar PIN temporário para "${nome}"? O PIN atual será invalidado.`, async () => {
          btn.disabled = true;
          try {
            const res = await api(`/api/athletes/${id}/reset-pin`, { method: 'POST' });
            openModal(
              `PIN temporário — ${escapeHtml(res.nome)}`,
              `<p style="font-size:13px;margin-bottom:12px;">
                 Entregue este PIN ao atleta. Ele poderá alterá-lo na tela Perfil.
               </p>
               <div class="pin-reveal">
                 <div class="pin-reveal-value">${escapeHtml(res.temp_pin)}</div>
                 <p style="font-size:11px;color:var(--color-text-muted);margin-top:8px;">
                   Exibido apenas uma vez
                 </p>
               </div>`,
              `<button class="btn btn-primary" onclick="closeModal()">Fechar</button>`
            );
          } catch (err) {
            showToast(`Erro ao resetar PIN: ${err.message}`, 'error');
          } finally {
            btn.disabled = false;
          }
        });
      });
    });
    content.querySelectorAll('.btn-excluir-atleta').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const atleta = state.athletes.find(a => a.id === id);
        confirmModal('Excluir Atleta', `Excluir atleta "${atleta.nome}"? Esta ação não pode ser desfeita.`, async () => {
          try {
            await api(`/api/athletes/${id}`, { method: 'DELETE' });
            state.athletes = state.athletes.filter(a => a.id !== id);
            paintAtletasTable(content);
            showToast(`Atleta "${atleta.nome}" excluído.`, 'info');
          } catch (err) {
            showToast(`Erro: ${err.message}`, 'error');
          }
        }, 'Excluir');
      });
    });
  }

  attachRowActions();
}

function renderAtletasRows(athletes) {
  if (!athletes.length) {
    return `<tr><td colspan="6"><p class="placeholder-text" style="padding:24px;">Nenhum atleta encontrado.</p></td></tr>`;
  }
  return athletes.map(a => `
    <tr>
      <td style="font-weight:500;">${escapeHtml(a.nome)}${!a.admin_confirmed ? ' <span title="Aguardando confirmação de categoria" style="color:#BA7517;">⚠</span>' : ''}</td>
      <td>${typeBadge(a.type)}</td>
      <td>${catLabel(a.current_category)}</td>
      <td>${a.admin_confirmed
        ? '<span style="color:#2A7A3A;">✓</span>'
        : `<span style="color:#BA7517;" title="Categoria desejada: ${a.desired_category || 'D'}">Pendente</span>`}</td>
      <td>${statusBadge(a.status)}</td>
      <td style="text-align:right;white-space:nowrap;">
        <button class="btn btn-ghost btn-sm btn-editar-atleta" data-id="${a.id}">Editar</button>
        <button class="btn btn-ghost btn-sm btn-reset-pin" data-id="${a.id}" data-nome="${escapeHtml(a.nome)}" style="margin-left:4px;" title="Gerar PIN temporário">PIN</button>
        <button class="btn btn-ghost btn-sm btn-excluir-atleta" data-id="${a.id}" style="color:#D94040;margin-left:4px;">Excluir</button>
      </td>
    </tr>`).join('');
}

function openAtletaModal(atleta = null) {
  const isEdit = !!atleta;
  const title = isEdit ? `Editar — ${atleta.nome}` : 'Novo Atleta';

  const body = `
    <form id="form-atleta" class="form-grid">
      <div class="form-group full">
        <label class="field-label">Nome completo</label>
        <input type="text" name="nome" class="field-input" value="${escapeHtml(atleta?.nome || '')}" required />
      </div>
      <div class="form-group">
        <label class="field-label">PIN (4 dígitos)${isEdit ? ' — deixe em branco para manter' : ''}</label>
        <input type="password" name="pin" class="field-input" placeholder="••••" maxlength="4" inputmode="numeric" ${isEdit ? '' : 'required'} />
      </div>
      <div class="form-group">
        <label class="field-label">Tipo</label>
        <select name="type" class="field-input">
          <option value="titular" ${atleta?.type === 'titular' ? 'selected' : ''}>Titular</option>
          <option value="reserva" ${(!atleta || atleta.type === 'reserva') ? 'selected' : ''}>Reserva</option>
          <option value="visitante" ${atleta?.type === 'visitante' ? 'selected' : ''}>Visitante</option>
        </select>
      </div>
      <div class="form-group">
        <label class="field-label">Categoria (admin)</label>
        <select name="admin_category" class="field-input">
          <option value="">Sem categoria</option>
          <option value="A" ${atleta?.current_category === 'A' ? 'selected' : ''}>Cat A</option>
          <option value="B" ${atleta?.current_category === 'B' ? 'selected' : ''}>Cat B</option>
          <option value="C" ${atleta?.current_category === 'C' ? 'selected' : ''}>Cat C</option>
          <option value="D" ${atleta?.current_category === 'D' ? 'selected' : ''}>Cat D</option>
        </select>
      </div>
      ${isEdit ? `
      <div class="form-group full">
        <label class="field-label">Status</label>
        <select name="status" class="field-input">
          <option value="ativo" ${atleta.status === 'ativo' ? 'selected' : ''}>Ativo</option>
          <option value="inativo" ${atleta.status === 'inativo' ? 'selected' : ''}>Inativo</option>
        </select>
      </div>` : ''}
      <p id="atleta-form-error" class="field-error full hidden" style="grid-column:1/-1;"></p>
    </form>`;

  const footer = `
    <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
    <button class="btn btn-primary" id="btn-salvar-atleta">${isEdit ? 'Salvar alterações' : 'Cadastrar atleta'}</button>`;

  openModal(title, body, footer);

  document.getElementById('btn-salvar-atleta').addEventListener('click', async () => {
    const form = document.getElementById('form-atleta');
    const errorEl = document.getElementById('atleta-form-error');
    const fd = new FormData(form);
    const pin = fd.get('pin').trim();
    const body = {
      nome: fd.get('nome').trim(),
      type: fd.get('type'),
    };
    if (isEdit) {
      body.current_category = fd.get('admin_category') || null;
      body.status = fd.get('status');
    } else {
      body.admin_category = fd.get('admin_category') || null;
    }
    if (pin) body.pin = pin;

    if (!isEdit) {
      if (pin && !/^\d{4}$/.test(pin)) {
        errorEl.textContent = 'PIN deve ter 4 dígitos numéricos.';
        errorEl.classList.remove('hidden');
        return;
      }
    }

    const btn = document.getElementById('btn-salvar-atleta');
    btn.disabled = true;
    btn.textContent = 'Salvando…';

    try {
      let saved;
      if (isEdit) {
        saved = await api(`/api/athletes/${atleta.id}`, { method: 'PUT', body });
        const idx = state.athletes.findIndex(a => a.id === atleta.id);
        if (idx !== -1) state.athletes[idx] = saved;
      } else {
        saved = await api('/api/athletes', { method: 'POST', body });
        state.athletes.push(saved);
      }
      closeModal();
      const content = app.querySelector('#admin-content');
      paintAtletasTable(content);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = isEdit ? 'Salvar alterações' : 'Cadastrar atleta';
    }
  });
}

// ---------------------------------------------------------------------------
// Admin: Cadastro de Categoria
// ---------------------------------------------------------------------------

async function renderAdminCategorias(content) {
  let seasons = [], athletes = [];
  try {
    [seasons, athletes] = await Promise.all([api('/api/seasons'), api('/api/athletes')]);
    state.athletes = athletes;
    state.seasons = seasons;
  } catch (err) {
    content.innerHTML = `<div class="alert alert-error">Erro ao carregar dados: ${err.message}</div>`;
    return;
  }

  if (!seasons.length) {
    content.innerHTML = `
      <div class="section-header"><h1 class="section-title">Cadastro de Categoria</h1></div>
      <div class="alert alert-warning">
        Nenhuma temporada cadastrada. <a href="#admin/temporada/nova">Criar temporada →</a>
      </div>`;
    return;
  }

  const latestPending = seasons.find(s => s.status === 'pending') || seasons[seasons.length - 1];
  let selectedSeason = latestPending;

  function paint(season) {
    content.innerHTML = `
      <div class="section-header">
        <div>
          <h1 class="section-title">Cadastro de Categoria</h1>
          <p class="section-subtitle">Atribua titulares e reservas por categoria</p>
        </div>
      </div>

      <div style="display:flex;gap:12px;align-items:center;margin-bottom:20px;flex-wrap:wrap;">
        <label class="field-label" style="margin:0;">Temporada:</label>
        <select id="season-selector" class="field-input" style="width:auto;min-width:220px;">
          ${seasons.map(s => `<option value="${s.id}" ${s.id === season.id ? 'selected' : ''}>${escapeHtml(s.name)} ${seasonStatusBadge(s.status)}</option>`).join('')}
        </select>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px;" id="cats-grid">
        ${['A','B','C','D'].map(cat => renderCatPanel(cat, season)).join('')}
      </div>`;

    content.querySelector('#season-selector').addEventListener('change', e => {
      selectedSeason = seasons.find(s => s.id === e.target.value);
      paint(selectedSeason);
    });

    content.querySelectorAll('.btn-add-titular').forEach(btn => {
      btn.addEventListener('click', () => openAtletaPicker(btn.dataset.cat, 'titular', selectedSeason, () => paint(selectedSeason)));
    });

    content.querySelectorAll('.btn-add-reserva').forEach(btn => {
      btn.addEventListener('click', () => openAtletaPicker(btn.dataset.cat, 'reserva', selectedSeason, () => paint(selectedSeason)));
    });

    content.querySelectorAll('.btn-remove-atleta').forEach(btn => {
      btn.addEventListener('click', async () => {
        const { cat, role, id: athleteId } = btn.dataset;
        const setup = selectedSeason.category_setup[cat];
        const key = `${role}_ids`;
        const newIds = setup[key].filter(x => x !== athleteId);
        await saveCategory(selectedSeason, cat, {
          ...setup,
          [key]: newIds,
        });
        const idx = seasons.findIndex(s => s.id === selectedSeason.id);
        if (idx !== -1) {
          seasons[idx].category_setup[cat][key] = newIds;
          selectedSeason = seasons[idx];
        }
        paint(selectedSeason);
      });
    });
  }

  paint(selectedSeason);
}

function renderCatPanel(cat, season) {
  const setup = season.category_setup[cat];
  const titulares = setup.titular_ids.map(id => state.athletes.find(a => a.id === id)).filter(Boolean);
  const reservas = setup.reserva_ids.map(id => state.athletes.find(a => a.id === id)).filter(Boolean);
  const tCount = titulares.length;
  const validTitular = tCount === 0 || (tCount >= 4 && tCount % 4 === 0);

  return `
    <div class="cat-panel">
      <div class="cat-panel-header">
        ${catLabel(cat)}
        <span style="font-size:12px;color:var(--color-text-muted);">${tCount} titular${tCount !== 1 ? 'es' : ''}</span>
      </div>

      <div class="cat-panel-section">
        <div class="cat-panel-section-title">
          <span>Titulares</span>
          <button class="btn btn-ghost btn-sm btn-add-titular" data-cat="${cat}">+ Adicionar</button>
        </div>
        <div style="min-height:32px;">
          ${titulares.map(a => `
            <span class="athlete-chip">
              ${escapeHtml(a.nome)}
              <button class="btn-remove-atleta" data-cat="${cat}" data-role="titular" data-id="${a.id}" title="Remover">×</button>
            </span>`).join('') || '<span style="color:var(--color-text-muted);font-size:12px;">Nenhum titular</span>'}
        </div>
        ${!validTitular ? `<p class="validation-msg error">Titulares devem ser múltiplo de 4 (Art. 5). Atual: ${tCount}</p>` : ''}
        ${tCount > 0 && validTitular ? `<p class="validation-msg ok">✓ ${tCount} titular${tCount !== 1 ? 'es' : ''} — válido</p>` : ''}
      </div>

      <div class="cat-panel-section">
        <div class="cat-panel-section-title">
          <span>Reservas</span>
          <button class="btn btn-ghost btn-sm btn-add-reserva" data-cat="${cat}">+ Adicionar</button>
        </div>
        <div style="min-height:32px;">
          ${reservas.map(a => `
            <span class="athlete-chip">
              ${escapeHtml(a.nome)}
              <button class="btn-remove-atleta" data-cat="${cat}" data-role="reserva" data-id="${a.id}" title="Remover">×</button>
            </span>`).join('') || '<span style="color:var(--color-text-muted);font-size:12px;">Nenhuma reserva</span>'}
        </div>
      </div>
    </div>`;
}

function openAtletaPicker(cat, role, season, onSaved) {
  // Atletas já alocados como titular em qualquer categoria desta temporada
  const allTitularIds = new Set(
    Object.values(season.category_setup).flatMap(s => s.titular_ids)
  );
  const currentSetup = season.category_setup[cat];

  // Exclui quem já está nessa sessão como titular ou reserva, e titulares de outras categorias (para role=titular)
  const excluded = new Set([
    ...currentSetup.titular_ids,
    ...currentSetup.reserva_ids,
    ...(role === 'titular' ? allTitularIds : []),
  ]);

  const available = state.athletes.filter(a =>
    a.status === 'ativo' && !excluded.has(a.id)
  );

  const label = role === 'titular' ? 'Titular' : 'Reserva';
  const body = `
    <p style="font-size:13px;color:var(--color-text-muted);margin-bottom:12px;">
      Selecione um atleta para adicionar como <strong>${label}</strong> em <strong>Cat ${cat}</strong>:
    </p>
    <input type="search" id="picker-search" class="search-input" placeholder="Buscar atleta…" style="margin-bottom:8px;width:100%;" />
    <div class="picker-list" id="picker-list">
      ${renderPickerItems(available)}
    </div>`;

  openModal(`Adicionar ${label} — Cat ${cat}`, body, '');

  document.getElementById('picker-search').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    document.getElementById('picker-list').innerHTML = renderPickerItems(
      available.filter(a => a.nome.toLowerCase().includes(q))
    );
    attachPickerClicks();
  });

  function attachPickerClicks() {
    document.querySelectorAll('.picker-item').forEach(item => {
      item.addEventListener('click', async () => {
        const athleteId = item.dataset.id;
        const key = `${role}_ids`;
        const newIds = [...currentSetup[key], athleteId];
        try {
          await saveCategory(season, cat, { ...currentSetup, [key]: newIds });
          currentSetup[key] = newIds;
          closeModal();
          onSaved();
        } catch (err) {
          showToast(`Erro: ${err.message}`, 'error');
        }
      });
    });
  }

  attachPickerClicks();
}

function renderPickerItems(athletes) {
  if (!athletes.length) {
    return `<p class="placeholder-text" style="padding:16px;">Nenhum atleta disponível.</p>`;
  }
  return athletes.map(a => `
    <div class="picker-item" data-id="${a.id}">
      <div>
        <span class="picker-item-name">${escapeHtml(a.nome)}</span>
        <span class="picker-item-meta" style="margin-left:8px;">${typeBadge(a.type)}</span>
      </div>
      ${a.current_category ? catLabel(a.current_category) : ''}
    </div>`).join('');
}

async function saveCategory(season, cat, setup) {
  const saved = await api(`/api/seasons/${season.id}/categories/${cat}`, {
    method: 'PUT',
    body: { titular_ids: setup.titular_ids, reserva_ids: setup.reserva_ids },
  });
  season.category_setup[cat] = saved;
}

// ---------------------------------------------------------------------------
// Admin: Criar Temporada
// ---------------------------------------------------------------------------

function renderAdminTemporadaNova(content) {
  const today = new Date().toISOString().split('T')[0];

  content.innerHTML = `
    <div class="section-header">
      <div>
        <h1 class="section-title">Nova Temporada</h1>
        <p class="section-subtitle">Configure os parâmetros da temporada (Art. 13)</p>
      </div>
    </div>

    <div class="card" style="max-width:600px;">
      <form id="form-temporada" class="form-grid">
        <div class="form-group full">
          <label class="field-label">Nome da temporada</label>
          <input type="text" name="name" class="field-input" placeholder="Ex.: Temporada 1/2025" required />
        </div>
        <div class="form-group">
          <label class="field-label">Ano</label>
          <input type="number" name="year" class="field-input" value="${new Date().getFullYear()}" min="2020" required />
        </div>
        <div class="form-group">
          <label class="field-label">Rodadas (padrão: 4)</label>
          <input type="number" name="rounds_total" class="field-input" value="4" min="1" max="12" required />
        </div>
        <div class="form-group">
          <label class="field-label">Data de início</label>
          <input type="date" name="start_date" class="field-input" value="${today}" required />
        </div>
        <div class="form-group">
          <label class="field-label">Data de fim</label>
          <input type="date" name="end_date" class="field-input" required />
        </div>
        <div class="form-group full">
          <label class="field-label">Local de jogo</label>
          <input type="text" name="location" class="field-input" value="Clube do Play" />
        </div>
        <div class="form-group full">
          <label class="field-label">Modo de local</label>
          <select name="location_mode" class="field-input">
            <option value="single">Único (local fixo)</option>
            <option value="multiple">Múltiplos (atletas votam — Art. 29)</option>
          </select>
        </div>

        <p id="temporada-error" class="field-error hidden" style="grid-column:1/-1;"></p>
        <p id="temporada-success" class="field-success hidden" style="grid-column:1/-1;"></p>

        <div style="grid-column:1/-1;display:flex;gap:12px;justify-content:flex-end;">
          <a href="#admin/dashboard" class="btn btn-ghost">Cancelar</a>
          <button type="submit" class="btn btn-primary">Criar temporada</button>
        </div>
      </form>
    </div>`;

  content.querySelector('#form-temporada').addEventListener('submit', async e => {
    e.preventDefault();
    const errorEl = content.querySelector('#temporada-error');
    const successEl = content.querySelector('#temporada-success');
    errorEl.classList.add('hidden');
    successEl.classList.add('hidden');

    const fd = new FormData(e.target);
    const body = {
      name: fd.get('name').trim(),
      year: parseInt(fd.get('year')),
      rounds_total: parseInt(fd.get('rounds_total')),
      start_date: fd.get('start_date'),
      end_date: fd.get('end_date'),
      location: fd.get('location').trim(),
      location_mode: fd.get('location_mode'),
    };

    if (body.start_date >= body.end_date) {
      errorEl.textContent = 'A data de fim deve ser posterior à de início.';
      errorEl.classList.remove('hidden');
      return;
    }

    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Criando…';

    try {
      const season = await api('/api/seasons', { method: 'POST', body });
      state.seasons.push(season);
      successEl.textContent = `Temporada "${season.name}" criada! Agora configure as categorias.`;
      successEl.classList.remove('hidden');
      // Redireciona para categorias após 1.5s
      setTimeout(() => { location.hash = '#admin/categorias'; }, 1500);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Criar temporada';
    }
  });
}

// ---------------------------------------------------------------------------
// Admin: Mediação de Slot (Art. 27 — sem interseção → admin define)
// ---------------------------------------------------------------------------

async function renderAdminMediacao(content) {
  let seasons = [], athletes = [];
  try {
    [seasons, athletes] = await Promise.all([api('/api/seasons'), api('/api/athletes')]);
    state.athletes = athletes;
  } catch (err) {
    content.innerHTML = `<div class="alert alert-error">Erro: ${escapeHtml(err.message)}</div>`;
    return;
  }

  const athletesById = Object.fromEntries(athletes.map(a => [a.id, a]));

  // Coleta todos os grupos needs_mediation ou pending de todos as rodadas
  let allRounds = [];
  for (const season of seasons) {
    try {
      const rounds = await api(`/api/seasons/${season.id}/rounds`);
      allRounds.push(...rounds.map(r => ({ ...r, season_name: season.name })));
    } catch (_) {}
  }

  // Grupos que precisam de mediação
  const pendingGroups = [];
  for (const rnd of allRounds) {
    for (const [cat, catSlots] of Object.entries(rnd.official_slots || {})) {
      for (let idx = 0; idx < catSlots.length; idx++) {
        const s = catSlots[idx];
        if (s.status === 'needs_mediation' || s.status === 'pending') {
          pendingGroups.push({ round: rnd, cat, groupIdx: idx, slotInfo: s });
        }
      }
    }
  }

  content.innerHTML = `
    <div class="section-header">
      <div>
        <h1 class="section-title">Mediação de Slot</h1>
        <p class="section-subtitle">
          ${pendingGroups.length === 0
            ? 'Nenhum grupo aguardando mediação'
            : `${pendingGroups.length} grupo${pendingGroups.length !== 1 ? 's' : ''} sem horário definido`}
        </p>
      </div>
    </div>

    ${pendingGroups.length === 0
      ? `<div class="alert alert-info">
           Todos os grupos têm horário definido. Use "Painel de Rodada → Resolver Slots" para computar os horários.
         </div>`
      : pendingGroups.map(pg => renderMediationCard(pg, athletesById)).join('')}`;

  // Botões "Resolver todos" por rodada
  content.querySelectorAll('.btn-resolve-round').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true; btn.textContent = 'Resolvendo…';
      try {
        await api(`/api/rounds/${btn.dataset.roundId}/resolve`, { method: 'POST', body: {} });
        await renderAdminMediacao(content);
      } catch (err) {
        showToast(`Erro: ${err.message}`, 'error');
        btn.disabled = false; btn.textContent = 'Resolver Slots';
      }
    });
  });

  // Formulários de mediação manual
  content.querySelectorAll('.btn-mediar').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { roundId, cat, groupIdx } = btn.dataset;
      const input = content.querySelector(`#mediation-input-${roundId}-${cat}-${groupIdx}`);
      const slot = input?.value?.trim();
      if (!slot) { showToast('Informe um slot (ex: 06:00)', 'error'); return; }
      btn.disabled = true; btn.textContent = 'Salvando…';
      try {
        await api(`/api/rounds/${roundId}/groups/${cat}/${groupIdx}/slot`, {
          method: 'PUT', body: { slot }
        });
        await renderAdminMediacao(content);
      } catch (err) {
        showToast(`Erro: ${err.message}`, 'error');
        btn.disabled = false; btn.textContent = 'Confirmar';
      }
    });
  });
}

function renderMediationCard(pg, athletesById) {
  const { round, cat, groupIdx, slotInfo } = pg;
  const group = round.groups?.[cat]?.[groupIdx] || [];
  const groupNamed = round.groups_named?.[cat]?.[groupIdx] || group;
  const roundSlotSummary = round.official_slots?.[cat]?.[groupIdx];

  const statusLabel = slotInfo.status === 'needs_mediation' ? '⚠ Sem interseção' : '🕐 Pendente';

  // Slots de cada atleta (via groups_named, mas não temos os slots aqui → mostrar quem tem WO)
  const woIds = slotInfo.wo_athlete_ids || [];

  return `
    <div class="mediation-group-card">
      <div class="mediation-group-header">
        ${catLabel(cat)}
        <span style="font-weight:600;margin-left:4px;">Grupo ${groupIdx + 1}</span>
        <span style="flex:1;"></span>
        <span class="badge badge-pending">${statusLabel}</span>
        <button class="btn btn-ghost btn-sm btn-resolve-round" data-round-id="${round.id}" style="margin-left:8px;">
          Resolver Slots
        </button>
      </div>

      <table class="mediation-slots-table">
        <tbody>
          ${groupNamed.map((nome, i) => {
            const aid = group[i];
            const isWo = woIds.includes(aid);
            return `<tr>
              <td style="width:180px;font-weight:${isWo ? '400' : '600'};">
                ${escapeHtml(nome)}
              </td>
              <td>
                ${isWo
                  ? '<span class="badge badge-inativo">Sem slots (WO)</span>'
                  : '<span class="badge badge-ativo">Slots marcados</span>'}
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>

      <div class="mediation-form">
        <span style="font-size:13px;font-weight:600;color:var(--color-text-muted);">Definir horário manualmente:</span>
        <select id="mediation-input-${round.id}-${cat}-${groupIdx}" class="field-input" style="width:auto;min-width:100px;">
          ${['06:00','06:30','07:00','07:30','08:00','08:30','09:00','09:30',
             '16:30','17:00','17:30','18:00','18:30','19:00','19:30','20:00','20:30'].map(s =>
            `<option value="${s}">${s}</option>`).join('')}
        </select>
        <button class="btn btn-primary btn-mediar"
          data-round-id="${round.id}" data-cat="${cat}" data-group-idx="${groupIdx}">
          Confirmar
        </button>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Admin: Painel de Rodada
// ---------------------------------------------------------------------------

async function renderAdminRodada(content) {
  let seasons = [];
  try { seasons = await api('/api/seasons'); } catch (err) {
    content.innerHTML = `<div class="alert alert-error">Erro ao carregar temporadas: ${escapeHtml(err.message)}</div>`;
    return;
  }

  if (!seasons.length) {
    content.innerHTML = `
      <div class="section-header"><h1 class="section-title">Painel de Rodada</h1></div>
      <div class="alert alert-warning">Nenhuma temporada. <a href="#admin/temporada/nova">Criar temporada →</a></div>`;
    return;
  }

  // Usa temporada ativa, ou a mais recente
  const activeSeason = seasons.find(s => s.status === 'active') || seasons[seasons.length - 1];
  let selectedSeason = activeSeason;
  let rounds = [];

  async function loadAndPaint(season) {
    selectedSeason = season;
    try {
      rounds = await api(`/api/seasons/${season.id}/rounds`);
    } catch (_) { rounds = []; }
    paintRodada(season, rounds);
  }

  function paintRodada(season, rounds) {
    const nextRoundNum = rounds.length + 1;
    const canDraw = nextRoundNum <= season.rounds_total;

    content.innerHTML = `
      <div class="section-header">
        <div>
          <h1 class="section-title">Painel de Rodada</h1>
          <p class="section-subtitle">${escapeHtml(season.name)} · ${rounds.length} de ${season.rounds_total} rodada${season.rounds_total !== 1 ? 's' : ''} sorteada${season.rounds_total !== 1 ? 's' : ''}</p>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <button id="btn-refresh-rodada" class="btn btn-ghost btn-sm" title="Atualizar dados">↺ Atualizar</button>
          ${canDraw
            ? `<button id="btn-sortear" class="btn btn-primary">⚡ Sortear Rodada ${nextRoundNum}</button>`
            : `<span class="badge badge-closed">Todas as rodadas sorteadas</span>`}
        </div>
      </div>

      <div style="display:flex;gap:12px;align-items:center;margin-bottom:20px;flex-wrap:wrap;">
        <label class="field-label" style="margin:0;">Temporada:</label>
        <select id="season-selector" class="field-input" style="width:auto;min-width:220px;">
          ${seasons.map(s => `<option value="${s.id}" ${s.id === season.id ? 'selected' : ''}>${escapeHtml(s.name)} ${seasonStatusBadge(s.status)}</option>`).join('')}
        </select>
      </div>

      ${rounds.length === 0
        ? `<div class="empty-state"><div class="empty-state-icon">🎲</div>
           <p class="empty-state-title">Nenhuma rodada sorteada</p>
           <p>Clique em "Sortear Rodada 1" para gerar os grupos.</p></div>`
        : `<div class="rounds-list" id="rounds-list">${rounds.map(r => renderRoundCard(r, season)).join('')}</div>`}`;

    // Selector de temporada
    content.querySelector('#season-selector').addEventListener('change', e => {
      const s = seasons.find(s => s.id === e.target.value);
      if (s) loadAndPaint(s);
    });

    // Botão sortear
    const btnSortear = content.querySelector('#btn-sortear');
    if (btnSortear) {
      btnSortear.addEventListener('click', async () => {
        btnSortear.disabled = true;
        btnSortear.textContent = 'Sorteando…';
        try {
          const newRound = await api(`/api/seasons/${season.id}/rounds`, { method: 'POST', body: {} });
          rounds.push(newRound);
          await loadAndPaint(season);
          // Expande o card da nova rodada automaticamente
          setTimeout(() => {
            const lastCard = content.querySelector('.round-card:last-child .round-card-header');
            if (lastCard) lastCard.click();
          }, 100);
        } catch (err) {
          showToast(`Erro ao sortear: ${err.message}`, 'error');
          btnSortear.disabled = false;
          btnSortear.textContent = `⚡ Sortear Rodada ${nextRoundNum}`;
        }
      });
    }

    // Refresh button
    content.querySelector('#btn-refresh-rodada')?.addEventListener('click', () => loadAndPaint(season));

    // Acordeon dos rounds
    content.querySelectorAll('.round-card-header').forEach(header => {
      header.addEventListener('click', async () => {
        const body = header.nextElementSibling;
        const chevron = header.querySelector('.round-card-chevron');
        body.classList.toggle('open');
        chevron.classList.toggle('open');
        if (body.classList.contains('open')) {
          initCatTabs(body);
          // Load result statuses for this round and annotate group cards
          const roundId = header.closest('.round-card').dataset.roundId;
          if (roundId) {
            try {
              const results = await api(`/api/rounds/${roundId}/results`);
              const statusLabel = { confirmed: 'Confirmado', contested: 'Contestado', pending: 'Aguardando' };
              const statusClass = { confirmed: 'badge-active', contested: 'badge-pending', pending: 'badge-inativo' };
              results.forEach(r => {
                const badge = body.querySelector(
                  `.group-card[data-round="${roundId}"][data-cat="${r.cat}"][data-gi="${r.group_idx}"] .group-result-badge`
                );
                if (badge) {
                  badge.className = `group-result-badge badge ${statusClass[r.status] || ''}`;
                  badge.textContent = statusLabel[r.status] || r.status;
                }
              });
            } catch (_) {}
          }
        }
      });
    });
  }

  await loadAndPaint(selectedSeason);
}

function renderRoundCard(round, season) {
  const statusMap = {
    pending: 'badge-pending', scheduled: 'badge-active',
    in_progress: 'badge-active', closed: 'badge-closed', cancelled: 'badge-inativo'
  };
  const statusLabel = {
    pending: 'Pendente', scheduled: 'Agendada',
    in_progress: 'Em andamento', closed: 'Encerrada', cancelled: 'Cancelada'
  };

  const cats = Object.keys(round.groups || {});
  const totalGroups = cats.reduce((acc, cat) => acc + (round.groups[cat] || []).length, 0);

  return `
    <div class="round-card" data-round-id="${round.id}">
      <div class="round-card-header">
        <span class="round-card-title">Rodada ${round.round_number} de ${season.rounds_total}</span>
        <span class="badge ${statusMap[round.status] || ''}" style="margin-right:8px;">${statusLabel[round.status] || round.status}</span>
        <span style="font-size:12px;color:var(--color-text-muted);margin-right:8px;">${totalGroups} grupo${totalGroups !== 1 ? 's' : ''} · ${cats.map(c => `Cat ${c}`).join(', ') || '—'}</span>
        <span class="round-card-chevron">▼</span>
      </div>
      <div class="round-card-body">
        ${round.cancelled_categories && round.cancelled_categories.length
          ? `<div class="alert alert-warning" style="margin-bottom:12px;">
              ⚠ Cat ${round.cancelled_categories.join(', ')} sem número válido de atletas (Art. 14) — rodada cancelada para essa(s) categoria(s).
             </div>`
          : ''}
        ${cats.length === 0
          ? `<p class="placeholder-text">Nenhum grupo gerado.</p>`
          : `<div class="cat-tabs">
              ${cats.map((cat, i) => `
                <button class="cat-tab ${i === 0 ? 'active' : ''}" data-cat="${cat}">
                  ${catLabel(cat)}
                </button>`).join('')}
            </div>
            ${cats.map((cat, i) => `
              <div class="cat-tab-content ${i === 0 ? 'active' : ''}" data-cat-content="${cat}">
                ${renderGroupsGrid(cat, round)}
              </div>`).join('')}`}
      </div>
    </div>`;
}

function renderGroupsGrid(cat, round) {
  const groups = round.groups[cat] || [];
  const groupsNamed = (round.groups_named || {})[cat] || [];
  const groupsSetsNamed = (round.groups_sets_named || {})[cat] || [];

  return `
    <div class="groups-grid">
      ${groups.map((group, idx) => {
        const names = groupsNamed[idx] || group;
        const sets = groupsSetsNamed[idx] || [];
        return `
          <div class="group-card" data-round="${round.id}" data-cat="${cat}" data-gi="${idx}">
            <div class="group-card-header">
              <span>Grupo ${idx + 1}</span>
              <span style="font-weight:400;opacity:0.8;">Cat ${cat}</span>
              <span class="group-result-badge badge" style="margin-left:auto;font-size:10px;"></span>
            </div>
            <div class="group-athletes">
              ${names.map(n => `<span class="group-athlete-chip">${escapeHtml(n)}</span>`).join('')}
            </div>
            <div class="group-sets">
              ${sets.map(s => `
                <div class="set-row">
                  <span class="set-label">Set ${s.set}</span>
                  <span class="set-team">${s.team_a.map(escapeHtml).join(' + ')}</span>
                  <span class="set-vs">vs</span>
                  <span class="set-team">${s.team_b.map(escapeHtml).join(' + ')}</span>
                </div>`).join('')}
            </div>
          </div>`;
      }).join('')}
    </div>`;
}

function initCatTabs(bodyEl) {
  bodyEl.querySelectorAll('.cat-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      bodyEl.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
      bodyEl.querySelectorAll('.cat-tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      bodyEl.querySelector(`.cat-tab-content[data-cat-content="${tab.dataset.cat}"]`).classList.add('active');
    });
  });
}

// ---------------------------------------------------------------------------
// Tela: Mesa (atleta) — shell + router
// ---------------------------------------------------------------------------

async function renderMesa(sub) {
  app.innerHTML = '';
  const frag = cloneTemplate('tpl-mesa');
  app.appendChild(frag);

  if (state.atleta) {
    app.querySelector('#mesa-atleta-nome').textContent = state.atleta.nome;
  }

  const activeHref = `#mesa/${sub || 'home'}`;
  app.querySelectorAll('.bottom-nav-item').forEach(link => {
    if (link.getAttribute('href') === activeHref) link.classList.add('active');
  });

  app.querySelector('#btn-mesa-logout').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    state.atleta = null;
    location.hash = '#login';
  });

  const content = app.querySelector('#mesa-content');

  // Carrega contexto do atleta (usado por todas as sub-telas)
  let ctx = null;
  try { ctx = await api('/api/mesa/context'); } catch (_) {}

  switch (sub || 'home') {
    case 'home':      await renderMesaHome(content, ctx); break;
    case 'slots':     renderMesaSlots(content, ctx); break;
    case 'grupo':     renderMesaGrupo(content, ctx); break;
    case 'resultado': renderMesaResultado(content, ctx); break;
    case 'historico': await renderMesaHistorico(content); break;
    case 'perfil':    await renderMesaPerfil(content); break;
    default:
      content.innerHTML = `<p class="placeholder-text">Tela disponível em sprint futuro.</p>`;
  }
}

// ---------------------------------------------------------------------------
// Mesa: Home
// ---------------------------------------------------------------------------

async function renderMesaHome(content, ctx) {
  if (!ctx || !ctx.season) {
    content.innerHTML = `
      <div class="empty-state" style="padding:40px 20px;">
        <div class="empty-state-icon">🎾</div>
        <p class="empty-state-title">Nenhuma temporada ativa</p>
        <p>Aguarde o administrador iniciar uma temporada.</p>
      </div>`;
    return;
  }

  const { season, round, group, official_slot, my_slots, pending_result } = ctx;
  const hasSlots = my_slots && my_slots.length > 0;
  const slotResolved = official_slot && official_slot.status === 'resolved';
  const athleteCat = ctx.athlete.current_category;

  let pendencias = [];
  if (round && !hasSlots) pendencias.push({ icon: '⏰', text: 'Marcar slots de disponibilidade', link: '#mesa/slots', urgent: true });
  if (pending_result) pendencias.push({ icon: '📋', text: 'Confirmar resultado do grupo', link: '#mesa/resultado', urgent: true });
  if (group && slotResolved) pendencias.push({ icon: '✅', text: `Horário definido: ${official_slot.slot}`, link: '#mesa/grupo', urgent: false });
  if (group && !slotResolved && hasSlots) pendencias.push({ icon: '🕐', text: 'Aguardando horário oficial do grupo', link: '#mesa/grupo', urgent: false });

  // Parallel fetch: ranking + history
  let myRank = null, catRanking = [], historyList = [];
  try {
    const [rankData, histData] = await Promise.all([
      season && athleteCat ? api(`/api/seasons/${season.id}/ranking?cat=${athleteCat}`) : Promise.resolve({}),
      api('/api/mesa/history'),
    ]);
    catRanking = rankData[athleteCat] || [];
    myRank = catRanking.find(r => r.athlete_id === ctx.athlete.id) || null;
    historyList = histData.history || [];
  } catch (_) {}

  const catTotal = catRanking.length;
  const rank = myRank?.rank;

  // Promo/releg bars (side by side in one row)
  let promoRelegHtml = '';
  if (myRank && catTotal > 0) {
    const showPromo = athleteCat !== 'A';
    const showReleg = athleteCat !== 'D';
    const promoPct = showPromo ? Math.max(0, Math.round(100 * (1 - (rank - 1) / catTotal))) : 0;
    const relegPct = showReleg ? Math.max(0, Math.round(100 * (rank - 1) / catTotal)) : 0;
    const promoCol = showPromo ? `
      <div style="flex:1;">
        <div class="promo-releg-label up">Promoção</div>
        <div class="promo-releg-bar-bg"><div class="promo-releg-bar-fill up" style="width:${promoPct}%;"></div></div>
        <div class="promo-releg-pct up">${promoPct}%</div>
      </div>` : '';
    const relegCol = showReleg ? `
      <div style="flex:1;">
        <div class="promo-releg-label down">Rebaixamento</div>
        <div class="promo-releg-bar-bg"><div class="promo-releg-bar-fill down" style="width:${relegPct}%;"></div></div>
        <div class="promo-releg-pct down">${relegPct}%</div>
      </div>` : '';
    if (showPromo || showReleg) {
      promoRelegHtml = `<div class="promo-releg-row" style="margin-bottom:var(--space-md);">${promoCol}${relegCol}</div>`;
    }
  }

  // Last result from history
  const lastResult = historyList.length ? historyList[historyList.length - 1] : null;
  const lastResultHtml = lastResult ? `
    <div class="last-result-card">
      <div class="last-result-header">
        <span class="last-result-label">Último Resultado</span>
        <span class="last-result-round">Rodada ${lastResult.round_number}</span>
      </div>
      <div style="display:flex;align-items:center;gap:12px;">
        <span class="last-result-score ${lastResult.rank_in_group === 1 ? 'pos-1' : lastResult.rank_in_group === 2 ? 'pos-2' : lastResult.rank_in_group === 3 ? 'pos-3' : 'other'}">${lastResult.rank_in_group}°</span>
        <div>
          <div style="font-size:13px;font-weight:600;">${lastResult.my_total ?? '—'} pts · Cat ${lastResult.cat}</div>
          <div class="last-result-detail">${lastResult.group_size} atletas no grupo</div>
        </div>
      </div>
    </div>` : '';

  // Hero card
  const heroHtml = myRank ? `
    <div class="mesa-hero-card">
      <div class="mesa-hero-greeting">Olá,</div>
      <div class="mesa-hero-name">${escapeHtml(ctx.athlete.nome)}</div>
      <div class="mesa-hero-cat-row">
        <span class="badge badge-cat-${athleteCat?.toLowerCase()}">${catLabel(athleteCat)}</span>
      </div>
      <div class="mesa-hero-rank-block">
        <span class="mesa-hero-rank-pos">${rank}°</span>
        <div class="mesa-hero-pts-block">
          <div class="mesa-hero-pts-value">${myRank.points}</div>
          <div class="mesa-hero-pts-label">pontos</div>
        </div>
      </div>
      ${promoRelegHtml}
      <div class="mesa-stats-grid">
        <div class="mesa-stat-cell">
          <div class="mesa-stat-value">${myRank.wins}</div>
          <div class="mesa-stat-label">Vitórias</div>
        </div>
        <div class="mesa-stat-cell">
          <div class="mesa-stat-value">${myRank.saldo >= 0 ? '+' : ''}${myRank.saldo}</div>
          <div class="mesa-stat-label">Saldo Sets</div>
        </div>
        <div class="mesa-stat-cell">
          <div class="mesa-stat-value">${catTotal}</div>
          <div class="mesa-stat-label">Na categoria</div>
        </div>
      </div>
    </div>` : `
    <div class="mesa-hero-card">
      <div class="mesa-hero-greeting">Olá,</div>
      <div class="mesa-hero-name">${escapeHtml(ctx.athlete.nome)}</div>
      <div class="mesa-hero-cat-row">
        <span class="badge badge-cat-${athleteCat?.toLowerCase()}">${catLabel(athleteCat)}</span>
      </div>
      <p style="font-size:13px;color:var(--color-text-muted);margin-top:8px;">Sem dados de ranking ainda.</p>
    </div>`;

  content.innerHTML = `
    <div style="padding:var(--space-md);">
      ${heroHtml}

      ${lastResultHtml}

      ${round ? `
        <div class="card" style="margin-bottom:16px;">
          <p style="font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--color-text-muted);margin-bottom:4px;">Rodada Atual</p>
          <p style="font-size:20px;font-weight:700;color:var(--color-primary);">Rodada ${round.round_number} de ${round.rounds_total}</p>
          ${round.target_date ? `<p style="font-size:13px;color:var(--color-text-muted);">Data: ${round.target_date}</p>` : ''}
          ${round.deadline_slots ? `<p style="font-size:12px;color:#BA7517;">Prazo slots: ${round.deadline_slots}</p>` : ''}
        </div>` : `<p class="placeholder-text">Nenhuma rodada criada ainda.</p>`}

      ${pendencias.length ? `
        <div style="margin-bottom:16px;">
          <p style="font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--color-text-muted);margin-bottom:8px;">Pendências</p>
          ${pendencias.map(p => `
            <a href="${p.link}" class="card" style="display:flex;align-items:center;gap:12px;margin-bottom:8px;text-decoration:none;${p.urgent ? 'border-left:3px solid var(--color-accent);' : ''}">
              <span style="font-size:20px;">${p.icon}</span>
              <span style="font-weight:500;font-size:14px;">${escapeHtml(p.text)}</span>
            </a>`).join('')}
        </div>` : round ? `<div class="alert alert-info">Sem pendências no momento.</div>` : ''}

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <a href="#mesa/slots" class="card" style="display:block;text-align:center;text-decoration:none;">
          <p style="font-size:20px;margin-bottom:4px;">⏰</p>
          <p style="font-size:13px;font-weight:600;">Marcar Slots</p>
          ${hasSlots ? `<p style="font-size:11px;color:var(--color-text-muted);">${my_slots.length} marcado${my_slots.length !== 1 ? 's' : ''}</p>` : ''}
        </a>
        <a href="#mesa/grupo" class="card" style="display:block;text-align:center;text-decoration:none;">
          <p style="font-size:20px;margin-bottom:4px;">👥</p>
          <p style="font-size:13px;font-weight:600;">Meu Grupo</p>
          ${group ? `<p style="font-size:11px;color:var(--color-text-muted);">Cat ${group.category} · Grupo ${group.group_index + 1}</p>` : ''}
        </a>
        <a href="#mesa/resultado" class="card" style="display:block;text-align:center;text-decoration:none;grid-column:1/-1;${pending_result ? 'border-left:3px solid var(--color-accent);' : ''}">
          <p style="font-size:20px;margin-bottom:4px;">📋</p>
          <p style="font-size:13px;font-weight:600;">Resultado</p>
          <p style="font-size:11px;color:var(--color-text-muted);">${pending_result ? 'Aguardando sua confirmação' : 'Ver resultado do grupo'}</p>
        </a>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Mesa: Marcar Slots (Art. 26 + Art. 28)
// ---------------------------------------------------------------------------

function renderMesaSlots(content, ctx) {
  if (!ctx || !ctx.round) {
    content.innerHTML = `<p class="placeholder-text">Nenhuma rodada ativa.</p>`;
    return;
  }

  const { round, my_slots = [], eligible_slots: eligible = [] } = ctx;
  let selected = new Set(my_slots);

  // Divide em manhã e tarde para dias úteis
  const MORNING = ["06:00","06:30","07:00","07:30"];
  const isWeekend = eligible.includes("08:00") && !eligible.includes("06:00");

  function renderSlotBtn(slot) {
    const isSel = selected.has(slot);
    return `<button class="slot-btn${isSel ? ' selected' : ''}" data-slot="${slot}">${slot}</button>`;
  }

  function buildGrid() {
    if (isWeekend) {
      return `
        <p class="slots-period-label">Fim de Semana / Feriado (07:00–10:00)</p>
        <div class="slots-row">${eligible.map(renderSlotBtn).join('')}</div>`;
    }
    const morning = eligible.filter(s => MORNING.includes(s));
    const afternoon = eligible.filter(s => !MORNING.includes(s));
    return `
      <p class="slots-period-label">Manhã (06:00–08:00)</p>
      <div class="slots-row">${morning.map(renderSlotBtn).join('')}</div>
      <p class="slots-period-label">Tarde/Noite (16:30–21:00)</p>
      <div class="slots-row">${afternoon.map(renderSlotBtn).join('')}</div>`;
  }

  content.innerHTML = `
    <div class="slots-screen">
      <h2 style="font-size:18px;font-weight:700;color:var(--color-primary);margin-bottom:4px;">Marcar Slots</h2>
      <p style="font-size:13px;color:var(--color-text-muted);margin-bottom:16px;">
        Rodada ${round.round_number} ${round.target_date ? '· ' + round.target_date : ''}
      </p>

      ${round.deadline_slots ? `
        <div class="deadline-bar">
          ⏰ Prazo: <strong>${round.deadline_slots}</strong> · Art. 26: sem slot = WO automático
        </div>` : ''}

      <p class="slots-summary" id="slots-summary">
        ${selected.size} slot${selected.size !== 1 ? 's' : ''} selecionado${selected.size !== 1 ? 's' : ''}
      </p>

      <div id="slots-grid">${buildGrid()}</div>

      <div style="display:flex;gap:12px;margin-top:20px;">
        <button id="btn-limpar" class="btn btn-ghost">Limpar tudo</button>
        <button id="btn-salvar-slots" class="btn btn-primary">Salvar slots</button>
      </div>
      <p id="slots-msg" class="hidden" style="margin-top:12px;font-size:13px;"></p>
    </div>`;

  function refreshGrid() {
    content.querySelector('#slots-grid').innerHTML = buildGrid();
    content.querySelector('#slots-summary').textContent =
      `${selected.size} slot${selected.size !== 1 ? 's' : ''} selecionado${selected.size !== 1 ? 's' : ''}`;
    attachSlotClicks();
  }

  function attachSlotClicks() {
    content.querySelectorAll('.slot-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const slot = btn.dataset.slot;
        if (selected.has(slot)) selected.delete(slot); else selected.add(slot);
        refreshGrid();
      });
    });
  }

  attachSlotClicks();

  content.querySelector('#btn-limpar').addEventListener('click', () => {
    selected.clear();
    refreshGrid();
  });

  content.querySelector('#btn-salvar-slots').addEventListener('click', async () => {
    const msgEl = content.querySelector('#slots-msg');
    const btn = content.querySelector('#btn-salvar-slots');
    btn.disabled = true;
    btn.textContent = 'Salvando…';
    try {
      await api(`/api/rounds/${round.id}/slots`, {
        method: 'PUT',
        body: { slots: [...selected] },
      });
      msgEl.textContent = '✓ Slots salvos com sucesso!';
      msgEl.style.color = 'var(--color-cat-c)';
      msgEl.classList.remove('hidden');
    } catch (err) {
      msgEl.textContent = `Erro: ${err.message}`;
      msgEl.style.color = '#D94040';
      msgEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Salvar slots';
    }
  });
}

// ---------------------------------------------------------------------------
// Mesa: Meu Grupo
// ---------------------------------------------------------------------------

function renderMesaGrupo(content, ctx) {
  if (!ctx || !ctx.group) {
    content.innerHTML = `
      <div class="empty-state" style="padding:40px 20px;">
        <div class="empty-state-icon">👥</div>
        <p class="empty-state-title">Grupo não encontrado</p>
        <p>Você não está em nenhum grupo na rodada atual.</p>
      </div>`;
    return;
  }

  const { athlete, group, official_slot, round } = ctx;
  const slotsStatus = ctx.group_slots_status || [];
  const slotResolved = official_slot && official_slot.status === 'resolved';
  const slotCard = slotResolved
    ? `<div class="official-slot-card">
         <p class="official-slot-label">Horário Oficial</p>
         <p class="official-slot-time">${official_slot.slot}</p>
         <p class="official-slot-location">📍 ${escapeHtml(group.location)}</p>
         ${round?.target_date ? `<p style="opacity:.75;font-size:12px;margin-top:4px;">${round.target_date}</p>` : ''}
       </div>`
    : `<div class="pending-slot-card">
         <p style="font-size:24px;margin-bottom:8px;">🕐</p>
         <p style="font-weight:600;">
           ${official_slot?.status === 'needs_mediation' ? 'Aguardando mediação do admin' : 'Aguardando definição de horário'}
         </p>
         <p style="font-size:13px;margin-top:4px;">Marque seus slots em <a href="#mesa/slots">Marcar Slots</a></p>
       </div>`;

  content.innerHTML = `
    <div class="grupo-screen">
      <h2 style="font-size:18px;font-weight:700;color:var(--color-primary);margin-bottom:4px;">Meu Grupo</h2>
      <p style="font-size:13px;color:var(--color-text-muted);margin-bottom:16px;">
        ${catLabel(group.category)} · Grupo ${group.group_index + 1} · Rodada ${round?.round_number ?? '—'}
      </p>

      ${slotCard}

      <p style="font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;
         color:var(--color-text-muted);margin-bottom:8px;">Atletas do Grupo</p>
      <div class="group-members-list" style="margin-bottom:20px;">
        ${group.names.map((nome, i) => {
          const aid = group.athlete_ids[i];
          const isMe = aid === athlete.id;
          const hasWo = official_slot?.wo_athlete_ids?.includes(aid);
          const memberStatus = slotsStatus.find(s => s.athlete_id === aid);
          const dotClass = memberStatus?.has_slots ? 'done' : 'pending';
          return `
            <div class="group-member-row${isMe ? ' is-me' : ''}">
              <span class="slot-status-dot ${dotClass}" title="${memberStatus?.has_slots ? 'Slots marcados' : 'Sem slots'}"></span>
              <span class="group-member-name">${escapeHtml(nome)}</span>
              ${isMe ? '<span class="badge badge-ativo">Eu</span>' : ''}
              ${hasWo ? '<span class="badge badge-inativo">WO</span>' : ''}
            </div>`;
        }).join('')}
      </div>

      <p style="font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;
         color:var(--color-text-muted);margin-bottom:8px;">Sets (Art. 7)</p>
      <div class="card" style="padding:0;overflow:hidden;">
        ${(group.sets_named || []).map(s => `
          <div class="set-row" style="padding:10px 16px;border-bottom:var(--border);">
            <span class="set-label">Set ${s.set}</span>
            <span class="set-team">${s.team_a.map(escapeHtml).join(' + ')}</span>
            <span class="set-vs">vs</span>
            <span class="set-team">${s.team_b.map(escapeHtml).join(' + ')}</span>
          </div>`).join('')}
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Mesa: Resultado (confirmar/contestar)
// ---------------------------------------------------------------------------

function renderMesaResultado(content, ctx) {
  if (!ctx || !ctx.group) {
    content.innerHTML = `<p class="placeholder-text">Você não está em nenhum grupo nesta rodada.</p>`;
    return;
  }

  const { athlete, group, round, pending_result } = ctx;

  // Busca resultado confirmado/contestado do grupo (não só o pendente)
  const fetchResult = async () => {
    try {
      const all = await api(`/api/rounds/${round.id}/results`);
      return all.find(r => r.cat === group.category && r.group_idx === group.group_index) || null;
    } catch (_) { return null; }
  };

  const renderContent = (result) => {
    if (!result) {
      content.innerHTML = `
        <div style="padding:var(--space-md);">
          <h2 style="font-size:18px;font-weight:700;color:var(--color-primary);margin-bottom:16px;">Resultado</h2>
          <div class="empty-state" style="padding:40px 20px;">
            <div class="empty-state-icon">📋</div>
            <p class="empty-state-title">Resultado não lançado</p>
            <p>O admin ainda não lançou o resultado deste grupo.</p>
          </div>
        </div>`;
      return;
    }

    const statusLabel = { pending_confirmation: 'Aguardando confirmação', confirmed: 'Confirmado', contested: 'Contestado' };
    const myConfirmation = result.confirmations?.[athlete.id];
    const canConfirm = result.status === 'pending_confirmation' && !myConfirmation;

    const scoresRows = group.athlete_ids.map((aid, i) => {
      const nome = group.names[i];
      const sc = result.scores?.[aid];
      if (!sc) return '';
      const setsBadges = (sc.sets || []).map((pts, si) => {
        const cls = pts === 3 ? 'win' : pts === 1 ? 'loss' : '';
        return `<span class="result-set-badge ${cls}">${pts}pts</span>`;
      }).join('');
      const isMe = aid === athlete.id;
      return `
        <tr>
          <td><strong>${escapeHtml(nome)}</strong>${isMe ? ' <span class="badge badge-ativo" style="font-size:10px;">Eu</span>' : ''}</td>
          <td><div class="result-set-scores">${setsBadges}</div></td>
          <td class="pts-total">${sc.total ?? 0}</td>
        </tr>`;
    }).join('');

    const confirmStatus = group.athlete_ids.map((aid, i) => {
      const nome = group.names[i];
      const c = result.confirmations?.[aid];
      return `<span style="font-size:12px;margin-right:8px;">${escapeHtml(nome)}: ${c ? (c === 'confirmed' ? '✅' : '❌') : '⏳'}</span>`;
    }).join('');

    content.innerHTML = `
      <div style="padding:var(--space-md);">
        <h2 style="font-size:18px;font-weight:700;color:var(--color-primary);margin-bottom:4px;">Resultado</h2>
        <p style="font-size:13px;color:var(--color-text-muted);margin-bottom:16px;">
          ${catLabel(group.category)} · Grupo ${group.group_index + 1} · Rodada ${round?.round_number ?? '—'}
        </p>

        <div class="result-card">
          <div class="result-card-header">
            ${catLabel(group.category)}
            <span>Grupo ${group.group_index + 1}</span>
            <span class="badge badge-${result.status === 'confirmed' ? 'confirmed' : result.status === 'contested' ? 'contested' : 'pending'}" style="margin-left:auto;">
              ${statusLabel[result.status] || result.status}
            </span>
          </div>
          <table class="result-scores-table">
            <thead><tr><th>Atleta</th><th>Sets</th><th>Total</th></tr></thead>
            <tbody>${scoresRows}</tbody>
          </table>
          <div class="result-footer">
            <div style="flex:1;font-size:12px;color:var(--color-text-muted);">${confirmStatus}</div>
          </div>
        </div>

        ${result.contest_reason ? `
          <div class="alert" style="background:#FBE9E7;border-color:#FFAB91;color:#BF360C;margin-bottom:16px;">
            Contestado: ${escapeHtml(result.contest_reason)}
          </div>` : ''}

        ${canConfirm ? `
          <div class="confirm-result-card">
            <p class="confirm-result-title">Confirmar Resultado</p>
            <p style="font-size:13px;">Confira o placar acima e confirme ou conteste.</p>
            <div class="confirm-result-actions">
              <button id="btn-confirmar" class="btn btn-primary">Confirmar</button>
              <button id="btn-contestar" class="btn btn-ghost" style="color:#D94040;">Contestar</button>
            </div>
          </div>` : myConfirmation ? `
          <div class="alert alert-info">Você já ${myConfirmation === 'confirmed' ? 'confirmou' : 'contestou'} este resultado.</div>` : ''}

        <p id="resultado-msg" class="hidden" style="margin-top:12px;font-size:13px;"></p>
      </div>`;

    if (!canConfirm) return;

    const msgEl = content.querySelector('#resultado-msg');

    content.querySelector('#btn-confirmar').addEventListener('click', async () => {
      try {
        await api(`/api/results/${result.id}/confirm`, { method: 'POST', body: { action: 'confirmed' } });
        msgEl.textContent = '✓ Resultado confirmado!';
        msgEl.style.color = 'var(--color-cat-c)';
        msgEl.classList.remove('hidden');
        setTimeout(() => location.hash = '#mesa/home', 1200);
      } catch (err) {
        msgEl.textContent = `Erro: ${err.message}`;
        msgEl.style.color = '#D94040';
        msgEl.classList.remove('hidden');
      }
    });

    content.querySelector('#btn-contestar').addEventListener('click', () => {
      openModal('Contestar Resultado', `
        <p style="margin-bottom:12px;">Informe o motivo da contestação:</p>
        <textarea id="contest-reason" rows="4" style="width:100%;padding:8px;border:var(--border);border-radius:var(--radius-sm);font-size:14px;resize:vertical;" placeholder="Descreva o problema com o placar..."></textarea>
        <p id="contest-error" class="field-error hidden"></p>`,
        `<button id="btn-contest-confirmar" class="btn btn-primary">Enviar contestação</button>
         <button id="btn-contest-cancelar" class="btn btn-ghost">Cancelar</button>`
      );
      document.getElementById('btn-contest-cancelar').addEventListener('click', closeModal);
      document.getElementById('btn-contest-confirmar').addEventListener('click', async () => {
        const reason = document.getElementById('contest-reason').value.trim();
        if (!reason) {
          document.getElementById('contest-error').textContent = 'Informe o motivo.';
          document.getElementById('contest-error').classList.remove('hidden');
          return;
        }
        try {
          await api(`/api/results/${result.id}/confirm`, { method: 'POST', body: { action: 'contested', reason } });
          closeModal();
          msgEl.textContent = '⚠ Contestação registrada. O admin analisará.';
          msgEl.style.color = '#BA7517';
          msgEl.classList.remove('hidden');
          setTimeout(() => location.hash = '#mesa/home', 1500);
        } catch (err) {
          document.getElementById('contest-error').textContent = err.message;
          document.getElementById('contest-error').classList.remove('hidden');
        }
      });
    });
  };

  content.innerHTML = `<p class="placeholder-text">Carregando resultado…</p>`;
  fetchResult().then(renderContent);
}

// ---------------------------------------------------------------------------
// Admin: Resultados — lançar e gerenciar
// ---------------------------------------------------------------------------

async function renderAdminResultados(content) {
  let rounds = [], athletes = [], seasons = [];
  try { seasons = await api('/api/seasons'); } catch (_) {}
  try { athletes = await api('/api/athletes'); } catch (_) {}

  const athletesById = Object.fromEntries(athletes.map(a => [a.id, a]));
  const activeSeason = seasons.find(s => s.status === 'active') || seasons[seasons.length - 1];

  if (!activeSeason) {
    content.innerHTML = `<div class="section-header"><h1 class="section-title">Resultados</h1></div>
      <div class="alert alert-info">Nenhuma temporada cadastrada.</div>`;
    return;
  }

  try {
    const allRounds = await api('/api/seasons/' + activeSeason.id + '/rounds');
    rounds = allRounds.filter(r => r.status !== 'cancelled');
  } catch (_) {}

  content.innerHTML = `
    <div class="section-header">
      <div>
        <h1 class="section-title">Resultados</h1>
        <p class="section-subtitle">${escapeHtml(activeSeason.name)}</p>
      </div>
    </div>
    <div id="resultados-body">
      <p class="placeholder-text">Carregando…</p>
    </div>`;

  const body = content.querySelector('#resultados-body');

  if (!rounds.length) {
    body.innerHTML = `<div class="alert alert-info">Nenhuma rodada com sorteio realizado.</div>`;
    return;
  }

  // Renderiza painel por rodada
  const renderRounds = async () => {
    let html = '';
    for (const rnd of rounds) {
      let roundResults = [];
      try { roundResults = await api(`/api/rounds/${rnd.id}/results`); } catch (_) {}
      const resultsByGroupKey = Object.fromEntries(
        roundResults.map(r => [`${r.cat}-${r.group_idx}`, r])
      );

      html += `
        <div class="card" style="margin-bottom:20px;">
          <div class="cat-tab-bar" style="padding:var(--space-sm) var(--space-md);border-bottom:var(--border);">
            <strong>Rodada ${rnd.round_number}</strong>
            ${rnd.target_date ? `<span style="color:var(--color-text-muted);font-size:13px;margin-left:8px;">${rnd.target_date}</span>` : ''}
          </div>`;

      for (const [cat, groups] of Object.entries(rnd.groups || {})) {
        for (let gi = 0; gi < groups.length; gi++) {
          const group = groups[gi];
          const key = `${cat}-${gi}`;
          const existing = resultsByGroupKey[key];
          const statusLabel = existing
            ? { pending_confirmation: 'Aguard. confirmação', confirmed: 'Confirmado', contested: 'Contestado' }[existing.status] || existing.status
            : 'Não lançado';
          const statusCls = existing
            ? { pending_confirmation: 'badge-pending', confirmed: 'badge-confirmed', contested: 'badge-contested' }[existing.status] || ''
            : 'badge-inativo';

          html += `
            <div class="group-card" style="margin:var(--space-sm) var(--space-md);border:var(--border);border-radius:var(--radius-md);overflow:hidden;">
              <div class="group-card-header" style="display:flex;align-items:center;gap:8px;padding:8px var(--space-md);background:var(--color-bg);">
                ${catLabel(cat)}
                <span style="font-size:13px;font-weight:600;">Grupo ${gi + 1}</span>
                <span class="badge ${statusCls}" style="margin-left:auto;">${statusLabel}</span>
                ${existing && existing.status === 'contested' ? `<button class="btn btn-sm btn-ghost btn-override" data-rid="${existing.id}" style="font-size:12px;color:#D94040;">Resolver</button>` : ''}
              </div>
              <div style="padding:var(--space-sm) var(--space-md);">
                <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
                  ${group.map(aid => `<span class="athlete-chip">${escapeHtml(athletesById[aid]?.nome || aid)}</span>`).join('')}
                </div>
                ${existing ? renderResultScores(existing, group, athletesById) : ''}
                ${!existing || existing.status === 'contested' ? `
                  <button class="btn btn-primary btn-sm btn-launch-result"
                    data-round="${rnd.id}" data-cat="${cat}" data-gi="${gi}"
                    data-group='${JSON.stringify(group)}'
                    data-sets='${JSON.stringify((rnd.groups_sets?.[cat]?.[gi] || []))}'>
                    ${existing ? 'Editar resultado' : 'Lançar resultado'}
                  </button>` : ''}
                ${existing && existing.status !== 'confirmed' ? `
                  <button class="btn btn-ghost btn-sm btn-wo-result"
                    data-round="${rnd.id}" data-cat="${cat}" data-gi="${gi}"
                    data-group='${JSON.stringify(group)}'
                    style="margin-left:6px;">WO</button>` : ''}
              </div>
            </div>`;
        }
      }
      html += `</div>`;
    }
    body.innerHTML = html;
    attachResultadosListeners(body, athletesById, renderRounds);
  };

  await renderRounds();
}

function renderResultScores(result, group, athletesById) {
  if (!result.scores) return '';
  const rows = group.map(aid => {
    const sc = result.scores[aid];
    if (!sc) return '';
    const nome = athletesById[aid]?.nome || aid;
    const badges = (sc.sets || []).map(pts => {
      const cls = pts === 3 ? 'win' : pts === 1 ? 'loss' : '';
      return `<span class="result-set-badge ${cls}">${pts}</span>`;
    }).join('');
    return `<tr>
      <td style="padding:4px 8px;font-size:13px;">${escapeHtml(nome)}</td>
      <td style="padding:4px 8px;"><div class="result-set-scores">${badges}</div></td>
      <td style="padding:4px 8px;font-weight:700;color:var(--color-primary);">${sc.total ?? 0}pts</td>
    </tr>`;
  }).join('');
  return `<table style="width:100%;margin-bottom:8px;"><tbody>${rows}</tbody></table>`;
}

function attachResultadosListeners(body, athletesById, refresh) {
  // Lançar/editar resultado
  body.querySelectorAll('.btn-launch-result').forEach(btn => {
    btn.addEventListener('click', () => {
      const roundId = btn.dataset.round;
      const cat = btn.dataset.cat;
      const gi = parseInt(btn.dataset.gi);
      const group = JSON.parse(btn.dataset.group);
      const sets = JSON.parse(btn.dataset.sets);
      openScoreForm(roundId, cat, gi, group, sets, athletesById, refresh);
    });
  });

  // WO total
  body.querySelectorAll('.btn-wo-result').forEach(btn => {
    btn.addEventListener('click', () => {
      const roundId = btn.dataset.round;
      const cat = btn.dataset.cat;
      const gi = parseInt(btn.dataset.gi);
      const group = JSON.parse(btn.dataset.group);
      openWoForm(roundId, cat, gi, group, athletesById, refresh);
    });
  });

  // Resolver contestação
  body.querySelectorAll('.btn-override').forEach(btn => {
    btn.addEventListener('click', () => {
      const rid = btn.dataset.rid;
      confirmModal('Confirmar Resultado', 'Confirmar resultado mesmo assim? A contestação será encerrada.', async () => {
        try {
          await api(`/api/results/${rid}/override`, { method: 'PUT', body: { action: 'confirm' } });
          await refresh();
        } catch (err) { showToast('Erro: ' + err.message, 'error'); }
      });
    });
  });
}

function openScoreForm(roundId, cat, gi, group, sets, athletesById, refresh) {
  const setsHtml = [1, 2, 3].map(setNum => {
    const setDef = sets[setNum - 1] || {};
    const teamA = (setDef.team_a || []).map(aid => athletesById[aid]?.nome || aid).join(' + ');
    const teamB = (setDef.team_b || []).map(aid => athletesById[aid]?.nome || aid).join(' + ');
    return `
      <div class="score-set-block">
        <p class="score-set-label">Set ${setNum}</p>
        <p style="font-size:11px;color:var(--color-text-muted);margin-bottom:6px;">${escapeHtml(teamA)} vs ${escapeHtml(teamB)}</p>
        <div class="score-set-inputs">
          <input type="number" id="sa${setNum}" min="0" max="20" value="" placeholder="—" />
          <span style="font-weight:700;">×</span>
          <input type="number" id="sb${setNum}" min="0" max="20" value="" placeholder="—" />
        </div>
        <label class="score-stb-checkbox">
          <input type="checkbox" id="stb${setNum}" />
          Super Tie-Break
        </label>
      </div>`;
  }).join('');

  openModal(
    `Lançar Resultado — Cat ${cat} · Grupo ${gi + 1}`,
    `<div class="score-form">
       <div class="score-sets-grid">${setsHtml}</div>
       <p id="score-error" class="field-error hidden"></p>
     </div>`,
    `<button id="btn-score-salvar" class="btn btn-primary">Salvar</button>
     <button id="btn-score-cancelar" class="btn btn-ghost">Cancelar</button>`
  );

  document.getElementById('btn-score-cancelar').addEventListener('click', closeModal);
  document.getElementById('btn-score-salvar').addEventListener('click', async () => {
    const errEl = document.getElementById('score-error');
    errEl.classList.add('hidden');

    const setsPayload = sets.map((setDef, idx) => {
      const n = idx + 1;
      const sa = parseInt(document.getElementById(`sa${n}`)?.value);
      const sb = parseInt(document.getElementById(`sb${n}`)?.value);
      const stb = document.getElementById(`stb${n}`)?.checked || false;
      return {
        set: n,
        team_a: setDef.team_a || [],
        team_b: setDef.team_b || [],
        score_a: isNaN(sa) ? null : sa,
        score_b: isNaN(sb) ? null : sb,
        is_super_tiebreak: stb,
      };
    });

    try {
      await api(`/api/rounds/${roundId}/results`, {
        method: 'POST',
        body: { cat, group_idx: gi, sets: setsPayload },
      });
      closeModal();
      await refresh();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
  });
}

function openWoForm(roundId, cat, gi, group, athletesById, refresh) {
  const options = group.map(aid =>
    `<option value="${aid}">${escapeHtml(athletesById[aid]?.nome || aid)}</option>`
  ).join('');

  openModal(
    `WO Total — Cat ${cat} · Grupo ${gi + 1}`,
    `<p style="margin-bottom:12px;">Selecione o atleta ausente:</p>
     <select id="wo-absent" class="field-input">${options}</select>
     <p style="font-size:12px;color:var(--color-text-muted);margin-top:8px;">Art. 10.1: atleta ausente recebe 0pts; demais recebem 9pts (3×3).</p>
     <p id="wo-error" class="field-error hidden"></p>`,
    `<button id="btn-wo-confirmar" class="btn btn-primary">Aplicar WO</button>
     <button id="btn-wo-cancelar" class="btn btn-ghost">Cancelar</button>`
  );

  document.getElementById('btn-wo-cancelar').addEventListener('click', closeModal);
  document.getElementById('btn-wo-confirmar').addEventListener('click', async () => {
    const absentId = document.getElementById('wo-absent').value;
    const errEl = document.getElementById('wo-error');
    try {
      await api(`/api/rounds/${roundId}/results/wo`, {
        method: 'POST',
        body: { cat, group_idx: gi, absent_athlete_id: absentId },
      });
      closeModal();
      await refresh();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
  });
}

// ---------------------------------------------------------------------------
// Admin: Fechamento de Temporada (Sprint 7)
// ---------------------------------------------------------------------------

async function renderAdminFechamento(content) {
  content.innerHTML = `<p class="placeholder-text">Carregando…</p>`;

  let seasons = [];
  try { seasons = await api('/api/seasons'); } catch (_) {}

  const activeSeason = seasons.find(s => s.status === 'active') || seasons.find(s => s.status === 'pending');
  const closedSeasons = seasons.filter(s => s.status === 'closed');

  if (!activeSeason) {
    content.innerHTML = `
      <div class="section-header"><h1 class="section-title">Fechamento de Temporada</h1></div>
      <div class="alert alert-info">Nenhuma temporada ativa.</div>`;
    return;
  }

  let preview = null;
  try { preview = await api(`/api/seasons/${activeSeason.id}/fechamento/preview`); } catch (_) {}

  const actionLabel = { promoted: 'Promoção ↑', relegated: 'Rebaixamento ↓', stays: 'Permanece' };
  const actionBadge = { promoted: 'badge-promoted', relegated: 'badge-relegated', stays: 'badge-stays' };

  const buildMovementTable = (summary) => {
    if (!summary || !summary.length) return `<p class="placeholder-text">Nenhum resultado registrado ainda.</p>`;
    const byCat = {};
    for (const entry of summary) {
      byCat[entry.from] = byCat[entry.from] || [];
      byCat[entry.from].push(entry);
    }
    return Object.entries(byCat).map(([cat, rows]) => `
      <div style="margin-bottom:16px;">
        <p style="font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;
           color:var(--color-text-muted);margin-bottom:8px;">Cat ${cat}</p>
        <div class="card" style="padding:0;overflow:hidden;">
          <table class="movement-table">
            <thead><tr><th>Atleta</th><th>Ação</th><th>Destino</th></tr></thead>
            <tbody>
              ${rows.map(r => `
                <tr>
                  <td><strong>${escapeHtml(r.nome)}</strong></td>
                  <td><span class="badge ${actionBadge[r.action]}">${actionLabel[r.action]}</span></td>
                  <td>${r.action !== 'stays'
                    ? `<span class="movement-arrow">${catLabel(r.from)} → ${catLabel(r.to)}</span>`
                    : catLabel(r.to)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`).join('');
  };

  const warnings = preview?.movements?.warnings || [];
  const projectedSizes = preview?.movements?.projected_sizes || {};

  const rankingsHtml = Object.entries(preview?.rankings || {})
    .filter(([,rows]) => rows.length)
    .map(([cat, rows]) => `
      <div style="margin-bottom:12px;">
        <p style="font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;
           color:var(--color-text-muted);margin-bottom:6px;">Cat ${cat}</p>
        <div class="card" style="padding:0;overflow:hidden;">
          <table class="ranking-table">
            <thead><tr><th>#</th><th>Atleta</th><th class="num">Pts</th><th class="num">W</th></tr></thead>
            <tbody>
              ${rows.map((r, i) => `
                <tr>
                  <td><span class="rank-position ${['gold','silver','bronze'][i]||''}">${r.rank}</span></td>
                  <td>${escapeHtml(r.nome)}</td>
                  <td class="num ranking-pts">${r.points}</td>
                  <td class="num ranking-stat">${r.wins}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`).join('');

  const isClosed = activeSeason.status === 'closed';
  const movedCount = (preview?.summary || []).filter(e => e.action !== 'stays').length;

  content.innerHTML = `
    <div class="section-header">
      <div>
        <h1 class="section-title">Fechamento de Temporada</h1>
        <p class="section-subtitle">${escapeHtml(activeSeason.name)}</p>
      </div>
    </div>

    ${warnings.map(w => `<div class="fechamento-warning">⚠ ${escapeHtml(w)}</div>`).join('')}

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px;">
      <div>
        <p style="font-size:14px;font-weight:700;margin-bottom:12px;">Ranking Final</p>
        ${rankingsHtml || '<p class="placeholder-text">Sem resultados ainda.</p>'}
      </div>
      <div>
        <p style="font-size:14px;font-weight:700;margin-bottom:12px;">Plano de Movimentação</p>
        ${buildMovementTable(preview?.summary)}
        ${Object.entries(projectedSizes).filter(([,n]) => n > 0).length ? `
          <div class="card" style="margin-top:12px;">
            <p style="font-size:12px;font-weight:700;color:var(--color-text-muted);margin-bottom:8px;">Tamanhos Projetados</p>
            ${Object.entries(projectedSizes).filter(([,n]) => n > 0).map(([cat, n]) => `
              <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:var(--border);font-size:13px;">
                <span>${catLabel(cat)}</span><strong>${n} titular${n !== 1 ? 'es' : ''}</strong>
              </div>`).join('')}
          </div>` : ''}
      </div>
    </div>

    ${!isClosed ? `
      <div class="fechamento-confirm-box">
        <p style="font-size:15px;font-weight:700;color:var(--color-accent);margin-bottom:8px;">Confirmar Fechamento</p>
        <p style="font-size:13px;margin-bottom:12px;">
          Esta ação é irreversível. Os atletas serão movimentados e a temporada será encerrada.
        </p>
        ${warnings.length ? `<p style="font-size:12px;color:#BA7517;margin-bottom:12px;">⚠ ${warnings.length} aviso(s) — revise antes de confirmar.</p>` : ''}
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
          <button id="btn-fechar-temporada" class="btn btn-primary">Fechar Temporada</button>
          <span style="font-size:12px;color:var(--color-text-muted);">Movimenta ${movedCount} atleta(s)</span>
        </div>
        <p id="fechamento-msg" class="hidden" style="margin-top:12px;font-size:13px;"></p>
      </div>` : `
      <div class="alert alert-info">Temporada encerrada em ${activeSeason.closed_at || '—'}.</div>`}

    ${closedSeasons.length ? `
      <div style="margin-top:24px;">
        <p style="font-size:13px;font-weight:700;color:var(--color-text-muted);margin-bottom:8px;">Temporadas Encerradas</p>
        ${closedSeasons.map(s => `
          <div class="card" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <span>${escapeHtml(s.name)}</span>
            <span class="badge badge-inativo">Encerrada</span>
          </div>`).join('')}
      </div>` : ''}`;

  content.querySelector('#btn-fechar-temporada')?.addEventListener('click', () => {
    confirmModal(
      'Fechar Temporada',
      `Confirma o fechamento de "${activeSeason.name}"? Esta ação promove/rebaixa atletas e não pode ser desfeita.`,
      async () => {
        const msgEl = content.querySelector('#fechamento-msg');
        const btn = content.querySelector('#btn-fechar-temporada');
        btn.disabled = true;
        btn.textContent = 'Fechando…';
        try {
          const result = await api(`/api/seasons/${activeSeason.id}/fechamento/apply`, { method: 'POST' });
          msgEl.textContent = `✓ Temporada encerrada! ${result.movements_applied} atleta(s) movimentado(s).`;
          msgEl.style.color = 'var(--color-cat-c)';
          msgEl.classList.remove('hidden');
          setTimeout(() => renderAdminFechamento(content), 1800);
        } catch (err) {
          msgEl.textContent = `Erro: ${err.message}`;
          msgEl.style.color = '#D94040';
          msgEl.classList.remove('hidden');
          btn.disabled = false;
          btn.textContent = 'Fechar Temporada';
        }
      },
      'Fechar Temporada'
    );
  });
}


// ---------------------------------------------------------------------------
// Sprint 8: Admin — Anual (Art. 21/22/23)
// ---------------------------------------------------------------------------

async function renderAdminAnual(content) {
  content.innerHTML = `<p class="placeholder-text">Carregando dados anuais…</p>`;

  const year = new Date().getFullYear();
  let titles, athletes, seasons;
  try {
    [titles, athletes, seasons] = await Promise.all([
      api(`/api/annual/${year}/titles`),
      api('/api/athletes'),
      api('/api/seasons'),
    ]);
  } catch (err) {
    content.innerHTML = `<p class="placeholder-text" style="color:#D94040">Erro: ${escapeHtml(err.message)}</p>`;
    return;
  }

  const rei   = titles.super_rei;
  const pato  = titles.super_pato;
  const patos = titles.pato_por_categoria || {};
  const ranking = titles.ranking_anual || [];

  // Verifica se já foi gravado na galeria
  let galeria = [];
  try { galeria = (await api('/api/titles')).titles || []; } catch (_) {}
  const jaGravado = galeria.some(t => t.year === year);

  const trophyCard = (label, entry, variant) => {
    if (!entry) return `
      <div class="title-trophy-card" style="opacity:.45;">
        <div class="trophy-icon">—</div>
        <div class="trophy-title">${label}</div>
        <div class="trophy-name">Nenhum elegível</div>
      </div>`;
    return `
      <div class="title-trophy-card ${variant}">
        <div class="trophy-icon">${variant === 'rei' ? '👑' : '🦆'}</div>
        <div class="trophy-title">${label} ${year}</div>
        <div class="trophy-name">${escapeHtml(entry.nome)}</div>
        <div class="ws-score">${catLabel(entry.category)} · ws ${entry.weighted_score.toFixed(2)}</div>
      </div>`;
  };

  const patosCatHtml = ['A','B','C','D'].map(cat => {
    const e = patos[cat];
    if (!e) return `
      <div class="galeria-title-item" style="opacity:.45;">
        ${catLabel(cat)}<br><span style="font-size:12px;color:var(--color-text-muted);">—</span>
      </div>`;
    return `
      <div class="galeria-title-item">
        <div style="margin-bottom:4px;">🦆 ${catLabel(cat)}</div>
        <strong>${escapeHtml(e.nome)}</strong>
        <div style="font-size:11px;color:var(--color-text-muted);">ws ${e.weighted_score.toFixed(2)}</div>
      </div>`;
  }).join('');

  const rankingHtml = ranking.length ? `
    <div class="card" style="padding:0;overflow:hidden;margin-top:16px;">
      <table class="annual-ranking-table">
        <thead>
          <tr>
            <th>#</th><th>Atleta</th><th>Cat Final</th>
            <th class="num">Temporadas</th><th class="num">WS</th>
          </tr>
        </thead>
        <tbody>
          ${ranking.map(e => `
            <tr>
              <td><span class="rank-position ${['gold','silver','bronze'][e.rank-1]||''}">${e.rank}</span></td>
              <td>${escapeHtml(e.nome)}</td>
              <td>${catLabel(e.category)}</td>
              <td class="num">${e.seasons_count}</td>
              <td class="num ws-score">${e.weighted_score.toFixed(2)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>` : `<p class="placeholder-text" style="margin-top:16px;">Nenhum atleta elegível em ${year}.</p>`;

  content.innerHTML = `
    <div class="section-header">
      <div>
        <h1 class="section-title">Títulos Anuais</h1>
        <p class="section-subtitle">Temporada ${year} · ${titles.eligible_count} atleta(s) elegível(is)</p>
      </div>
    </div>

    <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:24px;">
      ${trophyCard('Super Rei', rei, 'rei')}
      ${trophyCard('Super Pato', pato, 'pato')}
    </div>

    <div class="card" style="margin-bottom:24px;">
      <p style="font-size:13px;font-weight:700;color:var(--color-text-muted);
         text-transform:uppercase;letter-spacing:.05em;margin-bottom:12px;">Pato por Categoria</p>
      <div class="galeria-titles-grid">${patosCatHtml}</div>
    </div>

    <div style="display:flex;align-items:center;gap:16px;margin-bottom:8px;">
      <p style="font-size:13px;font-weight:700;margin:0;">Ranking Anual ${year}</p>
    </div>
    ${rankingHtml}

    <div style="margin-top:24px;">
      ${jaGravado
        ? `<div class="alert alert-info">Títulos de ${year} já registrados na galeria.</div>`
        : (ranking.length
          ? `<div class="fechamento-confirm-box">
               <p style="font-size:15px;font-weight:700;color:var(--color-accent);margin-bottom:8px;">Registrar Títulos ${year}</p>
               <p style="font-size:13px;margin-bottom:12px;">
                 Grava Super Rei, Super Pato e Patos por categoria na galeria histórica. Esta ação é definitiva.
               </p>
               <button id="btn-apply-titles" class="btn btn-primary">Registrar na Galeria</button>
               <p id="apply-titles-msg" class="hidden" style="margin-top:10px;font-size:13px;"></p>
             </div>`
          : '')}
    </div>`;

  content.querySelector('#btn-apply-titles')?.addEventListener('click', () => {
    confirmModal(
      'Registrar Títulos',
      `Registrar títulos de ${year} na galeria? Esta ação grava Super Rei, Super Pato e Patos por categoria de forma definitiva.`,
      async () => {
        const btn = content.querySelector('#btn-apply-titles');
        const msg = content.querySelector('#apply-titles-msg');
        btn.disabled = true;
        btn.textContent = 'Registrando…';
        try {
          await api(`/api/annual/${year}/titles/apply`, { method: 'POST' });
          msg.textContent = `✓ Títulos de ${year} registrados com sucesso!`;
          msg.style.color = 'var(--color-cat-c)';
          msg.classList.remove('hidden');
          setTimeout(() => renderAdminAnual(content), 1800);
        } catch (err) {
          msg.textContent = `Erro: ${err.message}`;
          msg.style.color = '#D94040';
          msg.classList.remove('hidden');
          btn.disabled = false;
          btn.textContent = 'Registrar na Galeria';
        }
      },
      'Registrar na Galeria'
    );
  });
}


// ---------------------------------------------------------------------------
// Sprint 8: Público — Galeria de Títulos (Art. 21/22/23)
// ---------------------------------------------------------------------------

async function renderPublicoTitulos(container) {
  container.innerHTML = `<p class="placeholder-text">Carregando galeria…</p>`;

  let data;
  try {
    data = await api('/api/titles');
  } catch (err) {
    container.innerHTML = `<p class="placeholder-text" style="color:#D94040">Erro: ${escapeHtml(err.message)}</p>`;
    return;
  }

  const titles = (data.titles || []).slice().sort((a, b) => b.year - a.year);

  if (!titles.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🏆</div>
        <p class="empty-state-title">Nenhum título registrado ainda</p>
        <p>Os títulos anuais aparecerão aqui após o fechamento de cada ano.</p>
      </div>`;
    return;
  }

  const entryHtml = (label, icon, entry) => {
    if (!entry) return `
      <div class="galeria-title-item" style="opacity:.5;">
        <div>${icon} ${label}</div>
        <span style="font-size:12px;color:var(--color-text-muted);">—</span>
      </div>`;
    return `
      <div class="galeria-title-item">
        <div>${icon} ${label}</div>
        <strong>${escapeHtml(entry.nome)}</strong>
        <div style="font-size:11px;color:var(--color-text-muted);">${catLabel(entry.category)} · ws ${(entry.weighted_score||0).toFixed(2)}</div>
      </div>`;
  };

  container.innerHTML = titles.map(t => {
    const patos = t.pato_por_categoria || {};
    return `
      <div class="galeria-card">
        <div class="galeria-year-header">${t.year}</div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px;justify-content:center;">
          <div class="title-trophy-card rei" style="flex:1;min-width:160px;">
            <div class="trophy-icon">👑</div>
            <div class="trophy-title">Super Rei</div>
            <div class="trophy-name">${t.super_rei ? escapeHtml(t.super_rei.nome) : '—'}</div>
            ${t.super_rei ? `<div class="ws-score">ws ${(t.super_rei.weighted_score||0).toFixed(2)}</div>` : ''}
          </div>
          <div class="title-trophy-card pato" style="flex:1;min-width:160px;">
            <div class="trophy-icon">🦆</div>
            <div class="trophy-title">Super Pato</div>
            <div class="trophy-name">${t.super_pato ? escapeHtml(t.super_pato.nome) : '—'}</div>
            ${t.super_pato ? `<div class="ws-score">ws ${(t.super_pato.weighted_score||0).toFixed(2)}</div>` : ''}
          </div>
        </div>
        <div class="galeria-titles-grid">
          ${['A','B','C','D'].map(cat => entryHtml(`Cat ${cat}`, '🦆', patos[cat])).join('')}
        </div>
      </div>`;
  }).join('');
}


// ---------------------------------------------------------------------------
// Sprint 11: Público — Histórico de Resultados por Rodada
// ---------------------------------------------------------------------------

function _setClass(pts) {
  if (pts === 3) return 'win';
  if (pts === 0) return 'wo';
  return 'loss';
}

function _buildGroupHtml(group) {
  if (!group.has_result) {
    return `<p style="font-size:12px;color:var(--color-text-muted);padding:6px 0;">Sem resultado registrado.</p>`;
  }
  return group.athletes.map((a, i) => `
    <div class="history-score-row">
      <span class="history-score-rank">${i + 1}</span>
      <span class="history-score-name">${escapeHtml(a.nome)}</span>
      <span class="history-score-sets">
        ${(a.sets || []).map(s => `<span class="history-score-set ${_setClass(s)}">${s}</span>`).join('')}
      </span>
      <span class="history-score-total">${a.total ?? '—'}</span>
    </div>`).join('');
}

async function renderPublicoResultados(container, season) {
  if (!season) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📋</div>
        <p class="empty-state-title">Nenhuma temporada disponível</p>
      </div>`;
    return;
  }

  container.innerHTML = `<p class="placeholder-text">Carregando histórico…</p>`;

  let data;
  try { data = await api(`/api/seasons/${season.id}/history`); }
  catch (err) {
    container.innerHTML = `<p class="placeholder-text" style="color:#D94040">Erro: ${escapeHtml(err.message)}</p>`;
    return;
  }

  const rounds = data.rounds || [];
  if (!rounds.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📋</div>
        <p class="empty-state-title">Nenhuma rodada criada</p>
      </div>`;
    return;
  }

  const html = rounds.map(rnd => {
    const groupsWithResults = rnd.groups.filter(g => g.has_result);
    const totalGroups = rnd.groups.length;
    const meta = groupsWithResults.length
      ? `${groupsWithResults.length}/${totalGroups} grupo(s) com resultado`
      : 'Sem resultados';

    const groupsHtml = rnd.groups
      .filter(g => g.athletes.length > 0)
      .map(g => `
        <div class="history-group-block">
          <div class="history-group-label">${catLabel(g.cat)} · Grupo ${g.group_idx + 1}</div>
          ${_buildGroupHtml(g)}
        </div>`).join('');

    return `
      <div class="history-round-card">
        <div class="history-round-header" data-round="${rnd.round_id}">
          <span class="history-round-title">Rodada ${rnd.round_number}</span>
          <span class="history-round-meta">${rnd.target_date ? rnd.target_date.slice(0, 10) : ''}</span>
          <span class="history-round-meta">${meta}</span>
          <span class="history-round-meta" style="font-size:16px;">›</span>
        </div>
        <div class="history-round-body" id="body-${rnd.round_id}">
          ${groupsHtml || '<p style="font-size:13px;color:var(--color-text-muted);">Sem grupos.</p>'}
        </div>
      </div>`;
  }).join('');

  container.innerHTML = `
    <div style="padding:0 var(--space-md);">
      <p style="font-size:13px;color:var(--color-text-muted);margin-bottom:12px;">
        ${escapeHtml(season.name)} · ${rounds.length} rodada(s)
      </p>
      ${html}
    </div>`;

  // Toggle accordion
  container.querySelectorAll('.history-round-header').forEach(hdr => {
    hdr.addEventListener('click', () => {
      const body = document.getElementById(`body-${hdr.dataset.round}`);
      body.classList.toggle('open');
    });
  });

  // Auto-open last round that has results
  const lastWithResult = [...rounds].reverse().find(r => r.groups.some(g => g.has_result));
  if (lastWithResult) {
    document.getElementById(`body-${lastWithResult.round_id}`)?.classList.add('open');
  }
}


// ---------------------------------------------------------------------------
// Sprint 11: Mesa — Histórico Pessoal
// ---------------------------------------------------------------------------

async function renderMesaHistorico(content) {
  content.innerHTML = `<p class="placeholder-text" aria-live="polite">Carregando histórico…</p>`;

  let data;
  try { data = await api('/api/mesa/history'); }
  catch (err) {
    content.innerHTML = `<p class="placeholder-text" style="color:#D94040">Erro: ${escapeHtml(err.message)}</p>`;
    return;
  }

  const history = data.history || [];

  if (!history.length) {
    content.innerHTML = `
      <div class="empty-state" style="padding:40px 20px;">
        <div class="empty-state-icon">📋</div>
        <p class="empty-state-title">Nenhuma partida jogada</p>
        <p>Suas partidas aparecerão aqui após os resultados serem confirmados.</p>
      </div>`;
    return;
  }

  // Summary stats
  const totalPts = history.reduce((s, h) => s + (h.my_total ?? 0), 0);
  const totalWins = history.reduce((s, h) => s + (h.my_sets || []).filter(x => x === 3).length, 0);
  const firsts = history.filter(h => h.rank_in_group === 1).length;

  const rankBadge = rank => {
    const cls = rank <= 3 ? `rank-${rank}` : '';
    const label = rank === 1 ? '1º 🥇' : rank === 2 ? '2º 🥈' : rank === 3 ? '3º 🥉' : `${rank}º`;
    return `<span class="match-rank-badge ${cls}">${label}</span>`;
  };

  const cards = history.map(h => {
    const setsPips = (h.my_sets || []).map(s => `
      <span class="match-set-pip ${s === 3 ? 'win' : 'loss'}">${s}</span>`).join('');
    const opponents = h.group_members.map(m => escapeHtml(m.nome)).join(', ');

    return `
      <div class="match-card">
        <div class="match-card-header">
          <span class="match-round-label">${catLabel(h.cat)} · Rodada ${h.round_number ?? '—'}</span>
          ${rankBadge(h.rank_in_group)}
        </div>
        <div class="match-sets-row">${setsPips}</div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:4px;">
          <span class="match-opponents">${opponents}</span>
          <span style="font-size:13px;font-weight:700;color:var(--color-primary);">${h.my_total ?? 0}pts</span>
        </div>
        ${h.result_status === 'pending' ? `<p style="font-size:11px;color:#BA7517;margin-top:4px;">⏳ Aguardando confirmação</p>` : ''}
      </div>`;
  }).join('');

  content.innerHTML = `
    <div style="padding:16px;">
      <div class="profile-stats-grid" style="margin-bottom:20px;">
        <div class="profile-stat-card">
          <div class="profile-stat-value">${history.length}</div>
          <div class="profile-stat-label">Rodadas</div>
        </div>
        <div class="profile-stat-card">
          <div class="profile-stat-value">${totalPts}</div>
          <div class="profile-stat-label">Pts Totais</div>
        </div>
        <div class="profile-stat-card">
          <div class="profile-stat-value">${firsts}</div>
          <div class="profile-stat-label">1º Lugares</div>
        </div>
      </div>
      ${cards}
    </div>`;
}


// ---------------------------------------------------------------------------
// Sprint 10: Público — Perfil de Atleta
// ---------------------------------------------------------------------------

async function renderPublicoAtleta(container, athleteId) {
  container.innerHTML = `<p class="placeholder-text">Carregando perfil…</p>`;

  let profile;
  try {
    profile = await api(`/api/athletes/${athleteId}/public`);
  } catch (err) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🎾</div>
        <p class="empty-state-title">Atleta não encontrado</p>
        <p><a href="#publico/ranking" style="color:var(--color-accent);">← Voltar ao ranking</a></p>
      </div>`;
    return;
  }

  const stats = profile.stats || {};
  const initial = (profile.nome || '?').charAt(0).toUpperCase();
  const history = profile.category_history || [];
  const summaries = profile.season_summaries || [];

  const historyHtml = history.length
    ? history.map(h => {
        if (h.cat && !h.from) {
          return `
            <div class="public-stat-row">
              <span style="color:var(--color-text-muted);">${(h.since || '').slice(0,10) || 'Início'}</span>
              <span>Categoria inicial: ${catLabel(h.cat)}</span>
            </div>`;
        }
        return `
          <div class="public-stat-row">
            <span style="color:var(--color-text-muted);">${(h.moved_at || '').slice(0,10)}</span>
            <span>${catLabel(h.from)} → ${catLabel(h.to)}</span>
          </div>`;
      }).join('')
    : `<p style="padding:10px 0;font-size:13px;color:var(--color-text-muted);">Nenhuma movimentação registrada.</p>`;

  const summaryHtml = summaries.map(s => `
    <div class="public-stat-row">
      <span>${escapeHtml(s.season_name)}</span>
      <span class="public-stat-val">${s.total_points}pts · ${s.set_wins}W · ${s.rounds_played} rod.</span>
    </div>`).join('') || `<p style="padding:10px 0;font-size:13px;color:var(--color-text-muted);">Sem rodadas ainda.</p>`;

  container.innerHTML = `
    <p style="margin-bottom:12px;">
      <a href="#publico/ranking" style="font-size:13px;color:var(--color-accent);">← Ranking</a>
    </p>
    <div class="public-profile-card">
      <div class="public-profile-header">
        <div class="public-profile-avatar" aria-hidden="true">${initial}</div>
        <div>
          <div class="public-profile-name">${escapeHtml(profile.nome)}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            ${catLabel(profile.current_category)}
            <span class="badge ${profile.status === 'ativo' ? 'badge-ativo' : 'badge-inativo'}">${profile.status}</span>
          </div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:20px;">
        ${[
          ['Rodadas', stats.total_rounds ?? 0],
          ['Pontos',  stats.total_points ?? 0],
          ['Sets W',  stats.total_set_wins ?? 0],
        ].map(([lbl, val]) => `
          <div style="text-align:center;background:var(--color-bg);border-radius:var(--radius-md);padding:12px 6px;">
            <div style="font-size:22px;font-weight:700;color:var(--color-primary);">${val}</div>
            <div style="font-size:11px;color:var(--color-text-muted);margin-top:2px;">${lbl}</div>
          </div>`).join('')}
      </div>

      <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;
         color:var(--color-text-muted);margin-bottom:8px;">Temporadas</p>
      ${summaryHtml}

      ${history.length ? `
        <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;
           color:var(--color-text-muted);margin:16px 0 8px;">Histórico de Categoria</p>
        ${historyHtml}` : ''}
    </div>`;
}


// ---------------------------------------------------------------------------
// Sprint 9: Mesa — Perfil do Atleta
// ---------------------------------------------------------------------------

async function renderMesaPerfil(content) {
  content.innerHTML = `<p class="placeholder-text" aria-live="polite">Carregando perfil…</p>`;

  let profile;
  try {
    profile = await api('/api/mesa/profile');
  } catch (err) {
    content.innerHTML = `<p class="placeholder-text" style="color:#D94040">Erro ao carregar perfil: ${escapeHtml(err.message)}</p>`;
    return;
  }

  const stats = profile.stats || {};
  const history = profile.category_history || [];
  const summaries = profile.season_summaries || [];
  const initial = (profile.nome || '?').charAt(0).toUpperCase();

  const historyHtml = history.length
    ? history.map(h => {
        if (h.cat && !h.from) {
          return `
            <div class="history-item">
              <span style="color:var(--color-text-muted);">${(h.since || '').slice(0,10) || 'Início'}</span>
              <span>Categoria inicial: ${catLabel(h.cat)}</span>
            </div>`;
        }
        return `
          <div class="history-item">
            <span style="color:var(--color-text-muted);">${(h.moved_at || '').slice(0,10)}</span>
            <span class="history-arrow">${catLabel(h.from)} → ${catLabel(h.to)}</span>
          </div>`;
      }).join('')
    : `<p style="padding:10px 12px;font-size:13px;color:var(--color-text-muted);">Nenhuma movimentação registrada.</p>`;

  const summariesHtml = summaries.length
    ? summaries.map(s => `
        <div class="season-row">
          <span>${escapeHtml(s.season_name)} <span style="font-size:11px;color:var(--color-text-muted);">(${s.status})</span></span>
          <span class="season-pts">${s.total_points}pts · ${s.set_wins}W · ${s.rounds_played} rod.</span>
        </div>`).join('')
    : `<p style="padding:10px 12px;font-size:13px;color:var(--color-text-muted);">Sem rodadas jogadas ainda.</p>`;

  content.innerHTML = `
    <div style="padding:16px;">
      <div class="profile-header">
        <div class="profile-avatar" aria-hidden="true">${initial}</div>
        <div>
          <div class="profile-name">${escapeHtml(profile.nome)}</div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            ${catLabel(profile.current_category)}
            <span class="badge ${profile.status === 'ativo' ? 'badge-ativo' : 'badge-inativo'}">${profile.status}</span>
          </div>
        </div>
      </div>

      <div class="profile-stats-grid">
        <div class="profile-stat-card">
          <div class="profile-stat-value">${stats.total_rounds}</div>
          <div class="profile-stat-label">Rodadas</div>
        </div>
        <div class="profile-stat-card">
          <div class="profile-stat-value">${stats.total_points}</div>
          <div class="profile-stat-label">Pontos Totais</div>
        </div>
        <div class="profile-stat-card">
          <div class="profile-stat-value">${stats.total_set_wins}</div>
          <div class="profile-stat-label">Sets Ganhos</div>
        </div>
      </div>

      <p class="profile-section-title">Temporadas Jogadas</p>
      <div class="card" style="padding:0;overflow:hidden;">
        ${summariesHtml}
      </div>

      <p class="profile-section-title">Histórico de Movimentações</p>
      <div class="card" style="padding:0;overflow:hidden;">
        ${historyHtml}
      </div>

      <p class="profile-section-title">Alterar PIN</p>
      <div class="card">
        <form id="form-pin" class="pin-form">
          <div>
            <label class="field-label" for="pin-current">PIN atual</label>
            <input id="pin-current" type="password" name="current_pin" class="field-input"
              placeholder="PIN atual" maxlength="4" inputmode="numeric" autocomplete="current-password" required />
          </div>
          <div>
            <label class="field-label" for="pin-new">Novo PIN (4 dígitos)</label>
            <input id="pin-new" type="password" name="new_pin" class="field-input"
              placeholder="Novo PIN" maxlength="4" inputmode="numeric" autocomplete="new-password" required />
          </div>
          <button type="submit" class="btn btn-primary">Salvar novo PIN</button>
          <p id="pin-msg" class="hidden" role="alert" style="font-size:13px;margin-top:4px;"></p>
        </form>
      </div>
    </div>`;

  content.querySelector('#form-pin').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const msgEl = content.querySelector('#pin-msg');
    msgEl.classList.add('hidden');
    try {
      await api('/api/mesa/profile/pin', {
        method: 'PUT',
        body: { current_pin: fd.get('current_pin'), new_pin: fd.get('new_pin') },
      });
      e.target.reset();
      showToast('PIN alterado com sucesso!', 'success');
    } catch (err) {
      msgEl.textContent = err.message;
      msgEl.style.color = '#D94040';
      msgEl.classList.remove('hidden');
    }
  });
}


// ---------------------------------------------------------------------------
// Sprint 12: Admin — Relatório de Temporada
// ---------------------------------------------------------------------------

async function renderAdminRelatorio(content) {
  renderSkeletonCards(content, 6);

  let seasons = [];
  try { seasons = await api('/api/seasons'); } catch (_) {}
  const activeSeason = seasons.find(s => s.status === 'active') || seasons[0];

  if (!activeSeason) {
    renderErrorState(content, 'Nenhuma temporada disponível para gerar relatório.');
    return;
  }

  let report;
  try {
    report = await api(`/api/seasons/${activeSeason.id}/report`);
  } catch (err) {
    renderErrorState(content, err.message, () => renderAdminRelatorio(content));
    return;
  }

  const kpis = [
    { label: 'Rodadas',        value: report.total_rounds },
    { label: 'Com resultado',  value: report.rounds_with_results },
    { label: 'Resultados',     value: report.total_confirmed_results },
    { label: 'Participaram',   value: `${report.athletes_who_played}/${report.total_titulares}` },
    { label: 'Participação',   value: `${report.participation_rate}%` },
    { label: 'Média de pts',   value: report.avg_points_per_athlete },
  ];

  const topCatHtml = ['A', 'B', 'C', 'D'].map(cat => {
    const e = report.top_per_cat[cat];
    if (!e) return '';
    return `
      <div class="report-top-card">
        <div class="report-top-icon">${catLabel(cat)}</div>
        <div>
          <div class="report-top-name">${escapeHtml(e.nome)}</div>
          <div class="report-top-sub">${e.total_points}pts · ${e.rounds} rod. · ${e.set_wins} sets W</div>
        </div>
      </div>`;
  }).join('');

  const mostActive = report.most_active;

  const tableRows = (report.athlete_stats || []).map((e, i) => `
    <tr>
      <td>${i + 1}</td>
      <td style="font-weight:500;"><a href="#publico/atleta/${e.athlete_id}" style="color:inherit;">${escapeHtml(e.nome)}</a></td>
      <td>${catLabel(e.category)}</td>
      <td class="num">${e.rounds}</td>
      <td class="num" style="font-weight:700;color:var(--color-primary);">${e.total_points}</td>
      <td class="num">${e.set_wins}</td>
    </tr>`).join('');

  content.innerHTML = `
    <div class="section-header">
      <div>
        <h1 class="section-title">Relatório de Temporada</h1>
        <p class="section-subtitle">${escapeHtml(activeSeason.name)}</p>
      </div>
    </div>

    <div class="report-kpi-grid">
      ${kpis.map(k => `
        <div class="report-kpi">
          <div class="report-kpi-value">${escapeHtml(String(k.value))}</div>
          <div class="report-kpi-label">${k.label}</div>
        </div>`).join('')}
    </div>

    ${mostActive ? `
      <p class="report-section-title">Atleta mais ativo</p>
      <div class="report-top-card">
        <div class="report-top-icon">⚡</div>
        <div>
          <div class="report-top-name">${escapeHtml(mostActive.nome)}</div>
          <div class="report-top-sub">${mostActive.rounds} rodada(s) · ${mostActive.total_points}pts</div>
        </div>
      </div>` : ''}

    ${topCatHtml ? `<p class="report-section-title">Melhor por Categoria</p>${topCatHtml}` : ''}

    <p class="report-section-title">Resultados por Rodada</p>
    <div class="bar-chart-wrap">
      ${svgBarChart(report.results_per_round)}
      <p style="font-size:11px;color:var(--color-text-muted);margin-top:8px;">Resultados confirmados por número de rodada</p>
    </div>

    <p class="report-section-title">Participação Geral</p>
    <div class="card" style="padding:0;overflow:hidden;">
      <div class="table-scroll">
        <table class="participation-table">
          <thead>
            <tr><th>#</th><th>Atleta</th><th>Cat</th><th class="num">Rod.</th><th class="num">Pts</th><th class="num">Sets W</th></tr>
          </thead>
          <tbody>${tableRows || '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--color-text-muted);">Sem dados.</td></tr>'}</tbody>
        </table>
      </div>
    </div>`;
}


// ---------------------------------------------------------------------------
// Sprint 13: Admin — Contestações
// ---------------------------------------------------------------------------

async function renderAdminContestacoes(content) {
  renderSkeletonCards(content, 3);

  let data;
  try {
    data = await api('/api/admin/contested');
  } catch (err) {
    renderErrorState(content, err.message, () => renderAdminContestacoes(content));
    return;
  }

  const { contested, count } = data;

  // Mantém o badge do sidebar sincronizado sem nova chamada de API
  const sidebarBadge = document.querySelector('#contested-badge');
  if (sidebarBadge) sidebarBadge.textContent = count > 0 ? String(count) : '';

  const header = `
    <div class="section-header">
      <div>
        <h1 class="section-title">Contestações</h1>
        <p class="section-subtitle">${count === 0 ? 'Nenhuma pendente' : `${count} resultado(s) contestado(s)`}</p>
      </div>
    </div>`;

  if (!contested.length) {
    content.innerHTML = header + `
      <div style="text-align:center;padding:48px 20px;">
        <div style="font-size:40px;margin-bottom:12px;">✅</div>
        <p style="color:var(--color-text-muted);">Sem resultados contestados no momento.</p>
      </div>`;
    return;
  }

  function statusLabel(s) {
    if (s === 'contested') return '<span class="contested-group-status contested">contestado</span>';
    if (s === 'confirmed') return '<span class="contested-group-status confirmed">confirmado</span>';
    return `<span class="contested-group-status">${s}</span>`;
  }

  const cards = contested.map(item => {
    const groupRows = item.group.map(m => `
      <div class="contested-group-row">
        <span class="contested-group-nome">${escapeHtml(m.nome)}</span>
        <span class="contested-group-score">${m.score !== null && m.score !== undefined ? m.score : '—'}</span>
        ${statusLabel(m.confirmation)}
      </div>`).join('');

    const contesters = item.contesters.length
      ? `<span style="font-size:12px;color:#B91C1C;">⚑ ${item.contesters.map(escapeHtml).join(', ')}</span>`
      : '';

    return `
      <div class="contested-card" data-result-id="${escapeHtml(item.result_id)}">
        <div class="contested-card-header">
          <span class="contested-card-title">
            ${catLabel(item.cat)} &nbsp;Grupo ${item.group_idx + 1}
          </span>
          <span class="contested-card-meta">Rodada ${escapeHtml(item.round_id)}</span>
        </div>
        ${groupRows}
        ${contesters ? `<div style="margin-top:8px;">${contesters}</div>` : ''}
        <div class="contested-card-actions">
          <button class="btn btn-primary btn-sm btn-confirm-result" data-id="${escapeHtml(item.result_id)}">
            Confirmar resultado
          </button>
          <button class="btn btn-ghost btn-sm btn-override-result"
            data-id="${escapeHtml(item.result_id)}"
            data-round-id="${escapeHtml(item.round_id)}"
            data-cat="${escapeHtml(item.cat)}"
            data-group-idx="${item.group_idx}">
            Editar resultado
          </button>
        </div>
      </div>`;
  }).join('');

  content.innerHTML = header + cards;

  // Confirmar resultado (admin aceita o placar como está)
  content.querySelectorAll('.btn-confirm-result').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      btn.disabled = true;
      btn.textContent = 'Confirmando…';
      try {
        await api(`/api/results/${id}/override`, { method: 'PUT', body: { action: 'confirm' } });
        showToast('Resultado confirmado.', 'success');
        renderAdminContestacoes(content);
      } catch (err) {
        showToast(err.message, 'error');
        btn.disabled = false;
        btn.textContent = 'Confirmar resultado';
      }
    });
  });

  // Editar resultado (recria via formulário de sets existente)
  content.querySelectorAll('.btn-override-result').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id       = btn.dataset.id;
      const roundId  = btn.dataset.roundId;
      const cat      = btn.dataset.cat;
      const gi       = parseInt(btn.dataset.groupIdx, 10);

      btn.disabled = true;
      btn.textContent = 'Carregando…';
      try {
        const [results, athletes] = await Promise.all([
          api(`/api/rounds/${roundId}/results`),
          api('/api/athletes'),
        ]);
        const result = results.find(r => r.id === id);
        if (!result) throw new Error('Resultado não encontrado');
        const athletesById = Object.fromEntries(athletes.map(a => [a.id, a]));
        openScoreForm(roundId, cat, gi, result.group, result.sets, athletesById,
          () => renderAdminContestacoes(content));
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Editar resultado';
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Sprint 12: Público — Busca Global
// ---------------------------------------------------------------------------

function renderPublicoBusca(container) {
  container.innerHTML = `
    <div style="padding:0 var(--space-md);">
      <p class="section-title" style="margin-bottom:16px;">Busca</p>
      <form class="search-page-form" id="form-busca" role="search">
        <input
          type="search"
          id="search-global-input"
          class="search-page-input"
          placeholder="Nome de atleta ou temporada…"
          minlength="2"
          autocomplete="off"
          aria-label="Buscar atletas e temporadas"
        />
        <button type="submit" class="btn btn-primary">Buscar</button>
      </form>
      <div id="search-results" aria-live="polite"></div>
    </div>`;

  const input   = container.querySelector('#search-global-input');
  const results = container.querySelector('#search-results');

  // Focus input immediately
  input.focus();

  // Restore query from hash if present (?q=xxx)
  const hashQuery = new URLSearchParams(location.hash.split('?')[1] || '').get('q');
  if (hashQuery) { input.value = hashQuery; doSearch(hashQuery); }

  async function doSearch(q) {
    if (q.trim().length < 2) {
      results.innerHTML = `<p style="font-size:13px;color:var(--color-text-muted);">Digite ao menos 2 caracteres.</p>`;
      return;
    }
    results.innerHTML = `<div class="skeleton skeleton-card"></div><div class="skeleton skeleton-row"></div>`;
    try {
      const data = await api(`/api/search?q=${encodeURIComponent(q)}`);
      let html = '';

      if (data.athletes.length) {
        html += `<div class="search-result-section">
          <p class="search-result-title">Atletas (${data.athletes.length})</p>
          ${data.athletes.map(a => `
            <a href="#publico/atleta/${a.id}" class="search-result-item">
              <span class="search-result-item-name">${escapeHtml(a.nome)}</span>
              <span class="search-result-item-sub">${catLabel(a.current_category)} · ${a.status}</span>
            </a>`).join('')}
        </div>`;
      }

      if (data.seasons.length) {
        html += `<div class="search-result-section">
          <p class="search-result-title">Temporadas (${data.seasons.length})</p>
          ${data.seasons.map(s => `
            <div class="search-result-item" style="cursor:default;">
              <span class="search-result-item-name">${escapeHtml(s.name)}</span>
              <span class="search-result-item-sub">${seasonStatusBadge(s.status)}</span>
            </div>`).join('')}
        </div>`;
      }

      if (!html) {
        html = `<p style="font-size:13px;color:var(--color-text-muted);">Nenhum resultado para "<strong>${escapeHtml(q)}</strong>".</p>`;
      }

      results.innerHTML = html;
    } catch (err) {
      renderErrorState(results, err.message, () => doSearch(q));
    }
  }

  container.querySelector('#form-busca').addEventListener('submit', e => {
    e.preventDefault();
    doSearch(input.value.trim());
  });

  // Debounced live search
  let debounceTimer;
  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => doSearch(input.value.trim()), 350);
  });
}
