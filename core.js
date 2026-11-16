// QG Pilote v2 — logique pure. Aucun DOM, aucun réseau : testable sous Node.
// Le snapshot (produit par le dépôt qg-pilote-data) contient des tâches déjà mappées :
// { id, title, status, owner, priority, kind, due, source, note }

export const QUEUED = 'En attente de validation';

const PRIO_RANK = { Haute: 0, Normale: 1, Basse: 2 };

function statusRank(t) {
  if (t.status === QUEUED) return 0;
  if (t.status === 'En cours') return 1;
  if (t.status === 'Terminé') return 3;
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
    if (t.status === 'Terminé') continue;
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
  return !!t.due && t.due.slice(0, 10) < today && t.status !== 'Terminé';
}
