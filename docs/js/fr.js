// Petits outils de langue française pour parler des pièces et des coups.

const NOUN = { p: 'pion', n: 'Cavalier', b: 'Fou', r: 'Tour', q: 'Dame', k: 'Roi' };
const PLURAL = { p: 'pions', n: 'Cavaliers', b: 'Fous', r: 'Tours', q: 'Dames', k: 'Rois' };
const FEM = { r: true, q: true };
const NUMBERS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit'];

export const isFem = (t) => !!FEM[t];
export const e = (t) => (FEM[t] ? 'e' : '');
export const ilElle = (t) => (FEM[t] ? 'elle' : 'il');
export const noun = (t) => NOUN[t];
export const le = (t) => (FEM[t] ? 'la ' : 'le ') + NOUN[t];
export const un = (t) => (FEM[t] ? 'une ' : 'un ') + NOUN[t];
export const du = (t) => (FEM[t] ? 'de la ' : 'du ') + NOUN[t];
export const au = (t) => (FEM[t] ? 'à la ' : 'au ') + NOUN[t];

const sqTag = (sq) => `<span class="sqn">${sq}</span>`;

// « le Cavalier en f3 », « le pion e5 »
export const pc = (t, sq) => (t === 'p' ? `le pion ${sqTag(sq)}` : `${le(t)} en ${sqTag(sq)}`);
export const pcDu = (t, sq) => (t === 'p' ? `du pion ${sqTag(sq)}` : `${du(t)} en ${sqTag(sq)}`);
export const pcUn = (t, sq) => (t === 'p' ? `un pion (${sqTag(sq)})` : `${un(t)} en ${sqTag(sq)}`);
export const sq = sqTag;

export const side = (c) => (c === 'w' ? 'les Blancs' : 'les Noirs');
export const Side = (c) => (c === 'w' ? 'Les Blancs' : 'Les Noirs');
export const color = (c) => (c === 'w' ? 'Blancs' : 'Noirs');

const LETTERS = { K: 'R', Q: 'D', R: 'T', B: 'F', N: 'C' };
export const sanFr = (san) => san.replace(/[KQRBN]/g, (c) => LETTERS[c]);

export const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function list(items) {
  if (items.length <= 1) return items.join('');
  return items.slice(0, -1).join(', ') + ' et ' + items[items.length - 1];
}

export function count(n, t) {
  if (n === 1) return un(t);
  const word = NUMBERS[n] || String(n);
  return `${word} ${PLURAL[t]}`;
}

export function pawns(v) {
  const n = Math.round(v * 10) / 10;
  const txt = String(n).replace('.', ',');
  return Math.abs(n) <= 1 ? `${txt} pion` : `${txt} pions`;
}

const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const ORDER = ['q', 'r', 'b', 'n', 'p'];

function group(types) {
  const counts = {};
  for (const t of types) counts[t] = (counts[t] || 0) + 1;
  return list(ORDER.filter((t) => counts[t]).map((t) => count(counts[t], t)));
}

// Décrit un bilan matériel à partir des pièces gagnées et perdues.
export function trade(gained, lost) {
  const g = [...gained];
  const l = [...lost];
  for (let i = g.length - 1; i >= 0; i--) {
    const k = l.indexOf(g[i]);
    if (k >= 0) { l.splice(k, 1); g.splice(i, 1); }
  }
  for (let i = g.length - 1; i >= 0; i--) {
    if (g[i] !== 'n' && g[i] !== 'b') continue;
    const k = l.findIndex((t) => t === 'n' || t === 'b');
    if (k >= 0) { l.splice(k, 1); g.splice(i, 1); }
  }
  const sum = (a) => a.reduce((s, t) => s + VALUE[t], 0);
  const net = sum(g) - sum(l);
  let text = '';
  if (g.length === 1 && g[0] === 'r' && l.length === 1 && (l[0] === 'n' || l[0] === 'b')) {
    text = 'la qualité (une Tour contre une pièce mineure)';
  } else if (g.length && !l.length) {
    text = group(g);
  } else if (g.length && l.length) {
    text = `${group(g)} contre ${group(l)}`;
  }
  return { net, text, gained: g, lost: l, lostText: l.length ? group(l) : '', gainedText: g.length ? group(g) : '' };
}

export function evalText(score) {
  if (!score) return '…';
  if (score.mate !== undefined) {
    if (score.mate === 0) return '#';
    return (score.mate > 0 ? '#' : '−#') + Math.abs(score.mate);
  }
  const v = score.cp / 100;
  const s = Math.abs(v).toFixed(1).replace('.', ',');
  if (Math.abs(v) < 0.05) return '0,0';
  return (v > 0 ? '+' : '−') + s;
}

export function moveNumber(fen, color) {
  const n = +(fen.split(' ')[5] || 1);
  return color === 'w' ? `${n}.` : `${n}…`;
}
