// QG Pilote v2 — couche DOM + API GitHub. La logique métier vit dans core.js (testé sous Node).
import { QUEUED, filterTasks, groupByPriority, summary, nextAction, formatDue, isLate, isSafeUrl, isClosed, sortTasks, requestFreshSnapshot, myDecisions, awaitingGreenLight, onYou, totalMinutes, closedTasks, postponedDecisions, ownerStats, actionsFor, toCsv } from './core.js';

const DATA_REPO = 'olafcarduf-dev/qg-pilote-data';
const API = 'https://api.github.com';
const TOKEN_KEY = 'qg2-token';
const SNAP_KEY = 'qg2-snapshot';
const POLL_MS = 10_000;
const POLL_MAX_MS = 3 * 60_000;
const TEXT_MAX = 200;

const $ = (s) => document.querySelector(s);
const state = { snapshot: readCache(), tab: 'file', q: '', status: '', priority: '' };

function readCache() {
  try { return JSON.parse(localStorage.getItem(SNAP_KEY)) || null; } catch { return null; }
}
const token = () => localStorage.getItem(TOKEN_KEY) || '';
const tasks = () => state.snapshot?.tasks || [];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmtSync = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR') : 'snapshot vide');
const cleanText = () => ($('#modal-text')?.value || '').trim().slice(0, TEXT_MAX);
const cleanAnswerDate = () => $('#modal-answer-date')?.value || '';

function showToast(msg, isErr = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = isErr ? 'err' : '';
  el.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { el.hidden = true; }, 5000);
}

function setSync(msg, isErr = false) {
  const el = $('#sync-state');
  el.textContent = msg;
  el.className = isErr ? 'err' : '';
}

// ---- API GitHub (token fine-grained, contenu du dépôt privé uniquement) ----
async function gh(path, init = {}) {
  if (!token()) throw new Error('Token manquant (onglet Réglages).');
  const res = await fetch(API + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {})
    }
  });
  if (!res.ok) throw new Error(`GitHub ${res.status} : ${(await res.text()).slice(0, 180)}`);
  return res;
}

async function fetchSnapshot() {
  const res = await gh(`/repos/${DATA_REPO}/contents/snapshot.json`, { headers: { Accept: 'application/vnd.github.raw' }, cache: 'no-store' });
  const snap = JSON.parse(await res.text());
  localStorage.setItem(SNAP_KEY, JSON.stringify(snap));
  state.snapshot = snap;
  return snap;
}

async function dispatch(eventType, payload = {}) {
  return gh(`/repos/${DATA_REPO}/dispatches`, {
    method: 'POST',
    body: JSON.stringify({ event_type: eventType, client_payload: payload })
  });
}

// ---- Rendu ----
function badges(t) {
  const parts = [];
  if (t.postponed && t.status === QUEUED) parts.push('<span class="badge reportee">reportée</span>');
  if (typeof t.timeMin === 'number') parts.push(`<span class="badge time">≈ ${esc(t.timeMin)} min</span>`);
  if (t.blocking) parts.push('<span class="badge block">bloque la suite</span>');
  return parts.length ? `<div class="badges">${parts.join('')}</div>` : '';
}

function card(t, opts = {}) {
  const el = document.createElement('article');
  el.className = 'card' + (isClosed(t) ? ' done' : '') + (isLate(t) ? ' late' : '') + (opts.next ? ' next' : '');
  const acts = actionsFor(t);
  el.innerHTML = `
    <div class="card-top"><span class="prio ${esc(t.priority.toLowerCase())}">${esc(t.priority)}</span><span class="kind">${esc(t.kind)}</span></div>
    <h3>${esc(t.title)}</h3>
    <div class="meta"><span class="status">${esc(t.status)}</span> · ${esc(t.owner)}${t.due ? ` · <span class="due${isLate(t) ? ' late' : ''}">${esc(formatDue(t.due))}</span>` : ''}</div>
    ${t.expected ? `<div class="expected">→ ${esc(t.expected)}</div>` : ''}
    ${badges(t)}
    ${acts.validate ? `
      <div class="card-actions">
        <button class="btn-validate">Valider</button>
        <button class="btn-reject" title="Ne pas valider">Refuser</button>
        <button class="btn-postpone" title="Reporter à plus tard">Reporter</button>
      </div>` : ''}
    ${acts.unpostpone ? '<button class="btn-unpostpone">Remettre dans la file</button>' : ''}
    ${acts.finish ? '<button class="btn-finish">Terminer</button>' : ''}
    ${acts.undo ? '<button class="btn-undo">Annuler</button>' : ''}`;
  el.addEventListener('click', (e) => { if (!e.target.closest('button')) openModal(t.id); });
  const wire = (sel, fn) => {
    const b = el.querySelector(sel);
    if (b) b.addEventListener('click', (e) => { e.stopPropagation(); fn(t, b); });
  };
  wire('.btn-validate', (t2, b) => validate(t2, b));
  wire('.btn-reject', (t2, b) => reject(t2, b));
  wire('.btn-postpone', () => openModal(t.id, 'postpone'));
  wire('.btn-unpostpone', (t2, b) => unpostpone(t2, b));
  wire('.btn-finish', (t2, b) => finish(t2, b));
  wire('.btn-undo', (t2, b) => undo(t2, b));
  return el;
}

function renderFile() {
  const el = $('#tab-file');
  el.textContent = '';
  if (!state.snapshot) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Aucun snapshot en cache. Ajoute ton token dans Réglages puis rafraîchis.';
    el.append(p);
    return;
  }
  const queued = filterTasks(tasks(), { status: QUEUED }).filter((t) => !t.postponed);
  const next = nextAction(tasks());
  if (next) el.append(card(next, { next }));
  const rest = queued.filter((t) => t !== next);
  for (const t of rest) el.append(card(t));
  if (!queued.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Rien à valider. File vide.';
    el.append(p);
  }
  const later = postponedDecisions(tasks());
  if (later.length) {
    const head = document.createElement('div');
    head.className = 'group-title';
    head.innerHTML = `<h2>◈ Reportées à plus tard</h2><span>${later.length}</span>`;
    el.append(head);
    for (const t of later) el.append(card(t));
  }
}

function renderMoi() {
  const el = $('#tab-me');
  el.textContent = '';
  if (!state.snapshot) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Aucun snapshot en cache. Ajoute ton token dans Réglages puis rafraîchis.';
    el.append(p);
    return;
  }
  const all = tasks();
  const mine = myDecisions(all);
  const green = awaitingGreenLight(all);
  const yours = onYou(all);
  const sections = [
    { title: 'Tes décisions', list: mine, hint: 'Valide, refuse ou reporte en un clic.' },
    { title: 'Feu vert à l\u2019IA', list: green, hint: 'L\u2019IA agira dès que tu valides.' },
    { title: 'Toi seul peux le faire', list: yours, hint: yours.length ? `Total estimé : ${totalMinutes(yours)} min` : 'Rien de bloquant sur toi.' }
  ];
  let shown = 0;
  for (const s of sections) {
    if (!s.list.length) continue;
    shown += s.list.length;
    const head = document.createElement('div');
    head.className = 'group-title';
    head.innerHTML = `<h2>◈ ${esc(s.title)}</h2><span>${esc(s.hint)}</span>`;
    el.append(head);
    for (const t of s.list) el.append(card(t));
  }
  if (!shown) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Rien à ton nom pour l\u2019instant.';
    el.append(p);
  }
}

function renderClosed() {
  const el = $('#tab-closed');
  el.textContent = '';
  if (!state.snapshot) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Aucun snapshot en cache.';
    el.append(p);
    return;
  }
  const closed = closedTasks(tasks());
  if (!closed.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Aucune tâche close pour l\u2019instant.';
    el.append(p);
    return;
  }
  for (const [status, label] of [['Terminé', 'Terminées'], ['Validé', 'Validées'], ['Rejeté', 'Rejetées']]) {
    const list = closed.filter((t) => t.status === status);
    if (!list.length) continue;
    const head = document.createElement('div');
    head.className = 'group-title';
    head.innerHTML = `<h2>◈ ${esc(label)}</h2><span>${list.length}</span>`;
    el.append(head);
    for (const t of list) el.append(card(t));
  }
}

function renderTasks() {
  const list = $('#tasks-list');
  list.textContent = '';
  const filtered = filterTasks(tasks(), { q: state.q, status: state.status, priority: state.priority });
  for (const t of filtered) list.append(card(t));
  if (!filtered.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Aucune tâche ne correspond.';
    list.append(p);
  }
}

function renderSummary() {
  const el = $('#tab-summary');
  el.textContent = '';
  if (!state.snapshot) return;
  const s = summary(tasks());
  const head = document.createElement('article');
  head.className = 'card';
  head.innerHTML = `
    <div class="meta"><span class="status">${s.total}</span> tâches · <span class="status">${s.queued}</span> à valider · <span class="status">${s.inProgress}</span> en cours · <span class="status">${s.done}</span> terminées · <span class="status">${s.approved}</span> validées · <span class="status">${s.rejected}</span> rejetées${s.blocked ? ` · <span class="status">${s.blocked}</span> bloquées` : ''}</div>
    <div class="progress"><div style="width:${s.pct}%"></div></div>
    <div class="meta">${s.pct}% terminé · sync ${esc(fmtSync(state.snapshot.generated_at))}</div>`;
  el.append(head);
  // Répartition par statut : une seule barre segmentée, chaque segment proportionnel.
  const todoCount = Math.max(0, s.total - s.done - s.approved - s.rejected - s.inProgress - s.queued - s.blocked);
  const slug = (name) => name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]+/g, '-');
  const dist = [['Terminé', s.done], ['Validé', s.approved], ['Rejeté', s.rejected], ['En cours', s.inProgress], ['En attente de validation', s.queued], ['Bloqué', s.blocked], ['À traiter', todoCount]].filter(([, n]) => n > 0);
  if (dist.length) {
    const seg = document.createElement('article');
    seg.className = 'card';
    const bar = dist.map(([name, n]) => `<div class="seg seg-${slug(name)}" style="width:${(100 * n / s.total).toFixed(2)}%" title="${esc(name)} : ${n}"></div>`).join('');
    const legend = dist.map(([name, n]) => `<span class="pill">${esc(name)} ${n}</span>`).join('');
    seg.innerHTML = `<h3>Répartition par statut</h3><div class="dist">${bar}</div><div class="badges">${legend}</div>`;
    el.append(seg);
  }
  // Charge ouverte par pilote : qui porte quoi, hors file et fiches closes.
  const owners = ownerStats(tasks());
  if (owners.length) {
    const oc = document.createElement('article');
    oc.className = 'card';
    const rows = owners.map((o) => `<tr><td>${esc(o.owner)}</td><td class="n">${o.open}</td><td class="n">${o.high}</td><td class="n">${o.minutes || ''}</td></tr>`).join('');
    oc.innerHTML = `<h3>Charge ouverte par pilote</h3>
      <table class="stats"><thead><tr><th>Pilote</th><th class="n">Ouvertes</th><th class="n">Haute</th><th class="n">Min</th></tr></thead><tbody>${rows}</tbody></table>`;
    el.append(oc);
  }
  const groups = groupByPriority(tasks());
  for (const [p, list] of Object.entries(groups)) {
    if (!list.length) continue;
    const title = document.createElement('div');
    title.className = 'group-title';
    title.innerHTML = `<h2>◈ ${esc(p)}</h2><span>${list.length} en jeu</span>`;
    el.append(title);
    for (const t of list) el.append(card(t));
  }
}

function render() {
  renderFile();
  renderMoi();
  renderClosed();
  renderTasks();
  renderSummary();
}

// ---- Modale de décision ----
// Pour une décision en file : zone de texte (réponse facultative), calendrier (report), 3 boutons.
// Pour une tâche ouverte : Terminer. Pour une fiche close : Annuler.
function openModal(id, focus) {
  const t = tasks().find((x) => x.id === id);
  if (!t) return;
  const acts = actionsFor(t);
  const box = $('#modal-box');
  const needAnswer = acts.validate || acts.reject || acts.finish || acts.postpone;
  // « Réponse attendue QG » mentionne une date → champ date dédié, écrit dans « Date renseignée QG ».
  const needAnswerDate = needAnswer && /date/i.test(t.answerKind || '');
  box.innerHTML = `
    <button class="close" aria-label="Fermer">✕</button>
    <div class="card-top"><span class="prio ${esc(t.priority.toLowerCase())}">${esc(t.priority)}</span><span class="kind">${esc(t.kind)}</span></div>
    <h3>${esc(t.title)}</h3>
    <div class="meta"><span class="status">${esc(t.status)}</span> · ${esc(t.owner)}${t.due ? ` · ${esc(formatDue(t.due))}` : ''}</div>
    ${t.expected ? `<div class="note expected">→ ${esc(t.expected)}</div>` : ''}
    ${badges(t)}
    ${t.note ? `<div class="note">${esc(t.note)}</div>` : ''}
    ${isSafeUrl(t.source) ? `<a href="${esc(t.source)}" target="_blank" rel="noopener">Ouvrir la source ↗</a>` : ''}
    ${needAnswer && t.answerKind ? `<div class="muted">Réponse attendue : ${esc(t.answerKind.toLowerCase())}</div>` : ''}
    ${needAnswer ? `<textarea id="modal-text" rows="3" maxlength="${TEXT_MAX}" placeholder="Ta réponse (facultatif, ajoutée à la fiche Notion)"></textarea>` : ''}
    ${needAnswerDate ? `<label class="muted" for="modal-answer-date">Date de ta réponse</label><input type="date" id="modal-answer-date">` : ''}
    ${acts.postpone ? `<label class="muted" for="modal-date">Nouvelle échéance</label><input type="date" id="modal-date">` : ''}
    <div class="card-actions">
      ${acts.validate ? '<button class="btn-validate">Valider</button>' : ''}
      ${acts.reject ? '<button class="btn-reject">Ne pas valider</button>' : ''}
      ${acts.postpone ? '<button class="btn-postpone" id="btn-modal-postpone" disabled>Reporter à plus tard</button>' : ''}
      ${acts.unpostpone ? '<button class="btn-unpostpone">Remettre dans la file</button>' : ''}
      ${acts.finish ? '<button class="btn-finish">Terminer</button>' : ''}
      ${acts.undo ? '<button class="btn-undo">Annuler</button>' : ''}
    </div>`;
  $('#modal').hidden = false;
  box.querySelector('.close').addEventListener('click', () => { $('#modal').hidden = true; });
  // Pré-remplissage avec la dernière réponse enregistrée dans Notion (propriétés « Réponse Ti Tar QG » / « Date renseignée QG »).
  const ta = box.querySelector('#modal-text');
  if (ta) ta.value = t.answerText || '';
  const ad = box.querySelector('#modal-answer-date');
  if (ad) ad.value = t.answerDate || '';

  const wire = (sel, fn) => {
    const b = box.querySelector(sel);
    if (b) b.addEventListener('click', () => { $('#modal').hidden = true; fn(); });
  };
  wire('.btn-validate', () => validate(t, box.querySelector('.btn-validate'), cleanText(), cleanAnswerDate()));
  wire('.btn-reject', () => reject(t, box.querySelector('.btn-reject'), cleanText(), cleanAnswerDate()));
  wire('.btn-finish', () => finish(t, box.querySelector('.btn-finish'), cleanText(), cleanAnswerDate()));
  wire('.btn-undo', () => undo(t, box.querySelector('.btn-undo')));
  wire('.btn-unpostpone', () => unpostpone(t, box.querySelector('.btn-unpostpone')));

  const btnPostpone = box.querySelector('#btn-modal-postpone');
  const dateInput = box.querySelector('#modal-date');
  if (btnPostpone && dateInput) {
    dateInput.addEventListener('change', () => { btnPostpone.disabled = !dateInput.value; });
    btnPostpone.addEventListener('click', () => {
      if (!dateInput.value) { showToast('Choisis d\u2019abord une nouvelle échéance.', true); return; }
      $('#modal').hidden = true;
      postpone(t, dateInput.value, btnPostpone, cleanText());
    });
  }
  if (focus === 'postpone' && dateInput) dateInput.focus();
}

$('#modal').addEventListener('click', (e) => {
  if (e.target.id === 'modal') $('#modal').hidden = true;
});

// ---- Écriture générique : dispatch → Action GitHub → Notion → snapshot frais ----
async function writeAndWait(t, eventType, btn, label, isDone, failMsg, payload = {}) {
  if (!token()) { switchTab('settings'); showToast('Ajoute ton token dans Réglages.', true); return; }
  btn.disabled = true;
  btn.textContent = 'Envoi…';
  try {
    const before = Date.parse(state.snapshot?.generated_at);
    await dispatch(eventType, { pageId: t.id, ...payload });
    btn.textContent = `${label} en cours…`;
    const deadline = Date.now() + POLL_MAX_MS;
    while (Date.now() < deadline) {
      await sleep(POLL_MS);
      const snap = await fetchSnapshot();
      const task = snap.tasks.find((x) => x.id === t.id);
      if (Date.parse(snap.generated_at) > before && task && isDone(task)) {
        render();
        showToast(`« ${t.title} » → ${task.status}${task.due ? ` · ${formatDue(task.due)}` : ''}`);
        return;
      }
    }
    showToast(failMsg, true);
  } catch (e) {
    showToast(`Échec : ${e.message}`, true);
  } finally {
    render();
  }
}

// Payload de réponse : texte + date de réponse, envoyés au workflow qui les écrit dans
// les propriétés « Réponse Ti Tar QG » et « Date renseignée QG » de la fiche Notion.
const answerPayload = (text, answerDate) => ({ ...(text ? { text } : {}), ...(answerDate ? { answerDate } : {}) });

const validate = (t, btn, text = '', answerDate = '') => writeAndWait(t, 'qg-validate', btn, 'Validation', (x) => x.status === 'Validé',
  'Pas de confirmation après 3 min. Cause la plus fréquente : statut Notion différent de « À valider Ti Tar » (refus sans écriture). Détail dans validate-log.txt du dépôt data.',
  answerPayload(text, answerDate));
const reject = (t, btn, text = '', answerDate = '') => writeAndWait(t, 'qg-reject', btn, 'Rejet', (x) => x.status === 'Rejeté',
  'Pas de confirmation après 3 min. Cause la plus fréquente : la décision n\u2019était plus « À valider Ti Tar » (refus sans écriture). Détail dans reject-log.txt du dépôt data.',
  answerPayload(text, answerDate));
const postpone = (t, due, btn, text = '') => writeAndWait(t, 'qg-postpone', btn, 'Report', (x) => x.status === QUEUED && x.due === due,
  `Pas de confirmation après 3 min. Le report exige une date valide et une décision « À valider Ti Tar » (refus sans écriture). Détail dans postpone-log.txt du dépôt data.`,
  { due, ...(text ? { text } : {}) });
const finish = (t, btn, text = '', answerDate = '') => writeAndWait(t, 'qg-finish', btn, 'Finalisation', (x) => x.status === 'Terminé',
  'Pas de confirmation après 3 min. Causes fréquentes : fiche déjà close, ou décision en file (utilise « Valider »). Refus sans écriture. Détail dans finish-log.txt du dépôt data.',
  answerPayload(text, answerDate));
const undo = (t, btn) => writeAndWait(t, 'qg-undo', btn, 'Annulation', (x) => !isClosed(x),
  'Pas de confirmation après 3 min. Annulation possible uniquement sur une fiche close (Terminé, Validé ou Rejeté). Détail dans undo-log.txt du dépôt data.');
const unpostpone = (t, btn) => writeAndWait(t, 'qg-unpostpone', btn, 'Remise en file', (x) => x.status === QUEUED && !x.postponed,
  'Pas de confirmation après 3 min. Remise en file possible uniquement sur une décision reportée « À valider Ti Tar ». Détail dans unpostpone-log.txt du dépôt data.');

// ---- Synchro ----
// Sans argument : simple relecture du snapshot commité. Avec force=true (bouton ⟳) :
// déclenche la synchro GitHub Actions (qg-sync) puis attend le nouveau snapshot.
async function refresh(force = false) {
  const btn = $('#btn-refresh');
  btn.disabled = true;
  setSync(force ? 'sync GitHub Actions…' : 'sync…');
  try {
    if (!token()) { setSync('token manquant', true); switchTab('settings'); return; }
    const snap = force
      ? await requestFreshSnapshot({ dispatch, fetchSnapshot, sleep, pollMs: POLL_MS, timeout: POLL_MAX_MS })
      : await fetchSnapshot();
    setSync(`sync ${fmtSync(snap.generated_at)}`);
    render();
  } catch (e) {
    setSync(`Erreur de synchro · dernier snapshot : ${fmtSync(state.snapshot?.generated_at)}`, true);
    showToast(e.message, true);
  } finally {
    btn.disabled = false;
  }
}

// ---- Navigation & réglages ----
function switchTab(tab) {
  state.tab = tab;
  for (const b of document.querySelectorAll('nav button')) b.classList.toggle('active', b.dataset.tab === tab);
  for (const s of document.querySelectorAll('.tab')) s.classList.toggle('active', s.id === `tab-${tab}`);
}

for (const b of document.querySelectorAll('nav button')) {
  b.addEventListener('click', () => switchTab(b.dataset.tab));
}
$('#btn-refresh').addEventListener('click', () => refresh(true));
$('#search').addEventListener('input', (e) => { state.q = e.target.value; renderTasks(); });
$('#filter-status').addEventListener('change', (e) => { state.status = e.target.value; renderTasks(); });
$('#filter-priority').addEventListener('change', (e) => { state.priority = e.target.value; renderTasks(); });

// Export CSV des tâches filtrées : BOM UTF-8 pour Excel FR, une tâche = une ligne.
$('#btn-export').addEventListener('click', () => {
  const rows = filterTasks(tasks(), { q: state.q, status: state.status, priority: state.priority });
  if (!rows.length) { showToast('Rien à exporter avec ces filtres.', true); return; }
  const blob = new Blob(['\uFEFF' + toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `qg-taches-${(state.snapshot?.generated_at || '').slice(0, 10) || 'export'}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
  showToast(`${rows.length} tâche(s) exportée(s) en CSV.`);
});

$('#btn-save-token').addEventListener('click', () => {
  const v = $('#token-input').value.trim();
  if (!v) { $('#token-msg').textContent = 'Champ vide : rien à enregistrer.'; return; }
  localStorage.setItem(TOKEN_KEY, v);
  $('#token-input').value = '';
  $('#token-msg').textContent = 'Token enregistré dans ce navigateur.';
  refresh();
});
$('#btn-clear-token').addEventListener('click', () => {
  localStorage.removeItem(TOKEN_KEY);
  $('#token-msg').textContent = 'Token et cache effacés.';
  localStorage.removeItem(SNAP_KEY);
  state.snapshot = null;
  setSync('Connexion GitHub à configurer.');
  render();
});
$('#btn-test-token').addEventListener('click', async () => {
  const v = $('#token-input').value.trim() || token();
  if (!v) { $('#token-msg').textContent = 'Aucun token à tester.'; return; }
  localStorage.setItem(TOKEN_KEY, v);
  try {
    const snap = await fetchSnapshot();
    $('#token-msg').textContent = snap.generated_at
      ? `OK : ${snap.tasks.length} tâches dans le registre.`
      : 'Token OK, mais snapshot pas encore généré (secret NOTION_TOKEN ?).';
    render();
  } catch (e) {
    $('#token-msg').textContent = `Échec : ${e.message}`;
  }
});

// ---- Démarrage ----
setSync(`cache ${fmtSync(state.snapshot?.generated_at)}`);
render();
refresh();
