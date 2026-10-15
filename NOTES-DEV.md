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
| Stockfish multi-thread exige `SharedArrayBuffer` | Le serveur envoie `COOP: same-origin` et `COEP: credentialless`. Le site n'utilise plus le multi-thread depuis le passage à Stockfish 19 (ligne suivante), mais ces en-têtes sont gardés : ils ne gênent pas. |
| Stockfish 19 va **plus lentement avec plusieurs threads** aux profondeurs du site. Mesure : 22 positions à profondeur 12, 7,6 s avec 1 thread, 19,9 s avec 4, 27,9 s avec 8. Le 13 octobre, le multi-thread plantait même dans le navigateur de l'app Claude | Le site charge `stockfish-19-single` (mono-thread). Ses évaluations sont identiques à celles du calage, vérifié sur 18 positions sur 18. **Repli automatique** (`engine.js > init()`) : s'il ne se charge pas, le site prend Stockfish 19 **lite** (1,8 Mo), moins précis, et l'indique dans le statut du moteur. |
| Quand le panneau navigateur de l'app Claude est masqué, Windows bride fortement la page (analyses 3 à 5 fois plus lentes) | Garder le panneau affiché pendant les longues analyses (calage). Sans effet dans un navigateur normal. |
| À profondeur 15, Stockfish « lite » rate parfois un mat un coup trop tôt (Opéra de Morphy : 15.Fxd7+ classé « erreur » à tort) | Ajout de la **propagation arrière** (`refine()`) et d'une **passe de vérification** à profondeur +4 sur les coups critiques. |

---

## 3. Arborescence

```
coup-par-coup/
├─ Lancer.bat              Lance server.ps1 (double-clic) ; prévient s'il manque des fichiers (zip non extrait)
├─ server.ps1              Serveur de fichiers local uniquement + en-têtes COOP/COEP, port 8765 (+10 si occupé)
├─ LISEZMOI.md             Guide utilisateur
├─ NOTES-DEV.md            Ce fichier
├─ calage/                 Données du calage de la précision sur Chess.com (non servies par le site)
│  ├─ precision-chesscom-sf19.json   62 parties analysées avec Stockfish 19 complet (calage actuel)
│  ├─ precision-chesscom-sf19-retouches.json   63 parties : évaluations avec et sans retouches (test du 14 octobre)
│  ├─ validation-nouvelles-parties.json        92 parties jamais utilisées au calage : validation de la formule actuelle
│  └─ precision-chesscom.json        les mêmes, analysées avec l'ancien Stockfish 17.1 lite
└─ public/
   ├─ index.html           Deux vues : #home (recherche, parties, légende) et #review (échiquier + commentaire)
   ├─ css/style.css        Thème clair/sombre par tokens CSS, responsive (< 980px : une colonne)
   ├─ js/
   │  ├─ app.js            Interface : état global, recherche, liste des parties, navigation, rendu
   │  ├─ engine.js         Pilote UCI de Stockfish dans un Web Worker, file d'attente, priorité, annulation
   │  ├─ analysis.js       Lecture PGN, pipeline d'analyse, classement, précision, bilan
   │  ├─ explain.js        Détection des motifs (faits d'un coup, analyse de variante, difficulté)
   │  ├─ commentary.js     Mise en mots (HTML) du commentaire d'un coup et du bilan
   │  ├─ position.js       Mini-modèle d'échiquier : attaques, SEE, clouages, pions passés
   │  ├─ fr.js             Outils de langue : articles, accords, notation française (C, F, T, D, R), choix des tournures (`pick`)
   │  ├─ openings.js       Petit livre d'ouvertures (~170 lignes, noms français)
   │  ├─ board.js          Échiquier DOM (grille 8×8) : pièces animées, glisser-déposer, choix de la promotion, flèches SVG, badge
   │  ├─ sound.js          Sons des coups, synthétisés avec la Web Audio API (aucun fichier audio)
   │  ├─ graph.js          Courbe d'évaluation SVG cliquable
   │  └─ chesscom.js       Appels directs à l'API Chess.com, résultat, cadences
   └─ vendor/
      ├─ chess.js          chess.js 1.4.0 (ESM) : règles, PGN, SAN
      ├─ pieces.css        Pièces « cburnett » en data-URI (tirées de chessground 9.1.1)
      └─ stockfish/        Stockfish 19 (stockfish.js v19.0.1, github.com/nmrugg/stockfish.js, GPLv3) :
                           stockfish-19-single.* (complet, mono-thread, 99 Mo), stockfish-19-lite-single.* (secours, 1,8 Mo)
```

Chaque `.js` cherche le `.wasm` du même nom : ne renommer l'un qu'avec l'autre.

---

## 4. Fonctionnement de l'analyse

### Pipeline (`GameAnalysis.run`, analysis.js)
1. `parseGame(pgn)` : coups (verbose chess.js avec `before`/`after`), FEN de chaque position, pendules `%clk`, cadence, profondeur de « livre ».
2. **Analyse** : chaque position est analysée à la profondeur du niveau choisi, MultiPV 3, par 4 moteurs en parallèle (`EnginePool`).
   - **Niveaux** (`MODES`, analysis.js, choisis par l'utilisateur le 15 octobre 2026) :

     | Niveau | Profondeur | Temps estimé, partie de 40 coups, PC libre |
     |---|---|---|
     | Rapide | 16 | environ 35 s (premier rendu vers 8 s) |
     | Standard | 18 | environ 1 min |
     | Approfondie | 20 | environ 2 min 30 |

     Historique des niveaux : 10, 12 et 15 avec vérification à +4 (jusqu'au 15 octobre) ; puis 12 avec vérification à 16, 15 et 17 ; enfin 16, 18 et 20.
   - **Premier rendu à 14**, pour tous les niveaux et volontairement **non annoncé** dans l'interface. Toute la partie est d'abord analysée à 14 et affichée, avec ses classements, son graphique et ses commentaires. Les résultats profonds sont gardés à part, puis remplacent ce rendu d'un coup, à la fin : évaluations, classements (une « gaffe » qui n'en est pas une est corrigée), commentaires et bilan. On ne mélange jamais deux profondeurs à l'écran.
     - Test dans l'interface (Xazouille – CMD2700, 77 coups, Rapide) : tous les coups étaient classés à 7,8 s, et le résultat final est arrivé à 35 s. 19 coups ont changé de classe entre les deux, par exemple 14. erreur → imprécision.
     - La barre de progression est continue. Le premier rendu en occupe le début, en proportion de son coût : 1 / (1 + 1,5^(profondeur − 14)).
   - **Notification de fin** : « Analyse complète terminée », en bas à droite pendant 5 s (`notify`, app.js). Si l'onglet est en arrière-plan, une coche s'ajoute au titre de l'onglet. Il n'y a pas de notification quand l'analyse a pris moins de 4 s (partie rouverte depuis la mémoire).
   - **Coup testé** sur l'échiquier : analysé au plus à profondeur 18, pour répondre en quelques secondes.
   - **Mémoires** : une position déjà connue n'est pas recalculée.
     - En mémoire vive, par FEN (4 premiers champs) et nombre de variantes.
     - Dans le navigateur (IndexedDB), d'une visite à l'autre ; voir « Temps d'analyse ».
     - Dans le fichier `data/ouvertures.json`, précalculé une fois pour toutes ; voir « Temps d'analyse ».
     - Une évaluation plus profonde que demandé est réutilisée telle quelle.
3. `refine()` : **propagation arrière le long de la partie**. La valeur d'une position est le maximum entre la valeur du coup joué (celle de la position suivante, inversée) et les autres lignes MultiPV. Les scores de mat sont décalés d'un coup (`shift`).
4. **Plus de vérification des moments clés** : l'ancienne passe 2 revérifiait à profondeur +4 les positions autour des coups « erreur, gaffe, occasion manquée, brillant, très bon ». Elle coûtait environ 70 % du travail et ne change presque plus rien à partir de la profondeur 16 (mesures dans « Temps d'analyse ») ; elle a été retirée le 15 octobre 2026.
5. `buildSummary()` : précision, performance, phases, moments clés, thèmes.
6. **Comparatif des profondeurs** (Xazouille – Proko91, 53 positions, 4 moteurs, MultiPV 3) :

   | Profondeur | Travail (millions de nœuds) | Temps, PC libre | Partie de 40 coups |
   |---|---|---|---|
   | 15 | 15 | 12 s | 20 s |
   | 17 | 31 | 26 s | 40 s |
   | 18 | 49 | 41 s | 1 min |
   | 19 | 77 | 1 min 04 | 1 min 40 |
   | 20 | 110 | 1 min 32 | 2 min 20 |

   - Chaque profondeur de plus coûte environ 1,5 fois plus.
   - Les temps sont calculés à 1,2 million de nœuds par seconde, la vitesse mesurée quand le PC était libre (mesures directes : 12 s à 15, 60 s à 19, 90 s à 20). Avec une autre application gourmande ouverte (un jeu, par exemple), les mesures ont été jusqu'à deux fois plus lentes.
   - Lancer les positions les plus difficiles en premier (repérées par le passage à 14) a semblé réduire la fin d'analyse où un seul moteur travaille (profondeur 18 : 73 s au lieu de 94 à 109 s). Mais ces mesures ont été faites avec le PC occupé par ailleurs : à confirmer avant de l'adopter.

### Moteur : pourquoi Stockfish 19 complet (14 octobre 2026)
- **Données du banc d'essai** : 170 coups de 2 parties de xazouille, 8 moteurs mono-thread en parallèle.
- **Référence** : Stockfish 19 complet à profondeur 20. Ce banc favorise un peu les moteurs 19, puisque la référence est elle-même un 19.

| Moteur · profondeur | Temps | Écart d'éval. (pts de chances) | Coups classés autrement | Erreurs/gaffes ratées (sur 31) |
|---|---|---|---|---|
| 17.1 lite · 15 (ancien) | 8 s | 4,2 | 26 | 6 |
| 19 lite · 13 | 9 s | 2,1 | 19 | 3 |
| 19 complet · 11 | 5 s | 1,5 | 15 | 2 |
| 19 complet · 12 | 8 s | 1,5 | 14 | 1 |
| 19 complet · 15 | 53 s | 0,9 | 15 | 1 |

- **À profondeur égale**, Stockfish 19 cherche beaucoup plus que le 17.1. À 15, il est environ 9 fois (lite) à 14 fois (complet) plus lent. Les profondeurs ont donc été baissées : 10, 12 et 15.
- **Threads** : en multi-thread (8 threads), le 19 complet à profondeur 12 prenait 2,2 fois le temps du 17.1 lite à profondeur 15. En **mono-thread**, réglage retenu, il va plus vite. Analyse complète en « Standard » (panneau de l'app Claude masqué, donc ralenti) :
  - partie de 45 coups : 81 s ;
  - Opéra de Morphy : 45 s.
- **Le « lite »** utilise un petit réseau d'évaluation : 1,8 Mo, mais une évaluation moins fine. Le **complet** embarque le grand réseau (99 Mo) : il juge mieux les positions, à vitesse proche.

### Évaluation
- Score retenu d'une position : `scoreOf(pos)`, qui vaut `pos.refined` s'il existe, sinon la meilleure ligne du moteur.
- Chances de gain (formule de Lichess) : `50 + 50 × (2 / (1 + e^(−0,00368208 × cp)) − 1)`, avec cp limité à ±1000. Un mat vaut 0 ou 100.

### Classement d'un coup (`makeReport`)
`perte = chances avant − chances après`, du point de vue du joueur qui joue. Seuils de base multipliés par un coefficient de niveau :

Seuils de base (14 octobre 2026, rendus plus sévères, proches de ceux de Lichess) : 2 / 4 / 8 / 15.

| Niveau | coef. | Excellent ≤ | Bon ≤ | Imprécision ≤ | Erreur ≤ | Gaffe > |
|---|---|---|---|---|---|---|
| Débutant (< 1000) | 1,2 | 2,4 | 4,8 | 9,6 | 18 | 18 |
| Intermédiaire (1000–1600) | 1 | 2 | 4 | 8 | 15 | 15 |
| Confirmé (1600–2000) | 0,9 | 1,8 | 3,6 | 7,2 | 13,5 | 13,5 |
| Expert (2000+) | 0,8 | 1,6 | 3,2 | 6,4 | 12 | 12 |

Anciennes valeurs (jugées trop gentilles) : base 2 / 5 / 10 / 20, coefficients 1,4 / 1,15 / 1 / 0,85.

Règles particulières :
- **Forcé** : un seul coup légal. **Théorique** : le coup est dans le livre (`openings.js`).
- **Meilleur** : premier coup du moteur, ou perte ≤ 0,3.
- **Brillant** : toutes les conditions suivantes.
  - Le coup est classé « meilleur » (un coup « excellent » ne peut plus être brillant).
  - C'est un **vrai sacrifice** d'au moins 2 points, hors pion, et pas un mat direct. Le sacrifice est revérifié en coups légaux (`legalSee`, explain.js), car la SEE rapide ignore les clouages et les échecs.
  - Le matériel est **réellement concédé** : dans la suite du moteur, le joueur se retrouve avec au moins 2 points de retard dans les 5 demi-coups qui suivent. Sinon, le coup doit forcer le mat.
  - L'avantage obtenu est **décisif** : chances de gain ≥ 80 % (environ +4) ou mat forcé.
  - Le sacrifice **rapporte nettement plus** que la meilleure autre option du moteur : au moins 15 points de chances de gain d'écart (`altGap`).
  - Pour un sacrifice qui **force le mat**, la courbe des chances sature près de 100 %. On exige seulement que la meilleure autre option ne soit pas déjà écrasante : ≤ 90 %, soit environ +6, et pas un autre mat. Avec Stockfish 19, l'alternative à 16.Db8+ (Opéra de Morphy) vaut +5,0 : l'écart n'est que de 13,6 points, mais le coup reste brillant.
- **Très bon coup** : premier coup du moteur. La meilleure autre option est inférieure d'au moins 15 points et ≤ 85 %. Exclus : coup qui mate, reprise de pièce, gain direct de matériel (capture qui rapporte ≥ 2 points), simple fuite d'une pièce attaquée sans menace créée.
- **Occasion manquée** : imprécision, erreur ou gaffe ; la meilleure ligne contenait une tactique (gain ≥ 2 points ou mat) ; le coup adverse précédent était fautif ; le coup joué ne perd pas lui-même de matériel.

Le niveau est automatique (Elo de chaque joueur pour ses propres coups) ou forcé par l'utilisateur. Changer de niveau reclasse tout instantanément (`rebuild()`), sans relancer le moteur.

### Précision et performance (calées sur Chess.com le 14 octobre 2026, avec Stockfish 19 complet)
La précision n'utilise **pas** la même courbe de chances de gain que le classement des coups. Les constantes `ACC_*` dépendent du moteur et de la profondeur : il faut les recaler à chaque changement de Stockfish.
- Chances de gain pour la précision (`accWinPct`) : même formule, mais avec une pente `ACC_K = 0,00175` au lieu de 0,00368, et **sans plafond** des évaluations (le classement des coups garde le plafond à ±1000 centipions). La courbe est plus plate.
- Précision d'un coup : `perte' = perte − ACC_TOL`, avec `ACC_TOL = 0,5` point. Les micro-pertes sont ignorées. Si `perte' ≤ 0` : 100. Sinon : `103,17 × e^(−ACC_B × perte') − 3,17 + 1`, avec `ACC_B = 0,16` (0,15 jusqu'au 15 octobre 2026, voir « Recalage pour les niveaux profonds »), borné entre 0 et 100.
- Précision de partie : **moyenne de puissance** `ACC_POWER = 0,4` des précisions des coups, `(Σ a^0,4 / n)^(1/0,4)`. Une grosse faute y pèse plus que dans une moyenne simple, mais bien moins que dans la moyenne harmonique de Lichess.

**Deuxième amélioration : sans plafond (14 octobre 2026).**
- **Constat** : avec 155 parties (63 de calage et 92 de validation), le bilan des erreurs ne montre presque plus de biais.
  - Le biais est quasi nul de 60 à 90 % de précision.
  - Il reste de légères tendances : +1,0 sous 500 Elo, −1,2 entre 1500 et 1900, +1,7 sur les parties de plus de 50 coups. Elles sont faiblement liées à l'erreur (corrélations 0,07 à 0,13).
- **Idées testées**, avec validation croisée 5 × 20 sur 155 parties, et réglage sur 63 parties puis test sur 92, et l'inverse :
  - correction selon l'Elo ;
  - courbe selon l'Elo ;
  - étirement de l'échelle ;
  - correction des parties longues ;
  - forme de la courbe par coup ;
  - plafond des évaluations.
- **Seul le plafond compte.** Sur la courbe plate de la précision, le plafond à ±1000 centipions écrasait les écarts dans les positions gagnées et faisait passer « mat » contre « +10 » pour une grosse perte. Au-delà de ±1500, le gain plafonne ; « sans plafond » est le plus simple.

| Écart moyen | Validation croisée (155) | Réglé sur 63 → testé sur 92 | Réglé sur 92 → testé sur 63 |
|---|---|---|---|
| Plafond ±1000 | 3,30 | 3,57 | 2,82 |
| **Sans plafond** | **2,91** | **3,23** | **2,58** |

- **Test décisif** sur les 92 parties de validation, avec des réglages choisis seulement sur les 63 autres : la formule précédente faisait 3,72, celle-ci fait **3,16**.
  - Différence −0,56, intervalle à 95 % [−0,84 ; −0,26] ;
  - plus proche de Chess.com dans 68 % des cas ;
  - par niveau : 150-900 de 3,96 à 3,30, 1000-1800 de 3,54 à 3,30, 2000+ de 2,83 à 2,25.
- **Réglage final**, choisi sur les 155 parties : `ACC_K = 0,00175`, `ACC_B = 0,15`, `ACC_TOL = 0,5`, bonus +1, `ACC_POWER = 0,4`, sans plafond. Écart attendu sur des parties nouvelles : environ 3,2 points.

**Dernières idées testées, sans gain (14 octobre 2026)**, avec le même protocole (155 parties) :

| Idée | Validation croisée | 63 → 92 | 92 → 63 | Décision |
|---|---|---|---|---|
| Formule actuelle | 2,90 | 3,23 | 2,58 | référence |
| Plancher par coup (5 à 20 %) | 2,90 | 3,23 | 2,58 | réglage retenu = 0 |
| Mélange chances de gain + perte en pions | 2,95 | 3,18 | 2,58 | réglage retenu = 0 |
| Courbe selon l'Elo moyen des deux joueurs | 2,90 | 3,23 | 2,58 | réglage retenu = 0 |
| Part de moyenne pondérée par la volatilité | 2,90 | 3,23 | 2,58 | réglage retenu = 0 |
| Valeur des mats (1500 à 4000 cp) | 2,88 | 3,23 | 2,59 | bruit |
| Pente selon l'avancement de la partie | 2,92 | 3,23 | 2,58 | réglage retenu = 0 |
| Forme de la queue (cp' = 100·(cp/100)^γ, γ = 0,9) | 2,84 | 3,18 | 2,51 | non significatif |

Pour γ = 0,9, sur les 92 parties, la différence est de −0,05, intervalle à 95 % [−0,31 ; +0,25] : non retenu.

**Modèles à plus de réglages, testés sans gain** (155 parties, validation croisée 5 × 5 par partie) :
- **Courbe libre** : note d'un coup définie par 9 points réglables, plus l'exposant de la moyenne.
  - Validation croisée 3,04 ; 63 → 92 : 3,20 ; 92 → 63 : 2,67.
  - Formule actuelle : 2,87 / 3,06 / 2,58.
- **Correction apprise** : régression ridge à partir de la précision actuelle, de la part des pertes > 5, > 10 et > 20 points, de la perte moyenne, de la longueur et de l'Elo des deux joueurs.
  - Validation croisée 2,98 à 3,26 selon la régularisation : toujours moins bien.

Plus de réglages ne captent pas d'information nouvelle : ils collent au bruit des parties de réglage et font moins bien sur les nouvelles parties.

**Conclusion** : la forme de la formule est à son optimum avec ces données. L'écart restant (environ 3,2 points) vient surtout des différences d'évaluation entre notre analyse (Stockfish 19, profondeur 12) et celle de Chess.com, et des parties secrètes de leur méthode. Seule piste restante, non testée car coûteuse : analyser plus profondément, puis recaler (plusieurs heures de calcul, et un site plus lent). Cette piste a été suivie le 15 octobre 2026 : voir ci-dessous.

**Recalage pour les niveaux profonds (15 octobre 2026).**
- **Contexte** : les niveaux sont passés à 16, 18 et 20, sans vérification des moments clés, alors que la formule avait été calée en profondeur 12.
- **Données** (`calage/precision-chesscom-profondeur18.json`) : 24 des 92 parties de validation, réanalysées en profondeur 18 (le niveau Standard), avec les ouvertures précalculées comme sur le site.
  - 12 de xazouille (une sur cinq), 8 entre 1 000 et 1 800 Elo (une sur deux), 4 à 2 000+ (une sur trois).
  - Les évaluations en profondeur 12 de la validation servent de référence, pour les mêmes parties.
- **Résultats** (écart moyen par joueur avec Chess.com, 48 précisions) :

  | Analyse | Écart moyen | Biais |
  |---|---|---|
  | Profondeur 12 (ancien Standard) | 2,67 | +0,2 |
  | Profondeur 18, `ACC_B = 0,15` | 2,27 | +0,9 |
  | Profondeur 18, `ACC_B = 0,16` (retenu) | 2,20 en validation croisée | −0,2 |

  - Différence profondeur 18 − profondeur 12 : −0,40 point, intervalle à 95 % (bootstrap par partie) de −0,82 à +0,03. L'analyse profonde se rapproche très probablement de Chess.com.
  - Par groupe, en profondeur 12 puis 18 : xazouille 2,53 → 2,21 ; 1 000 à 1 800 Elo 3,76 → 2,95 ; 2 000+ (4 parties seulement) 0,89 → 1,11.
- **Réajustement** : un seul réglage, choisi en laissant de côté une partie à la fois (validation croisée à 24 plis).
  - `ACC_B` : 0,16 est choisi dans chacun des 24 plis ; écart 2,20 en validation croisée, biais −0,2. **Retenu.**
  - `ACC_TOL` : 0,3 (0,2 dans certains plis) ; écart 2,19 en validation croisée. Gain équivalent mais moins stable, non retenu.
  - `ACC_K` : aucun gain.
- **À savoir** : une seule formule sert aux trois niveaux. Elle est calée sur Standard (18). Entre les profondeurs 12 et 18, la précision est montée d'environ 0,7 point. Rapide (16) devrait donc être très légèrement plus sévère que Standard, et Approfondie (20) très légèrement plus clément ; non mesuré.

**Évolution de la formule de partie (14 octobre 2026).**
- **Avant** : 0,25 de moyenne pondérée par la volatilité et 0,75 de moyenne simple, avec `ACC_K = 0,0015`, `ACC_B = 0,25`, `ACC_TOL = 0,5`.
- **Idées testées** sur les deux analyses Stockfish 19 des mêmes parties : validation croisée 5 × 20 par partie, qui garde les deux analyses d'une même partie dans le même groupe.
  - ignorer les coups théoriques, les coups forcés, le dernier coup ;
  - réduire ou ignorer les pertes dans une position déjà jouée (≥ 90 % ou ≥ 95 %) ;
  - courbe dépendant de l'Elo ;
  - moyennes de puissance p = 0,25, 0,5, 0,75 et 2.
- **Seule la moyenne de puissance p ≈ 0,5 apporte un gain net**, et il apparaît sur les deux analyses. Toutes les autres idées font jeu égal ou pire.

| Écart moyen avec Chess.com (validation croisée) | Global | 150-900 Elo | 1000-1800 | 2000+ |
|---|---|---|---|---|
| Ancienne combinaison, recalée au mieux | 3,76 | 4,05 | 2,52 | 3,15 |
| Moyenne de puissance 1/2 (actuelle) | **2,94** | **3,12** | 3,12 | **2,18** |

Le groupe 1000-1800 recule, mais il ne compte que 5 parties.

**Validation sur 92 parties nouvelles** (jamais utilisées au calage, `calage/validation-nouvelles-parties.json`) :
- **Parties** : 60 de xazouille, 20 entre 1000 et 1800 Elo (joueurs français tirés au hasard) et 12 à 2000+.
- **Analyse** : avec le site tel quel (Stockfish 19, profondeur 12).

| Écart moyen avec Chess.com (biais) | Global (184) | 150-900 (120) | 1000-1800 (40) | 2000+ (24) |
|---|---|---|---|---|
| Lichess d'origine | 8,05 (+1,2) | 9,49 (+1,8) | 6,33 (−0,2) | 3,74 (+0,6) |
| Ancienne combinaison | 4,87 (+1,7) | 5,45 (+2,9) | 3,81 (+0,2) | 3,72 (−2,1) |
| Moyenne de puissance 1/2, plafond ±1000 (version intermédiaire) | 3,72 (+0,2) | 3,96 (+0,9) | 3,54 (−1,0) | 2,83 (−1,5) |
| **Sans plafond, p = 0,45, réglée sur les 63 seulement** | **3,16** | **3,30** | **3,30** | **2,25** |

- **La nouvelle formule est plus proche de Chess.com** dans 62 % des cas.
- **Différence avec l'ancienne : −1,15 point**, intervalle à 95 % (bootstrap par partie) : [−1,73 ; −0,57]. Le gain est réel.
- **Le recul des 1000-1800 vu au calage ne se confirme pas** sur 20 parties nouvelles.
- **L'écart réel sur des parties nouvelles est d'environ 3,7 points**, un peu plus que les 2,9 estimés par validation croisée.
- **Performance estimée** (`PERF`) : table précision → Elo, recalée sur les points d'appui mesurés. Chess.com donne en moyenne environ 70 % vers 800 Elo, 81-83 % vers 2200 et 85 % vers 2650. L'estimation reste très approximative sur une seule partie.

**Comment le calage a été fait** :
- **Données** : 62 parties Chess.com qui ont une précision officielle, soit 124 précisions.
  - `lo` : 45 parties de xazouille et de ses adversaires, entre 150 et 900 Elo ;
  - `mid` : 5 parties, une par niveau (982/959, 1211/1239, 1410/1428, 1600/1597, 1752/1769), trouvées au hasard parmi des joueurs français ;
  - `hi` : 12 parties de joueurs entre 2000 et 2750 Elo (titrés NM).
- **Analyse** : avec le même pipeline que le site (profondeur standard, passe de vérification comprise). Les évaluations sont dans `calage/`.
- **Ajustement** :
  - recherche en grille sur `ACC_K`, `ACC_B`, `ACC_TOL`, le bonus et le mélange des moyennes ;
  - les parties `hi` comptent triple et les `mid` double, car elles sont peu nombreuses ;
  - une validation croisée (moitié des parties pour ajuster, l'autre pour tester) donne des erreurs du même ordre.
  - La surface d'erreur est plate : des réglages voisins donnent le même résultat à 0,01 près.

| Écart moyen avec Chess.com | Formule Lichess, 17.1 lite | Calée, 17.1 lite (prof. 15) | Calée, 19 complet (prof. 12, actuel) |
|---|---|---|---|
| 150-900 Elo (90 valeurs) | 10,7 pts (biais +7,2) | 3,6 pts (biais +0,7) | 3,7 pts (biais +1,5) |
| 1000-1800 Elo (10 valeurs) | – | 3,9 pts (biais −0,7) | 2,5 pts (biais −1,5) |
| 2000-2750 Elo (24 valeurs) | 4,5 pts (biais +4,0) | 2,7 pts (biais −0,1) | 3,0 pts (biais −0,2) |

**Conclusion** : face à Chess.com, les deux moteurs donnent une précision aussi proche l'un que l'autre. L'écart restant (environ 3,5 points) vient surtout du côté de Chess.com (son moteur, sa profondeur, son modèle), pas de la force de notre moteur. Stockfish 19 est un moteur plus fort. Mais aucun test indépendant ne montre que ses classements coup par coup sont plus proches de ceux de Chess.com : le banc d'essai de la section « Moteur » utilise Stockfish 19 comme référence, ce qui le favorise.

Réglages calés pour l'ancien 17.1 lite (pour mémoire) : `ACC_K = 0,002`, `ACC_B = 0,4`, `ACC_TOL = 1,25`.

**Test « précision sans retouches » (14 octobre 2026).**
- **Point de départ** : sur la partie Xazouille – Proko91, le site donnait 73,4 / 67,5, contre 70,6 / 59,3 sur Chess.com. Le moteur seul, sans propagation arrière (`refine`), donnait 69,9 / 63,0.
- **Test** : 63 parties réanalysées (Stockfish 19, profondeur 12), avec trois évaluations par position :
  - `ref` : celle du site, avec propagation arrière et vérification ;
  - `raw` : ligne principale après vérification ;
  - `raw1` : ligne principale de la première passe.
- **Résultat** : chaque version recalée, validation croisée, écart moyen avec Chess.com :
  - `ref` : 3,95 ;
  - `raw` : 4,12 ;
  - `raw1` : 4,11.
  
  **On garde donc les retouches.** Les réglages actuels donnent un écart moyen de 3,65 sur ces 63 parties (4,0 à 150-900 Elo). Un recalage complet ferait 3,78, en favorisant les joueurs forts : non retenu.
- **Données** : `calage/precision-chesscom-sf19-retouches.json`.

Ce que la partie Proko91 a montré : sur une partie isolée, l'écart peut atteindre 7 à 8 points, même avec le meilleur réglage. Stockfish 19 classe aussi en « gaffe » des coups que l'ancien moteur classait en « erreur » (17.Tfe1, 21.Dd4+, 10…Cbd7, 11…Cb6, 23…Cxf3). Une analyse à profondeur 22 des deux moteurs confirme qu'ils sont graves. Choix de l'utilisateur : garder ce classement.

Pour recaler plus tard : recharger le JSON, recalculer pour chaque joueur la série des chances de gain des Blancs (`evals`), puis la précision avec de nouveaux paramètres, et comparer à `cc`.

### Détection des motifs (`explain.js > moveFacts`)
Elle compare la position avant et après le coup, avec le mini-modèle de `position.js` :
- **SEE** (échange statique, `position.js > see`) pour savoir si une pièce peut être gagnée. Depuis le 15 octobre 2026, elle tient compte de la légalité :
  - une pièce clouée sur son Roi ne prend que sur la ligne du clouage ; les clouages sont recalculés après chaque prise, car une prise peut libérer une pièce clouée ;
  - un camp en échec ne peut d'abord prendre que la pièce qui donne échec, ou prendre avec son Roi ;
  - un Roi ne peut pas prendre une pièce défendue, même par une pièce clouée ;
  - l'échange est déroulé jusqu'au bout, sans l'élagage habituel, qui faussait les montants (Cxb5 cxb5 Fxb5+ comptait 2 pions perdus au lieu de 1).
  - Les sacrifices sont en plus revérifiés en coups légaux (`legalSee`, chess.js).
- **Contrôle des affirmations** (15 octobre 2026) : sur 80 parties (4 789 coups), chaque affirmation a été comparée aux coups réellement légaux (`legalSee`).
  - Avant la correction, il y avait 277 affirmations fausses, surtout :
    - « toujours en prise » : 204 sur 1 052, après un échec ;
    - « peut être pris » : 57 sur 461 ;
    - des « fourchettes » du Roi sur des pièces défendues.
  - Après correction : **0 fausse** sur environ 5 800, montants compris.
  - Seuls les montants des menaces, qui ne sont jamais affichés, ignorent encore la valeur d'une promotion.
- **Relecture des commentaires** (15 octobre 2026, deuxième passe). Deux parties ont été relues phrase par phrase sur l'échiquier : Xazouille – Proko91 et JohnMarcusIII – Xazouille. Erreurs trouvées et corrigées :
  - **Un échec qui « défend »** : après un échec, une pièce encore en prise était dite défendue ou mise à l'abri (« 20.Dg4+ défend le pion b2 »), parce que l'adversaire ne pouvait pas la prendre tout de suite. Un échec ne protège rien : `see(pos, case, camp, ignoreCheck)` vérifie que la pièce reste à l'abri une fois l'échec paré. Une menace qui existait avant l'échec subi n'est plus présentée comme nouvelle.
  - **Élimination du défenseur à tort** : « 11.Fxd6 laisse la Tour f8 sans protection », alors qu'elle restait défendue ; c'est le Fou arrivé en d6 qui l'attaquait. La menace doit maintenant exister sans la pièce qui vient de prendre.
  - **Clouages sans intérêt**, désormais filtrés :
    - pion cloué sur son Roi : on ne le signale que si le clouage l'empêche de prendre une de nos pièces (« 18.Cxe4 (clouage) », « 23…Dh5 (clouage) », le pion f2 cloué par un Fou en c5…). Un pion cloué « à gagner » ne compte pas : s'il tombe, c'est qu'il est attaqué plusieurs fois, pas à cause du clouage ;
    - clouage relatif devant une pièce défendue qui ne vaut pas plus que la pièce qui cloue (41.Te2) ;
    - un « Roi cloué » devant un pion (`linesBy`).
  - **Pertes gonflées** : « 41.Tf4 perd une Tour, un Fou et un Cavalier », parce que la variante du moteur contenait des coups de dépit du camp perdant (41…Tg2+ 42.Rc1 Txh2 43.Cd8+ Txd8 44.Txf6+…). Le bilan annoncé (`line.material`, `line.gain`) s'arrête avant le premier de ces coups (`spiteCut`). Le bilan brut (`line.net`, `line.running`), qui sert au classement, ne change pas.
    - Un coup de dépit est un coup du camp perdant qui donne au moins 2 points sans y être obligé.
    - Ne sont **pas** du dépit : un coup joué en échec ou sous menace de mat ; une pièce déjà condamnée (voir desperado) ; la prise d'un pion sur le point de promouvoir. Exemple : 37.Fxh2 contre le pion h2, où le Fou se donne pour éviter une Dame. Sans cette exception, « 36…Ce5 » était annoncé comme « gain de matériel » sans aucun gain chiffré.
    - Une Dame attaquée qui va se faire prendre ailleurs alors qu'elle avait des cases sûres (13…Fxe4 14.Dc5 Fd5 15.Db4 e5 16.Da5 Dxa5) est bien du dépit : « gagne un Cavalier », et non « une Dame et un Cavalier ».
    - Si la variante est coupée avant tout gain, la tactique manquée s'affiche sans l'étiquette « Gain de matériel ».
  - **Reprises** : « prend un Fou qui n'était pas défendu : +3 » pour une simple reprise. Une prise sur la case où l'adversaire vient de prendre est une reprise (`capture.retake`), décrite avec le bilan de tout l'échange (« Reprend le Fou en d3 : échange de Fous »). La réponse à un coup qui prend compte cette prise (`analyzeLine(…, { prev, seed })`) : « 6…Cxd5 (reprend le pion) » au lieu de « pièce en prise, gagne un pion ».
  - **« Pas assez défendu »** pour une Dame attaquée par un pion. La raison d'une menace est maintenant précise : sans défense, attaquée par une pièce de moindre valeur, ou défense insuffisante. « Attaque » est réservé à la pièce jouée ; une menace créée autrement (déclouage, ligne ouverte) est dite « maintenant menacée ».
  - **« N'était pas protégé »** alors qu'il l'était (15…gxf6 : le Fou f6 était défendu par le pion e5). Cette tournure exige maintenant qu'il n'y ait aucun défenseur ; sinon : « sort gagnant de l'échange ».
  - **Gaffe présentée comme un « sacrifice »** (10…Cbd7). Pour un mauvais coup, la pièce perdue va dans les faiblesses, avec sa cause quand elle est connue :
    - « En d7, le Cavalier coupe la défense de la Dame en d8 sur le Fou en d6 » (`hang.cut`) ;
    - « En quittant e5, le Cavalier ouvre la ligne de la Dame en d4 vers le pion f6 » (`hang.unmasked`).
  - **Desperado** : une pièce déjà perdue n'est plus un sacrifice quand elle se vend contre un pion (7.Fxf7+, 18…Fxf3). Elle est perdue si elle est attaquée et que, soit une autre pièce **au moins aussi précieuse** est en prise en même temps, soit elle n'a aucune retraite sûre. Phrase : « Le Fou, déjà perdu, se vend contre un pion (f7). »
  - **Fausses fourchettes** : une cible qui peut prendre la pièce qui fourchette sans y perdre (même valeur ou moins) ne compte pas. Exemple : 24…Dxf3+ « sur le Roi et la Dame f4 », alors que 25.Dxf3 échange simplement les Dames.
  - **Pièces mises à l'abri** : la raison est donnée.
    - Défense rouverte : « Le Fou en d6 est de nouveau défendu par la Dame en d8, grâce au départ du Cavalier ».
    - Attaquant cloué : « Le Cavalier en f6 n'est plus en prise : le pion e5, cloué, ne peut plus le prendre ».
    - Ligne coupée : « S'interpose entre le Fou en d5 et le pion g2 ».
    - Plusieurs pièces sauvées de la même façon sont réunies en une phrase.
  - **Sacrifice dans une position perdue** : « Sacrifice » est réservé aux bons coups dans une position qui n'est pas perdue (chances de gain ≥ 25 % après le coup). Sinon : « Le Cavalier en e4 reste en prise (environ 3 pions) ».
  - **Résumés courts** (options du moteur, « Et ensuite ? ») :
    - « prépare une fourchette » quand le motif n'arrive que plus loin dans la variante ;
    - « reprend le Fou, bilan : … » pour une reprise ;
    - « vend le Fou contre un pion » pour un desperado ;
    - « sacrifie la Tour » au lieu de « prend un pion » ;
    - « protège le pion » au lieu de « met le pion à l'abri » quand le pion ne bouge pas.
  - **Réponse qui mate** : « 44…Th1+, qui force le mat en 3 coups » au lieu de « 44…Th1+ : mat. Mat en 3 coups ensuite ».
  - Divers :
    - coup qui pare un échec : « Le Roi sort de l'échec », « le Cavalier s'interpose », « reste en prise » sans reproche ;
    - déclouage : « Libère le Cavalier en e5, qui était cloué sur son Roi » ;
    - plus rien d'autre après un mat ;
    - « très bon coup » : formulation défensive ou offensive selon la position ;
    - coup « bon » qui laisse un mat : « La position était déjà perdue, mais ce coup permet un mat en 1 » ;
    - motif apparu plus loin dans la variante : « 10.Dh3, puis 11.Df3 : … » ;
    - un pion central qui va être pris n'« occupe » pas le centre ;
    - « gagne de l'espace » est réservé aux pions qui passent dans le camp adverse ;
    - « la qualité » n'a plus de parenthèses imbriquées dans le résumé des options ;
    - une menace créée par une pièce qui donne échec et peut être prise n'est plus citée (19.Txe8+).
  - Audit après correction, sur les mêmes 80 parties : **0 affirmation fausse sur environ 8 500 contrôles**, dans 18 catégories. Le script d'audit était un fichier temporaire, supprimé ensuite ; il est facile à refaire à partir de cette liste. Nouveaux contrôles :
    - élimination du défenseur, vérifiée sans la pièce qui prend ;
    - « n'était pas défendu » et « cible sans défense » : aucun défenseur ;
    - reprise, desperado, réponse à un échec, déclouage ;
    - clouages relatifs utiles, aucun Roi cloué.
  - Motifs retirés sur les coups de ces 80 parties (4 789 coups) :
    - éliminations du défenseur : 153 → 45 ;
    - clouages : 224 → 83 ;
    - fourchettes : 78 → 72 ;
    - sacrifices : 165 → 155.
  - Effet sur les classements : voir « Tests effectués ».
- **Caches** (`moveFacts`, `analyzeLine`) : `rebuild()` refait tous les rapports à la fin de la vérification et à chaque changement de niveau. Sans cache, cela prenait 9 à 19 s de calcul par partie, et l'écran se figeait au changement de niveau ; avec le cache, quasiment rien. Les objets mis en cache ne sont jamais modifiés après coup.
- Faits détectés :
  - captures (gratuite, échange, mauvaise prise, **reprise** avec le bilan de tout l'échange, **desperado**), échec, échec double, échec à la découverte ;
  - **réponse à un échec** (le Roi sort de l'échec, interposition, prise de la pièce qui donne échec) ;
  - **fourchette** (la pièce jouée attaque au moins 2 cibles plus fortes ou non défendues, et ne peut pas être prise avec gain) ;
  - **attaque à la découverte**, **clouage** absolu ou relatif, **enfilade** (nouveaux et utiles seulement), **déclouage** ;
  - **menaces** nouvelles, avec leur raison (sans défense, pièce de moindre valeur, défense insuffisante), **élimination du défenseur**, **sacrifice** ;
  - pièces laissées en prise, avec leur cause (défenseur parti, défense coupée par la pièce jouée, ligne adverse démasquée), menaces ignorées, pièces sauvées (déplacée, attaquant pris, nouvelle défense, ligne coupée) ;
  - menace de **mat en 1** (le camp au trait est inversé et chaque coup est essayé) ;
  - roque, développement, centre, pion passé, Tour sur colonne ouverte, activité de pièce, perte du droit de roquer.
- `analyzeLine(fen, pv, { prev, seed })` joue une variante et en tire :
  - le bilan matériel **brut** (`net`, `running`), en comptant une reprise en attente en fin de ligne. Il sert au classement (occasion manquée, brillant) ;
  - le bilan **annoncé** dans les textes (`material`, `gain`), arrêté avant les coups de dépit du camp perdant. Pour une réponse (`seed`), il compte la prise que le coup joué venait de faire ;
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
  missedTactic, bestMates, difficulty, difficultyVerdict,
  altBest, altGap,        // meilleure autre ligne du moteur et écart (points de chances de gain) avec le coup joué
  spent, clock }
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
- **Variantes** : cliquer un coup d'une ligne l'affiche sur l'échiquier (`variation.source = 'line'`, le commentaire ne change pas). Faire glisser une pièce, ou cliquer la pièce puis la case, teste un coup libre (`source = 'free'`), analysé en priorité et commenté comme les coups de la partie.
- **Clavier** : ← → (coup précédent / suivant), Début / Fin, Échap (sortir d'une variante ou fermer le choix de promotion).
- **Échiquier** (`board.js`, 14 octobre 2026) :
  - **Taille** : la colonne a une largeur explicite dans `.review-grid` : `min(540px, 100vh − 110px)`, soit un échiquier d'environ 510 px. Avant, en `auto`, elle prenait la largeur de la barre de boutons et l'échiquier restait vers 390 px sur tous les écrans. Pour l'agrandir encore, il suffit de changer ces 540 px.
  - **Animation** : à chaque rendu, les pièces apparues sont appariées aux pièces identiques disparues les plus proches, puis glissent en 200 ms. Une pièce prise s'efface en fondu. Pas d'animation après un glisser-déposer, ni si le système demande moins d'animations.
  - **Glisser-déposer** : événements pointeur (souris et tactile, `touch-action: none` sur l'échiquier). Un déplacement de moins de 5 px reste un clic.
  - **Promotion** : `askPromotion()` affiche Dame, Cavalier, Tour et Fou en colonne sur la case d'arrivée. Un clic ailleurs ou Échap annule.
  - **Sons** (`sound.js`) : coup, capture, roque, échec. Ils sont joués quand la position affichée change, désactivables par la case « Sons » (`localStorage` `cpc.sound`).
- **Variété des phrases** : chaque phrase du commentaire et du bilan a 2 à 4 tournures, choisies par `fr.pick(clé, variantes)`. La clé combine le type de phrase et le coup (`move.before` + `move.lan`) : un coup garde toujours le même texte, et deux coups voisins changent de formulation. Pour ajouter une tournure, il suffit de compléter la liste concernée (`verdict`, `consequence`, `describeFacts`, `motifDetail`, `shortIdea`, `TIPS`, `LEVEL_TIPS`, `PHASE_TIPS`…). Attention aux accords : `fr.e(t)` ajoute le « e » des pièces féminines (Tour, Dame).

---

## 6. Tests effectués

- **Opéra de Morphy (1858)**, Stockfish 19 complet en « Standard », dans l'interface :
  - analyse terminée en moins de 75 s ;
  - seul 16.Db8+ est brillant : mat en 2, la meilleure autre option, 16.Db7, ne donnait que +5,0 ;
  - très bons coups : 10.Cxb5 (Cavalier contre deux pions, donc pas un sacrifice de 2 points) et 12.O-O-O ;
  - 13.Txd7 est un meilleur coup : 13.Td5 donnait déjà +5,9 sans sacrifice ;
  - erreurs : 6…Cf6, 9…b5, 10…cxb5. Imprécisions : 3…Fg4, 4…Fxf3, 7…De7.
  - Précision 98,4 % / 57,4 %.
- **Xazouille – JohnMarcusIII** (rapide, ~800 Elo) :
  - avec le 17.1 lite, anciennes règles → nouvelles : brillants 3 → 0 (18…Fxf3, 24…Fg3+ et 43…Td8+ n'étaient pas de vrais sacrifices), erreurs et gaffes 3 → 5, imprécisions 8 → 11 ;
  - avec Stockfish 19 complet (« Standard », 81 s) et la moyenne de puissance 1/2 : précision **72,5 % / 83,3 %**, contre **73,7 % / 84,0 %** sur Chess.com (formule Lichess d'origine : 85 % / 90 %).
- **Xazouille – Proko91** : 70,6 % / 64,2 %, contre 70,6 % / 59,3 % sur Chess.com (73,4 % / 67,5 % avec l'ancienne combinaison de moyennes).
  - Classements avec Stockfish 19 : Blancs 3 imprécisions, 3 erreurs, 1 gaffe ; Noirs 2 imprécisions, 1 gaffe ; aucun brillant.
- **Partie réelle Xazouille – Proko91** (Système de Londres), lancée par l'utilisateur :
  - analyse et vérification complètes ;
  - bilan obtenu : précision 66 % / 56 %, 1 tactique manquée (11.e4 au lieu de 11.Fxd6, élimination du défenseur, difficulté ≈ 800).
- Appels directs à l'API Chess.com depuis le navigateur (profil, stats, archives) : 115 parties chargées pour xazouille. Les avatars ne se chargent pas depuis ce réseau (`images.chesscomfiles.com` introuvable, ERR_NAME_NOT_RESOLVED) : l'initiale s'affiche à la place.
- Console du navigateur : aucune erreur après les corrections.
- **Relecture des commentaires** (15 octobre 2026), avant/après sur les mêmes évaluations de Stockfish 19 (« Standard ») :
  - Sur 17 parties (1 078 coups), avec la version intermédiaire : **aucun classement modifié**. Trois « tactiques manquées » n'existent plus ; c'étaient des clouages sans intérêt : 41.Tf4 → 41.Te2, et le pion f2 cloué par un Fou en c5 (14…De4, 20…dxc4).
  - Avec la version finale, sur les deux parties relues : aucun classement modifié. Trois fausses tactiques manquées (clouages) en moins.
  - Les règles finales (fausses fourchettes, pions cloués, desperado) ne retirent que des motifs faux. Elles peuvent, rarement, ramener une « occasion manquée » fondée sur un faux motif à sa classe d'origine (imprécision, erreur, gaffe). Elles ne touchent ni à la précision ni aux seuils.
  - Temps : Xazouille – Proko91 (53 demi-coups) analysée en 45 s avec le cache, contre 59 s sans. Le recalcul de tous les commentaires (`rebuild`) passe de 9 à 19 s à environ 20 à 70 ms.
- **Non testé** :
  - affichage mobile en conditions réelles ;
  - Chrome / Edge avec Stockfish 19 (temps d'analyse réel hors de l'app Claude) ;
  - partie partant d'une position FEN personnalisée ;
  - parties « par jour ».

---

## 7. Limites connues

1. **Temps d'analyse**. Depuis le 15 octobre 2026, `EnginePool` (engine.js) fait tourner jusqu'à 4 moteurs mono-thread en parallèle, sur des positions différentes. `GameAnalysis.run` leur confie toutes les positions d'un coup, la partie étant découpée en couloirs de positions voisines.
   - 54 positions à profondeur 14 : 26,8 s avec 1 moteur, 7,5 s avec 4. Pas de gain au-delà de 4 sur un Core 5 210H.
   - Mesure en conditions réelles, avec la vérification des moments clés, sur des parties de 27, 53 et 90 demi-coups :
     - profondeur 12 : 8, 33 et 66 s ;
     - profondeur 16 (vérification à 20) : 72, 128 et 303 s.
   - Test de précision en profondeur 16 sur ces 3 parties : écart moyen avec Chess.com de **0,8 point** par joueur, contre 1,7 en profondeur 12. Mais 15 à 25 % des coups changent de classement, et l'échantillon est trop petit pour conclure. La formule de précision a été calée en profondeur 12.
   - **Mémoire permanente des évaluations** (IndexedDB, `evaluate` dans analysis.js). Clé : moteur, position (FEN sans les compteurs), nombre de variantes. Une position déjà analysée à une profondeur suffisante n'est pas recalculée : rouvrir une partie prend 0 s au lieu de 5 s, et environ 10 % des positions reviennent d'une partie à l'autre (ouvertures).
     - Poids : environ 400 octets par position, les variantes étant coupées à 12 coups. Cela fait 25 Ko par partie et 24 Mo au plus pour 60 000 positions (environ 1 000 parties).
     - Au-delà, les positions les plus anciennes sont oubliées. Le quota du navigateur est de plusieurs Go.
   - **Ouvertures précalculées** (`data/ouvertures.json`) : 1 004 positions analysées en **profondeur 20** avec Stockfish 19 complet, MultiPV 3, variantes coupées à 12 coups (422 Ko, environ 100 Ko compressé).
     - Le livre du site fournit 596 positions (172 lignes).
     - S'y ajoutent les positions jouées au moins deux fois dans les 16 premiers demi-coups des 484 dernières parties de Xazouille.
     - Le fichier est chargé une fois, puis mis en cache par le navigateur. Dès la toute première analyse, ces positions ne sont pas recalculées.
     - En profondeur 20, il sert aux trois niveaux et au premier rendu à 14.
     - Historique : une première version en profondeur 18 ne servait pas au niveau Approfondie. Recalcul en 20 le 15 octobre 2026 : environ 3,5 s par position avec 4 moteurs sur secteur, et 3 à 4 fois plus sur batterie, Windows bridant alors le processeur. Le calcul était reprenable : résultats gardés au fur et à mesure dans le navigateur, pause automatique sur batterie sous 50 %.
     - Ces évaluations sont plus profondes que celles des niveaux Rapide et Standard : le premier coup hors de ces positions compare une évaluation à 20 et une autre à la profondeur du niveau. L'effet est faible, ces positions étant équilibrées.
   - **Nouveaux niveaux**, sur une partie de 27 demi-coups, avec 4 moteurs et la mémoire vide :
     - Rapide (12, moments clés à 16) : 7,4 s ;
     - Standard (15) : 5,7 s ;
     - Approfondie (17, aperçu à 14) : 19,2 s, l'aperçu étant immédiat car les positions venaient d'être analysées à 15.
   - **Où va le temps** (Xazouille – Proko91, 53 demi-coups, en millions de nœuds, ce qui ne dépend pas de la chauffe du processeur) :

     | Réglage | 1er passage | Vérification | Coups reclassés |
     |---|---|---|---|
     | 12, vérification à 16 (actuel) | 2,6 | 6,2 | – (bruit : 4) |
     | 12, vérification à 14 | 2,6 | 2,2 | 5 |
     | 12, sans vérification | 2,5 | 0 | 7 |
     | 16, vérification à 20 | 22 | 51 | – (bruit : 1) |
     | 16, vérification à 18 | 22 | 20 | 4 |
     | 16, sans vérification | 22 | 0 | 2 |
     | 16, 2 variantes au lieu de 3 | 14 | 41 | 15 |
     | 16, ordre inverse | 21 | 41 | 13 |
     | 16, mémoire du moteur vidée à chaque position | 22 | 41 | 9 |

     - La vérification des moments clés en +4 coûte environ 70 % du travail. En profondeur 16, elle ne change presque rien. En profondeur 12, la supprimer dégrade un peu le résultat (précision −1,3 point).
     - Passer à 2 variantes réduit le travail, mais change les évaluations (et donc le calage).
     - L'ordre inverse et une mémoire de 256 Mo par moteur n'apportent rien.
2. **Taille** : le moteur complet pèse 99 Mo, d'où un dossier du site d'environ 97 Mo. Le mode de secours (lite) est moins précis et n'a pas été calé.
3. **Détection heuristique** :
   - la SEE tient compte des clouages et des échecs (voir « Détection des motifs »), mais ne compte pas la valeur d'une promotion dans un échange ;
   - les avertissements « menace ignorée » peuvent être bruyants ;
   - motifs non détectés : surcharge, déviation, attraction, pièce piégée, coup intermédiaire, rayons X, mats d'Anastasia et arabe.
4. **Livre d'ouvertures maison** : sans transpositions. Le nom d'ouverture affiché est celui de toute la partie, même au 1er coup.
5. **Seuils de classement** inspirés de Lichess, pas du modèle (non public) de Chess.com. La précision et la performance, elles, sont calées sur Chess.com (voir « Précision et performance »).
6. **Serveur PowerShell séquentiel** : une requête à la fois. Suffisant en local, inadapté à un hébergement.
7. **Sons et animations** : vérifiés par le code (transitions de 200 ms créées, aucune erreur), mais pas écoutés ni regardés : le panneau de l'app Claude était masqué pendant les tests.
8. **Variantes non prises en charge** : Chess960, bughouse, etc. Les boutons de ces parties sont désactivés.

---

## 8. Pistes pour aller plus loin

### Qualité de l'analyse
- **Accélérer l'analyse** : lancer 2 à 4 moteurs mono-thread en parallèle, chacun sur des positions différentes, plutôt que des threads. C'est ce qui a servi pour le calage. Il faudra que `GameAnalysis.run` envoie les positions sans attendre chaque résultat. Chaque moteur charge sa propre copie du réseau de 99 Mo en mémoire.
- **À refaire plus tard (demandé par l'utilisateur)** : tester si une analyse plus profonde rapproche la précision de Chess.com.
  - Protocole : environ 30 parties de `calage/` en « Approfondie », recalage, comparaison avec la profondeur 12.
  - Coût : environ 2 h de calcul.
  - Seul levier restant : la formule elle-même est à son optimum.
- **Élargir le calage de la précision** : seulement 5 parties entre 1000 et 1800 Elo, une par niveau. Les classements de coups (brillant, gaffe…) ne peuvent pas être calés de la même façon : l'API Chess.com ne les fournit pas.
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
- Thèmes d'échiquier et jeux de pièces au choix. Le glisser-déposer, la promotion, les animations et les sons sont faits.
- Flèches et cercles dessinés à la main (clic droit, comme sur Lichess).
- Mise en page mobile à finaliser ; thèmes d'échiquier.
- Support de **Lichess** (API publique, export PGN par utilisateur).

### Mise en ligne
Le site est désormais 100 % statique (le navigateur parle directement à Chess.com). Il pourrait donc être publié sur un hébergeur statique (GitHub Pages, Netlify…), à condition d'y servir les en-têtes `COOP: same-origin` et `COEP: credentialless`. Sans ces en-têtes, le moteur tourne simplement en mono-thread. Plus besoin de télécharger quoi que ce soit, et plus de souci d'antivirus.

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
