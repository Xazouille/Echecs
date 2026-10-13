// Analyse d'une partie complète : évaluation de chaque position, classement de chaque coup,
// précision des joueurs et bilan.
import { Chess } from '../vendor/chess.js';
import { bookInfo, nameFromEcoUrl } from './openings.js';
import { analyzeLine, moveFacts, difficulty, difficultyVerdict, MATE_KEYS } from './explain.js';
import { parseFen, nonPawnMaterial, opp } from './position.js';
import * as fr from './fr.js';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export const DEPTHS = { rapide: 12, standard: 15, approfondie: 18 };

export const CLASSES = {
  brilliant: { label: 'Brillant', phrase: 'un coup brillant', glyph: '!!' },
  great: { label: 'Très bon coup', phrase: 'un très bon coup', glyph: '!' },
  best: { label: 'Meilleur coup', phrase: 'le meilleur coup', glyph: 'best' },
  excellent: { label: 'Excellent', phrase: 'un excellent coup', glyph: 'excellent' },
  good: { label: 'Bon', phrase: 'un bon coup', glyph: 'good' },
  book: { label: 'Théorique', phrase: 'un coup théorique', glyph: 'book' },
  forced: { label: 'Forcé', phrase: 'le seul coup légal', glyph: 'forced' },
  inaccuracy: { label: 'Imprécision', phrase: 'une imprécision', glyph: '?!' },
  mistake: { label: 'Erreur', phrase: 'une erreur', glyph: '?' },
  miss: { label: 'Occasion manquée', phrase: 'une occasion manquée', glyph: 'miss' },
  blunder: { label: 'Gaffe', phrase: 'une gaffe', glyph: '??' },
};
export const CLASS_ORDER = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder'];

export const LEVELS = {
  debutant: { label: 'Débutant', hint: 'moins de 1000', elo: 800, k: 1.4 },
  intermediaire: { label: 'Intermédiaire', hint: '1000 à 1600', elo: 1300, k: 1.15 },
  confirme: { label: 'Confirmé', hint: '1600 à 2000', elo: 1800, k: 1 },
  expert: { label: 'Expert', hint: '2000 et plus', elo: 2200, k: 0.85 },
};

export function levelForElo(elo) {
  if (!elo) return 'intermediaire';
  if (elo < 1000) return 'debutant';
  if (elo < 1600) return 'intermediaire';
  if (elo < 2000) return 'confirme';
  return 'expert';
}

export function thresholds(levelKey) {
  const k = LEVELS[levelKey].k;
  return { excellent: 2 * k, good: 5 * k, inaccuracy: 10 * k, mistake: 20 * k };
}

// ---------- Évaluations ----------

const stm = (fen) => fen.split(' ')[1];

export function winPct(score) {
  if (!score) return 50;
  if (score.mate !== undefined) return score.mate > 0 ? 100 : 0;
  const cp = Math.max(-1000, Math.min(1000, score.cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

export const negate = (s) => (s.mate !== undefined ? { mate: -s.mate } : { cp: -s.cp });

// Score (camp au trait) de la position vue depuis la position précédente :
// « mat en 0 » pour le camp au trait devient « mat en 1 » pour celui qui vient de jouer.
const shift = (s) => (s.mate !== undefined ? (s.mate <= 0 ? { mate: 1 - s.mate } : { mate: -s.mate }) : { cp: -s.cp });

const rank = (s) => {
  if (s.mate === undefined) return s.cp;
  return s.mate > 0 ? 100000 - s.mate : -100000 - s.mate;
};

// Évaluation retenue d'une position : celle du moteur, corrigée par la suite de la partie si besoin.
export function scoreOf(pos) {
  if (!pos) return { cp: 0 };
  if (pos.terminal === 'mate') return { mate: 0 };
  return pos.refined || (pos.lines[0] && pos.lines[0].score) || { cp: 0 };
}

export function whiteScore(pos) {
  if (!pos) return null;
  if (pos.terminal === 'mate') return { mate: 0 };
  const s = scoreOf(pos);
  return stm(pos.fen) === 'w' ? s : negate(s);
}

export function whiteWin(pos) {
  if (!pos) return 50;
  if (pos.terminal === 'mate') return stm(pos.fen) === 'w' ? 0 : 100;
  const p = winPct(scoreOf(pos));
  return stm(pos.fen) === 'w' ? p : 100 - p;
}

export function whiteEvalText(pos) {
  if (!pos) return '…';
  if (pos.terminal === 'mate') return stm(pos.fen) === 'w' ? '0-1' : '1-0';
  if (pos.terminal === 'draw') return '½-½';
  return fr.evalText(whiteScore(pos));
}

function terminalEval(fen) {
  const c = new Chess(fen);
  if (c.isCheckmate()) return { fen, lines: [{ score: { mate: 0 }, pv: [] }], depth: 99, terminal: 'mate' };
  if (c.isStalemate() || c.isInsufficientMaterial()) return { fen, lines: [{ score: { cp: 0 }, pv: [] }], depth: 99, terminal: 'draw' };
  return null;
}

const cache = new Map();
const fenKey = (fen) => fen.split(' ').slice(0, 4).join(' ');

export function cachedEval(fen, depth = 0) {
  const t = terminalEval(fen);
  if (t) return t;
  const hit = cache.get(fenKey(fen));
  return hit && hit.depth >= depth ? hit : null;
}

export async function evaluate(engine, fen, { depth, priority = false, tag = '' }) {
  const hit = cachedEval(fen, depth);
  if (hit) return hit;
  const res = await engine.analyze(fen, { depth, multipv: 3, priority, tag });
  if (!res) return null;
  const out = { fen, lines: res.lines, depth: res.depth };
  cache.set(fenKey(fen), out);
  return out;
}

// ---------- Lecture d'une partie ----------

function parseClock(txt) {
  const parts = txt.split(':').map(Number);
  return parts.reduce((s, v) => s * 60 + v, 0);
}

function parseTimeControl(tc) {
  if (!tc || tc.includes('/')) return null;
  const [base, inc] = tc.split('+').map(Number);
  if (!base) return null;
  return { base, inc: inc || 0 };
}

export function parseGame(pgn, meta = {}) {
  const chess = new Chess();
  try {
    chess.loadPgn(pgn);
  } catch (err) {
    throw new Error(`PGN illisible : ${err.message}`);
  }
  const headers = chess.getHeaders();
  const moves = chess.history({ verbose: true });
  if (!moves.length) throw new Error('Cette partie ne contient aucun coup.');
  const startFen = moves[0].before;
  const fens = [startFen, ...moves.map((m) => m.after)];
  const clocks = [...pgn.matchAll(/%clk\s+([\d:.]+)/g)].map((m) => parseClock(m[1]));
  const book = startFen === START_FEN ? bookInfo(moves.map((m) => m.san)) : { depth: 0, name: '' };
  const tc = parseTimeControl(headers.TimeControl);
  const game = {
    headers,
    moves,
    fens,
    startFen,
    tc,
    clocks: clocks.length === moves.length ? clocks : null,
    white: { name: headers.White || 'Blancs', elo: +headers.WhiteElo || null },
    black: { name: headers.Black || 'Noirs', elo: +headers.BlackElo || null },
    result: headers.Result || '*',
    termination: headers.Termination || '',
    opening: book.name || nameFromEcoUrl(headers.ECOUrl),
    ecoName: nameFromEcoUrl(headers.ECOUrl),
    bookDepth: book.depth,
    date: headers.UTCDate || headers.Date || '',
    url: meta.url || headers.Link || '',
    userColor: meta.userColor || null,
    chesscomAcc: meta.accuracies || null,
    timeClass: meta.timeClass || '',
  };
  game.spent = moves.map((m, i) => {
    if (!game.clocks) return null;
    const prev = i >= 2 ? game.clocks[i - 2] : tc ? tc.base : null;
    if (prev == null) return null;
    return Math.max(0, prev - game.clocks[i] + (i >= 2 && tc ? tc.inc : 0));
  });
  return game;
}

// ---------- Classement d'un coup ----------

function moveAccuracy(winBefore, winAfter) {
  if (winAfter >= winBefore) return 100;
  const raw = 103.1668100711649 * Math.exp(-0.04354415386753951 * (winBefore - winAfter)) - 3.166924740191411 + 1;
  return Math.max(0, Math.min(100, raw));
}

export function makeReport({ move, ply, before, after, prev = null, levelKey = 'intermediaire', elo = null, book = false }) {
  const me = move.color;
  const T = thresholds(levelKey);
  const lines = before.lines || [];
  const top = lines[0];
  const winBefore = winPct(scoreOf(before));
  const winAfter = after.terminal === 'mate' ? 100 : after.terminal === 'draw' ? 50 : 100 - winPct(scoreOf(after));
  const loss = Math.max(0, winBefore - winAfter);
  const isBest = !!top && top.pv[0] === move.lan;
  const playedLine = lines.find((l) => l.pv[0] === move.lan);
  const tiedBest = loss <= 0.3 || (!!playedLine && winPct(playedLine.score) >= winBefore - 0.3);
  const forcedMate = after.terminal === 'mate' || (scoreOf(after).mate !== undefined && scoreOf(after).mate <= 0);
  const legal = new Chess(move.before).moves().length;
  const facts = moveFacts(move, ply);

  const best = top && top.pv.length ? analyzeLine(move.before, top.pv) : null;
  const played = analyzeLine(move.before, [move.lan, ...((after.lines[0] && after.lines[0].pv) || [])]);
  const reply = after.lines[0] && after.lines[0].pv.length ? analyzeLine(move.after, after.lines[0].pv) : null;
  const alts = lines.map((l) => ({ score: l.score, line: analyzeLine(move.before, l.pv, { max: 8 }), uci: l.pv[0] }));

  let cls;
  if (legal === 1) cls = 'forced';
  else if (book) cls = 'book';
  else if (isBest || tiedBest) cls = 'best';
  else if (loss <= T.excellent) cls = 'excellent';
  else if (loss <= T.good) cls = 'good';
  else if (loss <= T.inaccuracy) cls = 'inaccuracy';
  else if (loss <= T.mistake) cls = 'mistake';
  else cls = 'blunder';

  const bestMates = !!(best && best.mated && best.mated !== me);
  const playedMates = !!(played.mated && played.mated !== me);
  const missedTactic = cls !== 'best' && cls !== 'forced' && cls !== 'book' && !!best && !!best.motif
    && loss > T.excellent && ((bestMates && !playedMates) || best.net - played.net >= 2);

  if (['inaccuracy', 'mistake', 'blunder'].includes(cls) && missedTactic && prev
    && ['inaccuracy', 'mistake', 'blunder', 'miss'].includes(prev.cls) && played.net >= -1 && played.mated !== me) {
    cls = 'miss';
  }

  if ((cls === 'best' || cls === 'excellent') && facts.sacrifice && facts.sacrifice.t !== 'p' && !facts.mate
    && winAfter >= 45 && (winBefore < 97 || forcedMate)) {
    cls = 'brilliant';
  } else if (cls === 'best' && lines.length >= 2 && !facts.mate) {
    const second = winPct(lines[1].score);
    const recapture = !!(prev && prev.move.captured && move.to === prev.move.to);
    if (winBefore - second >= 15 && second <= 85 && !recapture) cls = 'great';
  }

  const diff = missedTactic ? difficulty(best) : null;
  return {
    ply, move, me, them: opp(me),
    san: move.san, sanFr: fr.sanFr(move.san), num: fr.moveNumber(move.before, me),
    cls, loss, winBefore, winAfter, accuracy: moveAccuracy(winBefore, winAfter),
    isBest, legal, levelKey, elo, thresholds: T,
    before, after, best, played, reply, alts, facts,
    missedTactic, bestMates,
    difficulty: diff,
    difficultyVerdict: diff ? difficultyVerdict(diff, elo || LEVELS[levelKey].elo) : null,
    secondGap: lines.length >= 2 ? winBefore - winPct(lines[1].score) : null,
  };
}

// ---------- Analyse complète ----------

export class GameAnalysis {
  constructor(game, engine, settings) {
    this.game = game;
    this.engine = engine;
    this.settings = settings;
    this.positions = new Array(game.fens.length).fill(null);
    this.reports = new Array(game.moves.length).fill(null);
    this.done = false;
    this.cancelled = false;
    this.summary = null;
    this.tag = `partie-${Date.now()}`;
  }

  get depth() {
    return DEPTHS[this.settings.depth] || DEPTHS.standard;
  }

  levelFor(color) {
    if (this.settings.level && this.settings.level !== 'auto') return this.settings.level;
    const p = color === 'w' ? this.game.white : this.game.black;
    const other = color === 'w' ? this.game.black : this.game.white;
    return levelForElo(p.elo || other.elo);
  }

  eloFor(color) {
    if (this.settings.level && this.settings.level !== 'auto') return LEVELS[this.settings.level].elo;
    const p = color === 'w' ? this.game.white : this.game.black;
    return p.elo || LEVELS[this.levelFor(color)].elo;
  }

  cancel() {
    this.cancelled = true;
    this.engine.cancelAll((job) => job.tag === this.tag);
  }

  // onUpdate(fait, total, phase) — phase : 'scan' (première passe) ou 'check' (vérification).
  async run(onUpdate) {
    const n = this.game.fens.length;
    for (let i = 0; i < n; i++) {
      if (this.cancelled) return;
      const res = await evaluate(this.engine, this.game.fens[i], { depth: this.depth, tag: this.tag });
      if (this.cancelled || !res) return;
      this.positions[i] = res;
      if (i >= 1) this.buildReport(i - 1);
      onUpdate(i + 1, n, 'scan');
    }
    this.refine();
    this.rebuild();

    // Les coups qui changent le cours de la partie sont revérifiés plus profondément.
    const critical = new Set();
    this.reports.forEach((r, i) => {
      if (['mistake', 'blunder', 'miss', 'brilliant', 'great'].includes(r.cls)) { critical.add(i); critical.add(i + 1); }
    });
    const todo = [...critical].filter((i) => !this.positions[i].terminal).slice(0, 24);
    for (let k = 0; k < todo.length; k++) {
      if (this.cancelled) return;
      onUpdate(k, todo.length, 'check');
      const i = todo[k];
      const res = await evaluate(this.engine, this.game.fens[i], { depth: this.depth + 4, tag: this.tag });
      if (this.cancelled || !res) return;
      this.positions[i] = res;
    }
    this.refine();
    this.done = true;
    this.rebuild();
    onUpdate(n, n, 'done');
  }

  // Remonte la partie depuis la fin : la valeur d'un coup joué est celle de la position
  // qu'il produit, ce qui corrige les mats ou tactiques que le moteur ne voyait qu'un coup plus tard.
  refine() {
    const P = this.positions;
    const M = this.game.moves;
    const n = P.length - 1;
    for (const p of P) if (p) p.refined = null;
    let next = scoreOf(P[n]);
    for (let i = n - 1; i >= 0; i--) {
      const pos = P[i];
      if (pos.terminal) { next = scoreOf(pos); continue; }
      let best = shift(next);
      for (const l of pos.lines) {
        if (l.pv[0] !== M[i].lan && rank(l.score) > rank(best)) best = l.score;
      }
      pos.refined = best;
      next = best;
    }
  }

  // Reclasse les coups déjà analysés (après un changement de niveau ou une vérification).
  rebuild() {
    for (let i = 0; i < this.reports.length; i++) {
      if (this.positions[i] && this.positions[i + 1]) this.buildReport(i);
    }
    if (this.done) this.summary = buildSummary(this);
  }

  buildReport(i) {
    const move = this.game.moves[i];
    this.reports[i] = makeReport({
      move,
      ply: i,
      before: this.positions[i],
      after: this.positions[i + 1],
      prev: i > 0 ? this.reports[i - 1] : null,
      levelKey: this.levelFor(move.color),
      elo: this.eloFor(move.color),
      book: i < this.game.bookDepth,
    });
    this.reports[i].spent = this.game.spent[i];
    this.reports[i].clock = this.game.clocks ? this.game.clocks[i] : null;
  }
}

// ---------- Bilan ----------

function stdev(xs) {
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
}

function gameAccuracy(an, color) {
  const wins = an.positions.map(whiteWin);
  const n = an.reports.length;
  const size = Math.max(2, Math.min(8, Math.floor(n / 10)));
  let wSum = 0;
  let wTot = 0;
  let hSum = 0;
  let count = 0;
  an.reports.forEach((r, i) => {
    if (r.me !== color) return;
    const start = i < size - 2 ? 0 : i - (size - 2);
    const win = wins.slice(start, start + size);
    const w = Math.max(0.5, Math.min(12, stdev(win)));
    wSum += r.accuracy * w;
    wTot += w;
    hSum += 1 / Math.max(1, r.accuracy);
    count++;
  });
  if (!count) return null;
  return (wSum / wTot + count / hSum) / 2;
}

const PERF = [[0, 250], [40, 400], [55, 700], [65, 1000], [72, 1250], [78, 1500], [83, 1750], [87, 2000], [90, 2200], [93, 2450], [96, 2700], [98.5, 2900], [100, 3100]];

export function perfFromAccuracy(acc) {
  if (acc == null) return null;
  for (let i = 1; i < PERF.length; i++) {
    const [a1, e1] = PERF[i - 1];
    const [a2, e2] = PERF[i];
    if (acc <= a2) return Math.round((e1 + ((acc - a1) / (a2 - a1)) * (e2 - e1)) / 50) * 50;
  }
  return 3100;
}

function phaseOf(fen, ply, bookDepth) {
  if (nonPawnMaterial(parseFen(fen)) <= 26) return 'endgame';
  if (ply < Math.max(bookDepth, 20)) return 'opening';
  return 'middlegame';
}

export function buildSummary(an) {
  const { game, reports } = an;
  const players = {};
  for (const c of ['w', 'b']) {
    const counts = Object.fromEntries(Object.keys(CLASSES).map((k) => [k, 0]));
    const phases = { opening: [], middlegame: [], endgame: [] };
    const missed = [];
    const themes = {};
    const fell = {};
    let hung = 0;
    let rushed = 0;
    let lowClockErrors = 0;
    for (const r of reports) {
      if (!r || r.me !== c) continue;
      counts[r.cls]++;
      phases[phaseOf(r.move.before, r.ply, game.bookDepth)].push(r.accuracy);
      const bad = ['mistake', 'blunder', 'miss'].includes(r.cls);
      if (r.missedTactic) {
        missed.push(r);
        const k = MATE_KEYS.includes(r.best.motif.key) ? 'mate' : r.best.motif.key;
        themes[k] = (themes[k] || 0) + 1;
      }
      if (['mistake', 'blunder'].includes(r.cls)) {
        if (r.facts.hangs.length || r.facts.ignored.length) hung++;
        if (r.reply && r.reply.motif) {
          const k = MATE_KEYS.includes(r.reply.motif.key) ? 'mate' : r.reply.motif.key;
          fell[k] = (fell[k] || 0) + 1;
        }
      }
      if (bad && r.spent != null && r.spent < 3 && game.tc && game.tc.base >= 180) rushed++;
      if (bad && r.clock != null && game.tc && r.clock < Math.max(15, game.tc.base * 0.1)) lowClockErrors++;
    }
    const accuracy = gameAccuracy(an, c);
    const avg = (xs) => (xs.length >= 2 ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
    players[c] = {
      counts,
      accuracy,
      perf: perfFromAccuracy(accuracy),
      phases: { opening: avg(phases.opening), middlegame: avg(phases.middlegame), endgame: avg(phases.endgame) },
      missed,
      themes,
      fell,
      hung,
      rushed,
      lowClockErrors,
      levelKey: an.levelFor(c),
      elo: an.eloFor(c),
    };
  }
  const keyMoments = reports
    .filter((r) => r && (['mistake', 'blunder', 'miss'].includes(r.cls) || r.cls === 'brilliant' || r.cls === 'great'))
    .sort((a, b) => b.loss - a.loss || a.ply - b.ply)
    .slice(0, 5)
    .sort((a, b) => a.ply - b.ply);
  return { players, keyMoments };
}
