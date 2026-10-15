// Sons de l'échiquier, synthétisés avec la Web Audio API (aucun fichier à charger) :
// claquement de bois pour un coup, double claquement pour un roque, choc plus grave pour une
// capture, claquement suivi de deux notes pour un échec.

let ctx = null;
let master = null;

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// Bruit bref filtré : le « toc » d'une pièce posée sur l'échiquier.
function knock(ac, t, { freq, q = 1.4, gain, dur }) {
  const len = Math.floor(ac.sampleRate * dur);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 4;
  const src = ac.createBufferSource();
  src.buffer = buf;
  const filter = ac.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = q;
  const g = ac.createGain();
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(master);
  src.start(t);
}

function tone(ac, t, freq, dur, gain) {
  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = freq;
  const g = ac.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export function soundKind(move) {
  if (move.san.includes('+') || move.san.includes('#')) return 'check';
  if (move.captured) return 'capture';
  if (move.flags.includes('k') || move.flags.includes('q')) return 'castle';
  return 'move';
}

export function playSound(kind) {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + 0.005;
  if (kind === 'capture') {
    knock(ac, t, { freq: 900, gain: 1.6, dur: 0.11 });
    knock(ac, t + 0.03, { freq: 2400, gain: 0.7, dur: 0.06 });
  } else if (kind === 'castle') {
    knock(ac, t, { freq: 1700, gain: 1.1, dur: 0.07 });
    knock(ac, t + 0.09, { freq: 1500, gain: 1, dur: 0.07 });
  } else if (kind === 'check') {
    knock(ac, t, { freq: 1700, gain: 1.1, dur: 0.07 });
    tone(ac, t + 0.03, 880, 0.14, 0.12);
    tone(ac, t + 0.11, 1320, 0.18, 0.1);
  } else {
    knock(ac, t, { freq: 1700, gain: 1.1, dur: 0.07 });
  }
}
