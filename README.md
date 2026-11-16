# QG Pilote v2

Vue mobile sur un registre de tâches Notion, avec actions en un clic qui écrivent **dans Notion**.

**Ce dépôt est public et ne contient aucune donnée personnelle.** Les tâches vivent dans le dépôt privé `qg-pilote-data` et ne transitent que du navigateur de l'utilisateur vers `api.github.com`, avec son token local.

## Architecture (2 dépôts, zéro serveur à gérer)

```
[Notion : base de tâches]
        │  (API Notion 2025-09-03, jeton d'accès personnel en secret GitHub)
[qg-pilote-data (privé)]
   ├─ Action "sync" : Notion → snapshot.json (chaque heure + bouton ⟳ + à la demande)
   └─ Actions validate / reject / postpone / finish / undo : dispatch depuis le site → patch Notion → snapshot
        │  (api.github.com + token fine-grained local au navigateur)
[QG Pilote v2 (public, GitHub Pages)]  ← ce dépôt : lecture + boutons d'action
```

- **Lecture** : le site appelle l'API GitHub Contents sur `snapshot.json` avec le token local (localStorage). Rien n'est public.
- **Écriture** : chaque bouton envoie un `repository_dispatch` ; une Action GitHub vérifie le statut Notion, écrit, ajoute une trace datée, régénère le snapshot. Latence typique : 30 s à 2 min.
- **Sans token** : le site reste en lecture du dernier snapshot en cache.

## Traiter ses tâches (le plus simple possible)

- **File / Moi — décision en file** : zone de texte facultative (ta réponse, ajoutée à la fiche Notion) + calendrier pour reporter. Trois boutons : **Valider** (→ Validé, case cochée), **Ne pas valider** (→ Rejeté), **Reporter à plus tard** (échéance déplacée, la décision reste en file).
- **Tâche ouverte** : **Terminer** (→ Terminé, avec réponse facultative).
- **Erreur de clic ?** Onglet **Terminées** : toutes les fiches closes (Terminé, Validé, Rejeté) avec bouton **Annuler** qui rouvre la fiche (retour au statut précédent mémorisé dans la trace, sinon retour en file pour les décisions).

Chaque action refuse sans écriture si le statut Notion a changé entre-temps : rien n'est écrasé en aveugle.

## Réglages à faire une seule fois (propriétaire du compte GitHub)

1. **Pages** : dépôt `qg-pilote` → Settings → Pages → Source : **GitHub Actions**.
2. **Token GitHub** : github.com/settings/personal-access-tokens → Generate new token → Repository access : seulement `qg-pilote-data` → Permissions : **Contents → Read and write**. Puis dans le site, onglet Réglages → coller le token → Tester.
3. **Côté Notion** (dépôt data) : secret `NOTION_TOKEN` = **jeton d'accès personnel Notion** (app.notion.com/developers → Jetons d'accès personnels). Il agit avec les droits de son créateur : aucune connexion de base à configurer. Détails dans le README de `qg-pilote-data`.

## Développement

- `node tests/test-core.mjs` : tests de la logique pure (`core.js`).
- `node --check app.js` / `node --check core.js` : syntaxe.
- CI GitHub Actions à chaque push/PR (`ci.yml`), déploiement Pages sur `main` (`pages.yml`).
- Aucune dépendance, aucun build : HTML + CSS + ES modules natifs.

## Revue

Tout changement passe par une branche `vibe/*` → PR → CI verte → merge. Les revues sont bienvenues : problèmes observés, plus petit changement utile, test correspondant.

## Choix assumés

- **Latence des actions** (30 s à 2 min) : acceptable pour quelques décisions/jour ; c'est le prix du plan GitHub gratuit (pas de Worker 24/7).
- **Token dans le navigateur** : scope minimal (un seul dépôt data, Contents R/W), stockage localStorage, transmission limitée à `api.github.com`. Vol de téléphone = accès à ce seul dépôt, pas au reste.
- **Snapshot horaire** : le bouton ⟳ déclenche une synchro immédiate via `repository_dispatch` (`qg-sync`) puis attend le nouveau snapshot (max 3 min).
- **Sécurité des liens** : seules les URL `http(s)` sont cliquables (`isSafeUrl`), toutes les données Notion sont échappées avant rendu.
- **Réponses textes limitées à 200 caractères** : contrainte du payload `repository_dispatch` ; le texte va dans la fiche Notion, jamais dans le dépôt Git.

## Changelog

- 16/11/2026 (v2.2) : boutons Ne pas valider / Reporter à plus tard (calendrier), zone de texte pour répondre, bouton Annuler + onglet Terminées, statuts Validé/Rejeté distincts de Terminé, onglet Moi (décisions, feu vert IA, tâches bloquantes avec temps estimé), bouton Terminer.
- 16/11/2026 : correctif bouton ⟳ (déclenche vraiment `qg-sync`, avant il ne faisait que relire le cache), échappement systématique des dates, liens `source` filtrés par schéma, message d'échec de validation explicite (refus si statut ≠ « À valider Ti Tar »).
