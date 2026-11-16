# QG Pilote v2

Vue mobile sur un registre de tâches Notion, avec validation en un clic qui écrit **dans Notion**.

**Ce dépôt est public et ne contient aucune donnée personnelle.** Les tâches vivent dans le dépôt privé `qg-pilote-data` et ne transitent que du navigateur de l'utilisateur vers `api.github.com`, avec son token local.

## Architecture (2 dépôts, zéro serveur à gérer)

```
[Notion : base de tâches]
        │  (API Notion, token en secret GitHub)
[qg-pilote-data (privé)]
   ├─ Action "sync" : Notion → snapshot.json (chaque heure + à la demande)
   └─ Action "validate" : repository_dispatch depuis le site → patch Notion → snapshot
        │  (api.github.com + token fine-grained local au navigateur)
[QG Pilote v2 (public, GitHub Pages)]  ← ce dépôt : lecture + bouton Valider
```

- **Lecture** : le site appelle l'API GitHub Contents sur `snapshot.json` avec le token local (localStorage). Rien n'est public.
- **Écriture** : le bouton Valider envoie un `repository_dispatch` ; une Action GitHub vérifie le statut Notion (« À valider »), passe à Validé, coche la case de validation, ajoute la trace datée, régénère le snapshot. Latence typique : 30 s à 2 min.
- **Sans token** : le site reste en lecture du dernier snapshot en cache.

## Réglages à faire une seule fois (propriétaire du compte GitHub)

1. **Pages** : dépôt `qg-pilote` → Settings → Pages → Source : **GitHub Actions**.
2. **Token GitHub** : github.com/settings/personal-access-tokens → Generate new token → Repository access : seulement `qg-pilote-data` → Permissions : **Contents → Read and write**. Puis dans le site, onglet Réglages → coller le token → Tester.
3. **Côté Notion** (dépôt data) : voir le README de `qg-pilote-data` (intégration + secret `NOTION_TOKEN`).

## Développement

- `node tests/test-core.mjs` : tests de la logique pure (`core.js`).
- `node --check app.js` / `node --check core.js` : syntaxe.
- CI GitHub Actions à chaque push/PR (`ci.yml`), déploiement Pages sur `main` (`pages.yml`).
- Aucune dépendance, aucun build : HTML + CSS + ES modules natifs.

## Revue

Tout changement passe par une branche `vibe/*` → PR → CI verte → merge. Les revues sont bienvenues : problèmes observés, plus petit changement utile, test correspondant.

## Choix assumés

- **Latence de validation** (30 s à 2 min) : acceptable pour quelques validations/jour ; c'est le prix du plan GitHub gratuit (pas de Worker 24/7).
- **Token dans le navigateur** : scope minimal (un seul dépôt data, Contents R/W), stockage localStorage, transmission limitée à `api.github.com`. Vol de téléphone = accès à ce seul dépôt, pas au reste.
- **Snapshot horaire** : le bouton ⟳ force une synchro immédiate via `repository_dispatch` (`qg-sync`).
