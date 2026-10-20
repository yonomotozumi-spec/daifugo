/**
 * 音まわり。Web Audio API だけで その場で音を合成する。
 * 音源ファイルは使わないので、読み込みも 権利まわりの心配もない。
 *
 * 曲データ（SONGS）と効果音（SFX）は ただの表なので、
 * DOM や AudioContext なしでも読める＝テストできる。
 */

// ---------------------------------------------------------------- 音の高さ

const SEMITONE = { c: 0, 'c#': 1, d: 2, 'd#': 3, e: 4, f: 5, 'f#': 6, g: 7, 'g#': 8, a: 9, 'a#': 10, b: 11 };

/** 'A4' や 'C#5' を Hz に。読めなければ null。 */
export function noteFreq(name) {
  const m = /^([a-gA-G])(#?)(-?\d)$/.exec(name);
  if (!m) return null;
  const semi = SEMITONE[(m[1] + m[2]).toLowerCase()];
  const octave = Number(m[3]);
  return 440 * (2 ** ((semi - 9) / 12 + (octave - 4)));
}

/**
 * 譜面は 8 分音符ぶんの「ステップ」を空白で並べた文字列。
 *   'C4'  その音を鳴らす      '-'  前の音をのばす      '.'  休み
 * 戻り値は [{ freq, steps }]（freq が null なら休み）。
 */
export function parseTrack(notes) {
  const tokens = notes.trim().split(/\s+/);
  const out = [];
  for (const token of tokens) {
    if (token === '-' && out.length) {
      out[out.length - 1].steps++;
      continue;
    }
    if (token === '.' || token === '-') {
      out.push({ freq: null, steps: 1 });
      continue;
    }
    const freq = noteFreq(token);
    if (freq === null) throw new Error(`読めない音符: ${token}`);
    out.push({ freq, steps: 1, note: token });
  }
  return out;
}

export const trackLength = (notes) => notes.trim().split(/\s+/).length;

// ---------------------------------------------------------------- 曲

/**
 * tempo は 1 分あたりの 4 分音符の数。1 ステップは 8 分音符。
 * wave は square / triangle / sawtooth / sine / noise。
 */
export const SONGS = {
  title: {
    tempo: 84,
    loop: true,
    tracks: [
      {
        wave: 'triangle', vol: 0.5,
        notes: [
          'A4 - - - C5 - - - E5 - - - - - - -',
          'G4 - - - B4 - - - D5 - - - - - - -',
          'F4 - - - A4 - - - C5 - - - E5 - - -',
          'E5 - - - D5 - - - C5 - - - - - - -',
        ].join(' '),
      },
      {
        wave: 'sine', vol: 0.4,
        notes: [
          'A2 . . . E3 . . . A2 . . . E3 . . .',
          'G2 . . . D3 . . . G2 . . . D3 . . .',
          'F2 . . . C3 . . . F2 . . . C3 . . .',
          'E2 . . . B2 . . . E2 . . . E3 . . .',
        ].join(' '),
      },
    ],
  },

  town: {
    tempo: 126,
    loop: true,
    tracks: [
      {
        wave: 'square', vol: 0.42,
        notes: [
          'G4 - C5 - E5 - D5 - C5 - A4 - G4 - - -',
          'A4 - C5 - F5 - E5 - D5 - C5 - A4 - - -',
          'G4 - B4 - D5 - C5 - B4 - A4 - G4 - - -',
          'C5 - E5 - G5 - E5 - D5 - B4 - C5 - - -',
        ].join(' '),
      },
      {
        wave: 'triangle', vol: 0.45,
        notes: [
          'C3 . G3 . C3 . G3 . F2 . C3 . F2 . C3 .',
          'F2 . C3 . F2 . C3 . G2 . D3 . G2 . D3 .',
          'G2 . D3 . G2 . D3 . A2 . E3 . A2 . E3 .',
          'C3 . G3 . C3 . G3 . G2 . D3 . G2 . B2 .',
        ].join(' '),
      },
    ],
  },

  port: {
    tempo: 116,
    loop: true,
    tracks: [
      {
        wave: 'square', vol: 0.4,
        notes: [
          'F4 - A4 - C5 - A4 - F5 - - - C5 - - -',
          'D5 - C5 - A4 - F4 - G4 - - - A4 - - -',
          'A#4 - D5 - F5 - D5 - C5 - - - A4 - - -',
          'G4 - A4 - C5 - A4 - F4 - - - - - - -',
        ].join(' '),
      },
      {
        wave: 'triangle', vol: 0.42,
        notes: [
          'F2 . C3 . F2 . C3 . F2 . C3 . F2 . C3 .',
          'D2 . A2 . D2 . A2 . C3 . G3 . C3 . G3 .',
          'A#2 . F3 . A#2 . F3 . F2 . C3 . F2 . C3 .',
          'C3 . G3 . C3 . G3 . F2 . C3 . F2 . A2 .',
        ].join(' '),
      },
    ],
  },

  field: {
    tempo: 138,
    loop: true,
    tracks: [
      {
        wave: 'square', vol: 0.4,
        notes: [
          'D5 - D5 . G4 - B4 - D5 - - - B4 - G4 -',
          'C5 - C5 . E4 - A4 - C5 - - - A4 - E4 -',
          'B4 - D5 - G5 - F#5 - E5 - D5 - B4 - - -',
          'A4 - B4 - D5 - B4 - G4 - - - - - - -',
        ].join(' '),
      },
      {
        wave: 'triangle', vol: 0.45,
        notes: [
          'G2 . G2 . D3 . D3 . G2 . G2 . D3 . D3 .',
          'A2 . A2 . E3 . E3 . A2 . A2 . E3 . E3 .',
          'G2 . G2 . D3 . D3 . C3 . C3 . G3 . G3 .',
          'D3 . D3 . A2 . A2 . G2 . G2 . D3 . D3 .',
        ].join(' '),
      },
      {
        wave: 'noise', vol: 0.16,
        notes: [
          'C4 . . . C4 . . . C4 . . . C4 . C4 .',
          'C4 . . . C4 . . . C4 . . . C4 . C4 .',
          'C4 . . . C4 . . . C4 . . . C4 . C4 .',
          'C4 . . . C4 . . . C4 . C4 . C4 . C4 .',
        ].join(' '),
      },
    ],
  },

  cave: {
    tempo: 96,
    loop: true,
    tracks: [
      {
        wave: 'triangle', vol: 0.4,
        notes: [
          'D4 - - - F4 - - - E4 - - - - - - -',
          'A4 - - - G4 - - - F4 - - - - - - -',
          'D4 - - - C4 - - - A#3 - - - - - - -',
          'A3 - - - - - - - - - - - - - - -',
        ].join(' '),
      },
      {
        wave: 'sine', vol: 0.42,
        notes: [
          'D2 . . . . . . . D2 . . . . . . .',
          'A#1 . . . . . . . A#1 . . . . . . .',
          'A1 . . . . . . . A1 . . . . . . .',
          'D2 . . . . . . . A1 . . . . . . .',
        ].join(' '),
      },
    ],
  },

  castle: {
    tempo: 104,
    loop: true,
    tracks: [
      {
        wave: 'square', vol: 0.36,
        notes: [
          'B4 - A#4 - B4 - D5 - F#5 - - - F5 - - -',
          'E5 - D#5 - E5 - G5 - B5 - - - A#5 - - -',
          'F#5 - F5 - E5 - D5 - C#5 - - - B4 - - -',
          'A#4 - B4 - F#4 - B4 - - - - - - - - -',
        ].join(' '),
      },
      {
        wave: 'sawtooth', vol: 0.3,
        notes: [
          'B1 . B1 . B1 . B1 . B1 . B1 . B1 . B1 .',
          'E2 . E2 . E2 . E2 . E2 . E2 . E2 . E2 .',
          'F#2 . F#2 . F#2 . F#2 . F#2 . F#2 . F#2 . F#2 .',
          'B1 . B1 . B1 . B1 . F#2 . F#2 . F#2 . F#2 .',
        ].join(' '),
      },
    ],
  },

  battle: {
    tempo: 168,
    loop: true,
    tracks: [
      {
        wave: 'square', vol: 0.4,
        notes: [
          'A4 . A4 . C5 . A4 . E5 . D5 . C5 . B4 .',
          'A4 . A4 . C5 . A4 . G4 . A4 . B4 . C5 .',
          'D5 . D5 . F5 . D5 . E5 . D5 . C5 . B4 .',
          'A4 . C5 . E5 . A5 . G5 . E5 . C5 . A4 .',
        ].join(' '),
      },
      {
        wave: 'triangle', vol: 0.44,
        notes: [
          'A1 A1 . A1 . A1 A1 . A1 A1 . A1 . A1 A1 .',
          'A1 A1 . A1 . A1 A1 . F1 F1 . F1 . F1 F1 .',
          'D2 D2 . D2 . D2 D2 . D2 D2 . D2 . D2 D2 .',
          'E2 E2 . E2 . E2 E2 . E2 E2 . E2 . E2 E2 .',
        ].join(' '),
      },
      {
        wave: 'noise', vol: 0.18,
        notes: [
          'C4 . C4 C4 . C4 . C4 C4 . C4 C4 . C4 . C4',
          'C4 . C4 C4 . C4 . C4 C4 . C4 C4 . C4 . C4',
          'C4 . C4 C4 . C4 . C4 C4 . C4 C4 . C4 . C4',
          'C4 . C4 C4 . C4 . C4 C4 C4 . C4 . C4 C4 C4',
        ].join(' '),
      },
    ],
  },

  boss: {
    tempo: 176,
    loop: true,
    tracks: [
      {
        wave: 'square', vol: 0.4,
        notes: [
          'D5 . D#5 . D5 . A4 . D5 . F5 . E5 . D5 .',
          'C#5 . D5 . C#5 . A4 . F4 . A4 . C#5 . E5 .',
          'D5 . F5 . A5 . F5 . D5 . C#5 . C5 . B4 .',
          'A#4 . A4 . G#4 . A4 . D5 . - . - . - .',
        ].join(' '),
      },
      {
        wave: 'sawtooth', vol: 0.3,
        notes: [
          'D1 D1 . D1 D1 . D1 . D1 D1 . D1 D1 . D1 .',
          'A1 A1 . A1 A1 . A1 . A1 A1 . A1 A1 . A1 .',
          'A#1 A#1 . A#1 A#1 . A#1 . A1 A1 . A1 A1 . A1 .',
          'D1 D1 . D1 D1 . D1 . D1 D1 D1 . D1 . D1 D1',
        ].join(' '),
      },
      {
        wave: 'noise', vol: 0.2,
        notes: [
          'C4 C4 . C4 . C4 C4 . C4 C4 . C4 . C4 C4 .',
          'C4 C4 . C4 . C4 C4 . C4 C4 . C4 . C4 C4 .',
          'C4 C4 . C4 . C4 C4 . C4 C4 . C4 . C4 C4 .',
          'C4 C4 C4 C4 . C4 C4 . C4 C4 C4 C4 . C4 C4 C4',
        ].join(' '),
      },
    ],
  },

  victory: {
    tempo: 150,
    loop: false,
    tracks: [
      {
        wave: 'square', vol: 0.45,
        notes: 'C5 . E5 . G5 . C6 - - . G5 . C6 - - - - - - -',
      },
      {
        wave: 'triangle', vol: 0.45,
        notes: 'C3 . C3 . G3 . C4 - - . G3 . C4 - - - - - - -',
      },
    ],
  },

  gameover: {
    tempo: 92,
    loop: false,
    tracks: [
      {
        wave: 'triangle', vol: 0.45,
        notes: 'A4 - - G4 - - F4 - - E4 - - - D4 - - - - - -',
      },
      {
        wave: 'sine', vol: 0.4,
        notes: 'A2 - - G2 - - F2 - - E2 - - - D2 - - - - - -',
      },
    ],
  },

  ending: {
    tempo: 92,
    loop: true,
    tracks: [
      {
        wave: 'triangle', vol: 0.46,
        notes: [
          'C5 - - - E5 - G5 - A5 - - - G5 - - -',
          'F5 - - - E5 - D5 - C5 - - - - - - -',
          'D5 - - - F5 - A5 - C6 - - - A5 - - -',
          'G5 - - - E5 - C5 - - - - - - - - -',
        ].join(' '),
      },
      {
        wave: 'sine', vol: 0.42,
        notes: [
          'C3 . G3 . C3 . G3 . F2 . C3 . F2 . C3 .',
          'F2 . C3 . F2 . C3 . C3 . G3 . C3 . G3 .',
          'D3 . A3 . D3 . A3 . F2 . C3 . F2 . C3 .',
          'G2 . D3 . G2 . D3 . C3 . G3 . C3 . - .',
        ].join(' '),
      },
    ],
  },
};

export const songNames = () => Object.keys(SONGS);

// ---------------------------------------------------------------- 効果音

/**
 * 効果音は 短い音のかたまり。
 * type は tone（音程つき）か noise（ざらざら）。
 */
export const SFX = {
  cursor: [{ type: 'tone', wave: 'square', from: 880, to: 880, dur: 0.05, vol: 0.16 }],
  select: [{ type: 'tone', wave: 'square', from: 660, to: 1320, dur: 0.09, vol: 0.2 }],
  cancel: [{ type: 'tone', wave: 'square', from: 520, to: 300, dur: 0.1, vol: 0.18 }],
  swing: [{ type: 'noise', from: 2400, to: 700, dur: 0.11, vol: 0.22 }],
  hit: [
    { type: 'noise', from: 1800, to: 250, dur: 0.16, vol: 0.28 },
    { type: 'tone', wave: 'square', from: 220, to: 80, dur: 0.14, vol: 0.18 },
  ],
  critical: [
    { type: 'noise', from: 3200, to: 300, dur: 0.24, vol: 0.3 },
    { type: 'tone', wave: 'sawtooth', from: 880, to: 110, dur: 0.24, vol: 0.22 },
  ],
  hurt: [
    { type: 'tone', wave: 'sawtooth', from: 320, to: 90, dur: 0.22, vol: 0.24 },
    { type: 'noise', from: 900, to: 200, dur: 0.16, vol: 0.18 },
  ],
  cast: [{ type: 'tone', wave: 'sine', from: 300, to: 1400, dur: 0.28, vol: 0.2 }],
  heal: [
    { type: 'tone', wave: 'sine', from: 660, to: 990, dur: 0.14, vol: 0.2 },
    { type: 'tone', wave: 'sine', from: 990, to: 1320, dur: 0.16, vol: 0.18, delay: 0.12 },
  ],
  dead: [{ type: 'tone', wave: 'triangle', from: 440, to: 60, dur: 0.6, vol: 0.24 }],
  defeat: [
    { type: 'tone', wave: 'square', from: 520, to: 130, dur: 0.35, vol: 0.22 },
    { type: 'noise', from: 1200, to: 120, dur: 0.35, vol: 0.18 },
  ],
  levelup: [
    { type: 'tone', wave: 'square', from: 523, to: 523, dur: 0.1, vol: 0.2 },
    { type: 'tone', wave: 'square', from: 659, to: 659, dur: 0.1, vol: 0.2, delay: 0.1 },
    { type: 'tone', wave: 'square', from: 784, to: 784, dur: 0.1, vol: 0.2, delay: 0.2 },
    { type: 'tone', wave: 'square', from: 1047, to: 1047, dur: 0.24, vol: 0.22, delay: 0.3 },
  ],
  chest: [
    { type: 'tone', wave: 'square', from: 784, to: 784, dur: 0.08, vol: 0.18 },
    { type: 'tone', wave: 'square', from: 1047, to: 1047, dur: 0.18, vol: 0.2, delay: 0.08 },
  ],
  encounter: [
    { type: 'noise', from: 400, to: 3000, dur: 0.3, vol: 0.26 },
    { type: 'tone', wave: 'sawtooth', from: 110, to: 440, dur: 0.3, vol: 0.2 },
  ],
  warp: [{ type: 'tone', wave: 'sine', from: 200, to: 2000, dur: 0.5, vol: 0.22 }],
  buy: [
    { type: 'tone', wave: 'square', from: 988, to: 988, dur: 0.07, vol: 0.18 },
    { type: 'tone', wave: 'square', from: 1319, to: 1319, dur: 0.12, vol: 0.18, delay: 0.07 },
  ],
  join: [
    { type: 'tone', wave: 'triangle', from: 523, to: 523, dur: 0.12, vol: 0.2 },
    { type: 'tone', wave: 'triangle', from: 784, to: 784, dur: 0.12, vol: 0.2, delay: 0.12 },
    { type: 'tone', wave: 'triangle', from: 1047, to: 1047, dur: 0.3, vol: 0.22, delay: 0.24 },
  ],
  star: [
    { type: 'tone', wave: 'sine', from: 660, to: 1760, dur: 0.5, vol: 0.22 },
    { type: 'tone', wave: 'sine', from: 990, to: 2640, dur: 0.5, vol: 0.16, delay: 0.1 },
  ],
};

export const sfxNames = () => Object.keys(SFX);

/** どのマップで どの曲を鳴らすか。 */
export function songForMap(map) {
  if (!map) return 'town';
  if (map.id === 'port' || map.id.startsWith('port') || map.id === 'lighthouse') return 'port';
  if (map.kind === 'town' || map.kind === 'room') return 'town';
  if (map.kind === 'cave') return 'cave';
  if (map.kind === 'castle') return 'castle';
  return 'field';
}

// ---------------------------------------------------------------- 演奏

/**
 * 曲と効果音を鳴らす係。AudioContext は 最初のひと押しまで作らない
 * （ブラウザが 勝手に音を出すのを 禁じているため）。
 */
export class Jukebox {
  constructor({ enabled = true, volume = 0.5 } = {}) {
    this.enabled = enabled;
    this.volume = volume;
    this.ctx = null;
    this.master = null;
    this.bgmGain = null;
    this.current = null;      // いま鳴らしている曲の名前
    this.timer = null;
    this.nextTime = 0;
    this.step = 0;
    this.song = null;
    this.parsed = null;
    this.noiseBuffer = null;
  }

  /** 画面のどこかが押されたときに呼ぶ。ここではじめて音が出せるようになる。 */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? this.volume : 0;
    this.master.connect(this.ctx.destination);
    this.bgmGain = this.ctx.createGain();
    this.bgmGain.gain.value = 0.55;
    this.bgmGain.connect(this.master);
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? this.volume : 0;
    if (!on) this.stop();
    else if (this.current) this.play(this.current, { restart: true });
  }

  #noise() {
    if (this.noiseBuffer) return this.noiseBuffer;
    const len = Math.floor(this.ctx.sampleRate * 0.5);
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;
    return buffer;
  }

  /** 曲を鳴らす。同じ曲なら 何もしない。 */
  play(name, { restart = false } = {}) {
    if (!SONGS[name]) return;
    if (this.current === name && !restart && this.timer) return;
    this.stop();
    this.current = name;
    if (!this.enabled || !this.ctx) return;

    this.song = SONGS[name];
    this.length = trackLength(this.song.tracks[0].notes);
    // 「何ステップ目に どの音が始まるか」を先に並べておくと、演奏中の手間が減る。
    this.parsed = this.song.tracks.map((track) => {
      const byStep = new Array(this.length).fill(null);
      let at = 0;
      for (const note of parseTrack(track.notes)) {
        if (at < this.length && note.freq !== null) byStep[at] = note;
        at += note.steps;
      }
      return { ...track, byStep };
    });
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.06;
    this.#schedule();
    this.timer = setInterval(() => this.#schedule(), 60);
  }

  /** 1 曲だけ鳴らして、終わったら もとの曲に戻す。 */
  jingle(name, back) {
    if (!SONGS[name]) return;
    const song = SONGS[name];
    const steps = trackLength(song.tracks[0].notes);
    const seconds = (steps * 30) / song.tempo;
    this.play(name, { restart: true });
    setTimeout(() => { if (back) this.play(back, { restart: true }); }, Math.round(seconds * 1000) + 120);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.song = null;
  }

  /** これから 0.4 秒ぶんくらいの音を 先に予約しておく。 */
  #schedule() {
    if (!this.ctx || !this.song) return;
    const stepSec = 30 / this.song.tempo;
    while (this.nextTime < this.ctx.currentTime + 0.4) {
      for (const track of this.parsed) {
        const note = track.byStep[this.step];
        if (note) this.#note(track, note.freq, this.nextTime, note.steps * stepSec);
      }
      this.step++;
      this.nextTime += stepSec;
      if (this.step >= this.length) {
        if (!this.song.loop) { this.stop(); return; }
        this.step = 0;
      }
    }
  }

  #note(track, freq, time, dur) {
    const ctx = this.ctx;
    const gain = ctx.createGain();
    const vol = (track.vol ?? 0.4) * 0.5;
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(vol, time + 0.012);
    gain.gain.setTargetAtTime(0.0001, time + dur * 0.7, 0.06);
    gain.connect(this.bgmGain);

    let source;
    if (track.wave === 'noise') {
      source = ctx.createBufferSource();
      source.buffer = this.#noise();
      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 1200;
      source.connect(filter);
      filter.connect(gain);
    } else {
      source = ctx.createOscillator();
      source.type = track.wave || 'square';
      source.frequency.setValueAtTime(freq, time);
      source.connect(gain);
    }
    source.start(time);
    source.stop(time + dur + 0.12);
  }

  /** 効果音。 */
  sfx(name) {
    const parts = SFX[name];
    if (!parts || !this.enabled || !this.ctx) return;
    const ctx = this.ctx;
    for (const part of parts) {
      const time = ctx.currentTime + (part.delay || 0);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(part.vol, time);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + part.dur);
      gain.connect(this.master);

      let source;
      if (part.type === 'noise') {
        source = ctx.createBufferSource();
        source.buffer = this.#noise();
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(part.from, time);
        filter.frequency.exponentialRampToValueAtTime(Math.max(40, part.to), time + part.dur);
        filter.Q.value = 1.2;
        source.connect(filter);
        filter.connect(gain);
      } else {
        source = ctx.createOscillator();
        source.type = part.wave || 'square';
        source.frequency.setValueAtTime(part.from, time);
        source.frequency.exponentialRampToValueAtTime(Math.max(20, part.to), time + part.dur);
        source.connect(gain);
      }
      source.start(time);
      source.stop(time + part.dur + 0.05);
    }
  }
}
