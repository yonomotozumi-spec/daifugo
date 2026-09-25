/**
 * 効果音。
 *
 * 音のファイルは持たず、鳴らすたびに波形をその場で作る。
 * 読み込むものが増えないので、オフラインでもアプリの大きさが変わらない。
 * AudioContext が無い環境（Node のテストなど）でも、黙って何もしないだけで落ちない。
 */

const MUTE_KEY = 'fishing:muted';

/** 端末に覚えさせた消音の設定。読めなければ「音あり」。 */
function loadMuted() {
  try {
    return globalThis.localStorage?.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

class Sound {
  constructor() {
    this.muted = loadMuted();
    this.ctx = null;
    this.master = null;
    this.reel = null;     // 巻いているあいだ鳴らし続ける音
    this.noise = null;    // 使い回すホワイトノイズ
  }

  /**
   * 最初の操作で呼ぶ。
   * スマホのブラウザは、指が触れるまで音を出させてくれない。
   */
  unlock() {
    if (this.muted) return;
    this.#ensure();
    if (this.ctx?.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    try { globalThis.localStorage?.setItem(MUTE_KEY, this.muted ? '1' : '0'); } catch { /* 覚えられなくても鳴らせる */ }
    if (this.muted) this.stopReel();
    else this.unlock();
    return this.muted;
  }

  toggle() { return this.setMuted(!this.muted); }

  #ensure() {
    if (this.ctx) return this.ctx;
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctx) return null;
    try {
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.22;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
    return this.ctx;
  }

  /** 使い回すホワイトノイズ（水しぶき・風切り音のもと）。 */
  #noiseBuffer() {
    if (this.noise) return this.noise;
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buf;
    return buf;
  }

  /** 単音。type は波形、from → to へ高さを動かす。 */
  #tone({ from, to = from, type = 'sine', at = 0, dur = 0.18, gain = 0.5 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.02, dur / 3));
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(amp).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** ざらついた音。水音や糸が切れる音に使う。 */
  #hiss({ at = 0, dur = 0.3, gain = 0.5, from = 1200, to = 300, q = 1 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this.#noiseBuffer();
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = q;
    filter.frequency.setValueAtTime(from, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(amp).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  /** 音の中身。見てすぐ直せるように、1 行ずつ並べてある。 */
  static #VOICES = {
    cast: (s) => s.#hiss({ dur: 0.34, gain: 0.32, from: 2600, to: 420, q: 0.8 }),
    splash: (s) => s.#hiss({ dur: 0.26, gain: 0.4, from: 900, to: 180, q: 0.6 }),
    bite: (s) => { s.#tone({ from: 880, type: 'square', dur: 0.07, gain: 0.35 }); s.#tone({ from: 1320, type: 'square', at: 0.09, dur: 0.09, gain: 0.35 }); },
    catch: (s) => [523, 659, 784].forEach((f, i) => s.#tone({ from: f, type: 'triangle', at: i * 0.08, dur: 0.22, gain: 0.4 })),
    coin: (s) => { s.#tone({ from: 1568, type: 'square', dur: 0.06, gain: 0.3 }); s.#tone({ from: 2093, type: 'square', at: 0.07, dur: 0.1, gain: 0.26 }); },
    snap: (s) => { s.#hiss({ dur: 0.2, gain: 0.5, from: 3200, to: 600, q: 2 }); s.#tone({ from: 320, to: 60, type: 'sawtooth', dur: 0.3, gain: 0.3 }); },
    escape: (s) => s.#tone({ from: 440, to: 180, type: 'triangle', dur: 0.35, gain: 0.3 }),
    boss: (s) => { s.#tone({ from: 110, to: 82, type: 'sawtooth', dur: 0.9, gain: 0.35 }); [220, 261, 330].forEach((f, i) => s.#tone({ from: f, type: 'triangle', at: 0.1 + i * 0.1, dur: 0.6, gain: 0.22 })); },
    shiny: (s) => [1047, 1319, 1568, 2093].forEach((f, i) => s.#tone({ from: f, type: 'sine', at: i * 0.06, dur: 0.3, gain: 0.26 })),
    level: (s) => [523, 659, 784, 1047].forEach((f, i) => s.#tone({ from: f, type: 'square', at: i * 0.09, dur: 0.24, gain: 0.26 })),
    achieve: (s) => [659, 880, 1047].forEach((f, i) => s.#tone({ from: f, type: 'triangle', at: i * 0.11, dur: 0.4, gain: 0.3 })),
    buy: (s) => { s.#tone({ from: 660, type: 'square', dur: 0.07, gain: 0.26 }); s.#tone({ from: 990, type: 'square', at: 0.08, dur: 0.12, gain: 0.24 }); },
  };

  /** 鳴らせる音の名前。 */
  static get names() { return Object.keys(Sound.#VOICES); }

  /** 名前で鳴らす。知らない名前は黙って無視する。 */
  play(name) {
    if (this.muted || !this.#ensure()) return;
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    const voice = Sound.#VOICES[name];
    if (!voice) return;
    try { voice(this); } catch { /* 音が出なくても遊べる */ }
  }

  /** 巻いているあいだ、リールの唸りを鳴らし続ける。 */
  startReel() {
    if (this.muted || this.reel || !this.#ensure()) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    const lfo = ctx.createOscillator();
    const lfoAmp = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = 78;
    amp.gain.setValueAtTime(0.0001, ctx.currentTime);
    amp.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 0.08);
    // ゆらぎを足すと、機械が回っている感じになる
    lfo.frequency.value = 17;
    lfoAmp.gain.value = 0.07;
    lfo.connect(lfoAmp).connect(amp.gain);
    osc.connect(amp).connect(this.master);
    osc.start();
    lfo.start();
    this.reel = { osc, amp, lfo };
  }

  stopReel() {
    const reel = this.reel;
    if (!reel) return;
    this.reel = null;
    try {
      const end = this.ctx.currentTime + 0.12;
      reel.amp.gain.exponentialRampToValueAtTime(0.0001, end);
      reel.osc.stop(end + 0.02);
      reel.lfo.stop(end + 0.02);
    } catch { /* すでに止まっていれば何もしない */ }
  }
}

export const sound = new Sound();
export const SOUND_NAMES = Sound.names;
