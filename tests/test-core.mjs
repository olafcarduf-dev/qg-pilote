import assert from 'node:assert/strict';
import { QUEUED, sortTasks, filterTasks, groupByPriority, summary, nextAction, formatDue, relativeDue, isLate, isSafeUrl, isClosed, isArchived, archivedTasks, requestFreshSnapshot, AI_PILOTS, myDecisions, awaitingGreenLight, onYou, totalMinutes, actionsFor, closedTasks, postponedDecisions, ownerStats, csvEscape, toCsv, queueCount, myCount, closedCount } from '../core.js';

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
  note: o.note ?? null,
  expected: o.expected ?? null,
  answerKind: o.answerKind ?? null,
  answerText: o.answerText ?? null,
  answerDate: o.answerDate ?? null,
  timeMin: o.timeMin ?? null,
  blocking: o.blocking ?? false,
  postponed: o.postponed ?? false,
  archived: o.archived ?? false
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

await atest('filtre : la recherche atteint aussi la suite et l\u2019action attendue', async () => {
  const tasks = [
    t({ title: 'Décision RH', note: 'Sonder Anna sur le contrat.' }),
    t({ title: 'Tâche muette', expected: 'Répondre par oui ou non.' })
  ];
  assert.strictEqual(filterTasks(tasks, { q: 'anna' }).length, 1);
  assert.strictEqual(filterTasks(tasks, { q: 'oui ou non' }).length, 1);
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
    t({ title: 'Décision reportée', status: QUEUED, owner: 'Ti Tar', postponed: true }),
    t({ title: 'Feu vert reporté', status: QUEUED, owner: 'Vibe', postponed: true }),
    t({ title: 'Tâche en cours', status: 'En cours', owner: 'Vibe' })
  ];
  assert.deepEqual(myDecisions(tasks).map(x => x.title), ['Règles d\u2019arrêt', 'Décision non attribuée']);
  assert.deepEqual(awaitingGreenLight(tasks).map(x => x.title), ['Sprint de Vibe', 'Sprint de Claude']);
  assert.ok(AI_PILOTS.includes('Python') && AI_PILOTS.includes('ChatGPT'));
});

await atest('reportées : postponedDecisions isole les décisions reportées, nextAction les ignore', () => {
  const tasks = [
    t({ id: 'p1', title: 'Reportée P1', status: QUEUED, owner: 'Ti Tar', postponed: true, priority: 'Haute' }),
    t({ id: 'p2', title: 'Reportée basse', status: QUEUED, owner: 'Ti Tar', postponed: true }),
    t({ id: 'q1', title: 'En file normale', status: QUEUED, owner: 'Ti Tar', priority: 'Basse' }),
    t({ id: 'x1', title: 'Pas une décision', status: 'En cours', postponed: true })
  ];
  assert.deepEqual(postponedDecisions(tasks).map(x => x.id), ['p1', 'p2']);
  assert.strictEqual(nextAction(tasks).id, 'q1', 'la prochaine action vient de la file non reportée');
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
  assert.deepEqual(queued, { validate: true, reject: true, postpone: true, unpostpone: false, finish: false, undo: false, edit: true, archive: true, restore: false });
  assert.strictEqual(actionsFor(t({ status: QUEUED, postponed: true })).unpostpone, true, 'une décision reportée se remet en file');
  for (const status of ['Terminé', 'Validé', 'Rejeté']) {
    assert.deepEqual(actionsFor(t({ status })), { validate: false, reject: false, postpone: false, unpostpone: false, finish: false, undo: true, edit: true, archive: true, restore: false }, `close ${status}`);
  }
  for (const status of ['À traiter', 'En cours', 'Bloqué']) {
    assert.deepEqual(actionsFor(t({ status })), { validate: false, reject: false, postpone: false, unpostpone: false, finish: true, undo: false, edit: true, archive: true, restore: false }, `ouverte ${status}`);
  }
});

await atest('isArchived : détection de la suppression (case « Archivée QG »)', () => {
  assert.ok(isArchived(t({ archived: true })));
  assert.ok(!isArchived(t({})));
  assert.ok(!isArchived(t({ archived: 'true' })), 'seul le booléen vrai archive (le snapshot mappe la case cochée en true)');
  assert.ok(!isArchived(null));
});

await atest('archivées : absentes de toutes les vues actives', () => {
  const tasks = [
    t({ id: 'a1', title: 'En cours gardée', status: 'En cours', priority: 'Haute' }),
    t({ id: 'a2', title: 'Archivée en cours', status: 'En cours', archived: true }),
    t({ id: 'a3', title: 'Archivée en file', status: QUEUED, archived: true, priority: 'Haute' }),
    t({ id: 'a4', title: 'File gardée', status: QUEUED }),
    t({ id: 'a5', title: 'Terminée archivée', status: 'Terminé', archived: true })
  ];
  assert.ok(!filterTasks(tasks, {}).some(isArchived), 'aucune archivée dans l’onglet Tâches, filtres ou non');
  assert.ok(!groupByPriority(tasks).Haute.some(isArchived), 'aucune archivée dans les groupes de priorité');
  assert.ok(!nextAction(tasks) || nextAction(tasks).id !== 'a3', 'l’archivée en file P0 ne devient pas prochaine action');
  assert.ok(!myDecisions([...tasks, t({ id: 'a6', status: QUEUED, owner: 'Ti Tar', archived: true })]).some(isArchived));
  assert.ok(!awaitingGreenLight(tasks).some(isArchived));
  assert.ok(!postponedDecisions([...tasks, t({ id: 'a7', status: QUEUED, postponed: true, archived: true })]).some(isArchived));
  assert.ok(!onYou([...tasks, t({ id: 'a8', owner: 'Ti Tar', archived: true })]).some(isArchived));
  assert.ok(!closedTasks(tasks).some(isArchived), 'une close archivée quitte la liste Terminées (elle est dans Supprimées)');
  assert.ok(!ownerStats(tasks).length || !JSON.stringify(ownerStats(tasks)).includes('a2'), 'aucune archivée dans la charge par pilote');
  const s = summary(tasks);
  assert.strictEqual(s.inProgress, 1, 'le résumé ne compte que l’en cours non archivée');
  assert.strictEqual(s.total, 5, 'le total brut reste informatif');
});

await atest('archivedTasks : la section Supprimées liste les archivées, triées', () => {
  const tasks = [
    t({ id: 's2', title: 'Archivée Basse', archived: true, priority: 'Basse' }),
    t({ id: 's1', title: 'Archivée Haute', archived: true, priority: 'Haute' }),
    t({ id: 's3', title: 'Vivante', status: 'En cours' })
  ];
  const arch = archivedTasks(tasks);
  assert.strictEqual(arch.length, 2);
  assert.strictEqual(arch[0].id, 's1', 'la Haute passe avant la Basse');
  assert.ok(arch.every(isArchived));
  assert.strictEqual(archivedTasks([]).length, 0);
});

await atest('actionsFor : une archivée se restaure, ne se supprime pas deux fois', () => {
  assert.deepEqual(actionsFor(t({ archived: true })), { validate: false, reject: false, postpone: false, unpostpone: false, finish: false, undo: false, edit: true, archive: false, restore: true });
  const closed = actionsFor(t({ status: 'Terminé', archived: true }));
  assert.strictEqual(closed.undo, false, 'une close archivée ne s’annule plus depuis Supprimées');
  assert.strictEqual(closed.restore, true);
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

await atest('ownerStats : charge ouverte par pilote, hors file et closes, triée par charge', () => {
  const tasks = [
    t({ title: 'A1', status: 'En cours', owner: 'Vibe', priority: 'Haute', timeMin: 20 }),
    t({ title: 'A2', status: 'À traiter', owner: 'Vibe', timeMin: 10 }),
    t({ title: 'B1', status: 'En cours', owner: 'Ti Tar' }),
    t({ title: 'Q1', status: QUEUED, owner: 'Vibe' }),
    t({ title: 'C1', status: 'Terminé', owner: 'Vibe' })
  ];
  const stats = ownerStats(tasks);
  assert.strictEqual(stats.length, 2, 'file et closes ignorées');
  assert.strictEqual(stats[0].owner, 'Vibe');
  assert.strictEqual(stats[0].open, 2);
  assert.strictEqual(stats[0].high, 1);
  assert.strictEqual(stats[0].minutes, 30);
  assert.strictEqual(stats[1].owner, 'Ti Tar');
  assert.strictEqual(stats[1].minutes, 0);
  assert.deepEqual(ownerStats([]), []);
});

// ---- Export CSV ----
await atest('csvEscape : guillemets doublés, points-virgules quotés, sauts de ligne aplatis', () => {
  assert.strictEqual(csvEscape('simple'), 'simple');
  assert.strictEqual(csvEscape('avec "guillemets"'), '"avec ""guillemets"""');
  assert.strictEqual(csvEscape('a;b'), '"a;b"');
  assert.strictEqual(csvEscape('ligne\nsautée'), 'ligne sautée');
  assert.strictEqual(csvEscape(null), '');
  assert.strictEqual(csvEscape(5), '5');
});

await atest('toCsv : en-tête + une ligne par tâche, dates en JJ/MM/AAAA, filtres appliqués par l’appelant', () => {
  const csv = toCsv([
    t({ title: 'Valider les règles', status: QUEUED, owner: 'Ti Tar', due: '2026-11-23', blocking: true, timeMin: 5, answerDate: '2026-11-20' }),
    t({ title: 'Doc', expected: 'Relire;' })
  ]);
  const lines = csv.split('\r\n');
  assert.strictEqual(lines.length, 3);
  assert.ok(lines[0].startsWith('Tâche;Statut;Pilote;Priorité;Type;Échéance;'));
  assert.ok(lines[1].startsWith('Valider les règles;En attente de validation;Ti Tar;'));
  assert.ok(lines[1].includes(';23/11/2026;'));
  assert.ok(lines[1].includes('20/11/2026'));
  assert.ok(lines[1].includes('5;oui;'));
  assert.ok(lines[2].endsWith('"Relire;"'), 'le point-virgule du contenu est quoté');
  assert.strictEqual(toCsv([]), 'Tâche;Statut;Pilote;Priorité;Type;Échéance;Réponse attendue;Réponse de Ti Tar;Date de réponse;Temps estimé (min);Bloque la suite;Action attendue');
});
// ---- Suivi : compteurs de navigation et échéances relatives ----
await atest('queueCount : file actionnable (non reportée, non archivée)', () => {
  assert.strictEqual(queueCount([
    t({ status: QUEUED }),
    t({ status: QUEUED, postponed: true }),
    t({ status: QUEUED, archived: true }),
    t({ status: 'En cours' })
  ]), 1);
});

await atest('myCount : décisions à prendre + tâches réservées à Ti Tar (feu vert IA exclu)', () => {
  assert.strictEqual(myCount([
    t({ status: QUEUED, owner: 'Ti Tar' }),
    t({ status: QUEUED, owner: 'Vibe' }),
    t({ status: 'En cours', owner: 'Ti Tar' }),
    t({ status: 'Bloqué', owner: 'Vibe', blocking: true }),
    t({ status: 'Terminé' })
  ]), 3);
});

await atest('closedCount : fiches closes + archivées (badge Terminées)', () => {
  assert.strictEqual(closedCount([
    t({ status: 'Terminé' }),
    t({ status: 'Validé' }),
    t({ status: 'Rejeté', archived: true }),
    t({ status: QUEUED })
  ]), 3);
});

await atest('relativeDue : aujourd’hui, demain, hier, dans N j, il y a N j, dates invalides', () => {
  const today = '2026-11-16';
  assert.strictEqual(relativeDue('', today), '');
  assert.strictEqual(relativeDue(null, today), '');
  assert.strictEqual(relativeDue('2026-11-16', today), 'aujourd’hui');
  assert.strictEqual(relativeDue('2026-11-17', today), 'demain');
  assert.strictEqual(relativeDue('2026-11-15', today), 'hier');
  assert.strictEqual(relativeDue('2026-11-19', today), 'dans 3 j');
  assert.strictEqual(relativeDue('2026-11-10', today), 'il y a 6 j');
  assert.strictEqual(relativeDue('pas-une-date', today), '');
  assert.strictEqual(relativeDue('2026-11-16T10:00:00Z', today), 'aujourd’hui');
});

console.log(fails.length ? `\n${fails.length} ÉCHEC(S)` : `\n${ok} test(s) ok, 0 échec(s)`);
process.exitCode = fails.length ? 1 : 0;
