// Pilote UCI pour Stockfish 19 (WebAssembly) lancé dans un Web Worker.
// Les analyses passent par une file d'attente ; une analyse prioritaire passe devant.

function parseInfo(line) {
  const t = line.split(' ');
  const o = {};
  for (let i = 1; i < t.length; i++) {
    switch (t[i]) {
      case 'depth': o.depth = +t[++i]; break;
      case 'seldepth': o.seldepth = +t[++i]; break;
      case 'multipv': o.multipv = +t[++i]; break;
      case 'nodes': o.nodes = +t[++i]; break;
      case 'nps': o.nps = +t[++i]; break;
      case 'time': o.time = +t[++i]; break;
      case 'wdl': i += 3; break;
      case 'score': {
        const kind = t[++i];
        const v = +t[++i];
        o.score = kind === 'mate' ? { mate: v } : { cp: v };
        if (t[i + 1] === 'lowerbound' || t[i + 1] === 'upperbound') o.bound = t[++i];
        break;
      }
      case 'pv': o.pv = t.slice(i + 1); i = t.length; break;
      default: break;
    }
  }
  return o;
}

export class Engine {
  constructor() {
    this.worker = null;
    this.queue = [];
    this.current = null;
    this.waiters = [];
    this.ready = null;
    this.threads = 1;
    this.multiPv = 0;
    this.label = 'Stockfish 19';
  }

  // Version complète (réseau NNUE complet, 99 Mo), mono-thread : aux profondeurs du site (10 à 16),
  // les threads supplémentaires ralentissent Stockfish 19 au lieu de l'accélérer (22 positions à
  // profondeur 12 : 7,6 s avec 1 thread, 19,9 s avec 4, 27,9 s avec 8), et la précision a été calée
  // en mono-thread. Si elle ne se charge pas, repli sur la version « lite », moins précise.
  init() {
    if (this.ready) return this.ready;
    const lite = () => this.start('vendor/stockfish/stockfish-19-lite-single.js', 1, 'Stockfish 19 lite (mode de secours)');
    this.ready = this.start('vendor/stockfish/stockfish-19-single.js', 1).catch(lite);
    return this.ready;
  }

  start(file, threads, name = 'Stockfish 19') {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (msg) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (this.worker) this.worker.terminate();
        this.worker = null;
        this.waiters = [];
        reject(new Error(msg));
      };
      // Le réseau complet (99 Mo) peut mettre plusieurs secondes à se charger.
      const timer = setTimeout(() => fail('Le moteur ne répond pas.'), 60000);
      try {
        this.worker = new Worker(file);
      } catch (err) {
        fail(err.message);
        return;
      }
      this.threads = threads;
      this.worker.onerror = (ev) => fail(ev.message || 'Le moteur n’a pas pu démarrer.');
      this.worker.onmessage = (ev) => this.onLine(String(ev.data));
      this.expect('uciok')
        .then(() => {
          this.send(`setoption name Threads value ${threads}`);
          this.send('setoption name Hash value 64');
          this.send('isready');
          return this.expect('readyok');
        })
        .then(() => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          this.label = `${name} · ${threads} thread${threads > 1 ? 's' : ''}`;
          this.next();
          resolve(this);
        });
      this.send('uci');
    });
  }

  send(cmd) {
    this.worker.postMessage(cmd);
  }

  expect(token) {
    return new Promise((res) => this.waiters.push({ token, res }));
  }

  onLine(line) {
    for (let i = 0; i < this.waiters.length; i++) {
      if (line.startsWith(this.waiters[i].token)) {
        this.waiters.splice(i, 1)[0].res(line);
        i--;
      }
    }
    const job = this.current;
    if (!job) return;
    if (line.startsWith('info') && line.includes(' pv ')) {
      const info = parseInfo(line);
      if (!info.pv || !info.score || info.bound) return;
      const k = (info.multipv || 1) - 1;
      job.lines[k] = { score: info.score, pv: info.pv, depth: info.depth };
      job.depthReached = Math.max(job.depthReached, info.depth || 0);
      if (job.onInfo) job.onInfo(job.lines, info);
    } else if (line.startsWith('bestmove')) {
      this.current = null;
      const best = line.split(' ')[1];
      const lines = job.lines.filter(Boolean);
      job.resolve(job.cancelled ? null : { fen: job.fen, depth: job.depthReached, lines, bestmove: best });
      this.next();
    }
  }

  // Analyse une position. Résout avec { fen, depth, lines: [{ score, pv }] } ;
  // les scores sont donnés du point de vue du camp au trait.
  analyze(fen, { depth = 15, multipv = 3, priority = false, onInfo = null, tag = '' } = {}) {
    return new Promise((resolve) => {
      const job = { fen, depth, multipv, onInfo, tag, resolve, lines: [], depthReached: 0, cancelled: false };
      if (priority) this.queue.unshift(job);
      else this.queue.push(job);
      this.next();
    });
  }

  next() {
    if (this.current || !this.queue.length || !this.worker) return;
    const job = this.queue.shift();
    this.current = job;
    if (this.multiPv !== job.multipv) {
      this.send(`setoption name MultiPV value ${job.multipv}`);
      this.multiPv = job.multipv;
    }
    this.send(`position fen ${job.fen}`);
    this.send(`go depth ${job.depth}`);
  }

  // Abandonne les analyses en attente (et celle en cours) ; leurs promesses résolvent avec null.
  cancelAll(filter = () => true) {
    const keep = [];
    for (const job of this.queue) {
      if (filter(job)) job.resolve(null);
      else keep.push(job);
    }
    this.queue = keep;
    if (this.current && filter(this.current)) {
      this.current.cancelled = true;
      this.send('stop');
    }
  }
}
