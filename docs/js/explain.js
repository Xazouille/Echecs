// Reconnaissance des motifs tactiques et des idées d'un coup, puis mise en mots.
import { Chess } from '../vendor/chess.js';
import {
  parseFen, attacksFrom, attackersOf, see, VALUE, sqName, sqIndex, opp,
  linesBy, isPassed, fileStatus, findKing, absolutePins, aligned, between,
} from './position.js';
import * as fr from './fr.js';

export const MOTIFS = {
  mate: { label: 'Mat', pl: 'Mats', def: 'Le Roi est en échec et n’a aucun moyen d’y échapper : la partie s’arrête.' },
  backrank: { label: 'Mat du couloir', pl: 'Mats du couloir', def: 'Le Roi est enfermé sur sa dernière rangée par ses propres pions : une Tour ou une Dame qui arrive sur cette rangée le mate.' },
  smothered: { label: 'Mat à l’étouffée', pl: 'Mats à l’étouffée', def: 'Le Roi est entouré de ses propres pièces et un Cavalier lui donne échec : il n’a aucune case de fuite.' },
  fork: { label: 'Fourchette', pl: 'Fourchettes', fem: true, def: 'Une seule pièce attaque deux cibles en même temps. L’adversaire ne peut en sauver qu’une.' },
  pin: { label: 'Clouage', pl: 'Clouages', def: 'Une pièce ne peut pas bouger (ou ne doit pas) car elle protège une pièce plus importante placée derrière elle, souvent le Roi.' },
  skewer: { label: 'Enfilade', pl: 'Enfilades', fem: true, def: 'Une pièce de valeur est attaquée sur une ligne. Quand elle s’écarte, la pièce placée derrière elle tombe.' },
  discovered: { label: 'Attaque à la découverte', pl: 'Attaques à la découverte', fem: true, def: 'En bougeant, une pièce démasque l’attaque d’un Fou, d’une Tour ou d’une Dame placé(e) derrière elle. Deux menaces partent d’un seul coup.' },
  doubleCheck: { label: 'Échec double', pl: 'Échecs doubles', def: 'Deux pièces donnent échec en même temps. La seule défense est de déplacer le Roi.' },
  removal: { label: 'Élimination du défenseur', pl: 'Éliminations du défenseur', fem: true, def: 'On capture la pièce qui en protégeait une autre. Celle-ci n’est plus assez défendue et peut être gagnée.' },
  free: { label: 'Pièce en prise', pl: 'Pièces en prise', fem: true, def: 'Une pièce adverse peut être prise avec profit : elle n’est pas assez défendue, ou elle vaut plus que la pièce qui la prend.' },
  sacrifice: { label: 'Sacrifice', pl: 'Sacrifices', def: 'On donne volontairement du matériel pour obtenir plus : une attaque décisive, un mat ou un gain de matériel plus loin.' },
  promotion: { label: 'Promotion', pl: 'Promotions', fem: true, def: 'Un pion qui atteint la dernière rangée se transforme en Dame (ou en une autre pièce).' },
  mateThreat: { label: 'Menace de mat', pl: 'Menaces de mat', fem: true, def: 'Le coup prépare un mat au coup suivant : l’adversaire doit s’en occuper immédiatement.' },
  material: { label: 'Gain de matériel', pl: 'Gains de matériel', def: 'Une suite de coups forcée qui rapporte du matériel.' },
  threat: { label: 'Double menace', pl: 'Doubles menaces', fem: true, def: 'Un coup qui crée deux menaces à la fois : l’adversaire ne peut pas parer les deux.' },
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

const seeOrder = (t) => (t === 'k' ? 100 : VALUE[t]);

// Échange sur la case `sq` en ne jouant que des coups légaux : gain matériel, en pions,
// pour le camp au trait s'il commence à y capturer (0 s'il n'a pas intérêt à le faire).
export function legalSee(fen, sq) {
  let chess;
  try {
    chess = new Chess(fen);
  } catch {
    return 0;
  }
  const gain = (depth) => {
    if (depth > 12) return 0;
    let m = null;
    for (const c of chess.moves({ verbose: true })) {
      if (c.to !== sq || !c.captured || (c.promotion && c.promotion !== 'q')) continue;
      if (!m || seeOrder(c.piece) < seeOrder(m.piece)) m = c;
    }
    if (!m) return 0;
    chess.move({ from: m.from, to: m.to, promotion: m.promotion });
    const g = VALUE[m.captured] + (m.promotion ? VALUE[m.promotion] - 1 : 0) - gain(depth + 1);
    chess.undo();
    return Math.max(0, g);
  };
  return gain(0);
}

// La pièce jouée était-elle déjà perdue ? Attaquée sur sa case de départ, avec une autre pièce au
// moins aussi précieuse en prise en même temps (double attaque : on ne peut sauver que l'autre), ou
// sans aucune retraite sûre. Elle se vend alors au mieux : ce n'est pas un sacrifice.
function doomed(move, A, from, them, loss) {
  const before = see(A, from, them);
  if (before <= 0 || loss > before) return false;
  const worth = VALUE[A.sq[from].t];
  for (let j = 0; j < 64; j++) {
    const q = A.sq[j];
    if (j !== from && q && q.c === move.color && q.t !== 'k' && VALUE[q.t] >= worth && see(A, j, them) > 0) return true;
  }
  try {
    const chess = new Chess(move.before);
    return !chess.moves({ square: move.from, verbose: true })
      .some((m) => see(parseFen(m.after), sqIndex(m.to), them) - (m.captured ? VALUE[m.captured] : 0) <= 0);
  } catch {
    return false;
  }
}

// Caches : `rebuild()` (fin de la vérification, changement de niveau) refait tous les rapports alors
// que presque toutes les positions sont inchangées ; sans cache, cela prenait plusieurs secondes.
// Les faits et les variantes ne sont jamais modifiés après coup : ils peuvent être partagés.
const CACHE_MAX = 4000;
const factsCache = new Map();
const lineCache = new Map();

function cached(map, key, make) {
  let v = map.get(key);
  if (v === undefined) {
    if (map.size >= CACHE_MAX) map.clear();
    v = make();
    map.set(key, v);
  }
  return v;
}

// Tout ce qu'on peut dire d'un coup en regardant la position avant et après.
// `prev` : le coup qui précède, pour reconnaître une reprise.
export function moveFacts(move, ply = 0, prev = null) {
  const retake = prev && prev.captured && prev.to === move.to ? prev.captured : '';
  return cached(factsCache, `${move.before}|${move.lan}|${ply}|${retake}`, () => computeFacts(move, ply, prev));
}

function computeFacts(move, ply, prev) {
  const A = parseFen(move.before);
  const B = parseFen(move.after);
  const me = move.color;
  const them = opp(me);
  const from = sqIndex(move.from);
  const to = sqIndex(move.to);
  const t = move.promotion || move.piece;
  const f = {
    me, them, piece: move.piece, t, from: move.from, to: move.to, san: move.san,
    threats: [], discovered: [], lines: [], hangs: [], ignored: [], saved: [], removal: [], unpinned: [],
  };

  // Le coup répond-il à un échec ?
  const kingA = findKing(A, me);
  const checkersA = kingA >= 0 ? attackersOf(A, kingA, them) : [];
  f.evasion = checkersA.length > 0;

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
      checker: checkersA.includes(capIdx),
    };
    // Reprise : l'adversaire vient de prendre sur cette case. Le bilan compte aussi sa prise.
    if (prev && prev.captured && prev.to === move.to) {
      f.capture.retake = { t: prev.captured, balance: f.capture.net - VALUE[prev.captured] };
    }
  }

  if (move.flags.includes('k')) f.castle = 'k';
  else if (move.flags.includes('q')) f.castle = 'q';
  if (move.promotion) f.promotion = move.promotion;
  const home = me === 'w' ? 0 : 7;
  if ((move.piece === 'n' || move.piece === 'b') && from >> 3 === home && ply < 30) f.development = true;
  // Un pion central qui va être pris (échange en cours) n'occupe pas le centre.
  if (move.piece === 'p' && ['d4', 'e4', 'd5', 'e5'].includes(move.to) && ply < 24 && see(B, to, them) <= 0) f.center = true;
  if (!'pk'.includes(move.piece)) {
    f.mobility = { before: attacksFrom(A, from).length, after: attacksFrom(B, to).length };
  }

  // Nouvelles menaces : pièces adverses qu'on peut maintenant gagner. `by` : l'attaquant le moins cher.
  const pinsB = absolutePins(B, me);
  const kingB = findKing(B, me);
  for (let j = 0; j < 64; j++) {
    const q = B.sq[j];
    if (!q || q.c !== them || q.t === 'k') continue;
    const gain = see(B, j, me);
    if (gain <= 0) continue;
    const qa = A.sq[j];
    // Déjà menacée avant le coup : un échec subi ne faisait que retarder la prise.
    if (qa && qa.c === them && qa.t === q.t && see(A, j, me, true) > 0) continue;
    const atk = attackersOf(B, j, me).filter((i) => B.sq[i].t === 'k' || !pinsB.has(i) || aligned(kingB, i, j));
    let by = null;
    for (const i of atk) if (!by || seeOrder(B.sq[i].t) < seeOrder(by)) by = B.sq[i].t;
    f.threats.push({
      t: q.t, sq: sqName(j), idx: j, gain, byMoved: atk.includes(to), attackers: atk, by,
      defended: attackersOf(B, j, them).length > 0,
    });
  }
  // Une pièce qui donne échec et peut être prise avec profit ne menace rien d'autre : l'adversaire la prend.
  if (f.check && see(B, to, them) > 0) {
    f.threats = f.threats.filter((x) => !(x.attackers.length === 1 && x.byMoved));
  }
  if (f.capture) {
    // La cible doit tomber parce que son défenseur a disparu, pas parce que la pièce qui a pris
    // l'attaque depuis sa nouvelle case : on vérifie la menace sans cette pièce.
    const guarded = attacksFrom(A, f.capture.idx);
    const without = { sq: B.sq.slice() };
    without.sq[to] = null;
    f.removal = f.threats.filter((th) => guarded.includes(th.idx) && see(without, th.idx, me) > 0);
  }

  // Fourchette : la pièce jouée attaque au moins deux cibles intéressantes. Le Roi ne peut prendre
  // qu'une pièce non défendue ; une pièce clouée sur son Roi ne prend que sur la ligne du clouage.
  const prongs = [];
  const pinnedMover = absolutePins(B, me).has(to);
  const myKing = findKing(B, me);
  for (const j of attacksFrom(B, to)) {
    const q = B.sq[j];
    if (!q || q.c !== them || q.t === 'p') continue;
    if (q.t === 'k') {
      prongs.push({ t: 'k', sq: sqName(j) });
      continue;
    }
    if (pinnedMover && !aligned(myKing, to, j)) continue;
    // Une cible qui peut prendre la pièce qui fourchette sans y perdre (valeur égale ou moindre)
    // n'est pas fourchettée : elle règle tout par un échange (Dame contre Dame, Tour contre Tour).
    if (VALUE[q.t] <= VALUE[t] && attacksFrom(B, j).includes(to)) continue;
    const defended = attackersOf(B, j, them).length > 0;
    if (t === 'k' ? !defended : VALUE[q.t] > VALUE[t] || !defended) prongs.push({ t: q.t, sq: sqName(j) });
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
      // Clouage relatif : il ne compte que si la pièce de derrière vaut plus que celle qui cloue, ou
      // n'est pas défendue. Sinon la pièce clouée peut partir sans rien perdre.
      if (!x.absolute && VALUE[B.sq[x.behind].t] <= VALUE[slider.t]
        && attackersOf(B, x.behind, them).some((i) => i !== x.pinned)) continue;
      // Pion cloué sur son Roi : sans intérêt, sauf s'il ne peut plus prendre une de nos pièces
      // (s'il est à gagner, c'est parce qu'il est attaqué plusieurs fois, pas à cause du clouage).
      if (x.absolute && B.sq[x.pinned].t === 'p'
        && !attacksFrom(B, x.pinned).some((j) => B.sq[j] && B.sq[j].c === me)) continue;
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
    if (lossBefore > 0 && j !== to) {
      f.ignored.push({ t: q.t, sq: sqName(j), loss });
      continue;
    }
    const h = { t: q.t, sq: sqName(j), loss, moved: j === to, unguarded: j !== to && attacksFrom(A, from).includes(j) };
    // Pourquoi la pièce devient-elle vulnérable ? La pièce jouée coupe une de nos défenses (`cut`),
    // ou son départ démasque une pièce adverse (`unmasked`).
    if (j !== to && !h.unguarded) {
      for (let s = 0; s < 64 && !h.cut && !h.unmasked; s++) {
        const p = B.sq[s];
        if (!p || s === to || !'brq'.includes(p.t)) continue;
        if (p.c === me && between(s, j, to) && attacksFrom(A, s).includes(j)) h.cut = { t: p.t, sq: sqName(s) };
        else if (p.c === them && between(s, j, from) && attacksFrom(B, s).includes(j) && !attacksFrom(A, s).includes(j)) h.unmasked = { t: p.t, sq: sqName(s) };
      }
    }
    f.hangs.push(h);
  }
  // Pièces mises à l'abri. Un échec ne protège rien : la pièce doit rester hors de danger une fois
  // l'échec paré. `how` dit comment : déplacée, attaquant pris (`took` si c'est elle qui l'a pris),
  // nouvelle défense, ligne d'attaque coupée.
  for (let j = 0; j < 64; j++) {
    const qa = A.sq[j];
    if (!qa || qa.c !== me || qa.t === 'k' || see(A, j, them) <= 0) continue;
    const moved = j === from;
    const now = moved ? to : j;
    const q = B.sq[now];
    if (!q || q.c !== me || see(B, now, them, true) > 0) continue;
    const tookAttacker = !!f.capture && attacksFrom(A, f.capture.idx).includes(j);
    let how = 'other';
    let by = null;
    if (moved) how = tookAttacker ? 'took' : 'moved';
    else if (tookAttacker) how = 'capture';
    else if (attacksFrom(B, to).includes(j)) how = 'defend';
    else {
      // Ligne d'attaque coupée (`block`), défense rouverte par le départ de la pièce (`reopen`),
      // ou attaquant désormais cloué sur son Roi (`pinned`).
      const pinsThem = absolutePins(B, them);
      const kingThem = findKing(B, them);
      for (let s = 0; s < 64 && how === 'other'; s++) {
        const e = A.sq[s];
        const p = B.sq[s];
        if (e && e.c === them && 'brq'.includes(e.t) && attacksFrom(A, s).includes(j) && between(s, j, to)) {
          how = 'block';
          by = { t: e.t, sq: sqName(s) };
        } else if (p && p.c === me && s !== to && 'brq'.includes(p.t) && between(s, j, from)
          && attacksFrom(B, s).includes(j) && !attacksFrom(A, s).includes(j)) {
          how = 'reopen';
          by = { t: p.t, sq: sqName(s) };
        } else if (e && e.c === them && attacksFrom(A, s).includes(j) && pinsThem.has(s) && !aligned(kingThem, s, j)) {
          how = 'pinned';
          by = { t: e.t, sq: sqName(s) };
        }
      }
    }
    f.saved.push({ t: qa.t, sq: sqName(j), moved, how, by });
  }
  // Pièces déclouées : clouées sur leur Roi avant le coup, libres après (le Roi a bougé, la pièce
  // qui clouait a été prise, ou une pièce s'est interposée).
  const pinsA = absolutePins(A, me);
  for (const i of pinsA) {
    const p = B.sq[i];
    if (i === from || pinsB.has(i) || !p || p.c !== me) continue;
    f.unpinned.push({ t: p.t, sq: sqName(i), threat: f.threats.some((x) => x.attackers.includes(i)) });
  }

  // Sacrifice : on laisse volontairement au moins 2 points de matériel. La SEE rapide ignore
  // les clouages et les échecs : chaque candidat est revérifié en coups légaux. Une pièce déjà
  // perdue qui se vend au mieux (desperado) n'est pas un sacrifice.
  const got = move.captured ? VALUE[move.captured] : 0;
  const movedLoss = Math.max(0, see(B, to, them)) - got;
  let other = null;
  for (const h of f.hangs) if (!h.moved && (!other || h.loss > other.loss)) other = h;
  const otherLoss = other ? other.loss - got : 0;
  const cands = [];
  f.desperado = movedLoss >= 2 && doomed(move, A, from, them, movedLoss);
  if (movedLoss >= 2 && !f.desperado) cands.push({ t, sq: move.to });
  if (otherLoss >= 2) cands.push({ t: other.t, sq: other.sq });
  for (const c of cands) {
    const value = legalSee(move.after, c.sq) - got;
    if (value >= 2 && (!f.sacrifice || value > f.sacrifice.value)) f.sacrifice = { ...c, value };
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

// Bilan matériel des `n` premiers coups d'une variante, du point de vue de `pov`. `seed` : pièce
// perdue juste avant la variante (prise adverse que la variante reprend). Si la variante s'arrête
// au milieu d'un échange, la fin de l'échange est estimée par la SEE.
function tally(moves, n, pov, seed, over) {
  const mine = [];
  const lost = [];
  const running = [];
  let net = 0;
  if (seed) {
    lost.push(seed);
    net -= VALUE[seed];
  }
  for (const m of moves.slice(0, n)) {
    const sign = m.color === pov ? 1 : -1;
    if (m.captured) {
      (sign > 0 ? mine : lost).push(m.captured);
      net += sign * VALUE[m.captured];
    }
    if (m.promotion) {
      if (sign > 0) { mine.push(m.promotion); lost.push('p'); } else { lost.push(m.promotion); mine.push('p'); }
      net += sign * (VALUE[m.promotion] - 1);
    }
    running.push(net);
  }
  const last = moves[n - 1];
  if (last && last.captured && !over) {
    const end = parseFen(last.after);
    const idx = sqIndex(last.to);
    const stm = opp(last.color);
    const g = see(end, idx, stm);
    if (g > 0) {
      const sign = stm === pov ? 1 : -1;
      net += sign * g;
      if (g >= VALUE[end.sq[idx].t]) (sign > 0 ? mine : lost).push(end.sq[idx].t);
    }
  }
  return { mine, lost, net, running };
}

// Coups « de dépit » : dans une position perdue, le moteur fait souvent donner du matériel au camp
// perdant (un échec qui offre une pièce, une Tour qui prend un pion défendu…), puisque tout perd de
// toute façon. Le bilan annoncé s'arrête avant le premier de ces coups, sinon la perte affichée
// serait gonflée. Ne comptent pas comme dépit, car ils peuvent être imposés : un coup joué en échec
// ou sous menace de mat, une pièce déjà perdue qui se vend, la prise d'un pion sur le point de
// promouvoir (37.Fxh2 contre un pion h2 : le Fou se donne pour éviter une Dame).
function spiteCut(moves, pov, net) {
  if (!net) return moves.length;
  const loser = net > 0 ? opp(pov) : pov;
  const winner = opp(loser);
  for (let k = 1; k < moves.length; k++) {
    const m = moves[k];
    if (m.color !== loser || m.promotion) continue;
    const A = parseFen(m.before);
    const king = findKing(A, loser);
    if (king >= 0 && attackersOf(A, king, winner).length) continue;
    const to = sqIndex(m.to);
    const promoting = m.captured === 'p' && (to >> 3) === (winner === 'w' ? 6 : 1);
    const got = promoting ? VALUE.q - 1 : m.captured ? VALUE[m.captured] : 0;
    const loss = see(parseFen(m.after), to, winner) - got;
    if (loss < 2) continue;
    if (doomed(m, A, sqIndex(m.from), winner, loss)) continue;
    if (findMateIn1(m.before, winner)) continue;
    return k;
  }
  return moves.length;
}

// Joue une variante et en tire le bilan : matériel, mat, motif principal.
// `prev` : le coup joué juste avant la variante (pour reconnaître une reprise). `seed` : compter
// la prise faite par `prev` dans le bilan annoncé (réponse à un coup qui vient de prendre).
// `net`, `running`, `realise` : bilan brut de toute la variante (sert au classement des coups).
// `material`, `gain` : bilan annoncé dans les textes, arrêté avant les coups de dépit.
export function analyzeLine(fen, pv, { max = 12, prev = null, seed = false } = {}) {
  const taken = seed && prev && prev.captured ? prev.captured : null;
  const key = `${fen}|${(pv || []).slice(0, max).join(' ')}|${max}|${prev && prev.captured ? prev.to + prev.captured : ''}|${taken || ''}`;
  return cached(lineCache, key, () => computeLine(fen, pv, max, prev, taken));
}

function computeLine(fen, pv, max, prev, taken) {
  const { chess, moves } = playLine(fen, pv || [], max);
  const pov = fen.split(' ')[1];
  const over = chess.isGameOver();
  const raw = tally(moves, moves.length, pov, null, over);
  const mated = chess.isCheckmate() ? chess.turn() : null;
  const facts = [];
  for (let k = 0; k < moves.length && k < 6; k += 2) facts[k] = moveFacts(moves[k], 99, k === 0 ? prev : moves[k - 1]);
  let realise = moves.length - 1;
  if (raw.net >= 1) {
    const k = raw.running.findIndex((v) => v >= raw.net - 0.5);
    if (k >= 0) realise = k;
  }
  const cut = spiteCut(moves, pov, raw.net);
  const told = tally(moves, cut, pov, taken, cut === moves.length && over);
  const line = {
    fen, pov, moves, net: raw.net, running: raw.running, mated, facts, realise,
    pattern: mated ? matePattern(chess.fen(), mated) : null,
    material: fr.trade(told.mine, told.lost),
    gain: told.net,
  };
  // Pour une réponse, une simple reprise ne compte pas comme un gain de matériel.
  line.motif = pickMotif(line, taken ? raw.net - VALUE[taken] : raw.net);
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

function pickMotif(line, net = line.net) {
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
  if (first && first.capture && first.capture.net >= 1 && net >= 1) return { key: 'free', f: first, ply: 0, sacrifice: false };
  if (line.moves.some((m, k) => k % 2 === 0 && m.promotion) && net >= 3) return { key: 'promotion', ply: 0, sacrifice };
  if (sacrifice && net >= 0) return { key: 'sacrifice', f: first, ply: 0, sacrifice };
  if (first && first.mateThreat) return { key: 'mateThreat', f: first, ply: 0, sacrifice };
  if (net >= 2) return { key: 'material', ply: 0, sacrifice };
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
  const v = (variants) => fr.pick(`detail|${m.key}|${f.san}|${f.from}${f.to}`, variants);
  switch (m.key) {
    case 'fork': {
      const by = fr.pc(f.fork.t, f.fork.sq);
      const targets = fr.list(f.fork.targets.map((x) => fr.pc(x.t, x.sq)));
      return v([`${by} attaque à la fois ${targets}`, `${by} vise en même temps ${targets}`]);
    }
    case 'pin': {
      const l = f.lines.find((x) => x.kind === 'pin');
      const by = fr.pc(l.by, l.bySq);
      const pinned = fr.pc(l.t, l.sq);
      return l.absolute
        ? v([`${by} cloue ${pinned} sur son Roi`, `${pinned} est cloué${fr.e(l.t)} sur son Roi par ${by}`])
        : v([`${by} cloue ${pinned} devant ${fr.pc(l.behindT, l.behindSq)}`, `${pinned}, cloué${fr.e(l.t)} par ${by}, couvre ${fr.pc(l.behindT, l.behindSq)}`]);
    }
    case 'skewer': {
      const l = f.lines.find((x) => x.kind === 'skewer');
      const by = fr.pc(l.by, l.bySq);
      const front = fr.pc(l.t, l.sq);
      const behind = fr.pc(l.behindT, l.behindSq);
      return v([`${by} attaque ${front} ; derrière se trouve ${behind}`, `${front} est attaqué${fr.e(l.t)} par ${by}, avec ${behind} juste derrière`]);
    }
    case 'discovered': {
      if (f.discoveredCheck && f.checkers && f.checkers.length) {
        const c = f.checkers.find((x) => x.sq !== f.to) || f.checkers[0];
        return v([`en bougeant, ${fr.le(f.piece)} démasque un échec ${fr.pcDu(c.t, c.sq)}`, `le départ ${fr.du(f.piece)} démasque un échec ${fr.pcDu(c.t, c.sq)}`]);
      }
      const d = f.discovered[0];
      return v([
        `en bougeant, ${fr.le(f.piece)} ouvre la ligne ${fr.pcDu(d.by, d.bySq)} vers ${fr.pc(d.t, d.sq)}`,
        `le départ ${fr.du(f.piece)} ouvre la ligne ${fr.pcDu(d.by, d.bySq)} vers ${fr.pc(d.t, d.sq)}`,
      ]);
    }
    case 'doubleCheck':
      return v(['deux pièces donnent échec en même temps, le Roi doit bouger', 'échec de deux pièces à la fois : seul un déplacement du Roi répond']);
    case 'removal': {
      const r = f.removal[0];
      const taken = fr.pc(f.capture.t, f.capture.sq);
      const rest = r.defended ? `n’est plus assez défendu${fr.e(r.t)}` : `se retrouve sans protection`;
      return v([
        `en prenant ${taken}, on supprime le défenseur ${fr.pcDu(r.t, r.sq)}`,
        `${taken} défendait ${fr.pc(r.t, r.sq)}, qui ${rest}`,
      ]);
    }
    case 'free': {
      const c = f.capture;
      const t = c.t;
      const pc = fr.pc(t, c.sq);
      if (c.retake) return v([`${pc} pouvait être repris${fr.e(t)}`, `il fallait reprendre ${pc}`]);
      if (c.undefended) return v([`${pc} n’était pas défendu${fr.e(t)}`, `${pc} était laissé${fr.e(t)} sans défense`]);
      if (f.piece !== 'k' && VALUE[f.piece] < VALUE[t]) {
        const it = fr.isFem(t) ? 'la' : 'le';
        return v([`${pc} vaut plus que ${fr.le(f.piece)} qui ${it} prend`, `prendre ${pc} avec ${fr.un(f.piece)} rapporte du matériel`]);
      }
      return v([`${pc} n’était pas assez défendu${fr.e(t)}`, `${pc} était insuffisamment protégé${fr.e(t)}`]);
    }
    case 'mateThreat':
      return v([`menace ${fr.sanFr(f.mateThreat)} mat`, `prépare ${fr.sanFr(f.mateThreat)} mat`]);
    case 'sacrifice': {
      const s = f.sacrifice;
      const pc = fr.pc(s.t, s.sq);
      return v([`${pc} est offert${fr.e(s.t)} en échange d’une attaque`, `${pc} est donné${fr.e(s.t)} pour ouvrir l’attaque`]);
    }
    default:
      return '';
  }
}

// Phrases « ce que fait ce coup » (idées) et « attention » (faiblesses). Chaque phrase a plusieurs
// tournures ; `key` (le coup) fixe le choix, pour qu'un coup garde toujours le même texte.
// `bad` : le coup est une erreur. On ne parle alors pas de « sacrifice » (le matériel est perdu sans
// compensation) : la pièce perdue apparaît dans les faiblesses. `lost` : la position est perdue
// après le coup ; une pièce laissée en prise n'y est pas non plus un sacrifice.
export function describeFacts(f, key = `${f.san}|${f.from}${f.to}`, { bad = false, lost = false } = {}) {
  const idea = [];
  const warn = [];
  const v = (slot, variants) => fr.pick(`${slot}|${key}`, variants);
  // Après un mat, plus rien d'autre ne compte (menaces, pièces défendues…).
  if (f.mate) {
    idea.push(v('mate', ['Échec et mat.', 'Le Roi adverse est mat : la partie est terminée.', 'Mat.']));
    return { idea, warn };
  }

  // Réponse à un échec : le coup était en grande partie imposé.
  let interposed = false;
  if (f.evasion) {
    if (f.capture && f.capture.checker) {
      idea.push(v('evade-x', ['Pare l’échec en prenant la pièce qui le donnait.', 'Élimine la pièce qui donnait échec.']));
    } else if (f.piece === 'k') {
      idea.push(v('evade-k', [
        `Le Roi sort de l’échec en ${fr.sq(f.to)}.`,
        `Le Roi se met hors d’échec en ${fr.sq(f.to)}.`,
        `Le Roi échappe à l’échec en ${fr.sq(f.to)}.`,
      ]));
    } else {
      const s = f.sacrifice && f.sacrifice.sq === f.to ? f.sacrifice : null;
      interposed = !!s;
      const cost = s ? ` ; ${fr.ilElle(f.t)} peut être pris${fr.e(f.t)} (environ ${fr.pawns(s.value)})` : '';
      idea.push(v('evade-block', [
        `Pare l’échec en interposant ${fr.le(f.t)} en ${fr.sq(f.to)}${cost}.`,
        `${fr.cap(fr.le(f.t))} s’interpose en ${fr.sq(f.to)} pour parer l’échec${cost}.`,
      ]));
    }
  }

  if (f.capture) {
    const c = f.capture;
    const un = fr.pcUn(c.t, c.sq);
    const pc = fr.pc(c.t, c.sq);
    if (c.retake) {
      // Reprise : le bilan inclut la prise que l'adversaire vient de faire.
      const b = c.retake.balance;
      if (b >= 1) {
        idea.push(v('retake-win', [
          `Reprend ${pc} et sort gagnant de l’échange (+${fr.pawns(b)}).`,
          `Reprend ${pc} : l’échange rapporte finalement ${fr.pawns(b)}.`,
        ]));
      } else if (b === 0) {
        const what = c.t === 'p' ? 'pions' : `${fr.noun(c.t)}s`;
        idea.push(c.t === c.retake.t
          ? v('retake-even', [`Reprend ${pc} : échange de ${what}.`, `Reprise en ${fr.sq(c.sq)} : les ${what} s’échangent.`])
          : v('retake-trade', [`Reprend ${pc} : l’échange est équilibré.`, `Reprend ${pc}, pour un échange équilibré.`]));
      } else {
        idea.push(v('retake-loss', [
          `Reprend ${pc} ; bilan de l’échange : −${fr.pawns(-b)}.`,
          `Reprend ${pc}, mais l’échange coûte ${fr.pawns(-b)} au total.`,
        ]));
      }
    } else if (c.net >= 1 && c.undefended) {
      idea.push(v('cap-free', [
        `Prend ${un} qui n’était pas défendu${fr.e(c.t)} : gain net de ${fr.pawns(c.net)}.`,
        `Gagne ${un} laissé${fr.e(c.t)} sans défense (+${fr.pawns(c.net)}).`,
        `${fr.cap(fr.pc(c.t, c.sq))} n’était pas protégé${fr.e(c.t)} : la prise rapporte ${fr.pawns(c.net)}.`,
      ]));
    } else if (c.net >= 1) {
      idea.push(v('cap-win', [
        `Prend ${un} et sort gagnant de l’échange (+${fr.pawns(c.net)}).`,
        `Prend ${un} : l’échange qui suit rapporte ${fr.pawns(c.net)}.`,
        `Capture ${un} avec un bilan positif (+${fr.pawns(c.net)}).`,
      ]));
    } else if (c.net === 0) {
      const what = f.piece === 'p' ? 'pions' : `${fr.noun(c.t)}s`;
      idea.push(f.piece === c.t
        ? v('cap-even', [`Échange de ${what} en ${fr.sq(c.sq)}.`, `Les ${what} s’échangent en ${fr.sq(c.sq)}.`])
        : v('cap-trade', [
          `Échange ${fr.le(f.piece)} contre ${fr.un(c.t)} (${fr.sq(c.sq)}).`,
          `${fr.cap(fr.le(f.piece))} est échangé${fr.e(f.piece)} contre ${fr.un(c.t)} en ${fr.sq(c.sq)}.`,
        ]));
    } else if (f.desperado) {
      // Pièce condamnée (double attaque, ou piégée) qui prend ce qu'elle peut avant d'être prise.
      const e = fr.e(f.piece);
      idea.push(v('desperado', [
        `${fr.cap(fr.le(f.piece))} était perdu${e} de toute façon : ${fr.ilElle(f.piece)} prend ${un} avant d’être pris${e}.`,
        `${fr.cap(fr.le(f.piece))}, déjà perdu${e}, se vend contre ${un}.`,
      ]));
    } else if (!f.sacrifice || bad) {
      idea.push(v('cap-loss', [
        `Prend ${un}, mais l’échange coûte ${fr.pawns(-c.net)}.`,
        `Prend ${un}, mais le bilan de l’échange est négatif (−${fr.pawns(-c.net)}).`,
        `Capture ${un} au prix de ${fr.pawns(-c.net)} après les reprises.`,
      ]));
    }
  }

  if (f.fork) {
    const by = fr.pc(f.fork.t, f.fork.sq);
    const targets = fr.list(f.fork.targets.map((x) => fr.pc(x.t, x.sq)));
    idea.push(v('fork', [
      `<b>Fourchette</b> : ${by} attaque à la fois ${targets}.`,
      `<b>Fourchette</b> : ${by} vise en même temps ${targets}.`,
      `<b>Fourchette</b> ${fr.pcDu(f.fork.t, f.fork.sq)} sur ${targets}.`,
    ]));
  }
  if (f.doubleCheck) {
    idea.push(v('double', [
      '<b>Échec double</b> : deux pièces donnent échec, le Roi est obligé de bouger.',
      '<b>Échec double</b> : deux pièces attaquent le Roi, qui doit se déplacer.',
      '<b>Échec double</b> : seule une fuite du Roi est possible.',
    ]));
  } else if (f.check && f.discoveredCheck && !f.mate) {
    const c = (f.checkers || []).find((x) => x.sq !== f.to) || (f.checkers || [])[0];
    if (c) {
      idea.push(v('disc-check', [
        `<b>Échec à la découverte</b> : en quittant ${fr.sq(f.from)}, ${fr.le(f.piece)} libère la ligne ${fr.pcDu(c.t, c.sq)}.`,
        `<b>Échec à la découverte</b> : ${fr.le(f.piece)} quitte ${fr.sq(f.from)} et démasque ${fr.pc(c.t, c.sq)}.`,
        `<b>Échec à la découverte</b> ${fr.pcDu(c.t, c.sq)}, démasqué${fr.e(c.t)} par le départ ${fr.du(f.piece)}.`,
      ]));
    }
  }
  for (const d of f.discovered.filter((x) => x.t !== 'k').slice(0, 1)) {
    idea.push(v('disc', [
      `<b>Attaque à la découverte</b> : ${fr.le(f.piece)} libère la ligne ${fr.pcDu(d.by, d.bySq)}, qui attaque maintenant ${fr.pc(d.t, d.sq)}.`,
      `<b>Attaque à la découverte</b> : en bougeant, ${fr.le(f.piece)} ouvre la ligne ${fr.pcDu(d.by, d.bySq)} vers ${fr.pc(d.t, d.sq)}.`,
      `<b>Attaque à la découverte</b> : ${fr.pc(d.by, d.bySq)} vise désormais ${fr.pc(d.t, d.sq)}, grâce au départ ${fr.du(f.piece)}.`,
    ]));
  }
  f.lines.slice(0, 2).forEach((l, k) => {
    const pc = fr.pc(l.t, l.sq);
    const behind = fr.pc(l.behindT, l.behindSq);
    if (l.kind === 'pin' && l.absolute) {
      idea.push(v(`pin-abs${k}`, [
        `<b>Clouage</b> : ${pc} est cloué${fr.e(l.t)} sur son Roi.`,
        `<b>Clouage</b> : ${pc} se retrouve immobilisé${fr.e(l.t)} devant son Roi.`,
        `<b>Clouage</b> : ${pc} ne peut plus quitter la ligne de son Roi.`,
      ]));
    } else if (l.kind === 'pin') {
      idea.push(v(`pin${k}`, [
        `<b>Clouage</b> : si ${pc} bouge, ${behind} sera pris${fr.e(l.behindT)}.`,
        `<b>Clouage</b> : ${pc} ne peut pas bouger sans abandonner ${behind}.`,
      ]));
    } else {
      idea.push(v(`skewer${k}`, [
        `<b>Enfilade</b> : ${pc} est attaqué${fr.e(l.t)} et, en s’écartant, laissera ${behind} sans protection.`,
        `<b>Enfilade</b> : ${pc} est attaqué${fr.e(l.t)} ; ${behind}, juste derrière, deviendra vulnérable.`,
      ]));
    }
  });
  if (f.check && !f.mate && !f.doubleCheck && !f.discoveredCheck) {
    idea.push(v('check', [
      'Donne échec au Roi : l’adversaire doit d’abord parer l’échec.',
      'Échec : l’adversaire doit s’en occuper avant tout.',
      'Met le Roi adverse en échec, ce qui force la réponse.',
    ]));
  }
  if (f.mateThreat) {
    const san = fr.sanFr(f.mateThreat);
    const bare = san.replace('#', '');
    idea.push(v('mate-threat', [
      `<b>Menace de mat</b> : ${bare} serait mat au coup suivant.`,
      `<b>Menace de mat</b> en un coup : ${san}.`,
      `<b>Menace de mat</b> : si rien n’est fait, ${bare} mate.`,
    ]));
  }

  // Pièces déclouées : on ne les signale que si elles comptent (pièce, ou pion qui crée une menace).
  f.unpinned.filter((u) => u.t !== 'p' || u.threat).slice(0, 1).forEach((u) => {
    const pc = fr.pc(u.t, u.sq);
    idea.push(v('unpin', [
      `Libère ${pc}, qui était cloué${fr.e(u.t)} sur son Roi.`,
      `${fr.cap(pc)} n’est plus cloué${fr.e(u.t)} sur son Roi.`,
    ]));
  });

  const covered = new Set();
  if (f.fork) f.fork.targets.forEach((x) => covered.add(x.sq));
  f.discovered.forEach((x) => covered.add(x.sq));
  f.lines.forEach((x) => covered.add(x.sq));
  const threats = f.threats.filter((x) => !covered.has(x.sq) && (!f.capture || x.sq !== f.capture.sq));
  if (threats.length >= 2) {
    const shown = threats.slice(0, 3);
    const list = fr.list(shown.map((x) => fr.pc(x.t, x.sq)));
    const agree = shown.every((x) => fr.isFem(x.t)) ? 'es' : 's';
    idea.push(v('threats', [
      `<b>Double menace</b> sur ${list}.`,
      `<b>Double menace</b> : ${list} sont attaqué${agree} en même temps.`,
      `<b>Double menace</b> : le coup attaque à la fois ${list}.`,
    ]));
  } else if (threats.length === 1) {
    // La raison de la menace : cible sans défense, attaquée par une pièce de moindre valeur, ou
    // trop peu défendue. « Attaque » seulement si c'est la pièce jouée qui attaque.
    const x = threats[0];
    const pc = fr.pc(x.t, x.sq);
    const e = fr.e(x.t);
    if (!x.defended) {
      idea.push(x.byMoved
        ? v('threat-free', [`Attaque ${pc}, qui n’est pas défendu${e}.`, `Vise ${pc}, laissé${e} sans défense.`])
        : v('threat-free2', [`${fr.cap(pc)}, sans défense, est maintenant menacé${e}.`, `Menace de gagner ${pc}, qui n’est pas défendu${e}.`]));
    } else if (x.by && x.by !== 'k' && VALUE[x.by] < VALUE[x.t]) {
      idea.push(x.byMoved
        ? v('threat-cheap', [`Attaque ${pc}, qui vaut plus que ${fr.le(x.by)}.`, `${fr.cap(pc)} est attaqué${e} par ${fr.un(x.by)}, de moindre valeur.`])
        : v('threat-cheap2', [`${fr.cap(pc)} est maintenant attaqué${e} par ${fr.un(x.by)}, de moindre valeur.`, `${fr.cap(pc)} est menacé${e} par ${fr.un(x.by)} : même défendu${e}, ${fr.ilElle(x.t)} vaut plus que lui.`]));
    } else {
      idea.push(x.byMoved
        ? v('threat', [`Attaque ${pc}, qui n’est pas assez défendu${e}.`, `Menace de gagner ${pc}, insuffisamment défendu${e}.`])
        : v('threat2', [`${fr.cap(pc)} est maintenant menacé${e} : sa défense est insuffisante.`, `Menace de gagner ${pc}, insuffisamment défendu${e}.`]));
    }
  }
  if (f.promotion) idea.push(v('promo', [`Promotion en ${fr.noun(f.promotion)}.`, `Le pion devient ${fr.un(f.promotion)}.`]));
  if (f.sacrifice && !bad && !interposed) {
    const s = f.sacrifice;
    const pc = fr.pc(s.t, s.sq);
    // Dans une position déjà perdue, donner du matériel n'apporte pas de compensation : on constate.
    idea.push(lost
      ? v('sac-lost', [`${fr.cap(pc)} peut être pris${fr.e(s.t)} (environ ${fr.pawns(s.value)}).`, `${fr.cap(pc)} reste en prise (environ ${fr.pawns(s.value)}).`])
      : v('sac', [
        `<b>Sacrifice</b> : ${pc} peut être pris${fr.e(s.t)} (environ ${fr.pawns(s.value)} offerts).`,
        `<b>Sacrifice</b> : ${pc} est laissé${fr.e(s.t)} en prise (environ ${fr.pawns(s.value)}).`,
        `<b>Sacrifice</b> d’environ ${fr.pawns(s.value)} : ${pc} peut être capturé${fr.e(s.t)}.`,
      ]));
  }
  // Une pièce qui prend son propre attaquant (`took`) : la prise suffit à le dire. Plusieurs pièces
  // sauvées de la même façon (prise de l'attaquant, nouvelle défense) : une seule phrase.
  const saved = f.saved.filter((s) => s.how !== 'took');
  for (const how of ['capture', 'defend']) {
    const group = saved.filter((s) => s.how === how);
    if (group.length < 2) continue;
    const list = fr.list(group.map((s) => fr.pc(s.t, s.sq)));
    const agree = group.every((s) => fr.isFem(s.t)) ? 'es' : 's';
    idea.push(how === 'capture'
      ? v('saved-cap-n', [`La prise libère ${list} de la menace.`, `Élimine la pièce qui attaquait ${list}.`])
      : v('saved-n', [`Protège ${list}, qui étaient attaqué${agree}.`, `Défend à la fois ${list}, qui étaient menacé${agree}.`]));
    group.forEach((s) => saved.splice(saved.indexOf(s), 1));
  }
  saved.slice(0, 2).forEach((s, k) => {
    const pc = fr.pc(s.t, s.sq);
    if (s.moved) {
      idea.push(v(`saved-moved${k}`, [
        `Met à l’abri ${fr.le(s.t)}, qui était menacé${fr.e(s.t)} en ${fr.sq(s.sq)}.`,
        `Retire ${fr.le(s.t)} de ${fr.sq(s.sq)}, où ${fr.ilElle(s.t)} était menacé${fr.e(s.t)}.`,
        `Sauve ${fr.le(s.t)}, attaqué${fr.e(s.t)} en ${fr.sq(s.sq)}.`,
      ]));
    } else if (s.how === 'capture') {
      idea.push(v(`saved-cap${k}`, [
        `Élimine la pièce qui attaquait ${pc}.`,
        `Supprime l’attaquant ${fr.pcDu(s.t, s.sq)}.`,
        `La prise libère ${pc} de la menace.`,
      ]));
    } else if (s.how === 'defend') {
      idea.push(v(`saved${k}`, [
        `Protège ${pc}, qui était attaqué${fr.e(s.t)}.`,
        `Défend ${pc}, qui était menacé${fr.e(s.t)}.`,
        `${fr.cap(pc)}, attaqué${fr.e(s.t)}, est maintenant protégé${fr.e(s.t)}.`,
      ]));
    } else if (s.how === 'block') {
      idea.push(v(`saved-block${k}`, [
        `Coupe l’attaque ${fr.pcDu(s.by.t, s.by.sq)} sur ${pc}.`,
        `S’interpose entre ${fr.pc(s.by.t, s.by.sq)} et ${pc}.`,
      ]));
    } else if (s.how === 'reopen') {
      idea.push(v(`saved-reopen${k}`, [
        `${fr.cap(pc)} est de nouveau défendu${fr.e(s.t)} par ${fr.pc(s.by.t, s.by.sq)}, grâce au départ ${fr.du(f.piece)}.`,
        `En quittant ${fr.sq(f.from)}, ${fr.le(f.piece)} rouvre la ligne ${fr.pcDu(s.by.t, s.by.sq)}, qui défend de nouveau ${pc}.`,
      ]));
    } else if (s.how === 'pinned') {
      const it = fr.isFem(s.t) ? 'la' : 'le';
      idea.push(v(`saved-pinned${k}`, [
        `${fr.cap(pc)} n’est plus en prise : ${fr.pc(s.by.t, s.by.sq)}, cloué${fr.e(s.by.t)}, ne peut plus ${it} prendre.`,
        `Le clouage empêche ${fr.pc(s.by.t, s.by.sq)} de prendre ${pc}.`,
      ]));
    } else {
      idea.push(v(`saved-other${k}`, [
        `${fr.cap(pc)} n’est plus en prise.`,
        `${fr.cap(pc)} est maintenant hors de danger.`,
      ]));
    }
  });
  if (f.castle) {
    const wing = f.castle === 'k' ? 'côté Roi' : 'côté Dame';
    idea.push(v('castle', [
      `Roque ${wing} : le Roi se met à l’abri et la Tour entre dans le jeu.`,
      `Roque ${wing} : sécurité du Roi et Tour activée en un seul coup.`,
      `Le Roi roque ${wing} ; la Tour se rapproche du centre.`,
    ]));
  }
  if (f.development) {
    idea.push(v('dev', [
      `Développe ${fr.le(f.piece)} en ${fr.sq(f.to)} : une pièce de plus participe à la partie.`,
      `Sortie ${fr.du(f.piece)} en ${fr.sq(f.to)} : le développement progresse.`,
      `${fr.cap(fr.le(f.piece))} quitte sa case de départ pour ${fr.sq(f.to)}.`,
    ]));
  }
  if (f.center) {
    idea.push(v('center', [
      `Occupe le centre avec le pion ${fr.sq(f.to)}, ce qui donne de l’espace aux pièces.`,
      `Pion au centre en ${fr.sq(f.to)} : plus d’espace pour les pièces.`,
      `Prend le centre avec le pion ${fr.sq(f.to)}.`,
    ]));
  }
  if (f.passed) {
    const sq = fr.sq(f.passed.sq);
    idea.push(f.passed.created
      ? v('passed-new', [
        `Crée un pion passé en ${sq} : plus aucun pion adverse ne peut lui barrer la route.`,
        `Le pion ${sq} devient passé : aucun pion adverse ne peut plus le bloquer.`,
        `Nouveau pion passé en ${sq}.`,
      ])
      : v('passed-push', [
        `Pousse le pion passé vers la promotion (${sq}).`,
        `Le pion passé avance en ${sq}.`,
        `Le pion passé progresse vers la promotion (${sq}).`,
      ]));
  }
  if (f.file) {
    const kind = f.file.status === 'open' ? 'ouverte' : 'semi-ouverte';
    idea.push(v('file', [
      `Place la Tour sur la colonne ${kind} ${f.file.file}.`,
      `La Tour prend la colonne ${kind} ${f.file.file}.`,
      `Tour sur la colonne ${kind} ${f.file.file}.`,
    ]));
  }
  if (f.mobility && f.mobility.after >= f.mobility.before + 3 && !f.capture) {
    const { after, before } = f.mobility;
    idea.push(v('active', [
      `Active ${fr.le(f.piece)} : ${fr.ilElle(f.piece)} contrôle ${after} cases contre ${before} avant.`,
      `${fr.cap(fr.le(f.piece))} gagne en activité : ${after} cases contrôlées au lieu de ${before}.`,
      `Meilleure position pour ${fr.le(f.piece)} (${after} cases contrôlées, contre ${before}).`,
    ]));
  }

  f.hangs.forEach((h, k) => {
    // Déjà dit plus haut : sacrifice d'un bon coup, pièce interposée contre un échec, ou prise
    // perdante dont la phrase donne déjà le coût.
    if (h.moved && f.sacrifice && f.sacrifice.sq === h.sq && (!bad || interposed)) return;
    if (h.moved && f.capture && f.capture.net < 0) return;
    const pc = fr.pc(h.t, h.sq);
    const loss = fr.pawns(h.loss);
    if (h.moved) {
      warn.push(v(`hang-moved${k}`, [
        `${fr.cap(pc)} peut être pris${fr.e(h.t)} : l’adversaire gagne ${loss}.`,
        `${fr.cap(pc)} est en prise : ${loss} à perdre.`,
        `L’adversaire peut prendre ${pc} et gagner ${loss}.`,
      ]));
    } else if (h.unguarded) {
      warn.push(v(`hang-left${k}`, [
        `En quittant ${fr.sq(f.from)}, ${fr.le(f.piece)} ne protège plus ${pc}, qui devient vulnérable (${loss}).`,
        `${fr.cap(pc)} perd sa protection : ${fr.le(f.piece)} a quitté ${fr.sq(f.from)} (${loss} en jeu).`,
        `Le départ ${fr.du(f.piece)} de ${fr.sq(f.from)} laisse ${pc} sans défense (${loss}).`,
      ]));
    } else if (h.cut) {
      warn.push(v(`hang-cut${k}`, [
        `En ${fr.sq(f.to)}, ${fr.le(f.piece)} coupe la défense ${fr.pcDu(h.cut.t, h.cut.sq)} sur ${pc} (${loss}).`,
        `${fr.cap(fr.le(f.piece))} se place entre ${fr.pc(h.cut.t, h.cut.sq)} et ${pc}, qui perd ce défenseur (${loss}).`,
      ]));
    } else if (h.unmasked) {
      warn.push(v(`hang-unmask${k}`, [
        `En quittant ${fr.sq(f.from)}, ${fr.le(f.piece)} ouvre la ligne ${fr.pcDu(h.unmasked.t, h.unmasked.sq)} vers ${pc} (${loss}).`,
        `Le départ ${fr.du(f.piece)} démasque ${fr.pc(h.unmasked.t, h.unmasked.sq)}, qui vise maintenant ${pc} (${loss}).`,
      ]));
    } else {
      warn.push(v(`hang${k}`, [
        `Laisse ${pc} sans défense suffisante (${loss}).`,
        `${fr.cap(pc)} n’est plus assez défendu${fr.e(h.t)} (${loss}).`,
        `${fr.cap(pc)} devient vulnérable (${loss}).`,
      ]));
    }
  });
  f.ignored.forEach((g, k) => {
    const pc = fr.pc(g.t, g.sq);
    // En échec, le coup était imposé : on constate sans reprocher.
    warn.push(f.evasion
      ? v(`ignored-check${k}`, [`${fr.cap(pc)} reste en prise.`, `${fr.cap(pc)} est toujours en prise.`])
      : v(`ignored${k}`, [
        `Ne s’occupe pas ${fr.pcDu(g.t, g.sq)}, toujours en prise.`,
        `${fr.cap(pc)} reste en prise.`,
        `La menace sur ${pc} n’est pas traitée.`,
      ]));
  });
  if (f.loseCastle) {
    warn.push(v('castle-lost', [
      'Le Roi bouge et perd définitivement le droit de roquer.',
      'Ce déplacement du Roi supprime le droit de roquer.',
      'Le Roi ne pourra plus roquer.',
    ]));
  }

  return { idea, warn };
}

// Résumé très court d'une ligne (pour la liste des options du moteur).
export function shortIdea(line) {
  if (!line || !line.moves.length) return '';
  const v = (slot, variants) => fr.pick(`short|${slot}|${line.fen}|${line.moves[0].lan}`, variants);
  if (line.mated && line.mated !== line.pov) {
    const n = Math.ceil(line.moves.length / 2);
    return v('mate', [`mat en ${n}`, `mat forcé en ${n}`]);
  }
  // `short` : « la qualité » sans sa parenthèse, le résumé étant lui-même entre parenthèses.
  const mat = line.material.short || line.material.text;
  const f = line.facts[0];
  const m = line.motif;
  if (m && m.key !== 'material') {
    const extra = mat && line.gain >= 1 ? v('extra', [`, gagne ${mat}`, `, rapporte ${mat}`]) : '';
    // Une reprise reste une reprise, même si elle rapporte : on donne le bilan de tout l'échange.
    if (m.key === 'free' && f && f.capture && f.capture.retake) {
      return `${v('retake', [`reprend ${fr.le(f.capture.t)}`, `reprise ${fr.du(f.capture.t)}`])}${mat && line.gain >= 1 ? `, bilan : ${mat}` : ''}`;
    }
    // Motif créé plus loin dans la variante : le premier coup le prépare.
    if (m.ply > 0 && m.f && MOTIFS[m.key]) {
      const name = MOTIFS[m.key].label.toLowerCase();
      const base = m.sacrifice ? `sacrifice, puis ${name}` : `prépare ${MOTIFS[m.key].fem ? 'une' : 'un'} ${name}`;
      return base + extra;
    }
    return motifLabel(m).toLowerCase() + extra;
  }
  if (line.gain >= 2 && mat) return v('win', [`gagne ${mat}`, `rapporte ${mat}`]);
  if (!f) return '';
  if (f.evasion) {
    const how = f.capture && f.capture.checker
      ? v('ev-x', ['prend la pièce qui donnait échec', 'élimine la pièce qui donnait échec'])
      : f.piece === 'k'
        ? v('ev-k', ['le Roi sort de l’échec', 'met le Roi hors d’échec'])
        : v('ev-b', ['pare l’échec', 'pare l’échec en s’interposant']);
    return f.threats.length ? `${how}${v('ev-t', [` et vise ${fr.le(f.threats[0].t)}`, `, en attaquant ${fr.le(f.threats[0].t)}`])}` : how;
  }
  if (f.castle) return v('castle', ['met le Roi à l’abri', 'roque']);
  if (f.capture && f.capture.retake) return v('retake', [`reprend ${fr.le(f.capture.t)}`, `reprise ${fr.du(f.capture.t)}`]);
  if (f.capture && f.capture.net === 0) return v('trade', ['échange', `échange de ${f.piece === 'p' ? 'pions' : 'pièces'}`]);
  if (f.desperado && f.capture) return v('desperado', [`vend ${fr.le(f.piece)} contre ${fr.un(f.capture.t)}`, `${fr.le(f.piece)}, perdu${fr.e(f.piece)}, prend ${fr.un(f.capture.t)}`]);
  if (f.sacrifice) return v('sac', [`sacrifie ${fr.le(f.sacrifice.t)}`, `donne ${fr.le(f.sacrifice.t)}`]);
  if (f.capture) return v('take', [`prend ${fr.un(f.capture.t)}`, `capture ${fr.un(f.capture.t)}`]);
  if (f.check) return v('check', ['échec', 'donne échec']);
  if (f.development) return v('dev', [`développe ${fr.le(f.piece)}`, `sort ${fr.le(f.piece)}`]);
  // La pièce jouée d'abord : « 12.Dg3 (sauve la Dame) » plutôt que le pion qu'elle protège au passage.
  const s = f.saved.find((x) => x.moved) || f.saved[0];
  if (s && s.moved) return v('save', [`sauve ${fr.le(s.t)}`, `met ${fr.le(s.t)} à l’abri`]);
  if (s) return v('protect', [`protège ${fr.le(s.t)}`, `défend ${fr.le(s.t)}`]);
  if (f.threats.length) return v('threat', [`attaque ${fr.le(f.threats[0].t)}`, `vise ${fr.le(f.threats[0].t)}`]);
  if (f.passed) return v('passed', ['pousse le pion passé', 'avance le pion passé']);
  if (f.file) {
    const kind = f.file.status === 'open' ? 'ouverte' : 'semi-ouverte';
    return v('file', [`Tour sur la colonne ${kind}`, `active la Tour sur la colonne ${kind}`]);
  }
  if (f.center) return v('center', ['occupe le centre', 'prend le centre']);
  if (f.piece === 'p') {
    // « Gagner de l'espace » suppose un pion qui atteint la moitié adverse de l'échiquier.
    const rank = sqIndex(f.to) >> 3;
    const far = f.me === 'w' ? rank >= 4 : rank <= 3;
    return far ? v('pawn', ['gagne de l’espace', 'avance un pion']) : v('pawn-short', ['avance un pion', 'pousse un pion']);
  }
  if (f.piece === 'k') return v('king', ['replace le Roi', 'déplace le Roi']);
  return v('piece', [`replace ${fr.le(f.piece)}`, `manœuvre ${fr.le(f.piece)}`]);
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

const VERDICTS = {
  easy: [
    'Accessible à ce niveau : ce genre de tactique ne doit plus passer inaperçu.',
    'Tactique à la portée de ce niveau : à repérer systématiquement.',
    'Accessible à ce niveau : elle fait partie des motifs à connaître.',
  ],
  fair: [
    'Au niveau de la partie : elle était trouvable en cherchant les coups forcés.',
    'Du niveau de la partie : passer en revue les échecs et les captures suffisait.',
    'Au niveau du joueur : trouvable avec un calcul attentif.',
  ],
  hard: [
    'Difficile pour ce niveau, mais c’est exactement le type d’idée à apprendre à repérer.',
    'Au-dessus du niveau de la partie, mais l’idée mérite d’être retenue.',
    'Difficile à ce niveau ; le motif reste utile à étudier.',
  ],
};

export function difficultyVerdict(d, elo, key = '') {
  if (d == null || !elo) return null;
  const k = d <= elo - 50 ? 'easy' : d <= elo + 250 ? 'fair' : 'hard';
  return { key: k, text: fr.pick(`verdict|${key}`, VERDICTS[k]) };
}
