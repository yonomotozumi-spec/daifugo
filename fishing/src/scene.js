/**
 * 釣り場の描画とアニメーション。canvas に閉じている。
 * ゲームの進行は ui.js が持っていて、ここは「今どの見た目か」を受け取って描くだけ。
 */

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t * t * (3 - 2 * t);          // なめらかな加減速
const easeOut = (t) => 1 - (1 - t) * (1 - t);

/** キャストの飛翔時間（秒）。ui.js のタイマーと合わせている。 */
export const CAST_TIME = 0.85;
/** 釣り上げの演出時間（秒）。 */
export const LAND_TIME = 1.15;

/** 時間帯ごとの空と水の色。 */
const PALETTE = {
  morning: {
    sky: ['#ffd9a8', '#ffe9c9', '#bfe3f2'], sun: '#fff3c4', sunY: 0.30, star: 0,
    water: ['#4aa3b8', '#20627a', '#0d3247'], hill: '#5b7f74', haze: 'rgba(255,225,180,0.35)',
  },
  noon: {
    sky: ['#5fb8e8', '#9ad9f2', '#dff2fb'], sun: '#fffbe6', sunY: 0.14, star: 0,
    water: ['#3fa4c4', '#176787', '#08324a'], hill: '#4d7a63', haze: 'rgba(255,255,255,0.22)',
  },
  evening: {
    sky: ['#f2743f', '#f7a25c', '#6f6fa8'], sun: '#ffd07a', sunY: 0.40, star: 0.25,
    water: ['#c96b4a', '#5a4a72', '#20203c'], hill: '#3f3a52', haze: 'rgba(255,150,90,0.35)',
  },
  night: {
    sky: ['#0a1030', '#16204a', '#33427a'], sun: '#eef3ff', sunY: 0.20, star: 1,
    water: ['#1b3a5c', '#102846', '#050f22'], hill: '#141a2e', haze: 'rgba(120,150,255,0.18)',
  },
};

/**
 * 釣り場ごとの水の濃さと足場。
 * tint … 水にかぶせる色  current … 流れの筋  rocks … 岸の岩
 * gulls … カモメ  glow … 発光するプランクトン
 */
const SPOT_STYLE = {
  pond: {
    depth: 0.0, ground: '#4a5a3c', bank: '#6b7a4a', ray: 0.5, weed: 7,
    tint: 'rgba(60,120,70,0.16)', current: 0, rocks: 0, gulls: 0, glow: 0,
  },
  river: {
    depth: 0.08, ground: '#5a5a4a', bank: '#7a7a6a', ray: 0.65, weed: 4,
    tint: 'rgba(70,160,150,0.14)', current: 1, rocks: 4, gulls: 0, glow: 0,
  },
  sea: {
    depth: 0.24, ground: '#2a4a5a', bank: '#8a8272', ray: 0.75, weed: 2,
    tint: 'rgba(20,70,150,0.20)', current: 0.3, rocks: 1, gulls: 4, glow: 0,
  },
  deep: {
    depth: 0.68, ground: '#101a28', bank: '#2a3040', ray: 0.1, weed: 0,
    tint: 'rgba(4,10,40,0.35)', current: 0, rocks: 0, gulls: 0, glow: 26,
  },
};

export class Scene {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = 800;
    this.h = 450;
    this.dpr = 1;
    this.t = 0;
    this.last = 0;
    this.raf = 0;

    this.mode = 'idle';        // idle | cast | wait | bite | fight | land | fail
    this.spot = 'pond';
    this.time = 'noon';
    this.fight = null;
    this.holding = false;

    this.castT = 0;            // 0..1 キャストの進み
    this.modeT = 0;            // 現在のモードに入ってからの秒数
    this.lure = { x: 0, y: 0 };
    this.target = { x: 0, y: 0 };
    this.bobDepth = 0;         // ウキの沈み込み
    this.rodAngle = -0.5;
    this.rodTarget = -0.5;
    this.shake = 0;
    this.flash = 0;
    this.flashColor = '255,255,255';

    this.particles = [];
    this.ripples = [];
    this.clouds = [];
    this.stars = [];
    this.ambient = [];
    this.bubbles = [];
    this.landing = null;       // 釣り上げ演出中の魚

    this._seed = 1;
    this.#buildDecor();
    this.resize();
  }

  // 見た目用の乱数。ゲーム側の乱数とは別にしておく
  #rnd() {
    this._seed = (this._seed * 16807) % 2147483647;
    return this._seed / 2147483647;
  }

  #buildDecor() {
    this.clouds = Array.from({ length: 6 }, () => ({
      x: this.#rnd(), y: 0.05 + this.#rnd() * 0.22, s: 0.5 + this.#rnd(), v: 0.004 + this.#rnd() * 0.008,
    }));
    this.stars = Array.from({ length: 70 }, () => ({
      x: this.#rnd(), y: this.#rnd() * 0.42, s: 0.4 + this.#rnd() * 1.4, p: this.#rnd() * TAU,
    }));
    this.ambient = Array.from({ length: 7 }, (_, i) => this.#newAmbient(i / 7));
    this.bubbles = Array.from({ length: 14 }, () => ({
      x: this.#rnd(), y: this.#rnd(), r: 1 + this.#rnd() * 2.5, v: 0.03 + this.#rnd() * 0.05,
    }));
  }

  #newAmbient(x = -0.1) {
    const dir = this.#rnd() < 0.5 ? 1 : -1;
    return {
      x: dir > 0 ? x : 1 - x,
      y: 0.12 + this.#rnd() * 0.8,
      s: 0.5 + this.#rnd() * 0.9,
      v: (0.03 + this.#rnd() * 0.06) * dir,
      dir,
      p: this.#rnd() * TAU,
    };
  }

  // ------------------------------------------------------------ 外向きの操作

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(320, rect.width || 800);
    const h = Math.max(240, rect.height || 450);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  start() {
    if (this.raf) return;
    this.last = performance.now();
    const loop = (now) => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min((now - this.last) / 1000, 0.05);
      this.last = now;
      this.update(dt);
      this.draw();
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  setSpot(spotId) { this.spot = spotId; }
  setTime(timeId) { this.time = timeId; }

  setMode(mode) {
    this.mode = mode;
    this.modeT = 0;
  }

  /** 竿を振ってルアーを飛ばす。距離は 0..1（遠いほど深い場所）。 */
  cast(distance = 0.6) {
    this.setMode('cast');
    this.castT = 0;
    this.bobDepth = 0;
    this.landing = null;
    const tip = this.rodTip();
    this.lure = { x: tip.x, y: tip.y };
    this.target = {
      x: lerp(this.w * 0.42, this.w * 0.92, distance),
      y: this.waterY() - 2,
    };
    this.rodAngle = -1.5;
    this.rodTarget = -0.25;
  }

  /** アタリ。ウキが沈んで波紋が走る。 */
  bite() {
    this.setMode('bite');
    this.splash(this.lure.x, this.waterY(), 10, 1.2);
    this.ring(this.lure.x, this.waterY(), 1.4);
    this.shake = Math.max(this.shake, 5);
    this.pop(this.lure.x, this.waterY() - 46, '！', '#ffd43b');
  }

  /** 合わせ成功。ファイト開始。 */
  hook(fight) {
    this.fight = fight;
    this.setMode('fight');
    this.rodTarget = -1.15;
    this.splash(this.lure.x, this.waterY(), 14, 1.5);
    this.ring(this.lure.x, this.waterY(), 1.6);
    this.shake = Math.max(this.shake, 8);
  }

  setHolding(holding) { this.holding = holding; }

  /** 釣り上げ成功。魚が水面から飛び出して釣り人の手元へ。 */
  land(result) {
    this.fight = null;
    this.setMode('land');
    this.rodTarget = -0.9;
    const from = { x: this.lure.x, y: this.waterY() };
    const angler = this.anglerPos();
    this.landing = {
      result,
      from,
      to: { x: angler.x + 34, y: angler.y - 54 },
      peak: Math.min(from.y, angler.y) - this.h * 0.34,
      t: 0,
    };
    this.splash(from.x, from.y, 26, 2);
    this.ring(from.x, from.y, 2.2);
    this.shake = 10;
    this.flash = 0.55;
    this.flashColor = '255,255,255';
    for (let i = 0; i < 18; i++) this.sparkle(from.x, from.y - 40);
  }

  /** 逃げられた / ラインが切れた。 */
  fail(kind = 'escaped') {
    this.fight = null;
    this.setMode('fail');
    this.rodTarget = -0.35;
    this.splash(this.lure.x, this.waterY(), 12, 1.1);
    this.ring(this.lure.x, this.waterY(), 1.5);
    this.shake = 7;
    if (kind === 'snapped') {
      this.flash = 0.4;
      this.flashColor = '255,120,110';
      this.pop(this.lure.x, this.waterY() - 50, 'プツン', '#ff8787');
    } else {
      this.pop(this.lure.x, this.waterY() - 50, 'にげられた', '#dbe4ff');
    }
  }

  /** 竿を戻して待機に戻す。 */
  reset() {
    this.setMode('idle');
    this.fight = null;
    this.landing = null;
    this.rodTarget = -0.5;
    this.bobDepth = 0;
  }

  /** 売却時などに使う、飛んでいくコイン。 */
  coins(count = 12) {
    const from = this.landing ? this.landing.to : this.anglerPos();
    for (let i = 0; i < count; i++) {
      this.particles.push({
        type: 'coin',
        x: from.x + (this.#rnd() - 0.5) * 30,
        y: from.y + (this.#rnd() - 0.5) * 20,
        vx: 60 + this.#rnd() * 180,
        vy: -140 - this.#rnd() * 160,
        g: 380,
        life: 0, max: 0.9 + this.#rnd() * 0.4,
        r: 5 + this.#rnd() * 4,
        rot: this.#rnd() * TAU, vr: (this.#rnd() - 0.5) * 12,
      });
    }
    this.flash = 0.25;
    this.flashColor = '255,220,120';
  }

  // ------------------------------------------------------------ 部品

  waterY() { return Math.round(this.h * 0.46); }

  anglerPos() { return { x: this.w * 0.13, y: this.waterY() + 4 }; }

  rodTip() {
    const a = this.anglerPos();
    // 横向きの端末など画面が低いときは、竿先が画面の外に出ないように短くする
    const len = Math.min(this.w * 0.26, 190, this.h * 0.42);
    return {
      x: a.x + Math.cos(this.rodAngle) * len,
      y: a.y - 58 + Math.sin(this.rodAngle) * len,
    };
  }

  splash(x, y, count = 10, power = 1) {
    for (let i = 0; i < count; i++) {
      const a = -Math.PI / 2 + (this.#rnd() - 0.5) * 2.2;
      const sp = (60 + this.#rnd() * 190) * power;
      this.particles.push({
        type: 'drop',
        x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        g: 620,
        life: 0, max: 0.45 + this.#rnd() * 0.5,
        r: 1.5 + this.#rnd() * 3 * power,
      });
    }
  }

  sparkle(x, y) {
    const a = this.#rnd() * TAU;
    const sp = 40 + this.#rnd() * 130;
    this.particles.push({
      type: 'spark',
      x: x + (this.#rnd() - 0.5) * 60, y: y + (this.#rnd() - 0.5) * 50,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
      g: 90,
      life: 0, max: 0.5 + this.#rnd() * 0.6,
      r: 2 + this.#rnd() * 3,
      rot: this.#rnd() * TAU, vr: (this.#rnd() - 0.5) * 8,
    });
  }

  pop(x, y, text, color) {
    this.particles.push({
      type: 'text', x, y, vx: 0, vy: -46, g: 30,
      life: 0, max: 1.1, text, color, r: 0,
    });
  }

  ring(x, y, scale = 1) {
    this.ripples.push({ x, y, r: 4, max: 42 * scale + 30, life: 0, dur: 0.9 + scale * 0.25 });
  }

  // ------------------------------------------------------------ 更新

  update(dt) {
    this.t += dt;
    this.modeT += dt;
    this.shake = Math.max(0, this.shake - dt * 26);
    this.flash = Math.max(0, this.flash - dt * 1.6);

    // 竿の角度はいつも目標へ追いつく
    this.rodAngle += (this.rodTarget - this.rodAngle) * Math.min(1, dt * 9);

    const waterY = this.waterY();

    if (this.mode === 'cast') {
      this.castT = clamp(this.castT + dt / CAST_TIME, 0, 1);
      const t = this.castT;
      const tip = this.rodTip();
      // 竿先 → 着水点までの放物線
      this.lure.x = lerp(tip.x, this.target.x, easeOut(t));
      const arc = Math.sin(t * Math.PI) * this.h * 0.34;
      this.lure.y = lerp(tip.y, this.target.y, t * t) - arc;
      if (t >= 1) {
        this.lure.y = waterY;
        this.splash(this.lure.x, waterY, 12, 1);
        this.ring(this.lure.x, waterY, 1);
        this.ring(this.lure.x, waterY, 0.6);
        this.setMode('wait');
      }
    } else if (this.mode === 'wait') {
      // ウキがゆっくり上下する。ときどき小さな波紋
      this.bobDepth = Math.sin(this.t * 2.2) * 2.5;
      this.lure.y = waterY + this.bobDepth;
      if (this.#rnd() < dt * 1.2) this.ring(this.lure.x + (this.#rnd() - 0.5) * 20, waterY, 0.35);
    } else if (this.mode === 'bite') {
      // ぐいぐい引き込まれる
      this.bobDepth = 6 + Math.sin(this.modeT * 26) * 5 + this.modeT * 14;
      this.lure.y = waterY + this.bobDepth;
      if (this.#rnd() < dt * 8) this.ring(this.lure.x, waterY, 0.5);
    } else if (this.mode === 'fight') {
      const f = this.fight;
      this.bobDepth = 16 + (f ? f.fishY * 26 : 0);
      this.lure.y = waterY + this.bobDepth;
      // 魚が走ると水面が揺れる
      if (f) {
        this.rodTarget = this.holding ? -1.35 : -1.0;
        if (f.dash > 0.7 && this.#rnd() < dt * 12) {
          this.ring(this.lure.x + (this.#rnd() - 0.5) * 40, waterY, 0.6);
          this.shake = Math.max(this.shake, 3);
        }
        if (f.strain > 0.7) this.shake = Math.max(this.shake, (f.strain - 0.7) * 22);
        if (this.holding && this.#rnd() < dt * 20) this.splash(this.lure.x, waterY, 1, 0.5);
      }
    } else if (this.mode === 'land') {
      const L = this.landing;
      if (L) {
        L.t = clamp(L.t + dt / LAND_TIME, 0, 1);
        const t = L.t;
        // 山なりに跳ね上がって手元へ
        L.x = lerp(L.from.x, L.to.x, ease(t));
        L.y = (1 - t) * (1 - t) * L.from.y + 2 * (1 - t) * t * L.peak + t * t * L.to.y;
        L.rot = (1 - t) * -1.5 + t * 0.2 + Math.sin(t * 12) * 0.12 * (1 - t);
        if (t < 0.35 && this.#rnd() < dt * 30) {
          this.particles.push({
            type: 'drop', x: L.x, y: L.y, vx: (this.#rnd() - 0.5) * 90, vy: 20 + this.#rnd() * 60,
            g: 520, life: 0, max: 0.5, r: 1.5 + this.#rnd() * 2,
          });
        }
        if (t > 0.55 && this.#rnd() < dt * 14) this.sparkle(L.x, L.y);
      }
      this.lure.y = waterY;
    } else if (this.mode === 'fail') {
      // ラインがふわっと戻る
      this.bobDepth = Math.max(0, 18 - this.modeT * 40) + Math.sin(this.t * 3) * 2;
      this.lure.y = waterY + this.bobDepth;
      this.rodTarget = -0.35;
    } else {
      this.rodTarget = -0.5 + Math.sin(this.t * 0.8) * 0.03;
    }

    // 雲・魚影・泡
    for (const c of this.clouds) {
      c.x += c.v * dt;
      if (c.x > 1.25) { c.x = -0.3; c.y = 0.05 + this.#rnd() * 0.22; }
    }
    for (let i = 0; i < this.ambient.length; i++) {
      const a = this.ambient[i];
      a.x += a.v * dt * 0.45;
      a.p += dt * 2.4;
      if (a.x > 1.2 || a.x < -0.2) this.ambient[i] = this.#newAmbient(-0.05);
    }
    for (const b of this.bubbles) {
      b.y -= b.v * dt;
      if (b.y < 0) { b.y = 1; b.x = this.#rnd(); }
    }

    // パーティクル
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      p.vy += (p.g || 0) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.vr) p.rot += p.vr * dt;
      if (p.life >= p.max) this.particles.splice(i, 1);
    }
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i];
      r.life += dt;
      r.r = 4 + easeOut(r.life / r.dur) * r.max;
      if (r.life >= r.dur) this.ripples.splice(i, 1);
    }
  }

  // ------------------------------------------------------------ 描画

  draw() {
    const { ctx, w, h } = this;
    const pal = PALETTE[this.time] || PALETTE.noon;
    const style = SPOT_STYLE[this.spot] || SPOT_STYLE.pond;
    const waterY = this.waterY();

    ctx.save();
    if (this.shake > 0.2) {
      ctx.translate((this.#rnd() - 0.5) * this.shake, (this.#rnd() - 0.5) * this.shake);
    }
    ctx.clearRect(-20, -20, w + 40, h + 40);

    this.#drawSky(pal, waterY);
    this.#drawHills(pal, style, waterY);
    this.#drawWater(pal, style, waterY);
    this.#drawUnderwater(pal, style, waterY);
    this.#drawSurface(pal, waterY);
    this.#drawRocks(style, waterY);
    this.#drawRipples();
    this.#drawDock(style, waterY);
    this.#drawLine();
    this.#drawAngler();
    this.#drawLanding();
    this.#drawParticles();
    this.#drawFightGauge();
    ctx.restore();

    if (this.flash > 0.01) {
      ctx.fillStyle = `rgba(${this.flashColor},${this.flash * 0.5})`;
      ctx.fillRect(0, 0, w, h);
    }
  }

  #drawSky(pal, waterY) {
    const { ctx, w } = this;
    const g = ctx.createLinearGradient(0, 0, 0, waterY);
    g.addColorStop(0, pal.sky[0]);
    g.addColorStop(0.55, pal.sky[1]);
    g.addColorStop(1, pal.sky[2]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, waterY);

    if (pal.star > 0) {
      for (const s of this.stars) {
        const tw = 0.55 + 0.45 * Math.sin(this.t * 2 + s.p);
        ctx.fillStyle = `rgba(255,255,255,${pal.star * tw * 0.9})`;
        ctx.fillRect(s.x * w, s.y * waterY, s.s, s.s);
      }
    }

    // 太陽 or 月
    const sx = w * 0.76;
    const sy = waterY * pal.sunY + 10;
    const glow = ctx.createRadialGradient(sx, sy, 4, sx, sy, 90);
    glow.addColorStop(0, pal.haze);
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(sx, sy, 90, 0, TAU);
    ctx.fill();
    ctx.fillStyle = pal.sun;
    ctx.beginPath();
    ctx.arc(sx, sy, this.time === 'night' ? 16 : 22, 0, TAU);
    ctx.fill();
    if (this.time === 'night') {           // 月を欠けさせる
      ctx.fillStyle = pal.sky[0];
      ctx.beginPath();
      ctx.arc(sx - 8, sy - 5, 15, 0, TAU);
      ctx.fill();
    }

    // カモメ（海）
    const style = SPOT_STYLE[this.spot] || SPOT_STYLE.pond;
    if (style.gulls) {
      ctx.strokeStyle = this.time === 'night' ? 'rgba(200,210,240,0.5)' : 'rgba(60,70,80,0.6)';
      ctx.lineWidth = 2;
      for (let i = 0; i < style.gulls; i++) {
        const gx = ((this.t * (14 + i * 5) + i * 260) % (w + 120)) - 60;
        const gy = waterY * (0.18 + i * 0.11) + Math.sin(this.t * 0.8 + i) * 8;
        const flap = Math.sin(this.t * 5 + i * 1.4) * 4;
        const s = 7 + (i % 2) * 3;
        ctx.beginPath();
        ctx.moveTo(gx - s, gy + flap);
        ctx.quadraticCurveTo(gx - s / 2, gy - 3, gx, gy);
        ctx.quadraticCurveTo(gx + s / 2, gy - 3, gx + s, gy + flap);
        ctx.stroke();
      }
    }

    // 雲
    for (const c of this.clouds) {
      const cx = c.x * (w + 200) - 100;
      const cy = c.y * waterY;
      ctx.fillStyle = this.time === 'night' ? 'rgba(180,195,235,0.20)' : 'rgba(255,255,255,0.62)';
      for (const [ox, oy, r] of [[0, 0, 22], [20, 4, 16], [-20, 5, 14], [8, -8, 15]]) {
        ctx.beginPath();
        ctx.ellipse(cx + ox * c.s, cy + oy * c.s, r * c.s, r * c.s * 0.66, 0, 0, TAU);
        ctx.fill();
      }
    }
  }

  #drawHills(pal, style, waterY) {
    const { ctx, w } = this;
    if (this.spot === 'deep') return;
    ctx.fillStyle = pal.hill;
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.moveTo(0, waterY);
    const peaks = this.spot === 'sea' ? 2 : 5;
    for (let i = 0; i <= peaks; i++) {
      const x = (i / peaks) * w;
      const yy = waterY - (this.spot === 'sea' ? 12 : 40 + Math.sin(i * 2.3) * 26);
      ctx.quadraticCurveTo(x - w / peaks / 2, yy - 18, x, yy);
    }
    ctx.lineTo(w, waterY);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  #drawWater(pal, style, waterY) {
    const { ctx, w, h } = this;
    const g = ctx.createLinearGradient(0, waterY, 0, h);
    g.addColorStop(0, pal.water[0]);
    g.addColorStop(0.45, pal.water[1]);
    g.addColorStop(1, pal.water[2]);
    ctx.fillStyle = g;
    ctx.fillRect(0, waterY, w, h - waterY);

    if (style.depth > 0) {                 // 深い場所ほど暗く重ねる
      ctx.fillStyle = `rgba(2,8,20,${style.depth})`;
      ctx.fillRect(0, waterY, w, h - waterY);
    }
    if (style.tint) {                      // 釣り場ごとの水の色
      ctx.fillStyle = style.tint;
      ctx.fillRect(0, waterY, w, h - waterY);
    }

    // 光条
    if (style.ray > 0.2) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 4; i++) {
        const x = w * (0.2 + i * 0.2) + Math.sin(this.t * 0.4 + i) * 26;
        ctx.fillStyle = `rgba(255,255,255,${0.05 * style.ray})`;
        ctx.beginPath();
        ctx.moveTo(x - 16, waterY);
        ctx.lineTo(x + 16, waterY);
        ctx.lineTo(x + 70, h);
        ctx.lineTo(x - 40, h);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
  }

  #drawUnderwater(pal, style, waterY) {
    const { ctx, w, h } = this;
    const depth = h - waterY;

    // 流れの筋（渓流・海）
    if (style.current) {
      ctx.save();
      ctx.globalAlpha = 0.16 * style.current;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      for (let i = 0; i < 9; i++) {
        const y = waterY + 20 + ((i * 37) % (depth - 30));
        const speed = 90 + (i % 3) * 45;
        const len = 40 + (i % 4) * 22;
        const x = w - ((this.t * speed + i * 130) % (w + 220)) + 110;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + len, y + Math.sin(i) * 3);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 発光するプランクトン（深海）
    if (style.glow) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < style.glow; i++) {
        const gx = ((i * 97) % 100) / 100 * w + Math.sin(this.t * 0.4 + i) * 12;
        const gy = waterY + 20 + ((i * 61) % 100) / 100 * (depth - 30);
        const pulse = 0.35 + 0.65 * Math.abs(Math.sin(this.t * 1.2 + i * 1.7));
        const r = 2 + (i % 3);
        const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, r * 4);
        g.addColorStop(0, `rgba(140,255,220,${0.5 * pulse})`);
        g.addColorStop(1, 'rgba(140,255,220,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(gx, gy, r * 4, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }

    // 泡
    ctx.fillStyle = 'rgba(255,255,255,0.20)';
    for (const b of this.bubbles) {
      ctx.beginPath();
      ctx.arc(b.x * w, waterY + b.y * depth, b.r, 0, TAU);
      ctx.fill();
    }

    // うろうろしている魚影
    for (const a of this.ambient) {
      const x = a.x * w;
      const y = waterY + 16 + a.y * (depth - 26) + Math.sin(a.p) * 4;
      this.#fishShadow(x, y, 20 * a.s, a.dir, 'rgba(0,0,0,0.28)', a.p);
    }

    // 底と水草
    ctx.fillStyle = style.ground;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(0, h - 14);
    for (let x = 0; x <= w; x += 40) {
      ctx.lineTo(x, h - 14 - Math.sin(x * 0.03) * 6);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    for (let i = 0; i < style.weed; i++) {
      const x = ((i + 0.5) / style.weed) * w + Math.sin(i * 3) * 20;
      const sway = Math.sin(this.t * 1.4 + i) * 7;
      ctx.strokeStyle = 'rgba(20,60,40,0.5)';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x, h - 12);
      ctx.quadraticCurveTo(x + sway, h - 34, x + sway * 1.8, h - 54);
      ctx.stroke();
    }

    // ファイト中の魚（掛かっている本人）
    if (this.mode === 'fight' && this.fight) {
      const f = this.fight;
      const y = waterY + 34 + f.fishY * (depth - 60);
      const x = this.lure.x + Math.sin(this.t * 3) * 10 + (f.inBar ? -8 : 14);
      const size = 26 + (f.fish?.power || 2) * 5;
      this.#fishShadow(x, y, size, -1, 'rgba(0,0,0,0.45)', this.t * 6);
      // ラインが魚まで伸びている
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(this.lure.x, this.lure.y);
      ctx.lineTo(x + size * 0.4, y);
      ctx.stroke();
    }
  }

  /** 単純な魚のシルエット。dir が 1 なら右向き。 */
  #fishShadow(x, y, size, dir, color, phase = 0) {
    const ctx = this.ctx;
    const tail = Math.sin(phase) * size * 0.16;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(dir >= 0 ? 1 : -1, 1);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(0, 0, size * 0.5, size * 0.24, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-size * 0.42, 0);
    ctx.lineTo(-size * 0.72, -size * 0.2 + tail);
    ctx.lineTo(-size * 0.72, size * 0.2 + tail);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  #drawSurface(pal, waterY) {
    const { ctx, w } = this;
    // 水面のきらめき
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = `rgba(255,255,255,${0.16 - i * 0.04})`;
      ctx.lineWidth = 2 - i * 0.5;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 8) {
        const y = waterY + 6 + i * 9 + Math.sin(x * 0.035 + this.t * (1.4 + i * 0.4)) * (3 - i * 0.6);
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();

    // 水面のふち
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 6) {
      const y = waterY + Math.sin(x * 0.05 + this.t * 1.8) * 1.6;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  /** 水面から顔を出している岩。釣り場の雰囲気づけ。 */
  #drawRocks(style, waterY) {
    if (!style.rocks) return;
    const { ctx, w } = this;
    for (let i = 0; i < style.rocks; i++) {
      const x = w * (0.34 + i * 0.17);
      const s = 10 + ((i * 7) % 3) * 6;
      const y = waterY + 3;                // 水面から頭だけ出す
      ctx.fillStyle = 'rgba(58,60,58,0.9)';
      ctx.beginPath();
      ctx.ellipse(x, y, s, s * 0.7, 0, Math.PI, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.beginPath();
      ctx.ellipse(x - s * 0.3, y - s * 0.34, s * 0.28, s * 0.12, -0.4, 0, TAU);
      ctx.fill();
      // 岩の下流にできる小さな白波
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + s * 0.9, waterY + 4);
      ctx.quadraticCurveTo(x + s * 1.5, waterY + 6 + Math.sin(this.t * 6 + i) * 1.5, x + s * 2.3, waterY + 4);
      ctx.stroke();
    }
  }

  #drawRipples() {
    const ctx = this.ctx;
    for (const r of this.ripples) {
      const a = 1 - r.life / r.dur;
      ctx.strokeStyle = `rgba(255,255,255,${a * 0.5})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, r.r, r.r * 0.3, 0, 0, TAU);
      ctx.stroke();
    }
  }

  #drawDock(style, waterY) {
    const { ctx, h } = this;
    const a = this.anglerPos();
    ctx.fillStyle = style.bank;
    ctx.beginPath();
    ctx.moveTo(0, waterY - 26);
    ctx.lineTo(a.x + 46, waterY - 26);
    ctx.lineTo(a.x + 40, waterY + 6);
    ctx.lineTo(0, waterY + 6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, waterY + 2, a.x + 41, 5);
    // 杭
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(a.x + 24, waterY + 6, 8, Math.min(40, h - waterY - 6));
  }

  #drawAngler() {
    const { ctx } = this;
    const a = this.anglerPos();
    const tip = this.rodTip();
    const bob = Math.sin(this.t * 1.6) * 1.2;
    const lean = this.mode === 'fight' && this.holding ? -3 : 0;

    ctx.save();
    ctx.translate(a.x + lean, a.y + bob);
    ctx.fillStyle = '#22303a';
    // 脚と胴
    ctx.fillRect(-9, -34, 7, 34);
    ctx.fillRect(2, -34, 7, 34);
    ctx.beginPath();
    ctx.roundRect(-12, -62, 24, 32, 8);
    ctx.fill();
    // 頭と帽子
    ctx.beginPath();
    ctx.arc(0, -72, 10, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#c8543f';
    ctx.beginPath();
    ctx.ellipse(0, -80, 15, 5, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, -82, 8, Math.PI, TAU);
    ctx.fill();
    ctx.restore();

    // 竿
    ctx.strokeStyle = '#3a2a20';
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x + 4, a.y - 48);
    const bend = this.mode === 'fight' ? (this.holding ? 26 : 12) : 4;
    ctx.quadraticCurveTo((a.x + tip.x) / 2, (a.y - 58 + tip.y) / 2 + bend, tip.x, tip.y);
    ctx.stroke();
    // リール
    ctx.fillStyle = '#8c99a4';
    ctx.beginPath();
    ctx.arc(a.x + 16, a.y - 44, 5, 0, TAU);
    ctx.fill();
  }

  #drawLine() {
    const { ctx } = this;
    if (this.mode === 'idle') return;
    const tip = this.rodTip();
    const taut = this.mode === 'fight';
    const shiver = taut && this.holding ? Math.sin(this.t * 40) * 2.4 : 0;
    const sag = taut ? 6 : 26;

    ctx.strokeStyle = taut ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.55)';
    ctx.lineWidth = taut ? 1.6 : 1.2;
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.quadraticCurveTo(
      (tip.x + this.lure.x) / 2 + shiver,
      (tip.y + this.lure.y) / 2 + sag,
      this.lure.x, this.lure.y,
    );
    ctx.stroke();

    if (this.mode === 'land' || this.mode === 'fail') return;
    // ウキ
    const y = this.lure.y;
    ctx.fillStyle = '#e94f37';
    ctx.beginPath();
    ctx.arc(this.lure.x, y - 4, 5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#f5f0e6';
    ctx.beginPath();
    ctx.arc(this.lure.x, y - 4, 5, 0, Math.PI);
    ctx.fill();
    ctx.fillStyle = '#2b2b2b';
    ctx.fillRect(this.lure.x - 0.75, y - 14, 1.5, 6);
  }

  #drawLanding() {
    const L = this.landing;
    if (!L || this.mode !== 'land') return;
    const { ctx } = this;
    const fish = L.result.fish;
    ctx.save();
    ctx.translate(L.x, L.y);
    ctx.rotate(L.rot || 0);
    const size = clamp(34 + (L.result.weightKg || 1) * 1.4, 34, 78);
    // 体（色つき）と絵文字を重ねる
    ctx.fillStyle = fish.color || '#7aa';
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.ellipse(0, 0, size * 0.52, size * 0.28, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.font = `${Math.round(size)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(fish.emoji, 0, 0);
    ctx.restore();
  }

  #drawParticles() {
    const ctx = this.ctx;
    for (const p of this.particles) {
      const a = 1 - p.life / p.max;
      if (p.type === 'drop') {
        ctx.fillStyle = `rgba(210,240,255,${a * 0.9})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, TAU);
        ctx.fill();
      } else if (p.type === 'spark') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = `rgba(255,240,170,${a})`;
        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
          const ang = (i / 4) * TAU;
          ctx.lineTo(Math.cos(ang) * p.r * 2.2, Math.sin(ang) * p.r * 2.2);
          ctx.lineTo(Math.cos(ang + TAU / 8) * p.r * 0.7, Math.sin(ang + TAU / 8) * p.r * 0.7);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else if (p.type === 'coin') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.scale(Math.cos(p.rot), 1);   // くるくる回るコイン
        ctx.fillStyle = `rgba(247,201,72,${a})`;
        ctx.beginPath();
        ctx.arc(0, 0, p.r, 0, TAU);
        ctx.fill();
        ctx.fillStyle = `rgba(180,132,20,${a})`;
        ctx.font = `${Math.round(p.r * 1.5)}px system-ui`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('¥', 0, 0);
        ctx.restore();
      } else if (p.type === 'text') {
        ctx.save();
        ctx.globalAlpha = a;
        ctx.font = 'bold 22px "Hiragino Sans","Noto Sans JP",system-ui,sans-serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.strokeText(p.text, p.x, p.y);
        ctx.fillStyle = p.color || '#fff';
        ctx.fillText(p.text, p.x, p.y);
        ctx.restore();
      }
    }
  }

  /**
   * ファイト中のゲージ（画面の右側）。
   * 左＝寄せ具合、まん中＝寄せバーと魚、右＝ラインの負荷。
   * 縦長の画面でも間延びしないように高さに上限をつけている。
   */
  #drawFightGauge() {
    const f = this.fight;
    if (this.mode !== 'fight' || !f) return;
    const { ctx, w, h } = this;

    const gh = Math.min(h * 0.72, 440);
    const gy = Math.round((h - gh) / 2) + 8;
    const gw = clamp(Math.round(w * 0.07), 24, 36);
    const thin = 9;                       // 左右の細いバーの幅
    const gap = 7;
    const strainX = w - 18 - thin;
    const gx = strainX - gap - gw;
    const progressX = gx - gap - thin;
    const label = h > 420;

    const track = (x, width, radius) => {
      ctx.fillStyle = 'rgba(3,14,22,0.78)';
      ctx.beginPath();
      ctx.roundRect(x, gy - 8, width, gh + 16, radius);
      ctx.fill();
    };

    // --- まん中：寄せバーの通り道
    track(gx - 6, gw + 12, 14);
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 1;
    ctx.stroke();

    const barTop = gy + f.barTop * gh;
    const barH = f.barH * gh;
    const grad = ctx.createLinearGradient(0, barTop, 0, barTop + barH);
    const hot = f.inBar;
    grad.addColorStop(0, hot ? '#8ce99a' : '#7f9aa8');
    grad.addColorStop(1, hot ? '#38c172' : '#5d7c8a');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(gx, barTop, gw, barH, 10);
    ctx.fill();
    if (hot) {
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // 魚のアイコン
    const fy = gy + f.fishY * gh;
    ctx.save();
    ctx.translate(gx + gw / 2, fy);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.arc(0, 0, gw * 0.46, 0, TAU);
    ctx.fill();
    ctx.font = `${Math.round(gw * 0.68)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(f.fish?.emoji || '🐟', 0, 0);
    ctx.restore();

    // --- 左：寄せ具合。下から伸びて満タンで釣り上げ
    track(progressX - 3, thin + 6, 7);
    const ph = Math.max(2, f.progress * gh);
    ctx.fillStyle = '#ffd43b';
    ctx.beginPath();
    ctx.roundRect(progressX, gy + gh - ph, thin, ph, 4);
    ctx.fill();

    // --- 右：ラインの負荷。満タンで切れる
    track(strainX - 3, thin + 6, 7);
    if (f.strain > 0.01) {
      const sh = Math.max(2, f.strain * gh);
      const danger = f.strain > 0.65;
      ctx.fillStyle = danger
        ? `rgba(255,${Math.round(90 - f.strain * 60)},80,${0.75 + Math.sin(this.t * 22) * 0.25})`
        : '#ffa94d';
      ctx.beginPath();
      ctx.roundRect(strainX, gy + gh - sh, thin, sh, 4);
      ctx.fill();
    }

    if (label) {
      ctx.font = '10px "Hiragino Sans","Noto Sans JP",system-ui,sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      // 明るい空の上でも読めるように縁取りする
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(3,14,22,0.85)';
      ctx.strokeText('寄せ', progressX + thin / 2, gy - 14);
      ctx.strokeText('負荷', strainX + thin / 2, gy - 14);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillText('寄せ', progressX + thin / 2, gy - 14);
      ctx.fillStyle = f.strain > 0.65 ? '#ff8787' : 'rgba(255,255,255,0.9)';
      ctx.fillText('負荷', strainX + thin / 2, gy - 14);
    }
  }
}
