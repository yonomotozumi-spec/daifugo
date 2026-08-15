/**
 * RPG「ひかりのつるぎ」のルールエンジン。
 * DOM に依存しないので、ブラウザと Node の両方から読み込める。
 * マップは world.js、描画は scene.js、画面まわりは ui.js に任せる。
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
 * spells はそのレベルで覚える呪文。
 */
export const LEVELS = [
  { level: 1, exp: 0, hp: 20, mp: 0, str: 6, agi: 5, spells: [] },
  { level: 2, exp: 8, hp: 26, mp: 0, str: 9, agi: 7, spells: [] },
  { level: 3, exp: 22, hp: 32, mp: 6, str: 12, agi: 9, spells: ['hoimi'] },
  { level: 4, exp: 45, hp: 38, mp: 10, str: 15, agi: 11, spells: ['gira'] },
  { level: 5, exp: 80, hp: 46, mp: 14, str: 19, agi: 13, spells: [] },
  { level: 6, exp: 130, hp: 54, mp: 18, str: 23, agi: 15, spells: ['rura'] },
  { level: 7, exp: 200, hp: 63, mp: 23, str: 27, agi: 17, spells: [] },
  { level: 8, exp: 290, hp: 72, mp: 28, str: 31, agi: 20, spells: ['behoimi'] },
  { level: 9, exp: 420, hp: 82, mp: 33, str: 36, agi: 23, spells: [] },
  { level: 10, exp: 600, hp: 93, mp: 38, str: 41, agi: 26, spells: ['begirama'] },
  { level: 11, exp: 850, hp: 104, mp: 44, str: 46, agi: 29, spells: [] },
  { level: 12, exp: 1150, hp: 116, mp: 50, str: 52, agi: 32, spells: ['baikiruto'] },
  { level: 13, exp: 1550, hp: 128, mp: 56, str: 58, agi: 35, spells: [] },
  { level: 14, exp: 2050, hp: 140, mp: 62, str: 64, agi: 38, spells: [] },
  { level: 15, exp: 2600, hp: 153, mp: 69, str: 70, agi: 41, spells: ['behoma'] },
  { level: 16, exp: 3300, hp: 166, mp: 76, str: 77, agi: 44, spells: [] },
  { level: 17, exp: 4200, hp: 180, mp: 83, str: 84, agi: 47, spells: [] },
  { level: 18, exp: 5200, hp: 194, mp: 90, str: 91, agi: 50, spells: ['ionazun'] },
  { level: 19, exp: 6400, hp: 209, mp: 98, str: 98, agi: 53, spells: [] },
  { level: 20, exp: 7800, hp: 225, mp: 106, str: 106, agi: 57, spells: [] },
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

// ---------------------------------------------------------------- 呪文

export const SPELLS = [
  { id: 'hoimi', name: 'ホイミ', mp: 4, kind: 'heal', power: [28, 38], field: true, desc: 'HP を 30 ほど回復する' },
  { id: 'gira', name: 'ギラ', mp: 5, kind: 'attack', power: [16, 24], field: false, desc: '炎で 20 ほどのダメージ' },
  { id: 'rura', name: 'ルーラ', mp: 6, kind: 'warp', field: true, battle: false, desc: 'はじまりの村へ飛んで帰る' },
  { id: 'behoimi', name: 'ベホイミ', mp: 8, kind: 'heal', power: [78, 98], field: true, desc: 'HP を 85 ほど回復する' },
  { id: 'begirama', name: 'ベギラマ', mp: 9, kind: 'attack', power: [40, 54], field: false, desc: '大きな炎で 45 ほどのダメージ' },
  { id: 'baikiruto', name: 'バイキルト', mp: 10, kind: 'buff', field: false, desc: '戦闘のあいだ攻撃力が上がる' },
  { id: 'behoma', name: 'ベホマ', mp: 14, kind: 'heal', power: 'full', field: true, desc: 'HP を全回復する' },
  { id: 'ionazun', name: 'イオナズン', mp: 20, kind: 'attack', power: [90, 120], field: false, desc: '爆裂で 100 ほどのダメージ' },
];

export const spellById = (id) => SPELLS.find((s) => s.id === id) || null;

/** そのレベルまでに覚えている呪文。 */
export function spellsOf(hero) {
  const level = levelOf(hero.exp);
  const ids = [];
  for (const row of LEVELS) {
    if (row.level > level) break;
    ids.push(...row.spells);
  }
  return ids.map(spellById);
}

export const knowsSpell = (hero, id) => spellsOf(hero).some((s) => s.id === id);

// ---------------------------------------------------------------- 道具

export const ITEMS = [
  { id: 'herb', name: 'やくそう', price: 24, kind: 'heal', power: 34, field: true, battle: true, desc: 'HP を 34 ほど回復する' },
  { id: 'water', name: 'まほうのせいすい', price: 78, kind: 'mp', power: 26, field: true, battle: true, desc: 'MP を 26 回復する' },
  { id: 'wing', name: 'キメラのつばさ', price: 36, kind: 'warp', field: true, battle: false, desc: 'はじまりの村へ帰る' },
  { id: 'seedStr', name: 'ちからのたね', price: 0, kind: 'seedStr', power: 5, field: true, battle: false, desc: 'ちからが永久に上がる' },
  { id: 'seedHp', name: 'いのちのきのみ', price: 0, kind: 'seedHp', power: 15, field: true, battle: false, desc: '最大 HP が永久に上がる' },
  { id: 'orb', name: 'ひかりのたま', price: 0, kind: 'key', field: false, battle: false, desc: '魔王の城の結界を破るという宝玉' },
];

export const itemById = (id) => ITEMS.find((i) => i.id === id) || null;

/** 売値は買値の半分。売れない道具は 0。 */
export const sellPrice = (id) => Math.floor((itemById(id)?.price || 0) / 2);

// ---------------------------------------------------------------- 装備

export const WEAPONS = [
  { id: 'none', name: 'そぼくなこぶし', price: 0, atk: 0, shop: false },
  { id: 'stick', name: 'ひのきのぼう', price: 20, atk: 3, shop: true },
  { id: 'copper', name: 'どうのつるぎ', price: 140, atk: 12, shop: true },
  { id: 'steel', name: 'はがねのつるぎ', price: 720, atk: 26, shop: true },
  { id: 'flame', name: 'ほのおのつるぎ', price: 2600, atk: 42, shop: true },
  { id: 'light', name: 'ひかりのつるぎ', price: 0, atk: 58, shop: false },
];

export const ARMORS = [
  { id: 'none', name: 'ただのふく', price: 0, def: 0, shop: false },
  { id: 'clothes', name: 'たびびとのふく', price: 30, def: 3, shop: true },
  { id: 'leather', name: 'かわのよろい', price: 180, def: 8, shop: true },
  { id: 'chain', name: 'くさりかたびら', price: 480, def: 14, shop: true },
  { id: 'iron', name: 'てつのよろい', price: 1200, def: 22, shop: true },
  { id: 'magic', name: 'まほうのよろい', price: 3000, def: 32, shop: true },
  { id: 'lightArmor', name: 'ひかりのよろい', price: 0, def: 42, shop: false },
];

export const SHIELDS = [
  { id: 'none', name: 'なし', price: 0, def: 0, shop: false },
  { id: 'leatherShield', name: 'かわのたて', price: 110, def: 5, shop: true },
  { id: 'ironShield', name: 'てつのたて', price: 620, def: 12, shop: true },
  { id: 'mirrorShield', name: 'みかがみのたて', price: 2400, def: 22, shop: true },
];

/** 装備の種類。slot はセーブデータのキーでもある。 */
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

/** 全装備をひとつの配列で。店の品ぞろえづくりに使う。 */
export const ALL_GEAR = GEAR.flatMap((g) => g.list.filter((item) => item.id !== 'none').map((item) => ({ ...item, slot: g.slot })));

export const allGearById = (id) => ALL_GEAR.find((g) => g.id === id) || null;

// ---------------------------------------------------------------- 主人公

export const START = { map: 'town', x: 10, y: 11, dir: 'down' };

export function createHero(name = 'ゆうしゃ') {
  const hero = {
    v: 1,
    name,
    exp: 0,
    gold: 30,
    hp: 20,
    mp: 0,
    bonusHp: 0,
    bonusStr: 0,
    weapon: 'none',
    armor: 'none',
    shield: 'none',
    items: { herb: 2 },
    flags: {},
    chests: [],
    steps: 0,
    map: START.map,
    x: START.x,
    y: START.y,
    dir: START.dir,
  };
  const s = statsOf(hero);
  hero.hp = s.maxHp;
  hero.mp = s.maxMp;
  return hero;
}

/** セーブデータを読み込む。壊れていても遊べる形に直す。 */
export function normalizeHero(raw) {
  const base = createHero();
  if (!raw || typeof raw !== 'object') return base;

  const hero = { ...base, ...raw };
  hero.name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.slice(0, 8) : base.name;
  hero.exp = Math.max(0, Math.floor(Number(raw.exp) || 0));
  hero.gold = clamp(Math.floor(Number(raw.gold) || 0), 0, 999999);
  hero.bonusHp = Math.max(0, Math.floor(Number(raw.bonusHp) || 0));
  hero.bonusStr = Math.max(0, Math.floor(Number(raw.bonusStr) || 0));
  hero.steps = Math.max(0, Math.floor(Number(raw.steps) || 0));

  for (const { slot, list } of GEAR) {
    hero[slot] = list.some((g) => g.id === raw[slot]) ? raw[slot] : 'none';
  }

  hero.items = {};
  if (raw.items && typeof raw.items === 'object') {
    for (const [id, count] of Object.entries(raw.items)) {
      const n = Math.floor(Number(count) || 0);
      if (itemById(id) && n > 0) hero.items[id] = Math.min(n, 99);
    }
  }

  hero.flags = raw.flags && typeof raw.flags === 'object' ? { ...raw.flags } : {};
  hero.chests = Array.isArray(raw.chests) ? raw.chests.filter((id) => typeof id === 'string') : [];

  const s = statsOf(hero);
  hero.hp = clamp(Math.floor(Number(raw.hp) ?? s.maxHp), 0, s.maxHp);
  hero.mp = clamp(Math.floor(Number(raw.mp) ?? s.maxMp), 0, s.maxMp);
  if (hero.hp <= 0) hero.hp = s.maxHp;   // 全滅したまま保存されていても詰まないように

  hero.map = typeof raw.map === 'string' ? raw.map : START.map;
  hero.x = Math.floor(Number(raw.x) ?? START.x);
  hero.y = Math.floor(Number(raw.y) ?? START.y);
  hero.dir = ['up', 'down', 'left', 'right'].includes(raw.dir) ? raw.dir : START.dir;
  return hero;
}

/** レベル・装備・たねを合わせた最終的な能力。 */
export function statsOf(hero) {
  const level = levelOf(hero.exp);
  const row = levelRow(level);
  const weapon = gearById('weapon', hero.weapon);
  const armor = gearById('armor', hero.armor);
  const shield = gearById('shield', hero.shield);
  const str = row.str + (hero.bonusStr || 0);
  const agi = row.agi;
  return {
    level,
    maxHp: row.hp + (hero.bonusHp || 0),
    maxMp: row.mp,
    str,
    agi,
    atk: str + weapon.atk,
    def: Math.floor(agi / 2) + armor.def + shield.def,
    weapon,
    armor,
    shield,
    nextExp: expToNext(hero.exp),
  };
}

/** 経験値を足してレベルアップを判定する。上がった分の情報を返す。 */
export function gainExp(hero, amount) {
  const before = levelOf(hero.exp);
  hero.exp += Math.max(0, Math.floor(amount));
  const after = levelOf(hero.exp);
  const gained = [];
  for (let level = before + 1; level <= after; level++) {
    const row = levelRow(level);
    gained.push({ level, spells: row.spells.map(spellById) });
  }
  if (gained.length) {
    // ドラクエと同じで、レベルが上がると上がった分だけ HP / MP も回復する。
    const s = statsOf(hero);
    const beforeRow = levelRow(before);
    hero.hp = Math.min(s.maxHp, hero.hp + (s.maxHp - (beforeRow.hp + (hero.bonusHp || 0))));
    hero.mp = Math.min(s.maxMp, hero.mp + (s.maxMp - beforeRow.mp));
  }
  return gained;
}

// ---------------------------------------------------------------- 持ち物

export const ITEM_LIMIT = 12;

/** 持っている道具を [{item, count}] で返す。 */
export function itemList(hero) {
  return ITEMS.filter((i) => (hero.items[i.id] || 0) > 0).map((item) => ({ item, count: hero.items[item.id] }));
}

export const itemCount = (hero, id) => hero.items[id] || 0;

export const hasItem = (hero, id) => itemCount(hero, id) > 0;

/** 持ち物の種類が上限を超えていたら false（同じ道具は重ねられる）。 */
export function addItem(hero, id, count = 1) {
  if (!itemById(id)) return false;
  if (!hero.items[id] && itemList(hero).length >= ITEM_LIMIT) return false;
  hero.items[id] = Math.min(99, (hero.items[id] || 0) + count);
  return true;
}

export function removeItem(hero, id, count = 1) {
  if (!hasItem(hero, id)) return false;
  hero.items[id] -= count;
  if (hero.items[id] <= 0) delete hero.items[id];
  return true;
}

/**
 * 道具を使う。where は 'field' か 'battle'。
 * 戻り値の consumed が true なら道具が減っている。
 */
export function useItem(hero, id, where = 'field', rng = Math.random) {
  const item = itemById(id);
  if (!item || !hasItem(hero, id)) return { ok: false, text: 'その道具は持っていない。' };
  if (where === 'battle' && !item.battle) return { ok: false, text: `${item.name}は 戦いの中では使えない！` };
  if (where === 'field' && !item.field) return { ok: false, text: `${item.name}は いま使ってもなにも起きない。` };

  const s = statsOf(hero);
  switch (item.kind) {
    case 'heal': {
      if (hero.hp >= s.maxHp) return { ok: false, text: 'HP は満タンだ。' };
      const heal = Math.min(s.maxHp - hero.hp, randInt(item.power - 4, item.power + 4, rng));
      hero.hp += heal;
      removeItem(hero, id);
      return { ok: true, consumed: true, heal, fx: 'heal', text: `${hero.name}は ${item.name}を つかった！\nHP が ${heal} 回復した。` };
    }
    case 'mp': {
      if (s.maxMp === 0) return { ok: false, text: 'まだ呪文をおぼえていない。' };
      if (hero.mp >= s.maxMp) return { ok: false, text: 'MP は満タンだ。' };
      const heal = Math.min(s.maxMp - hero.mp, item.power);
      hero.mp += heal;
      removeItem(hero, id);
      return { ok: true, consumed: true, fx: 'heal', text: `${hero.name}は ${item.name}を つかった！\nMP が ${heal} 回復した。` };
    }
    case 'warp':
      removeItem(hero, id);
      return { ok: true, consumed: true, warp: true, fx: 'warp', text: `${item.name}を つかった！\n空へ舞い上がった！` };
    case 'seedStr':
      hero.bonusStr += item.power;
      removeItem(hero, id);
      return { ok: true, consumed: true, fx: 'heal', text: `${hero.name}の ちからが ${item.power} 上がった！` };
    case 'seedHp': {
      hero.bonusHp += item.power;
      hero.hp += item.power;
      removeItem(hero, id);
      return { ok: true, consumed: true, fx: 'heal', text: `${hero.name}の 最大 HP が ${item.power} 上がった！` };
    }
    default:
      return { ok: false, text: `${item.name}は だいじな品だ。` };
  }
}

// ---------------------------------------------------------------- 店・宿

/** 宿代はレベルが上がるほど高い。 */
export const innCost = (hero) => 4 + levelOf(hero.exp) * 3;

/** 買い物。戻り値の ok が false なら text に理由が入る。 */
export function buy(hero, id) {
  const gear = allGearById(id);
  const item = itemById(id);
  const goods = gear || item;
  if (!goods) return { ok: false, text: 'それは売っていない。' };
  if (hero.gold < goods.price) return { ok: false, text: 'お金が足りないようだ。' };

  if (gear) {
    const old = gearById(gear.slot, hero[gear.slot]);
    if (old.id === gear.id) return { ok: false, text: 'それは もう装備している。' };
    hero.gold -= gear.price;
    hero[gear.slot] = gear.id;
    const back = old.id === 'none' ? '' : `\n${old.name}は 下取りに出した。`;
    return { ok: true, text: `${gear.name}を 手に入れた！${back}` };
  }

  if (!addItem(hero, id)) return { ok: false, text: 'これ以上 道具を持てない。' };
  hero.gold -= item.price;
  return { ok: true, text: `${item.name}を 手に入れた！` };
}

/** 道具を売る。装備は下取り扱いなので売れない。 */
export function sell(hero, id) {
  const item = itemById(id);
  if (!item || !hasItem(hero, id)) return { ok: false, text: 'それは持っていない。' };
  const price = sellPrice(id);
  if (price <= 0) return { ok: false, text: 'それは 買い取れないよ。' };
  removeItem(hero, id);
  hero.gold = Math.min(999999, hero.gold + price);
  return { ok: true, price, text: `${item.name}を ${price} ゴールドで 売った。` };
}

// ---------------------------------------------------------------- モンスター

/**
 * actions は行動の抽選表。kind は attack / spell / breath / heal / sleep。
 * resist は炎・爆発系の呪文が効きにくくなる割合（0 で等倍）。
 */
export const MONSTERS = [
  {
    id: 'slime', name: 'スライム', emoji: '🟢', color: '#4dd07a',
    hp: 8, atk: 6, def: 3, agi: 4, exp: 3, gold: 6, resist: 0,
    actions: [{ kind: 'attack', w: 100 }],
  },
  {
    id: 'rat', name: 'おおねずみ', emoji: '🐀', color: '#b39d86',
    hp: 14, atk: 9, def: 5, agi: 10, exp: 6, gold: 9, resist: 0,
    actions: [{ kind: 'attack', w: 100 }],
  },
  {
    id: 'bee', name: 'キラービー', emoji: '🐝', color: '#ffd43b',
    hp: 17, atk: 12, def: 7, agi: 18, exp: 10, gold: 13, resist: 0,
    actions: [{ kind: 'attack', w: 100 }],
  },
  {
    id: 'goblin', name: 'ゴブリン', emoji: '👺', color: '#e07a5f',
    hp: 26, atk: 17, def: 10, agi: 9, exp: 15, gold: 18, resist: 0,
    actions: [{ kind: 'attack', w: 100 }],
  },
  {
    id: 'wolf', name: 'あばれオオカミ', emoji: '🐺', color: '#9aa5b1',
    hp: 38, atk: 30, def: 16, agi: 16, exp: 26, gold: 28, resist: 0,
    actions: [{ kind: 'attack', w: 88 }, { kind: 'sleep', w: 12 }],
  },
  {
    id: 'mage', name: 'まどうし', emoji: '🧙', color: '#b197fc',
    hp: 30, atk: 20, def: 14, agi: 14, exp: 32, gold: 42, resist: 0.3,
    actions: [{ kind: 'attack', w: 45 }, { kind: 'spell', id: 'gira', w: 40 }, { kind: 'heal', power: 25, w: 15 }],
  },
  {
    id: 'armor', name: 'さまようよろい', emoji: '🛡️', color: '#adb5bd',
    hp: 50, atk: 34, def: 28, agi: 10, exp: 40, gold: 48, resist: 0.1,
    actions: [{ kind: 'attack', w: 100 }],
  },
  {
    id: 'skeleton', name: 'がいこつ剣士', emoji: '💀', color: '#dee2e6',
    hp: 62, atk: 44, def: 30, agi: 16, exp: 65, gold: 75, resist: 0.1,
    actions: [{ kind: 'attack', w: 85 }, { kind: 'sleep', w: 15 }],
  },
  {
    id: 'lizard', name: 'どくトカゲ', emoji: '🦎', color: '#82c91e',
    hp: 72, atk: 50, def: 34, agi: 14, exp: 80, gold: 90, resist: 0.2,
    actions: [{ kind: 'attack', w: 75 }, { kind: 'breath', power: [24, 34], w: 25 }],
  },
  {
    id: 'golem', name: 'ゴーレム', emoji: '🗿', color: '#8d99ae',
    hp: 120, atk: 62, def: 50, agi: 6, exp: 135, gold: 165, resist: 0.15,
    actions: [{ kind: 'attack', w: 100 }],
  },
  {
    id: 'witch', name: 'まじょ', emoji: '🧟', color: '#da77f2',
    hp: 85, atk: 44, def: 36, agi: 22, exp: 145, gold: 175, resist: 0.4,
    actions: [
      { kind: 'attack', w: 35 },
      { kind: 'spell', id: 'begirama', w: 35 },
      { kind: 'heal', power: 55, w: 15 },
      { kind: 'sleep', w: 15 },
    ],
  },
  {
    id: 'knight', name: 'あくまのきし', emoji: '😈', color: '#f06595',
    hp: 140, atk: 70, def: 54, agi: 24, exp: 210, gold: 240, resist: 0.2,
    actions: [{ kind: 'attack', w: 80 }, { kind: 'breath', power: [30, 42], w: 20 }],
  },
  {
    id: 'dragon', name: 'ドラゴン', emoji: '🐉', color: '#69db7c',
    hp: 180, atk: 78, def: 60, agi: 18, exp: 330, gold: 390, resist: 0.5,
    actions: [{ kind: 'attack', w: 60 }, { kind: 'breath', power: [42, 58], w: 40 }],
  },
  {
    id: 'darklord', name: 'まおう ダークロード', emoji: '👹', color: '#ff6b6b',
    hp: 360, atk: 92, def: 66, agi: 26, exp: 0, gold: 0, resist: 0.35, boss: true,
    actions: [
      { kind: 'attack', w: 40 },
      { kind: 'breath', power: [52, 70], w: 25 },
      { kind: 'spell', id: 'begirama', w: 15 },
      { kind: 'heal', power: 70, w: 10 },
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

/** かいしんのいちげきは守備力を無視する。 */
export const CRITICAL_RATE = 1 / 24;

export const criticalDamage = (atk, rng = Math.random) => Math.max(1, Math.round(atk * (0.95 + rng() * 0.35)));

/** 呪文・ブレスのダメージ。resist のぶんだけ軽くなる。 */
export function spellDamage(range, resist = 0, rng = Math.random) {
  const raw = randInt(range[0], range[1], rng);
  return Math.max(1, Math.round(raw * (1 - clamp(resist, 0, 0.9))));
}

// ---------------------------------------------------------------- 戦闘

/**
 * 1 対 1 の戦闘。command() を呼ぶと 1 ターン分を解決して、
 * 画面に流すメッセージ（[{text, fx}]）を返す。
 */
export class Battle {
  constructor(hero, monsterId, rng = Math.random) {
    const base = monsterById(monsterId);
    if (!base) throw new Error(`未知のモンスター: ${monsterId}`);
    this.hero = hero;
    this.rng = rng;
    this.monster = { ...base, maxHp: base.hp };
    this.result = null;        // null / 'win' / 'lose' / 'escaped'
    this.reward = { exp: 0, gold: 0 };
    this.turn = 0;
    this.sleep = 0;            // 主人公が眠っている残りターン
    this.buff = false;         // バイキルト中か
  }

  get over() { return this.result !== null; }

  get stats() { return statsOf(this.hero); }

  /** 主人公の攻撃力（バイキルト込み）。 */
  get heroAtk() {
    const atk = this.stats.atk;
    return this.buff ? Math.round(atk * 1.6) : atk;
  }

  /** 戦闘開始時のメッセージ。 */
  start() {
    return [{ text: `${this.monster.name}が あらわれた！`, fx: 'appear' }];
  }

  /**
   * command({type, id}) で 1 ターン進める。
   * type は 'attack' / 'spell' / 'item' / 'flee'。
   */
  command(action) {
    if (this.over) return [];
    this.turn++;
    const lines = [];
    const heroFirst = this.rng() * (this.stats.agi + 4) >= this.rng() * (this.monster.agi + 4);

    const heroTurn = () => {
      if (this.over) return;
      if (this.sleep > 0) {
        this.sleep--;
        lines.push({ text: `${this.hero.name}は ねむっている……`, fx: 'sleep' });
        if (this.sleep === 0) lines.push({ text: `${this.hero.name}は 目をさました！` });
        return;
      }
      lines.push(...this.#heroAction(action));
    };

    const monsterTurn = () => {
      if (this.over) return;
      lines.push(...this.#monsterAction());
    };

    if (heroFirst) { heroTurn(); monsterTurn(); } else { monsterTurn(); heroTurn(); }
    return lines;
  }

  #heroAction(action) {
    const lines = [];
    const hero = this.hero;

    if (action.type === 'flee') {
      if (this.monster.boss) {
        lines.push({ text: 'まわりを 結界にはばまれた！\n逃げられない！', fx: 'fail' });
        return lines;
      }
      const chance = clamp(0.45 + (this.stats.agi - this.monster.agi) / 90, 0.15, 0.92);
      lines.push({ text: `${hero.name}は 逃げだした！`, fx: 'flee' });
      if (this.rng() < chance) {
        this.result = 'escaped';
      } else {
        lines.push({ text: 'しかし まわりこまれてしまった！', fx: 'fail' });
      }
      return lines;
    }

    if (action.type === 'item') {
      const res = useItem(hero, action.id, 'battle', this.rng);
      lines.push({ text: res.text, fx: res.fx || 'fail' });
      return lines;
    }

    if (action.type === 'spell') {
      const spell = spellById(action.id);
      if (!spell || !knowsSpell(hero, action.id)) return [{ text: 'そんな呪文は 知らない。', fx: 'fail' }];
      if (hero.mp < spell.mp) return [{ text: 'MP が 足りない！', fx: 'fail' }];
      hero.mp -= spell.mp;
      lines.push({ text: `${hero.name}は ${spell.name}を となえた！`, fx: 'cast' });

      if (spell.kind === 'attack') {
        const dmg = spellDamage(spell.power, this.monster.resist, this.rng);
        lines.push(...this.#hurtMonster(dmg));
      } else if (spell.kind === 'heal') {
        const s = this.stats;
        const heal = spell.power === 'full' ? s.maxHp - hero.hp : Math.min(s.maxHp - hero.hp, randInt(spell.power[0], spell.power[1], this.rng));
        hero.hp += heal;
        lines.push({ text: heal > 0 ? `${hero.name}の HP が ${heal} 回復した。` : 'しかし HP は満タンだ。', fx: 'heal' });
      } else if (spell.kind === 'buff') {
        this.buff = true;
        lines.push({ text: `${hero.name}の 攻撃力が 上がった！`, fx: 'buff' });
      } else {
        lines.push({ text: 'しかし 戦いの中では 効果がなかった。', fx: 'fail' });
      }
      return lines;
    }

    // たたかう
    if (this.rng() < CRITICAL_RATE) {
      lines.push({ text: `${hero.name}の こうげき！\nかいしんの いちげき！！`, fx: 'critical' });
      lines.push(...this.#hurtMonster(criticalDamage(this.heroAtk, this.rng)));
      return lines;
    }
    lines.push({ text: `${hero.name}の こうげき！`, fx: 'swing' });
    const dmg = attackDamage(this.heroAtk, this.monster.def, this.rng);
    if (dmg <= 0) {
      lines.push({ text: 'ミス！ ダメージを あたえられない！', fx: 'fail' });
      return lines;
    }
    lines.push(...this.#hurtMonster(dmg));
    return lines;
  }

  #hurtMonster(dmg) {
    const lines = [];
    this.monster.hp -= dmg;
    lines.push({ text: `${this.monster.name}に ${dmg} のダメージ！`, fx: 'hit-monster', damage: dmg });
    if (this.monster.hp <= 0) {
      this.monster.hp = 0;
      this.result = 'win';
      this.reward = { exp: this.monster.exp, gold: this.monster.gold };
      lines.push({ text: `${this.monster.name}を たおした！`, fx: 'defeat' });
    }
    return lines;
  }

  #monsterAction() {
    const lines = [];
    const monster = this.monster;
    const hero = this.hero;
    const pool = monster.actions.filter((a) => !(a.kind === 'heal' && monster.hp > monster.maxHp * 0.4));
    const act = weightedPick(pool.length ? pool : monster.actions, (a) => a.w, this.rng);

    if (act.kind === 'heal') {
      const heal = Math.min(monster.maxHp - monster.hp, act.power);
      monster.hp += heal;
      lines.push({ text: `${monster.name}は ホイミを となえた！\n${monster.name}の HP が 回復した。`, fx: 'heal-monster' });
      return lines;
    }

    if (act.kind === 'sleep') {
      lines.push({ text: `${monster.name}は ラリホーを となえた！`, fx: 'cast' });
      if (this.sleep > 0 || this.rng() < 0.35) {
        lines.push({ text: 'しかし 効かなかった！', fx: 'fail' });
      } else {
        this.sleep = randInt(2, 4, this.rng);
        lines.push({ text: `${hero.name}は 眠ってしまった！`, fx: 'sleep' });
      }
      return lines;
    }

    if (act.kind === 'spell') {
      const spell = spellById(act.id);
      lines.push({ text: `${monster.name}は ${spell.name}を となえた！`, fx: 'cast' });
      return [...lines, ...this.#hurtHero(spellDamage(spell.power, 0, this.rng), true)];
    }

    if (act.kind === 'breath') {
      lines.push({ text: `${monster.name}は 炎を はきだした！`, fx: 'cast' });
      return [...lines, ...this.#hurtHero(spellDamage(act.power, 0, this.rng), true)];
    }

    lines.push({ text: `${monster.name}の こうげき！`, fx: 'swing' });
    const dmg = attackDamage(monster.atk, this.stats.def, this.rng);
    if (dmg <= 0) {
      lines.push({ text: `${hero.name}は うまく身をかわした！`, fx: 'fail' });
      return lines;
    }
    return [...lines, ...this.#hurtHero(dmg)];
  }

  #hurtHero(dmg, magic = false) {
    const lines = [];
    this.hero.hp = Math.max(0, this.hero.hp - dmg);
    lines.push({ text: `${this.hero.name}は ${dmg} のダメージを うけた！`, fx: magic ? 'hit-hero-magic' : 'hit-hero', damage: dmg });
    if (this.hero.hp <= 0) {
      this.result = 'lose';
      lines.push({ text: `${this.hero.name}は 力つきてしまった……`, fx: 'dead' });
    } else if (this.sleep > 0) {
      this.sleep = 0;
      lines.push({ text: `${this.hero.name}は 目をさました！` });
    }
    return lines;
  }
}

/** 勝ったあとの経験値と金貨の受け取り。 */
export function claimReward(hero, battle) {
  const { exp, gold } = battle.reward;
  hero.gold = Math.min(999999, hero.gold + gold);
  const levels = gainExp(hero, exp);
  return { exp, gold, levels };
}

/** 全滅したときの処理。ドラクエと同じで、所持金が半分になって村に戻る。 */
export function onDefeat(hero) {
  const lost = Math.floor(hero.gold / 2);
  hero.gold -= lost;
  const s = statsOf(hero);
  hero.hp = s.maxHp;
  hero.mp = s.maxMp;
  hero.map = START.map;
  hero.x = START.x;
  hero.y = START.y;
  hero.dir = 'down';
  return { lost };
}

/** 宿屋に泊まる。 */
export function stayInn(hero) {
  const cost = innCost(hero);
  if (hero.gold < cost) return { ok: false, cost, text: 'お金が 足りないようだね。' };
  hero.gold -= cost;
  const s = statsOf(hero);
  hero.hp = s.maxHp;
  hero.mp = s.maxMp;
  return { ok: true, cost, text: 'ぐっすり おやすみ……\n\nおはようございます！\nHP と MP が 全回復した。' };
}
