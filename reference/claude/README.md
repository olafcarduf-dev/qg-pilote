# QG Pilote Direct (version Claude)

Page unique (index.html, aucune dépendance de build) qui lit la base Notion « QG — Tâches & Décisions » et écrit les décisions de Ti Tar.

- Lecture : outil Notion `notion-query-data-sources` en mode `view` (vue « Default view », view://0acf1f9c-91b6-48cb-a0c5-d3f753716f5e). Le mode SQL est limité par un quota Notion, ne pas y revenir.
- Écriture : `notion-update-page` (update_properties puis insert_content pour la ligne datée), relecture après chaque écriture.
- Colonnes utilisées : Statut, Validation utilisateur, Intervention QG, Temps Ti Tar (min), Bloque la suite, Action attendue de Ti Tar, Réponse attendue QG, Réponse Ti Tar QG, Date renseignée QG, Reportée QG.
- Onglets : À décider (décisions, autorisations IA, reportées), À faire (actions de Ti Tar, temps estimé), Tâches, Résumé.
- Hébergement actuel : artifact Claude privé. Les appels Notion passent par `window.claude.use('mcp')`, disponible seulement dans Claude ; hors de Claude il faut un Worker authentifié (jeton côté serveur).
