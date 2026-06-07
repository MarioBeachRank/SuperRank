/* =====================================================================
   SuperRank · Rei do Play — SPA Router
   Roteamento por hash: #login | #cadastro | #publico | #admin/... | #mesa/...
   ===================================================================== */

const app = document.getElementById('app');

const state = {
  isAdmin: false,
  adminRole: null,       // "super" | "staff"
  adminUsername: null,
  atleta: null,
  athletes: [],
  seasons: [],
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
  const isFormData = opts.body instanceof FormData;
  const res = await fetch(path, {
    headers: isFormData ? (opts.headers || {}) : { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
    body: isFormData ? opts.body : (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
  const json = await res.json();
  if (!res.ok) throw Object.assign(new Error(json.error || 'Erro'), { status: res.status, ...json });
  return json;
}

function catClass(cat) {
  return { A: 'cat-a', B: 'cat-b', C: 'cat-c', D: 'cat-d' }[cat] || '';
}

function catLabel(cat) {
  return cat ? `<span class="category-pill ${catClass(cat)}">Cat ${cat}</span>` : '—';
}

// Célula de posição no ranking. Atleta sem rodadas jogadas (results_count==0)
// não tem posição legítima — mostra "–" em vez de número/medalha.
function rankCell(entry) {
  if ((entry.results_count ?? 0) === 0)
    return `<span class="rank-position rank-unranked" title="Ainda não jogou nenhuma rodada">–</span>`;
  const medals = ['gold', 'silver', 'bronze'];
  return `<span class="rank-position ${medals[entry.rank - 1] || ''}">${entry.rank}</span>`;
}

// Aviso quando ninguém da categoria jogou ainda (início da temporada).
function rankingNotStartedNote(rows) {
  const anyPlayed = (rows || []).some(r => (r.results_count ?? 0) > 0);
  return anyPlayed ? '' :
    `<div class="ranking-not-started">ℹ️ Classificação começa após a 1ª rodada — todos empatados, sem jogos.</div>`;
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

function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

// ---------------------------------------------------------------------------
// Telefone / WhatsApp helpers
// ---------------------------------------------------------------------------

const PHONE_COUNTRIES = [
  { code: '55',  flag: '🇧🇷', label: '+55 Brasil' },
  { code: '1',   flag: '🇺🇸', label: '+1 EUA/Canadá' },
  { code: '54',  flag: '🇦🇷', label: '+54 Argentina' },
  { code: '56',  flag: '🇨🇱', label: '+56 Chile' },
  { code: '57',  flag: '🇨🇴', label: '+57 Colômbia' },
  { code: '51',  flag: '🇵🇪', label: '+51 Peru' },
  { code: '598', flag: '🇺🇾', label: '+598 Uruguai' },
  { code: '595', flag: '🇵🇾', label: '+595 Paraguai' },
  { code: '591', flag: '🇧🇴', label: '+591 Bolívia' },
  { code: '58',  flag: '🇻🇪', label: '+58 Venezuela' },
  { code: '593', flag: '🇪🇨', label: '+593 Equador' },
  { code: '351', flag: '🇵🇹', label: '+351 Portugal' },
  { code: '34',  flag: '🇪🇸', label: '+34 Espanha' },
  { code: '39',  flag: '🇮🇹', label: '+39 Itália' },
  { code: '49',  flag: '🇩🇪', label: '+49 Alemanha' },
  { code: '33',  flag: '🇫🇷', label: '+33 França' },
  { code: '44',  flag: '🇬🇧', label: '+44 Reino Unido' },
];

function parseTelefone(full) {
  if (!full) return { countryCode: '55', localNumber: '' };
  const digits = full.replace(/\D/g, '');
  const match = PHONE_COUNTRIES.find(c => digits.startsWith(c.code));
  if (match) return { countryCode: match.code, localNumber: digits.slice(match.code.length) };
  return { countryCode: '55', localNumber: digits };
}

function fmtPhone(digits) {
  if (!digits) return '';
  const d = digits.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return '(' + d;
  if (d.length <= 6) return '(' + d.slice(0,2) + ') ' + d.slice(2);
  if (d.length <= 10) return '(' + d.slice(0,2) + ') ' + d.slice(2,6) + '-' + d.slice(6);
  return '(' + d.slice(0,2) + ') ' + d.slice(2,7) + '-' + d.slice(7,11);
}

function applyPhoneMask(el) {
  el.addEventListener('input', () => {
    el.value = fmtPhone(el.value);
  });
}

function phoneInputHtml(full = '') {
  const { countryCode, localNumber } = parseTelefone(full);
  const options = PHONE_COUNTRIES.map(c =>
    `<option value="${c.code}" ${c.code === countryCode ? 'selected' : ''}>${c.flag} ${c.label}</option>`
  ).join('');
  return `
    <div class="phone-input-group">
      <select name="phone_country" class="phone-country-select">${options}</select>
      <input type="tel" name="phone_local" class="form-control phone-number-input"
             placeholder="(XX) XXXXX-XXXX" inputmode="numeric"
             value="${escapeHtml(fmtPhone(localNumber))}" maxlength="15" />
    </div>`;
}

const WA_SVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>`;

function waBtn(telefone) {
  if (!telefone) return '';
  const digits = telefone.replace(/\D/g, '');
  if (!digits) return '';
  return `<a class="btn-wa" href="https://wa.me/${digits}" target="_blank" rel="noopener">${WA_SVG} WhatsApp</a>`;
}

// ---------------------------------------------------------------------------
// Messaging helpers — WhatsApp deep links + message modal
// ---------------------------------------------------------------------------

function buildWaUrl(phone, text) {
  const digits = (phone || '').replace(/\D/g, '');
  const number = digits.startsWith('55') ? digits : '55' + digits;
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

function openMessageModal(title, recipientName, phone, defaultText) {
  const digits = (phone || '').replace(/\D/g, '');
  const number = digits.startsWith('55') ? digits : '55' + digits;
  const hasPhone = number.length >= 10;

  openModal(
    title,
    `<div>
      <p style="font-size:12px;color:var(--color-text-muted);margin-bottom:10px;">
        Para: <strong>${escapeHtml(recipientName)}</strong>
        ${hasPhone ? '' : ' <span style="color:#D94040;">(sem telefone cadastrado)</span>'}
      </p>
      <textarea id="msg-text" class="field-input msg-textarea" rows="9"
        style="resize:vertical;font-family:inherit;">${escapeHtml(defaultText)}</textarea>
    </div>`,
    `${hasPhone ? `<a id="btn-abrir-wa" class="btn btn-primary" href="#" target="_blank" rel="noopener">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="#fff" style="vertical-align:middle;margin-right:4px;"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M11.985 0C5.373 0 0 5.373 0 11.985c0 2.11.554 4.087 1.523 5.797L.057 23.886l6.236-1.637A11.947 11.947 0 0011.985 24C18.597 24 24 18.627 24 12.015 24 5.373 18.597 0 11.985 0zm0 21.818a9.826 9.826 0 01-5.012-1.372l-.36-.214-3.713.974.993-3.619-.235-.372a9.81 9.81 0 01-1.506-5.215c0-5.423 4.412-9.835 9.833-9.835 5.422 0 9.834 4.412 9.834 9.835S17.407 21.818 11.985 21.818z"/></svg>
        Abrir WhatsApp</a>` : ''}
     <button id="btn-copiar-msg" class="btn btn-ghost">Copiar texto</button>
     <button id="btn-fechar-msg" class="btn btn-ghost">Fechar</button>`
  );

  function refreshUrl() {
    const text = document.getElementById('msg-text')?.value || '';
    const link = document.getElementById('btn-abrir-wa');
    if (link) link.href = `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
  }
  document.getElementById('msg-text')?.addEventListener('input', refreshUrl);
  refreshUrl();

  document.getElementById('btn-copiar-msg')?.addEventListener('click', () => {
    const text = document.getElementById('msg-text')?.value || '';
    navigator.clipboard?.writeText(text).catch(() => {});
    showToast('Mensagem copiada!', 'success');
  });
  document.getElementById('btn-fechar-msg')?.addEventListener('click', closeModal);
}

// Message templates — return pre-filled text for each scenario
const MSG = {
  // Atleta → grupo
  agendarGrupo: (nome, cat, gi, roundNum, mySlots) => {
    const slots = (mySlots || []).slice(0, 5).join('\n') || '(sem slots marcados ainda)';
    return `Oi pessoal! 👋 Sou ${nome}, Cat ${cat} Grupo ${gi+1} Rodada ${roundNum} do SuperRank.\n\nPrecisamos marcar nossa partida. Meus horários disponíveis:\n${slots}\n\nQual funciona pra vocês? 🎾`;
  },
  confirmarHorario: (nome, cat, gi, roundNum, slot, location) =>
    `Pessoal! ✅ Horário oficial do nosso grupo confirmado:\n📅 ${slot}\n📍 ${location || '—'}\n\nCat ${cat} · G${gi+1} · Rod ${roundNum}. Todos presentes! 🎾`,

  pedirConfirmacaoResultado: (nome, cat, gi, roundNum) =>
    `Oi pessoal! Lancei o resultado da Rodada ${roundNum} (Cat ${cat} G${gi+1}) no SuperRank. Por favor, confirmem o placar no app. 🎾`,

  contatoDireto: (meuNome, coleganome, cat, gi, roundNum) =>
    `Oi ${coleganome}! 🎾 Somos colegas de grupo no SuperRank — Cat ${cat} G${gi+1} Rod ${roundNum}. Tudo certo pra nossa partida?`,

  cobrarSlots: (meuNome, coleganome, cat, gi, roundNum, deadline) =>
    `Oi ${coleganome}! Já marcou seus horários no SuperRank? Somos do mesmo grupo (Cat ${cat} G${gi+1} Rod ${roundNum}). Prazo: ${deadline || '—'}. Entra no app e marca já! 🎾`,

  // Atleta → Admin
  pedirMediacao: (nome, cat, gi, roundNum) =>
    `Olá! Sou ${nome}, Cat ${cat} Grupo ${gi+1} Rodada ${roundNum} do SuperRank. Solicito mediação de horário — nosso grupo não encontrou um horário em comum. Pode ajudar?`,

  falarComAdmin: (nome, cat) =>
    `Olá! Sou ${nome}, Cat ${cat} do SuperRank. Preciso de ajuda com: `,

  // Admin → atleta
  lembreteSlot: (atletaNome, roundNum, deadline) =>
    `⚠️ Olá ${atletaNome}! Você ainda não marcou seus horários disponíveis da Rodada ${roundNum} no SuperRank. Prazo: ${deadline || '—'}. Acesse o app agora! 🎾`,

  alertaWo: (atletaNome, roundNum, deadline) =>
    `🚨 ${atletaNome}, atenção! Você está prestes a receber WO automático na Rodada ${roundNum} do SuperRank. Prazo para marcar slots: ${deadline || '—'}. Acesse urgente!`,

  slotConfirmado: (atletaNome, cat, gi, roundNum, slot, location) =>
    `✅ ${atletaNome}! Horário oficial da sua partida:\n📅 ${slot}\n📍 ${location || '—'}\nCat ${cat} · G${gi+1} · Rod ${roundNum}\nNão perca! 🎾`,

  rodadaSorteada: (atletaNome, cat, gi, roundNum, deadline) =>
    `🎯 ${atletaNome}! Rodada ${roundNum} do SuperRank sorteada. Você está no Grupo ${gi+1} da Cat ${cat}. Entre no app para ver seu grupo e marcar seus horários. Prazo: ${deadline || '—'}. 🎾`,

  contestacaoResolvida: (atletaNome, cat, gi, roundNum) =>
    `✅ ${atletaNome}, o admin resolveu a contestação do resultado da Rodada ${roundNum} (Cat ${cat} G${gi+1}). Acesse o SuperRank para ver o resultado final.`,

  horarioAutoConfirmado: (meuNome, cat, gi, roundNum, slot, location) =>
    `🎾 Pessoal! Todos marcamos nossos horários e o sistema confirmou automaticamente:\n\n📅 ${slot}\n📍 ${location || '—'}\nCat ${cat} · G${gi+1} · Rodada ${roundNum}\n\nNos vemos na quadra! 🏆`,

  semHorarioEmComum: (meuNome, cat, gi, roundNum) =>
    `⚠️ Pessoal! Todos do nosso grupo (Cat ${cat} G${gi+1} Rod ${roundNum}) já marcaram slots, mas não há horário em comum.\n\nPor favor, abram o SuperRank e adicionem mais opções de disponibilidade para conseguirmos agendar a partida. 🎾`,
};

// ---------------------------------------------------------------------------
// Modal de notificação de slot (Sprint B)
// ---------------------------------------------------------------------------

function openSlotNotificationModal({ resolved, slot, cat, groupIndex, roundNumber, location, members, myId }) {
  const gi = groupIndex;
  const others = (members || []).filter(m => m.athlete_id !== myId && !String(m.athlete_id).startsWith('guest_'));

  const msgText = resolved
    ? MSG.horarioAutoConfirmado('', cat, gi, roundNumber, slot, location)
    : MSG.semHorarioEmComum('', cat, gi, roundNumber);

  const fmtSlot = resolved ? (() => {
    try {
      const [date, time] = slot.split(' ');
      const d = new Date(date + 'T12:00:00');
      const weekdays = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
      const months = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
      return `${weekdays[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} · ${time}`;
    } catch(_) { return slot; }
  })() : null;

  const waButtons = others.map(m => {
    if (!m.telefone) return `<span style="font-size:12px;color:var(--color-text-muted);">${escapeHtml(m.nome)} — sem telefone</span>`;
    const digits = m.telefone.replace(/\D/g, '');
    const url = `https://wa.me/${digits}?text=${encodeURIComponent(msgText)}`;
    return `<a href="${url}" target="_blank" rel="noopener"
               class="btn btn-primary" style="width:100%;text-align:center;text-decoration:none;
               background:#25D366;border-color:#25D366;">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="#fff" style="vertical-align:middle;margin-right:6px;"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M11.985 0C5.373 0 0 5.373 0 11.985c0 2.11.554 4.087 1.523 5.797L.057 23.886l6.236-1.637A11.947 11.947 0 0011.985 24C18.597 24 24 18.627 24 12.015 24 5.373 18.597 0 11.985 0zm0 21.818a9.826 9.826 0 01-5.012-1.372l-.36-.214-3.713.974.993-3.619-.235-.372a9.81 9.81 0 01-1.506-5.215c0-5.423 4.412-9.835 9.833-9.835 5.422 0 9.834 4.412 9.834 9.835S17.407 21.818 11.985 21.818z"/></svg>
              ${escapeHtml(m.nome)}
            </a>`;
  }).join('');

  const copyBtn = `<button id="btn-copy-slot-msg" class="btn btn-ghost" style="width:100%;">📋 Copiar mensagem</button>`;

  openModal(
    resolved ? '🎾 Horário Confirmado Automaticamente!' : '⚠️ Sem Horário em Comum',
    `<div style="text-align:center;">
      ${resolved
        ? `<div style="font-size:48px;margin-bottom:8px;">✅</div>
           <p style="font-size:22px;font-weight:800;color:var(--color-primary);margin-bottom:4px;">${escapeHtml(fmtSlot)}</p>
           <p style="font-size:13px;color:var(--color-text-muted);margin-bottom:20px;">Cat ${cat} · Grupo ${gi+1} · Rodada ${roundNumber}</p>`
        : `<div style="font-size:48px;margin-bottom:8px;">⚠️</div>
           <p style="font-size:15px;font-weight:700;margin-bottom:6px;">Todos marcaram, mas sem horário em comum</p>
           <p style="font-size:13px;color:var(--color-text-muted);margin-bottom:20px;">
             Avise seus colegas para adicionarem mais opções no app.
           </p>`}
      <p style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;
         color:var(--color-text-muted);margin-bottom:10px;">Avisar pelo WhatsApp</p>
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px;">
        ${waButtons || '<p style="font-size:13px;color:var(--color-text-muted);">Nenhum colega com telefone cadastrado.</p>'}
      </div>
      ${copyBtn}
    </div>`,
    `<button class="btn btn-ghost" style="width:100%;" onclick="closeModal()">Fechar</button>`
  );

  document.getElementById('btn-copy-slot-msg')?.addEventListener('click', () => {
    navigator.clipboard?.writeText(msgText).catch(() => {});
    showToast('Mensagem copiada!', 'success');
  });
}

// ---------------------------------------------------------------------------
// Unlock request modal (atleta solicita desbloqueio ao admin)
// ---------------------------------------------------------------------------

function openUnlockRequestModal(roundId, slot) {
  openModal(
    '🔒 Solicitar Desbloqueio de Slots',
    `<div>
      <p style="font-size:14px;margin-bottom:4px;">
        Horário confirmado: <strong>${escapeHtml(slot)}</strong>
      </p>
      <p style="font-size:13px;color:var(--color-text-muted);margin-bottom:16px;">
        Para alterar os slots do grupo o admin precisa aprovar o desbloqueio.
        Todos os membros poderão remarcar após a aprovação.
      </p>
      <div class="form-group">
        <label class="field-label">Motivo</label>
        <textarea id="unlock-reason" class="field-input" rows="3"
          placeholder="Ex: Não consigo nesse horário por compromisso já agendado…"></textarea>
      </div>
      <p id="unlock-msg" class="hidden" style="font-size:13px;margin-top:8px;"></p>
    </div>`,
    `<button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
     <button class="btn btn-primary" id="btn-send-unlock" style="margin-left:8px;">Enviar Solicitação</button>`
  );
  document.getElementById('btn-send-unlock').addEventListener('click', async () => {
    const reason = (document.getElementById('unlock-reason')?.value || '').trim();
    const msgEl  = document.getElementById('unlock-msg');
    const sendBtn = document.getElementById('btn-send-unlock');
    if (!reason) {
      msgEl.textContent = 'Informe o motivo.';
      msgEl.style.color = '#D94040'; msgEl.classList.remove('hidden');
      return;
    }
    sendBtn.disabled = true; sendBtn.textContent = 'Enviando…';
    try {
      const res = await api(`/api/rounds/${roundId}/slots/unlock-request`, { method: 'POST', body: { reason } });
      msgEl.textContent = res.message || 'Solicitação enviada! Aguarde aprovação do admin.';
      msgEl.style.color = 'var(--color-cat-c)'; msgEl.classList.remove('hidden');
      setTimeout(closeModal, 2500);
    } catch (err) {
      msgEl.textContent = `Erro: ${err.message}`;
      msgEl.style.color = '#D94040'; msgEl.classList.remove('hidden');
      sendBtn.disabled = false; sendBtn.textContent = 'Enviar Solicitação';
    }
  });
}

function _renderLockedSlots(content, round, official_slot) {
  const pendingReq = official_slot?.unlock_request?.status === 'pending';
  const slot = official_slot?.slot || '—';
  content.innerHTML = `
    <div class="slots-screen">
      <h2 style="font-size:18px;font-weight:700;color:var(--color-primary);margin-bottom:4px;">Marcar Slots</h2>
      <p style="font-size:13px;color:var(--color-text-muted);margin-bottom:16px;">
        Rodada ${round.round_number}
      </p>
      <div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.35);
                  border-radius:10px;padding:20px;text-align:center;">
        <div style="font-size:40px;margin-bottom:8px;">🔒</div>
        <p style="font-size:15px;font-weight:700;margin-bottom:4px;">Horário Confirmado Automaticamente</p>
        <p style="font-size:24px;font-weight:800;color:var(--color-accent);margin:10px 0;">
          ${escapeHtml(slot)}
        </p>
        <p style="font-size:13px;color:var(--color-text-muted);margin-bottom:18px;">
          Todos do grupo marcaram e o sistema encontrou um horário em comum.<br>
          Edições estão bloqueadas.
        </p>
        ${pendingReq
          ? `<div style="display:inline-block;background:rgba(245,158,11,0.15);
                          border-radius:8px;padding:8px 16px;font-size:13px;color:var(--color-accent);">
               ⏳ Solicitação de desbloqueio pendente — aguardando admin
             </div>`
          : `<button id="btn-solicitar-desbloqueio" class="btn btn-ghost">
               🔓 Solicitar Desbloqueio
             </button>`}
      </div>
    </div>`;
  if (!pendingReq) {
    content.querySelector('#btn-solicitar-desbloqueio')?.addEventListener('click', () => {
      openUnlockRequestModal(round.id, slot);
    });
  }
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
  'admin/auditoria':     'Auditoria — SuperRank',
  'admin/config':        'Configurações — SuperRank',
  'admin/admins':        'Admins — SuperRank',
  'admin/whatsapp':      'WhatsApp — SuperRank',
  'admin/pagamentos':    'Pagamentos — SuperRank',
  'mesa/pagamento':      'Pagamento — SuperRank',
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

function svgRankEvolution(history, { color = '#F59E0B' } = {}) {
  if (!history || history.length === 0) return '';
  const VW = 320, VH = 100;
  const P = { t: 20, r: 16, b: 24, l: 28 };
  const w = VW - P.l - P.r, h = VH - P.t - P.b;

  const maxRank = Math.max(...history.map(p => p.total || p.rank), history.length, 4);

  function xPos(i) { return history.length === 1 ? P.l + w / 2 : P.l + i * w / (history.length - 1); }
  function yPos(rank) { return P.t + ((rank - 1) / (maxRank - 1 || 1)) * h; }

  const coords = history.map((p, i) => ({ x: xPos(i), y: yPos(p.rank), p }));
  const linePath = coords.length > 1 ? `M ${coords.map(c => `${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' L ')}` : '';

  const grid = `
    <line x1="${P.l}" y1="${P.t}" x2="${P.l + w}" y2="${P.t}" stroke="rgba(255,255,255,0.06)" stroke-width="1" stroke-dasharray="3 4"/>
    <line x1="${P.l}" y1="${P.t + h}" x2="${P.l + w}" y2="${P.t + h}" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>
    <text x="${P.l - 4}" y="${P.t + 4}" text-anchor="end" font-size="8" fill="rgba(255,255,255,0.28)">1°</text>
    <text x="${P.l - 4}" y="${P.t + h + 4}" text-anchor="end" font-size="8" fill="rgba(255,255,255,0.28)">${maxRank}°</text>`;

  const areaPath = coords.length > 1
    ? `<path d="M ${coords[0].x.toFixed(1)} ${(P.t + h).toFixed(1)} ${coords.map(c => `L ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ')} L ${coords[coords.length-1].x.toFixed(1)} ${(P.t + h).toFixed(1)} Z" fill="${color}" opacity="0.07"/>`
    : '';

  const line = linePath ? `<path d="${linePath}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>` : '';

  const dots = coords.map(c => `
    <circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="4" fill="${color}"/>
    <text x="${c.x.toFixed(1)}" y="${(c.y - 7).toFixed(1)}" text-anchor="middle" font-size="9" fill="${color}" font-weight="700">${c.p.rank}°</text>
    <text x="${c.x.toFixed(1)}" y="${(VH - 4).toFixed(1)}" text-anchor="middle" font-size="8.5" fill="rgba(255,255,255,0.38)">R${c.p.round_number}</text>`).join('');

  return `<svg viewBox="0 0 ${VW} ${VH}" width="100%" preserveAspectRatio="xMidYMid meet" style="display:block;">${grid}${areaPath}${line}${dots}</svg>`;
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
// Avatar helper — foto circular, fallback para inicial
// ---------------------------------------------------------------------------

function avatarHtml(photoUrl, name, size = 48) {
  const initial = (name || '?').charAt(0).toUpperCase();
  const style = `width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;flex-shrink:0;`;
  if (photoUrl) {
    return `<img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(name)}"
                 style="${style}background:var(--color-surface);"
                 onerror="this.outerHTML='<div style=\\'${style}background:var(--color-surface);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:${Math.round(size*0.4)}px;color:var(--color-primary);border:1px solid rgba(255,255,255,0.1)\\'>${initial}</div>'" />`;
  }
  return `<div style="${style}background:var(--color-surface);display:flex;align-items:center;
                        justify-content:center;font-weight:700;font-size:${Math.round(size*0.4)}px;
                        color:var(--color-primary);border:1px solid rgba(255,255,255,0.1);">
            ${initial}
          </div>`;
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
  const hash = (location.hash.replace('#', '') || 'publico').split('?')[0];
  const [section, ...parts] = hash.split('/');
  const sub = parts.join('/');

  if (section === 'admin') {
    const me = await api('/api/auth/me').catch(() => ({ is_admin: false }));
    if (!me.is_admin) { location.hash = '#login'; return; }
    state.isAdmin = true;
    // Fetch admin role if not yet loaded
    if (!state.adminRole) {
      try {
        const adminMe = await api('/api/auth/admin/me');
        state.adminRole     = adminMe.role || 'super';
        state.adminUsername = adminMe.username || 'admin';
      } catch (_) { state.adminRole = 'super'; }
    }
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
window.addEventListener('load', () => {
  route();
  // Pre-load public config for use in comms messages
  api('/api/config').then(cfg => {
    window._appUrl = cfg.app_url || '';
    window._clubName = cfg.club_name || 'SuperRank';
    window._adminPhone = cfg.admin_whatsapp || '';
  }).catch(() => {});
});

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
    const username = (e.target.username?.value || '').trim();
    const password = e.target.password.value;
    errorEl.classList.add('hidden');
    try {
      const res = await api('/api/auth/admin', { method: 'POST', body: { username, password } });
      state.isAdmin      = true;
      state.adminRole    = res.role || 'super';
      state.adminUsername = res.username || 'admin';
      location.hash = '#admin/dashboard';
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
    }
  });

  // Aplica máscara no campo de telefone do login
  const loginPhoneEl = app.querySelector('#form-login-atleta input[name="phone_local"]');
  if (loginPhoneEl) applyPhoneMask(loginPhoneEl);

  // Login atleta
  app.querySelector('#form-login-atleta').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Entrando…';
    try {
      const countryCode = e.target.phone_country.value;
      const localNumber = e.target.phone_local.value.replace(/\D/g, '');
      const telefone = countryCode + localNumber;
      const data = await api('/api/auth/atleta', {
        method: 'POST',
        body: { telefone, pin: e.target.pin.value },
      });
      state.atleta = data.atleta;
      location.hash = '#mesa/home';
    } catch (err) {
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
  // Check for ?convidado=TOKEN guest registration flow
  const hash = location.hash;
  const qIdx = hash.indexOf('?');
  const params = new URLSearchParams(qIdx >= 0 ? hash.slice(qIdx + 1) : '');
  const guestToken = params.get('convidado');
  if (guestToken) { renderCadastroConvidado(guestToken); return; }

  app.innerHTML = '';
  const frag = cloneTemplate('tpl-cadastro');
  app.appendChild(frag);

  const phoneEl = app.querySelector('input[name="phone_local"]');
  if (phoneEl) applyPhoneMask(phoneEl);

  app.querySelector('#form-cadastro').addEventListener('submit', async e => {
    e.preventDefault();
    const errorEl = app.querySelector('#cadastro-error');
    const successEl = app.querySelector('#cadastro-success');
    errorEl.classList.add('hidden');
    successEl.classList.add('hidden');

    const nome = e.target.nome.value.trim();
    const apelido = e.target.apelido.value.trim();
    const pin = e.target.pin.value;
    const pinConfirm = e.target.pin_confirm.value;
    const desired = e.target.desired_category.value || null;
    const countryCode = e.target.phone_country ? e.target.phone_country.value : '55';
    const localNumber = e.target.phone_local ? e.target.phone_local.value.replace(/\D/g, '') : '';
    const telefone = localNumber ? countryCode + localNumber : '';

    if (!apelido) {
      errorEl.textContent = 'Apelido é obrigatório.';
      errorEl.classList.remove('hidden');
      return;
    }
    if (!telefone) {
      errorEl.textContent = 'WhatsApp é obrigatório.';
      errorEl.classList.remove('hidden');
      return;
    }
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
        body: { nome, apelido, pin, type: 'reserva', desired_category: desired, telefone },
      });
      successEl.textContent = 'Cadastro feito! Você já pode entrar com seu telefone e PIN. O admin confirmará sua categoria antes da próxima temporada.';
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

async function renderCadastroConvidado(token) {
  const shell = `
    <div class="screen screen-landing">
      <div class="landing-logo-block">
        <div class="landing-logo-icon">🎾</div>
        <div class="landing-logo-name">Super<span>Rank</span></div>
        <div class="landing-tagline">Cadastro de Convidado</div>
      </div>
      <div class="login-card" style="max-width:420px;" id="convidado-card">
        <p class="placeholder-text">Verificando convite…</p>
      </div>
      <span class="landing-version">v1.2</span>
    </div>`;
  app.innerHTML = shell;
  const card = app.querySelector('#convidado-card');

  let info;
  try {
    info = await api(`/api/guest-token/${token}`);
  } catch (_) {
    card.innerHTML = `
      <p style="color:#D94040;text-align:center;font-size:14px;">
        Link inválido ou expirado. Entre em contato com o admin.
      </p>
      <a href="#login" class="link-secondary" style="display:block;text-align:center;margin-top:16px;">Ir para o login</a>`;
    return;
  }

  if (info.registered) {
    card.innerHTML = `
      <p style="text-align:center;font-size:14px;margin-bottom:16px;">
        Este convite já foi utilizado.
      </p>
      <a href="#login" class="btn btn-primary btn-full">Fazer login</a>`;
    return;
  }

  card.innerHTML = `
    <p style="font-size:14px;margin-bottom:16px;color:var(--color-text-muted);">
      Olá, <strong>${escapeHtml(info.nome)}</strong>!
      Defina um PIN de 4 dígitos para acessar o SuperRank nesta rodada.
    </p>
    <form id="form-convidado" style="display:flex;flex-direction:column;gap:var(--space-md);">
      <div class="form-group">
        <label class="field-label">Nome exibido</label>
        <input type="text" class="field-input" value="${escapeHtml(info.nome)}" disabled>
      </div>
      ${info.telefone ? `
      <div class="form-group">
        <label class="field-label">WhatsApp</label>
        <input type="text" class="field-input" value="${escapeHtml(info.telefone)}" disabled>
      </div>` : ''}
      <div class="form-group">
        <label class="field-label">PIN (4 dígitos)</label>
        <input type="password" name="pin" class="field-input" placeholder="Escolha um PIN de 4 dígitos"
               maxlength="4" inputmode="numeric" autocomplete="new-password" required autofocus>
      </div>
      <div class="form-group">
        <label class="field-label">Confirmar PIN</label>
        <input type="password" name="pin_confirm" class="field-input" placeholder="Repita o PIN"
               maxlength="4" inputmode="numeric" autocomplete="new-password" required>
      </div>
      <p id="convidado-error" class="field-error hidden"></p>
      <button type="submit" class="btn btn-primary btn-full btn-lg">Confirmar e Entrar</button>
      <a href="#login" class="link-secondary">Já tenho cadastro — Entrar</a>
    </form>`;

  card.querySelector('#form-convidado').addEventListener('submit', async e => {
    e.preventDefault();
    const errorEl = card.querySelector('#convidado-error');
    errorEl.classList.add('hidden');
    const pin = e.target.pin.value;
    const pinConfirm = e.target.pin_confirm.value;
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
    btn.disabled = true; btn.textContent = 'Salvando…';
    try {
      await api(`/api/guest-token/${token}/register`, { method: 'POST', body: { pin } });
      showToast('PIN definido! Faça login para entrar na rodada.');
      location.hash = '#login';
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
      btn.disabled = false; btn.textContent = 'Confirmar e Entrar';
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

  // Cabeçalho ciente da sessão: quem está logado vê "Voltar", não "Entrar".
  // (navegar pelo público NÃO desloga — a sessão permanece intacta.)
  api('/api/auth/me').then(me => {
    const authBtn = app.querySelector('#publico-auth-btn');
    if (!authBtn) return;
    if (me.atleta) {
      authBtn.textContent = '← Voltar à Mesa';
      authBtn.setAttribute('href', '#mesa/home');
    } else if (me.is_admin) {
      authBtn.textContent = '← Voltar ao Admin';
      authBtn.setAttribute('href', '#admin/dashboard');
    }
  }).catch(() => {});

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

async function renderPublicoRanking(container, season, selectedSeasonId = null) {
  container.innerHTML = `<p class="placeholder-text" style="padding:var(--space-md);">Carregando ranking…</p>`;

  let seasons = [];
  try { seasons = await api('/api/seasons'); } catch (_) {}

  const selectedSeason = (selectedSeasonId && seasons.find(s => s.id === selectedSeasonId)) || season;

  let rankingData = {};
  try { rankingData = await api(`/api/seasons/${selectedSeason.id}/ranking`); } catch (_) {}

  const cats = ['A','B','C','D'].filter(c => (rankingData[c] || []).length > 0);

  if (!cats.length) {
    const seasonSelectEmpty = seasons.length > 1 ? `
      <select id="ranking-season-sel-empty" class="input" style="font-size:13px;max-width:220px;margin-bottom:12px;">
        ${seasons.map(s => `<option value="${s.id}"${s.id === selectedSeason.id ? ' selected' : ''}>${escapeHtml(s.name)}${s.status === 'active' ? ' ✓' : ''}</option>`).join('')}
      </select>` : '';
    container.innerHTML = `
      <div style="padding:var(--space-md);">
        ${seasonSelectEmpty}
        <div class="empty-state" style="padding:20px 0;">
          <p class="empty-state-title">Nenhum resultado registrado</p>
          <p>O ranking será atualizado após o lançamento dos primeiros resultados.</p>
        </div>
      </div>`;
    container.querySelector('#ranking-season-sel-empty')?.addEventListener('change', e => {
      renderPublicoRanking(container, season, e.target.value);
    });
    return;
  }

  const seasonSelectHtml = seasons.length > 1 ? `
    <select id="ranking-season-sel" class="input" style="font-size:12px;max-width:200px;margin-bottom:12px;">
      ${seasons.map(s => `<option value="${s.id}"${s.id === selectedSeason.id ? ' selected' : ''}>${escapeHtml(s.name)}${s.status === 'active' ? ' ✓' : ''}</option>`).join('')}
    </select>` : '';

  let activeCat = cats[0];

  const renderTable = (cat) => {
    const rows = rankingData[cat] || [];
    const medals = ['gold','silver','bronze'];
    const n = rows.length;
    const m = n >= 8 ? 2 : 1;
    const hasPromo = cat !== 'A' && n >= 4;
    const hasReleg = cat !== 'D' && n >= 4;

    const tableRows = rows.map(r => {
      const inPromo = hasPromo && r.rank <= m;
      const inReleg = hasReleg && r.rank > n - m;
      const trClass = [inPromo ? 'pub-zone-promo' : '', inReleg ? 'pub-zone-releg' : ''].filter(Boolean).join(' ');

      const delta = r.rank_delta;
      let deltaTag = '';
      if (delta !== null && delta !== undefined) {
        if (delta > 0)
          deltaTag = `<span class="rank-tbl-delta rank-tbl-up" title="Subiu ${delta} posição${delta !== 1 ? 'ões' : ''}">▲${delta}</span>`;
        else if (delta < 0)
          deltaTag = `<span class="rank-tbl-delta rank-tbl-down" title="Caiu ${Math.abs(delta)} posição${Math.abs(delta) !== 1 ? 'ões' : ''}">▼${Math.abs(delta)}</span>`;
      }

      const gw = r.games_won ?? '—';
      const gl = r.games_lost ?? '—';
      const rd = r.results_count ?? 0;

      return `<tr class="${trClass}">
        <td>${rankCell(r)}</td>
        <td><a href="#publico/atleta/${r.athlete_id}" style="color:inherit;font-weight:600;text-decoration:none;">${escapeHtml(r.nome)}</a>${deltaTag}</td>
        <td class="num ranking-pts">${r.points}</td>
        <td class="num ranking-stat">${r.wins}</td>
        <td class="num ranking-stat">${gw}/${gl}</td>
        <td class="num ranking-stat" style="font-size:11px;color:var(--color-text-muted);">${rd}R</td>
      </tr>`;
    });

    // Separadores de zona
    const withSep = [];
    rows.forEach((r, i) => {
      withSep.push(tableRows[i]);
      if (hasPromo && r.rank === m)
        withSep.push(`<tr class="zone-separator"><td colspan="6" class="zone-sep-promo">▲ Zona de Promoção acima</td></tr>`);
      if (hasReleg && r.rank === n - m)
        withSep.push(`<tr class="zone-separator"><td colspan="6" class="zone-sep-releg">▼ Zona de Rebaixamento abaixo</td></tr>`);
    });

    return `
      ${rankingNotStartedNote(rows)}
      <table class="ranking-table">
        <thead>
          <tr>
            <th style="width:44px;">#</th>
            <th>Atleta</th>
            <th class="num">Pts</th>
            <th class="num">V</th>
            <th class="num">Games</th>
            <th class="num">R</th>
          </tr>
        </thead>
        <tbody>${withSep.join('')}</tbody>
      </table>`;
  };

  const rebuild = () => {
    container.querySelectorAll('.ranking-cat-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.cat === activeCat));
    container.querySelector('#ranking-table-area').innerHTML = renderTable(activeCat);
  };

  container.innerHTML = `
    <div style="padding:var(--space-md) var(--space-md) 0;">
      ${seasonSelectHtml}
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

  container.querySelector('#ranking-season-sel')?.addEventListener('change', e => {
    renderPublicoRanking(container, season, e.target.value);
  });

  container.querySelectorAll('.ranking-cat-tab').forEach(btn =>
    btn.addEventListener('click', () => { activeCat = btn.dataset.cat; rebuild(); }));
}

async function renderPublicoGrupos(container, season) {
  container.innerHTML = `<p class="placeholder-text" style="padding:var(--space-md);">Carregando grupos…</p>`;

  let rounds = [], athletes = [];
  const [roundsRes, athletesRes] = await Promise.allSettled([
    api(`/api/seasons/${season.id}/rounds`),
    api('/api/athletes'),
  ]);
  if (roundsRes.status  === 'fulfilled') rounds   = roundsRes.value;
  if (athletesRes.status === 'fulfilled') athletes = athletesRes.value;

  rounds.sort((a, b) => b.round_number - a.round_number);

  if (!rounds.length) {
    container.innerHTML = `<div class="empty-state" style="padding:40px 20px;"><p class="empty-state-title">Nenhuma rodada criada</p></div>`;
    return;
  }

  const byId = Object.fromEntries(athletes.map(a => [a.id, a]));
  const catColors = { A: 'var(--color-cat-a)', B: 'var(--color-cat-b)', C: 'var(--color-cat-c)', D: 'var(--color-cat-d)' };
  let selectedRound = rounds[0];

  function groupsHtml(rnd) {
    const hasGroups = ['A','B','C','D'].some(cat => rnd.groups?.[cat]?.length);
    if (!hasGroups) return `<p style="font-size:13px;color:var(--color-text-muted);padding:16px 0;">Grupos ainda não gerados para esta rodada.</p>`;
    let h = '';
    for (const cat of ['A','B','C','D']) {
      const groups = rnd.groups?.[cat];
      if (!groups?.length) continue;
      h += `
        <div style="display:flex;align-items:center;gap:8px;margin:16px 0 8px;">
          <span style="width:3px;height:16px;background:${catColors[cat]};border-radius:2px;flex-shrink:0;"></span>
          <span style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${catColors[cat]};">${catLabel(cat)}</span>
        </div>`;
      groups.forEach((group, gi) => {
        const slot = rnd.official_slots?.[cat]?.[gi];
        h += `
          <div class="card" style="margin-bottom:10px;padding:var(--space-sm) var(--space-md);">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
              <strong style="font-size:13px;">Grupo ${gi + 1}</strong>
              ${slot?.slot ? `<span style="font-size:12px;color:var(--color-text-muted);">⏰ ${slot.slot}</span>` : '<span style="font-size:11px;color:var(--color-text-muted);">Horário pendente</span>'}
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;">
              ${group.map(aid => `<a href="#publico/atleta/${aid}" class="athlete-chip" style="text-decoration:none;color:inherit;">${escapeHtml(byId[aid]?.nome || aid)}</a>`).join('')}
            </div>
          </div>`;
      });
    }
    return h;
  }

  function areaHtml(rnd) {
    const parts = [`Rodada ${rnd.round_number}`];
    if (rnd.target_date) parts.push(rnd.target_date);
    if (rnd.status === 'closed') parts.push('encerrada');
    return `<p style="font-size:12px;color:var(--color-text-muted);margin-bottom:var(--space-md);">${parts.join(' · ')}</p>${groupsHtml(rnd)}`;
  }

  const pillsHtml = rounds.map(r => `
    <button class="grupos-round-pill${r.id === selectedRound.id ? ' grupos-round-pill-active' : ''}" data-round-id="${r.id}">
      Rod. ${r.round_number}
    </button>`).join('');

  container.innerHTML = `
    <div style="padding:var(--space-md);">
      <div class="grupos-round-bar">${pillsHtml}</div>
      <div id="grupos-area">${areaHtml(selectedRound)}</div>
    </div>`;

  container.querySelectorAll('.grupos-round-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedRound = rounds.find(r => r.id === btn.dataset.roundId) || selectedRound;
      container.querySelectorAll('.grupos-round-pill').forEach(b =>
        b.classList.toggle('grupos-round-pill-active', b.dataset.roundId === selectedRound.id));
      container.querySelector('#grupos-area').innerHTML = areaHtml(selectedRound);
    });
  });
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
    state.isAdmin = false; state.adminRole = null; state.adminUsername = null;
    location.hash = '#login';
  });

  // Mostrar link de Admins só para super
  if (state.adminRole === 'super') {
    const sidebar = app.querySelector('#admin-sidebar nav, .sidebar-nav, #admin-sidebar');
    const adminsLink = sidebar?.querySelector('a[href="#admin/admins"]');
    if (adminsLink) adminsLink.parentElement.style.display = '';
  } else {
    const adminsLink = app.querySelector('a[href="#admin/admins"]');
    if (adminsLink) adminsLink.parentElement.style.display = 'none';
  }

  // Exibe username do admin logado
  const userLabel = app.querySelector('#admin-user-label');
  if (userLabel && state.adminUsername) {
    userLabel.textContent = state.adminUsername;
    userLabel.title = `Role: ${state.adminRole || ''}`;
  }

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
    case 'temporadas':
      await renderAdminTemporadas(content);
      break;
    case 'temporada/nova':
      await renderAdminTemporadaNova(content);
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
    case 'lesoes':
      await renderAdminLesoes(content);
      break;
    case 'liga':
      await renderAdminLiga(content);
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
    case 'auditoria':
      await renderAdminAuditoria(content);
      break;
    case 'config':
      await renderAdminConfig(content);
      break;
    case 'pendencias':
      await renderAdminPendencias(content);
      break;
    case 'admins':
      await renderAdminAdmins(content);
      break;
    case 'whatsapp':
      await renderAdminWhatsapp(content);
      break;
    case 'pagamentos':
      await renderAdminPagamentos(content);
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

  let stats = {}, rankingData = {}, allAthletes = [];
  const [statsRes] = await Promise.allSettled([api('/api/admin/stats')]);
  if (statsRes.status === 'fulfilled') stats = statsRes.value;

  const [rankRes, athRes] = await Promise.allSettled([
    stats.active_season_id ? api(`/api/seasons/${stats.active_season_id}/ranking`) : Promise.resolve({}),
    stats.pending_registration > 0 ? api('/api/athletes') : Promise.resolve([]),
  ]);
  if (rankRes.status === 'fulfilled') rankingData = rankRes.value;
  if (athRes.status  === 'fulfilled') allAthletes = athRes.value;
  const pendingAthletes = allAthletes.filter(a => !a.admin_confirmed);

  // --- Progress bar da rodada ativa ---
  function buildRoundProgress(rp) {
    if (!rp) return '';
    const { round_number, start_date, end_date, total_groups,
            confirmed, pending_confirmation, contested, not_launched, is_overdue } = rp;
    const pct = total_groups ? Math.round((confirmed / total_groups) * 100) : 0;
    const period = (start_date && end_date) ? `${fmtDate(start_date)} → ${fmtDate(end_date)}` : '';
    const overdueTag = is_overdue
      ? `<span class="dash-overdue-tag">VENCIDA</span>`
      : '';
    const chips = [
      confirmed            ? `<span class="dash-prog-chip chip-confirmed">${confirmed} confirmado${confirmed !== 1 ? 's' : ''}</span>` : '',
      pending_confirmation ? `<span class="dash-prog-chip chip-pending">${pending_confirmation} aguard. confirmação</span>` : '',
      contested            ? `<span class="dash-prog-chip chip-contested">${contested} contestado${contested !== 1 ? 's' : ''}</span>` : '',
      not_launched         ? `<span class="dash-prog-chip chip-missing">${not_launched} não lançado${not_launched !== 1 ? 's' : ''}</span>` : '',
    ].filter(Boolean).join('');

    return `
      <div class="dash-round-progress ${is_overdue ? 'is-overdue' : ''}">
        <div class="dash-round-progress-header">
          <div>
            <span class="dash-round-label">Rodada ${round_number}</span>
            ${overdueTag}
            ${period ? `<span class="dash-round-period">${period}</span>` : ''}
          </div>
          <a href="#admin/resultados" class="btn btn-ghost btn-sm">Ver resultados →</a>
        </div>
        <div class="dash-progress-bar-track">
          <div class="dash-progress-bar-fill ${pct === 100 ? 'complete' : ''}" style="width:${pct}%"></div>
        </div>
        <div class="dash-prog-meta">
          <span>${pct}% concluído · ${confirmed}/${total_groups} grupos</span>
          <div class="dash-prog-chips">${chips}</div>
        </div>
      </div>`;
  }

  // --- Alertas de rodadas vencidas ---
  function buildOverdueAlerts(overdue) {
    if (!overdue?.length) return '';
    return overdue.map(r => `
      <div class="alert alert-error dash-overdue-alert">
        <strong>Rodada ${r.round_number} vencida</strong> —
        prazo encerrado em ${fmtDate(r.end_date)} com
        ${r.missing} grupo${r.missing !== 1 ? 's' : ''} sem resultado confirmado.
        <a href="#admin/resultados" style="margin-left:8px;">Resolver →</a>
      </div>`).join('');
  }

  // --- Ranking ao vivo: tabela completa por categoria (atualiza a cada rodada) ---
  function buildRankingFull(rankingData) {
    const cats = ['A','B','C','D'].filter(c => rankingData[c]?.length > 0);
    if (!cats.length) return '';
    const medals = ['gold','silver','bronze'];

    const renderCatTable = (cat) => {
      const rows = rankingData[cat] || [];
      const n = rows.length;
      const m = n >= 8 ? 2 : 1;
      const hasPromo = cat !== 'A' && n >= 4;
      const hasReleg = cat !== 'D' && n >= 4;

      const withSep = [];
      rows.forEach((r, i) => {
        const inPromo = hasPromo && r.rank <= m;
        const inReleg = hasReleg && r.rank > n - m;
        const trClass = [inPromo ? 'pub-zone-promo' : '', inReleg ? 'pub-zone-releg' : ''].filter(Boolean).join(' ');

        const delta = r.rank_delta;
        let deltaTag = '';
        if (delta > 0)
          deltaTag = `<span class="rank-tbl-delta rank-tbl-up" title="Subiu ${delta} posição${delta !== 1 ? 'ões' : ''}">▲${delta}</span>`;
        else if (delta < 0)
          deltaTag = `<span class="rank-tbl-delta rank-tbl-down" title="Caiu ${Math.abs(delta)} posição${Math.abs(delta) !== 1 ? 'ões' : ''}">▼${Math.abs(delta)}</span>`;

        const gw = r.games_won ?? '—';
        const gl = r.games_lost ?? '—';
        const rd = r.results_count ?? 0;

        withSep.push(`<tr class="${trClass}">
          <td>${rankCell(r)}</td>
          <td><a href="#admin/atletas" style="color:inherit;font-weight:600;text-decoration:none;">${escapeHtml(r.nome)}</a>${deltaTag}</td>
          <td class="num ranking-pts">${r.points}</td>
          <td class="num ranking-stat">${r.wins}</td>
          <td class="num ranking-stat">${gw}/${gl}</td>
          <td class="num ranking-stat" style="font-size:11px;color:var(--color-text-muted);">${rd}R</td>
        </tr>`);
        if (hasPromo && r.rank === m)
          withSep.push(`<tr class="zone-separator"><td colspan="6" class="zone-sep-promo">▲ Zona de Promoção acima</td></tr>`);
        if (hasReleg && r.rank === n - m)
          withSep.push(`<tr class="zone-separator"><td colspan="6" class="zone-sep-releg">▼ Zona de Rebaixamento abaixo</td></tr>`);
      });

      return `
        <div class="dash-ranking-cat-block">
          <div class="dash-ranking-card-title">${catLabel(cat)} <span style="font-weight:400;color:var(--color-text-muted);">· ${n} atleta${n !== 1 ? 's' : ''}</span></div>
          ${rankingNotStartedNote(rows)}
          <div class="card" style="padding:0;overflow:hidden;">
            <table class="ranking-table">
              <thead>
                <tr>
                  <th style="width:44px;">#</th>
                  <th>Atleta</th>
                  <th class="num">Pts</th>
                  <th class="num">V</th>
                  <th class="num">Games</th>
                  <th class="num">R</th>
                </tr>
              </thead>
              <tbody>${withSep.join('')}</tbody>
            </table>
          </div>
        </div>`;
    };

    return `
      <div class="dash-ranking-section">
        <div class="dash-ranking-header">
          <span class="dash-ranking-title">Ranking ao Vivo <span style="font-weight:400;font-size:12px;color:var(--color-text-muted);">· temporada · atualiza a cada rodada</span></span>
          <a href="#admin/anual" class="btn btn-ghost btn-sm">Ver ranking do ano →</a>
        </div>
        <div class="dash-ranking-full">
          ${cats.map(renderCatTable).join('')}
        </div>
      </div>`;
  }

  // --- Cards de stat ---
  const statCards = [
    { label: 'Atletas Ativos',   value: stats.active_athletes      ?? '—', href: '#admin/atletas',    cls: '' },
    { label: 'Pendentes',        value: stats.pending_registration  ?? 0,   href: '#admin/atletas',    cls: stats.pending_registration ? 'warn' : '' },
    { label: 'Temporada Ativa',  value: stats.active_season_name   ?? '—', href: '#admin/temporadas', cls: stats.active_season_name ? 'accent' : '' },
    { label: 'Resultados Conf.', value: stats.confirmed_results     ?? '—', href: '#admin/resultados', cls: '' },
  ];

  // --- Card de contestações ---
  const contestedCard = stats.contested_count > 0 ? `
    <a href="#admin/contestacoes" class="dash-contested-card">
      <span class="dash-contested-icon">⚑</span>
      <div>
        <div class="dash-contested-count">${stats.contested_count}</div>
        <div class="dash-contested-label">contestação${stats.contested_count !== 1 ? 'ões' : ''} pendente${stats.contested_count !== 1 ? 's' : ''}</div>
      </div>
      <span class="dash-contested-arrow">→</span>
    </a>` : '';

  content.innerHTML = `
    <div class="section-header">
      <div>
        <h1 class="section-title">Dashboard</h1>
        <p class="section-subtitle">${escapeHtml(stats.active_season_name || 'SuperRank · Rei do Play')}</p>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button id="btn-dash-refresh" class="btn btn-ghost btn-sm" title="Atualizar">↺ Atualizar</button>
        <a href="/api/admin/export" class="btn btn-ghost btn-sm" download>Exportar dados</a>
      </div>
    </div>

    ${buildOverdueAlerts(stats.overdue_rounds)}

    ${pendingAthletes.length > 0 ? `
      <div class="alert alert-warning" style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;">
        <span>
          <strong>⚠ ${pendingAthletes.length} atleta(s) aguardando confirmação:</strong>
          ${pendingAthletes.slice(0, 3).map(a => escapeHtml(a.nome)).join(', ')}${pendingAthletes.length > 3 ? ` e mais ${pendingAthletes.length - 3}…` : '.'}
        </span>
        <a href="#admin/atletas" class="btn btn-ghost btn-sm" style="margin-left:auto;white-space:nowrap;">
          Confirmar agora →
        </a>
      </div>` : ''}

    ${!stats.active_season_name ? `
      <div class="alert alert-info">
        Nenhuma temporada ativa. <a href="#admin/temporadas">Ativar temporada →</a>
      </div>` : ''}

    <div class="stat-grid">
      ${statCards.map(c => `
        <a href="${c.href}" class="stat-counter ${c.cls}">
          <div class="stat-counter-value">${escapeHtml(String(c.value))}</div>
          <div class="stat-counter-label">${c.label}</div>
        </a>`).join('')}
    </div>

    ${contestedCard}
    ${buildRoundProgress(stats.round_progress)}
    ${buildRankingFull(rankingData)}`;

  content.querySelector('#btn-dash-refresh')?.addEventListener('click', () => renderAdminDashboard(content));
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
  const isMobile = window.innerWidth < 640;

  const tableBlock = isMobile ? `
    <div id="atletas-list">
      ${renderAtletasRows(athletes)}
    </div>` : `
    <div class="card" style="padding:0;overflow:hidden;">
      <table class="data-table" id="atletas-table">
        <thead>
          <tr>
            <th>Nome</th><th>Tipo</th><th>Categoria</th>
            <th>Telefone</th><th>Cadastro</th><th>Confirmado</th><th>Status</th><th></th>
          </tr>
        </thead>
        <tbody id="atletas-tbody">
          ${renderAtletasRows(athletes)}
        </tbody>
      </table>
    </div>`;

  const pendingCount = athletes.filter(a => !a.admin_confirmed).length;

  content.innerHTML = `
    <div class="section-header">
      <div>
        <h1 class="section-title">Gestão de Atletas</h1>
        <p class="section-subtitle">${athletes.length} atleta(s) cadastrado(s)${pendingCount ? ` · <span style="color:#BA7517;">${pendingCount} pendente(s)</span>` : ''}</p>
      </div>
      <div style="display:flex;gap:8px;">
        <a href="/api/athletes/export.csv" class="btn btn-ghost btn-sm" title="Baixar lista em CSV">⬇ CSV</a>
        <button id="btn-novo-atleta" class="btn btn-primary">+ Novo Atleta</button>
      </div>
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
      <select id="filter-confirmed" class="field-input" style="width:auto;min-width:160px;">
        <option value="">Todos</option>
        <option value="confirmed">Confirmados</option>
        <option value="pending">Pendentes${pendingCount ? ` (${pendingCount})` : ''}</option>
      </select>
    </div>

    ${tableBlock}`;

  // Botão novo atleta
  content.querySelector('#btn-novo-atleta').addEventListener('click', () => openAtletaModal());

  // Busca + filtros
  function applyFilters() {
    const q          = content.querySelector('#search-atleta').value.toLowerCase();
    const typeF      = content.querySelector('#filter-type').value;
    const catF       = content.querySelector('#filter-cat').value;
    const confirmedF = content.querySelector('#filter-confirmed').value;
    const filtered = state.athletes.filter(a => {
      const matchName = (a.nome.toLowerCase().includes(q) || (a.apelido || '').toLowerCase().includes(q));
      const matchType = !typeF || a.type === typeF;
      const matchCat  = !catF || (catF === 'sem' ? !a.current_category : a.current_category === catF);
      const matchConf = !confirmedF
        || (confirmedF === 'confirmed' &&  a.admin_confirmed)
        || (confirmedF === 'pending'   && !a.admin_confirmed);
      return matchName && matchType && matchCat && matchConf;
    });
    const listEl  = content.querySelector('#atletas-list');
    const tbodyEl = content.querySelector('#atletas-tbody');
    if (listEl)  { listEl.innerHTML  = renderAtletasRows(filtered); }
    if (tbodyEl) { tbodyEl.innerHTML = renderAtletasRows(filtered); }
    attachRowActions();
  }

  content.querySelector('#search-atleta').addEventListener('input', applyFilters);
  content.querySelector('#filter-type').addEventListener('change', applyFilters);
  content.querySelector('#filter-cat').addEventListener('change', applyFilters);
  content.querySelector('#filter-confirmed').addEventListener('change', applyFilters);

  function attachRowActions() {
    // Confirmação rápida de atleta pendente
    content.querySelectorAll('.btn-confirmar-atleta').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const atleta = state.athletes.find(a => a.id === id);
        openModal(
          `Confirmar Atleta — ${escapeHtml(atleta.nome)}`,
          `<p style="font-size:13px;color:var(--color-text-muted);margin-bottom:14px;">
             Defina a categoria e o tipo para liberar o acesso do atleta.
           </p>
           <div class="form-group">
             <label class="field-label">Categoria</label>
             <select id="confirm-cat" class="field-input">
               <option value="">Selecione…</option>
               <option value="A">Cat A</option>
               <option value="B">Cat B</option>
               <option value="C">Cat C</option>
               <option value="D">Cat D</option>
             </select>
           </div>
           <div class="form-group">
             <label class="field-label">Tipo</label>
             <select id="confirm-type" class="field-input">
               <option value="titular">Titular</option>
               <option value="reserva">Reserva</option>
               <option value="visitante">Visitante</option>
             </select>
           </div>`,
          `<button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
           <button class="btn btn-primary" id="btn-do-confirm" style="margin-left:8px;">✓ Confirmar Atleta</button>`
        );
        document.getElementById('btn-do-confirm').addEventListener('click', async () => {
          const cat  = document.getElementById('confirm-cat').value;
          const type = document.getElementById('confirm-type').value;
          if (!cat) { showToast('Selecione uma categoria', 'error'); return; }
          try {
            const updated = await api(`/api/athletes/${id}`, {
              method: 'PUT',
              body: { current_category: cat, type },
            });
            state.athletes = state.athletes.map(a => a.id === id ? updated : a);
            closeModal();
            showToast(`${escapeHtml(atleta.nome)} confirmado na Cat ${cat}.`, 'success');
            applyFilters();
          } catch (err) {
            showToast('Erro: ' + err.message, 'error');
          }
        });
      });
    });

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
  const isMobile = window.innerWidth < 640;

  if (!athletes.length) {
    if (isMobile) return `<p class="placeholder-text" style="padding:24px;">Nenhum atleta encontrado.</p>`;
    return `<tr><td colspan="6"><p class="placeholder-text" style="padding:24px;">Nenhum atleta encontrado.</p></td></tr>`;
  }

  if (isMobile) {
    return athletes.map(a => {
      const confirmado = a.admin_confirmed
        ? '<span style="color:#2A7A3A;">✓ confirmado</span>'
        : '<span style="color:#BA7517;">⚠ pendente</span>';
      const displayNome = a.apelido
        ? `${escapeHtml(a.apelido)} <span style="font-size:11px;color:var(--color-text-muted);">(${escapeHtml(a.nome)})</span>`
        : escapeHtml(a.nome);
      return `
        <div class="atleta-card-mobile">
          <div class="atleta-card-top">
            <span class="atleta-card-nome">${displayNome}</span>
            ${statusBadge(a.status)}
          </div>
          <div class="atleta-card-meta">
            ${typeBadge(a.type)} ${catLabel(a.current_category)} · ${confirmado}
          </div>
          <div class="atleta-card-acoes">
            ${!a.admin_confirmed ? `<button class="btn btn-ghost btn-sm btn-confirmar-atleta" data-id="${a.id}" style="color:#22C55E;font-weight:700;">✓ Confirmar</button>` : ''}
            ${waBtn(a.telefone)}
            <a href="#publico/atleta/${a.id}" class="btn btn-ghost btn-sm" title="Ver perfil público" target="_blank" rel="noopener">👤</a>
            <button class="btn btn-ghost btn-sm btn-editar-atleta" data-id="${a.id}">Editar</button>
            <button class="btn btn-ghost btn-sm btn-reset-pin" data-id="${a.id}" data-nome="${escapeHtml(a.nome)}" title="PIN temporário">PIN</button>
            <button class="btn btn-ghost btn-sm btn-excluir-atleta" data-id="${a.id}" style="color:#D94040;">✕</button>
          </div>
        </div>`;
    }).join('');
  }

  return athletes.map(a => {
    const phoneDisplay = a.telefone
      ? `<span style="font-size:12px;font-family:monospace;">${escapeHtml(fmtPhone(a.telefone))}</span>`
      : '<span style="color:var(--color-text-muted);font-size:11px;">—</span>';
    const cadastroDisplay = a.created_at
      ? `<span style="font-size:12px;">${fmtDate(a.created_at.slice(0,10))}</span>`
      : '—';
    return `
    <tr>
      <td style="font-weight:500;">
        ${a.apelido ? escapeHtml(a.apelido) : escapeHtml(a.nome)}
        ${a.apelido ? `<span style="font-size:11px;color:var(--color-text-muted);display:block;">${escapeHtml(a.nome)}</span>` : ''}
        ${!a.admin_confirmed ? ' <span style="color:#BA7517;">⚠</span>' : ''}
      </td>
      <td>${typeBadge(a.type)}</td>
      <td>${catLabel(a.current_category)}</td>
      <td>${phoneDisplay}</td>
      <td>${cadastroDisplay}</td>
      <td>${a.admin_confirmed ? '<span style="color:#2A7A3A;">✓</span>' : '<span style="color:#BA7517;">Pendente</span>'}</td>
      <td>${statusBadge(a.status)}</td>
      <td style="text-align:right;white-space:nowrap;">
        ${!a.admin_confirmed ? `<button class="btn btn-ghost btn-sm btn-confirmar-atleta" data-id="${a.id}" style="color:#22C55E;font-weight:700;margin-right:4px;">✓ Confirmar</button>` : ''}
        ${waBtn(a.telefone)}
        <a href="#publico/atleta/${a.id}" class="btn btn-ghost btn-sm" title="Ver perfil público" style="margin-left:4px;" target="_blank" rel="noopener">👤</a>
        <button class="btn btn-ghost btn-sm btn-editar-atleta" data-id="${a.id}" style="margin-left:4px;">Editar</button>
        <button class="btn btn-ghost btn-sm btn-reset-pin" data-id="${a.id}" data-nome="${escapeHtml(a.nome)}" style="margin-left:4px;" title="PIN temporário">PIN</button>
        <button class="btn btn-ghost btn-sm btn-excluir-atleta" data-id="${a.id}" style="color:#D94040;margin-left:4px;">Excluir</button>
      </td>
    </tr>`;
  }).join('');
}

function openAtletaModal(atleta = null) {
  const isEdit = !!atleta;
  const title = isEdit ? `Editar — ${atleta.nome}` : 'Novo Atleta';

  const body = `
    <form id="form-atleta" class="form-grid">
      <div class="form-group full">
        <label class="field-label">Nome completo <span style="font-size:11px;color:var(--color-text-muted);">(só admin vê)</span></label>
        <input type="text" name="nome" class="field-input" value="${escapeHtml(atleta?.nome || '')}" required />
      </div>
      <div class="form-group full">
        <label class="field-label">Apelido <span style="font-size:11px;color:var(--color-text-muted);">(nome exibido no clube)</span></label>
        <input type="text" name="apelido" class="field-input" value="${escapeHtml(atleta?.apelido || '')}" required />
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
      <div class="form-group">
        <label class="field-label">Data de nascimento</label>
        <input type="date" name="birth_date" class="field-input" value="${escapeHtml(atleta?.birth_date || '')}" max="${new Date().toISOString().slice(0,10)}" />
      </div>
      <div class="form-group full">
        <label class="field-label">WhatsApp (com DDD)</label>
        ${phoneInputHtml(atleta?.telefone || '')}
      </div>
      ${isEdit ? `
      <div class="form-group full">
        <label class="field-label">Status</label>
        <select name="status" class="field-input">
          <option value="ativo" ${atleta.status === 'ativo' ? 'selected' : ''}>Ativo</option>
          <option value="inativo" ${atleta.status === 'inativo' ? 'selected' : ''}>Inativo</option>
        </select>
      </div>
      <div class="form-group full">
        <label class="field-label">Foto de perfil</label>
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:6px;">
          <div id="adm-photo-preview" style="flex-shrink:0;">
            ${avatarHtml(atleta.photo_url, atleta.apelido || atleta.nome, 48)}
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <label for="adm-photo-input" class="btn btn-ghost btn-sm" style="cursor:pointer;margin:0;">
              📷 Alterar
            </label>
            <input id="adm-photo-input" type="file" accept="image/jpeg,image/png,image/webp" style="display:none;" />
            ${atleta.photo_url ? `<button type="button" id="adm-btn-remove-photo" class="btn btn-ghost btn-sm" style="color:#D94040;">✕ Remover</button>` : ''}
          </div>
        </div>
        <p id="adm-photo-msg" style="font-size:12px;display:none;"></p>
      </div>` : ''}
      <p id="atleta-form-error" class="field-error full hidden" style="grid-column:1/-1;"></p>
    </form>`;

  const footer = `
    <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
    <button class="btn btn-primary" id="btn-salvar-atleta">${isEdit ? 'Salvar alterações' : 'Cadastrar atleta'}</button>`;

  openModal(title, body, footer);

  const phoneLocalEl = document.querySelector('#form-atleta input[name="phone_local"]');
  if (phoneLocalEl) applyPhoneMask(phoneLocalEl);

  // Admin photo upload (edit mode only)
  if (isEdit) {
    const admPhotoInput   = document.getElementById('adm-photo-input');
    const admPhotoPreview = document.getElementById('adm-photo-preview');
    const admPhotoMsg     = document.getElementById('adm-photo-msg');

    admPhotoInput?.addEventListener('change', async () => {
      const file = admPhotoInput.files[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) { admPhotoMsg.textContent = 'Máximo 2 MB.'; admPhotoMsg.style.color='#D94040'; admPhotoMsg.style.display='block'; return; }
      const localUrl = URL.createObjectURL(file);
      if (admPhotoPreview) admPhotoPreview.innerHTML = avatarHtml(localUrl, atleta.apelido || atleta.nome, 48);
      const fd = new FormData();
      fd.append('photo', file);
      admPhotoMsg.style.display = 'none';
      try {
        const res = await api(`/api/athletes/${atleta.id}/photo`, { method: 'POST', body: fd });
        admPhotoMsg.textContent = '✓ Foto salva';
        admPhotoMsg.style.color = 'var(--color-cat-c)'; admPhotoMsg.style.display = 'block';
        atleta.photo_url = res.photo_url;
      } catch (err) {
        admPhotoMsg.textContent = err.message; admPhotoMsg.style.color = '#D94040'; admPhotoMsg.style.display = 'block';
        if (admPhotoPreview) admPhotoPreview.innerHTML = avatarHtml(atleta.photo_url, atleta.apelido || atleta.nome, 48);
      }
      URL.revokeObjectURL(localUrl);
    });

    document.getElementById('adm-btn-remove-photo')?.addEventListener('click', async () => {
      try {
        await api(`/api/athletes/${atleta.id}/photo`, { method: 'DELETE' });
        atleta.photo_url = null;
        if (admPhotoPreview) admPhotoPreview.innerHTML = avatarHtml(null, atleta.apelido || atleta.nome, 48);
        admPhotoMsg.textContent = 'Foto removida.'; admPhotoMsg.style.color = 'var(--color-cat-c)'; admPhotoMsg.style.display = 'block';
        document.getElementById('adm-btn-remove-photo')?.remove();
      } catch (err) {
        admPhotoMsg.textContent = err.message; admPhotoMsg.style.color = '#D94040'; admPhotoMsg.style.display = 'block';
      }
    });
  }

  document.getElementById('btn-salvar-atleta').addEventListener('click', async () => {
    const form = document.getElementById('form-atleta');
    const errorEl = document.getElementById('atleta-form-error');
    const fd = new FormData(form);
    const pin = fd.get('pin').trim();
    const countryCode = fd.get('phone_country') || '55';
    const localNumber = (fd.get('phone_local') || '').replace(/\D/g, '');
    const telefone = localNumber ? countryCode + localNumber : null;
    const body = {
      nome: fd.get('nome').trim(),
      apelido: fd.get('apelido').trim(),
      type: fd.get('type'),
      telefone,
      birth_date: fd.get('birth_date') || null,
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
  const [seasonsRes, athletesRes] = await Promise.allSettled([
    api('/api/seasons'), api('/api/athletes'),
  ]);
  if (seasonsRes.status  === 'fulfilled') { seasons  = seasonsRes.value;  state.seasons  = seasons; }
  if (athletesRes.status === 'fulfilled') { athletes = athletesRes.value; state.athletes = athletes; }

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
      </div>

      <!-- Barra flutuante de ações em bloco -->
      <div id="cat-bulk-bar" style="display:none;position:sticky;bottom:0;left:0;right:0;
           background:var(--color-surface);border-top:2px solid var(--color-accent);
           padding:12px 16px;margin-top:12px;border-radius:var(--radius-md) var(--radius-md) 0 0;
           box-shadow:0 -4px 16px rgba(0,0,0,.35);z-index:50;
           display:none;align-items:center;gap:10px;flex-wrap:wrap;">
        <span id="cat-bulk-count" style="font-weight:700;flex:1;font-size:14px;min-width:100px;">0 selecionados</span>
        <select id="cat-bulk-target" class="field-input" style="width:auto;min-width:140px;">
          <option value="">Mover para…</option>
          <option value="A">Categoria A</option>
          <option value="B">Categoria B</option>
          <option value="C">Categoria C</option>
          <option value="D">Categoria D</option>
        </select>
        <button id="btn-cat-bulk-move" class="btn btn-primary btn-sm">Mover</button>
        <button id="btn-cat-bulk-remove" class="btn btn-sm"
                style="background:#D94040;border-color:#D94040;color:#fff;">Remover</button>
        <button id="btn-cat-bulk-cancel" class="btn btn-ghost btn-sm">Cancelar</button>
      </div>`;

    content.querySelector('#season-selector').addEventListener('change', e => {
      selectedSeason = seasons.find(s => s.id === e.target.value);
      paint(selectedSeason);
    });

    content.querySelectorAll('.btn-add-titular').forEach(btn => {
      btn.addEventListener('click', () => openAtletaPicker(btn.dataset.cat, 'titular', selectedSeason, async () => {
        const fresh = await api('/api/seasons');
        seasons = fresh;
        selectedSeason = seasons.find(s => s.id === selectedSeason.id) || selectedSeason;
        paint(selectedSeason);
      }));
    });

    content.querySelectorAll('.btn-add-reserva').forEach(btn => {
      btn.addEventListener('click', () => openAtletaPicker(btn.dataset.cat, 'reserva', selectedSeason, async () => {
        const fresh = await api('/api/seasons');
        seasons = fresh;
        selectedSeason = seasons.find(s => s.id === selectedSeason.id) || selectedSeason;
        paint(selectedSeason);
      }));
    });

    content.querySelectorAll('.btn-remove-atleta').forEach(btn => {
      btn.addEventListener('click', async () => {
        const { cat, role, id: athleteId } = btn.dataset;
        try {
          await api(`/api/seasons/${selectedSeason.id}/categories/${cat}/bulk`, {
            method: 'POST',
            body: { action: 'remove', role, athlete_ids: [athleteId] },
          });
          const fresh = await api('/api/seasons');
          seasons = fresh;
          selectedSeason = seasons.find(s => s.id === selectedSeason.id) || selectedSeason;
          paint(selectedSeason);
        } catch (err) {
          showToast(`Erro ao remover: ${err.message}`, 'error');
        }
      });
    });

    // ── Barra de ações em bloco ──────────────────────────────────────────
    const bulkBar     = content.querySelector('#cat-bulk-bar');
    const bulkCount   = content.querySelector('#cat-bulk-count');
    const bulkTarget  = content.querySelector('#cat-bulk-target');
    const btnMove     = content.querySelector('#btn-cat-bulk-move');
    const btnRemove   = content.querySelector('#btn-cat-bulk-remove');
    const btnCancel   = content.querySelector('#btn-cat-bulk-cancel');

    function getChecked() {
      return [...content.querySelectorAll('.cat-ath-check:checked')];
    }

    function refreshBulkBar() {
      const n = getChecked().length;
      bulkBar.style.display = n > 0 ? 'flex' : 'none';
      bulkCount.textContent  = `${n} selecionado${n !== 1 ? 's' : ''}`;
    }

    content.addEventListener('change', e => {
      if (e.target.classList.contains('cat-ath-check')) refreshBulkBar();
    });

    btnCancel?.addEventListener('click', () => {
      content.querySelectorAll('.cat-ath-check').forEach(el => { el.checked = false; });
      refreshBulkBar();
    });

    btnRemove?.addEventListener('click', async () => {
      const checked = getChecked();
      if (!checked.length) return;
      // Agrupar por (cat, role) para chamar um bulk por grupo
      const grouped = {};
      checked.forEach(el => {
        const k = `${el.dataset.cat}|${el.dataset.role}`;
        if (!grouped[k]) grouped[k] = { cat: el.dataset.cat, role: el.dataset.role, ids: [] };
        grouped[k].ids.push(el.dataset.id);
      });
      btnRemove.disabled = true;
      try {
        await Promise.allSettled(
          Object.values(grouped).map(g =>
            api(`/api/seasons/${selectedSeason.id}/categories/${g.cat}/bulk`, {
              method: 'POST', body: { action: 'remove', role: g.role, athlete_ids: g.ids },
            })
          )
        );
        const fresh = await api('/api/seasons');
        seasons = fresh;
        selectedSeason = seasons.find(s => s.id === selectedSeason.id);
        paint(selectedSeason);
        showToast(`${checked.length} atleta(s) removido(s).`, 'success');
      } catch (err) {
        showToast(`Erro: ${err.message}`, 'error');
        btnRemove.disabled = false;
      }
    });

    btnMove?.addEventListener('click', async () => {
      const targetCat = bulkTarget?.value;
      if (!targetCat) { showToast('Selecione a categoria destino.', 'warning'); return; }
      const checked = getChecked();
      if (!checked.length) return;
      const grouped = {};
      checked.forEach(el => {
        const k = `${el.dataset.cat}|${el.dataset.role}`;
        if (!grouped[k]) grouped[k] = { cat: el.dataset.cat, role: el.dataset.role, ids: [] };
        grouped[k].ids.push(el.dataset.id);
      });
      btnMove.disabled = true;
      try {
        // Remove das categorias de origem
        await Promise.allSettled(
          Object.values(grouped).map(g =>
            api(`/api/seasons/${selectedSeason.id}/categories/${g.cat}/bulk`, {
              method: 'POST', body: { action: 'remove', role: g.role, athlete_ids: g.ids },
            })
          )
        );
        // Adiciona na categoria destino como titular
        const allIds = checked.map(el => el.dataset.id);
        await api(`/api/seasons/${selectedSeason.id}/categories/${targetCat}/bulk`, {
          method: 'POST', body: { action: 'add', role: 'titular', athlete_ids: allIds },
        });
        const fresh = await api('/api/seasons');
        seasons = fresh;
        selectedSeason = seasons.find(s => s.id === selectedSeason.id);
        paint(selectedSeason);
        showToast(`${allIds.length} atleta(s) movido(s) para Cat ${targetCat}.`, 'success');
      } catch (err) {
        showToast(`Erro: ${err.message}`, 'error');
        btnMove.disabled = false;
      }
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
              <input type="checkbox" class="cat-ath-check" data-cat="${cat}" data-role="titular" data-id="${a.id}"
                     style="width:14px;height:14px;flex-shrink:0;accent-color:var(--color-accent);cursor:pointer;" />
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
              <input type="checkbox" class="cat-ath-check" data-cat="${cat}" data-role="reserva" data-id="${a.id}"
                     style="width:14px;height:14px;flex-shrink:0;accent-color:var(--color-accent);cursor:pointer;" />
              ${escapeHtml(a.nome)}
              <button class="btn-remove-atleta" data-cat="${cat}" data-role="reserva" data-id="${a.id}" title="Remover">×</button>
            </span>`).join('') || '<span style="color:var(--color-text-muted);font-size:12px;">Nenhuma reserva</span>'}
        </div>
      </div>
    </div>`;
}

function openAtletaPicker(cat, role, season, onSaved) {
  const allTitularIds = new Set(
    Object.values(season.category_setup).flatMap(s => s.titular_ids)
  );
  const currentSetup = season.category_setup[cat];
  const excluded = new Set([
    ...currentSetup.titular_ids,
    ...currentSetup.reserva_ids,
    ...(role === 'titular' ? allTitularIds : []),
  ]);
  const available = state.athletes.filter(a => a.status === 'ativo' && !excluded.has(a.id));
  const label = role === 'titular' ? 'Titular' : 'Reserva';

  const modalBody = `
    <p style="font-size:13px;color:var(--color-text-muted);margin-bottom:12px;">
      Selecione um ou mais atletas para adicionar como <strong>${label}</strong> em <strong>Cat ${cat}</strong>:
    </p>
    <input type="search" id="picker-search" class="search-input" placeholder="Buscar atleta…"
           style="margin-bottom:8px;width:100%;" />
    <div class="picker-list" id="picker-list">
      ${renderPickerItems(available)}
    </div>`;

  const modalFooter = `
    <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
    <button class="btn btn-primary" id="btn-picker-add" disabled>Selecione atletas</button>`;

  openModal(`Adicionar ${label} — Cat ${cat}`, modalBody, modalFooter);

  const listEl   = document.getElementById('picker-list');
  const searchEl = document.getElementById('picker-search');
  const addBtn   = document.getElementById('btn-picker-add');

  function updateAddBtn() {
    const checked = listEl.querySelectorAll('.picker-check:checked');
    const n = checked.length;
    addBtn.disabled   = n === 0;
    addBtn.textContent = n === 0 ? 'Selecione atletas' : `Adicionar ${n} atleta${n !== 1 ? 's' : ''}`;
  }

  listEl.addEventListener('change', e => {
    if (e.target.classList.contains('picker-check')) updateAddBtn();
  });

  searchEl.addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    listEl.innerHTML = renderPickerItems(available.filter(a => a.nome.toLowerCase().includes(q)));
    updateAddBtn();
  });

  addBtn.addEventListener('click', async () => {
    const ids = [...listEl.querySelectorAll('.picker-check:checked')].map(el => el.dataset.id);
    if (!ids.length) return;
    addBtn.disabled = true;
    addBtn.textContent = 'Salvando…';
    try {
      await api(`/api/seasons/${season.id}/categories/${cat}/bulk`, {
        method: 'POST',
        body: { action: 'add', role, athlete_ids: ids },
      });
      closeModal();
      onSaved();
    } catch (err) {
      showToast(`Erro: ${err.message}`, 'error');
      addBtn.disabled = false;
      updateAddBtn();
    }
  });
}

function renderPickerItems(athletes) {
  if (!athletes.length) {
    return `<p class="placeholder-text" style="padding:16px;">Nenhum atleta disponível.</p>`;
  }
  return athletes.map(a => `
    <label class="picker-item" data-id="${a.id}" style="cursor:pointer;display:flex;align-items:center;gap:10px;">
      <input type="checkbox" class="picker-check" data-id="${a.id}"
             style="width:16px;height:16px;flex-shrink:0;accent-color:var(--color-accent);" />
      <div style="flex:1;min-width:0;">
        <span class="picker-item-name">${escapeHtml(a.nome)}</span>
        <span class="picker-item-meta" style="margin-left:8px;">${typeBadge(a.type)}</span>
      </div>
      ${a.current_category ? catLabel(a.current_category) : ''}
    </label>`).join('');
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

async function renderAdminTemporadas(content) {
  content.innerHTML = `<p class="placeholder-text">Carregando temporadas…</p>`;

  let seasons = [], ligas = [];
  const [seasonsRes, ligasRes] = await Promise.allSettled([
    api('/api/seasons'), api('/api/ligas'),
  ]);
  if (seasonsRes.status !== 'fulfilled') {
    content.innerHTML = `<div class="alert alert-error">Erro: ${escapeHtml(seasonsRes.reason?.message)}</div>`;
    return;
  }
  seasons = seasonsRes.value;
  if (ligasRes.status === 'fulfilled') ligas = ligasRes.value;

  const ligaById = Object.fromEntries(ligas.map(l => [l.id, l]));
  let filterLiga = '';

  const paint = () => {
    const visible = filterLiga ? seasons.filter(s => s.liga_id === filterLiga) : seasons;
    const ligaSelectHtml = ligas.length > 1
      ? `<select id="filter-liga-sel" class="field-input" style="font-size:13px;max-width:220px;">
           <option value="">Todas as ligas</option>
           ${ligas.map(l => `<option value="${l.id}"${l.id === filterLiga ? ' selected' : ''}>${escapeHtml(l.name)}</option>`).join('')}
         </select>`
      : '';

    content.innerHTML = `
      <div class="section-header">
        <div>
          <h1 class="section-title">Temporadas</h1>
          <p class="section-subtitle">${seasons.length} temporada(s) cadastrada(s)</p>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          ${ligaSelectHtml}
          <a href="#admin/temporada/nova" class="btn btn-primary">+ Nova Temporada</a>
        </div>
      </div>

      ${!visible.length ? `<div class="alert alert-info">${seasons.length ? 'Nenhuma temporada nessa liga.' : 'Nenhuma temporada.'} <a href="#admin/temporada/nova">Criar agora →</a></div>` : `
      <div class="card" style="padding:0;overflow:hidden;">
        <table class="data-table" style="width:100%;">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Liga</th>
              <th>Status</th>
              <th>Período</th>
              <th>Rodadas</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${visible.map(s => {
              const liga = ligaById[s.liga_id];
              return `
              <tr>
                <td style="font-weight:500;">${escapeHtml(s.name)}</td>
                <td style="font-size:12px;color:var(--color-text-muted);">${liga ? escapeHtml(liga.name) : '—'}</td>
                <td>${seasonStatusBadge(s.status)}</td>
                <td style="font-size:12px;">${s.start_date} → ${s.end_date}</td>
                <td>${s.rounds_total}</td>
                <td style="text-align:right;white-space:nowrap;display:flex;gap:6px;justify-content:flex-end;">
                  <button class="btn btn-ghost btn-sm btn-editar-temporada"
                    data-id="${s.id}" data-nome="${escapeHtml(s.name)}"
                    data-start="${s.start_date || ''}" data-end="${s.end_date || ''}"
                    data-rounds="${s.rounds_total}" data-days="${s.round_duration_days || 10}">
                    Editar
                  </button>
                  ${s.status === 'pending'
                    ? `<button class="btn btn-ghost btn-sm btn-ativar-temporada" data-id="${s.id}" data-nome="${escapeHtml(s.name)}" style="color:#22C55E;font-weight:700;">✓ Ativar</button>`
                    : ''}
                  ${s.status === 'active'
                    ? `<button class="btn btn-ghost btn-sm btn-desativar-temporada" data-id="${s.id}" data-nome="${escapeHtml(s.name)}" style="color:#BA7517;">Desativar</button>`
                    : ''}
                  <button class="btn btn-ghost btn-sm btn-excluir-temporada" data-id="${s.id}" data-nome="${escapeHtml(s.name)}" data-status="${s.status}" style="color:#D94040;">Excluir</button>
                </td>
              </tr>`;}).join('')}
          </tbody>
        </table>
      </div>`}`;

    content.querySelector('#filter-liga-sel')?.addEventListener('change', e => {
      filterLiga = e.target.value;
      paint();
    });

    content.querySelectorAll('.btn-ativar-temporada').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id   = btn.dataset.id;
        const nome = btn.dataset.nome;
        const jaAtiva = seasons.find(s => s.status === 'active');
        if (jaAtiva && jaAtiva.id !== id) {
          if (!confirm(`A temporada "${jaAtiva.name}" já está ativa. Deseja desativá-la e ativar "${nome}"?`)) return;
          btn.disabled = true;
          btn.textContent = 'Aguarde…';
          try {
            await api(`/api/seasons/${jaAtiva.id}`, { method: 'PUT', body: { status: 'pending' } });
          } catch (_) {}
        } else {
          btn.disabled = true;
          btn.textContent = 'Aguarde…';
        }
        try {
          const updated = await api(`/api/seasons/${id}`, { method: 'PUT', body: { status: 'active' } });
          seasons = seasons.map(s => s.id === updated.id ? updated : s.id === jaAtiva?.id ? { ...s, status: 'pending' } : s);
          showToast(`Temporada "${nome}" ativada.`, 'success');
          paint();
        } catch (err) {
          showToast('Erro: ' + err.message, 'error');
          btn.disabled = false;
          btn.textContent = '✓ Ativar';
        }
      });
    });

    content.querySelectorAll('.btn-desativar-temporada').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id   = btn.dataset.id;
        const nome = btn.dataset.nome;
        if (!confirm(`Desativar temporada "${nome}"? Ela voltará ao status Pendente.`)) return;
        btn.disabled = true;
        btn.textContent = 'Aguarde…';
        try {
          const updated = await api(`/api/seasons/${id}`, { method: 'PUT', body: { status: 'pending' } });
          seasons = seasons.map(s => s.id === id ? updated : s);
          showToast(`Temporada "${nome}" desativada.`, 'success');
          paint();
        } catch (err) {
          showToast('Erro: ' + err.message, 'error');
          btn.disabled = false;
          btn.textContent = 'Desativar';
        }
      });
    });

    content.querySelectorAll('.btn-excluir-temporada').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const nome = btn.dataset.nome;
        const status = btn.dataset.status;
        const hasData = status !== 'pending';
        if (!confirm(`Excluir temporada "${nome}"? Esta ação não pode ser desfeita.`)) return;
        // Temporada com dados: segunda confirmação, pois apaga rodadas/resultados em cascata.
        if (hasData && !confirm(`"${nome}" tem dados lançados (rodadas, resultados). TODOS serão apagados em cascata. Confirmar exclusão definitiva?`)) return;
        btn.disabled = true;
        btn.textContent = 'Excluindo…';
        try {
          const res = await api(`/api/seasons/${id}`, { method: 'DELETE', body: hasData ? { confirm: true } : {} });
          const d = res?.deleted;
          showToast(d ? `Temporada excluída (${d.rounds} rodada(s), ${d.results} resultado(s)).` : 'Temporada excluída.', 'success');
          seasons = seasons.filter(s => s.id !== id);
          paint();
        } catch (err) {
          alert(`Erro: ${err.message}`);
          btn.disabled = false;
          btn.textContent = 'Excluir';
        }
      });
    });

    content.querySelectorAll('.btn-editar-temporada').forEach(btn => {
      btn.addEventListener('click', () => {
        const id     = btn.dataset.id;
        const nome   = btn.dataset.nome;
        const start  = btn.dataset.start;
        const end    = btn.dataset.end;
        const rounds = btn.dataset.rounds;
        const days   = btn.dataset.days;

        openModal('Editar Temporada', `
          <div class="form-group">
            <label class="field-label">Nome</label>
            <input id="edit-s-name" class="field-input" value="${escapeHtml(nome)}">
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div class="form-group">
              <label class="field-label">Início</label>
              <input id="edit-s-start" type="date" class="field-input" value="${start}">
            </div>
            <div class="form-group">
              <label class="field-label">Fim</label>
              <input id="edit-s-end" type="date" class="field-input" value="${end}">
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div class="form-group">
              <label class="field-label">Nº de Rodadas</label>
              <input id="edit-s-rounds" type="number" min="1" max="20" class="field-input" value="${rounds}">
            </div>
            <div class="form-group">
              <label class="field-label">Dias por Rodada</label>
              <input id="edit-s-days" type="number" min="1" max="60" class="field-input" value="${days}">
            </div>
          </div>
          <p style="font-size:12px;color:var(--color-text-muted);margin-top:4px;">
            Editar uma temporada ativa afeta sorteios e ranking. Confirme com cuidado.
          </p>`,
          `<button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
           <button class="btn btn-primary" id="btn-salvar-season" style="margin-left:8px;">Salvar alterações</button>`
        );
        document.getElementById('btn-salvar-season').addEventListener('click', async () => {
          const body = {
            name:                document.getElementById('edit-s-name').value.trim(),
            start_date:          document.getElementById('edit-s-start').value,
            end_date:            document.getElementById('edit-s-end').value,
            rounds_total:        parseInt(document.getElementById('edit-s-rounds').value),
            round_duration_days: parseInt(document.getElementById('edit-s-days').value),
          };
          if (!body.name) { showToast('Nome é obrigatório', 'error'); return; }
          try {
            const updated = await api(`/api/seasons/${id}`, { method: 'PUT', body });
            seasons = seasons.map(s => s.id === id ? updated : s);
            closeModal();
            showToast('Temporada atualizada.', 'success');
            paint();
          } catch (err) {
            showToast('Erro: ' + err.message, 'error');
          }
        });
      });
    });
  };

  paint();
}

async function renderAdminTemporadaNova(content) {
  content.innerHTML = `<p class="placeholder-text">Carregando ligas…</p>`;

  let ligas = [];
  try { ligas = await api('/api/ligas'); } catch (_) {}

  if (!ligas.length) {
    content.innerHTML = `
      <div class="section-header"><div>
        <h1 class="section-title">Nova Temporada</h1>
      </div></div>
      <div class="alert alert-warning">
        Nenhuma liga cadastrada. Toda temporada precisa pertencer a uma liga.
        <a href="#admin/liga" style="margin-left:8px;">Criar liga →</a>
      </div>`;
    return;
  }

  const today = new Date().toISOString().split('T')[0];
  const preselectedLiga = new URLSearchParams(location.hash.split('?')[1] || '').get('liga') || ligas[0].id;

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
          <label class="field-label">Liga <span style="color:#D94040;">*</span></label>
          <select name="liga_id" id="f-liga-id" class="field-input" required>
            ${ligas.map(l => `<option value="${l.id}"${l.id === preselectedLiga ? ' selected' : ''}>${escapeHtml(l.name)} (${l.year})</option>`).join('')}
          </select>
        </div>
        <div class="form-group full">
          <label class="field-label">Nome da temporada</label>
          <input type="text" name="name" class="field-input" placeholder="Ex.: Temporada 1/2025" required />
        </div>
        <div class="form-group">
          <label class="field-label">Ano</label>
          <input type="number" name="year" class="field-input" value="${new Date().getFullYear()}" min="2020" required />
        </div>
        <div class="form-group">
          <label class="field-label">Rodadas (2–5, padrão: 4)</label>
          <input type="number" name="rounds_total" class="field-input" value="4" min="2" max="5" required />
        </div>
        <div class="form-group">
          <label class="field-label">Dias por rodada (padrão: 10)</label>
          <input type="number" name="round_duration_days" class="field-input" value="10" min="1" max="60" required />
        </div>
        <div class="form-group">
          <label class="field-label">Data de início</label>
          <input type="date" name="start_date" id="f-start-date" class="field-input" value="${today}" required />
        </div>
        <div class="form-group">
          <label class="field-label" style="display:flex;align-items:center;justify-content:space-between;">
            <span>Data de fim <span id="end-date-tag" class="field-tag">calculada</span></span>
            <label style="font-size:11px;font-weight:500;cursor:pointer;display:flex;align-items:center;gap:4px;">
              <input type="checkbox" id="chk-extend" style="margin:0;" />
              Ajustar manualmente
            </label>
          </label>
          <input type="date" name="end_date" id="f-end-date" class="field-input" readonly
            style="background:var(--color-surface-2);color:var(--color-text-muted);" required />
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
          <a href="#admin/temporadas" class="btn btn-ghost">Cancelar</a>
          <button type="submit" class="btn btn-primary">Criar temporada</button>
        </div>
      </form>
    </div>`;

  function calcEndDate() {
    const start   = content.querySelector('#f-start-date')?.value;
    const rounds  = parseInt(content.querySelector('[name="rounds_total"]')?.value) || 0;
    const days    = parseInt(content.querySelector('[name="round_duration_days"]')?.value) || 0;
    if (!start || !rounds || !days) return '';
    const d = new Date(start + 'T00:00:00');
    d.setDate(d.getDate() + rounds * days - 1);
    return d.toISOString().split('T')[0];
  }

  function refreshEndDate() {
    if (!content.querySelector('#chk-extend')?.checked) {
      const calc = calcEndDate();
      const field = content.querySelector('#f-end-date');
      if (field && calc) field.value = calc;
    }
  }

  ['#f-start-date', '[name="rounds_total"]', '[name="round_duration_days"]'].forEach(sel => {
    content.querySelector(sel)?.addEventListener('input', refreshEndDate);
    content.querySelector(sel)?.addEventListener('change', refreshEndDate);
  });

  content.querySelector('#chk-extend')?.addEventListener('change', function() {
    const field = content.querySelector('#f-end-date');
    const tag   = content.querySelector('#end-date-tag');
    if (this.checked) {
      field.removeAttribute('readonly');
      field.style.background = '';
      field.style.color = '';
      if (tag) tag.textContent = 'manual';
    } else {
      field.setAttribute('readonly', '');
      field.style.background = 'var(--color-surface-2)';
      field.style.color = 'var(--color-text-muted)';
      if (tag) tag.textContent = 'calculada';
      refreshEndDate();
    }
  });

  refreshEndDate();

  content.querySelector('#form-temporada').addEventListener('submit', async e => {
    e.preventDefault();
    const errorEl   = content.querySelector('#temporada-error');
    const successEl = content.querySelector('#temporada-success');
    errorEl.classList.add('hidden');
    successEl.classList.add('hidden');

    const fd = new FormData(e.target);
    const body = {
      name:                fd.get('name').trim(),
      year:                parseInt(fd.get('year')),
      rounds_total:        parseInt(fd.get('rounds_total')),
      round_duration_days: parseInt(fd.get('round_duration_days')),
      start_date:          fd.get('start_date'),
      end_date:            fd.get('end_date'),
      location:            fd.get('location').trim(),
      location_mode:       fd.get('location_mode'),
      liga_id:             fd.get('liga_id'),
    };

    if (!body.liga_id) {
      errorEl.textContent = 'Selecione uma liga.';
      errorEl.classList.remove('hidden');
      return;
    }
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
  const [seasonsRes, athletesRes] = await Promise.allSettled([
    api('/api/seasons'), api('/api/athletes'),
  ]);
  if (seasonsRes.status  === 'fulfilled') seasons  = seasonsRes.value;
  if (athletesRes.status === 'fulfilled') { athletes = athletesRes.value; state.athletes = athletes; }

  const athletesById = Object.fromEntries(athletes.map(a => [a.id, a]));

  // Carrega rodadas de todas as temporadas em paralelo
  let allRounds = [];
  const roundsSettled = await Promise.allSettled(
    seasons.map(s => api(`/api/seasons/${s.id}/rounds`).then(rounds => rounds.map(r => ({ ...r, season_name: s.name }))))
  );
  for (const res of roundsSettled) {
    if (res.status === 'fulfilled') allRounds.push(...res.value);
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

function _mediationSlots(startDate, endDate) {
  const MORNING = ["06:00","06:30","07:00","07:30"];
  const AFTERNOON = ["16:30","17:00","17:30","18:00","18:30","19:00","19:30","20:00","20:30"];
  const WEEKEND = ["07:00","07:30","08:00","08:30","09:00","09:30"];
  const result = [];
  let cur = new Date(startDate + 'T12:00:00');
  const end = new Date(endDate + 'T12:00:00');
  while (cur <= end) {
    const dateStr = cur.toISOString().slice(0, 10);
    const dow = cur.getDay();
    const times = (dow === 0 || dow === 6) ? WEEKEND : [...MORNING, ...AFTERNOON];
    times.forEach(t => result.push(`${dateStr} ${t}`));
    cur = new Date(cur.getTime() + 86400000);
  }
  return result;
}

function renderMediationCard(pg, athletesById) {
  const { round, cat, groupIdx, slotInfo } = pg;
  const group = round.groups?.[cat]?.[groupIdx] || [];
  const groupNamed = round.groups_named?.[cat]?.[groupIdx] || group;
  const roundSlotSummary = round.official_slots?.[cat]?.[groupIdx];

  const statusLabel = slotInfo.status === 'needs_mediation' ? '⚠ Sem interseção' : '🕐 Pendente';

  // Slots de cada atleta (via groups_named, mas não temos os slots aqui → mostrar quem tem WO)
  const woIds = slotInfo.wo_athlete_ids || [];

  const dateLine = round.start_date && round.end_date
    ? `${round.start_date} → ${round.end_date}`
    : (round.target_date || '');

  return `
    <div class="mediation-group-card">
      <div class="mediation-group-header">
        ${catLabel(cat)}
        <span style="font-weight:600;margin-left:4px;">Grupo ${groupIdx + 1}</span>
        <span style="font-size:12px;color:var(--color-text-muted);margin-left:8px;">
          Rodada ${round.round_number}${dateLine ? ' · ' + dateLine : ''}
        </span>
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
        ${round.start_date && round.end_date
          ? (() => {
              const allSlots = _mediationSlots(round.start_date, round.end_date);
              return `<select id="mediation-input-${round.id}-${cat}-${groupIdx}" class="field-input" style="width:auto;min-width:180px;">
                ${allSlots.map(s => `<option value="${s}">${s}</option>`).join('')}
              </select>`;
            })()
          : `<select id="mediation-input-${round.id}-${cat}-${groupIdx}" class="field-input" style="width:auto;min-width:100px;">
              ${['06:00','06:30','07:00','07:30','08:00','08:30','09:00','09:30',
                 '16:30','17:00','17:30','18:00','18:30','19:00','19:30','20:00','20:30'].map(s =>
                `<option value="${s}">${s}</option>`).join('')}
            </select>`}
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
      <div class="alert alert-warning">Nenhuma temporada. <a href="#admin/temporadas">Criar temporada →</a></div>`;
    return;
  }

  // Usa temporada ativa, ou a mais recente
  const hasActive = seasons.some(s => s.status === 'active');
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

      ${!hasActive ? `
        <div class="alert alert-warning" style="margin-bottom:16px;">
          ⚠ Nenhuma temporada está ativa. Os sorteios ficam disponíveis somente para temporadas ativas.
          <a href="#admin/temporadas" style="margin-left:8px;font-weight:600;">Ativar temporada →</a>
        </div>` : season.status !== 'active' ? `
        <div class="alert alert-info" style="margin-bottom:16px;">
          Visualizando <strong>${escapeHtml(season.name)}</strong> (${season.status}).
          A temporada ativa é outra — use o seletor abaixo para alternar.
        </div>` : ''}

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

    // Authorize-draw buttons
    content.querySelectorAll('.btn-authorize-draw').forEach(btn => {
      btn.addEventListener('click', async () => {
        const roundId = btn.dataset.roundId;
        if (!confirm('Autorizar sorteio da próxima rodada agora (antes do dia final)?')) return;
        btn.disabled = true; btn.textContent = 'Autorizando…';
        try {
          await api(`/api/rounds/${roundId}/authorize-draw`, { method: 'POST', body: {} });
          await loadAndPaint(season);
        } catch (err) {
          showToast(`Erro: ${err.message}`, 'error');
          btn.disabled = false; btn.textContent = '✓ Autorizar Sorteio da Próxima Rodada';
        }
      });
    });

    // Comunicação em massa por categoria
    content.querySelectorAll('.btn-comms-cat').forEach(btn => {
      btn.addEventListener('click', async () => {
        const roundId = btn.dataset.roundId;
        const cat     = btn.dataset.cat;
        btn.disabled = true; btn.textContent = 'Carregando…';
        try {
          const data = await api(`/api/seasons/${season.id}/comms-checklist?round_id=${roundId}&cat=${cat}`);
          openCommsModal(roundId, cat, data.checklist);
        } catch (err) {
          showToast('Erro: ' + err.message, 'error');
        } finally {
          btn.disabled = false; btn.innerHTML = '📢 Comunicar';
        }
      });
    });

    // Close round buttons
    content.querySelectorAll('.btn-close-round').forEach(btn => {
      btn.addEventListener('click', () => {
        const roundId = btn.dataset.roundId;
        confirmModal(
          'Encerrar Rodada',
          'Encerrar esta rodada manualmente? Grupos sem resultado confirmado ficarão sem pontuação nesta rodada.',
          async () => {
            btn.disabled = true; btn.textContent = 'Encerrando…';
            try {
              const res = await api(`/api/rounds/${roundId}/close`, { method: 'POST', body: {} });
              if (res.warning) showToast(res.warning, 'info');
              else showToast('Rodada encerrada com sucesso.', 'success');
              await loadAndPaint(season);
            } catch (err) {
              showToast(`Erro: ${err.message}`, 'error');
              btn.disabled = false; btn.innerHTML = '⊗ Encerrar Rodada';
            }
          },
          'Encerrar'
        );
      });
    });

    // Cancel empty round buttons
    content.querySelectorAll('.btn-cancel-round').forEach(btn => {
      btn.addEventListener('click', () => {
        const roundId = btn.dataset.roundId;
        confirmModal(
          'Cancelar Rodada',
          'Cancelar esta rodada? Só é permitido para rodadas vazias (sem resultados lançados). A rodada não contará para o ranking nem bloqueará o fechamento da temporada.',
          async () => {
            btn.disabled = true; btn.textContent = 'Cancelando…';
            try {
              await api(`/api/rounds/${roundId}/cancel`, { method: 'POST', body: {} });
              showToast('Rodada cancelada com sucesso.', 'success');
              await loadAndPaint(season);
            } catch (err) {
              showToast(`Erro: ${err.message}`, 'error');
              btn.disabled = false; btn.innerHTML = '🗑 Cancelar Rodada';
            }
          },
          'Cancelar Rodada'
        );
      });
    });

    // Reopen closed round buttons
    content.querySelectorAll('.btn-reopen-round').forEach(btn => {
      btn.addEventListener('click', () => {
        const roundId = btn.dataset.roundId;
        confirmModal(
          'Reabrir Rodada',
          'Reabrir esta rodada? O status voltará para "Em andamento" e novos resultados poderão ser lançados. Resultados já confirmados são mantidos.',
          async () => {
            btn.disabled = true; btn.textContent = 'Reabrindo…';
            try {
              await api(`/api/rounds/${roundId}/reopen`, { method: 'POST', body: {} });
              showToast('Rodada reaberta com sucesso.', 'success');
              await loadAndPaint(season);
            } catch (err) {
              showToast(`Erro: ${err.message}`, 'error');
              btn.disabled = false; btn.innerHTML = '🔓 Reabrir Rodada';
            }
          },
          'Reabrir'
        );
      });
    });

    // Descartar rodada (destrutivo — apaga resultados)
    content.querySelectorAll('.btn-discard-round').forEach(btn => {
      btn.addEventListener('click', () => {
        const roundId = btn.dataset.roundId;
        confirmModal(
          'Descartar rodada',
          'Esta ação APAGA todos os resultados lançados nesta rodada e a marca como cancelada. ' +
          'Use apenas para rodadas de teste ou criadas por engano. O ranking será recalculado sem esses resultados. ' +
          'Esta ação é IRREVERSÍVEL.',
          async () => {
            // Segunda confirmação explícita.
            if (!confirm('Tem certeza? Os resultados desta rodada serão apagados definitivamente.')) return;
            btn.disabled = true; btn.textContent = 'Descartando…';
            try {
              const res = await api(`/api/rounds/${roundId}/discard`, { method: 'POST', body: { confirm: true } });
              showToast(`Rodada descartada. ${res.results_removed} resultado(s) apagado(s).`, 'success');
              await loadAndPaint(season);
            } catch (err) {
              showToast(`Erro: ${err.message}`, 'error');
              btn.disabled = false; btn.innerHTML = '⚠ Descartar rodada (apaga resultados)';
            }
          },
          'Descartar'
        );
      });
    });

    // Acordeon dos rounds
    content.querySelectorAll('.round-card-header').forEach(header => {
      header.addEventListener('click', async () => {
        const body = header.nextElementSibling;
        const chevron = header.querySelector('.round-card-chevron');
        body.classList.toggle('open');
        chevron.classList.toggle('open');
        if (body.classList.contains('open')) {
          initCatTabs(body);

          // Admin messaging buttons
          body.querySelectorAll('.btn-adm-lembrete').forEach(btn => {
            btn.addEventListener('click', () => {
              openMessageModal('Lembrete Slot', btn.dataset.nome, btn.dataset.phone,
                MSG.lembreteSlot(btn.dataset.nome, btn.dataset.round, btn.dataset.deadline));
            });
          });
          body.querySelectorAll('.btn-adm-wo').forEach(btn => {
            btn.addEventListener('click', () => {
              openMessageModal('Alerta WO', btn.dataset.nome, btn.dataset.phone,
                MSG.alertaWo(btn.dataset.nome, btn.dataset.round, btn.dataset.deadline));
            });
          });

          // Copy draw text to clipboard
          body.querySelectorAll('.btn-copy-draw').forEach(btn => {
            btn.addEventListener('click', () => {
              const rnd = rounds.find(r => r.id === btn.dataset.roundId);
              if (!rnd) return;
              const text = buildDrawText(rnd, selectedSeason);
              navigator.clipboard?.writeText(text).catch(() => {
                const ta = document.createElement('textarea');
                ta.value = text; document.body.appendChild(ta); ta.select();
                document.execCommand('copy'); document.body.removeChild(ta);
              });
              showToast('Sorteio copiado para a área de transferência!', 'success');
            });
          });

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

          // Unlock approve/reject buttons
          body.querySelectorAll('.btn-unlock-approve, .btn-unlock-reject').forEach(btn => {
            btn.addEventListener('click', async () => {
              const decision = btn.classList.contains('btn-unlock-approve') ? 'approve' : 'reject';
              const label = decision === 'approve' ? 'Aprovar' : 'Rejeitar';
              confirmModal(
                `${label} desbloqueio`,
                decision === 'approve'
                  ? 'Aprovar o desbloqueio? O grupo poderá remarcar os slots.'
                  : 'Rejeitar a solicitação? O horário original será mantido.',
                async () => {
                  btn.disabled = true;
                  try {
                    const res = await api(
                      `/api/rounds/${btn.dataset.roundId}/groups/${btn.dataset.cat}/${btn.dataset.gi}/unlock`,
                      { method: 'POST', body: { decision } }
                    );
                    showToast(res.message || `${label}do com sucesso.`, 'success');
                    await loadAndPaint(selectedSeason);
                  } catch (err) {
                    showToast(`Erro: ${err.message}`, 'error');
                    btn.disabled = false;
                  }
                },
                label
              );
            });
          });
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

  const dateLine = round.start_date && round.end_date
    ? `${round.start_date} → ${round.end_date}`
    : '';

  let deadlineFmt = '';
  if (round.deadline_slots) {
    try {
      const dl = new Date(round.deadline_slots);
      deadlineFmt = dl.toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit', timeZone:'America/Sao_Paulo' });
    } catch(_) { deadlineFmt = round.deadline_slots; }
  }

  const canAuthorize = round.status !== 'closed' && round.status !== 'cancelled' && !round.draw_authorized;

  return `
    <div class="round-card" data-round-id="${round.id}">
      <div class="round-card-header">
        <span class="round-card-title">Rodada ${round.round_number} de ${season.rounds_total}</span>
        <span class="badge ${statusMap[round.status] || ''}" style="margin-right:8px;">${statusLabel[round.status] || round.status}</span>
        <span style="font-size:12px;color:var(--color-text-muted);margin-right:8px;">${totalGroups} grupo${totalGroups !== 1 ? 's' : ''} · ${cats.map(c => `Cat ${c}`).join(', ') || '—'}</span>
        <span class="round-card-chevron">▼</span>
      </div>
      <div class="round-card-body">
        ${dateLine || deadlineFmt ? `
          <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-bottom:12px;font-size:12px;">
            ${dateLine ? `<span>📅 <strong>Período:</strong> ${dateLine}</span>` : ''}
            ${deadlineFmt ? `<span style="color:#BA7517;">⏰ <strong>Prazo slots:</strong> ${deadlineFmt}</span>` : ''}
            ${round.draw_authorized ? `<span class="badge badge-active">Sorteio autorizado</span>` : ''}
          </div>` : ''}
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
                ${round.status !== 'closed' && round.status !== 'cancelled' ? `
                  <div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.06);">
                    <button class="btn btn-ghost btn-sm btn-comms-cat"
                      data-round-id="${round.id}" data-cat="${cat}"
                      style="color:var(--color-text-muted);font-size:12px;">
                      📢 Comunicar
                    </button>
                  </div>` : ''}
              </div>`).join('')}`}
        ${Object.keys(round.groups_named || {}).some(c => (round.groups_named[c]||[]).length) ? `
          <div style="margin-top:16px;padding-top:12px;border-top:var(--border);">
            <button class="btn btn-ghost btn-sm btn-copy-draw" data-round-id="${round.id}"
              style="font-size:12px;">
              📋 Copiar sorteio
            </button>
          </div>` : ''}
        ${canAuthorize ? `
          <div style="margin-top:16px;padding-top:12px;border-top:var(--border);">
            <button class="btn btn-ghost btn-sm btn-authorize-draw" data-round-id="${round.id}">
              ✓ Autorizar Sorteio da Próxima Rodada
            </button>
          </div>` : ''}
        ${round.status !== 'closed' && round.status !== 'cancelled' ? `
          <div style="margin-top:16px;padding-top:12px;border-top:var(--border);display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-ghost btn-sm btn-close-round" data-round-id="${round.id}"
              style="color:#D94040;"
              title="Encerrar esta rodada manualmente">
              ⊗ Encerrar Rodada
            </button>
            <button class="btn btn-ghost btn-sm btn-cancel-round" data-round-id="${round.id}"
              style="color:#BA7517;"
              title="Cancelar uma rodada vazia (sem resultados lançados). Não conta para o ranking nem bloqueia o fechamento.">
              🗑 Cancelar Rodada
            </button>
          </div>` : ''}
        ${round.status === 'closed' ? `
          <div style="margin-top:16px;padding-top:12px;border-top:var(--border);">
            <button class="btn btn-ghost btn-sm btn-reopen-round" data-round-id="${round.id}"
              style="color:#BA7517;"
              title="Reabrir esta rodada para permitir correções">
              🔓 Reabrir Rodada
            </button>
          </div>` : ''}
        ${round.status !== 'cancelled' ? `
          <div style="margin-top:12px;padding-top:12px;border-top:var(--border);">
            <button class="btn btn-ghost btn-sm btn-discard-round" data-round-id="${round.id}"
              style="color:#D94040;opacity:.85;"
              title="Descartar a rodada por completo: APAGA os resultados lançados e cancela a rodada. Use para rodadas de teste/engano. Irreversível.">
              ⚠ Descartar rodada (apaga resultados)
            </button>
          </div>` : ''}
      </div>
    </div>`;
}

function renderGroupsGrid(cat, round) {
  const groups = round.groups[cat] || [];
  const groupsNamed = (round.groups_named || {})[cat] || [];
  const groupsSetsNamed = (round.groups_sets_named || {})[cat] || [];
  const groupsTelefones = (round.groups_telefones || {})[cat] || [];

  return `
    <div class="groups-grid">
      ${groups.map((group, idx) => {
        const names = groupsNamed[idx] || group;
        const sets = groupsSetsNamed[idx] || [];
        const telefones = groupsTelefones[idx] || [];
        return `
          <div class="group-card" data-round="${round.id}" data-cat="${cat}" data-gi="${idx}">
            <div class="group-card-header">
              <span>Grupo ${idx + 1}</span>
              <span style="font-weight:400;opacity:0.8;">Cat ${cat}</span>
              <span class="group-result-badge badge" style="margin-left:auto;font-size:10px;"></span>
            </div>
            <div class="group-athletes">
              ${names.map((n, i) => `
                <span class="group-athlete-chip" style="display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;">
                  ${escapeHtml(n)}
                  ${telefones[i] ? `
                    ${waBtn(telefones[i])}
                    <button class="btn btn-sm btn-ghost btn-adm-lembrete"
                      data-nome="${escapeHtml(n)}" data-phone="${escapeHtml(telefones[i])}"
                      data-round="${round.round_number}" data-deadline="${escapeHtml(round.deadline_slots||'')}"
                      style="font-size:10px;padding:2px 6px;">⏰ Lembrete</button>
                    <button class="btn btn-sm btn-ghost btn-adm-wo"
                      data-nome="${escapeHtml(n)}" data-phone="${escapeHtml(telefones[i])}"
                      data-round="${round.round_number}" data-deadline="${escapeHtml(round.deadline_slots||'')}"
                      style="font-size:10px;padding:2px 6px;color:#D94040;">🚨 WO Alert</button>
                  ` : ''}
                </span>`).join('')}
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
            ${(() => {
              const osEntry = (round.official_slots || {})[cat]?.[idx];
              const unlockReq = osEntry?.unlock_request;
              if (!unlockReq || unlockReq.status !== 'pending') return '';
              const requesterIdx = (round.groups?.[cat]?.[idx] || []).indexOf(unlockReq.requested_by);
              const requesterName = requesterIdx >= 0
                ? (groupsNamed[idx]?.[requesterIdx] || unlockReq.requested_by)
                : (unlockReq.requested_by || '?');
              return `
                <div class="alert alert-warning" style="font-size:12px;margin-top:10px;padding:10px 12px;border-radius:8px;">
                  <div style="font-weight:700;margin-bottom:4px;">🔓 Solicitação de desbloqueio de slots</div>
                  <div style="margin-bottom:2px;"><strong>${escapeHtml(requesterName)}</strong> pediu desbloqueio:</div>
                  <div style="color:var(--color-text-muted);font-style:italic;margin-bottom:8px;">"${escapeHtml(unlockReq.reason)}"</div>
                  <div style="display:flex;gap:8px;">
                    <button class="btn btn-sm btn-primary btn-unlock-approve"
                      data-round-id="${round.id}" data-cat="${cat}" data-gi="${idx}"
                      style="font-size:11px;padding:4px 10px;">✓ Aprovar</button>
                    <button class="btn btn-sm btn-ghost btn-unlock-reject"
                      data-round-id="${round.id}" data-cat="${cat}" data-gi="${idx}"
                      style="font-size:11px;padding:4px 10px;color:#D94040;">✗ Rejeitar</button>
                  </div>
                </div>`;
            })()}
          </div>`;
      }).join('')}
    </div>`;
}

function buildDrawText(round, season) {
  const lines = [`🎾 Rodada ${round.round_number} — ${season.name}`];
  if (round.start_date && round.end_date)
    lines.push(`📅 ${fmtDate(round.start_date)} → ${fmtDate(round.end_date)}`);
  for (const cat of ['A','B','C','D']) {
    const groups = (round.groups_named || {})[cat];
    if (!groups?.length) continue;
    lines.push('', `📌 Categoria ${cat}`);
    groups.forEach((group, gi) => {
      lines.push('', `Grupo ${gi + 1}:`);
      group.forEach(nome => lines.push(`• ${nome}`));
      const slot = (round.official_slots || {})[cat]?.[gi];
      if (slot?.slot) lines.push(`⏰ ${slot.slot}`);
    });
  }
  return lines.join('\n');
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
    app.querySelector('#mesa-atleta-nome').textContent = state.atleta.apelido || state.atleta.nome;
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

  // Badge no nav de Resultado quando há algo para o atleta fazer
  const resultNavBadge = app.querySelector('#resultado-nav-badge');
  if (resultNavBadge && ctx?.result_status === 'pending_mine') {
    resultNavBadge.style.display = 'block';
  }

  // Convidados: ocultar tabs irrelevantes e marcar badge
  if (ctx?.is_guest) {
    const nav = app.querySelector('#mesa-bottom-nav');
    if (nav) {
      nav.querySelectorAll('a[href="#mesa/perfil"]').forEach(el => {
        el.style.display = 'none';
      });
    }
    const nomeEl = app.querySelector('#mesa-atleta-nome');
    if (nomeEl) nomeEl.textContent = `${ctx.athlete?.apelido || ctx.athlete?.nome || ''} (Convidado)`;
    // Redireciona tabs sem sentido para convidado
    if (['perfil','historico','ranking','notificacoes'].includes(sub)) {
      location.hash = '#mesa/home'; return;
    }
  }

  switch (sub || 'home') {
    case 'home':           await renderMesaHome(content, ctx); break;
    case 'slots':          renderMesaSlots(content, ctx); break;
    case 'grupo':          await renderMesaGrupo(content, ctx); break;
    case 'resultado':      renderMesaResultado(content, ctx); break;
    case 'historico':      await renderMesaHistorico(content); break;
    case 'perfil':         await renderMesaPerfil(content); break;
    case 'ranking':        await renderMesaRanking(content, ctx); break;
    case 'notificacoes':   await renderMesaNotificacoes(content); break;
    case 'pagamento':      await renderMesaPagamento(content); break;
    default:
      content.innerHTML = `<p class="placeholder-text">Tela disponível em sprint futuro.</p>`;
  }

  // Update notification badge
  try {
    const nd = await api('/api/mesa/notifications');
    const badge = document.getElementById('notif-badge');
    if (badge) {
      badge.textContent = nd.unread > 0 ? String(nd.unread) : '';
      badge.style.display = nd.unread > 0 ? 'flex' : 'none';
    }
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// Mesa: Home — vista de convidado
// ---------------------------------------------------------------------------

function deadlineUrgencyColor(dl) {
  try {
    const h = (new Date(dl) - new Date()) / 3600000;
    if (h < 0)  return 'var(--color-text-muted)';
    if (h < 24) return '#D94040';
    if (h < 48) return '#BA7517';
    return '#BA7517';
  } catch(_) { return '#BA7517'; }
}

function deadlineUrgencyText(dl) {
  try {
    const deadline = new Date(dl);
    const h = (deadline - new Date()) / 3600000;
    const timeFmt = deadline.toLocaleString('pt-BR', { hour:'2-digit', minute:'2-digit', timeZone:'America/Sao_Paulo' });
    const dateFmt = deadline.toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit', timeZone:'America/Sao_Paulo' });
    if (h < 0)   return `Prazo de slots encerrado`;
    if (h < 2)   return `⚠ Prazo slots: ${timeFmt} — urgente!`;
    if (h < 24)  return `⚠ Prazo slots: hoje às ${timeFmt}`;
    if (h < 48)  return `Prazo slots: amanhã às ${timeFmt}`;
    return `Prazo slots: ${dateFmt}`;
  } catch(_) { return dl; }
}

function renderMesaHomeGuest(content, ctx) {
  const { athlete, group, round, official_slot } = ctx;
  const nome = athlete?.apelido || athlete?.nome || '—';
  const cat  = group?.category || '?';
  const gi   = group != null ? (group.group_index + 1) : '?';

  const slotResolved = official_slot?.status === 'resolved';
  const slotHtml = slotResolved
    ? `<div class="official-slot-card">
         <p class="official-slot-label">Horário Oficial</p>
         <p class="official-slot-time">${official_slot.slot}</p>
         <p class="official-slot-location">📍 ${escapeHtml(group?.location || '—')}</p>
       </div>`
    : `<div class="pending-slot-card">
         <p style="font-size:24px;margin-bottom:8px;">🕐</p>
         <p style="font-weight:600;">Aguardando definição de horário</p>
         <p style="font-size:13px;margin-top:4px;">O admin irá comunicar o slot oficial.</p>
       </div>`;

  const membersHtml = (group?.names || []).map((n, i) => {
    const isMe = group.athlete_ids[i] === athlete.id;
    return `<div class="group-member-row${isMe ? ' is-me' : ''}">
      <span class="group-member-name">${escapeHtml(n)}</span>
      ${isMe ? '<span class="badge badge-ativo">Você</span>' : ''}
    </div>`;
  }).join('');

  const setsHtml = (group?.sets_named || []).map(s => `
    <div class="set-row" style="padding:10px 16px;border-bottom:var(--border);">
      <span class="set-label">Set ${s.set}</span>
      <span class="set-team">${s.team_a.map(escapeHtml).join(' + ')}</span>
      <span class="set-vs">vs</span>
      <span class="set-team">${s.team_b.map(escapeHtml).join(' + ')}</span>
    </div>`).join('');

  const roundInfo = round
    ? `Rodada ${round.round_number}${round.start_date ? ` · ${round.start_date} → ${round.end_date || '?'}` : ''}`
    : '';

  content.innerHTML = `
    <div style="padding:16px;max-width:600px;margin:0 auto;">
      <div style="background:rgba(255,179,0,0.12);border:1px solid rgba(255,179,0,0.35);
                  border-radius:var(--radius-md);padding:12px 16px;margin-bottom:20px;
                  display:flex;align-items:center;gap:10px;">
        <span style="font-size:20px;">🎾</span>
        <div>
          <div style="font-size:13px;font-weight:700;color:var(--color-gold);">Participando como Convidado</div>
          <div style="font-size:12px;color:var(--color-text-muted);">
            ${escapeHtml(nome)} · ${catLabel(cat)} Grupo ${gi} · ${roundInfo}
          </div>
        </div>
      </div>

      ${slotHtml}

      <p style="font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;
         color:var(--color-text-muted);margin:20px 0 8px;">Atletas do Grupo</p>
      <div class="group-members-list" style="margin-bottom:20px;">${membersHtml}</div>

      ${setsHtml ? `
      <p style="font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;
         color:var(--color-text-muted);margin-bottom:8px;">Sets (Art. 7)</p>
      <div class="card" style="padding:0;overflow:hidden;margin-bottom:20px;">${setsHtml}</div>` : ''}

      <p style="font-size:12px;color:var(--color-text-muted);text-align:center;margin-top:12px;">
        Sua participação é válida apenas nesta rodada. Os pontos não entram no ranking.
      </p>
    </div>`;
}

// ---------------------------------------------------------------------------
// Mesa: Home
// ---------------------------------------------------------------------------

async function renderMesaHome(content, ctx) {
  if (!ctx || (!ctx.season && !ctx.is_guest)) {
    content.innerHTML = `
      <div class="empty-state" style="padding:40px 20px;">
        <div class="empty-state-icon">🎾</div>
        <p class="empty-state-title">Nenhuma temporada ativa</p>
        <p>Aguarde o administrador iniciar uma temporada.</p>
      </div>`;
    return;
  }

  // --- Vista simplificada para convidado ---
  if (ctx.is_guest) {
    renderMesaHomeGuest(content, ctx);
    return;
  }

  const { season, round, group, official_slot, my_slots, pending_result, rank_delta } = ctx;
  const hasSlots = my_slots && my_slots.length > 0;
  const slotResolved = official_slot && official_slot.status === 'resolved';
  const athleteCat = ctx.athlete.current_category;

  // Parallel fetch: ranking + history + ranking evolution + payment status
  let myRank = null, catRanking = [], historyList = [], rankEvolution = [], paymentStatus = null;
  const [rankRes, histRes, rankEvolRes, payRes] = await Promise.allSettled([
    season && athleteCat ? api(`/api/seasons/${season.id}/ranking?cat=${athleteCat}`) : Promise.resolve({}),
    api('/api/mesa/history'),
    ctx.athlete?.id && season?.id
      ? api(`/api/athletes/${ctx.athlete.id}/ranking-history?season_id=${season.id}`)
      : Promise.resolve({ history: [] }),
    api('/api/mesa/payment-status'),
  ]);
  if (rankRes.status === 'fulfilled') {
    catRanking = rankRes.value[athleteCat] || [];
    myRank = catRanking.find(r => r.athlete_id === ctx.athlete.id) || null;
  }
  if (histRes.status === 'fulfilled') {
    historyList = histRes.value.history || [];
  }
  if (rankEvolRes.status === 'fulfilled') {
    rankEvolution = (rankEvolRes.value.history || []).filter(h => h.cat === athleteCat);
  }
  if (payRes.status === 'fulfilled') {
    paymentStatus = payRes.value;
  }

  let pendencias = [];
  if (round && !hasSlots) pendencias.push({ icon: '⏰', text: 'Marcar slots de disponibilidade', link: '#mesa/slots', urgent: true });
  if (pending_result) pendencias.push({ icon: '📋', text: 'Confirmar resultado do grupo', link: '#mesa/resultado', urgent: true });
  if (paymentStatus?.payments_enabled !== false && paymentStatus?.season_id && !paymentStatus.paid && paymentStatus.payment_amount > 0)
    pendencias.push({ icon: '💳', text: 'Pagamento da temporada pendente', link: '#mesa/pagamento', urgent: true });
  if (group && slotResolved) pendencias.push({ icon: '✅', text: `Horário definido: ${official_slot.slot}`, link: '#mesa/grupo', urgent: false });
  if (group && !slotResolved && hasSlots) pendencias.push({ icon: '🕐', text: 'Aguardando horário oficial do grupo', link: '#mesa/grupo', urgent: false });

  // Ranking mini-section: top 5 + neighborhood
  function buildMiniRanking() {
    if (!catRanking.length) return '';
    const myIdx = catRanking.findIndex(r => r.athlete_id === ctx.athlete.id);
    const medals = ['🥇','🥈','🥉'];

    function rankRow(r, idx, isMe) {
      const pos = idx + 1;
      const medal = medals[idx] || '';
      const delta = r.rank_delta;
      let deltaTag = '';
      if (delta !== null && delta !== undefined) {
        if (delta > 0)
          deltaTag = `<span class="rank-tbl-delta rank-tbl-up">▲${delta}</span>`;
        else if (delta < 0)
          deltaTag = `<span class="rank-tbl-delta rank-tbl-down">▼${Math.abs(delta)}</span>`;
      }
      return `<div class="mini-rank-row${isMe ? ' mini-rank-me' : ''}">
        <span class="mini-rank-pos">${(r.results_count ?? 0) === 0 ? '<span class="rank-unranked">–</span>' : (medal || pos + '°')}</span>
        <span class="mini-rank-nome">${escapeHtml(r.nome || r.athlete_id)}${isMe ? ' <span class="mini-rank-you">você</span>' : ''}${deltaTag}</span>
        <span class="mini-rank-pts">${r.points} pts</span>
      </div>`;
    }

    const top5 = catRanking.slice(0, 5);
    let rows = top5.map((r, i) => rankRow(r, i, r.athlete_id === ctx.athlete.id));

    // If athlete is beyond top 5, show separator + neighborhood
    if (myIdx >= 5) {
      const start = Math.max(5, myIdx - 2);
      const end   = Math.min(catRanking.length, myIdx + 3);
      const neighborhood = catRanking.slice(start, end);
      rows.push(`<div class="mini-rank-dots">···</div>`);
      neighborhood.forEach((r, i) => {
        rows.push(rankRow(r, start + i, r.athlete_id === ctx.athlete.id));
      });
    }

    return `
      <div class="mini-ranking-card" style="margin-bottom:16px;">
        <div class="mini-ranking-header">
          <span>Ranking ${catLabel(athleteCat)}</span>
          <a href="#mesa/ranking" class="mini-ranking-link">Ver completo →</a>
        </div>
        ${rows.join('')}
      </div>`;
  }

  const catTotal = catRanking.length;
  const rank = myRank?.rank;
  // Atleta sem rodadas jogadas: ainda não tem posição legítima.
  const notPlayed = (myRank?.results_count ?? 0) === 0;

  // Promo/releg: textos concretos (pts de distância). Só faz sentido após jogar.
  let promoRelegHtml = '';
  if (myRank && catTotal > 0 && !notPlayed) {
    const m = catTotal >= 8 ? 2 : 1;
    const showPromo = athleteCat !== 'A';
    const showReleg = athleteCat !== 'D';
    let promoText = '', relegText = '';

    if (showPromo) {
      if (rank <= m) {
        promoText = `<span style="color:#22C55E;font-weight:700;">Você está na zona de promoção!</span>`;
      } else {
        const gap = (catRanking[m - 1]?.points ?? 0) - myRank.points;
        promoText = gap > 0
          ? `<span style="color:#22C55E;">${gap} pt${gap !== 1 ? 's' : ''} atrás do ${m}° (promove)</span>`
          : `<span style="color:#22C55E;font-weight:700;">Empatado na zona de promoção!</span>`;
      }
    }
    if (showReleg) {
      const relegCutIdx = catTotal - m; // 0-based index of first relegated
      const relegEntry = catRanking[relegCutIdx];
      if (rank > catTotal - m) {
        relegText = `<span style="color:#EF4444;font-weight:700;">Você está na zona de rebaixamento!</span>`;
      } else if (relegEntry) {
        const gap = myRank.points - relegEntry.points;
        relegText = gap > 0
          ? `<span style="color:#EF4444;">${gap} pt${gap !== 1 ? 's' : ''} acima da zona de rebaixamento</span>`
          : `<span style="color:#EF4444;font-weight:700;">Empatado com a zona de rebaixamento!</span>`;
      }
    }
    if (promoText || relegText) {
      promoRelegHtml = `<div style="display:flex;flex-direction:column;gap:4px;margin-bottom:var(--space-md);font-size:12px;">
        ${promoText ? `<div>⬆ ${promoText}</div>` : ''}
        ${relegText ? `<div>⬇ ${relegText}</div>` : ''}
      </div>`;
    }
  }

  // Badge de evolução de posição (separado do número grande)
  let deltaBadge = '';
  if (rank_delta !== null && rank_delta !== undefined) {
    if (rank_delta > 0)
      deltaBadge = `<span class="rank-delta-badge rank-delta-up">▲ ${rank_delta} pos.</span>`;
    else if (rank_delta < 0)
      deltaBadge = `<span class="rank-delta-badge rank-delta-down">▼ ${Math.abs(rank_delta)} pos.</span>`;
    else
      deltaBadge = `<span class="rank-delta-badge rank-delta-same">= mesma pos.</span>`;
  }

  // Últimas 3 partidas (mais recentes primeiro)
  const recentMatches = [...historyList]
    .sort((a, b) => (b.round_number ?? 0) - (a.round_number ?? 0))
    .slice(0, 3);

  function miniMatchCard(h) {
    const rankColor = h.rank_in_group === 1 ? 'var(--color-primary)' : h.rank_in_group === 2 ? '#C0C0C0' : h.rank_in_group === 3 ? '#CD7F32' : 'var(--color-text-muted)';
    const setsHtml = (h.set_scores?.length ? h.set_scores : (h.my_sets || []).map(s => ({ won: s === 3 })))
      .map(s => {
        if (s.wo) return `<span style="font-size:10px;padding:1px 5px;border-radius:4px;background:rgba(217,64,64,.15);color:#D94040;">WO</span>`;
        const won = s.won ?? (s.score_mine > s.score_opp);
        const bg = won ? 'rgba(255,140,0,.15)' : 'rgba(255,255,255,.06)';
        const col = won ? 'var(--color-primary)' : 'var(--color-text-muted)';
        const lbl = s.score_mine !== undefined ? `${s.score_mine}–${s.score_opp}${s.is_super_tiebreak ? ' STB' : ''}` : (won ? '3pts' : '1pt');
        return `<span style="font-size:10px;padding:1px 5px;border-radius:4px;background:${bg};color:${col};font-weight:600;">${lbl}</span>`;
      }).join('');
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
        <div>
          <span style="font-size:11px;color:var(--color-text-muted);">${catLabel(h.cat)} · Rod. ${h.round_number ?? '—'}</span>
          <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px;">${setsHtml}</div>
        </div>
        <div style="text-align:right;flex-shrink:0;margin-left:10px;">
          <div style="font-size:16px;font-weight:800;color:${rankColor};">${h.rank_in_group}°</div>
          <div style="font-size:11px;color:var(--color-text-muted);">${h.my_total ?? 0} pts</div>
        </div>
      </div>`;
  }

  const lastResultHtml = recentMatches.length ? `
    <div class="card" style="padding:12px 16px;margin-bottom:16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
        <p style="font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--color-text-muted);">Últimas Partidas</p>
        <a href="#mesa/historico" style="font-size:12px;color:var(--color-primary);text-decoration:none;">Ver tudo →</a>
      </div>
      ${recentMatches.map(miniMatchCard).join('')}
    </div>` : '';

  // Hero card
  const heroHtml = myRank ? `
    <div class="mesa-hero-card">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
        ${avatarHtml(ctx.athlete.photo_url, ctx.athlete.nome, 44)}
        <div>
          <div class="mesa-hero-greeting" style="margin:0;font-size:12px;">Olá,</div>
          <div class="mesa-hero-name" style="margin:0;">${escapeHtml(ctx.athlete.nome)}</div>
        </div>
      </div>
      <div class="mesa-hero-cat-row">
        <span class="badge badge-cat-${athleteCat?.toLowerCase()}">${catLabel(athleteCat)}</span>
      </div>
      <div class="mesa-hero-rank-block">
        <span class="mesa-hero-rank-pos">${notPlayed ? '–' : rank + '°'}</span>
        <div class="mesa-hero-pts-block">
          <div class="mesa-hero-pts-value">${myRank.points}</div>
          <div class="mesa-hero-pts-label">pontos</div>
        </div>
      </div>
      ${deltaBadge ? `<div style="margin-bottom:10px;">${deltaBadge}</div>` : ''}
      ${promoRelegHtml}
      <div class="mesa-stats-grid">
        <div class="mesa-stat-cell">
          <div class="mesa-stat-value">${myRank.wins}</div>
          <div class="mesa-stat-label">Sets Ganhos</div>
        </div>
        <div class="mesa-stat-cell">
          <div class="mesa-stat-value">${myRank.games_won ?? '—'}/${myRank.games_lost ?? '—'}</div>
          <div class="mesa-stat-label">Games G/P</div>
        </div>
        <div class="mesa-stat-cell">
          <div class="mesa-stat-value">${myRank.results_count ?? 0}/${round ? round.rounds_total : '—'}</div>
          <div class="mesa-stat-label">Rodadas</div>
        </div>
      </div>
      ${rankEvolution.length >= 1 ? `
        <div style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.07);">
          <p style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;
             color:var(--color-text-muted);margin-bottom:8px;">Evolução de Posição</p>
          ${svgRankEvolution(rankEvolution.slice(-8))}
        </div>` : ''}
      <a href="#publico/atleta/${ctx.athlete.id}" style="display:block;text-align:center;font-size:12px;color:var(--color-text-muted);text-decoration:none;margin-top:12px;">👤 Ver meu perfil público</a>
    </div>` : `
    <div class="mesa-hero-card">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
        ${avatarHtml(ctx.athlete.photo_url, ctx.athlete.nome, 44)}
        <div>
          <div class="mesa-hero-greeting" style="margin:0;font-size:12px;">Olá,</div>
          <div class="mesa-hero-name" style="margin:0;">${escapeHtml(ctx.athlete.nome)}</div>
        </div>
      </div>
      <div class="mesa-hero-cat-row">
        <span class="badge badge-cat-${athleteCat?.toLowerCase()}">${catLabel(athleteCat)}</span>
      </div>
      <p style="font-size:13px;color:var(--color-text-muted);margin-top:8px;">Sem dados de ranking ainda.</p>
      <a href="#publico/atleta/${ctx.athlete.id}" style="display:block;text-align:center;font-size:12px;color:var(--color-text-muted);text-decoration:none;margin-top:12px;">👤 Ver meu perfil público</a>
    </div>`;

  content.innerHTML = `
    <div style="padding:var(--space-md);">
      ${heroHtml}

      ${round ? `
        <div class="card" style="margin-bottom:16px;">
          <p style="font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--color-text-muted);margin-bottom:4px;">Rodada Atual</p>
          <p style="font-size:20px;font-weight:700;color:var(--color-primary);">Rodada ${round.round_number} de ${round.rounds_total}</p>
          ${round.target_date ? `<p style="font-size:13px;color:var(--color-text-muted);">Data: ${round.target_date}</p>` : ''}
          ${round.deadline_slots ? `<p style="font-size:13px;font-weight:700;color:${deadlineUrgencyColor(round.deadline_slots)};">⏰ ${deadlineUrgencyText(round.deadline_slots)}</p>` : ''}
          ${ctx.round_progress ? (() => {
            const { confirmed, total } = ctx.round_progress;
            const pct = Math.round(100 * confirmed / (total || 1));
            return `<div style="margin-top:10px;">
              <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--color-text-muted);margin-bottom:4px;">
                <span>Resultados confirmados</span>
                <span>${confirmed}/${total}</span>
              </div>
              <div class="round-progress-track">
                <div class="round-progress-fill" style="width:${pct}%;"></div>
              </div>
            </div>`;
          })() : ''}
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
          <p style="font-size:13px;font-weight:600;">Grupos</p>
          ${group ? `<p style="font-size:11px;color:var(--color-text-muted);">Meu grupo: Cat ${group.category} · G${group.group_index + 1}</p>` : ''}
        </a>
        ${(() => {
          const rs = ctx.result_status || 'none';
          const accentBorder = (rs === 'pending_mine') ? 'border-left:3px solid var(--color-accent);' : '';
          const icon  = rs === 'confirmed' ? '✅' : rs === 'pending_mine' ? '🔔' : rs === 'contested' ? '⚑' : '📋';
          const label = rs === 'confirmed'     ? 'Resultado'
                      : rs === 'pending_mine'  ? 'Confirmar Resultado'
                      : rs === 'pending_peers' ? 'Resultado'
                      : rs === 'contested'     ? 'Resultado'
                      :                          'Lançar Resultado';
          const sub_  = rs === 'confirmed'     ? 'Placar confirmado'
                      : rs === 'pending_mine'  ? 'Aguardando sua confirmação'
                      : rs === 'pending_peers' ? 'Aguardando colegas'
                      : rs === 'contested'     ? 'Contestado — admin revisando'
                      : round                  ? 'Toque para inserir o placar'
                      :                          'Sem rodada ativa';
          return `<a href="#mesa/resultado" class="card" style="display:block;text-align:center;text-decoration:none;${accentBorder}">
            <p style="font-size:20px;margin-bottom:4px;">${icon}</p>
            <p style="font-size:13px;font-weight:600;">${label}</p>
            <p style="font-size:11px;color:var(--color-text-muted);">${sub_}</p>
          </a>`;
        })()}
        <a href="#mesa/ranking" class="card" style="display:block;text-align:center;text-decoration:none;">
          <p style="font-size:20px;margin-bottom:4px;">🏆</p>
          <p style="font-size:13px;font-weight:600;">Ranking</p>
          ${myRank ? `<p style="font-size:11px;color:var(--color-text-muted);">${notPlayed ? 'sem jogos ainda' : myRank.rank + '° lugar'}</p>` : ''}
        </a>
      </div>

      ${buildMiniRanking()}

      ${lastResultHtml}

      <div id="mesa-schedule-block" style="margin-bottom:16px;"></div>
    </div>`;

  // Load round schedule asynchronously
  if (season) {
    api(`/api/seasons/${season.id}/schedule`).then(data => {
      const block = content.querySelector('#mesa-schedule-block');
      if (!block || !data.schedule || !data.schedule.length) return;
      const STATUS_LABEL = { pending: 'Pendente', scheduled: 'Agendada', in_progress: 'Em andamento', closed: 'Encerrada' };
      const STATUS_COLOR = { pending: 'var(--color-text-muted)', scheduled: '#22C55E', in_progress: 'var(--color-gold)', closed: 'var(--color-text-muted)' };
      const rows = data.schedule.map(r => {
        const label = STATUS_LABEL[r.status] || r.status;
        const color = STATUS_COLOR[r.status] || 'var(--color-text-muted)';
        const period = r.start_date && r.end_date ? `${fmtDate(r.start_date)} – ${fmtDate(r.end_date)}` : r.end_date ? fmtDate(r.end_date) : '—';
        return `<div class="sched-row${r.status === 'closed' ? ' sched-closed' : r.status === 'in_progress' ? ' sched-active' : ''}">
          <span class="sched-num">R${r.round_number}</span>
          <span class="sched-period">${period}</span>
          <span class="sched-status" style="color:${color};">${label}</span>
        </div>`;
      }).join('');
      block.innerHTML = `
        <div class="card" style="padding:12px 16px;">
          <p style="font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--color-text-muted);margin-bottom:8px;">
            Calendário de Rodadas
          </p>
          <div class="sched-list">${rows}</div>
        </div>`;
    }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Mesa: Ranking
// ---------------------------------------------------------------------------

async function renderMesaRanking(content, ctx, selectedSeasonId = null) {
  const myId  = ctx?.athlete?.id;
  const myCat = ctx?.athlete?.current_category;

  content.innerHTML = `<p class="placeholder-text" style="padding:var(--space-md);">Carregando ranking…</p>`;

  // Fetch seasons list alongside ranking for the selected season
  let seasons = [];
  try { seasons = await api('/api/seasons'); } catch (_) {}

  const activeSeason   = ctx?.season || seasons.find(s => s.status === 'active');
  const selectedSeason = (selectedSeasonId && seasons.find(s => s.id === selectedSeasonId)) || activeSeason;

  if (!selectedSeason) {
    content.innerHTML = `<div style="padding:var(--space-md);"><p class="placeholder-text">Nenhuma temporada ativa.</p></div>`;
    return;
  }

  let allRanking = {};
  try {
    allRanking = await api(`/api/seasons/${selectedSeason.id}/ranking`);
  } catch (err) {
    content.innerHTML = `<div style="padding:var(--space-md);"><p class="placeholder-text">Erro ao carregar ranking.</p></div>`;
    return;
  }

  const CATS = ['A','B','C','D'];
  const availCats = CATS.filter(c => (allRanking[c] || []).length > 0);
  if (!availCats.length) {
    content.innerHTML = `<div style="padding:var(--space-md);">
      <h2 style="font-size:18px;font-weight:700;color:var(--color-primary);margin-bottom:12px;">Ranking</h2>
      <p style="color:var(--color-text-muted);">Ainda sem dados de ranking. Os resultados aparecerão aqui após as primeiras partidas.</p>
    </div>`;
    return;
  }

  // Pre-select athlete's category if available, otherwise first with data
  let activeCat = (myCat && availCats.includes(myCat)) ? myCat : availCats[0];

  const medals = ['🥇','🥈','🥉'];

  function renderTable(cat) {
    const rows = allRanking[cat] || [];
    if (!rows.length) return `<p style="color:var(--color-text-muted);padding:20px 16px;">Nenhum atleta nesta categoria ainda.</p>`;
    const n = rows.length;
    const m = n >= 8 ? 2 : 1;
    const hasPromo = cat !== 'A' && n >= 4;
    const hasReleg = cat !== 'D' && n >= 4;

    const tableRows = rows.map((r, i) => {
      const isMe = r.athlete_id === myId;
      const pos  = i + 1;
      const medal = medals[i] || '';
      const inPromo = hasPromo && pos <= m;
      const inReleg = hasReleg && pos > n - m;
      let trClass = isMe ? 'mesa-ranking-me' : '';
      if (inPromo) trClass += ' zone-promo';
      if (inReleg) trClass += ' zone-releg';
      const gw = r.games_won ?? '—';
      const gl = r.games_lost ?? '—';
      const rd = r.results_count ?? 0;
      const delta = r.rank_delta;
      let deltaTag = '';
      if (delta !== null && delta !== undefined) {
        if (delta > 0)
          deltaTag = `<span class="rank-tbl-delta rank-tbl-up" title="Subiu ${delta} posição${delta !== 1 ? 'ões' : ''}">▲${delta}</span>`;
        else if (delta < 0)
          deltaTag = `<span class="rank-tbl-delta rank-tbl-down" title="Caiu ${Math.abs(delta)} posição${Math.abs(delta) !== 1 ? 'ões' : ''}">▼${Math.abs(delta)}</span>`;
      }
      return `<tr class="${trClass.trim()}">
        <td class="mesa-ranking-pos">${rd === 0 ? '<span class="rank-unranked">–</span>' : (medal || (pos + '°'))}</td>
        <td class="mesa-ranking-nome">${escapeHtml(r.nome || r.athlete_id)}${isMe ? ' <span class="mesa-ranking-you-tag">você</span>' : ''}${deltaTag}</td>
        <td class="mesa-ranking-pts">${r.points}</td>
        <td class="mesa-ranking-stat">${r.wins}</td>
        <td class="mesa-ranking-stat">${gw}/${gl}</td>
        <td class="mesa-ranking-stat" style="font-size:11px;color:var(--color-text-muted);">${rd}R</td>
      </tr>`;
    });

    // Separator rows at zone boundaries
    const withSeparators = [];
    rows.forEach((r, i) => {
      const pos = i + 1;
      // After last promo spot
      if (hasPromo && pos === m) {
        withSeparators.push(tableRows[i]);
        withSeparators.push(`<tr class="zone-separator"><td colspan="6" class="zone-sep-promo">▲ Zona de Promoção acima</td></tr>`);
      // Before first releg spot
      } else if (hasReleg && pos === n - m) {
        withSeparators.push(tableRows[i]);
        withSeparators.push(`<tr class="zone-separator"><td colspan="6" class="zone-sep-releg">▼ Zona de Rebaixamento abaixo</td></tr>`);
      } else {
        withSeparators.push(tableRows[i]);
      }
    });

    return `${rankingNotStartedNote(rows)}<table class="mesa-ranking-table">
      <thead><tr>
        <th>#</th><th>Atleta</th><th>Pts</th><th>V</th><th>Games</th><th>R</th>
      </tr></thead>
      <tbody>${withSeparators.join('')}</tbody>
    </table>`;
  }

  function paint(cat) {
    content.querySelector('#mesa-ranking-table-area').innerHTML = renderTable(cat);
    // Scroll highlighted row into view
    const meRow = content.querySelector('.mesa-ranking-me');
    if (meRow) meRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    // Update active tab
    content.querySelectorAll('.mesa-ranking-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.cat === cat);
    });
  }

  const tabs = availCats.map(c => `
    <button class="mesa-ranking-tab${c === activeCat ? ' active' : ''}" data-cat="${c}">
      ${catLabel(c)}
    </button>`).join('');

  const seasonSelectHtml = seasons.length > 1 ? `
    <select id="mesa-ranking-season-sel" class="input" style="font-size:12px;max-width:200px;margin-bottom:10px;">
      ${seasons.map(s => `<option value="${s.id}"${s.id === selectedSeason.id ? ' selected' : ''}>${escapeHtml(s.name)}${s.status === 'active' ? ' ✓' : ''}</option>`).join('')}
    </select>` : '';

  content.innerHTML = `
    <div style="padding:var(--space-md);">
      <h2 style="font-size:18px;font-weight:700;color:var(--color-primary);margin-bottom:8px;">Ranking</h2>
      ${seasonSelectHtml}
      <div class="mesa-ranking-tabs">${tabs}</div>
      <div id="mesa-ranking-table-area">${renderTable(activeCat)}</div>
    </div>`;

  content.querySelector('#mesa-ranking-season-sel')?.addEventListener('change', e => {
    renderMesaRanking(content, ctx, e.target.value);
  });

  content.querySelectorAll('.mesa-ranking-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      activeCat = btn.dataset.cat;
      paint(activeCat);
    });
  });

  // Auto-scroll to athlete on first load
  const meRow = content.querySelector('.mesa-ranking-me');
  if (meRow) meRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ---------------------------------------------------------------------------
// Mesa: Notificações
// ---------------------------------------------------------------------------

async function renderMesaNotificacoes(content) {
  content.innerHTML = `<p class="placeholder-text" style="padding:var(--space-md);">Carregando notificações…</p>`;

  let data = { notifications: [], unread: 0 };
  try {
    data = await api('/api/mesa/notifications');
    await api('/api/mesa/notifications/read', { method: 'PUT' });
    // Clear badge
    const badge = document.getElementById('notif-badge');
    if (badge) { badge.textContent = ''; badge.style.display = 'none'; }
  } catch (_) {}

  const { notifications } = data;
  const ICONS = {
    result_submitted: '📋',
    slot_confirmed: '📅',
    contest_resolved: '⚖️',
    wo_applied: '🚨',
    round_drawn: '🎯',
    deadline_reminder: '⏰',
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  const header = `
    <div class="section-header">
      <div>
        <h1 class="section-title">Notificações</h1>
        ${unreadCount > 0 ? `<p class="section-subtitle">${unreadCount} não lida${unreadCount !== 1 ? 's' : ''}</p>` : ''}
      </div>
      ${unreadCount > 0
        ? `<button id="btn-mark-all-read" class="btn btn-ghost btn-sm" style="font-size:12px;">
             ✓ Marcar todas como lidas
           </button>`
        : ''}
    </div>`;

  if (!notifications.length) {
    content.innerHTML = header + `
      <div style="text-align:center;padding:48px 20px;">
        <div style="font-size:40px;margin-bottom:12px;">🔔</div>
        <p style="color:var(--color-text-muted);">Nenhuma notificação ainda.</p>
      </div>`;
    return;
  }

  const items = notifications.map(n => {
    const icon = ICONS[n.type] || '🔔';
    const date = n.created_at ? new Date(n.created_at + 'Z').toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '';
    const isUnread = !n.read;
    return `
      <div class="notif-item${isUnread ? ' unread' : ''}"${n.link ? ` onclick="location.hash='${n.link}'" style="cursor:pointer;"` : ''}>
        <span class="notif-icon">${icon}</span>
        <div class="notif-body">
          <p class="notif-title">${escapeHtml(n.title)}</p>
          <p class="notif-text">${escapeHtml(n.body)}</p>
          <p class="notif-date">${date}</p>
        </div>
        ${isUnread ? '<span class="notif-dot"></span>' : ''}
      </div>`;
  }).join('');

  content.innerHTML = header + `<div class="notif-list">${items}</div>`;

  content.querySelector('#btn-mark-all-read')?.addEventListener('click', async () => {
    try {
      await api('/api/mesa/notifications/read', { method: 'PUT' });
      const badge = document.getElementById('notif-badge');
      if (badge) { badge.textContent = ''; badge.style.display = 'none'; }
      await renderMesaNotificacoes(content);
    } catch (err) {
      showToast('Erro: ' + err.message, 'error');
    }
  });
}

// ---------------------------------------------------------------------------
// Mesa: Marcar Slots (Art. 26 + Art. 28)
// ---------------------------------------------------------------------------

function renderMesaSlots(content, ctx) {
  if (!ctx || !ctx.round) {
    content.innerHTML = `<p class="placeholder-text">Nenhuma rodada ativa.</p>`;
    return;
  }

  // Lock check: if group slot was auto-resolved and not yet unlocked, show locked UI
  const official_slot = ctx.official_slot;
  if (official_slot?.status === 'resolved' &&
      official_slot?.resolved_by === 'auto' &&
      !official_slot?.unlock_approved) {
    _renderLockedSlots(content, ctx.round, official_slot);
    return;
  }

  const { round, my_slots = [], eligible_slots: eligible = [], group_slots_map: groupMap = {} } = ctx;

  // New format: "YYYY-MM-DD HH:MM"; old: "HH:MM"
  const isNewFmt = eligible.length > 0 && eligible[0].includes('-');

  if (!isNewFmt) {
    // Legacy simple UI (rounds created before the overhaul)
    let selected = new Set(my_slots);
    const MORNING = ["06:00","06:30","07:00","07:30"];
    const isWeekend = eligible.includes("08:00") && !eligible.includes("06:00");
    function renderSlotBtn(slot) {
      return `<button class="slot-btn${selected.has(slot) ? ' selected' : ''}" data-slot="${slot}">${slot}</button>`;
    }
    function buildGrid() {
      if (isWeekend) return `<p class="slots-period-label">Fim de Semana / Feriado (07:00–10:00)</p><div class="slots-row">${eligible.map(renderSlotBtn).join('')}</div>`;
      return `<p class="slots-period-label">Manhã (06:00–08:00)</p><div class="slots-row">${eligible.filter(s=>MORNING.includes(s)).map(renderSlotBtn).join('')}</div>
              <p class="slots-period-label">Tarde/Noite (16:30–21:00)</p><div class="slots-row">${eligible.filter(s=>!MORNING.includes(s)).map(renderSlotBtn).join('')}</div>`;
    }
    content.innerHTML = `<div class="slots-screen"><h2 style="font-size:18px;font-weight:700;color:var(--color-primary);margin-bottom:4px;">Marcar Slots</h2>
      <p class="slots-summary" id="slots-summary">${selected.size} slot${selected.size!==1?'s':''} selecionado${selected.size!==1?'s':''}</p>
      <div id="slots-grid">${buildGrid()}</div>
      <div style="display:flex;gap:12px;margin-top:20px;">
        <button id="btn-limpar" class="btn btn-ghost">Limpar tudo</button>
        <button id="btn-salvar-slots" class="btn btn-primary">Salvar slots</button>
      </div><p id="slots-msg" class="hidden" style="margin-top:12px;font-size:13px;"></p></div>`;
    function refreshLegacy() {
      content.querySelector('#slots-grid').innerHTML = buildGrid();
      content.querySelector('#slots-summary').textContent = `${selected.size} slot${selected.size!==1?'s':''} selecionado${selected.size!==1?'s':''}`;
      content.querySelectorAll('.slot-btn').forEach(b => b.addEventListener('click', () => { const s=b.dataset.slot; selected.has(s)?selected.delete(s):selected.add(s); refreshLegacy(); }));
    }
    refreshLegacy();
    content.querySelector('#btn-limpar').addEventListener('click', () => { selected.clear(); refreshLegacy(); });
    content.querySelector('#btn-salvar-slots').addEventListener('click', async () => {
      const msgEl = content.querySelector('#slots-msg');
      const btn = content.querySelector('#btn-salvar-slots');
      btn.disabled = true; btn.textContent = 'Salvando…';
      let savedOk = false;
      try {
        const res = await api(`/api/rounds/${round.id}/slots`, { method: 'PUT', body: { slots: [...selected] } });
        savedOk = true;
        msgEl.textContent = res.auto_resolved ? `✓ Slots salvos! Horário do grupo: ${res.auto_slot}` : '✓ Slots salvos!';
        msgEl.style.color = 'var(--color-cat-c)'; msgEl.classList.remove('hidden');
        btn.textContent = '✓ Salvo';
        const editBtn = document.createElement('button');
        editBtn.className = 'btn btn-ghost'; editBtn.textContent = '✏️ Editar';
        editBtn.addEventListener('click', () => {
          btn.textContent = 'Salvar slots'; btn.disabled = false;
          editBtn.remove(); msgEl.classList.add('hidden');
        });
        btn.parentNode.insertBefore(editBtn, btn.nextSibling);
        if (res.auto_resolved || res.all_submitted) {
          openSlotNotificationModal({
            resolved: res.auto_resolved, slot: res.auto_slot,
            cat: ctx.group?.category, groupIndex: ctx.group?.group_index,
            roundNumber: round.round_number, location: ctx.group?.location,
            members: ctx.group_slots_status || [], myId: ctx.athlete?.id,
          });
        }
      } catch (err) {
        if (err.status === 423) {
          _renderLockedSlots(content, round, {
            slot: err.slot, status: 'resolved', resolved_by: 'auto',
            unlock_request: err.unlock_request,
          });
          return;
        }
        msgEl.textContent = `Erro: ${err.message}`; msgEl.style.color = '#D94040'; msgEl.classList.remove('hidden');
      } finally {
        if (!savedOk) { btn.disabled = false; btn.textContent = 'Salvar slots'; }
      }
    });
    return;
  }

  // ── New calendar-strip UI ──────────────────────────────────────────────────

  const MORNING = ["06:00","06:30","07:00","07:30"];
  const DAY_ABBR = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const DAY_FULL = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];

  // Group eligible slots by date
  const byDate = {};
  for (const slot of eligible) {
    const [date, time] = slot.split(' ');
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(time);
  }
  const dates = Object.keys(byDate).sort();

  function isWeekday(dateStr) {
    const dow = new Date(dateStr + 'T12:00:00').getDay();
    return dow >= 1 && dow <= 5;
  }

  let selected = new Set(my_slots.filter(s => s.includes('-')));
  let activeDate = dates[0] || null;
  let replicationTargets = new Set(); // dates chosen to receive replication

  function countByDate(date) {
    return (byDate[date] || []).filter(t => selected.has(`${date} ${t}`)).length;
  }

  function getTimesForDate(date) {
    return (byDate[date] || []).filter(t => selected.has(`${date} ${t}`));
  }

  function fmtDeadline(dl) {
    if (!dl) return '';
    try {
      return new Date(dl).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit', timeZone:'America/Sao_Paulo' });
    } catch(_) { return dl; }
  }

  function buildCalStrip() {
    return `<div class="cal-strip">
      ${dates.map(date => {
        const d = new Date(date + 'T12:00:00');
        const dow = d.getDay();
        const weekend = dow === 0 || dow === 6;
        const count = countByDate(date);
        const isActive = date === activeDate;
        return `<button class="cal-day${weekend?' weekend':''}${count>0?' has-slots':''}${isActive?' active':''}" data-date="${date}">
          <span class="cal-day-abbr">${DAY_ABBR[dow]}</span>
          <span class="cal-day-date">${date.slice(5)}</span>
          ${count>0 ? `<span class="cal-day-count">${count}</span>` : ''}
        </button>`;
      }).join('')}
    </div>`;
  }

  function buildTimesPanel(date) {
    if (!date) return '';
    const times = byDate[date] || [];
    const weekend = !isWeekday(date);
    const morning = weekend ? [] : times.filter(t => MORNING.includes(t));
    const afternoon = weekend ? [] : times.filter(t => !MORNING.includes(t));
    const wkendTimes = weekend ? times : [];
    const renderBtn = time => {
      const slot = `${date} ${time}`;
      const peers = groupMap[slot] || 0;
      const total = peers + (selected.has(slot) ? 1 : 0);
      const badge = total > 0 ? `<span class="slot-peer-badge${total >= 4 ? ' slot-peer-full' : ''}">${total}</span>` : '';
      return `<button class="slot-btn${selected.has(slot)?' selected':''}" data-slot="${slot}">${time}${badge}</button>`;
    };
    return weekend
      ? `<p class="slots-period-label">Fim de Semana / Feriado (07:00–10:00)</p>
         <div class="slots-row">${wkendTimes.map(renderBtn).join('')}</div>`
      : `<p class="slots-period-label">Manhã (06:00–08:00)</p>
         <div class="slots-row">${morning.map(renderBtn).join('')}</div>
         <p class="slots-period-label">Tarde/Noite (16:30–21:00)</p>
         <div class="slots-row">${afternoon.map(renderBtn).join('')}</div>`;
  }

  function buildReplicationPanel(date) {
    if (!date) return '';
    const activeIsWeekend = !isWeekday(date);
    const peers = dates.filter(d => d !== date && (activeIsWeekend ? !isWeekday(d) : isWeekday(d)));
    if (!peers.length) return '';

    const selTimes = getTimesForDate(date);
    const hasSelection = selTimes.length > 0;
    const checkedCount = replicationTargets.size;

    return `
      <div class="replication-panel${!hasSelection ? ' replication-dimmed' : ''}">
        <p class="slots-period-label" style="margin-bottom:8px;">
          ${hasSelection
            ? `Replicar estes horários para:`
            : `Selecione horários acima para poder replicar`}
        </p>
        <div class="replication-day-list">
          ${peers.map(d => {
            const dow = new Date(d + 'T12:00:00').getDay();
            const checked = replicationTargets.has(d);
            const cnt = countByDate(d);
            return `<label class="replication-day-item${checked?' checked':''}${!hasSelection?' disabled':''}">
              <input type="checkbox" class="rep-checkbox" data-date="${d}"
                ${checked ? 'checked' : ''} ${!hasSelection ? 'disabled' : ''}/>
              <span class="rep-day-name">${DAY_FULL[dow]}</span>
              <span class="rep-day-date">${d.slice(5)}</span>
              ${cnt > 0 ? `<span class="rep-day-count">${cnt} slot${cnt>1?'s':''}</span>` : ''}
            </label>`;
          }).join('')}
        </div>
        ${hasSelection && checkedCount > 0 ? `
          <button class="btn btn-primary btn-aplicar-rep" style="margin-top:12px;width:100%;font-size:14px;font-weight:700;">
            ✓ Aplicar a ${checkedCount} dia${checkedCount>1?'s':''} selecionado${checkedCount>1?'s':''}
          </button>` : ''}
      </div>`;
  }

  function refreshPanel() {
    const container = content.querySelector('#times-and-rep');
    if (container) container.innerHTML = buildTimesPanel(activeDate) + buildReplicationPanel(activeDate);
    const total = selected.size;
    const summary = content.querySelector('.slots-summary');
    if (summary) summary.textContent = `${total} slot${total!==1?'s':''} selecionado${total!==1?'s':''}`;
    // Update cal strip counts without full re-render
    content.querySelectorAll('.cal-day').forEach(chip => {
      const d = chip.dataset.date;
      const cnt = countByDate(d);
      chip.classList.toggle('has-slots', cnt > 0);
      let el = chip.querySelector('.cal-day-count');
      if (cnt > 0) { if (el) el.textContent = cnt; else chip.insertAdjacentHTML('beforeend', `<span class="cal-day-count">${cnt}</span>`); }
      else if (el) el.remove();
    });
    attachInteractions();
  }

  function render() {
    const total = selected.size;
    content.innerHTML = `
      <div class="slots-screen">
        <h2 style="font-size:18px;font-weight:700;color:var(--color-primary);margin-bottom:4px;">Marcar Slots</h2>
        <p style="font-size:13px;color:var(--color-text-muted);margin-bottom:10px;">
          Rodada ${round.round_number}${round.start_date ? ' · ' + round.start_date + ' → ' + round.end_date : ''}
        </p>
        ${round.deadline_slots ? `
          <div class="deadline-bar" style="margin-bottom:10px;color:${deadlineUrgencyColor(round.deadline_slots)};border-color:${deadlineUrgencyColor(round.deadline_slots)};">
            ⏰ <strong>${deadlineUrgencyText(round.deadline_slots)}</strong> · sem marcar = WO automático
          </div>` : ''}
        <p class="slots-summary">${total} slot${total!==1?'s':''} selecionado${total!==1?'s':''}</p>
        ${buildCalStrip()}
        <div id="times-and-rep" style="margin-top:12px;">
          ${buildTimesPanel(activeDate)}
          ${buildReplicationPanel(activeDate)}
        </div>
        <div style="display:flex;gap:12px;margin-top:20px;">
          <button id="btn-limpar" class="btn btn-ghost">Limpar tudo</button>
          <button id="btn-salvar-slots" class="btn btn-primary">Salvar slots</button>
        </div>
        <p id="slots-msg" class="hidden" style="margin-top:12px;font-size:13px;"></p>
      </div>`;

    setTimeout(() => {
      content.querySelector(`.cal-day[data-date="${activeDate}"]`)?.scrollIntoView({ behavior:'smooth', block:'nearest', inline:'center' });
    }, 50);

    // Cal day click → switch day, reset replication targets
    content.querySelectorAll('.cal-day').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.date !== activeDate) {
          activeDate = btn.dataset.date;
          replicationTargets.clear();
        }
        render();
      });
    });

    content.querySelector('#btn-limpar').addEventListener('click', () => {
      selected.clear(); replicationTargets.clear(); render();
    });

    content.querySelector('#btn-salvar-slots').addEventListener('click', async () => {
      const msgEl = content.querySelector('#slots-msg');
      const btn = content.querySelector('#btn-salvar-slots');
      btn.disabled = true; btn.textContent = 'Salvando…';
      let savedOk = false;
      try {
        const res = await api(`/api/rounds/${round.id}/slots`, { method: 'PUT', body: { slots: [...selected] } });
        savedOk = true;
        msgEl.textContent = res.auto_resolved ? `✓ Slots salvos! Horário do grupo: ${res.auto_slot}` : '✓ Slots salvos com sucesso!';
        msgEl.style.color = 'var(--color-cat-c)';
        msgEl.classList.remove('hidden');
        btn.textContent = '✓ Salvo';
        const editBtn = document.createElement('button');
        editBtn.className = 'btn btn-ghost'; editBtn.textContent = '✏️ Editar';
        editBtn.addEventListener('click', () => {
          btn.textContent = 'Salvar slots'; btn.disabled = false;
          editBtn.remove(); msgEl.classList.add('hidden');
        });
        btn.parentNode.insertBefore(editBtn, btn.nextSibling);
        if (res.auto_resolved || res.all_submitted) {
          openSlotNotificationModal({
            resolved: res.auto_resolved, slot: res.auto_slot,
            cat: ctx.group?.category, groupIndex: ctx.group?.group_index,
            roundNumber: round.round_number, location: ctx.group?.location,
            members: ctx.group_slots_status || [], myId: ctx.athlete?.id,
          });
        }
      } catch (err) {
        if (err.status === 423) {
          _renderLockedSlots(content, round, {
            slot: err.slot, status: 'resolved', resolved_by: 'auto',
            unlock_request: err.unlock_request,
          });
          return;
        }
        msgEl.textContent = `Erro: ${err.message}`;
        msgEl.style.color = '#D94040';
        msgEl.classList.remove('hidden');
      } finally {
        if (!savedOk) { btn.disabled = false; btn.textContent = 'Salvar slots'; }
      }
    });

    attachInteractions();
  }

  function attachInteractions() {
    // Slot time buttons
    content.querySelectorAll('.slot-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const slot = btn.dataset.slot;
        if (selected.has(slot)) selected.delete(slot); else selected.add(slot);
        refreshPanel();
      });
    });

    // Replication checkboxes
    content.querySelectorAll('.rep-checkbox').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) replicationTargets.add(cb.dataset.date);
        else replicationTargets.delete(cb.dataset.date);
        refreshPanel();
      });
    });

    // Apply replication (additive: adds to existing slots of target days)
    content.querySelector('.btn-aplicar-rep')?.addEventListener('click', () => {
      const times = getTimesForDate(activeDate);
      const targets = [...replicationTargets];
      const count = targets.length;
      for (const targetDate of targets) {
        for (const time of times) {
          if (byDate[targetDate]?.includes(time)) selected.add(`${targetDate} ${time}`);
        }
      }
      replicationTargets.clear();
      showToast(`Horários replicados para ${count} dia${count>1?'s':''}.`, 'success');
      if (targets.length > 0) activeDate = targets[0];
      render();
    });
  }

  render();
}

// ---------------------------------------------------------------------------
// Mesa: Meu Grupo
// ---------------------------------------------------------------------------

async function renderMesaGrupo(content, ctx) {
  if (!ctx || !ctx.round) {
    content.innerHTML = `
      <div class="empty-state" style="padding:40px 20px;">
        <div class="empty-state-icon">👥</div>
        <p class="empty-state-title">Sem rodada ativa</p>
        <p>Não há rodada em andamento no momento.</p>
      </div>`;
    return;
  }

  const { athlete, group, official_slot, round, confirmed_result } = ctx;
  const slotsStatus = ctx.group_slots_status || [];
  const slotResolved = official_slot && official_slot.status === 'resolved';

  // Render skeleton immediately, then fill async sections
  const myGroupHtml = group ? (() => {
    const slotCard = slotResolved
      ? `<div class="official-slot-card">
           <p class="official-slot-label">Horário Oficial</p>
           <p class="official-slot-time">${official_slot.slot}</p>
           <p class="official-slot-location">📍 ${escapeHtml(group.location)}</p>
         </div>`
      : `<div class="pending-slot-card">
           <p style="font-size:24px;margin-bottom:8px;">🕐</p>
           <p style="font-weight:600;">${official_slot?.status === 'needs_mediation' ? 'Aguardando mediação do admin' : 'Aguardando definição de horário'}</p>
           <p style="font-size:13px;margin-top:4px;">Marque seus slots em <a href="#mesa/slots">Marcar Slots</a></p>
         </div>`;

    const membersHtml = group.names.map((nome, i) => {
      const aid = group.athlete_ids[i];
      const isMe = aid === athlete.id;
      const hasWo = official_slot?.wo_athlete_ids?.includes(aid);
      const memberStatus = slotsStatus.find(s => s.athlete_id === aid);
      return `
        <div class="group-member-row${isMe ? ' is-me' : ''}">
          <span class="slot-status-dot ${memberStatus?.has_slots ? 'done' : 'pending'}" title="${memberStatus?.has_slots ? 'Slots marcados' : 'Sem slots'}"></span>
          <span class="group-member-name">${escapeHtml(nome)}</span>
          ${isMe ? '<span class="badge badge-ativo">Eu</span>' : ''}
          ${hasWo ? '<span class="badge badge-inativo">WO</span>' : ''}
          ${memberStatus?.telefone ? waBtn(memberStatus.telefone) : ''}
        </div>`;
    }).join('');

    const setsHtml = (group.sets_named || []).map(s => {
      let scoreHtml = '';
      if (confirmed_result?.sets) {
        const setDef = confirmed_result.sets.find(sd => sd.set === s.set);
        if (setDef) {
          scoreHtml = `<span class="set-score-result" style="font-size:13px;font-weight:700;color:var(--color-primary);margin-left:auto;">
            ${setDef.score_a}<span style="color:var(--color-text-muted);">–</span>${setDef.score_b}${setDef.is_super_tiebreak ? ' <span style="font-size:10px;">STB</span>' : ''}
          </span>`;
        }
      }
      return `<div class="set-row" style="padding:10px 16px;border-bottom:var(--border);">
        <span class="set-label">Set ${s.set}</span>
        <span class="set-team">${s.team_a.map(escapeHtml).join(' + ')}</span>
        <span class="set-vs">vs</span>
        <span class="set-team">${s.team_b.map(escapeHtml).join(' + ')}</span>
        ${scoreHtml}
      </div>`;
    }).join('');

    return `
      <div class="card" style="border-left:3px solid var(--color-primary);padding:0;overflow:hidden;margin-bottom:20px;">
        <div style="padding:12px 16px;border-bottom:var(--border);display:flex;align-items:center;justify-content:space-between;">
          <div>
            <span style="font-size:13px;font-weight:700;">${catLabel(group.category)} · Grupo ${group.group_index + 1}</span>
          </div>
          <span class="badge badge-ativo">Meu Grupo</span>
        </div>
        <div style="padding:12px 16px;">
          ${slotCard}
          <button id="btn-copy-grupo" class="btn btn-ghost btn-sm" style="width:100%;margin:8px 0 12px;">📋 Copiar info do grupo</button>
          <p style="font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--color-text-muted);margin-bottom:8px;">Atletas</p>
          <div class="group-members-list" style="margin-bottom:16px;">${membersHtml}</div>
          <p style="font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--color-text-muted);margin-bottom:8px;">Sets (Art. 7)</p>
          <div style="border:var(--border);border-radius:8px;overflow:hidden;margin-bottom:16px;">${setsHtml}</div>
          <p style="font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--color-text-muted);margin-bottom:8px;">Mensagens Rápidas</p>
          <div class="quick-msg-grid" id="quick-msg-btns"></div>
          <div id="guest-request-section"></div>
          <p style="font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--color-text-muted);margin:16px 0 8px;">Confronto Direto (H2H)</p>
          <div id="h2h-grupo-section"><p class="placeholder-text" style="font-size:13px;">Carregando H2H…</p></div>
        </div>
      </div>`;
  })() : '';

  content.innerHTML = `
    <div class="grupo-screen">
      <h2 style="font-size:18px;font-weight:700;color:var(--color-primary);margin-bottom:4px;">Grupos</h2>
      <p style="font-size:13px;color:var(--color-text-muted);margin-bottom:16px;">Rodada ${round?.round_number ?? '—'}</p>
      ${myGroupHtml}
      <div id="todos-grupos-section">
        <p class="placeholder-text" style="font-size:13px;">Carregando grupos…</p>
      </div>
    </div>`;

  // Copiar info do grupo para área de transferência
  content.querySelector('#btn-copy-grupo')?.addEventListener('click', () => {
    const lines = [
      `🎾 Rodada ${round?.round_number ?? '—'} — ${catLabel(group.category)}, Grupo ${group.group_index + 1}`,
      `👥 ${group.names.join(', ')}`,
    ];
    if (slotResolved) {
      lines.push(`⏰ Horário: ${official_slot.slot}`);
      if (group.location) lines.push(`📍 ${group.location}`);
    } else {
      lines.push('⏰ Aguardando horário');
    }
    const text = lines.join('\n');
    navigator.clipboard?.writeText(text).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
    });
    showToast('Info do grupo copiada!', 'success');
  });

  // Quick message buttons (populated after innerHTML is set since we need admin phone)
  const msgGrid = content.querySelector('#quick-msg-btns');
  if (msgGrid) {
    const myName = ctx.athlete.apelido || ctx.athlete.nome;
    const mySlots = ctx.my_slots || [];
    const deadline = round?.deadline_slots ? new Date(round.deadline_slots).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';
    const slotStr = official_slot?.slot || '—';
    const loc = group.location || '—';
    const gi = group.group_index;
    const cat = group.category;
    const roundNum = round?.round_number || '—';

    // Fetch admin phone
    let adminPhone = '';
    try { const cfg = await api('/api/config'); adminPhone = cfg.admin_whatsapp || ''; } catch (_) {}

    // Build buttons list
    const btns = [];

    // "Agendar partida" — open modal to message all group members individually
    btns.push({ label: '📅 Agendar partida', action: () => {
      const others = slotsStatus.filter(s => s.athlete_id !== athlete.id && s.telefone);
      if (!others.length) { showToast('Nenhum colega com telefone cadastrado.', 'warning'); return; }
      const first = others[0];
      openMessageModal(
        'Agendar Partida',
        first.nome,
        first.telefone,
        MSG.agendarGrupo(myName, cat, gi, roundNum, mySlots)
      );
    }});

    if (slotResolved) {
      btns.push({ label: '✅ Confirmar horário', action: () => {
        const others = slotsStatus.filter(s => s.athlete_id !== athlete.id && s.telefone);
        if (!others.length) { showToast('Nenhum colega com telefone.', 'warning'); return; }
        openMessageModal('Confirmar Horário', others[0].nome, others[0].telefone,
          MSG.confirmarHorario(myName, cat, gi, roundNum, slotStr, loc));
      }});
    }

    // "Cobrar slots" for teammates without slots
    const semSlots = slotsStatus.filter(s => s.athlete_id !== athlete.id && !s.has_slots && s.telefone);
    if (semSlots.length) {
      btns.push({ label: '⏰ Cobrar slots dos colegas', action: () => {
        openMessageModal('Cobrar Slots', semSlots[0].nome, semSlots[0].telefone,
          MSG.cobrarSlots(myName, semSlots[0].nome, cat, gi, roundNum, deadline));
      }});
    }

    if (adminPhone) {
      btns.push({ label: '🆘 Pedir mediação ao admin', action: () => {
        openMessageModal('Pedir Mediação', 'Admin', adminPhone,
          MSG.pedirMediacao(myName, cat, gi, roundNum));
      }});
      btns.push({ label: '💬 Falar com admin', action: () => {
        openMessageModal('Falar com Admin', 'Admin', adminPhone,
          MSG.falarComAdmin(myName, cat));
      }});
    }

    msgGrid.innerHTML = btns.map((b, i) =>
      `<button class="quick-msg-btn" data-idx="${i}">${b.label}</button>`
    ).join('');
    msgGrid.querySelectorAll('.quick-msg-btn').forEach(btn => {
      btn.addEventListener('click', () => btns[parseInt(btn.dataset.idx)].action());
    });
  }

  // H2H vs each opponent in the group
  const h2hSection = content.querySelector('#h2h-grupo-section');
  if (h2hSection && athlete?.id) {
    const opponents = (group.athlete_ids || []).filter(id => id !== athlete.id && !id.startsWith('guest_'));
    if (!opponents.length) {
      h2hSection.innerHTML = `<p style="font-size:13px;color:var(--color-text-muted);">Sem adversários para comparar.</p>`;
    } else {
      const h2hResults = await Promise.allSettled(
        opponents.map(id => api(`/api/h2h/${athlete.id}/${id}`))
      );
      const cards = opponents.map((oppId, i) => {
        const res = h2hResults[i];
        if (res.status !== 'fulfilled') return '';
        const h2h = res.value;
        const s = h2h.summary;
        const oppNome = h2h.athlete_b.nome;
        const wins = s.a_wins, losses = s.b_wins, draws = s.draws;
        const color = wins > losses ? 'var(--color-primary)' : losses > wins ? '#D94040' : 'var(--color-text-muted)';
        return `
          <div class="card" style="padding:12px 16px;margin-bottom:8px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span style="font-size:13px;font-weight:600;">${escapeHtml(oppNome)}</span>
              <span style="font-size:12px;font-weight:700;color:${color};">${wins}V ${losses}D ${draws}E</span>
            </div>
            <p style="font-size:11px;color:var(--color-text-muted);margin-top:2px;">
              ${s.encounters} grupo${s.encounters !== 1 ? 's' : ''} · Sets diretos ${s.direct_sets_a}×${s.direct_sets_b}
            </p>
          </div>`;
      }).join('');
      h2hSection.innerHTML = cards || `<p style="font-size:13px;color:var(--color-text-muted);">Sem confrontos anteriores.</p>`;
    }
  }

  // Pending guest request for this group?
  const grSection = content.querySelector('#guest-request-section');
  if (grSection && ctx.round && group?.category !== undefined) {
    try {
      const grs = await api(`/api/guest-requests?round_id=${ctx.round.id}&status=pending`);
      const myGr = grs.find(g => g.cat === group.category && g.group_idx === group.group_index);
      if (myGr) {
        _renderMesaGuestRequest(grSection, myGr, athlete.id);
      }
    } catch (_) { /* not critical */ }
  }

  // ── Todos os grupos da rodada ──────────────────────────────────────────────
  const todosSection = content.querySelector('#todos-grupos-section');
  if (!todosSection) return;

  try {
    const [rndData, allResults] = await Promise.all([
      api(`/api/rounds/${round.id}`),
      api(`/api/rounds/${round.id}/results`).catch(() => []),
    ]);

    const groupsNamed   = rndData.groups_named   || {};
    const groupsSetsNamed = rndData.groups_sets_named || {};
    const officialSlots = rndData.official_slots  || {};
    const myGroupCat    = group?.category;
    const myGroupIdx    = group?.group_index ?? -1;
    const cats = ['A', 'B', 'C', 'D'].filter(c => groupsNamed[c]?.length);

    const RESULT_STATUS = {
      confirmed:     { label: 'Confirmado',  cls: 'badge-ativo'    },
      auto_confirmed:{ label: 'Confirmado',  cls: 'badge-ativo'    },
      admin_override:{ label: 'Admin',       cls: 'badge-ativo'    },
      pending_confirmation: { label: 'Aguardando confirmação', cls: 'badge-inativo' },
      contested:     { label: 'Contestado',  cls: 'badge-pending'  },
    };

    function slotHtml(slotObj) {
      if (!slotObj || slotObj.status !== 'resolved' || !slotObj.slot) {
        const msg = slotObj?.status === 'needs_mediation' ? 'Aguardando mediação' : 'Horário não definido';
        return `<p style="font-size:12px;color:var(--color-text-muted);margin:4px 0 8px;">🕐 ${msg}</p>`;
      }
      return `<p style="font-size:13px;font-weight:700;color:var(--color-primary);margin:4px 0 8px;">⏰ ${escapeHtml(slotObj.slot)}</p>`;
    }

    function resultHtml(result) {
      if (!result) return `<p style="font-size:12px;color:var(--color-text-muted);margin:4px 0 0;">Sem resultado lançado</p>`;
      const badge = RESULT_STATUS[result.status] || { label: result.status, cls: 'badge-inativo' };
      const scoresHtml = Object.entries(result.scores || {}).map(([aid, sc]) => {
        const nome = result.group_named?.[result.group?.indexOf(aid)] || aid;
        return `<div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0;">
          <span>${escapeHtml(nome)}</span>
          <span style="font-weight:700;color:var(--color-primary);">${sc.total ?? 0} pts</span>
        </div>`;
      }).join('');
      return `
        <div style="margin-top:6px;">
          <span class="badge ${badge.cls}" style="font-size:10px;margin-bottom:6px;">${badge.label}</span>
          ${scoresHtml}
        </div>`;
    }

    function buildGroupsHtml(cat, skipMyGroup) {
      const groups = groupsNamed[cat] || [];
      const setsPerGroup = groupsSetsNamed[cat] || [];
      const slots = officialSlots[cat] || [];
      let html = '';
      for (let gi = 0; gi < groups.length; gi++) {
        if (skipMyGroup && cat === myGroupCat && gi === myGroupIdx) continue;
        const names  = groups[gi] || [];
        const sets   = setsPerGroup[gi] || [];
        const slot   = slots[gi] || null;
        const result = allResults.find(r => r.cat === cat && r.group_idx === gi) || null;
        const setsRows = sets.map(s =>
          `<div style="font-size:12px;color:var(--color-text-muted);padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
            <span style="font-size:10px;">Set ${s.set}</span>
            <span style="margin-left:6px;">${s.team_a.map(escapeHtml).join(' + ')} <span style="opacity:.5;">vs</span> ${s.team_b.map(escapeHtml).join(' + ')}</span>
          </div>`
        ).join('');
        html += `
          <div class="card" style="padding:12px 16px;margin-bottom:10px;">
            <span style="font-size:13px;font-weight:700;display:block;margin-bottom:8px;">Grupo ${gi + 1}</span>
            <div style="margin-bottom:8px;">
              ${names.map(n => `<span style="display:inline-block;font-size:13px;margin-right:8px;margin-bottom:2px;">${escapeHtml(n)}</span>`).join('')}
            </div>
            ${sets.length ? `<div style="margin-bottom:8px;">${setsRows}</div>` : ''}
            ${slotHtml(slot)}
            ${resultHtml(result)}
          </div>`;
      }
      return html;
    }

    // Categoria do atleta: expandida logo abaixo de Meu Grupo
    let myCatHtml = '';
    if (myGroupCat && groupsNamed[myGroupCat]) {
      const otherGroupsInMyCat = buildGroupsHtml(myGroupCat, true);
      if (otherGroupsInMyCat) {
        myCatHtml = `
          <p style="font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;
             color:var(--color-text-muted);margin:0 0 10px;">${catLabel(myGroupCat)} — outros grupos</p>
          ${otherGroupsInMyCat}`;
      }
    }

    // Outras categorias: accordion colapsado
    const otherCats = cats.filter(c => c !== myGroupCat);
    const accordionHtml = otherCats.map(cat => {
      const catContent = buildGroupsHtml(cat, false);
      if (!catContent) return '';
      const uid = `acc-cat-${cat}`;
      return `
        <button class="grupos-accordion-btn" data-target="${uid}"
          style="width:100%;display:flex;align-items:center;justify-content:space-between;
                 background:var(--color-surface);border:var(--border);border-radius:8px;
                 padding:12px 16px;margin-bottom:8px;cursor:pointer;text-align:left;">
          <span style="font-size:13px;font-weight:700;">${catLabel(cat)}</span>
          <span class="acc-chevron" style="font-size:12px;color:var(--color-text-muted);transition:transform .2s;">▼</span>
        </button>
        <div id="${uid}" style="display:none;margin-bottom:8px;">${catContent}</div>`;
    }).join('');

    const hasOtherCats = otherCats.some(c => groupsNamed[c]?.length);

    todosSection.innerHTML = `
      ${myCatHtml}
      ${hasOtherCats ? `
        <p style="font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;
           color:var(--color-text-muted);margin:8px 0 10px;">Outras Categorias</p>
        ${accordionHtml}` : ''}`;

    // Accordion toggle
    todosSection.querySelectorAll('.grupos-accordion-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const panel = document.getElementById(btn.dataset.target);
        const chevron = btn.querySelector('.acc-chevron');
        const isOpen = panel.style.display !== 'none';
        panel.style.display = isOpen ? 'none' : 'block';
        chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
      });
    });

  } catch (e) {
    todosSection.innerHTML = `<p style="font-size:13px;color:var(--color-text-muted);">Erro ao carregar grupos.</p>`;
  }
}

function _renderMesaGuestRequest(container, gr, myAthleteId) {
  const mySuggestion = gr.suggestions?.find(s => s.suggested_by === myAthleteId);

  const suggestionsHtml = gr.suggestions?.length
    ? `<div style="margin-bottom:10px;">
        <p style="font-size:11px;color:var(--color-text-muted);margin-bottom:6px;">Sugestões enviadas:</p>
        ${gr.suggestions.map(s => `
          <div class="suggestion-row">
            <span style="font-weight:600;">${escapeHtml(s.nome_externo || s.athlete_id || '—')}</span>
            ${s.telefone ? `<span style="color:var(--color-text-muted);font-size:12px;">${escapeHtml(s.telefone)}</span>` : ''}
            <span style="font-size:11px;color:var(--color-text-muted);margin-left:auto;">
              ${s.suggested_by === myAthleteId ? 'Você' : 'Colega'}
            </span>
          </div>`).join('')}
      </div>`
    : '';

  container.innerHTML = `
    <div class="guest-request-banner">
      <div class="guest-request-banner-title">🏥 Convidado Necessário</div>
      <p style="font-size:13px;color:var(--color-text-muted);margin-bottom:10px;">
        Um atleta do seu grupo está afastado. O admin pode confirmar um convidado para a rodada.
        ${mySuggestion ? 'Você já enviou uma sugestão.' : 'Sugira um convidado abaixo.'}
      </p>
      ${suggestionsHtml}
      ${mySuggestion ? '' : `
        <div class="guest-suggest-form" id="suggest-form-${gr.id}">
          <input id="suggest-nome-${gr.id}" class="form-input" placeholder="Nome do convidado" maxlength="80">
          <input id="suggest-tel-${gr.id}" class="form-input" placeholder="WhatsApp (com DDD)" inputmode="numeric" maxlength="20">
          <button class="btn btn-sm btn-primary" id="btn-suggest-${gr.id}">Sugerir Convidado</button>
          <p id="suggest-msg-${gr.id}" class="hidden" style="font-size:12px;color:#D94040;"></p>
        </div>`}
    </div>`;

  if (!mySuggestion) {
    container.querySelector(`#btn-suggest-${gr.id}`).addEventListener('click', async () => {
      const nome = container.querySelector(`#suggest-nome-${gr.id}`).value.trim();
      const tel  = container.querySelector(`#suggest-tel-${gr.id}`).value.replace(/\D/g, '');
      const msg  = container.querySelector(`#suggest-msg-${gr.id}`);
      if (!nome) { msg.textContent = 'Informe o nome do convidado.'; msg.classList.remove('hidden'); return; }
      if (!tel)  { msg.textContent = 'Informe o WhatsApp.'; msg.classList.remove('hidden'); return; }
      try {
        await api(`/api/guest-requests/${gr.id}/suggest`, {
          method: 'POST',
          body: { nome_externo: nome, telefone: tel },
        });
        showToast('Sugestão enviada! O admin irá confirmar.');
        _renderMesaGuestRequest(container, { ...gr, suggestions: [...(gr.suggestions || []), { suggested_by: myAthleteId, nome_externo: nome, telefone: tel }] }, myAthleteId);
      } catch (err) {
        msg.textContent = err.message; msg.classList.remove('hidden');
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Score picker helpers (shared by athlete launch form + admin score form)
// ---------------------------------------------------------------------------

function validateSetPair(a, b) {
  if (a === null || b === null) return null;
  const hi = Math.max(a, b), lo = Math.min(a, b);
  if (hi === 6 && lo <= 4) return { valid: true, tb: false };
  if (hi === 7 && lo === 5) return { valid: true, tb: false };
  if (hi === 7 && lo === 6) return { valid: true, tb: true };
  if (hi === 7) return { valid: false, msg: `7×${lo}: adversário deve ter 5 (7-5) ou 6 (7-6 Tie Break).` };
  if (hi === 6 && lo === 5) return { valid: false, msg: `6-5 inválido — registre 7-5 ou 7-6 (Tie Break).` };
  if (hi === 6 && lo === 6) return { valid: false, msg: `6-6 inválido — registre 7-6 (Tie Break).` };
  return { valid: false, msg: `Incompleto — nenhum time chegou a 6.` };
}

function buildScoreSetBlockHtml(prefix, setNum, teamAName, teamBName, teamAIds, teamBIds) {
  const nums = [0,1,2,3,4,5,6,7];
  const mkBtns = side => nums.map(n =>
    `<button type="button" class="score-num-btn" data-val="${n}" data-side="${side}" data-set="${setNum}" data-prefix="${prefix}">${n}</button>`
  ).join('');
  return `
    <div class="score-set-block" id="${prefix}set-block-${setNum}">
      <p class="score-set-label">Set ${setNum}</p>
      <div class="score-picker-row">
        <span class="score-picker-team">${escapeHtml(teamAName)}</span>
        <div class="score-num-btns" id="${prefix}btns-a${setNum}">${mkBtns('a')}</div>
      </div>
      <div class="score-picker-row" style="margin-top:6px;">
        <span class="score-picker-team">${escapeHtml(teamBName)}</span>
        <div class="score-num-btns" id="${prefix}btns-b${setNum}">${mkBtns('b')}</div>
      </div>
      <div class="score-set-status" id="${prefix}status${setNum}"></div>
      <input type="hidden" id="${prefix}sa${setNum}" value="">
      <input type="hidden" id="${prefix}sb${setNum}" value="">
      <input type="hidden" id="${prefix}stb${setNum}" value="false">
      <input type="hidden" id="${prefix}ta${setNum}" value='${JSON.stringify(teamAIds||[])}'>
      <input type="hidden" id="${prefix}tb${setNum}" value='${JSON.stringify(teamBIds||[])}'>
    </div>`;
}

function attachScorePickerListeners(container, prefix, setNums) {
  setNums.forEach(setNum => {
    const block    = container.querySelector(`#${prefix}set-block-${setNum}`);
    if (!block) return;
    const hiddenA  = container.querySelector(`#${prefix}sa${setNum}`);
    const hiddenB  = container.querySelector(`#${prefix}sb${setNum}`);
    const hiddenStb = container.querySelector(`#${prefix}stb${setNum}`);
    const statusEl = container.querySelector(`#${prefix}status${setNum}`);

    function getVal(side) {
      const v = (side === 'a' ? hiddenA : hiddenB).value;
      return v === '' ? null : parseInt(v, 10);
    }
    function updateStatus() {
      const res = validateSetPair(getVal('a'), getVal('b'));
      if (!res) { statusEl.innerHTML = ''; hiddenStb.value = 'false'; return; }
      if (res.valid) {
        statusEl.innerHTML = res.tb ? '<span class="set-tb-badge">Tie Break</span>' : '';
        hiddenStb.value = res.tb ? 'true' : 'false';
      } else {
        statusEl.innerHTML = `<span class="set-score-error">${res.msg}</span>`;
        hiddenStb.value = 'false';
      }
    }
    block.querySelectorAll('.score-num-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const side   = btn.dataset.side;
        const val    = btn.dataset.val;
        const hidden = side === 'a' ? hiddenA : hiddenB;
        const row    = block.querySelector(`#${prefix}btns-${side}${setNum}`);
        if (hidden.value === val) {
          hidden.value = '';
          btn.classList.remove('selected');
        } else {
          hidden.value = val;
          row.querySelectorAll('.score-num-btn').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
        }
        updateStatus();
      });
    });
  });
}

function readScoreSets(container, prefix, count) {
  return Array.from({ length: count }, (_, i) => {
    const n   = i + 1;
    const sa  = container.querySelector(`#${prefix}sa${n}`)?.value ?? '';
    const sb  = container.querySelector(`#${prefix}sb${n}`)?.value ?? '';
    const stb = container.querySelector(`#${prefix}stb${n}`)?.value === 'true';
    const ta  = JSON.parse(container.querySelector(`#${prefix}ta${n}`)?.value || '[]');
    const tb  = JSON.parse(container.querySelector(`#${prefix}tb${n}`)?.value || '[]');
    return {
      set: n,
      team_a: ta, team_b: tb,
      score_a: sa === '' ? NaN : parseInt(sa, 10),
      score_b: sb === '' ? NaN : parseInt(sb, 10),
      is_super_tiebreak: stb,
    };
  });
}

// ---------------------------------------------------------------------------
// Mesa: Resultado (confirmar/contestar)
// ---------------------------------------------------------------------------

function renderMesaResultado(content, ctx) {
  if (!ctx || !ctx.group) {
    content.innerHTML = `<p class="placeholder-text">Você não está em nenhum grupo nesta rodada.</p>`;
    return;
  }

  const { athlete, group, round } = ctx;
  const STATUS_LABEL = { pending_confirmation: 'Aguardando confirmação', confirmed: 'Confirmado', contested: 'Contestado' };

  const setCount = (group.sets_named || []).length;
  const setNums  = (group.sets_named || []).map(s => s.set);

  function buildSetForm(prefix) {
    return (group.sets_named || []).map((s, i) => {
      const raw = (group.sets || [])[i] || {};
      return buildScoreSetBlockHtml(
        prefix, s.set,
        s.team_a.map(escapeHtml).join(' + '),
        s.team_b.map(escapeHtml).join(' + '),
        raw.team_a || [], raw.team_b || []
      );
    }).join('');
  }

  function collectSets(container, prefix) {
    return readScoreSets(container, prefix, setCount);
  }

  function scoresTableHtml(result) {
    return group.athlete_ids.map((aid, i) => {
      const nome = group.names[i];
      const sc = result.scores?.[aid];
      if (!sc) return '';
      const badges = (sc.sets||[]).map(pts =>
        `<span class="result-set-badge ${pts===3?'win':'loss'}">${pts}pts</span>`).join('');
      const isMe = aid === athlete.id;
      return `<tr>
        <td><strong>${escapeHtml(nome)}</strong>${isMe?' <span class="badge badge-ativo" style="font-size:10px;">Eu</span>':''}</td>
        <td><div class="result-set-scores">${badges}</div></td>
        <td class="pts-total">${sc.total??0}</td>
      </tr>`;
    }).join('');
  }

  function confirmStatusHtml(result) {
    return group.athlete_ids.map((aid, i) => {
      const c = result.confirmations?.[aid];
      return `<span style="font-size:12px;margin-right:8px;">${escapeHtml(group.names[i])}: ${c==='confirmed'?'✅':c==='contested'?'❌':'⏳'}</span>`;
    }).join('');
  }

  let showContestForm = false;

  const fetchAndRender = async () => {
    let result = null;
    try {
      const all = await api(`/api/rounds/${round.id}/results`);
      result = all.find(r => r.cat === group.category && r.group_idx === group.group_index) || null;
    } catch (_) {}
    paint(result);
  };

  const paint = (result) => {
    const header = `
      <h2 style="font-size:18px;font-weight:700;color:var(--color-primary);margin-bottom:4px;">Resultado</h2>
      <p style="font-size:13px;color:var(--color-text-muted);margin-bottom:16px;">
        ${catLabel(group.category)} · Grupo ${group.group_index + 1} · Rodada ${round?.round_number ?? '—'}
      </p>`;

    // ── No result yet: athlete launches it ───────────────────────────────────
    if (!result) {
      content.innerHTML = `<div style="padding:var(--space-md);">
        ${header}
        <p style="font-size:13px;margin-bottom:16px;">Lance o placar da partida abaixo:</p>
        <div class="result-form-card">
          ${buildSetForm('l_')}
          <p id="launch-error" class="field-error hidden" style="margin-top:8px;"></p>
          <button id="btn-lancar" class="btn btn-primary" style="width:100%;margin-top:16px;">
            Lançar resultado
          </button>
        </div>
      </div>`;

      attachScorePickerListeners(content, 'l_', setNums);

      content.querySelector('#btn-lancar').addEventListener('click', async () => {
        const btn = content.querySelector('#btn-lancar');
        const errEl = content.querySelector('#launch-error');
        errEl.classList.add('hidden');
        const sets = collectSets(content, 'l_');
        // Validate each set before sending
        for (const s of sets) {
          const res = validateSetPair(isNaN(s.score_a) ? null : s.score_a, isNaN(s.score_b) ? null : s.score_b);
          if (!res) { errEl.textContent = `Set ${s.set}: selecione o placar dos dois times.`; errEl.classList.remove('hidden'); return; }
          if (!res.valid) { errEl.textContent = `Set ${s.set}: ${res.msg}`; errEl.classList.remove('hidden'); return; }
        }
        btn.disabled = true; btn.textContent = 'Lançando…';
        try {
          await api(`/api/rounds/${round.id}/results`, {
            method: 'POST', body: { cat: group.category, group_idx: group.group_index, sets },
          });
          await fetchAndRender();
        } catch (err) {
          errEl.textContent = err.message; errEl.classList.remove('hidden');
          btn.disabled = false; btn.textContent = 'Lançar resultado';
        }
      });
      return;
    }

    // ── Result exists ────────────────────────────────────────────────────────
    const myConfirmation = result.confirmations?.[athlete.id];
    const iSubmitted = result.submitted_by === athlete.id;
    const canAct = result.status !== 'confirmed' && !myConfirmation;

    const resultCard = `
      <div class="result-card" style="margin-bottom:16px;">
        <div class="result-card-header">
          ${catLabel(group.category)} Grupo ${group.group_index + 1}
          <span class="badge badge-${result.status==='confirmed'?'active':result.status==='contested'?'pending':'inativo'}" style="margin-left:auto;">
            ${STATUS_LABEL[result.status]||result.status}
          </span>
        </div>
        <p style="font-size:11px;color:var(--color-text-muted);padding:6px 12px 0;">
          Lançado por: <strong>${escapeHtml(result.submitted_by_name||'—')}</strong>
        </p>
        <table class="result-scores-table">
          <thead><tr><th>Atleta</th><th>Sets</th><th>Pts</th></tr></thead>
          <tbody>${scoresTableHtml(result)}</tbody>
        </table>
        <div class="result-footer">
          <div style="font-size:12px;color:var(--color-text-muted);">${confirmStatusHtml(result)}</div>
        </div>
      </div>`;

    // Contest form (inline)
    const contestFormHtml = `
      <div class="result-form-card" style="border-color:rgba(217,64,64,0.4);">
        <p style="font-size:14px;font-weight:700;color:#D94040;margin-bottom:12px;">Contestação</p>
        <div class="form-group" style="margin-bottom:12px;">
          <label class="field-label">Motivo *</label>
          <textarea id="contest-reason" class="field-input" rows="3"
            placeholder="Descreva por que o placar está incorreto…" style="resize:vertical;"></textarea>
        </div>
        <p class="field-label" style="margin-bottom:10px;">Placar que considera correto:</p>
        ${buildSetForm('c_')}
        <p id="contest-error" class="field-error hidden" style="margin-top:8px;"></p>
        <div style="display:flex;gap:10px;margin-top:14px;">
          <button id="btn-cancelar-contest" class="btn btn-ghost" style="flex:1;">Cancelar</button>
          <button id="btn-enviar-contest" class="btn btn-primary" style="flex:1;background:#D94040;">Enviar contestação</button>
        </div>
      </div>`;

    const actionsHtml = canAct && !showContestForm ? `
      <div style="display:flex;gap:10px;margin-bottom:16px;">
        <button id="btn-confirmar" class="btn btn-primary" style="flex:1;">✅ Confirmar resultado</button>
        <button id="btn-toggle-contest" class="btn btn-ghost" style="flex:1;color:#D94040;">❌ Contestar</button>
      </div>` : '';

    const myStatusHtml = myConfirmation ? `
      <div class="alert alert-${myConfirmation==='confirmed'?'info':'warning'}" style="margin-top:4px;">
        ${myConfirmation==='confirmed' ? '✅ Você confirmou este resultado.' : '❌ Você contestou. O admin irá revisar.'}
      </div>` : '';

    content.innerHTML = `<div style="padding:var(--space-md);">
      ${header}${resultCard}${actionsHtml}
      ${canAct && showContestForm ? contestFormHtml : ''}
      ${myStatusHtml}
    </div>`;

    if (canAct && showContestForm) {
      attachScorePickerListeners(content, 'c_', setNums);
    }

    // Confirmar
    content.querySelector('#btn-confirmar')?.addEventListener('click', async () => {
      const btn = content.querySelector('#btn-confirmar');
      btn.disabled = true; btn.textContent = 'Confirmando…';
      try {
        await api(`/api/results/${result.id}/confirm`, { method: 'POST', body: { action: 'confirmed' } });
        await fetchAndRender();
      } catch (err) { showToast(err.message, 'error'); btn.disabled = false; btn.textContent = '✅ Confirmar resultado'; }
    });

    // Mostrar/ocultar form de contestação
    content.querySelector('#btn-toggle-contest')?.addEventListener('click', () => {
      showContestForm = true; paint(result);
    });
    content.querySelector('#btn-cancelar-contest')?.addEventListener('click', () => {
      showContestForm = false; paint(result);
    });

    // Enviar contestação
    content.querySelector('#btn-enviar-contest')?.addEventListener('click', async () => {
      const btn = content.querySelector('#btn-enviar-contest');
      const errEl = content.querySelector('#contest-error');
      const reason = content.querySelector('#contest-reason')?.value?.trim();
      if (!reason) { errEl.textContent = 'Informe o motivo.'; errEl.classList.remove('hidden'); return; }
      const sets = collectSets(content, 'c_');
      // Validate sets if any were filled in
      const anyFilled = sets.some(s => !isNaN(s.score_a) || !isNaN(s.score_b));
      if (anyFilled) {
        for (const s of sets) {
          const res = validateSetPair(isNaN(s.score_a) ? null : s.score_a, isNaN(s.score_b) ? null : s.score_b);
          if (!res) { errEl.textContent = `Set ${s.set}: selecione o placar dos dois times.`; errEl.classList.remove('hidden'); return; }
          if (!res.valid) { errEl.textContent = `Set ${s.set}: ${res.msg}`; errEl.classList.remove('hidden'); return; }
        }
      }
      btn.disabled = true; btn.textContent = 'Enviando…'; errEl.classList.add('hidden');
      try {
        await api(`/api/results/${result.id}/confirm`, { method: 'POST', body: { action: 'contested', reason, sets } });
        showContestForm = false;
        await fetchAndRender();
      } catch (err) {
        errEl.textContent = err.message; errEl.classList.remove('hidden');
        btn.disabled = false; btn.textContent = 'Enviar contestação';
      }
    });
  };

  content.innerHTML = `<p class="placeholder-text" style="padding:var(--space-md);">Carregando resultado…</p>`;
  fetchAndRender();
}

// ---------------------------------------------------------------------------
// Admin: Resultados — lançar e gerenciar
// ---------------------------------------------------------------------------

async function renderAdminResultados(content, selectedSeasonId = null) {
  let rounds = [], athletes = [], seasons = [];
  const [seasonsRes, athletesRes] = await Promise.allSettled([
    api('/api/seasons'), api('/api/athletes'),
  ]);
  if (seasonsRes.status  === 'fulfilled') seasons  = seasonsRes.value;
  if (athletesRes.status === 'fulfilled') athletes = athletesRes.value;

  const athletesById = Object.fromEntries(athletes.map(a => [a.id, a]));
  const defaultSeason = seasons.find(s => s.status === 'active') || seasons[seasons.length - 1];
  const activeSeason  = (selectedSeasonId && seasons.find(s => s.id === selectedSeasonId)) || defaultSeason;

  if (!activeSeason) {
    content.innerHTML = `<div class="section-header"><h1 class="section-title">Resultados</h1></div>
      <div class="alert alert-info">Nenhuma temporada cadastrada.</div>`;
    return;
  }

  try {
    const allRounds = await api('/api/seasons/' + activeSeason.id + '/rounds');
    rounds = allRounds.filter(r => r.status !== 'cancelled');
  } catch (_) {}

  const seasonSelectHtml = seasons.length > 1 ? `
    <select id="resultados-admin-season-sel" class="input" style="font-size:13px;max-width:220px;">
      ${seasons.map(s => `<option value="${s.id}"${s.id === activeSeason.id ? ' selected' : ''}>${escapeHtml(s.name)}${s.status === 'active' ? ' ✓' : ''}</option>`).join('')}
    </select>` : '';

  content.innerHTML = `
    <div class="section-header">
      <div>
        <h1 class="section-title">Resultados</h1>
        <p class="section-subtitle">${escapeHtml(activeSeason.name)}</p>
      </div>
      ${seasonSelectHtml}
    </div>
    <div class="resultados-filter-bar">
      <div id="resultados-cat-tabs" class="cat-tabs">
        <button class="cat-tab active" data-filter="all">Todas</button>
      </div>
      <div id="resultados-status-tabs" class="res-status-tabs">
        <button class="res-status-tab active" data-status="all">Todos</button>
        <button class="res-status-tab" data-status="not_launched">Não lançados</button>
        <button class="res-status-tab" data-status="pending_confirmation">Aguard. confirm.</button>
        <button class="res-status-tab" data-status="contested">Contestados</button>
        <button class="res-status-tab" data-status="confirmed">Confirmados</button>
      </div>
    </div>
    <div id="resultados-body">
      <p class="placeholder-text">Carregando…</p>
    </div>`;

  const body = content.querySelector('#resultados-body');
  const tabsBar = content.querySelector('#resultados-cat-tabs');
  const statusBar = content.querySelector('#resultados-status-tabs');

  if (!rounds.length) {
    body.innerHTML = `<div class="alert alert-info">Nenhuma rodada com sorteio realizado.</div>`;
    return;
  }

  // Coleta categorias presentes em todos os rounds
  const presentCats = [...new Set(
    rounds.flatMap(rnd => Object.keys(rnd.groups || {}))
  )].sort();
  presentCats.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'cat-tab';
    btn.dataset.filter = cat;
    btn.textContent = `Cat ${cat}`;
    tabsBar.appendChild(btn);
  });

  let activeCatFilter = 'all';
  let activeStatusFilter = 'all';

  function applyFilter(cat, status) {
    if (cat !== undefined) activeCatFilter = cat;
    if (status !== undefined) activeStatusFilter = status;
    tabsBar.querySelectorAll('.cat-tab').forEach(t => t.classList.toggle('active', t.dataset.filter === activeCatFilter));
    statusBar.querySelectorAll('.res-status-tab').forEach(t => t.classList.toggle('active', t.dataset.status === activeStatusFilter));

    body.querySelectorAll('.group-card[data-cat]').forEach(card => {
      const catMatch = activeCatFilter === 'all' || card.dataset.cat === activeCatFilter;
      const cardStatus = card.dataset.status || 'not_launched';
      const statusMatch = activeStatusFilter === 'all' || cardStatus === activeStatusFilter;
      card.style.display = (catMatch && statusMatch) ? '' : 'none';
    });
    body.querySelectorAll('.card[data-round-card]').forEach(card => {
      const hasVisible = [...card.querySelectorAll('.group-card[data-cat]')].some(g => g.style.display !== 'none');
      card.style.display = hasVisible ? '' : 'none';
    });
  }

  tabsBar.addEventListener('click', e => {
    const btn = e.target.closest('.cat-tab');
    if (btn) applyFilter(btn.dataset.filter, undefined);
  });

  statusBar.addEventListener('click', e => {
    const btn = e.target.closest('.res-status-tab');
    if (btn) applyFilter(undefined, btn.dataset.status);
  });

  // Renderiza painel por rodada
  const renderRounds = async () => {
    let html = '';
    const resultsSettled = await Promise.allSettled(
      rounds.map(rnd => api(`/api/rounds/${rnd.id}/results`))
    );
    for (let i = 0; i < rounds.length; i++) {
      const rnd = rounds[i];
      const roundResults = resultsSettled[i].status === 'fulfilled' ? resultsSettled[i].value : [];
      const resultsByGroupKey = Object.fromEntries(
        roundResults.map(r => [`${r.cat}-${r.group_idx}`, r])
      );

      const today = new Date().toISOString().slice(0, 10);
      const rndEnd = rnd.end_date || rnd.target_date;
      const isOverdue = rndEnd && rndEnd < today && rnd.status !== 'closed';
      const periodHtml = rnd.start_date
        ? `<span class="round-period">${rnd.start_date} → ${rnd.end_date || '?'}</span>`
        : '';
      const overdueBadge = isOverdue
        ? `<span class="badge badge-overdue" style="margin-left:8px;">Vencida</span>`
        : '';

      html += `
        <div class="card" data-round-card style="margin-bottom:20px;">
          <div class="cat-tab-bar" style="padding:var(--space-sm) var(--space-md);border-bottom:var(--border);display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <strong>Rodada ${rnd.round_number}</strong>
            ${periodHtml}
            ${overdueBadge}
            ${rnd.status !== 'closed' ? `<button class="btn btn-primary btn-sm btn-batch-launch" data-batch-round="${rnd.id}" data-launched='${JSON.stringify(Object.keys(resultsByGroupKey).filter(k => resultsByGroupKey[k].status !== 'contested'))}' style="margin-left:auto;">⚡ Lançar em lote</button>` : ''}
          </div>`;

      for (const [cat, groups] of Object.entries(rnd.groups || {})) {
        for (let gi = 0; gi < groups.length; gi++) {
          const group = groups[gi];
          const key = `${cat}-${gi}`;
          const existing = resultsByGroupKey[key];
          const cardStatus = existing ? existing.status : 'not_launched';
          const statusLabel = existing
            ? { pending_confirmation: 'Aguard. confirmação', confirmed: 'Confirmado', contested: 'Contestado' }[existing.status] || existing.status
            : 'Não lançado';
          const statusCls = existing
            ? { pending_confirmation: 'badge-pending', confirmed: 'badge-confirmed', contested: 'badge-contested' }[existing.status] || ''
            : 'badge-inativo';

          const adminConfirmBtn = (existing && existing.status === 'pending_confirmation') ? `
            <button class="btn btn-ghost btn-sm btn-admin-confirm"
              data-rid="${existing.id}"
              style="margin-left:6px;color:#7C3AED;"
              title="Forçar confirmação sem aguardar todos os atletas">
              ✓ Confirmar como ADM
            </button>` : '';
          const impactBtn = (existing && existing.status === 'pending_confirmation') ? `
            <button class="btn btn-ghost btn-sm btn-ver-impacto"
              data-rid="${existing.id}"
              data-season="${activeSeason.id}"
              style="color:var(--color-text-muted);"
              title="Ver como este resultado alteraria o ranking">
              📊 Ver impacto
            </button>` : '';

          html += `
            <div class="group-card" data-cat="${cat}" data-status="${cardStatus}" style="margin:var(--space-sm) var(--space-md);border:var(--border);border-radius:var(--radius-md);overflow:hidden;">
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
                <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">
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
                      data-group='${JSON.stringify(group)}'>WO</button>` : ''}
                  ${adminConfirmBtn}
                  ${impactBtn}
                </div>
              </div>
            </div>`;
        }
      }
      html += `</div>`;
    }
    body.innerHTML = html;
    applyFilter(activeCatFilter, activeStatusFilter);
    attachResultadosListeners(body, athletesById, renderRounds);

    // Lançamento em lote (por categoria ativa)
    body.querySelectorAll('.btn-batch-launch').forEach(btn => {
      btn.addEventListener('click', () => {
        const rnd = rounds.find(r => r.id === btn.dataset.batchRound);
        if (!rnd) return;
        const launched = new Set(JSON.parse(btn.dataset.launched || '[]'));
        const items = [];
        for (const [cat, groups] of Object.entries(rnd.groups || {})) {
          if (activeCatFilter !== 'all' && cat !== activeCatFilter) continue;
          for (let gi = 0; gi < groups.length; gi++) {
            if (launched.has(`${cat}-${gi}`)) continue;
            items.push({ cat, gi, group: groups[gi], sets: (rnd.groups_sets?.[cat]?.[gi] || []) });
          }
        }
        if (!items.length) {
          showToast('Nenhum grupo pendente de lançamento nesta seleção.', 'info');
          return;
        }
        openBatchScoreForm(rnd.id, items, athletesById, renderRounds,
          activeCatFilter === 'all' ? null : activeCatFilter);
      });
    });
  };

  await renderRounds();
  content.querySelector('#resultados-admin-season-sel')?.addEventListener('change', e => {
    renderAdminResultados(content, e.target.value);
  });
}

function _renderSetScorelines(sets, athletesById) {
  if (!sets || !sets.length) return '';
  const rows = sets.map(s => {
    const nameA = (s.team_a || []).map(id => escapeHtml(athletesById[id]?.nome?.split(' ')[0] || id)).join(' / ');
    const nameB = (s.team_b || []).map(id => escapeHtml(athletesById[id]?.nome?.split(' ')[0] || id)).join(' / ');
    const winA = s.score_a > s.score_b;
    const winB = s.score_b > s.score_a;
    return `<div class="set-scoreline">
      <span class="set-team ${winA ? 'set-winner' : ''}">${nameA}</span>
      <span class="set-score">${s.score_a}<span class="set-sep">×</span>${s.score_b}</span>
      <span class="set-team set-team-right ${winB ? 'set-winner' : ''}">${nameB}</span>
    </div>`;
  }).join('');
  return `<div class="set-scorelines">${rows}</div>`;
}

function renderResultScores(result, group, athletesById) {
  if (!result.scores) return '';
  const scoreLines = _renderSetScorelines(result.sets || [], athletesById);
  const sorted = [...group].sort((a, b) =>
    (result.scores[b]?.total ?? 0) - (result.scores[a]?.total ?? 0)
  );
  const rows = sorted.map((aid, i) => {
    const sc = result.scores[aid];
    if (!sc) return '';
    const nome = athletesById[aid]?.nome || aid;
    const badges = (sc.sets || []).map(pts => {
      const cls = pts === 3 ? 'win' : pts === 1 ? 'loss' : '';
      return `<span class="result-set-badge ${cls}">${pts}</span>`;
    }).join('');
    return `<tr>
      <td style="padding:4px 8px;font-size:12px;color:var(--color-text-muted);">${i + 1}º</td>
      <td style="padding:4px 8px;font-size:13px;">${escapeHtml(nome)}</td>
      <td style="padding:4px 8px;"><div class="result-set-scores">${badges}</div></td>
      <td style="padding:4px 8px;font-weight:700;color:var(--color-primary);">${sc.total ?? 0}pts</td>
    </tr>`;
  }).join('');
  return `
    ${scoreLines}
    <table style="width:100%;margin-bottom:8px;margin-top:${scoreLines ? '10px' : '0'};">
      <tbody>${rows}</tbody>
    </table>`;
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

  // Forçar confirmação como ADM
  body.querySelectorAll('.btn-admin-confirm').forEach(btn => {
    btn.addEventListener('click', () => {
      const rid = btn.dataset.rid;
      confirmModal(
        'Confirmar como ADM',
        'Forçar a confirmação deste resultado sem aguardar todos os atletas? O placar lançado será aceito como definitivo.',
        async () => {
          btn.disabled = true;
          try {
            await api(`/api/results/${rid}/admin-confirm`, { method: 'POST' });
            showToast('Resultado confirmado pelo ADM.', 'success');
            await refresh();
          } catch (err) {
            showToast('Erro: ' + err.message, 'error');
            btn.disabled = false;
          }
        },
        'Confirmar'
      );
    });
  });

  // Ver impacto no ranking
  body.querySelectorAll('.btn-ver-impacto').forEach(btn => {
    btn.addEventListener('click', async () => {
      const rid = btn.dataset.rid;
      const seasonId = btn.dataset.season;
      btn.disabled = true;
      btn.textContent = 'Calculando…';
      try {
        const impact = await api(`/api/seasons/${seasonId}/ranking/impact?result_id=${rid}`);
        openImpactModal(impact);
      } catch (err) {
        showToast('Erro ao calcular impacto: ' + err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = '📊 Ver impacto';
      }
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

function openImpactModal(impact) {
  const { cat, result_id, athletes } = impact;
  if (!athletes || !athletes.length) {
    showToast('Nenhum atleta afetado pelo impacto.', 'info');
    return;
  }

  const rows = athletes.map(a => {
    const before = a.rank_before != null ? `#${a.rank_before}` : '—';
    const after  = `#${a.rank_after}`;
    let delta = '';
    if (a.delta == null) {
      delta = `<span class="impact-same">—</span>`;
    } else if (a.delta < 0) {
      delta = `<span class="impact-up">▲ ${Math.abs(a.delta)}</span>`;
    } else if (a.delta > 0) {
      delta = `<span class="impact-down">▼ ${a.delta}</span>`;
    } else {
      delta = `<span class="impact-same">= </span>`;
    }
    return `<tr>
      <td>${escapeHtml(a.nome)}</td>
      <td style="text-align:center;">${before}</td>
      <td style="text-align:center;">${after}</td>
      <td style="text-align:center;">${delta}</td>
      <td style="text-align:right;">${a.points_after} pts</td>
    </tr>`;
  }).join('');

  const overlay = document.createElement('div');
  overlay.className = 'impact-modal-overlay';
  overlay.innerHTML = `
    <div class="impact-modal">
      <div class="impact-modal-header">
        <span class="impact-modal-title">📊 Impacto no Ranking — Cat ${escapeHtml(cat)}</span>
        <button class="impact-modal-close" id="closeImpactModal">✕</button>
      </div>
      <p style="font-size:12px;color:var(--color-text-muted);margin-bottom:12px;">
        Simulação: como o ranking ficaria se este resultado fosse confirmado agora.
      </p>
      <table class="impact-table">
        <thead>
          <tr>
            <th>Atleta</th>
            <th style="text-align:center;">Antes</th>
            <th style="text-align:center;">Após</th>
            <th style="text-align:center;">Variação</th>
            <th style="text-align:right;">Pontos</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  document.body.appendChild(overlay);
  overlay.querySelector('#closeImpactModal').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

function openCommsModal(roundId, cat, checklist) {
  const ISSUE_LABELS = {
    sem_slots:        { icon: '⏰', text: 'Sem slots marcados' },
    resultado_pendente:{ icon: '📋', text: 'Resultado pendente de confirmação' },
  };
  const SENT_KEY = `comms_sent_${roundId}`;
  const sentSet  = new Set(JSON.parse(localStorage.getItem(SENT_KEY) || '[]'));

  if (!checklist.length) {
    showToast(`Cat ${cat}: sem atletas com pendências.`, 'info');
    return;
  }

  function buildRows(list) {
    return list.map(a => {
      const isSent = sentSet.has(a.athlete_id);
      const issues = a.issues.map(k => {
        const { icon, text } = ISSUE_LABELS[k] || { icon: '•', text: k };
        return `<span class="comms-issue-tag">${icon} ${text}</span>`;
      }).join('');
      const waLink = a.telefone
        ? (() => {
            const phone = a.telefone.replace(/\D/g, '');
            const fullPhone = phone.startsWith('55') ? phone : '55' + phone;
            const msgs = [];
            if (a.issues.includes('sem_slots'))
              msgs.push(`Olá ${a.nome.split(' ')[0]}! Por favor marque seus horários disponíveis no SuperRank para a Rodada atual. Acesse: ${window._appUrl || ''}#mesa/home`);
            if (a.issues.includes('resultado_pendente'))
              msgs.push(`Olá ${a.nome.split(' ')[0]}! Seu resultado aguarda confirmação no SuperRank. Acesse: ${window._appUrl || ''}#mesa/resultado`);
            const msg = encodeURIComponent(msgs.join('\n'));
            return `https://wa.me/${fullPhone}?text=${msg}`;
          })()
        : null;
      return `<div class="comms-row${isSent ? ' comms-sent' : ''}" data-aid="${a.athlete_id}">
        <div class="comms-row-left">
          <span class="comms-nome">${escapeHtml(a.nome)}</span>
          <span class="comms-cat-tag">${catLabel(a.cat)} G${a.group_idx + 1}</span>
          <div class="comms-issues">${issues}</div>
        </div>
        <div class="comms-row-right">
          ${isSent ? `<span class="comms-ok-tag">✓ Enviado</span>` : ''}
          ${waLink
            ? `<a href="${waLink}" target="_blank" class="btn btn-ghost btn-sm comms-wa-btn"
                data-aid="${a.athlete_id}">
                📱 WhatsApp
              </a>`
            : `<span style="font-size:11px;color:var(--color-text-muted);">Sem telefone</span>`}
        </div>
      </div>`;
    }).join('');
  }

  const overlay = document.createElement('div');
  overlay.className = 'impact-modal-overlay';
  overlay.innerHTML = `
    <div class="impact-modal" style="max-width:580px;">
      <div class="impact-modal-header">
        <span class="impact-modal-title">📢 Comunicação — Rodada · Cat ${escapeHtml(cat)}</span>
        <button class="impact-modal-close" id="closeCommsModal">✕</button>
      </div>
      <p style="font-size:12px;color:var(--color-text-muted);margin-bottom:14px;">
        ${checklist.length} atleta(s) com pendências. Clique em WhatsApp para abrir a conversa com mensagem pré-preenchida.
      </p>
      <div id="comms-list">${buildRows(checklist)}</div>
      <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--color-border);display:flex;justify-content:space-between;align-items:center;">
        <button id="btn-clear-sent" class="btn btn-ghost btn-sm" style="font-size:12px;color:var(--color-text-muted);">
          Limpar marcações de enviado
        </button>
        <span style="font-size:11px;color:var(--color-text-muted);">Marcações salvas localmente</span>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  overlay.querySelectorAll('.comms-wa-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const aid = btn.dataset.aid;
      sentSet.add(aid);
      localStorage.setItem(SENT_KEY, JSON.stringify([...sentSet]));
      const row = overlay.querySelector(`.comms-row[data-aid="${aid}"]`);
      if (row) {
        row.classList.add('comms-sent');
        const right = row.querySelector('.comms-row-right');
        if (right && !right.querySelector('.comms-ok-tag')) {
          right.insertAdjacentHTML('afterbegin', `<span class="comms-ok-tag">✓ Enviado</span>`);
        }
      }
    });
  });

  overlay.querySelector('#btn-clear-sent').addEventListener('click', () => {
    sentSet.clear();
    localStorage.removeItem(SENT_KEY);
    overlay.querySelector('#comms-list').innerHTML = buildRows(checklist);
    overlay.querySelectorAll('.comms-wa-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        sentSet.add(btn.dataset.aid);
        localStorage.setItem(SENT_KEY, JSON.stringify([...sentSet]));
        btn.closest('.comms-row')?.classList.add('comms-sent');
      });
    });
  });

  overlay.querySelector('#closeCommsModal').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

function openScoreForm(roundId, cat, gi, group, sets, athletesById, refresh) {
  const prefix   = `adm${gi}_`;
  const setNums  = sets.map((_, i) => i + 1);
  const setsHtml = sets.map((setDef, idx) => {
    const n      = idx + 1;
    const teamA  = (setDef.team_a || []).map(aid => athletesById[aid]?.nome || aid).join(' + ');
    const teamB  = (setDef.team_b || []).map(aid => athletesById[aid]?.nome || aid).join(' + ');
    return buildScoreSetBlockHtml(prefix, n, teamA, teamB, setDef.team_a || [], setDef.team_b || []);
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

  const modalBody = document.getElementById('modal-body');
  attachScorePickerListeners(modalBody, prefix, setNums);

  document.getElementById('btn-score-cancelar').addEventListener('click', closeModal);
  document.getElementById('btn-score-salvar').addEventListener('click', async () => {
    const errEl = document.getElementById('score-error');
    errEl.classList.add('hidden');

    const setsPayload = readScoreSets(modalBody, prefix, sets.length);

    // Validate all sets before sending
    for (const s of setsPayload) {
      const res = validateSetPair(isNaN(s.score_a) ? null : s.score_a, isNaN(s.score_b) ? null : s.score_b);
      if (!res) { errEl.textContent = `Set ${s.set}: selecione o placar dos dois times.`; errEl.classList.remove('hidden'); return; }
      if (!res.valid) { errEl.textContent = `Set ${s.set}: ${res.msg}`; errEl.classList.remove('hidden'); return; }
    }

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

function openBatchScoreForm(roundId, items, athletesById, refresh, catFilter) {
  // Monta uma seção por grupo, cada uma com seus blocos de set (reusa helpers).
  const sectionsHtml = items.map(it => {
    const prefix = `b${it.cat}_${it.gi}_`;
    const setsHtml = (it.sets || []).map((setDef, idx) => {
      const teamA = (setDef.team_a || []).map(aid => athletesById[aid]?.nome || aid).join(' + ');
      const teamB = (setDef.team_b || []).map(aid => athletesById[aid]?.nome || aid).join(' + ');
      return buildScoreSetBlockHtml(prefix, idx + 1, teamA, teamB, setDef.team_a || [], setDef.team_b || []);
    }).join('');
    return `
      <div class="batch-group-section" style="border:var(--border);border-radius:var(--radius-md);padding:10px 12px;margin-bottom:14px;">
        <p style="font-weight:700;font-size:14px;margin-bottom:8px;">${catLabel(it.cat)} · Grupo ${it.gi + 1}</p>
        <div class="score-sets-grid">${setsHtml}</div>
      </div>`;
  }).join('');

  openModal(
    `Lançar em lote${catFilter ? ' — Cat ' + catFilter : ''} · ${items.length} grupo${items.length !== 1 ? 's' : ''}`,
    `<div class="score-form">
       <p style="font-size:12px;color:var(--color-text-muted);margin-bottom:12px;">
         Preencha os grupos que quiser. Quem ficar em branco é ignorado. Os 3 sets de um grupo precisam estar completos para salvar.
       </p>
       ${sectionsHtml}
       <p id="batch-error" class="field-error hidden"></p>
     </div>`,
    `<button id="btn-batch-salvar" class="btn btn-primary">Salvar todos</button>
     <button id="btn-batch-cancelar" class="btn btn-ghost">Cancelar</button>`
  );

  const modalBody = document.getElementById('modal-body');
  items.forEach(it => attachScorePickerListeners(modalBody, `b${it.cat}_${it.gi}_`, (it.sets || []).map((_, i) => i + 1)));

  document.getElementById('btn-batch-cancelar').addEventListener('click', closeModal);
  document.getElementById('btn-batch-salvar').addEventListener('click', async () => {
    const errEl = document.getElementById('batch-error');
    errEl.classList.add('hidden');

    const payload = [];
    const problems = [];
    for (const it of items) {
      const prefix = `b${it.cat}_${it.gi}_`;
      const count = (it.sets || []).length || 3;
      const sp = readScoreSets(modalBody, prefix, count);
      const anyFilled = sp.some(s => !isNaN(s.score_a) || !isNaN(s.score_b));
      if (!anyFilled) continue; // grupo deixado em branco — ok, ignora
      let ok = true;
      for (const s of sp) {
        const res = validateSetPair(isNaN(s.score_a) ? null : s.score_a, isNaN(s.score_b) ? null : s.score_b);
        if (!res || !res.valid) { ok = false; break; }
      }
      if (!ok) { problems.push(`Cat ${it.cat} G${it.gi + 1}`); continue; }
      payload.push({ cat: it.cat, group_idx: it.gi, sets: sp });
    }

    if (problems.length) {
      errEl.textContent = `Placar incompleto ou inválido em: ${problems.join(', ')}. Complete os 3 sets ou deixe o grupo em branco.`;
      errEl.classList.remove('hidden');
      return;
    }
    if (!payload.length) {
      errEl.textContent = 'Nenhum grupo preenchido.';
      errEl.classList.remove('hidden');
      return;
    }

    const btn = document.getElementById('btn-batch-salvar');
    btn.disabled = true; btn.textContent = 'Salvando…';
    try {
      const res = await api(`/api/rounds/${roundId}/results/batch`, { method: 'POST', body: { results: payload } });
      closeModal();
      if (res.failed && res.failed.length) {
        showToast(`${res.saved} salvo(s); ${res.failed.length} com erro.`, 'info');
      } else {
        showToast(`${res.saved} resultado(s) lançado(s).`, 'success');
      }
      await refresh();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
      btn.disabled = false; btn.textContent = 'Salvar todos';
    }
  });
}

function openWoForm(roundId, cat, gi, group, athletesById, refresh) {
  const options = group.map(aid =>
    `<option value="${aid}">${escapeHtml(athletesById[aid]?.nome || aid)}</option>`
  ).join('');

  function buildWoPreview(absentId) {
    const present = group.filter(aid => aid !== absentId);
    const absentName = escapeHtml(athletesById[absentId]?.nome || absentId);
    const presentRows = present.map(aid =>
      `<div class="wo-preview-row wo-present">
         <span>${escapeHtml(athletesById[aid]?.nome || aid)}</span>
         <span class="wo-pts">9 pts (3×3)</span>
       </div>`
    ).join('');
    return `
      <div class="wo-preview-box">
        ${presentRows}
        <div class="wo-preview-row wo-absent">
          <span>${absentName} <em style="font-size:11px;">(ausente)</em></span>
          <span class="wo-pts wo-zero">0 pts</span>
        </div>
      </div>`;
  }

  openModal(
    `WO — Cat ${cat} · Grupo ${gi + 1}`,
    `<p style="margin-bottom:10px;font-size:13px;">Selecione o atleta <strong>ausente</strong>:</p>
     <select id="wo-absent" class="field-input" style="margin-bottom:12px;">${options}</select>
     <div id="wo-preview">${buildWoPreview(group[0])}</div>
     <p style="font-size:11px;color:var(--color-text-muted);margin-top:10px;">Art. 10.1: ausente recebe 0 pts; demais recebem 9 pts (3 sets × 3 pts).</p>
     <p id="wo-error" class="field-error hidden"></p>`,
    `<button id="btn-wo-confirmar" class="btn btn-primary">Aplicar WO</button>
     <button id="btn-wo-cancelar" class="btn btn-ghost">Cancelar</button>`
  );

  document.getElementById('wo-absent').addEventListener('change', e => {
    document.getElementById('wo-preview').innerHTML = buildWoPreview(e.target.value);
  });

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

async function renderAdminFechamento(content, selectedSeasonId = null) {
  content.innerHTML = `<p class="placeholder-text">Carregando…</p>`;

  let seasons = [];
  try { seasons = await api('/api/seasons'); } catch (_) {}

  const activeSeason    = seasons.find(s => s.status === 'active') || seasons.find(s => s.status === 'pending');
  const selectedSeason  = (selectedSeasonId && seasons.find(s => s.id === selectedSeasonId)) || activeSeason;

  if (!selectedSeason) {
    content.innerHTML = `
      <div class="section-header"><h1 class="section-title">Fechamento de Temporada</h1></div>
      <div class="alert alert-info">Nenhuma temporada disponível.</div>`;
    return;
  }

  let preview = null;
  try { preview = await api(`/api/seasons/${selectedSeason.id}/fechamento/preview`); } catch (_) {}

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

  const openRoundsCount  = preview?.open_rounds_count || 0;
  const openRounds       = preview?.open_rounds || [];
  const ineligible       = preview?.ineligible_warnings || [];
  const isClosed         = selectedSeason.status === 'closed';
  const isViewingActive  = activeSeason && selectedSeason.id === activeSeason.id;
  const movedCount       = (preview?.summary || []).filter(e => e.action !== 'stays').length;

  // Ranking final com notas de desempate e marcação de zona
  const rankingsHtml = Object.entries(preview?.rankings || {})
    .filter(([, rows]) => rows.length)
    .map(([cat, rows]) => {
      const n = rows.length;
      const m = n >= 8 ? 2 : 1;
      const promoIds = new Set(rows.slice(0, n > 1 ? m : 0).map(r => r.athlete_id));
      const relegIds = new Set(rows.slice(Math.max(0, n - m)).map(r => r.athlete_id));
      return `
        <div style="margin-bottom:14px;">
          <p style="font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;
             color:var(--color-text-muted);margin-bottom:6px;">Cat ${cat}</p>
          <div class="card" style="padding:0;overflow:hidden;">
            <table class="ranking-table">
              <thead><tr><th>#</th><th>Atleta</th><th class="num">Pts</th><th class="num">W</th><th class="num">R</th></tr></thead>
              <tbody>
                ${rows.map((r, i) => {
                  const inPromo = promoIds.has(r.athlete_id) && cat !== 'A';
                  const inReleg = relegIds.has(r.athlete_id) && cat !== 'D' && n > 1;
                  const rowCls  = inPromo ? 'fech-zone-promo' : inReleg ? 'fech-zone-releg' : '';
                  const ineligWarn = ineligible.find(x => x.athlete_id === r.athlete_id) ? ' <span class="fech-inelig-tag" title="Sem rodadas jogadas — verifique elegibilidade">⚠ 0 rodadas</span>' : '';
                  const tieNote = r.tiebreak_note ? `<span class="fech-tiebreak-note" title="${escapeHtml(r.tiebreak_note)}">≡</span>` : '';
                  return `
                    <tr class="${rowCls}">
                      <td><span class="rank-position ${['gold','silver','bronze'][i]||''}">${r.rank}</span></td>
                      <td>${escapeHtml(r.nome)}${ineligWarn}${tieNote}</td>
                      <td class="num ranking-pts">${r.points}</td>
                      <td class="num ranking-stat">${r.wins}</td>
                      <td class="num ranking-stat">${r.results_count}</td>
                    </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>`;
    }).join('');

  // Banner de bloqueio por rodadas abertas
  const openRoundsBanner = openRoundsCount > 0 ? `
    <div class="alert alert-error fech-block-banner">
      <strong>Fechamento bloqueado.</strong>
      ${openRoundsCount} rodada${openRoundsCount > 1 ? 's' : ''} ainda aberta${openRoundsCount > 1 ? 's' : ''}:
      ${openRounds.map(r => `Rodada ${r.round_number}`).join(', ')}.
      Feche todas as rodadas antes de encerrar a temporada.
      <a href="#admin/rodada" style="margin-left:8px;">Ir para Rodadas →</a>
    </div>` : '';

  // Avisos de inelegibilidade
  const ineligBanner = ineligible.length > 0 ? `
    <div class="alert alert-warning">
      <strong>Atenção — atletas na zona de movimento sem rodadas jogadas:</strong>
      ${ineligible.map(w => `<br>• ${escapeHtml(w.nome)} (${catLabel(w.cat)} · ${w.rank}° · ${w.action === 'promoted' ? 'seria promovido' : w.action === 'relegated' ? 'seria rebaixado' : 'permanece'})`).join('')}
    </div>` : '';

  const seasonSelectHtml = seasons.length > 1 ? `
    <select id="fechamento-season-sel" class="input" style="font-size:13px;max-width:220px;">
      ${seasons.map(s => `<option value="${s.id}"${s.id === selectedSeason.id ? ' selected' : ''}>${escapeHtml(s.name)}${s.status === 'active' ? ' ✓' : ''}</option>`).join('')}
    </select>` : '';

  content.innerHTML = `
    <div class="section-header">
      <div>
        <h1 class="section-title">Fechamento de Temporada</h1>
        <p class="section-subtitle">${escapeHtml(selectedSeason.name)}</p>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        ${seasonSelectHtml}
        <a href="/api/seasons/${selectedSeason.id}/ranking/export.csv"
           class="btn btn-ghost btn-sm"
           title="Baixar ranking completo em CSV">
          ⬇ Exportar CSV
        </a>
      </div>
    </div>

    ${openRoundsBanner}
    ${ineligBanner}
    ${warnings.map(w => `<div class="fechamento-warning">⚠ ${escapeHtml(w)}</div>`).join('')}

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px;">
      <div>
        <p style="font-size:14px;font-weight:700;margin-bottom:12px;">
          Ranking Final
          <span style="font-size:11px;font-weight:400;color:var(--color-text-muted);margin-left:8px;">
            ≡ = desempate · ⚠ = sem rodadas
          </span>
        </p>
        ${rankingsHtml || '<p class="placeholder-text">Sem resultados ainda.</p>'}
      </div>
      <div>
        <p style="font-size:14px;font-weight:700;margin-bottom:12px;">Plano de Movimentação</p>
        ${buildMovementTable(preview?.summary)}
        ${Object.entries(projectedSizes).filter(([, n]) => n > 0).length ? `
          <div class="card" style="margin-top:12px;">
            <p style="font-size:12px;font-weight:700;color:var(--color-text-muted);margin-bottom:8px;">Tamanhos Projetados</p>
            ${Object.entries(projectedSizes).filter(([, n]) => n > 0).map(([cat, n]) => `
              <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:var(--border);font-size:13px;">
                <span>${catLabel(cat)}</span><strong>${n} titular${n !== 1 ? 'es' : ''}</strong>
              </div>`).join('')}
          </div>` : ''}
      </div>
    </div>

    ${isClosed ? `
      <div class="alert alert-info">Temporada encerrada em ${selectedSeason.closed_at || '—'}.</div>
    ` : isViewingActive ? `
      <div class="fechamento-confirm-box ${openRoundsCount > 0 ? 'fech-blocked' : ''}">
        <p style="font-size:15px;font-weight:700;color:var(--color-accent);margin-bottom:8px;">Confirmar Fechamento</p>
        <p style="font-size:13px;margin-bottom:12px;">
          Esta ação é irreversível. Os atletas serão movimentados e a temporada será encerrada.
        </p>
        ${warnings.length ? `<p style="font-size:12px;color:#BA7517;margin-bottom:12px;">⚠ ${warnings.length} aviso(s) — revise antes de confirmar.</p>` : ''}
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
          <button id="btn-fechar-temporada" class="btn btn-primary" ${openRoundsCount > 0 ? 'disabled' : ''}>
            Fechar Temporada
          </button>
          <span style="font-size:12px;color:var(--color-text-muted);">
            ${openRoundsCount > 0 ? `Bloqueado — ${openRoundsCount} rodada(s) aberta(s)` : `Movimenta ${movedCount} atleta(s)`}
          </span>
        </div>
        <p id="fechamento-msg" class="hidden" style="margin-top:12px;font-size:13px;"></p>
      </div>` : ''}`;

  content.querySelector('#fechamento-season-sel')?.addEventListener('change', e => {
    renderAdminFechamento(content, e.target.value);
  });

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
// Admin — Ligas (Ranking Contínuo)
// ---------------------------------------------------------------------------

async function renderAdminLiga(content) {
  content.innerHTML = `<p class="placeholder-text">Carregando ligas…</p>`;

  const AWARD_META = {
    rei_do_play:        { icon: '👑', label: 'Rei do Play' },
    atleta_revelacao:   { icon: '🌟', label: 'Atleta Revelação' },
    pato_do_play:       { icon: '🦆', label: 'Pato do Play' },
    melhor_performance: { icon: '⚡', label: 'Melhor Performance' },
    maior_virada:       { icon: '📈', label: 'Maior Virada' },
  };
  const ALL_AWARD_KEYS = Object.keys(AWARD_META);

  let ligas = [], allSeasons = [];
  const [ligasRes, allSeasonsRes] = await Promise.allSettled([
    api('/api/ligas'),
    api('/api/seasons'),
  ]);
  if (ligasRes.status     === 'fulfilled') ligas      = ligasRes.value;
  if (allSeasonsRes.status === 'fulfilled') allSeasons = allSeasonsRes.value;

  const year = new Date().getFullYear();

  // --- estimate seasons count from liga dates + duration ---
  function estimateSeasons(startDate, closeDate, roundsTotal, daysPerRound) {
    if (!startDate || !closeDate || !roundsTotal || !daysPerRound) return null;
    const ms = new Date(closeDate) - new Date(startDate);
    if (ms <= 0) return 0;
    const days = ms / 86400000;
    const seasonDays = roundsTotal * daysPerRound;
    return Math.floor(days / seasonDays);
  }

  // --- Liga creation / edit form ---
  function buildLigaForm(liga = null) {
    const isEdit = !!liga;
    const y = liga?.year || year;
    const activeAwards = liga?.active_awards || ALL_AWARD_KEYS;
    const rt  = liga?.default_rounds_total || 4;
    const rpd = liga?.default_round_duration_days || 10;
    const sd  = liga?.start_date  || `${y}-01-20`;
    const cd  = liga?.close_date  || `${y}-12-10`;
    const est = estimateSeasons(sd, cd, rt, rpd);

    const awardsHtml = ALL_AWARD_KEYS.map(k => `
      <label class="liga-award-toggle ${activeAwards.includes(k) ? 'active' : ''}">
        <input type="checkbox" value="${k}" ${activeAwards.includes(k) ? 'checked' : ''}>
        <span class="liga-award-icon">${AWARD_META[k].icon}</span>
        <span class="liga-award-label">${AWARD_META[k].label}</span>
      </label>`).join('');

    return `
      <div class="card liga-form-card" id="liga-form">
        <p class="form-section-label">${isEdit ? `Editar: ${escapeHtml(liga.name)}` : 'Nova Liga / Ranking Contínuo'}</p>

        <label class="form-label">Nome</label>
        <input id="lf-name" class="form-input" value="${escapeHtml(liga?.name || `Ranking Contínuo ${y}`)}" placeholder="Ex: Ranking Contínuo 2026">

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px;">
          <div>
            <label class="form-label">Ano</label>
            <input id="lf-year" class="form-input" type="number" min="2020" max="2099" value="${y}" ${isEdit ? 'disabled' : ''}>
          </div>
          <div>
            <label class="form-label">Status</label>
            <select id="lf-status" class="form-input">
              ${['active','closed','pending'].map(s =>
                `<option value="${s}" ${(liga?.status||'active')===s?'selected':''}>${{active:'Ativa',closed:'Encerrada',pending:'Pendente'}[s]}</option>`
              ).join('')}
            </select>
          </div>
        </div>

        <p class="form-section-label" style="margin-top:16px;">Período da liga</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div>
            <label class="form-label">Início</label>
            <input id="lf-start" class="form-input" type="date" value="${sd}">
          </div>
          <div>
            <label class="form-label">Encerramento</label>
            <input id="lf-close" class="form-input" type="date" value="${cd}">
          </div>
        </div>
        <div style="margin-top:8px;">
          <label class="form-label">Reabertura próximo ano</label>
          <input id="lf-reopen" class="form-input" type="date" value="${liga?.reopen_date || `${y+1}-01-20`}" style="max-width:200px;">
        </div>

        <p class="form-section-label" style="margin-top:16px;">Duração padrão das temporadas</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:end;">
          <div>
            <label class="form-label">Rodadas por temporada</label>
            <select id="lf-rounds" class="form-input">
              ${[2,3,4,5].map(n => `<option value="${n}" ${rt===n?'selected':''}>${n} rodadas</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="form-label">Dias por rodada</label>
            <input id="lf-rpd" class="form-input" type="number" min="1" max="60" value="${rpd}">
          </div>
        </div>
        <div id="lf-estimate" class="liga-estimate-badge" style="margin-top:10px;">
          ${est !== null ? `≈ <strong>${est}</strong> temporadas no período` : ''}
        </div>

        <label class="form-label" style="margin-top:16px;">Prêmios ativos</label>
        <div class="liga-awards-grid">${awardsHtml}</div>

        <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap;">
          <button class="btn btn-primary" id="btn-lf-save">${isEdit ? 'Salvar alterações' : 'Criar Liga'}</button>
          <button class="btn btn-ghost" id="btn-lf-cancel">Cancelar</button>
          <span id="lf-msg" style="font-size:13px;align-self:center;"></span>
        </div>
      </div>`;
  }

  function setupLigaForm(liga) {
    const wrap = content.querySelector('#liga-form-wrap');

    // Award toggles
    wrap.querySelectorAll('.liga-award-toggle input').forEach(cb =>
      cb.addEventListener('change', () => cb.closest('.liga-award-toggle').classList.toggle('active', cb.checked))
    );

    // Live estimate
    function refreshEstimate() {
      const sd  = wrap.querySelector('#lf-start')?.value;
      const cd  = wrap.querySelector('#lf-close')?.value;
      const rt  = parseInt(wrap.querySelector('#lf-rounds')?.value || 4);
      const rpd = parseInt(wrap.querySelector('#lf-rpd')?.value || 10);
      const est = estimateSeasons(sd, cd, rt, rpd);
      const el  = wrap.querySelector('#lf-estimate');
      if (el) el.innerHTML = est !== null ? `≈ <strong>${est}</strong> temporadas no período (${rt} rod × ${rpd} dias = ${rt*rpd} dias/temporada)` : '';
    }
    ['#lf-start','#lf-close','#lf-rounds','#lf-rpd'].forEach(sel =>
      wrap.querySelector(sel)?.addEventListener('input', refreshEstimate)
    );

    wrap.querySelector('#btn-lf-cancel').addEventListener('click', () => { wrap.innerHTML = ''; });

    wrap.querySelector('#btn-lf-save').addEventListener('click', async () => {
      const btn = wrap.querySelector('#btn-lf-save');
      const msg = wrap.querySelector('#lf-msg');
      const active_awards = [...wrap.querySelectorAll('.liga-award-toggle input:checked')].map(cb => cb.value);
      const body = {
        name:    wrap.querySelector('#lf-name').value.trim(),
        start_date: wrap.querySelector('#lf-start').value,
        close_date: wrap.querySelector('#lf-close').value,
        reopen_date: wrap.querySelector('#lf-reopen').value,
        status:  wrap.querySelector('#lf-status').value,
        default_rounds_total: parseInt(wrap.querySelector('#lf-rounds').value),
        default_round_duration_days: parseInt(wrap.querySelector('#lf-rpd').value),
        active_awards,
      };
      if (!liga) body.year = parseInt(wrap.querySelector('#lf-year').value);
      btn.disabled = true; btn.textContent = 'Salvando…';
      try {
        let saved;
        if (liga) {
          saved = await api(`/api/ligas/${liga.id}`, { method: 'PUT', body });
          const idx = ligas.findIndex(l => l.id === liga.id);
          if (idx !== -1) ligas[idx] = saved;
        } else {
          saved = await api('/api/ligas', { method: 'POST', body });
          ligas.push(saved);
        }
        wrap.innerHTML = '';
        render();
        showToast(liga ? 'Liga atualizada.' : 'Liga criada!');
      } catch (err) {
        msg.textContent = `Erro: ${err.message}`; msg.style.color = '#D94040';
        btn.disabled = false; btn.textContent = liga ? 'Salvar alterações' : 'Criar Liga';
      }
    });
  }

  // --- Season sub-form inside a liga card ---
  function buildSeasonForm(liga, nextNum, suggestedStart) {
    const name = `Temporada ${nextNum}`;
    const rt  = liga.default_rounds_total || 4;
    const rpd = liga.default_round_duration_days || 10;
    const sd  = suggestedStart || liga.start_date || '';
    const autoEnd = sd ? (() => {
      const d = new Date(sd); d.setDate(d.getDate() + rt * rpd - 1);
      return d.toISOString().slice(0,10);
    })() : '';

    return `
      <div class="liga-season-form" id="sf-${liga.id}">
        <p class="form-section-label">Nova Temporada — ${escapeHtml(liga.name)}</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div>
            <label class="form-label">Nome</label>
            <input id="sf-name-${liga.id}" class="form-input" value="${escapeHtml(name)}">
          </div>
          <div>
            <label class="form-label">Local</label>
            <input id="sf-loc-${liga.id}" class="form-input" value="Clube do Play">
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:10px;">
          <div>
            <label class="form-label">Início</label>
            <input id="sf-start-${liga.id}" class="form-input" type="date" value="${sd}">
          </div>
          <div>
            <label class="form-label">Rodadas</label>
            <select id="sf-rounds-${liga.id}" class="form-input">
              ${[2,3,4,5].map(n => `<option value="${n}" ${rt===n?'selected':''}>${n}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="form-label">Dias/rodada</label>
            <input id="sf-rpd-${liga.id}" class="form-input" type="number" min="1" max="60" value="${rpd}">
          </div>
        </div>
        <div class="liga-estimate-badge" id="sf-end-preview-${liga.id}" style="margin-top:8px;">
          ${autoEnd ? `Término estimado: <strong>${autoEnd}</strong>` : ''}
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;">
          <button class="btn btn-primary btn-sm" id="sf-save-${liga.id}">Criar Temporada</button>
          <button class="btn btn-ghost btn-sm" id="sf-cancel-${liga.id}">Cancelar</button>
          <span id="sf-msg-${liga.id}" style="font-size:12px;align-self:center;"></span>
        </div>
      </div>`;
  }

  function attachSeasonForm(liga, container) {
    const id = liga.id;
    const sfStart  = container.querySelector(`#sf-start-${id}`);
    const sfRounds = container.querySelector(`#sf-rounds-${id}`);
    const sfRpd    = container.querySelector(`#sf-rpd-${id}`);
    const sfPreview= container.querySelector(`#sf-end-preview-${id}`);

    function updateEndPreview() {
      const sd  = sfStart.value;
      const rt  = parseInt(sfRounds.value || 4);
      const rpd = parseInt(sfRpd.value || 10);
      if (!sd) { sfPreview.innerHTML = ''; return; }
      const d = new Date(sd); d.setDate(d.getDate() + rt * rpd - 1);
      sfPreview.innerHTML = `Término estimado: <strong>${d.toISOString().slice(0,10)}</strong>`;
    }
    [sfStart, sfRounds, sfRpd].forEach(el => el?.addEventListener('input', updateEndPreview));

    container.querySelector(`#sf-cancel-${id}`).addEventListener('click', () => {
      container.querySelector(`#sf-wrap-${id}`).innerHTML = '';
    });

    container.querySelector(`#sf-save-${id}`).addEventListener('click', async () => {
      const btn = container.querySelector(`#sf-save-${id}`);
      const msg = container.querySelector(`#sf-msg-${id}`);
      const sd  = sfStart.value;
      const rt  = parseInt(sfRounds.value);
      const rpd = parseInt(sfRpd.value);
      const d   = new Date(sd); d.setDate(d.getDate() + rt * rpd - 1);
      const body = {
        name:               container.querySelector(`#sf-name-${id}`).value.trim(),
        year:               liga.year,
        start_date:         sd,
        rounds_total:       rt,
        round_duration_days: rpd,
        location:           container.querySelector(`#sf-loc-${id}`).value.trim() || 'Clube do Play',
        location_mode:      'single',
        liga_id:            liga.id,
      };
      btn.disabled = true; btn.textContent = 'Criando…';
      try {
        const season = await api('/api/seasons', { method: 'POST', body });
        // update local liga seasons list
        const lObj = ligas.find(l => l.id === id);
        if (lObj) { lObj.seasons = lObj.seasons || []; lObj.seasons.push(season.id); }
        allSeasons.push(season);
        container.querySelector(`#sf-wrap-${id}`).innerHTML = '';
        renderLigaSeasons(liga, container);
        showToast(`Temporada "${season.name}" criada!`);
      } catch (err) {
        msg.textContent = `Erro: ${err.message}`; msg.style.color = '#D94040';
        btn.disabled = false; btn.textContent = 'Criar Temporada';
      }
    });
  }

  function renderLigaSeasons(liga, card) {
    const seasonsWrap = card.querySelector(`#seasons-wrap-${liga.id}`);
    if (!seasonsWrap) return;
    const linked = allSeasons.filter(s => s.liga_id === liga.id)
      .sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''));

    const rt  = liga.default_rounds_total || 4;
    const rpd = liga.default_round_duration_days || 10;
    const est = estimateSeasons(liga.start_date, liga.close_date, rt, rpd);
    const statusLabel = { pending:'Pendente', active:'Ativa', closed:'Encerrada' };

    // Suggest start for next season: day after last season ends, or liga start
    const lastSeason = linked[linked.length - 1];
    let nextStart = liga.start_date || '';
    if (lastSeason?.end_date) {
      const d = new Date(lastSeason.end_date); d.setDate(d.getDate() + 1);
      nextStart = d.toISOString().slice(0, 10);
    }

    seasonsWrap.innerHTML = `
      <div class="liga-seasons-header">
        <span class="liga-seasons-count">
          ${linked.length} temporada${linked.length !== 1 ? 's' : ''} criada${linked.length !== 1 ? 's' : ''}
          ${est !== null ? `<span class="liga-estimate-inline">/ ~${est} estimada${est !== 1 ? 's' : ''}</span>` : ''}
        </span>
        <button class="btn btn-ghost btn-sm" id="btn-new-season-${liga.id}">+ Nova Temporada</button>
      </div>
      ${linked.length ? `
        <div class="liga-seasons-list">
          ${linked.map(s => `
            <div class="liga-season-row">
              <span class="liga-season-name">${escapeHtml(s.name)}</span>
              <span class="liga-season-dates">${s.start_date || '?'} → ${s.end_date || '?'}</span>
              <span class="liga-season-info">${s.rounds_total} rod · ${s.round_duration_days} dias/rod</span>
              <span class="liga-season-status liga-status-${s.status}">${statusLabel[s.status] || s.status}</span>
            </div>`).join('')}
        </div>` : `<p style="font-size:12px;color:var(--color-text-muted);margin:6px 0 0;">Nenhuma temporada criada ainda.</p>`}
      <div id="sf-wrap-${liga.id}"></div>`;

    seasonsWrap.querySelector(`#btn-new-season-${liga.id}`).addEventListener('click', () => {
      const sfWrap = seasonsWrap.querySelector(`#sf-wrap-${liga.id}`);
      if (sfWrap.innerHTML) { sfWrap.innerHTML = ''; return; }
      sfWrap.innerHTML = buildSeasonForm(liga, linked.length + 1, nextStart);
      attachSeasonForm(liga, seasonsWrap);
    });
  }

  // --- Main render ---
  function render() {
    const ligasHtml = ligas.length ? ligas.map(l => {
      const rt  = l.default_rounds_total || 4;
      const rpd = l.default_round_duration_days || 10;
      const est = estimateSeasons(l.start_date, l.close_date, rt, rpd);
      return `
        <div class="liga-card" data-id="${l.id}">
          <div class="liga-card-header">
            <span class="liga-card-name">${escapeHtml(l.name)}</span>
            <span class="liga-status-badge liga-status-${l.status}">${
              {active:'Ativa',closed:'Encerrada',pending:'Pendente'}[l.status]||l.status}</span>
          </div>
          <div class="liga-card-meta">
            📅 ${l.year} &nbsp;·&nbsp; ${l.start_date||'?'} → ${l.close_date||'?'} &nbsp;·&nbsp; Reabre ${l.reopen_date||'?'}
            &nbsp;·&nbsp; ${rt} rod × ${rpd} dias = ${rt*rpd} dias/temporada
            ${est !== null ? `<span class="liga-estimate-inline">&nbsp;≈ ${est} temporadas</span>` : ''}
          </div>
          <div class="liga-card-awards">
            ${(l.active_awards||[]).map(k=>`<span class="liga-award-chip">${AWARD_META[k]?.icon||''} ${AWARD_META[k]?.label||k}</span>`).join('')}
          </div>
          <div id="seasons-wrap-${l.id}" class="liga-seasons-wrap"></div>
          <div class="liga-card-actions" style="margin-top:10px;">
            <button class="btn btn-ghost btn-sm" onclick="editLiga('${l.id}')">Editar Liga</button>
            <a href="#admin/anual?liga=${l.id}" class="btn btn-ghost btn-sm">Ver Premiações</a>
            <button class="btn btn-ghost btn-sm btn-danger" onclick="deleteLiga('${l.id}','${escapeHtml(l.name)}')">Excluir</button>
          </div>
        </div>`;
    }).join('') :
    `<div class="empty-state"><div class="empty-state-icon">🔗</div>
     <p class="empty-state-title">Nenhuma liga criada</p>
     <p>Crie a primeira liga para iniciar o Ranking Contínuo.</p></div>`;

    content.innerHTML = `
      <div class="section-header">
        <div><h1 class="section-title">Ligas / Ranking Contínuo</h1>
          <p class="section-subtitle">Cada liga abrange um ano, define as temporadas e os prêmios do período.</p>
        </div>
        <button class="btn btn-primary" id="btn-new-liga">+ Nova Liga</button>
      </div>
      <div id="liga-form-wrap"></div>
      <div id="ligas-list">${ligasHtml}</div>`;

    content.querySelector('#btn-new-liga').addEventListener('click', () => {
      content.querySelector('#liga-form-wrap').innerHTML = buildLigaForm();
      setupLigaForm(null);
      content.querySelector('#liga-form-wrap').scrollIntoView({ behavior: 'smooth' });
    });

    // Render seasons for each liga card
    ligas.forEach(l => {
      const card = content.querySelector(`[data-id="${l.id}"]`);
      if (card) renderLigaSeasons(l, card);
    });
  }

  window.editLiga = (id) => {
    const liga = ligas.find(l => l.id === id);
    if (!liga) return;
    content.querySelector('#liga-form-wrap').innerHTML = buildLigaForm(liga);
    setupLigaForm(liga);
    content.querySelector('#liga-form-wrap').scrollIntoView({ behavior: 'smooth' });
  };

  window.deleteLiga = (id, name) => {
    const liga = ligas.find(l => l.id === id);
    const nSeasons = (liga?.seasons || []).length;
    const msg = nSeasons
      ? `Excluir "${name}"? Esta liga tem ${nSeasons} temporada(s) vinculada(s) — ELAS E TODOS OS DADOS (rodadas, resultados) serão apagados em cascata. Ação irreversível.`
      : `Excluir "${name}"? Ação irreversível.`;
    confirmModal('Excluir Liga', msg, async () => {
      // Com temporadas: segunda confirmação explícita antes do hard delete em cascata.
      if (nSeasons && !confirm(`Confirmar exclusão definitiva da liga "${name}" e suas ${nSeasons} temporada(s)?`)) return;
      try {
        const res = await api(`/api/ligas/${id}`, { method: 'DELETE', body: nSeasons ? { confirm: true } : {} });
        ligas = ligas.filter(l => l.id !== id);
        render();
        showToast(res?.seasons_deleted ? `Liga excluída (${res.seasons_deleted} temporada(s) apagada(s)).` : 'Liga excluída.');
      } catch (err) { showToast(`Erro: ${err.message}`, 'error'); }
    }, 'Excluir');
  };

  render();
}


// ---------------------------------------------------------------------------
// Admin — Premiações Anuais (Ranking Contínuo)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Admin: Lesões e Convidados
// ---------------------------------------------------------------------------

async function renderAdminLesoes(content) {
  content.innerHTML = `<p class="placeholder-text">Carregando…</p>`;

  let athletes = [], seasons = [], injuries = [], guestRequests = [];
  const [athRes, seaRes, injRes, guestRes] = await Promise.allSettled([
    api('/api/athletes'),
    api('/api/seasons'),
    api('/api/injuries'),
    api('/api/guest-requests'),
  ]);
  if (athRes.status   === 'fulfilled') athletes      = athRes.value;
  if (seaRes.status   === 'fulfilled') seasons       = seaRes.value;
  if (injRes.status   === 'fulfilled') injuries      = injRes.value;
  if (guestRes.status === 'fulfilled') guestRequests = guestRes.value;

  const athletesById = Object.fromEntries(athletes.map(a => [a.id, a]));
  const activeSeason = seasons.find(s => s.status === 'active') || seasons[seasons.length - 1];
  const activeInjuries   = injuries.filter(i => i.status === 'active');
  const pendingRequests  = guestRequests.filter(r => r.status === 'pending');
  const readyGuests      = guestRequests.filter(r => r.status === 'confirmed' && r.confirmed_guest?.registered);

  const tipoLabel = { lesao: 'Lesão', viagem: 'Viagem', outro: 'Outro' };
  const tipoColor = { lesao: '#D94040', viagem: '#BA7517', outro: 'var(--color-text-muted)' };

  function injuryCard(inj) {
    const declaredLabel = inj.declared_by === 'admin' ? 'Admin' : (athletesById[inj.declared_by]?.nome || inj.declared_by);
    const filled = inj.vacancy_filled_by
      ? `<span style="font-size:12px;color:#69DB7C;">Reserva promovido: ${escapeHtml(athletesById[inj.vacancy_filled_by]?.nome || inj.vacancy_filled_by)}</span>`
      : `<span style="font-size:12px;color:var(--color-text-muted);">Sem reserva — vaga em aberto</span>`;
    return `
      <div class="injury-card" data-id="${inj.id}">
        <div class="injury-card-header">
          <span class="injury-type-badge" style="background:${tipoColor[inj.tipo]}20;color:${tipoColor[inj.tipo]};border:1px solid ${tipoColor[inj.tipo]}40;">
            ${tipoLabel[inj.tipo] || inj.tipo}
          </span>
          <span class="injury-athlete">${escapeHtml(inj.athlete_nome || athletesById[inj.athlete_id]?.nome || inj.athlete_id)}</span>
          <span class="injury-cat">${catLabel(inj.category)}</span>
          <button class="btn btn-ghost btn-sm" style="margin-left:auto;font-size:12px;color:#D94040;"
            onclick="deleteInjury('${inj.id}')">Cancelar</button>
        </div>
        <div class="injury-card-meta">
          <span>Início: <strong>${inj.start_date}</strong></span>
          <span>Retorno previsto: <strong>${inj.recovery_date}</strong></span>
          <span>${inj.duration_days} dia(s)</span>
          <span>Declarado por: ${escapeHtml(declaredLabel)}</span>
        </div>
        ${inj.notes ? `<p style="font-size:12px;color:var(--color-text-muted);margin:4px 0 0;">${escapeHtml(inj.notes)}</p>` : ''}
        <div style="margin-top:6px;">${filled}</div>
      </div>`;
  }

  function guestRequestCard(gr) {
    const suggestionsHtml = gr.suggestions.length
      ? gr.suggestions.map(s => {
          const nome = s.nome_externo || athletesById[s.athlete_id]?.nome || s.athlete_id || '?';
          const by   = s.suggested_by === 'admin' ? 'Admin' : (athletesById[s.suggested_by]?.nome || s.suggested_by);
          const tel  = s.telefone ? `<span style="font-size:11px;color:var(--color-text-muted);">📱 ${s.telefone}</span>` : '';
          return `<div class="suggestion-row">
            <div style="display:flex;flex-direction:column;gap:2px;flex:1;">
              <span style="font-weight:600;">${escapeHtml(nome)}</span>
              <div style="display:flex;gap:8px;align-items:center;">
                ${tel}
                <span style="font-size:11px;color:var(--color-text-muted);">por ${escapeHtml(by)}</span>
              </div>
            </div>
            <button class="btn btn-sm btn-primary"
              onclick="confirmGuestWithLink('${gr.id}', '${s.id}', '${escapeHtml(s.nome_externo || '')}', '${s.telefone || ''}')">
              Confirmar + Gerar Link
            </button>
          </div>`;
        }).join('')
      : `<p style="font-size:12px;color:var(--color-text-muted);">Nenhuma sugestão ainda.</p>`;

    return `
      <div class="guest-request-card" data-id="${gr.id}">
        <div class="guest-request-header">
          ${catLabel(gr.cat)} Grupo ${gr.group_idx + 1}
          <span style="font-size:12px;color:var(--color-text-muted);margin-left:8px;">Rodada: ${gr.round_id.slice(0,8)}…</span>
        </div>
        <div style="margin:8px 0 4px;font-size:12px;font-weight:700;">Sugestões dos atletas:</div>
        ${suggestionsHtml}
        <div class="guest-actions" style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-sm btn-primary" onclick="openAddGuestModal('${gr.id}')">+ Indicar convidado</button>
          <button class="btn btn-sm btn-ghost" style="color:#D94040;" onclick="markGuestWo('${gr.id}')">Marcar W.O.</button>
        </div>
      </div>`;
  }

  function readyGuestCard(gr) {
    const cg = gr.confirmed_guest;
    const inj = injuries.find(i => i.id === gr.injury_id);
    const injuredName = inj
      ? escapeHtml(athletesById[inj.athlete_id]?.nome || inj.athlete_id)
      : '—';
    const injuredId = inj?.athlete_id || null;

    return `
      <div class="guest-request-card" style="border-left-color:#69DB7C;" data-id="${gr.id}">
        <div class="guest-request-header" style="color:#69DB7C;">
          ✅ ${catLabel(gr.cat)} Grupo ${gr.group_idx + 1} — Convidado Pronto
        </div>
        <div style="margin:8px 0;font-size:13px;">
          <strong>${escapeHtml(cg.nome_display)}</strong>
          ${cg.telefone ? `<span style="font-size:12px;color:var(--color-text-muted);margin-left:6px;">📱 ${escapeHtml(cg.telefone)}</span>` : ''}
        </div>
        ${injuredId ? `
        <p style="font-size:12px;color:var(--color-text-muted);margin-bottom:8px;">
          Substitui: <strong>${injuredName}</strong>
        </p>
        <button class="btn btn-sm btn-primary"
          onclick="addGuestToRound('${gr.id}', '${gr.round_id}', '${gr.cat}', ${gr.group_idx}, '${injuredId}', '${cg.guest_id}', '${escapeHtml(cg.nome_display)}')">
          Adicionar à Rodada
        </button>` : `
        <p style="font-size:12px;color:var(--color-text-muted);margin-bottom:8px;">
          Lesão não vinculada — selecione o atleta a substituir manualmente.
        </p>
        <button class="btn btn-sm btn-primary"
          onclick="addGuestToRoundManual('${gr.id}', '${gr.round_id}', '${gr.cat}', ${gr.group_idx}, '${cg.guest_id}', '${escapeHtml(cg.nome_display)}')">
          Adicionar à Rodada (escolher atleta)
        </button>`}
      </div>`;
  }

  const injuriesHtml = activeInjuries.length
    ? activeInjuries.map(injuryCard).join('')
    : `<p class="placeholder-text">Nenhuma lesão ativa.</p>`;

  const pendingHtml = pendingRequests.length
    ? pendingRequests.map(guestRequestCard).join('')
    : `<p class="placeholder-text">Nenhum pedido de convidado pendente.</p>`;

  const readyHtml = readyGuests.length
    ? readyGuests.map(readyGuestCard).join('')
    : '';

  const defaultSeason = seasons.find(s => s.status === 'active') || seasons[seasons.length - 1];
  const seasonOptions = seasons
    .filter(s => s.status !== 'cancelled')
    .map(s => `<option value="${s.id}" ${s.id === defaultSeason?.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('');

  content.innerHTML = `
    <div class="section-header">
      <div>
        <h1 class="section-title">Lesões e Convidados</h1>
        <p class="section-subtitle">Gerencie afastamentos e substitutos por rodada.</p>
      </div>
    </div>

    <div class="lesoes-grid">

      <!-- Declarar nova lesão -->
      <div class="card" style="padding:var(--space-md);">
        <p style="font-size:13px;font-weight:700;margin:0 0 12px;">Declarar Afastamento</p>
        <div class="form-grid-2">
          <div class="form-group">
            <label class="form-label">Atleta</label>
            <select id="inj-athlete" class="form-input">
              <option value="">Selecione…</option>
              ${athletes.map(a => `<option value="${a.id}">${escapeHtml(a.nome)} — Cat ${a.current_category || '?'}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Temporada</label>
            <select id="inj-season" class="form-input">${seasonOptions}</select>
          </div>
          <div class="form-group">
            <label class="form-label">Tipo</label>
            <select id="inj-tipo" class="form-input">
              <option value="lesao">Lesão</option>
              <option value="viagem">Viagem</option>
              <option value="outro">Outro</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Data de início</label>
            <input id="inj-start" type="date" class="form-input" value="${new Date().toISOString().slice(0,10)}">
          </div>
          <div class="form-group">
            <label class="form-label">Dias de afastamento</label>
            <input id="inj-days" type="number" class="form-input" min="1" max="365" placeholder="ex: 30" value="30">
          </div>
          <div class="form-group" style="grid-column:1/-1;">
            <label class="form-label">Observações</label>
            <input id="inj-notes" type="text" class="form-input" placeholder="Opcional">
          </div>
        </div>
        <div style="margin-top:4px;font-size:12px;color:var(--color-text-muted);" id="inj-recovery-preview"></div>
        <button id="btn-declarar-lesao" class="btn btn-primary" style="margin-top:12px;">Declarar Afastamento</button>
        <span id="inj-msg" style="font-size:13px;margin-left:10px;"></span>
      </div>

      <!-- Lesões ativas -->
      <div>
        <p style="font-size:13px;font-weight:700;margin:0 0 10px;">Afastamentos Ativos (${activeInjuries.length})</p>
        ${injuriesHtml}
      </div>

      <!-- Pedidos de convidado pendentes -->
      <div>
        <p style="font-size:13px;font-weight:700;margin:0 0 10px;">Pedidos de Convidado Pendentes (${pendingRequests.length})</p>
        ${pendingHtml}
        ${readyHtml ? `
        <p style="font-size:13px;font-weight:700;margin:16px 0 10px;color:#69DB7C;">Convidados Prontos para Adicionar</p>
        ${readyHtml}` : ''}
      </div>

    </div>`;

  // Preview de retorno
  function updateRecoveryPreview() {
    const start = content.querySelector('#inj-start').value;
    const days  = parseInt(content.querySelector('#inj-days').value);
    const el    = content.querySelector('#inj-recovery-preview');
    if (start && days > 0) {
      const dt = new Date(start + 'T12:00:00');
      dt.setDate(dt.getDate() + days);
      el.textContent = `Retorno previsto: ${dt.toISOString().slice(0, 10)}`;
    } else {
      el.textContent = '';
    }
  }
  content.querySelector('#inj-start').addEventListener('input', updateRecoveryPreview);
  content.querySelector('#inj-days').addEventListener('input', updateRecoveryPreview);
  updateRecoveryPreview();

  // Declarar lesão
  content.querySelector('#btn-declarar-lesao').addEventListener('click', async () => {
    const athleteId = content.querySelector('#inj-athlete').value;
    const seasonId  = content.querySelector('#inj-season').value;
    const tipo      = content.querySelector('#inj-tipo').value;
    const startDate = content.querySelector('#inj-start').value;
    const days      = parseInt(content.querySelector('#inj-days').value);
    const notes     = content.querySelector('#inj-notes').value;
    const msg       = content.querySelector('#inj-msg');

    if (!athleteId || !seasonId || !startDate || !days) {
      msg.textContent = 'Preencha atleta, temporada, data e dias.';
      msg.style.color = '#D94040'; return;
    }
    try {
      const res = await api('/api/injuries', { method: 'POST', body: { athlete_id: athleteId, season_id: seasonId, tipo, start_date: startDate, duration_days: days, notes } });
      const promoted = res.reserva_promoted;
      showToast(promoted ? `Lesão declarada. Reserva promovido!` : `Lesão declarada. Vaga em aberto.`);
      await renderAdminLesoes(content);
    } catch (err) {
      msg.textContent = `Erro: ${err.message}`;
      msg.style.color = '#D94040';
    }
  });
}

window.deleteInjury = async function(id) {
  confirmModal('Cancelar Afastamento', 'Cancelar este registro de lesão?', async () => {
    try {
      await api(`/api/injuries/${id}`, { method: 'DELETE' });
      showToast('Afastamento cancelado.');
      const content = app.querySelector('#admin-content');
      await renderAdminLesoes(content);
    } catch (err) { showToast('Erro: ' + err.message, 'error'); }
  });
};

window.openAddGuestModal = function(grId) {
  openModal('Indicar Convidado',
    `<div class="form-group">
       <label class="form-label">Nome completo</label>
       <input id="guest-nome-ext" class="form-input" placeholder="Nome do convidado" autofocus>
     </div>
     <div class="form-group">
       <label class="form-label">Telefone (WhatsApp)</label>
       <input id="guest-telefone" class="form-input" placeholder="55 11 99999-9999" inputmode="tel">
     </div>
     <p style="font-size:12px;color:var(--color-text-muted);">Um link de cadastro será gerado para enviar ao convidado.</p>
     <p id="guest-modal-err" class="field-error hidden"></p>`,
    `<button id="btn-guest-confirm" class="btn btn-primary">Confirmar + Gerar Link</button>
     <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>`
  );
  document.getElementById('btn-guest-confirm').addEventListener('click', async () => {
    const nome = document.getElementById('guest-nome-ext').value.trim();
    const tel  = document.getElementById('guest-telefone').value.trim();
    const err  = document.getElementById('guest-modal-err');
    if (!nome) {
      err.textContent = 'Nome obrigatório.';
      err.classList.remove('hidden'); return;
    }
    try {
      const res = await api(`/api/guest-requests/${grId}/confirm`, {
        method: 'POST',
        body: { nome_externo: nome, telefone: tel, guest_type: 'convidado' },
      });
      closeModal();
      showGuestLink(res.register_link, nome);
      const content = app.querySelector('#admin-content');
      await renderAdminLesoes(content);
    } catch (e) {
      err.textContent = 'Erro: ' + e.message;
      err.classList.remove('hidden');
    }
  });
};

window.confirmGuestWithLink = async function(grId, suggestionId, nome, telefone) {
  try {
    const res = await api(`/api/guest-requests/${grId}/confirm`, {
      method: 'POST',
      body: { suggestion_id: suggestionId, nome_externo: nome, telefone, guest_type: 'convidado' },
    });
    showGuestLink(res.register_link, nome);
    const content = app.querySelector('#admin-content');
    await renderAdminLesoes(content);
  } catch (err) { showToast('Erro: ' + err.message, 'error'); }
};

function showGuestLink(link, nome) {
  openModal('Link de Cadastro Gerado',
    `<p style="font-size:14px;margin-bottom:12px;">
       Envie este link para <strong>${escapeHtml(nome)}</strong> via WhatsApp:
     </p>
     <div class="guest-link-box" id="guest-link-text">${escapeHtml(link)}</div>
     <p style="font-size:12px;color:var(--color-text-muted);margin-top:8px;">
       O convidado acessa o link, define um PIN e já pode fazer login na rodada.
     </p>`,
    `<button id="btn-copy-link" class="btn btn-primary">Copiar Link</button>
     <button class="btn btn-ghost" onclick="closeModal()">Fechar</button>`
  );
  document.getElementById('btn-copy-link').addEventListener('click', () => {
    navigator.clipboard.writeText(link).then(() => {
      document.getElementById('btn-copy-link').textContent = 'Copiado!';
    });
  });
};

window.markGuestWo = async function(grId) {
  confirmModal('Marcar W.O.', 'Confirma W.O. para este grupo? O grupo não terá resultado nesta rodada.', async () => {
    try {
      await api(`/api/guest-requests/${grId}/wo`, { method: 'POST' });
      showToast('W.O. registrado.');
      const content = app.querySelector('#admin-content');
      await renderAdminLesoes(content);
    } catch (err) { showToast('Erro: ' + err.message, 'error'); }
  });
};

window.addGuestToRound = async function(grId, roundId, cat, groupIdx, oldAthleteId, newAthleteId, nomePara) {
  confirmModal(
    'Adicionar Convidado à Rodada',
    `Confirma a entrada de <strong>${escapeHtml(nomePara)}</strong> no grupo ${cat}${groupIdx + 1}?`,
    async () => {
      try {
        await api(`/api/rounds/${roundId}/substitute`, {
          method: 'POST',
          body: { cat, group_idx: groupIdx, old_athlete_id: oldAthleteId, new_athlete_id: newAthleteId, guest_request_id: grId },
        });
        showToast(`${nomePara} adicionado ao grupo com sucesso!`);
        const content = app.querySelector('#admin-content');
        await renderAdminLesoes(content);
      } catch (err) { showToast('Erro: ' + err.message, 'error'); }
    }
  );
};

window.addGuestToRoundManual = async function(grId, roundId, cat, groupIdx, newAthleteId, nomePara) {
  // Fetch the round to list the current group members for selection
  let rnd;
  try { rnd = await api(`/api/rounds/${roundId}`); }
  catch (err) { showToast('Erro ao carregar rodada: ' + err.message, 'error'); return; }

  const group = rnd.groups?.[cat]?.[groupIdx] || [];
  let athletes = [];
  try { athletes = await api('/api/athletes'); } catch (_) {}
  const byId = Object.fromEntries(athletes.map(a => [a.id, a]));

  const opts = group.map(aid =>
    `<option value="${aid}">${escapeHtml(byId[aid]?.nome || aid)}</option>`
  ).join('');

  openModal(
    'Escolher atleta a substituir',
    `<p style="font-size:13px;margin-bottom:12px;">Quem <strong>${escapeHtml(nomePara)}</strong> vai substituir?</p>
     <select id="manual-old-athlete" class="form-input">${opts}</select>`,
    `<button id="btn-manual-sub" class="btn btn-primary">Confirmar Substituição</button>
     <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>`
  );
  document.getElementById('btn-manual-sub').addEventListener('click', async () => {
    const oldId = document.getElementById('manual-old-athlete').value;
    closeModal();
    await window.addGuestToRound(grId, roundId, cat, groupIdx, oldId, newAthleteId, nomePara);
  });
};

async function renderAdminAnual(content) {
  content.innerHTML = `<p class="placeholder-text">Carregando…</p>`;

  // Check for ?liga= param in URL hash
  const hashParams = new URLSearchParams(location.hash.split('?')[1] || '');
  const preselectedLiga = hashParams.get('liga');

  let ligas = [], galeria = [];
  const [ligasRes, galeriaRes] = await Promise.allSettled([
    api('/api/ligas'),
    api('/api/titles').then(d => d.titles || []),
  ]);
  if (ligasRes.status   === 'fulfilled') ligas   = ligasRes.value;
  if (galeriaRes.status === 'fulfilled') galeria  = galeriaRes.value;
  if (ligasRes.status   !== 'fulfilled' && galeriaRes.status !== 'fulfilled') {
    content.innerHTML = `<p class="placeholder-text" style="color:#D94040">Erro ao carregar dados de premiações.</p>`;
    return;
  }

  const AWARD_META = {
    rei_do_play:        { icon: '👑', label: 'Rei do Play',       stat: e => `${e.pts_per_round?.toFixed(2) || '—'} pts/rod` },
    atleta_revelacao:   { icon: '🌟', label: 'Atleta Revelação',   stat: e => `${e.promotions_count || 0} promoção(ões)` },
    pato_do_play:       { icon: '🦆', label: 'Pato do Play',       stat: e => `${e.demotions_count || 0} rebaixamento(s)` },
    melhor_performance: { icon: '⚡', label: 'Melhor Performance',  stat: e => `${e.best_round_pts ?? '—'} pts (saldo ${e.best_round_saldo ?? '—'})` },
    maior_virada:       { icon: '📈', label: 'Maior Virada',        stat: e => `+${e.virada?.toFixed ? e.virada.toFixed(2) : e.virada ?? '—'} pts/rod de evolução` },
  };

  function awardCard(key, winner, inactive) {
    const meta = AWARD_META[key];
    if (inactive) return `
      <div class="award-card award-inactive">
        <div class="award-icon">${meta.icon}</div>
        <div class="award-name">${meta.label}</div>
        <div class="award-winner">— inativo —</div>
      </div>`;
    if (!winner) return `
      <div class="award-card award-empty">
        <div class="award-icon">${meta.icon}</div>
        <div class="award-name">${meta.label}</div>
        <div class="award-winner">Nenhum elegível</div>
      </div>`;
    return `
      <div class="award-card award-filled">
        <div class="award-icon">${meta.icon}</div>
        <div class="award-name">${meta.label}</div>
        <div class="award-winner">${escapeHtml(winner.nome)}</div>
        <div class="award-stat">${catLabel(winner.category)} · ${meta.stat(winner)}</div>
      </div>`;
  }

  async function renderLiga(ligaId) {
    const ligaSection = content.querySelector('#liga-awards-section');
    ligaSection.innerHTML = `<p class="placeholder-text">Carregando premiações…</p>`;
    let data;
    try {
      data = await api(`/api/ligas/${ligaId}/awards`);
    } catch (err) {
      ligaSection.innerHTML = `<p style="color:#D94040">Erro: ${escapeHtml(err.message)}</p>`;
      return;
    }

    const { liga, awards, active_awards, ranking } = data;
    const jaGravado = galeria.some(t => t.liga_id === ligaId);

    const awardsHtml = Object.keys(AWARD_META).map(key => {
      const isActive = active_awards.includes(key);
      const winner = awards[key];
      return awardCard(key, isActive ? winner : null, !isActive);
    }).join('');

    const rankingHtml = ranking.length ? `
      <div class="card" style="padding:0;overflow:hidden;">
        <table class="annual-ranking-table">
          <thead><tr>
            <th>#</th><th>Atleta</th><th>Cat</th>
            <th class="num">Temporadas</th><th class="num">WS</th>
          </tr></thead>
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
      </div>` : `<p class="placeholder-text">Nenhum atleta elegível ainda.</p>`;

    // Ranking por categoria — agrupa por última categoria jogada, ordena por pts/rod desc
    const catOrder = ['A', 'B', 'C', 'D'];
    const byCat = catOrder.reduce((acc, c) => ({ ...acc, [c]: [] }), {});
    ranking.forEach(e => { if (byCat[e.category]) byCat[e.category].push(e); });
    catOrder.forEach(c => {
      byCat[c].sort((a, b) => {
        const ppr = e => {
          const pts = (e.seasons_played || []).reduce((s, sp) => s + sp.points, 0);
          const rds = (e.seasons_played || []).reduce((s, sp) => s + sp.rounds_played, 0);
          return rds ? pts / rds : 0;
        };
        return ppr(b) - ppr(a);
      });
    });
    const catRankingHtml = catOrder
      .filter(c => byCat[c].length > 0)
      .map(c => {
        const rows = byCat[c].map((e, i) => {
          const totalPts = (e.seasons_played || []).reduce((s, sp) => s + (sp.points || 0), 0);
          const totalRds = (e.seasons_played || []).reduce((s, sp) => s + (sp.rounds_played || 0), 0);
          const ppr = totalRds ? (totalPts / totalRds).toFixed(2) : '—';
          return `
          <tr>
            <td><span class="rank-position ${i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : ''}">${i + 1}</span></td>
            <td>${escapeHtml(e.nome)}</td>
            <td class="num">${e.seasons_count}</td>
            <td class="num">${ppr}</td>
          </tr>`;
        }).join('');
        return `
          <div style="margin-bottom:16px;">
            <p style="font-size:12px;font-weight:700;margin:0 0 6px;display:flex;align-items:center;gap:8px;">
              ${catLabel(c)} <span style="font-weight:400;color:var(--color-text-muted);">${byCat[c].length} atleta(s)</span>
            </p>
            <div class="card" style="padding:0;overflow:hidden;">
              <table class="annual-ranking-table">
                <thead><tr>
                  <th>#</th><th>Atleta</th>
                  <th class="num">Temp.</th><th class="num">Pts/Rod</th>
                </tr></thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          </div>`;
      }).join('');

    ligaSection.innerHTML = `
      <p style="font-size:13px;font-weight:700;margin:0 0 12px;">
        ${escapeHtml(liga.name)} · ${liga.year} · Encerra ${liga.close_date}
      </p>
      <div class="awards-grid">${awardsHtml}</div>

      <p style="font-size:13px;font-weight:700;margin:20px 0 8px;">Ranking Geral ${liga.year}</p>
      ${rankingHtml}

      ${ranking.length ? `
      <p style="font-size:13px;font-weight:700;margin:20px 0 8px;">Ranking por Categoria</p>
      ${catRankingHtml}` : ''}

      <div style="margin-top:20px;">
        ${jaGravado
          ? `<div class="alert alert-info">Premiações de ${liga.year} já registradas na galeria.</div>`
          : (ranking.length
            ? `<div class="fechamento-confirm-box">
                <p style="font-size:14px;font-weight:700;color:var(--color-accent);margin-bottom:6px;">Registrar Premiações ${liga.year}</p>
                <p style="font-size:13px;margin-bottom:12px;">Grava os prêmios e ranking na galeria histórica. Definitivo.</p>
                <button id="btn-apply-awards" class="btn btn-primary">Registrar na Galeria</button>
                <span id="awards-apply-msg" style="font-size:13px;margin-left:10px;"></span>
               </div>`
            : '')}
      </div>`;

    ligaSection.querySelector('#btn-apply-awards')?.addEventListener('click', () => {
      confirmModal('Registrar Premiações', `Registrar premiações de ${liga.year} na galeria?`, async () => {
        const btn = ligaSection.querySelector('#btn-apply-awards');
        btn.disabled = true; btn.textContent = 'Registrando…';
        try {
          await api(`/api/ligas/${ligaId}/awards/apply`, { method: 'POST' });
          galeria = (await api('/api/titles')).titles || [];
          showToast(`Premiações de ${liga.year} registradas!`);
          renderLiga(ligaId);
        } catch (err) {
          const msg = ligaSection.querySelector('#awards-apply-msg');
          msg.textContent = `Erro: ${err.message}`;
          msg.style.color = '#D94040';
          btn.disabled = false; btn.textContent = 'Registrar na Galeria';
        }
      }, 'Registrar');
    });
  }

  if (!ligas.length) {
    content.innerHTML = `
      <div class="section-header">
        <h1 class="section-title">Premiações Anuais</h1>
      </div>
      <div class="empty-state">
        <div class="empty-state-icon">🏆</div>
        <p class="empty-state-title">Nenhuma liga criada</p>
        <p>Crie uma liga em <a href="#admin/liga">🔗 Ligas</a> para gerenciar as premiações.</p>
      </div>`;
    return;
  }

  const currentLigaId = preselectedLiga || ligas[0]?.id;

  const selectHtml = ligas.map(l =>
    `<option value="${l.id}" ${l.id === currentLigaId ? 'selected' : ''}>${escapeHtml(l.name)} (${l.year})</option>`
  ).join('');

  content.innerHTML = `
    <div class="section-header">
      <div><h1 class="section-title">Premiações Anuais</h1>
        <p class="section-subtitle">Selecione uma liga para ver prêmios e ranking.</p>
      </div>
    </div>
    <div style="margin-bottom:20px;">
      <label class="form-label">Liga</label>
      <select id="liga-select" class="form-input" style="max-width:360px;">${selectHtml}</select>
    </div>
    <div id="liga-awards-section"><p class="placeholder-text">Carregando…</p></div>`;

  content.querySelector('#liga-select').addEventListener('change', e => {
    renderLiga(e.target.value);
  });

  renderLiga(currentLigaId);
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

  const AWARD_META = {
    rei_do_play:        { icon: '👑', label: 'Rei do Play' },
    atleta_revelacao:   { icon: '🌟', label: 'Atleta Revelação' },
    pato_do_play:       { icon: '🦆', label: 'Pato do Play' },
    melhor_performance: { icon: '⚡', label: 'Melhor Performance' },
    maior_virada:       { icon: '📈', label: 'Maior Virada' },
  };

  container.innerHTML = titles.map(t => {
    const awards = t.awards || {};
    const awardNames = t.award_names || {};
    const awardIcons = t.award_icons || {};
    const activeAwards = t.active_awards || Object.keys(AWARD_META);

    const awardsHtml = activeAwards.map(key => {
      const winner = awards[key];
      const meta = AWARD_META[key] || { icon: awardIcons[key] || '🏆', label: awardNames[key] || key };
      if (!winner) return `
        <div class="galeria-title-item" style="opacity:.5;">
          <div>${meta.icon} ${meta.label}</div>
          <span style="font-size:12px;color:var(--color-text-muted);">—</span>
        </div>`;
      return `
        <div class="galeria-title-item">
          <div>${meta.icon} ${meta.label}</div>
          <strong>${escapeHtml(winner.nome)}</strong>
          <div style="font-size:11px;color:var(--color-text-muted);">${catLabel(winner.category)}</div>
        </div>`;
    }).join('');

    const ligaLabel = t.liga_name ? `<span style="font-size:12px;font-weight:400;color:var(--color-text-muted);margin-left:8px;">${escapeHtml(t.liga_name)}</span>` : '';

    return `
      <div class="galeria-card">
        <div class="galeria-year-header">${t.year}${ligaLabel}</div>
        <div class="galeria-titles-grid">${awardsHtml}</div>
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

  // Monta mapa nome por athlete_id a partir dos atletas do grupo
  const nameById = Object.fromEntries((group.athletes || []).map(a => [a.athlete_id, a.nome]));

  const scorelinesHtml = (group.sets || []).map(s => {
    const nameA = (s.team_a || []).map(id => escapeHtml((nameById[id] || id).split(' ')[0])).join(' / ');
    const nameB = (s.team_b || []).map(id => escapeHtml((nameById[id] || id).split(' ')[0])).join(' / ');
    const winA = s.score_a > s.score_b;
    const winB = s.score_b > s.score_a;
    return `<div class="set-scoreline">
      <span class="set-team ${winA ? 'set-winner' : ''}">${nameA}</span>
      <span class="set-score">${s.score_a}<span class="set-sep">×</span>${s.score_b}</span>
      <span class="set-team set-team-right ${winB ? 'set-winner' : ''}">${nameB}</span>
    </div>`;
  }).join('');

  const athleteRows = group.athletes.map((a, i) => `
    <div class="history-score-row">
      <span class="history-score-rank">${i + 1}</span>
      <span class="history-score-name">
        <a href="#publico/atleta/${a.athlete_id}" style="color:inherit;text-decoration:none;">${escapeHtml(a.nome)}</a>
      </span>
      <span class="history-score-sets">
        ${(a.sets || []).map(s => `<span class="history-score-set ${_setClass(s)}">${s}</span>`).join('')}
      </span>
      <span class="history-score-total">${a.total ?? '—'}</span>
    </div>`).join('');

  return `
    ${scorelinesHtml ? `<div class="set-scorelines">${scorelinesHtml}</div>` : ''}
    <div style="margin-top:${scorelinesHtml ? '10px' : '0'}">${athleteRows}</div>`;
}

async function renderPublicoResultados(container, _defaultSeason, selectedSeasonId = null) {
  container.innerHTML = `<p class="placeholder-text">Carregando histórico…</p>`;

  let seasons = [];
  try { seasons = await api('/api/seasons'); } catch (_) {}

  if (!seasons.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📋</div>
        <p class="empty-state-title">Nenhuma temporada disponível</p>
      </div>`;
    return;
  }

  const activeSeason = seasons.find(s => s.status === 'active') || seasons[0];
  const season = (selectedSeasonId && seasons.find(s => s.id === selectedSeasonId)) || _defaultSeason || activeSeason;

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

  // Coleta categorias únicas presentes nos rounds
  const presentCatsPub = [...new Set(
    rounds.flatMap(r => r.groups.map(g => g.cat))
  )].filter(Boolean).sort();

  const catTabsHtml = `
    <div class="cat-tabs" id="pub-resultados-tabs">
      <button class="cat-tab active" data-filter="all">Todas</button>
      ${presentCatsPub.map(c => `<button class="cat-tab" data-filter="${c}">Cat ${c}</button>`).join('')}
    </div>`;

  const html = rounds.map(rnd => {
    const groupsWithResults = rnd.groups.filter(g => g.has_result);
    const totalGroups = rnd.groups.length;
    const meta = groupsWithResults.length
      ? `${groupsWithResults.length}/${totalGroups} grupo(s) com resultado`
      : 'Sem resultados';

    const groupsHtml = rnd.groups
      .filter(g => g.athletes.length > 0)
      .map(g => `
        <div class="history-group-block" data-cat="${g.cat}">
          <div class="history-group-label">${catLabel(g.cat)} · Grupo ${g.group_idx + 1}</div>
          ${_buildGroupHtml(g)}
        </div>`).join('');

    const periodMeta = rnd.start_date
      ? `${rnd.start_date} → ${rnd.end_date || '?'}`
      : '';

    return `
      <div class="history-round-card" data-round-card>
        <div class="history-round-header" data-round="${rnd.round_id}">
          <span class="history-round-title">Rodada ${rnd.round_number}</span>
          ${periodMeta ? `<span class="history-round-meta">${periodMeta}</span>` : ''}
          <span class="history-round-meta">${meta}</span>
          <span class="history-round-meta" style="font-size:16px;">›</span>
        </div>
        <div class="history-round-body" id="body-${rnd.round_id}">
          ${groupsHtml || '<p style="font-size:13px;color:var(--color-text-muted);">Sem grupos.</p>'}
        </div>
      </div>`;
  }).join('');

  const seasonSelectHtml = seasons.length > 1 ? `
    <select id="resultados-season-sel" class="input" style="font-size:13px;max-width:220px;margin-bottom:10px;">
      ${seasons.map(s => `<option value="${s.id}"${s.id === season.id ? ' selected' : ''}>${escapeHtml(s.name)}${s.status === 'active' ? ' ✓' : ''}</option>`).join('')}
    </select>` : '';

  container.innerHTML = `
    <div style="padding:0 var(--space-md);">
      ${seasonSelectHtml}
      <p style="font-size:13px;color:var(--color-text-muted);margin-bottom:8px;">
        ${escapeHtml(season.name)} · ${rounds.length} rodada(s)
      </p>
      ${catTabsHtml}
      ${html}
    </div>`;

  // Filtro por categoria
  function applyPubFilter(cat) {
    container.querySelectorAll('#pub-resultados-tabs .cat-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.filter === cat)
    );
    container.querySelectorAll('.history-group-block[data-cat]').forEach(block => {
      block.style.display = (cat === 'all' || block.dataset.cat === cat) ? '' : 'none';
    });
    // Oculta rodadas sem grupos visíveis no filtro atual
    container.querySelectorAll('.history-round-card[data-round-card]').forEach(card => {
      if (cat === 'all') { card.style.display = ''; return; }
      const hasVisible = [...card.querySelectorAll('.history-group-block[data-cat]')]
        .some(b => b.dataset.cat === cat && b.style.display !== 'none');
      card.style.display = hasVisible ? '' : 'none';
    });
  }

  container.querySelector('#pub-resultados-tabs').addEventListener('click', e => {
    const btn = e.target.closest('.cat-tab');
    if (btn) applyPubFilter(btn.dataset.filter);
  });

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

  // Season selector
  container.querySelector('#resultados-season-sel')?.addEventListener('change', e => {
    renderPublicoResultados(container, null, e.target.value);
  });
}


// ---------------------------------------------------------------------------
// Sprint 11: Mesa — Histórico Pessoal
// ---------------------------------------------------------------------------

async function renderMesaHistorico(content) {
  content.innerHTML = `<p class="placeholder-text" aria-live="polite">Carregando histórico…</p>`;

  let history = [], seasons = [];
  const [histRes, seasonsRes] = await Promise.allSettled([
    api('/api/mesa/history'),
    api('/api/seasons'),
  ]);
  if (histRes.status !== 'fulfilled') {
    content.innerHTML = `<p class="placeholder-text" style="color:#D94040">Erro: ${escapeHtml(histRes.reason?.message || 'Falha ao carregar')}</p>`;
    return;
  }
  history  = histRes.value.history || [];
  if (seasonsRes.status === 'fulfilled') seasons = seasonsRes.value;

  if (!history.length) {
    content.innerHTML = `
      <div class="empty-state" style="padding:40px 20px;">
        <div class="empty-state-icon">📋</div>
        <p class="empty-state-title">Nenhuma partida jogada</p>
        <p>Suas partidas aparecerão aqui após os resultados serem confirmados.</p>
      </div>`;
    return;
  }

  // Build season index from history (in order of appearance → most recent last)
  const seasonById = Object.fromEntries(seasons.map(s => [s.id, s]));
  const seenSeasonIds = [...new Set(history.map(h => h.season_id).filter(Boolean))];
  // Most recent first (history is ordered newest-first by the engine)
  const seasonTabs = seenSeasonIds.map(id => ({ id, name: seasonById[id]?.name || id }));

  let activeSeasonId = 'all'; // 'all' | season_id

  const rankBadge = rank => {
    const cls = rank <= 3 ? `rank-${rank}` : '';
    const label = rank === 1 ? '1º 🥇' : rank === 2 ? '2º 🥈' : rank === 3 ? '3º 🥉' : `${rank}º`;
    return `<span class="match-rank-badge ${cls}">${label}</span>`;
  };

  function matchCard(h) {
    let scoresHtml;
    if (h.set_scores?.length) {
      const scLine = h.set_scores.map(s => {
        const cls = s.wo ? 'wo' : s.won ? 'win' : 'loss';
        const lbl = s.wo ? 'WO' : `${s.score_mine}–${s.score_opp}${s.is_super_tiebreak ? ' STB' : ''}`;
        return `<span class="match-set-score ${cls}">${lbl}</span>`;
      }).join('<span style="color:var(--color-text-muted);padding:0 2px;">/</span>');
      const gHtml = (h.games_won !== undefined && h.games_lost !== undefined)
        ? `<span style="font-size:11px;color:var(--color-text-muted);margin-left:8px;">${h.games_won}G–${h.games_lost}G</span>`
        : '';
      scoresHtml = `<div class="match-sets-row">${scLine}${gHtml}</div>`;
    } else {
      const pips = (h.my_sets || []).map(s =>
        `<span class="match-set-pip ${s === 3 ? 'win' : 'loss'}">${s}</span>`).join('');
      scoresHtml = `<div class="match-sets-row">${pips}</div>`;
    }
    const opponents = h.group_members.map(m => escapeHtml(m.nome)).join(', ');
    return `
      <div class="match-card">
        <div class="match-card-header">
          <span class="match-round-label">${catLabel(h.cat)} · Rodada ${h.round_number ?? '—'}</span>
          ${rankBadge(h.rank_in_group)}
        </div>
        ${scoresHtml}
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:4px;">
          <span class="match-opponents">${opponents}</span>
          <span style="font-size:13px;font-weight:700;color:var(--color-primary);">${h.my_total ?? 0}pts</span>
        </div>
        ${h.result_status === 'pending' ? `<p style="font-size:11px;color:#BA7517;margin-top:4px;">⏳ Aguardando confirmação</p>` : ''}
      </div>`;
  }

  function statsGrid(items) {
    const pts   = items.reduce((s, h) => s + (h.my_total ?? 0), 0);
    const setsW = items.reduce((s, h) => s + (h.my_sets || []).filter(x => x === 3).length, 0);
    const setsT = items.reduce((s, h) => s + (h.my_sets || []).length, 0);
    const gw    = items.reduce((s, h) => s + (h.games_won ?? 0), 0);
    const gl    = items.reduce((s, h) => s + (h.games_lost ?? 0), 0);
    const f1    = items.filter(h => h.rank_in_group === 1).length;
    const wr    = setsT > 0 ? Math.round(100 * setsW / setsT) : 0;
    return `
      <div class="profile-stats-grid" style="margin-bottom:4px;">
        <div class="profile-stat-card"><div class="profile-stat-value">${items.length}</div><div class="profile-stat-label">Rodadas</div></div>
        <div class="profile-stat-card"><div class="profile-stat-value">${pts}</div><div class="profile-stat-label">Pts Totais</div></div>
        <div class="profile-stat-card"><div class="profile-stat-value">${f1}</div><div class="profile-stat-label">1º Lugares</div></div>
      </div>
      <div class="profile-stats-grid" style="margin-bottom:16px;">
        <div class="profile-stat-card"><div class="profile-stat-value">${setsW}/${setsT}</div><div class="profile-stat-label">Sets G/J</div></div>
        <div class="profile-stat-card"><div class="profile-stat-value">${wr}%</div><div class="profile-stat-label">Aproveit.</div></div>
        <div class="profile-stat-card"><div class="profile-stat-value">${gw > 0 ? (gw >= gl ? '+' : '') + (gw - gl) : '—'}</div><div class="profile-stat-label">Saldo Games</div></div>
      </div>`;
  }

  function paint() {
    const items = activeSeasonId === 'all'
      ? history
      : history.filter(h => h.season_id === activeSeasonId);

    content.querySelectorAll('.hist-season-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.sid === activeSeasonId));

    content.querySelector('#hist-stats').innerHTML = statsGrid(items);
    content.querySelector('#hist-cards').innerHTML = items.length
      ? items.map(matchCard).join('')
      : `<p style="font-size:13px;color:var(--color-text-muted);padding:8px 0;">Sem partidas nesta temporada.</p>`;
  }

  const tabsHtml = seasonTabs.length > 1 ? `
    <div class="hist-season-bar">
      <button class="hist-season-tab active" data-sid="all">Todas</button>
      ${seasonTabs.map(s => `<button class="hist-season-tab" data-sid="${s.id}">${escapeHtml(s.name)}</button>`).join('')}
    </div>` : '';

  content.innerHTML = `
    <div style="padding:16px;">
      ${tabsHtml}
      <div id="hist-stats">${statsGrid(history)}</div>
      <div id="hist-cards">${history.map(matchCard).join('')}</div>
    </div>`;

  content.querySelectorAll('.hist-season-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      activeSeasonId = btn.dataset.sid;
      paint();
    });
  });
}


// ---------------------------------------------------------------------------
// Sprint 10: Público — Perfil de Atleta
// ---------------------------------------------------------------------------

async function renderPublicoAtleta(container, athleteId) {
  container.innerHTML = `<p class="placeholder-text">Carregando perfil…</p>`;

  const [profileRes, histRes, rankHistRes] = await Promise.allSettled([
    api(`/api/athletes/${athleteId}/public`),
    api(`/api/athletes/${athleteId}/history?limit=10`),
    api(`/api/athletes/${athleteId}/ranking-history`),
  ]);

  if (profileRes.status !== 'fulfilled') {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🎾</div>
        <p class="empty-state-title">Atleta não encontrado</p>
        <p><a href="#publico/ranking" style="color:var(--color-accent);">← Voltar ao ranking</a></p>
      </div>`;
    return;
  }

  const profile = profileRes.value;
  const matchHistory = histRes.status === 'fulfilled' ? (histRes.value.history || []) : [];
  const rankHistory  = rankHistRes.status === 'fulfilled' ? (rankHistRes.value.history || []) : [];

  const stats = profile.stats || {};
  const displayNome = profile.apelido || profile.nome || '?';
  const initial = displayNome.charAt(0).toUpperCase();
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

  const cr = profile.current_rank;
  const rankBadgeHtml = cr
    ? `<span class="pub-rank-badge" title="${escapeHtml(cr.season_name)}">
         ${(cr.results_count ?? 0) === 0 ? 'sem jogos ainda' : `${cr.rank}° de ${cr.total}`} · ${catLabel(cr.cat)}
       </span>`
    : '';

  const _pubRankBadge = rank => {
    const cls = rank <= 3 ? `rank-${rank}` : '';
    const label = rank === 1 ? '1º 🥇' : rank === 2 ? '2º 🥈' : rank === 3 ? '3º 🥉' : `${rank}º`;
    return `<span class="match-rank-badge ${cls}">${label}</span>`;
  };
  const matchHistoryHtml = matchHistory.length
    ? [...matchHistory].reverse().map(h => {
        let scoresHtml;
        if (h.set_scores?.length) {
          const scLine = h.set_scores.map(s => {
            const sc = s.wo ? 'wo' : s.won ? 'win' : 'loss';
            const lbl = s.wo ? 'WO' : `${s.score_mine}–${s.score_opp}${s.is_super_tiebreak ? ' STB' : ''}`;
            return `<span class="match-set-score ${sc}">${lbl}</span>`;
          }).join('<span style="color:var(--color-text-muted);padding:0 2px;">/</span>');
          scoresHtml = `<div class="match-sets-row">${scLine}</div>`;
        } else {
          const pips = (h.my_sets || []).map(s =>
            `<span class="match-set-pip ${s === 3 ? 'win' : 'loss'}">${s}</span>`).join('');
          scoresHtml = `<div class="match-sets-row">${pips}</div>`;
        }
        const opponents = (h.group_members || []).map(m => escapeHtml(m.nome)).join(', ');
        return `
          <div class="match-card">
            <div class="match-card-header">
              <span class="match-round-label">${catLabel(h.cat)} · Rodada ${h.round_number ?? '—'}</span>
              ${_pubRankBadge(h.rank_in_group)}
            </div>
            ${scoresHtml}
            <div style="display:flex;align-items:center;justify-content:space-between;margin-top:4px;">
              <span class="match-opponents">${opponents}</span>
              <span style="font-size:13px;font-weight:700;color:var(--color-primary);">${h.my_total ?? 0}pts</span>
            </div>
          </div>`;
      }).join('')
    : `<p style="padding:10px 0;font-size:13px;color:var(--color-text-muted);">Nenhuma partida registrada.</p>`;

  container.innerHTML = `
    <p style="margin-bottom:12px;">
      <a href="#publico/ranking" style="font-size:13px;color:var(--color-accent);">← Ranking</a>
    </p>
    <div class="public-profile-card">
      <div class="public-profile-header">
        <div class="public-profile-avatar" aria-hidden="true" style="overflow:hidden;border-radius:50%;">
          ${avatarHtml(profile.photo_url, displayNome, 64)}
        </div>
        <div>
          <div class="public-profile-name">${escapeHtml(displayNome)}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            ${catLabel(profile.current_category)}
            <span class="badge ${profile.status === 'ativo' ? 'badge-ativo' : 'badge-inativo'}">${profile.status}</span>
            ${rankBadgeHtml}
          </div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(${profile.age != null ? 4 : 3},1fr);gap:10px;margin-bottom:20px;">
        ${[
          ['Rodadas', stats.total_rounds ?? 0],
          ['Pontos',  stats.total_points ?? 0],
          ['Sets W',  stats.total_set_wins ?? 0],
          ...(profile.age != null ? [['Idade', `${profile.age}a`]] : []),
        ].map(([lbl, val]) => `
          <div style="text-align:center;background:var(--color-bg);border-radius:var(--radius-md);padding:12px 6px;">
            <div style="font-size:22px;font-weight:700;color:var(--color-primary);">${val}</div>
            <div style="font-size:11px;color:var(--color-text-muted);margin-top:2px;">${lbl}</div>
          </div>`).join('')}
      </div>

      <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;
         color:var(--color-text-muted);margin-bottom:8px;">Temporadas</p>
      ${summaryHtml}

      ${rankHistory.length >= 1 ? (() => {
        // Group by season+cat for display; show most recent cat's history
        const latest = rankHistory[rankHistory.length - 1];
        const sameCatSeason = rankHistory.filter(h => h.cat === latest.cat && h.season_id === latest.season_id);
        return `
          <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;
             color:var(--color-text-muted);margin:20px 0 8px;">Evolução de Ranking · ${catLabel(latest.cat)}</p>
          <div style="background:var(--color-bg);border-radius:var(--radius-md);padding:14px 10px 8px;">
            ${svgRankEvolution(sameCatSeason.slice(-8))}
            <p style="font-size:10px;color:var(--color-text-muted);text-align:center;margin-top:4px;">
              Posição por rodada — eixo Y: 1° = topo
            </p>
          </div>`;
      })() : ''}

      ${history.length ? `
        <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;
           color:var(--color-text-muted);margin:16px 0 8px;">Histórico de Categoria</p>
        ${historyHtml}` : ''}

      <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;
         color:var(--color-text-muted);margin:20px 0 8px;">Últimas Partidas</p>
      ${matchHistoryHtml}

      <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;
         color:var(--color-text-muted);margin:24px 0 8px;">Comparar com</p>
      <div class="card" style="padding:var(--space-md);">
        <input id="h2h-search" class="field-input" placeholder="Buscar atleta…" autocomplete="off"
               style="margin-bottom:8px;" />
        <div id="h2h-dropdown" style="display:none;background:var(--color-surface);border:var(--border);
             border-radius:var(--radius-md);max-height:160px;overflow-y:auto;margin-bottom:8px;"></div>
        <div id="h2h-result"></div>
      </div>
    </div>`;

  // Wire H2H search
  const h2hInput = container.querySelector('#h2h-search');
  const h2hDropdown = container.querySelector('#h2h-dropdown');
  const h2hResult = container.querySelector('#h2h-result');
  let h2hTimer;

  h2hInput?.addEventListener('input', () => {
    clearTimeout(h2hTimer);
    const q = h2hInput.value.trim();
    if (q.length < 2) { h2hDropdown.style.display = 'none'; return; }
    h2hTimer = setTimeout(async () => {
      try {
        const res = await api(`/api/search?q=${encodeURIComponent(q)}`);
        const athletes = (res.athletes || []).filter(a => a.id !== athleteId).slice(0, 6);
        if (!athletes.length) { h2hDropdown.style.display = 'none'; return; }
        h2hDropdown.innerHTML = athletes.map(a => `
          <div class="h2h-option" data-id="${escapeHtml(a.id)}" data-nome="${escapeHtml(a.nome || a.apelido || '?')}"
               style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:var(--border);">
            ${escapeHtml(a.apelido || a.nome || '?')}
            <span style="color:var(--color-text-muted);font-size:11px;margin-left:6px;">${catLabel(a.current_category)}</span>
          </div>`).join('');
        h2hDropdown.style.display = 'block';
        h2hDropdown.querySelectorAll('.h2h-option').forEach(el => {
          el.addEventListener('click', () => _loadH2H(el.dataset.id, el.dataset.nome));
        });
      } catch (_) {}
    }, 280);
  });

  document.addEventListener('click', (e) => {
    if (!h2hDropdown?.contains(e.target) && e.target !== h2hInput) {
      h2hDropdown && (h2hDropdown.style.display = 'none');
    }
  }, { once: false });

  async function _loadH2H(otherId, otherNome) {
    h2hDropdown.style.display = 'none';
    h2hInput.value = otherNome;
    h2hResult.innerHTML = `<p style="font-size:12px;color:var(--color-text-muted);">Carregando…</p>`;
    try {
      const h2h = await api(`/api/h2h/${athleteId}/${otherId}`);
      const s = h2h.summary;
      const na = h2h.athlete_a.nome;
      const nb = h2h.athlete_b.nome;
      const pct = s.encounters > 0 ? Math.round((s.a_wins / s.encounters) * 100) : 0;
      h2hResult.innerHTML = `
        <div style="text-align:center;margin-bottom:12px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <span style="font-size:13px;font-weight:700;">${escapeHtml(na)}</span>
            <span style="font-size:11px;color:var(--color-text-muted);">${s.encounters} grupo${s.encounters !== 1 ? 's' : ''}</span>
            <span style="font-size:13px;font-weight:700;">${escapeHtml(nb)}</span>
          </div>
          <div style="display:flex;gap:6px;justify-content:center;margin-bottom:4px;">
            <span style="font-size:28px;font-weight:800;color:var(--color-primary);">${s.a_wins}</span>
            <span style="font-size:22px;color:var(--color-text-muted);align-self:center;">–</span>
            <span style="font-size:28px;font-weight:800;color:var(--color-accent);">${s.b_wins}</span>
          </div>
          ${s.draws ? `<p style="font-size:11px;color:var(--color-text-muted);">${s.draws} empate${s.draws !== 1 ? 's' : ''}</p>` : ''}
          <p style="font-size:11px;color:var(--color-text-muted);margin-top:2px;">
            Sets diretos: ${s.direct_sets_a} × ${s.direct_sets_b}
          </p>
        </div>
        ${h2h.encounters.slice(0, 5).map(e => `
          <div class="public-stat-row" style="padding:6px 0;">
            <span style="color:var(--color-text-muted);font-size:12px;">Rod.${e.round_number ?? '—'} ${catLabel(e.cat)}</span>
            <span style="font-size:13px;font-weight:700;color:${e.winner === 'a' ? 'var(--color-primary)' : e.winner === 'b' ? 'var(--color-accent)' : 'var(--color-text-muted)'};">
              ${e.total_a} × ${e.total_b}
            </span>
          </div>`).join('')}`;
    } catch (_) {
      h2hResult.innerHTML = `<p style="font-size:12px;color:#D94040;">Erro ao carregar H2H.</p>`;
    }
  }
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
  const displayNomeMesa = profile.apelido || profile.nome || '?';
  const initial = displayNomeMesa.charAt(0).toUpperCase();

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
    ? summaries.map(s => {
        const fr = s.final_rank;
        const rankStr = fr ? `${fr.rank}°/${fr.total}` : '—';
        const rankColor = fr && fr.rank === 1 ? '#F59E0B' : fr && fr.rank <= 3 ? '#22C55E' : 'var(--color-text-muted)';
        return `
        <div class="season-row">
          <div>
            <span>${escapeHtml(s.season_name)}</span>
            <span style="font-size:11px;color:var(--color-text-muted);margin-left:6px;">(${s.status})</span>
          </div>
          <div style="text-align:right;">
            <span class="season-pts">${s.total_points}pts · ${s.set_wins}W · ${s.rounds_played} rod.</span>
            <div style="font-size:12px;font-weight:700;color:${rankColor};">${rankStr} ${fr ? catLabel(fr.cat) : ''}</div>
          </div>
        </div>`;
      }).join('')
    : `<p style="padding:10px 12px;font-size:13px;color:var(--color-text-muted);">Sem rodadas jogadas ainda.</p>`;

  content.innerHTML = `
    <div style="padding:16px;">
      <div class="profile-header">
        <div class="profile-avatar" aria-hidden="true" style="overflow:hidden;border-radius:50%;" id="perfil-avatar-wrap">
          ${avatarHtml(profile.photo_url, displayNomeMesa, 64)}
        </div>
        <div>
          <div class="profile-name">${escapeHtml(displayNomeMesa)}</div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            ${catLabel(profile.current_category)}
            <span class="badge ${profile.status === 'ativo' ? 'badge-ativo' : 'badge-inativo'}">${profile.status}</span>
          </div>
        </div>
      </div>

      <p class="profile-section-title">Foto de Perfil</p>
      <div class="card" style="padding:var(--space-md);margin-bottom:16px;">
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:10px;">
          <div id="photo-preview-wrap" style="flex-shrink:0;">
            ${avatarHtml(profile.photo_url, displayNomeMesa, 60)}
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;">
            <label for="photo-file-input" class="btn btn-ghost btn-sm" style="cursor:pointer;margin:0;">
              📷 Alterar foto
            </label>
            <input id="photo-file-input" type="file" accept="image/jpeg,image/png,image/webp" style="display:none;" />
            ${profile.photo_url
              ? `<button id="btn-remove-photo" class="btn btn-ghost btn-sm" style="color:#D94040;">✕ Remover foto</button>`
              : ''}
          </div>
        </div>
        <p style="font-size:11px;color:var(--color-text-muted);margin:0 0 4px;">JPEG · PNG · WebP · máx 2 MB</p>
        <p id="photo-msg" class="hidden" style="font-size:13px;margin-top:6px;"></p>
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
        ${profile.age != null ? `
        <div class="profile-stat-card">
          <div class="profile-stat-value">${profile.age}a</div>
          <div class="profile-stat-label">Idade</div>
        </div>` : ''}
      </div>

      <p class="profile-section-title">Temporadas Jogadas</p>
      <div class="card" style="padding:0;overflow:hidden;">
        ${summariesHtml}
      </div>

      <p class="profile-section-title">Histórico de Movimentações</p>
      <div class="card" style="padding:0;overflow:hidden;">
        ${historyHtml}
      </div>

      <p class="profile-section-title">Compartilhar Perfil</p>
      <div class="card" style="padding:var(--space-md);">
        <p style="font-size:12px;color:var(--color-text-muted);margin:0 0 10px;">
          Compartilhe sua posição no ranking com amigos.
        </p>
        <div class="share-url-row">
          <code id="share-url" class="share-url-text">${location.origin}/#publico/atleta/${escapeHtml(profile.id)}</code>
          <button id="btn-copy-link" class="btn btn-sm btn-ghost" title="Copiar link">📋 Copiar</button>
        </div>
        <div style="margin-top:10px;">
          <a id="btn-share-wa" href="#" target="_blank" rel="noopener"
             class="btn btn-sm" style="background:#25D366;border-color:#25D366;color:#fff;text-decoration:none;">
            📲 Enviar no WhatsApp
          </a>
        </div>
      </div>

      <p class="profile-section-title">Declarar Afastamento</p>
      <div class="card" style="padding:var(--space-md);">
        <p style="font-size:12px;color:var(--color-text-muted);margin:0 0 10px;">
          Use apenas em caso real de lesão ou viagem. O afastamento custa a temporada e abre vaga para reserva.
        </p>
        <div style="display:flex;flex-direction:column;gap:10px;">
          <div class="form-group">
            <label class="form-label">Tipo</label>
            <select id="mesa-inj-tipo" class="form-input">
              <option value="lesao">Lesão</option>
              <option value="viagem">Viagem</option>
              <option value="outro">Outro</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Data de início</label>
            <input id="mesa-inj-start" type="date" class="form-input" value="${new Date().toISOString().slice(0,10)}">
          </div>
          <div class="form-group">
            <label class="form-label">Dias de afastamento</label>
            <input id="mesa-inj-days" type="number" class="form-input" min="1" max="365" placeholder="ex: 21">
          </div>
          <div class="form-group">
            <label class="form-label">Observações</label>
            <input id="mesa-inj-notes" type="text" class="form-input" placeholder="Opcional">
          </div>
        </div>
        <div id="mesa-inj-preview" style="font-size:12px;color:var(--color-text-muted);margin-top:4px;"></div>
        <button id="btn-mesa-declarar" class="btn btn-primary" style="margin-top:12px;background:#D94040;border-color:#D94040;">
          Declarar Afastamento
        </button>
        <span id="mesa-inj-msg" style="font-size:13px;margin-left:8px;"></span>
      </div>

      <p class="profile-section-title">Editar Perfil</p>
      <div class="card" style="padding:var(--space-md);">
        <form id="form-perfil-edit" style="display:flex;flex-direction:column;gap:12px;">
          <div class="form-group">
            <label class="form-label" for="perfil-apelido">Apelido</label>
            <input id="perfil-apelido" type="text" class="form-input"
              value="${escapeHtml(profile.apelido || '')}"
              placeholder="Seu apelido" maxlength="40" required />
          </div>
          <div class="form-group">
            <label class="form-label" for="perfil-birth-date">Data de nascimento</label>
            <input id="perfil-birth-date" type="date" class="form-input"
              value="${escapeHtml(profile.birth_date || '')}" />
          </div>
          <div style="display:flex;align-items:center;gap:12px;">
            <button type="submit" class="btn btn-primary btn-sm">Salvar alterações</button>
            <span id="perfil-edit-msg" style="font-size:13px;display:none;"></span>
          </div>
        </form>
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

  // Preview retorno
  function updateMesaInjPreview() {
    const start = content.querySelector('#mesa-inj-start').value;
    const days  = parseInt(content.querySelector('#mesa-inj-days').value);
    const el    = content.querySelector('#mesa-inj-preview');
    if (start && days > 0) {
      const dt = new Date(start + 'T12:00:00');
      dt.setDate(dt.getDate() + days);
      el.textContent = `Retorno previsto: ${dt.toISOString().slice(0, 10)}`;
    } else {
      el.textContent = '';
    }
  }
  content.querySelector('#mesa-inj-start').addEventListener('input', updateMesaInjPreview);
  content.querySelector('#mesa-inj-days').addEventListener('input', updateMesaInjPreview);

  // Declarar afastamento pelo atleta
  content.querySelector('#btn-mesa-declarar').addEventListener('click', async () => {
    const tipo  = content.querySelector('#mesa-inj-tipo').value;
    const start = content.querySelector('#mesa-inj-start').value;
    const days  = parseInt(content.querySelector('#mesa-inj-days').value);
    const notes = content.querySelector('#mesa-inj-notes').value;
    const msg   = content.querySelector('#mesa-inj-msg');

    if (!start || !days) {
      msg.textContent = 'Preencha data e dias.'; msg.style.color = '#D94040'; return;
    }

    // Busca temporada ativa para associar
    let seasons = [];
    try { seasons = await api('/api/seasons'); } catch (_) {}
    const activeSeason = seasons.find(s => s.status === 'active');
    if (!activeSeason) {
      msg.textContent = 'Sem temporada ativa no momento.'; msg.style.color = '#D94040'; return;
    }

    confirmModal('Confirmar Afastamento',
      `Declarar afastamento de ${days} dia(s) a partir de ${start}? Isso custa sua vaga na temporada atual.`,
      async () => {
        try {
          const res = await api('/api/injuries', { method: 'POST', body: {
            athlete_id: profile.id, season_id: activeSeason.id,
            tipo, start_date: start, duration_days: days, notes,
          }});
          showToast(res.reserva_promoted ? 'Afastamento declarado. Reserva assumiu sua vaga.' : 'Afastamento declarado. Vaga em aberto.');
          await renderMesaPerfil(content);
        } catch (err) {
          msg.textContent = 'Erro: ' + err.message; msg.style.color = '#D94040';
        }
      }, 'Confirmar Afastamento'
    );
  });

  // Share profile
  const shareUrl = `${location.origin}/#publico/atleta/${profile.id}`;
  content.querySelector('#btn-copy-link').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast('Link copiado!', 'success');
    } catch (_) {
      // Fallback para browsers sem clipboard API
      const ta = document.createElement('textarea');
      ta.value = shareUrl;
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
      showToast('Link copiado!', 'success');
    }
  });
  content.querySelector('#btn-share-wa').href =
    `https://wa.me/?text=${encodeURIComponent('Acompanhe meu perfil no SuperRank: ' + shareUrl)}`;

  // Photo upload
  const photoInput = content.querySelector('#photo-file-input');
  const photoMsg   = content.querySelector('#photo-msg');
  const photoPreview = content.querySelector('#photo-preview-wrap');
  const headerAvatar = content.querySelector('#perfil-avatar-wrap');

  function showPhotoMsg(text, ok) {
    photoMsg.textContent = text;
    photoMsg.style.color = ok ? 'var(--color-cat-c)' : '#D94040';
    photoMsg.classList.remove('hidden');
  }

  photoInput?.addEventListener('change', async () => {
    const file = photoInput.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { showPhotoMsg('Arquivo muito grande. Máximo 2 MB.', false); return; }
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) { showPhotoMsg('Formato inválido. Use JPEG, PNG ou WebP.', false); return; }

    // Local preview
    const localUrl = URL.createObjectURL(file);
    if (photoPreview) photoPreview.innerHTML = avatarHtml(localUrl, displayNomeMesa, 60);
    if (headerAvatar) headerAvatar.innerHTML = avatarHtml(localUrl, displayNomeMesa, 64);

    const fd = new FormData();
    fd.append('photo', file);
    photoMsg.classList.add('hidden');
    try {
      const res = await api(`/api/athletes/${profile.id}/photo`, { method: 'POST', body: fd });
      showPhotoMsg('Foto salva com sucesso!', true);
      // Update hero avatar in mesa home if visible
      document.querySelectorAll('.mesa-hero-card img, .mesa-hero-card div[style*="border-radius:50%"]').forEach(el => {
        el.parentElement.innerHTML = avatarHtml(res.photo_url, displayNomeMesa, 44);
      });
    } catch (err) {
      showPhotoMsg(`Erro: ${err.message}`, false);
      if (photoPreview) photoPreview.innerHTML = avatarHtml(profile.photo_url, displayNomeMesa, 60);
      if (headerAvatar) headerAvatar.innerHTML = avatarHtml(profile.photo_url, displayNomeMesa, 64);
    }
    URL.revokeObjectURL(localUrl);
  });

  content.querySelector('#btn-remove-photo')?.addEventListener('click', () => {
    confirmModal('Remover foto', 'Remover sua foto de perfil?', async () => {
      try {
        await api(`/api/athletes/${profile.id}/photo`, { method: 'DELETE' });
        showToast('Foto removida.', 'success');
        await renderMesaPerfil(content);
      } catch (err) {
        showToast(`Erro: ${err.message}`, 'error');
      }
    }, 'Remover');
  });

  content.querySelector('#form-perfil-edit').addEventListener('submit', async e => {
    e.preventDefault();
    const apelido = content.querySelector('#perfil-apelido').value.trim();
    const birth_date = content.querySelector('#perfil-birth-date').value || null;
    const msgEl = content.querySelector('#perfil-edit-msg');
    msgEl.style.display = 'none';
    try {
      await api('/api/mesa/profile', { method: 'PUT', body: { apelido, birth_date } });
      profile.apelido = apelido;
      profile.birth_date = birth_date;
      content.querySelector('.profile-name').textContent = apelido;
      msgEl.textContent = 'Alterações salvas!';
      msgEl.style.color = 'var(--color-cat-c)';
      msgEl.style.display = '';
      showToast('Perfil atualizado!', 'success');
    } catch (err) {
      msgEl.textContent = err.message;
      msgEl.style.color = '#D94040';
      msgEl.style.display = '';
    }
  });

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

async function renderAdminRelatorio(content, selectedSeasonId = null) {
  renderSkeletonCards(content, 6);

  let seasons = [];
  try { seasons = await api('/api/seasons'); } catch (_) {}

  if (!seasons.length) {
    renderErrorState(content, 'Nenhuma temporada disponível para gerar relatório.');
    return;
  }

  const defaultSeason = seasons.find(s => s.status === 'active') || seasons[0];
  const selectedSeason = (selectedSeasonId && seasons.find(s => s.id === selectedSeasonId)) || defaultSeason;

  let report;
  try {
    report = await api(`/api/seasons/${selectedSeason.id}/report`);
  } catch (err) {
    renderErrorState(content, err.message, () => renderAdminRelatorio(content, selectedSeasonId));
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

  const seasonSelectHtml = seasons.length > 1 ? `
    <select id="relatorio-season-sel" class="input" style="font-size:13px;max-width:220px;">
      ${seasons.map(s => `<option value="${s.id}"${s.id === selectedSeason.id ? ' selected' : ''}>${escapeHtml(s.name)}${s.status === 'active' ? ' ✓' : ''}</option>`).join('')}
    </select>` : '';

  content.innerHTML = `
    <div class="section-header">
      <div>
        <h1 class="section-title">Relatório de Temporada</h1>
        <p class="section-subtitle">${escapeHtml(selectedSeason.name)}</p>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        ${seasonSelectHtml}
        <button id="btn-export-relatorio" class="btn btn-ghost btn-sm" title="Copiar relatório formatado">
          📋 Exportar
        </button>
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

  content.querySelector('#relatorio-season-sel')?.addEventListener('change', e => {
    renderAdminRelatorio(content, e.target.value);
  });

  content.querySelector('#btn-export-relatorio')?.addEventListener('click', () => {
    const lines = [
      `RELATÓRIO — ${selectedSeason.name}`,
      `Gerado em: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
      '',
      'KPIs',
      `Rodadas: ${report.total_rounds}`,
      `Com resultado: ${report.rounds_with_results}`,
      `Resultados: ${report.total_confirmed_results}`,
      `Participaram: ${report.athletes_who_played}/${report.total_titulares}`,
      `Participação: ${report.participation_rate}%`,
      `Média de pts: ${report.avg_points_per_athlete}`,
    ];
    if (report.most_active) {
      lines.push('', 'ATLETA MAIS ATIVO');
      lines.push(`${report.most_active.nome} — ${report.most_active.rounds} rod. · ${report.most_active.total_points}pts`);
    }
    const topCats = ['A', 'B', 'C', 'D'].map(cat => {
      const e = report.top_per_cat[cat];
      return e ? `[${cat}] ${e.nome} — ${e.total_points}pts · ${e.rounds} rod. · ${e.set_wins} sets W` : null;
    }).filter(Boolean);
    if (topCats.length) {
      lines.push('', 'MELHOR POR CATEGORIA');
      lines.push(...topCats);
    }
    if ((report.athlete_stats || []).length) {
      lines.push('', 'PARTICIPAÇÃO GERAL');
      report.athlete_stats.forEach((e, i) => {
        lines.push(`${String(i + 1).padStart(2)}. ${e.nome} (${e.category}) — ${e.total_points}pts · ${e.rounds} rod. · ${e.set_wins} sets W`);
      });
    }
    const text = lines.join('\n');
    navigator.clipboard?.writeText(text).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
    });
    showToast('Relatório copiado para a área de transferência!', 'success');
  });
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

  function contestedScoresTable(scores, group) {
    if (!scores || !Object.keys(scores).length) return '';
    const rows = group.map(m => {
      const sc = scores[m.athlete_id];
      if (!sc) return '';
      const badges = (sc.sets || []).map(p => `<span class="result-set-badge">${p}</span>`).join('');
      return `<tr>
        <td>${escapeHtml(m.nome)}</td>
        <td><div class="result-set-scores">${badges}</div></td>
        <td class="pts-total">${sc.total ?? '—'}</td>
      </tr>`;
    }).join('');
    return `<table class="result-scores-table" style="margin-top:6px;">
      <thead><tr><th>Atleta</th><th>Sets</th><th>Pts</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  function originalScoresTable(group) {
    const rows = group.map(m => {
      const sc = m.score;
      if (!sc || typeof sc !== 'object') return `<tr><td>${escapeHtml(m.nome)}</td><td colspan="2">—</td></tr>`;
      const badges = (sc.sets || []).map(p => `<span class="result-set-badge">${p}</span>`).join('');
      return `<tr>
        <td>${escapeHtml(m.nome)}</td>
        <td><div class="result-set-scores">${badges}</div></td>
        <td class="pts-total">${sc.total ?? '—'}</td>
      </tr>`;
    }).join('');
    return `<table class="result-scores-table">
      <thead><tr><th>Atleta</th><th>Sets</th><th>Pts</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  const cards = contested.map(item => {
    const contestDetailsHtml = (item.contests || []).map(c => `
      <div class="contest-detail-card">
        <div class="contest-detail-header">
          <span class="contest-detail-name">⚑ ${escapeHtml(c.nome)}</span>
        </div>
        <p class="contest-detail-reason">${escapeHtml(c.reason || '—')}</p>
        ${c.scores ? `<p style="font-size:11px;color:var(--color-text-muted);margin:8px 0 2px;">Placar proposto:</p>${contestedScoresTable(c.scores, item.group)}` : ''}
      </div>`).join('');

    const roundLabel = item.round_number
      ? `Rodada ${item.round_number}${item.round_start_date ? ` · ${fmtDate(item.round_start_date)}–${fmtDate(item.round_end_date)}` : ''}`
      : `Rodada ${escapeHtml((item.round_id || '').slice(0, 8))}…`;

    return `
      <div class="contested-card" data-result-id="${escapeHtml(item.result_id)}">
        <div class="contested-card-header">
          <span class="contested-card-title">
            ${catLabel(item.cat)} &nbsp;Grupo ${item.group_idx + 1}
          </span>
          <span class="contested-card-meta">${roundLabel}</span>
        </div>
        <p style="font-size:11px;color:var(--color-text-muted);margin:8px 12px 2px;">Placar lançado:</p>
        <div style="padding:0 12px 8px;">${originalScoresTable(item.group)}</div>
        ${contestDetailsHtml}
        <div class="contested-card-actions">
          <button class="btn btn-primary btn-sm btn-confirm-result" data-id="${escapeHtml(item.result_id)}">
            Confirmar placar lançado
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
        const [resultsRes, athletesRes] = await Promise.allSettled([
          api(`/api/rounds/${roundId}/results`),
          api('/api/athletes'),
        ]);
        if (resultsRes.status  !== 'fulfilled') throw resultsRes.reason;
        if (athletesRes.status !== 'fulfilled') throw athletesRes.reason;
        const result = resultsRes.value.find(r => r.id === id);
        if (!result) throw new Error('Resultado não encontrado');
        const athletesById = Object.fromEntries(athletesRes.value.map(a => [a.id, a]));
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
// Sprint 15: Log de Auditoria
// ---------------------------------------------------------------------------

async function renderAdminAuditoria(content) {
  const ACTION_LABELS = {
    result_admin_confirm: 'Confirmação forçada de resultado',
    result_override:      'Override de contestação',
    result_wo_applied:    'WO aplicado',
    season_closed:        'Temporada encerrada',
    round_reopened:       'Rodada reaberta',
    round_closed:         'Rodada encerrada manualmente',
    season_edited:        'Temporada editada',
    athlete_confirmed:    'Cadastro de atleta confirmado',
    athlete_category_set: 'Categoria de atleta definida',
  };
  const ACTION_ICONS = {
    result_admin_confirm: '✓',
    result_override:      '⚖',
    result_wo_applied:    '🚫',
    season_closed:        '🔒',
    round_reopened:       '🔓',
    round_closed:         '✅',
    season_edited:        '✏️',
    athlete_confirmed:    '👤',
    athlete_category_set: '🗂',
  };

  content.innerHTML = `
    <div class="section-header">
      <div>
        <h1 class="section-title">Auditoria</h1>
        <p class="section-subtitle">Histórico de ações administrativas</p>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <input id="audit-search" class="input" type="search" placeholder="Buscar ator…"
          style="font-size:13px;max-width:150px;" autocomplete="off">
        <select id="audit-action-sel" class="input" style="font-size:13px;max-width:200px;">
          <option value="">Todas as ações</option>
          ${Object.entries(ACTION_LABELS).map(([k, v]) => `<option value="${k}">${escapeHtml(v)}</option>`).join('')}
        </select>
        <button id="btn-refresh-audit" class="btn btn-ghost btn-sm">↺ Atualizar</button>
      </div>
    </div>
    <div id="audit-body"><p class="placeholder-text">Carregando…</p></div>`;

  const body = content.querySelector('#audit-body');
  let allEntries = [];

  function buildRow(e) {
    const icon  = ACTION_ICONS[e.action]  || '•';
    const label = ACTION_LABELS[e.action] || e.action;
    const det   = Object.entries(e.details || {})
      .filter(([k]) => !['result_id','round_id','season_id'].includes(k))
      .map(([k, v]) => `${k}: <strong>${escapeHtml(String(v))}</strong>`)
      .join(' · ');
    const ts = e.created_at
      ? new Date(e.created_at).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', timeZone:'America/Sao_Paulo' })
      : '—';
    return `<tr>
      <td style="color:var(--color-text-muted);font-size:12px;white-space:nowrap;">${ts}</td>
      <td style="font-size:16px;text-align:center;">${icon}</td>
      <td style="font-weight:500;">${escapeHtml(label)}</td>
      <td style="font-size:12px;color:var(--color-text-muted);">${det}</td>
      <td style="font-size:12px;color:var(--color-text-muted);">${escapeHtml(e.actor || 'admin')}</td>
    </tr>`;
  }

  function paintFiltered() {
    const actionFilter = content.querySelector('#audit-action-sel')?.value || '';
    const searchFilter = (content.querySelector('#audit-search')?.value || '').toLowerCase().trim();
    const filtered = allEntries.filter(e => {
      const actionMatch  = !actionFilter || e.action === actionFilter;
      const actorMatch   = !searchFilter || (e.actor || '').toLowerCase().includes(searchFilter);
      return actionMatch && actorMatch;
    });
    if (!filtered.length) {
      body.innerHTML = `<div style="text-align:center;padding:32px;color:var(--color-text-muted);">Nenhum resultado para os filtros selecionados.</div>`;
      return;
    }
    body.innerHTML = `
      <div class="card" style="padding:0;overflow:hidden;">
        <table class="data-table" style="width:100%;">
          <thead><tr><th>Quando</th><th></th><th>Ação</th><th>Detalhes</th><th>Por</th></tr></thead>
          <tbody>${filtered.map(buildRow).join('')}</tbody>
        </table>
      </div>`;
  }

  async function loadAndPaint() {
    body.innerHTML = `<p class="placeholder-text">Carregando…</p>`;
    try { allEntries = await api('/api/admin/audit?limit=200'); } catch (err) {
      body.innerHTML = `<div class="alert alert-error">Erro ao carregar: ${escapeHtml(err.message)}</div>`;
      return;
    }
    if (!allEntries.length) {
      body.innerHTML = `
        <div style="text-align:center;padding:48px 20px;">
          <div style="font-size:40px;margin-bottom:12px;">📋</div>
          <p style="color:var(--color-text-muted);">Nenhuma ação registrada ainda.</p>
        </div>`;
      return;
    }
    paintFiltered();
  }

  content.querySelector('#audit-action-sel').addEventListener('change', paintFiltered);
  content.querySelector('#audit-search').addEventListener('input', paintFiltered);
  content.querySelector('#btn-refresh-audit').addEventListener('click', loadAndPaint);
  await loadAndPaint();
}

// ---------------------------------------------------------------------------
// Sprint 16: Configurações do Sistema
// ---------------------------------------------------------------------------

async function renderAdminConfig(content) {
  content.innerHTML = `<p class="placeholder-text">Carregando configurações…</p>`;
  let settings = {};
  try { settings = await api('/api/admin/settings'); } catch (err) {
    content.innerHTML = `<div class="alert alert-error">Erro: ${escapeHtml(err.message)}</div>`;
    return;
  }

  function field(id, label, value, hint, type = 'text', inputmode = '') {
    return `
      <div class="form-group">
        <label class="field-label" for="${id}">${label}</label>
        <input id="${id}" class="field-input" type="${type}" ${inputmode ? `inputmode="${inputmode}"` : ''}
          value="${escapeHtml(value || '')}" />
        ${hint ? `<p style="font-size:11px;color:var(--color-text-muted);margin-top:3px;">${hint}</p>` : ''}
      </div>`;
  }

  content.innerHTML = `
    <div class="section-header">
      <div>
        <h1 class="section-title">Configurações do Sistema</h1>
        <p class="section-subtitle">Dados do clube e preferências do administrador</p>
      </div>
    </div>

    <div class="card" style="max-width:600px;">
      <p class="config-section-label">🏟 Clube</p>
      ${field('cfg-club-name',  'Nome do Clube / App', settings.club_name,  'Aparece no cabeçalho público e nas mensagens automáticas')}
      ${field('cfg-location',   'Local das Quadras',   settings.court_location, 'Ex.: Quadras do Play, Feira de Santana — BA')}
      ${field('cfg-app-url',    'URL do Sistema',      settings.app_url,    'Ex.: https://superrank.up.railway.app — usado em links nas mensagens')}

      <hr style="border:none;border-top:1px solid var(--color-border);margin:20px 0;">

      <p class="config-section-label">📱 Comunicação</p>
      <div class="form-group">
        <label class="field-label">WhatsApp do Admin</label>
        ${phoneInputHtml(settings.admin_whatsapp || '')}
        <p style="font-size:11px;color:var(--color-text-muted);margin-top:3px;">Número de contato exibido para atletas</p>
      </div>

      <hr style="border:none;border-top:1px solid var(--color-border);margin:20px 0;">

      <p class="config-section-label">💳 Pagamentos</p>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;padding:12px 16px;background:var(--color-surface);border:var(--border);border-radius:8px;">
        <div>
          <p style="font-size:13px;font-weight:600;margin:0;">Cobranças ativas</p>
          <p style="font-size:12px;color:var(--color-text-muted);margin:2px 0 0;">Exibe status de pagamento para os atletas</p>
        </div>
        <label style="position:relative;display:inline-block;width:44px;height:24px;flex-shrink:0;">
          <input type="checkbox" id="cfg-payments-enabled" style="opacity:0;width:0;height:0;"
            ${settings.payments_enabled !== false ? 'checked' : ''}>
          <span id="cfg-payments-slider" style="position:absolute;cursor:pointer;inset:0;background:${settings.payments_enabled !== false ? 'var(--color-primary)' : 'rgba(255,255,255,.15)'};border-radius:24px;transition:.2s;">
            <span style="position:absolute;height:18px;width:18px;left:${settings.payments_enabled !== false ? '23px' : '3px'};bottom:3px;background:#fff;border-radius:50%;transition:.2s;"></span>
          </span>
        </label>
      </div>
      ${field('cfg-pay-amount',   'Mensalidade (R$)',  settings.payment_amount  ?? '',  'Valor cobrado por temporada', 'number', 'decimal')}
      ${field('cfg-pay-due-day',  'Vencimento (dia)',  settings.payment_due_day ?? '10', 'Dia do mês limite para pagamento (1–28)', 'number', 'numeric')}

      <div style="display:flex;gap:10px;margin-top:20px;align-items:center;">
        <button id="btn-save-config" class="btn btn-primary">Salvar configurações</button>
        <span id="cfg-feedback" style="font-size:13px;"></span>
      </div>
    </div>`;

  const phoneLocalEl = content.querySelector('[name="phone_local"]');
  if (phoneLocalEl) applyPhoneMask(phoneLocalEl);

  content.querySelector('#btn-save-config').addEventListener('click', async () => {
    const btn = content.querySelector('#btn-save-config');
    const fb  = content.querySelector('#cfg-feedback');
    btn.disabled = true; btn.textContent = 'Salvando…';
    const countryCode  = content.querySelector('[name="phone_country"]')?.value || '55';
    const localDigits  = (content.querySelector('[name="phone_local"]')?.value || '').replace(/\D/g, '');
    const body = {
      club_name:        content.querySelector('#cfg-club-name').value.trim(),
      court_location:   content.querySelector('#cfg-location').value.trim(),
      app_url:          content.querySelector('#cfg-app-url').value.trim(),
      admin_whatsapp:   localDigits ? countryCode + localDigits : '',
      payment_amount:    parseFloat(content.querySelector('#cfg-pay-amount')?.value || '0') || 0,
      payment_due_day:   parseInt(content.querySelector('#cfg-pay-due-day')?.value || '10', 10) || 10,
      payments_enabled:  content.querySelector('#cfg-payments-enabled')?.checked ?? true,
    };
    try {
      await api('/api/admin/settings', { method: 'PUT', body });
      fb.textContent = '✓ Configurações salvas!';
      fb.style.color = 'var(--color-cat-c)';
      showToast('Configurações atualizadas.', 'success');
    } catch (err) {
      fb.textContent = 'Erro: ' + err.message;
      fb.style.color = '#D94040';
    }
    btn.disabled = false; btn.textContent = 'Salvar configurações';
  });

  // Animar toggle de cobranças visualmente
  content.querySelector('#cfg-payments-enabled')?.addEventListener('change', e => {
    const on = e.target.checked;
    const slider = content.querySelector('#cfg-payments-slider');
    if (slider) {
      slider.style.background = on ? 'var(--color-primary)' : 'rgba(255,255,255,.15)';
      const knob = slider.querySelector('span');
      if (knob) knob.style.left = on ? '23px' : '3px';
    }
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
              <span class="search-result-item-sub">${catLabel(a.current_category)}${a.status && a.status !== 'active' ? ` · <span class="badge badge-inativo">${escapeHtml(a.status)}</span>` : ''}</span>
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


// ---------------------------------------------------------------------------
// Sprint 18: Admin — Painel de Pendências
// ---------------------------------------------------------------------------

async function renderAdminPendencias(content) {
  renderSkeletonCards(content, 4);

  let athletes = [], contestedData = {}, stats = {};
  const [athRes, contRes, statRes] = await Promise.allSettled([
    api('/api/athletes'),
    api('/api/admin/contested'),
    api('/api/admin/stats'),
  ]);
  if (athRes.status  === 'fulfilled') athletes     = athRes.value;
  if (contRes.status === 'fulfilled') contestedData = contRes.value;
  if (statRes.status === 'fulfilled') stats         = statRes.value;

  const pendingAthletes = athletes.filter(a => !a.admin_confirmed);
  const contestedCount  = contestedData.count || 0;
  const rp              = stats.active_round_progress;

  // Overdue open rounds: status open, has target_date, target_date < today
  const today = new Date().toISOString().slice(0, 10);
  let overdueRounds = [];
  if (stats.active_season_id) {
    try {
      const allRounds = await api(`/api/seasons/${stats.active_season_id}/rounds`);
      overdueRounds = allRounds.filter(r =>
        r.status === 'open' && r.target_date && r.target_date < today);
    } catch (_) {}
  }

  const totalIssues = pendingAthletes.length + contestedCount +
                      (rp ? rp.pending_confirmation : 0) + overdueRounds.length;

  function statusChip(ok) {
    return ok
      ? `<span class="pend-chip pend-chip-ok">✓ OK</span>`
      : `<span class="pend-chip pend-chip-warn">⚠ Ação</span>`;
  }

  function pendCard(icon, title, count, desc, link, linkLabel) {
    const ok = count === 0;
    return `
      <div class="card pend-card${ok ? ' pend-card-ok' : ''}">
        <div class="pend-card-top">
          <span class="pend-card-icon">${icon}</span>
          <div class="pend-card-info">
            <div class="pend-card-title">${title}</div>
            <div class="pend-card-desc">${desc}</div>
          </div>
          ${statusChip(ok)}
        </div>
        ${!ok && link ? `<div class="pend-card-action"><a href="${link}" class="btn btn-sm btn-primary">${linkLabel}</a></div>` : ''}
      </div>`;
  }

  // Card de atletas pendentes com lista compacta de nomes
  const pendAthCard = (() => {
    const ok = pendingAthletes.length === 0;
    const names = pendingAthletes.slice(0, 5).map(a => escapeHtml(a.nome)).join(', ');
    const extra = pendingAthletes.length > 5 ? ` +${pendingAthletes.length - 5}` : '';
    return `
      <div class="card pend-card${ok ? ' pend-card-ok' : ''}">
        <div class="pend-card-top">
          <span class="pend-card-icon">👤</span>
          <div class="pend-card-info">
            <div class="pend-card-title">Atletas pendentes</div>
            <div class="pend-card-desc">${ok ? 'Todos confirmados.' : `${pendingAthletes.length} aguardando confirmação admin`}</div>
            ${!ok ? `<div class="pend-card-names">${names}${extra}</div>` : ''}
          </div>
          ${statusChip(ok)}
        </div>
        ${!ok ? `<div class="pend-card-action"><a href="#admin/atletas" class="btn btn-sm btn-primary">Ver atletas</a></div>` : ''}
      </div>`;
  })();

  // Card de rodada ativa
  const roundCard = rp ? (() => {
    const missing = rp.pending_confirmation + rp.contested + rp.not_launched;
    const ok = missing === 0;
    return `
      <div class="card pend-card${ok ? ' pend-card-ok' : ''}">
        <div class="pend-card-top">
          <span class="pend-card-icon">🎾</span>
          <div class="pend-card-info">
            <div class="pend-card-title">Rodada ${rp.round_number} — resultados</div>
            <div class="pend-card-desc">${rp.confirmed}/${rp.total_groups} grupos confirmados${rp.is_overdue ? ' · <strong style="color:var(--color-danger);">vencida</strong>' : ''}</div>
            ${missing > 0 ? `<div class="pend-card-names" style="color:var(--color-text-muted);">
              ${rp.pending_confirmation > 0 ? `${rp.pending_confirmation} pendente(s)` : ''}
              ${rp.contested > 0 ? ` · ${rp.contested} contestado(s)` : ''}
              ${rp.not_launched > 0 ? ` · ${rp.not_launched} sem lançar` : ''}
            </div>` : ''}
          </div>
          ${statusChip(ok)}
        </div>
        ${!ok ? `<div class="pend-card-action"><a href="#admin/resultados" class="btn btn-sm btn-primary">Ver resultados</a></div>` : ''}
      </div>`;
  })() : '';

  // Card de rodadas vencidas
  const overdueCard = overdueRounds.length > 0 ? `
    <div class="card pend-card">
      <div class="pend-card-top">
        <span class="pend-card-icon">⏰</span>
        <div class="pend-card-info">
          <div class="pend-card-title">Rodadas vencidas</div>
          <div class="pend-card-desc">${overdueRounds.length} rodada(s) abertas com prazo expirado</div>
          <div class="pend-card-names">${overdueRounds.map(r => `Rod. ${r.round_number} (${r.target_date})`).join(' · ')}</div>
        </div>
        <span class="pend-chip pend-chip-warn">⚠ Ação</span>
      </div>
      <div class="pend-card-action"><a href="#admin/rodada" class="btn btn-sm btn-primary">Ver rodadas</a></div>
    </div>` : '';

  content.innerHTML = `
    <div class="section-header">
      <div>
        <h1 class="section-title">Painel de Pendências</h1>
        <p class="section-subtitle">${totalIssues === 0 ? 'Tudo em ordem ✓' : `${totalIssues} item(s) requerem atenção`}</p>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="renderAdminPendencias(document.querySelector('#admin-content'))">↻ Atualizar</button>
    </div>

    ${totalIssues === 0 ? `
      <div style="text-align:center;padding:48px 20px;">
        <div style="font-size:48px;margin-bottom:12px;">✅</div>
        <p style="color:var(--color-text-muted);font-size:14px;">Nenhuma pendência encontrada.</p>
      </div>` : ''}

    ${pendAthCard}
    ${pendCard('⚠️', 'Resultados contestados', contestedCount,
        contestedCount === 0 ? 'Nenhuma contestação aberta.' : `${contestedCount} resultado(s) aguardando decisão`,
        '#admin/contestacoes', 'Ver contestações')}
    ${roundCard}
    ${overdueCard}`;
}

// ---------------------------------------------------------------------------
// Admin: Gestão de Admins
// ---------------------------------------------------------------------------

async function renderAdminAdmins(content) {
  content.innerHTML = `<p class="placeholder-text">Carregando…</p>`;
  let admins = [];
  try {
    const data = await api('/api/admins');
    admins = Array.isArray(data) ? data : (data.data || []);
  } catch (e) {
    renderErrorState(content, e.message, () => renderAdminAdmins(content));
    return;
  }

  function roleLabel(r) {
    return r === 'super'
      ? '<span class="badge badge-titular">Super</span>'
      : '<span class="badge badge-reserva">Staff</span>';
  }

  function buildTable() {
    if (!admins.length) return '<p class="placeholder-text">Nenhum administrador cadastrado.</p>';
    return `
      <table class="data-table">
        <thead><tr>
          <th>Nome</th><th>Username</th><th>Role</th><th>Último Login</th><th></th>
        </tr></thead>
        <tbody>
          ${admins.map(a => `
          <tr>
            <td>${escapeHtml(a.nome)}</td>
            <td><code>${escapeHtml(a.username)}</code></td>
            <td>${roleLabel(a.role)}</td>
            <td style="font-size:13px;color:var(--color-text-muted)">${a.last_login ? fmtDate(a.last_login) : '—'}</td>
            <td style="white-space:nowrap;">
              <button class="btn btn-sm btn-ghost" data-edit="${escapeHtml(a.id)}" title="Editar">✏️</button>
              <button class="btn btn-sm btn-ghost" data-del="${escapeHtml(a.id)}"
                      data-name="${escapeHtml(a.nome)}" title="Remover"
                      style="color:var(--color-danger)">🗑</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  }

  content.innerHTML = `
    <div class="section-header">
      <div>
        <h1 class="section-title">Administradores</h1>
        <p class="section-subtitle">${admins.length} admin(s) cadastrado(s)</p>
      </div>
      <button id="btn-admin-novo" class="btn btn-primary btn-sm">+ Novo Admin</button>
    </div>
    <div id="admins-table-wrap">${buildTable()}</div>`;

  function openAdminModal(admin = null) {
    const isEdit = !!admin;
    const modalTitle = isEdit ? 'Editar Admin' : 'Novo Admin';
    const bodyHtml = `
      <div class="form-group">
        <label class="field-label">Nome</label>
        <input id="m-nome" class="field-input" value="${isEdit ? escapeHtml(admin.nome) : ''}" placeholder="Nome completo" />
      </div>
      ${!isEdit ? `<div class="form-group">
        <label class="field-label">Username</label>
        <input id="m-username" class="field-input" value="" placeholder="admin2" autocomplete="off" />
      </div>` : ''}
      <div class="form-group">
        <label class="field-label">Senha${isEdit ? ' <span style="font-weight:400;color:var(--color-text-muted)">(deixe vazio para manter)</span>' : ''}</label>
        <input id="m-password" type="password" class="field-input"
               placeholder="${isEdit ? '••••••••' : 'mínimo 6 caracteres'}" autocomplete="new-password" />
      </div>
      <div class="form-group">
        <label class="field-label">Role</label>
        <select id="m-role" class="field-input">
          <option value="super"${admin?.role === 'super' || !isEdit ? ' selected' : ''}>Super Admin</option>
          <option value="staff"${admin?.role === 'staff' ? ' selected' : ''}>Staff</option>
        </select>
      </div>`;
    const footerHtml = `
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" id="btn-save-admin" style="margin-left:8px;">${isEdit ? 'Salvar' : 'Criar'}</button>`;

    openModal(modalTitle, bodyHtml, footerHtml);

    document.getElementById('btn-save-admin').addEventListener('click', async () => {
      const nome = document.getElementById('m-nome').value.trim();
      const username = isEdit ? admin.username : (document.getElementById('m-username')?.value.trim() || '');
      const password = document.getElementById('m-password').value;
      const role = document.getElementById('m-role').value;
      if (!nome) { showToast('Nome obrigatório', 'error'); return; }
      if (!isEdit && !username) { showToast('Username obrigatório', 'error'); return; }
      if (!isEdit && !password) { showToast('Senha obrigatória', 'error'); return; }
      try {
        if (isEdit) {
          const payload = { nome, role };
          if (password) payload.password = password;
          await api(`/api/admins/${admin.id}`, { method: 'PUT', body: payload });
        } else {
          await api('/api/admins', { method: 'POST', body: { nome, username, password, role } });
        }
        closeModal();
        showToast(isEdit ? 'Admin atualizado!' : 'Admin criado!', 'success');
        await renderAdminAdmins(content);
      } catch (e) {
        showToast(e.message, 'error');
      }
    });
  }

  content.querySelector('#btn-admin-novo')?.addEventListener('click', () => openAdminModal());

  content.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      const a = admins.find(x => x.id === btn.dataset.edit);
      if (a) openAdminModal(a);
    });
  });

  content.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      confirmModal(
        'Remover Admin',
        `Remover "${btn.dataset.name}"? Esta ação não pode ser desfeita.`,
        async () => {
          try {
            await api(`/api/admins/${btn.dataset.del}`, { method: 'DELETE' });
            showToast('Admin removido.', 'success');
            await renderAdminAdmins(content);
          } catch (e) {
            showToast(e.message, 'error');
          }
        },
        'Remover'
      );
    });
  });
}

// ---------------------------------------------------------------------------
// Admin: WhatsApp em Lote
// ---------------------------------------------------------------------------

async function renderAdminWhatsapp(content) {
  content.innerHTML = `<p class="placeholder-text">Carregando…</p>`;

  let templates = [], athletes = [];
  try {
    const [tplRes, athRes] = await Promise.all([
      api('/api/whatsapp/templates'),
      api('/api/athletes'),
    ]);
    templates = tplRes || [];
    athletes  = (Array.isArray(athRes) ? athRes : (athRes.data || [])).filter(a => a.telefone);
  } catch (e) {
    renderErrorState(content, e.message, () => renderAdminWhatsapp(content));
    return;
  }

  let selectedKey    = templates[0]?.key || 'custom';
  let filterCat      = '';
  let filterStatus   = 'ativo';
  let composeResults = null;

  function getTpl() { return templates.find(t => t.key === selectedKey) || templates[0]; }

  function filteredAthletes() {
    return athletes.filter(a => {
      if (filterCat    && a.current_category !== filterCat) return false;
      if (filterStatus && a.status           !== filterStatus) return false;
      return true;
    });
  }

  function previewText(extraVars = {}) {
    const tpl = getTpl();
    if (!tpl) return '';
    let text = tpl.text || '';
    (tpl.extra_vars || []).forEach(k => {
      text = text.replaceAll(`{${k}}`, extraVars[k] || `{${k}}`);
    });
    return text.replaceAll('{nome}', '[nome do atleta]');
  }

  function extraVarInputsHtml() {
    const tpl = getTpl();
    return (tpl?.extra_vars || []).map(v => `
      <div class="form-group" style="margin-bottom:8px;">
        <label class="field-label" style="font-size:12px;text-transform:capitalize;">${v.replace(/_/g,' ')}</label>
        <input id="wa-var-${v}" class="field-input wa-var" data-var="${v}"
               placeholder="${v}" style="height:32px;font-size:13px;" />
      </div>`).join('');
  }

  function getExtraVars() {
    const vars = {};
    content.querySelectorAll('.wa-var').forEach(inp => { vars[inp.dataset.var] = inp.value.trim(); });
    return vars;
  }

  function render() {
    const filtered = filteredAthletes();
    const tpl      = getTpl();
    content.innerHTML = `
      <div class="section-header">
        <div>
          <h1 class="section-title">WhatsApp em Lote</h1>
          <p class="section-subtitle">Gere links de envio para grupos de atletas</p>
        </div>
        <button class="btn btn-ghost btn-sm" id="btn-wa-hist">📋 Histórico</button>
      </div>

      <div class="card" style="padding:16px;margin-bottom:16px;">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;align-items:end;">
          <div class="form-group" style="margin:0;">
            <label class="field-label">Template</label>
            <select id="wa-tpl-sel" class="field-input">
              ${templates.map(t => `<option value="${t.key}"${t.key===selectedKey?' selected':''}>${t.label}</option>`).join('')}
            </select>
          </div>
          <div class="form-group" style="margin:0;">
            <label class="field-label">Categoria</label>
            <select id="wa-cat-sel" class="field-input">
              <option value="">Todas</option>
              ${['A','B','C','D'].map(c=>`<option value="${c}"${filterCat===c?' selected':''}>${c}</option>`).join('')}
            </select>
          </div>
          <div class="form-group" style="margin:0;">
            <label class="field-label">Status</label>
            <select id="wa-status-sel" class="field-input">
              <option value="">Todos</option>
              <option value="ativo"${filterStatus==='ativo'?' selected':''}>Ativo</option>
              <option value="inativo"${filterStatus==='inativo'?' selected':''}>Inativo</option>
            </select>
          </div>
        </div>
        <div id="wa-extra-wrap" style="margin-top:12px;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;">
          ${extraVarInputsHtml()}
        </div>
        <div style="margin-top:14px;padding:10px 12px;background:var(--color-surface-2);border-radius:8px;">
          <p style="font-size:11px;color:var(--color-text-muted);margin:0 0 4px;">Preview</p>
          <p id="wa-preview" style="font-size:13px;line-height:1.6;margin:0;white-space:pre-wrap;color:var(--color-text);">${escapeHtml(previewText())}</p>
        </div>
        <div style="margin-top:14px;display:flex;align-items:center;gap:12px;">
          <button id="btn-wa-compor" class="btn btn-primary">
            Gerar Links (${filtered.length} atleta${filtered.length!==1?'s':''})
          </button>
          <span style="font-size:12px;color:var(--color-text-muted);">${athletes.length - filtered.length} sem telefone ou filtrado</span>
        </div>
      </div>

      <div id="wa-results-wrap">
        ${composeResults !== null ? buildResultsHtml() : '<p class="placeholder-text" style="font-size:13px;">Configure acima e clique em Gerar Links.</p>'}
      </div>`;

    wireEvents();
  }

  function buildResultsHtml() {
    if (!composeResults?.length) {
      return `<p class="placeholder-text" style="font-size:13px;">Nenhum atleta com telefone nos filtros selecionados.</p>`;
    }
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <p style="font-size:13px;color:var(--color-text-muted);margin:0;">${composeResults.length} link(s) gerado(s)</p>
        <button id="btn-wa-reg" class="btn btn-sm btn-ghost">✅ Registrar Envio</button>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th style="width:32px;"><input type="checkbox" id="wa-chk-all" checked title="Selecionar todos" /></th>
            <th>Atleta</th><th>Cat</th><th>Telefone</th><th></th>
          </tr></thead>
          <tbody>
            ${composeResults.map(r => `
            <tr>
              <td><input type="checkbox" class="wa-chk" value="${r.athlete_id}" checked /></td>
              <td style="font-size:13px;">${escapeHtml(r.nome)}</td>
              <td>${catLabel(r.cat || '')}</td>
              <td style="font-size:12px;color:var(--color-text-muted);">+${r.phone}</td>
              <td>
                <a href="${r.wa_url}" target="_blank" rel="noopener noreferrer"
                   class="btn btn-sm btn-primary" style="text-decoration:none;">📱 Abrir</a>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function wireEvents() {
    content.querySelector('#btn-wa-hist')?.addEventListener('click', renderHistorico);

    content.querySelector('#wa-tpl-sel')?.addEventListener('change', e => {
      selectedKey = e.target.value;
      content.querySelector('#wa-extra-wrap').innerHTML = extraVarInputsHtml();
      content.querySelectorAll('.wa-var').forEach(inp => inp.addEventListener('input', refreshPreview));
      refreshPreview();
      refreshComposeBtn();
    });

    content.querySelector('#wa-cat-sel')?.addEventListener('change', e => {
      filterCat = e.target.value; refreshComposeBtn();
    });
    content.querySelector('#wa-status-sel')?.addEventListener('change', e => {
      filterStatus = e.target.value; refreshComposeBtn();
    });

    content.querySelectorAll('.wa-var').forEach(inp => inp.addEventListener('input', refreshPreview));

    content.querySelector('#btn-wa-compor')?.addEventListener('click', doCompose);

    content.querySelector('#wa-chk-all')?.addEventListener('change', e => {
      content.querySelectorAll('.wa-chk').forEach(cb => cb.checked = e.target.checked);
    });

    content.querySelector('#btn-wa-reg')?.addEventListener('click', doRegistrar);
  }

  function refreshPreview() {
    const el = content.querySelector('#wa-preview');
    if (el) el.textContent = previewText(getExtraVars());
  }

  function refreshComposeBtn() {
    const btn = content.querySelector('#btn-wa-compor');
    const n   = filteredAthletes().length;
    if (btn) btn.textContent = `Gerar Links (${n} atleta${n!==1?'s':''})`;
  }

  async function doCompose() {
    const btn = content.querySelector('#btn-wa-compor');
    if (btn) { btn.disabled = true; btn.textContent = 'Gerando…'; }
    try {
      const vars    = getExtraVars();
      const ids     = filteredAthletes().map(a => a.id);
      const results = await api('/api/whatsapp/compose', {
        method: 'POST',
        body:   { template_key: selectedKey, athlete_ids: ids, ...vars },
      });
      composeResults = results;
      // Enrich with cat for display
      const athMap = Object.fromEntries(athletes.map(a => [a.id, a]));
      composeResults.forEach(r => { r.cat = athMap[r.athlete_id]?.current_category || ''; });
      content.querySelector('#wa-results-wrap').innerHTML = buildResultsHtml();
      wireResultEvents();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      const btn2 = content.querySelector('#btn-wa-compor');
      if (btn2) { btn2.disabled = false; refreshComposeBtn(); }
    }
  }

  function wireResultEvents() {
    content.querySelector('#wa-chk-all')?.addEventListener('change', e => {
      content.querySelectorAll('.wa-chk').forEach(cb => cb.checked = e.target.checked);
    });
    content.querySelector('#btn-wa-reg')?.addEventListener('click', doRegistrar);
  }

  async function doRegistrar() {
    const selected = [...content.querySelectorAll('.wa-chk:checked')].map(cb => cb.value);
    if (!selected.length) { showToast('Selecione ao menos um atleta', 'error'); return; }
    const tpl = getTpl();
    try {
      await api('/api/whatsapp/log', {
        method: 'POST',
        body: {
          template_key:   selectedKey,
          template_label: tpl?.label || '',
          athlete_count:  selected.length,
          vars:           getExtraVars(),
        },
      });
      showToast(`Envio registrado para ${selected.length} atleta(s)!`, 'success');
      composeResults = null;
      render();
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  async function renderHistorico() {
    content.innerHTML = `<p class="placeholder-text">Carregando histórico…</p>`;
    try {
      const data    = await api('/api/whatsapp/log');
      const entries = data.data || [];
      content.innerHTML = `
        <div class="section-header">
          <h1 class="section-title">Histórico de Envios WhatsApp</h1>
          <button class="btn btn-ghost btn-sm" id="btn-hist-back">← Voltar</button>
        </div>
        ${!entries.length ? '<p class="placeholder-text">Nenhum envio registrado.</p>' : `
        <table class="data-table">
          <thead><tr><th>Data</th><th>Template</th><th>Admin</th><th>Qtd</th><th>Parâmetros</th></tr></thead>
          <tbody>
            ${entries.map(e => `<tr>
              <td style="font-size:12px;white-space:nowrap;">${fmtDate(e.timestamp)}</td>
              <td style="font-size:13px;">${escapeHtml(e.template_label || e.template_key)}</td>
              <td style="font-size:12px;color:var(--color-text-muted);">${escapeHtml(e.admin_username || '—')}</td>
              <td>${e.athlete_count}</td>
              <td style="font-size:11px;color:var(--color-text-muted);">
                ${Object.entries(e.vars||{}).map(([k,v])=>`${escapeHtml(k)}: ${escapeHtml(v)}`).join(' · ')||'—'}
              </td>
            </tr>`).join('')}
          </tbody>
        </table>`}`;
      content.querySelector('#btn-hist-back')?.addEventListener('click', () => { composeResults = null; render(); });
    } catch (e) {
      renderErrorState(content, e.message, renderHistorico);
    }
  }

  render();
}

// ---------------------------------------------------------------------------
// Admin: Pagamentos
// ---------------------------------------------------------------------------

async function renderAdminPagamentos(content, selectedSeasonId = null) {
  content.innerHTML = `<p class="placeholder-text">Carregando…</p>`;

  let seasons = [], settings = {};
  try {
    const [sRes, cfgRes] = await Promise.all([
      api('/api/seasons'),
      api('/api/admin/settings'),
    ]);
    seasons  = (sRes.data || sRes || []).sort((a, b) =>
      (b.created_at || '').localeCompare(a.created_at || ''));
    settings = cfgRes || {};
  } catch (e) {
    renderErrorState(content, e.message, () => renderAdminPagamentos(content, selectedSeasonId));
    return;
  }

  if (!seasons.length) {
    content.innerHTML = `<div class="section-header"><h1 class="section-title">Pagamentos</h1></div>
      <p class="placeholder-text">Nenhuma temporada cadastrada.</p>`;
    return;
  }

  const activeSeason = seasons.find(s => s.status === 'active') || seasons[0];
  const curId = selectedSeasonId || activeSeason?.id || seasons[0]?.id;

  let payments = [];
  try {
    payments = await api(`/api/seasons/${curId}/payments`);
  } catch (e) {
    renderErrorState(content, e.message, () => renderAdminPagamentos(content, curId));
    return;
  }

  const payAmt     = parseFloat(settings.payment_amount || 0);
  const dueDay     = parseInt(settings.payment_due_day  || 10, 10);
  const paidList   = payments.filter(p => p.paid);
  const totalPaid  = paidList.reduce((s, p) => s + (p.amount || 0), 0);
  const active     = payments.filter(p => p.status === 'ativo');
  const pending    = active.filter(p => !p.paid);

  let filterShow   = 'all'; // 'all' | 'paid' | 'pending'
  let filterCat    = '';

  function filtered() {
    return payments.filter(p => {
      if (filterCat && p.current_category !== filterCat) return false;
      if (filterShow === 'paid'    && !p.paid) return false;
      if (filterShow === 'pending' && p.paid)  return false;
      return true;
    });
  }

  function buildTable() {
    const rows = filtered();
    if (!rows.length) return '<p class="placeholder-text" style="font-size:13px;">Nenhum atleta nos filtros selecionados.</p>';
    return `
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th>Atleta</th><th>Cat</th><th>Status</th><th>Pagamento</th>
            <th style="text-align:right;">Valor</th><th></th>
          </tr></thead>
          <tbody>
            ${rows.map(p => `<tr>
              <td>
                <div style="font-size:13px;font-weight:500;">${escapeHtml(p.nome)}</div>
                ${p.apelido && p.apelido !== p.nome ? `<div style="font-size:11px;color:var(--color-text-muted);">${escapeHtml(p.apelido)}</div>` : ''}
              </td>
              <td>${catLabel(p.current_category)}</td>
              <td>${statusBadge(p.status)}</td>
              <td>
                ${p.paid
                  ? `<span style="color:#22C55E;font-size:13px;">✅ ${fmtDate(p.paid_at)}</span>`
                  : `<span style="color:var(--color-text-muted);font-size:13px;">⏳ Pendente</span>`}
              </td>
              <td style="text-align:right;font-size:13px;">
                ${p.paid && p.amount ? `R$ ${p.amount.toFixed(2).replace('.',',')}` : '—'}
              </td>
              <td style="white-space:nowrap;">
                ${p.paid
                  ? `<button class="btn btn-sm btn-ghost" data-unpay="${p.athlete_id}" title="Reverter">↩</button>`
                  : `<button class="btn btn-sm btn-primary" data-pay="${p.athlete_id}" data-nome="${escapeHtml(p.nome)}">✓ Pago</button>`}
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function render() {
    const rows = filtered();
    content.innerHTML = `
      <div class="section-header">
        <div>
          <h1 class="section-title">Pagamentos</h1>
          <p class="section-subtitle">${paidList.length}/${payments.filter(p=>p.status==='ativo').length} ativos pagos · R$ ${totalPaid.toFixed(2).replace('.',',')}</p>
        </div>
        <a href="#admin/config" class="btn btn-ghost btn-sm">⚙️ Config</a>
      </div>

      <!-- Resumo -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:16px;">
        <div class="card" style="text-align:center;padding:12px;">
          <div style="font-size:22px;font-weight:700;color:#22C55E;">${paidList.length}</div>
          <div style="font-size:11px;color:var(--color-text-muted);">Pagos</div>
        </div>
        <div class="card" style="text-align:center;padding:12px;">
          <div style="font-size:22px;font-weight:700;color:#EF4444;">${pending.length}</div>
          <div style="font-size:11px;color:var(--color-text-muted);">Pendentes (ativos)</div>
        </div>
        <div class="card" style="text-align:center;padding:12px;">
          <div style="font-size:18px;font-weight:700;">R$ ${totalPaid.toFixed(2).replace('.',',')}</div>
          <div style="font-size:11px;color:var(--color-text-muted);">Arrecadado</div>
        </div>
        ${payAmt > 0 ? `<div class="card" style="text-align:center;padding:12px;">
          <div style="font-size:18px;font-weight:700;">R$ ${(payAmt * paidList.length).toFixed(2).replace('.',',')}</div>
          <div style="font-size:11px;color:var(--color-text-muted);">Esperado (R$${payAmt.toFixed(0)}/atleta)</div>
        </div>` : ''}
      </div>

      <!-- Controles -->
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;align-items:center;">
        <select id="pag-season-sel" class="field-input" style="width:auto;height:34px;font-size:13px;">
          ${seasons.map(s => `<option value="${s.id}"${s.id===curId?' selected':''}>${escapeHtml(s.name || s.id)} ${s.status==='active'?'(ativa)':''}</option>`).join('')}
        </select>
        <select id="pag-filter-show" class="field-input" style="width:auto;height:34px;font-size:13px;">
          <option value="all"${filterShow==='all'?' selected':''}>Todos (${rows.length})</option>
          <option value="paid"${filterShow==='paid'?' selected':''}>Pagos</option>
          <option value="pending"${filterShow==='pending'?' selected':''}>Pendentes</option>
        </select>
        <select id="pag-filter-cat" class="field-input" style="width:auto;height:34px;font-size:13px;">
          <option value="">Todas cats</option>
          ${['A','B','C','D'].map(c=>`<option value="${c}"${filterCat===c?' selected':''}>${c}</option>`).join('')}
        </select>
      </div>

      <div id="pag-table-wrap">${buildTable()}</div>`;

    wireEvents();
  }

  function wireEvents() {
    content.querySelector('#pag-season-sel')?.addEventListener('change', e => {
      renderAdminPagamentos(content, e.target.value);
    });
    content.querySelector('#pag-filter-show')?.addEventListener('change', e => {
      filterShow = e.target.value;
      content.querySelector('#pag-table-wrap').innerHTML = buildTable();
      wireTableEvents();
    });
    content.querySelector('#pag-filter-cat')?.addEventListener('change', e => {
      filterCat = e.target.value;
      content.querySelector('#pag-table-wrap').innerHTML = buildTable();
      wireTableEvents();
    });
    wireTableEvents();
  }

  function wireTableEvents() {
    content.querySelectorAll('[data-pay]').forEach(btn => {
      btn.addEventListener('click', () => {
        const amtDefault = payAmt > 0 ? payAmt.toFixed(2) : '';
        openModal(
          `Registrar pagamento — ${btn.dataset.nome}`,
          `<div class="form-group">
            <label class="field-label">Valor (R$)</label>
            <input id="pay-amount" class="field-input" type="number" step="0.01" min="0"
                   value="${amtDefault}" placeholder="${payAmt > 0 ? payAmt.toFixed(2) : '0.00'}" />
          </div>
          <div class="form-group">
            <label class="field-label">Observação (opcional)</label>
            <input id="pay-note" class="field-input" placeholder="Ex.: pago em espécie" />
          </div>`,
          `<button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
           <button class="btn btn-primary" id="btn-confirm-pay" style="margin-left:8px;">Confirmar</button>`
        );
        document.getElementById('btn-confirm-pay').addEventListener('click', async () => {
          const amount = parseFloat(document.getElementById('pay-amount').value || '0') || 0;
          const note   = document.getElementById('pay-note').value.trim();
          try {
            await api(`/api/seasons/${curId}/payments/${btn.dataset.pay}`, {
              method: 'POST', body: { amount, note },
            });
            closeModal();
            showToast('Pagamento registrado!', 'success');
            await renderAdminPagamentos(content, curId);
          } catch (e) { showToast(e.message, 'error'); }
        });
      });
    });

    content.querySelectorAll('[data-unpay]').forEach(btn => {
      btn.addEventListener('click', () => {
        confirmModal('Reverter Pagamento', 'Marcar este atleta como não pago?', async () => {
          try {
            await api(`/api/seasons/${curId}/payments/${btn.dataset.unpay}`, { method: 'DELETE' });
            showToast('Pagamento revertido.', 'success');
            await renderAdminPagamentos(content, curId);
          } catch (e) { showToast(e.message, 'error'); }
        }, 'Reverter');
      });
    });
  }

  render();
}

// ---------------------------------------------------------------------------
// Mesa: Pagamento
// ---------------------------------------------------------------------------

async function renderMesaPagamento(content) {
  content.innerHTML = `<p class="placeholder-text">Carregando…</p>`;
  let status = null;
  try {
    status = await api('/api/mesa/payment-status');
  } catch (e) {
    renderErrorState(content, e.message, () => renderMesaPagamento(content));
    return;
  }

  if (status.payments_enabled === false) {
    content.innerHTML = `
      <div style="padding:var(--space-md);">
        <h2 class="section-title" style="font-size:18px;">Pagamento</h2>
        <div class="empty-state" style="padding:40px 0;">
          <div class="empty-state-icon">💳</div>
          <p class="empty-state-title">Cobranças não habilitadas</p>
          <p style="font-size:13px;color:var(--color-text-muted);">O clube não está realizando cobranças neste momento.</p>
        </div>
      </div>`;
    return;
  }

  if (!status.season_id) {
    content.innerHTML = `
      <div style="padding:var(--space-md);">
        <h2 class="section-title" style="font-size:18px;">Pagamento</h2>
        <div class="empty-state" style="padding:40px 0;">
          <div class="empty-state-icon">💳</div>
          <p class="empty-state-title">Sem temporada ativa</p>
          <p style="font-size:13px;color:var(--color-text-muted);">Aguarde o administrador iniciar uma temporada.</p>
        </div>
      </div>`;
    return;
  }

  const { paid, paid_at, amount, payment_amount, payment_due_day, season_name } = status;
  const fmtAmt = (v) => v > 0 ? `R$ ${parseFloat(v).toFixed(2).replace('.',',')}` : '—';

  content.innerHTML = `
    <div style="padding:var(--space-md);">
      <h2 class="section-title" style="font-size:18px;margin-bottom:16px;">Pagamento</h2>

      <div class="card" style="text-align:center;padding:28px 20px;margin-bottom:16px;">
        <div style="font-size:52px;margin-bottom:12px;">${paid ? '✅' : '⏳'}</div>
        <div style="font-size:20px;font-weight:700;color:${paid ? '#22C55E' : 'var(--color-text)'};">
          ${paid ? 'Em Dia' : 'Pendente'}
        </div>
        <div style="font-size:13px;color:var(--color-text-muted);margin-top:6px;">
          ${escapeHtml(season_name)}
        </div>
        ${paid
          ? `<div style="font-size:13px;margin-top:12px;">Pago em <strong>${fmtDate(paid_at)}</strong> · ${fmtAmt(amount)}</div>`
          : payment_amount > 0
            ? `<div style="font-size:13px;color:#EF4444;margin-top:12px;">Valor: <strong>${fmtAmt(payment_amount)}</strong> · Vence dia <strong>${payment_due_day}</strong></div>`
            : ''}
      </div>

      ${!paid ? `
        <div class="alert alert-info" style="font-size:13px;line-height:1.6;">
          Entre em contato com a administração do clube para regularizar seu pagamento.
        </div>` : ''}
    </div>`
}
