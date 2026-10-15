// Analyse d'une partie complète : évaluation de chaque position, classement de chaque coup,
// précision des joueurs et bilan.
import { Chess } from '../vendor/chess.js';
import { bookInfo, nameFromEcoUrl } from './openings.js';
import { analyzeLine, moveFacts, difficulty, difficultyVerdict, MATE_KEYS } from './explain.js';
import { parseFen, nonPawnMaterial, opp } from './position.js';
import * as fr from './fr.js';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// Réglages d'analyse (15 octobre 2026). `depth` : profondeur du passage sur toutes les positions.
// `check` : profondeur ajoutée pour revérifier les moments clés (0 = pas de vérification).
// `preview` : premier rendu rapide à cette profondeur, affiché pendant l'approfondissement.
// Mesures (Xazouille – Proko91, 53 demi-coups, 4 moteurs) : la vérification à +4 représente
// environ 70 % du travail. Elle est utile à profondeur 12 (sans elle, 7 coups reclassés et
// −1,3 point de précision), mais ne change presque plus rien à partir de 16 (2 coups sur 53).
// « Rapide » reprend l'ancien « Standard », sur lequel la précision a été calée.
export const MODES = {
  rapide: { depth: 12, check: 4 },
  standard: { depth: 15, check: 0 },
  approfondie: { depth: 17, check: 0, preview: 14 },
};
export const DEPTHS = Object.fromEntries(Object.entries(MODES).map(([k, m]) => [k, m.depth]));

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
  debutant: { label: 'Débutant', hint: 'moins de 1000', elo: 800, k: 1.2 },
  intermediaire: { label: 'Intermédiaire', hint: '1000 à 1600', elo: 1300, k: 1 },
  confirme: { label: 'Confirmé', hint: '1600 à 2000', elo: 1800, k: 0.9 },
  expert: { label: 'Expert', hint: '2000 et plus', elo: 2200, k: 0.8 },
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
  return { excellent: 2 * k, good: 4 * k, inaccuracy: 8 * k, mistake: 15 * k };
}

// ---------- Évaluations ----------

const stm = (fen) => fen.split(' ')[1];

function winCurve(score, k, clamp = 1000) {
  if (!score) return 50;
  if (score.mate !== undefined) return score.mate > 0 ? 100 : 0;
  const cp = Math.max(-clamp, Math.min(clamp, score.cp));
  return 50 + 50 * (2 / (1 + Math.exp(-k * cp)) - 1);
}

// Chances de gain (Lichess) : barre d'évaluation, courbe et classement des coups.
export const winPct = (score) => winCurve(score, 0.00368208);

// Chances de gain utilisées pour la précision : courbe plus plate, calée sur Chess.com (voir « Précision »),
// sans plafond à ±10 pions : sur cette courbe plate, le plafond écrasait les écarts dans les positions
// gagnées et faisait passer « mat » contre « +10 » pour une grosse perte.
// Les constantes ACC_* dépendent du moteur : elles sont à recaler si on change de version de Stockfish.
const ACC_K = 0.00175;
const accWinPct = (score) => winCurve(score, ACC_K, Infinity);

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

function whiteChances(pos, curve) {
  if (!pos) return 50;
  if (pos.terminal === 'mate') return stm(pos.fen) === 'w' ? 0 : 100;
  const p = curve(scoreOf(pos));
  return stm(pos.fen) === 'w' ? p : 100 - p;
}

export const whiteWin = (pos) => whiteChances(pos, winPct);

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
const fenKey = (fen, multipv = 3) => `${fen.split(' ').slice(0, 4).join(' ')}|${multipv}`;

export function cachedEval(fen, depth = 0, multipv = 3) {
  const t = terminalEval(fen);
  if (t) return t;
  const hit = cache.get(fenKey(fen, multipv));
  return hit && hit.depth >= depth ? hit : null;
}

// Mémoire permanente des évaluations (IndexedDB, dans le navigateur). Une position déjà analysée,
// dans cette partie (réouverture) ou dans une autre (ouvertures répétées : environ 10 % des
// positions sur les parties de Xazouille), n'est pas recalculée. La clé contient le moteur, pour ne
// pas mélanger le moteur complet et la version lite. Sans IndexedDB (navigation privée…), on s'en
// passe. Au-delà de DB_MAX positions, les plus anciennes sont oubliées.
const DB_MAX = 60000;
let dbPromise = null;
let dbWrites = 0;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open('coup-par-coup', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('evals').createIndex('t', 't');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

async function dbGet(key) {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction('evals').objectStore('evals').get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function dbPut(key, value) {
  const db = await openDb();
  if (!db) return;
  try {
    db.transaction('evals', 'readwrite').objectStore('evals').put({ ...value, t: Date.now() }, key);
    if (++dbWrites % 500 === 0) dbPrune(db);
  } catch {
    // Quota dépassé ou base indisponible : l'analyse continue sans mémoriser.
  }
}

function dbPrune(db) {
  const store = db.transaction('evals', 'readwrite').objectStore('evals');
  const count = store.count();
  count.onsuccess = () => {
    let extra = count.result - DB_MAX;
    if (extra <= 0) return;
    store.index('t').openCursor().onsuccess = (e) => {
      const cur = e.target.result;
      if (!cur || extra-- <= 0) return;
      cur.delete();
      cur.continue();
    };
  };
}

// Les explications n'utilisent que les 12 premiers coups d'une variante : on ne garde pas le reste.
const PV_KEEP = 12;
const trimLines = (lines) => lines.map((l) => ({ score: l.score, pv: l.pv.slice(0, PV_KEEP), depth: l.depth }));

// Évaluations précalculées des ouvertures les plus jouées (data/ouvertures.json, Stockfish 19 complet,
// profondeur 18) : le livre d'ouvertures du site et les positions qui reviennent dans les parties de
// Xazouille. Chargées une fois, elles évitent de recalculer les premiers coups de la plupart des
// parties, même à la toute première analyse.
let openingsPromise = null;
function loadOpenings() {
  if (!openingsPromise) {
    openingsPromise = fetch(new URL('../data/ouvertures.json', import.meta.url))
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        for (const [pos, lines] of Object.entries(data.positions)) {
          const key = `${pos}|${data.multipv}`;
          if (!cache.has(key)) cache.set(key, { fen: pos, lines, depth: data.depth });
        }
      })
      .catch(() => {});
  }
  return openingsPromise;
}

export async function evaluate(engine, fen, { depth, priority = false, tag = '', lane, multipv = 3 }) {
  await loadOpenings();
  const hit = cachedEval(fen, depth, multipv);
  if (hit) return hit;
  const key = fenKey(fen, multipv);
  const dbKey = engine.key ? `${engine.key}|${key}` : null;
  const stored = dbKey ? await dbGet(dbKey) : null;
  if (stored && stored.depth >= depth) {
    const out = { fen, lines: stored.lines, depth: stored.depth };
    cache.set(key, out);
    return out;
  }
  const res = await engine.analyze(fen, { depth, multipv, priority, tag, lane });
  if (!res) return null;
  const out = { fen, lines: res.lines, depth: res.depth };
  cache.set(key, out);
  if (dbKey && res.lines.length) dbPut(dbKey, { lines: trimLines(res.lines), depth: res.depth });
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

// Précision d'un coup : même forme que Lichess, mais bien plus sévère (ACC_B au lieu de 0,0435),
// sur la courbe de chances de gain plus plate `accWinPct`. Les pertes de moins de ACC_TOL points
// sont ignorées : ce sont surtout des écarts de calcul entre notre moteur et celui de Chess.com.
const ACC_B = 0.15;
const ACC_TOL = 0.5;

function moveAccuracy(before, after) {
  const accBefore = accWinPct(scoreOf(before));
  const accAfter = after.terminal === 'mate' ? 100 : after.terminal === 'draw' ? 50 : 100 - accWinPct(scoreOf(after));
  const loss = accBefore - accAfter - ACC_TOL;
  if (loss <= 0) return 100;
  const raw = 103.1668100711649 * Math.exp(-ACC_B * loss) - 3.166924740191411 + 1;
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
  // Le coup précédent sert à reconnaître une reprise ; la réponse compte la prise du coup joué.
  const prevMove = prev ? prev.move : null;
  const facts = moveFacts(move, ply, prevMove);

  const best = top && top.pv.length ? analyzeLine(move.before, top.pv, { prev: prevMove }) : null;
  const played = analyzeLine(move.before, [move.lan, ...((after.lines[0] && after.lines[0].pv) || [])], { prev: prevMove });
  const reply = after.lines[0] && after.lines[0].pv.length ? analyzeLine(move.after, after.lines[0].pv, { prev: move, seed: true }) : null;
  const alts = lines.map((l) => ({ score: l.score, line: analyzeLine(move.before, l.pv, { max: 8, prev: prevMove }), uci: l.pv[0] }));

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

  // Ce que le coup rapporte par rapport à la meilleure autre option du moteur.
  const others = lines.filter((l) => l.pv[0] !== move.lan).sort((a, b) => rank(b.score) - rank(a.score));
  const altBest = others[0] || null;
  const gap = altBest ? winAfter - winPct(altBest.score) : null;

  // Brillant : un vrai sacrifice (au moins 2 points, hors pion, vérifié en coups légaux), réellement
  // concédé dans la suite du moteur (ou qui force le mat), et qui donne un avantage décisif
  // nettement supérieur à toutes les autres options. Pour un sacrifice qui force le mat, la courbe
  // des chances sature : on exige seulement que la meilleure autre option ne soit pas déjà écrasante.
  const sac = facts.sacrifice;
  const given = forcedMate || Math.min(...played.running.slice(1, 6)) <= -2;
  const decisive = forcedMate ? !altBest || winPct(altBest.score) <= 90 : gap == null || gap >= 15;
  if (cls === 'best' && sac && sac.t !== 'p' && !facts.mate && given && winAfter >= 80 && decisive) {
    cls = 'brilliant';
  } else if (cls === 'best' && isBest && gap != null && !facts.mate) {
    // Très bon coup : le seul coup qui tient, à condition qu'il ne soit pas évident
    // (reprise, gain direct de matériel, simple fuite d'une pièce attaquée).
    const recapture = !!(prev && prev.move.captured && move.to === prev.move.to);
    const grab = !!(facts.capture && facts.capture.net >= 2);
    const escape = facts.saved.some((s) => s.moved) && !facts.check && !facts.fork && !facts.threats.length && !facts.mateThreat;
    if (gap >= 15 && winPct(altBest.score) <= 85 && !recapture && !grab && !escape) cls = 'great';
  }

  const diff = missedTactic ? difficulty(best) : null;
  return {
    ply, move, me, them: opp(me),
    san: move.san, sanFr: fr.sanFr(move.san), num: fr.moveNumber(move.before, me),
    cls, loss, winBefore, winAfter, accuracy: moveAccuracy(before, after),
    isBest, legal, levelKey, elo, thresholds: T,
    before, after, best, played, reply, alts, facts,
    missedTactic, bestMates,
    difficulty: diff,
    difficultyVerdict: diff ? difficultyVerdict(diff, elo || LEVELS[levelKey].elo, `${move.before}|${move.lan}`) : null,
    altBest, altGap: gap,
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

  get mode() {
    return MODES[this.settings.depth] || MODES.standard;
  }

  get depth() {
    return this.mode.depth;
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

  // Évalue toutes les positions à `depth` et range les résultats dans `target`. Toutes les positions
  // sont confiées d'un coup au moteur : avec un groupe de moteurs (EnginePool), elles sont analysées
  // en parallèle, la partie étant découpée en couloirs de positions voisines. `live` : les rapports
  // sont construits au fur et à mesure (sinon, à la fin). Renvoie false si l'analyse a été annulée.
  async scan(depth, target, live, onUpdate, phase) {
    const n = this.game.fens.length;
    const lanes = this.engine.size || 1;
    let done = 0;
    let stop = false;
    await Promise.all(this.game.fens.map((fen, i) => evaluate(this.engine, fen, {
      depth, tag: this.tag, lane: Math.floor((i * lanes) / n),
    }).then((res) => {
      if (this.cancelled || !res) { stop = true; return; }
      target[i] = res;
      if (live) {
        if (i >= 1 && target[i - 1]) this.buildReport(i - 1);
        if (i + 1 < n && target[i + 1]) this.buildReport(i);
      }
      onUpdate(++done, n, phase);
    })));
    return !stop && !this.cancelled;
  }

  // onUpdate(fait, total, phase) — phase : 'preview' (premier rendu rapide), 'scan' (passage
  // principal), 'check' (vérification des moments clés) ou 'done'.
  async run(onUpdate) {
    const mode = this.mode;
    const n = this.game.fens.length;
    if (mode.preview) {
      // Premier rendu rapide, affiché pendant l'approfondissement. Les résultats profonds sont gardés
      // à part et remplacent l'aperçu d'un coup, à la fin : pas de mélange de profondeurs à l'écran.
      if (!await this.scan(mode.preview, this.positions, true, onUpdate, 'preview')) return;
      this.refine();
      this.rebuild();
      const deep = new Array(n).fill(null);
      onUpdate(0, n, 'scan');
      if (!await this.scan(mode.depth, deep, false, onUpdate, 'scan')) return;
      this.positions = deep;
    } else if (!await this.scan(mode.depth, this.positions, true, onUpdate, 'scan')) {
      return;
    }
    this.refine();
    this.rebuild();

    if (mode.check) {
      // Les coups qui changent le cours de la partie sont revérifiés plus profondément.
      const lanes = this.engine.size || 1;
      const critical = new Set();
      this.reports.forEach((r, i) => {
        if (['mistake', 'blunder', 'miss', 'brilliant', 'great'].includes(r.cls)) { critical.add(i); critical.add(i + 1); }
      });
      const todo = [...critical].filter((i) => !this.positions[i].terminal).slice(0, 24);
      let checked = 0;
      let stop = false;
      onUpdate(0, todo.length, 'check');
      await Promise.all(todo.map((i, k) => evaluate(this.engine, this.game.fens[i], {
        depth: mode.depth + mode.check, tag: this.tag, lane: Math.floor((k * lanes) / todo.length),
      }).then((res) => {
        if (this.cancelled || !res) { stop = true; return; }
        this.positions[i] = res;
        onUpdate(++checked, todo.length, 'check');
      })));
      if (stop || this.cancelled) return;
      this.refine();
    }
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

// Précision de partie : moyenne de puissance ACC_POWER des précisions des coups, (Σ a^p / n)^(1/p).
// Une grosse faute y pèse plus que dans une moyenne simple, mais bien moins que dans la moyenne
// harmonique de Lichess. Calée sur 155 parties Chess.com (14 octobre 2026) ; sur 92 parties de
// validation, 3,2 points d'écart moyen avec Chess.com (voir NOTES-DEV.md, « Précision »).
const ACC_POWER = 0.4;

function gameAccuracy(an, color) {
  let sum = 0;
  let count = 0;
  for (const r of an.reports) {
    if (r.me !== color) continue;
    sum += Math.max(r.accuracy, 0.01) ** ACC_POWER;
    count++;
  }
  return count ? (sum / count) ** (1 / ACC_POWER) : null;
}

// Précision (échelle Chess.com) → Elo. Points d'appui mesurés sur des parties Chess.com : environ 70 %
// vers 800 Elo, 83 % vers 2200, 85 % vers 2650. Très approximatif sur une seule partie.
const PERF = [[0, 100], [50, 300], [60, 500], [70, 800], [75, 1200], [80, 1700], [83, 2100], [86, 2450], [90, 2750], [95, 3000], [100, 3200]];

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
