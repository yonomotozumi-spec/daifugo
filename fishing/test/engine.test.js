import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FIGHT, FISH, GEAR, LURES, NO_GEAR, RARITY, RODS, SPOTS,
  Fight, biteDelay, buy, collectionProgress, createPlayer, equip,
  equippedLure, equippedRod, fishById, fishOfSpot, gearById, gearEffects,
  hookWindow, mulberry32, normalizePlayer, owns, pickFish, priceOf, recordCatch,
  sell, sizeTitle, timeAt, weightedPick,
  EVENTS, WEATHERS, WEATHER_SPAN, advanceWeather, rollEvent, tickEvent, weatherById,
  CHARMS, buyCharm, charmById, charmCount, shortMoney, useCharm,
} from '../src/engine.js';

const lure = (id) => LURES.find((l) => l.id === id);
const rod = (id) => RODS.find((r) => r.id === id);

// ------------------------------------------------------------------ データ

test('魚・竿・ルアー・釣り場の ID が重複しない', () => {
  for (const [label, list] of [['魚', FISH], ['竿', RODS], ['ルアー', LURES], ['釣り場', SPOTS]]) {
    const ids = list.map((x) => x.id);
    assert.equal(new Set(ids).size, ids.length, `${label}の ID が重複している`);
  }
});

test('魚のデータが壊れていない', () => {
  for (const f of FISH) {
    assert.ok(RARITY[f.rarity], `${f.name}: 未知のレア度 ${f.rarity}`);
    assert.ok(SPOTS.some((s) => s.id === f.spot), `${f.name}: 未知の釣り場 ${f.spot}`);
    assert.ok(f.weight[0] > 0 && f.weight[1] > f.weight[0], `${f.name}: 重さの範囲がおかしい`);
    assert.ok(f.length[0] > 0 && f.length[1] > f.length[0], `${f.name}: 長さの範囲がおかしい`);
    assert.ok(f.power >= 1 && f.power <= 5, `${f.name}: パワーが範囲外`);
    assert.ok(f.value > 0 && f.emoji && f.name, `${f.name}: 表示用の値が欠けている`);
  }
});

test('どの釣り場にも魚がいて、レア度がひと通りそろっている', () => {
  for (const spot of SPOTS) {
    const list = fishOfSpot(spot.id);
    assert.ok(list.length >= 5, `${spot.name}の魚が少なすぎる`);
    assert.ok(list.some((f) => f.rarity === 'common'), `${spot.name}に common がいない`);
  }
});

test('釣り場・竿・ルアーの値段は段階的に上がる', () => {
  for (const list of [SPOTS, RODS, LURES]) {
    for (let i = 1; i < list.length; i++) {
      assert.ok(list[i].price > list[i - 1].price, `${list[i].name}の値段が前より安い`);
    }
  }
  assert.equal(SPOTS[0].price, 0);
  assert.equal(RODS[0].price, 0);
  assert.equal(LURES[0].price, 0);
});

// ------------------------------------------------------------------ 抽選

test('weightedPick は重みゼロの候補を選ばない', () => {
  const rng = mulberry32(7);
  for (let i = 0; i < 200; i++) {
    assert.equal(weightedPick(['a', 'b'], [0, 1], rng), 'b');
  }
});

test('pickFish はその釣り場の魚だけを返し、サイズが範囲に収まる', () => {
  const rng = mulberry32(42);
  for (const spot of SPOTS) {
    for (let i = 0; i < 300; i++) {
      const r = pickFish(spot.id, { rng, rod: rod('legend'), lure: lure('worm') });
      assert.equal(r.fish.spot, spot.id);
      assert.ok(r.weightKg >= r.fish.weight[0] - 0.01 && r.weightKg <= r.fish.weight[1] + 0.01);
      assert.ok(r.lengthCm >= r.fish.length[0] - 1 && r.lengthCm <= r.fish.length[1] + 1);
      assert.ok(r.price >= 1);
      assert.ok(r.sizeRatio >= 0 && r.sizeRatio <= 1);
    }
  }
});

test('pickFish は同じシードなら同じ結果になる', () => {
  const draw = () => {
    const rng = mulberry32(2024);
    return Array.from({ length: 20 }, () => pickFish('sea', { rng, rod: rod('nobe'), lure: lure('worm') }))
      .map((r) => `${r.fish.id}:${r.weightKg}`);
  };
  assert.deepEqual(draw(), draw());
});

test('知らない釣り場を指定すると例外になる', () => {
  assert.throws(() => pickFish('mars', { rng: mulberry32(1) }), /unknown spot/);
});

const rarityRate = (spotId, opts, n = 4000) => {
  const rng = mulberry32(99);
  let rareOrBetter = 0;
  let junk = 0;
  for (let i = 0; i < n; i++) {
    const { fish } = pickFish(spotId, { rng, rod: rod('legend'), ...opts });
    if (['rare', 'epic', 'legendary'].includes(fish.rarity)) rareOrBetter++;
    if (fish.junk) junk++;
  }
  return { rare: rareOrBetter / n, junk: junk / n };
};

test('良いルアーほどレアが出やすく、ゴミが減る', () => {
  const worm = rarityRate('pond', { lure: lure('worm'), timeIndex: 1 });
  const aurora = rarityRate('pond', { lure: lure('aurora'), timeIndex: 1 });
  assert.ok(aurora.rare > worm.rare * 1.5, `レア率が上がっていない ${worm.rare} → ${aurora.rare}`);
  assert.ok(aurora.junk < worm.junk, `ゴミ率が下がっていない ${worm.junk} → ${aurora.junk}`);
});

test('夜のほうがレアが出やすい', () => {
  const noon = rarityRate('river', { lure: lure('worm'), timeIndex: 1 });
  const night = rarityRate('river', { lure: lure('worm'), timeIndex: 3 });
  assert.equal(timeAt(1).id, 'noon');
  assert.equal(timeAt(3).id, 'night');
  assert.ok(night.rare > noon.rare, `夜のレア率が上がっていない ${noon.rare} → ${night.rare}`);
});

test('timeAt は範囲外でも一周して返す', () => {
  assert.equal(timeAt(0).id, 'morning');
  assert.equal(timeAt(4).id, 'morning');
  assert.equal(timeAt(-1).id, 'night');
});

test('弱い竿では強すぎる魚が掛かりにくい', () => {
  const count = (rodId) => {
    const rng = mulberry32(5);
    let strong = 0;
    for (let i = 0; i < 3000; i++) {
      const { fish } = pickFish('sea', { rng, rod: rod(rodId), lure: lure('worm') });
      if (fish.power >= 5) strong++;
    }
    return strong;
  };
  assert.ok(count('nobe') < count('legend'), '竿による掛かりやすさの差がない');
});

// ------------------------------------------------------------------ 値段

test('同じ魚なら大きいほど高く売れる', () => {
  for (const f of FISH) {
    const small = priceOf(f, f.weight[0]);
    const big = priceOf(f, f.weight[1]);
    assert.ok(big > small, `${f.name}: 大きくても高くならない`);
    assert.equal(priceOf(f, f.weight[0] - 99), small, '範囲外は最小値に丸める');
    assert.equal(priceOf(f, f.weight[1] + 99), big, '範囲外は最大値に丸める');
  }
});

test('レア度が高いほど単価が高い', () => {
  const funa = fishById('funa');
  const nushi = fishById('nushi');
  assert.ok(priceOf(nushi, nushi.weight[0]) > priceOf(funa, funa.weight[1]));
});

test('アタリまでの時間は正で、良いルアーほど短い', () => {
  const avg = (lureId) => {
    const rng = mulberry32(11);
    let sum = 0;
    for (let i = 0; i < 500; i++) sum += biteDelay(rng, { lure: lure(lureId), timeIndex: 1 });
    return sum / 500;
  };
  const slow = avg('worm');
  const fast = avg('aurora');
  assert.ok(slow > 0 && fast > 0);
  assert.ok(fast < slow, `アタリが速くなっていない ${slow} → ${fast}`);
});

// ------------------------------------------------------------------ ファイト

/** バーを魚に合わせ続ける「うまいプレイヤー」。 */
function simulate(fight, controller, maxSeconds = 60) {
  const dt = 1 / 60;
  for (let t = 0; t < maxSeconds; t += dt) {
    const phase = fight.update(dt, controller(fight));
    if (phase !== FIGHT.fighting) return phase;
  }
  return FIGHT.fighting;
}

const chase = (f) => f.barY > f.fishY;   // 魚より下にいたら巻いて上げる

test('魚を追いかけ続ければ釣れる', () => {
  for (const fishId of ['funa', 'bass', 'iwana', 'tai', 'kinmedai']) {
    const fight = new Fight({
      fish: fishById(fishId), rod: rod('offshore'), sizeRatio: 0.5, rng: mulberry32(3),
    });
    assert.equal(simulate(fight, chase), FIGHT.caught, `${fishId}が釣れない`);
  }
});

test('何もしなければ逃げられる', () => {
  const fight = new Fight({
    fish: fishById('bass'), rod: rod('nobe'), sizeRatio: 0.5, rng: mulberry32(8),
  });
  assert.equal(simulate(fight, () => false, 20), FIGHT.escaped);
});

test('竿が負けているとラインが切れる', () => {
  const fight = new Fight({
    fish: fishById('kajiki'), rod: rod('nobe'), sizeRatio: 0.8, rng: mulberry32(4),
  });
  assert.equal(simulate(fight, chase, 20), FIGHT.snapped);
});

test('強い竿ならライン負荷がたまらない', () => {
  const fight = new Fight({
    fish: fishById('buri'), rod: rod('legend'), sizeRatio: 0.5, rng: mulberry32(6),
  });
  assert.equal(simulate(fight, chase), FIGHT.caught);
  assert.equal(fight.strain, 0);
});

test('決着がついたらそれ以上進まない', () => {
  const fight = new Fight({
    fish: fishById('funa'), rod: rod('legend'), sizeRatio: 0.2, rng: mulberry32(1),
  });
  assert.equal(simulate(fight, chase), FIGHT.caught);
  const before = fight.progress;
  assert.equal(fight.update(1, false), FIGHT.caught);
  assert.equal(fight.progress, before);
});

test('ファイト中の値は常に 0..1 に収まる', () => {
  const fight = new Fight({
    fish: fishById('ito'), rod: rod('carbon'), sizeRatio: 1, rng: mulberry32(12),
  });
  const dt = 1 / 60;
  for (let i = 0; i < 1200; i++) {
    if (fight.update(dt, i % 17 < 8) !== FIGHT.fighting) break;
    for (const key of ['barY', 'fishY', 'progress', 'strain']) {
      assert.ok(fight[key] >= 0 && fight[key] <= 1, `${key} が範囲外: ${fight[key]}`);
    }
    assert.ok(fight.barTop >= 0 && fight.barBottom <= 1);
  }
});

test('大きい個体ほど強くて速い', () => {
  const small = new Fight({ fish: fishById('buri'), rod: rod('legend'), sizeRatio: 0 });
  const big = new Fight({ fish: fishById('buri'), rod: rod('legend'), sizeRatio: 1 });
  assert.ok(big.power > small.power);
  assert.ok(big.speed > small.speed);
});

// ------------------------------------------------------------------ お金と持ち物

test('はじまりは所持金 0・のべ竿・ミミズ・池', () => {
  const p = createPlayer();
  assert.equal(p.money, 0);
  assert.equal(equippedRod(p).id, 'nobe');
  assert.equal(equippedLure(p).id, 'worm');
  assert.equal(p.spot, 'pond');
});

test('お金が足りないと買えない', () => {
  const p = createPlayer();
  const res = buy(p, 'rod', 'legend');
  assert.equal(res.ok, false);
  assert.match(res.error, /足りません/);
  assert.equal(p.money, 0);
  assert.equal(owns(p, 'rod', 'legend'), false);
});

test('買うと所持金が減り、そのまま装備される', () => {
  const p = createPlayer({ money: 5000 });
  const res = buy(p, 'rod', 'carbon');
  assert.equal(res.ok, true);
  assert.equal(p.money, 5000 - rod('carbon').price);
  assert.equal(p.rod, 'carbon');
  assert.ok(owns(p, 'rod', 'carbon'));
  assert.equal(buy(p, 'rod', 'carbon').ok, false, '二重購入できてしまう');
});

test('釣り場も買えて、買うとそこへ移動する', () => {
  const p = createPlayer({ money: 2000 });
  assert.equal(buy(p, 'spot', 'river').ok, true);
  assert.equal(p.spot, 'river');
  assert.equal(buy(p, 'spot', 'sea').ok, false, '所持金以上に買えてしまう');
});

test('持っていない道具は装備できない', () => {
  const p = createPlayer();
  assert.equal(equip(p, 'lure', 'jig'), false);
  assert.equal(p.lure, 'worm');
  p.lures.push('jig');
  assert.equal(equip(p, 'lure', 'jig'), true);
  assert.equal(p.lure, 'jig');
});

test('存在しない商品を買おうとしても壊れない', () => {
  const p = createPlayer({ money: 99999 });
  assert.equal(buy(p, 'rod', 'nothing').ok, false);
  assert.equal(buy(p, 'nothing', 'nobe').ok, false);
  assert.equal(p.money, 99999);
});

test('売ると所持金と売上が増える', () => {
  const p = createPlayer();
  const rng = mulberry32(21);
  const result = pickFish('pond', { rng, rod: rod('nobe'), lure: lure('worm') });
  sell(p, result);
  assert.equal(p.money, result.price);
  assert.equal(p.earned, result.price);
});

// ------------------------------------------------------------------ 図鑑

test('図鑑は初登録と自己ベスト更新のときだけ true', () => {
  const p = createPlayer();
  const funa = fishById('funa');
  const make = (kg) => ({ fish: funa, weightKg: kg, lengthCm: 20, price: priceOf(funa, kg) });

  assert.equal(recordCatch(p, make(0.5)), true, '初登録で true にならない');
  assert.equal(recordCatch(p, make(0.3)), false, '小さいのに更新扱いになる');
  assert.equal(recordCatch(p, make(0.9)), true, '大物なのに更新されない');
  assert.equal(p.records.funa.count, 3);
  assert.equal(p.records.funa.weightKg, 0.9);
  assert.equal(p.catches, 3);
});

test('図鑑の進捗は釣り場ごとに数える', () => {
  const p = createPlayer();
  const before = collectionProgress(p, 'pond');
  assert.equal(before.found, 0);
  assert.equal(before.total, fishOfSpot('pond').length);
  recordCatch(p, { fish: fishById('funa'), weightKg: 0.5, lengthCm: 20, price: 10 });
  assert.equal(collectionProgress(p, 'pond').found, 1);
  assert.equal(collectionProgress(p, 'sea').found, 0);
});

test('サイズの称号は大物と小物だけにつく', () => {
  assert.equal(sizeTitle(0.5), null);
  assert.equal(sizeTitle(0.95).tone, 'huge');
  assert.equal(sizeTitle(0.75).tone, 'big');
  assert.equal(sizeTitle(0.05).tone, 'small');
});

// ------------------------------------------------------------------ セーブデータ

test('壊れたセーブデータでも遊べる形に直す', () => {
  const p = normalizePlayer({
    money: -50,
    rods: ['nobe', 'ghost-rod'],
    lures: 'ミミズ',
    spots: ['deep'],
    rod: 'ghost-rod',
    lure: 'jig',
    spot: 'mars',
    records: { funa: { count: 2, weightKg: 1, lengthCm: 30, price: 100 }, ghost: { count: 1 } },
    casts: 'たくさん',
  });
  assert.equal(p.money, 0);
  assert.deepEqual(p.rods, ['nobe']);
  assert.deepEqual(p.lures, ['worm']);
  assert.ok(p.spots.includes('pond') && p.spots.includes('deep'));
  assert.ok(p.rods.includes(p.rod), '持っていない竿を装備している');
  assert.ok(p.lures.includes(p.lure), '持っていないルアーを装備している');
  assert.ok(p.spots.includes(p.spot), '行けない釣り場にいる');
  assert.equal(p.casts, 0);
  assert.ok(p.records.funa);
  assert.equal(p.records.ghost, undefined, '存在しない魚が図鑑に残っている');
});

test('セーブデータが無くても初期状態になる', () => {
  for (const raw of [null, undefined, 'こわれた', 42]) {
    const p = normalizePlayer(raw);
    assert.equal(p.money, 0);
    assert.equal(p.rod, 'nobe');
  }
});

test('JSON を通しても状態が変わらない', () => {
  const p = createPlayer({ money: 1234 });
  buy(p, 'rod', 'glass');
  recordCatch(p, { fish: fishById('funa'), weightKg: 0.8, lengthCm: 28, price: 120 });
  const round = normalizePlayer(JSON.parse(JSON.stringify(p)));
  assert.deepEqual(round.rods, p.rods);
  assert.equal(round.money, p.money);
  assert.deepEqual(round.records, p.records);
});

// ------------------------------------------------------------------ 進行のバランス

test('池だけで遊んでいても、すぐ次の釣り場に行ける', () => {
  const rng = mulberry32(4242);
  const p = createPlayer();
  let casts = 0;
  const river = SPOTS.find((s) => s.id === 'river');
  while (p.money < river.price && casts < 15) {
    casts++;
    const result = pickFish('pond', { rng, rod: rod('nobe'), lure: lure('worm'), timeIndex: casts });
    if (result.fish.power > rod('nobe').power + 1) continue;   // 取り込めない魚は数えない
    sell(p, result);
  }
  assert.ok(p.money >= river.price, `15回釣っても渓流に行けない（${p.money}円 / ${river.price}円）`);
});

test('釣り場は 8 か所あって、順番に値段が上がる', () => {
  assert.equal(SPOTS.length, 8);
  assert.deepEqual(SPOTS.map((s) => s.id),
    ['pond', 'river', 'harbor', 'ice', 'sea', 'island', 'cave', 'deep']);
});

test('魚は全部で 75 種以上いて、どの釣り場にも 7 種以上いる', () => {
  assert.ok(FISH.length >= 75, `魚が少ない（${FISH.length} 種）`);
  for (const spot of SPOTS) {
    const list = fishOfSpot(spot.id);
    assert.ok(list.length >= 7, `${spot.name}の魚が少ない（${list.length} 種）`);
    assert.ok(list.some((f) => f.rarity === 'legendary'), `${spot.name}に伝説の魚がいない`);
    assert.ok(list.some((f) => f.junk), `${spot.name}にゴミがない`);
  }
});

test('奥の釣り場ほど魚の値段が高い', () => {
  const median = (spotId) => {
    const values = fishOfSpot(spotId).filter((f) => !f.junk).map((f) => f.value).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)];
  };
  const order = SPOTS.map((s) => median(s.id));
  for (let i = 1; i < order.length; i++) {
    assert.ok(order[i] > order[i - 1], `${SPOTS[i].name}の魚が前の釣り場より安い（${order[i - 1]} → ${order[i]}）`);
  }
});

test('ルアーの得意な釣り場は実在する釣り場を指している', () => {
  for (const l of LURES) {
    for (const id of Object.keys(l.spotBonus || {})) {
      assert.ok(SPOTS.some((s) => s.id === id), `${l.name}: 知らない釣り場 ${id}`);
    }
  }
});

test('のべ竿とミミズでも池なら稼げて、最初の竿に手が届く', () => {
  const rng = mulberry32(777);
  const p = createPlayer();
  for (let i = 0; i < 40; i++) {
    const result = pickFish('pond', { rng, rod: rod('nobe'), lure: lure('worm'), timeIndex: i });
    // 竿に対して強すぎる魚は取り込めないものとして数えない
    if (result.fish.power > rod('nobe').power + 1) continue;
    sell(p, result);
  }
  assert.ok(p.money >= RODS[1].price, `40回釣っても次の竿が買えない（${p.money}円）`);
});

// ------------------------------------------------------------------ 道具

const withGear = (...ids) => gearEffects({ gears: ids });

test('道具のデータが壊れていない', () => {
  const ids = GEAR.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length, 'ID が重複している');
  assert.ok(GEAR.length >= 8, `道具が少ない（${GEAR.length} 個）`);
  for (const g of GEAR) {
    assert.ok(g.price > 0, `${g.name}: 値段がおかしい`);
    assert.ok(g.name && g.note && g.emoji, `${g.name}: 表示用の値が欠けている`);
    const effects = Object.entries(g.effects ?? {});
    assert.ok(effects.length > 0, `${g.name}: 効果がない`);
    for (const [key, value] of effects) {
      assert.ok(key in NO_GEAR, `${g.name}: 知らない効果 ${key}`);
      assert.ok(value > 0, `${g.name}: ${key} が正の値でない`);
    }
  }
  for (let i = 1; i < GEAR.length; i++) {
    assert.ok(GEAR[i].price > GEAR[i - 1].price, `${GEAR[i].name}の値段が前より安い`);
  }
});

test('道具を持っていなければ効果はゼロ', () => {
  assert.deepEqual(gearEffects(createPlayer()), NO_GEAR);
  assert.deepEqual(gearEffects(null), NO_GEAR);
  assert.deepEqual(withGear('knowniot'), NO_GEAR, '知らない道具は無視する');
});

test('道具の効果は足し算で重なる', () => {
  const one = withGear('cooler');
  const both = withGear('cooler', 'charm');
  assert.equal(one.sell, gearById('cooler').effects.sell);
  assert.equal(both.sell, gearById('cooler').effects.sell + gearById('charm').effects.sell);
  assert.equal(both.rarityBonus, gearById('charm').effects.rarityBonus);
});

test('クーラーボックスがあると高く売れる', () => {
  const draw = (gear) => {
    const rng = mulberry32(1234);
    return pickFish('pond', { rng, rod: rod('nobe'), lure: lure('worm'), gear });
  };
  const plain = draw(NO_GEAR);
  const cooled = draw(withGear('cooler'));
  assert.equal(plain.fish.id, cooled.fish.id, '前提：同じ魚が釣れること');
  assert.ok(cooled.price > plain.price, `高くなっていない ${plain.price} → ${cooled.price}`);
  assert.equal(cooled.price, Math.round(plain.price * 1.12));
});

test('お守りでレアが出やすくなる', () => {
  const rate = (gear) => {
    const rng = mulberry32(77);
    let rare = 0;
    for (let i = 0; i < 4000; i++) {
      const { fish } = pickFish('sea', { rng, rod: rod('legend'), lure: lure('worm'), gear, timeIndex: 1 });
      if (['rare', 'epic', 'legendary'].includes(fish.rarity)) rare++;
    }
    return rare;
  };
  assert.ok(rate(withGear('charm')) > rate(NO_GEAR), 'レア率が上がっていない');
});

test('魚群探知機でゴミが減る', () => {
  const junk = (gear) => {
    const rng = mulberry32(55);
    let count = 0;
    for (let i = 0; i < 3000; i++) {
      const { fish } = pickFish('harbor', { rng, rod: rod('carbon'), lure: lure('worm'), gear });
      if (fish.junk) count++;
    }
    return count;
  };
  assert.ok(junk(withGear('sonar')) < junk(NO_GEAR), 'ゴミ率が下がっていない');
});

test('コマセバケツでアタリが早くなる', () => {
  const avg = (gear) => {
    const rng = mulberry32(9);
    let sum = 0;
    for (let i = 0; i < 400; i++) sum += biteDelay(rng, { lure: lure('worm'), timeIndex: 1, gear });
    return sum / 400;
  };
  assert.ok(avg(withGear('chum')) < avg(NO_GEAR), 'アタリが早くなっていない');
});

test('偏光グラスで合わせの猶予が伸びる', () => {
  assert.ok(hookWindow(withGear('glasses')) > hookWindow(NO_GEAR));
  assert.equal(hookWindow(withGear('glasses')), hookWindow(NO_GEAR) + 0.45);
  assert.equal(hookWindow(), hookWindow(NO_GEAR), '既定は効果なしと同じ');
});

test('道具は竿の性能に上乗せされる', () => {
  const base = new Fight({ fish: fishById('buri'), rod: rod('nobe'), sizeRatio: 0.5 });
  const geared = new Fight({
    fish: fishById('buri'), rod: rod('nobe'), sizeRatio: 0.5,
    gear: withGear('ereel', 'spool', 'bignet', 'net'),
  });
  assert.ok(geared.rod.reel > base.rod.reel, '寄せ速度が上がっていない');
  assert.ok(geared.rod.line > base.rod.line, 'ライン強度が上がっていない');
  assert.ok(geared.barH > base.barH, 'バーが広がっていない');
  assert.ok(geared.escapeRate < base.escapeRate, '逃げ足が落ちていない');
  // 元の竿のデータは書き換えない
  assert.equal(rod('nobe').reel, 0.42);
});

test('タモ網があると逃げられにくい', () => {
  const run = (gear) => {
    const fight = new Fight({
      fish: fishById('bass'), rod: rod('nobe'), sizeRatio: 0.5, rng: mulberry32(8), gear,
    });
    return simulate(fight, () => false, 30);
  };
  const plain = new Fight({
    fish: fishById('bass'), rod: rod('nobe'), sizeRatio: 0.5, rng: mulberry32(8),
  });
  const netted = new Fight({
    fish: fishById('bass'), rod: rod('nobe'), sizeRatio: 0.5, rng: mulberry32(8), gear: withGear('net'),
  });
  assert.ok(netted.escapeRate < plain.escapeRate);
  assert.equal(run(NO_GEAR), FIGHT.escaped, '前提：何もしなければ逃げられる');
});

test('道具は買えるが、付け替えはない', () => {
  const p = createPlayer({ money: 5000 });
  assert.equal(buy(p, 'gear', 'cooler').ok, true);
  assert.equal(p.money, 5000 - gearById('cooler').price);
  assert.ok(owns(p, 'gear', 'cooler'));
  assert.equal(buy(p, 'gear', 'cooler').ok, false, '二重購入できてしまう');
  assert.equal(equip(p, 'gear', 'cooler'), false, '道具に装備の概念はない');
  assert.equal(buy(p, 'gear', 'charm').ok, false, '所持金以上に買えてしまう');
});

test('道具もセーブデータに残り、知らないものは捨てる', () => {
  const p = createPlayer({ money: 99999 });
  buy(p, 'gear', 'cooler');
  buy(p, 'gear', 'net');
  const round = normalizePlayer(JSON.parse(JSON.stringify(p)));
  assert.deepEqual(round.gears, ['cooler', 'net']);
  assert.deepEqual(normalizePlayer({ gears: ['cooler', 'ghost'] }).gears, ['cooler']);
  assert.deepEqual(normalizePlayer({ gears: 'クーラー' }).gears, []);
  assert.deepEqual(normalizePlayer({}).gears, []);
});

// ------------------------------------------------------------------ 天気

test('天気のデータが壊れていない', () => {
  const ids = WEATHERS.map((w) => w.id);
  assert.equal(new Set(ids).size, ids.length, 'ID が重複している');
  assert.ok(WEATHERS.length >= 5, `天気が少ない（${WEATHERS.length} 種）`);
  for (const w of WEATHERS) {
    assert.ok(w.weight > 0, `${w.label}: 出現の重みがない`);
    assert.ok(w.label && w.emoji && w.note, `${w.label}: 表示用の値が欠けている`);
    assert.ok(w.stress >= 0 && w.stress <= 1, `${w.label}: ラインへの負荷が範囲外`);
  }
  assert.equal(weatherById('sunny').id, 'sunny');
  assert.equal(weatherById('しらない天気').id, 'sunny', '知らない天気は晴れに倒す');
});

test('天気は数投ごとに変わり、しばらく続く', () => {
  const rng = mulberry32(21);
  const p = createPlayer();
  const [min, max] = WEATHER_SPAN;

  const first = advanceWeather(p, rng);
  assert.equal(first.changed, true, '最初のキャストで天気が決まらない');
  assert.ok(p.weatherLeft >= min && p.weatherLeft <= max, `持ちが範囲外: ${p.weatherLeft}`);

  // 持ちが尽きるまでは変わらない（残り回数は先に控えておく）
  const id = p.weather;
  const remaining = p.weatherLeft - 1;
  let changes = 0;
  for (let i = 0; i < remaining; i++) {
    if (advanceWeather(p, rng).changed) changes++;
  }
  assert.equal(changes, 0, '持ちが残っているのに天気が変わった');
  assert.equal(p.weather, id);
  assert.equal(advanceWeather(p, rng).changed, true, '持ちが尽きても変わらない');
});

test('長く続ければどの天気も出る', () => {
  const rng = mulberry32(5);
  const p = createPlayer();
  const seen = new Set();
  for (let i = 0; i < 600; i++) seen.add(advanceWeather(p, rng).weather.id);
  for (const w of WEATHERS) assert.ok(seen.has(w.id), `${w.label}が一度も出ない`);
});

test('雨はアタリが早く、霧はレアが出やすい', () => {
  const avgDelay = (weather) => {
    const rng = mulberry32(31);
    let sum = 0;
    for (let i = 0; i < 400; i++) sum += biteDelay(rng, { lure: lure('worm'), timeIndex: 1, weather });
    return sum / 400;
  };
  assert.ok(avgDelay(weatherById('rain')) < avgDelay(weatherById('sunny')), '雨でアタリが早くなっていない');

  const rareRate = (weather) => {
    const rng = mulberry32(64);
    let rare = 0;
    for (let i = 0; i < 4000; i++) {
      const { fish } = pickFish('sea', { rng, rod: rod('legend'), lure: lure('worm'), weather, timeIndex: 1 });
      if (['rare', 'epic', 'legendary'].includes(fish.rarity)) rare++;
    }
    return rare;
  };
  assert.ok(rareRate(weatherById('fog')) > rareRate(weatherById('sunny')), '霧でレアが増えていない');
});

test('嵐はラインが切れやすい', () => {
  const strainAfter = (weather) => {
    const fight = new Fight({
      fish: fishById('buri'), rod: rod('nobe'), sizeRatio: 0.8, rng: mulberry32(12), weather,
    });
    for (let i = 0; i < 30; i++) fight.update(1 / 60, true);
    return fight.strain;
  };
  assert.ok(strainAfter(weatherById('storm')) > strainAfter(weatherById('sunny')), '嵐で負荷が増えていない');
  assert.equal(new Fight({ fish: fishById('buri'), rod: rod('nobe') }).stress, 1, '天気なしなら負荷は等倍');
});

test('天気はセーブされ、壊れていれば晴れに戻す', () => {
  const p = createPlayer();
  advanceWeather(p, mulberry32(3));
  const round = normalizePlayer(JSON.parse(JSON.stringify(p)));
  assert.equal(round.weather, p.weather);
  assert.equal(round.weatherLeft, p.weatherLeft);
  assert.equal(normalizePlayer({ weather: '大雪' }).weather, 'sunny');
  assert.equal(normalizePlayer({ weatherLeft: 999 }).weatherLeft, 20, '長すぎる持ちは丸める');
});

// ------------------------------------------------------------------ できごと

test('できごとのデータが壊れていない', () => {
  for (const event of Object.values(EVENTS)) {
    assert.ok(event.chance > 0 && event.chance < 0.5, `${event.label}: 起きる確率が極端`);
    assert.ok(event.casts >= 1, `${event.label}: 続くキャスト数がおかしい`);
    assert.ok(event.label && event.emoji && event.start && event.end);
  }
});

test('できごとはたまに起きるが、起きている最中は引かない', () => {
  const rng = mulberry32(2);
  let hits = 0;
  for (let i = 0; i < 2000; i++) if (rollEvent(rng)) hits++;
  assert.ok(hits > 0, '一度も起きない');
  assert.ok(hits < 2000 * 0.3, `起きすぎ（${hits} / 2000）`);
  assert.equal(rollEvent(() => 0, { active: { event: EVENTS.fever } }), null, '重ねて起きてしまう');
});

test('できごとはキャストのたびに減って、終わる', () => {
  let state = { event: EVENTS.fever, left: 2 };
  state = tickEvent(state);
  assert.equal(state.left, 1);
  assert.equal(tickEvent(state), null, '終わらない');
  assert.equal(tickEvent(null), null);
});

test('大漁タイムはアタリが早くレアが出やすい', () => {
  const rng = mulberry32(41);
  let plain = 0;
  let fever = 0;
  for (let i = 0; i < 300; i++) {
    plain += biteDelay(rng, { lure: lure('worm'), timeIndex: 1 });
    fever += biteDelay(rng, { lure: lure('worm'), timeIndex: 1, event: EVENTS.fever });
  }
  assert.ok(fever < plain, 'アタリが早くなっていない');
  assert.ok(EVENTS.fever.rarityBonus > 0);
});

test('ヌシの気配ではレア以上しか掛からない', () => {
  const rng = mulberry32(17);
  for (const spot of SPOTS) {
    for (let i = 0; i < 60; i++) {
      const { fish } = pickFish(spot.id, {
        rng, rod: rod('legend'), lure: lure('worm'), event: EVENTS.nushi,
      });
      assert.ok(['rare', 'epic', 'legendary'].includes(fish.rarity),
        `${spot.name}で ${fish.name}（${fish.rarity}）が出た`);
      assert.ok(!fish.junk, `${spot.name}でゴミが出た`);
    }
  }
});

// ------------------------------------------------------------------ ヌシ（ボス）

test('どの釣り場にもヌシが 1 体ずついる', () => {
  const bosses = FISH.filter((f) => f.boss);
  assert.equal(bosses.length, SPOTS.length, `ヌシの数が釣り場の数と合わない（${bosses.length}）`);
  for (const spot of SPOTS) {
    const list = fishOfSpot(spot.id).filter((f) => f.boss);
    assert.equal(list.length, 1, `${spot.name}のヌシが ${list.length} 体`);
    const boss = list[0];
    assert.equal(boss.rarity, 'legendary', `${boss.name}が伝説になっていない`);
    assert.ok(boss.title && boss.tale, `${boss.name}に二つ名か言い伝えがない`);
    assert.ok(boss.power >= 4, `${boss.name}が弱すぎる`);
  }
});

test('ヌシは半分まで寄せると暴れ出す', () => {
  const boss = FISH.find((f) => f.boss);
  const fight = new Fight({ fish: boss, rod: rod('legend'), sizeRatio: 0.5, rng: mulberry32(3) });
  assert.equal(fight.boss, true);
  assert.equal(fight.enraged, false);
  const speed = fight.speed;
  const escape = fight.escapeRate;

  let sawSignal = 0;
  let phase = FIGHT.fighting;
  for (let i = 0; i < 60 * 60 && phase === FIGHT.fighting; i++) {
    phase = fight.update(1 / 60, fight.barY > fight.fishY);
    if (fight.justEnraged) {
      sawSignal++;
      assert.ok(fight.progress >= Fight.ENRAGE_AT, '半分も寄せていないのに暴れ出した');
    }
  }
  assert.equal(sawSignal, 1, '暴れ出す合図が 1 回だけ出ていない');
  assert.equal(fight.enraged, true);
  assert.ok(fight.speed > speed, '暴れても速くなっていない');
  assert.ok(fight.escapeRate > escape, '暴れても逃げ足が変わらない');
});

test('ふつうの魚は暴れない', () => {
  const fight = new Fight({ fish: fishById('funa'), rod: rod('legend'), sizeRatio: 1, rng: mulberry32(4) });
  assert.equal(fight.boss, false);
  let phase = FIGHT.fighting;
  for (let i = 0; i < 60 * 60 && phase === FIGHT.fighting; i++) {
    phase = fight.update(1 / 60, fight.barY > fight.fishY);
    assert.equal(fight.justEnraged, false);
  }
  assert.equal(fight.enraged, false);
});

// ------------------------------------------------------------------ お札

test('お札のデータが壊れていない', () => {
  const ids = CHARMS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'ID が重複している');
  for (const c of CHARMS) {
    assert.ok(c.price > 0 && c.casts >= 1, `${c.name}: 値段か効く長さがおかしい`);
    assert.ok(c.name && c.emoji && c.note, `${c.name}: 表示用の値が欠けている`);
    assert.ok(Object.keys(c.effect ?? {}).length > 0, `${c.name}: 効果がない`);
  }
  for (let i = 1; i < CHARMS.length; i++) {
    assert.ok(CHARMS[i].price > CHARMS[i - 1].price, `${CHARMS[i].name}の値段が前より安い`);
  }
});

test('お札は何枚でも買えて、使うと減る', () => {
  const p = createPlayer({ money: 10000 });
  assert.equal(charmCount(p, 'chumball'), 0);

  const res = buyCharm(p, 'chumball', 3);
  assert.equal(res.ok, true);
  assert.equal(p.money, 10000 - charmById('chumball').price * 3);
  assert.equal(charmCount(p, 'chumball'), 3);

  assert.equal(useCharm(p, 'chumball').id, 'chumball');
  assert.equal(charmCount(p, 'chumball'), 2);
  assert.equal(useCharm(p, 'ghost'), null, '知らないお札が使えてしまう');
  assert.equal(useCharm(p, 'lucky'), null, '持っていないお札が使えてしまう');
  assert.equal(buyCharm(p, 'boss', 1).ok, false, '所持金以上に買えてしまう');
  assert.equal(buyCharm(p, 'ghost').ok, false);
});

test('幸運の札でレアが出やすくなる', () => {
  const rate = (charm) => {
    const rng = mulberry32(88);
    let rare = 0;
    for (let i = 0; i < 3000; i++) {
      const { fish } = pickFish('river', { rng, rod: rod('legend'), lure: lure('worm'), charm, timeIndex: 1 });
      if (['rare', 'epic', 'legendary'].includes(fish.rarity)) rare++;
    }
    return rare;
  };
  assert.ok(rate(charmById('lucky').effect) > rate(null), 'レア率が上がっていない');
});

test('撒き餌の玉でアタリが早くなる', () => {
  const avg = (charm) => {
    const rng = mulberry32(6);
    let sum = 0;
    for (let i = 0; i < 400; i++) sum += biteDelay(rng, { lure: lure('worm'), timeIndex: 1, charm });
    return sum / 400;
  };
  assert.ok(avg(charmById('chumball').effect) < avg(null), 'アタリが早くなっていない');
});

test('ヌシの札を使うとヌシが掛かりやすい', () => {
  const charm = charmById('boss').effect;
  for (const spotId of ['pond', 'sea', 'deep']) {
    const rng = mulberry32(9);
    let boss = 0;
    for (let i = 0; i < 400; i++) {
      const { fish } = pickFish(spotId, { rng, rod: rod('legend'), lure: lure('worm'), charm });
      assert.ok(['epic', 'legendary'].includes(fish.rarity), `${fish.name} が掛かった`);
      if (fish.boss) boss++;
    }
    assert.ok(boss > 400 * 0.2, `${spotId}: ヌシが出なさすぎる（${boss} / 400）`);
    assert.ok(boss < 400 * 0.9, `${spotId}: ヌシが出すぎ（${boss} / 400）`);
  }
});

test('安全ピンの札を使うとラインが切れない', () => {
  const run = (charm) => {
    const fight = new Fight({
      fish: fishById('kajiki'), rod: rod('nobe'), sizeRatio: 0.8, rng: mulberry32(4), charm,
    });
    return simulate(fight, chase, 20);
  };
  assert.equal(run(null), FIGHT.snapped, '前提：ふだんは切れること');
  assert.notEqual(run(charmById('safety').effect), FIGHT.snapped, 'お札を使っても切れた');
});

test('お札はセーブされ、おかしな枚数は直される', () => {
  const p = createPlayer({ money: 50000 });
  buyCharm(p, 'lucky', 2);
  const round = normalizePlayer(JSON.parse(JSON.stringify(p)));
  assert.equal(charmCount(round, 'lucky'), 2);
  assert.deepEqual(normalizePlayer({ charms: { ghost: 3 } }).charms, {});
  assert.deepEqual(normalizePlayer({ charms: { lucky: -5 } }).charms, {});
  assert.deepEqual(normalizePlayer({ charms: { lucky: 999 } }).charms, { lucky: 99 });
  assert.deepEqual(normalizePlayer({}).charms, {});
});

// ------------------------------------------------------------------ 表示

test('所持金は狭い画面向けに桁を詰める', () => {
  assert.equal(shortMoney(0, true), '0');
  assert.equal(shortMoney(9999, true), '9,999');
  assert.equal(shortMoney(10000, true), '1.0万');
  assert.equal(shortMoney(12345, true), '1.2万');
  assert.equal(shortMoney(999999, true), '99.9万', '切り上げて多く見せない');
  assert.equal(shortMoney(99999999, true), '9,999万');
  assert.equal(shortMoney(123456789, true), '1.23億');
  // 広い画面ではそのまま
  assert.equal(shortMoney(1234567, false), '1,234,567');
});
