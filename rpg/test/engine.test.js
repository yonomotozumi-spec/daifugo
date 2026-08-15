import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ALL_GEAR, Battle, ITEMS, LEVELS, MONSTERS, SPELLS,
  addItem, attackDamage, buy, claimReward, createHero, expToNext, gainExp, innCost,
  itemById, itemList, levelOf, monsterById, mulberry32, normalizeHero, onDefeat, sell,
  spellById, spellsOf, statsOf, stayInn, useItem, weightedPick,
} from '../src/engine.js';
import {
  MAPS, SHOPS, TILES, canWalk, chestAt, encounterChance, encountersAt, frontOf,
  mapById, mapHeight, mapWidth, npcAt, tileAt, warpAt,
} from '../src/world.js';

const rng = () => 0.5;   // まん中の目で固定した乱数

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

test('覚える呪文はすべて実在して、重複がない', () => {
  const learned = LEVELS.flatMap((row) => row.spells);
  assert.equal(new Set(learned).size, learned.length, '同じ呪文を 2 回覚えている');
  for (const id of learned) assert.ok(spellById(id), `未知の呪文 ${id}`);
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

// ------------------------------------------------------------------ 主人公

test('作りたての主人公は HP 満タンで村にいる', () => {
  const hero = createHero();
  const s = statsOf(hero);
  assert.equal(hero.hp, s.maxHp);
  assert.equal(s.level, 1);
  assert.equal(hero.map, 'town');
  assert.ok(canWalk(MAPS.town, hero.x, hero.y));
});

test('経験値でレベルが上がり、呪文をおぼえる', () => {
  const hero = createHero();
  const gained = gainExp(hero, LEVELS[3].exp);       // Lv4 まで
  assert.equal(levelOf(hero.exp), 4);
  assert.deepEqual(gained.map((g) => g.level), [2, 3, 4]);
  const learned = gained.flatMap((g) => g.spells.map((s) => s.id));
  assert.deepEqual(learned, ['hoimi', 'gira']);
  assert.deepEqual(spellsOf(hero).map((s) => s.id), ['hoimi', 'gira']);
});

test('レベルが上がると HP と MP も その分ふえる', () => {
  const hero = createHero();
  hero.hp = 5;
  gainExp(hero, LEVELS[2].exp);
  assert.ok(hero.hp > 5, 'レベルアップで HP が回復していない');
  assert.ok(hero.mp > 0, 'MP をおぼえていない');
});

test('最大レベルより先には上がらない', () => {
  const hero = createHero();
  gainExp(hero, 999999);
  assert.equal(levelOf(hero.exp), LEVELS[LEVELS.length - 1].level);
  assert.equal(expToNext(hero.exp), null);
});

test('装備すると 攻撃力と守備力が上がる', () => {
  const hero = createHero();
  const before = statsOf(hero);
  hero.weapon = 'steel';
  hero.armor = 'iron';
  hero.shield = 'ironShield';
  const after = statsOf(hero);
  assert.ok(after.atk > before.atk);
  assert.ok(after.def > before.def);
});

test('やくそうで回復し、道具が 1 つ減る', () => {
  const hero = createHero();
  hero.hp = 5;
  const res = useItem(hero, 'herb', 'field', rng);
  assert.ok(res.ok);
  assert.ok(hero.hp > 5);
  assert.equal(hero.items.herb, 1);
});

test('HP が満タンなら やくそうは 使えない', () => {
  const hero = createHero();
  const res = useItem(hero, 'herb', 'field', rng);
  assert.equal(res.ok, false);
  assert.equal(hero.items.herb, 2);
});

test('キメラのつばさは 戦闘中には使えない', () => {
  const hero = createHero();
  addItem(hero, 'wing');
  assert.equal(useItem(hero, 'wing', 'battle', rng).ok, false);
  assert.equal(useItem(hero, 'wing', 'field', rng).warp, true);
});

test('たねは 能力を永久に上げる', () => {
  const hero = createHero();
  addItem(hero, 'seedStr');
  const before = statsOf(hero).str;
  useItem(hero, 'seedStr', 'field', rng);
  assert.equal(statsOf(hero).str, before + 5);
});

test('道具の持てる種類には上限がある', () => {
  const hero = createHero();
  hero.items = {};
  for (const item of ITEMS) addItem(hero, item.id);
  assert.ok(itemList(hero).length <= 12);
});

// ------------------------------------------------------------------ 店・宿

test('買い物でお金が減り、装備が変わる', () => {
  const hero = createHero();
  hero.gold = 500;
  const res = buy(hero, 'copper');
  assert.ok(res.ok);
  assert.equal(hero.weapon, 'copper');
  assert.equal(hero.gold, 500 - 140);
});

test('お金が足りなければ 買えない', () => {
  const hero = createHero();
  hero.gold = 10;
  const res = buy(hero, 'steel');
  assert.equal(res.ok, false);
  assert.equal(hero.weapon, 'none');
  assert.equal(hero.gold, 10);
});

test('道具は買値の半分で売れる', () => {
  const hero = createHero();
  const gold = hero.gold;
  const res = sell(hero, 'herb');
  assert.ok(res.ok);
  assert.equal(hero.gold, gold + Math.floor(itemById('herb').price / 2));
  assert.equal(hero.items.herb, 1);
});

test('だいじな品は売れない', () => {
  const hero = createHero();
  addItem(hero, 'orb');
  assert.equal(sell(hero, 'orb').ok, false);
  assert.equal(hero.items.orb, 1);
});

test('宿屋に泊まると全回復して、お金が減る', () => {
  const hero = createHero();
  gainExp(hero, 300);
  hero.hp = 1;
  hero.mp = 0;
  hero.gold = 500;
  const cost = innCost(hero);
  const res = stayInn(hero);
  assert.ok(res.ok);
  const s = statsOf(hero);
  assert.equal(hero.hp, s.maxHp);
  assert.equal(hero.mp, s.maxMp);
  assert.equal(hero.gold, 500 - cost);
});

test('お金が足りなければ 泊まれない', () => {
  const hero = createHero();
  hero.gold = 0;
  hero.hp = 1;
  assert.equal(stayInn(hero).ok, false);
  assert.equal(hero.hp, 1);
});

// ------------------------------------------------------------------ ダメージ

test('守備力が高いほど ダメージが減る', () => {
  const soft = attackDamage(40, 0, rng);
  const hard = attackDamage(40, 60, rng);
  assert.ok(soft > hard);
  assert.ok(hard >= 0);
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

test('攻撃すると 魔物の HP が減る', () => {
  const hero = createHero();
  const battle = new Battle(hero, 'slime', mulberry32(3));
  const before = battle.monster.hp;
  battle.command({ type: 'attack' });
  assert.ok(battle.monster.hp < before);
});

test('スライムには 勝てて 経験値と金貨がもらえる', () => {
  const hero = createHero();
  const battle = new Battle(hero, 'slime', mulberry32(11));
  for (let i = 0; i < 30 && !battle.over; i++) battle.command({ type: 'attack' });
  assert.equal(battle.result, 'win');
  const reward = claimReward(hero, battle);
  assert.equal(reward.gold, monsterById('slime').gold);
  assert.equal(hero.exp, monsterById('slime').exp);
});

test('レベル 1 でドラゴンに挑めば 力つきる', () => {
  const hero = createHero();
  const battle = new Battle(hero, 'dragon', mulberry32(5));
  for (let i = 0; i < 60 && !battle.over; i++) battle.command({ type: 'attack' });
  assert.equal(battle.result, 'lose');
  assert.equal(hero.hp, 0);
});

test('力つきると 所持金が半分になって 村に戻る', () => {
  const hero = createHero();
  hero.gold = 100;
  hero.hp = 0;
  hero.map = 'castle';
  const { lost } = onDefeat(hero);
  assert.equal(lost, 50);
  assert.equal(hero.gold, 50);
  assert.equal(hero.map, 'town');
  assert.equal(hero.hp, statsOf(hero).maxHp);
});

test('呪文は MP を消費し、足りなければ 唱えられない', () => {
  const hero = createHero();
  gainExp(hero, 999);          // ホイミ・ギラをおぼえる
  hero.hp = 1;
  const battle = new Battle(hero, 'slime', mulberry32(2));
  const mp = hero.mp;
  battle.command({ type: 'spell', id: 'hoimi' });
  assert.equal(hero.mp, mp - spellById('hoimi').mp);
  assert.ok(hero.hp > 1);

  hero.mp = 0;
  const lines = battle.command({ type: 'spell', id: 'gira' });
  assert.ok(lines.some((l) => l.text.includes('MP')), 'MP 不足のメッセージが出ていない');
});

test('おぼえていない呪文は 唱えられない', () => {
  const hero = createHero();
  const battle = new Battle(hero, 'slime', mulberry32(4));
  const lines = battle.command({ type: 'spell', id: 'ionazun' });
  assert.ok(lines.some((l) => l.text.includes('知らない')));
});

test('魔王からは 逃げられない', () => {
  const hero = createHero();
  gainExp(hero, 99999);
  const battle = new Battle(hero, 'darklord', mulberry32(9));
  const lines = battle.command({ type: 'flee' });
  assert.equal(battle.result, null);
  assert.ok(lines.some((l) => l.text.includes('逃げられない')));
});

test('弱い魔物からは たいてい逃げられる', () => {
  let escaped = 0;
  for (let i = 0; i < 50; i++) {
    const hero = createHero();
    gainExp(hero, 3000);
    const battle = new Battle(hero, 'slime', mulberry32(100 + i));
    battle.command({ type: 'flee' });
    if (battle.result === 'escaped') escaped++;
  }
  assert.ok(escaped > 30, `逃げられた回数が少なすぎる: ${escaped}`);
});

test('戦闘中でも やくそうが使える', () => {
  const hero = createHero();
  hero.hp = 5;
  const battle = new Battle(hero, 'slime', mulberry32(6));
  battle.command({ type: 'item', id: 'herb' });
  assert.ok(hero.hp > 5);
  assert.equal(hero.items.herb, 1);
});

test('バイキルトで 攻撃力が上がる', () => {
  const hero = createHero();
  gainExp(hero, 99999);
  const battle = new Battle(hero, 'golem', mulberry32(8));
  const before = battle.heroAtk;
  battle.command({ type: 'spell', id: 'baikiruto' });
  assert.ok(battle.heroAtk > before);
});

test('戦闘のメッセージには かならず文章がある', () => {
  const hero = createHero();
  gainExp(hero, 99999);
  for (const monster of MONSTERS) {
    const battle = new Battle(hero, monster.id, mulberry32(monster.name.length + 1));
    hero.hp = statsOf(hero).maxHp;
    const lines = [...battle.start(), ...battle.command({ type: 'attack' })];
    for (const line of lines) assert.ok(typeof line.text === 'string' && line.text.length, `${monster.name}: 空のメッセージ`);
  }
});

// ------------------------------------------------------------------ セーブ

test('セーブデータを読み書きしても中身が変わらない', () => {
  const hero = createHero('テスト');
  gainExp(hero, 500);
  hero.gold = 1234;
  hero.weapon = 'steel';
  hero.chests.push('cave-1');
  addItem(hero, 'wing', 3);
  const back = normalizeHero(JSON.parse(JSON.stringify(hero)));
  assert.deepEqual(back, hero);
});

test('壊れたセーブデータでも遊べる形に直る', () => {
  const broken = normalizeHero({ name: '', exp: -5, gold: 'たくさん', hp: 9999, weapon: 'ずるい剣', items: { herb: -3, なぞ: 5 }, map: 42 });
  const s = statsOf(broken);
  assert.equal(broken.exp, 0);
  assert.equal(broken.gold, 0);
  assert.equal(broken.weapon, 'none');
  assert.ok(broken.hp > 0 && broken.hp <= s.maxHp);
  assert.deepEqual(broken.items, {});
  assert.equal(broken.map, 'town');
});

test('セーブデータが無くても 作りたての主人公になる', () => {
  const hero = normalizeHero(null);
  assert.equal(hero.name, 'ゆうしゃ');
  assert.equal(hero.gold, 30);
});

// ------------------------------------------------------------------ バランス

test('装備をそろえた Lv18 なら 魔王に勝てる見込みがある', () => {
  let wins = 0;
  const tries = 40;
  for (let i = 0; i < tries; i++) {
    const hero = createHero();
    gainExp(hero, 5200);                    // Lv18
    hero.weapon = 'light';
    hero.armor = 'lightArmor';
    hero.shield = 'mirrorShield';
    hero.items = { herb: 6 };
    const rand = mulberry32(1000 + i);
    const battle = new Battle(hero, 'darklord', rand);
    const max = statsOf(hero).maxHp;
    for (let turn = 0; turn < 200 && !battle.over; turn++) {
      if (hero.hp < max * 0.45 && hero.mp >= 14) battle.command({ type: 'spell', id: 'behoma' });
      else if (hero.hp < max * 0.35 && hero.items.herb) battle.command({ type: 'item', id: 'herb' });
      else battle.command({ type: 'attack' });
    }
    if (battle.result === 'win') wins++;
  }
  assert.ok(wins >= tries * 0.6, `Lv18 の勝率が低すぎる: ${wins}/${tries}`);
});

test('レベル 5 では 魔王に歯が立たない', () => {
  let wins = 0;
  for (let i = 0; i < 20; i++) {
    const hero = createHero();
    gainExp(hero, 80);
    hero.weapon = 'copper';
    const battle = new Battle(hero, 'darklord', mulberry32(2000 + i));
    for (let turn = 0; turn < 200 && !battle.over; turn++) battle.command({ type: 'attack' });
    if (battle.result === 'win') wins++;
  }
  assert.equal(wins, 0, 'レベル 5 で魔王に勝ててしまう');
});
