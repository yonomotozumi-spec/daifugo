/**
 * 魔物の絵。canvas に 立体感のある 描きこみで 描く。
 *
 * 描きかたの決まり:
 *   ・光は いつも 左上から。丸みは グラデーションで出す（平らな塗りにしない）
 *   ・地面に近いほど 暗く落とす（環境遮蔽）。右下の内がわには 照り返しを のせる
 *   ・肌には 細かい きめ を散らす。輪郭は 細く 半透明にして 絵から浮かせない
 *   ・目は 虹彩の放射グラデ＋濃いふち＋まぶたの影。ハイライトは ぼかしと点の 2 つ
 *   ・待機モーションは 呼吸（たて方向の伸び縮み）＋ 部位ごとの揺れ
 *
 * ART[id] が その魔物の「型（paint）と色」。engine.js の MONSTERS と ID をそろえる。
 */

const TAU = Math.PI * 2;

/** #rrggbb を 明るく／暗くする。 */
export function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const next = amount >= 0 ? v + (255 - v) * amount : v * (1 + amount);
    return Math.max(0, Math.min(255, Math.round(next)));
  });
  return `#${ch.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** #rrggbb を 半透明にする。 */
export function fade(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** 0〜1 の でたらめな値。番号が同じなら いつも同じ値になる（きめが ちらつかない）。 */
function grain(i) {
  const v = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
}

/**
 * 立体的な塗り。path を描く関数と、その大まかな囲みを渡す。
 * 下地のグラデーション → 足もとの陰り → きめ → つや → ふちの照り返し → 細い輪郭。
 */
function cel(ctx, pathFn, box, color, { lineWidth, shadeAt = 0.56, gloss = true, outline = true, grainy = true } = {}) {
  const lw = lineWidth || 1;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const reach = Math.max(box.w, box.h);
  const lightX = box.x + box.w * 0.33;
  const lightY = box.y + box.h * 0.22;

  ctx.save();
  pathFn();
  ctx.save();
  ctx.clip();

  // 下地。左上が いちばん明るく、遠ざかるほど 落ちる
  const body = ctx.createRadialGradient(lightX, lightY, reach * 0.04, cx, cy + box.h * 0.14, reach * 0.98);
  body.addColorStop(0, shade(color, 0.3));
  body.addColorStop(0.34, shade(color, 0.06));
  body.addColorStop(0.68, shade(color, -0.1));
  body.addColorStop(0.9, shade(color, -0.44));
  body.addColorStop(1, shade(color, -0.24));   // ふちは 空の光を 拾って わずかに戻す
  ctx.fillStyle = body;
  ctx.fillRect(box.x - box.w, box.y - box.h, box.w * 3, box.h * 3);

  // 足もとに向かう 陰り
  const ao = ctx.createLinearGradient(0, box.y + box.h * shadeAt, 0, box.y + box.h * 1.04);
  ao.addColorStop(0, 'rgba(10,6,18,0)');
  ao.addColorStop(1, 'rgba(10,6,18,0.4)');
  ctx.fillStyle = ao;
  ctx.fillRect(box.x - box.w, box.y + box.h * shadeAt, box.w * 3, box.h * 1.6);

  // きめ。形が同じなら 同じところに出る
  if (grainy && reach > 12) {
    for (let i = 0; i < 14; i++) {
      const light = i % 2 === 0;
      ctx.fillStyle = light ? 'rgba(255,255,255,0.055)' : 'rgba(0,0,0,0.06)';
      ctx.beginPath();
      ctx.arc(
        box.x + grain(i * 3 + 1) * box.w,
        box.y + grain(i * 3 + 2) * box.h,
        Math.max(0.5, reach * (0.008 + grain(i * 3 + 3) * 0.022)),
        0,
        TAU,
      );
      ctx.fill();
    }
  }

  // つや。強くすると おもちゃの ビニールに見えるので うっすら 広くのせる
  if (gloss) {
    const spot = ctx.createRadialGradient(lightX, lightY, 0, lightX, lightY, reach * 0.52);
    spot.addColorStop(0, 'rgba(255,255,255,0.16)');
    spot.addColorStop(0.5, 'rgba(255,255,255,0.06)');
    spot.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = spot;
    ctx.fillRect(box.x - box.w, box.y - box.h, box.w * 3, box.h * 3);
  }

  // ふちの照り返し。形を 左上へ ずらして なぞると 右下の内がわだけが 光る
  ctx.save();
  ctx.translate(-lw * 0.8, -lw * 1.1);
  pathFn();
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = lw * 2;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();

  ctx.restore();              // ここで 切り抜きを もどす

  if (outline) {
    pathFn();                 // 塗りで 形が変わっているので 引き直してから ふちどる
    ctx.strokeStyle = fade(shade(color, -0.68), 0.62);
    ctx.lineWidth = lw * 0.75;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
  ctx.restore();
}

/** ふくらんだ楕円を 1 つ描くだけの近道。 */
function celEllipse(ctx, cx, cy, rx, ry, color, lw, opts = {}) {
  cel(ctx, () => {
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, opts.rotate || 0, 0, TAU);
  }, { x: cx - rx, y: cy - ry, w: rx * 2, h: ry * 2 }, color, { lineWidth: lw, ...opts });
}

/**
 * 生きものらしい目。虹彩の放射グラデ・濃いふち・まぶたと まゆの影。
 * mood: 'cute' | 'fierce' | 'calm'、glow を渡すと 光る目になる。
 *
 * 呼び出し側が渡す大きさを EYE 倍に絞っている。顔いっぱいの大きな目は
 * かわいいが 漫画寄りに見えるので、頭に対して 小さめに収める。
 */
const EYE = 0.66;

function animeEyes(ctx, { x, y, gap: gap0, w: w0, h: h0, iris = '#2b3a55', mood = 'cute', glow = null, lw }) {
  const w = w0 * EYE;
  const h = h0 * EYE;
  const gap = gap0 * 0.92;

  const draw = (ex, flip) => {
    if (glow) {
      ctx.save();
      ctx.shadowColor = glow;
      ctx.shadowBlur = w * 2.6;
      const core = ctx.createRadialGradient(ex, y, 0, ex, y, w * 0.75);
      core.addColorStop(0, '#ffffff');
      core.addColorStop(0.35, glow);
      core.addColorStop(1, fade(glow, 0));
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.ellipse(ex, y, w * 0.75, h * 0.65, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
      return;
    }
    const ix = ex + flip * w * 0.12;
    const iy = y + h * 0.08;
    const ir = Math.max(w * 0.62, h * 0.72);

    // 目のくぼみ。目のまわりが 落ちくぼんで 頭に はまって見える
    const socket = ctx.createRadialGradient(ex, y, w * 0.9, ex, y, w * 2.1);
    socket.addColorStop(0, 'rgba(24,18,30,0.34)');
    socket.addColorStop(1, 'rgba(24,18,30,0)');
    ctx.fillStyle = socket;
    ctx.beginPath();
    ctx.arc(ex, y, w * 2.1, 0, TAU);
    ctx.fill();

    // 白目。上まぶたの影が 落ちて 下ほど明るい
    const sclera = ctx.createLinearGradient(ex, y - h, ex, y + h);
    sclera.addColorStop(0, '#b9bccb');
    sclera.addColorStop(0.42, '#fbfbff');
    sclera.addColorStop(1, '#e2e5ef');
    ctx.fillStyle = sclera;
    ctx.beginPath();
    ctx.ellipse(ex, y, w, h, 0, 0, TAU);
    ctx.fill();

    // 虹彩。中心が明るく、ふちに 濃い輪
    const ig = ctx.createRadialGradient(ix - w * 0.16, iy - h * 0.18, 0, ix, iy, ir);
    ig.addColorStop(0, shade(iris, 0.5));
    ig.addColorStop(0.45, shade(iris, 0.12));
    ig.addColorStop(1, shade(iris, -0.5));
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(ex, y, w, h, 0, 0, TAU);
    ctx.clip();
    ctx.fillStyle = ig;
    ctx.beginPath();
    ctx.ellipse(ix, iy, w * 0.62, h * 0.72, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = fade(shade(iris, -0.7), 0.85);
    ctx.lineWidth = lw * 0.5;
    ctx.stroke();
    // 瞳
    ctx.fillStyle = '#0d0f16';
    ctx.beginPath();
    ctx.ellipse(ix, y + h * 0.12, w * 0.3, h * 0.42, 0, 0, TAU);
    ctx.fill();
    // まぶたの影
    const lid = ctx.createLinearGradient(ex, y - h, ex, y);
    lid.addColorStop(0, 'rgba(24,20,34,0.42)');
    lid.addColorStop(1, 'rgba(24,20,34,0)');
    ctx.fillStyle = lid;
    ctx.fillRect(ex - w, y - h, w * 2, h);
    ctx.restore();

    // ハイライト。ぼかした玉と くっきりした点
    const hl = ctx.createRadialGradient(ex - w * 0.28, y - h * 0.34, 0, ex - w * 0.28, y - h * 0.34, w * 0.46);
    hl.addColorStop(0, 'rgba(255,255,255,0.95)');
    hl.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    hl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hl;
    ctx.beginPath();
    ctx.ellipse(ex - w * 0.28, y - h * 0.34, w * 0.46, h * 0.42, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath();
    ctx.ellipse(ex + w * 0.34, y + h * 0.36, w * 0.12, h * 0.1, 0, 0, TAU);
    ctx.fill();

    // まわりの ふち
    ctx.strokeStyle = 'rgba(18,20,32,0.7)';
    ctx.lineWidth = lw * 0.7;
    ctx.beginPath();
    ctx.ellipse(ex, y, w, h, 0, 0, TAU);
    ctx.stroke();
  };

  draw(x - gap / 2, -1);
  draw(x + gap / 2, 1);

  // まゆの ふくらみが 落とす影。目のうえが ひとつづきに 陰る
  if (!glow) {
    const brow = ctx.createLinearGradient(x, y - h * 2.4, x, y - h * 0.2);
    brow.addColorStop(0, 'rgba(20,14,26,0)');
    brow.addColorStop(1, 'rgba(20,14,26,0.28)');
    ctx.fillStyle = brow;
    ctx.beginPath();
    ctx.ellipse(x, y - h * 1.2, gap * 0.5 + w * 2, h * 1.5, 0, 0, TAU);
    ctx.fill();
  }

  if (mood === 'fierce') {
    ctx.strokeStyle = 'rgba(18,20,30,0.88)';
    ctx.lineWidth = lw * 1.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - gap / 2 - w * 1.4, y - h * 1.7);
    ctx.lineTo(x - gap / 2 + w * 0.9, y - h * 0.9);
    ctx.moveTo(x + gap / 2 + w * 1.4, y - h * 1.7);
    ctx.lineTo(x + gap / 2 - w * 0.9, y - h * 0.9);
    ctx.stroke();
  }
}

/** 口。にっこり／きば／への字。 */
function mouth(ctx, { x, y, w, h, kind = 'smile', lw, color = '#1a1c26' }) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (kind === 'smile') {
    ctx.moveTo(x - w / 2, y);
    ctx.quadraticCurveTo(x, y + h, x + w / 2, y);
  } else if (kind === 'frown') {
    ctx.moveTo(x - w / 2, y + h * 0.6);
    ctx.quadraticCurveTo(x, y - h * 0.4, x + w / 2, y + h * 0.6);
  } else if (kind === 'fang') {
    ctx.moveTo(x - w / 2, y);
    ctx.quadraticCurveTo(x, y + h * 1.2, x + w / 2, y);
    ctx.stroke();
    ctx.fillStyle = '#fdfdff';
    for (const sx of [-w * 0.24, w * 0.24]) {
      ctx.beginPath();
      ctx.moveTo(x + sx - w * 0.09, y + h * 0.18);
      ctx.lineTo(x + sx + w * 0.09, y + h * 0.18);
      ctx.lineTo(x + sx, y + h * 0.62);
      ctx.closePath();
      ctx.fill();
    }
    return;
  }
  ctx.stroke();
}

/** つの。 */
function horn(ctx, x, y, len, wide, color, lw, tilt = 0) {
  cel(ctx, () => {
    ctx.beginPath();
    ctx.moveTo(x - wide, y);
    ctx.quadraticCurveTo(x - wide * 0.4 + tilt, y - len * 0.7, x + tilt * 1.6, y - len);
    ctx.quadraticCurveTo(x + wide * 0.6 + tilt, y - len * 0.6, x + wide, y);
    ctx.closePath();
  }, { x: x - wide, y: y - len, w: wide * 2, h: len }, color, { lineWidth: lw, gloss: false });
}

/** こうもり／竜の翼。 */
function wing(ctx, x, y, span, height, color, lw, flip, flap) {
  const s = span * flip;
  cel(ctx, () => {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + s * 0.5, y - height * (0.9 + flap), x + s, y - height * (0.25 + flap * 0.6));
    ctx.quadraticCurveTo(x + s * 0.78, y + height * 0.12, x + s * 0.62, y - height * 0.02);
    ctx.quadraticCurveTo(x + s * 0.5, y + height * 0.3, x + s * 0.38, y + height * 0.08);
    ctx.quadraticCurveTo(x + s * 0.24, y + height * 0.36, x, y);
    ctx.closePath();
  }, { x: Math.min(x, x + s), y: y - height, w: Math.abs(s), h: height * 1.3 }, color, { lineWidth: lw, gloss: false });
}

/** けものの あし。ももから しぼって 足先をつける。 */
function beastLeg(ctx, x, y, s, color, lw) {
  cel(ctx, () => {
    ctx.beginPath();
    ctx.moveTo(x - s * 0.048, y);
    ctx.quadraticCurveTo(x - s * 0.05, y + s * 0.09, x - s * 0.032, y + s * 0.14);
    ctx.lineTo(x + s * 0.032, y + s * 0.14);
    ctx.quadraticCurveTo(x + s * 0.05, y + s * 0.09, x + s * 0.048, y);
    ctx.closePath();
  }, { x: x - s * 0.05, y, w: s * 0.1, h: s * 0.14 }, color, { lineWidth: lw, gloss: false });
  cel(ctx, () => {
    ctx.beginPath();
    ctx.ellipse(x + s * 0.012, y + s * 0.152, s * 0.055, s * 0.028, 0, 0, TAU);
  }, { x: x - s * 0.043, y: y + s * 0.124, w: s * 0.11, h: s * 0.056 }, shade(color, -0.14), { lineWidth: lw * 0.85, gloss: false });
}

/** ふわりと浮く布（ローブ・マント・幽霊のすそ）。 */
function cloak(ctx, cx, cy, w, h, color, lw, wave) {
  cel(ctx, () => {
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.5, cy - h * 0.5);
    ctx.quadraticCurveTo(cx, cy - h * 0.62, cx + w * 0.5, cy - h * 0.5);
    ctx.lineTo(cx + w * 0.62, cy + h * 0.42);
    ctx.quadraticCurveTo(cx + w * 0.28, cy + h * (0.3 + wave), cx, cy + h * 0.46);
    ctx.quadraticCurveTo(cx - w * 0.28, cy + h * (0.58 - wave), cx - w * 0.62, cy + h * 0.42);
    ctx.closePath();
  }, { x: cx - w * 0.62, y: cy - h * 0.62, w: w * 1.24, h: h * 1.1 }, color, { lineWidth: lw });
}

// ---------------------------------------------------------------- 型ごとの絵

const PAINTERS = {
  /** ぷるぷるした ゼリー。 */
  blob(ctx, p, s, t) {
    const squash = 1 + Math.sin(t * 3.2) * 0.07;
    const w = s * 0.46 * squash;
    const h = s * 0.36 / squash;
    cel(ctx, () => {
      ctx.beginPath();
      ctx.moveTo(-w, h);
      ctx.bezierCurveTo(-w * 1.05, -h * 0.9, -w * 0.5, -h * 1.7, 0, -h * 1.7);
      ctx.bezierCurveTo(w * 0.5, -h * 1.7, w * 1.05, -h * 0.9, w, h);
      ctx.closePath();
    }, { x: -w, y: -h * 1.7, w: w * 2, h: h * 2.7 }, p.body, { lineWidth: s * 0.03 });

    animeEyes(ctx, { x: 0, y: -h * 0.35, gap: w * 0.72, w: w * 0.26, h: h * 0.42, iris: p.eye, lw: s * 0.02, mood: p.mood });
    mouth(ctx, { x: 0, y: h * 0.18, w: w * 0.4, h: h * 0.3, kind: p.mouth || 'smile', lw: s * 0.022 });
  },

  /** 四つ足のけもの。しり・胸・くび・はなづらを 分けて けものらしい形にする。 */
  beast(ctx, p, s, t) {
    const bob = Math.sin(t * 2.6) * s * 0.01;
    const lw = s * 0.026;
    const bodyW = s * 0.32;
    const bodyH = s * 0.18;
    const cx = -s * 0.05;
    const cy = s * 0.05 + bob;
    const far = shade(p.body, -0.36);

    // しっぽ
    ctx.save();
    ctx.strokeStyle = shade(p.body, -0.4);
    ctx.lineWidth = s * (p.thinTail ? 0.024 : 0.055);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - bodyW * 0.9, cy - bodyH * 0.25);
    ctx.quadraticCurveTo(cx - bodyW * 1.7, cy - bodyH * (1.1 + Math.sin(t * 4) * 0.4), cx - bodyW * 1.44, cy - bodyH * 2);
    ctx.stroke();
    ctx.restore();

    // 向こうがわの 足。暗くすると 奥ゆきが出る
    for (const [lx, delay] of [[-0.66, 0.9], [0.6, 2.5]]) {
      beastLeg(ctx, cx + bodyW * lx + Math.sin(t * 4 + delay) * s * 0.01, cy + bodyH * 0.3, s, far, lw * 0.85);
    }

    // 胴。しりは丸く、胸へ向かって しぼる
    cel(ctx, () => {
      ctx.beginPath();
      ctx.moveTo(cx - bodyW, cy + bodyH * 0.15);
      ctx.bezierCurveTo(cx - bodyW * 1.06, cy - bodyH * 1.1, cx - bodyW * 0.4, cy - bodyH * 1.4, cx + bodyW * 0.16, cy - bodyH * 1.02);
      ctx.bezierCurveTo(cx + bodyW * 0.66, cy - bodyH * 0.74, cx + bodyW, cy - bodyH * 0.3, cx + bodyW * 0.96, cy + bodyH * 0.5);
      ctx.bezierCurveTo(cx + bodyW * 0.6, cy + bodyH * 1.24, cx - bodyW * 0.55, cy + bodyH * 1.3, cx - bodyW, cy + bodyH * 0.15);
      ctx.closePath();
    }, { x: cx - bodyW * 1.06, y: cy - bodyH * 1.4, w: bodyW * 2.05, h: bodyH * 2.7 }, p.body, { lineWidth: lw });

    // せなかのトゲ
    if (p.spikes) {
      // せぼねの ふくらみに合わせて 中央ほど 高く、はしほど 低く生やす
      for (let i = -1; i <= 1; i++) {
        const bx = cx + i * bodyW * 0.36 - bodyW * 0.08;
        const base = cy - bodyH * (1.02 - Math.abs(i) * 0.16);
        const tip = base - bodyH * (0.85 - Math.abs(i) * 0.2);
        cel(ctx, () => {
          ctx.beginPath();
          ctx.moveTo(bx - s * 0.032, base);
          ctx.lineTo(bx + s * 0.008, tip);
          ctx.lineTo(bx + s * 0.032, base);
          ctx.closePath();
        }, { x: bx - s * 0.032, y: tip, w: s * 0.064, h: base - tip }, shade(p.body, -0.28), { lineWidth: lw * 0.8, gloss: false });
      }
    }

    // こちらがわの 足
    for (const [lx, delay] of [[-0.56, 2.5], [0.68, 0.9]]) {
      beastLeg(ctx, cx + bodyW * lx + Math.sin(t * 4 + delay) * s * 0.012, cy + bodyH * 0.36, s, p.body, lw);
    }

    // くび
    const hx = cx + bodyW * 1.1;
    const hy = cy - bodyH * 1.32;
    cel(ctx, () => {
      ctx.beginPath();
      ctx.moveTo(cx + bodyW * 0.3, cy - bodyH * 0.95);
      ctx.quadraticCurveTo(cx + bodyW * 0.78, cy - bodyH * 1.6, hx - s * 0.02, hy + s * 0.01);
      ctx.lineTo(hx + s * 0.05, hy + s * 0.13);
      ctx.quadraticCurveTo(cx + bodyW * 0.9, cy - bodyH * 0.5, cx + bodyW * 0.5, cy - bodyH * 0.15);
      ctx.closePath();
    }, { x: cx + bodyW * 0.3, y: hy, w: bodyW * 0.9, h: bodyH * 1.5 }, p.body, { lineWidth: lw, gloss: false });

    if (p.mane) {
      // 毛のふさ。点の数は 偶数にしないと 内と外が そろわず 多角形に見えてしまう
      const tufts = 11;
      cel(ctx, () => {
        ctx.beginPath();
        for (let i = 0; i < tufts * 2; i++) {
          const a2 = (i / (tufts * 2)) * TAU - 0.3;
          const r = s * (i % 2 ? 0.135 : 0.225);
          const mx = hx + Math.cos(a2) * r * 1.05;
          const my = hy + Math.sin(a2) * r;
          if (i === 0) ctx.moveTo(mx, my);
          else ctx.lineTo(mx, my);
        }
        ctx.closePath();
      }, { x: hx - s * 0.24, y: hy - s * 0.23, w: s * 0.47, h: s * 0.45 }, shade(p.body, -0.34), { lineWidth: lw * 0.8, gloss: false });
    }

    // 耳（頭がい骨より さきに描いて 生えぎわを 隠す）
    if (p.ears !== false) {
      for (const side of [-1, 1]) {
        const ex = hx + side * s * 0.055 - s * 0.02;
        cel(ctx, () => {
          ctx.beginPath();
          ctx.moveTo(ex - s * 0.045, hy - s * 0.055);
          ctx.quadraticCurveTo(ex - s * 0.03, hy - s * 0.2, ex + s * 0.03, hy - s * 0.24);
          ctx.quadraticCurveTo(ex + s * 0.05, hy - s * 0.13, ex + s * 0.055, hy - s * 0.03);
          ctx.closePath();
        }, { x: ex - s * 0.045, y: hy - s * 0.24, w: s * 0.1, h: s * 0.21 }, side < 0 ? far : p.body, { lineWidth: lw * 0.85, gloss: false });
      }
    }

    // 頭がい骨
    celEllipse(ctx, hx, hy, s * 0.14, s * 0.125, p.body, lw);

    // はなづら
    cel(ctx, () => {
      ctx.beginPath();
      ctx.moveTo(hx + s * 0.015, hy - s * 0.05);
      ctx.quadraticCurveTo(hx + s * 0.19, hy - s * 0.055, hx + s * 0.235, hy + s * 0.03);
      ctx.quadraticCurveTo(hx + s * 0.2, hy + s * 0.115, hx + s * 0.025, hy + s * 0.115);
      ctx.closePath();
    }, { x: hx + s * 0.015, y: hy - s * 0.055, w: s * 0.22, h: s * 0.17 }, shade(p.body, 0.08), { lineWidth: lw * 0.85 });

    // はな
    ctx.fillStyle = '#23232b';
    ctx.beginPath();
    ctx.ellipse(hx + s * 0.222, hy + s * 0.012, s * 0.023, s * 0.019, 0, 0, TAU);
    ctx.fill();

    animeEyes(ctx, { x: hx + s * 0.025, y: hy - s * 0.025, gap: s * 0.125, w: s * 0.05, h: s * 0.055, iris: p.eye, mood: p.mood || 'fierce', lw: s * 0.02 });
    mouth(ctx, { x: hx + s * 0.145, y: hy + s * 0.088, w: s * 0.1, h: s * 0.04, kind: p.mouth || 'fang', lw: s * 0.02 });
  },

  /** 虫。羽と足。 */
  bug(ctx, p, s, t) {
    const lw = s * 0.026;
    const flap = Math.sin(t * 18) * 0.22;
    const cy = Math.sin(t * 3) * s * 0.02;

    if (p.legs) {
      ctx.strokeStyle = shade(p.body, -0.5);
      ctx.lineWidth = s * 0.022;
      ctx.lineCap = 'round';
      for (const side of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          const a = 0.5 + i * 0.42;
          ctx.beginPath();
          ctx.moveTo(0, cy);
          ctx.quadraticCurveTo(side * s * 0.3, cy + Math.sin(a) * s * 0.1, side * s * (0.34 + i * 0.04), cy + s * (0.12 + i * 0.09));
          ctx.stroke();
        }
      }
    }
    if (p.wings) {
      for (const side of [-1, 1]) {
        ctx.save();
        ctx.globalAlpha = 0.75;
        celEllipse(ctx, side * s * 0.16, cy - s * 0.16 - flap * s * 0.06, s * 0.16, s * 0.09, '#e8f4ff', lw * 0.7, { rotate: side * (0.5 + flap), gloss: false });
        ctx.restore();
      }
    }

    celEllipse(ctx, 0, cy + s * 0.06, s * 0.22, s * 0.2, p.body, lw);
    if (p.stripes) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(0, cy + s * 0.06, s * 0.22, s * 0.2, 0, 0, TAU);
      ctx.clip();
      ctx.fillStyle = shade(p.body, -0.66);
      for (let i = -1; i <= 1; i++) ctx.fillRect(-s * 0.25, cy + s * (0.02 + i * 0.09), s * 0.5, s * 0.045);
      ctx.restore();
    }
    if (p.stinger) {
      cel(ctx, () => {
        ctx.beginPath();
        ctx.moveTo(-s * 0.04, cy + s * 0.24);
        ctx.lineTo(0, cy + s * 0.4);
        ctx.lineTo(s * 0.04, cy + s * 0.24);
        ctx.closePath();
      }, { x: -s * 0.04, y: cy + s * 0.24, w: s * 0.08, h: s * 0.16 }, '#3b3b46', { lineWidth: lw * 0.7, gloss: false });
    }

    celEllipse(ctx, 0, cy - s * 0.16, s * 0.15, s * 0.13, shade(p.body, -0.12), lw);
    animeEyes(ctx, { x: 0, y: cy - s * 0.17, gap: s * 0.14, w: s * 0.055, h: s * 0.06, iris: p.eye, mood: p.mood || 'fierce', lw: s * 0.018 });
  },

  /** きのこ。 */
  mushroom(ctx, p, s, t) {
    const lw = s * 0.03;
    const sway = Math.sin(t * 2.4) * 0.08;
    ctx.save();
    ctx.rotate(sway * 0.12);
    celEllipse(ctx, 0, s * 0.12, s * 0.17, s * 0.2, '#f3e6cf', lw);
    cel(ctx, () => {
      ctx.beginPath();
      ctx.ellipse(0, -s * 0.1, s * 0.34, s * 0.24, 0, Math.PI, TAU);
      ctx.closePath();
    }, { x: -s * 0.34, y: -s * 0.34, w: s * 0.68, h: s * 0.28 }, p.body, { lineWidth: lw });
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(0, -s * 0.1, s * 0.34, s * 0.24, 0, Math.PI, TAU);
    ctx.clip();
    ctx.fillStyle = '#fff6e0';
    for (const [dx, dy, r] of [[-0.17, -0.16, 0.05], [0.12, -0.2, 0.04], [0.2, -0.08, 0.03], [-0.05, -0.1, 0.035]]) {
      ctx.beginPath();
      ctx.ellipse(dx * s, dy * s, r * s, r * s * 0.8, 0, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    animeEyes(ctx, { x: 0, y: s * 0.1, gap: s * 0.14, w: s * 0.05, h: s * 0.055, iris: p.eye, mood: p.mood || 'calm', lw: s * 0.018 });
    mouth(ctx, { x: 0, y: s * 0.2, w: s * 0.09, h: s * 0.04, kind: 'frown', lw: s * 0.02 });
    ctx.restore();
  },

  /** かえる。 */
  frog(ctx, p, s, t) {
    const lw = s * 0.03;
    const puff = 1 + Math.sin(t * 3) * 0.06;
    celEllipse(ctx, -s * 0.26, s * 0.2, s * 0.1, s * 0.07, shade(p.body, -0.18), lw, { gloss: false });
    celEllipse(ctx, s * 0.26, s * 0.2, s * 0.1, s * 0.07, shade(p.body, -0.18), lw, { gloss: false });
    celEllipse(ctx, 0, s * 0.06, s * 0.3 * puff, s * 0.24 / puff, p.body, lw);
    for (const side of [-1, 1]) {
      celEllipse(ctx, side * s * 0.13, -s * 0.17, s * 0.09, s * 0.09, p.body, lw, { gloss: false });
    }
    animeEyes(ctx, { x: 0, y: -s * 0.18, gap: s * 0.26, w: s * 0.06, h: s * 0.065, iris: p.eye, mood: p.mood || 'calm', lw: s * 0.02 });
    mouth(ctx, { x: 0, y: s * 0.04, w: s * 0.3, h: s * 0.09, kind: 'smile', lw: s * 0.024 });
  },

  /** 人がた（ゴブリン・山賊・大男・仮面・がいこつ）。 */
  humanoid(ctx, p, s, t) {
    const lw = s * 0.03;
    const bob = Math.sin(t * 2.2) * s * 0.012;
    const scale = p.big ? 1.15 : 1;
    ctx.save();
    ctx.scale(scale, scale);

    const drawWeapon = () => {
      if (!p.weapon) return;
      ctx.save();
      ctx.translate(s * 0.28, bob + s * 0.02);
      ctx.rotate(-0.5 + Math.sin(t * 2) * 0.06);
      const wl = s * (p.weapon === 'axe' ? 0.34 : 0.42);
      ctx.strokeStyle = '#7a5230';
      ctx.lineWidth = s * 0.032;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, s * 0.16);
      ctx.lineTo(0, -wl);
      ctx.stroke();
      if (p.weapon === 'axe') {
        cel(ctx, () => {
          ctx.beginPath();
          ctx.moveTo(0, -wl);
          ctx.quadraticCurveTo(s * 0.2, -wl - s * 0.06, s * 0.16, -wl + s * 0.16);
          ctx.quadraticCurveTo(s * 0.06, -wl + s * 0.1, 0, -wl + s * 0.12);
          ctx.closePath();
        }, { x: 0, y: -wl - s * 0.06, w: s * 0.2, h: s * 0.24 }, '#c8ccd8', { lineWidth: lw * 0.8 });
      } else if (p.weapon === 'sword') {
        cel(ctx, () => {
          ctx.beginPath();
          ctx.moveTo(-s * 0.03, -wl);
          ctx.lineTo(s * 0.03, -wl);
          ctx.lineTo(s * 0.02, -wl - s * 0.3);
          ctx.lineTo(-s * 0.02, -wl - s * 0.3);
          ctx.closePath();
        }, { x: -s * 0.03, y: -wl - s * 0.3, w: s * 0.06, h: s * 0.3 }, '#dfe6ef', { lineWidth: lw * 0.7 });
      } else if (p.weapon === 'bow') {
        ctx.strokeStyle = '#8a5a2b';
        ctx.lineWidth = s * 0.026;
        ctx.beginPath();
        ctx.arc(0, -wl * 0.4, s * 0.22, -1.1, 1.1);
        ctx.stroke();
      }
      ctx.restore();
    };

    // あし。からだの うしろから 生やす
    for (const side of [-1, 1]) {
      const step = Math.sin(t * 2.2 + (side > 0 ? 1.7 : 0)) * s * 0.006;
      cel(ctx, () => {
        ctx.beginPath();
        ctx.moveTo(side * s * 0.035, bob + s * 0.26);
        ctx.lineTo(side * s * 0.15, bob + s * 0.26);
        ctx.quadraticCurveTo(side * s * 0.14, bob + s * 0.4, side * s * 0.12 + step, bob + s * 0.46);
        ctx.lineTo(side * s * 0.05 + step, bob + s * 0.46);
        ctx.closePath();
      }, { x: -s * 0.15, y: bob + s * 0.26, w: s * 0.3, h: s * 0.2 }, shade(p.cloth || p.skin, -0.32), { lineWidth: lw * 0.9, gloss: false });
      cel(ctx, () => {
        ctx.beginPath();
        ctx.ellipse(side * s * 0.085 + step, bob + s * 0.475, s * 0.06, s * 0.028, 0, 0, TAU);
      }, { x: -s * 0.15, y: bob + s * 0.447, w: s * 0.3, h: s * 0.056 }, shade(p.cloth || p.skin, -0.5), { lineWidth: lw * 0.8, gloss: false });
    }

    // からだ。肩から こしへ すぼめる
    cel(ctx, () => {
      ctx.beginPath();
      ctx.moveTo(-s * 0.17, bob + s * 0.3);
      ctx.quadraticCurveTo(-s * 0.22, bob + s * 0.04, -s * 0.16, bob - s * 0.09);
      ctx.quadraticCurveTo(-s * 0.1, bob - s * 0.15, 0, bob - s * 0.15);
      ctx.quadraticCurveTo(s * 0.1, bob - s * 0.15, s * 0.16, bob - s * 0.09);
      ctx.quadraticCurveTo(s * 0.22, bob + s * 0.04, s * 0.17, bob + s * 0.3);
      ctx.closePath();
    }, { x: -s * 0.22, y: bob - s * 0.15, w: s * 0.44, h: s * 0.45 }, p.cloth, { lineWidth: lw });

    // うで。肩から ひじ、その先に 手
    for (const side of [-1, 1]) {
      const swing = Math.sin(t * 2.2 + (side > 0 ? 0 : 1.7)) * s * 0.008;
      cel(ctx, () => {
        ctx.beginPath();
        ctx.moveTo(side * s * 0.12, bob - s * 0.11);
        ctx.quadraticCurveTo(side * s * 0.24, bob + s * 0.01, side * s * 0.215 + swing, bob + s * 0.15);
        ctx.lineTo(side * s * 0.135 + swing, bob + s * 0.15);
        ctx.quadraticCurveTo(side * s * 0.15, bob + s * 0.02, side * s * 0.055, bob - s * 0.09);
        ctx.closePath();
      }, { x: -s * 0.24, y: bob - s * 0.11, w: s * 0.48, h: s * 0.26 }, p.cloth, { lineWidth: lw * 0.6, gloss: false });
      celEllipse(ctx, side * s * 0.175 + swing, bob + s * 0.16, s * 0.05, s * 0.055, p.skin, lw * 0.9, { gloss: false });
    }

    drawWeapon();

    // くび
    celEllipse(ctx, 0, bob - s * 0.16, s * 0.055, s * 0.07, shade(p.skin, -0.26), lw * 0.8, { gloss: false });

    // あたま。あごへ向けて 細くする
    const hy = bob - s * 0.29;
    cel(ctx, () => {
      ctx.beginPath();
      ctx.moveTo(-s * 0.155, hy - s * 0.02);
      ctx.quadraticCurveTo(-s * 0.15, hy + s * 0.11, 0, hy + s * 0.155);
      ctx.quadraticCurveTo(s * 0.15, hy + s * 0.11, s * 0.155, hy - s * 0.02);
      ctx.quadraticCurveTo(s * 0.14, hy - s * 0.19, 0, hy - s * 0.19);
      ctx.quadraticCurveTo(-s * 0.14, hy - s * 0.19, -s * 0.155, hy - s * 0.02);
      ctx.closePath();
    }, { x: -s * 0.155, y: hy - s * 0.19, w: s * 0.31, h: s * 0.35 }, p.skin, { lineWidth: lw });

    if (p.ears) {
      for (const side of [-1, 1]) {
        cel(ctx, () => {
          ctx.beginPath();
          ctx.moveTo(side * s * 0.15, hy - s * 0.02);
          ctx.lineTo(side * s * 0.31, hy - s * 0.12);
          ctx.lineTo(side * s * 0.15, hy + s * 0.07);
          ctx.closePath();
        }, { x: -s * 0.31, y: hy - s * 0.12, w: s * 0.62, h: s * 0.2 }, p.skin, { lineWidth: lw * 0.8, gloss: false });
      }
    }
    if (p.hood) {
      cel(ctx, () => {
        ctx.beginPath();
        ctx.arc(0, hy, s * 0.19, Math.PI * 1.05, TAU * 0.98);
        ctx.closePath();
      }, { x: -s * 0.19, y: hy - s * 0.19, w: s * 0.38, h: s * 0.22 }, p.cloth, { lineWidth: lw });
    }
    if (p.horns) {
      horn(ctx, -s * 0.1, hy - s * 0.1, s * 0.16, s * 0.04, '#e6dcc8', lw * 0.8, -s * 0.03);
      horn(ctx, s * 0.1, hy - s * 0.1, s * 0.16, s * 0.04, '#e6dcc8', lw * 0.8, s * 0.03);
    }

    if (p.mask) {
      cel(ctx, () => {
        ctx.beginPath();
        ctx.ellipse(0, hy, s * 0.14, s * 0.15, 0, 0, TAU);
      }, { x: -s * 0.14, y: hy - s * 0.15, w: s * 0.28, h: s * 0.3 }, p.mask, { lineWidth: lw });
      animeEyes(ctx, { x: 0, y: hy - s * 0.01, gap: s * 0.14, w: s * 0.045, h: s * 0.05, glow: p.glow || '#ff6b6b', lw: s * 0.02 });
    } else if (p.bone) {
      // どくろ
      ctx.fillStyle = '#1a1c26';
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(side * s * 0.06, hy - s * 0.01, s * 0.045, s * 0.05, 0, 0, TAU);
        ctx.fill();
      }
      animeEyes(ctx, { x: 0, y: hy - s * 0.01, gap: s * 0.12, w: s * 0.04, h: s * 0.045, glow: p.glow || '#8fe3ff', lw: s * 0.02 });
      ctx.strokeStyle = '#1a1c26';
      ctx.lineWidth = lw * 0.8;
      ctx.beginPath();
      ctx.moveTo(-s * 0.07, hy + s * 0.1);
      ctx.lineTo(s * 0.07, hy + s * 0.1);
      for (let i = -2; i <= 2; i++) {
        ctx.moveTo(i * s * 0.03, hy + s * 0.07);
        ctx.lineTo(i * s * 0.03, hy + s * 0.13);
      }
      ctx.stroke();
    } else {
      animeEyes(ctx, { x: 0, y: hy - s * 0.01, gap: s * 0.14, w: s * 0.05, h: s * 0.055, iris: p.eye, mood: p.mood || 'fierce', lw: s * 0.02 });
      mouth(ctx, { x: 0, y: hy + s * 0.09, w: s * 0.12, h: s * 0.05, kind: p.mouth || 'fang', lw: s * 0.022 });
    }
    ctx.restore();
  },

  /** ローブ姿（まほうつかい・魔女・魔導）。 */
  robed(ctx, p, s, t) {
    const lw = s * 0.03;
    const wave = Math.sin(t * 2) * 0.05;
    const float = Math.sin(t * 1.6) * s * 0.02;

    if (p.orb) {
      const glow = 0.5 + 0.5 * Math.sin(t * 4);
      ctx.save();
      ctx.shadowColor = p.orb;
      ctx.shadowBlur = s * 0.22 * (0.6 + glow * 0.6);
      celEllipse(ctx, s * 0.3, float, s * 0.07, s * 0.07, p.orb, lw * 0.7, { gloss: true });
      ctx.restore();
    }

    cloak(ctx, 0, float + s * 0.14, s * 0.46, s * 0.5, p.cloth, lw, wave);

    const hy = float - s * 0.2;
    celEllipse(ctx, 0, hy, s * 0.14, s * 0.14, p.skin || '#e8d9c0', lw, { gloss: false });

    if (p.hat) {
      cel(ctx, () => {
        ctx.beginPath();
        ctx.moveTo(-s * 0.24, hy - s * 0.1);
        ctx.quadraticCurveTo(0, hy - s * 0.16, s * 0.24, hy - s * 0.1);
        ctx.quadraticCurveTo(s * 0.1, hy - s * 0.2, s * 0.06, hy - s * 0.46);
        ctx.quadraticCurveTo(-s * 0.06, hy - s * 0.22, -s * 0.24, hy - s * 0.1);
        ctx.closePath();
      }, { x: -s * 0.24, y: hy - s * 0.46, w: s * 0.48, h: s * 0.36 }, p.hatColor || p.cloth, { lineWidth: lw });
    } else {
      cel(ctx, () => {
        ctx.beginPath();
        ctx.arc(0, hy, s * 0.17, Math.PI * 1.02, TAU * 0.99);
        ctx.closePath();
      }, { x: -s * 0.17, y: hy - s * 0.17, w: s * 0.34, h: s * 0.2 }, p.cloth, { lineWidth: lw });
    }

    animeEyes(ctx, {
      x: 0, y: hy + s * 0.01, gap: s * 0.12, w: s * 0.045, h: s * 0.05,
      iris: p.eye, glow: p.glow, mood: p.mood || 'fierce', lw: s * 0.018,
    });
    if (!p.glow) mouth(ctx, { x: 0, y: hy + s * 0.09, w: s * 0.08, h: s * 0.03, kind: 'frown', lw: s * 0.02 });
  },

  /** よろい（さまよう鎧・騎兵・将）。 */
  armor(ctx, p, s, t) {
    const lw = s * 0.03;
    const float = Math.sin(t * 2) * s * 0.018;

    if (p.cape) {
      cloak(ctx, 0, float + s * 0.14, s * 0.44, s * 0.46, p.cape, lw, Math.sin(t * 2.2) * 0.06);
    }
    if (p.weapon) {
      ctx.save();
      ctx.translate(s * 0.28, float);
      ctx.rotate(-0.35 + Math.sin(t * 1.8) * 0.05);
      cel(ctx, () => {
        ctx.beginPath();
        ctx.moveTo(-s * 0.035, s * 0.12);
        ctx.lineTo(s * 0.035, s * 0.12);
        ctx.lineTo(s * 0.02, -s * 0.42);
        ctx.lineTo(0, -s * 0.5);
        ctx.lineTo(-s * 0.02, -s * 0.42);
        ctx.closePath();
      }, { x: -s * 0.04, y: -s * 0.5, w: s * 0.08, h: s * 0.62 }, '#e3e9f2', { lineWidth: lw * 0.8 });
      ctx.strokeStyle = '#5b4632';
      ctx.lineWidth = s * 0.03;
      ctx.beginPath();
      ctx.moveTo(0, s * 0.12);
      ctx.lineTo(0, s * 0.24);
      ctx.stroke();
      ctx.restore();
    }

    // 胴
    cel(ctx, () => {
      ctx.beginPath();
      ctx.moveTo(-s * 0.19, float + s * 0.3);
      ctx.quadraticCurveTo(-s * 0.27, float - s * 0.06, -s * 0.14, float - s * 0.14);
      ctx.lineTo(s * 0.14, float - s * 0.14);
      ctx.quadraticCurveTo(s * 0.27, float - s * 0.06, s * 0.19, float + s * 0.3);
      ctx.closePath();
    }, { x: -s * 0.27, y: float - s * 0.14, w: s * 0.54, h: s * 0.44 }, p.body, { lineWidth: lw });

    // 肩あて
    for (const side of [-1, 1]) {
      celEllipse(ctx, side * s * 0.22, float - s * 0.06, s * 0.1, s * 0.075, shade(p.body, 0.12), lw, { gloss: false });
    }

    // かぶと
    const hy = float - s * 0.28;
    cel(ctx, () => {
      ctx.beginPath();
      ctx.moveTo(-s * 0.14, hy + s * 0.12);
      ctx.quadraticCurveTo(-s * 0.16, hy - s * 0.16, 0, hy - s * 0.17);
      ctx.quadraticCurveTo(s * 0.16, hy - s * 0.16, s * 0.14, hy + s * 0.12);
      ctx.closePath();
    }, { x: -s * 0.16, y: hy - s * 0.17, w: s * 0.32, h: s * 0.3 }, shade(p.body, 0.08), { lineWidth: lw });

    // 面の すきま
    ctx.fillStyle = '#0d0e14';
    ctx.fillRect(-s * 0.11, hy - s * 0.02, s * 0.22, s * 0.07);
    animeEyes(ctx, { x: 0, y: hy + s * 0.015, gap: s * 0.12, w: s * 0.035, h: s * 0.03, glow: p.glow || '#ffb057', lw: s * 0.018 });

    if (p.plume) {
      cel(ctx, () => {
        ctx.beginPath();
        ctx.moveTo(0, hy - s * 0.16);
        ctx.quadraticCurveTo(s * 0.06, hy - s * 0.34, -s * 0.02 + Math.sin(t * 3) * s * 0.03, hy - s * 0.42);
        ctx.quadraticCurveTo(-s * 0.02, hy - s * 0.28, -s * 0.06, hy - s * 0.16);
        ctx.closePath();
      }, { x: -s * 0.08, y: hy - s * 0.42, w: s * 0.16, h: s * 0.28 }, p.plume, { lineWidth: lw * 0.8, gloss: false });
    }
  },

  /** 翼のあるもの（こうもり・怪鳥・翼竜・ドラゴン）。 */
  flyer(ctx, p, s, t) {
    const lw = s * 0.03;
    const flap = Math.sin(t * (p.slowWings ? 3 : 7)) * 0.24;
    const float = Math.sin(t * 2.2) * s * 0.02;
    const bodyR = s * (p.big ? 0.24 : 0.17);

    wing(ctx, -bodyR * 0.7, float, s * 0.42, s * 0.3, shade(p.body, -0.2), lw, -1, flap);
    wing(ctx, bodyR * 0.7, float, s * 0.42, s * 0.3, shade(p.body, -0.2), lw, 1, flap);

    celEllipse(ctx, 0, float + s * 0.04, bodyR, bodyR * 1.15, p.body, lw);

    if (p.tail) {
      ctx.strokeStyle = shade(p.body, -0.35);
      ctx.lineWidth = s * 0.04;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, float + bodyR);
      ctx.quadraticCurveTo(s * 0.16, float + bodyR + s * 0.16, s * 0.06 + Math.sin(t * 3) * s * 0.04, float + bodyR + s * 0.3);
      ctx.stroke();
    }

    const hy = float - bodyR * 0.9;
    celEllipse(ctx, 0, hy, bodyR * 0.78, bodyR * 0.72, p.body, lw);

    if (p.snout) {
      cel(ctx, () => {
        ctx.beginPath();
        ctx.moveTo(bodyR * 0.4, hy - bodyR * 0.1);
        ctx.quadraticCurveTo(bodyR * 1.3, hy + bodyR * 0.02, bodyR * 1.15, hy + bodyR * 0.34);
        ctx.quadraticCurveTo(bodyR * 0.7, hy + bodyR * 0.4, bodyR * 0.35, hy + bodyR * 0.3);
        ctx.closePath();
      }, { x: bodyR * 0.35, y: hy - bodyR * 0.1, w: bodyR, h: bodyR * 0.5 }, shade(p.body, 0.08), { lineWidth: lw * 0.85 });
      ctx.fillStyle = '#fdfdff';
      for (const dx of [0.6, 0.85]) {
        ctx.beginPath();
        ctx.moveTo(bodyR * dx, hy + bodyR * 0.3);
        ctx.lineTo(bodyR * (dx + 0.1), hy + bodyR * 0.3);
        ctx.lineTo(bodyR * (dx + 0.05), hy + bodyR * 0.52);
        ctx.closePath();
        ctx.fill();
      }
    }
    if (p.ears) {
      for (const side of [-1, 1]) {
        cel(ctx, () => {
          ctx.beginPath();
          ctx.moveTo(side * bodyR * 0.3, hy - bodyR * 0.4);
          ctx.lineTo(side * bodyR * 0.75, hy - bodyR * 1.35);
          ctx.lineTo(side * bodyR * 0.78, hy - bodyR * 0.25);
          ctx.closePath();
        }, { x: -bodyR, y: hy - bodyR * 1.35, w: bodyR * 2, h: bodyR }, p.body, { lineWidth: lw * 0.8, gloss: false });
      }
    }
    if (p.horns) {
      horn(ctx, -bodyR * 0.4, hy - bodyR * 0.45, bodyR * 0.7, bodyR * 0.16, '#f0e4cc', lw * 0.8, -bodyR * 0.12);
      horn(ctx, bodyR * 0.4, hy - bodyR * 0.45, bodyR * 0.7, bodyR * 0.16, '#f0e4cc', lw * 0.8, bodyR * 0.12);
    }

    animeEyes(ctx, {
      x: p.snout ? -bodyR * 0.06 : 0, y: hy - bodyR * 0.06, gap: bodyR * 0.62,
      w: bodyR * 0.24, h: bodyR * 0.26, iris: p.eye, glow: p.glow, mood: p.mood || 'fierce', lw: s * 0.02,
    });
  },

  /** 幽霊・死神。 */
  ghost(ctx, p, s, t) {
    const lw = s * 0.028;
    const float = Math.sin(t * 1.8) * s * 0.03;
    const wave = Math.sin(t * 2.6) * 0.08;

    if (p.scythe) {
      ctx.save();
      ctx.translate(s * 0.26, float);
      ctx.rotate(0.25);
      ctx.strokeStyle = '#6b4a2c';
      ctx.lineWidth = s * 0.028;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, s * 0.3);
      ctx.lineTo(0, -s * 0.36);
      ctx.stroke();
      cel(ctx, () => {
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.36);
        ctx.quadraticCurveTo(-s * 0.3, -s * 0.44, -s * 0.3, -s * 0.18);
        ctx.quadraticCurveTo(-s * 0.16, -s * 0.3, 0, -s * 0.28);
        ctx.closePath();
      }, { x: -s * 0.3, y: -s * 0.46, w: s * 0.3, h: s * 0.3 }, '#dfe6ef', { lineWidth: lw * 0.8 });
      ctx.restore();
    }

    ctx.save();
    ctx.globalAlpha = p.alpha ?? 0.92;
    cel(ctx, () => {
      ctx.beginPath();
      ctx.moveTo(-s * 0.24, float + s * 0.12);
      ctx.quadraticCurveTo(-s * 0.26, float - s * 0.3, 0, float - s * 0.3);
      ctx.quadraticCurveTo(s * 0.26, float - s * 0.3, s * 0.24, float + s * 0.12);
      ctx.quadraticCurveTo(s * 0.18, float + s * (0.3 + wave), s * 0.08, float + s * 0.18);
      ctx.quadraticCurveTo(0, float + s * (0.36 - wave), -s * 0.08, float + s * 0.18);
      ctx.quadraticCurveTo(-s * 0.18, float + s * (0.32 + wave), -s * 0.24, float + s * 0.12);
      ctx.closePath();
    }, { x: -s * 0.26, y: float - s * 0.3, w: s * 0.52, h: s * 0.66 }, p.body, { lineWidth: lw });

    if (p.hood) {
      cel(ctx, () => {
        ctx.beginPath();
        ctx.moveTo(-s * 0.2, float - s * 0.02);
        ctx.quadraticCurveTo(-s * 0.2, float - s * 0.34, 0, float - s * 0.34);
        ctx.quadraticCurveTo(s * 0.2, float - s * 0.34, s * 0.2, float - s * 0.02);
        ctx.quadraticCurveTo(0, float - s * 0.14, -s * 0.2, float - s * 0.02);
        ctx.closePath();
      }, { x: -s * 0.2, y: float - s * 0.34, w: s * 0.4, h: s * 0.34 }, p.hood, { lineWidth: lw });
    }
    ctx.restore();

    animeEyes(ctx, { x: 0, y: float - s * 0.12, gap: s * 0.14, w: s * 0.05, h: s * 0.055, glow: p.glow || '#a5d8ff', lw: s * 0.02 });
  },

  /** 岩・マグマのかたまり。 */
  golem(ctx, p, s, t) {
    const lw = s * 0.032;
    const bob = Math.sin(t * 1.6) * s * 0.014;

    for (const side of [-1, 1]) {
      cel(ctx, () => {
        ctx.beginPath();
        ctx.moveTo(side * s * 0.24, bob - s * 0.04);
        ctx.lineTo(side * s * 0.42, bob + s * 0.04);
        ctx.lineTo(side * s * 0.36, bob + s * 0.26);
        ctx.lineTo(side * s * 0.2, bob + s * 0.18);
        ctx.closePath();
      }, { x: -s * 0.42, y: bob - s * 0.04, w: s * 0.84, h: s * 0.3 }, shade(p.body, -0.1), { lineWidth: lw, gloss: false });
    }

    cel(ctx, () => {
      ctx.beginPath();
      ctx.moveTo(-s * 0.26, bob + s * 0.32);
      ctx.lineTo(-s * 0.3, bob - s * 0.12);
      ctx.lineTo(-s * 0.12, bob - s * 0.3);
      ctx.lineTo(s * 0.16, bob - s * 0.28);
      ctx.lineTo(s * 0.3, bob - s * 0.06);
      ctx.lineTo(s * 0.24, bob + s * 0.32);
      ctx.closePath();
    }, { x: -s * 0.3, y: bob - s * 0.3, w: s * 0.6, h: s * 0.62 }, p.body, { lineWidth: lw });

    // ひび
    ctx.strokeStyle = shade(p.body, -0.5);
    ctx.lineWidth = lw * 0.6;
    ctx.beginPath();
    ctx.moveTo(-s * 0.14, bob + s * 0.3);
    ctx.lineTo(-s * 0.06, bob + s * 0.12);
    ctx.lineTo(-s * 0.14, bob + s * 0.02);
    ctx.moveTo(s * 0.16, bob + s * 0.26);
    ctx.lineTo(s * 0.08, bob + s * 0.1);
    ctx.stroke();

    if (p.molten) {
      const glow = 0.55 + 0.45 * Math.sin(t * 5);
      ctx.save();
      ctx.globalAlpha = glow;
      ctx.fillStyle = p.molten;
      ctx.beginPath();
      ctx.moveTo(-s * 0.28, bob - s * 0.02);
      ctx.quadraticCurveTo(-s * 0.1, bob + s * 0.1, 0, bob - s * 0.04);
      ctx.quadraticCurveTo(s * 0.14, bob + s * 0.12, s * 0.28, bob - s * 0.02);
      ctx.lineTo(s * 0.26, bob + s * 0.12);
      ctx.quadraticCurveTo(0, bob + s * 0.2, -s * 0.26, bob + s * 0.1);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    if (p.crown) {
      for (const dx of [-0.16, 0, 0.16]) {
        cel(ctx, () => {
          ctx.beginPath();
          ctx.moveTo(s * (dx - 0.06), bob - s * 0.28);
          ctx.lineTo(s * dx, bob - s * 0.46);
          ctx.lineTo(s * (dx + 0.06), bob - s * 0.28);
          ctx.closePath();
        }, { x: s * (dx - 0.06), y: bob - s * 0.46, w: s * 0.12, h: s * 0.18 }, shade(p.body, 0.1), { lineWidth: lw * 0.8, gloss: false });
      }
    }
    animeEyes(ctx, { x: 0, y: bob - s * 0.12, gap: s * 0.18, w: s * 0.055, h: s * 0.05, glow: p.glow || '#ffd166', lw: s * 0.02 });
  },

  /** 節のある虫（いわむし）。 */
  worm(ctx, p, s, t) {
    const lw = s * 0.03;
    for (let i = 4; i >= 0; i--) {
      const wobble = Math.sin(t * 3 - i * 0.6) * s * 0.03;
      const r = s * (0.2 - i * 0.022);
      celEllipse(ctx, -i * s * 0.11, s * 0.12 + wobble + i * s * 0.02, r, r * 0.9, shade(p.body, -i * 0.06), lw, { gloss: i === 0 });
    }
    const hy = s * 0.12 + Math.sin(t * 3) * s * 0.03;
    animeEyes(ctx, { x: s * 0.04, y: hy - s * 0.04, gap: s * 0.13, w: s * 0.05, h: s * 0.05, iris: p.eye, mood: 'fierce', lw: s * 0.02 });
    mouth(ctx, { x: s * 0.06, y: hy + s * 0.08, w: s * 0.12, h: s * 0.05, kind: 'fang', lw: s * 0.022 });
  },

  /** 木の主。 */
  tree(ctx, p, s, t) {
    const lw = s * 0.032;
    const sway = Math.sin(t * 1.4) * 0.04;
    ctx.save();
    ctx.rotate(sway * 0.1);

    for (const side of [-1, 1]) {
      ctx.strokeStyle = shade(p.trunk, -0.2);
      ctx.lineWidth = s * 0.05;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(side * s * 0.08, s * 0.06);
      ctx.quadraticCurveTo(side * s * 0.34, -s * 0.02, side * s * (0.4 + sway), -s * 0.22);
      ctx.stroke();
    }

    cel(ctx, () => {
      ctx.beginPath();
      ctx.moveTo(-s * 0.2, s * 0.36);
      ctx.quadraticCurveTo(-s * 0.14, -s * 0.05, -s * 0.16, -s * 0.24);
      ctx.lineTo(s * 0.16, -s * 0.24);
      ctx.quadraticCurveTo(s * 0.14, -s * 0.05, s * 0.2, s * 0.36);
      ctx.closePath();
    }, { x: -s * 0.2, y: -s * 0.24, w: s * 0.4, h: s * 0.6 }, p.trunk, { lineWidth: lw });

    cel(ctx, () => {
      ctx.beginPath();
      ctx.ellipse(0, -s * 0.32, s * 0.36, s * 0.24, 0, 0, TAU);
    }, { x: -s * 0.36, y: -s * 0.56, w: s * 0.72, h: s * 0.48 }, p.body, { lineWidth: lw });

    animeEyes(ctx, { x: 0, y: s * 0.02, gap: s * 0.17, w: s * 0.055, h: s * 0.06, glow: p.glow || '#ffe066', lw: s * 0.02 });
    mouth(ctx, { x: 0, y: s * 0.16, w: s * 0.16, h: s * 0.06, kind: 'frown', lw: s * 0.024, color: shade(p.trunk, -0.55) });
    ctx.restore();
  },

  /** 魔王。角・翼・大きな体。 */
  demon(ctx, p, s, t) {
    const lw = s * 0.034;
    const float = Math.sin(t * 1.7) * s * 0.02;
    const flap = Math.sin(t * 3) * 0.16;

    wing(ctx, -s * 0.16, float - s * 0.04, s * 0.52, s * 0.42, p.wing, lw, -1, flap);
    wing(ctx, s * 0.16, float - s * 0.04, s * 0.52, s * 0.42, p.wing, lw, 1, flap);

    cloak(ctx, 0, float + s * 0.16, s * 0.5, s * 0.5, p.cloth, lw, Math.sin(t * 2) * 0.05);

    // 胸あて
    celEllipse(ctx, 0, float + s * 0.02, s * 0.19, s * 0.14, shade(p.body, 0.1), lw, { gloss: false });

    const hy = float - s * 0.26;
    celEllipse(ctx, 0, hy, s * 0.17, s * 0.16, p.body, lw);
    horn(ctx, -s * 0.12, hy - s * 0.08, s * 0.26, s * 0.05, '#f1e2c4', lw * 0.9, -s * 0.08);
    horn(ctx, s * 0.12, hy - s * 0.08, s * 0.26, s * 0.05, '#f1e2c4', lw * 0.9, s * 0.08);

    animeEyes(ctx, { x: 0, y: hy, gap: s * 0.15, w: s * 0.05, h: s * 0.05, glow: p.glow || '#ffe066', lw: s * 0.022 });
    mouth(ctx, { x: 0, y: hy + s * 0.1, w: s * 0.14, h: s * 0.05, kind: 'fang', lw: s * 0.024 });
  },
};

// ---------------------------------------------------------------- 魔物ごとの見た目

export const ART = {
  slime: { paint: 'blob', body: '#5bd57f', eye: '#1f5b39', mood: 'cute', mouth: 'smile' },
  pup: { paint: 'beast', body: '#d9a066', eye: '#5a3b1c', mood: 'cute', mouth: 'fang' },
  rat: { paint: 'beast', body: '#a9a29a', eye: '#4a2b2b', thinTail: true, mood: 'fierce' },
  mush: { paint: 'mushroom', body: '#e8590c', eye: '#4b2b12', mood: 'calm' },
  bee: { paint: 'bug', body: '#ffd43b', eye: '#4a3a10', wings: true, stripes: true, stinger: true },
  frog: { paint: 'frog', body: '#74b816', eye: '#2f4a10' },
  goblin: { paint: 'humanoid', body: '#e07a5f', skin: '#8bbf5a', cloth: '#7a4b2a', ears: true, weapon: 'axe', eye: '#3d2a12' },
  bandit: { paint: 'humanoid', skin: '#e0b088', cloth: '#8a5a3a', hood: true, weapon: 'bow', eye: '#3b2412' },
  wolf: { paint: 'beast', body: '#9aa5b1', eye: '#c0392b', mood: 'fierce', mane: true },
  bat: { paint: 'flyer', body: '#868e96', eye: '#ffd166', ears: true, glow: '#ffd166' },
  mage: { paint: 'robed', cloth: '#5b3fa8', skin: '#e6d5bd', hat: true, hatColor: '#4a3390', eye: '#2b1d55', orb: '#b197fc' },
  armor: { paint: 'armor', body: '#adb5bd', glow: '#8fe3ff' },
  harpy: { paint: 'flyer', body: '#ced4da', eye: '#c92a2a', slowWings: false, tail: true },
  worm: { paint: 'worm', body: '#c0a080', eye: '#4a3520' },
  ogre: { paint: 'humanoid', skin: '#c2703d', cloth: '#5f4630', big: true, horns: true, weapon: 'axe', eye: '#3a1f10' },
  skeleton: { paint: 'humanoid', skin: '#e9ecef', cloth: '#495057', bone: true, weapon: 'sword', glow: '#8fe3ff' },
  ghost: { paint: 'ghost', body: '#a5d8ff', glow: '#e7f5ff', alpha: 0.85 },
  lizard: { paint: 'beast', body: '#82c91e', eye: '#c92a2a', spikes: true, mood: 'fierce' },
  spider: { paint: 'bug', body: '#495057', eye: '#ff6b6b', legs: true, mood: 'fierce' },
  lava: { paint: 'golem', body: '#7a3b22', molten: '#ff922b', glow: '#ffd43b' },
  golem: { paint: 'golem', body: '#8d99ae', glow: '#ffd166' },
  witch: { paint: 'robed', cloth: '#7b2d8b', skin: '#dcc7b0', hat: true, hatColor: '#5f1f6e', eye: '#3d1148', orb: '#da77f2' },
  reaper: { paint: 'ghost', body: '#3b3550', hood: '#241f36', scythe: true, glow: '#b197fc', alpha: 1 },
  knight: { paint: 'armor', body: '#6b3550', cape: '#8b1e3f', plume: '#f06595', glow: '#ff6b6b' },
  mask: { paint: 'humanoid', skin: '#c9b6d8', cloth: '#5a3d78', mask: '#e599f7', weapon: 'sword', glow: '#ffe066' },
  wyvern: { paint: 'flyer', body: '#748ffc', eye: '#ffd43b', snout: true, tail: true, horns: true, slowWings: true },
  dragon: { paint: 'flyer', body: '#69db7c', eye: '#ffd43b', snout: true, tail: true, horns: true, big: true, slowWings: true },
  golva: { paint: 'golem', body: '#adb5bd', glow: '#ff8787', crown: true },
  gald: { paint: 'armor', body: '#8a8f98', cape: '#3b3550', plume: '#ffa8a8', weapon: true, glow: '#ff6b6b' },
  yugd: { paint: 'tree', body: '#51cf66', trunk: '#8a6234', glow: '#ffe066' },
  valdes: { paint: 'robed', cloth: '#2b1d3f', skin: '#d6c4b0', orb: '#cc5de8', glow: '#e599f7' },
  darklord: { paint: 'demon', body: '#c0392b', cloth: '#2b1020', wing: '#4a1730', glow: '#ffe066' },
};

export const artOf = (id) => ART[id] || null;

/**
 * 魔物を 1 体描く。
 *   cx, cy … 足もとではなく 体の中心
 *   size  … おおよその背丈
 *   t     … 秒（待機モーション用）
 */
export function drawMonster(ctx, id, cx, cy, size, t = 0, { flash = 0, fade = 0 } = {}) {
  const art = ART[id];
  if (!art) return false;
  const painter = PAINTERS[art.paint];
  if (!painter) return false;

  ctx.save();
  ctx.translate(cx, cy);
  if (fade) ctx.globalAlpha = Math.max(0, 1 - fade);
  ctx.lineCap = 'round';
  painter(ctx, art, size, t);

  if (flash > 0) {
    // 攻撃を受けた瞬間だけ 白く光らせる
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = `rgba(255,255,255,${Math.min(0.85, flash)})`;
    ctx.fillRect(-size, -size, size * 2, size * 2);
  }
  ctx.restore();
  return true;
}
