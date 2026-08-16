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
 *   L  とうだい
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
  L: { id: 'lighthouse', name: 'とうだい', walk: false },
};

// ---------------------------------------------------------------- 店の品ぞろえ

export const SHOPS = {
  item: { name: 'どうぐや', goods: ['herb', 'feather'] },
  weapon: { name: 'ぶきとぼうぐの店', goods: ['stick', 'copper', 'clothes', 'leather', 'leatherShield'] },
  portItem: { name: 'サーラの道具店', goods: ['herb', 'mana', 'feather'] },
  portWeapon: { name: 'サーラの武具店', goods: ['steel', 'flame', 'chain', 'iron', 'magic', 'ironShield', 'mirrorShield'] },
};

// ---------------------------------------------------------------- はじまりの村

const town = {
  id: 'town',
  name: 'はじまりの村 リオン',
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
    { x: 6, y: 11, text: '「どうぐや」\nいやしそうは 旅の友。' },
    { x: 16, y: 11, text: '「ちょうろうの家」' },
  ],
  npcs: [
    {
      id: 'guard', x: 9, y: 13, kind: 'talk', look: { cloth: '#4d7cfe', hair: '#3b4252' }, name: '兵士',
      lines: ['この村を出ると まものが おそってくる。', 'ひとり旅は むぼうだ。\nやどやに 腕の立つ 男が 泊まっているぞ。'],
    },
    {
      id: 'villager1', x: 4, y: 12, kind: 'talk', look: { cloth: '#e8a33d', hair: '#8d5524' }, name: '村人',
      lines: ['北の 山のむこうに まおう ザルガスの 城が あるという。', 'だが 城には 結界が はられていて 近づけないそうだ。'],
    },
    {
      id: 'villager2', x: 16, y: 6, kind: 'talk', look: { cloth: '#7ac74f', hair: '#5b3a1f' }, name: '村人',
      lines: ['東の 「こだまの洞くつ」の おくに\n星のしずくの 欠片が ねむっているらしい。', 'しずくは ふたつに 割れて\nもう ひとつは 行方知れずだとか。'],
    },
    {
      id: 'kid', x: 12, y: 12, kind: 'talk', small: true, look: { cloth: '#ff8fab', hair: '#3b4252' }, name: 'こども',
      lines: ['おおきくなったら ぼくも たびに でるんだ！', 'ゆうしゃさま かっこいい！'],
    },
    { id: 'cat', x: 3, y: 6, kind: 'talk', emoji: '🐈', name: 'ねこ', lines: ['にゃあ。'] },
    {
      id: 'oldman', x: 17, y: 13, kind: 'talk', look: { cloth: '#b0bec5', hair: '#eceff1' }, name: '老人',
      lines: ['戦いに つかれたら やどやで やすむとよい。', '川を こえて 東へ 行けば\nみなとまち サーラ が あるはずじゃ。'],
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
    id: 'garon', x: 2, y: 4, kind: 'join', look: { cloth: '#c0392b', hair: '#4b3621' }, name: 'ガロン',
    member: { cls: 'warrior', name: 'ガロン', minLevel: 2 },
    lines: [
      'おれは 流れの せんし ガロン。\n腕っぷしなら 村いちばんだ。',
      '魔王を たおしに 行くんだろ？\nおれも 連れて行ってくれ！',
    ],
    joinLines: ['前は まかせておけ！\n背中は 守ってやる。'],
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
    lines: ['いやしそうは 何枚あっても こまらないよ。'],
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
        'まおう ザルガスが よみがえり\n世界は 闇に つつまれようとしておる。',
        '城を おおう 結界を 破れるのは\n伝説の 「星のしずく」だけ。',
        'じゃが しずくは ふたつの欠片に 割れておる。\nひとつは 東の こだまの洞くつ の おく。',
        'まずは その欠片を 手に入れるのじゃ。\nもう ひとつの ゆくえは……\n港の 者なら 知っておるかもしれん。',
      ],
      done: ['ふたつの欠片を そろえ\nみなとまち サーラ の 灯台へ 行くのじゃ。'],
      gift: { gold: 60, item: 'herb', text: 'ちょうろうは 旅のしたくにと\n60 ゴールドと いやしそうを くれた！' },
    },
    {
      id: 'scribe', x: 2, y: 4, kind: 'save', look: { cloth: '#dee2e6', hair: '#495057' }, name: '書き役',
      lines: ['ぼうけんの きろくを つけておこうかね？'],
    },
    {
      id: 'mina', x: 6, y: 1, kind: 'join', look: { cloth: '#f1f3f5', hair: '#8d6e63' }, name: 'ミナ',
      member: { cls: 'priest', name: 'ミナ', minLevel: 3 },
      require: 'elder',
      waitLines: ['わたしは そうりょの ミナ。', 'まずは ちょうろうさまの お話を お聞きなさい。'],
      lines: [
        'わたしは そうりょの ミナ。\n傷を いやす 術を 心得ています。',
        'ゆうしゃさま。\nわたしも おともさせて ください。',
      ],
      joinLines: ['リカなら まかせてください。\n倒れた仲間も いずれ 起こせます。'],
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
    { id: 'slime', w: 24 },
    { id: 'pup', w: 20 },
    { id: 'rat', w: 18 },
    { id: 'mush', w: 14 },
    { id: 'bee', w: 14 },
    { id: 'frog', w: 12 },
    { id: 'goblin', w: 12 },
    { id: 'bandit', w: 8 },
  ],
  // 川より北は 一段と 手ごわい魔物が出る。
  zones: [
    {
      x0: 0, y0: 0, x1: 39, y1: 17,
      encounters: [
        { id: 'bandit', w: 14 },
        { id: 'wolf', w: 20 },
        { id: 'bat', w: 16 },
        { id: 'harpy', w: 14 },
        { id: 'mage', w: 16 },
        { id: 'armor', w: 16 },
        { id: 'ogre', w: 12 },
        { id: 'skeleton', w: 8 },
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
    '^^^C.........."""..........."^^^^^^^^^^^',
    '^^..........."""............B.^^^^^^^^^^',
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
    { x: 28, y: 15, to: 'port', tx: 11, ty: 14, dir: 'up' },
    { x: 3, y: 14, to: 'mine', tx: 11, ty: 16, dir: 'up' },
    {
      x: 18, y: 2, to: 'castle', tx: 12, ty: 16, dir: 'up',
      require: 'star',
      requireText: '門は 見えない結界に 閉ざされている。\nどうしても 中へ 入れない！',
      openText: '星のしずくが まばゆく光った！\n結界が 音をたてて くだけ散った！',
    },
  ],
  npcs: [
    {
      id: 'yugd', x: 22, y: 24, kind: 'boss', emoji: '🌳', name: 'もりの主 ユグド', monster: 'yugd',
      defeatFlag: 'yugdDead',
      lines: [
        '……森が ざわめいている。',
        '古い木が ゆっくりと 目をあけた。',
        '「通りたくば 力を 見せよ」',
      ],
      onWin: {
        item: 'seedStr',
        lines: [
          'もりの主は 静かに 根をおろした。',
          '「よい 目をしている。持っていけ」',
          '剛力の実を 手に入れた！',
        ],
      },
    },
  ],
  chests: [{ id: 'world-1', x: 3, y: 27, gold: 120 }],
  signs: [
    { x: 10, y: 22, text: '←「はじまりの村 リオン」\n↑ 北へ まおうの城\n→ 東へ こだまの洞くつ' },
    { x: 27, y: 16, text: '↑「みなとまち サーラ」\n　この先 潮のにおい' },
    { x: 4, y: 15, text: '「忘れられた廃坑」\n落石注意 立入禁止' },
  ],
};

// ---------------------------------------------------------------- こだまの洞くつ

const cave = {
  id: 'cave',
  name: 'こだまの洞くつ',
  kind: 'cave',
  dark: true,
  encRate: 0.12,
  encounters: [
    { id: 'armor', w: 16 },
    { id: 'worm', w: 18 },
    { id: 'skeleton', w: 18 },
    { id: 'ghost', w: 16 },
    { id: 'lizard', w: 16 },
    { id: 'spider', w: 10 },
    { id: 'golem', w: 6 },
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
  signs: [
    { x: 12, y: 4, text: '古い石版が ある。\n\n「ふたつの欠片は みなとまち サーラ の\n　灯台にて ひとつに 戻らん」' },
  ],
  npcs: [
    {
      id: 'sera', x: 11, y: 6, kind: 'join', look: { cloth: '#9775fa', hair: '#343a40' }, name: 'セラ',
      member: { cls: 'mage', name: 'セラ', minLevel: 7 },
      lines: [
        'たすかった……！\nわたしは まほうつかいの セラ。',
        '星のしずくの 欠片を さがしに来て\n魔物に かこまれてしまったの。',
        'お礼に わたしの 魔法を 役立てて。\n連れて行って くれる？',
      ],
      joinLines: ['フラムなら まかせて。\n奥に すすみましょう！'],
    },
  ],
  chests: [
    { id: 'cave-1', x: 2, y: 1, item: 'seedStr' },
    { id: 'cave-2', x: 21, y: 1, gold: 320 },
    {
      id: 'cave-3', x: 11, y: 4, item: 'shardA', fanfare: true,
      guard: 'golva',
      guardLines: [
        '宝箱に 手を かけた そのとき——',
        '岩が むくりと 起きあがった！\n洞くつの 主が 目を さましたのだ！',
      ],
    },
    { id: 'cave-4', x: 14, y: 9, item: 'mana' },
    { id: 'cave-5', x: 2, y: 14, item: 'flower' },
  ],
};

// ---------------------------------------------------------------- 魔王の城

const castle = {
  id: 'castle',
  name: 'まおうの城',
  kind: 'castle',
  encRate: 0.13,
  encounters: [
    { id: 'witch', w: 16 },
    { id: 'reaper', w: 18 },
    { id: 'knight', w: 18 },
    { id: 'mask', w: 16 },
    { id: 'wyvern', w: 16 },
    { id: 'dragon', w: 12 },
    { id: 'golem', w: 4 },
  ],
  tiles: [
    '########################',
    '#######,,,,,,,,,,#######',
    '#######,,,,,,,,,,#######',
    '#######,,,,,,,,,,#######',
    '###########,############',
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
      id: 'valdes', x: 11, y: 4, kind: 'boss', emoji: '🔮', name: '黒衣の魔導 ヴァレス', monster: 'valdes',
      defeatFlag: 'valdesDead',
      lines: [
        'ここから 先は 玉座の間。',
        'ザルガスさまに 会いたくば\nまず わしの 魔をこえて みせよ。',
      ],
      onWin: {
        lines: [
          'ヴァレスの ローブが ほどけ\n風に 溶けるように 消えていく。',
          '「……夜明けが 来るのか」\n玉座への 道が ひらけた。',
        ],
      },
    },
    {
      id: 'darklord', x: 11, y: 2, kind: 'boss', emoji: '👹', name: 'まおう ザルガス', monster: 'darklord',
      defeatFlag: 'bossDead',
      lines: [
        'よくぞ ここまで 来たな 小さき者よ。',
        '星のしずくを つないだか。\nならば その手で 砕いて やろう。',
        'ゆうしゃよ……\nその 命 ここで もらいうける！',
      ],
    },
  ],
  chests: [
    { id: 'castle-1', x: 2, y: 10, gear: 'light' },
    { id: 'castle-2', x: 21, y: 10, gear: 'lightArmor' },
    { id: 'castle-3', x: 7, y: 7, item: 'seedHp' },
    { id: 'castle-4', x: 16, y: 13, gold: 800 },
    { id: 'castle-5', x: 18, y: 7, item: 'flower' },
  ],
  signs: [],
};


// ---------------------------------------------------------------- みなとまち サーラ

const port = {
  id: 'port',
  name: 'みなとまち サーラ',
  kind: 'town',
  encRate: 0,
  tiles: [
    '~~~~~~~~~~~~~~~~~~~~~~~~',
    '~~~~~~~~~==~~~~~~~~~~~~~',
    '___________________LLLL_',
    '___________________LLLL_',
    '___________________L+LL_',
    '________________________',
    '__####___####___####____',
    '__####___####___####____',
    '__#+##___#+##___#+##____',
    '________________________',
    '__ff_____TT______ff_____',
    '________________________',
    '____TT____________TT____',
    '________________________',
    '________________________',
    'TTTTTTTTTTT__TTTTTTTTTTT',
  ],
  warps: [
    { x: 3, y: 8, to: 'portInn', tx: 4, ty: 5 },
    { x: 10, y: 8, to: 'portItem', tx: 4, ty: 5 },
    { x: 17, y: 8, to: 'portWeapon', tx: 4, ty: 5 },
    { x: 20, y: 4, to: 'lighthouse', tx: 4, ty: 5 },
    { x: 11, y: 15, to: 'world', tx: 28, ty: 16, dir: 'down' },
    { x: 12, y: 15, to: 'world', tx: 28, ty: 16, dir: 'down' },
  ],
  signs: [
    { x: 5, y: 9, text: '「サーラのやどや」\n潮風の あたる 部屋あります' },
    { x: 12, y: 9, text: '「サーラの道具店」\n船旅の したくは ここで' },
    { x: 19, y: 9, text: '「サーラの武具店」\n海をこえた 品も あるよ' },
    { x: 21, y: 5, text: '「サーラの灯台」\n夜ごと 船を みちびく 灯り' },
  ],
  npcs: [
    {
      id: 'sailor', x: 9, y: 3, kind: 'talk', look: { cloth: '#3b82c4', hair: '#2f3640' }, name: '船乗り',
      lines: [
        'よお 旅の人。\nこの町は 海の 玄関口さ。',
        '西の 山あいに 「忘れられた廃坑」がある。\nいまは やみの将 ガルド が いすわってる。',
        'あいつ 何かを 後生大事に かかえてたな。\n光る 石のかけら みたいな もんを。',
      ],
    },
    {
      id: 'scholar', x: 15, y: 11, kind: 'talk', look: { cloth: '#2f9e7a', hair: '#f1f3f5' }, name: '学者',
      lines: [
        'ほう、よあけの欠片を 持っておるのか。',
        '星のしずくは 対の 欠片で できておる。\nふたつ そろえて 灯台の 火に かざすのじゃ。',
        'もう ひとつの 欠片は\n西の 廃坑に あると 言われておる。',
      ],
    },
    {
      id: 'portKid', x: 6, y: 13, kind: 'talk', small: true, look: { cloth: '#ffd43b', hair: '#5b3a1f' }, name: 'こども',
      lines: ['きのう 廃坑のほうで\nすごい 地ひびきが したんだ！', 'こわいから ぼくは 行かないよ。'],
    },
    {
      id: 'portWoman', x: 18, y: 13, kind: 'talk', look: { cloth: '#ff8fab', hair: '#6d4c41' }, name: '町の女',
      lines: ['灯台守の おじいさんは\nずっと あの灯りを 守っているの。', '海の魔物が 増えて 船が 出せないのよ。'],
    },
    { id: 'gull', x: 13, y: 2, kind: 'talk', emoji: '🐦', name: 'かもめ', lines: ['ぴゅい。'] },
    {
      id: 'hunter', x: 3, y: 11, kind: 'talk', look: { cloth: '#8d6e63', hair: '#3b2b20' }, name: '猟師',
      lines: [
        '南の 森に 「もりの主」が いるって 話だ。',
        '古い木の 姿を した 大物さ。\n倒せば 力を 分けて くれるとか。',
        'まあ おれには 手に負えん。',
      ],
    },
    {
      id: 'oldSailor', x: 20, y: 12, kind: 'talk', look: { cloth: '#495057', hair: '#e9ecef' }, name: '老いた船乗り',
      lines: [
        '城の 玉座の 前には\n「黒衣の魔導」が 立ちはだかる。',
        'あいつの 炎は 生半可じゃ 防げん。\nよく 備えて 行きな。',
      ],
    },
  ],
  chests: [],
};

const portInn = room('portInn', 'サーラのやどや', [
  {
    id: 'portInnkeeper', x: 4, y: 1, kind: 'inn', look: { cloth: '#63c7b2', hair: '#4e342e' }, name: 'やどやの主人',
    lines: ['いらっしゃい。\n潮風の 部屋は よく 眠れるよ。'],
  },
  {
    id: 'portGuest', x: 2, y: 4, kind: 'talk', look: { cloth: '#a5d8ff', hair: '#37474f' }, name: '旅の商人',
    lines: ['廃坑の 魔物は 手強い。', '倒れた仲間は 宿でも 起きるが\n「よみがえりの花」も 持っておくといい。'],
  },
]);
portInn.warps = [{ x: 4, y: 6, to: 'port', tx: 3, ty: 9, dir: 'down' }];

const portItem = room('portItem', 'サーラの道具店', [
  {
    id: 'portMerchant', x: 4, y: 1, kind: 'shop', shop: 'portItem', look: { cloth: '#e8a33d', hair: '#3b2b20' }, name: '店主',
    lines: ['マナのしずくは 呪文使いの ともだよ。'],
  },
]);
portItem.warps = [{ x: 4, y: 6, to: 'port', tx: 10, ty: 9, dir: 'down' }];

const portWeapon = room('portWeapon', 'サーラの武具店', [
  {
    id: 'portSmith', x: 4, y: 1, kind: 'shop', shop: 'portWeapon', look: { cloth: '#c0392b', hair: '#3b2b20' }, name: '店主',
    lines: ['海のむこうの 業物も そろえてるぜ。'],
  },
]);
portWeapon.warps = [{ x: 4, y: 6, to: 'port', tx: 17, ty: 9, dir: 'down' }];

const lighthouse = room(
  'lighthouse',
  'サーラの灯台',
  [
    {
      id: 'keeper', x: 4, y: 1, kind: 'altar', look: { cloth: '#dee2e6', hair: '#f8f9fa' }, name: '灯台守',
      needs: ['shardA', 'shardB'],
      gives: 'star',
      waitLines: [
        'この灯りは 星のしずくの かけらで\n燃えていると いう。',
        'ふたつの欠片が そろったら\nわしの ところへ 持っておいで。',
      ],
      readyLines: [
        'おお……その 欠片は！\nふたつとも そろっておるな。',
        'さあ 灯りに かざしなさい。',
      ],
      giveLines: [
        'ふたつの欠片は 引きあうように 重なり\nひとつの 雫（しずく）に なった！',
        '星のしずくを 手に入れた！',
        'それが あれば 城の結界も 破れよう。\n北の 門へ 向かうのじゃ。',
      ],
      doneLines: ['星のしずくを 持つ お前たちなら\nきっと 夜明けを 取りもどせる。'],
    },
  ],
);
lighthouse.warps = [{ x: 4, y: 6, to: 'port', tx: 20, ty: 5, dir: 'down' }];

// ---------------------------------------------------------------- 忘れられた廃坑

const mine = {
  id: 'mine',
  name: '忘れられた廃坑',
  kind: 'cave',
  dark: true,
  encRate: 0.13,
  encounters: [
    { id: 'worm', w: 16 },
    { id: 'ogre', w: 16 },
    { id: 'skeleton', w: 16 },
    { id: 'ghost', w: 14 },
    { id: 'spider', w: 14 },
    { id: 'lava', w: 12 },
    { id: 'golem', w: 12 },
  ],
  tiles: [
    '########################',
    '#,,,,,,,,,,,,,,,,,,,,,,#',
    '#,####,####,####,####,,#',
    '#,#,,,,,,,,,,,,,,,,,#,,#',
    '#,#,##,####,####,##,#,,#',
    '#,,,,#,,,,,,,,,,#,,,,,,#',
    '#,####,######,###,####,#',
    '#,,,,,,,,,,,,,,,,,,,,,,#',
    '#,####,####,####,####,,#',
    '#,,,,,,,,,,,,,,,,,,,,,,#',
    '#,##,####,####,####,##,#',
    '#,,,,,,,,,,,,,,,,,,,,,,#',
    '#,####,####,####,####,,#',
    '#,,,,,,,,,,,,,,,,,,,,,,#',
    '#,####,,,,,,,,,,,,####,#',
    '#,,,,,,,,,,,,,,,,,,,,,,#',
    '#,,,,,,,,,,,<,,,,,,,,,,#',
    '########################',
  ],
  warps: [{ x: 12, y: 16, to: 'world', tx: 3, ty: 15, dir: 'down' }],
  signs: [
    { x: 10, y: 16, text: '坑道の 入口に 札が ある。\n\n「この先 落盤あり\n　夜ごと 剣の音 聞こゆ」' },
  ],
  npcs: [
    {
      id: 'gald', x: 11, y: 1, kind: 'boss', emoji: '🗡️', name: 'やみの将 ガルド', monster: 'gald',
      defeatFlag: 'galdDead',
      lines: [
        'ここから 先へは 通さん。',
        'この 欠片は まおう ザルガス さまの もの。',
        'ほしくば……\nわしを 倒して いくがいい！',
      ],
      onWin: {
        item: 'shardB',
        lines: [
          'ガルドは 静かに ひざを ついた。',
          '「よいやみの欠片」を 手に入れた！',
          'これで ふたつの欠片が そろった。\nサーラの灯台へ 戻ろう。',
        ],
      },
    },
  ],
  chests: [
    { id: 'mine-1', x: 2, y: 1, item: 'flower' },
    { id: 'mine-2', x: 21, y: 1, gold: 600 },
    { id: 'mine-3', x: 2, y: 15, item: 'seedHp' },
    { id: 'mine-4', x: 21, y: 15, item: 'mana' },
  ],
};

export const MAPS = {
  town, inn, weapon, item, house,
  world, cave,
  port, portInn, portItem, portWeapon, lighthouse,
  mine, castle,
};

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
