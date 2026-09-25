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
  MAX_POWER, isHardSpot, spotById, spotHazard, spotLocked,
  ACHIEVEMENTS, DAILY_COUNT, DAILY_KINDS, MAX_RANK, RANKS, SHINY,
  achievementById, achievementState, checkAchievements, dailyProgress, earnedTitles,
  gainXp, progressDaily, rankAt, rankEffects, rankOf, rankProgress, refreshDaily,
  rollDailies, setTitle, shinyKinds, todayKey, totalEffects, xpFor,
  SAVE_FORMAT, SAVE_VERSION, TUTORIAL, advanceTutorial, exportSave, importSave,
  saveSummary, tutorialStep, HAPTICS, hapticFor,
} from '../src/engine.js';
import { SOUND_NAMES, sound } from '../src/sound.js';

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
    assert.ok(f.power >= 1 && f.power <= MAX_POWER, `${f.name}: パワーが範囲外`);
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

test('釣り場は 11 か所あって、順番に値段が上がる', () => {
  assert.equal(SPOTS.length, 11);
  assert.deepEqual(SPOTS.map((s) => s.id),
    ['pond', 'river', 'harbor', 'ice', 'sea', 'island', 'cave', 'deep', 'ruin', 'crater', 'abyss']);
});

test('魚は全部で 105 種以上いて、どの釣り場にも 7 種以上いる', () => {
  assert.ok(FISH.length >= 105, `魚が少ない（${FISH.length} 種）`);
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

// ------------------------------------------------------------------ 難所（高難度の釣り場）

const HARD_IDS = ['ruin', 'crater', 'abyss'];
const hardSpots = () => HARD_IDS.map((id) => spotById(id));

test('難所は 3 か所あって、ひとつ前のヌシが鍵になっている', () => {
  const hard = SPOTS.filter(isHardSpot);
  assert.deepEqual(hard.map((s) => s.id), HARD_IDS);
  const keys = ['coelacanth', 'wadatsumi', 'enrin'];
  hard.forEach((spot, i) => {
    assert.equal(spot.require, keys[i], `${spot.name}の鍵がちがう`);
    const key = fishById(spot.require);
    assert.ok(key?.boss, `${spot.name}の鍵がヌシではない`);
    // ひとつ前の釣り場のヌシであること
    const prev = SPOTS[SPOTS.indexOf(spot) - 1];
    assert.equal(key.spot, prev.id, `${spot.name}の鍵が ${prev.name} のヌシではない`);
  });
});

test('難所は奥ほど荒れていて、ふつうの釣り場には補正がない', () => {
  for (const spot of SPOTS.filter((s) => !isHardSpot(s))) {
    const h = spotHazard(spot);
    assert.deepEqual(h, { stress: 0, drift: 0, fishSpeed: 1, biteBonus: 0, tough: 1 },
      `${spot.name}に補正がついている`);
  }
  const hard = hardSpots().map(spotHazard);
  for (let i = 1; i < hard.length; i++) {
    assert.ok(hard[i].stress > hard[i - 1].stress, '奥の難所のほうが負荷が軽い');
    assert.ok(hard[i].drift > hard[i - 1].drift, '奥の難所のほうが流れがゆるい');
    assert.ok(hard[i].fishSpeed > hard[i - 1].fishSpeed, '奥の難所の魚のほうが遅い');
    assert.ok(hard[i].biteBonus < hard[i - 1].biteBonus, '奥の難所のほうがアタリが早い');
    assert.ok(hard[i].tough > hard[i - 1].tough, '奥の難所の魚のほうが軽い');
  }
});

test('難所はヌシを釣るまで買えない', () => {
  const p = createPlayer({ money: 10000000 });
  const ruin = spotById('ruin');
  assert.ok(spotLocked(p, ruin), 'まだ開いていないはずの難所が開いている');
  const locked = buy(p, 'spot', 'ruin');
  assert.equal(locked.ok, false);
  assert.match(locked.error, /シーラカンス/);
  assert.equal(p.money, 10000000, '買えていないのにお金が減った');

  // 深海のヌシを釣ると開く
  recordCatch(p, { fish: fishById('coelacanth'), weightKg: 50, lengthCm: 150, price: 400000 });
  assert.equal(spotLocked(p, ruin), null);
  const opened = buy(p, 'spot', 'ruin');
  assert.equal(opened.ok, true, opened.error);
  assert.equal(p.spot, 'ruin');

  // その先はまだ開かない
  assert.ok(spotLocked(p, spotById('crater')), '海底神殿のヌシなしで火口湖が開いた');
});

test('鍵になる魚を釣っていないと、難所は順番に開く', () => {
  const p = createPlayer({ money: 99999999 });
  for (const spot of hardSpots()) {
    assert.equal(buy(p, 'spot', spot.id).ok, false, `${spot.name}が先に買えてしまう`);
    recordCatch(p, { fish: fishById(spot.require), weightKg: 100, lengthCm: 300, price: 1 });
    assert.equal(buy(p, 'spot', spot.id).ok, true, `${spot.name}が開かない`);
  }
  assert.equal(p.spots.length, SPOTS.filter((s) => !s.price || true).length - 7);
});

test('難所ではラインへの負荷が増え、潮に流される', () => {
  const make = (spotId) => new Fight({
    fish: fishById('funa'), rod: rod('mythrod'), sizeRatio: 0.5, rng: mulberry32(9),
    spot: spotId ? spotById(spotId) : null,
  });
  const pond = make(null);
  const abyss = make('abyss');
  assert.equal(pond.drift, 0);
  assert.ok(abyss.drift > 0, '奈落なのに流されない');
  assert.ok(abyss.stress > pond.stress, '奈落なのに負荷が同じ');
  assert.ok(abyss.speed > pond.speed, '奈落なのに魚が速くない');
  assert.equal(abyss.hard, 3);
});

/** 動かない魚を相手に、同じ操作で寄せたときの進み具合を比べる。 */
function reelProgress(spotId, extra = {}) {
  const still = { ...fishById('funa'), speed: 0, escape: 0, power: 1 };
  const fight = new Fight({
    fish: still, rod: rod('nobe'), sizeRatio: 0.5, rng: () => 0.5,
    spot: spotId ? spotById(spotId) : null, ...extra,
  });
  for (let i = 0; i < 60; i++) fight.update(1 / 60, fight.barY > fight.fishY);
  return fight.progress;
}

test('潮に流される難所では、同じ操作でも寄せが進まない', () => {
  const pond = reelProgress(null);
  const ruin = reelProgress('ruin');
  const abyss = reelProgress('abyss');
  assert.ok(ruin < pond, `海底神殿のほうが楽になっている（${ruin} / ${pond}）`);
  assert.ok(abyss < ruin, `奈落のほうが楽になっている（${abyss} / ${ruin}）`);
});

test('潮止めアンカーと凪の札は、難所の流れを抑える', () => {
  const bare = reelProgress('abyss');
  const anchored = reelProgress('abyss', { gear: { ...NO_GEAR, driftCut: 0.03 } });
  const calmed = reelProgress('abyss', { charm: charmById('calm').effect });
  assert.ok(anchored > bare, 'アンカーが効いていない');
  assert.ok(calmed > anchored, '凪の札がアンカーより弱い');
  // 荒れはおさまるが、魚の重さ（寄せにくさ）までは変わらない
  const calm = new Fight({
    fish: fishById('narakunushi'), rod: rod('mythrod'), sizeRatio: 0.5, rng: mulberry32(1),
    spot: spotById('abyss'), charm: charmById('calm').effect,
  });
  assert.equal(calm.drift, 0);
  assert.equal(calm.stress, 1);
  assert.ok(calm.tough > 1, '凪の札でヌシまで軽くなってしまう');
});

test('難所のヌシは二段構えで暴れる', () => {
  for (const spot of hardSpots()) {
    const boss = fishOfSpot(spot.id).find((f) => f.boss);
    assert.equal(boss.rages, 2, `${boss.name}が二段構えになっていない`);
    const fight = new Fight({ fish: boss, rod: rod('mythrod'), sizeRatio: 0.5, rng: mulberry32(11) });
    let signals = 0;
    let phase = FIGHT.fighting;
    for (let i = 0; i < 60 * 120 && phase === FIGHT.fighting; i++) {
      phase = fight.update(1 / 60, fight.barY > fight.fishY);
      if (fight.justEnraged) signals++;
    }
    assert.equal(phase, FIGHT.caught, `${boss.name}を寄せきれない`);
    assert.equal(signals, 2, `${boss.name}の暴れ出す合図が ${signals} 回`);
    assert.equal(fight.rageLevel, 2);
  }
});

test('奈落の主は、伝説の竿では上がらず、神竿なら上がる', () => {
  const boss = fishById('narakunushi');
  const gear = gearEffects({ gears: GEAR.map((g) => g.id) });   // 道具はすべて持っている前提
  const rate = (rodId) => {
    let caught = 0;
    let snapped = 0;
    for (let n = 1; n <= 40; n++) {
      const fight = new Fight({
        fish: boss, rod: rod(rodId), sizeRatio: 0.55, rng: mulberry32(n * 17),
        spot: spotById('abyss'), gear,
      });
      let phase = FIGHT.fighting;
      for (let i = 0; i < 60 * 90 && phase === FIGHT.fighting; i++) {
        phase = fight.update(1 / 60, fight.fishY < fight.barY);
      }
      if (phase === FIGHT.caught) caught++;
      if (phase === FIGHT.snapped) snapped++;
    }
    return { caught, snapped };
  };
  const legend = rate('legend');
  const myth = rate('mythrod');
  assert.equal(legend.caught, 0, `伝説の竿で奈落の主が上がってしまう（${legend.caught} / 40）`);
  assert.ok(legend.snapped > 20, `伝説の竿でラインが切れない（${legend.snapped} / 40）`);
  assert.ok(myth.caught > 20, `神竿でも奈落の主がほとんど上がらない（${myth.caught} / 40）`);
  assert.equal(myth.snapped, 0, `神竿でもラインが切れる（${myth.snapped} / 40）`);
});

test('難所のヌシとの勝負は長丁場になる', () => {
  const gear = gearEffects({ gears: GEAR.map((g) => g.id) });
  const seconds = (spotId, rodId) => {
    const boss = fishOfSpot(spotId).find((f) => f.boss);
    let total = 0;
    let n = 0;
    for (let i = 1; i <= 40; i++) {
      const fight = new Fight({
        fish: boss, rod: rod(rodId), sizeRatio: 0.55, rng: mulberry32(i * 17),
        spot: spotById(spotId), gear,
      });
      let phase = FIGHT.fighting;
      for (let k = 0; k < 60 * 90 && phase === FIGHT.fighting; k++) {
        phase = fight.update(1 / 60, fight.fishY < fight.barY);
      }
      if (phase === FIGHT.caught) { total += fight.time; n++; }
    }
    return total / n;
  };
  const deep = seconds('deep', 'legend');
  const abyss = seconds('abyss', 'mythrod');
  assert.ok(abyss > deep * 2, `奈落の主が深海のヌシと変わらない（${abyss.toFixed(1)}秒 / ${deep.toFixed(1)}秒）`);
  assert.ok(abyss < 40, `長すぎて中だるみする（${abyss.toFixed(1)}秒）`);
});

test('難所ほどアタリが渋い', () => {
  const mean = (spotId) => {
    const rng = mulberry32(77);
    let total = 0;
    for (let i = 0; i < 400; i++) {
      total += biteDelay(rng, { lure: lure('worm'), timeIndex: 1, spot: spotId ? spotById(spotId) : null });
    }
    return total / 400;
  };
  const pond = mean(null);
  const ruin = mean('ruin');
  const abyss = mean('abyss');
  assert.ok(ruin > pond, `海底神殿のほうがアタリが早い（${ruin} / ${pond}）`);
  assert.ok(abyss > ruin, `奈落のほうがアタリが早い（${abyss} / ${ruin}）`);
});

test('凪の札を使うと、難所でもアタリの渋さが消える', () => {
  const rngA = mulberry32(3);
  const rngB = mulberry32(3);
  const opts = { lure: lure('worm'), timeIndex: 1, spot: spotById('abyss') };
  const hard = biteDelay(rngA, opts);
  const calm = biteDelay(rngB, { ...opts, charm: charmById('calm').effect });
  assert.ok(calm < hard, '凪の札でアタリが早くならない');
});

test('神託の札では伝説しか掛からない', () => {
  const rng = mulberry32(23);
  const effect = charmById('oracle').effect;
  for (const spot of SPOTS) {
    for (let i = 0; i < 40; i++) {
      const { fish } = pickFish(spot.id, { rng, rod: rod('mythrod'), lure: lure('worm'), charm: effect });
      assert.equal(fish.rarity, 'legendary', `${spot.name}で ${fish.name} が出た`);
    }
  }
});

test('新しい竿・ルアー・道具・お札がそろっている', () => {
  assert.equal(MAX_POWER, 7);
  assert.deepEqual(RODS.slice(-2).map((r) => r.power), [6, 7]);
  for (const id of ['phantom', 'kami']) {
    assert.ok(LURES.some((l) => l.id === id), `ルアー ${id} がない`);
  }
  for (const id of ['harness', 'anchor', 'drone']) {
    assert.ok(gearById(id), `道具 ${id} がない`);
  }
  for (const id of ['calm', 'oracle']) {
    assert.ok(charmById(id), `お札 ${id} がない`);
  }
  // 難所の魚に届く竿が必ず存在する
  const strongest = Math.max(...FISH.map((f) => f.power));
  assert.ok(MAX_POWER >= strongest, `いちばん強い魚（${strongest}）に届く竿がない`);
});

// ------------------------------------------------------------------ きらめき個体

/** 抽選を何度も回して、きらめきが出た割合を返す。 */
function shinyRate(opts = {}, tries = 20000) {
  const rng = mulberry32(2024);
  let shiny = 0;
  for (let i = 0; i < tries; i++) {
    const r = pickFish('pond', { rng, rod: rod('nobe'), lure: lure('worm'), ...opts });
    if (r.shiny) shiny++;
  }
  return shiny / tries;
}

test('きらめき個体はまれに出て、値段が跳ね上がる', () => {
  const rate = shinyRate();
  assert.ok(rate > SHINY.rate * 0.6 && rate < SHINY.rate * 1.5,
    `出る割合がおかしい（${(rate * 100).toFixed(2)}% / 想定 ${(SHINY.rate * 100).toFixed(2)}%）`);

  // 同じ魚・同じ大きさなら、ちょうど 5 倍
  const fish = fishById('funa');
  const plain = priceOf(fish, 1);
  assert.equal(plain * SHINY.priceMult, plain * 5);
});

test('ゴミは光らない', () => {
  const rng = mulberry32(5);
  for (let i = 0; i < 4000; i++) {
    const r = pickFish('pond', { rng, rod: rod('nobe'), lure: lure('worm') });
    if (r.fish.junk) assert.equal(r.shiny, false, `${r.fish.name}が光った`);
  }
});

test('ランクが上がるときらめきに出会いやすくなる', () => {
  const low = shinyRate({ gear: NO_GEAR });
  const high = shinyRate({ gear: rankEffects({ xp: RANKS[MAX_RANK - 1].need }) });
  assert.ok(high > low * 1.2, `熟練度で増えていない（${low} → ${high}）`);
});

// ------------------------------------------------------------------ 熟練度（ランク）

test('ランクの表は順番に上がっていく', () => {
  assert.equal(RANKS.length, MAX_RANK);
  for (let i = 1; i < RANKS.length; i++) {
    assert.equal(RANKS[i].level, RANKS[i - 1].level + 1);
    assert.ok(RANKS[i].need > RANKS[i - 1].need, `${RANKS[i].name}の必要経験値が前より少ない`);
    assert.ok(RANKS[i].name, 'ランクに名前がない');
  }
  assert.equal(RANKS[0].need, 0);
});

test('経験値はレア度・大きさ・ヌシ・きらめきで増える', () => {
  const at = (id, over = {}) => xpFor({ fish: fishById(id), sizeRatio: 0.5, ...over });
  assert.equal(at('boot'), 1, 'ゴミで経験値が入る');
  assert.ok(at('funa') < at('bass'), 'レア度で増えていない');
  assert.ok(at('bass') < at('namazu'));
  assert.ok(at('namazu') < at('suppon'));
  assert.ok(at('suppon') < at('nushi'), 'ヌシがいちばん多くない');
  assert.ok(at('funa', { sizeRatio: 1 }) > at('funa', { sizeRatio: 0 }), '大きさで増えていない');
  assert.equal(at('funa', { shiny: true }), at('funa') * SHINY.xpMult);
});

test('ランクは経験値で決まり、次のランクまでの進みも出る', () => {
  assert.equal(rankAt(0).level, 1);
  assert.equal(rankAt(-50).level, 1, 'おかしな値でも落ちない');
  assert.equal(rankAt(RANKS[1].need).level, 2);
  assert.equal(rankAt(RANKS[1].need - 1).level, 1);
  assert.equal(rankAt(99999999).level, MAX_RANK);
  assert.equal(rankProgress(RANKS[1].need), 0);
  assert.ok(Math.abs(rankProgress((RANKS[1].need + RANKS[2].need) / 2) - 0.5) < 0.01);
  assert.equal(rankProgress(99999999), 1, '最高位なら満タン');
});

test('釣るとランクが上がり、上がった合図が出る', () => {
  const p = createPlayer();
  assert.equal(rankOf(p).level, 1);
  let leveled = 0;
  for (let i = 0; i < 40; i++) {
    const res = gainXp(p, { fish: fishById('koi'), sizeRatio: 0.8 });
    if (res.leveledUp) leveled++;
    assert.ok(res.gained > 0);
  }
  assert.ok(rankOf(p).level > 1, 'ランクが上がらない');
  assert.equal(leveled, rankOf(p).level - 1, '上がった回数と合わない');
});

test('ランクの効果は道具と同じ枠に足される', () => {
  const low = createPlayer();
  const high = createPlayer({ xp: RANKS[MAX_RANK - 1].need, gears: ['cooler'] });
  assert.deepEqual(rankEffects(low), NO_GEAR, 'ランク 1 なのに補正がある');
  const total = totalEffects(high);
  const rank = rankEffects(high);
  assert.ok(rank.sell > 0 && rank.line > 0, '最高ランクなのに効果がない');
  assert.equal(total.sell, rank.sell + gearEffects(high).sell, '道具とランクが足されていない');
  for (const key of Object.keys(NO_GEAR)) {
    assert.ok(Number.isFinite(total[key]), `${key} が数値になっていない`);
  }
});

// ------------------------------------------------------------------ 実績と称号

test('実績のデータが壊れていない', () => {
  const ids = ACHIEVEMENTS.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length, '実績の ID が重複している');
  assert.ok(ACHIEVEMENTS.length >= 30, `実績が少ない（${ACHIEVEMENTS.length} 個）`);
  const fresh = createPlayer();
  for (const a of ACHIEVEMENTS) {
    assert.ok(a.name && a.note && a.icon, `${a.id}: 表示用の値が欠けている`);
    assert.ok(a.goal > 0, `${a.name}: 目標がおかしい`);
    assert.ok(a.reward > 0, `${a.name}: 賞金がない`);
    // はじめの一匹以外は、まっさらな状態で達成していないこと
    const state = achievementState(fresh, a);
    assert.ok(Number.isFinite(state.value), `${a.name}: 進みが数値でない`);
    assert.ok(state.value < a.goal, `${a.name}: 何もしていないのに達成している`);
    assert.equal(achievementById(a.id), a);
  }
});

test('実績を達成すると賞金がもらえ、二度はもらえない', () => {
  const p = createPlayer();
  recordCatch(p, { fish: fishById('funa'), weightKg: 1, lengthCm: 30, price: 100 });
  const first = checkAchievements(p);
  assert.ok(first.some((a) => a.id === 'first'), 'はじめの一匹が達成されない');
  const money = p.money;
  assert.ok(money > 0, '賞金が入っていない');
  assert.deepEqual(checkAchievements(p), [], '同じ実績を二度達成している');
  assert.equal(p.money, money, '二度目で賞金が増えた');
});

test('賞金でさらに開く実績も、その場で拾える', () => {
  const p = createPlayer({ earned: 9900 });
  // 売上 1 万円 → 賞金 → それ以上の実績までまとめて開くこと
  p.earned += 200;
  const unlocked = checkAchievements(p);
  assert.ok(unlocked.some((a) => a.id === 'earn10k'), '売上の実績が開かない');
  assert.equal(p.money, unlocked.reduce((sum, a) => sum + a.reward, 0), '賞金の合計が合わない');
});

test('称号は実績でしか手に入らず、持っているものだけつけられる', () => {
  const p = createPlayer();
  assert.deepEqual(earnedTitles(p), []);
  assert.equal(setTitle(p, 'ヌシ狩り'), false, '持っていない称号がつけられる');
  assert.equal(p.title, null);

  p.achieved = ['bossAll'];
  assert.deepEqual(earnedTitles(p), ['ヌシ狩り']);
  assert.equal(setTitle(p, 'ヌシ狩り'), true);
  assert.equal(p.title, 'ヌシ狩り');
  assert.equal(setTitle(p, null), true, '称号を外せない');
  assert.equal(p.title, null);
});

test('称号つきの実績がひと通りある', () => {
  const titled = ACHIEVEMENTS.filter((a) => a.title);
  assert.ok(titled.length >= 8, `称号が少ない（${titled.length} 個）`);
  const names = titled.map((a) => a.title);
  assert.equal(new Set(names).size, names.length, '同じ称号が二つある');
});

// ------------------------------------------------------------------ 日替わりのお題

test('お題は 3 つ出て、その日のあいだは変わらない', () => {
  const p = createPlayer();
  assert.equal(refreshDaily(p, '2026-05-05'), true, '初回に引かれない');
  const first = JSON.stringify(p.daily.quests);
  assert.equal(p.daily.quests.length, DAILY_COUNT);
  assert.equal(refreshDaily(p, '2026-05-05'), false, '同じ日に引き直している');
  assert.equal(JSON.stringify(p.daily.quests), first);
  assert.equal(refreshDaily(p, '2026-05-06'), true, '日付が変わっても引き直さない');
  assert.notEqual(JSON.stringify(p.daily.quests), first, '次の日も同じお題');
});

test('お題は種類がかぶらず、行ける釣り場からしか出ない', () => {
  for (const spots of [['pond'], ['pond', 'river', 'harbor'], SPOTS.map((s) => s.id)]) {
    const p = createPlayer({ spots });
    for (const day of ['2026-01-01', '2026-06-15', '2026-12-31']) {
      const quests = rollDailies(day, p);
      assert.equal(quests.length, DAILY_COUNT, `${day}: お題が ${quests.length} 個`);
      const kinds = quests.map((q) => q.kind);
      assert.equal(new Set(kinds).size, kinds.length, `${day}: 同じ種類のお題が並んでいる`);
      for (const q of quests) {
        assert.ok(q.goal > 0 && q.reward > 0, `${q.label}: 目標か賞金がおかしい`);
        assert.ok(q.label, 'お題の文がない');
        assert.equal(q.done, false);
        if (q.spot) assert.ok(spots.includes(q.spot), `行けない釣り場のお題が出た: ${q.label}`);
      }
    }
  }
});

test('はじめたばかりだと、ヌシやきらめきのお題は出ない', () => {
  const p = createPlayer();
  for (let d = 1; d <= 28; d++) {
    const quests = rollDailies(`2026-03-${String(d).padStart(2, '0')}`, p);
    for (const q of quests) {
      assert.ok(!['boss', 'shiny'].includes(q.kind), `池しか行けないのに「${q.label}」が出た`);
    }
  }
});

test('お題は進めると賞金がもらえ、一度だけ数えられる', () => {
  const p = createPlayer();
  p.daily = {
    date: 'x',
    quests: [
      { kind: 'count', spot: 'pond', label: '池で 2 匹', goal: 2, progress: 0, done: false, reward: 500 },
      { kind: 'sell', label: '1000 円売る', goal: 1000, progress: 0, done: false, reward: 800 },
      { kind: 'size', label: '30cm 以上', goal: 30, progress: 0, done: false, reward: 400 },
    ],
  };
  const catchOne = (over = {}) => progressDaily(p, {
    type: 'catch',
    result: { fish: fishById('funa'), lengthCm: 20, ...over },
  });

  assert.deepEqual(catchOne(), [], '1 匹目で達成になっている');
  const done = catchOne({ lengthCm: 40 });
  assert.equal(done.length, 2, `2 匹目で達成するのは 2 つのはず（${done.length}）`);
  assert.equal(p.money, 900, `賞金が合わない（${p.money}）`);
  assert.equal(p.dailyDone, 2);

  // 達成したお題はもう増えない
  catchOne({ lengthCm: 90 });
  assert.equal(p.money, 900);
  assert.equal(dailyProgress(p).done, 2);

  progressDaily(p, { type: 'sell', price: 1200 });
  assert.equal(p.money, 900 + 800);
  assert.deepEqual(dailyProgress(p), { done: 3, total: 3 });
});

test('お題の種類ごとに、数えかたが合っている', () => {
  const quest = (over) => {
    const p = createPlayer();
    p.daily = { date: 'x', quests: [{ progress: 0, done: false, reward: 100, goal: 99, ...over }] };
    return p;
  };
  const feed = (p, event) => { progressDaily(p, event); return p.daily.quests[0].progress; };

  const casts = quest({ kind: 'casts', label: '' });
  assert.equal(feed(casts, { type: 'cast' }), 1);

  const junk = quest({ kind: 'junk', label: '' });
  assert.equal(feed(junk, { type: 'catch', result: { fish: fishById('boot') } }), 1);
  assert.equal(feed(junk, { type: 'catch', result: { fish: fishById('funa') } }), 1, 'ゴミ以外を数えている');

  const rare = quest({ kind: 'rarity', rarity: 'rare', label: '' });
  assert.equal(feed(rare, { type: 'catch', result: { fish: fishById('bass') } }), 0, 'レア度が足りないのに数えた');
  assert.equal(feed(rare, { type: 'catch', result: { fish: fishById('namazu') } }), 1);
  assert.equal(feed(rare, { type: 'catch', result: { fish: fishById('suppon') } }), 2, '上のレア度が数えられない');

  const boss = quest({ kind: 'boss', label: '' });
  assert.equal(feed(boss, { type: 'catch', result: { fish: fishById('funa') } }), 0);
  assert.equal(feed(boss, { type: 'catch', result: { fish: fishById('nushi') } }), 1);

  const shiny = quest({ kind: 'shiny', label: '' });
  assert.equal(feed(shiny, { type: 'catch', result: { fish: fishById('funa') } }), 0);
  assert.equal(feed(shiny, { type: 'catch', result: { fish: fishById('funa'), shiny: true } }), 1);
});

test('その日の鍵は年月日でできている', () => {
  assert.equal(todayKey(new Date(2026, 0, 3)), '2026-01-03');
  assert.equal(todayKey(new Date(2026, 11, 31)), '2026-12-31');
  assert.match(todayKey(), /^\d{4}-\d{2}-\d{2}$/);
});

// ------------------------------------------------------------------ 記録とセーブ

test('きらめき個体は別の図鑑にも残る', () => {
  const p = createPlayer();
  const result = { fish: fishById('koi'), weightKg: 3, lengthCm: 60, price: 5000, shiny: true };
  recordCatch(p, result, { weather: 'rain' });
  assert.equal(shinyKinds(p), 1);
  assert.equal(p.records.koi.count, 1, 'ふつうの図鑑にも残っていない');
  assert.equal(p.shinies.koi.count, 1);
  assert.deepEqual(p.weathersSeen, ['rain']);
  assert.equal(p.best.price, 5000);
  assert.equal(p.best.lengthCm, 60);

  // 光っていない個体では、きらめきの枠は増えない
  recordCatch(p, { fish: fishById('koi'), weightKg: 9, lengthCm: 90, price: 900 }, { weather: 'rain' });
  assert.equal(p.shinies.koi.count, 1);
  assert.equal(p.records.koi.count, 2);
  assert.equal(p.best.lengthCm, 90, '自己ベストが伸びていない');
  assert.equal(p.best.price, 5000, '自己ベストの値段が下がった');
  assert.deepEqual(p.weathersSeen, ['rain'], '同じ天気を二度数えている');
});

test('壊れたセーブでも、やりこみの記録を拾い直せる', () => {
  const p = normalizePlayer({
    xp: -5,
    achieved: ['first', 'そんな実績はない'],
    title: 'ヌシ狩り',                       // 実績を持っていないので外れるはず
    shinies: { koi: { count: 2, weightKg: 3, lengthCm: 60, price: 100 }, nope: { count: 1 } },
    weathersSeen: ['rain', 'ゆき'],
    dailyDone: 3.7,
    best: { price: '1200', lengthCm: 44.6, weightKg: 'x' },
    daily: { date: '2026-02-02', quests: [{ kind: 'count', spot: 'pond', goal: 3, progress: 1, reward: 500, label: '池で 3 匹' }, { kind: 'にせもの', goal: 1 }] },
  });
  assert.equal(p.xp, 0);
  assert.deepEqual(p.achieved, ['first']);
  assert.equal(p.title, null, '持っていない称号がついたまま');
  assert.equal(shinyKinds(p), 1, '知らない魚のきらめきが残っている');
  assert.deepEqual(p.weathersSeen, ['rain']);
  assert.equal(p.dailyDone, 3);
  assert.deepEqual(p.best, { price: 1200, lengthCm: 45, weightKg: 0 });
  assert.equal(p.daily.quests.length, 1, '知らない種類のお題が残っている');
  assert.equal(p.daily.quests[0].done, false);
  assert.equal(p.daily.date, '2026-02-02');
});

test('大きさのお題は、ヌシに頼らなくても届く', () => {
  for (const spots of [['pond'], ['pond', 'river'], SPOTS.map((s) => s.id)]) {
    const p = createPlayer({ spots });
    // その人が行ける釣り場の、ヌシ以外でいちばん大きい魚
    const reach = Math.max(...spots
      .flatMap((id) => fishOfSpot(id))
      .filter((f) => !f.junk && !f.boss)
      .map((f) => f.length[1]));
    for (let d = 1; d <= 28; d++) {
      for (const q of rollDailies(`2026-07-${String(d).padStart(2, '0')}`, p)) {
        if (q.kind !== 'size') continue;
        assert.ok(q.goal <= reach, `${spots.at(-1)}: ${q.label} はヌシでないと無理（届くのは ${reach}cm）`);
      }
    }
  }
});

// ------------------------------------------------------------------ セーブの持ち出し

test('書き出したセーブは、そのまま読み直せる', () => {
  const p = createPlayer({ money: 12345, xp: 5000, spots: ['pond', 'river'] });
  recordCatch(p, { fish: fishById('koi'), weightKg: 3, lengthCm: 60, price: 900, shiny: true });
  refreshDaily(p, '2026-04-01');
  setTitle(p, null);

  const text = exportSave(p);
  const head = JSON.parse(text);
  assert.equal(head.format, SAVE_FORMAT);
  assert.equal(head.version, SAVE_VERSION);
  assert.match(head.savedAt, /^\d{4}-\d{2}-\d{2}T/);

  const back = importSave(text);
  assert.equal(back.ok, true, back.error);
  assert.equal(back.player.money, 12345);
  assert.equal(back.player.xp, 5000);
  assert.equal(shinyKinds(back.player), 1);
  assert.deepEqual(back.player.spots, ['pond', 'river']);
  assert.equal(back.player.daily.date, '2026-04-01');
  assert.equal(back.savedAt, head.savedAt);
});

test('セーブそのもの（localStorage の中身）を貼っても読める', () => {
  const p = createPlayer({ money: 700 });
  const back = importSave(JSON.stringify(p));
  assert.equal(back.ok, true, back.error);
  assert.equal(back.player.money, 700);
  assert.equal(back.savedAt, null);
});

test('読み込めないデータは、理由をつけて断る', () => {
  const cases = [
    ['', 'データが空です'],
    ['   ', 'データが空です'],
    ['これはただの文章', 'データの形が違います。コピーし損ねていませんか'],
    ['{"hello":1}', 'この釣りゲームのデータではないようです'],
    ['[1,2,3]', 'この釣りゲームのデータではないようです'],
    [JSON.stringify({ format: SAVE_FORMAT, version: SAVE_VERSION + 5, player: {} }),
      '新しい版のデータです。アプリを更新してください'],
    [JSON.stringify({ format: SAVE_FORMAT, version: SAVE_VERSION, player: null }), '中身が入っていません'],
  ];
  for (const [text, error] of cases) {
    const res = importSave(text);
    assert.equal(res.ok, false, `読めてしまった: ${text}`);
    assert.equal(res.error, error);
  }
});

test('壊れかけのデータでも、読めるところまでは拾う', () => {
  const res = importSave(JSON.stringify({
    format: SAVE_FORMAT, version: SAVE_VERSION,
    player: { money: -5, rods: ['nobe', 'にせ竿'], records: { koi: { count: 2, weightKg: 3, lengthCm: 60, price: 90 } } },
  }));
  assert.equal(res.ok, true, res.error);
  assert.equal(res.player.money, 0);
  assert.deepEqual(res.player.rods, ['nobe']);
  assert.equal(Object.keys(res.player.records).length, 1);
});

test('書き出しの見出しに、いまの状態が出る', () => {
  const p = createPlayer({ money: 1200, xp: 0 });
  recordCatch(p, { fish: fishById('funa'), weightKg: 1, lengthCm: 30, price: 100 });
  const text = saveSummary(p);
  assert.match(text, /1,200円/);
  assert.match(text, /図鑑 1 種/);
  assert.match(text, /Lv\.1 見習い/);
});

// ------------------------------------------------------------------ 時計いじり

test('端末の時計を戻しても、お題は引き直されない', () => {
  const p = createPlayer();
  assert.equal(refreshDaily(p, '2026-05-10'), true);
  p.daily.quests[0].done = true;
  const kept = JSON.stringify(p.daily.quests);

  // 前の日に戻しても、お題はそのまま（賞金をもう一度もらえてしまう）
  assert.equal(refreshDaily(p, '2026-05-09'), false, '時計を戻すと引き直せてしまう');
  assert.equal(JSON.stringify(p.daily.quests), kept);
  assert.equal(refreshDaily(p, '2026-05-01'), false);

  // 先に進めば、もちろん新しくなる
  assert.equal(refreshDaily(p, '2026-05-11'), true);
  assert.equal(p.daily.quests.some((q) => q.done), false, '新しいお題が達成済みで出ている');
  assert.equal(p.daily.seen, '2026-05-11');

  // 戻したあとで元の日に来ても、引き直さない
  refreshDaily(p, '2026-05-02');
  assert.equal(p.daily.date, '2026-05-11');
});

// ------------------------------------------------------------------ はじめての案内

test('案内は順番に出て、最後まで行くと二度と出ない', () => {
  const p = createPlayer();
  assert.equal(tutorialStep(p).id, 'cast', 'はじめの案内がキャストでない');
  assert.equal(advanceTutorial(p), false, '何もしていないのに進んだ');

  p.casts = 1;
  assert.equal(advanceTutorial(p), true);
  assert.equal(tutorialStep(p).id, 'hook');

  p.tutorial.hooked = true;
  advanceTutorial(p);
  assert.equal(tutorialStep(p).id, 'reel', '合わせたのに次へ進まない');

  p.catches = 1;
  advanceTutorial(p);
  assert.equal(tutorialStep(p).id, 'sell');

  p.earned = 100;
  p.rods = ['nobe', 'glass'];
  p.tutorial.sawQuest = true;
  assert.equal(advanceTutorial(p), true);
  assert.equal(p.tutorial.done, true, '条件がそろっても終わらない');
  assert.equal(tutorialStep(p), null);
  assert.equal(advanceTutorial(p), false, '終わったのにまだ動く');
});

test('案内の手順に抜けがない', () => {
  assert.ok(TUTORIAL.length >= 5);
  const ids = TUTORIAL.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, '案内の ID が重複している');
  for (const step of TUTORIAL) {
    assert.ok(step.text, `${step.id}: 文がない`);
    assert.equal(typeof step.need, 'function', `${step.id}: 進む条件がない`);
    assert.equal(step.need(createPlayer()), false, `${step.id}: はじめから条件を満たしている`);
  }
});

test('途中で閉じた案内は、もう出てこない', () => {
  const p = createPlayer();
  p.tutorial.done = true;
  assert.equal(tutorialStep(p), null);
  const back = normalizePlayer(JSON.parse(JSON.stringify(p)));
  assert.equal(back.tutorial.done, true, '読み直すと案内が復活する');
});

// ------------------------------------------------------------------ 音

test('音は、鳴らせない環境でも落ちない', () => {
  // Node には AudioContext が無い。そこで落ちるとゲームごと止まってしまう
  assert.ok(SOUND_NAMES.length >= 10, `音の種類が少ない（${SOUND_NAMES.length}）`);
  sound.unlock();
  for (const name of SOUND_NAMES) sound.play(name);
  sound.play('そんな音はない');
  sound.startReel();
  sound.stopReel();
  assert.equal(sound.toggle(), true, '消音に切りかえられない');
  assert.equal(sound.toggle(), false);
});

// ------------------------------------------------------------------ 手ごたえ（振動）

test('振動のパターンは、指で区別がつく形になっている', () => {
  for (const [name, pattern] of Object.entries(HAPTICS)) {
    assert.ok(Array.isArray(pattern) && pattern.length > 0, `${name}: パターンが空`);
    for (const ms of pattern) {
      assert.ok(Number.isInteger(ms) && ms > 0 && ms <= 300, `${name}: ${ms}ms は長すぎるか短すぎる`);
    }
  }
  // 珍しいものほど長く震える
  const total = (p) => p.reduce((a, b) => a + b, 0);
  assert.ok(total(HAPTICS.boss) > total(HAPTICS.catch), 'ヌシがふつうの魚と同じ手ごたえ');
  assert.ok(total(HAPTICS.shiny) > total(HAPTICS.catch), 'きらめきがふつうの魚と同じ手ごたえ');
  assert.ok(total(HAPTICS.junk) < total(HAPTICS.catch), 'ゴミが魚より手ごたえがある');
});

test('釣れたものに合わせて振動を選ぶ', () => {
  const of = (id, over = {}) => hapticFor({ fish: fishById(id), sizeRatio: 0.5, ...over });
  assert.deepEqual(of('nushi'), HAPTICS.boss, 'ヌシの手ごたえが違う');
  assert.deepEqual(of('funa', { shiny: true }), HAPTICS.shiny);
  assert.deepEqual(of('boot'), HAPTICS.junk, 'ゴミの手ごたえが違う');
  assert.deepEqual(of('funa', { isNew: true }), HAPTICS.record);
  assert.deepEqual(of('funa', { sizeRatio: 0.9 }), HAPTICS.big);
  assert.deepEqual(of('funa'), HAPTICS.catch);
  assert.deepEqual(hapticFor(null), HAPTICS.catch, '中身がなくても落ちない');

  // ヌシは、きらめきでも自己ベストでもヌシの手ごたえが勝つ
  assert.deepEqual(of('nushi', { shiny: true, isNew: true }), HAPTICS.boss);
});
