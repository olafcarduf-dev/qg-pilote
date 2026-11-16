// QG Pilote v2 — logique pure. Aucun DOM, aucun réseau : testable sous Node.
// Le snapshot (produit par le dépôt qg-pilote-data) contient des tâches déjà mappées :
// { id, title, status, owner, priority, kind, due, source, note, expected, timeMin, blocking, qgAction }

export const QUEUED = 'En attente de validation';

export const isClosed = (task) => ['Terminé', 'Validé', 'Rejeté'].includes(task.status);

const PRIO_RANK = { Haute: 0, Normale: 1, Basse: 2 };
const CLOSED_RANK = { 'Terminé': 0, 'Validé': 1, 'Rejeté': 2 };

function statusRank(t) {
  if (t.status === QUEUED) return 0;
  if (t.status === 'En cours') return 1;
  if (isClosed(t)) return 3;
  return 2; // À traiter, Bloqué, autres
}

export function sortTasks(tasks) {
  return [...tasks].sort((a, b) =>
    (statusRank(a) - statusRank(b)) ||
    ((PRIO_RANK[a.priority] ?? 1) - (PRIO_RANK[b.priority] ?? 1)) ||
    String(a.due ?? '9999').localeCompare(String(b.due ?? '9999')) ||
    a.title.localeCompare(b.title)
  );
}

export function isQueued(t) {
  return t?.status === QUEUED;
}

export function filterTasks(tasks, f = {}) {
  const q = (f.q || '').trim().toLowerCase();
  return sortTasks(tasks.filter((t) => {
    if (f.status && t.status !== f.status) return false;
    if (f.owner && t.owner !== f.owner) return false;
    if (f.priority && t.priority !== f.priority) return false;
    if (q && !`${t.title} ${t.owner} ${t.kind}`.toLowerCase().includes(q)) return false;
    return true;
  }));
}

export function groupByPriority(tasks) {
  const groups = { Haute: [], Normale: [], Basse: [] };
  for (const t of tasks) {
    if (isClosed(t)) continue;
    (groups[t.priority] ?? (groups[t.priority] = [])).push(t);
  }
  for (const k of Object.keys(groups)) groups[k] = sortTasks(groups[k]);
  return groups;
}

export function summary(tasks) {
  const counts = {};
  for (const t of tasks) counts[t.status] = (counts[t.status] || 0) + 1;
  return {
    total: tasks.length,
    queued: counts[QUEUED] || 0,
    inProgress: counts['En cours'] || 0,
    done: counts['Terminé'] || 0,
    approved: counts['Validé'] || 0,
    rejected: counts['Rejeté'] || 0,
    blocked: counts['Bloqué'] || 0,
    pct: tasks.length ? Math.round(((counts['Terminé'] || 0) / tasks.length) * 100) : 0
  };
}

export function nextAction(tasks) {
  return sortTasks(tasks.filter(isQueued))[0] ?? null;
}

export function formatDue(due) {
  if (!due) return '';
  const [y, m, d] = due.slice(0, 10).split('-');
  if (!y || !m || !d) return due;
  return `${d}/${m}/${y}`;
}

export function isLate(t, today = new Date().toISOString().slice(0, 10)) {
  return !!t.due && t.due.slice(0, 10) < today && !isClosed(t);
}

// Lien sûr : uniquement http(s). Bloque javascript:, data: et cie, même sur une valeur échappée.
export function isSafeUrl(u) {
  if (typeof u !== 'string' || !u) return false;
  try {
    const p = new URL(u);
    return p.protocol === 'http:' || p.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function requestFreshSnapshot({ dispatch, fetchSnapshot, sleep, pollMs, timeout }) {
  const before = Date.parse((await fetchSnapshot()).generated_at);
  await dispatch('qg-sync');
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    await sleep(Math.min(pollMs, deadline - Date.now()));
    const snapshot = await fetchSnapshot();
    const generated = Date.parse(snapshot.generated_at);
    if (Number.isFinite(generated) && (!Number.isFinite(before) || generated > before)) return snapshot;
  }
  throw new Error('Aucun snapshot Notion plus récent. Vérifie le dernier run GitHub Actions.');
}

// ---- Onglet « Moi » : qui doit faire quoi ----
export const AI_PILOTS = ['Vibe', 'ChatGPT', 'Claude', 'Python'];

// Décisions qui attendent Ti Tar (en file, pas pilotées par une IA).
export function myDecisions(tasks) {
  return tasks.filter((t) => t.status === QUEUED && !AI_PILOTS.includes(t.owner));
}

// Tâches qu'une IA peut faire mais qui attendent le feu vert de Ti Tar.
export function awaitingGreenLight(tasks) {
  return tasks.filter((t) => t.status === QUEUED && AI_PILOTS.includes(t.owner));
}

// Tâches que Ti Tar seul peut faire : pilotées par lui ou « bloque la suite », hors file, non closes.
export function onYou(tasks) {
  return sortTasks(tasks.filter((t) =>
    t.status !== QUEUED && !isClosed(t) && (t.owner === 'Ti Tar' || t.blocking === true)
  ));
}

export const totalMinutes = (tasks) => tasks.reduce((sum, t) => sum + (typeof t.timeMin === 'number' ? t.timeMin : 0), 0);

// ---- Quels boutons afficher selon le statut ----
// La file décide (Valider / Ne pas valider / Reporter), les closes s'annulent, le reste se termine.
export function actionsFor(t) {
  if (t.status === QUEUED) return { validate: true, reject: true, postpone: true, finish: false, undo: false };
  if (isClosed(t)) return { validate: false, reject: false, postpone: false, finish: false, undo: true };
  return { validate: false, reject: false, postpone: false, finish: true, undo: false };
}

// Tâches closes, groupables : Terminé d'abord, puis Validé, puis Rejeté.
export function closedTasks(tasks) {
  return [...tasks.filter(isClosed)].sort((a, b) =>
    (CLOSED_RANK[a.status] - CLOSED_RANK[b.status]) ||
    ((PRIO_RANK[a.priority] ?? 1) - (PRIO_RANK[b.priority] ?? 1)) ||
    String(b.due ?? '').localeCompare(String(a.due ?? '')) ||
    a.title.localeCompare(b.title)
  );
}
