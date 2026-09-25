/**
 * 効果音。
 *
 * 音のファイルは持たず、鳴らすたびに波形をその場で作る。
 * 読み込むものが増えないので、オフラインでもアプリの大きさが変わらない。
 * AudioContext が無い環境（Node のテストなど）でも、黙って何もしないだけで落ちない。
 */

const MUTE_KEY = 'fishing:muted';
const AMBIENCE_KEY = 'fishing:ambience';

/**
 * 天気ごとの環境音の強さ。water は水面、rain は雨粒、wind は風。
 * 合計で小さめにしてある（効果音が埋もれないように）。
 */
const AMBIENCE_WEATHER = {
  sunny: { water: 0.10, rain: 0, wind: 0.02 },
  cloudy: { water: 0.10, rain: 0, wind: 0.04 },
  rain: { water: 0.12, rain: 0.10, wind: 0.03 },
  fog: { water: 0.07, rain: 0, wind: 0.05 },
  storm: { water: 0.16, rain: 0.14, wind: 0.12 },
};

/** 釣り場ごとの味つけ（掛け算）。流れの速い場所は水音が大きい。 */
const AMBIENCE_SPOT = {
  river: { water: 1.7, wind: 0.8 },
  harbor: { water: 1.2 },
  ice: { water: 0.4, wind: 1.4 },
  sea: { water: 1.3, wind: 1.2 },
  island: { water: 1.2 },
  cave: { water: 0.6, wind: 0 },      // 洞窟の中なので風は吹かない
  deep: { water: 1.1, wind: 1.1 },
  ruin: { water: 1.3 },
  crater: { water: 1.4, wind: 1.2 },
  abyss: { water: 1.5, wind: 1.3 },
};

/** 端末に覚えさせた設定を読む。読めなければ既定値。 */
function loadFlag(key, fallback) {
  try {
    const value = globalThis.localStorage?.getItem(key);
    return value === null || value === undefined ? fallback : value === '1';
  } catch {
    return fallback;
  }
}

function saveFlag(key, on) {
  try { globalThis.localStorage?.setItem(key, on ? '1' : '0'); } catch { /* 覚えられなくても鳴らせる */ }
}

class Sound {
  constructor() {
    this.muted = loadFlag(MUTE_KEY, false);
    this.ambienceOn = loadFlag(AMBIENCE_KEY, true);
    this.ctx = null;
    this.master = null;
    this.reel = null;      // 巻いているあいだ鳴らし続ける音
    this.noise = null;     // 使い回すホワイトノイズ
    this.ambience = null;  // 水面・雨・風の layer
    this.scene = { weather: 'sunny', spot: 'pond' };
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
    saveFlag(MUTE_KEY, this.muted);
    if (this.muted) {
      this.stopReel();
      this.stopAmbience();
    } else {
      this.unlock();
      this.#syncAmbience();
    }
    return this.muted;
  }

  toggle() { return this.setMuted(!this.muted); }

  /** 環境音（水音・雨・風）だけを切る。効果音は残る。 */
  setAmbience(on) {
    this.ambienceOn = Boolean(on);
    saveFlag(AMBIENCE_KEY, this.ambienceOn);
    this.#syncAmbience();
    return this.ambienceOn;
  }

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

  /**
   * いまいる場所と天気を伝える。環境音の混ぜ具合が変わる。
   * 呼ぶだけなら軽いので、画面の更新のたびに呼んでよい。
   */
  setScene({ weather, spot } = {}) {
    const next = {
      weather: weather ?? this.scene.weather,
      spot: spot ?? this.scene.spot,
    };
    if (next.weather === this.scene.weather && next.spot === this.scene.spot) return;
    this.scene = next;
    this.#syncAmbience();
  }

  /** 環境音を鳴らし始める。すでに鳴っていれば混ぜ具合だけ直す。 */
  startAmbience() {
    if (this.muted || !this.ambienceOn || !this.#ensure()) return;
    if (!this.ambience) this.#buildAmbience();
    this.#syncAmbience();
  }

  stopAmbience() {
    const amb = this.ambience;
    if (!amb) return;
    this.ambience = null;
    try {
      const end = this.ctx.currentTime + 0.4;
      for (const layer of [amb.water, amb.rain, amb.wind]) {
        layer.gain.gain.linearRampToValueAtTime(0.0001, end);
      }
      amb.src.stop(end + 0.05);
      amb.windLfo.stop(end + 0.05);
    } catch { /* すでに止まっていれば何もしない */ }
  }

  #buildAmbience() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.#noiseBuffer();
    src.loop = true;

    /** ノイズを 1 本の帯にして、独立した音量つまみをつける。 */
    const layer = (type, freq, q) => {
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = freq;
      filter.Q.value = q;
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      src.connect(filter).connect(gain).connect(this.master);
      return { filter, gain };
    };

    const water = layer('lowpass', 460, 0.7);
    const rain = layer('bandpass', 2800, 0.6);
    const wind = layer('lowpass', 900, 0.4);

    // 風はゆっくり強弱がつくと、それらしく聞こえる
    const windLfo = ctx.createOscillator();
    const windDepth = ctx.createGain();
    windLfo.frequency.value = 0.12;
    windDepth.gain.value = 0.5;
    windLfo.connect(windDepth).connect(wind.gain.gain);
    src.start();
    windLfo.start();

    this.ambience = { src, water, rain, wind, windLfo };
  }

  /** いまの天気と釣り場に合わせて、3 つの帯の音量を動かす。 */
  #syncAmbience() {
    if (this.muted || !this.ambienceOn) return this.stopAmbience();
    if (!this.ctx) return;
    if (!this.ambience) return this.startAmbience();

    const base = AMBIENCE_WEATHER[this.scene.weather] || AMBIENCE_WEATHER.sunny;
    const tint = AMBIENCE_SPOT[this.scene.spot] || {};
    const end = this.ctx.currentTime + 0.9;
    for (const key of ['water', 'rain', 'wind']) {
      const value = Math.max(0.0001, (base[key] ?? 0) * (tint[key] ?? 1));
      this.ambience[key].gain.gain.linearRampToValueAtTime(value, end);
    }
  }

  /**
   * 巻いているあいだの音の高さを、ラインの張り具合で変える。
   * 張りつめるほど高く鳴るので、目を離していても危ないのが分かる。
   * @param {number} tension 0..1
   */
  setReelTension(tension) {
    if (!this.reel) return;
    const t = Math.min(1, Math.max(0, Number(tension) || 0));
    try {
      this.reel.osc.frequency.linearRampToValueAtTime(74 + t * 74, this.ctx.currentTime + 0.12);
      this.reel.lfo.frequency.linearRampToValueAtTime(15 + t * 16, this.ctx.currentTime + 0.12);
    } catch { /* 止まりかけていれば何もしない */ }
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

    // ここから追加ぶん
    miss: (s) => s.#tone({ from: 330, to: 140, type: 'square', dur: 0.2, gain: 0.24 }),
    junk: (s) => { s.#tone({ from: 150, to: 90, type: 'sine', dur: 0.22, gain: 0.34 }); s.#hiss({ dur: 0.16, gain: 0.2, from: 600, to: 160, q: 0.7 }); },
    release: (s) => { s.#hiss({ dur: 0.22, gain: 0.3, from: 800, to: 200, q: 0.6 }); s.#tone({ from: 523, to: 784, type: 'sine', at: 0.05, dur: 0.24, gain: 0.2 }); },
    rage: (s) => { s.#tone({ from: 160, to: 70, type: 'sawtooth', dur: 0.55, gain: 0.4 }); s.#tone({ from: 233, to: 196, type: 'square', at: 0.05, dur: 0.4, gain: 0.2 }); s.#hiss({ dur: 0.4, gain: 0.25, from: 400, to: 120, q: 1.4 }); },
    record: (s) => { s.#tone({ from: 880, type: 'triangle', dur: 0.16, gain: 0.3 }); s.#tone({ from: 1319, type: 'triangle', at: 0.12, dur: 0.3, gain: 0.3 }); },
    unlock: (s) => [523, 659, 784, 1047, 1319].forEach((f, i) => s.#tone({ from: f, type: 'triangle', at: i * 0.1, dur: 0.42, gain: 0.3 })),
    quest: (s) => [784, 988, 1175].forEach((f, i) => s.#tone({ from: f, type: 'square', at: i * 0.08, dur: 0.22, gain: 0.24 })),
    thunder: (s) => { s.#hiss({ dur: 1.4, gain: 0.5, from: 700, to: 45, q: 0.4 }); s.#tone({ from: 60, to: 34, type: 'sine', at: 0.04, dur: 1.2, gain: 0.32 }); },
    tick: (s) => s.#tone({ from: 1200, type: 'square', dur: 0.03, gain: 0.14 }),
    open: (s) => s.#tone({ from: 440, to: 880, type: 'sine', dur: 0.14, gain: 0.18 }),
    close: (s) => s.#tone({ from: 660, to: 330, type: 'sine', dur: 0.14, gain: 0.16 }),
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
