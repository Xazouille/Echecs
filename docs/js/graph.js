// Courbe d'évaluation de la partie (avantage des Blancs en bas, des Noirs en haut).

const MARKED = ['brilliant', 'great', 'miss', 'mistake', 'blunder'];

export class EvalGraph {
  constructor(root, { onPick }) {
    this.root = root;
    this.onPick = onPick;
    this.data = null;
    this.root.addEventListener('click', (e) => this.pick(e));
    this.root.addEventListener('keydown', (e) => {
      if (!this.data) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); this.onPick(Math.max(0, this.data.current - 1)); }
      if (e.key === 'ArrowRight') { e.preventDefault(); this.onPick(Math.min(this.data.total, this.data.current + 1)); }
    });
    new ResizeObserver(() => this.draw()).observe(root);
  }

  pick(e) {
    if (!this.data) return;
    const rect = this.root.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    this.onPick(Math.max(0, Math.min(this.data.total, Math.round(x * this.data.total))));
  }

  // wins : % de gain des Blancs pour chaque position (null si pas encore analysée)
  update(data) {
    this.data = data;
    this.draw();
  }

  draw() {
    if (!this.data) return;
    const { wins, total, current, marks } = this.data;
    const W = Math.max(100, this.root.clientWidth);
    const H = Math.max(60, this.root.clientHeight);
    const x = (i) => (total ? (i / total) * W : 0);
    const y = (w) => H - (w / 100) * H;
    let last = -1;
    for (let i = 0; i < wins.length; i++) if (wins[i] != null) last = i;
    let area = '';
    let stroke = '';
    if (last >= 0) {
      const pts = [];
      for (let i = 0; i <= last; i++) pts.push([x(i), y(wins[i] ?? 50)]);
      area = `M0,${H} ${pts.map((p) => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')} L${x(last).toFixed(1)},${H} Z`;
      stroke = `M${pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' L')}`;
    }
    const dots = marks
      .filter((m) => MARKED.includes(m.cls) && wins[m.ply] != null)
      .map((m) => `<circle class="g-dot c-${m.cls}" cx="${x(m.ply).toFixed(1)}" cy="${y(wins[m.ply]).toFixed(1)}" r="3.6"/>`)
      .join('');
    const cx = x(current).toFixed(1);
    this.root.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Courbe d’évaluation de la partie">
      <rect class="g-bg" x="0" y="0" width="${W}" height="${H}"/>
      <path class="g-area" d="${area}"/>
      <line class="g-mid" x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}"/>
      <path class="g-line" d="${stroke}"/>
      <line class="g-cursor" x1="${cx}" x2="${cx}" y1="0" y2="${H}"/>
      ${dots}
    </svg>`;
  }
}
