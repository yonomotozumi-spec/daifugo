/**
 * マップ・NPC・宝箱のデータと、そのまわりの当たり判定。
 * ここも DOM に依存しない（テストから読める）。
 *
 * タイルの文字:
 *   .  くさち（敵が出る）      "  もり（敵が出やすい）    ,  ゆか・洞窟の床（敵が出る）
 *   _  みち・家の中（安全）    f  はなばたけ              =  はし
 *   ^  やま                    ~  みず                    #  かべ
 *   T  き                      o  いわ                    w  カウンター・家具
 *   +  とびら                  <  のぼり階段              >  くだり階段
 *   B  まちの入口              C  ほらあなの入口          K  しろの門
 */

export const TILES = {
  '.': { id: 'grass', name: 'くさち', walk: true, enc: 1 },
  '"': { id: 'forest', name: 'もり', walk: true, enc: 1.7 },
  ',': { id: 'cavefloor', name: 'ゆか', walk: true, enc: 1.2 },
  _: { id: 'road', name: 'みち', walk: true, enc: 0 },
  f: { id: 'flower', name: 'はなばたけ', walk: true, enc: 0 },
  '=': { id: 'bridge', name: 'はし', walk: true, enc: 0.5 },
  '^': { id: 'mountain', name: 'やま', walk: false },
  '~': { id: 'water', name: 'みず', walk: false },
  '#': { id: 'wall', name: 'かべ', walk: false },
  T: { id: 'tree', name: 'き', walk: false },
  o: { id: 'rock', name: 'いわ', walk: false },
  w: { id: 'counter', name: 'カウンター', walk: false, counter: true },
  '+': { id: 'door', name: 'とびら', walk: true, enc: 0 },
  '<': { id: 'stairUp', name: 'のぼり階段', walk: true, enc: 0 },
  '>': { id: 'stairDown', name: 'くだり階段', walk: true, enc: 0 },
  B: { id: 'town', name: 'まち', walk: true, enc: 0 },
  C: { id: 'caveEntrance', name: 'ほらあな', walk: true, enc: 0 },
  K: { id: 'gate', name: 'しろのもん', walk: true, enc: 0 },
};

// ---------------------------------------------------------------- 店の品ぞろえ

export const SHOPS = {
  item: { name: 'どうぐや', goods: ['herb', 'water', 'wing'] },
  weapon: { name: 'ぶきとぼうぐの店', goods: ['stick', 'copper', 'steel', 'flame', 'clothes', 'leather', 'chain', 'iron', 'magic', 'leatherShield', 'ironShield', 'mirrorShield'] },
};

// ---------------------------------------------------------------- はじまりの村

const town = {
  id: 'town',
  name: 'はじまりの村',
  kind: 'town',
  encRate: 0,
  tiles: [
    'TTTTTTTTTTTTTTTTTTTT',
    'T__________________T',
    'T_####______####___T',
    'T_####______####___T',
    'T_##+#______##+#___T',
    'T__________________T',
    'T_ff____TT____ff___T',
    'T_ff____TT____ff___T',
    'T_####______####___T',
    'T_####______####___T',
    'T_##+#______##+#___T',
    'T__________________T',
    'T____TT______TT____T',
    'T__________________T',
    'T__________________T',
    'TTTTTTTT__TTTTTTTTTT',
  ],
  warps: [
    { x: 4, y: 4, to: 'inn', tx: 4, ty: 5 },
    { x: 14, y: 4, to: 'weapon', tx: 4, ty: 5 },
    { x: 4, y: 10, to: 'item', tx: 4, ty: 5 },
    { x: 14, y: 10, to: 'house', tx: 4, ty: 5 },
    { x: 8, y: 15, to: 'world', tx: 9, ty: 23, dir: 'down' },
    { x: 9, y: 15, to: 'world', tx: 9, ty: 23, dir: 'down' },
  ],
  signs: [
    { x: 6, y: 5, text: '「やどや」\nひとばん とまれば\n元気になれる。' },
    { x: 16, y: 5, text: '「ぶきとぼうぐの店」\n旅立つ前に そなえよう。' },
    { x: 6, y: 11, text: '「どうぐや」\nやくそうは 旅の友。' },
    { x: 16, y: 11, text: '「ちょうろうの家」' },
  ],
  npcs: [
    {
      id: 'guard', x: 9, y: 13, kind: 'talk', look: { cloth: '#4d7cfe', hair: '#3b4252' }, name: '兵士',
      lines: ['この村を出ると まものが おそってくる。', 'HP が 減ったら 早めに 村へ もどるんだ。\n無理は いかんぞ。'],
    },
    {
      id: 'villager1', x: 4, y: 12, kind: 'talk', look: { cloth: '#e8a33d', hair: '#8d5524' }, name: '村人',
      lines: ['北の 山のむこうに 魔王ダークロードの 城が あるという。', 'だが 城には 結界が はられていて 近づけないそうだ。'],
    },
    {
      id: 'villager2', x: 16, y: 6, kind: 'talk', look: { cloth: '#7ac74f', hair: '#5b3a1f' }, name: '村人',
      lines: ['東の ほらあなの おくに\n「ひかりのたま」が ねむっているらしい。', 'あれこそ 結界を やぶる 力を もつ 宝玉さ。'],
    },
    {
      id: 'kid', x: 12, y: 12, kind: 'talk', small: true, look: { cloth: '#ff8fab', hair: '#3b4252' }, name: 'こども',
      lines: ['おおきくなったら ぼくも たびに でるんだ！', 'ゆうしゃさま かっこいい！'],
    },
    { id: 'cat', x: 3, y: 6, kind: 'talk', emoji: '🐈', name: 'ねこ', lines: ['にゃあ。'] },
    {
      id: 'oldman', x: 17, y: 13, kind: 'talk', look: { cloth: '#b0bec5', hair: '#eceff1' }, name: '老人',
      lines: ['戦いに つかれたら やどやで やすむとよい。', 'ちからが つけば まものも こわくない。'],
    },
  ],
  chests: [],
};

// ---------------------------------------------------------------- 建物の中

/** 9 × 7 の小さな部屋。上の段にカウンター、下の壁に出口。 */
const room = (id, name, npcs, chests = []) => ({
  id,
  name,
  kind: 'room',
  encRate: 0,
  tiles: [
    '#########',
    '#_______#',
    '#__www__#',
    '#_______#',
    '#_______#',
    '#_______#',
    '####+####',
  ],
  warps: [],   // 出口は 部屋ごとに あとから入れる
  npcs,
  chests,
  signs: [],
});

const inn = room('inn', 'やどや', [
  {
    id: 'innkeeper', x: 4, y: 1, kind: 'inn', look: { cloth: '#ffd43b', hair: '#6d4c41' }, name: 'やどやの主人',
    lines: ['いらっしゃい。\nひとばん とまって いくかね？'],
  },
  {
    id: 'guest', x: 2, y: 4, kind: 'talk', look: { cloth: '#a5d8ff', hair: '#37474f' }, name: '旅人',
    lines: ['ねむると HP も MP も 元どおりさ。', 'ぼうけんの きろくも つけておいてくれる。'],
  },
]);
inn.warps = [{ x: 4, y: 6, to: 'town', tx: 4, ty: 5, dir: 'down' }];

const weapon = room('weapon', 'ぶきとぼうぐの店', [
  {
    id: 'smith', x: 4, y: 1, kind: 'shop', shop: 'weapon', look: { cloth: '#e07a5f', hair: '#3b2b20' }, name: '店主',
    lines: ['武器と よろいなら まかせときな！'],
  },
]);
weapon.warps = [{ x: 4, y: 6, to: 'town', tx: 14, ty: 5, dir: 'down' }];

const item = room('item', 'どうぐや', [
  {
    id: 'merchant', x: 4, y: 1, kind: 'shop', shop: 'item', look: { cloth: '#63c7b2', hair: '#4e342e' }, name: '店主',
    lines: ['やくそうは 何枚あっても こまらないよ。'],
  },
]);
item.warps = [{ x: 4, y: 6, to: 'town', tx: 4, ty: 11, dir: 'down' }];

const house = room(
  'house',
  'ちょうろうの家',
  [
    {
      id: 'elder', x: 4, y: 1, kind: 'elder', look: { cloth: '#9775fa', hair: '#f1f3f5' }, name: 'ちょうろう',
      lines: [
        'おお ゆうしゃよ！ よくぞ来た。',
        '魔王ダークロードが よみがえり\n世界は 闇に つつまれようとしておる。',
        '東の ほらあなで 「ひかりのたま」を 見つけ\n北の 城の 結界を 破るのじゃ。',
      ],
      done: ['たのんだぞ ゆうしゃよ。\n世界の 明日は お前の 手の中にある。'],
      gift: { gold: 60, item: 'herb', text: 'ちょうろうは 旅のしたくにと\n60 ゴールドと やくそうを くれた！' },
    },
    {
      id: 'scribe', x: 2, y: 4, kind: 'save', look: { cloth: '#dee2e6', hair: '#495057' }, name: '書き役',
      lines: ['ぼうけんの きろくを つけておこうかね？'],
    },
  ],
  [{ id: 'house-1', x: 6, y: 4, item: 'herb' }],
);
house.warps = [{ x: 4, y: 6, to: 'town', tx: 14, ty: 11, dir: 'down' }];

// ---------------------------------------------------------------- フィールド

const world = {
  id: 'world',
  name: 'フィールド',
  kind: 'field',
  encRate: 0.09,
  encounters: [
    { id: 'slime', w: 34 },
    { id: 'rat', w: 26 },
    { id: 'bee', w: 20 },
    { id: 'goblin', w: 20 },
  ],
  // 川より北は 一段と 手ごわい魔物が出る。
  zones: [
    {
      x0: 0, y0: 0, x1: 39, y1: 17,
      encounters: [
        { id: 'goblin', w: 18 },
        { id: 'wolf', w: 26 },
        { id: 'mage', w: 22 },
        { id: 'armor', w: 22 },
        { id: 'skeleton', w: 12 },
      ],
    },
  ],
  tiles: [
    '^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^',
    '^^^^^^^^^^^^^^^^^...^^^^^^^^^^^^^^^^^^^^',
    '^^^^^^^^^^^^^^^^^.K.^^^^^^^^^^^^^^^^^^^^',
    '^^^^^^^^^^^^^^^^^...^^^^^^^^^^^^^^^^^^^^',
    '^^^^^^^^^^^^^^^^^...^^^^^^^^^^^^^^^^^^^^',
    '^^^^^^^^^^^^^^^^....^^^^^^^^^^^^^^^^^^^^',
    '^^^^^^^^^^^^^^^.....^^^^^^^^^^^^^^^^^^^^',
    '^^^^^^^^^^^^^^......^^^^^^^^^^^^^^^^^^^^',
    '^^^^^^^^^^^^^^......^^^^^^^^^^^^^^^^^^^^',
    '^^^^^^^^^^^^.........^^^^^^^^^^^^^^^^^^^',
    '^^^^^^^^^^..........."""^^^^^^^^^^^^^^^^',
    '^^^^^^^^............""""^^^^^^^^^^^^^^^^',
    '^^^^^^.............""""..^^^^^^^^^^^^^^^',
    '^^^^................""".....^^^^^^^^^^^^',
    '^^^..........."""..........."^^^^^^^^^^^',
    '^^..........."""..............^^^^^^^^^^',
    '^^..........."""..............~~~^^^^^^^',
    '^^...........................~~~~^^^^^^^',
    '^~~~~~~~~~=~~~~~~~~~~~~~~~~~~=~~~~~~~~~^',
    '^^..........................""""^^^^^^^^',
    '^^..........""".............."""^^^^^^^^',
    '^^..........................""^^^^^^^^^^',
    '^^.......B..................""^^^^^^^^^^',
    '^^..........................""^^^^^^^^^^',
    '^^...................""""....C.^^^^^^^^^',
    '^^..........................""""^^^^^^^^',
    '^^"""......................."""^^^^^^^^^',
    '^^..............................^^^^^^^^',
    '^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^',
    '^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^',
  ],
  warps: [
    { x: 9, y: 22, to: 'town', tx: 9, ty: 14, dir: 'up' },
    { x: 29, y: 24, to: 'cave', tx: 11, ty: 16, dir: 'up' },
    {
      x: 18, y: 2, to: 'castle', tx: 12, ty: 16, dir: 'up',
      require: 'orb',
      requireText: '門は 見えない結界に 閉ざされている。\nどうしても 中へ 入れない！',
      openText: 'ひかりのたまが まばゆく光った！\n結界が 音をたてて くだけ散った！',
    },
  ],
  npcs: [],
  chests: [{ id: 'world-1', x: 3, y: 27, gold: 120 }],
  signs: [
    { x: 10, y: 22, text: '←「はじまりの村」\n↑ 北へ 魔王の城\n→ 東へ ひかりのほらあな' },
  ],
};

// ---------------------------------------------------------------- ひかりのほらあな

const cave = {
  id: 'cave',
  name: 'ひかりのほらあな',
  kind: 'cave',
  dark: true,
  encRate: 0.12,
  encounters: [
    { id: 'armor', w: 22 },
    { id: 'skeleton', w: 26 },
    { id: 'lizard', w: 24 },
    { id: 'mage', w: 16 },
    { id: 'golem', w: 12 },
  ],
  tiles: [
    '########################',
    '#,,,,,,,,,,,,,,,,,,,,,,#',
    '#,oo,,####,,,,####,,oo,#',
    '#,oo,,#,,,,,,,,,,#,,oo,#',
    '#,,,,,#,,oo,,oo,,#,,,,,#',
    '#,####,,,oo,,oo,,,####,#',
    '#,#,,,,,,,,,,,,,,,,,,#,#',
    '#,#,oo,####,,####,oo,#,#',
    '#,,,oo,#,,,,,,,,#,oo,,,#',
    '#,,,,,,#,,,oo,,,#,,,,,,#',
    '#,####,,,,,oo,,,,,####,#',
    '#,#,,,,,,,,,,,,,,,,,,#,#',
    '#,#,oo,,###,,###,,oo,#,#',
    '#,,,oo,,,,,,,,,,,,,oo,,#',
    '#,,,,,,,,,,,,,,,,,,,,,,#',
    '#,####,,,,,,,,,,,,####,#',
    '#,,,,,,,,,,<,,,,,,,,,,,#',
    '########################',
  ],
  warps: [{ x: 11, y: 16, to: 'world', tx: 29, ty: 25, dir: 'down' }],
  npcs: [],
  chests: [
    { id: 'cave-1', x: 2, y: 1, item: 'seedStr' },
    { id: 'cave-2', x: 21, y: 1, gold: 320 },
    { id: 'cave-3', x: 11, y: 4, item: 'orb', fanfare: true },
    { id: 'cave-4', x: 14, y: 9, item: 'water' },
  ],
  signs: [],
};

// ---------------------------------------------------------------- 魔王の城

const castle = {
  id: 'castle',
  name: 'まおうの城',
  kind: 'castle',
  encRate: 0.13,
  encounters: [
    { id: 'skeleton', w: 14 },
    { id: 'witch', w: 24 },
    { id: 'knight', w: 26 },
    { id: 'golem', w: 16 },
    { id: 'dragon', w: 20 },
  ],
  tiles: [
    '########################',
    '#######,,,,,,,,,,#######',
    '#######,,,,,,,,,,#######',
    '#######,,,,,,,,,,#######',
    '#####,,,,,,,,,,,,,,#####',
    '#####,,####,,####,,#####',
    '#####,,####,,####,,#####',
    '#,,,,,,,,,,,,,,,,,,,,,,#',
    '#,####,,,,,,,,,,,,####,#',
    '#,####,,###,,###,,####,#',
    '#,,,,,,,,,,,,,,,,,,,,,,#',
    '#,####,,,,,,,,,,,,####,#',
    '#,####,,###,,###,,####,#',
    '#,,,,,,,,,,,,,,,,,,,,,,#',
    '######,,,,,,,,,,,,######',
    '######,,,,,,,,,,,,######',
    '###########,,###########',
    '########################',
  ],
  warps: [{ x: 11, y: 16, to: 'world', tx: 18, ty: 3, dir: 'down' }],
  npcs: [
    {
      id: 'darklord', x: 11, y: 2, kind: 'boss', emoji: '👹', name: 'まおう ダークロード', monster: 'darklord',
      lines: [
        'よくぞ ここまで 来たな 小さき者よ。',
        'この 世界は すでに わが 手の中。\nお前の 村も じきに 闇に沈む。',
        'ゆうしゃよ……\nその 命 ここで もらいうける！',
      ],
      done: ['……'],
    },
  ],
  chests: [
    { id: 'castle-1', x: 2, y: 10, gear: 'light' },
    { id: 'castle-2', x: 21, y: 10, gear: 'lightArmor' },
    { id: 'castle-3', x: 7, y: 7, item: 'seedHp' },
    { id: 'castle-4', x: 16, y: 13, gold: 800 },
  ],
  signs: [],
};

export const MAPS = { town, inn, weapon, item, house, world, cave, castle };

export const mapById = (id) => MAPS[id] || MAPS.town;

// ---------------------------------------------------------------- 当たり判定

export const mapWidth = (map) => map.tiles[0].length;
export const mapHeight = (map) => map.tiles.length;

export function inside(map, x, y) {
  return x >= 0 && y >= 0 && x < mapWidth(map) && y < mapHeight(map);
}

/** その場所のタイル文字。マップの外は壁あつかい。 */
export function tileAt(map, x, y) {
  if (!inside(map, x, y)) return '#';
  return map.tiles[y][x];
}

export const tileInfo = (map, x, y) => TILES[tileAt(map, x, y)] || TILES['#'];

export const canWalk = (map, x, y) => tileInfo(map, x, y).walk === true;

export const warpAt = (map, x, y) => map.warps.find((w) => w.x === x && w.y === y) || null;

export const signAt = (map, x, y) => (map.signs || []).find((s) => s.x === x && s.y === y) || null;

export const npcAt = (npcs, x, y) => npcs.find((n) => n.x === x && n.y === y) || null;

/** まだ開けていない宝箱。 */
export const chestsOf = (map, opened) => (map.chests || []).filter((c) => !opened.includes(c.id));

export const chestAt = (map, opened, x, y) => chestsOf(map, opened).find((c) => c.x === x && c.y === y) || null;

/** その場所で出会う魔物の抽選表。 */
export function encountersAt(map, x, y) {
  for (const zone of map.zones || []) {
    if (x >= zone.x0 && x <= zone.x1 && y >= zone.y0 && y <= zone.y1) return zone.encounters;
  }
  return map.encounters || [];
}

/** 1 歩あるいたときに魔物と出会う確率。 */
export function encounterChance(map, x, y) {
  const enc = tileInfo(map, x, y).enc || 0;
  return (map.encRate || 0) * enc;
}

export const DIRS = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

/** 向いている先のマス。カウンター越しなら もう 1 マス先を見る。 */
export function frontOf(map, x, y, dir) {
  const d = DIRS[dir];
  let fx = x + d.dx;
  let fy = y + d.dy;
  if (tileInfo(map, fx, fy).counter) { fx += d.dx; fy += d.dy; }
  return { x: fx, y: fy };
}
