// Reconnaissance des motifs tactiques et des idées d'un coup, puis mise en mots.
import { Chess } from '../vendor/chess.js';
import {
  parseFen, attacksFrom, attackersOf, see, VALUE, sqName, sqIndex, opp,
  linesBy, isPassed, fileStatus, findKing,
} from './position.js';
import * as fr from './fr.js';

export const MOTIFS = {
  mate: { label: 'Mat', def: 'Le Roi est en échec et n’a aucun moyen d’y échapper : la partie s’arrête.' },
  backrank: { label: 'Mat du couloir', def: 'Le Roi est enfermé sur sa dernière rangée par ses propres pions : une Tour ou une Dame qui arrive sur cette rangée le mate.' },
  smothered: { label: 'Mat à l’étouffée', def: 'Le Roi est entouré de ses propres pièces et un Cavalier lui donne échec : il n’a aucune case de fuite.' },
  fork: { label: 'Fourchette', fem: true, def: 'Une seule pièce attaque deux cibles en même temps. L’adversaire ne peut en sauver qu’une.' },
  pin: { label: 'Clouage', def: 'Une pièce ne peut pas bouger (ou ne doit pas) car elle protège une pièce plus importante placée derrière elle, souvent le Roi.' },
  skewer: { label: 'Enfilade', fem: true, def: 'Une pièce de valeur est attaquée sur une ligne. Quand elle s’écarte, la pièce placée derrière elle tombe.' },
  discovered: { label: 'Attaque à la découverte', fem: true, def: 'En bougeant, une pièce démasque l’attaque d’un Fou, d’une Tour ou d’une Dame placé(e) derrière elle. Deux menaces partent d’un seul coup.' },
  doubleCheck: { label: 'Échec double', def: 'Deux pièces donnent échec en même temps. La seule défense est de déplacer le Roi.' },
  removal: { label: 'Élimination du défenseur', fem: true, def: 'On capture la pièce qui en protégeait une autre. Celle-ci se retrouve sans défense.' },
  free: { label: 'Pièce en prise', fem: true, def: 'Une pièce adverse n’est pas assez protégée : on peut la prendre sans rien perdre en retour.' },
  sacrifice: { label: 'Sacrifice', def: 'On donne volontairement du matériel pour obtenir plus : une attaque décisive, un mat ou un gain de matériel plus loin.' },
  promotion: { label: 'Promotion', fem: true, def: 'Un pion qui atteint la dernière rangée se transforme en Dame (ou en une autre pièce).' },
  mateThreat: { label: 'Menace de mat', fem: true, def: 'Le coup prépare un mat au coup suivant : l’adversaire doit s’en occuper immédiatement.' },
  material: { label: 'Gain de matériel', def: 'Une suite de coups forcée qui rapporte du matériel.' },
  threat: { label: 'Double menace', fem: true, def: 'Un coup qui crée deux menaces à la fois : l’adversaire ne peut pas parer les deux.' },
};

export const MATE_KEYS = ['mate', 'backrank', 'smothered'];

// Joue une suite de coups UCI ; s'arrête au premier coup illégal.
export function playLine(fen, uciList, max = 12) {
  const chess = new Chess(fen);
  const moves = [];
  for (const u of uciList.slice(0, max)) {
    let m = null;
    try {
      m = chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
    } catch {
      m = null;
    }
    if (!m) break;
    moves.push(m);
  }
  return { chess, moves };
}

export function findMateIn1(fen, color) {
  const parts = fen.split(' ');
  parts[1] = color;
  parts[3] = '-';
  let chess;
  try {
    chess = new Chess(parts.join(' '), { skipValidation: true });
  } catch {
    return null;
  }
  for (const m of chess.moves({ verbose: true })) {
    chess.move({ from: m.from, to: m.to, promotion: m.promotion });
    const mate = chess.isCheckmate();
    chess.undo();
    if (mate) return m.san;
  }
  return null;
}

// Tout ce qu'on peut dire d'un coup en regardant la position avant et après.
export function moveFacts(move, ply = 0) {
  const A = parseFen(move.before);
  const B = parseFen(move.after);
  const me = move.color;
  const them = opp(me);
  const from = sqIndex(move.from);
  const to = sqIndex(move.to);
  const t = move.promotion || move.piece;
  const f = {
    me, them, piece: move.piece, t, from: move.from, to: move.to, san: move.san,
    threats: [], discovered: [], lines: [], hangs: [], ignored: [], saved: [], removal: [],
  };

  f.mate = move.san.includes('#');
  f.check = f.mate || move.san.includes('+');
  if (f.check) {
    const k = findKing(B, them);
    const checkers = attackersOf(B, k, me);
    f.doubleCheck = checkers.length >= 2;
    f.discoveredCheck = !checkers.includes(to);
    f.checkers = checkers.map((i) => ({ t: B.sq[i].t, sq: sqName(i) }));
  }

  if (move.captured) {
    const capIdx = move.flags.includes('e') ? to + (me === 'w' ? -8 : 8) : to;
    const recapture = Math.max(0, see(B, to, them));
    f.capture = {
      t: move.captured,
      sq: sqName(capIdx),
      idx: capIdx,
      recapture,
      net: VALUE[move.captured] - recapture,
      undefended: attackersOf(A, capIdx, them).length === 0,
    };
  }

  if (move.flags.includes('k')) f.castle = 'k';
  else if (move.flags.includes('q')) f.castle = 'q';
  if (move.promotion) f.promotion = move.promotion;
  const home = me === 'w' ? 0 : 7;
  if ((move.piece === 'n' || move.piece === 'b') && from >> 3 === home && ply < 30) f.development = true;
  if (move.piece === 'p' && ['d4', 'e4', 'd5', 'e5'].includes(move.to) && ply < 24) f.center = true;
  if (!'pk'.includes(move.piece)) {
    f.mobility = { before: attacksFrom(A, from).length, after: attacksFrom(B, to).length };
  }

  // Nouvelles menaces : pièces adverses qu'on peut maintenant gagner.
  for (let j = 0; j < 64; j++) {
    const q = B.sq[j];
    if (!q || q.c !== them || q.t === 'k') continue;
    const gain = see(B, j, me);
    if (gain <= 0) continue;
    const qa = A.sq[j];
    if (qa && qa.c === them && qa.t === q.t && see(A, j, me) > 0) continue;
    const atk = attackersOf(B, j, me);
    f.threats.push({ t: q.t, sq: sqName(j), idx: j, gain, byMoved: atk.includes(to) });
  }
  if (f.capture) {
    const guarded = attacksFrom(A, f.capture.idx);
    f.removal = f.threats.filter((th) => guarded.includes(th.idx));
  }

  // Fourchette : la pièce jouée attaque au moins deux cibles intéressantes.
  const prongs = [];
  for (const j of attacksFrom(B, to)) {
    const q = B.sq[j];
    if (!q || q.c !== them || q.t === 'p') continue;
    if (q.t === 'k') prongs.push({ t: 'k', sq: sqName(j) });
    else if (VALUE[q.t] > VALUE[t] || attackersOf(B, j, them).length === 0) prongs.push({ t: q.t, sq: sqName(j) });
  }
  if (prongs.length >= 2 && see(B, to, them) <= 0) f.fork = { t, sq: move.to, targets: prongs };

  // Attaques à la découverte.
  for (let s = 0; s < 64; s++) {
    const p = B.sq[s];
    if (!p || p.c !== me || s === to || !'brq'.includes(p.t)) continue;
    const pa = A.sq[s];
    if (!pa || pa.c !== me || pa.t !== p.t) continue;
    const before = new Set(attacksFrom(A, s));
    for (const j of attacksFrom(B, s)) {
      if (before.has(j)) continue;
      const q = B.sq[j];
      if (!q || q.c !== them) continue;
      if (q.t === 'k' || see(B, j, me) > 0 || VALUE[q.t] > VALUE[p.t]) {
        f.discovered.push({ by: p.t, bySq: sqName(s), t: q.t, sq: sqName(j) });
      }
    }
  }

  // Clouages et enfilades nouvellement créés.
  const key = (x) => `${x.kind}:${x.pinned ?? x.front}:${x.behind}`;
  const old = new Set(linesBy(A, me).map(key));
  for (const x of linesBy(B, me)) {
    if (old.has(key(x))) continue;
    if (see(B, x.by, them) > 0) continue;
    const slider = B.sq[x.by];
    if (x.kind === 'pin') {
      f.lines.push({
        kind: 'pin', absolute: x.absolute, by: slider.t, bySq: sqName(x.by),
        t: B.sq[x.pinned].t, sq: sqName(x.pinned), behindT: B.sq[x.behind].t, behindSq: sqName(x.behind),
      });
    } else {
      const behind = B.sq[x.behind];
      if (attackersOf(B, x.behind, them).length && VALUE[behind.t] <= VALUE[slider.t]) continue;
      f.lines.push({
        kind: 'skewer', by: slider.t, bySq: sqName(x.by),
        t: B.sq[x.front].t, sq: sqName(x.front), behindT: behind.t, behindSq: sqName(x.behind),
      });
    }
  }

  // Nos pièces : laissées en prise, menaces ignorées, pièces sauvées.
  for (let j = 0; j < 64; j++) {
    const q = B.sq[j];
    if (!q || q.c !== me || q.t === 'k') continue;
    let loss = see(B, j, them);
    if (j === to && move.captured) loss -= VALUE[move.captured];
    if (loss <= 0) continue;
    const origin = j === to ? from : j;
    const qa = A.sq[origin];
    const lossBefore = qa && qa.c === me ? see(A, origin, them) : 0;
    if (lossBefore > 0 && j !== to) f.ignored.push({ t: q.t, sq: sqName(j), loss });
    else f.hangs.push({ t: q.t, sq: sqName(j), loss, moved: j === to, unguarded: j !== to && attacksFrom(A, from).includes(j) });
  }
  for (let j = 0; j < 64; j++) {
    const qa = A.sq[j];
    if (!qa || qa.c !== me || qa.t === 'k' || see(A, j, them) <= 0) continue;
    const now = j === from ? to : j;
    const q = B.sq[now];
    if (q && q.c === me && see(B, now, them) <= 0) f.saved.push({ t: qa.t, sq: sqName(j), moved: j === from });
  }

  // Sacrifice : on laisse volontairement au moins 2 points de matériel.
  const got = move.captured ? VALUE[move.captured] : 0;
  const movedLoss = Math.max(0, see(B, to, them)) - got;
  let other = null;
  for (const h of f.hangs) if (!h.moved && (!other || h.loss > other.loss)) other = h;
  const otherLoss = other ? other.loss - got : 0;
  if (Math.max(movedLoss, otherLoss) >= 2) {
    f.sacrifice = movedLoss >= otherLoss
      ? { t, sq: move.to, value: movedLoss }
      : { t: other.t, sq: other.sq, value: otherLoss };
  }

  if (move.piece === 'p' && !move.promotion && isPassed(B, to)) {
    const rel = me === 'w' ? to >> 3 : 7 - (to >> 3);
    if (!isPassed(A, from)) f.passed = { created: true, sq: move.to, rel };
    else if (rel >= 4) f.passed = { created: false, sq: move.to, rel };
  }
  if (move.piece === 'r' && !f.castle && (from & 7) !== (to & 7)) {
    const st = fileStatus(B, to & 7, me);
    if (st) f.file = { status: st, file: 'abcdefgh'[to & 7] };
  }
  if (move.piece === 'k' && !f.castle) {
    const rights = me === 'w' ? /[KQ]/.test(A.castling) : /[kq]/.test(A.castling);
    if (rights) f.loseCastle = true;
  }
  if (!f.check) {
    const mate = findMateIn1(move.after, me);
    if (mate) f.mateThreat = mate;
  }
  return f;
}

const KING_STEPS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

function matePattern(fen, mated) {
  const pos = parseFen(fen);
  const k = findKing(pos, mated);
  const attackers = attackersOf(pos, k, opp(mated));
  if (attackers.length !== 1) return 'mate';
  const a = pos.sq[attackers[0]];
  if (a.t === 'n') {
    let boxed = true;
    for (const [df, dr] of KING_STEPS) {
      const f = (k & 7) + df;
      const r = (k >> 3) + dr;
      if (f < 0 || f > 7 || r < 0 || r > 7) continue;
      const q = pos.sq[r * 8 + f];
      if (!q || q.c !== mated) { boxed = false; break; }
    }
    if (boxed) return 'smothered';
  }
  const back = mated === 'w' ? 0 : 7;
  if ((a.t === 'r' || a.t === 'q') && k >> 3 === back && attackers[0] >> 3 === back) return 'backrank';
  return 'mate';
}

// Joue une variante et en tire le bilan : matériel, mat, motif principal.
export function analyzeLine(fen, pv, { max = 12 } = {}) {
  const { chess, moves } = playLine(fen, pv || [], max);
  const pov = fen.split(' ')[1];
  const ledger = { mine: [], lost: [] };
  const running = [];
  let net = 0;
  for (const m of moves) {
    const sign = m.color === pov ? 1 : -1;
    if (m.captured) {
      (sign > 0 ? ledger.mine : ledger.lost).push(m.captured);
      net += sign * VALUE[m.captured];
    }
    if (m.promotion) {
      if (sign > 0) { ledger.mine.push(m.promotion); ledger.lost.push('p'); } else { ledger.lost.push(m.promotion); ledger.mine.push('p'); }
      net += sign * (VALUE[m.promotion] - 1);
    }
    running.push(net);
  }
  const last = moves[moves.length - 1];
  if (last && last.captured && !chess.isGameOver()) {
    const end = parseFen(chess.fen());
    const idx = sqIndex(last.to);
    const stm = chess.turn();
    const g = see(end, idx, stm);
    if (g > 0) {
      const sign = stm === pov ? 1 : -1;
      net += sign * g;
      if (g >= VALUE[end.sq[idx].t]) (sign > 0 ? ledger.mine : ledger.lost).push(end.sq[idx].t);
    }
  }
  const mated = chess.isCheckmate() ? chess.turn() : null;
  const facts = [];
  for (let k = 0; k < moves.length && k < 6; k += 2) facts[k] = moveFacts(moves[k], 99);
  let realise = moves.length - 1;
  if (net >= 1) {
    const k = running.findIndex((v) => v >= net - 0.5);
    if (k >= 0) realise = k;
  }
  const line = {
    fen, pov, moves, net, mated, facts, realise,
    pattern: mated ? matePattern(chess.fen(), mated) : null,
    material: fr.trade(ledger.mine, ledger.lost),
  };
  line.motif = pickMotif(line);
  return line;
}

const STRONG = ['doubleCheck', 'fork', 'skewer', 'pin', 'discovered', 'removal'];

function motifOf(f) {
  if (!f) return null;
  if (f.doubleCheck) return { key: 'doubleCheck', f };
  if (f.fork) return { key: 'fork', f };
  if (f.lines.some((l) => l.kind === 'skewer')) return { key: 'skewer', f };
  if (f.lines.some((l) => l.kind === 'pin')) return { key: 'pin', f };
  if (f.discovered.length || f.discoveredCheck) return { key: 'discovered', f };
  if (f.removal.length) return { key: 'removal', f };
  return null;
}

function pickMotif(line) {
  const first = line.facts[0];
  const sacrifice = !!(first && first.sacrifice);
  if (line.mated && line.mated !== line.pov) {
    return { key: line.pattern || 'mate', ply: line.moves.length - 1, sacrifice, mateIn: Math.ceil(line.moves.length / 2) };
  }
  for (let k = 0; k < line.facts.length; k += 2) {
    if (k > line.realise + 1) break;
    const m = motifOf(line.facts[k]);
    if (m && STRONG.includes(m.key)) return { ...m, ply: k, sacrifice };
  }
  if (first && first.capture && first.capture.net >= 1 && line.net >= 1) return { key: 'free', f: first, ply: 0, sacrifice: false };
  if (line.moves.some((m, k) => k % 2 === 0 && m.promotion) && line.net >= 3) return { key: 'promotion', ply: 0, sacrifice };
  if (sacrifice && line.net >= 0) return { key: 'sacrifice', f: first, ply: 0, sacrifice };
  if (first && first.mateThreat) return { key: 'mateThreat', f: first, ply: 0, sacrifice };
  if (line.net >= 2) return { key: 'material', ply: 0, sacrifice };
  return null;
}

export function motifLabel(m) {
  if (!m) return '';
  const base = MOTIFS[m.key]?.label || '';
  if (m.sacrifice && m.key !== 'sacrifice') return `Sacrifice + ${base.toLowerCase()}`;
  return base;
}

// Détail en une phrase du motif (qui attaque quoi).
export function motifDetail(m) {
  if (!m || !m.f) return '';
  const f = m.f;
  switch (m.key) {
    case 'fork':
      return `${fr.cap(fr.pc(f.fork.t, f.fork.sq))} attaque à la fois ${fr.list(f.fork.targets.map((x) => fr.pc(x.t, x.sq)))}`;
    case 'pin': {
      const l = f.lines.find((x) => x.kind === 'pin');
      return l.absolute
        ? `${fr.cap(fr.pc(l.by, l.bySq))} cloue ${fr.pc(l.t, l.sq)} sur son Roi`
        : `${fr.cap(fr.pc(l.by, l.bySq))} cloue ${fr.pc(l.t, l.sq)} devant ${fr.pc(l.behindT, l.behindSq)}`;
    }
    case 'skewer': {
      const l = f.lines.find((x) => x.kind === 'skewer');
      return `${fr.cap(fr.pc(l.by, l.bySq))} attaque ${fr.pc(l.t, l.sq)} ; derrière se trouve ${fr.pc(l.behindT, l.behindSq)}`;
    }
    case 'discovered': {
      if (f.discoveredCheck && f.checkers && f.checkers.length) {
        const c = f.checkers.find((x) => x.sq !== f.to) || f.checkers[0];
        return `en bougeant, ${fr.le(f.piece)} démasque un échec ${fr.pcDu(c.t, c.sq)}`;
      }
      const d = f.discovered[0];
      return `en bougeant, ${fr.le(f.piece)} ouvre la ligne ${fr.pcDu(d.by, d.bySq)} vers ${fr.pc(d.t, d.sq)}`;
    }
    case 'doubleCheck':
      return 'deux pièces donnent échec en même temps, le Roi doit bouger';
    case 'removal': {
      const r = f.removal[0];
      return `en prenant ${fr.pc(f.capture.t, f.capture.sq)}, on supprime le défenseur ${fr.pcDu(r.t, r.sq)}`;
    }
    case 'free':
      return `${fr.pc(f.capture.t, f.capture.sq)} n’était pas assez défendu${fr.e(f.capture.t)}`;
    case 'mateThreat':
      return `menace ${fr.sanFr(f.mateThreat)} mat`;
    case 'sacrifice':
      return `${fr.pc(f.sacrifice.t, f.sacrifice.sq)} est offert${fr.e(f.sacrifice.t)} en échange d’une attaque`;
    default:
      return '';
  }
}

// Phrases « ce que fait ce coup » (idées) et « attention » (faiblesses).
export function describeFacts(f) {
  const idea = [];
  const warn = [];
  if (f.mate) idea.push('Échec et mat.');

  if (f.capture) {
    const c = f.capture;
    if (c.net >= 1 && c.recapture === 0) {
      idea.push(`Prend ${fr.pcUn(c.t, c.sq)} qui n’était pas défendu${fr.e(c.t)} : gain net de ${fr.pawns(c.net)}.`);
    } else if (c.net >= 1) {
      idea.push(`Prend ${fr.pcUn(c.t, c.sq)} et sort gagnant de l’échange (+${fr.pawns(c.net)}).`);
    } else if (c.net === 0) {
      idea.push(f.piece === c.t
        ? `Échange ${f.piece === 'p' ? 'de pions' : `de ${fr.noun(c.t)}s`} en ${fr.sq(c.sq)}.`
        : `Échange ${fr.le(f.piece)} contre ${fr.un(c.t)} (${fr.sq(c.sq)}).`);
    } else if (!f.sacrifice) {
      idea.push(`Prend ${fr.pcUn(c.t, c.sq)}, mais l’échange coûte ${fr.pawns(-c.net)}.`);
    }
  }

  if (f.fork) {
    idea.push(`<b>Fourchette</b> : ${fr.pc(f.fork.t, f.fork.sq)} attaque à la fois ${fr.list(f.fork.targets.map((x) => fr.pc(x.t, x.sq)))}.`);
  }
  if (f.doubleCheck) {
    idea.push('<b>Échec double</b> : deux pièces donnent échec, le Roi est obligé de bouger.');
  } else if (f.check && f.discoveredCheck && !f.mate) {
    const c = (f.checkers || []).find((x) => x.sq !== f.to) || (f.checkers || [])[0];
    if (c) idea.push(`<b>Échec à la découverte</b> : en quittant ${fr.sq(f.from)}, ${fr.le(f.piece)} libère la ligne ${fr.pcDu(c.t, c.sq)}.`);
  }
  for (const d of f.discovered.filter((x) => x.t !== 'k').slice(0, 1)) {
    idea.push(`<b>Attaque à la découverte</b> : ${fr.le(f.piece)} libère la ligne ${fr.pcDu(d.by, d.bySq)}, qui attaque maintenant ${fr.pc(d.t, d.sq)}.`);
  }
  for (const l of f.lines.slice(0, 2)) {
    if (l.kind === 'pin' && l.absolute) {
      idea.push(`<b>Clouage</b> : ${fr.pc(l.t, l.sq)} est cloué${fr.e(l.t)} sur son Roi et ne peut plus bouger.`);
    } else if (l.kind === 'pin') {
      idea.push(`<b>Clouage</b> : si ${fr.pc(l.t, l.sq)} bouge, ${fr.pc(l.behindT, l.behindSq)} sera pris${fr.e(l.behindT)}.`);
    } else {
      idea.push(`<b>Enfilade</b> : ${fr.pc(l.t, l.sq)} est attaqué${fr.e(l.t)} et, en s’écartant, laissera ${fr.pc(l.behindT, l.behindSq)} sans protection.`);
    }
  }
  if (f.check && !f.mate && !f.doubleCheck && !f.discoveredCheck) idea.push('Donne échec au Roi : l’adversaire doit d’abord parer l’échec.');
  if (f.mateThreat) idea.push(`<b>Menace de mat</b> : ${fr.sanFr(f.mateThreat)} serait mat au coup suivant.`);

  const covered = new Set();
  if (f.fork) f.fork.targets.forEach((x) => covered.add(x.sq));
  f.discovered.forEach((x) => covered.add(x.sq));
  f.lines.forEach((x) => covered.add(x.sq));
  const threats = f.threats.filter((x) => !covered.has(x.sq) && (!f.capture || x.sq !== f.capture.sq));
  if (threats.length >= 2) {
    idea.push(`<b>Double menace</b> sur ${fr.list(threats.slice(0, 3).map((x) => fr.pc(x.t, x.sq)))}.`);
  } else if (threats.length === 1) {
    const x = threats[0];
    idea.push(`Menace de gagner ${fr.pc(x.t, x.sq)}, insuffisamment défendu${fr.e(x.t)}.`);
  }
  if (f.promotion) idea.push(`Promotion en ${fr.noun(f.promotion)}.`);
  if (f.sacrifice) {
    const s = f.sacrifice;
    idea.push(`<b>Sacrifice</b> : ${fr.pc(s.t, s.sq)} peut être pris${fr.e(s.t)} (environ ${fr.pawns(s.value)} offerts).`);
  }
  for (const s of f.saved.slice(0, 2)) {
    if (s.moved) idea.push(`Met à l’abri ${fr.le(s.t)}, qui était menacé${fr.e(s.t)} en ${fr.sq(s.sq)}.`);
    else if (f.capture) idea.push(`Élimine la pièce qui attaquait ${fr.pc(s.t, s.sq)}.`);
    else idea.push(`Protège ${fr.pc(s.t, s.sq)}, qui était attaqué${fr.e(s.t)}.`);
  }
  if (f.castle) idea.push(`Roque ${f.castle === 'k' ? 'côté Roi' : 'côté Dame'} : le Roi se met à l’abri et la Tour entre dans le jeu.`);
  if (f.development) idea.push(`Développe ${fr.le(f.piece)} en ${fr.sq(f.to)} : une pièce de plus participe à la partie.`);
  if (f.center) idea.push(`Occupe le centre avec le pion ${fr.sq(f.to)}, ce qui donne de l’espace aux pièces.`);
  if (f.passed) {
    idea.push(f.passed.created
      ? `Crée un pion passé en ${fr.sq(f.passed.sq)} : plus aucun pion adverse ne peut lui barrer la route.`
      : `Pousse le pion passé vers la promotion (${fr.sq(f.passed.sq)}).`);
  }
  if (f.file) idea.push(`Place la Tour sur la colonne ${f.file.status === 'open' ? 'ouverte' : 'semi-ouverte'} ${f.file.file}.`);
  if (f.mobility && f.mobility.after >= f.mobility.before + 3 && !f.capture) {
    idea.push(`Active ${fr.le(f.piece)} : ${fr.ilElle(f.piece)} contrôle ${f.mobility.after} cases contre ${f.mobility.before} avant.`);
  }

  for (const h of f.hangs) {
    if (h.moved && f.sacrifice && f.sacrifice.sq === h.sq) continue;
    if (h.moved) warn.push(`${fr.cap(fr.pc(h.t, h.sq))} peut être pris${fr.e(h.t)} : l’adversaire gagne ${fr.pawns(h.loss)}.`);
    else if (h.unguarded) warn.push(`En quittant ${fr.sq(f.from)}, ${fr.le(f.piece)} ne protège plus ${fr.pc(h.t, h.sq)}, qui devient vulnérable (${fr.pawns(h.loss)}).`);
    else warn.push(`Laisse ${fr.pc(h.t, h.sq)} sans défense suffisante (${fr.pawns(h.loss)}).`);
  }
  for (const g of f.ignored) warn.push(`Ne s’occupe pas ${fr.pcDu(g.t, g.sq)}, toujours en prise.`);
  if (f.loseCastle) warn.push('Le Roi bouge et perd définitivement le droit de roquer.');

  return { idea, warn };
}

// Résumé très court d'une ligne (pour la liste des options du moteur).
export function shortIdea(line) {
  if (!line || !line.moves.length) return '';
  if (line.mated && line.mated !== line.pov) return `mat en ${Math.ceil(line.moves.length / 2)}`;
  if (line.motif && line.motif.key !== 'material') {
    const extra = line.material.text && line.net >= 1 ? `, gagne ${line.material.text}` : '';
    return motifLabel(line.motif).toLowerCase() + extra;
  }
  if (line.net >= 2 && line.material.text) return `gagne ${line.material.text}`;
  const f = line.facts[0];
  if (!f) return '';
  if (f.castle) return 'met le Roi à l’abri';
  if (f.capture && f.capture.net === 0) return 'échange';
  if (f.capture) return `prend ${fr.un(f.capture.t)}`;
  if (f.check) return 'échec';
  if (f.development) return `développe ${fr.le(f.piece)}`;
  if (f.saved.length) return `sauve ${fr.le(f.saved[0].t)}`;
  if (f.threats.length) return `attaque ${fr.le(f.threats[0].t)}`;
  if (f.passed) return 'pousse le pion passé';
  if (f.file) return 'Tour sur la colonne ouverte';
  if (f.center) return 'occupe le centre';
  if (f.piece === 'p') return 'gagne de l’espace';
  if (f.piece === 'k') return 'améliore le Roi';
  return `replace ${fr.le(f.piece)}`;
}

// Difficulté estimée (en Elo) d'une tactique, pour la comparer au niveau du joueur.
export function difficulty(line) {
  if (!line || !line.moves.length || !line.motif) return null;
  const first = line.moves[0];
  const forcing = first.san.includes('+') || !!first.captured;
  let d;
  if (MATE_KEYS.includes(line.motif.key)) {
    const n = Math.ceil(line.moves.length / 2);
    d = 500 + (n - 1) * 350 + (forcing ? 0 : 300);
  } else {
    const povMoves = Math.floor(line.realise / 2) + 1;
    d = 650 + (povMoves - 1) * 230;
    if (!forcing) d += 300;
    if (['pin', 'skewer', 'discovered', 'removal', 'doubleCheck'].includes(line.motif.key)) d += 150;
    if (line.motif.key === 'free') d -= 200;
  }
  if (line.motif.sacrifice) d += 300;
  return Math.max(400, Math.min(2700, Math.round(d / 50) * 50));
}

export function difficultyVerdict(d, elo) {
  if (d == null || !elo) return null;
  if (d <= elo - 150) return { key: 'easy', text: 'Accessible à ce niveau : à ne plus laisser passer.' };
  if (d <= elo + 200) return { key: 'fair', text: 'Au niveau de la partie : un bon exercice à refaire.' };
  return { key: 'hard', text: 'Difficile pour ce niveau : normal de ne pas l’avoir vue.' };
}
