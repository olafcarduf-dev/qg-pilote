# Version ChatGPT de QG Pilote (démonstration publique)

Ces fichiers (`index.html`, `style.css`, `app.js`) sont la copie exacte de la démo interactive écrite par ChatGPT, conservée dans le dépôt privé `qg-multiagents` (dossier `sites/qg-pilote/demo/`). Seules deux adaptations de déploiement ont été faites ici :

1. **Chemins relatifs** : `style.css` et `app.js` sont référencés en relatif (la démo d'origine pointe vers `/style.css` et `/app.js`, valides à la racine d'un domaine seulement).
2. **Lien vers le QG réel** : le bandeau de démo pointe vers le site principal.

Pourquoi cette copie ici : `qg-multiagents` est un dépôt **privé**, et GitHub Pages refuse de publier un site depuis un dépôt privé sur un compte gratuit (« Upgrade or make this repository public »). Le workflow Pages poussé en v2.5 dans ce dépôt ne pouvait donc jamais aboutir. La démo est servie par le workflow Pages du présent dépôt public, qui copie tout `reference/` dans le site publié.

**URL publique** : https://olafcarduf-dev.github.io/qg-pilote/reference/chatgpt/

## Règle d'or

Cette démo tourne sur **données fictives** intégrées dans `app.js` (aucun appel réseau, aucune donnée perso). C'est la condition pour la servir depuis un dépôt public : les vraies tâches de Ti Tar ne vivent que dans Notion et dans le snapshot du dépôt privé `qg-pilote-data`. Ne jamais copier de vraies fiches ici.

## Différence avec le site principal

La démo simule la coordination multi-IA en mémoire navigateur (les changements durent le temps de la visite). Le site principal lit le snapshot GitHub du dépôt data et écrit dans Notion via GitHub Actions (valider, refuser, reporter, répondre, et depuis la v2.6 : ajouter, modifier, archiver/restaurer).
