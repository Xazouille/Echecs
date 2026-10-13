// Mise en page du commentaire d'un coup et du bilan de partie.
import * as fr from './fr.js';
import { CLASSES, CLASS_ORDER, LEVELS, negate, scoreOf } from './analysis.js';
import { describeFacts, motifLabel, motifDetail, MOTIFS, shortIdea, playLine } from './explain.js';

const ICONS = {
  best: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.6l1.9 4.1 4.5.4-3.4 3 1 4.4L8 11.2l-4 2.3 1-4.4-3.4-3 4.5-.4z"/></svg>',
  excellent: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 7.2h2.6V14H2zM5.8 14h5.7c.7 0 1.3-.5 1.5-1.2l1-4.1c.2-.9-.4-1.7-1.3-1.7H9.8l.4-2.4c.2-.9-.5-1.6-1.2-1.6L5.8 7.4z"/></svg>',
  good: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.4 12.6L2.5 8.7l1.5-1.5 2.4 2.4 5.6-5.6 1.5 1.5z"/></svg>',
  book: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3c2-.6 4-.4 5.4.7v9.6C6 12.4 4 12.2 2 12.8zM14 3c-2-.6-4-.4-5.4.7v9.6c1.4-.9 3.4-1.1 5.4-.5z"/></svg>',
  forced: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 7h8.2L7.4 4.2 8.8 2.8 14 8l-5.2 5.2-1.4-1.4L10.2 9H2z"/></svg>',
  miss: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.2 2.8L8 6.6l3.8-3.8 1.4 1.4L9.4 8l3.8 3.8-1.4 1.4L8 9.4l-3.8 3.8-1.4-1.4L6.6 8 2.8 4.2z"/></svg>',
};

export function classIcon(cls) {
  const g = CLASSES[cls].glyph;
  return ICONS[g] || `<span class="glyph">${g}</span>`;
}

export function badgeHtml(cls, extra = '') {
  return `<span class="badge c-${cls} ${extra}" title="${CLASSES[cls].label}">${classIcon(cls)}</span>`;
}

const fullmove = (fen) => +(fen.split(' ')[5] || 1);
const whiteOf = (score, color) => (color === 'w' ? score : negate(score));

function evalOf(pos) {
  if (!pos) return '…';
  if (pos.terminal === 'mate') return pos.fen.split(' ')[1] === 'w' ? '0-1' : '1-0';
  if (pos.terminal === 'draw') return '½-½';
  return fr.evalText(whiteOf(scoreOf(pos), pos.fen.split(' ')[1]));
}

let seq = 0;

export function lineHtml(registry, line, { max = 10, label = '' } = {}) {
  if (!line || !line.moves.length) return '';
  const id = `l${++seq}`;
  registry.set(id, { fen: line.fen, moves: line.moves });
  const toks = line.moves.slice(0, max).map((m, k) => {
    const n = fullmove(m.before);
    const num = m.color === 'w' ? `${n}.` : k === 0 ? `${n}…` : '';
    return `<button type="button" class="tok" data-line="${id}" data-i="${k}">${num ? `<span class="tok-n">${num}</span>` : ''}${fr.sanFr(m.san)}</button>`;
  });
  if (line.moves.length > max) toks.push('<span class="tok-more">…</span>');
  return `<div class="line">${label ? `<span class="line-label">${label}</span>` : ''}${toks.join('')}</div>`;
}

function sanTag(m) {
  return `<b class="san">${fr.moveNumber(m.before, m.color)}${fr.sanFr(m.san)}</b>`;
}

function lossPhrase(mat) {
  if (!mat.lostText) return '';
  return mat.gainedText ? `${mat.lostText} contre ${mat.gainedText}` : mat.lostText;
}

function mateIn(line) {
  return Math.ceil(line.moves.length / 2);
}

function consequence(r) {
  const p = r.played;
  if (p.mated === r.me) return `ce coup permet un mat en ${Math.ceil((p.moves.length - 1) / 2)}.`;
  if (p.net <= -1 && p.material.lostText) return `ce coup perd ${lossPhrase(p.material)}.`;
  if (r.missedTactic && r.best.moves[0]) return `il y avait mieux avec ${sanTag(r.best.moves[0])} (${motifLabel(r.best.motif).toLowerCase()}).`;
  return `l’évaluation passe de ${evalOf(r.before)} à ${evalOf(r.after)}.`;
}

function verdict(r, game) {
  const bm = r.best && r.best.moves[0];
  const best = bm ? sanTag(bm) : 'le coup du moteur';
  switch (r.cls) {
    case 'brilliant':
      return `Un sacrifice ${fr.du(r.facts.sacrifice.t)} parfaitement calculé : ${fr.side(r.them)} ne peuvent pas l’accepter sans dommage.`;
    case 'great': {
      const alt = r.alts[1];
      return alt
        ? `Le seul coup qui tient la position. Le deuxième meilleur choix, ${sanTag(alt.line.moves[0])}, ne donnait que ${fr.evalText(whiteOf(alt.score, r.me))}.`
        : 'Le seul coup qui tient la position.';
    }
    case 'best':
      return 'C’est le coup que recommande le moteur.';
    case 'excellent':
      return `Presque aussi fort que le meilleur coup (${best}) : la différence est minime.`;
    case 'good':
      return `Un coup correct, mais ${best} était plus précis.`;
    case 'book':
      return `Coup de théorie${game && game.opening ? ` (${game.opening})` : ''} : il fait partie des lignes d’ouverture connues.`;
    case 'forced':
      return 'Seul coup légal : il n’y avait pas le choix.';
    case 'inaccuracy':
      return `Un coup imprécis : ${best} était meilleur, ${consequence(r)}`;
    case 'mistake':
      return `Une erreur : ${consequence(r)}`;
    case 'blunder':
      return `Une gaffe : ${consequence(r)}`;
    case 'miss': {
      const gain = r.bestMates ? `un mat en ${mateIn(r.best)}` : r.best.material.text || 'un avantage décisif';
      return `L’adversaire venait de se tromper, mais l’occasion n’a pas été saisie : ${best} gagnait ${gain}.`;
    }
    default:
      return '';
  }
}

function section(title, body, kind = '') {
  return `<section class="cmt-sec ${kind}"><h3>${title}</h3>${body}</section>`;
}

const ul = (items) => `<ul>${items.map((x) => `<li>${x}</li>`).join('')}</ul>`;

function fmtSeconds(s) {
  if (s == null) return '';
  if (s < 10) return `${s.toFixed(1).replace('.', ',')} s`;
  if (s < 60) return `${Math.round(s)} s`;
  return `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, '0')}`;
}

export function commentaryHtml(r, registry, { game = null, glossary = false } = {}) {
  const C = CLASSES[r.cls];
  const T = r.thresholds;
  const bad = ['inaccuracy', 'mistake', 'blunder', 'miss'].includes(r.cls);
  const motifsSeen = new Set();
  const out = [];

  const meta = [`${evalOf(r.before)} → ${evalOf(r.after)}`, `précision ${Math.round(r.accuracy)} %`];
  if (r.spent != null) meta.push(`${fmtSeconds(r.spent)} de réflexion`);
  out.push(`<header class="cmt-head c-${r.cls}">
    ${badgeHtml(r.cls, 'badge-lg')}
    <div class="cmt-title">
      <p class="cmt-kicker">${C.label}</p>
      <h2>${r.num}${r.sanFr} est ${C.phrase}</h2>
      <p class="cmt-meta">${meta.join(' · ')}</p>
    </div>
  </header>`);
  out.push(`<p class="cmt-verdict">${verdict(r, game)}</p>`);

  // Ce que fait le coup
  const { idea, warn } = describeFacts(r.facts);
  if (!idea.length) {
    const f = r.facts;
    idea.push(f.piece === 'p'
      ? `Avance le pion de ${fr.sq(f.from)} à ${fr.sq(f.to)} : un coup de structure, sans menace immédiate.`
      : `Replace ${fr.le(f.piece)} de ${fr.sq(f.from)} à ${fr.sq(f.to)} : un coup de manœuvre, sans menace immédiate.`);
  }
  out.push(section('Ce que fait ce coup', ul(idea)));
  for (const k of ['fork', 'pin', 'skewer', 'discovered', 'doubleCheck', 'sacrifice', 'mateThreat']) {
    if ((k === 'fork' && r.facts.fork) || (k === 'pin' && r.facts.lines.some((l) => l.kind === 'pin'))
      || (k === 'skewer' && r.facts.lines.some((l) => l.kind === 'skewer')) || (k === 'discovered' && r.facts.discovered.length)
      || (k === 'doubleCheck' && r.facts.doubleCheck) || (k === 'sacrifice' && r.facts.sacrifice) || (k === 'mateThreat' && r.facts.mateThreat)) motifsSeen.add(k);
  }

  // Pourquoi c'est fort
  if (r.cls === 'brilliant' && r.facts.sacrifice) {
    const s = r.facts.sacrifice;
    const accept = r.after.lines.find((l) => l.pv[0] && l.pv[0].slice(2, 4) === s.sq);
    const parts = [`${fr.cap(fr.pc(s.t, s.sq))} est offert${fr.e(s.t)}.`];
    if (accept) {
      parts.push(`Si ${fr.side(r.them)} acceptent, la suite donne ${fr.evalText(whiteOf(accept.score, r.them))} :`);
      const moves = playLine(r.move.after, accept.pv, 10).moves;
      out.push(section('Pourquoi ce sacrifice fonctionne', `<p>${parts.join(' ')}</p>${lineHtml(registry, { fen: r.move.after, moves })}`, 'good'));
    } else {
      parts.push(`Le prendre serait une erreur pour ${fr.side(r.them)} : le moteur préfère ne pas l’accepter.`);
      out.push(section('Pourquoi ce sacrifice fonctionne', `<p>${parts.join(' ')}</p>`, 'good'));
    }
  } else if (r.cls === 'great' && r.alts.length >= 2) {
    const rows = r.alts.slice(1).map((a) => `${sanTag(a.line.moves[0])} ne donnait que ${fr.evalText(whiteOf(a.score, r.me))}`);
    out.push(section('Pourquoi c’est le seul bon coup', `<p>Les autres options étaient nettement moins bonnes : ${fr.list(rows)}.</p>`, 'good'));
  }

  // Faiblesses et réfutation
  if (bad || r.loss > T.good) {
    if (warn.length) out.push(section('Les points faibles', ul(warn), 'warn'));
    if (r.reply && r.reply.moves.length && r.cls !== 'miss') {
      const first = r.reply.moves[0];
      const m = r.reply.motif;
      if (m) motifsSeen.add(m.key);
      let txt = `${fr.Side(r.them)} répondent ${sanTag(first)}`;
      if (m) {
        const det = motifDetail(m);
        txt += ` : <b>${motifLabel(m).toLowerCase()}</b>${det ? ` (${det})` : ''}`;
      }
      txt += '. ';
      const p = r.played;
      if (p.mated === r.me) txt += `Le mat suit en ${Math.ceil((p.moves.length - 1) / 2)} coup${p.moves.length > 3 ? 's' : ''}.`;
      else if (p.net <= -1 && p.material.lostText) txt += `Au bout de la variante, ${fr.side(r.me)} perdent ${lossPhrase(p.material)}.`;
      else txt += `Sans perte de matériel immédiate, mais la position bascule : ${evalOf(r.before)} → ${evalOf(r.after)}.`;
      out.push(section('La réponse qui punit', `<p>${txt}</p>${lineHtml(registry, r.reply)}`, 'warn'));
    }
  }

  // Le meilleur coup / tactique manquée
  if (!r.isBest && r.best && r.best.moves.length && !['best', 'book', 'forced', 'brilliant', 'great'].includes(r.cls) && r.loss > T.excellent) {
    const b = r.best;
    const bm = b.moves[0];
    const bestEval = fr.evalText(whiteOf(r.before.lines[0].score, r.me));
    if (r.missedTactic) {
      const m = b.motif;
      motifsSeen.add(m.key);
      if (m.sacrifice) motifsSeen.add('sacrifice');
      const det = motifDetail(m);
      let txt = `${sanTag(bm)}${det ? ` : ${det}` : ''}. `;
      if (r.bestMates) txt += `La suite force le mat en ${mateIn(b)} coup${mateIn(b) > 1 ? 's' : ''}.`;
      else if (b.material.text) txt += `Au bout de la variante, ${fr.side(r.me)} gagnent ${b.material.text}.`;
      txt += ` Évaluation : ${bestEval} au lieu de ${evalOf(r.after)}.`;
      let diff = '';
      if (r.difficulty) {
        const v = r.difficultyVerdict;
        diff = `<p class="diff diff-${v.key}"><span class="diff-num">≈ ${r.difficulty}</span><span>Difficulté estimée de la tactique. ${v.text}</span></p>`;
      }
      out.push(section(`Tactique manquée · ${motifLabel(m)}`, `<p>${txt}</p>${lineHtml(registry, b)}${diff}`, 'missed'));
    } else {
      const ideas = describeFacts(b.facts[0] || {}).idea.slice(0, 3);
      const body = `<p>${sanTag(bm)} (${bestEval}) était préférable.</p>${ideas.length ? ul(ideas) : ''}${lineHtml(registry, b, { label: 'Suite' })}`;
      out.push(section('Ce qu’il fallait jouer', body, 'missed'));
    }
  }

  // Les options du moteur
  if (r.alts.length) {
    const rows = r.alts.map((a, k) => {
      const m = a.line.moves[0];
      if (!m) return '';
      const isPlayed = a.uci === r.move.lan;
      return `<li>
        <span class="alt-rank">${k + 1}</span>
        ${lineHtml(registry, a.line, { max: 1 })}
        <span class="alt-ev">${fr.evalText(whiteOf(a.score, r.me))}</span>
        <span class="alt-idea">${shortIdea(a.line)}</span>
        ${isPlayed ? '<span class="pill">joué</span>' : ''}
      </li>`;
    });
    if (!r.alts.some((a) => a.uci === r.move.lan)) {
      rows.push(`<li class="alt-played">
        <span class="alt-rank">–</span>
        <span class="line"><span class="tok is-static">${fr.sanFr(r.san)}</span></span>
        <span class="alt-ev">${evalOf(r.after)}</span>
        <span class="alt-idea">${shortIdea(r.played)}</span>
        <span class="pill">joué</span>
      </li>`);
    }
    out.push(section('Les options du moteur', `<ol class="alts">${rows.join('')}</ol>`));
  }

  // Et ensuite ?
  if (!bad && r.reply && r.reply.moves.length) {
    const first = r.reply.moves[0];
    let txt = `${fr.Side(r.them)} devraient répondre ${sanTag(first)}`;
    const idea2 = shortIdea(r.reply);
    txt += idea2 ? ` (${idea2}).` : '.';
    if (r.facts.mateThreat) txt += ` Ils doivent surtout parer la menace ${fr.sanFr(r.facts.mateThreat)} mat.`;
    out.push(section('Et ensuite ?', `<p>${txt}</p>${lineHtml(registry, r.reply, { label: 'Suite probable' })}`));
  }

  // Lexique
  const defs = [...motifsSeen].filter((k) => MOTIFS[k]).map((k) => `<dt>${MOTIFS[k].label}</dt><dd>${MOTIFS[k].def}</dd>`);
  if (defs.length) {
    out.push(`<details class="glossary"${glossary ? ' open' : ''}><summary>Lexique des motifs</summary><dl>${defs.join('')}</dl></details>`);
  }
  return `<article class="cmt">${out.join('')}</article>`;
}

export function introHtml(game, analysis) {
  const n = game.moves.length;
  const parts = [`<p class="cmt-kicker">Position de départ</p><h2>${game.opening || 'Partie'}</h2>`];
  const facts = [`${Math.ceil(n / 2)} coups`, game.result !== '*' ? `résultat ${game.result.replace('1/2-1/2', '½-½')}` : null, game.date ? game.date.replace(/\./g, '/') : null].filter(Boolean);
  parts.push(`<p class="cmt-meta">${facts.join(' · ')}</p>`);
  const tip = analysis && analysis.done
    ? 'L’analyse est prête. Avance coup par coup avec la flèche droite du clavier, ou ouvre le bilan pour voir les moments clés.'
    : 'Stockfish analyse la partie position par position. Tu peux déjà avancer avec les flèches : les commentaires apparaissent au fur et à mesure.';
  parts.push(`<p class="cmt-verdict">${tip}</p>`);
  parts.push(`<ul class="intro-keys"><li><kbd>←</kbd><kbd>→</kbd> coup précédent / suivant</li><li><kbd>Échap</kbd> revenir à la partie après une variante</li><li>Clique sur une pièce de l’échiquier pour tester ton propre coup</li><li>Clique sur un coup d’une variante pour l’afficher</li></ul>`);
  return `<article class="cmt cmt-intro">${parts.join('')}</article>`;
}

export function pendingHtml(text) {
  return `<article class="cmt cmt-pending"><div class="spinner" aria-hidden="true"></div><p>${text}</p></article>`;
}

// ---------- Bilan ----------

const PHASES = [['opening', 'Ouverture'], ['middlegame', 'Milieu de partie'], ['endgame', 'Finale']];

const TIPS = {
  fork: 'Cherche les cases d’où une seule pièce (souvent un Cavalier) attaque deux pièces mal protégées ou le Roi et une pièce.',
  pin: 'Quand une pièce adverse se trouve devant son Roi ou sa Dame sur une même ligne, demande-toi si un Fou ou une Tour peut la clouer.',
  skewer: 'Repère le Roi et la Dame alignés sur une colonne, une rangée ou une diagonale : une attaque en ligne peut les « embrocher ».',
  discovered: 'Regarde les pièces placées devant tes Fous, Tours et Dame : les déplacer avec une menace crée deux attaques d’un coup.',
  doubleCheck: 'Les échecs à la découverte sont encore plus forts quand la pièce qui bouge donne aussi échec.',
  removal: 'Demande-toi quelle pièce adverse en protège une autre, puis comment la capturer ou la détourner.',
  free: 'Après chaque coup adverse, fais le tour des pièces adverses : lesquelles ne sont plus protégées ?',
  mate: 'Entraîne-toi aux mats en 1 et en 2 : commence toujours par examiner tous les échecs possibles.',
  backrank: 'Quand le Roi adverse n’a pas de case de fuite derrière ses pions, une Tour sur la dernière rangée peut suffire.',
  smothered: 'Un Roi entouré de ses pièces est vulnérable aux échecs de Cavalier.',
  sacrifice: 'Les sacrifices se trouvent en calculant les coups forcés (échecs, captures) même quand ils donnent du matériel.',
  promotion: 'Un pion proche de la promotion vaut souvent plus qu’une pièce : compte les tempos jusqu’à la dame.',
  material: 'Avant de jouer, compte les attaquants et les défenseurs de chaque pièce menacée.',
  mateThreat: 'Avant chaque coup, demande-toi si l’adversaire menace de mater au coup suivant.',
};

const LEVEL_TIPS = {
  debutant: 'À ce niveau, la plupart des parties se décident sur des pièces laissées en prise. Avant chaque coup, fais la vérification « échecs, captures, menaces », pour toi et pour l’adversaire.',
  intermediaire: 'Travaille les tactiques en deux coups (fourchettes, clouages, attaques à la découverte) : une dizaine de problèmes par jour suffit pour progresser vite.',
  confirme: 'Liste tes coups candidats et calcule les variantes forcées jusqu’au bout avant de jouer. Soigne aussi le plan de milieu de partie après l’ouverture.',
  expert: 'Les points se perdent surtout dans la conversion des avantages et la défense des positions difficiles. Rejoue tes moments critiques sans moteur avant de vérifier.',
};

function accClass(v) {
  if (v == null) return '';
  if (v >= 85) return 'acc-hi';
  if (v >= 65) return 'acc-mid';
  return 'acc-lo';
}

const fmtAcc = (v) => (v == null ? '–' : v.toFixed(1).replace('.', ','));

function moveRef(r) {
  return `<button type="button" class="ply-link" data-ply="${r.ply + 1}">${badgeHtml(r.cls)}<span>${r.num}${r.sanFr}</span></button>`;
}

export function summaryHtml(an, focus, userColor) {
  const { game, summary } = an;
  if (!summary) return pendingHtml('Le bilan sera prêt à la fin de l’analyse.');
  const P = summary.players;
  const name = (c) => (c === 'w' ? game.white : game.black);
  const out = [];

  // Joueurs
  const card = (c) => {
    const p = P[c];
    const n = name(c);
    const cc = game.chesscomAcc ? game.chesscomAcc[c === 'w' ? 'white' : 'black'] : null;
    return `<div class="acc-card ${c === 'w' ? 'is-white' : 'is-black'}">
      <p class="acc-who"><span class="dot dot-${c}"></span>${n.name}${n.elo ? ` <span class="muted">(${n.elo})</span>` : ''}${userColor === c ? ' <span class="pill">toi</span>' : ''}</p>
      <p class="acc-num ${accClass(p.accuracy)}">${fmtAcc(p.accuracy)}<small>%</small></p>
      <p class="acc-sub">Précision${cc ? ` · Chess.com ${String(cc).replace('.', ',')} %` : ''}</p>
      <p class="acc-sub">Performance estimée <b>${p.perf ?? '–'}</b> · niveau ${LEVELS[p.levelKey].label.toLowerCase()}</p>
    </div>`;
  };
  out.push(`<div class="acc-cards">${card('w')}${card('b')}</div>`);

  // Classement des coups
  const rows = CLASS_ORDER.map((k) => `<tr><td>${badgeHtml(k)} ${CLASSES[k].label}</td><td class="num">${P.w.counts[k]}</td><td class="num">${P.b.counts[k]}</td></tr>`);
  out.push(section('Qualité des coups', `<div class="table-wrap"><table class="cls-table"><thead><tr><th></th><th class="num">Blancs</th><th class="num">Noirs</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`));

  // Phases
  const ph = PHASES.map(([k, label]) => `<tr><td>${label}</td><td class="num ${accClass(P.w.phases[k])}">${fmtAcc(P.w.phases[k])}</td><td class="num ${accClass(P.b.phases[k])}">${fmtAcc(P.b.phases[k])}</td></tr>`);
  out.push(section('Précision par phase', `<div class="table-wrap"><table class="cls-table"><thead><tr><th></th><th class="num">Blancs</th><th class="num">Noirs</th></tr></thead><tbody>${ph.join('')}</tbody></table></div>`));

  // Moments clés
  if (summary.keyMoments.length) {
    const items = summary.keyMoments.map((r) => {
      let why = '';
      if (r.cls === 'brilliant' || r.cls === 'great') why = CLASSES[r.cls].label;
      else if (r.played.mated === r.me) why = 'permet un mat';
      else if (r.played.net <= -1 && r.played.material.lostText) why = `perd ${lossPhrase(r.played.material)}`;
      else if (r.missedTactic) why = `manque ${motifLabel(r.best.motif).toLowerCase()}`;
      else why = `${evalOf(r.before)} → ${evalOf(r.after)}`;
      return `<li>${moveRef(r)}<span class="km-side">${fr.color(r.me)}</span><span class="km-why">${why}</span></li>`;
    });
    out.push(section('Moments clés', `<ul class="key-moments">${items.join('')}</ul>`));
  }

  // Focus sur un joueur
  const p = P[focus];
  const who = name(focus).name;
  const toggle = `<div class="seg" role="group" aria-label="Joueur analysé">
    <button type="button" data-focus="w" class="${focus === 'w' ? 'is-on' : ''}">Blancs</button>
    <button type="button" data-focus="b" class="${focus === 'b' ? 'is-on' : ''}">Noirs</button></div>`;
  out.push(`<div class="focus-head"><h3>Pour progresser · ${who}</h3>${toggle}</div>`);

  if (p.missed.length) {
    const items = p.missed.map((r) => {
      const v = r.difficultyVerdict;
      const gain = r.bestMates ? `mat en ${mateIn(r.best)}` : r.best.material.text ? `gagne ${r.best.material.text}` : '';
      return `<li>${moveRef(r)}
        <span class="tm-what"><b>${fr.sanFr(r.best.moves[0].san)}</b> · ${motifLabel(r.best.motif)}${gain ? ` · ${gain}` : ''}</span>
        ${r.difficulty ? `<span class="diff-chip diff-${v.key}" title="${v.text}">≈ ${r.difficulty}</span>` : ''}</li>`;
    });
    out.push(section(`Tactiques manquées (${p.missed.length})`, `<ul class="tactics">${items.join('')}</ul><p class="note">Le chiffre indique la difficulté estimée de chaque tactique, en Elo : vert = accessible au niveau du joueur, orange = de son niveau, gris = difficile.</p>`));
  } else {
    out.push(section('Tactiques manquées', '<p>Aucune tactique gagnante n’a été manquée dans cette partie.</p>'));
  }

  const advice = [];
  if (p.hung) advice.push(`<b>Sécurité des pièces.</b> ${p.hung} erreur${p.hung > 1 ? 's' : ''} vien${p.hung > 1 ? 'nent' : 't'} d’une pièce laissée sans défense ou d’une menace ignorée. Avant chaque coup, demande-toi : qu’est-ce que mon coup laisse sans protection, et que menace l’adversaire ?`);
  const topMissed = Object.entries(p.themes).sort((a, b) => b[1] - a[1])[0];
  if (topMissed) {
    const [k, n] = topMissed;
    advice.push(`<b>${MOTIFS[k].label} manqué${MOTIFS[k].fem ? 'e' : ''}${n > 1 ? 's' : ''} (${n}).</b> ${TIPS[k] || ''}`);
  }
  const topFell = Object.entries(p.fell).sort((a, b) => b[1] - a[1])[0];
  if (topFell) {
    const [k, n] = topFell;
    advice.push(`<b>${MOTIFS[k].label} subi${MOTIFS[k].fem ? 'e' : ''}${n > 1 ? 's' : ''} (${n}).</b> L’adversaire a trouvé ce motif après une erreur. ${TIPS[k] || ''}`);
  }
  const phaseVals = PHASES.map(([k, label]) => [label, p.phases[k]]).filter(([, v]) => v != null);
  const weakest = phaseVals.sort((a, b) => a[1] - b[1])[0];
  if (weakest && weakest[1] < 75) {
    const tips = {
      Ouverture: `Les premiers coups coûtent des points${game.opening ? ` (${game.opening})` : ''} : développe les pièces, contrôle le centre et roque tôt plutôt que de lancer des attaques prématurées.`,
      'Milieu de partie': 'Le milieu de partie est la phase la plus coûteuse : à chaque coup, cherche les échecs, les captures et les menaces avant de penser au plan.',
      Finale: 'La finale fait perdre des points : active ton Roi, crée des pions passés et compte les tempos avant d’échanger.',
    };
    advice.push(`<b>${weakest[0]} (${fmtAcc(weakest[1])} %).</b> ${tips[weakest[0]]}`);
  }
  if (p.lowClockErrors) advice.push(`<b>Gestion du temps.</b> ${p.lowClockErrors} erreur${p.lowClockErrors > 1 ? 's' : ''} commise${p.lowClockErrors > 1 ? 's' : ''} avec moins de 10 % du temps à la pendule. Garde une réserve pour la fin de partie.`);
  if (p.rushed >= 2) advice.push(`<b>Coups trop rapides.</b> ${p.rushed} erreurs jouées en moins de 3 secondes. Dans les positions tendues, prends quelques secondes de vérification.`);
  advice.push(`<b>Priorité au niveau ${LEVELS[p.levelKey].label.toLowerCase()}.</b> ${LEVEL_TIPS[p.levelKey]}`);
  out.push(section('Conseils', ul(advice)));
  return `<div class="summary">${out.join('')}</div>`;
}
