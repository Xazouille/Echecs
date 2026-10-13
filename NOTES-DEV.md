# Coup par Coup — notes de développement

Résumé de la session de création (13 octobre 2026), pour reprendre le développement plus tard, seul ou avec Claude.

---

## 1. Objectif

Un site d'analyse de parties d'échecs dans l'esprit du « Game Review » de Chess.com, avec trois exigences :

1. **Moteur d'échecs** (Stockfish) et **indicateurs de qualité des coups adaptés au niveau** du joueur.
2. **Explications plus détaillées** que Chess.com : tactiques manquées, idée et intérêt potentiel de chaque coup.
3. **Analyse directe à partir d'un pseudo Chess.com** (récupération automatique des parties).

---

## 2. Contraintes découvertes et choix qui en découlent

| Constat | Conséquence |
|---|---|
| Ni Node.js ni Python sur la machine | Serveur écrit en **PowerShell** (`server.ps1`, `HttpListener`), lancé par `Lancer.bat`. Aucune dépendance à installer. |
| Une page « Artifact » claude.ai ne peut pas appeler `api.chess.com` (CSP) | Site **local** plutôt qu'en ligne. |
| La 1re version de `server.ps1` relayait l'API Chess.com. Une fois mise sur Google Drive, Drive l'a signalée « infectée » (faux positif) et l'a retirée du `.zip` téléchargé | `server.ps1` ne sert plus que les fichiers locaux : aucune requête internet. Le **navigateur appelle directement** `https://api.chess.com/pub` (l'API autorise CORS, `Access-Control-Allow-Origin: *`) et charge les avatars depuis `images.chesscomfiles.com`, avec l'initiale en remplacement si l'image échoue. Ne pas remettre de requêtes sortantes dans le script. |
| Stockfish multi-thread exige `SharedArrayBuffer` | Le serveur envoie `COOP: same-origin` et `COEP: credentialless` : la page est isolée, et les images et polices externes restent autorisées. |
| Le Stockfish multi-thread plante dans le navigateur intégré de l'app Claude (`Uncaught [object Event]` au démarrage, sans doute un worker pthread) | **Repli automatique** sur la version mono-thread (`engine.js > init()`). Les workers imbriqués et la mémoire partagée fonctionnent pourtant dans ce navigateur : la cause exacte n'est pas trouvée. Non testé dans Chrome ou Edge. |
| À profondeur 15, Stockfish « lite » rate parfois un mat un coup trop tôt (Opéra de Morphy : 15.Fxd7+ classé « erreur » à tort) | Ajout de la **propagation arrière** (`refine()`) et d'une **passe de vérification** à profondeur +4 sur les coups critiques. |

---

## 3. Arborescence

```
coup-par-coup/
├─ Lancer.bat              Windows : lance server.ps1 (double-clic) ; prévient s'il manque des fichiers (zip non extrait)
├─ server.ps1              Windows : serveur de fichiers local uniquement + en-têtes COOP/COEP, port 8765 (+10 si occupé)
├─ Lancer-Mac.command      macOS : lance serveur-mac.pl (« sh Lancer-Mac.command », ou double-clic après chmod +x)
├─ serveur-mac.pl          macOS : même serveur en Perl (modules standard), 127.0.0.1 uniquement, mêmes en-têtes
├─ README.md               Présentation (affichée par GitHub), utilisation, crédits et licences
├─ NOTES-DEV.md            Ce fichier
└─ docs/                   Le site. Nommé « docs » pour que GitHub Pages puisse le publier tel quel
   ├─ .nojekyll            Fichier vide : indique à GitHub Pages de servir les fichiers sans les transformer
   ├─ index.html           Deux vues : #home (recherche, parties, légende) et #review (échiquier + commentaire)
   ├─ css/style.css        Thème clair/sombre par tokens CSS, responsive (< 980px : une colonne)
   ├─ js/
   │  ├─ app.js            Interface : état global, recherche, liste des parties, navigation, rendu
   │  ├─ engine.js         Pilote UCI de Stockfish dans un Web Worker, file d'attente, priorité, annulation
   │  ├─ analysis.js       Lecture PGN, pipeline d'analyse, classement, précision, bilan
   │  ├─ explain.js        Détection des motifs (faits d'un coup, analyse de variante, difficulté)
   │  ├─ commentary.js     Mise en mots (HTML) du commentaire d'un coup et du bilan
   │  ├─ position.js       Mini-modèle d'échiquier : attaques, SEE, clouages, pions passés
   │  ├─ fr.js             Outils de langue : articles, accords, notation française (C, F, T, D, R)
   │  ├─ openings.js       Petit livre d'ouvertures (~170 lignes, noms français)
   │  ├─ board.js          Échiquier DOM (grille 8×8) + flèches SVG + badge de classement
   │  ├─ graph.js          Courbe d'évaluation SVG cliquable
   │  └─ chesscom.js       Appels directs à l'API Chess.com, résultat, cadences
   └─ vendor/
      ├─ chess.js          chess.js 1.4.0 (ESM) : règles, PGN, SAN
      ├─ pieces.css        Pièces « cburnett » en data-URI (tirées de chessground 9.1.1)
      └─ stockfish/        Stockfish 17.1 « lite » : sf-lite.* (multi-thread), sf-lite-single.* (mono-thread)
```

Les fichiers Stockfish ont été renommés, mais chaque `.js` cherche toujours le `.wasm` du même nom.

---

## 4. Fonctionnement de l'analyse

### Pipeline (`GameAnalysis.run`, analysis.js)
1. `parseGame(pgn)` : coups (verbose chess.js avec `before`/`after`), FEN de chaque position, pendules `%clk`, cadence, profondeur de « livre ».
2. **Passe 1** : chaque position est analysée à la profondeur choisie (12, 15 ou 18), MultiPV 3. Les résultats sont mis en cache par FEN (4 premiers champs). Le rapport du coup *i* est construit dès que les positions *i* et *i+1* sont connues, d'où l'affichage progressif.
3. `refine()` : **propagation arrière le long de la partie**. La valeur d'une position est le maximum entre la valeur du coup joué (celle de la position suivante, inversée) et les autres lignes MultiPV. Les scores de mat sont décalés d'un coup (`shift`).
4. **Passe 2** : vérification à profondeur +4 des positions autour des coups « erreur, gaffe, occasion manquée, brillant, très bon » (24 positions au maximum), puis `refine()` et reconstruction des rapports.
5. `buildSummary()` : précision, performance, phases, moments clés, thèmes.

### Évaluation
- Score retenu d'une position : `scoreOf(pos)`, qui vaut `pos.refined` s'il existe, sinon la meilleure ligne du moteur.
- Chances de gain (formule de Lichess) : `50 + 50 × (2 / (1 + e^(−0,00368208 × cp)) − 1)`, avec cp limité à ±1000. Un mat vaut 0 ou 100.

### Classement d'un coup (`makeReport`)
`perte = chances avant − chances après`, du point de vue du joueur qui joue. Seuils de base multipliés par un coefficient de niveau :

| Niveau | coef. | Excellent ≤ | Bon ≤ | Imprécision ≤ | Erreur ≤ | Gaffe > |
|---|---|---|---|---|---|---|
| Débutant (< 1000) | 1,4 | 2,8 | 7 | 14 | 28 | 28 |
| Intermédiaire (1000–1600) | 1,15 | 2,3 | 5,75 | 11,5 | 23 | 23 |
| Confirmé (1600–2000) | 1 | 2 | 5 | 10 | 20 | 20 |
| Expert (2000+) | 0,85 | 1,7 | 4,25 | 8,5 | 17 | 17 |

Règles particulières :
- **Forcé** : un seul coup légal. **Théorique** : le coup est dans le livre (`openings.js`).
- **Meilleur** : premier coup du moteur, ou perte ≤ 0,3.
- **Brillant** : meilleur ou excellent, avec un sacrifice d'au moins 2 points (hors pion, pas de mat direct), position après ≥ 45 %, et position avant < 97 % ou sacrifice qui force le mat.
- **Très bon coup** : meilleur coup, le 2e choix du moteur est inférieur d'au moins 15 points et ≤ 85 %. Ne s'applique ni à une simple reprise de pièce, ni à un coup qui mate.
- **Occasion manquée** : imprécision, erreur ou gaffe ; la meilleure ligne contenait une tactique (gain ≥ 2 points ou mat) ; le coup adverse précédent était fautif ; le coup joué ne perd pas lui-même de matériel.

Le niveau est automatique (Elo de chaque joueur pour ses propres coups) ou forcé par l'utilisateur. Changer de niveau reclasse tout instantanément (`rebuild()`), sans relancer le moteur.

### Précision et performance
- Précision d'un coup (Lichess) : `103,17 × e^(−0,04354 × perte) − 3,17 + 1`, bornée entre 0 et 100.
- Précision de partie : moyenne entre une moyenne pondérée par la volatilité (fenêtres glissantes) et une moyenne harmonique, comme Lichess.
- **Performance estimée** : table de correspondance précision → Elo (`PERF` dans analysis.js). Elle est **arbitraire** et serait à calibrer.

### Détection des motifs (`explain.js > moveFacts`)
Elle compare la position avant et après le coup, avec le mini-modèle de `position.js` :
- **SEE** (échange statique) pour savoir si une pièce peut être gagnée. Elle ignore les clouages et la légalité des prises.
- Faits détectés :
  - captures (gratuite, échange, mauvaise prise), échec, échec double, échec à la découverte ;
  - **fourchette** (la pièce jouée attaque au moins 2 cibles plus fortes ou non défendues, et ne peut pas être prise avec gain) ;
  - **attaque à la découverte**, **clouage** absolu ou relatif, **enfilade** (nouveaux seulement) ;
  - **menaces** nouvelles, **élimination du défenseur**, **sacrifice** ;
  - pièces laissées en prise, menaces ignorées, pièces sauvées ;
  - menace de **mat en 1** (le camp au trait est inversé et chaque coup est essayé) ;
  - roque, développement, centre, pion passé, Tour sur colonne ouverte, activité de pièce, perte du droit de roquer.
- `analyzeLine(fen, pv)` joue une variante et en tire :
  - le bilan matériel, en comptant une reprise en attente en fin de ligne ;
  - le mat et son type (couloir, étouffé) ;
  - le **motif principal** (`pickMotif`, par priorité).
- `difficulty(line)` estime la difficulté en Elo à partir du nombre de coups jusqu'au gain, du caractère forçant ou calme du premier coup, du sacrifice et du type de motif. `difficultyVerdict` la compare au niveau : accessible, au niveau, difficile.

### Structure d'un rapport de coup (`makeReport`)
```
{ ply, move, me, them, san, sanFr, num, cls, loss, winBefore, winAfter, accuracy,
  isBest, legal, levelKey, elo, thresholds,
  before, after,          // positions { fen, lines:[{score, pv}], depth, refined?, terminal? }
  best, played, reply,    // analyses de lignes (analyzeLine) : meilleure ligne, ligne jouée, réfutation
  alts,                   // [{ score, line, uci }] : les 3 lignes MultiPV
  facts,                  // moveFacts du coup joué
  missedTactic, bestMates, difficulty, difficultyVerdict, secondGap, spent, clock }
```

---

## 5. Interface (app.js)

- **Accueil** :
  - pseudo Chess.com, puis profil, classements et niveau détecté ;
  - parties récentes filtrables par cadence, avec bouton « mois précédent » (archives mensuelles de l'API) ;
  - collage d'un PGN ;
  - partie d'exemple (Opéra de Morphy) ;
  - réglages (profondeur, niveau), mémorisés dans `localStorage` ;
  - légende des classements et tableau des seuils.
- **Revue** :
  - échiquier avec barre d'évaluation, joueurs et pendules ;
  - courbe d'évaluation, liste des coups avec badges ;
  - onglets « Coup par coup » et « Bilan » ;
  - sélecteur de niveau.
- **Commentaire d'un coup**, dans l'ordre :
  1. verdict ;
  2. « Ce que fait ce coup » ;
  3. « Les points faibles » ;
  4. « La réponse qui punit » ;
  5. « Tactique manquée » ou « Ce qu'il fallait jouer », avec difficulté ;
  6. « Pourquoi ce sacrifice fonctionne » ou « Pourquoi c'est le seul bon coup » ;
  7. « Les options du moteur » ;
  8. « Et ensuite ? » ;
  9. lexique des motifs, ouvert par défaut pour les niveaux débutant et intermédiaire.
- **Variantes** : cliquer un coup d'une ligne l'affiche sur l'échiquier (`variation.source = 'line'`, le commentaire ne change pas). Cliquer une pièce permet de tester un coup libre (`source = 'free'`), analysé en priorité et commenté comme les coups de la partie.
- **Clavier** : ← → (coup précédent / suivant), Début / Fin, Échap (sortir d'une variante).

---

## 6. Tests effectués

- **Opéra de Morphy (1858)** :
  - 10.Cxb5, 13.Txd7 et 16.Db8+ classés brillants ;
  - 15.Fxd7+ et 17.Td8# classés meilleur coup ;
  - 9…b5 classé imprécision, avec la réfutation 10.Cxb5 expliquée.
- **Partie réelle de l'auteur** (Système de Londres, joueurs autour de 800–950 Elo) :
  - analyse et vérification complètes ;
  - bilan obtenu : précision 66 % / 56 %, 1 tactique manquée (11.e4 au lieu de 11.Fxd6, élimination du défenseur, difficulté ≈ 800).
- Appels directs à l'API Chess.com depuis le navigateur (profil, stats, archives) : 115 parties chargées pour le compte de l'auteur. Les avatars ne se chargeaient pas depuis le réseau de test (`images.chesscomfiles.com` introuvable, ERR_NAME_NOT_RESOLVED) : l'initiale s'affiche à la place.
- Console du navigateur : aucune erreur après les corrections.
- **Non testé** :
  - version Mac (`Lancer-Mac.command` + `serveur-mac.pl`) : écrite sans pouvoir l'exécuter (pas de Mac ni de Perl sur le PC de développement). Seuls les fins de ligne Unix et l'absence de BOM ont été vérifiés. À tester en priorité sur un Mac ;
  - Safari (ne gère pas `COEP: credentialless`, donc Stockfish devrait y tourner en mono-thread) ;
  - affichage mobile en conditions réelles ;
  - Chrome / Edge (multi-thread) ;
  - partie partant d'une position FEN personnalisée ;
  - parties « par jour ».

---

## 7. Limites connues

1. **Moteur mono-thread** dans le navigateur de l'app Claude : environ 30 s à 1 min 30 par partie.
2. **Stockfish « lite »** (petit réseau NNUE, 7 Mo) : plus faible que la version complète (75 Mo, découpée en 6 fichiers `-part-N.wasm`).
3. **Détection heuristique** :
   - la SEE ignore les clouages et les échecs ;
   - les avertissements « menace ignorée » peuvent être bruyants ;
   - motifs non détectés : surcharge, déviation, attraction, pièce piégée, coup intermédiaire, rayons X, mats d'Anastasia et arabe.
4. **Livre d'ouvertures maison** : sans transpositions. Le nom d'ouverture affiché est celui de toute la partie, même au 1er coup.
5. **Seuils et précision** calqués sur Lichess, pas sur le modèle (non public) de Chess.com. La table de performance est arbitraire.
6. **Serveur PowerShell séquentiel** : une requête à la fois. Suffisant en local, inadapté à un hébergement.
7. **Exploration** : promotion toujours en Dame, pas de glisser-déposer.
8. **Variantes non prises en charge** : Chess960, bughouse, etc. Les boutons de ces parties sont désactivés.

---

## 8. Pistes pour aller plus loin

### Qualité de l'analyse
- **Corriger le multi-thread** : trouver pourquoi le worker pthread de `sf-lite.js` lève une erreur. Tester dans Chrome et Edge. Essayer la version complète de Stockfish 17.1 (plus forte).
- **Calibrer le classement** sur de vraies parties. L'API Chess.com fournit `accuracies` pour les parties déjà revues : comparer automatiquement nos précisions aux leurs sur 50 à 100 parties et ajuster les seuils.
- **Tests unitaires** de `position.js` et `explain.js` sur des positions connues (fourchettes, clouages, SEE).
- Nouveaux motifs : surcharge, déviation, attraction, pièce piégée, coup intermédiaire, rayons X, autres mats types.

### Explications plus riches
- **Explications positionnelles** :
  - structure de pions (doublés, isolés, arriérés, majorité) ;
  - avant-postes, paire de Fous, sécurité du Roi (bouclier de pions, colonnes ouvertes vers le Roi) ;
  - activité et coordination des pièces ;
  - plan suggéré à partir des coups calmes du moteur.
- **Finales** : interroger les tables de finales de Lichess (`tablebase.lichess.ovh`, via le relais du serveur) pour dire « finale gagnante, nulle ou perdue » à 7 pièces ou moins.
- **Rédaction par une IA** : envoyer les faits détectés et les variantes à un modèle de langage pour obtenir un texte plus naturel et pédagogique, adapté au niveau. Il faudra une clé API côté serveur.
- **Livre d'ouvertures complet** : jeu de données `lichess-org/chess-openings` (domaine public, environ 3 500 lignes ECO), traduit ou non.

### Suivi de la progression (indicateurs dans la durée)
- **Analyse groupée** des N dernières parties, avec un profil de faiblesses : motifs manqués le plus souvent, phase la plus faible, erreurs en zeitnot, ouvertures qui coûtent des points.
- **Historique** des analyses dans IndexedDB (mise en cache, retour rapide).
- **Mode exercices** : transformer chaque tactique manquée en problème à rejouer, avec répétition espacée.
- Courbes de progression : précision et motifs manqués par semaine.

### Interface
- Glisser-déposer des pièces, choix de la promotion, animations, sons.
- Flèches et cercles dessinés à la main (clic droit, comme sur Lichess).
- Mise en page mobile à finaliser ; thèmes d'échiquier.
- Support de **Lichess** (API publique, export PGN par utilisateur).

### Mise en ligne (GitHub Pages)
Le site est 100 % statique (le navigateur parle directement à Chess.com) et tous ses chemins sont relatifs. Il fonctionne donc dans un sous-dossier comme `https://pseudo.github.io/coup-par-coup/`.
- Publication : dépôt GitHub public → Settings → Pages → « Deploy from a branch » → branche `main`, dossier `/docs`.
- GitHub Pages ne permet pas d'envoyer les en-têtes COOP/COEP : la page n'est pas isolée, et Stockfish tourne directement en mono-thread (le repli prévu). Pour retrouver le multi-thread en ligne, on peut ajouter le script `coi-serviceworker`, qui ajoute ces en-têtes côté navigateur, puis tester.
- Chaque visiteur fait tourner l'analyse sur son propre ordinateur : aucun coût de serveur, quel que soit le nombre d'utilisateurs.

---

## 9. Reprendre le travail avec Claude

- Ouvrir le dossier `coup-par-coup` comme projet dans Claude Code et lui indiquer ce fichier (`NOTES-DEV.md`).
- Lancer le site : `Lancer.bat`, ou `powershell -NoProfile -ExecutionPolicy Bypass -File server.ps1 -NoBrowser`.
- Points d'entrée pour les modifications les plus probables :
  - nouveaux motifs → `explain.js` (`moveFacts`, `pickMotif`, `MOTIFS`) ;
  - textes → `commentary.js` (`commentaryHtml`, `summaryHtml`) ;
  - seuils et règles de classement → `analysis.js` (`LEVELS`, `thresholds`, `makeReport`) ;
  - moteur → `engine.js`.
- Après une modification JS, recharger la page suffit : les fichiers hors `vendor/` sont servis en `no-cache`.
