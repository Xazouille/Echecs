// Accès à l'API publique de Chess.com (appelée directement par le navigateur).

const API = 'https://api.chess.com/pub';

export class NotFoundError extends Error {}

async function getJson(path) {
  let res;
  try {
    res = await fetch(`${API}/${path}`);
  } catch {
    throw new Error('Impossible de joindre Chess.com. Vérifie ta connexion internet, puis réessaie.');
  }
  if (res.status === 404 || res.status === 410) throw new NotFoundError('introuvable');
  if (res.status === 429) throw new Error('Chess.com limite le nombre de requêtes. Réessaie dans une minute.');
  if (!res.ok) {
    let msg = `erreur ${res.status}`;
    try {
      const body = await res.json();
      if (body && (body.message || body.error)) msg = body.message || body.error;
    } catch { /* corps vide */ }
    throw new Error(`Chess.com n’a pas répondu correctement (${msg}).`);
  }
  return res.json();
}

export const validUsername = (u) => /^[A-Za-z0-9_-]{2,40}$/.test(u);

export async function fetchPlayer(username) {
  const u = username.trim().toLowerCase();
  const [profile, stats, archives] = await Promise.all([
    getJson(`player/${u}`),
    getJson(`player/${u}/stats`).catch(() => null),
    getJson(`player/${u}/games/archives`),
  ]);
  return { username: profile.username || u, profile, stats, archives: archives.archives || [] };
}

export async function fetchArchive(url) {
  const path = url.replace(/^https:\/\/api\.chess\.com\/pub\//, '');
  const data = await getJson(path);
  return data.games || [];
}

export const avatarUrl = (url) => (/^https:\/\/images\.chesscomfiles\.com\//.test(url || '') ? url : '');

const DRAWS = ['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient'];
const HOW = {
  checkmated: 'par mat',
  resigned: 'par abandon',
  timeout: 'au temps',
  abandoned: 'par abandon de partie',
  agreed: 'par accord',
  repetition: 'par répétition',
  stalemate: 'par pat',
  insufficient: 'matériel insuffisant',
  '50move': 'règle des 50 coups',
  timevsinsufficient: 'temps contre matériel insuffisant',
  kingofthehill: 'roi au centre',
  threecheck: 'trois échecs',
  bughousepartnerlose: 'partenaire battu',
};

export function outcomeFor(game, username) {
  const isWhite = game.white.username.toLowerCase() === username.toLowerCase();
  const me = isWhite ? game.white : game.black;
  const them = isWhite ? game.black : game.white;
  const res = me.result === 'win' ? 'win' : DRAWS.includes(me.result) ? 'draw' : 'loss';
  const how = res === 'win' ? HOW[them.result] : HOW[me.result];
  return { color: isWhite ? 'w' : 'b', me, them, res, how: how || '' };
}

export const TIME_CLASSES = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapide', daily: 'Par jour' };

export function formatTimeControl(tc) {
  if (!tc) return '';
  if (tc.includes('/')) {
    const secs = +tc.split('/')[1];
    const days = Math.round(secs / 86400);
    return `${days} jour${days > 1 ? 's' : ''}`;
  }
  const [base, inc] = tc.split('+').map(Number);
  const min = base / 60;
  const m = Number.isInteger(min) ? String(min) : min.toFixed(1).replace('.', ',');
  return inc ? `${m}+${inc}` : `${m} min`;
}

export function countMoves(pgn) {
  const body = pgn.replace(/\{[^}]*\}/g, '').split(/\r?\n\r?\n/).pop() || '';
  const nums = [...body.matchAll(/(\d+)\.(?!\d)/g)].map((m) => +m[1]);
  return nums.length ? Math.max(...nums) : null;
}
