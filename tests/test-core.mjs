import assert from 'node:assert/strict';
import { QUEUED, sortTasks, filterTasks, groupByPriority, summary, nextAction, formatDue, isLate } from '../core.js';

let ok = 0;
const fails = [];
const atest = async (name, fn) => {
  try { await fn(); ok++; console.log('  ok  ' + name); }
  catch (e) { fails.push(name); console.error('FAIL  ' + name + ' :: ' + e.message); }
};

const t = (o) => ({
  id: o.id ?? Math.random().toString(36).slice(2),
  title: o.title ?? 'Tâche',
  status: o.status ?? 'À traiter',
  owner: o.owner ?? 'Vibe',
  priority: o.priority ?? 'Normale',
  kind: o.kind ?? 'Action à faire',
  due: o.due ?? null,
  source: null,
  note: null
});

await atest('tri : la file passe avant tout, puis priorité, puis échéance', async () => {
  const tasks = [
    t({ title: 'P1 en cours', status: 'En cours', priority: 'Normale' }),
    t({ title: 'P0 à traiter', status: 'À traiter', priority: 'Haute' }),
    t({ title: 'En file P2', status: QUEUED, priority: 'Basse' }),
    t({ title: 'En file P0', status: QUEUED, priority: 'Haute' }),
    t({ title: 'Terminé', status: 'Terminé', priority: 'Haute' })
  ];
  const sorted = sortTasks(tasks);
  assert.strictEqual(sorted[0].title, 'En file P0');
  assert.strictEqual(sorted[1].title, 'En file P2');
  assert.strictEqual(sorted[2].title, 'P1 en cours');
  assert.strictEqual(sorted.at(-1).title, 'Terminé');
});

await atest('tri : à priorité égale, l’échéance la plus proche d’abord', async () => {
  const sorted = sortTasks([
    t({ title: 'loin', status: 'En cours', due: '2026-12-31' }),
    t({ title: 'proche', status: 'En cours', due: '2026-11-20' })
  ]);
  assert.strictEqual(sorted[0].title, 'proche');
});

await atest('filtre : recherche texte sur titre, pilote et type', async () => {
  const tasks = [
    t({ title: 'Valider les règles', owner: 'Ti Tar' }),
    t({ title: 'Écrire la doc', owner: 'Claude', kind: 'Apprentissage' })
  ];
  assert.strictEqual(filterTasks(tasks, { q: 'règles' }).length, 1);
  assert.strictEqual(filterTasks(tasks, { q: 'claude' }).length, 1);
  assert.strictEqual(filterTasks(tasks, { q: 'apprentissage' }).length, 1);
  assert.strictEqual(filterTasks(tasks, { q: 'zzz' }).length, 0);
});

await atest('filtre : statut, pilote et priorité combinés', async () => {
  const tasks = [
    t({ title: 'a', status: QUEUED, owner: 'Ti Tar', priority: 'Haute' }),
    t({ title: 'b', status: QUEUED, owner: 'Vibe', priority: 'Haute' }),
    t({ title: 'c', status: 'En cours', owner: 'Ti Tar', priority: 'Haute' })
  ];
  assert.strictEqual(filterTasks(tasks, { status: QUEUED, owner: 'Ti Tar', priority: 'Haute' }).length, 1);
});

await atest('groupByPriority : exclut les tâches Terminées et trie chaque groupe', async () => {
  const groups = groupByPriority([
    t({ title: 'fait', status: 'Terminé', priority: 'Haute' }),
    t({ title: 'P2', priority: 'Basse', status: 'À traiter' }),
    t({ title: 'P0', priority: 'Haute', status: 'En cours' })
  ]);
  assert.strictEqual(Object.keys(groups).length, 3);
  assert.ok(groups.Haute.length === 1 && groups.Haute[0].title === 'P0');
  assert.ok(groups.Basse.length === 1);
  assert.ok(!JSON.stringify(groups).includes('fait'));
});

await atest('summary : compteurs et pourcentage de tâches terminées', async () => {
  const s = summary([
    t({ status: QUEUED }), t({ status: QUEUED }),
    t({ status: 'En cours' }),
    t({ status: 'Terminé' }), t({ status: 'Terminé' }), t({ status: 'Terminé' }),
    t({ status: 'Bloqué' }),
    t({ status: 'À traiter' })
  ]);
  assert.strictEqual(s.total, 8);
  assert.strictEqual(s.queued, 2);
  assert.strictEqual(s.inProgress, 1);
  assert.strictEqual(s.done, 3);
  assert.strictEqual(s.blocked, 1);
  assert.strictEqual(s.pct, 38); // 3/8 = 37,5 % arrondi à 38
});

await atest('summary : registre vide → 0 %, pas de division par zéro', async () => {
  const s = summary([]);
  assert.strictEqual(s.total, 0);
  assert.strictEqual(s.pct, 0);
});

await atest('nextAction : la tâche en file la plus prioritaire, sinon null', async () => {
  const tasks = [
    t({ title: 'P2 en file', status: QUEUED, priority: 'Basse' }),
    t({ title: 'P0 en file', status: QUEUED, priority: 'Haute' }),
    t({ title: 'P0 ailleurs', status: 'En cours', priority: 'Haute' })
  ];
  assert.strictEqual(nextAction(tasks).title, 'P0 en file');
  assert.strictEqual(nextAction(tasks.filter((x) => x.status !== QUEUED)), null);
});

await atest('formatDue : YYYY-MM-DD → JJ/MM/AAAA, gère les vides', async () => {
  assert.strictEqual(formatDue('2026-11-23'), '23/11/2026');
  assert.strictEqual(formatDue('2026-11-23T12:00:00.000Z'), '23/11/2026');
  assert.strictEqual(formatDue(null), '');
  assert.strictEqual(formatDue('n/importe'), 'n/importe');
});

await atest('isLate : en retard seulement si échéance passée et non terminée', async () => {
  const today = '2026-11-16';
  assert.ok(isLate(t({ due: '2026-11-15', status: 'En cours' }), today));
  assert.ok(!isLate(t({ due: '2026-11-15', status: 'Terminé' }), today));
  assert.ok(!isLate(t({ due: '2026-11-17', status: 'En cours' }), today));
  assert.ok(!isLate(t({ due: null, status: 'En cours' }), today));
});

console.log(fails.length ? `\n${fails.length} ÉCHEC(S)` : `\n${ok} test(s) ok, 0 échec(s)`);
process.exitCode = fails.length ? 1 : 0;
