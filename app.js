// QG Pilote v2 — couche DOM + API GitHub. La logique métier vit dans core.js (testé sous Node).
import { QUEUED, filterTasks, groupByPriority, summary, nextAction, formatDue, isLate, isSafeUrl } from './core.js';

const DATA_REPO = 'olafcarduf-dev/qg-pilote-data';
const API = 'https://api.github.com';
const TOKEN_KEY = 'qg2-token';
const SNAP_KEY = 'qg2-snapshot';
const POLL_MS = 10_000;
const POLL_MAX_MS = 3 * 60_000;

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
  const res = await gh(`/repos/${DATA_REPO}/contents/snapshot.json`, { headers: { Accept: 'application/vnd.github.raw' } });
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
function card(t, opts = {}) {
  const el = document.createElement('article');
  el.className = 'card' + (t.status === 'Terminé' ? ' done' : '') + (isLate(t) ? ' late' : '') + (opts.next ? ' next' : '');
  el.innerHTML = `
    <div class="card-top"><span class="prio ${esc(t.priority.toLowerCase())}">${esc(t.priority)}</span><span class="kind">${esc(t.kind)}</span></div>
    <h3>${esc(t.title)}</h3>
    <div class="meta"><span class="status">${esc(t.status)}</span> · ${esc(t.owner)}${t.due ? ` · <span class="due${isLate(t) ? ' late' : ''}">${esc(formatDue(t.due))}</span>` : ''}</div>
    ${t.status === QUEUED ? '<button class="btn-validate">Valider</button>' : ''}`;
  el.addEventListener('click', (e) => { if (!e.target.closest('button')) openModal(t.id); });
  const btn = el.querySelector('.btn-validate');
  if (btn) btn.addEventListener('click', () => validate(t, btn));
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
  const queued = filterTasks(tasks(), { status: QUEUED });
  const next = nextAction(tasks());
  if (next) el.append(card(next, { next }));
  const rest = queued.filter((t) => t !== next);
  for (const t of rest) el.append(card(t));
  if (!queued.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = state.snapshot.generated_at
      ? 'Rien à valider. File vide.'
      : 'Snapshot pas encore généré : pose le secret NOTION_TOKEN (voir README du dépôt data) puis attends la synchro horaire ou appuie sur ⟳.';
    el.append(p);
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
    <div class="meta"><span class="status">${s.total}</span> tâches · <span class="status">${s.queued}</span> à valider · <span class="status">${s.inProgress}</span> en cours · <span class="status">${s.done}</span> terminées${s.blocked ? ` · <span class="status">${s.blocked}</span> bloquées` : ''}</div>
    <div class="progress"><div style="width:${s.pct}%"></div></div>
    <div class="meta">${s.pct}% terminé · sync ${esc(fmtSync(state.snapshot.generated_at))}</div>`;
  el.append(head);
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
  renderTasks();
  renderSummary();
}

// ---- Modale fiche ----
function openModal(id) {
  const t = tasks().find((x) => x.id === id);
  if (!t) return;
  const box = $('#modal-box');
  box.innerHTML = `
    <button class="close" aria-label="Fermer">✕</button>
    <div class="card-top"><span class="prio ${esc(t.priority.toLowerCase())}">${esc(t.priority)}</span><span class="kind">${esc(t.kind)}</span></div>
    <h3>${esc(t.title)}</h3>
    <div class="meta"><span class="status">${esc(t.status)}</span> · ${esc(t.owner)}${t.due ? ` · ${esc(formatDue(t.due))}` : ''}</div>
    ${t.note ? `<div class="note">${esc(t.note)}</div>` : ''}
    ${isSafeUrl(t.source) ? `<a href="${esc(t.source)}" target="_blank" rel="noopener">Ouvrir la source ↗</a>` : ''}
    ${t.status === QUEUED ? '<button class="btn-validate">Valider</button>' : ''}`;
  $('#modal').hidden = false;
  box.querySelector('.close').addEventListener('click', () => { $('#modal').hidden = true; });
  const btn = box.querySelector('.btn-validate');
  if (btn) btn.addEventListener('click', () => { $('#modal').hidden = true; validate(t, btn); });
}

$('#modal').addEventListener('click', (e) => {
  if (e.target.id === 'modal') $('#modal').hidden = true;
});

// ---- Validation en un clic : dispatch → Action GitHub → Notion → snapshot frais ----
async function validate(t, btn) {
  if (!token()) { switchTab('settings'); showToast('Ajoute ton token dans Réglages.', true); return; }
  btn.disabled = true;
  btn.textContent = 'Envoi…';
  try {
    await dispatch('qg-validate', { pageId: t.id });
    btn.textContent = 'Validation en cours…';
    const before = state.snapshot?.generated_at;
    const deadline = Date.now() + POLL_MAX_MS;
    while (Date.now() < deadline) {
      await sleep(POLL_MS);
      const snap = await fetchSnapshot();
      const task = snap.tasks.find((x) => x.id === t.id);
      if (snap.generated_at !== before && task && task.status !== QUEUED) {
        render();
        showToast(`« ${t.title} » → ${task.status}`);
        return;
      }
      if (snap.generated_at !== before && !task) {
        render();
        showToast('Snapshot actualisé.');
        return;
      }
    }
    showToast('Pas de confirmation après 3 min. Cause la plus fréquente : statut Notion différent de « À valider Ti Tar » (validation refusée sans écriture). Détail dans validate-log.txt du dépôt data.', true);
  } catch (e) {
    showToast(`Échec : ${e.message}`, true);
  } finally {
    render();
  }
}

// ---- Synchro ----
// Sans argument : simple relecture du snapshot commité. Avec force=true (bouton ⟳) :
// déclenche la synchro GitHub Actions (qg-sync) puis attend le nouveau snapshot.
async function refresh(force = false) {
  const btn = $('#btn-refresh');
  btn.disabled = true;
  setSync(force ? 'sync GitHub Actions…' : 'sync…');
  try {
    if (!token()) { setSync('token manquant', true); switchTab('settings'); return; }
    if (force) {
      const before = state.snapshot?.generated_at;
      await dispatch('qg-sync');
      const deadline = Date.now() + POLL_MAX_MS;
      while (Date.now() < deadline) {
        await sleep(POLL_MS);
        const snap = await fetchSnapshot();
        if (snap.generated_at !== before) {
          setSync(`sync ${fmtSync(snap.generated_at)}`);
          render();
          return;
        }
      }
      setSync('sync lente', true);
      showToast('Synchro pas terminée après 3 min : vérifie l\'onglet Actions de qg-pilote-data.', true);
      return;
    }
    const snap = await fetchSnapshot();
    setSync(`sync ${fmtSync(snap.generated_at)}`);
    render();
  } catch (e) {
    setSync('erreur sync', true);
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
  $('#token-msg').textContent = 'Token effacé.';
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
