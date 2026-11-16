# Version Claude de QG Pilote Direct (référence)

`index.html` et `README.md` sont la version du site QG écrite par Claude, déposée par Ti Tar le 16/11/2026. Ils sont conservés **tels quels** dans la logique et le style ; une exception documentée ci-dessous a été ajoutée le 16/11/2026 (v2.6).

## Mode lecture (ajout v2.6, seule modification)

Hors d'une session Claude, `window.claude.use('mcp')` n'existe pas : la page affichait « Lecture impossible » avec toutes les sections vides. Depuis la v2.6, sans session Claude, la page passe en **mode lecture** : elle récupère `snapshot.json` du dépôt data via l'API GitHub avec le token déjà saisi dans les Réglages du site principal (même origine GitHub Pages, clé locale `qg2-token`), mappe les fiches vers son format interne (`snapTask` : priorités Haute/Normale/Basse → P0/P1/P2, `qgAction` → Intervention, tâches archivées exclues), affiche une bannière « Mode lecture » et désactive les formulaires d'écriture. Avec une session Claude active, rien ne change : lecture et écriture Notion comme avant.

## Pourquoi elle ne remplace pas le site principal

Cette version lit et écrit dans Notion via `window.claude.use('mcp')`, disponible uniquement dans les artifacts Claude. Sur GitHub Pages, l'écriture est impossible (il faudrait un Worker authentifié, jeton Notion côté serveur) : la page s'y affiche en mode lecture (voir ci-dessus). Le site principal (`app.js` + dépôt privé `qg-pilote-data`) écrit déjà dans Notion sans Worker, via GitHub Actions et le token local du navigateur.

## Ce qui en a été repris dans le site principal (v2.4)

- **Réponses structurées** : le texte de réponse part dans la propriété « Réponse Ti Tar QG », la date dans « Date renseignée QG » (en plus de la trace en bas de fiche). La modale pré-remplit les deux depuis le snapshot.
- **Section « Reportées à plus tard »** : les décisions reportées (case « Reportée QG ») sortent de la file principale et s'affichent à part dans l'onglet File, avec un bouton **Remettre dans la file** (dispatch `qg-unpostpone`).
- **Résumé enrichi** : barre de répartition par statut et table « charge ouverte par pilote ».
- **Recherche étendue** : la recherche de l'onglet Tâches atteint aussi la suite et l'action attendue.
- Une fiche validée, rejetée ou terminée ne reste jamais marquée « reportée ».

## Idées connues, non reprises (à décider)

- Valider une autorisation IA la fermerait en « Validé » ; la version Claude la passe en « En cours » pour que l'IA agisse. Changement de sémantique des statuts : décision de Ti Tar.
- Thème clair / sombre automatique : le site principal est sombre par design.
- Anti-doublon côté client (relire la fiche avant d'écrire) : déjà couvert côté backend, qui refuse toute écriture si le statut a changé (zéro écriture, log commité).
