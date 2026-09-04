/**
 * 戦国シミュレーションの進行ルール（DOM 非依存。Node からも読める）。
 *
 *   createGame()   … 大名を選んで新しいゲームを作る
 *   commandList()  … 武将が今できるコマンドと、できない理由
 *   execute()      … コマンドを実行する（出陣だけは戦闘オブジェクトを返す）
 *   battleRound() / battleRetreat() … 戦闘を 1 合戦ずつ進める
 *   advanceMonth() … 月を進める（収入・収穫・一揆など）
 *
 * 乱数は state.rng に入った 32bit 整数から作るので、保存して読み直しても同じ結果になる。
 */

import {
  COST, DAIMYOS, GENERALS, LIMIT, LINKS, LORD_LEAD, PROVINCES, RANKS, START_MONTH, START_YEAR, initialRank,
} from './data.js';
import {
  MAX_LEVEL, buildCost, cellBuild, eligibleCells, key as cellKey, provinceAt, raiseCell, seedLand, terrainAt,
} from './land.js';

export { COST, LIMIT, RANKS };
export * from './land.js';

// ------------------------------------------------------------------ 乱数

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 0 以上 1 未満の乱数。state.rng を進める。 */
export function rand(state) {
  state.rng = (state.rng + 0x6d2b79f5) >>> 0;
  let t = state.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const randInt = (state, lo, hi) => lo + Math.floor(rand(state) * (hi - lo + 1));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ------------------------------------------------------------------ 地図

const ADJ = {};
const SEA = new Set();
for (const p of PROVINCES) ADJ[p.id] = [];
for (const [a, b, kind] of LINKS) {
  ADJ[a].push(b);
  ADJ[b].push(a);
  if (kind === 'sea') { SEA.add(`${a}:${b}`); SEA.add(`${b}:${a}`); }
}

export const adjacent = (id) => ADJ[id] || [];
export const isSeaRoute = (a, b) => SEA.has(`${a}:${b}`);
export const provinceName = (id) => PROVINCES.find((p) => p.id === id)?.name ?? id;

// ------------------------------------------------------------------ 生成

export function createGame({ player, seed = Date.now() % 2147483647 } = {}) {
  if (!DAIMYOS.some((d) => d.id === player)) throw new Error(`unknown daimyo: ${player}`);

  const provinces = {};
  for (const p of PROVINCES) {
    provinces[p.id] = {
      id: p.id, name: p.name, owner: p.owner,
      agri: p.agri, comm: p.comm, defense: p.defense, soldiers: p.soldiers,
      loyalty: p.owner ? 65 : 55, training: 50,
      commands: 0, // 今月この国で使った命令の数
    };
  }

  const daimyos = {};
  for (const d of DAIMYOS) {
    daimyos[d.id] = {
      id: d.id, name: d.name, color: d.color, capital: d.capital,
      gold: d.gold, rice: d.rice, alive: true,
      friendship: {}, // 相手の大名 id → 0..100
      alliance: {},   // 相手の大名 id → 同盟が切れる turn
    };
  }
  for (const a of DAIMYOS) for (const b of DAIMYOS) if (a !== b) daimyos[a.id].friendship[b.id] = 30;
  // 史実の盟友は最初から仲がよい
  const friends = [['azai', 'asakura', 80], ['takeda', 'imagawa', 60], ['hojo', 'imagawa', 60], ['takeda', 'hojo', 55]];
  for (const [a, b, v] of friends) { daimyos[a].friendship[b] = v; daimyos[b].friendship[a] = v; }

  const generals = {};
  for (const g of GENERALS) {
    // 登場年が先の武将は「未登場」。大名のいない武将は「在野」
    const status = g.appear && g.appear > START_YEAR ? 'unborn' : g.daimyo ? 'active' : 'ronin';
    generals[g.id] = { ...g, homeDaimyo: g.daimyo, acted: false, status, merit: 0 };
  }

  const state = {
    version: 2,
    seed, rng: seed >>> 0,
    player, year: START_YEAR, month: START_MONTH, turn: 0,
    provinces, daimyos, generals, cells: {},
    log: [], report: [], ended: null,
  };
  seedLand(state);
  return state;
}

// ------------------------------------------------------------------ 参照

export const provincesOf = (state, daimyoId) => Object.values(state.provinces).filter((p) => p.owner === daimyoId);
export const generalsOf = (state, daimyoId) => Object.values(state.generals).filter((g) => g.daimyo === daimyoId && g.status === 'active');
export const generalsIn = (state, provinceId) => Object.values(state.generals).filter((g) => g.province === provinceId && g.status === 'active');
export const lordOf = (state, daimyoId) => generalsOf(state, daimyoId).find((g) => g.lord) || null;
export const roninIn = (state, provinceId) => Object.values(state.generals).filter((g) => g.province === provinceId && g.status === 'ronin');
export const rankName = (g) => (g.lord ? '当主' : RANKS[g.rank]?.name ?? '足軽頭');
/** 率いて出陣・移動できる兵の上限 */
export const leadCap = (g) => (g.lord ? LORD_LEAD : RANKS[g.rank]?.lead ?? RANKS[0].lead);
/** その国で今月あと何回命令できるか */
export const commandsLeft = (state, provinceId) => Math.max(0, LIMIT.commandsPerProvince - (state.provinces[provinceId]?.commands ?? 0));
export const aliveDaimyos = (state) => Object.values(state.daimyos).filter((d) => d.alive);

export function isAllied(state, a, b) {
  if (!a || !b || a === b) return false;
  const until = state.daimyos[a]?.alliance?.[b];
  return until != null && until > state.turn;
}

export const dateLabel = (state) => `${state.year}年${state.month}月`;

function pushLog(state, text, kind = 'info', { daimyos = [] } = {}) {
  const entry = { turn: state.turn, date: dateLabel(state), text, kind };
  state.log.push(entry);
  if (state.log.length > 200) state.log.splice(0, state.log.length - 200);
  if (daimyos.includes(state.player)) state.report.push(entry);
  return entry;
}

/** 大名家の強さの目安（大名一覧の並べ替え用） */
export function daimyoSummary(state, id) {
  const ps = provincesOf(state, id);
  const gs = generalsOf(state, id);
  return {
    id, name: state.daimyos[id].name, color: state.daimyos[id].color, alive: state.daimyos[id].alive,
    provinces: ps.length,
    soldiers: ps.reduce((s, p) => s + p.soldiers, 0),
    generals: gs.length,
    gold: state.daimyos[id].gold, rice: state.daimyos[id].rice,
    lord: lordOf(state, id)?.name ?? '—',
    score: ps.length * 1000 + ps.reduce((s, p) => s + p.soldiers, 0) / 10 + gs.length * 100,
  };
}

// ------------------------------------------------------------------ 戦力

const fightStat = (g) => (g ? g.lead * 0.6 + g.valor * 0.4 : 55);

/** 兵数 × 訓練 × 大将の能力 で決まる攻撃側の戦力 */
export function attackPower(soldiers, general, training) {
  return soldiers * (1 + training / 200) * (1 + fightStat(general) / 200);
}

/** 国を守る側の戦力。城の防御が上乗せされる。 */
export function defensePower(state, provinceId) {
  const p = state.provinces[provinceId];
  const best = bestGeneral(generalsIn(state, provinceId));
  return attackPower(p.soldiers, best, p.training) * (1 + p.defense / 150);
}

export function bestGeneral(list) {
  let best = null;
  for (const g of list) if (!best || fightStat(g) > fightStat(best)) best = g;
  return best;
}

// ------------------------------------------------------------------ コマンド

export const COMMANDS = [
  { type: 'develop', label: '開墾', icon: '🌾', desc: 'マスを選んで田を作る・田のレベルを上げる。秋の米の収穫が増える' },
  { type: 'commerce', label: 'まちづくり', icon: '🏘️', desc: 'マスを選んで町を作る・町のレベルを上げる。毎月の金の収入が増える' },
  { type: 'fortify', label: '築城', icon: '🏯', desc: '城の防御を上げる。攻められたときに強い' },
  { type: 'recruit', label: '徴兵', icon: '🪖', desc: '金で兵を集める。民忠が少し下がる' },
  { type: 'train', label: '訓練', icon: '⚔️', desc: '兵の訓練度を上げる。戦で強くなる' },
  { type: 'charity', label: '施し', icon: '🍙', desc: '米を配って民忠を上げる。一揆を防ぐ' },
  { type: 'move', label: '移動', icon: '🐎', desc: '隣の自国へ武将と兵を動かす' },
  { type: 'march', label: '出陣', icon: '🔥', desc: '隣の他国へ攻め込む' },
  { type: 'explore', label: '探索', icon: '🔍', desc: '国の中を探して在野の武将を見つけ、家臣に誘う' },
  { type: 'goodwill', label: '親善', icon: '🎁', desc: '他の大名に贈り物をして友好を上げる' },
  { type: 'alliance', label: '同盟', icon: '🤝', desc: '友好の高い大名と同盟を結ぶ。互いに攻められなくなる' },
];

const recruitAmount = (g) => 300 + g.lead * 5;
const developGain = (g) => 2 + Math.floor(g.pol / 15);

/** 武将が今できるコマンド一覧。enabled が false のときは reason に理由が入る。 */
export function commandList(state, generalId) {
  const g = state.generals[generalId];
  const d = state.daimyos[g.daimyo];
  const p = state.provinces[g.province];
  const out = [];
  const noBudget = commandsLeft(state, p.id) <= 0;
  const add = (type, ok, reason = '', extra = {}) => {
    const def = COMMANDS.find((c) => c.type === type);
    const blocked = g.acted ? '今月はもう行動した' : noBudget ? `この国で出せる命令は月 ${LIMIT.commandsPerProvince} 回まで` : '';
    out.push({ ...def, enabled: ok && !blocked, reason: blocked || (ok ? '' : reason), ...extra });
  };
  const cap = Math.min(p.soldiers, leadCap(g));
  const nbOwn = adjacent(p.id).filter((id) => state.provinces[id].owner === g.daimyo);
  const nbEnemy = adjacent(p.id).filter((id) => state.provinces[id].owner !== g.daimyo && !isAllied(state, g.daimyo, state.provinces[id].owner));
  const recruits = Math.min(recruitAmount(g), LIMIT.soldiersPerProvince - p.soldiers);
  const recruitCost = Math.ceil(recruits / 100) * COST.recruitPer100;

  const farmCells = eligibleCells(state, p.id, 'farm');
  const townCells = eligibleCells(state, p.id, 'town');
  const cheapest = (cells, type) => cells.reduce((m, [c, r]) => Math.min(m, buildCost(state, c, r, type)), Infinity);
  add('develop', farmCells.length > 0 && d.gold >= cheapest(farmCells, 'farm'),
    farmCells.length === 0 ? '田を作れるマスがない' : `金が足りない（${cheapest(farmCells, 'farm')} 必要）`,
    { cost: `金${farmCells.length ? cheapest(farmCells, 'farm') : COST.develop}〜`, effect: `田のレベル +1（農業 +${developGain(g)}）`, cells: farmCells.filter(([c, r]) => d.gold >= buildCost(state, c, r, 'farm')), cellType: 'farm' });
  add('commerce', townCells.length > 0 && d.gold >= cheapest(townCells, 'town'),
    townCells.length === 0 ? '町を作れるマスがない' : `金が足りない（${cheapest(townCells, 'town')} 必要）`,
    { cost: `金${townCells.length ? cheapest(townCells, 'town') : COST.develop}〜`, effect: `町のレベル +1（商業 +${developGain(g)}）`, cells: townCells.filter(([c, r]) => d.gold >= buildCost(state, c, r, 'town')), cellType: 'town' });
  add('fortify', d.gold >= COST.fortify && p.defense < LIMIT.defense, d.gold < COST.fortify ? `金が足りない（${COST.fortify} 必要）` : '防御はもう最大', { cost: `金${COST.fortify}`, effect: `防御 +${developGain(g)}` });
  add('recruit', d.gold >= recruitCost && p.loyalty >= 30 && recruits > 0,
    p.loyalty < 30 ? '民忠が低すぎて兵が集まらない（30 以上必要）' : recruits <= 0 ? '兵はもう上限' : `金が足りない（${recruitCost} 必要）`,
    { cost: `金${recruitCost}`, effect: `兵 +${recruits}` });
  add('train', p.training < LIMIT.training, '訓練度はもう最大', { cost: 'なし', effect: `訓練 +${4 + Math.floor(g.lead / 10)}` });
  add('charity', d.rice >= COST.charity && p.loyalty < LIMIT.loyalty, d.rice < COST.charity ? `米が足りない（${COST.charity} 必要）` : '民忠はもう最大', { cost: `米${COST.charity}`, effect: `民忠 +${5 + Math.floor(g.pol / 10)}` });
  add('move', nbOwn.length > 0, '隣に自分の国がない', { cost: 'なし', effect: `兵を最大 ${cap} 連れて移る`, targets: nbOwn, maxSoldiers: cap });
  add('march', nbEnemy.length > 0 && p.soldiers >= 100 && d.rice >= COST.marchRicePer100,
    nbEnemy.length === 0 ? '隣に攻められる国がない' : p.soldiers < 100 ? '兵が足りない' : '米が足りない',
    { cost: `米 100人ごとに${COST.marchRicePer100}`, effect: `最大 ${cap} の兵で攻める`, targets: nbEnemy, maxSoldiers: cap });
  add('explore', d.gold >= COST.explore, `金が足りない（${COST.explore} 必要）`, { cost: `金${COST.explore}`, effect: roninIn(state, p.id).length ? '在野の武将がいそうだ' : '手がかりはなさそうだ' });
  const others = aliveDaimyos(state).filter((o) => o.id !== g.daimyo);
  add('goodwill', d.gold >= COST.goodwill && others.length > 0, `金が足りない（${COST.goodwill} 必要）`, { cost: `金${COST.goodwill}`, effect: `友好 +${5 + Math.floor(g.pol / 10)}` });
  const allianceTargets = others.filter((o) => d.friendship[o.id] >= 60 && !isAllied(state, g.daimyo, o.id));
  add('alliance', d.gold >= COST.alliance && allianceTargets.length > 0,
    d.gold < COST.alliance ? `金が足りない（${COST.alliance} 必要）` : '友好が 60 以上の大名がいない',
    { cost: `金${COST.alliance}`, effect: '24 か月の同盟', targets: allianceTargets.map((o) => o.id) });
  return out;
}

/**
 * コマンドを実行する。
 *   { type, general, target?, soldiers?, daimyo? }
 * 戻り値は { ok, text, battle? }。出陣のときは battle を返し、呼び出し側が
 * battleRound() / battleRetreat() で決着まで進める。
 */
export function execute(state, cmd) {
  const g = state.generals[cmd.general];
  if (!g || g.status !== 'active') return { ok: false, text: 'その武将は動けない' };
  if (g.acted) return { ok: false, text: `${g.name}は今月はもう行動した` };
  const d = state.daimyos[g.daimyo];
  const p = state.provinces[g.province];
  if (commandsLeft(state, p.id) <= 0) return { ok: false, text: `${p.name}で出せる命令は月 ${LIMIT.commandsPerProvince} 回まで` };
  const who = [g.daimyo];
  const fail = (text) => ({ ok: false, text });
  /** 行動を確定する：武将は行動済み、国の命令を 1 つ使い、功績を加える */
  const done = (merit) => { g.acted = true; p.commands++; addMerit(state, g, merit); };

  switch (cmd.type) {
    case 'develop':
    case 'commerce': {
      const type = cmd.type === 'develop' ? 'farm' : 'town';
      const label = type === 'farm' ? '田' : '町';
      const cells = eligibleCells(state, p.id, type);
      let [c, r] = cmd.cell || [];
      if (cmd.cell == null) {
        // マスを指定しないときは、いちばん安いマス（CPU 用）
        if (!cells.length) return fail(`${label}を作れるマスがない`);
        [c, r] = cells.reduce((m, x) => (buildCost(state, x[0], x[1], type) < buildCost(state, m[0], m[1], type) ? x : m));
      }
      if (!cells.some(([cc, rr]) => cc === c && rr === r)) return fail(`そのマスには${label}を作れない`);
      const cost = buildCost(state, c, r, type);
      if (d.gold < cost) return fail(`金が足りない（${cost} 必要）`);
      d.gold -= cost;
      const before = type === 'farm' ? p.agri : p.comm;
      const level = raiseCell(state, c, r, type);
      // 政治が高い武将ほど、同じ費用で余分に伸びる
      const bonus = Math.max(0, developGain(g) - 8);
      if (type === 'farm') p.agri += bonus; else p.comm += bonus;
      const gain = (type === 'farm' ? p.agri : p.comm) - before;
      done(2);
      const where = terrainAt(c, r) === 'f' && level === 1 ? '森を切り開いて' : '';
      return {
        ok: true, cell: [c, r], level,
        text: pushLog(state, `${g.name}が${p.name}で${where}${label}をレベル ${level} にした（${type === 'farm' ? '農業' : '商業'} +${gain}）`, 'info', { daimyos: who }).text,
      };
    }
    case 'fortify': {
      if (d.gold < COST.fortify) return fail('金が足りない');
      if (p.defense >= LIMIT.defense) return fail('防御はもう最大');
      d.gold -= COST.fortify;
      const gain = Math.min(developGain(g), LIMIT.defense - p.defense);
      p.defense += gain;
      done(2);
      return { ok: true, text: pushLog(state, `${g.name}が${p.name}の城を固めた（防御 +${gain}）`, 'info', { daimyos: who }).text };
    }
    case 'recruit': {
      const n = Math.min(recruitAmount(g), LIMIT.soldiersPerProvince - p.soldiers);
      const cost = Math.ceil(n / 100) * COST.recruitPer100;
      if (n <= 0) return fail('兵はもう上限');
      if (p.loyalty < 30) return fail('民忠が低すぎる');
      if (d.gold < cost) return fail('金が足りない');
      d.gold -= cost;
      p.soldiers += n;
      p.loyalty = clamp(p.loyalty - 4, 0, LIMIT.loyalty);
      done(2);
      return { ok: true, text: pushLog(state, `${g.name}が${p.name}で兵を集めた（兵 +${n}）`, 'info', { daimyos: who }).text };
    }
    case 'train': {
      if (p.training >= LIMIT.training) return fail('訓練度はもう最大');
      const gain = Math.min(4 + Math.floor(g.lead / 10), LIMIT.training - p.training);
      p.training += gain;
      done(1);
      return { ok: true, text: pushLog(state, `${g.name}が${p.name}の兵を訓練した（訓練 +${gain}）`, 'info', { daimyos: who }).text };
    }
    case 'charity': {
      if (d.rice < COST.charity) return fail('米が足りない');
      if (p.loyalty >= LIMIT.loyalty) return fail('民忠はもう最大');
      d.rice -= COST.charity;
      const gain = Math.min(5 + Math.floor(g.pol / 10), LIMIT.loyalty - p.loyalty);
      p.loyalty += gain;
      done(2);
      return { ok: true, text: pushLog(state, `${g.name}が${p.name}の民に米を配った（民忠 +${gain}）`, 'info', { daimyos: who }).text };
    }
    case 'move': {
      const t = state.provinces[cmd.target];
      if (!t || !adjacent(p.id).includes(t.id)) return fail('隣の国にしか移動できない');
      if (t.owner !== g.daimyo) return fail('自分の国にしか移動できない');
      const n = clamp(Math.floor(cmd.soldiers ?? 0), 0, p.soldiers);
      if (n > leadCap(g)) return fail(`${rankName(g)}の${g.name}が率いられる兵は ${leadCap(g)} まで`);
      if (t.soldiers + n > LIMIT.soldiersPerProvince) return fail('移動先の兵が上限を超える');
      p.soldiers -= n;
      t.soldiers += n;
      // 訓練度は兵数で加重平均
      if (n > 0) t.training = Math.round((t.training * (t.soldiers - n) + p.training * n) / t.soldiers);
      g.province = t.id;
      done(0);
      return { ok: true, text: pushLog(state, `${g.name}が兵${n}を率いて${p.name}から${t.name}へ移った`, 'info', { daimyos: who }).text };
    }
    case 'march': {
      const t = state.provinces[cmd.target];
      if (!t || !adjacent(p.id).includes(t.id)) return fail('隣の国にしか攻め込めない');
      if (t.owner === g.daimyo) return fail('自分の国は攻められない');
      if (isAllied(state, g.daimyo, t.owner)) return fail('同盟中の相手は攻められない');
      const n = clamp(Math.floor(cmd.soldiers ?? 0), 0, p.soldiers);
      if (n < 100) return fail('100 人以上で出陣する');
      if (n > leadCap(g)) return fail(`${rankName(g)}の${g.name}が率いられる兵は ${leadCap(g)} まで`);
      const rice = Math.ceil(n / 100) * COST.marchRicePer100;
      if (d.rice < rice) return fail(`兵糧の米が足りない（${rice} 必要）`);
      d.rice -= rice;
      p.soldiers -= n;
      done(0);
      const battle = startBattle(state, g, p, t, n);
      return { ok: true, text: battle.log[0].text, battle };
    }
    case 'goodwill': {
      const o = state.daimyos[cmd.daimyo];
      if (!o || !o.alive || o.id === g.daimyo) return fail('相手を選ぶ');
      if (d.gold < COST.goodwill) return fail('金が足りない');
      d.gold -= COST.goodwill;
      const gain = 5 + Math.floor(g.pol / 10);
      d.friendship[o.id] = clamp(d.friendship[o.id] + gain, 0, 100);
      o.friendship[g.daimyo] = clamp(o.friendship[g.daimyo] + Math.ceil(gain / 2), 0, 100);
      done(2);
      return { ok: true, text: pushLog(state, `${g.name}が${o.name}に贈り物をした（友好 ${d.friendship[o.id]}）`, 'info', { daimyos: who }).text };
    }
    case 'alliance': {
      const o = state.daimyos[cmd.daimyo];
      if (!o || !o.alive || o.id === g.daimyo) return fail('相手を選ぶ');
      if (isAllied(state, g.daimyo, o.id)) return fail('もう同盟している');
      if (d.friendship[o.id] < 60) return fail('友好が 60 以上必要');
      if (d.gold < COST.alliance) return fail('金が足りない');
      d.gold -= COST.alliance;
      done(1);
      const chance = (d.friendship[o.id] - 30) / 100 + g.pol / 500;
      if (rand(state) < chance) {
        addMerit(state, g, 5);
        const until = state.turn + LIMIT.allianceMonths;
        d.alliance[o.id] = until;
        o.alliance[g.daimyo] = until;
        return { ok: true, text: pushLog(state, `${d.name}と${o.name}が同盟を結んだ（${LIMIT.allianceMonths} か月）`, 'good', { daimyos: [g.daimyo, o.id] }).text, success: true };
      }
      d.friendship[o.id] = clamp(d.friendship[o.id] - 5, 0, 100);
      return { ok: true, text: pushLog(state, `${o.name}は${g.name}の同盟の申し出を断った`, 'bad', { daimyos: who }).text, success: false };
    }
    case 'explore': {
      if (d.gold < COST.explore) return fail('金が足りない');
      d.gold -= COST.explore;
      const found = roninIn(state, p.id).filter((r) => r.refused !== state.turn);
      if (!found.length) {
        done(1);
        return { ok: true, text: pushLog(state, `${g.name}が${p.name}を探索したが、在野の武将は見つからなかった`, 'info', { daimyos: who }).text, found: null };
      }
      const r = found[Math.floor(rand(state) * found.length)];
      const lord = lordOf(state, g.daimyo);
      const charm = lord ? (lord.lead + lord.pol) / 2 : 50;
      const strength = r.lead + r.valor + r.pol;
      const chance = clamp(0.55 + (charm - 50) / 200 + g.pol / 400 - (strength - 150) / 600, 0.15, 0.9);
      if (rand(state) < chance) {
        r.status = 'active';
        r.daimyo = g.daimyo;
        r.province = p.id;
        r.acted = true;
        r.lord = false;
        r.rank = initialRank(r.lead, r.valor, r.pol);
        delete r.refused;
        done(5);
        return { ok: true, text: pushLog(state, `${g.name}が${p.name}で${r.name}を見つけ、家臣に迎えた！`, 'good', { daimyos: who }).text, found: r.id, joined: true };
      }
      r.refused = state.turn;
      done(2);
      return { ok: true, text: pushLog(state, `${g.name}が${p.name}で${r.name}を見つけたが、仕官を断られた`, 'bad', { daimyos: who }).text, found: r.id, joined: false };
    }
    default:
      return fail('知らないコマンド');
  }
}

// ------------------------------------------------------------------ 功績と身分

/** 功績を加え、足りていれば昇進させる */
function addMerit(state, g, amount) {
  if (!amount) return;
  g.merit = (g.merit || 0) + amount;
  while (!g.lord && g.rank < RANKS.length - 1 && g.merit >= RANKS[g.rank + 1].merit) {
    g.rank++;
    pushLog(state, `${g.name}が${RANKS[g.rank].name}に昇進した（率いられる兵 ${RANKS[g.rank].lead}）`, 'good', { daimyos: [g.daimyo] });
  }
}

// ------------------------------------------------------------------ 戦闘

function startBattle(state, g, from, target, soldiers) {
  const defenders = generalsIn(state, target.id);
  const b = {
    attacker: g.id, attackerDaimyo: g.daimyo, from: from.id, target: target.id,
    defenderDaimyo: target.owner, defenders: defenders.map((x) => x.id),
    attSoldiers: soldiers, attStart: soldiers, attTraining: from.training,
    defSoldiers: target.soldiers, defStart: target.soldiers,
    round: 0, log: [], done: false, result: null, captured: [], fled: [],
  };
  const attackerName = state.daimyos[g.daimyo].name;
  const defName = target.owner ? state.daimyos[target.owner].name : '国人衆';
  const dg = bestGeneral(defenders);
  b.log.push({ text: `${attackerName}の${g.name}が兵${soldiers}を率いて${from.name}から${target.name}へ攻め込んだ！ 守るは${defName}${dg ? `の${dg.name}` : ''}、兵${target.soldiers}` });
  pushLog(state, b.log[0].text, 'battle', { daimyos: [g.daimyo, target.owner] });
  if (target.soldiers <= 0) finishBattle(state, b, 'win');
  return b;
}

/** 1 合戦ぶん進める。終わったら b.done が true になる。 */
export function battleRound(state, b) {
  if (b.done) return b;
  const ag = state.generals[b.attacker];
  const t = state.provinces[b.target];
  const dg = bestGeneral(b.defenders.map((id) => state.generals[id]));
  b.round++;
  const aPow = attackPower(b.attSoldiers, ag, b.attTraining);
  const dPow = attackPower(b.defSoldiers, dg, t.training);
  const r1 = 0.8 + rand(state) * 0.4;
  const r2 = 0.8 + rand(state) * 0.4;
  const dmgToDef = Math.min(b.defSoldiers, Math.round(aPow * 0.1 * r1 / (1 + t.defense / 150)));
  const dmgToAtt = Math.min(b.attSoldiers, Math.round(dPow * 0.1 * r2));
  b.defSoldiers -= dmgToDef;
  b.attSoldiers -= dmgToAtt;
  t.defense = Math.max(5, t.defense - 1);
  b.log.push({ round: b.round, dmgToDef, dmgToAtt, text: `第${b.round}合戦：${ag.name}隊は${dmgToDef}の敵を討ち取り、${dmgToAtt}の兵を失った（味方 ${b.attSoldiers} / 敵 ${b.defSoldiers}）` });

  if (b.defSoldiers <= 0) finishBattle(state, b, 'win');
  else if (b.attSoldiers <= 0) finishBattle(state, b, 'lose');
  else if (b.round >= LIMIT.battleRounds) finishBattle(state, b, 'timeout');
  return b;
}

export function battleRetreat(state, b) {
  if (!b.done) finishBattle(state, b, 'retreat');
  return b;
}

function finishBattle(state, b, result) {
  const ag = state.generals[b.attacker];
  const from = state.provinces[b.from];
  const t = state.provinces[b.target];
  const attName = state.daimyos[b.attackerDaimyo].name;
  const involved = [b.attackerDaimyo, b.defenderDaimyo];
  b.done = true;
  b.result = result;
  t.soldiers = Math.max(0, b.defSoldiers);

  if (result === 'win') {
    const loser = b.defenderDaimyo;
    t.owner = b.attackerDaimyo;
    t.soldiers = b.attSoldiers;
    t.training = b.attTraining;
    t.loyalty = 40;
    t.defense = Math.max(10, Math.round(t.defense * 0.7));
    ag.province = t.id;
    // 守っていた武将は逃げるか捕まる
    for (const id of b.defenders) {
      const dg = state.generals[id];
      const refuge = adjacent(t.id).filter((pid) => state.provinces[pid].owner === loser);
      if (refuge.length && rand(state) < 0.6) {
        dg.province = refuge[Math.floor(rand(state) * refuge.length)];
        b.fled.push(id);
      } else {
        dg.status = 'captured';
        dg.province = t.id;
        dg.capturedBy = b.attackerDaimyo;
        b.captured.push(id);
      }
    }
    const text = `${attName}の${ag.name}が${t.name}を攻め落とした！`;
    b.log.push({ text, result });
    pushLog(state, text, 'battle', { daimyos: involved });
    addMerit(state, ag, 15);
    for (const id of b.fled) pushLog(state, `${state.generals[id].name}は${provinceName(state.generals[id].province)}へ逃げのびた`, 'info', { daimyos: [loser] });
    for (const id of b.captured) pushLog(state, `${state.generals[id].name}を捕らえた`, 'battle', { daimyos: involved });
    if (loser) checkElimination(state, loser);
    checkEnd(state);
  } else {
    // 攻め手は残った兵と一緒にもとの国へ戻る
    const back = Math.max(0, b.attSoldiers);
    from.soldiers += back;
    const text = result === 'lose'
      ? `${ag.name}隊は全滅に近い損害を出し、${from.name}へ敗走した`
      : result === 'retreat'
        ? `${ag.name}隊は兵${back}を連れて${from.name}へ退いた`
        : `${ag.name}隊は${t.name}を落とせず、兵${back}を連れて${from.name}へ引き上げた`;
    b.log.push({ text, result });
    pushLog(state, text, 'battle', { daimyos: involved });
    addMerit(state, ag, result === 'lose' ? 1 : 3);
    const dg = bestGeneral(b.defenders.map((id) => state.generals[id]));
    if (dg) addMerit(state, dg, 8);
  }
}

/** 捕らえた武将を家臣に誘う。成功すると自分の武将になる。 */
export function recruitCaptured(state, generalId, byDaimyo) {
  const g = state.generals[generalId];
  if (g.status !== 'captured') return { ok: false, joined: false, text: 'その武将は捕らえていない' };
  const lord = lordOf(state, byDaimyo);
  const charm = lord ? (lord.lead + lord.pol) / 2 : 50;
  let chance = 0.35 + (charm - 50) / 150;
  if (g.lord) chance -= 0.3; // 当主はめったに降らない
  const wasDaimyo = g.daimyo;
  g.acted = true;
  if (rand(state) < chance) {
    g.status = 'active';
    g.daimyo = byDaimyo;
    g.lord = false;
    delete g.capturedBy;
    if (wasDaimyo) succession(state, wasDaimyo);
    const text = `${g.name}が${state.daimyos[byDaimyo].name}に仕えることになった`;
    pushLog(state, text, 'good', { daimyos: [byDaimyo, wasDaimyo] });
    return { ok: true, joined: true, text };
  }
  const text = `${g.name}は${state.daimyos[byDaimyo].name}への仕官を断った`;
  pushLog(state, text, 'info', { daimyos: [byDaimyo, wasDaimyo] });
  return { ok: true, joined: false, text };
}

/** 捕らえた武将を解放する。もとの家に国が残っていればそこへ帰る。 */
export function releaseCaptured(state, generalId) {
  const g = state.generals[generalId];
  if (g.status !== 'captured') return { ok: false, text: 'その武将は捕らえていない' };
  const home = state.daimyos[g.daimyo]?.alive ? provincesOf(state, g.daimyo) : [];
  delete g.capturedBy;
  if (home.length) {
    g.status = 'active';
    g.acted = true;
    if (g.lord && generalsOf(state, g.daimyo).some((x) => x.lord)) g.lord = false; // 家督はもう継がれている
    const cap = home.find((p) => p.id === state.daimyos[g.daimyo].capital) || home[0];
    g.province = cap.id;
    const text = `${g.name}は解放され、${cap.name}へ帰った`;
    pushLog(state, text, 'info', { daimyos: [g.daimyo, state.player] });
    return { ok: true, text };
  }
  g.status = 'ronin';
  g.daimyo = null;
  g.lord = false;
  const text = `${g.name}は解放され、${provinceName(g.province)}で野に下った`;
  pushLog(state, text, 'info', { daimyos: [state.player] });
  return { ok: true, text };
}

/** 当主がいなくなったら家督を継がせる。継げる武将がいなければ滅亡。 */
function succession(state, daimyoId) {
  const d = state.daimyos[daimyoId];
  if (!d.alive) return;
  const gs = generalsOf(state, daimyoId);
  if (gs.some((g) => g.lord)) return;
  if (!gs.length) { checkElimination(state, daimyoId); return; }
  const heir = gs.reduce((a, b) => (a.lead + a.pol >= b.lead + b.pol ? a : b));
  heir.lord = true;
  pushLog(state, `${heir.name}が${d.name}の家督を継いだ`, 'info', { daimyos: [daimyoId] });
}

function checkElimination(state, daimyoId) {
  const d = state.daimyos[daimyoId];
  if (!d || !d.alive) return;
  const ps = provincesOf(state, daimyoId);
  const gs = generalsOf(state, daimyoId);
  if (ps.length && gs.length) {
    if (!gs.some((g) => g.lord)) succession(state, daimyoId);
    return;
  }
  d.alive = false;
  for (const p of ps) p.owner = null; // 武将がいない国は国人衆が治める
  for (const g of gs) { g.status = 'ronin'; g.daimyo = null; g.lord = false; } // 家臣は野に下る
  pushLog(state, `${d.name}は滅亡した`, 'battle', { daimyos: [daimyoId, state.player] });
}

function checkEnd(state) {
  if (state.ended) return;
  const me = state.daimyos[state.player];
  if (!me) return;
  if (!me.alive) {
    state.ended = { result: 'lose', text: `${me.name}は滅亡した……。` };
    return;
  }
  const rivals = aliveDaimyos(state).filter((d) => d.id !== state.player);
  if (rivals.length === 0) {
    state.ended = { result: 'win', text: `${dateLabel(state)}、${me.name}は天下を統一した！` };
  }
}

// ------------------------------------------------------------------ 月の進行

/** 月を進める。収入・収穫・兵糧・民忠・一揆・同盟の期限を処理する。
 *  state.report（プレイヤー向けの月報）は消さないので、呼ぶ前に空にしておく。 */
export function advanceMonth(state) {
  state.turn++;
  state.month++;
  if (state.month > 12) { state.month = 1; state.year++; }
  const events = [];
  const me = state.player;

  for (const g of Object.values(state.generals)) g.acted = false;
  for (const p of Object.values(state.provinces)) p.commands = 0;
  appearGenerals(state);

  // 空白地の国人衆はゆっくり兵を戻す
  for (const p of Object.values(state.provinces)) {
    if (!p.owner) {
      p.soldiers = Math.min(p.soldiers + 60, 4000);
      p.loyalty = clamp(p.loyalty + 1, 0, 100);
    }
  }

  const harvestMonth = state.month === 9;
  let harvestFactor = 1;
  let harvestLabel = '';
  if (harvestMonth) {
    const r = rand(state);
    if (r < 0.15) { harvestFactor = 0.7; harvestLabel = '凶作'; }
    else if (r < 0.3) { harvestFactor = 1.25; harvestLabel = '豊作'; }
    else { harvestFactor = 1; harvestLabel = '平年並み'; }
    pushLog(state, `今年の収穫は${harvestLabel}だった`, harvestFactor < 1 ? 'bad' : 'good', { daimyos: [me] });
  }

  for (const d of aliveDaimyos(state)) {
    const ps = provincesOf(state, d.id);
    const gold = ps.reduce((s, p) => s + Math.round(p.comm * 0.5), 0);
    const eat = ps.reduce((s, p) => s + Math.ceil(p.soldiers / 30), 0);
    const harvest = harvestMonth ? Math.round(ps.reduce((s, p) => s + p.agri * 25, 0) * harvestFactor) : 0;
    d.gold += gold;
    d.rice += harvest - eat;
    if (d.id === me) {
      events.push({ kind: 'income', gold, eat, harvest });
      pushLog(state, `収入：金 +${gold}、兵糧 -${eat}${harvest ? `、収穫 +${harvest}` : ''}`, 'info', { daimyos: [me] });
    }
    if (d.rice < 0) {
      d.rice = 0;
      for (const p of ps) {
        p.soldiers = Math.floor(p.soldiers * 0.9);
        p.loyalty = clamp(p.loyalty - 5, 0, 100);
      }
      pushLog(state, `${d.name}は兵糧が尽き、兵が逃げ出した`, 'bad', { daimyos: [d.id] });
    }

    for (const p of ps) {
      // 民忠はゆっくり 60 に近づく
      if (p.loyalty < 60) p.loyalty += 1;
      else if (p.loyalty > 60 && rand(state) < 0.3) p.loyalty -= 1;
      // 一揆
      if (p.loyalty < 25 && rand(state) < 0.3) {
        const lost = Math.floor(p.soldiers * 0.2);
        p.soldiers -= lost;
        p.agri = Math.max(10, p.agri - 5);
        p.loyalty = clamp(p.loyalty + 10, 0, 100);
        pushLog(state, `${p.name}で一揆が起きた！ 兵 -${lost}、農業 -5`, 'bad', { daimyos: [d.id] });
      }
    }

    for (const [other, until] of Object.entries(d.alliance)) {
      if (until === state.turn) {
        delete d.alliance[other];
        delete state.daimyos[other]?.alliance?.[d.id];
        pushLog(state, `${d.name}と${state.daimyos[other].name}の同盟が期限切れになった`, 'info', { daimyos: [d.id, other] });
      }
    }
  }

  // 年の変わり目：家々が少しずつ関係を忘れる
  if (state.month === 1) {
    for (const d of aliveDaimyos(state)) {
      for (const k of Object.keys(d.friendship)) {
        if (d.friendship[k] > 30) d.friendship[k] -= 1;
      }
    }
  }
  return events;
}

/** 登場年を迎えた武将を現す。家が残っていれば仕官し、なければ在野になる */
function appearGenerals(state) {
  for (const g of Object.values(state.generals)) {
    if (g.status !== 'unborn' || state.year < g.appear) continue;
    const home = g.homeDaimyo && state.daimyos[g.homeDaimyo]?.alive ? state.daimyos[g.homeDaimyo] : null;
    if (home) {
      const ps = provincesOf(state, home.id);
      const cap = ps.find((p) => p.id === home.capital) || ps[0];
      g.status = 'active';
      g.daimyo = home.id;
      g.province = cap.id;
      g.rank = initialRank(g.lead, g.valor, g.pol);
      pushLog(state, `${g.name}が元服し、${home.name}に仕えた`, 'good', { daimyos: [home.id] });
    } else {
      g.status = 'ronin';
      g.daimyo = null;
      g.lord = false;
      if (state.provinces[g.province].owner === state.player) {
        pushLog(state, `${provinceName(g.province)}に${g.name}という者が現れたらしい`, 'info', { daimyos: [state.player] });
      }
    }
  }
}

// ------------------------------------------------------------------ 保存

export const serialize = (state) => JSON.stringify(state);
export function deserialize(text) {
  const s = JSON.parse(text);
  if (!s || s.version !== 2 || !s.provinces || !s.daimyos || !s.generals || !s.cells) throw new Error('bad save');
  return s;
}
