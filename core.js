// QG Pilote v2 — logique pure. Aucun DOM, aucun réseau : testable sous Node.
// Le snapshot (produit par le dépôt qg-pilote-data) contient des tâches déjà mappées :
// { id, title, status, owner, priority, kind, due, source, note, expected, timeMin, blocking, qgAction }

export const QUEUED = 'En attente de validation';

export const isClosed = (task) => ['Terminé', 'Validé', 'Rejeté'].includes(task.status);
// Supprimée côté site = case « Archivée QG » cochée : récupérable, jamais détruite.
export const isArchived = (t) => t?.archived === true;

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
    if (isArchived(t)) return false;
    if (f.status && t.status !== f.status) return false;
    if (f.owner && t.owner !== f.owner) return false;
    if (f.priority && t.priority !== f.priority) return false;
    if (q && !`${t.title} ${t.owner} ${t.kind} ${t.note ?? ''} ${t.expected ?? ''}`.toLowerCase().includes(q)) return false;
    return true;
  }));
}

export function groupByPriority(tasks) {
  const groups = { Haute: [], Normale: [], Basse: [] };
  for (const t of tasks) {
    if (isClosed(t) || isArchived(t)) continue;
    (groups[t.priority] ?? (groups[t.priority] = [])).push(t);
  }
  for (const k of Object.keys(groups)) groups[k] = sortTasks(groups[k]);
  return groups;
}

export function summary(tasks) {
  const counts = {};
  for (const t of tasks) {
    if (isArchived(t)) continue;
    counts[t.status] = (counts[t.status] || 0) + 1;
  }
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
  return sortTasks(tasks.filter((t) => isQueued(t) && !t.postponed && !isArchived(t)))[0] ?? null;
}

// Compteur de la file actionnable (badge de l'onglet File).
export const queueCount = (tasks) => tasks.filter((t) => isQueued(t) && !t.postponed && !isArchived(t)).length;

export function formatDue(due) {
  if (!due) return '';
  const [y, m, d] = due.slice(0, 10).split('-');
  if (!y || !m || !d) return due;
  return `${d}/${m}/${y}`;
}

export function isLate(t, today = new Date().toISOString().slice(0, 10)) {
  return !!t.due && t.due.slice(0, 10) < today && !isClosed(t);
}

// Échéance relative pour le suivi : « aujourd’hui », « demain », « dans 3 j », « il y a 2 j ».
export function relativeDue(due, today = new Date().toISOString().slice(0, 10)) {
  if (!due) return '';
  const d = due.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return '';
  const diff = Math.round((Date.parse(d + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000);
  if (diff === 0) return 'aujourd’hui';
  if (diff === 1) return 'demain';
  if (diff === -1) return 'hier';
  if (diff > 1) return `dans ${diff} j`;
  return `il y a ${-diff} j`;
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

// Décisions qui attendent Ti Tar (en file, pas pilotées par une IA). Les reportées
// sont exclues : elles s'affichent dans la section « Reportées » de l'onglet File.
export function myDecisions(tasks) {
  return tasks.filter((t) => t.status === QUEUED && !AI_PILOTS.includes(t.owner) && !t.postponed && !isArchived(t));
}

// Tâches qu'une IA peut faire mais qui attendent le feu vert de Ti Tar.
export function awaitingGreenLight(tasks) {
  return tasks.filter((t) => t.status === QUEUED && AI_PILOTS.includes(t.owner) && !t.postponed && !isArchived(t));
}

// Décisions mises de côté par « Reporter » : toujours en file, case « Reportée QG » cochée.
export function postponedDecisions(tasks) {
  return sortTasks(tasks.filter((t) => t.status === QUEUED && t.postponed && !isArchived(t)));
}

// Tâches que Ti Tar seul peut faire : pilotées par lui ou « bloque la suite », hors file, non closes.
export function onYou(tasks) {
  return sortTasks(tasks.filter((t) =>
    t.status !== QUEUED && !isClosed(t) && !isArchived(t) && (t.owner === 'Ti Tar' || t.blocking === true)
  ));
}

export const totalMinutes = (tasks) => tasks.reduce((sum, t) => sum + (typeof t.timeMin === 'number' ? t.timeMin : 0), 0);

// Compteur de l'onglet « Moi » : décisions à prendre + tâches qui ne peuvent avancer que par Ti Tar.
export const myCount = (tasks) => myDecisions(tasks).length + onYou(tasks).length;

// ---- Quels boutons afficher selon le statut ----
// La file décide (Valider / Ne pas valider / Reporter), les reportées se remettent en file,
// les closes s'annulent, le reste se termine.
export function actionsFor(t) {
  if (isArchived(t)) {
    return { validate: false, reject: false, postpone: false, unpostpone: false, finish: false, undo: false, edit: true, archive: false, restore: true };
  }
  if (t.status === QUEUED) {
    return { validate: true, reject: true, postpone: true, unpostpone: !!t.postponed, finish: false, undo: false, edit: true, archive: true, restore: false };
  }
  if (isClosed(t)) return { validate: false, reject: false, postpone: false, unpostpone: false, finish: false, undo: true, edit: true, archive: true, restore: false };
  return { validate: false, reject: false, postpone: false, unpostpone: false, finish: true, undo: false, edit: true, archive: true, restore: false };
}

// Tâches closes, groupables : Terminé d'abord, puis Validé, puis Rejeté. Les archivées vont dans la
// section « Supprimées », elles ne polluent pas cette liste.
export function closedTasks(tasks) {
  return [...tasks.filter((t) => isClosed(t) && !isArchived(t))].sort((a, b) =>
    (CLOSED_RANK[a.status] - CLOSED_RANK[b.status]) ||
    ((PRIO_RANK[a.priority] ?? 1) - (PRIO_RANK[b.priority] ?? 1)) ||
    String(b.due ?? '').localeCompare(String(a.due ?? '')) ||
    a.title.localeCompare(b.title)
  );
}

// Section « Supprimées » (onglet Terminées) : archivées, récupérables via « Restaurer ».
export function archivedTasks(tasks) {
  return sortTasks(tasks.filter(isArchived));
}

// Compteur de l'onglet « Terminées » : fiches closes + archivées.
export const closedCount = (tasks) => closedTasks(tasks).length + archivedTasks(tasks).length;

// Charge ouverte par pilote : ouvertes (hors file et closes), dont décisions en file et Haute priorité.
export function ownerStats(tasks) {
  const by = {};
  for (const t of tasks) {
    if (isArchived(t) || t.status === QUEUED || isClosed(t)) continue;
    const o = by[t.owner] ?? (by[t.owner] = { owner: t.owner, open: 0, high: 0, minutes: 0 });
    o.open++;
    if (t.priority === 'Haute') o.high++;
    if (typeof t.timeMin === 'number') o.minutes += t.timeMin;
  }
  return Object.values(by).sort((a, b) => b.open - a.open || a.owner.localeCompare(b.owner));
}

// ---- Export CSV (onglet Tâches, filtres appliqués) ----
// Séparateur « ; » pour Excel FR. Les sauts de ligne sont aplatis : une tâche = une ligne.
export function csvEscape(v) {
  const s = String(v ?? '').replace(/\r?\n/g, ' ');
  return /[";]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

const CSV_COLUMNS = [
  ['Tâche', (t) => t.title],
  ['Statut', (t) => t.status],
  ['Pilote', (t) => t.owner],
  ['Priorité', (t) => t.priority],
  ['Type', (t) => t.kind],
  ['Échéance', (t) => formatDue(t.due)],
  ['Réponse attendue', (t) => t.answerKind || ''],
  ['Réponse de Ti Tar', (t) => t.answerText || ''],
  ['Date de réponse', (t) => formatDue(t.answerDate)],
  ['Temps estimé (min)', (t) => t.timeMin ?? ''],
  ['Bloque la suite', (t) => (t.blocking ? 'oui' : 'non')],
  ['Action attendue', (t) => t.expected || '']
];

export function toCsv(tasks) {
  const lines = [CSV_COLUMNS.map(([label]) => csvEscape(label)).join(';')];
  for (const t of tasks) lines.push(CSV_COLUMNS.map(([, get]) => csvEscape(get(t))).join(';'));
  return lines.join('\r\n');
}
