// Interface : recherche Chess.com, liste des parties, revue d'une partie.
import { Chess } from '../vendor/chess.js';
import { EnginePool } from './engine.js';
import {
  parseGame, GameAnalysis, makeReport, evaluate, cachedEval, whiteWin, whiteEvalText,
  CLASSES, CLASS_ORDER, LEVELS, DEPTHS, levelForElo, thresholds,
} from './analysis.js';
import { nameFromEcoUrl } from './openings.js';
import { Board } from './board.js';
import { EvalGraph } from './graph.js';
import { commentaryHtml, summaryHtml, introHtml, pendingHtml, badgeHtml } from './commentary.js';
import { playSound, soundKind } from './sound.js';
import * as cc from './chesscom.js';
import * as fr from './fr.js';

const $ = (id) => document.getElementById(id);

const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem(`cpc.${k}`);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(`cpc.${k}`, JSON.stringify(v));
    } catch { /* stockage indisponible */ }
  },
};

const SAMPLE_PGN = `[Event "Opéra de Paris"]
[Site "Paris"]
[Date "1858.11.02"]
[White "Paul Morphy"]
[Black "Duc de Brunswick et comte Isouard"]
[Result "1-0"]

1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7
8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7
14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0`;

const CLASS_DESC = {
  brilliant: 'Un vrai sacrifice (pièce ou qualité) qui est le meilleur coup et donne un avantage décisif, bien supérieur à toute autre option.',
  great: 'Le seul coup qui garde l’avantage ou sauve la position, quand il n’est pas évident (hors reprises et gains directs).',
  best: 'Le coup choisi par le moteur.',
  excellent: 'Presque aussi bon que le meilleur coup.',
  good: 'Un coup correct qui cède un peu de terrain.',
  book: 'Un coup connu de la théorie des ouvertures.',
  inaccuracy: 'Une petite perte : il existait un coup nettement meilleur.',
  mistake: 'Une perte importante d’avantage.',
  miss: 'L’adversaire s’était trompé, mais la tactique gagnante n’a pas été jouée.',
  blunder: 'Un coup qui perd du matériel, la partie ou un gros avantage.',
};

const state = {
  engine: new EnginePool(),
  settings: {
    depth: store.get('depth', 'standard'),
    level: store.get('level', 'auto'),
    arrows: store.get('arrows', true),
    sound: store.get('sound', true),
  },
  player: null,
  filter: 'all',
  game: null,
  analysis: null,
  ply: 0,
  flipped: false,
  variation: null,
  selected: null,
  tab: 'coup',
  focus: 'w',
  navigated: false,
  lines: new Map(),
  varReports: new Map(),
  pending: new Set(),
  cmtKey: '',
};

let board;
let graph;
let shownFen = null; // position affichée au dernier rendu : un changement déclenche le son du coup

// ---------- Démarrage ----------

function init() {
  board = new Board($('board'), { onSquare: onSquareClick, onDragStart, onDrop });
  graph = new EvalGraph($('graph'), { onPick: (i) => goto(i) });

  $('depthSel').value = state.settings.depth;
  $('levelSel').value = state.settings.level;
  $('arrowsChk').checked = state.settings.arrows;
  $('soundChk').checked = state.settings.sound;
  $('username').value = store.get('username', '');
  $('reviewLevel').innerHTML = $('levelSel').innerHTML.replace('Automatique (Elo de la partie)', 'Auto (Elo)');

  $('searchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    searchPlayer($('username').value);
  });
  $('moreBtn').addEventListener('click', () => loadMoreGames());
  $('sampleBtn').addEventListener('click', () => startReview(parseGame(SAMPLE_PGN)));
  $('pgnBtn').addEventListener('click', () => {
    const msg = $('pgnMsg');
    msg.textContent = '';
    try {
      startReview(parseGame($('pgnInput').value.trim()));
    } catch (err) {
      msg.textContent = err.message;
      msg.className = 'form-msg is-error';
    }
  });
  $('depthSel').addEventListener('change', (e) => {
    state.settings.depth = e.target.value;
    store.set('depth', e.target.value);
  });
  $('levelSel').addEventListener('change', (e) => setLevel(e.target.value));
  $('reviewLevel').addEventListener('change', (e) => setLevel(e.target.value));
  $('arrowsChk').addEventListener('change', (e) => {
    state.settings.arrows = e.target.checked;
    store.set('arrows', e.target.checked);
    renderBoard();
  });
  $('soundChk').addEventListener('change', (e) => {
    state.settings.sound = e.target.checked;
    store.set('sound', e.target.checked);
  });
  $('backBtn').addEventListener('click', () => showHome());
  $('brand').addEventListener('click', (e) => {
    e.preventDefault();
    showHome();
  });
  $('themeBtn').addEventListener('click', toggleTheme);

  document.querySelector('.controls').addEventListener('click', (e) => {
    const b = e.target.closest('[data-nav]');
    if (!b) return;
    const a = b.dataset.nav;
    if (a === 'first') goto(0);
    else if (a === 'prev') step(-1);
    else if (a === 'next') step(1);
    else if (a === 'last') goto(state.game.moves.length);
    else if (a === 'flip') {
      state.flipped = !state.flipped;
      renderAll();
    }
  });
  document.querySelector('.tabs').addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) setTab(t.dataset.tab);
  });
  $('commentary').addEventListener('click', onPanelClick);
  $('summary').addEventListener('click', onPanelClick);
  $('varBanner').addEventListener('click', onPanelClick);
  $('movelist').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ply]');
    if (b) goto(+b.dataset.ply);
  });
  $('games').addEventListener('click', (e) => {
    const b = e.target.closest('[data-game]');
    if (b && !b.disabled) openChesscomGame(+b.dataset.game);
  });
  $('filters').addEventListener('click', (e) => {
    const b = e.target.closest('[data-filter]');
    if (!b) return;
    state.filter = b.dataset.filter;
    renderGames();
  });
  document.addEventListener('keydown', onKey);

  renderLegend();
  state.engine.init().then(
    (eng) => setEngineStatus(eng.label),
    (err) => setEngineStatus(`Moteur indisponible : ${err.message}`, true),
  );
}

function setEngineStatus(text, error = false) {
  const el = $('engineStatus');
  el.textContent = text;
  el.classList.toggle('is-error', error);
}

function toggleTheme() {
  const root = document.documentElement;
  const dark = root.dataset.theme
    ? root.dataset.theme === 'dark'
    : window.matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  store.set('theme', root.dataset.theme);
}

function setLevel(value) {
  state.settings.level = value;
  store.set('level', value);
  $('levelSel').value = value;
  $('reviewLevel').value = value;
  if (state.analysis) {
    state.analysis.settings.level = value;
    state.analysis.rebuild();
    state.varReports.clear();
    state.cmtKey = '';
    renderAll();
    renderSummary();
  }
}

function renderLegend() {
  const items = CLASS_ORDER.map((k) => `<li>${badgeHtml(k)}<div><b>${CLASSES[k].label}</b><span>${CLASS_DESC[k]}</span></div></li>`);
  const rows = Object.entries(LEVELS).map(([key, lv]) => {
    const t = thresholds(key);
    const p = fr.pct;
    return `<tr><th scope="row">${lv.label}</th><td>≤ ${p(t.excellent)}</td><td>≤ ${p(t.good)}</td><td>≤ ${p(t.inaccuracy)}</td><td>≤ ${p(t.mistake)}</td><td>&gt; ${p(t.mistake)}</td></tr>`;
  });
  $('legendGrid').outerHTML = `<ul class="legend-grid" id="legendGrid">${items.join('')}</ul>
    <div class="table-wrap"><table class="thr-table">
      <caption>Perte de chances de gain tolérée selon le niveau</caption>
      <thead><tr><th></th><th>Excellent</th><th>Bon</th><th>Imprécision</th><th>Erreur</th><th>Gaffe</th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table></div>`;
}

// ---------- Chess.com ----------

async function searchPlayer(raw) {
  const username = raw.trim();
  const msg = $('searchMsg');
  msg.className = 'form-msg';
  if (!cc.validUsername(username)) {
    msg.textContent = 'Un pseudo Chess.com contient de 2 à 40 lettres, chiffres, tirets ou soulignés.';
    msg.classList.add('is-error');
    return;
  }
  msg.textContent = 'Recherche du joueur…';
  $('searchBtn').disabled = true;
  try {
    const data = await cc.fetchPlayer(username);
    store.set('username', data.username);
    state.player = { ...data, games: [], next: data.archives.length - 1 };
    state.filter = 'all';
    renderPlayerCard();
    $('playerArea').hidden = false;
    msg.textContent = '';
    await loadMoreGames(20);
    if (!state.player.games.length) msg.textContent = 'Aucune partie publique trouvée pour ce joueur.';
  } catch (err) {
    msg.textContent = err instanceof cc.NotFoundError
      ? `Aucun joueur « ${username} » sur Chess.com. Vérifie l’orthographe du pseudo.`
      : err.message;
    msg.classList.add('is-error');
  } finally {
    $('searchBtn').disabled = false;
  }
}

async function loadMoreGames(min = 1) {
  const p = state.player;
  if (!p) return;
  const btn = $('moreBtn');
  btn.disabled = true;
  btn.textContent = 'Chargement…';
  let added = 0;
  try {
    while (p.next >= 0 && added < min) {
      const games = await cc.fetchArchive(p.archives[p.next]);
      p.next--;
      games.sort((a, b) => b.end_time - a.end_time);
      p.games.push(...games);
      added += games.length;
    }
  } catch (err) {
    $('searchMsg').textContent = err.message;
    $('searchMsg').className = 'form-msg is-error';
  }
  btn.disabled = p.next < 0;
  btn.textContent = p.next < 0 ? 'Toutes les parties sont chargées' : 'Charger le mois précédent';
  renderGames();
}

function renderPlayerCard() {
  const p = state.player;
  const prof = p.profile;
  const st = p.stats || {};
  const rating = (k) => (st[k] && st[k].last ? st[k].last.rating : null);
  const ratings = [['chess_rapid', 'Rapide'], ['chess_blitz', 'Blitz'], ['chess_bullet', 'Bullet'], ['chess_daily', 'Par jour']]
    .filter(([k]) => rating(k))
    .map(([k, label]) => `<li><span>${label}</span><b>${rating(k)}</b></li>`);
  const main = rating('chess_rapid') || rating('chess_blitz') || rating('chess_bullet') || rating('chess_daily');
  const lv = LEVELS[levelForElo(main)];
  const avatarSrc = cc.avatarUrl(prof.avatar);
  const initial = `<span class="avatar avatar-fallback">${p.username.slice(0, 1).toUpperCase()}</span>`;
  const avatar = avatarSrc ? `<img class="avatar" src="${avatarSrc}" alt="" width="56" height="56">` : initial;
  $('playerCard').innerHTML = `${avatar}
    <div class="pc-main">
      <p class="pc-name">${prof.title ? `<span class="title">${prof.title}</span>` : ''}${prof.username || p.username}</p>
      <p class="pc-sub">${prof.name ? `${escapeHtml(prof.name)} · ` : ''}niveau détecté : <b>${lv.label}</b> (${lv.hint})</p>
    </div>
    <ul class="ratings">${ratings.join('')}</ul>`;
  const img = $('playerCard').querySelector('img.avatar');
  if (img) img.addEventListener('error', () => { img.outerHTML = initial; }, { once: true });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function renderGames() {
  const p = state.player;
  if (!p) return;
  const counts = {};
  for (const g of p.games) counts[g.time_class] = (counts[g.time_class] || 0) + 1;
  const chips = [['all', 'Toutes', p.games.length], ...Object.entries(cc.TIME_CLASSES).filter(([k]) => counts[k]).map(([k, l]) => [k, l, counts[k]])];
  $('filters').innerHTML = chips
    .map(([k, l, n]) => `<button type="button" class="chip ${state.filter === k ? 'is-on' : ''}" data-filter="${k}">${l} <span>${n}</span></button>`)
    .join('');
  const items = p.games
    .map((g, i) => ({ g, i }))
    .filter(({ g }) => state.filter === 'all' || g.time_class === state.filter)
    .map(({ g, i }) => {
      const o = cc.outcomeFor(g, p.username);
      const supported = g.rules === 'chess' && !!g.pgn;
      const date = new Date(g.end_time * 1000).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
      const moves = cc.countMoves(g.pgn || '');
      const opening = nameFromEcoUrl(g.eco);
      const label = { win: 'Victoire', loss: 'Défaite', draw: 'Nulle' }[o.res];
      const acc = g.accuracies ? g.accuracies[o.color === 'w' ? 'white' : 'black'] : null;
      const sub = [
        `${cc.TIME_CLASSES[g.time_class] || g.time_class} ${cc.formatTimeControl(g.time_control)}`,
        date,
        moves ? `${moves} coups` : null,
        opening || null,
      ].filter(Boolean).join(' · ');
      return `<li><button type="button" class="game" data-game="${i}" ${supported ? '' : 'disabled title="Variante non prise en charge"'}>
        <span class="g-res res-${o.res}" aria-label="${label}">${label[0]}</span>
        <span class="g-main">
          <span class="g-opp"><span class="dot dot-${o.color === 'w' ? 'b' : 'w'}" title="${o.color === 'w' ? 'L’adversaire avait les Noirs' : 'L’adversaire avait les Blancs'}"></span>${escapeHtml(o.them.username)} <span class="muted">(${o.them.rating})</span></span>
          <span class="g-sub">${escapeHtml(sub)}</span>
        </span>
        <span class="g-side">
          <span class="g-how">${label}${o.how ? ` ${o.how}` : ''}</span>
          <span class="g-rating">${o.me.rating}${acc ? ` · ${String(acc).replace('.', ',')} %` : ''}</span>
        </span>
        <span class="g-go">${supported ? 'Analyser' : 'Variante'}</span>
      </button></li>`;
    });
  $('games').innerHTML = items.join('') || '<li class="games-empty">Aucune partie dans cette catégorie pour l’instant.</li>';
}

function openChesscomGame(i) {
  const g = state.player.games[i];
  const o = cc.outcomeFor(g, state.player.username);
  try {
    startReview(parseGame(g.pgn, { url: g.url, userColor: o.color, accuracies: g.accuracies, timeClass: g.time_class }));
  } catch (err) {
    $('searchMsg').textContent = err.message;
    $('searchMsg').className = 'form-msg is-error';
  }
}

// ---------- Revue ----------

function showHome() {
  if (state.analysis) state.analysis.cancel();
  state.analysis = null;
  state.game = null;
  $('review').hidden = true;
  $('home').hidden = false;
  document.title = 'Coup par Coup';
}

function startReview(game) {
  if (state.analysis) state.analysis.cancel();
  state.game = game;
  state.ply = 0;
  state.variation = null;
  state.selected = null;
  state.navigated = false;
  state.lines.clear();
  state.varReports.clear();
  state.pending.clear();
  state.cmtKey = '';
  shownFen = null;
  state.flipped = game.userColor === 'b';
  state.focus = game.userColor || 'w';
  $('home').hidden = true;
  $('review').hidden = false;
  $('reviewLevel').value = state.settings.level;
  document.title = `${game.white.name} – ${game.black.name} · Coup par Coup`;
  $('gameTitle').innerHTML = `<b>${escapeHtml(game.white.name)}</b> <span class="muted">contre</span> <b>${escapeHtml(game.black.name)}</b>${game.opening ? `<span class="gt-open">${escapeHtml(game.opening)}</span>` : ''}`;
  setTab('coup');
  window.scrollTo(0, 0);

  const an = new GameAnalysis(game, state.engine, { ...state.settings });
  state.analysis = an;
  renderAll();
  setProgress(0, game.fens.length, an.mode.preview ? 'preview' : 'scan');
  const started = performance.now();
  state.engine.init()
    .then(() => an.run((done, total, phase) => {
      if (state.analysis !== an) return;
      setProgress(done, total, phase);
      renderAll();
      if (an.done) {
        renderSummary();
        if (!state.navigated) setTab('bilan');
        // Pas de notification pour une partie déjà analysée, rouverte instantanément.
        if (performance.now() - started > 4000) notify('Analyse complète terminée');
      }
    }))
    .catch((err) => {
      $('progressText').textContent = `Analyse impossible : ${err.message}`;
    });
}

// Une seule barre pour toute l'analyse. Le premier rendu rapide (`mode.preview`) n'est pas annoncé :
// il occupe le début de la barre, en proportion de son coût (chaque profondeur de plus coûte
// environ 1,5 fois plus).
function setProgress(done, total, phase = 'scan') {
  const an = state.analysis;
  const mode = an ? an.mode : null;
  let frac = total ? done / total : 0;
  if (mode && mode.preview) {
    const share = 1 / (1 + 1.5 ** (mode.depth - mode.preview));
    frac = phase === 'preview' ? frac * share : share + frac * (1 - share);
  }
  if (an && an.done) frac = 1;
  const pct = Math.round(frac * 100);
  $('progressFill').style.width = `${pct}%`;
  $('progress').classList.toggle('is-done', !!(an && an.done));
  $('progressText').textContent = an && an.done
    ? `Analyse terminée · profondeur ${an.depth}`
    : `Analyse ${pct} % · profondeur ${an ? an.depth : ''}`;
}

// Petite notification en bas de l'écran. Si l'onglet est en arrière-plan, une coche s'ajoute aussi
// au titre de l'onglet, jusqu'au retour sur la page.
function notify(text) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('is-on'));
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => {
    el.classList.remove('is-on');
    setTimeout(() => { el.hidden = true; }, 300);
  }, 5000);
  if (document.hidden && !document.title.startsWith('✓ ')) {
    document.title = `✓ ${document.title}`;
    const back = () => {
      if (document.hidden) return;
      document.title = document.title.replace(/^✓ /, '');
      document.removeEventListener('visibilitychange', back);
    };
    document.addEventListener('visibilitychange', back);
  }
}

function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('is-on', t.dataset.tab === tab);
    t.setAttribute('aria-selected', String(t.dataset.tab === tab));
  });
  $('tab-coup').hidden = tab !== 'coup';
  $('tab-bilan').hidden = tab !== 'bilan';
  if (tab === 'bilan') renderSummary();
}

function goto(ply) {
  if (!state.game) return;
  state.navigated = true;
  state.variation = null;
  state.selected = null;
  state.ply = Math.max(0, Math.min(state.game.moves.length, ply));
  if (state.tab !== 'coup') setTab('coup');
  renderAll();
}

function step(d) {
  const v = state.variation;
  if (v) {
    v.idx = Math.max(-1, Math.min(v.moves.length - 1, v.idx + d));
    state.selected = null;
    renderAll();
  } else {
    goto(state.ply + d);
  }
}

function onKey(e) {
  if (!state.game || $('review').hidden) return;
  if (e.target.closest('input, textarea, select')) return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
  else if (e.key === 'Home') { e.preventDefault(); goto(0); }
  else if (e.key === 'End') { e.preventDefault(); goto(state.game.moves.length); }
  else if (e.key === 'Escape' && state.variation) { e.preventDefault(); exitVariation(); }
}

function exitVariation() {
  state.variation = null;
  state.selected = null;
  renderAll();
}

function onPanelClick(e) {
  const tok = e.target.closest('.tok[data-line]');
  if (tok) {
    const l = state.lines.get(tok.dataset.line);
    if (!l) return;
    state.variation = { fen: l.fen, moves: l.moves, idx: +tok.dataset.i, source: 'line', lineId: tok.dataset.line };
    state.selected = null;
    renderAll();
    return;
  }
  const vi = e.target.closest('[data-vi]');
  if (vi && state.variation) {
    state.variation.idx = +vi.dataset.vi;
    renderAll();
    return;
  }
  if (e.target.closest('[data-exit]')) {
    exitVariation();
    return;
  }
  const ply = e.target.closest('[data-ply]');
  if (ply) {
    goto(+ply.dataset.ply);
    return;
  }
  const focus = e.target.closest('[data-focus]');
  if (focus) {
    state.focus = focus.dataset.focus;
    renderSummary();
  }
}

// Position affichée (partie ou variante).
function current() {
  const v = state.variation;
  if (v) {
    const m = v.idx >= 0 ? v.moves[v.idx] : null;
    return { fen: m ? m.after : v.fen, move: m, variation: true };
  }
  const m = state.ply > 0 ? state.game.moves[state.ply - 1] : null;
  const report = m && state.analysis ? state.analysis.reports[state.ply - 1] : null;
  return { fen: state.game.fens[state.ply], move: m, report, variation: false };
}

const varKey = (m) => `${m.before}|${m.lan}`;

function currentReport() {
  const cur = current();
  if (!cur.move) return null;
  if (!cur.variation) return cur.report;
  if (state.variation.source === 'free') return state.varReports.get(varKey(cur.move)) || null;
  return null;
}

// ---------- Exploration libre sur l'échiquier ----------

function onSquareClick(sq) {
  if (!state.game) return;
  const chess = new Chess(current().fen);
  if (state.selected && state.selected !== sq && chess.moves({ square: state.selected, verbose: true }).some((m) => m.to === sq)) {
    tryMove(state.selected, sq);
    return;
  }
  const p = chess.get(sq);
  state.selected = p && p.color === chess.turn() && state.selected !== sq ? sq : null;
  renderBoard();
}

// Début d'un glisser-déposer : seules les pièces du camp au trait peuvent bouger.
function onDragStart(sq) {
  if (!state.game) return false;
  const chess = new Chess(current().fen);
  const p = chess.get(sq);
  if (!p || p.color !== chess.turn()) return false;
  state.selected = sq;
  renderBoard();
  return true;
}

function onDrop(from, to) {
  if (to && to !== from && new Chess(current().fen).moves({ square: from, verbose: true }).some((m) => m.to === to)) {
    tryMove(from, to);
    return;
  }
  // Lâchée sur sa case : la pièce reste sélectionnée pour un coup au clic ; ailleurs, le coup est annulé.
  state.selected = to === from ? from : null;
  renderBoard();
}

// Joue un coup légal de l'utilisateur, en demandant la pièce de promotion si besoin.
async function tryMove(from, to) {
  const fen = current().fen;
  const mv = new Chess(fen).moves({ square: from, verbose: true }).find((m) => m.to === to);
  if (!mv) return;
  let promotion;
  if (mv.promotion) {
    promotion = await board.askPromotion(to, mv.color);
    if (!promotion || !state.game || current().fen !== fen) {
      state.selected = null;
      if (state.game) renderBoard();
      return;
    }
  }
  playUserMove(fen, { from, to, promotion });
}

function playUserMove(fen, input) {
  const chess = new Chess(fen);
  const m = chess.move(input);
  state.selected = null;
  const v = state.variation;
  if (!v && state.ply < state.game.moves.length && state.game.moves[state.ply].lan === m.lan) {
    goto(state.ply + 1);
    return;
  }
  if (v) {
    if (v.moves[v.idx + 1] && v.moves[v.idx + 1].lan === m.lan) {
      v.idx++;
    } else {
      v.moves = [...v.moves.slice(0, v.idx + 1), m];
      v.idx = v.moves.length - 1;
      v.source = 'free';
    }
  } else {
    state.variation = { fen, moves: [m], idx: 0, source: 'free' };
  }
  renderAll();
}

function plyOf(fen) {
  const [, turn, , , , full] = fen.split(' ');
  return (+full - 1) * 2 + (turn === 'b' ? 1 : 0);
}

async function requestVarReport(m) {
  const key = varKey(m);
  if (state.pending.has(key) || state.varReports.has(key)) return;
  state.pending.add(key);
  const an = state.analysis;
  // Un coup testé doit répondre vite : on plafonne à 18 (quelques secondes), même en Approfondie.
  const depth = Math.min(DEPTHS[state.settings.depth] || 18, 18);
  const [before, after] = await Promise.all([
    evaluate(state.engine, m.before, { depth, priority: true }),
    evaluate(state.engine, m.after, { depth, priority: true }),
  ]);
  state.pending.delete(key);
  if (!before || !after || state.analysis !== an) return;
  // Le coup qui mène à cette position (dans la variante, sinon dans la partie) : pour reconnaître une reprise.
  const v = state.variation;
  const i = v ? v.moves.indexOf(m) : -1;
  const prevMove = i > 0 ? v.moves[i - 1] : state.game.moves.find((x) => x.after === m.before) || null;
  state.varReports.set(key, makeReport({
    move: m,
    ply: plyOf(m.before),
    before,
    after,
    prev: prevMove ? { move: prevMove } : null,
    levelKey: an.levelFor(m.color),
    elo: an.eloFor(m.color),
  }));
  renderAll();
}

async function requestEval(fen) {
  if (state.pending.has(fen)) return;
  state.pending.add(fen);
  const res = await evaluate(state.engine, fen, { depth: Math.min(14, DEPTHS[state.settings.depth] || 15), priority: true });
  state.pending.delete(fen);
  if (res && state.game) {
    renderEvalBar();
    renderBanner();
  }
}

// ---------- Rendu ----------

function renderAll() {
  if (!state.game) return;
  renderBoard();
  renderEvalBar();
  renderPlayers();
  renderBanner();
  renderMoveList();
  renderCommentary();
  renderGraph();
}

function kingInCheck(fen) {
  const chess = new Chess(fen);
  if (!chess.inCheck()) return null;
  const turn = chess.turn();
  for (const row of chess.board()) {
    for (const p of row) if (p && p.type === 'k' && p.color === turn) return p.square;
  }
  return null;
}

function renderBoard() {
  const cur = current();
  const r = currentReport();
  const arrows = [];
  let badge = null;
  if (r) {
    badge = { sq: r.move.to, cls: r.cls };
    if (state.settings.arrows) {
      const bm = r.best && r.best.moves[0];
      if (bm && !r.isBest && !['best', 'book', 'forced', 'brilliant', 'great'].includes(r.cls)) arrows.push({ from: bm.from, to: bm.to, kind: 'best' });
      const rm = r.reply && r.reply.moves[0];
      if (rm && ['inaccuracy', 'mistake', 'blunder'].includes(r.cls)) arrows.push({ from: rm.from, to: rm.to, kind: 'threat' });
    }
  }
  let targets = [];
  if (state.selected) {
    targets = new Chess(cur.fen).moves({ square: state.selected, verbose: true }).map((m) => m.to);
  }
  if (cur.fen !== shownFen) {
    board.closePromotion(null);
    if (shownFen && cur.move && state.settings.sound) playSound(soundKind(cur.move));
    shownFen = cur.fen;
  }
  board.render({
    fen: cur.fen,
    flipped: state.flipped,
    lastMove: cur.move ? { from: cur.move.from, to: cur.move.to } : null,
    lastCls: r ? r.cls : cur.variation ? 'variation' : null,
    badge,
    arrows,
    selected: state.selected,
    targets,
    check: kingInCheck(cur.fen),
  });
}

function renderEvalBar() {
  const cur = current();
  let pos = null;
  if (cur.variation) {
    pos = cachedEval(cur.fen, 1);
    if (!pos) requestEval(cur.fen);
  } else if (state.analysis) {
    pos = state.analysis.positions[state.ply];
  }
  const w = pos ? whiteWin(pos) : 50;
  $('evalbar').classList.toggle('is-flipped', state.flipped);
  $('evalFill').style.height = `${w}%`;
  const txt = $('evalTxt');
  txt.textContent = pos ? whiteEvalText(pos) : '…';
  txt.classList.toggle('on-dark', w < 50);
}

function clockAt(color) {
  const g = state.game;
  if (!g.clocks) return null;
  for (let i = state.ply - 1; i >= 0; i--) if (g.moves[i].color === color) return g.clocks[i];
  return g.tc ? g.tc.base : null;
}

function fmtClock(s) {
  if (s == null) return '';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const ss = s < 20 ? sec.toFixed(1).padStart(4, '0') : String(Math.floor(sec)).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

function renderPlayers() {
  const g = state.game;
  const an = state.analysis;
  const strip = (c) => {
    const p = c === 'w' ? g.white : g.black;
    const acc = an && an.summary ? an.summary.players[c].accuracy : null;
    const clock = clockAt(c);
    const turn = current().fen.split(' ')[1] === c;
    return `<span class="ps-name"><span class="dot dot-${c}"></span>${escapeHtml(p.name)}${p.elo ? ` <span class="muted">${p.elo}</span>` : ''}${g.userColor === c ? ' <span class="pill">toi</span>' : ''}</span>
      ${acc != null ? `<span class="ps-acc">${acc.toFixed(1).replace('.', ',')} %</span>` : ''}
      ${clock != null ? `<span class="ps-clock ${turn ? 'is-turn' : ''}">${fmtClock(clock)}</span>` : ''}`;
  };
  $('pTop').innerHTML = strip(state.flipped ? 'w' : 'b');
  $('pBottom').innerHTML = strip(state.flipped ? 'b' : 'w');
}

function renderBanner() {
  const el = $('varBanner');
  const v = state.variation;
  if (!v) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const toks = v.moves.map((m, k) => {
    const n = +m.before.split(' ')[5];
    const num = m.color === 'w' ? `${n}.` : k === 0 ? `${n}…` : '';
    return `<button type="button" class="tok ${k === v.idx ? 'is-active' : ''}" data-vi="${k}">${num ? `<span class="tok-n">${num}</span>` : ''}${fr.sanFr(m.san)}</button>`;
  });
  const pos = cachedEval(current().fen, 1);
  el.innerHTML = `<span class="var-label">${v.source === 'free' ? 'Ton essai' : 'Variante'}${pos ? ` · ${whiteEvalText(pos)}` : ''}</span>
    <div class="line">${toks.join('')}</div>
    <button type="button" class="btn btn-sm" data-exit>Revenir à la partie</button>`;
}

function renderMoveList() {
  const g = state.game;
  const an = state.analysis;
  const rows = [];
  let row = null;
  g.moves.forEach((m, i) => {
    if (m.color === 'w' || !row) {
      row = { n: +m.before.split(' ')[5], cells: m.color === 'b' ? ['<span class="ml-empty">…</span>'] : [] };
      rows.push(row);
    }
    const r = an ? an.reports[i] : null;
    const active = !state.variation && state.ply === i + 1;
    row.cells.push(`<button type="button" class="ml-mv ${active ? 'is-active' : ''} ${r ? `c-${r.cls}` : ''}" data-ply="${i + 1}">${r ? badgeHtml(r.cls, 'badge-sm') : '<span class="badge-sm badge-wait"></span>'}<span>${fr.sanFr(m.san)}</span></button>`);
  });
  const list = $('movelist');
  list.innerHTML = rows.map((r) => `<div class="ml-row"><span class="ml-n">${r.n}.</span>${r.cells.join('')}</div>`).join('');
  const a = list.querySelector('.is-active');
  if (a) {
    const top = a.offsetTop;
    if (top < list.scrollTop + 8 || top > list.scrollTop + list.clientHeight - 40) list.scrollTop = top - list.clientHeight / 2;
  }
}

function renderCommentary() {
  const el = $('commentary');
  const v = state.variation;
  const an = state.analysis;
  const free = v && v.source === 'free';
  const fm = free && v.idx >= 0 ? v.moves[v.idx] : null;
  const freeRep = fm ? state.varReports.get(varKey(fm)) : null;
  const r = !free && state.ply > 0 && an ? an.reports[state.ply - 1] : null;
  const key = free
    ? `free:${fm ? varKey(fm) : '-'}:${!!freeRep}:${state.settings.level}`
    : `main:${state.ply}:${!!r}:${state.settings.level}:${!!(an && an.done)}`;
  if (key !== state.cmtKey) {
    let html;
    if (free && !fm) {
      html = pendingHtml('Fais glisser une pièce, ou clique sur la pièce puis sur une case, pour tester un coup.');
    } else if (free && freeRep) {
      state.lines = new Map();
      html = `<p class="var-note">Coup testé hors partie : il est analysé et expliqué comme ceux de la partie.</p>${commentaryHtml(freeRep, state.lines, { game: state.game, glossary: isLowLevel(fm.color) })}`;
    } else if (free) {
      requestVarReport(fm);
      html = pendingHtml(`Analyse de ${fr.sanFr(fm.san)}…`);
    } else if (state.ply === 0) {
      html = introHtml(state.game, an);
    } else if (r) {
      state.lines = new Map();
      html = commentaryHtml(r, state.lines, { game: state.game, glossary: isLowLevel(r.me) });
    } else {
      html = pendingHtml('Stockfish analyse encore ce coup…');
    }
    el.innerHTML = html;
    el.scrollTop = 0;
    state.cmtKey = key;
  }
  highlightToken(el);
}

function highlightToken(el) {
  el.querySelectorAll('.tok.is-active').forEach((t) => t.classList.remove('is-active'));
  const v = state.variation;
  if (v && v.source === 'line') {
    const t = el.querySelector(`.tok[data-line="${v.lineId}"][data-i="${v.idx}"]`);
    if (t) t.classList.add('is-active');
  }
}

function isLowLevel(color) {
  const an = state.analysis;
  if (!an) return false;
  const k = an.levelFor(color);
  return k === 'debutant' || k === 'intermediaire';
}

function renderGraph() {
  const an = state.analysis;
  const g = state.game;
  const wins = g.fens.map((_, i) => (an && an.positions[i] ? whiteWin(an.positions[i]) : null));
  const marks = an ? an.reports.map((r, i) => (r ? { ply: i + 1, cls: r.cls } : null)).filter(Boolean) : [];
  graph.update({ wins, total: g.moves.length, current: state.ply, marks });
}

function renderSummary() {
  const an = state.analysis;
  if (!an) return;
  $('summary').innerHTML = summaryHtml(an, state.focus, state.game.userColor);
}

init();
