// Mise en page du commentaire d'un coup et du bilan de partie.
import * as fr from './fr.js';
import { CLASSES, CLASS_ORDER, LEVELS, negate, scoreOf } from './analysis.js';
import { describeFacts, motifLabel, motifDetail, MOTIFS, MATE_KEYS, shortIdea, playLine } from './explain.js';

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

// Chaque phrase a plusieurs tournures : la clé du coup fixe le choix, pour qu'un même coup garde
// toujours le même texte et que deux coups voisins ne se répètent pas.
const keyOf = (r) => `${r.move.before}|${r.move.lan}`;
const say = (r, slot, variants) => fr.pick(`${slot}|${keyOf(r)}`, variants);

// Conséquence du coup joué, en fin de phrase (commence par une minuscule).
function consequence(r) {
  const p = r.played;
  if (p.mated === r.me) {
    const n = Math.ceil((p.moves.length - 1) / 2);
    return say(r, 'cons-mate', [`ce coup permet un mat en ${n}.`, `le coup joué laisse un mat en ${n}.`, `l’adversaire dispose alors d’un mat en ${n}.`]);
  }
  if (p.gain <= -1 && p.material.lostText) {
    const loss = lossPhrase(p.material);
    return say(r, 'cons-loss', [`ce coup perd ${loss}.`, `le coup joué coûte ${loss}.`, `la suite fait perdre ${loss}.`]);
  }
  if (r.missedTactic && r.best.moves[0]) {
    const b = sanTag(r.best.moves[0]);
    const motif = motifLabel(r.best.motif).toLowerCase();
    return say(r, 'cons-tactic', [`il y avait mieux avec ${b} (${motif}).`, `${b} (${motif}) était plus fort.`, `le coup à trouver était ${b} (${motif}).`]);
  }
  const a = evalOf(r.before);
  const b = evalOf(r.after);
  return say(r, 'cons-eval', [`l’évaluation passe de ${a} à ${b}.`, `le moteur passe de ${a} à ${b}.`, `l’évaluation change : ${a} → ${b}.`]);
}

// La meilleure option autre que le coup joué : { move, ev }.
function altInfo(r) {
  if (!r.altBest) return null;
  const a = r.alts.find((x) => x.uci === r.altBest.pv[0]);
  const m = a && a.line.moves[0];
  return m ? { move: sanTag(m), ev: fr.evalText(whiteOf(r.altBest.score, r.me)) } : null;
}

function verdict(r, game) {
  const bm = r.best && r.best.moves[0];
  const best = bm ? sanTag(bm) : 'le coup du moteur';
  const alt = altInfo(r);
  const v = (variants) => say(r, `verdict-${r.cls}`, variants);
  // Un coup classé correct qui laisse pourtant un mat forcé : la position était déjà perdue (sinon le
  // coup serait une gaffe), mais « ce coup tient » serait faux.
  const sAfter = scoreOf(r.after);
  const sBefore = scoreOf(r.before);
  if (['excellent', 'good'].includes(r.cls) && r.after.terminal !== 'mate' && sAfter.mate > 0 && !(sBefore.mate < 0)) {
    const n = sAfter.mate;
    const lost = r.winBefore <= 10 ? 'La position était déjà perdue, mais ' : '';
    return say(r, 'verdict-allows-mate', [
      `${lost}${lost ? 'ce' : 'Ce'} coup permet un mat en ${n} ; ${best} résistait plus longtemps.`,
      `${lost}${lost ? 'ce' : 'Ce'} coup laisse un mat en ${n} ; ${best} prolongeait la résistance.`,
    ]);
  }
  switch (r.cls) {
    case 'brilliant': {
      const t = r.facts.sacrifice.t;
      const s = scoreOf(r.after);
      const mate = s.mate !== undefined && s.mate < 0 ? 1 - s.mate : null;
      const gain = mate ? `il force le mat en ${mate}` : `il mène à ${evalOf(r.after)}`;
      const result = mate ? `mat forcé en ${mate}` : `évaluation de ${evalOf(r.after)}`;
      return v([
        `Un vrai sacrifice ${fr.du(t)}, parfaitement calculé : ${gain}${alt ? `, alors que la meilleure autre option, ${alt.move}, ne donnait que ${alt.ev}` : ''}.`,
        `Sacrifice ${fr.du(t)} justifié : ${gain}.${alt ? ` Sans lui, la meilleure option, ${alt.move}, ne donnait que ${alt.ev}.` : ''}`,
        `${fr.cap(fr.le(t))} est offert${fr.e(t)} à bon escient : ${result}.${alt ? ` En comparaison, ${alt.move} ne donnait que ${alt.ev}.` : ''}`,
      ]);
    }
    case 'great': {
      // « Tenir la position » ne convient qu'à un coup défensif ; un coup qui donne l'avantage
      // « exploite » la position.
      const ahead = r.winAfter >= 60;
      if (!alt) {
        return ahead
          ? v(['Le seul coup qui exploite pleinement la position.', 'Aucune autre option ne donnait autant.'])
          : v(['Le seul coup qui tient la position.', 'Aucune autre option ne donnait autant.', 'Un coup unique : les autres options cédaient du terrain.']);
      }
      return ahead
        ? v([
          `Le seul coup qui exploite pleinement la position : la meilleure autre option, ${alt.move}, ne donnait que ${alt.ev}.`,
          `Un coup unique : les autres options laissaient filer l’avantage, la meilleure (${alt.move}) ne donnant que ${alt.ev}.`,
          `Coup précis, nettement au-dessus des autres options : ${alt.move}, deuxième choix du moteur, ne donnait que ${alt.ev}.`,
        ])
        : v([
          `Le seul coup qui tient la position. La meilleure autre option, ${alt.move}, ne donnait que ${alt.ev}.`,
          `Un coup unique : les autres options cédaient du terrain, la meilleure (${alt.move}) ne donnant que ${alt.ev}.`,
          `Coup précis, nettement au-dessus des autres options : ${alt.move}, deuxième choix du moteur, ne donnait que ${alt.ev}.`,
        ]);
    }
    case 'best':
      // « Meilleur coup » couvre aussi un coup aussi bon que le premier choix du moteur sans être le même.
      return r.isBest || !bm
        ? v(['C’est le coup que recommande le moteur.', 'Premier choix du moteur.', 'Le moteur aurait joué exactement ce coup.', 'Coup exact : c’est aussi le choix de Stockfish.'])
        : v([`Aussi fort que le premier choix du moteur (${best}).`, `Le moteur préférait ${best}, mais ce coup est tout aussi bon.`, `Équivalent au meilleur coup du moteur, ${best}.`]);
    case 'excellent':
      return v([`Très proche du meilleur coup (${best}), sans être le plus précis.`, `Presque optimal : seul ${best} faisait un peu mieux.`, `Un coup solide ; ${best} était légèrement plus précis.`]);
    case 'good': {
      const lost = fr.pct(r.loss);
      return v([
        `Jouable, mais ${best} était plus fort : ce coup cède ${lost} de chances de gain.`,
        `Correct sans plus : ${best} était préférable (${lost} de chances de gain en moins).`,
        `Ce coup tient, mais il cède ${lost} de chances de gain ; ${best} était plus précis.`,
      ]);
    }
    case 'book': {
      const op = game && game.opening ? ` (${game.opening})` : '';
      return v([
        `Coup de théorie${op} : il fait partie des lignes d’ouverture connues.`,
        `Coup connu de la théorie${op}.`,
        `Toujours dans les lignes d’ouverture connues${op}.`,
      ]);
    }
    case 'forced':
      return v(['Seul coup légal : il n’y avait pas le choix.', 'Aucun autre coup n’était possible.', 'Coup forcé : c’était le seul coup légal.']);
    case 'inaccuracy': {
      if (r.missedTactic && bm) {
        const motif = motifLabel(r.best.motif).toLowerCase();
        return v([`Un coup imprécis : ${best} (${motif}) était meilleur.`, `Imprécision : ${best} (${motif}) était plus fort.`, `Pas le plus précis : il fallait voir ${best} (${motif}).`]);
      }
      const cons = consequence(r);
      return v([`Un coup imprécis : ${best} était meilleur, ${cons}`, `Imprécision : ${best} était plus juste, et ${cons}`, `Pas le plus précis : ${best} était à préférer, ${cons}`]);
    }
    case 'mistake': {
      const cons = consequence(r);
      const hint = r.missedTactic || !bm ? '' : ` Il fallait jouer ${best}.`;
      return v([`Une erreur : ${cons}`, `Faute importante : ${cons}`, `${fr.cap(cons)}${hint}`]);
    }
    case 'blunder': {
      const cons = consequence(r);
      const hint = r.missedTactic || !bm ? '' : ` ${best} s’imposait.`;
      return v([`Une gaffe : ${cons}`, `Faute grave : ${cons}`, `${fr.cap(cons)}${hint}`]);
    }
    case 'miss': {
      // Sans gain matériel chiffré, on ne parle d'avantage « décisif » que s'il l'est (≥ 80 % de chances).
      const edge = r.winBefore >= 80 ? 'un avantage décisif' : 'un net avantage';
      const gain = r.bestMates ? `forçait le mat en ${mateIn(r.best)}` : `gagnait ${r.best.material.text || edge}`;
      return v([
        `L’adversaire venait de se tromper, mais l’occasion n’a pas été saisie : ${best} ${gain}.`,
        `Occasion manquée : après la faute adverse, ${best} ${gain}.`,
        `La faute précédente de l’adversaire reste impunie : ${best} ${gain}.`,
        `Il fallait profiter de l’erreur adverse : ${best} ${gain}.`,
      ]);
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
  const { idea, warn } = describeFacts(r.facts, keyOf(r), { bad, lost: r.winAfter < 25 });
  if (!idea.length) {
    const f = r.facts;
    const from = fr.sq(f.from);
    const to = fr.sq(f.to);
    idea.push(f.piece === 'p'
      ? say(r, 'idle-pawn', [
        `Avance le pion de ${from} à ${to} : un coup de structure, sans menace immédiate.`,
        `Le pion passe de ${from} à ${to} : coup de structure, sans menace directe.`,
        `Coup de pion (${from} → ${to}) qui modifie la structure, sans menace immédiate.`,
      ])
      : say(r, 'idle-piece', [
        `Replace ${fr.le(f.piece)} de ${from} à ${to} : un coup de manœuvre, sans menace immédiate.`,
        `${fr.cap(fr.le(f.piece))} passe de ${from} à ${to} : coup de manœuvre, sans menace directe.`,
        `Manœuvre ${fr.du(f.piece)} de ${from} vers ${to}, sans menace immédiate.`,
      ]));
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
    const pc = fr.pc(s.t, s.sq);
    const it = fr.isFem(s.t) ? 'la' : 'le';
    const parts = [say(r, 'sac-offer', [
      `${fr.cap(pc)} est offert${fr.e(s.t)}.`,
      `Le sacrifice porte sur ${pc}.`,
      `${fr.cap(pc)} est laissé${fr.e(s.t)} en prise volontairement.`,
    ])];
    if (accept) {
      const mated = accept.score.mate !== undefined && accept.score.mate < 0 ? fr.plural(-accept.score.mate, 'coup') : null;
      const ev = fr.evalText(whiteOf(accept.score, r.them));
      parts.push(mated
        ? say(r, 'sac-accept', [
          `Si ${fr.side(r.them)} acceptent, le mat suit en ${mated} :`,
          `Après la prise, le mat suit en ${mated} :`,
          `Si le sacrifice est accepté, mat en ${mated} :`,
        ])
        : say(r, 'sac-accept', [
          `Si ${fr.side(r.them)} acceptent, la suite donne ${ev} :`,
          `Après la prise, le moteur donne ${ev} :`,
          `Si le sacrifice est accepté, l’évaluation devient ${ev} :`,
        ]));
      const moves = playLine(r.move.after, accept.pv, 10).moves;
      out.push(section('Pourquoi ce sacrifice fonctionne', `<p>${parts.join(' ')}</p>${lineHtml(registry, { fen: r.move.after, moves })}`, 'good'));
    } else {
      parts.push(say(r, 'sac-decline', [
        `${fr.cap(it)} prendre serait une erreur pour ${fr.side(r.them)} : le moteur préfère ne pas l’accepter.`,
        `${fr.Side(r.them)} ont intérêt à refuser : la prise leur coûterait encore plus.`,
        `Le moteur conseille ${fr.auxSide(r.them)} de ne pas ${it} prendre.`,
      ]));
      out.push(section('Pourquoi ce sacrifice fonctionne', `<p>${parts.join(' ')}</p>`, 'good'));
    }
  } else if (r.cls === 'great' && r.alts.length >= 2) {
    const rows = fr.list(r.alts.slice(1).map((a) => `${sanTag(a.line.moves[0])} ne donnait que ${fr.evalText(whiteOf(a.score, r.me))}`));
    out.push(section('Pourquoi c’est le seul bon coup', `<p>${say(r, 'great-why', [
      `Les autres options étaient nettement moins bonnes : ${rows}.`,
      `Les alternatives restaient loin derrière : ${rows}.`,
      `Comparaison avec les autres choix du moteur : ${rows}.`,
    ])}</p>`, 'good'));
  }

  // Faiblesses et réfutation
  if (bad || r.loss > T.good) {
    if (warn.length) out.push(section('Les points faibles', ul(warn), 'warn'));
    if (r.reply && r.reply.moves.length && r.cls !== 'miss') {
      const first = r.reply.moves[0];
      const m = r.reply.motif;
      if (m) motifsSeen.add(m.key);
      const tag = sanTag(first);
      // C'est la meilleure réponse selon le moteur, pas forcément celle jouée dans la partie.
      let txt = say(r, 'reply-intro', [`La meilleure réponse est ${tag}`, `${fr.Side(r.them)} peuvent répondre ${tag}`, `${fr.Side(r.them)} disposent de ${tag}`]);
      // Un mat se dit avec sa longueur (« 44…Th1+ : mat » laisserait croire que Th1+ mate déjà).
      const mates = !!m && MATE_KEYS.includes(m.key);
      if (mates) {
        const n = fr.plural(Math.ceil(r.reply.moves.length / 2), 'coup');
        const label = MOTIFS[m.key].label.toLowerCase();
        txt += say(r, 'reply-mate-motif', [`, qui force le <b>${label}</b> en ${n}`, ` : <b>${label}</b> forcé en ${n}`]);
      } else if (m) {
        const det = motifDetail(m);
        // Motif apparu plus loin dans la variante : on nomme le coup qui le crée.
        const later = m.ply > 0 && m.f && r.reply.moves[m.ply] ? ` avec ${sanTag(r.reply.moves[m.ply])}` : '';
        txt += ` : <b>${motifLabel(m).toLowerCase()}</b>${later}${det ? ` (${det})` : ''}`;
      }
      txt += '. ';
      const p = r.played;
      if (p.mated === r.me) {
        const n = fr.plural(Math.ceil((p.moves.length - 1) / 2), 'coup');
        if (!mates) txt += say(r, 'reply-mate', [`Le mat suit en ${n}.`, `Mat en ${n} ensuite.`, `La suite mène au mat en ${n}.`]);
      } else if (p.gain <= -1 && p.material.lostText) {
        const loss = lossPhrase(p.material);
        const forms = [
          `Au bout de la variante, ${fr.side(r.me)} perdent ${loss}.`,
          `Bilan de la variante : ${fr.side(r.me)} perdent ${loss}.`,
        ];
        // « coûte une Dame contre un Fou aux Noirs » se lit mal : tournure réservée aux pertes simples.
        if (!p.material.gainedText) forms.push(`La variante coûte ${loss} ${fr.auxSide(r.me)}.`);
        txt += say(r, 'reply-loss', forms);
      } else {
        const a = evalOf(r.before);
        const b = evalOf(r.after);
        txt += say(r, 'reply-eval', [
          `Sans perte de matériel immédiate, mais la position bascule : ${a} → ${b}.`,
          `Pas de perte matérielle directe, mais l’évaluation passe de ${a} à ${b}.`,
          `Le matériel reste égal, mais la position se dégrade : ${a} → ${b}.`,
        ]);
      }
      // Ce qui s'est passé dans la partie (seulement pour un coup de la partie, pas pour un essai).
      const own = game && game.moves[r.ply];
      const next = own && own.before === r.move.before && own.lan === r.move.lan ? game.moves[r.ply + 1] : null;
      if (next) {
        txt += next.lan === first.lan
          ? say(r, 'reply-played', [' Elle a été jouée dans la partie.', ' C’est ce que l’adversaire a joué.', ' L’adversaire l’a trouvée.'])
          : say(r, 'reply-missed', [` Dans la partie, ${fr.side(r.them)} ont joué ${sanTag(next)}.`, ` L’adversaire a joué ${sanTag(next)} à la place.`, ` Dans la partie, ce fut ${sanTag(next)}.`]);
      }
      out.push(section('La réponse qui punit', `<p>${txt.replace(/ {2,}/g, ' ').trim()}</p>${lineHtml(registry, r.reply)}`, 'warn'));
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
      // Motif apparu plus loin dans la variante : on nomme le coup qui le crée.
      const later = m.ply > 0 && m.f && b.moves[m.ply] ? `, puis ${sanTag(b.moves[m.ply])}` : '';
      const parts = [`${sanTag(bm)}${later}${det ? ` : ${det}` : ''}.`];
      if (r.bestMates) {
        const n = fr.plural(mateIn(b), 'coup');
        parts.push(say(r, 'tac-mate', [`La suite force le mat en ${n}.`, `Mat forcé en ${n}.`, `La variante se termine par un mat en ${n}.`]));
      } else if (b.material.text) {
        parts.push(say(r, 'tac-gain', [
          `Au bout de la variante, ${fr.side(r.me)} gagnent ${b.material.text}.`,
          `Gain de la variante : ${b.material.text}.`,
          `${fr.Side(r.me)} y gagnent ${b.material.text}.`,
        ]));
      }
      const after = evalOf(r.after);
      parts.push(say(r, 'tac-eval', [
        `Évaluation : ${bestEval} au lieu de ${after}.`,
        `Le moteur donnait ${bestEval}, contre ${after} après le coup joué.`,
        `${bestEval} au lieu de ${after}.`,
      ]));
      const txt = parts.join(' ');
      let diff = '';
      if (r.difficulty) {
        const v = r.difficultyVerdict;
        diff = `<p class="diff diff-${v.key}"><span class="diff-num">≈ ${r.difficulty}</span><span>Difficulté estimée de la tactique. ${v.text}</span></p>`;
      }
      // « Gain de matériel » sans gain chiffré (variante coupée avant les coups de dépit) : pas d'étiquette.
      const title = m.key === 'material' && !(b.gain >= 2) ? 'Tactique manquée' : `Tactique manquée · ${motifLabel(m)}`;
      out.push(section(title, `<p>${txt}</p>${lineHtml(registry, b)}${diff}`, 'missed'));
    } else {
      const ideas = describeFacts(b.facts[0] || {}, `best|${keyOf(r)}`).idea.slice(0, 3);
      const tag = sanTag(bm);
      const lead = say(r, 'best-lead', [`${tag} (${bestEval}) était préférable.`, `Mieux valait ${tag} (${bestEval}).`, `Le moteur proposait ${tag} (${bestEval}).`]);
      const body = `<p>${lead}</p>${ideas.length ? ul(ideas) : ''}${lineHtml(registry, b, { label: 'Suite' })}`;
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
    const tag = sanTag(first);
    let txt = say(r, 'next-intro', [`${fr.Side(r.them)} devraient répondre ${tag}`, `Réponse attendue : ${tag}`, `Le moteur attend ${tag}`]);
    const idea2 = shortIdea(r.reply);
    txt += idea2 ? ` (${idea2}).` : '.';
    if (r.facts.mateThreat) {
      const san = fr.sanFr(r.facts.mateThreat);
      txt += say(r, 'next-threat', [
        ` Ils doivent surtout parer la menace ${san} mat.`,
        ` Priorité pour eux : parer la menace ${san} mat.`,
        ` La menace ${san} mat doit être parée en premier.`,
      ]);
    }
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
  parts.push(`<ul class="intro-keys"><li><kbd>←</kbd><kbd>→</kbd> coup précédent / suivant</li><li><kbd>Échap</kbd> revenir à la partie après une variante</li><li>Fais glisser une pièce (ou clique dessus) pour tester ton propre coup</li><li>Clique sur un coup d’une variante pour l’afficher</li></ul>`);
  return `<article class="cmt cmt-intro">${parts.join('')}</article>`;
}

export function pendingHtml(text) {
  return `<article class="cmt cmt-pending"><div class="spinner" aria-hidden="true"></div><p>${text}</p></article>`;
}

// ---------- Bilan ----------

const PHASES = [['opening', 'Ouverture'], ['middlegame', 'Milieu de partie'], ['endgame', 'Finale']];

// Conseils par motif, en plusieurs tournures.
const TIPS = {
  fork: [
    'Cherche les cases d’où une seule pièce (souvent un Cavalier) attaque deux pièces mal protégées ou le Roi et une pièce.',
    'Repère les pièces adverses non protégées et le Roi : une case qui touche deux de ces cibles annonce une fourchette.',
    'Les Cavaliers sont les spécialistes de la fourchette : vérifie toujours leurs cases d’arrivée possibles.',
  ],
  pin: [
    'Quand une pièce adverse se trouve devant son Roi ou sa Dame sur une même ligne, demande-toi si un Fou ou une Tour peut la clouer.',
    'Une pièce placée entre un Fou, une Tour ou une Dame et une pièce plus importante est une cible de clouage.',
  ],
  skewer: [
    'Repère le Roi et la Dame alignés sur une colonne, une rangée ou une diagonale : une attaque en ligne peut les « embrocher ».',
    'Deux pièces de valeur sur une même ligne invitent à l’enfilade : attaque la plus forte, la seconde tombe.',
  ],
  discovered: [
    'Regarde les pièces placées devant tes Fous, Tours et Dame : les déplacer avec une menace crée deux attaques d’un coup.',
    'Une pièce qui masque une ligne de ta Dame ou de ta Tour est une arme : en bougeant, elle peut créer deux menaces.',
  ],
  doubleCheck: [
    'Les échecs à la découverte sont encore plus forts quand la pièce qui bouge donne aussi échec.',
    'Un échec double ne se pare qu’en déplaçant le Roi : cherche-le dès qu’un échec à la découverte est possible.',
  ],
  removal: [
    'Demande-toi quelle pièce adverse en protège une autre, puis comment la capturer ou la détourner.',
    'Identifie les défenseurs clés : en éliminer un suffit souvent à faire tomber la pièce qu’il protégeait.',
  ],
  free: [
    'Après chaque coup adverse, fais le tour des pièces adverses : lesquelles ne sont plus protégées ?',
    'Avant de jouer, vérifie si une pièce adverse peut être prise sans contrepartie.',
    'Un rapide inventaire des pièces non défendues, à chaque coup, évite de laisser passer du matériel gratuit.',
  ],
  mate: [
    'Entraîne-toi aux mats en 1 et en 2 : commence toujours par examiner tous les échecs possibles.',
    'Quand le Roi adverse manque de cases, passe en revue chaque échec : le mat est souvent là.',
  ],
  backrank: [
    'Quand le Roi adverse n’a pas de case de fuite derrière ses pions, une Tour sur la dernière rangée peut suffire.',
    'Un Roi bloqué derrière ses pions sur la dernière rangée est exposé au mat du couloir : surveille cette rangée.',
  ],
  smothered: [
    'Un Roi entouré de ses pièces est vulnérable aux échecs de Cavalier.',
    'Quand le Roi adverse est enfermé par ses propres pièces, cherche un échec de Cavalier.',
  ],
  sacrifice: [
    'Les sacrifices se trouvent en calculant les coups forcés (échecs, captures) même quand ils donnent du matériel.',
    'Ne rejette pas un coup parce qu’il donne du matériel : calcule d’abord la suite forcée.',
  ],
  promotion: [
    'Un pion proche de la promotion vaut souvent plus qu’une pièce : compte les tempos jusqu’à la dame.',
    'Près de la promotion, compte les coups nécessaires de chaque côté avant d’échanger ou de défendre.',
  ],
  material: [
    'Avant de jouer, compte les attaquants et les défenseurs de chaque pièce menacée.',
    'Sur chaque case disputée, compare le nombre d’attaquants et de défenseurs avant de t’engager.',
  ],
  mateThreat: [
    'Avant chaque coup, demande-toi si l’adversaire menace de mater au coup suivant.',
    'Vérifie à chaque coup les échecs dont dispose l’adversaire : une menace de mat passe vite inaperçue.',
  ],
};

const LEVEL_TIPS = {
  debutant: [
    'À ce niveau, la plupart des parties se décident sur des pièces laissées en prise. Avant chaque coup, fais la vérification « échecs, captures, menaces », pour toi et pour l’adversaire.',
    'Les parties se jouent surtout sur le matériel laissé en prise. Prends l’habitude de vérifier, avant chaque coup, ce que ton coup laisse sans défense et ce que menace l’adversaire.',
  ],
  intermediaire: [
    'Travaille les tactiques en deux coups (fourchettes, clouages, attaques à la découverte) : une dizaine de problèmes par jour suffit pour progresser vite.',
    'Les tactiques courtes font la différence à ce niveau : une dizaine de problèmes par jour sur les fourchettes, clouages et attaques à la découverte.',
  ],
  confirme: [
    'Liste tes coups candidats et calcule les variantes forcées jusqu’au bout avant de jouer. Soigne aussi le plan de milieu de partie après l’ouverture.',
    'Avant de jouer, compare deux ou trois coups candidats et calcule les suites forcées jusqu’au bout. Après l’ouverture, fixe-toi un plan clair.',
  ],
  expert: [
    'Les points se perdent surtout dans la conversion des avantages et la défense des positions difficiles. Rejoue tes moments critiques sans moteur avant de vérifier.',
    'À ce niveau, la conversion des avantages et la défense des positions inférieures décident souvent. Analyse d’abord tes moments critiques sans moteur.',
  ],
};

const PHASE_TIPS = {
  opening: (op) => [
    `Les premiers coups coûtent des points${op} : développe les pièces, contrôle le centre et roque tôt plutôt que de lancer des attaques prématurées.`,
    `L’ouverture fait perdre du terrain${op} : priorité au développement, au centre et à la sécurité du Roi.`,
  ],
  middlegame: () => [
    'Le milieu de partie est la phase la plus coûteuse : à chaque coup, cherche les échecs, les captures et les menaces avant de penser au plan.',
    'Le milieu de partie concentre les pertes : avant chaque coup, passe en revue échecs, captures et menaces.',
  ],
  endgame: () => [
    'La finale fait perdre des points : active ton Roi, crée des pions passés et compte les tempos avant d’échanger.',
    'Les points partent en finale : Roi actif, pions passés, et calcul des tempos avant chaque échange.',
  ],
};

// « Clouages manqués (3) », « Fourchette subie (1) » : nom et participe accordés.
function motifCount(k, n, participle) {
  const m = MOTIFS[k];
  return `${n > 1 ? m.pl || m.label : m.label} ${participle}${m.fem ? 'e' : ''}${n > 1 ? 's' : ''} (${n})`;
}

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
  // Tournures du bilan : fixes pour une partie et un joueur donnés.
  const tell = (slot, variants) => fr.pick(`${slot}|${game.white.name}|${game.black.name}|${game.moves.length}|${focus}`, variants);

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
      else if (r.played.mated === r.me) why = say(r, 'km-mate', ['permet un mat', 'laisse un mat']);
      else if (r.played.gain <= -1 && r.played.material.lostText) {
        const loss = lossPhrase(r.played.material);
        why = say(r, 'km-loss', [`perd ${loss}`, `coûte ${loss}`]);
      } else if (r.missedTactic) {
        const motif = motifLabel(r.best.motif).toLowerCase();
        why = say(r, 'km-miss', [`manque : ${motif}`, `laisse passer : ${motif}`]);
      } else why = `${evalOf(r.before)} → ${evalOf(r.after)}`;
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
    out.push(section('Tactiques manquées', `<p>${tell('no-miss', [
      'Aucune tactique gagnante n’a été manquée dans cette partie.',
      'Aucune tactique gagnante n’est passée inaperçue.',
      'Toutes les tactiques gagnantes ont été trouvées.',
    ])}</p>`));
  }

  const advice = [];
  if (p.hung) {
    const n = p.hung;
    const errs = `${n} erreur${n > 1 ? 's' : ''}`;
    advice.push(`<b>Sécurité des pièces.</b> ${tell('hung', [
      `${errs} vien${n > 1 ? 'nent' : 't'} d’une pièce laissée sans défense ou d’une menace ignorée. Avant chaque coup, demande-toi : qu’est-ce que mon coup laisse sans protection, et que menace l’adversaire ?`,
      `${errs} : pièce laissée sans défense ou menace ignorée. Avant de jouer, vérifie ce que ton coup laisse sans protection et ce que menace l’adversaire.`,
      `Une pièce non défendue ou une menace non traitée explique ${errs}. Un dernier contrôle avant chaque coup suffit souvent à l’éviter.`,
    ])}`);
  }
  const topMissed = Object.entries(p.themes).sort((a, b) => b[1] - a[1])[0];
  if (topMissed) {
    const [k, n] = topMissed;
    advice.push(`<b>${motifCount(k, n, 'manqué')}.</b> ${TIPS[k] ? tell(`tip-miss-${k}`, TIPS[k]) : ''}`);
  }
  const topFell = Object.entries(p.fell).sort((a, b) => b[1] - a[1])[0];
  if (topFell) {
    const [k, n] = topFell;
    const lead = tell('fell', [
      'L’adversaire a trouvé ce motif après une erreur.',
      'C’est le motif que l’adversaire a exploité après une faute.',
      'L’adversaire en a profité après une erreur.',
    ]);
    advice.push(`<b>${motifCount(k, n, 'subi')}.</b> ${lead} ${TIPS[k] ? tell(`tip-fell-${k}`, TIPS[k]) : ''}`);
  }
  const phaseVals = PHASES.map(([k, label]) => [k, label, p.phases[k]]).filter(([, , v]) => v != null);
  const weakest = phaseVals.sort((a, b) => a[2] - b[2])[0];
  if (weakest && weakest[2] < 75) {
    const [k, label, v] = weakest;
    advice.push(`<b>${label} (${fmtAcc(v)} %).</b> ${tell(`phase-${k}`, PHASE_TIPS[k](game.opening ? ` (${game.opening})` : ''))}`);
  }
  if (p.lowClockErrors) {
    const n = p.lowClockErrors;
    const errs = `${n} erreur${n > 1 ? 's' : ''} commise${n > 1 ? 's' : ''}`;
    advice.push(`<b>Gestion du temps.</b> ${tell('clock', [
      `${errs} avec moins de 10 % du temps à la pendule. Garde une réserve pour la fin de partie.`,
      `${errs} dans les dernières secondes (moins de 10 % du temps). Une meilleure répartition du temps limiterait ces fautes.`,
    ])}`);
  }
  if (p.rushed >= 2) {
    advice.push(`<b>Coups trop rapides.</b> ${tell('rushed', [
      `${p.rushed} erreurs jouées en moins de 3 secondes. Dans les positions tendues, prends quelques secondes de vérification.`,
      `${p.rushed} erreurs jouées en moins de 3 secondes : dans les positions tendues, une courte vérification aurait suffi.`,
    ])}`);
  }
  advice.push(`<b>Priorité au niveau ${LEVELS[p.levelKey].label.toLowerCase()}.</b> ${tell('level', LEVEL_TIPS[p.levelKey])}`);
  out.push(section('Conseils', ul(advice)));
  return `<div class="summary">${out.join('')}</div>`;
}
