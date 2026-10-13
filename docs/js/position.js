// Modèle d'échiquier léger utilisé pour reconnaître les motifs tactiques.
// Les cases sont indexées de 0 (a1) à 63 (h8).

export const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const SEE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
const FILES = 'abcdefgh';

export const sqName = (i) => FILES[i & 7] + ((i >> 3) + 1);
export const sqIndex = (s) => s.charCodeAt(0) - 97 + (s.charCodeAt(1) - 49) * 8;
export const opp = (c) => (c === 'w' ? 'b' : 'w');

export function parseFen(fen) {
  const [placement, turn = 'w', castling = '-', ep = '-'] = fen.split(' ');
  const sq = new Array(64).fill(null);
  placement.split('/').forEach((row, r) => {
    let f = 0;
    for (const ch of row) {
      if (ch >= '1' && ch <= '8') {
        f += +ch;
      } else {
        sq[(7 - r) * 8 + f] = { t: ch.toLowerCase(), c: ch === ch.toLowerCase() ? 'b' : 'w' };
        f++;
      }
    }
  });
  return { sq, turn, castling, ep };
}

const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function slideDirs(t) {
  if (t === 'b') return DIAG;
  if (t === 'r') return ORTH;
  if (t === 'q') return [...DIAG, ...ORTH];
  return [];
}

export function attacksFrom(pos, i) {
  const p = pos.sq[i];
  if (!p) return [];
  const f = i & 7;
  const r = i >> 3;
  const out = [];
  const jump = (dirs) => {
    for (const [df, dr] of dirs) {
      const nf = f + df;
      const nr = r + dr;
      if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) out.push(nr * 8 + nf);
    }
  };
  if (p.t === 'p') {
    const dr = p.c === 'w' ? 1 : -1;
    jump([[-1, dr], [1, dr]]);
  } else if (p.t === 'n') {
    jump(KNIGHT);
  } else if (p.t === 'k') {
    jump(KING);
  } else {
    for (const [df, dr] of slideDirs(p.t)) {
      let nf = f + df;
      let nr = r + dr;
      while (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) {
        const j = nr * 8 + nf;
        out.push(j);
        if (pos.sq[j]) break;
        nf += df;
        nr += dr;
      }
    }
  }
  return out;
}

export function attackersOf(pos, target, color) {
  const res = [];
  for (let i = 0; i < 64; i++) {
    const p = pos.sq[i];
    if (p && p.c === color && attacksFrom(pos, i).includes(target)) res.push(i);
  }
  return res;
}

export function findKing(pos, color) {
  return pos.sq.findIndex((p) => p && p.t === 'k' && p.c === color);
}

function leastValuable(pos, target, color) {
  let best = -1;
  let bestVal = Infinity;
  for (const i of attackersOf(pos, target, color)) {
    const v = SEE_VALUE[pos.sq[i].t];
    if (v < bestVal) { bestVal = v; best = i; }
  }
  return best;
}

// Échange statique (SEE) : gain matériel, en pions, pour `by` s'il commence
// à capturer sur `target` et que chaque camp choisit au mieux de continuer.
// Positif = la capture rapporte du matériel.
export function see(pos, target, by) {
  const sq = pos.sq.slice();
  const board = { sq };
  const victim = sq[target];
  if (!victim || victim.c === by) return 0;
  let from = leastValuable(board, target, by);
  if (from < 0) return 0;
  const gain = [SEE_VALUE[victim.t]];
  let d = 0;
  let side = by;
  let piece = sq[from];
  for (;;) {
    d++;
    gain[d] = SEE_VALUE[piece.t] - gain[d - 1];
    if (Math.max(-gain[d - 1], gain[d]) < 0) break;
    sq[target] = piece;
    sq[from] = null;
    side = opp(side);
    from = leastValuable(board, target, side);
    if (from < 0) break;
    piece = sq[from];
  }
  while (--d) gain[d - 1] = -Math.max(-gain[d - 1], gain[d]);
  return gain[0];
}

export function material(pos) {
  const m = { w: 0, b: 0 };
  for (const p of pos.sq) if (p) m[p.c] += VALUE[p.t];
  return m;
}

export function nonPawnMaterial(pos) {
  let total = 0;
  for (const p of pos.sq) if (p && p.t !== 'p') total += VALUE[p.t];
  return total;
}

// Clouages et enfilades créés par les pièces à longue portée de `color`.
export function linesBy(pos, color) {
  const res = [];
  for (let i = 0; i < 64; i++) {
    const p = pos.sq[i];
    if (!p || p.c !== color || !'brq'.includes(p.t)) continue;
    for (const [df, dr] of slideDirs(p.t)) {
      let f = (i & 7) + df;
      let r = (i >> 3) + dr;
      let first = -1;
      while (f >= 0 && f < 8 && r >= 0 && r < 8) {
        const j = r * 8 + f;
        const q = pos.sq[j];
        if (q) {
          if (first < 0) {
            if (q.c === color) break;
            first = j;
          } else {
            if (q.c !== color) {
              const a = pos.sq[first];
              if (q.t === 'k' && a.t !== 'k') {
                res.push({ kind: 'pin', absolute: true, by: i, pinned: first, behind: j });
              } else if ((a.t === 'k' || VALUE[a.t] > VALUE[q.t]) && q.t !== 'p' && (a.t === 'k' || a.t === 'q' || a.t === 'r')) {
                res.push({ kind: 'skewer', by: i, front: first, behind: j });
              } else if (a.t !== 'p' && VALUE[q.t] > VALUE[a.t]) {
                res.push({ kind: 'pin', absolute: false, by: i, pinned: first, behind: j });
              }
            }
            break;
          }
        }
        f += df;
        r += dr;
      }
    }
  }
  return res;
}

export function isPassed(pos, i) {
  const p = pos.sq[i];
  if (!p || p.t !== 'p') return false;
  const f = i & 7;
  const dir = p.c === 'w' ? 1 : -1;
  for (let r = (i >> 3) + dir; r >= 0 && r < 8; r += dir) {
    for (let ff = f - 1; ff <= f + 1; ff++) {
      if (ff < 0 || ff > 7) continue;
      const q = pos.sq[r * 8 + ff];
      if (q && q.t === 'p' && q.c !== p.c) return false;
    }
  }
  return true;
}

// 'open' : aucun pion sur la colonne ; 'half' : aucun pion de `color`.
export function fileStatus(pos, file, color) {
  let own = false;
  let theirs = false;
  for (let r = 0; r < 8; r++) {
    const q = pos.sq[r * 8 + file];
    if (q && q.t === 'p') {
      if (q.c === color) own = true;
      else theirs = true;
    }
  }
  if (!own && !theirs) return 'open';
  if (!own) return 'half';
  return null;
}
