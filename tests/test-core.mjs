import assert from 'node:assert/strict';
import { QUEUED, sortTasks, filterTasks, groupByPriority, summary, nextAction, formatDue, isLate, isSafeUrl, isClosed, requestFreshSnapshot, AI_PILOTS, myDecisions, awaitingGreenLight, onYou, totalMinutes, actionsFor, closedTasks } from '../core.js';

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
  note: null,
  expected: o.expected ?? null,
  timeMin: o.timeMin ?? null,
  blocking: o.blocking ?? false
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

await atest('groupByPriority : exclut les tâches closes et trie chaque groupe', async () => {
  const groups = groupByPriority([
    t({ title: 'fait', status: 'Terminé', priority: 'Haute' }),
    t({ title: 'validée', status: 'Validé', priority: 'Haute' }),
    t({ title: 'P2', priority: 'Basse', status: 'À traiter' }),
    t({ title: 'P0', priority: 'Haute', status: 'En cours' })
  ]);
  assert.strictEqual(Object.keys(groups).length, 3);
  assert.ok(groups.Haute.length === 1 && groups.Haute[0].title === 'P0');
  assert.ok(groups.Basse.length === 1);
  assert.ok(!JSON.stringify(groups).includes('fait'));
  assert.ok(!JSON.stringify(groups).includes('validée'));
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

await atest('isLate : en retard seulement si échéance passée et non close', async () => {
  const today = '2026-11-16';
  assert.ok(isLate(t({ due: '2026-11-15', status: 'En cours' }), today));
  assert.ok(!isLate(t({ due: '2026-11-15', status: 'Terminé' }), today));
  assert.ok(!isLate(t({ due: '2026-11-15', status: 'Validé' }), today));
  assert.ok(!isLate(t({ due: '2026-11-17', status: 'En cours' }), today));
  assert.ok(!isLate(t({ due: null, status: 'En cours' }), today));
});

await atest('isSafeUrl : accepte http/https, refuse tout le reste', async () => {
  assert.ok(isSafeUrl('https://app.notion.com/p/abc'));
  assert.ok(isSafeUrl('http://example.com/x?y=1'));
  assert.ok(!isSafeUrl('javascript:alert(1)'), 'javascript: refusé');
  assert.ok(!isSafeUrl('data:text/html,<b>'), 'data: refusé');
  assert.ok(!isSafeUrl('notion://page/abc'), 'schéma natif refusé');
  assert.ok(!isSafeUrl(''), 'chaîne vide refusée');
  assert.ok(!isSafeUrl(null), 'null refusé');
  assert.ok(!isSafeUrl('pas une url'), 'texte libre refusé');
});

await atest('décisions validées et rejetées distinctes des tâches terminées', () => {
  const tasks = ['Validé', 'Terminé', 'Rejeté'].map(status => t({ status, due: '2026-11-01' }));
  assert.equal(summary(tasks).done, 1);
  assert.equal(summary(tasks).approved, 1);
  assert.equal(summary(tasks).rejected, 1);
  assert.equal(Object.values(groupByPriority(tasks)).flat().length, 0);
  assert.ok(tasks.every(task => !isLate(task, '2026-11-16')));
});
await atest('actualisation : un dispatch et une génération strictement plus récente', async () => {
  const events = [];
  const snapshots = ['2026-11-16T00:00:00Z', '2026-11-16T00:00:00Z', '2026-11-16T00:00:01Z'];
  const fresh = await requestFreshSnapshot({
    dispatch: async name => events.push(name),
    fetchSnapshot: async () => ({ generated_at: snapshots.shift() }),
    sleep: async () => {},
    pollMs: 1,
    timeout: 100
  });
  assert.deepEqual(events, ['qg-sync']);
  assert.equal(fresh.generated_at, '2026-11-16T00:00:01Z');
});
await atest('actualisation : aucun faux succès à expiration', async () => {
  await assert.rejects(requestFreshSnapshot({
    dispatch: async () => {},
    fetchSnapshot: async () => ({ generated_at: '2026-11-16T00:00:00Z' }),
    sleep: async () => {},
    pollMs: 1,
    timeout: 0
  }), /Aucun snapshot/);
});

// ---- Onglet « Moi » ----
await atest('Moi : décisions de Ti Tar séparées du feu vert IA', () => {
  const tasks = [
    t({ title: 'Règles d\u2019arrêt', status: QUEUED, owner: 'Ti Tar' }),
    t({ title: 'Décision non attribuée', status: QUEUED, owner: 'Non attribué' }),
    t({ title: 'Sprint de Vibe', status: QUEUED, owner: 'Vibe' }),
    t({ title: 'Sprint de Claude', status: QUEUED, owner: 'Claude' }),
    t({ title: 'Tâche en cours', status: 'En cours', owner: 'Vibe' })
  ];
  assert.deepEqual(myDecisions(tasks).map(x => x.title), ['Règles d\u2019arrêt', 'Décision non attribuée']);
  assert.deepEqual(awaitingGreenLight(tasks).map(x => x.title), ['Sprint de Vibe', 'Sprint de Claude']);
  assert.ok(AI_PILOTS.includes('Python') && AI_PILOTS.includes('ChatGPT'));
});

await atest('Moi : onYou = pilotées par Ti Tar ou bloquantes, jamais closes ni en file', () => {
  const tasks = [
    t({ title: 'Candidatures', owner: 'Ti Tar', status: 'À traiter', timeMin: 25 }),
    t({ title: 'Sécurité numérique', owner: 'ChatGPT', status: 'En cours', blocking: true, timeMin: 15 }),
    t({ title: 'Déjà close', owner: 'Ti Tar', status: 'Terminé', blocking: true }),
    t({ title: 'Décision en file', owner: 'Ti Tar', status: QUEUED }),
    t({ title: 'Normale IA', owner: 'Vibe', status: 'À traiter' })
  ];
  const mine = onYou(tasks);
  assert.deepEqual(mine.map(x => x.title), ['Sécurité numérique', 'Candidatures']); // En cours avant À traiter
  assert.equal(totalMinutes(mine), 40);
});

await atest('totalMinutes : ignore les valeurs non numériques et les absentes', () => {
  assert.equal(totalMinutes([t({ timeMin: 10 }), t({ timeMin: 5 }), t({}), t({ timeMin: null })]), 15);
  assert.equal(totalMinutes([]), 0);
});

// ---- Boutons selon le statut ----
await atest('actionsFor : la file décide, les closes s\u2019annulent, le reste se termine', () => {
  const queued = actionsFor(t({ status: QUEUED }));
  assert.deepEqual(queued, { validate: true, reject: true, postpone: true, finish: false, undo: false });
  for (const status of ['Terminé', 'Validé', 'Rejeté']) {
    assert.deepEqual(actionsFor(t({ status })), { validate: false, reject: false, postpone: false, finish: false, undo: true }, `close ${status}`);
  }
  for (const status of ['À traiter', 'En cours', 'Bloqué']) {
    assert.deepEqual(actionsFor(t({ status })), { validate: false, reject: false, postpone: false, finish: true, undo: false }, `ouverte ${status}`);
  }
});

await atest('closedTasks : uniquement les closes, Terminé puis Validé puis Rejeté', () => {
  const tasks = [
    t({ title: 'Rejetée', status: 'Rejeté', priority: 'Haute' }),
    t({ title: 'À traiter', status: 'À traiter' }),
    t({ title: 'Validée', status: 'Validé' }),
    t({ title: 'Terminée B', status: 'Terminé', priority: 'Basse' }),
    t({ title: 'Terminée A', status: 'Terminé', priority: 'Haute' })
  ];
  assert.deepEqual(closedTasks(tasks).map(x => x.title), ['Terminée A', 'Terminée B', 'Validée', 'Rejetée']);
  assert.deepEqual(closedTasks([tasks[1]]), []);
});
console.log(fails.length ? `\n${fails.length} ÉCHEC(S)` : `\n${ok} test(s) ok, 0 échec(s)`);
process.exitCode = fails.length ? 1 : 0;
