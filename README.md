# Coup par Coup

Analyse tes parties Chess.com avec Stockfish 19. Chaque coup est expliqué en français : ce qu'il fait, pourquoi il perd, quelle tactique a été manquée et si elle était à la portée du joueur.

## Utiliser le site en ligne

**https://xazouille.github.io/Echecs/**

Au premier passage, le navigateur télécharge le moteur complet (environ 80 Mo) : la première analyse démarre donc plus lentement, ensuite il reste en mémoire.

Entre ton pseudo Chess.com, choisis une partie, puis clique sur « Analyser ». L'analyse tourne dans ton navigateur : rien n'est envoyé ailleurs qu'à l'API publique de Chess.com pour récupérer tes parties.

## Ce que fait l'analyse

- **Classement des coups**, comme sur Chess.com : brillant, très bon coup, meilleur coup, excellent, bon, théorique, imprécision, erreur, occasion manquée, gaffe.
- **Seuils selon le niveau** : la perte tolérée change selon le niveau du joueur. Il est détecté depuis l'Elo de la partie, ou tu peux le choisir.
- **Explications détaillées** pour chaque coup : menaces créées, fourchettes, clouages, enfilades, attaques à la découverte, pièces laissées en prise, sacrifices.
- **Tactiques manquées**, avec la suite gagnante et une difficulté estimée en Elo, comparée au niveau du joueur.
- **Options du moteur** : les 3 meilleurs coups, chacun avec son idée en une phrase.
- **Bilan** : précision, performance estimée, précision par phase, moments clés et conseils pour progresser.
- **Exploration** : clique sur une pièce pour tester ton propre coup. Il est analysé et expliqué comme les coups de la partie.

Trois niveaux d'analyse :
- **Rapide** : profondeur 12, les moments clés étant revérifiés à 16 ;
- **Standard** : profondeur 15 ;
- **Approfondie** : profondeur 17, avec un premier aperçu à 14 affiché en attendant.

L'analyse utilise jusqu'à 4 cœurs du processeur. Les positions déjà analysées sont gardées dans le navigateur, et les ouvertures les plus jouées sont fournies déjà calculées (`data/ouvertures.json`) : elles ne sont jamais recalculées.

## Lancer le site sur son ordinateur (sans internet pour le site lui-même)

### Windows
1. Si tu as téléchargé un `.zip`, fais d'abord un clic droit dessus → « Extraire tout… ».
2. Double-clique sur `Lancer.bat`. Si Windows demande confirmation, réponds Oui (ou « Informations complémentaires » → « Exécuter quand même »).
3. Le navigateur s'ouvre sur http://localhost:8765. Laisse la fenêtre noire ouverte pendant que tu utilises le site.

### Mac
1. Si tu as téléchargé un `.zip`, double-clique dessus pour l'extraire.
2. Ouvre l'app **Terminal**, tape `sh ` (avec un espace), glisse le fichier `Lancer-Mac.command` dans la fenêtre, puis appuie sur Entrée.
3. Le navigateur s'ouvre sur http://localhost:8765. Laisse le Terminal ouvert pendant que tu utilises le site.

Aucune installation n'est nécessaire : le serveur local est un script PowerShell sur Windows et un script Perl sur Mac, tous deux fournis avec le système. Une connexion internet reste nécessaire pour récupérer les parties sur Chess.com.

## Structure

- `docs/` : le site (c'est ce dossier que GitHub Pages publie)
  - `js/explain.js` : reconnaissance des motifs tactiques
  - `js/analysis.js` : classement des coups, précision, bilan
  - `js/commentary.js` : rédaction des commentaires
  - `js/engine.js` : pilote de Stockfish (plusieurs moteurs en parallèle)
  - `data/ouvertures.json` : évaluations précalculées des ouvertures les plus jouées
  - `vendor/` : Stockfish 19 (complet, et lite en secours), chess.js, pièces « cburnett »
- `server.ps1` / `Lancer.bat` : serveur local Windows
- `serveur-mac.pl` / `Lancer-Mac.command` : serveur local Mac
- `NOTES-DEV.md` : notes de développement détaillées

## Crédits et licences

- [Stockfish](https://stockfishchess.org) 19, version WebAssembly [stockfish.js](https://github.com/nmrugg/stockfish.js) : GPLv3 (texte complet dans `docs/vendor/stockfish/Copying.txt`)
- [chess.js](https://github.com/jhlywa/chess.js) 1.4.0 : licence BSD-2-Clause
- Pièces « cburnett » de Colin M.L. Burnett, via [chessground](https://github.com/lichess-org/chessground) : GPLv2+
- Données des parties : [API publique de Chess.com](https://www.chess.com/news/view/published-data-api)
