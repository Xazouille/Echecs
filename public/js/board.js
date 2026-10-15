// Échiquier : cases, pièces (animées), surbrillances, badge de classement, flèches,
// glisser-déposer et choix de la promotion.
import { classIcon } from './commentary.js';

const FILES = 'abcdefgh';
const SVG_NS = 'http://www.w3.org/2000/svg';
const ANIM_MS = 200;
const DRAG_PX = 5;
const PROMO = [['q', 'Dame'], ['n', 'Cavalier'], ['r', 'Tour'], ['b', 'Fou']];

function pieceMap(fen) {
  const map = {};
  fen.split(' ')[0].split('/').forEach((row, r) => {
    let f = 0;
    for (const ch of row) {
      if (ch >= '1' && ch <= '8') f += +ch;
      else {
        const color = ch === ch.toLowerCase() ? 'b' : 'w';
        map[FILES[f] + (8 - r)] = color + ch.toLowerCase();
        f++;
      }
    }
  });
  return map;
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export class Board {
  // onSquare(sq) : clic sur une case. onDragStart(sq) : cases d'arrivée possibles, ou null si la pièce
  // ne peut pas être déplacée. onDrop(from, to) : pièce lâchée (to vaut null hors de l'échiquier).
  constructor(root, { onSquare, onDragStart = () => null, onDrop = () => {} }) {
    this.root = root;
    this.onSquare = onSquare;
    this.onDragStart = onDragStart;
    this.onDrop = onDrop;
    this.flipped = null;
    this.cells = {};
    this.pieces = {};
    this.press = null;
    this.skipAnim = false;
    this.promo = null;
    root.classList.add('board');
    this.grid = document.createElement('div');
    this.grid.className = 'board-grid';
    for (let r = 8; r >= 1; r--) {
      for (let f = 0; f < 8; f++) {
        const sq = FILES[f] + r;
        const el = document.createElement('div');
        el.className = `sq ${(f + r) % 2 === 1 ? 'sq-d' : 'sq-l'}`;
        el.dataset.sq = sq;
        this.grid.appendChild(el);
        this.cells[sq] = el;
      }
    }
    root.appendChild(this.grid);
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('viewBox', '0 0 800 800');
    this.svg.setAttribute('class', 'board-arrows');
    this.svg.setAttribute('aria-hidden', 'true');
    root.appendChild(this.svg);
    root.addEventListener('pointerdown', (e) => this.down(e));
    root.addEventListener('pointermove', (e) => this.move(e));
    root.addEventListener('pointerup', (e) => this.up(e));
    root.addEventListener('pointercancel', () => this.endDrag());
  }

  orient(flipped) {
    if (this.flipped === flipped) return false;
    this.flipped = flipped;
    for (const [sq, el] of Object.entries(this.cells)) {
      const f = FILES.indexOf(sq[0]);
      const r = +sq[1];
      el.style.gridColumn = String(flipped ? 8 - f : f + 1);
      el.style.gridRow = String(flipped ? r : 9 - r);
      el.querySelectorAll('.coord').forEach((c) => c.remove());
      const bottomRank = flipped ? 8 : 1;
      const leftFile = flipped ? 'h' : 'a';
      if (r === bottomRank) el.insertAdjacentHTML('beforeend', `<span class="coord coord-f">${sq[0]}</span>`);
      if (sq[0] === leftFile) el.insertAdjacentHTML('beforeend', `<span class="coord coord-r">${r}</span>`);
    }
    return true;
  }

  // Colonne et rangée d'une case à l'écran (0 à 7, depuis le coin haut gauche).
  screen(sq) {
    const f = FILES.indexOf(sq[0]);
    const r = +sq[1];
    return [this.flipped ? 7 - f : f, this.flipped ? r - 1 : 8 - r];
  }

  center(sq) {
    const [x, y] = this.screen(sq);
    return [x * 100 + 50, y * 100 + 50];
  }

  squareAt(clientX, clientY) {
    const rect = this.grid.getBoundingClientRect();
    const x = Math.floor(((clientX - rect.left) / rect.width) * 8);
    const y = Math.floor(((clientY - rect.top) / rect.height) * 8);
    if (x < 0 || x > 7 || y < 0 || y > 7) return null;
    return FILES[this.flipped ? 7 - x : x] + (this.flipped ? y + 1 : 8 - y);
  }

  render({ fen, flipped = false, lastMove = null, lastCls = null, badge = null, arrows = [], selected = null, targets = [], check = null }) {
    const turned = this.orient(flipped);
    const map = pieceMap(fen);
    const prev = this.pieces;
    const animate = !turned && !this.skipAnim && !reducedMotion();
    this.skipAnim = false;
    const appeared = [];
    const vanished = [];
    for (const [sq, el] of Object.entries(this.cells)) {
      const code = map[sq] || '';
      if (prev[sq] !== code) {
        el.querySelector('.pc:not(.is-fading)')?.remove();
        if (prev[sq]) vanished.push(sq);
        if (code) {
          el.insertAdjacentHTML('afterbegin', `<div class="pc pc-${code}"></div>`);
          appeared.push(sq);
        }
      }
      el.querySelector('.sq-badge')?.remove();
      el.classList.remove('is-last', 'is-sel', 'is-target', 'is-capture', 'is-check');
      el.removeAttribute('data-cls');
    }
    this.pieces = { ...map };
    if (animate) this.animate(prev, map, appeared, vanished);
    if (lastMove) {
      for (const sq of [lastMove.from, lastMove.to]) {
        this.cells[sq].classList.add('is-last');
        if (lastCls) this.cells[sq].dataset.cls = lastCls;
      }
    }
    if (check) this.cells[check].classList.add('is-check');
    if (selected) this.cells[selected].classList.add('is-sel');
    for (const t of targets) this.cells[t].classList.add(map[t] ? 'is-capture' : 'is-target');
    if (badge) {
      this.cells[badge.sq].insertAdjacentHTML('beforeend', `<span class="sq-badge badge c-${badge.cls}">${classIcon(badge.cls)}</span>`);
    }
    this.drawArrows(arrows);
  }

  // Chaque pièce apparue glisse depuis la case la plus proche où une pièce identique a disparu ;
  // une pièce prise s'efface en fondu.
  animate(prev, map, appeared, vanished) {
    const free = new Set(vanished);
    const dist = (a, b) => {
      const [ax, ay] = this.screen(a);
      const [bx, by] = this.screen(b);
      return Math.hypot(ax - bx, ay - by);
    };
    for (const sq of appeared) {
      let from = null;
      for (const v of free) if (prev[v] === map[sq] && (!from || dist(v, sq) < dist(from, sq))) from = v;
      if (!from) continue;
      free.delete(from);
      const [fx, fy] = this.screen(from);
      const [tx, ty] = this.screen(sq);
      const el = this.cells[sq].querySelector('.pc:not(.is-fading)');
      el.classList.add('is-moving');
      el.style.transform = `translate(${(fx - tx) * 100}%, ${(fy - ty) * 100}%)`;
      el.getBoundingClientRect();
      el.style.transition = `transform ${ANIM_MS}ms cubic-bezier(0.25, 0.8, 0.35, 1)`;
      el.style.transform = '';
      // Minuterie plutôt que « transitionend », qui n'arrive pas si la page n'est pas affichée.
      setTimeout(() => {
        el.classList.remove('is-moving');
        el.style.transition = '';
      }, ANIM_MS + 30);
      if (prev[sq]) {
        const ghost = document.createElement('div');
        ghost.className = `pc pc-${prev[sq]} is-fading`;
        this.cells[sq].appendChild(ghost);
        setTimeout(() => ghost.remove(), ANIM_MS);
      }
    }
  }

  drawArrows(arrows) {
    const parts = [];
    for (const a of arrows) {
      const [x1, y1] = this.center(a.from);
      const [x2, y2] = this.center(a.to);
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy);
      if (!len) continue;
      const ux = dx / len;
      const uy = dy / len;
      const px = -uy;
      const py = ux;
      const shaft = 11;
      const headW = 30;
      const headL = 38;
      const sx = x1 + ux * 18;
      const sy = y1 + uy * 18;
      const ex = x2 - ux * 8;
      const ey = y2 - uy * 8;
      const bx = ex - ux * headL;
      const by = ey - uy * headL;
      const pts = [
        [sx + px * shaft, sy + py * shaft],
        [bx + px * shaft, by + py * shaft],
        [bx + px * headW, by + py * headW],
        [ex, ey],
        [bx - px * headW, by - py * headW],
        [bx - px * shaft, by - py * shaft],
        [sx - px * shaft, sy - py * shaft],
      ];
      parts.push(`<polygon class="arrow arrow-${a.kind}" points="${pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ')}"/>`);
    }
    this.svg.innerHTML = parts.join('');
  }

  // ---------- Clic et glisser-déposer ----------

  down(e) {
    if (this.promo || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const sq = this.squareAt(e.clientX, e.clientY);
    if (!sq) return;
    e.preventDefault();
    this.press = { sq, x: e.clientX, y: e.clientY, id: e.pointerId, dragging: false, refused: false };
    this.root.setPointerCapture(e.pointerId);
  }

  move(e) {
    const p = this.press;
    if (!p || e.pointerId !== p.id || p.refused) return;
    if (!p.dragging) {
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_PX) return;
      const code = this.pieces[p.sq];
      if (!code || !this.onDragStart(p.sq)) {
        p.refused = true;
        return;
      }
      p.dragging = true;
      p.ghost = document.createElement('div');
      p.ghost.className = `pc pc-${code} pc-drag`;
      this.root.appendChild(p.ghost);
      this.cells[p.sq].querySelector('.pc:not(.is-fading)')?.classList.add('is-origin');
    }
    const rect = this.root.getBoundingClientRect();
    const size = this.grid.getBoundingClientRect().width / 8;
    p.ghost.style.width = `${size}px`;
    p.ghost.style.height = `${size}px`;
    p.ghost.style.left = `${e.clientX - rect.left - size / 2}px`;
    p.ghost.style.top = `${e.clientY - rect.top - size / 2}px`;
    const over = this.squareAt(e.clientX, e.clientY);
    if (over !== p.over) {
      if (p.over) this.cells[p.over].classList.remove('is-hover');
      if (over) this.cells[over].classList.add('is-hover');
      p.over = over;
    }
  }

  up(e) {
    const p = this.press;
    if (!p || e.pointerId !== p.id) return;
    const to = this.squareAt(e.clientX, e.clientY);
    this.endDrag();
    if (p.dragging) {
      this.skipAnim = true;
      this.onDrop(p.sq, to);
    } else if (to === p.sq) {
      this.onSquare(p.sq);
    }
  }

  endDrag() {
    const p = this.press;
    if (!p) return;
    this.press = null;
    if (this.root.hasPointerCapture(p.id)) this.root.releasePointerCapture(p.id);
    if (p.ghost) p.ghost.remove();
    if (p.over) this.cells[p.over].classList.remove('is-hover');
    this.cells[p.sq].querySelector('.pc:not(.is-fading)')?.classList.remove('is-origin');
  }

  // ---------- Promotion ----------

  // Affiche les quatre pièces possibles en colonne sur la case d'arrivée ; résout avec 'q', 'n', 'r',
  // 'b', ou null si le joueur clique ailleurs ou appuie sur Échap.
  askPromotion(sq, color) {
    this.closePromotion(null);
    this.skipAnim = false;
    return new Promise((resolve) => {
      const [x, y] = this.screen(sq);
      const dir = y === 0 ? 1 : -1;
      const overlay = document.createElement('div');
      overlay.className = 'promo';
      overlay.innerHTML = PROMO.map(([t, label], k) => `<button type="button" class="promo-btn" data-piece="${t}" aria-label="Promotion en ${label}"
        style="left:${x * 12.5}%;top:${(y + dir * k) * 12.5}%"><span class="pc pc-${color}${t}"></span></button>`).join('');
      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          this.closePromotion(null);
        }
      };
      overlay.addEventListener('click', (e) => {
        const b = e.target.closest('[data-piece]');
        this.closePromotion(b ? b.dataset.piece : null);
      });
      document.addEventListener('keydown', onKey, true);
      this.promo = { overlay, resolve, onKey };
      this.root.appendChild(overlay);
      overlay.querySelector('.promo-btn').focus();
    });
  }

  closePromotion(piece) {
    const p = this.promo;
    if (!p) return;
    this.promo = null;
    document.removeEventListener('keydown', p.onKey, true);
    p.overlay.remove();
    p.resolve(piece);
  }
}
