import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ALL_GEAR, Battle, CLASSES, ITEMS, LEVELS, MONSTERS, PARTY_LIMIT, SPELLS,
  addItem, alive, attackDamage, buy, claimReward, createMember, createSave, expForLevel,
  expToNext, gainExp, innCost, isDown, isWiped, itemById, itemList, joinParty, leaderOf,
  levelOf, monsterById, mulberry32, normalizeSave, onDefeat, sell, spellById, spellsOf,
  statsOf, stayInn, useItem, weightedPick,
} from '../src/engine.js';
import {
  MAPS, SHOPS, TILES, canWalk, chestAt, encounterChance, encountersAt, frontOf,
  mapById, mapHeight, mapWidth, npcAt, tileAt, warpAt,
} from '../src/world.js';

const rng = () => 0.5;   // まん中の目で固定した乱数

/** テスト用に すぐ 4 人そろったパーティを作る。 */
function fullParty(exp = 0) {
  const save = createSave();
  gainExp(save.party[0], exp);
  for (const [cls, name] of [['warrior', 'ガロン'], ['priest', 'ミナ'], ['mage', 'セラ']]) {
    joinParty(save, cls, name);
  }
  for (const member of save.party) {
    member.exp = exp;
    const s = statsOf(member);
    member.hp = s.maxHp;
    member.mp = s.maxMp;
  }
  return save;
}

/** 全員 たたかう。 */
const attackAll = (save) => save.party.map(() => ({ type: 'attack' }));

// ------------------------------------------------------------------ データ

test('モンスター・道具・呪文・装備の ID が重複しない', () => {
  for (const [label, list] of [['モンスター', MONSTERS], ['道具', ITEMS], ['呪文', SPELLS], ['装備', ALL_GEAR]]) {
    const ids = list.map((x) => x.id);
    assert.equal(new Set(ids).size, ids.length, `${label}の ID が重複している`);
  }
});

test('モンスターのデータが壊れていない', () => {
  for (const m of MONSTERS) {
    assert.ok(m.hp > 0 && m.atk > 0 && m.def >= 0 && m.agi > 0, `${m.name}: 能力がおかしい`);
    assert.ok(m.name && m.emoji, `${m.name}: 表示用の値が欠けている`);
    assert.ok(m.actions.length > 0, `${m.name}: 行動がない`);
    assert.ok(!m.acts || (m.acts >= 1 && m.acts <= 3), `${m.name}: 行動回数がおかしい`);
    for (const a of m.actions) {
      assert.ok(a.w > 0, `${m.name}: 行動の重みが 0 以下`);
      if (a.kind === 'spell') assert.ok(spellById(a.id), `${m.name}: 未知の呪文 ${a.id}`);
      if (a.kind === 'breath') assert.ok(a.power[1] > a.power[0], `${m.name}: ブレスの威力がおかしい`);
    }
  }
});

test('あとに出てくる魔物ほど 経験値と金貨が多い', () => {
  const normal = MONSTERS.filter((m) => !m.boss);
  for (let i = 1; i < normal.length; i++) {
    assert.ok(normal[i].exp > normal[i - 1].exp, `${normal[i].name}の経験値が前より少ない`);
    assert.ok(normal[i].gold > normal[i - 1].gold, `${normal[i].name}の金貨が前より少ない`);
  }
  const boss = MONSTERS.find((m) => m.boss);
  assert.ok(boss.hp > Math.max(...normal.map((m) => m.hp)), '魔王が いちばん強くない');
});

test('レベル表は経験値・能力ともに右肩上がり', () => {
  for (let i = 1; i < LEVELS.length; i++) {
    const a = LEVELS[i - 1];
    const b = LEVELS[i];
    assert.equal(b.level, a.level + 1);
    assert.ok(b.exp > a.exp, `Lv${b.level} の必要経験値が増えていない`);
    assert.ok(b.hp > a.hp && b.str > a.str && b.agi > a.agi, `Lv${b.level} の能力が増えていない`);
    assert.ok(b.mp >= a.mp);
  }
  assert.equal(LEVELS[0].exp, 0);
});

test('職業ごとの覚える呪文はすべて実在して、重複がない', () => {
  for (const cls of Object.values(CLASSES)) {
    const learned = Object.values(cls.spells).flat();
    assert.equal(new Set(learned).size, learned.length, `${cls.name}が 同じ呪文を 2 回覚えている`);
    for (const id of learned) assert.ok(spellById(id), `${cls.name}: 未知の呪文 ${id}`);
    for (const level of Object.keys(cls.spells)) {
      assert.ok(Number(level) >= 1 && Number(level) <= 20, `${cls.name}: 覚えるレベルが範囲外`);
    }
  }
});

test('職業には それぞれ 役わりがある', () => {
  const { hero, warrior, priest, mage } = CLASSES;
  assert.ok(warrior.hp > hero.hp && warrior.str > hero.str, 'せんしが かたくない');
  assert.equal(warrior.mp, 0, 'せんしが 呪文を つかえてしまう');
  assert.ok(priest.mp > hero.mp && priest.hp < hero.hp, 'そうりょの MP が 多くない');
  assert.ok(mage.mp > priest.mp && mage.hp < priest.hp, 'まほうつかいが 打たれ強すぎる');
  assert.ok(Object.values(priest.spells).flat().includes('zaoral'), 'そうりょが 蘇生を おぼえない');
});

test('店の品ぞろえはすべて実在して、値段がついている', () => {
  for (const shop of Object.values(SHOPS)) {
    for (const id of shop.goods) {
      const goods = ALL_GEAR.find((g) => g.id === id) || itemById(id);
      assert.ok(goods, `店に 未知の品 ${id} がある`);
      assert.ok(goods.price > 0, `${id} の値段が 0`);
    }
  }
});

// ------------------------------------------------------------------ マップ

test('どのマップも長方形で、知らないタイルが混ざっていない', () => {
  for (const [id, map] of Object.entries(MAPS)) {
    const w = mapWidth(map);
    assert.ok(w > 0 && mapHeight(map) > 0, `${id}: 空のマップ`);
    for (const row of map.tiles) {
      assert.equal(row.length, w, `${id}: 行の長さがそろっていない`);
      for (const ch of row) assert.ok(TILES[ch], `${id}: 知らないタイル ${ch}`);
    }
  }
});

test('ワープ・NPC・宝箱の置き場所が壁の中でない', () => {
  for (const [id, map] of Object.entries(MAPS)) {
    for (const w of map.warps) {
      assert.ok(canWalk(map, w.x, w.y), `${id}: ワープ (${w.x},${w.y}) が歩けない場所にある`);
      const dest = MAPS[w.to];
      assert.ok(dest, `${id}: ワープ先 ${w.to} が無い`);
      assert.ok(canWalk(dest, w.tx, w.ty), `${id}: ワープ先 ${w.to}(${w.tx},${w.ty}) が歩けない`);
    }
    for (const n of map.npcs) assert.ok(canWalk(map, n.x, n.y), `${id}: NPC ${n.id} が壁の中`);
    for (const c of map.chests || []) assert.ok(canWalk(map, c.x, c.y), `${id}: 宝箱 ${c.id} が壁の中`);
  }
});

test('宝箱の ID は世界でただひとつ', () => {
  const ids = Object.values(MAPS).flatMap((m) => (m.chests || []).map((c) => c.id));
  assert.equal(new Set(ids).size, ids.length);
});

test('マップの行ける場所がひと続きになっている', () => {
  const starts = { town: [10, 11], inn: [4, 5], weapon: [4, 5], item: [4, 5], house: [4, 5], world: [9, 23], cave: [11, 16], castle: [11, 16] };
  for (const [id, map] of Object.entries(MAPS)) {
    const [sx, sy] = starts[id];
    // 立て札は通れないので 障害物として数える（宝箱は開ければどく）
    const walls = new Set((map.signs || []).map((s) => `${s.x},${s.y}`));
    const seen = new Set([`${sx},${sy}`]);
    const queue = [[sx, sy]];
    while (queue.length) {
      const [x, y] = queue.pop();
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const key = `${x + dx},${y + dy}`;
        if (seen.has(key) || walls.has(key) || !canWalk(map, x + dx, y + dy)) continue;
        seen.add(key);
        queue.push([x + dx, y + dy]);
      }
    }
    for (const w of map.warps) assert.ok(seen.has(`${w.x},${w.y}`), `${id}: ワープ (${w.x},${w.y}) に たどりつけない`);
    for (const n of map.npcs) {
      const near = [[0, 1], [0, -1], [1, 0], [-1, 0]].some(([dx, dy]) => seen.has(`${n.x + dx},${n.y + dy}`));
      assert.ok(near || seen.has(`${n.x},${n.y}`), `${id}: NPC ${n.id} に 話しかけられない`);
    }
    for (const c of map.chests || []) {
      const near = [[0, 1], [0, -1], [1, 0], [-1, 0]].some(([dx, dy]) => seen.has(`${c.x + dx},${c.y + dy}`));
      assert.ok(near, `${id}: 宝箱 ${c.id} に 手がとどかない`);
    }
  }
});

test('村・ほらあな・城が つながっていて、行き来できる', () => {
  const world = MAPS.world;
  assert.equal(warpAt(world, 9, 22).to, 'town');
  assert.equal(warpAt(world, 29, 24).to, 'cave');
  assert.equal(warpAt(world, 18, 2).to, 'castle');
  assert.equal(warpAt(MAPS.town, 9, 15).to, 'world');
  assert.equal(warpAt(MAPS.cave, 11, 16).to, 'world');
  assert.equal(warpAt(MAPS.castle, 11, 16).to, 'world');
});

test('魔王の城の門には ひかりのたま がいる', () => {
  const gate = warpAt(MAPS.world, 18, 2);
  assert.equal(gate.require, 'orb');
  const orb = MAPS.cave.chests.find((c) => c.item === 'orb');
  assert.ok(orb, 'ほらあなに ひかりのたま が置かれていない');
});

test('カウンター越しでも 店主に話しかけられる', () => {
  const map = MAPS.item;
  const front = frontOf(map, 4, 3, 'up');
  assert.deepEqual(front, { x: 4, y: 1 });
  assert.ok(npcAt(map.npcs, front.x, front.y), 'カウンターの向こうに店主がいない');
});

test('安全な場所では魔物が出ない', () => {
  assert.equal(encounterChance(MAPS.town, 10, 11), 0);
  assert.equal(encounterChance(MAPS.inn, 4, 3), 0);
  assert.ok(encounterChance(MAPS.world, 9, 23) > 0);
  assert.ok(encounterChance(MAPS.cave, 11, 15) > encounterChance(MAPS.world, 9, 23) * 0.5);
});

test('川より北では 手ごわい魔物の表になる', () => {
  const south = encountersAt(MAPS.world, 9, 23).map((m) => m.id);
  const north = encountersAt(MAPS.world, 18, 5).map((m) => m.id);
  assert.ok(south.includes('slime'));
  assert.ok(!north.includes('slime'));
  assert.ok(north.includes('armor'));
});

test('宝箱は 開けたら消える', () => {
  const chest = MAPS.cave.chests[0];
  assert.ok(chestAt(MAPS.cave, [], chest.x, chest.y));
  assert.equal(chestAt(MAPS.cave, [chest.id], chest.x, chest.y), null);
});

test('マップの外は壁あつかい', () => {
  assert.equal(tileAt(MAPS.town, -1, 0), '#');
  assert.equal(canWalk(MAPS.town, 99, 99), false);
  assert.equal(mapById('そんなマップはない').id, 'town');
});

// ------------------------------------------------------------------ 仲間

test('仲間になれる人は 村と ほらあなにいる', () => {
  const joins = Object.values(MAPS).flatMap((m) => m.npcs.filter((n) => n.kind === 'join'));
  assert.equal(joins.length, PARTY_LIMIT - 1, '仲間の数が パーティの空きと合っていない');
  for (const npc of joins) {
    assert.ok(CLASSES[npc.member.cls], `${npc.id}: 未知の職業 ${npc.member.cls}`);
    assert.ok(npc.member.name && npc.lines.length, `${npc.id}: 会話が足りない`);
  }
  const classes = joins.map((n) => n.member.cls);
  assert.deepEqual([...new Set(classes)].sort(), ['mage', 'priest', 'warrior'], '職業がかたよっている');
});

test('作りたてのパーティは ゆうしゃ ひとりで、村にいる', () => {
  const save = createSave();
  assert.equal(save.party.length, 1);
  const hero = leaderOf(save);
  assert.equal(hero.cls, 'hero');
  assert.equal(hero.hp, statsOf(hero).maxHp);
  assert.equal(save.map, 'town');
  assert.ok(canWalk(MAPS.town, save.x, save.y));
});

test('仲間は 4 人まで', () => {
  const save = createSave();
  assert.ok(joinParty(save, 'warrior', 'ガロン').ok);
  assert.ok(joinParty(save, 'priest', 'ミナ').ok);
  assert.ok(joinParty(save, 'mage', 'セラ').ok);
  const over = joinParty(save, 'warrior', 'よぶんな人');
  assert.equal(over.ok, false);
  assert.equal(save.party.length, PARTY_LIMIT);
});

test('あとから入る仲間は 主人公にあわせたレベルで加わる', () => {
  const save = createSave();
  gainExp(save.party[0], 2600);                    // Lv15
  joinParty(save, 'mage', 'セラ', 7);
  const sera = save.party[1];
  assert.ok(levelOf(sera.exp) >= 12, `弱すぎる仲間になっている: Lv${levelOf(sera.exp)}`);
  assert.ok(sera.exp < save.party[0].exp, '主人公より 経験値が多い');
  assert.ok(statsOf(sera).maxMp > 0, 'まほうつかいなのに MP がない');
});

test('最低レベルは守られる', () => {
  const save = createSave();                        // 主人公は Lv1
  joinParty(save, 'mage', 'セラ', 7);
  assert.ok(levelOf(save.party[1].exp) >= 7);
});

test('職業ごとに 能力の伸びかたが違う', () => {
  const save = fullParty(2600);
  const [hero, garon, mina, sera] = save.party.map(statsOf);
  assert.ok(garon.maxHp > hero.maxHp, 'せんしの HP が 主人公より低い');
  assert.ok(garon.str > hero.str);
  assert.equal(garon.maxMp, 0);
  assert.ok(mina.maxMp > hero.maxMp);
  assert.ok(sera.maxMp > mina.maxMp);
  assert.ok(sera.maxHp < mina.maxHp);
});

test('職業ごとに おぼえる呪文が違う', () => {
  const save = fullParty(2600);
  const [hero, garon, mina, sera] = save.party.map((m) => spellsOf(m).map((s) => s.id));
  assert.ok(hero.includes('ionazun') || hero.includes('behoma'));
  assert.deepEqual(garon, []);
  assert.ok(mina.includes('zaoral'));
  assert.ok(sera.includes('rarihoo'));
  assert.ok(!sera.includes('zaoral'), 'まほうつかいが 蘇生を おぼえている');
});

test('経験値でレベルが上がり、呪文をおぼえる', () => {
  const save = createSave();
  const hero = leaderOf(save);
  const gained = gainExp(hero, expForLevel(4));
  assert.equal(levelOf(hero.exp), 4);
  assert.deepEqual(gained.map((g) => g.level), [2, 3, 4]);
  assert.deepEqual(gained.flatMap((g) => g.spells.map((s) => s.id)), ['hoimi', 'gira']);
});

test('レベルが上がると HP と MP も その分ふえる', () => {
  const hero = createMember('hero');
  hero.hp = 5;
  gainExp(hero, expForLevel(3));
  assert.ok(hero.hp > 5, 'レベルアップで HP が増えていない');
  assert.ok(hero.mp > 0, 'MP をおぼえていない');
});

test('最大レベルより先には上がらない', () => {
  const hero = createMember('hero');
  gainExp(hero, 999999);
  assert.equal(levelOf(hero.exp), LEVELS[LEVELS.length - 1].level);
  assert.equal(expToNext(hero.exp), null);
});

test('装備すると 攻撃力と守備力が上がる', () => {
  const hero = createMember('hero');
  const before = statsOf(hero);
  hero.weapon = 'steel';
  hero.armor = 'iron';
  hero.shield = 'ironShield';
  const after = statsOf(hero);
  assert.ok(after.atk > before.atk);
  assert.ok(after.def > before.def);
});

// ------------------------------------------------------------------ 道具

test('やくそうは 選んだ仲間を回復する', () => {
  const save = fullParty(600);
  const mina = save.party[2];
  mina.hp = 5;
  const res = useItem(save, 'herb', mina, 'field', rng);
  assert.ok(res.ok);
  assert.ok(mina.hp > 5);
  assert.equal(save.items.herb, 1);
  assert.equal(save.party[0].hp, statsOf(save.party[0]).maxHp, 'ほかの仲間まで回復している');
});

test('HP が満タンなら やくそうは 使えない', () => {
  const save = createSave();
  const res = useItem(save, 'herb', leaderOf(save), 'field', rng);
  assert.equal(res.ok, false);
  assert.equal(save.items.herb, 2);
});

test('せかいじゅのはは 死んだ仲間だけに使える', () => {
  const save = fullParty(600);
  addItem(save, 'leaf');
  const garon = save.party[1];
  assert.equal(useItem(save, 'leaf', garon, 'field', rng).ok, false);
  garon.hp = 0;
  assert.ok(useItem(save, 'leaf', garon, 'field', rng).ok);
  assert.equal(garon.hp, statsOf(garon).maxHp);
  assert.equal(save.items.leaf, undefined);
});

test('キメラのつばさは 戦闘中には使えない', () => {
  const save = createSave();
  addItem(save, 'wing');
  assert.equal(useItem(save, 'wing', leaderOf(save), 'battle', rng).ok, false);
  assert.equal(useItem(save, 'wing', leaderOf(save), 'field', rng).warp, true);
});

test('たねは 選んだ仲間の能力を永久に上げる', () => {
  const save = fullParty(600);
  addItem(save, 'seedStr');
  const garon = save.party[1];
  const before = statsOf(garon).str;
  useItem(save, 'seedStr', garon, 'field', rng);
  assert.equal(statsOf(garon).str, before + 5);
});

test('道具の持てる種類には上限がある', () => {
  const save = createSave();
  save.items = {};
  for (const item of ITEMS) addItem(save, item.id);
  assert.ok(itemList(save).length <= 12);
});

// ------------------------------------------------------------------ 店・宿

test('買った装備は 選んだ仲間が身につける', () => {
  const save = fullParty(600);
  save.gold = 500;
  const garon = save.party[1];
  const res = buy(save, 'copper', garon);
  assert.ok(res.ok);
  assert.equal(garon.weapon, 'copper');
  assert.equal(save.party[0].weapon, 'none');
  assert.equal(save.gold, 500 - 140);
});

test('お金が足りなければ 買えない', () => {
  const save = createSave();
  save.gold = 10;
  assert.equal(buy(save, 'steel').ok, false);
  assert.equal(leaderOf(save).weapon, 'none');
  assert.equal(save.gold, 10);
});

test('道具は買値の半分で売れる', () => {
  const save = createSave();
  const gold = save.gold;
  assert.ok(sell(save, 'herb').ok);
  assert.equal(save.gold, gold + Math.floor(itemById('herb').price / 2));
  assert.equal(save.items.herb, 1);
});

test('だいじな品は売れない', () => {
  const save = createSave();
  addItem(save, 'orb');
  assert.equal(sell(save, 'orb').ok, false);
  assert.equal(save.items.orb, 1);
});

test('宿代は 人数がふえるほど高くなる', () => {
  const solo = createSave();
  const four = fullParty(0);
  assert.ok(innCost(four) > innCost(solo));
});

test('宿屋に泊まると 死んだ仲間も 元気になる', () => {
  const save = fullParty(600);
  save.gold = 9999;
  save.party[1].hp = 0;
  save.party[2].hp = 3;
  save.party[3].mp = 0;
  const cost = innCost(save);
  const res = stayInn(save);
  assert.ok(res.ok);
  for (const member of save.party) {
    const s = statsOf(member);
    assert.equal(member.hp, s.maxHp, `${member.name}の HP が回復していない`);
    assert.equal(member.mp, s.maxMp, `${member.name}の MP が回復していない`);
  }
  assert.equal(save.gold, 9999 - cost);
});

test('お金が足りなければ 泊まれない', () => {
  const save = createSave();
  save.gold = 0;
  leaderOf(save).hp = 1;
  assert.equal(stayInn(save).ok, false);
  assert.equal(leaderOf(save).hp, 1);
});

// ------------------------------------------------------------------ ダメージ

test('守備力が高いほど ダメージが減る', () => {
  assert.ok(attackDamage(40, 0, rng) > attackDamage(40, 60, rng));
  assert.ok(attackDamage(40, 60, rng) >= 0);
});

test('ダメージは 0 未満にならない', () => {
  for (let i = 0; i < 200; i++) {
    const r = mulberry32(i + 1);
    assert.ok(attackDamage(5, 200, r) >= 0);
    assert.ok(attackDamage(200, 5, r) >= 1);
  }
});

test('重み付き抽選は 重みの大きいほうがよく出る', () => {
  const r = mulberry32(7);
  const items = [{ id: 'a', w: 90 }, { id: 'b', w: 10 }];
  let a = 0;
  for (let i = 0; i < 1000; i++) if (weightedPick(items, (x) => x.w, r).id === 'a') a++;
  assert.ok(a > 800, `偏りがおかしい: ${a}`);
});

// ------------------------------------------------------------------ 戦闘

test('パーティ全員が 1 ターンに 1 回ずつ行動する', () => {
  const save = fullParty(600);
  const battle = new Battle(save, 'golem', mulberry32(3));
  const lines = battle.resolve(attackAll(save));
  for (const member of save.party) {
    assert.ok(lines.some((l) => l.text.startsWith(`${member.name}の`)), `${member.name}が 行動していない`);
  }
});

test('攻撃すると 魔物の HP が減る', () => {
  const save = fullParty(600);
  const battle = new Battle(save, 'golem', mulberry32(4));
  const before = battle.monster.hp;
  battle.resolve(attackAll(save));
  assert.ok(battle.monster.hp < before);
});

test('スライムには 勝てて 全員が経験値をもらえる', () => {
  const save = fullParty(0);
  const battle = new Battle(save, 'slime', mulberry32(11));
  for (let i = 0; i < 30 && !battle.over; i++) battle.resolve(attackAll(save));
  assert.equal(battle.result, 'win');
  const reward = claimReward(save, battle);
  assert.equal(reward.gold, monsterById('slime').gold);
  for (const member of save.party) assert.equal(member.exp, monsterById('slime').exp);
});

test('倒れている仲間は 経験値をもらえない', () => {
  const save = fullParty(600);
  const battle = new Battle(save, 'slime', mulberry32(12));
  const fallen = save.party[3];
  fallen.hp = 0;
  const expBefore = fallen.exp;
  for (let i = 0; i < 30 && !battle.over; i++) battle.resolve(attackAll(save));
  claimReward(save, battle);
  assert.equal(fallen.exp, expBefore);
  assert.ok(save.party[0].exp > expBefore);
});

test('魔物の攻撃は 全員ではなく だれかに当たる', () => {
  const save = fullParty(80);
  const battle = new Battle(save, 'knight', mulberry32(5));   // 1 ターンに 2 回 動く魔物
  battle.resolve(attackAll(save));
  const hurt = save.party.filter((m) => m.hp < statsOf(m).maxHp);
  assert.ok(hurt.length >= 1, 'だれも ダメージを受けていない');
  assert.ok(hurt.length <= battle.monster.acts, '行動回数より 多くの仲間が 傷ついている');
});

test('全員 倒れると 全滅になる', () => {
  const save = fullParty(0);
  const battle = new Battle(save, 'dragon', mulberry32(6));
  for (let i = 0; i < 60 && !battle.over; i++) battle.resolve(attackAll(save));
  assert.equal(battle.result, 'lose');
  assert.ok(isWiped(save));
  assert.equal(alive(save.party).length, 0);
});

test('全滅すると 所持金が半分になって 村で目を覚ます', () => {
  const save = fullParty(600);
  save.gold = 100;
  save.map = 'castle';
  for (const m of save.party) m.hp = 0;
  const { lost } = onDefeat(save);
  assert.equal(lost, 50);
  assert.equal(save.gold, 50);
  assert.equal(save.map, 'town');
  for (const m of save.party) assert.equal(m.hp, statsOf(m).maxHp);
});

test('ホイミで 選んだ仲間が回復する', () => {
  const save = fullParty(600);
  const mina = save.party[2];
  const garon = save.party[1];
  garon.hp = 10;
  const battle = new Battle(save, 'golem', mulberry32(7));   // すぐ倒れない相手で
  const actions = attackAll(save);
  actions[2] = { type: 'spell', id: 'hoimi', target: garon };
  const mp = mina.mp;
  battle.resolve(actions);
  assert.ok(garon.hp > 10, 'ガロンが 回復していない');
  assert.equal(mina.mp, mp - spellById('hoimi').mp);
});

test('ザオラルで 倒れた仲間が生き返ることがある', () => {
  let revived = 0;
  for (let seed = 0; seed < 40; seed++) {
    const save = fullParty(1550);                 // ミナが ザオラルを覚えるレベル
    const mina = save.party[2];
    const garon = save.party[1];
    garon.hp = 0;
    const battle = new Battle(save, 'golem', mulberry32(500 + seed));
    const actions = attackAll(save);
    actions[1] = null;
    actions[2] = { type: 'spell', id: 'zaoral', target: garon };
    battle.resolve(actions);
    if (garon.hp > 0) revived++;
  }
  assert.ok(revived > 8 && revived < 38, `生き返る確率がおかしい: ${revived}/40`);
});

test('ラリホーで 魔物が眠る', () => {
  let slept = 0;
  for (let seed = 0; seed < 40; seed++) {
    const save = fullParty(600);
    const battle = new Battle(save, 'golem', mulberry32(700 + seed));
    const actions = [null, null, null, { type: 'spell', id: 'rarihoo' }];
    const lines = battle.resolve(actions);
    if (lines.some((l) => l.text.includes('眠ってしまった'))) slept++;
  }
  assert.ok(slept > 18, `ラリホーが 効かなすぎる: ${slept}/40`);
});

test('MP が足りなければ 唱えられない', () => {
  const save = fullParty(600);
  const sera = save.party[3];
  sera.mp = 0;
  const battle = new Battle(save, 'slime', mulberry32(8));
  const actions = attackAll(save);
  actions[3] = { type: 'spell', id: 'gira' };
  const lines = battle.resolve(actions);
  assert.ok(lines.some((l) => l.text.includes('MP')), 'MP 不足のメッセージが出ていない');
});

test('おぼえていない呪文は 唱えられない', () => {
  const save = fullParty(600);
  const battle = new Battle(save, 'slime', mulberry32(9));
  const actions = attackAll(save);
  actions[1] = { type: 'spell', id: 'hoimi' };     // せんしは 呪文を使えない
  const lines = battle.resolve(actions);
  assert.ok(lines.some((l) => l.text.includes('知らない')));
});

test('魔王からは 逃げられない', () => {
  const save = fullParty(5200);
  const battle = new Battle(save, 'darklord', mulberry32(10));
  const actions = attackAll(save);
  actions[0] = { type: 'flee' };
  const lines = battle.resolve(actions);
  assert.equal(battle.result, null);
  assert.ok(lines.some((l) => l.text.includes('はばまれた')));
});

test('弱い魔物からは たいてい逃げられる', () => {
  let escaped = 0;
  for (let i = 0; i < 50; i++) {
    const save = fullParty(2600);
    const battle = new Battle(save, 'slime', mulberry32(100 + i));
    const actions = attackAll(save);
    actions[0] = { type: 'flee' };
    battle.resolve(actions);
    if (battle.result === 'escaped') escaped++;
  }
  assert.ok(escaped > 30, `逃げられた回数が少なすぎる: ${escaped}`);
});

test('戦闘中でも やくそうを 仲間に使える', () => {
  const save = fullParty(600);
  const sera = save.party[3];
  sera.hp = 5;
  const battle = new Battle(save, 'golem', mulberry32(13));
  const actions = attackAll(save);
  actions[0] = { type: 'item', id: 'herb', target: sera };
  battle.resolve(actions);
  assert.ok(sera.hp > 5);
  assert.equal(save.items.herb, 1);
});

test('バイキルトで 攻撃力が上がる', () => {
  const save = fullParty(3300);
  const garon = save.party[1];
  const battle = new Battle(save, 'golem', mulberry32(14));
  const before = battle.atkOf(garon);
  const actions = attackAll(save);
  actions[2] = { type: 'spell', id: 'baikiruto', target: garon };
  battle.resolve(actions);
  assert.ok(battle.atkOf(garon) > before);
});

test('戦闘のメッセージには かならず文章がある', () => {
  for (const monster of MONSTERS) {
    const save = fullParty(3300);
    const battle = new Battle(save, monster.id, mulberry32(monster.name.length + 1));
    const lines = [...battle.start(), ...battle.resolve(attackAll(save))];
    for (const line of lines) assert.ok(typeof line.text === 'string' && line.text.length, `${monster.name}: 空のメッセージ`);
  }
});

// ------------------------------------------------------------------ セーブ

test('セーブデータを読み書きしても中身が変わらない', () => {
  const save = fullParty(500);
  save.gold = 1234;
  save.party[1].weapon = 'steel';
  save.chests.push('cave-1');
  addItem(save, 'wing', 3);
  const back = normalizeSave(JSON.parse(JSON.stringify(save)));
  assert.deepEqual(back, save);
});

test('古い 1 人ぶんのセーブデータも 読み込める', () => {
  const old = {
    v: 1, name: 'ゆうしゃ', exp: 600, gold: 500, hp: 40, mp: 10,
    weapon: 'steel', armor: 'iron', shield: 'none',
    items: { herb: 3 }, flags: { elder: true }, chests: ['cave-1'],
    steps: 120, map: 'cave', x: 11, y: 16, dir: 'up',
  };
  const save = normalizeSave(old);
  assert.equal(save.party.length, 1);
  assert.equal(save.party[0].cls, 'hero');
  assert.equal(save.party[0].exp, 600);
  assert.equal(save.party[0].weapon, 'steel');
  assert.equal(save.gold, 500);
  assert.equal(save.items.herb, 3);
  assert.equal(save.map, 'cave');
  assert.equal(save.flags.elder, true);
});

test('壊れたセーブデータでも遊べる形に直る', () => {
  const broken = normalizeSave({
    party: [{ cls: 'そんな職業はない', exp: -5, hp: 9999, weapon: 'ずるい剣' }],
    gold: 'たくさん', items: { herb: -3, なぞ: 5 }, map: 42,
  });
  const hero = leaderOf(broken);
  assert.equal(hero.cls, 'hero');
  assert.equal(hero.exp, 0);
  assert.equal(broken.gold, 0);
  assert.equal(hero.weapon, 'none');
  assert.ok(hero.hp > 0 && hero.hp <= statsOf(hero).maxHp);
  assert.deepEqual(broken.items, {});
  assert.equal(broken.map, 'town');
});

test('全滅したまま保存されていても 先頭は立ち上がる', () => {
  const save = fullParty(600);
  for (const m of save.party) m.hp = 0;
  const back = normalizeSave(JSON.parse(JSON.stringify(save)));
  assert.ok(back.party[0].hp > 0);
  assert.ok(!isWiped(back));
});

test('セーブデータが無くても 作りたてのパーティになる', () => {
  const save = normalizeSave(null);
  assert.equal(save.party.length, 1);
  assert.equal(leaderOf(save).name, 'ゆうしゃ');
  assert.equal(save.gold, 30);
});

// ------------------------------------------------------------------ バランス

/** 回復役つきの 素直な戦いかたで 1 戦してみる。 */
function simulate(save, monsterId, seed) {
  const rand = mulberry32(seed);
  const battle = new Battle(save, monsterId, rand);
  for (let turn = 0; turn < 200 && !battle.over; turn++) {
    const actions = save.party.map((member) => {
      if (isDown(member)) return null;
      const spells = spellsOf(member).map((s) => s.id);
      const weakest = alive(save.party)
        .slice()
        .sort((a, b) => a.hp / statsOf(a).maxHp - b.hp / statsOf(b).maxHp)[0];
      const ratio = weakest ? weakest.hp / statsOf(weakest).maxHp : 1;
      if (ratio < 0.5 && spells.includes('behoma') && member.mp >= 14) return { type: 'spell', id: 'behoma', target: weakest };
      if (ratio < 0.5 && spells.includes('behoimi') && member.mp >= 8) return { type: 'spell', id: 'behoimi', target: weakest };
      if (ratio < 0.4 && spells.includes('hoimi') && member.mp >= 4) return { type: 'spell', id: 'hoimi', target: weakest };
      if (spells.includes('ionazun') && member.mp >= 20) return { type: 'spell', id: 'ionazun' };
      if (spells.includes('begirama') && member.mp >= 9) return { type: 'spell', id: 'begirama' };
      if (spells.includes('gira') && member.mp >= 5) return { type: 'spell', id: 'gira' };
      return { type: 'attack' };
    });
    battle.resolve(actions);
  }
  return battle;
}

/** その時期に そろえていそうな装備をつける。 */
function equipParty(save, weapon, armor, shield) {
  for (const member of save.party) {
    member.weapon = weapon;
    member.armor = armor;
    member.shield = shield;
  }
}

test('道中の魔物には ちゃんと勝てる', () => {
  const plan = [
    ['goblin', 5, 'copper', 'leather', 'none'],
    ['armor', 9, 'copper', 'chain', 'leatherShield'],
    ['skeleton', 11, 'steel', 'chain', 'ironShield'],
    ['golem', 13, 'steel', 'iron', 'ironShield'],
    ['dragon', 17, 'flame', 'magic', 'mirrorShield'],
  ];
  for (const [id, level, weapon, armor, shield] of plan) {
    let wins = 0;
    for (let i = 0; i < 20; i++) {
      const save = fullParty(expForLevel(level));
      equipParty(save, weapon, armor, shield);
      save.items = { herb: 5 };
      if (simulate(save, id, 3000 + i).result === 'win') wins++;
    }
    assert.ok(wins >= 18, `Lv${level} で ${id} に勝てなさすぎる: ${wins}/20`);
  }
});

test('装備をそろえた Lv18 のパーティなら 魔王に勝てる見込みがある', () => {
  let wins = 0;
  const tries = 30;
  for (let i = 0; i < tries; i++) {
    const save = fullParty(expForLevel(18));
    equipParty(save, 'light', 'lightArmor', 'mirrorShield');
    save.items = { herb: 8, leaf: 1 };
    if (simulate(save, 'darklord', 4000 + i).result === 'win') wins++;
  }
  assert.ok(wins >= tries * 0.55, `Lv18 の勝率が低すぎる: ${wins}/${tries}`);
  assert.ok(wins <= tries * 0.98, `歯ごたえが なさすぎる: ${wins}/${tries}`);
});

test('レベル 5 では 魔王に歯が立たない', () => {
  let wins = 0;
  for (let i = 0; i < 20; i++) {
    const save = fullParty(expForLevel(5));
    equipParty(save, 'copper', 'leather', 'none');
    if (simulate(save, 'darklord', 5000 + i).result === 'win') wins++;
  }
  assert.equal(wins, 0, 'レベル 5 で魔王に勝ててしまう');
});
