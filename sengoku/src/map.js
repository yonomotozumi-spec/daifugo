/**
 * マス目の日本地図を canvas に描く。
 *
 *   createMap(canvas, { onSelect })  … onSelect(provinceId, [列, 段]) はマスをクリックしたとき
 *   map.update(state, view)          … 描き直す。view = { selected, targets, mode, cells, cellType, cell, todo }
 *   map.centerOn(provinceId)         … その国の城が真ん中に来るようにスクロール
 *   map.zoomBy(倍率)
 *
 * ドラッグでスクロール、ホイールやピンチで拡大縮小できる。
 */

import { LINKS, PROVINCES } from './data.js';
import {
  COLS, ROWS, castleOf, cellBuild, cellsOf, isCastle, provinceAt, terrainAt,
} from './land.js';

const SEA_ROUTES = LINKS.filter((l) => l[2] === 'sea');

const NEUTRAL = '#8d8f86';
const NAME = Object.fromEntries(PROVINCES.map((p) => [p.id, p.name]));
const FONT = '"Hiragino Sans", "Noto Sans JP", system-ui, sans-serif';

// マスごとの色むら（毎回同じになるように座標から決める）
const noise = (c, r) => {
  let h = (c * 73856093) ^ (r * 19349663);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (hex, a) => `rgba(${hexToRgb(hex).join(',')},${a})`;

export function createMap(canvas, { onSelect }) {
  const ctx = canvas.getContext('2d');
  let state = null;
  let view = {};
  let zoom = 1;          // 1 = 画面に全体が収まる
  let ox = 0;            // 左上のマスの画面上の位置（px）
  let oy = 0;
  let base = 8;          // zoom 1 のときの 1 マスの大きさ（px）
  let raf = 0;
  let animating = false;
  let dragging = null;
  let moved = false;
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

  // 海のうち陸に接するマス（浅瀬の色にする）
  const shallow = new Set();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (terrainAt(c, r) !== '~') continue;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (terrainAt(c + dc, r + dr) !== '~') shallow.add(`${c},${r}`);
      }
    }
  }

  const cell = () => base * zoom;

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    base = Math.min(w / COLS, h / ROWS);
    clampOffset();
    draw();
  }

  function clampOffset() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const mw = COLS * cell();
    const mh = ROWS * cell();
    // 地図が画面より小さい向きは中央に、大きい向きは端が余らないように
    ox = mw <= w ? (w - mw) / 2 : Math.min(0, Math.max(w - mw, ox));
    oy = mh <= h ? (h - mh) / 2 : Math.min(0, Math.max(h - mh, oy));
  }

  function cellAt(px, py) {
    const c = Math.floor((px - ox) / cell());
    const r = Math.floor((py - oy) / cell());
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return null;
    return [c, r];
  }

  // ------------------------------------------------------------ 描画

  function draw() {
    if (!canvas.width) return;
    const s = cell();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    // 海
    const sea = ctx.createLinearGradient(0, 0, 0, h);
    sea.addColorStop(0, '#2b5a78');
    sea.addColorStop(1, '#173a52');
    ctx.fillStyle = sea;
    ctx.fillRect(0, 0, w, h);

    const c0 = Math.max(0, Math.floor(-ox / s));
    const r0 = Math.max(0, Math.floor(-oy / s));
    const c1 = Math.min(COLS - 1, Math.ceil((w - ox) / s));
    const r1 = Math.min(ROWS - 1, Math.ceil((h - oy) / s));
    const owners = state ? state.provinces : null;
    const pick = view.cells ? new Set(view.cells.map(([c, r]) => `${c},${r}`)) : null;
    const targets = new Set(view.targets || []);

    // 浅瀬
    ctx.fillStyle = 'rgba(120, 190, 210, 0.35)';
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (shallow.has(`${c},${r}`)) ctx.fillRect(ox + c * s, oy + r * s, s + 0.5, s + 0.5);
      }
    }

    // 陸
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const t = terrainAt(c, r);
        if (t === '~') continue;
        const x = ox + c * s;
        const y = oy + r * s;
        const n = noise(c, r);
        const pid = provinceAt(c, r);
        const owner = owners && pid ? owners[pid].owner : null;
        const color = owner && state.daimyos[owner] ? state.daimyos[owner].color : NEUTRAL;
        const dim = view.mode && !targets.has(pid) && view.selected !== pid && !pick;

        // 地形の地色
        if (t === '.') ctx.fillStyle = `hsl(${78 + n * 14}, ${38 + n * 12}%, ${58 + n * 8}%)`;
        else if (t === 'f') ctx.fillStyle = `hsl(${100 + n * 16}, ${34 + n * 10}%, ${34 + n * 8}%)`;
        else ctx.fillStyle = `hsl(${30 + n * 12}, ${18 + n * 10}%, ${44 + n * 12}%)`;
        ctx.fillRect(x, y, s + 0.5, s + 0.5);

        // 所有者の色を薄くかぶせる
        ctx.fillStyle = rgba(color, owner ? 0.38 : 0.22);
        ctx.fillRect(x, y, s + 0.5, s + 0.5);

        // 山・森・田・町の絵
        if (s >= 6) {
          if (t === 'm') drawMountain(x, y, s, n);
          else if (t === 'f') drawForest(x, y, s, n);
          const b = state ? cellBuild(state, c, r) : null;
          if (b?.farm) drawFarm(x, y, s, b.farm);
          if (b?.town) drawTown(x, y, s, b.town, n);
        }
        if (dim) {
          ctx.fillStyle = 'rgba(10, 20, 30, 0.45)';
          ctx.fillRect(x, y, s + 0.5, s + 0.5);
        }
        if (pick && pick.has(`${c},${r}`)) {
          ctx.fillStyle = view.cellType === 'farm' ? 'rgba(255, 235, 120, 0.45)' : 'rgba(255, 170, 120, 0.45)';
          ctx.fillRect(x, y, s + 0.5, s + 0.5);
          ctx.strokeStyle = '#fff3a8';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(x + 1, y + 1, s - 2, s - 2);
        }
      }
    }

    // 国境
    ctx.lineWidth = Math.max(1, s * 0.12);
    ctx.strokeStyle = 'rgba(40, 30, 20, 0.55)';
    ctx.beginPath();
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const pid = provinceAt(c, r);
        if (!pid) continue;
        const x = ox + c * s;
        const y = oy + r * s;
        if (provinceAt(c + 1, r) && provinceAt(c + 1, r) !== pid) { ctx.moveTo(x + s, y); ctx.lineTo(x + s, y + s); }
        if (provinceAt(c, r + 1) && provinceAt(c, r + 1) !== pid) { ctx.moveTo(x, y + s); ctx.lineTo(x + s, y + s); }
      }
    }
    ctx.stroke();

    // 海路
    ctx.setLineDash([s * 0.5, s * 0.5]);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = Math.max(1, s * 0.15);
    ctx.beginPath();
    for (const [a, b] of SEA_ROUTES) {
      const [ac, ar] = castleOf(a);
      const [bc, br] = castleOf(b);
      ctx.moveTo(ox + (ac + 0.5) * s, oy + (ar + 0.5) * s);
      ctx.lineTo(ox + (bc + 0.5) * s, oy + (br + 0.5) * s);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // 選んでいる国・行き先の国のふちどり
    if (view.selected) outline(view.selected, '#ffd75e', Math.max(2, s * 0.25), false);
    for (const pid of targets) outline(pid, '#fff3a8', Math.max(2, s * 0.25), true);

    // 城・国名・兵数
    if (state) {
      for (const p of PROVINCES) {
        const [cc, cr] = castleOf(p.id);
        if (cc < c0 - 4 || cc > c1 + 4 || cr < r0 - 3 || cr > r1 + 3) continue;
        drawCastle(p.id, ox + cc * s, oy + cr * s, s, targets.has(p.id));
      }
    }

    // 選んでいるマス
    if (view.cell) {
      const [c, r] = view.cell;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.strokeRect(ox + c * s + 1, oy + r * s + 1, s - 2, s - 2);
    }
  }

  function outline(pid, color, width, dashed) {
    const s = cell();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dashed ? [s * 0.6, s * 0.4] : []);
    ctx.lineDashOffset = dashed ? -(performance.now() / 40) % s : 0;
    ctx.beginPath();
    for (const [c, r] of cellsOf(pid)) {
      const x = ox + c * s;
      const y = oy + r * s;
      if (provinceAt(c + 1, r) !== pid) { ctx.moveTo(x + s, y); ctx.lineTo(x + s, y + s); }
      if (provinceAt(c - 1, r) !== pid) { ctx.moveTo(x, y); ctx.lineTo(x, y + s); }
      if (provinceAt(c, r + 1) !== pid) { ctx.moveTo(x, y + s); ctx.lineTo(x + s, y + s); }
      if (provinceAt(c, r - 1) !== pid) { ctx.moveTo(x, y); ctx.lineTo(x + s, y); }
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawMountain(x, y, s, n) {
    ctx.fillStyle = `hsl(${28 + n * 10}, 16%, ${30 + n * 8}%)`;
    ctx.beginPath();
    ctx.moveTo(x + s * 0.1, y + s * 0.9);
    ctx.lineTo(x + s * (0.4 + n * 0.2), y + s * (0.15 + n * 0.1));
    ctx.lineTo(x + s * 0.9, y + s * 0.9);
    ctx.closePath();
    ctx.fill();
    if (s >= 10) {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath();
      ctx.moveTo(x + s * (0.4 + n * 0.2), y + s * (0.15 + n * 0.1));
      ctx.lineTo(x + s * (0.5 + n * 0.2), y + s * 0.35);
      ctx.lineTo(x + s * (0.3 + n * 0.2), y + s * 0.35);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawForest(x, y, s, n) {
    ctx.fillStyle = `hsl(${112 + n * 14}, 40%, ${26 + n * 6}%)`;
    const k = 2 + Math.floor(n * 2);
    for (let i = 0; i < k; i++) {
      const px = x + s * (0.25 + ((i * 0.37 + n * 0.5) % 0.55));
      const py = y + s * (0.3 + ((i * 0.53 + n * 0.3) % 0.5));
      ctx.beginPath();
      ctx.arc(px, py, s * 0.16, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawFarm(x, y, s, level) {
    ctx.fillStyle = level >= 3 ? '#e9d55a' : level === 2 ? '#cfd05a' : '#a9c95c';
    ctx.fillRect(x + s * 0.12, y + s * 0.12, s * 0.76, s * 0.76);
    ctx.strokeStyle = 'rgba(80, 90, 30, 0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i <= level + 1; i++) {
      const yy = y + s * (0.12 + (0.76 * i) / (level + 2));
      ctx.moveTo(x + s * 0.14, yy);
      ctx.lineTo(x + s * 0.86, yy);
    }
    ctx.stroke();
  }

  function drawTown(x, y, s, level, n) {
    const houses = level + 1;
    for (let i = 0; i < houses; i++) {
      const hx = x + s * (0.12 + ((i * 0.31 + n * 0.2) % 0.6));
      const hy = y + s * (0.18 + ((i * 0.47 + n * 0.4) % 0.5));
      const hw = s * 0.3;
      ctx.fillStyle = '#f0e6d0';
      ctx.fillRect(hx, hy + hw * 0.4, hw, hw * 0.5);
      ctx.fillStyle = level >= 3 ? '#6b3a2e' : '#8a4b3a';
      ctx.beginPath();
      ctx.moveTo(hx - hw * 0.1, hy + hw * 0.45);
      ctx.lineTo(hx + hw * 0.5, hy);
      ctx.lineTo(hx + hw * 1.1, hy + hw * 0.45);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawCastle(pid, x, y, s, isTarget) {
    const p = state.provinces[pid];
    const owner = p.owner ? state.daimyos[p.owner] : null;
    const color = owner ? owner.color : NEUTRAL;
    const mine = p.owner === state.player;
    const cx = x + s / 2;
    const cy = y + s / 2;
    const size = Math.max(11, Math.min(28, s * 1.8));

    // 城（石垣 + 天守）
    ctx.fillStyle = '#5b5148';
    ctx.fillRect(cx - size * 0.45, cy - size * 0.05, size * 0.9, size * 0.35);
    ctx.fillStyle = '#f4efe4';
    ctx.fillRect(cx - size * 0.3, cy - size * 0.4, size * 0.6, size * 0.4);
    ctx.fillStyle = '#2f3a4a';
    ctx.beginPath();
    ctx.moveTo(cx - size * 0.42, cy - size * 0.38);
    ctx.lineTo(cx, cy - size * 0.68);
    ctx.lineTo(cx + size * 0.42, cy - size * 0.38);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(cx - size * 0.36, cy - size * 0.2, size * 0.72, size * 0.05);
    // 旗
    ctx.fillStyle = '#3a2f22';
    ctx.fillRect(cx + size * 0.32, cy - size * 0.95, 1.5, size * 0.6);
    ctx.fillStyle = color;
    ctx.fillRect(cx + size * 0.34, cy - size * 0.95, size * 0.32, size * 0.24);
    if (mine) {
      ctx.strokeStyle = '#ffd75e';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(cx + size * 0.34, cy - size * 0.95, size * 0.32, size * 0.24);
    }

    // 城名と兵数（縮小しているときは選んでいる城と行き先だけ）
    const showLabel = s >= 7 || isTarget || view.selected === pid || mine;
    if (!showLabel) return;
    const font = Math.max(10, Math.min(15, s * 1.1));
    ctx.font = `700 ${font}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = NAME[pid];
    const ly = cy - size * 0.78 - font * 0.6;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(20, 16, 12, 0.85)';
    ctx.strokeText(label, cx, ly);
    ctx.fillStyle = isTarget ? '#fff3a8' : view.selected === pid ? '#ffd75e' : '#ffffff';
    ctx.fillText(label, cx, ly);

    const sub = `${p.soldiers.toLocaleString('ja-JP')}`;
    const sf = Math.max(9, font * 0.8);
    ctx.font = `600 ${sf}px ${FONT}`;
    const tw = ctx.measureText(sub).width + 8;
    const sy = cy + size * 0.32 + sf * 0.7;
    ctx.fillStyle = 'rgba(20, 16, 12, 0.8)';
    roundRect(cx - tw / 2, sy - sf * 0.65, tw, sf * 1.3, sf * 0.65);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(sub, cx, sy);

    // 命令がまだ残っている印（金の点）
    if (mine && view.todo && view.todo.has(pid)) {
      ctx.fillStyle = '#ffd75e';
      ctx.strokeStyle = '#3a2f22';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx - size * 0.55, cy - size * 0.85, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; draw(); if (animating) schedule(); });
  }

  // ------------------------------------------------------------ 操作

  function zoomAt(factor, px, py) {
    const before = cell();
    zoom = Math.max(1, Math.min(8, zoom * factor));
    const after = cell();
    // マウスの下のマスがずれないように
    ox = px - ((px - ox) / before) * after;
    oy = py - ((py - oy) / before) * after;
    clampOffset();
    schedule();
  }

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false });

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    dragging = { x: e.clientX, y: e.clientY, ox, oy };
    moved = false;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging || pinch) return;
    const dx = e.clientX - dragging.x;
    const dy = e.clientY - dragging.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
    ox = dragging.ox + dx;
    oy = dragging.oy + dy;
    clampOffset();
    schedule();
  });
  const endDrag = (e) => {
    if (!dragging) return;
    dragging = null;
    if (moved) return;
    const rect = canvas.getBoundingClientRect();
    const hit = cellAt(e.clientX - rect.left, e.clientY - rect.top);
    if (!hit) return;
    const pid = provinceAt(hit[0], hit[1]);
    if (pid) onSelect(pid, hit);
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', () => { dragging = null; });

  // ピンチ
  let pinch = null;
  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      pinch = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      dragging = null;
    }
  }, { passive: true });
  canvas.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && pinch) {
      e.preventDefault();
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      const rect = canvas.getBoundingClientRect();
      const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
      const my = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
      zoomAt(d / pinch, mx, my);
      pinch = d;
    }
  }, { passive: false });
  canvas.addEventListener('touchend', () => { pinch = null; }, { passive: true });

  window.addEventListener('resize', resize);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(canvas);
  resize();

  return {
    update(nextState, nextView) {
      state = nextState;
      view = nextView;
      animating = Boolean(view.targets && view.targets.length);
      schedule();
    },
    centerOn(pid) {
      const [c, r] = castleOf(pid);
      const s = cell();
      ox = canvas.clientWidth / 2 - (c + 0.5) * s;
      oy = canvas.clientHeight / 2 - (r + 0.5) * s;
      clampOffset();
      schedule();
    },
    zoomBy(factor) { zoomAt(factor, canvas.clientWidth / 2, canvas.clientHeight / 2); },
    setZoom(z) { zoom = 1; zoomAt(z, canvas.clientWidth / 2, canvas.clientHeight / 2); },
    get zoom() { return zoom; },
    isCastleCell: isCastle,
  };
}
