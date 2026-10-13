// Échiquier : cases, pièces, surbrillances, badge de classement et flèches.
import { classIcon } from './commentary.js';

const FILES = 'abcdefgh';
const SVG_NS = 'http://www.w3.org/2000/svg';

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

export class Board {
  constructor(root, { onSquare }) {
    this.root = root;
    this.onSquare = onSquare;
    this.flipped = null;
    this.cells = {};
    this.pieces = {};
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
    this.grid.addEventListener('click', (e) => {
      const cell = e.target.closest('.sq');
      if (cell) this.onSquare(cell.dataset.sq);
    });
  }

  orient(flipped) {
    if (this.flipped === flipped) return;
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
  }

  center(sq) {
    const f = FILES.indexOf(sq[0]);
    const r = +sq[1];
    const x = this.flipped ? 7 - f : f;
    const y = this.flipped ? r - 1 : 8 - r;
    return [x * 100 + 50, y * 100 + 50];
  }

  render({ fen, flipped = false, lastMove = null, lastCls = null, badge = null, arrows = [], selected = null, targets = [], check = null }) {
    this.orient(flipped);
    const map = pieceMap(fen);
    for (const [sq, el] of Object.entries(this.cells)) {
      const code = map[sq] || '';
      if (this.pieces[sq] !== code) {
        el.querySelector('.pc')?.remove();
        if (code) el.insertAdjacentHTML('afterbegin', `<div class="pc pc-${code}"></div>`);
        this.pieces[sq] = code;
      }
      el.querySelector('.sq-badge')?.remove();
      el.classList.remove('is-last', 'is-sel', 'is-target', 'is-capture', 'is-check');
      el.removeAttribute('data-cls');
    }
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
}
