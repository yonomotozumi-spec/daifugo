import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FIGHT, FISH, LURES, RARITY, RODS, SPOTS,
  Fight, biteDelay, buy, collectionProgress, createPlayer, equip,
  equippedLure, equippedRod, fishById, fishOfSpot, mulberry32, normalizePlayer,
  owns, pickFish, priceOf, recordCatch, sell, sizeTitle, timeAt, weightedPick,
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

test('釣り場は 6 か所あって、値段が段階的に上がる', () => {
  assert.equal(SPOTS.length, 6);
  assert.deepEqual(SPOTS.map((s) => s.id), ['pond', 'river', 'harbor', 'sea', 'island', 'deep']);
});

test('魚は全部で 55 種以上いて、どの釣り場にも 7 種以上いる', () => {
  assert.ok(FISH.length >= 55, `魚が少ない（${FISH.length} 種）`);
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
