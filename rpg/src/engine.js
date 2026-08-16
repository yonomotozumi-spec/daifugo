/**
 * RPG「よあけのつるぎ」のルールエンジン。
 * DOM に依存しないので、ブラウザと Node の両方から読み込める。
 * マップは world.js、描画は scene.js、画面まわりは ui.js に任せる。
 *
 * セーブデータ（save）は「パーティ 1 つぶん」の入れもの:
 *   { v, party: [なかま…], gold, items, flags, chests, steps, map, x, y, dir }
 */

// ---------------------------------------------------------------- 乱数

/** 再現可能な乱数（テスト用）。 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** lo 以上 hi 以下の整数。 */
export const randInt = (lo, hi, rng = Math.random) => lo + Math.floor(rng() * (hi - lo + 1));

/** 重み付き抽選。 */
export function weightedPick(items, weightOf, rng = Math.random) {
  const total = items.reduce((a, x) => a + weightOf(x), 0);
  if (!(total > 0)) return items[items.length - 1];
  let r = rng() * total;
  for (const item of items) {
    r -= weightOf(item);
    if (r < 0) return item;
  }
  return items[items.length - 1];
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// ---------------------------------------------------------------- レベル

/**
 * レベルごとの成長表。exp は「そのレベルになるのに必要な累計経験値」。
 * この表は ゆうしゃの伸びかたで、仲間は職業ごとの倍率をかけて使う。
 */
export const LEVELS = [
  { level: 1, exp: 0, hp: 20, mp: 0, str: 6, agi: 5 },
  { level: 2, exp: 8, hp: 26, mp: 0, str: 9, agi: 7 },
  { level: 3, exp: 22, hp: 32, mp: 6, str: 12, agi: 9 },
  { level: 4, exp: 45, hp: 38, mp: 10, str: 15, agi: 11 },
  { level: 5, exp: 80, hp: 46, mp: 14, str: 19, agi: 13 },
  { level: 6, exp: 130, hp: 54, mp: 18, str: 23, agi: 15 },
  { level: 7, exp: 200, hp: 63, mp: 23, str: 27, agi: 17 },
  { level: 8, exp: 290, hp: 72, mp: 28, str: 31, agi: 20 },
  { level: 9, exp: 420, hp: 82, mp: 33, str: 36, agi: 23 },
  { level: 10, exp: 600, hp: 93, mp: 38, str: 41, agi: 26 },
  { level: 11, exp: 850, hp: 104, mp: 44, str: 46, agi: 29 },
  { level: 12, exp: 1150, hp: 116, mp: 50, str: 52, agi: 32 },
  { level: 13, exp: 1550, hp: 128, mp: 56, str: 58, agi: 35 },
  { level: 14, exp: 2050, hp: 140, mp: 62, str: 64, agi: 38 },
  { level: 15, exp: 2600, hp: 153, mp: 69, str: 70, agi: 41 },
  { level: 16, exp: 3300, hp: 166, mp: 76, str: 77, agi: 44 },
  { level: 17, exp: 4200, hp: 180, mp: 83, str: 84, agi: 47 },
  { level: 18, exp: 5200, hp: 194, mp: 90, str: 91, agi: 50 },
  { level: 19, exp: 6400, hp: 209, mp: 98, str: 98, agi: 53 },
  { level: 20, exp: 7800, hp: 225, mp: 106, str: 106, agi: 57 },
];

export const MAX_LEVEL = LEVELS[LEVELS.length - 1].level;

/** 累計経験値からレベルを求める。 */
export function levelOf(exp) {
  let level = 1;
  for (const row of LEVELS) if (exp >= row.exp) level = row.level;
  return level;
}

export const levelRow = (level) => LEVELS[clamp(level, 1, MAX_LEVEL) - 1];

/** 次のレベルまでの残り経験値。最大レベルなら null。 */
export function expToNext(exp) {
  const next = LEVELS.find((row) => row.exp > exp);
  return next ? next.exp - exp : null;
}

/** そのレベルになるのに必要な累計経験値。 */
export const expForLevel = (level) => levelRow(level).exp;

// ---------------------------------------------------------------- 呪文

export const SPELLS = [
  { id: 'rika', name: 'リカ', mp: 4, kind: 'heal', power: [28, 38], field: true, desc: 'HP を 30 ほど回復する' },
  { id: 'flam', name: 'フラム', mp: 5, kind: 'attack', power: [16, 24], field: false, desc: '炎で 20 ほどのダメージ' },
  { id: 'somna', name: 'ソムナ', mp: 6, kind: 'sleep', field: false, desc: '魔物を 眠らせる' },
  { id: 'returna', name: 'リターナ', mp: 6, kind: 'warp', field: true, desc: 'はじまりの村へ飛んで帰る' },
  { id: 'rikara', name: 'リカラ', mp: 8, kind: 'heal', power: [78, 98], field: true, desc: 'HP を 85 ほど回復する' },
  { id: 'flamra', name: 'フラムラ', mp: 9, kind: 'attack', power: [40, 54], field: false, desc: '大きな炎で 45 ほどのダメージ' },
  { id: 'brave', name: 'ブレイヴ', mp: 10, kind: 'buff', field: false, desc: '仲間ひとりの攻撃力を上げる' },
  { id: 'revina', name: 'リヴィナ', mp: 12, kind: 'revive', field: true, desc: '倒れた仲間を 起こす（不確実）' },
  { id: 'rikada', name: 'リカダ', mp: 14, kind: 'heal', power: 'full', field: true, desc: 'HP を全回復する' },
  { id: 'flamda', name: 'フラムダ', mp: 20, kind: 'attack', power: [90, 120], field: false, desc: '大爆炎で 100 ほどのダメージ' },
];

export const spellById = (id) => SPELLS.find((s) => s.id === id) || null;

/** 味方ひとりを選ぶ呪文か。 */
export const targetsAlly = (spell) => ['heal', 'revive', 'buff'].includes(spell.kind);

// ---------------------------------------------------------------- 職業

/**
 * 仲間の職業。hp / mp / str / agi は LEVELS への倍率。
 * spells は「そのレベルで覚える呪文」。
 */
export const CLASSES = {
  hero: {
    id: 'hero', name: 'ゆうしゃ', hp: 1, mp: 1, str: 1, agi: 1,
    look: { cloth: '#3f8bff', hair: '#f6b93b', hero: true },
    spells: { 3: ['rika'], 4: ['flam'], 6: ['returna'], 8: ['rikara'], 10: ['flamra'], 12: ['brave'], 15: ['rikada'], 18: ['flamda'] },
  },
  warrior: {
    id: 'warrior', name: 'せんし', hp: 1.32, mp: 0, str: 1.22, agi: 0.85,
    look: { cloth: '#c0392b', hair: '#4b3621' },
    spells: {},
  },
  priest: {
    id: 'priest', name: 'そうりょ', hp: 0.86, mp: 1.35, str: 0.72, agi: 0.95, mpMin: 8,
    look: { cloth: '#f1f3f5', hair: '#8d6e63' },
    spells: { 1: ['rika'], 5: ['rikara'], 9: ['revina'], 13: ['rikada'], 16: ['brave'] },
  },
  mage: {
    id: 'mage', name: 'まほうつかい', hp: 0.64, mp: 1.65, str: 0.6, agi: 1.1, mpMin: 10,
    look: { cloth: '#9775fa', hair: '#343a40' },
    spells: { 1: ['flam'], 3: ['somna'], 7: ['flamra'], 11: ['brave'], 15: ['flamda'] },
  },
};

export const classById = (id) => CLASSES[id] || CLASSES.hero;

export const PARTY_LIMIT = 4;

// ---------------------------------------------------------------- 道具

export const ITEMS = [
  { id: 'herb', name: 'いやしそう', price: 24, kind: 'heal', power: 34, field: true, battle: true, ally: true, desc: 'HP を 34 ほど回復する' },
  { id: 'mana', name: 'マナのしずく', price: 78, kind: 'mp', power: 26, field: true, battle: true, ally: true, desc: 'MP を 26 回復する' },
  { id: 'feather', name: 'かえりの羽根', price: 36, kind: 'warp', field: true, battle: false, desc: 'はじまりの村へ帰る' },
  { id: 'seedStr', name: '剛力の実', price: 0, kind: 'seedStr', power: 5, field: true, battle: false, ally: true, desc: 'ちからが永久に上がる' },
  { id: 'seedHp', name: '生命の実', price: 0, kind: 'seedHp', power: 15, field: true, battle: false, ally: true, desc: '最大 HP が永久に上がる' },
  { id: 'flower', name: 'よみがえりの花', price: 0, kind: 'revive', field: true, battle: true, ally: true, desc: '倒れた仲間を 起こす' },
  { id: 'shardA', name: 'よあけの欠片', price: 0, kind: 'key', field: false, battle: false, desc: '星のしずく を なす ふたつの欠片のひとつ' },
  { id: 'shardB', name: 'よいやみの欠片', price: 0, kind: 'key', field: false, battle: false, desc: '星のしずく を なす ふたつの欠片のひとつ' },
  { id: 'star', name: '星のしずく', price: 0, kind: 'key', field: false, battle: false, desc: '結界を 打ち破るという 星のかけら' },
];

export const itemById = (id) => ITEMS.find((i) => i.id === id) || null;

/** 売値は買値の半分。売れない道具は 0。 */
export const sellPrice = (id) => Math.floor((itemById(id)?.price || 0) / 2);

// ---------------------------------------------------------------- 装備

export const WEAPONS = [
  { id: 'none', name: 'すで', price: 0, atk: 0 },
  { id: 'stick', name: 'かしの棒', price: 20, atk: 3 },
  { id: 'copper', name: 'あおがねの剣', price: 140, atk: 12 },
  { id: 'steel', name: 'くろがねの剣', price: 720, atk: 26 },
  { id: 'flame', name: 'ほむらの剣', price: 2600, atk: 42 },
  { id: 'light', name: 'よあけの剣', price: 0, atk: 58 },
];

export const ARMORS = [
  { id: 'none', name: 'あさの服', price: 0, def: 0 },
  { id: 'clothes', name: '旅装束', price: 30, def: 3 },
  { id: 'leather', name: '革の胸あて', price: 180, def: 8 },
  { id: 'chain', name: '鎖の鎧', price: 480, def: 14 },
  { id: 'iron', name: 'くろがねの鎧', price: 1200, def: 22 },
  { id: 'magic', name: '魔よけの鎧', price: 3000, def: 32 },
  { id: 'lightArmor', name: 'よあけの鎧', price: 0, def: 42 },
];

export const SHIELDS = [
  { id: 'none', name: 'なし', price: 0, def: 0 },
  { id: 'leatherShield', name: '木の盾', price: 110, def: 5 },
  { id: 'ironShield', name: 'くろがねの盾', price: 620, def: 12 },
  { id: 'mirrorShield', name: '銀鏡の盾', price: 2400, def: 22 },
];

/** 装備の種類。slot は仲間 1 人のデータのキーでもある。 */
export const GEAR = [
  { slot: 'weapon', label: 'ぶき', list: WEAPONS },
  { slot: 'armor', label: 'よろい', list: ARMORS },
  { slot: 'shield', label: 'たて', list: SHIELDS },
];

export function gearById(slot, id) {
  const group = GEAR.find((g) => g.slot === slot);
  if (!group) return null;
  return group.list.find((g) => g.id === id) || group.list[0];
}

/** 「なし」をのぞいた全装備。店の品ぞろえづくりに使う。 */
export const ALL_GEAR = GEAR.flatMap((g) => g.list.filter((item) => item.id !== 'none').map((item) => ({ ...item, slot: g.slot })));

export const allGearById = (id) => ALL_GEAR.find((g) => g.id === id) || null;

// ---------------------------------------------------------------- 仲間

export const START = { map: 'town', x: 10, y: 11, dir: 'down' };

export const SAVE_VERSION = 2;

/** 仲間ひとりを作る。exp を渡すと そのぶんのレベルで生まれる。 */
export function createMember(clsId = 'hero', name, exp = 0) {
  const cls = classById(clsId);
  const member = {
    cls: cls.id,
    name: name || cls.name,
    exp: Math.max(0, Math.floor(exp)),
    hp: 1,
    mp: 0,
    bonusHp: 0,
    bonusStr: 0,
    weapon: 'none',
    armor: 'none',
    shield: 'none',
  };
  const s = statsOf(member);
  member.hp = s.maxHp;
  member.mp = s.maxMp;
  return member;
}

/** 新しい冒険のはじまり。パーティは ゆうしゃ ひとり。 */
export function createSave(name = 'ゆうしゃ') {
  return {
    v: SAVE_VERSION,
    party: [createMember('hero', name)],
    gold: 30,
    items: { herb: 2 },
    flags: {},
    chests: [],
    steps: 0,
    map: START.map,
    x: START.x,
    y: START.y,
    dir: START.dir,
  };
}

function normalizeMember(raw, fallbackCls = 'hero') {
  const cls = CLASSES[raw?.cls] ? raw.cls : fallbackCls;
  const member = createMember(cls, undefined, Math.max(0, Math.floor(Number(raw?.exp) || 0)));
  if (typeof raw?.name === 'string' && raw.name.trim()) member.name = raw.name.slice(0, 8);
  member.bonusHp = Math.max(0, Math.floor(Number(raw?.bonusHp) || 0));
  member.bonusStr = Math.max(0, Math.floor(Number(raw?.bonusStr) || 0));
  for (const { slot, list } of GEAR) {
    member[slot] = list.some((g) => g.id === raw?.[slot]) ? raw[slot] : 'none';
  }
  const s = statsOf(member);
  member.hp = clamp(Math.floor(Number(raw?.hp) ?? s.maxHp), 0, s.maxHp);
  member.mp = clamp(Math.floor(Number(raw?.mp) ?? s.maxMp), 0, s.maxMp);
  return member;
}

/** セーブデータを読み込む。古い形式や壊れたデータでも遊べる形に直す。 */
export function normalizeSave(raw) {
  const base = createSave();
  if (!raw || typeof raw !== 'object') return base;

  // v1 は「ゆうしゃ 1 人ぶん」がそのまま入っていた。パーティ 1 人として引き継ぐ。
  const partyRaw = Array.isArray(raw.party) && raw.party.length ? raw.party : [raw];

  const save = {
    v: SAVE_VERSION,
    party: partyRaw.slice(0, PARTY_LIMIT).map((m, i) => normalizeMember(m, i === 0 ? 'hero' : 'warrior')),
    gold: clamp(Math.floor(Number(raw.gold) || 0), 0, 999999),
    items: {},
    flags: raw.flags && typeof raw.flags === 'object' ? { ...raw.flags } : {},
    chests: Array.isArray(raw.chests) ? raw.chests.filter((id) => typeof id === 'string') : [],
    steps: Math.max(0, Math.floor(Number(raw.steps) || 0)),
    map: typeof raw.map === 'string' ? raw.map : START.map,
    x: Math.floor(Number(raw.x) ?? START.x),
    y: Math.floor(Number(raw.y) ?? START.y),
    dir: ['up', 'down', 'left', 'right'].includes(raw.dir) ? raw.dir : START.dir,
  };

  if (raw.items && typeof raw.items === 'object') {
    for (const [id, count] of Object.entries(raw.items)) {
      const n = Math.floor(Number(count) || 0);
      if (itemById(id) && n > 0) save.items[id] = Math.min(n, 99);
    }
  }

  // 全滅したまま保存されていても詰まないように、先頭だけは必ず立っている。
  if (!alive(save.party).length) {
    const leader = save.party[0];
    leader.hp = statsOf(leader).maxHp;
  }
  return save;
}

/** レベル・職業・装備・たねを合わせた最終的な能力。 */
export function statsOf(member) {
  const cls = classById(member.cls);
  const level = levelOf(member.exp);
  const row = levelRow(level);
  const weapon = gearById('weapon', member.weapon);
  const armor = gearById('armor', member.armor);
  const shield = gearById('shield', member.shield);
  const str = Math.round(row.str * cls.str) + (member.bonusStr || 0);
  const agi = Math.max(1, Math.round(row.agi * cls.agi));
  const maxMp = cls.mp === 0 ? 0 : Math.max(row.mp > 0 ? cls.mpMin || 0 : 0, Math.round(row.mp * cls.mp));
  return {
    cls,
    level,
    maxHp: Math.round(row.hp * cls.hp) + (member.bonusHp || 0),
    maxMp,
    str,
    agi,
    atk: str + weapon.atk,
    def: Math.floor(agi / 2) + armor.def + shield.def,
    weapon,
    armor,
    shield,
    nextExp: expToNext(member.exp),
  };
}

/** その仲間が覚えている呪文。 */
export function spellsOf(member) {
  const cls = classById(member.cls);
  const level = levelOf(member.exp);
  const ids = [];
  for (const [at, list] of Object.entries(cls.spells)) {
    if (Number(at) <= level) ids.push(...list);
  }
  return ids.map(spellById);
}

export const knowsSpell = (member, id) => spellsOf(member).some((s) => s.id === id);

/** 経験値を足してレベルアップを判定する。上がった分の情報を返す。 */
export function gainExp(member, amount) {
  const cls = classById(member.cls);
  const before = levelOf(member.exp);
  member.exp += Math.max(0, Math.floor(amount));
  const after = levelOf(member.exp);
  const gained = [];
  for (let level = before + 1; level <= after; level++) {
    gained.push({ level, spells: (cls.spells[level] || []).map(spellById) });
  }
  if (gained.length) {
    // レベルが上がると 増えたぶんだけ HP / MP も増える。
    const beforeRow = levelRow(before);
    const beforeHp = Math.round(beforeRow.hp * cls.hp) + (member.bonusHp || 0);
    const beforeMp = cls.mp === 0 ? 0 : Math.max(beforeRow.mp > 0 ? cls.mpMin || 0 : 0, Math.round(beforeRow.mp * cls.mp));
    const s = statsOf(member);
    if (member.hp > 0) member.hp = Math.min(s.maxHp, member.hp + (s.maxHp - beforeHp));
    member.mp = Math.min(s.maxMp, member.mp + (s.maxMp - beforeMp));
  }
  return gained;
}

// ---------------------------------------------------------------- パーティ

export const isDown = (member) => member.hp <= 0;

export const alive = (party) => party.filter((m) => m.hp > 0);

export const isWiped = (save) => alive(save.party).length === 0;

export const leaderOf = (save) => save.party[0];

/** 仲間を加える。level を渡すと そのレベル以上で加わる。 */
export function joinParty(save, clsId, name, minLevel = 1) {
  if (save.party.length >= PARTY_LIMIT) return { ok: false, text: 'これ以上 仲間は 連れていけない。' };
  const leaderExp = leaderOf(save).exp;
  const exp = Math.max(expForLevel(minLevel), Math.round(leaderExp * 0.85));
  const member = createMember(clsId, name, exp);
  save.party.push(member);
  return { ok: true, member, text: `${member.name}が 仲間に くわわった！` };
}

/** 生き返らせる。もともと生きていれば false。 */
export function revive(member, ratio = 0.5) {
  if (!isDown(member)) return false;
  member.hp = Math.max(1, Math.round(statsOf(member).maxHp * ratio));
  return true;
}

export function healAll(save) {
  for (const member of save.party) {
    const s = statsOf(member);
    member.hp = s.maxHp;
    member.mp = s.maxMp;
  }
}

// ---------------------------------------------------------------- 持ち物

export const ITEM_LIMIT = 12;

/** 持っている道具を [{item, count}] で返す。 */
export function itemList(save) {
  return ITEMS.filter((i) => (save.items[i.id] || 0) > 0).map((item) => ({ item, count: save.items[item.id] }));
}

export const itemCount = (save, id) => save.items[id] || 0;

export const hasItem = (save, id) => itemCount(save, id) > 0;

/** 持ち物の種類が上限を超えていたら false（同じ道具は重ねられる）。 */
export function addItem(save, id, count = 1) {
  if (!itemById(id)) return false;
  if (!save.items[id] && itemList(save).length >= ITEM_LIMIT) return false;
  save.items[id] = Math.min(99, (save.items[id] || 0) + count);
  return true;
}

export function removeItem(save, id, count = 1) {
  if (!hasItem(save, id)) return false;
  save.items[id] -= count;
  if (save.items[id] <= 0) delete save.items[id];
  return true;
}

/**
 * 道具を使う。target は使われる仲間（省略すると先頭）。
 * where は 'field' か 'battle'。consumed が true なら道具が減っている。
 */
export function useItem(save, id, target = leaderOf(save), where = 'field', rng = Math.random) {
  const item = itemById(id);
  if (!item || !hasItem(save, id)) return { ok: false, text: 'その道具は持っていない。' };
  if (where === 'battle' && !item.battle) return { ok: false, text: `${item.name}は 戦いの中では使えない！` };
  if (where === 'field' && !item.field) return { ok: false, text: `${item.name}は いま使ってもなにも起きない。` };
  if (item.ally && item.kind !== 'revive' && isDown(target)) return { ok: false, text: `${target.name}は 倒れている。` };

  const s = statsOf(target);
  switch (item.kind) {
    case 'heal': {
      if (target.hp >= s.maxHp) return { ok: false, text: `${target.name}の HP は 満タンだ。` };
      const heal = Math.min(s.maxHp - target.hp, randInt(item.power - 4, item.power + 4, rng));
      target.hp += heal;
      removeItem(save, id);
      return { ok: true, consumed: true, heal, fx: 'heal', text: `${item.name}を つかった！\n${target.name}の HP が ${heal} 回復した。` };
    }
    case 'mp': {
      if (s.maxMp === 0) return { ok: false, text: `${target.name}は 呪文を つかえない。` };
      if (target.mp >= s.maxMp) return { ok: false, text: `${target.name}の MP は 満タンだ。` };
      const heal = Math.min(s.maxMp - target.mp, item.power);
      target.mp += heal;
      removeItem(save, id);
      return { ok: true, consumed: true, fx: 'heal', text: `${item.name}を つかった！\n${target.name}の MP が ${heal} 回復した。` };
    }
    case 'revive': {
      if (!isDown(target)) return { ok: false, text: `${target.name}は 元気だ。` };
      revive(target, 1);
      removeItem(save, id);
      return { ok: true, consumed: true, fx: 'heal', text: `${item.name}を つかった！\n${target.name}は 生き返った！` };
    }
    case 'warp':
      removeItem(save, id);
      return { ok: true, consumed: true, warp: true, fx: 'warp', text: `${item.name}を つかった！\n空へ舞い上がった！` };
    case 'seedStr':
      target.bonusStr += item.power;
      removeItem(save, id);
      return { ok: true, consumed: true, fx: 'heal', text: `${target.name}の ちからが ${item.power} 上がった！` };
    case 'seedHp':
      target.bonusHp += item.power;
      target.hp += item.power;
      removeItem(save, id);
      return { ok: true, consumed: true, fx: 'heal', text: `${target.name}の 最大 HP が ${item.power} 上がった！` };
    default:
      return { ok: false, text: `${item.name}は だいじな品だ。` };
  }
}

// ---------------------------------------------------------------- 店・宿

/** 宿代は 人数とレベルで決まる。 */
export const innCost = (save) => save.party.reduce((sum, m) => sum + 4 + levelOf(m.exp) * 3, 0);

/** 買い物。装備は who に渡す（省略すると先頭）。 */
export function buy(save, id, who = leaderOf(save)) {
  const gear = allGearById(id);
  const item = itemById(id);
  const goods = gear || item;
  if (!goods) return { ok: false, text: 'それは売っていない。' };
  if (save.gold < goods.price) return { ok: false, text: 'お金が足りないようだ。' };

  if (gear) {
    const old = gearById(gear.slot, who[gear.slot]);
    if (old.id === gear.id) return { ok: false, text: `${who.name}は もう それを 装備している。` };
    save.gold -= gear.price;
    who[gear.slot] = gear.id;
    const back = old.id === 'none' ? '' : `\n${old.name}は 下取りに出した。`;
    return { ok: true, text: `${who.name}は ${gear.name}を 手に入れた！${back}` };
  }

  if (!addItem(save, id)) return { ok: false, text: 'これ以上 道具を持てない。' };
  save.gold -= item.price;
  return { ok: true, text: `${item.name}を 手に入れた！` };
}

/** 道具を売る。装備は下取り扱いなので売れない。 */
export function sell(save, id) {
  const item = itemById(id);
  if (!item || !hasItem(save, id)) return { ok: false, text: 'それは持っていない。' };
  const price = sellPrice(id);
  if (price <= 0) return { ok: false, text: 'それは 買い取れないよ。' };
  removeItem(save, id);
  save.gold = Math.min(999999, save.gold + price);
  return { ok: true, price, text: `${item.name}を ${price} ゴールドで 売った。` };
}

/** 宿屋に泊まる。死んだ仲間も 目を覚ます。 */
export function stayInn(save) {
  const cost = innCost(save);
  if (save.gold < cost) return { ok: false, cost, text: 'お金が 足りないようだね。' };
  save.gold -= cost;
  healAll(save);
  return { ok: true, cost, text: 'ぐっすり おやすみ……\n\nおはようございます！\nみんな 元気になった。' };
}

// ---------------------------------------------------------------- モンスター

/**
 * actions は行動の抽選表。kind は attack / spell / breath / heal / sleep。
 * acts は 1 ターンに動く回数、resist は炎・爆発系が効きにくくなる割合。
 */
export const MONSTERS = [
  {
    id: 'slime', name: 'ぷるん', emoji: '🟢', color: '#4dd07a',
    hp: 13, atk: 6, def: 3, agi: 4, exp: 3, gold: 6, resist: 0,
    actions: [{ kind: 'attack', w: 100 }],
  },
  {
    id: 'rat', name: 'どぶネズミ', emoji: '🐀', color: '#b39d86',
    hp: 22, atk: 9, def: 5, agi: 10, exp: 6, gold: 9, resist: 0,
    actions: [{ kind: 'attack', w: 100 }],
  },
  {
    id: 'bee', name: 'あばれバチ', emoji: '🐝', color: '#ffd43b',
    hp: 30, atk: 13, def: 7, agi: 18, exp: 10, gold: 13, resist: 0,
    actions: [{ kind: 'attack', w: 100 }],
  },
  {
    id: 'frog', name: 'どくガエル', emoji: '🐸', color: '#74b816',
    hp: 40, atk: 16, def: 9, agi: 8, exp: 12, gold: 15, resist: 0,
    actions: [{ kind: 'attack', w: 100 }],
  },
  {
    id: 'goblin', name: 'ゴブリン', emoji: '👺', color: '#e07a5f',
    hp: 52, atk: 19, def: 10, agi: 9, exp: 15, gold: 18, resist: 0,
    actions: [{ kind: 'attack', w: 100 }],
  },
  {
    id: 'wolf', name: 'はぐれオオカミ', emoji: '🐺', color: '#9aa5b1',
    hp: 82, atk: 33, def: 16, agi: 16, exp: 26, gold: 28, resist: 0, acts: 2,
    actions: [{ kind: 'attack', w: 88 }, { kind: 'sleep', w: 12 }],
  },
  {
    id: 'bat', name: 'よろいコウモリ', emoji: '🦇', color: '#868e96',
    hp: 70, atk: 30, def: 18, agi: 26, exp: 29, gold: 34, resist: 0, acts: 2,
    actions: [{ kind: 'attack', w: 100 }],
  },
  {
    id: 'mage', name: 'くろローブ', emoji: '🧙', color: '#b197fc',
    hp: 66, atk: 22, def: 14, agi: 14, exp: 32, gold: 42, resist: 0.3,
    actions: [{ kind: 'attack', w: 45 }, { kind: 'spell', id: 'flam', w: 40 }, { kind: 'heal', power: 40, w: 15 }],
  },
  {
    id: 'armor', name: 'うごく鎧', emoji: '🛡️', color: '#adb5bd',
    hp: 110, atk: 38, def: 28, agi: 10, exp: 40, gold: 48, resist: 0.1,
    actions: [{ kind: 'attack', w: 100 }],
  },
  {
    id: 'worm', name: 'いわむし', emoji: '🪱', color: '#c0a080',
    hp: 130, atk: 42, def: 34, agi: 8, exp: 52, gold: 60, resist: 0.25,
    actions: [{ kind: 'attack', w: 82 }, { kind: 'breath', power: [20, 28], w: 18 }],
  },
  {
    id: 'skeleton', name: 'ほねの剣士', emoji: '💀', color: '#dee2e6',
    hp: 145, atk: 48, def: 30, agi: 16, exp: 65, gold: 75, resist: 0.1, acts: 2,
    actions: [{ kind: 'attack', w: 85 }, { kind: 'sleep', w: 15 }],
  },
  {
    id: 'lizard', name: 'どくトカゲ', emoji: '🦎', color: '#82c91e',
    hp: 165, atk: 54, def: 34, agi: 14, exp: 80, gold: 90, resist: 0.2, acts: 2,
    actions: [{ kind: 'attack', w: 75 }, { kind: 'breath', power: [24, 34], w: 25 }],
  },
  {
    id: 'golem', name: '岩人形', emoji: '🗿', color: '#8d99ae',
    hp: 280, atk: 70, def: 50, agi: 6, exp: 135, gold: 165, resist: 0.15,
    actions: [{ kind: 'attack', w: 100 }],
  },
  {
    id: 'witch', name: '沼の魔女', emoji: '🧟', color: '#da77f2',
    hp: 195, atk: 48, def: 36, agi: 22, exp: 145, gold: 175, resist: 0.4, acts: 2,
    actions: [
      { kind: 'attack', w: 35 },
      { kind: 'spell', id: 'flamra', w: 35 },
      { kind: 'heal', power: 90, w: 15 },
      { kind: 'sleep', w: 15 },
    ],
  },
  {
    id: 'knight', name: 'やみの騎兵', emoji: '😈', color: '#f06595',
    hp: 320, atk: 74, def: 54, agi: 24, exp: 210, gold: 240, resist: 0.2, acts: 2,
    actions: [{ kind: 'attack', w: 80 }, { kind: 'breath', power: [30, 42], w: 20 }],
  },
  {
    id: 'dragon', name: 'ドラゴン', emoji: '🐉', color: '#69db7c',
    hp: 420, atk: 82, def: 60, agi: 18, exp: 330, gold: 390, resist: 0.5, acts: 2,
    actions: [{ kind: 'attack', w: 60 }, { kind: 'breath', power: [42, 58], w: 40 }],
  },
  {
    id: 'gald', name: 'やみの将 ガルド', emoji: '🗡️', color: '#ffa8a8',
    hp: 700, atk: 62, def: 44, agi: 20, exp: 420, gold: 520, resist: 0.25, boss: true, acts: 2,
    actions: [
      { kind: 'attack', w: 60 },
      { kind: 'breath', power: [26, 38], w: 25 },
      { kind: 'heal', power: 70, w: 15 },
    ],
  },
  {
    id: 'darklord', name: 'まおう ザルガス', emoji: '👹', color: '#ff6b6b',
    hp: 1600, atk: 114, def: 66, agi: 26, exp: 0, gold: 0, resist: 0.35, boss: true, final: true, acts: 3,
    actions: [
      { kind: 'attack', w: 40 },
      { kind: 'breath', power: [52, 70], w: 25 },
      { kind: 'spell', id: 'flamra', w: 15 },
      { kind: 'heal', power: 90, w: 10 },
      { kind: 'sleep', w: 10 },
    ],
  },
];

export const monsterById = (id) => MONSTERS.find((m) => m.id === id) || null;

// ---------------------------------------------------------------- ダメージ

/** 通常攻撃のダメージ。守備力が高いとほとんど通らない。 */
export function attackDamage(atk, def, rng = Math.random) {
  const base = atk - def / 2;
  if (base <= 0) return rng() < 0.5 ? 0 : 1;
  return Math.max(1, Math.round(base * (0.4 + rng() * 0.4)));
}

/** するどい一撃は 守備力を無視する。 */
/** するどい一撃の出る確率。 */
export const CRITICAL_RATE = 1 / 24;

export const criticalDamage = (atk, rng = Math.random) => Math.max(1, Math.round(atk * (0.95 + rng() * 0.35)));

/** 呪文・ブレスのダメージ。resist のぶんだけ軽くなる。 */
export function spellDamage(range, resist = 0, rng = Math.random) {
  const raw = randInt(range[0], range[1], rng);
  return Math.max(1, Math.round(raw * (1 - clamp(resist, 0, 0.9))));
}

// ---------------------------------------------------------------- 戦闘

/**
 * パーティ 対 魔物 1 匹の戦闘。
 * resolve(actions) に「生きている仲間ぶんの行動」を渡すと 1 ターン分を解決して、
 * 画面に流すメッセージ（[{text, fx}]）を返す。
 *
 * actions は仲間と同じ並びの配列で、中身は
 *   { type:'attack' } / { type:'spell', id, target } / { type:'item', id, target } / { type:'flee' }
 */
export class Battle {
  constructor(save, monsterId, rng = Math.random) {
    const base = monsterById(monsterId);
    if (!base) throw new Error(`未知のモンスター: ${monsterId}`);
    this.save = save;
    this.party = save.party;
    this.rng = rng;
    this.monster = { ...base, maxHp: base.hp, acts: base.acts || 1 };
    this.result = null;        // null / 'win' / 'lose' / 'escaped'
    this.reward = { exp: 0, gold: 0 };
    this.turn = 0;
    this.sleep = new Map();    // 眠っている仲間 → 残りターン
    this.buff = new Set();     // ブレイヴ中の仲間
    this.monsterSleep = 0;
  }

  get over() { return this.result !== null; }

  /** 戦える（生きていて 眠っていない）仲間。 */
  get actors() { return alive(this.party); }

  atkOf(member) {
    const atk = statsOf(member).atk;
    return this.buff.has(member) ? Math.round(atk * 1.6) : atk;
  }

  /** 戦闘開始時のメッセージ。 */
  start() {
    return [{ text: `${this.monster.name}が あらわれた！`, fx: 'appear' }];
  }

  resolve(actions) {
    if (this.over) return [];
    this.turn++;
    const lines = [];

    // 「にげる」は パーティ全体の行動。ひとりでも選んでいたら まず逃げてみる。
    const fleeing = this.party.some((m, i) => !isDown(m) && actions[i]?.type === 'flee');
    if (fleeing) {
      lines.push(...this.#tryFlee());
      if (this.over) return lines;
    }

    // すばやさ順。魔物は acts の回数だけ 順番に割りこむ。
    const order = [];
    for (const member of this.party) {
      if (isDown(member)) continue;
      const i = this.party.indexOf(member);
      if (fleeing && actions[i]?.type === 'flee') continue;     // 逃げそこねた人は動けない
      order.push({ member, action: actions[i], speed: statsOf(member).agi * (0.75 + this.rng() * 0.5) });
    }
    for (let i = 0; i < this.monster.acts; i++) {
      order.push({ monster: true, speed: this.monster.agi * (0.75 + this.rng() * 0.5) });
    }
    order.sort((a, b) => b.speed - a.speed);

    for (const slot of order) {
      if (this.over) break;
      if (slot.monster) {
        lines.push(...this.#monsterAction());
      } else if (!isDown(slot.member)) {
        lines.push(...this.#memberAction(slot.member, slot.action));
      }
    }
    return lines;
  }

  #tryFlee() {
    const lines = [{ text: `${leaderOf(this.save).name}たちは 逃げだした！`, fx: 'flee' }];
    if (this.monster.boss) {
      lines.push({ text: 'しかし まわりを 結界に はばまれた！', fx: 'fail' });
      return lines;
    }
    const fastest = Math.max(...alive(this.party).map((m) => statsOf(m).agi));
    const chance = clamp(0.45 + (fastest - this.monster.agi) / 90, 0.15, 0.92);
    if (this.rng() < chance) this.result = 'escaped';
    else lines.push({ text: 'しかし 追いつかれてしまった！', fx: 'fail' });
    return lines;
  }

  #memberAction(member, action) {
    const lines = [];

    if (this.sleep.get(member) > 0) {
      this.sleep.set(member, this.sleep.get(member) - 1);
      lines.push({ text: `${member.name}は ねむっている……`, fx: 'sleep' });
      if (this.sleep.get(member) === 0) lines.push({ text: `${member.name}は 目をさました！` });
      return lines;
    }
    if (!action || action.type === 'flee') return lines;

    if (action.type === 'item') {
      const target = action.target || member;
      const res = useItem(this.save, action.id, target, 'battle', this.rng);
      lines.push({ text: `${member.name}は ${itemById(action.id)?.name || '道具'}を つかった！`, fx: 'cast' });
      lines.push({ text: res.text, fx: res.fx || 'fail' });
      return lines;
    }

    if (action.type === 'spell') {
      const spell = spellById(action.id);
      if (!spell || !knowsSpell(member, action.id)) return [{ text: `${member.name}は その呪文を 知らない。`, fx: 'fail' }];
      if (member.mp < spell.mp) return [{ text: `${member.name}の MP が 足りない！`, fx: 'fail' }];
      member.mp -= spell.mp;
      lines.push({ text: `${member.name}は ${spell.name}を となえた！`, fx: 'cast' });
      lines.push(...this.#castSpell(member, spell, action.target || member));
      return lines;
    }

    // たたかう
    if (this.rng() < CRITICAL_RATE) {
      lines.push({ text: `${member.name}の こうげき！\nするどい 一撃！！`, fx: 'critical' });
      return [...lines, ...this.#hurtMonster(criticalDamage(this.atkOf(member), this.rng))];
    }
    lines.push({ text: `${member.name}の こうげき！`, fx: 'swing' });
    const dmg = attackDamage(this.atkOf(member), this.monster.def, this.rng);
    if (dmg <= 0) {
      lines.push({ text: 'ミス！ ダメージを あたえられない！', fx: 'fail' });
      return lines;
    }
    return [...lines, ...this.#hurtMonster(dmg)];
  }

  #castSpell(member, spell, target) {
    const lines = [];
    switch (spell.kind) {
      case 'attack':
        return this.#hurtMonster(spellDamage(spell.power, this.monster.resist, this.rng));
      case 'heal': {
        if (isDown(target)) return [{ text: `しかし ${target.name}は 倒れている。`, fx: 'fail' }];
        const s = statsOf(target);
        const heal = spell.power === 'full'
          ? s.maxHp - target.hp
          : Math.min(s.maxHp - target.hp, randInt(spell.power[0], spell.power[1], this.rng));
        target.hp += heal;
        lines.push({ text: heal > 0 ? `${target.name}の HP が ${heal} 回復した。` : `しかし ${target.name}の HP は 満タンだ。`, fx: 'heal' });
        return lines;
      }
      case 'revive':
        if (!isDown(target)) return [{ text: `しかし ${target.name}は 元気だ。`, fx: 'fail' }];
        if (this.rng() < 0.5) {
          revive(target, 0.5);
          lines.push({ text: `${target.name}は 生き返った！`, fx: 'heal' });
        } else {
          lines.push({ text: `しかし ${target.name}は 生き返らなかった……`, fx: 'fail' });
        }
        return lines;
      case 'buff':
        this.buff.add(target);
        return [{ text: `${target.name}の 攻撃力が 上がった！`, fx: 'buff' }];
      case 'sleep':
        if (this.monsterSleep > 0 || this.rng() < (this.monster.boss ? 0.85 : 0.35)) {
          return [{ text: 'しかし 効かなかった！', fx: 'fail' }];
        }
        this.monsterSleep = randInt(2, 4, this.rng);
        return [{ text: `${this.monster.name}は 眠ってしまった！`, fx: 'sleep' }];
      default:
        return [{ text: 'しかし 戦いの中では 効果がなかった。', fx: 'fail' }];
    }
  }

  #hurtMonster(dmg) {
    const lines = [];
    this.monster.hp -= dmg;
    if (this.monsterSleep > 0 && this.rng() < 0.25) this.monsterSleep = 0;   // 痛みで目をさますことがある
    lines.push({ text: `${this.monster.name}に ${dmg} のダメージ！`, fx: 'hit-monster', damage: dmg });
    if (this.monster.hp <= 0) {
      this.monster.hp = 0;
      this.result = 'win';
      this.reward = { exp: this.monster.exp, gold: this.monster.gold };
      lines.push({ text: `${this.monster.name}を たおした！`, fx: 'defeat' });
    }
    return lines;
  }

  /** 魔物が ねらう相手。生きている仲間からランダムに選ぶ。 */
  #pickTarget() {
    const living = alive(this.party);
    return living[Math.floor(this.rng() * living.length)] || null;
  }

  #monsterAction() {
    const monster = this.monster;
    const lines = [];

    if (this.monsterSleep > 0) {
      this.monsterSleep--;
      lines.push({ text: `${monster.name}は ねむっている。`, fx: 'sleep' });
      if (this.monsterSleep === 0) lines.push({ text: `${monster.name}は 目をさました！` });
      return lines;
    }

    const target = this.#pickTarget();
    if (!target) return lines;

    const pool = monster.actions.filter((a) => !(a.kind === 'heal' && monster.hp > monster.maxHp * 0.4));
    const act = weightedPick(pool.length ? pool : monster.actions, (a) => a.w, this.rng);

    if (act.kind === 'heal') {
      monster.hp = Math.min(monster.maxHp, monster.hp + act.power);
      return [{ text: `${monster.name}は リカを となえた！\n${monster.name}の HP が 回復した。`, fx: 'heal-monster' }];
    }

    if (act.kind === 'sleep') {
      lines.push({ text: `${monster.name}は ソムナを となえた！`, fx: 'cast' });
      if (this.sleep.get(target) > 0 || this.rng() < 0.35) {
        lines.push({ text: 'しかし 効かなかった！', fx: 'fail' });
      } else {
        this.sleep.set(target, randInt(2, 4, this.rng));
        lines.push({ text: `${target.name}は 眠ってしまった！`, fx: 'sleep' });
      }
      return lines;
    }

    if (act.kind === 'spell') {
      const spell = spellById(act.id);
      lines.push({ text: `${monster.name}は ${spell.name}を となえた！`, fx: 'cast' });
      return [...lines, ...this.#hurtMember(target, spellDamage(spell.power, 0, this.rng), true)];
    }

    if (act.kind === 'breath') {
      lines.push({ text: `${monster.name}は 炎を はきだした！`, fx: 'cast' });
      return [...lines, ...this.#hurtMember(target, spellDamage(act.power, 0, this.rng), true)];
    }

    lines.push({ text: `${monster.name}の こうげき！`, fx: 'swing' });
    const dmg = attackDamage(monster.atk, statsOf(target).def, this.rng);
    if (dmg <= 0) {
      lines.push({ text: `${target.name}は うまく身をかわした！`, fx: 'fail' });
      return lines;
    }
    return [...lines, ...this.#hurtMember(target, dmg)];
  }

  #hurtMember(target, dmg, magic = false) {
    const lines = [];
    target.hp = Math.max(0, target.hp - dmg);
    lines.push({
      text: `${target.name}は ${dmg} のダメージを うけた！`,
      fx: magic ? 'hit-hero-magic' : 'hit-hero',
      damage: dmg,
      target: this.party.indexOf(target),
    });
    if (target.hp <= 0) {
      this.sleep.delete(target);
      this.buff.delete(target);
      lines.push({ text: `${target.name}は たおれてしまった！`, fx: 'dead' });
      if (!alive(this.party).length) {
        this.result = 'lose';
        lines.push({ text: 'パーティは 全滅した……', fx: 'wipe' });
      }
    } else if (this.sleep.get(target) > 0) {
      this.sleep.delete(target);
      lines.push({ text: `${target.name}は 目をさました！` });
    }
    return lines;
  }
}

/** 勝ったあとの経験値と金貨の受け取り。生きている仲間だけが経験を積む。 */
export function claimReward(save, battle) {
  const { exp, gold } = battle.reward;
  save.gold = Math.min(999999, save.gold + gold);
  const levels = [];
  for (const member of save.party) {
    if (isDown(member)) continue;
    for (const up of gainExp(member, exp)) levels.push({ member, ...up });
  }
  return { exp, gold, levels };
}

/** 全滅したときの処理。所持金が半分になって 村で目を覚ます。 */
export function onDefeat(save) {
  const lost = Math.floor(save.gold / 2);
  save.gold -= lost;
  healAll(save);
  save.map = START.map;
  save.x = START.x;
  save.y = START.y;
  save.dir = 'down';
  return { lost };
}
