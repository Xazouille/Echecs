# Coup par Coup

Analyse tes parties Chess.com avec Stockfish 19. Chaque coup est expliqué en français : ce qu'il fait, pourquoi il perd, quelle tactique a été manquée et si elle était à la portée du joueur.

## Lancer le site

1. Double-clique sur `Lancer.bat`.
2. Le navigateur s'ouvre sur http://localhost:8765. Laisse la fenêtre noire ouverte pendant que tu utilises le site.
3. Entre ton pseudo Chess.com, choisis une partie, puis clique sur « Analyser ».

Aucune installation n'est nécessaire : le serveur est un script PowerShell, déjà présent sur Windows. Il faut une connexion internet pour récupérer les parties sur Chess.com.

## Ce que fait l'analyse

- **Classement des coups**, comme sur Chess.com : brillant, très bon coup, meilleur coup, excellent, bon, théorique, imprécision, erreur, occasion manquée, gaffe.
- **Seuils selon le niveau** : la perte tolérée change selon le niveau du joueur. Il est détecté depuis l'Elo de la partie, ou tu peux le choisir.
- **Explications détaillées** pour chaque coup : menaces créées, fourchettes, clouages, enfilades, attaques à la découverte, pièces laissées en prise, sacrifices.
- **Tactiques manquées**, avec la suite gagnante et une difficulté estimée en Elo, comparée au niveau du joueur.
- **Options du moteur** : les 3 meilleurs coups, chacun avec son idée en une phrase.
- **Bilan** : précision (calée sur celle de Chess.com), performance estimée, précision par phase, moments clés et conseils pour progresser.
- **Exploration** : fais glisser une pièce (ou clique dessus, puis sur la case d'arrivée) pour tester ton propre coup. Il est analysé et expliqué comme les coups de la partie. Pour une promotion, tu choisis la pièce.
- **Échiquier** : pièces animées et sons (coup, capture, roque, échec), à couper avec la case « Sons » sous l'échiquier.
- **Commentaires variés** : chaque type de phrase existe en plusieurs tournures, pour éviter les répétitions d'un coup à l'autre.

Les coups décisifs sont revérifiés plus profondément à la fin de l'analyse.

## Structure

- `server.ps1` : serveur local, qui sert uniquement les fichiers du site (le navigateur interroge lui-même l'API publique de Chess.com)
- `public/js/explain.js` : reconnaissance des motifs tactiques
- `public/js/analysis.js` : classement des coups, précision, bilan
- `public/js/commentary.js` : rédaction des commentaires
- `public/vendor/` : Stockfish 19 (GPLv3, version complète de 99 Mo), chess.js, pièces « cburnett »
- `calage/` : données utilisées pour caler la précision sur celle de Chess.com
