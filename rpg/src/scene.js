/**
 * canvas への描画。マップと戦闘画面の見た目だけを受け持つ。
 * ルールは engine.js / world.js、進行は ui.js。
 */

import { chestsOf, inside, mapHeight, mapWidth, tileAt } from './world.js';

/** タイルごとに決まる 0〜1 の値。草の生え方などをマスごとに固定するのに使う。 */
function hash(x, y) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const COLORS = {
  grass: ['#5ba05a', '#4e9150'],
  forest: '#2f7d43',
  sand: '#d8c79c',
  wood: '#a9713f',
  water: '#2f6fb5',
  mountain: '#6d5c4b',
  snow: '#f1f3f5',
};

const roundRect = (ctx, x, y, w, h, r) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

export class Scene {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.tile = 32;
    this.time = 0;
    this.resize();
  }

  resize() {
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(240, Math.round(rect.width || this.canvas.clientWidth || 640));
    const h = Math.max(180, Math.round(rect.height || this.canvas.clientHeight || 400));
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    // 画面の広さに合わせて、横 15 マス前後が見える大きさにする（大きくなりすぎないよう頭打ち）。
    this.tile = clamp(Math.round(Math.min(w / 15, h / 10)), 24, 48);
  }

  // -------------------------------------------------------------- マップ

  /**
   * view = { map, hero:{x,y,dir,ox,oy,frame}, npcs, opened, flash }
   * ox / oy は移動中のずれ（-1〜1 マス）。
   */
  drawField(view, dt = 16) {
    this.time += dt;
    const { ctx, tile } = this;
    const { map, hero } = view;
    const cols = mapWidth(map);
    const rows = mapHeight(map);

    // カメラは主人公を中央に。マップが画面より小さいときは中央ぞろえ。
    const heroPx = (hero.x + hero.ox) * tile;
    const heroPy = (hero.y + hero.oy) * tile;
    // 暗い洞窟では 端に寄せると明かりが画面外に出てしまうので、いつも主人公を中央に置く。
    const free = (p, size, total) => p + tile / 2 - size / 2;
    const fit = (p, size, total) => (total <= size ? (total - size) / 2 : clamp(free(p, size, total), 0, total - size));
    const camX = map.dark ? free(heroPx, this.w, cols * tile) : fit(heroPx, this.w, cols * tile);
    const camY = map.dark ? free(heroPy, this.h, rows * tile) : fit(heroPy, this.h, rows * tile);
    this.cam = { x: camX, y: camY };

    ctx.fillStyle = map.kind === 'room' ? '#2b2118' : map.dark ? '#05060a' : '#12351f';
    ctx.fillRect(0, 0, this.w, this.h);

    const x0 = Math.floor(camX / tile) - 1;
    const y0 = Math.floor(camY / tile) - 1;
    const x1 = Math.ceil((camX + this.w) / tile) + 1;
    const y1 = Math.ceil((camY + this.h) / tile) + 1;

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = Math.round(x * tile - camX);
        const py = Math.round(y * tile - camY);
        this.#drawTile(map, x, y, px, py);
      }
    }

    // 宝箱・立て札
    for (const chest of chestsOf(map, view.opened || [])) {
      this.#drawChest(Math.round(chest.x * tile - camX), Math.round(chest.y * tile - camY));
    }
    for (const sign of map.signs || []) {
      this.#drawSign(Math.round(sign.x * tile - camX), Math.round(sign.y * tile - camY));
    }

    // 人物は上から順に描くと重なりが自然になる
    const people = [...(view.npcs || []).map((n) => ({ ...n, py: n.y })), { hero: true, ...hero, py: hero.y + hero.oy }];
    people.sort((a, b) => a.py - b.py);
    for (const p of people) {
      const px = Math.round(((p.hero ? p.x + p.ox : p.x) * tile) - camX);
      const py = Math.round(((p.hero ? p.y + p.oy : p.y) * tile) - camY);
      if (p.emoji) this.#drawEmoji(p.emoji, px, py, tile * 0.72);
      else this.#drawPerson(px, py, p.hero ? { cloth: '#3f8bff', hair: '#f6b93b', hero: true } : p.look || {}, p.dir || 'down', p.frame || 0, p.small);
    }

    if (map.dark) this.#drawDarkness(Math.round((hero.x + hero.ox) * tile - camX), Math.round((hero.y + hero.oy) * tile - camY));
    if (view.flash) {
      ctx.fillStyle = `rgba(255,255,255,${view.flash})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }
  }

  #drawTile(map, x, y, px, py) {
    const { ctx, tile } = this;
    if (!inside(map, x, y)) {                 // マップの外は のっぺりした闇
      ctx.fillStyle = map.kind === 'room' ? '#1b140e' : map.dark ? '#05060a' : '#0a1a12';
      ctx.fillRect(px, py, tile, tile);
      return;
    }
    const ch = tileAt(map, x, y);
    const n = hash(x, y);
    const t = this.time / 1000;

    const ground = () => {
      if (map.kind === 'room') { this.#floorWood(px, py, n); return; }
      if (map.kind === 'cave' || map.kind === 'castle') { this.#floorStone(px, py, n, map.kind === 'castle'); return; }
      this.#floorGrass(px, py, n);
    };

    switch (ch) {
      case '.':
        this.#floorGrass(px, py, n);
        break;
      case '"':
        this.#floorGrass(px, py, n);
        this.#tree(px, py, n, COLORS.forest);
        break;
      case 'T':
        this.#floorGrass(px, py, n);
        this.#tree(px, py, n, '#276b39');
        break;
      case 'f':
        this.#floorGrass(px, py, n);
        for (let i = 0; i < 3; i++) {
          const fx = px + tile * (0.2 + hash(x * 7 + i, y) * 0.6);
          const fy = py + tile * (0.2 + hash(x, y * 7 + i) * 0.6);
          ctx.fillStyle = ['#ffd43b', '#ff8fab', '#e9ecef'][i % 3];
          ctx.beginPath();
          ctx.arc(fx, fy, tile * 0.07, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      case ',':
        map.kind === 'castle' ? this.#floorStone(px, py, n, true) : this.#floorStone(px, py, n, false);
        break;
      case '_':
        map.kind === 'room' ? this.#floorWood(px, py, n) : this.#floorPath(px, py, n);
        break;
      case '^':
        this.#mountain(px, py, n);
        break;
      case '~':
        this.#water(px, py, n, t);
        break;
      case '=':
        this.#water(px, py, n, t);
        this.#bridge(px, py);
        break;
      case '#':
        ground();
        // 村の建物は 上の段だけ屋根にすると 家らしく見える。
        if (map.kind === 'town' && tileAt(map, x, y - 1) !== '#') this.#roof(px, py);
        else this.#wall(px, py, n, map.kind);
        break;
      case 'o':
        ground();
        this.#rock(px, py, n);
        break;
      case 'w':
        this.#floorWood(px, py, n);
        this.#counter(px, py);
        break;
      case '+':
        map.kind === 'room' ? this.#floorWood(px, py, n) : this.#floorPath(px, py, n);
        this.#door(px, py);
        break;
      case '<':
      case '>':
        ground();
        this.#stairs(px, py, ch === '<');
        break;
      case 'B':
        this.#floorGrass(px, py, n);
        this.#village(px, py);
        break;
      case 'C':
        this.#mountain(px, py, n);
        this.#caveMouth(px, py);
        break;
      case 'K':
        this.#floorStone(px, py, n, true);
        this.#gate(px, py);
        break;
      default:
        ground();
    }
  }

  #floorGrass(px, py, n) {
    const { ctx, tile } = this;
    ctx.fillStyle = n > 0.5 ? COLORS.grass[0] : COLORS.grass[1];
    ctx.fillRect(px, py, tile, tile);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    const gx = px + tile * (0.15 + n * 0.6);
    const gy = py + tile * (0.2 + (1 - n) * 0.6);
    ctx.fillRect(gx, gy, Math.max(1, tile * 0.09), Math.max(1, tile * 0.16));
  }

  #floorPath(px, py, n) {
    const { ctx, tile } = this;
    ctx.fillStyle = n > 0.5 ? COLORS.sand : '#cdbb8f';
    ctx.fillRect(px, py, tile, tile);
    ctx.fillStyle = 'rgba(0,0,0,0.06)';
    ctx.fillRect(px + tile * n * 0.6, py + tile * (1 - n) * 0.6, tile * 0.16, tile * 0.1);
  }

  #floorWood(px, py, n) {
    const { ctx, tile } = this;
    ctx.fillStyle = n > 0.5 ? '#8a5a33' : '#7d5230';
    ctx.fillRect(px, py, tile, tile);
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, py + tile - 0.5);
    ctx.lineTo(px + tile, py + tile - 0.5);
    ctx.stroke();
  }

  #floorStone(px, py, n, castle) {
    const { ctx, tile } = this;
    ctx.fillStyle = castle ? (n > 0.5 ? '#5f5279' : '#584b71') : n > 0.5 ? '#6f6558' : '#665c50';
    ctx.fillRect(px, py, tile, tile);
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 0.5, py + 0.5, tile - 1, tile - 1);
    if (n > 0.82) {
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fillRect(px + tile * 0.3, py + tile * 0.4, tile * 0.2, tile * 0.12);
    }
  }

  #wall(px, py, n, kind) {
    const { ctx, tile } = this;
    ctx.fillStyle = kind === 'castle' ? '#241c33' : kind === 'cave' ? '#2b251d' : '#7c6a58';
    ctx.fillRect(px, py, tile, tile);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(px, py, tile, tile * 0.12);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    const half = tile / 2;
    ctx.beginPath();
    ctx.moveTo(px, py + half);
    ctx.lineTo(px + tile, py + half);
    ctx.moveTo(px + (n > 0.5 ? half : 0), py);
    ctx.lineTo(px + (n > 0.5 ? half : 0), py + half);
    ctx.moveTo(px + (n > 0.5 ? 0 : half), py + half);
    ctx.lineTo(px + (n > 0.5 ? 0 : half), py + tile);
    ctx.stroke();
  }

  /** 村の家の屋根。 */
  #roof(px, py) {
    const { ctx, tile } = this;
    ctx.fillStyle = '#b1442f';
    ctx.fillRect(px, py + tile * 0.18, tile, tile * 0.82);
    ctx.fillStyle = '#c9553d';
    ctx.beginPath();
    ctx.moveTo(px - 1, py + tile * 0.24);
    ctx.lineTo(px + tile + 1, py + tile * 0.24);
    ctx.lineTo(px + tile + 1, py + tile * 0.05);
    ctx.lineTo(px - 1, py + tile * 0.05);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(px, py + tile * (0.24 + i * 0.26));
      ctx.lineTo(px + tile, py + tile * (0.24 + i * 0.26));
      ctx.stroke();
    }
  }

  #tree(px, py, n, color) {
    const { ctx, tile } = this;
    const cx = px + tile / 2;
    ctx.fillStyle = '#6b4423';
    ctx.fillRect(cx - tile * 0.06, py + tile * 0.55, tile * 0.12, tile * 0.3);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx, py + tile * (0.05 + n * 0.05));
    ctx.lineTo(cx + tile * 0.4, py + tile * 0.65);
    ctx.lineTo(cx - tile * 0.4, py + tile * 0.65);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.moveTo(cx, py + tile * 0.1);
    ctx.lineTo(cx + tile * 0.16, py + tile * 0.5);
    ctx.lineTo(cx - tile * 0.02, py + tile * 0.5);
    ctx.closePath();
    ctx.fill();
  }

  #mountain(px, py, n) {
    const { ctx, tile } = this;
    ctx.fillStyle = '#4f4335';
    ctx.fillRect(px, py, tile, tile);
    ctx.fillStyle = COLORS.mountain;
    ctx.beginPath();
    ctx.moveTo(px + tile * 0.5, py + tile * (0.05 + n * 0.1));
    ctx.lineTo(px + tile * 1.02, py + tile);
    ctx.lineTo(px - tile * 0.02, py + tile);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = COLORS.snow;
    ctx.beginPath();
    ctx.moveTo(px + tile * 0.5, py + tile * (0.05 + n * 0.1));
    ctx.lineTo(px + tile * 0.66, py + tile * 0.38);
    ctx.lineTo(px + tile * 0.34, py + tile * 0.38);
    ctx.closePath();
    ctx.fill();
  }

  #water(px, py, n, t) {
    const { ctx, tile } = this;
    ctx.fillStyle = COLORS.water;
    ctx.fillRect(px, py, tile, tile);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    const wave = Math.sin(t * 2 + n * 6.28) * tile * 0.12;
    ctx.fillRect(px + tile * 0.15 + wave, py + tile * 0.3, tile * 0.3, Math.max(1, tile * 0.06));
    ctx.fillRect(px + tile * 0.5 - wave, py + tile * 0.66, tile * 0.25, Math.max(1, tile * 0.06));
  }

  #bridge(px, py) {
    const { ctx, tile } = this;
    ctx.fillStyle = COLORS.wood;
    ctx.fillRect(px, py + tile * 0.12, tile, tile * 0.76);
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(px + (tile * i) / 4, py + tile * 0.12);
      ctx.lineTo(px + (tile * i) / 4, py + tile * 0.88);
      ctx.stroke();
    }
  }

  #rock(px, py, n) {
    const { ctx, tile } = this;
    ctx.fillStyle = '#8d8377';
    ctx.beginPath();
    ctx.ellipse(px + tile / 2, py + tile * 0.6, tile * 0.36, tile * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.ellipse(px + tile * (0.4 + n * 0.05), py + tile * 0.48, tile * 0.16, tile * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  #counter(px, py) {
    const { ctx, tile } = this;
    ctx.fillStyle = '#c08b4e';
    ctx.fillRect(px, py + tile * 0.2, tile, tile * 0.6);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(px, py + tile * 0.7, tile, tile * 0.1);
  }

  #door(px, py) {
    const { ctx, tile } = this;
    ctx.fillStyle = '#3a2a1c';
    roundRect(ctx, px + tile * 0.14, py + tile * 0.16, tile * 0.72, tile * 0.84, tile * 0.3);
    ctx.fill();
    ctx.fillStyle = '#c8973f';
    ctx.beginPath();
    ctx.arc(px + tile * 0.7, py + tile * 0.6, tile * 0.06, 0, Math.PI * 2);
    ctx.fill();
  }

  #stairs(px, py, up) {
    const { ctx, tile } = this;
    ctx.fillStyle = up ? '#b9b2a5' : '#2b2a33';
    ctx.fillRect(px + tile * 0.1, py + tile * 0.1, tile * 0.8, tile * 0.8);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (let i = 0; i < 3; i++) {
      ctx.fillRect(px + tile * 0.1, py + tile * (0.25 + i * 0.22), tile * (0.8 - i * 0.2), tile * 0.08);
    }
  }

  #village(px, py) {
    const { ctx, tile } = this;
    ctx.fillStyle = '#e0e0e0';
    ctx.fillRect(px + tile * 0.2, py + tile * 0.45, tile * 0.6, tile * 0.4);
    ctx.fillStyle = '#c0392b';
    ctx.beginPath();
    ctx.moveTo(px + tile * 0.5, py + tile * 0.15);
    ctx.lineTo(px + tile * 0.92, py + tile * 0.5);
    ctx.lineTo(px + tile * 0.08, py + tile * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#6b4423';
    ctx.fillRect(px + tile * 0.42, py + tile * 0.6, tile * 0.16, tile * 0.25);
  }

  #caveMouth(px, py) {
    const { ctx, tile } = this;
    ctx.fillStyle = '#12100e';
    ctx.beginPath();
    ctx.ellipse(px + tile / 2, py + tile * 0.68, tile * 0.32, tile * 0.3, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(px + tile * 0.18, py + tile * 0.68, tile * 0.64, tile * 0.2);
  }

  #gate(px, py) {
    const { ctx, tile } = this;
    ctx.fillStyle = '#2b2438';
    ctx.fillRect(px + tile * 0.08, py + tile * 0.1, tile * 0.84, tile * 0.8);
    ctx.fillStyle = '#1a1523';
    ctx.beginPath();
    ctx.ellipse(px + tile / 2, py + tile * 0.62, tile * 0.26, tile * 0.36, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(px + tile * 0.24, py + tile * 0.62, tile * 0.52, tile * 0.28);
    ctx.fillStyle = '#ff6b6b';
    ctx.beginPath();
    ctx.arc(px + tile * 0.5, py + tile * 0.22, tile * 0.06, 0, Math.PI * 2);
    ctx.fill();
  }

  #drawChest(px, py) {
    const { ctx, tile } = this;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(px + tile / 2, py + tile * 0.86, tile * 0.3, tile * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#b5761f';
    roundRect(ctx, px + tile * 0.16, py + tile * 0.34, tile * 0.68, tile * 0.48, tile * 0.08);
    ctx.fill();
    ctx.fillStyle = '#8a5513';
    ctx.fillRect(px + tile * 0.16, py + tile * 0.52, tile * 0.68, tile * 0.08);
    ctx.fillStyle = '#ffd43b';
    ctx.fillRect(px + tile * 0.45, py + tile * 0.48, tile * 0.1, tile * 0.16);
  }

  #drawSign(px, py) {
    const { ctx, tile } = this;
    ctx.fillStyle = '#6b4423';
    ctx.fillRect(px + tile * 0.45, py + tile * 0.45, tile * 0.1, tile * 0.4);
    ctx.fillStyle = '#c9a227';
    roundRect(ctx, px + tile * 0.18, py + tile * 0.2, tile * 0.64, tile * 0.34, tile * 0.06);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(px + tile * 0.26, py + tile * 0.3, tile * 0.48, tile * 0.04);
    ctx.fillRect(px + tile * 0.26, py + tile * 0.4, tile * 0.34, tile * 0.04);
  }

  #drawEmoji(emoji, px, py, size) {
    const { ctx, tile } = this;
    ctx.font = `${Math.round(size)}px "Segoe UI Emoji","Apple Color Emoji",sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, px + tile / 2, py + tile * 0.55);
  }

  /** ドット絵ふうの人物。dir と frame で向きと歩きを変える。 */
  #drawPerson(px, py, look, dir, frame, small = false) {
    const { ctx, tile } = this;
    const s = tile * (small ? 0.78 : 1);
    const ox = px + (tile - s) / 2;
    const oy = py + (tile - s);
    const cloth = look.cloth || '#c0392b';
    const hair = look.hair || '#3b2b20';
    const skin = look.skin || '#f6d0a0';

    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(ox + s / 2, oy + s * 0.93, s * 0.28, s * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();

    // あし（歩くと交互に出る）
    const step = frame % 2 === 0 ? 1 : -1;
    ctx.fillStyle = '#3f3a35';
    ctx.fillRect(ox + s * 0.3, oy + s * 0.78 + (step > 0 ? 0 : s * 0.04), s * 0.14, s * 0.14);
    ctx.fillRect(ox + s * 0.56, oy + s * 0.78 + (step > 0 ? s * 0.04 : 0), s * 0.14, s * 0.14);

    // からだ
    ctx.fillStyle = cloth;
    roundRect(ctx, ox + s * 0.24, oy + s * 0.42, s * 0.52, s * 0.4, s * 0.1);
    ctx.fill();
    if (look.hero) {
      ctx.fillStyle = '#ffd43b';
      ctx.fillRect(ox + s * 0.24, oy + s * 0.66, s * 0.52, s * 0.07);
      if (dir === 'right' || dir === 'down') {
        ctx.fillStyle = '#dfe6e9';                 // つるぎ
        ctx.fillRect(ox + s * 0.78, oy + s * 0.36, s * 0.06, s * 0.34);
      }
    }

    // かお
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(ox + s / 2, oy + s * 0.34, s * 0.21, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = hair;
    ctx.beginPath();
    ctx.arc(ox + s / 2, oy + s * 0.31, s * 0.22, Math.PI, Math.PI * 2);
    ctx.fill();
    if (dir === 'up') {
      ctx.fillRect(ox + s * 0.28, oy + s * 0.28, s * 0.44, s * 0.14);
    }

    ctx.fillStyle = '#2b2b2b';
    const eye = s * 0.045;
    if (dir === 'down') {
      ctx.fillRect(ox + s * 0.41, oy + s * 0.36, eye, eye * 1.6);
      ctx.fillRect(ox + s * 0.55, oy + s * 0.36, eye, eye * 1.6);
    } else if (dir === 'left') {
      ctx.fillRect(ox + s * 0.34, oy + s * 0.36, eye, eye * 1.6);
    } else if (dir === 'right') {
      ctx.fillRect(ox + s * 0.61, oy + s * 0.36, eye, eye * 1.6);
    }
  }

  /** 洞窟の暗闇。たいまつの明かりぶんだけ見える。 */
  #drawDarkness(px, py) {
    const { ctx, tile } = this;
    const cx = px + tile / 2;
    const cy = py + tile / 2;
    const r = tile * 3.4;
    const g = ctx.createRadialGradient(cx, cy, tile * 0.7, cx, cy, r);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.55)');
    g.addColorStop(1, 'rgba(0,0,0,0.96)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.fillStyle = 'rgba(0,0,0,0.96)';
    ctx.fillRect(0, 0, this.w, Math.max(0, cy - r));
    ctx.fillRect(0, cy + r, this.w, Math.max(0, this.h - cy - r));
    ctx.fillRect(0, 0, Math.max(0, cx - r), this.h);
    ctx.fillRect(cx + r, 0, Math.max(0, this.w - cx - r), this.h);
  }

  // -------------------------------------------------------------- 戦闘

  /**
   * view = { monster, hp, maxHp, kind, shake, flash, fade, dead }
   */
  drawBattle(view, dt = 16) {
    this.time += dt;
    const { ctx } = this;
    const t = this.time / 1000;
    const w = this.w;
    const h = this.h;

    const sky = ctx.createLinearGradient(0, 0, 0, h);
    if (view.kind === 'castle') { sky.addColorStop(0, '#2b1035'); sky.addColorStop(1, '#0d0512'); }
    else if (view.kind === 'cave') { sky.addColorStop(0, '#16130f'); sky.addColorStop(1, '#050403'); }
    else { sky.addColorStop(0, '#132a52'); sky.addColorStop(1, '#040a16'); }
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // 地面
    ctx.fillStyle = view.kind === 'castle' ? '#241a2e' : view.kind === 'cave' ? '#1a1712' : '#123021';
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.92, w * 0.62, h * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();

    if (view.kind !== 'cave') {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      for (let i = 0; i < 26; i++) {
        const sx = ((i * 97) % 100) / 100 * w;
        const sy = ((i * 53) % 60) / 100 * h;
        const tw = 0.5 + 0.5 * Math.sin(t * 2 + i);
        ctx.globalAlpha = 0.25 + tw * 0.5;
        ctx.fillRect(sx, sy, 2, 2);
      }
      ctx.globalAlpha = 1;
    }

    const shake = view.shake ? Math.sin(t * 60) * view.shake : 0;
    const bob = Math.sin(t * 2.2) * this.h * 0.012;
    const size = Math.min(w * 0.3, h * 0.38) * (view.big ? 1.25 : 1);
    const cx = w / 2 + shake;
    const cy = h * 0.44 + bob;

    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.66, size * 0.4, size * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    if (view.dead) { ctx.globalAlpha = Math.max(0, 1 - view.dead); ctx.translate(0, view.dead * h * 0.1); }
    ctx.font = `${Math.round(size)}px "Segoe UI Emoji","Apple Color Emoji",sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (view.flash) {
      ctx.shadowColor = '#fff';
      ctx.shadowBlur = 30 * view.flash;
    }
    ctx.fillText(view.monster.emoji, cx, cy);
    ctx.restore();

    if (view.flash) {
      ctx.fillStyle = `rgba(255,80,80,${0.28 * view.flash})`;
      ctx.fillRect(0, 0, w, h);
    }
    if (view.fade) {
      ctx.fillStyle = `rgba(0,0,0,${view.fade})`;
      ctx.fillRect(0, 0, w, h);
    }
  }
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
