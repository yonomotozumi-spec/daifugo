/**
 * canvas への描画。マップと戦闘画面の見た目だけを受け持つ。
 * ルールは engine.js / world.js、進行は ui.js。
 */

import { chestsOf, inside, mapHeight, mapWidth, tileAt } from './world.js';
import { drawMonster, shade as shadeHex } from './monsters.js';

/** タイルごとに決まる 0〜1 の値。草の生え方などをマスごとに固定するのに使う。 */
function hash(x, y) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * タイルの下地を 1px だけ はみ出して塗るための ふくらみ。
 * カメラが 小数の位置にいると、ぴったり隣りあわせに塗った四角のあいだに
 * 半透明の すきま（継ぎ目）が出る。右と下へ 少し重ねて 消す。
 * 描く順が 左→右・上→下 なので、はみ出した分は あとから来る隣が 塗りつぶす。
 */
const BLEED = 1;

const COLORS = {
  grass: ['#5ba05a', '#4e9150'],
  forest: '#2f7d43',
  sand: '#d8c79c',
  wood: '#a9713f',
  water: '#2f6fb5',
  mountain: '#6d5c4b',
  snow: '#f1f3f5',
};

/**
 * マスをまたいで なめらかに変わる 0〜1 の値。
 * hash をマスごとに使うと 市松模様に見えてしまうので、
 * 4 マスおきの点を とって そのあいだを つないだ値を使う。
 */
function patch(x, y, scale = 4) {
  const fx = x / scale;
  const fy = y / scale;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const ease = (v) => v * v * (3 - 2 * v);
  const ex = ease(tx);
  const ey = ease(ty);
  const a = hash(ix, iy);
  const b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1);
  const d = hash(ix + 1, iy + 1);
  return (a + (b - a) * ex) * (1 - ey) + (c + (d - c) * ex) * ey;
}

/** 2 色を まぜる。 */
function mix(hexA, hexB, k) {
  const A = parseInt(hexA.slice(1), 16);
  const B = parseInt(hexB.slice(1), 16);
  const ch = (sh) => Math.round((((A >> sh) & 255) * (1 - k)) + (((B >> sh) & 255) * k));
  return `#${[16, 8, 0].map((sh) => ch(sh).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * 立体感のためのタイルの分類。
 * 隣とちがう地面が来たときに 境目をなじませるのに使う（草が道へはみ出す、岸に浅瀬をつける）。
 */
function terrainOf(map, x, y) {
  if (!inside(map, x, y)) return null;
  const ch = tileAt(map, x, y);
  if (ch === '~') return 'water';
  if (ch === '=') return 'water';
  if (ch === '_') return map.kind === 'room' ? 'wood' : 'path';
  if (ch === '.' || ch === '"' || ch === 'T' || ch === 'f' || ch === 'B') return 'grass';
  if (ch === ',' || ch === 'K') return 'stone';
  return 'solid';
}

/** 上に立っていると 下のマスへ 影を落とすもの。 */
const CASTS_SHADOW = new Set(['#', 'T', '"', '^', 'o', 'C', 'K', 'L', 'B', 'w']);

/** 4 方向。[dx, dy] */
const SIDES = [[0, -1], [0, 1], [-1, 0], [1, 0]];

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

  /** マップを移ったときは カメラを 追いかけさせずに 置きなおす。 */
  resetCamera() {
    this.cam = null;
  }

  /**
   * グラデーションを 作りおきする。
   * createLinearGradient は ただの塗りより ずっと重いので、毎フレーム 作りなおさない。
   * 中身は タイルの中の座標で作り、使うときに translate でずらす。
   */
  #gradient(key, make) {
    if (!this.grads) this.grads = new Map();
    let g = this.grads.get(key);
    if (!g) {
      g = make();
      this.grads.set(key, g);
    }
    return g;
  }

  resize() {
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    // 幅は 丸めずに 小数のまま使う。整数に丸めると 画面と描画面の 縮尺が わずかにずれて、
    // 動かしたときに 線が 太くなったり 消えたりする。
    const w = Math.max(240, rect.width || this.canvas.clientWidth || 640);
    const h = Math.max(180, rect.height || this.canvas.clientHeight || 400);
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(this.canvas.width / w, 0, 0, this.canvas.height / h, 0, 0);
    // 画面の広さに合わせて、横 15 マス前後が見える大きさにする（大きくなりすぎないよう頭打ち）。
    this.tile = clamp(Math.round(Math.min(w / 15, h / 10)), 24, 48);
    this.grads = new Map();      // 大きさが変わったので 作りおきは 捨てる
  }

  // -------------------------------------------------------------- マップ

  /**
   * view = { map, party:[{x,y,dir,frame,look,down}], npcs, opened, flash }
   * party の座標は小数（マス単位）で、先頭が主人公。
   */
  drawField(view, dt = 16) {
    this.time += dt;
    const { ctx, tile } = this;
    const { map } = view;
    const hero = view.party[0];
    const cols = mapWidth(map);
    const rows = mapHeight(map);

    // カメラは主人公を中央に。マップが画面より小さいときは中央ぞろえ。
    const heroPx = hero.x * tile;
    const heroPy = hero.y * tile;
    // 暗い洞窟では 端に寄せると明かりが画面外に出てしまうので、いつも主人公を中央に置く。
    const free = (p, size, total) => p + tile / 2 - size / 2;
    const fit = (p, size, total) => (total <= size ? (total - size) / 2 : clamp(free(p, size, total), 0, total - size));
    const targetX = map.dark ? free(heroPx, this.w, cols * tile) : fit(heroPx, this.w, cols * tile);
    const targetY = map.dark ? free(heroPy, this.h, rows * tile) : fit(heroPy, this.h, rows * tile);

    // カメラは 遅れずに ぴったり 主人公に合わせる。
    // 少し遅れて追いかけると 歩き出しが やわらかく見えるが、フレームが 1 枚つまるたびに
    // 主人公だけが 地面に対して すべって もどる（見た目の かくつき）。
    // ぴったり合わせておけば つまったときも 画面全体が 同じだけ止まるので 気になりにくい。
    if (!this.cam) this.cam = { x: targetX, y: targetY };
    this.cam.x = targetX;
    this.cam.y = targetY;

    // カメラは 小数のまま使う。整数に丸めると 世界が 1px ずつ 飛んで かくついて見える。
    // タイルの継ぎ目は 1px ぶん はみ出して塗ることで 埋める（BLEED）。
    const camX = this.cam.x;
    const camY = this.cam.y;

    ctx.fillStyle = map.kind === 'room' ? '#2b2118' : map.dark ? '#05060a' : '#12351f';
    ctx.fillRect(0, 0, this.w, this.h);

    const x0 = Math.floor(camX / tile) - 1;
    const y0 = Math.floor(camY / tile) - 1;
    const x1 = Math.ceil((camX + this.w) / tile) + 1;
    const y1 = Math.ceil((camY + this.h) / tile) + 1;

    // 2 層に分けて描く。地面 →（草や小石を まとめて）→ 地面の上に立つもの。
    // まとめて描くのは 速さのため。草の葉を マスごとに stroke すると
    // 1 画面で 2000 回以上の線引きになり、それだけで 数 ms かかる。
    this.#startDetail();
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        this.#drawGround(map, x, y, x * tile - camX, y * tile - camY);
      }
    }
    this.#flushDetail();
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        this.#drawObject(map, x, y, x * tile - camX, y * tile - camY);
      }
    }

    // 宝箱・立て札
    for (const chest of chestsOf(map, view.opened || [])) {
      this.#drawChest(chest.x * tile - camX, chest.y * tile - camY);
    }
    for (const sign of map.signs || []) {
      this.#drawSign(sign.x * tile - camX, sign.y * tile - camY);
    }

    // 人物は上にいる順に描くと重なりが自然になる。仲間は隊列のうしろから。
    const people = [
      ...(view.npcs || []).map((n) => ({ ...n })),
      ...[...view.party].reverse(),
    ];
    people.sort((a, b) => a.y - b.y);
    for (const p of people) {
      const px = p.x * tile - camX;         // 地面と 同じカメラで置くので 足もとがずれない
      const py = (p.y + (p.bob || 0)) * tile - camY;   // 歩きのはずみは 絵だけに効かせる
      if (p.monster && drawMonster(ctx, p.monster, px + tile / 2, py + tile * 0.5, tile * 1.05, this.time / 1000)) continue;
      if (p.emoji) this.#drawEmoji(p.emoji, px, py, tile * 0.72);
      else this.#drawPerson(px, py, p.look || {}, p.dir || 'down', p.swing || 0, p.small, p.down);
    }

    if (map.dark) this.#drawDarkness(hero.x * tile - camX, hero.y * tile - camY);
    else this.#vignette();
    if (view.flash) {
      ctx.fillStyle = `rgba(255,255,255,${view.flash})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }
  }

  /**
   * 1 まわり目。地面そのもの（不透明に塗りつぶすもの）だけを描く。
   * 草や小石の こまかい模様は その場で描かず、あとで まとめて 1 回に する。
   */
  #drawGround(map, x, y, px, py) {
    const { ctx, tile } = this;
    if (!inside(map, x, y)) {                 // マップの外は のっぺりした闇
      ctx.fillStyle = map.kind === 'room' ? '#1b140e' : map.dark ? '#05060a' : '#0a1a12';
      ctx.fillRect(px, py, tile + BLEED, tile + BLEED);
      return;
    }
    const ch = tileAt(map, x, y);
    const n = hash(x, y);

    switch (ch) {
      case '^':
      case 'C':
        this.#mountain(px, py, n, map, x, y);
        return;
      case '~':
      case '=':
        this.#water(px, py, n, this.time / 1000, map, x, y);
        return;
      case 'L':
        this.#floorPath(px, py, n, map, x, y);
        return;
      case ',':
      case 'K':
        this.#floorStone(px, py, n, map.kind === 'castle');
        return;
      case 'w':
        this.#floorWood(px, py, n);
        return;
      case '_':
      case '+':
        if (map.kind === 'room') this.#floorWood(px, py, n);
        else this.#floorPath(px, py, n, map, x, y);
        return;
      case '.':
      case '"':
      case 'T':
      case 'f':
      case 'B':
        this.#floorGrass(px, py, n, map, x, y);
        return;
      default:
        if (map.kind === 'room') this.#floorWood(px, py, n);
        else if (map.kind === 'cave' || map.kind === 'castle') this.#floorStone(px, py, n, map.kind === 'castle');
        else this.#floorGrass(px, py, n, map, x, y);
    }
  }

  /** 2 まわり目。地面の上に 立っているもの。先に 上のマスから落ちる影を敷く。 */
  #drawObject(map, x, y, px, py) {
    const { ctx, tile } = this;
    if (!inside(map, x, y)) return;
    const ch = tileAt(map, x, y);
    const n = hash(x, y);

    // 上のマスに 木や壁が 立っているなら、この地面に 影が落ちる。
    // 影は 受ける側で描く（上から はみ出させると 下のマスの地面に 消される）。
    if (!CASTS_SHADOW.has(ch) && CASTS_SHADOW.has(tileAt(map, x, y - 1))) this.#castShadow(px, py);

    switch (ch) {
      case '"':
        this.#tree(px, py, n, COLORS.forest);
        break;
      case 'T':
        this.#tree(px, py, n, '#276b39');
        break;
      case 'f':
        for (let i = 0; i < 3; i++) {
          const fx = px + tile * (0.2 + hash(x * 7 + i, y) * 0.6);
          const fy = py + tile * (0.2 + hash(x, y * 7 + i) * 0.6);
          ctx.fillStyle = ['#ffd43b', '#ff8fab', '#e9ecef'][i % 3];
          ctx.beginPath();
          ctx.arc(fx, fy, tile * 0.07, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      case '=':
        this.#bridge(px, py);
        break;
      case '#':
        // 村の建物は 上の段だけ屋根にすると 家らしく見える。
        if (map.kind === 'town' && tileAt(map, x, y - 1) !== '#') this.#roof(px, py);
        else this.#wall(px, py, n, map.kind);
        break;
      case 'L':
        this.#lighthouse(px, py, tileAt(map, x, y - 1) !== 'L');
        break;
      case 'o':
        this.#rock(px, py, n);
        break;
      case 'w':
        this.#counter(px, py);
        break;
      case '+':
        this.#door(px, py);
        break;
      case '<':
      case '>':
        this.#stairs(px, py, ch === '<');
        break;
      case 'B':
        this.#village(px, py);
        break;
      case 'C':
        this.#caveMouth(px, py);
        break;
      case 'K':
        this.#gate(px, py);
        break;
      default:
        break;
    }
  }

  /**
   * 上のマスに 立っているものが 落とす影。受ける側で描く（下のマスは あとから塗るため）。
   * 四角い帯で塗ると 影が 長方形に見えるので、横長の楕円を 少し右にずらして置く。
   */
  #castShadow(px, py) {
    const { ctx, tile } = this;
    for (const [r, a] of [[0.56, 0.13], [0.44, 0.11]]) {
      ctx.fillStyle = `rgba(10,16,12,${a})`;
      ctx.beginPath();
      ctx.ellipse(px + tile * 0.56, py + tile * 0.04, tile * r, tile * (r * 0.42), 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * 草の葉・小石のような こまかい模様の 入れ場所。
   * マスごとに stroke / fill すると 回数が多すぎるので、色ごとに 1 本の Path2D へ
   * ためて、地面を塗りおわってから まとめて 1 回で 描く。
   * どの模様も 自分のマスの中に おさまるので、あとで まとめて描いても はみ出さない。
   */
  #startDetail() {
    this.detail = {
      edgeGrass: new Path2D(),
      edgeFoot: new Path2D(),
      bladeLight: new Path2D(),
      bladeDark: new Path2D(),
      pebbleLight: new Path2D(),
      pebbleDark: new Path2D(),
    };
  }

  #flushDetail() {
    const { ctx, tile } = this;
    const d = this.detail;
    // 境目の草 → 小石 → 草の葉 の順（葉が いちばん上）
    ctx.fillStyle = COLORS.grass[1];
    ctx.fill(d.edgeGrass);
    ctx.fillStyle = mix(COLORS.grass[1], '#33552f', 0.45);
    ctx.fill(d.edgeFoot);
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fill(d.pebbleLight);
    ctx.fillStyle = 'rgba(90,70,44,0.18)';
    ctx.fill(d.pebbleDark);
    ctx.lineWidth = Math.max(1, tile * 0.035);
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(232,255,214,0.16)';
    ctx.stroke(d.bladeLight);
    ctx.strokeStyle = 'rgba(12,40,16,0.14)';
    ctx.stroke(d.bladeDark);
  }

  #floorGrass(px, py, n, map, x, y) {
    const { ctx, tile } = this;
    // 色は なめらかに 移らせる。マスごとに 2 色を切りかえると 市松模様に見える。
    // 平らな地面には 上下の陰影をつけない（マスごとに 横しまが出てしまう）。
    ctx.fillStyle = mix(COLORS.grass[1], COLORS.grass[0], patch(x, y, 4));
    ctx.fillRect(px, py, tile + BLEED, tile + BLEED);

    // 草の葉。同じマスなら いつも同じところに 生える
    const d = this.detail;
    if (!d) return;
    for (let i = 0; i < 4; i++) {
      const h1 = hash(x * 13 + i * 5, y * 7 + i);
      const h2 = hash(x * 5 + i * 3, y * 11 + i * 7);
      const bx = px + tile * (0.1 + h1 * 0.8);
      const by = py + tile * (0.2 + h2 * 0.66);
      const len = tile * (0.09 + h1 * 0.09);
      const lean = (h2 - 0.5) * tile * 0.14;
      const into = i % 2 ? d.bladeLight : d.bladeDark;
      into.moveTo(bx, by + len);
      into.quadraticCurveTo(bx + lean * 0.4, by + len * 0.45, bx + lean, by);
    }
  }

  #floorPath(px, py, n, map, x, y) {
    const { ctx, tile } = this;
    ctx.fillStyle = mix('#cdbb8f', COLORS.sand, patch(x + 40, y + 40, 3));
    ctx.fillRect(px, py, tile + BLEED, tile + BLEED);

    // 小石
    const d = this.detail;
    if (d) {
      for (let i = 0; i < 3; i++) {
        const h1 = hash(x * 17 + i, y * 19 + i * 3);
        const h2 = hash(x * 23 + i * 5, y * 29 + i);
        // 1〜2px の 粒なので 四角で足りる。楕円にすると 曲線を こまかく割るぶん
        // 1 画面ぶんで 数 ms かかってしまう（村は ほとんどが 道のマス）。
        const into = i % 2 ? d.pebbleLight : d.pebbleDark;
        into.rect(
          px + tile * (0.12 + h1 * 0.76),
          py + tile * (0.16 + h2 * 0.68),
          Math.max(1, tile * (0.03 + h1 * 0.04)),
          Math.max(1, tile * (0.025 + h2 * 0.03)),
        );
      }
    }
    // 草が 道へ はみ出す。まっすぐな境目が 消えて 踏みならした道に見える
    if (map) this.#edgeInto(px, py, map, x, y, 'grass', this.detail?.edgeGrass);
  }

  /**
   * 隣のマスの地面を 少しだけ 引きこんで 境目をぼかす。
   * from の地面が となりに来ている辺だけ、color の丸をいくつか はみ出させる。
   * これがないと 草と道・草と山の 境目が 定規で引いたような 直線に見える。
   */
  #edgeInto(px, py, map, x, y, from, into) {
    if (!into) return;
    const { tile } = this;
    for (const [dx, dy] of SIDES) {
      if (terrainOf(map, x + dx, y + dy) !== from) continue;
      for (let i = 0; i < 3; i++) {
        const h = hash(x * 31 + dx * 7 + i, y * 37 + dy * 11 + i);
        const along = tile * (0.16 + i * 0.34);
        const depth = tile * (0.09 + h * 0.11);
        const r = tile * (0.11 + h * 0.06);
        const bx = (dx === 0 ? px + along : px + (dx > 0 ? tile : 0)) + dx * (r * 0.4 - depth);
        const by = (dy === 0 ? py + along : py + (dy > 0 ? tile : 0)) + dy * (r * 0.4 - depth);
        into.moveTo(bx + r, by);
        into.ellipse(bx, by, r, r * 0.8, 0, 0, Math.PI * 2);
        into.closePath();
      }
    }
  }

  #floorWood(px, py, n) {
    const { ctx, tile } = this;
    ctx.fillStyle = n > 0.5 ? '#8a5a33' : '#7d5230';
    ctx.fillRect(px, py, tile + BLEED, tile + BLEED);
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
    ctx.fillRect(px, py, tile + BLEED, tile + BLEED);
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
    ctx.fillRect(px, py, tile + BLEED, tile + BLEED);
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

  /** 灯台。てっぺんのマスには 灯りをともす。 */
  #lighthouse(px, py, top) {
    const { ctx, tile } = this;
    ctx.fillStyle = '#e9ecef';
    ctx.fillRect(px, py, tile + BLEED, tile + BLEED);
    ctx.fillStyle = '#c92a2a';
    ctx.fillRect(px, py + tile * 0.34, tile, tile * 0.16);
    ctx.fillRect(px, py + tile * 0.74, tile, tile * 0.16);
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 0.5, py + 0.5, tile - 1, tile - 1);
    if (top) {
      const glow = 0.55 + 0.45 * Math.sin(this.time / 500);
      ctx.fillStyle = '#343a40';
      ctx.fillRect(px + tile * 0.1, py, tile * 0.8, tile * 0.3);
      ctx.fillStyle = `rgba(255, 224, 130, ${glow})`;
      ctx.beginPath();
      ctx.arc(px + tile / 2, py + tile * 0.14, tile * 0.16, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** 村の家の屋根。 */
  /** 屋根。棟から 手前へ 下る面にして、軒を 少し出す。 */
  #roof(px, py) {
    const { ctx, tile } = this;
    const ridge = py + tile * 0.16;
    const eave = py + tile;
    const over = tile * 0.06;                 // 軒の出

    // むこう側の 面（棟より上）。少し暗くする
    ctx.fillStyle = '#8f3626';
    ctx.fillRect(px - over, py + tile * 0.02, tile + over * 2 + BLEED, tile * 0.14);

    // 手前へ 下る面。上から下へ 明るさが 変わる
    ctx.fillStyle = '#c9553d';
    ctx.fillRect(px - over, ridge, tile + over * 2 + BLEED, tile * 0.5);
    ctx.fillStyle = '#b1442f';
    ctx.fillRect(px - over, ridge + tile * 0.5, tile + over * 2 + BLEED, eave - ridge - tile * 0.5);

    // かわらの すじ
    ctx.strokeStyle = 'rgba(70,20,12,0.28)';
    ctx.lineWidth = Math.max(1, tile * 0.03);
    ctx.beginPath();
    for (let i = 1; i < 4; i++) {
      const ly = ridge + (eave - ridge) * (i / 4);
      ctx.moveTo(px - over, ly);
      ctx.lineTo(px + tile + over, ly);
    }
    ctx.stroke();

    // 棟の 照りかえしと 軒の影
    ctx.fillStyle = 'rgba(255,214,190,0.34)';
    ctx.fillRect(px - over, ridge, tile + over * 2 + BLEED, Math.max(1, tile * 0.045));
    ctx.fillStyle = 'rgba(40,14,10,0.34)';
    ctx.fillRect(px - over, eave - tile * 0.06, tile + over * 2 + BLEED, tile * 0.06 + BLEED);
  }

  /** 木。丸い葉のかたまりを 3 つ重ねて、根もとに 影を落とす。 */
  #tree(px, py, n, color) {
    const { ctx, tile } = this;
    const cx = px + tile / 2;
    const top = py + tile * (0.06 + n * 0.05);

    // 根もとの影
    ctx.fillStyle = 'rgba(12,26,12,0.26)';
    ctx.beginPath();
    ctx.ellipse(cx + tile * 0.07, py + tile * 0.86, tile * 0.3, tile * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();

    // みき
    ctx.fillStyle = '#6b4423';
    ctx.fillRect(cx - tile * 0.06, py + tile * 0.56, tile * 0.12, tile * 0.3);
    ctx.fillStyle = 'rgba(255,236,200,0.16)';
    ctx.fillRect(cx - tile * 0.06, py + tile * 0.56, tile * 0.045, tile * 0.3);

    // 葉。下のかたまりから 順に 明るくして ふくらみを出す
    const lobes = [
      [cx - tile * 0.22, py + tile * 0.56, tile * 0.23, -0.3],
      [cx + tile * 0.22, py + tile * 0.56, tile * 0.23, -0.3],
      [cx, py + tile * 0.44, tile * 0.26, -0.12],
      [cx, top + tile * 0.2, tile * 0.22, 0.1],
    ];
    for (const [lx, ly, r, lift] of lobes) {
      ctx.fillStyle = shadeHex(color, lift);
      ctx.beginPath();
      ctx.arc(lx, ly, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // 下がわの 陰
    ctx.fillStyle = 'rgba(6,26,14,0.22)';
    ctx.beginPath();
    ctx.arc(cx + tile * 0.02, py + tile * 0.56, tile * 0.28, 0.25, Math.PI - 0.25);
    ctx.fill();
    // 日の当たる ふち
    ctx.fillStyle = 'rgba(214,255,190,0.28)';
    ctx.beginPath();
    ctx.arc(cx - tile * 0.06, top + tile * 0.2, tile * 0.2, Math.PI * 1.05, Math.PI * 1.75);
    ctx.fill();
  }

  /** 山。日の当たる面と 陰の面で 岩の かたまりに見せる。 */
  #mountain(px, py, n, map, x, y) {
    const { ctx, tile } = this;
    // 下地は 岩そのものの色。暗い色で埋めると となりの山との あいだが 谷に見えて、
    // 山脈ではなく 三角形の並びに見えてしまう。
    ctx.fillStyle = mix('#5c4d3d', '#6d5c4b', map ? patch(x + 80, y + 80, 3) : n);
    ctx.fillRect(px, py, tile + BLEED, tile + BLEED);
    const peak = py + tile * (0.04 + n * 0.1);
    const cx = px + tile * (0.46 + n * 0.08);

    // 日の当たる 左の面
    ctx.fillStyle = shadeHex(COLORS.mountain, 0.14);
    ctx.beginPath();
    ctx.moveTo(cx, peak);
    ctx.lineTo(cx + tile * 0.06, py + tile + BLEED);
    ctx.lineTo(px - BLEED, py + tile + BLEED);
    ctx.closePath();
    ctx.fill();
    // 陰の 右の面
    ctx.fillStyle = shadeHex(COLORS.mountain, -0.24);
    ctx.beginPath();
    ctx.moveTo(cx, peak);
    ctx.lineTo(px + tile + BLEED, py + tile + BLEED);
    ctx.lineTo(cx + tile * 0.06, py + tile + BLEED);
    ctx.closePath();
    ctx.fill();
    // ふもとの ざらつき
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.fillRect(px, py + tile * 0.88, tile + BLEED, tile * 0.12 + BLEED);
    // 雪
    ctx.fillStyle = COLORS.snow;
    ctx.beginPath();
    ctx.moveTo(cx, peak);
    ctx.lineTo(cx + tile * 0.15, py + tile * 0.36);
    ctx.lineTo(cx + tile * 0.05, py + tile * 0.32);
    ctx.lineTo(cx - tile * 0.04, py + tile * 0.38);
    ctx.lineTo(cx - tile * 0.15, py + tile * 0.34);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(120,140,170,0.35)';
    ctx.beginPath();
    ctx.moveTo(cx, peak);
    ctx.lineTo(cx + tile * 0.15, py + tile * 0.36);
    ctx.lineTo(cx + tile * 0.02, py + tile * 0.34);
    ctx.closePath();
    ctx.fill();
    // ふもとに 草が はいこむ
    if (map) this.#edgeInto(px, py, map, x, y, 'grass', this.detail?.edgeFoot);
  }

  #water(px, py, n, t, map, x, y) {
    const { ctx, tile } = this;
    ctx.fillStyle = '#255c9c';
    ctx.fillRect(px, py, tile + BLEED, tile + BLEED);
    // 深いところは 暗く、水面の上のほうは 空を映して 明るい
    ctx.fillStyle = 'rgba(120,190,255,0.16)';
    ctx.fillRect(px, py, tile + BLEED, tile * 0.34);
    ctx.fillStyle = 'rgba(4,20,44,0.18)';
    ctx.fillRect(px, py + tile * 0.7, tile + BLEED, tile * 0.3 + BLEED);

    // 波の きらめき
    const wave = Math.sin(t * 1.7 + n * 6.28) * tile * 0.14;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1, tile * 0.045);
    ctx.strokeStyle = 'rgba(226,244,255,0.24)';
    ctx.beginPath();
    ctx.moveTo(px + tile * 0.16 + wave, py + tile * 0.3);
    ctx.lineTo(px + tile * 0.42 + wave, py + tile * 0.3);
    ctx.moveTo(px + tile * 0.54 - wave, py + tile * 0.68);
    ctx.lineTo(px + tile * 0.74 - wave, py + tile * 0.68);
    ctx.stroke();

    if (!map) return;
    // 岸。陸に接する辺だけ 浅瀬を明るくして、動く白波をのせる
    for (const [dx, dy] of SIDES) {
      if (terrainOf(map, x + dx, y + dy) === 'water') continue;
      if (!inside(map, x + dx, y + dy)) continue;
      const band = tile * 0.24;
      const sx = dx < 0 ? px : dx > 0 ? px + tile - band : px;
      const sy = dy < 0 ? py : dy > 0 ? py + tile - band : py;
      const w = dx === 0 ? tile + BLEED : band;
      const h = dy === 0 ? tile + BLEED : band;
      ctx.fillStyle = 'rgba(150,215,240,0.3)';
      ctx.fillRect(sx, sy, w, h);
      // 白波。行ったり来たりする
      const surf = 0.5 + 0.5 * Math.sin(t * 1.6 + n * 5);
      ctx.strokeStyle = `rgba(255,255,255,${0.2 + surf * 0.4})`;
      ctx.lineWidth = Math.max(1, tile * 0.05);
      const off = band * (0.5 + surf * 0.4);
      ctx.beginPath();
      if (dy !== 0) {
        const ly = dy < 0 ? py + off : py + tile - off;
        ctx.moveTo(px + tile * 0.1, ly);
        ctx.quadraticCurveTo(px + tile * 0.5, ly + dy * tile * 0.05, px + tile * 0.9, ly);
      } else {
        const lx = dx < 0 ? px + off : px + tile - off;
        ctx.moveTo(lx, py + tile * 0.1);
        ctx.quadraticCurveTo(lx + dx * tile * 0.05, py + tile * 0.5, lx, py + tile * 0.9);
      }
      ctx.stroke();
    }
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

  /** 岩。面を割って 角のある かたまりに見せる。 */
  #rock(px, py, n) {
    const { ctx, tile } = this;
    const cx = px + tile / 2;
    const cy = py + tile * 0.6;

    ctx.fillStyle = 'rgba(10,14,10,0.28)';
    ctx.beginPath();
    ctx.ellipse(cx + tile * 0.06, py + tile * 0.84, tile * 0.32, tile * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();

    // 本体
    ctx.fillStyle = '#8d8377';
    ctx.beginPath();
    ctx.moveTo(cx - tile * 0.36, cy + tile * 0.22);
    ctx.lineTo(cx - tile * 0.3, cy - tile * 0.16);
    ctx.lineTo(cx - tile * (0.06 + n * 0.04), cy - tile * 0.3);
    ctx.lineTo(cx + tile * 0.22, cy - tile * 0.2);
    ctx.lineTo(cx + tile * 0.36, cy + tile * 0.1);
    ctx.lineTo(cx + tile * 0.24, cy + tile * 0.24);
    ctx.closePath();
    ctx.fill();
    // 日の当たる 上の面
    ctx.fillStyle = 'rgba(255,252,240,0.24)';
    ctx.beginPath();
    ctx.moveTo(cx - tile * 0.3, cy - tile * 0.16);
    ctx.lineTo(cx - tile * (0.06 + n * 0.04), cy - tile * 0.3);
    ctx.lineTo(cx + tile * 0.22, cy - tile * 0.2);
    ctx.lineTo(cx + tile * 0.04, cy - tile * 0.06);
    ctx.closePath();
    ctx.fill();
    // 陰の 右の面
    ctx.fillStyle = 'rgba(24,20,26,0.26)';
    ctx.beginPath();
    ctx.moveTo(cx + tile * 0.22, cy - tile * 0.2);
    ctx.lineTo(cx + tile * 0.36, cy + tile * 0.1);
    ctx.lineTo(cx + tile * 0.24, cy + tile * 0.24);
    ctx.lineTo(cx + tile * 0.04, cy - tile * 0.06);
    ctx.closePath();
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
  /**
   * 人。swing は −1〜1 の 歩きの位相（連続した値）。
   * 2 コマの絵を パタパタ切りかえると 1 マス 132ms では 1 秒に 7 回も変わり、
   * 歩きではなく ふるえに見える。手足は なめらかに 振らせる。
   */
  #drawPerson(px, py, look, dir, swing = 0, small = false, down = false) {
    const { ctx, tile } = this;
    const s = tile * (small ? 0.78 : 1);
    const cloth = look.cloth || '#c0392b';
    const hair = look.hair || '#3b2b20';
    const skin = look.skin || '#f6d0a0';
    const side = dir === 'left' ? -1 : 1;

    ctx.save();
    ctx.translate(px + (tile - s) / 2, py + (tile - s));
    if (down) ctx.globalAlpha = 0.45;      // 死んでいる仲間は うすく

    // 足もとの影。ふちを ぼかすと 地面に のって見える
    const shadow = this.#gradient(`person-shadow:${s}`, () => {
      const g = ctx.createRadialGradient(s / 2, s * 0.93, 0, s / 2, s * 0.93, s * 0.3);
      g.addColorStop(0, 'rgba(0,0,0,0.34)');
      g.addColorStop(0.6, 'rgba(0,0,0,0.16)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      return g;
    });
    ctx.save();
    ctx.translate(s / 2, s * 0.93);
    ctx.scale(1, 0.3);
    ctx.translate(-s / 2, -s * 0.93 / 0.3);
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.arc(s / 2, s * 0.93 / 0.3, s * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // あし。左右が 逆向きに 振れる（たてに歩くときは 上下、横に歩くときは 前後）
    const vertical = dir === 'up' || dir === 'down';
    const legTop = s * 0.77;
    // 前に出ている足を あとから描く（手前に来る）
    for (const sign of swing >= 0 ? [-1, 1] : [1, -1]) {
      const a = swing * sign;
      const lx = s * 0.31 + (sign > 0 ? 0 : s * 0.25) + (vertical ? 0 : a * s * 0.07 * side);
      const ly = legTop + (vertical ? Math.max(0, a) * s * 0.05 : 0);
      ctx.fillStyle = sign > 0 ? '#4a443d' : '#3a352f';
      roundRect(ctx, lx, ly, s * 0.14, s * 0.17, s * 0.045);
      ctx.fill();
    }

    // からだ。上が明るく 下へ落ちる
    const body = this.#gradient(`cloth:${cloth}:${s}`, () => {
      const g = ctx.createLinearGradient(0, s * 0.4, 0, s * 0.84);
      g.addColorStop(0, shadeHex(cloth, 0.24));
      g.addColorStop(0.45, cloth);
      g.addColorStop(1, shadeHex(cloth, -0.34));
      return g;
    });
    ctx.fillStyle = body;
    roundRect(ctx, s * 0.24, s * 0.42, s * 0.52, s * 0.4, s * 0.1);
    ctx.fill();
    ctx.strokeStyle = 'rgba(18,16,26,0.4)';
    ctx.lineWidth = Math.max(1, s * 0.022);
    ctx.stroke();

    // うで。足と 逆に 振る
    if (!vertical) {
      ctx.fillStyle = shadeHex(cloth, -0.2);
      const ax = s * (side > 0 ? 0.66 : 0.2) - swing * s * 0.05 * side;
      roundRect(ctx, ax, s * 0.5 + Math.abs(swing) * s * 0.02, s * 0.14, s * 0.2, s * 0.05);
      ctx.fill();
    }

    if (look.hero) {
      ctx.fillStyle = '#ffd43b';                    // こしのベルト
      ctx.fillRect(s * 0.24, s * 0.66, s * 0.52, s * 0.07);
      if (dir === 'right' || dir === 'down') {
        const blade = this.#gradient(`blade:${s}`, () => {
          const g = ctx.createLinearGradient(s * 0.78, 0, s * 0.85, 0);
          g.addColorStop(0, '#9aa4b2');
          g.addColorStop(0.5, '#f1f5f9');
          g.addColorStop(1, '#7d8796');
          return g;
        });
        ctx.fillStyle = blade;
        ctx.fillRect(s * 0.78, s * 0.34, s * 0.07, s * 0.36);
        ctx.fillStyle = '#7a5230';
        ctx.fillRect(s * 0.77, s * 0.66, s * 0.09, s * 0.06);
      }
    }

    // かお
    const face = this.#gradient(`skin:${skin}:${s}`, () => {
      const g = ctx.createRadialGradient(s * 0.43, s * 0.28, 0, s / 2, s * 0.34, s * 0.24);
      g.addColorStop(0, shadeHex(skin, 0.2));
      g.addColorStop(0.6, skin);
      g.addColorStop(1, shadeHex(skin, -0.22));
      return g;
    });
    ctx.fillStyle = face;
    ctx.beginPath();
    ctx.arc(s / 2, s * 0.34, s * 0.21, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(18,16,26,0.34)';
    ctx.lineWidth = Math.max(1, s * 0.02);
    ctx.stroke();

    // かみ
    ctx.fillStyle = hair;
    ctx.beginPath();
    ctx.arc(s / 2, s * 0.315, s * 0.22, Math.PI * 0.98, Math.PI * 2.02);
    ctx.fill();
    if (dir === 'up') ctx.fillRect(s * 0.28, s * 0.3, s * 0.44, s * 0.14);
    ctx.fillStyle = shadeHex(hair, 0.32);          // かみの てりかえし
    ctx.beginPath();
    ctx.ellipse(s * 0.42, s * 0.19, s * 0.07, s * 0.03, -0.4, 0, Math.PI * 2);
    ctx.fill();

    // め
    ctx.fillStyle = '#2b2b2b';
    const eye = s * 0.045;
    if (dir === 'down') {
      ctx.fillRect(s * 0.41, s * 0.36, eye, eye * 1.6);
      ctx.fillRect(s * 0.55, s * 0.36, eye, eye * 1.6);
    } else if (dir === 'left') {
      ctx.fillRect(s * 0.34, s * 0.36, eye, eye * 1.6);
    } else if (dir === 'right') {
      ctx.fillRect(s * 0.61, s * 0.36, eye, eye * 1.6);
    }
    ctx.restore();
  }

  /** 画面の四すみを ほんのり落とす。中央に 目が向いて 絵が締まる。 */
  #vignette() {
    const { ctx } = this;
    const g = this.#gradient(`vignette:${Math.round(this.w)}x${Math.round(this.h)}`, () => {
      const r = Math.hypot(this.w, this.h) / 2;
      const grad = ctx.createRadialGradient(this.w / 2, this.h / 2, r * 0.45, this.w / 2, this.h / 2, r);
      grad.addColorStop(0, 'rgba(6,10,18,0)');
      grad.addColorStop(1, 'rgba(6,10,18,0.34)');
      return grad;
    });
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
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

    // 足もとの影。ふちを ぼかすと 地面に のっているように見える。
    ctx.save();
    ctx.translate(w / 2, h * 0.66);
    ctx.scale(1, 0.25);
    const shadow = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 0.42);
    shadow.addColorStop(0, 'rgba(0,0,0,0.42)');
    shadow.addColorStop(0.6, 'rgba(0,0,0,0.22)');
    shadow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    if (view.dead) ctx.translate(0, view.dead * h * 0.12);
    const drawn = drawMonster(ctx, view.monster.id, cx, cy, size * 1.34, t, {
      flash: view.flash,
      fade: view.dead,
    });
    if (!drawn) {                       // 絵の用意がない魔物は 絵文字でしのぐ
      ctx.globalAlpha = Math.max(0, 1 - (view.dead || 0));
      ctx.font = `${Math.round(size)}px "Segoe UI Emoji","Apple Color Emoji",sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(view.monster.emoji, cx, cy);
    }
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
