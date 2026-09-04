/**
 * マス目の土地（田・町）のルール。地図そのものは mapdata.js（自動生成）にある。
 *
 *   state.cells["列,段"] = { farm: 0-3, town: 0-3 }   … 何か建っているマスだけ入っている
 *   国の農業・商業は、田・町のレベルの合計から計算する（refreshProvince）
 */

import { CASTLES, COLS, PROVINCE, PROVINCE_ORDER, ROWS, TERRAIN } from './mapdata.js';
import { PROVINCES } from './data.js';

export { COLS, ROWS };

export const MAX_LEVEL = 3;
export const BASE_STAT = 10;       // 田も町もないときの農業・商業
export const LEVEL_STAT = 8;       // 田・町 1 レベルあたりの農業・商業
export const TERRAIN_NAME = { '.': '平地', f: '森', m: '山', '~': '海' };

export const key = (c, r) => `${c},${r}`;
export const parseKey = (k) => k.split(',').map(Number);
export const terrainAt = (c, r) => (r < 0 || r >= ROWS || c < 0 || c >= COLS ? '~' : TERRAIN[r][c]);
export function provinceAt(c, r) {
  const ch = PROVINCE[r]?.[c];
  return !ch || ch === '~' ? null : PROVINCE_ORDER[ch.charCodeAt(0) - 65];
}
export const castleOf = (pid) => CASTLES[pid];
export const isCastle = (c, r) => {
  const pid = provinceAt(c, r);
  return Boolean(pid) && CASTLES[pid][0] === c && CASTLES[pid][1] === r;
};

const CELLS = {};
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const pid = provinceAt(c, r);
    if (pid) (CELLS[pid] ||= []).push([c, r]);
  }
}
/** 国に属するマスの一覧 [[列, 段], ...] */
export const cellsOf = (pid) => CELLS[pid] || [];

export function neighbors8(c, r) {
  const out = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr || dc) out.push([c + dc, r + dr]);
    }
  }
  return out;
}

export const cellBuild = (state, c, r) => state.cells[key(c, r)] || null;
/** そのマスに田か町を建てられる地形か */
export const buildable = (c, r) => (terrainAt(c, r) === '.' || terrainAt(c, r) === 'f') && !isCastle(c, r);

/** 田や町は、城か すでにある田・町の隣にしか作れない（城下から広がっていく） */
function connected(state, c, r, pid) {
  return neighbors8(c, r).some(([nc, nr]) => provinceAt(nc, nr) === pid && (isCastle(nc, nr) || cellBuild(state, nc, nr)));
}

/**
 * 命令できるマスの一覧。type は 'farm'（開墾）か 'town'（まちづくり）。
 * まだ何もないマス（つながっている所）と、同じ種類でレベルが上げられるマス。
 */
export function eligibleCells(state, pid, type) {
  const other = type === 'farm' ? 'town' : 'farm';
  const out = [];
  for (const [c, r] of cellsOf(pid)) {
    if (!buildable(c, r)) continue;
    const b = cellBuild(state, c, r);
    if (b && b[other]) continue;
    if (b && b[type] >= MAX_LEVEL) continue;
    if (!b && !connected(state, c, r, pid)) continue;
    out.push([c, r]);
  }
  return out;
}

/** 開墾・まちづくりの金の費用。レベルが上がるほど高く、森を切り開くときは少し高い */
export function buildCost(state, c, r, type) {
  const b = cellBuild(state, c, r);
  const level = b ? b[type] || 0 : 0;
  return 30 + level * 20 + (level === 0 && terrainAt(c, r) === 'f' ? 15 : 0);
}

/** 田・町を 1 レベル上げる。戻り値は新しいレベル */
export function raiseCell(state, c, r, type) {
  const k = key(c, r);
  const b = state.cells[k] || (state.cells[k] = { farm: 0, town: 0 });
  b[type] = Math.min(MAX_LEVEL, (b[type] || 0) + 1);
  refreshProvince(state, provinceAt(c, r));
  return b[type];
}

export function landSummary(state, pid) {
  const s = { cells: 0, plain: 0, forest: 0, mountain: 0, farmCells: 0, townCells: 0, farm: 0, town: 0, buildable: 0, maxLevels: 0 };
  for (const [c, r] of cellsOf(pid)) {
    s.cells++;
    const t = terrainAt(c, r);
    if (t === '.') s.plain++;
    else if (t === 'f') s.forest++;
    else if (t === 'm') s.mountain++;
    if (buildable(c, r)) s.buildable++;
    const b = cellBuild(state, c, r);
    if (b?.farm) { s.farmCells++; s.farm += b.farm; }
    if (b?.town) { s.townCells++; s.town += b.town; }
  }
  s.maxLevels = s.buildable * MAX_LEVEL;
  return s;
}

/** 田・町のレベルから国の農業・商業を計算し直す */
export function refreshProvince(state, pid) {
  const p = state.provinces[pid];
  if (!p) return;
  const s = landSummary(state, pid);
  p.agri = BASE_STAT + s.farm * LEVEL_STAT;
  p.comm = BASE_STAT + s.town * LEVEL_STAT;
}

/** 農業・商業の上限（建てられるマスがすべて最高レベルになったとき） */
export function statMax(pid) {
  let n = 0;
  for (const [c, r] of cellsOf(pid)) if (buildable(c, r)) n++;
  return BASE_STAT + Math.ceil(n / 2) * MAX_LEVEL * LEVEL_STAT;
}

/**
 * ゲーム開始時の田と町。data.js の農業・商業の値に近づくように、城の近くから順に置く。
 */
export function seedLand(state) {
  state.cells = {};
  for (const p of PROVINCES) {
    const targetFarm = Math.max(0, Math.round((p.agri - BASE_STAT) / LEVEL_STAT));
    const targetTown = Math.max(0, Math.round((p.comm - BASE_STAT) / LEVEL_STAT));
    // 城から近い順（平地を先に）
    const [cx, cy] = castleOf(p.id);
    const order = cellsOf(p.id)
      .filter(([c, r]) => buildable(c, r))
      .sort((a, b) => {
        const da = Math.hypot(a[0] - cx, a[1] - cy) + (terrainAt(a[0], a[1]) === 'f' ? 0.75 : 0);
        const db = Math.hypot(b[0] - cx, b[1] - cy) + (terrainAt(b[0], b[1]) === 'f' ? 0.75 : 0);
        return da - db;
      });
    let farm = targetFarm;
    let town = targetTown;
    let i = 0;
    while ((farm > 0 || town > 0) && i < order.length) {
      const [c, r] = order[i++];
      // 田と町を交互に。城のすぐ隣は町にする
      const wantTown = town > 0 && (farm <= 0 || i % 2 === 0);
      const type = wantTown ? 'town' : 'farm';
      const lv = Math.min(MAX_LEVEL, type === 'farm' ? farm : town, 2);
      state.cells[key(c, r)] = { farm: type === 'farm' ? lv : 0, town: type === 'town' ? lv : 0 };
      if (type === 'farm') farm -= lv; else town -= lv;
    }
    refreshProvince(state, p.id);
  }
}
