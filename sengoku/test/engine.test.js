import test from 'node:test';
import assert from 'node:assert/strict';

import { DAIMYOS, GENERALS, LINKS, PROVINCES } from '../src/data.js';
import {
  BASE_STAT, COST, LEVEL_STAT, LIMIT, MAX_LEVEL, RANKS, adjacent, advanceMonth, aliveDaimyos, attackPower,
  battleRetreat, battleRound, buildCost, buildable, castleOf, cellBuild, cellsOf, commandList, commandsLeft,
  createGame, daimyoSummary, defensePower, deserialize, eligibleCells, execute, generalsIn, generalsOf, isAllied,
  isCastle, landSummary, leadCap, lordOf, neighbors8, provinceAt, provincesOf, rankName, recruitCaptured,
  refreshProvince, releaseCaptured, roninIn, serialize, statMax, terrainAt,
} from '../src/engine.js';
import { runAi } from '../src/ai.js';

const game = (player = 'oda', seed = 1) => createGame({ player, seed });
const lord = (s, d) => lordOf(s, d);

// ------------------------------------------------------------------ データ

test('国・大名・武将のデータに矛盾がない', () => {
  const ids = new Set(PROVINCES.map((p) => p.id));
  assert.equal(ids.size, PROVINCES.length);
  for (const [a, b] of LINKS) {
    assert.ok(ids.has(a) && ids.has(b), `unknown link ${a}-${b}`);
  }
  for (const p of PROVINCES) {
    assert.ok(adjacent(p.id).length >= 1, `${p.name} は孤立している`);
    if (p.owner) assert.ok(DAIMYOS.some((d) => d.id === p.owner), `${p.name} の大名が不明`);
  }
  for (const d of DAIMYOS) {
    assert.equal(PROVINCES.find((p) => p.id === d.capital)?.owner, d.id, `${d.name} の本拠が自分の国でない`);
    assert.equal(GENERALS.filter((g) => g.daimyo === d.id && g.lord).length, 1, `${d.name} の当主は 1 人`);
  }
  for (const g of GENERALS) {
    assert.ok(PROVINCES.some((p) => p.id === g.province), `${g.name} のいる国が不明`);
    if (g.daimyo) assert.equal(PROVINCES.find((p) => p.id === g.province)?.owner, g.daimyo, `${g.name} が自分の家の国にいない`);
    if (g.appear) assert.ok(g.appear > 1500 && g.appear < 1650, `${g.name} の登場年がおかしい`);
  }
  assert.ok(GENERALS.length >= 1000, `武将は 1000 人以上（今 ${GENERALS.length} 人）`);
  assert.equal(new Set(GENERALS.map((g) => g.name)).size, GENERALS.length, '名前が重複している');
});

test('地図はひとつながりになっている', () => {
  const seen = new Set([PROVINCES[0].id]);
  const queue = [PROVINCES[0].id];
  while (queue.length) {
    for (const n of adjacent(queue.shift())) if (!seen.has(n)) { seen.add(n); queue.push(n); }
  }
  assert.equal(seen.size, PROVINCES.length);
});

// ------------------------------------------------------------------ 生成

test('createGame は選んだ大名をプレイヤーにして 1560 年 4 月から始める', () => {
  const s = game('takeda');
  assert.equal(s.player, 'takeda');
  assert.equal(s.year, 1560);
  assert.equal(s.month, 4);
  assert.equal(provincesOf(s, 'takeda').length, 2);
  assert.equal(lord(s, 'takeda').name, '武田信玄');
  assert.equal(aliveDaimyos(s).length, DAIMYOS.length);
  assert.throws(() => createGame({ player: 'nobody' }));
});

test('同じ seed なら同じ結果になる（保存して読み直せる）', () => {
  const a = game('oda', 42);
  const b = game('oda', 42);
  for (let i = 0; i < 6; i++) { runAi(a, { includePlayer: true }); advanceMonth(a); }
  const restored = deserialize(serialize(b));
  for (let i = 0; i < 6; i++) { runAi(restored, { includePlayer: true }); advanceMonth(restored); }
  assert.equal(serialize(a), serialize(restored));
  assert.throws(() => deserialize('{"version":0}'));
});

// ------------------------------------------------------------------ 内政

test('開墾・まちづくりはマスを選んで田・町のレベルを上げ、農業・商業が増える', () => {
  const s = game('oda');
  const nobunaga = lord(s, 'oda');
  const gold = s.daimyos.oda.gold;
  const agri = s.provinces.owari.agri;
  const cmd = commandList(s, nobunaga.id).find((c) => c.type === 'develop');
  assert.ok(cmd.enabled);
  assert.ok(cmd.cells.length > 0, '田を作れるマスがある');
  const [c, r] = cmd.cells[0];
  const cost = buildCost(s, c, r, 'farm');
  const before = cellBuild(s, c, r)?.farm || 0;
  const res = execute(s, { type: 'develop', general: nobunaga.id, cell: [c, r] });
  assert.ok(res.ok, res.text);
  assert.equal(res.level, before + 1);
  assert.equal(cellBuild(s, c, r).farm, before + 1);
  assert.equal(s.daimyos.oda.gold, gold - cost);
  assert.ok(s.provinces.owari.agri >= agri + LEVEL_STAT, '農業が上がる');
  assert.ok(nobunaga.acted);
  assert.equal(execute(s, { type: 'commerce', general: nobunaga.id }).ok, false, '同じ月に 2 回は動けない');

  // マスを指定しなければ、いちばん安いマスに作る（CPU 用）
  const hideyoshi = generalsOf(s, 'oda').find((g) => g.name === '木下秀吉');
  const comm = s.provinces.owari.comm;
  const r2 = execute(s, { type: 'commerce', general: hideyoshi.id });
  assert.ok(r2.ok, r2.text);
  assert.ok(s.provinces.owari.comm >= comm + LEVEL_STAT);
  assert.ok(cellBuild(s, r2.cell[0], r2.cell[1]).town >= 1);

  const niwa = generalsOf(s, 'oda').find((g) => g.name === '丹羽長秀');
  const def = s.provinces.owari.defense;
  execute(s, { type: 'fortify', general: niwa.id });
  assert.equal(s.provinces.owari.defense, def + 2 + Math.floor(niwa.pol / 15));
});

test('田や町は城か田・町の隣にしか作れず、田のマスに町は作れない', () => {
  const s = game('oda');
  const nobunaga = lord(s, 'oda');
  const farmCells = eligibleCells(s, 'owari', 'farm');
  for (const [c, r] of farmCells) {
    assert.equal(provinceAt(c, r), 'owari');
    assert.ok(buildable(c, r));
    const b = cellBuild(s, c, r);
    assert.ok(!b || !b.town, '町のあるマスは田にできない');
  }
  // 城から離れた、まわりに何もないマスは選べない
  const far = cellsOf('owari').find(([c, r]) => buildable(c, r) && !cellBuild(s, c, r)
    && !neighbors8(c, r).some(([nc, nr]) => provinceAt(nc, nr) === 'owari' && (isCastle(nc, nr) || cellBuild(s, nc, nr))));
  if (far) {
    const res = execute(s, { type: 'develop', general: nobunaga.id, cell: far });
    assert.equal(res.ok, false);
    assert.match(res.text, /作れない/);
  }
  // 他の国のマスも選べない
  const other = cellsOf('mino')[0];
  assert.equal(execute(s, { type: 'develop', general: nobunaga.id, cell: other }).ok, false);
});

test('金が足りないと内政コマンドは失敗し、一覧でも理由つきで無効になる', () => {
  const s = game('oda');
  s.daimyos.oda.gold = 10;
  const nobunaga = lord(s, 'oda');
  assert.equal(execute(s, { type: 'develop', general: nobunaga.id }).ok, false);
  assert.ok(!nobunaga.acted);
  const cmd = commandList(s, nobunaga.id).find((c) => c.type === 'develop');
  assert.equal(cmd.enabled, false);
  assert.match(cmd.reason, /金が足りない/);
  const train = commandList(s, nobunaga.id).find((c) => c.type === 'train');
  assert.ok(train.enabled, '訓練は金がなくてもできる');
});

test('徴兵は統率に応じて兵が増え、民忠が下がる', () => {
  const s = game('oda');
  const katsuie = generalsOf(s, 'oda').find((g) => g.name === '柴田勝家');
  const soldiers = s.provinces.owari.soldiers;
  const loyalty = s.provinces.owari.loyalty;
  const gold = s.daimyos.oda.gold;
  const r = execute(s, { type: 'recruit', general: katsuie.id });
  assert.ok(r.ok);
  const n = 300 + katsuie.lead * 5;
  assert.equal(s.provinces.owari.soldiers, soldiers + n);
  assert.equal(s.provinces.owari.loyalty, loyalty - 4);
  assert.equal(s.daimyos.oda.gold, gold - Math.ceil(n / 100) * COST.recruitPer100);
});

test('民忠が低いと徴兵できず、施しで回復する', () => {
  const s = game('oda');
  s.provinces.owari.loyalty = 20;
  const nobunaga = lord(s, 'oda');
  assert.equal(execute(s, { type: 'recruit', general: nobunaga.id }).ok, false);
  const rice = s.daimyos.oda.rice;
  assert.ok(execute(s, { type: 'charity', general: nobunaga.id }).ok);
  assert.equal(s.daimyos.oda.rice, rice - COST.charity);
  assert.equal(s.provinces.owari.loyalty, 20 + 5 + Math.floor(nobunaga.pol / 10));
});

test('田がレベル 3 になるとそのマスはもう開墾できず、全部埋まると開墾できなくなる', () => {
  const s = game('oda');
  for (const [c, r] of cellsOf('owari')) {
    if (buildable(c, r)) s.cells[`${c},${r}`] = { farm: MAX_LEVEL, town: 0 };
  }
  refreshProvince(s, 'owari');
  assert.ok(s.provinces.owari.agri >= statMax('owari'), '田で埋めると農業は上限に届く');
  const cmd = commandList(s, lord(s, 'oda').id).find((c) => c.type === 'develop');
  assert.equal(cmd.enabled, false);
  assert.match(cmd.reason, /マスがない/);
  assert.equal(commandList(s, lord(s, 'oda').id).find((c) => c.type === 'commerce').enabled, false, '田で埋まっていると町も作れない');
});

test('マス目の地図は国ごとにまとまっていて、城は自分の国の平地にある', () => {
  for (const p of PROVINCES) {
    const cells = cellsOf(p.id);
    assert.ok(cells.length >= 10, `${p.name} のマスが少なすぎる（${cells.length}）`);
    const [c, r] = castleOf(p.id);
    assert.equal(provinceAt(c, r), p.id, `${p.name} の城が自分の国にない`);
    assert.equal(terrainAt(c, r), '.', `${p.name} の城が平地にない`);
    assert.ok(isCastle(c, r));
  }
  const s = game('oda');
  const sum = landSummary(s, 'mino');
  assert.equal(sum.cells, cellsOf('mino').length);
  assert.ok(sum.farm > 0 && sum.town > 0, '最初から田と町がある');
  assert.equal(s.provinces.mino.agri, BASE_STAT + sum.farm * LEVEL_STAT);
});

// ------------------------------------------------------------------ 移動

test('移動は隣の自分の国にだけでき、兵も一緒に動く', () => {
  const s = game('takeda');
  const shingen = lord(s, 'takeda'); // 甲斐
  assert.equal(execute(s, { type: 'move', general: shingen.id, target: 'suruga', soldiers: 100 }).ok, false, '他家の国へは移動できない');
  assert.equal(execute(s, { type: 'move', general: shingen.id, target: 'echigo', soldiers: 100 }).ok, false, '隣でない');
  const kai = s.provinces.kai.soldiers;
  const shinano = s.provinces.shinano.soldiers;
  const r = execute(s, { type: 'move', general: shingen.id, target: 'shinano', soldiers: 2000 });
  assert.ok(r.ok, r.text);
  assert.equal(shingen.province, 'shinano');
  assert.equal(s.provinces.kai.soldiers, kai - 2000);
  assert.equal(s.provinces.shinano.soldiers, shinano + 2000);
});

// ------------------------------------------------------------------ 合戦

test('出陣は兵糧を使い、合戦を 1 合戦ずつ進められる', () => {
  const s = game('oda', 3);
  const nobunaga = lord(s, 'oda');
  s.provinces.owari.soldiers = 12000;
  s.provinces.owari.training = 90;
  const rice = s.daimyos.oda.rice;
  const defenders = generalsIn(s, 'mikawa').length;
  const r = execute(s, { type: 'march', general: nobunaga.id, target: 'mikawa', soldiers: 10000 });
  assert.ok(r.ok, r.text);
  assert.ok(r.battle);
  assert.equal(s.daimyos.oda.rice, rice - 100 * COST.marchRicePer100);
  assert.equal(s.provinces.owari.soldiers, 2000);
  const b = r.battle;
  assert.equal(b.round, 0);
  battleRound(s, b);
  assert.equal(b.round, 1);
  assert.ok(b.attSoldiers < 10000 || b.defSoldiers < b.defStart);
  let guard = 0;
  while (!b.done && guard++ < 20) battleRound(s, b);
  assert.ok(b.done);
  assert.equal(b.result, 'win', '兵 10000 vs 3500 ならまず勝つ');
  assert.equal(s.provinces.mikawa.owner, 'oda');
  assert.equal(nobunaga.province, 'mikawa');
  assert.equal(s.provinces.mikawa.soldiers, b.attSoldiers);
  assert.equal(s.provinces.mikawa.loyalty, 40);
  // 三河にいた松平の武将は、逃げ場（隣の自国）がないので捕虜になる
  for (const id of b.captured) assert.equal(s.generals[id].status, 'captured');
  assert.equal(b.captured.length + b.fled.length, defenders);
  assert.equal(b.fled.length, 0);
  assert.equal(s.daimyos.matsudaira.alive, false, '一国しかない松平は滅亡する');
});

test('退却すると残った兵はもとの国へ戻る', () => {
  const s = game('oda', 5);
  const nobunaga = lord(s, 'oda');
  const r = execute(s, { type: 'march', general: nobunaga.id, target: 'mino', soldiers: 3000 });
  const b = r.battle;
  battleRound(s, b);
  battleRetreat(s, b);
  assert.equal(b.result, 'retreat');
  assert.equal(s.provinces.owari.soldiers, 2000 + b.attSoldiers);
  assert.equal(nobunaga.province, 'owari');
  assert.equal(s.provinces.mino.owner, 'saito');
});

test('10 合戦で落とせなければ引き上げになる', () => {
  const s = game('oda', 5);
  const nobunaga = lord(s, 'oda');
  s.provinces.mino.soldiers = 15000;
  s.provinces.mino.defense = 100;
  const b = execute(s, { type: 'march', general: nobunaga.id, target: 'mino', soldiers: 4000 }).battle;
  let guard = 0;
  while (!b.done && guard++ < 20) battleRound(s, b);
  assert.ok(['timeout', 'lose'].includes(b.result));
  assert.ok(b.round <= LIMIT.battleRounds);
});

test('兵のいない国は無血開城する', () => {
  const s = game('oda', 5);
  s.provinces.ise.soldiers = 0;
  const b = execute(s, { type: 'march', general: lord(s, 'oda').id, target: 'ise', soldiers: 1000 }).battle;
  assert.ok(b.done);
  assert.equal(b.result, 'win');
  assert.equal(s.provinces.ise.owner, 'oda');
});

test('同盟中の相手には出陣できず、期限が来ると切れる', () => {
  const s = game('azai', 1);
  const nagamasa = lord(s, 'azai');
  s.daimyos.azai.gold = 1000;
  // 朝倉とは最初から友好 80 なので同盟できる（seed 固定で成功する乱数を探す）
  let r = execute(s, { type: 'alliance', general: nagamasa.id, daimyo: 'asakura' });
  let tries = 0;
  while (!r.success && tries++ < 20) {
    nagamasa.acted = false;
    s.daimyos.azai.friendship.asakura = 90;
    r = execute(s, { type: 'alliance', general: nagamasa.id, daimyo: 'asakura' });
  }
  assert.ok(r.success, '同盟が成立する');
  assert.ok(isAllied(s, 'azai', 'asakura'));
  nagamasa.acted = false;
  assert.equal(execute(s, { type: 'march', general: nagamasa.id, target: 'echizen', soldiers: 1000 }).ok, false);
  for (let i = 0; i < LIMIT.allianceMonths; i++) advanceMonth(s);
  assert.equal(isAllied(s, 'azai', 'asakura'), false);
});

test('親善で友好が上がる', () => {
  const s = game('oda');
  const nobunaga = lord(s, 'oda');
  const before = s.daimyos.oda.friendship.tokugawa ?? s.daimyos.oda.friendship.matsudaira;
  execute(s, { type: 'goodwill', general: nobunaga.id, daimyo: 'matsudaira' });
  assert.equal(s.daimyos.oda.friendship.matsudaira, before + 5 + Math.floor(nobunaga.pol / 10));
});

// ------------------------------------------------------------------ 捕虜

test('捕らえた武将は登用か解放できる', () => {
  const s = game('oda', 3);
  s.provinces.owari.soldiers = 15000;
  const b = execute(s, { type: 'march', general: lord(s, 'oda').id, target: 'mikawa', soldiers: 12000 }).battle;
  while (!b.done) battleRound(s, b);
  assert.ok(b.captured.length > 0);
  // 解放：松平は滅亡しているので野に下る
  const first = b.captured[0];
  const rel = releaseCaptured(s, first);
  assert.ok(rel.ok);
  assert.equal(s.generals[first].status, 'ronin', '帰る家がないので在野になる');
  assert.equal(s.generals[first].province, 'mikawa');
  // 登用：成功するまで乱数を回す
  const second = b.captured[1];
  let joined = false;
  for (let i = 0; i < 30 && !joined; i++) {
    const r = recruitCaptured(s, second, 'oda');
    joined = r.joined;
    if (!joined) s.generals[second].status = 'captured';
  }
  assert.ok(joined);
  assert.equal(s.generals[second].daimyo, 'oda');
  assert.equal(s.generals[second].status, 'active');
  assert.equal(s.generals[second].lord, false);
});

test('当主を失った家は家督を継ぐ', () => {
  const s = game('oda', 3);
  s.provinces.owari.soldiers = 15000;
  // 斎藤義龍だけ美濃に残す
  for (const g of generalsIn(s, 'mino')) if (!g.lord) g.province = 'mino';
  s.provinces.mino.soldiers = 500;
  s.provinces.mino.defense = 10;
  const b = execute(s, { type: 'march', general: lord(s, 'oda').id, target: 'mino', soldiers: 12000 }).battle;
  while (!b.done) battleRound(s, b);
  assert.equal(b.result, 'win');
  assert.equal(s.daimyos.saito.alive, false, '一国の斎藤家は国を失って滅亡する');
});

// ------------------------------------------------------------------ 月の進行

test('月が進むと金が入り、兵糧が減り、9 月に収穫がある', () => {
  const s = game('oda');
  const gold = s.daimyos.oda.gold;
  const rice = s.daimyos.oda.rice;
  advanceMonth(s);
  assert.equal(s.month, 5);
  assert.equal(s.daimyos.oda.gold, gold + Math.round(s.provinces.owari.comm * 0.5));
  assert.equal(s.daimyos.oda.rice, rice - Math.ceil(s.provinces.owari.soldiers / 30));
  while (s.month !== 8) advanceMonth(s);
  const before = s.daimyos.oda.rice;
  advanceMonth(s); // 9 月になった瞬間に収穫される
  assert.equal(s.month, 9);
  assert.ok(s.daimyos.oda.rice > before + 1000, `収穫で米が増える (${before} -> ${s.daimyos.oda.rice})`);
});

test('12 月の次は翌年 1 月になり、武将は再び動ける', () => {
  const s = game('oda');
  const nobunaga = lord(s, 'oda');
  execute(s, { type: 'train', general: nobunaga.id });
  assert.ok(nobunaga.acted);
  s.month = 12;
  advanceMonth(s);
  assert.equal(s.year, 1561);
  assert.equal(s.month, 1);
  assert.ok(!nobunaga.acted);
});

test('米が尽きると兵が逃げ出す', () => {
  const s = game('oda');
  s.daimyos.oda.rice = 0;
  const soldiers = s.provinces.owari.soldiers;
  advanceMonth(s);
  assert.equal(s.daimyos.oda.rice, 0);
  assert.equal(s.provinces.owari.soldiers, Math.floor(soldiers * 0.9));
  assert.ok(s.log.some((l) => l.text.includes('兵糧が尽き')));
});

test('民忠がとても低いと一揆が起きることがある', () => {
  const s = game('oda', 9);
  s.provinces.owari.loyalty = 5;
  let happened = false;
  for (let i = 0; i < 30 && !happened; i++) {
    s.provinces.owari.loyalty = 5;
    advanceMonth(s);
    happened = s.log.some((l) => l.text.includes('一揆'));
  }
  assert.ok(happened);
});

// ------------------------------------------------------------------ 戦力の目安

test('城の防御が高いほど守りの戦力が上がる', () => {
  const s = game('oda');
  const a = defensePower(s, 'mino');
  s.provinces.mino.defense = 100;
  assert.ok(defensePower(s, 'mino') > a);
  const g = lord(s, 'oda');
  assert.ok(attackPower(1000, g, 100) > attackPower(1000, g, 0));
});

// ------------------------------------------------------------------ CPU

test('CPU は国ごとの命令を使い切り、プレイヤーの武将は動かさない', () => {
  const s = game('oda', 7);
  const before = provincesOf(s, 'takeda').map((p) => p.id);
  runAi(s);
  // 月の初めから持っていた国では命令を使い切る（その月に取った国や逃げ込んだ先は除く）
  for (const id of before) {
    if (s.provinces[id].owner !== 'takeda') continue;
    assert.equal(commandsLeft(s, id), 0, `${s.provinces[id].name} の命令が余っている`);
  }
  assert.ok(generalsOf(s, 'takeda').some((g) => g.acted));
  assert.ok(generalsOf(s, 'oda').every((g) => !g.acted));
  assert.equal(commandsLeft(s, 'owari'), LIMIT.commandsPerProvince);
});

test('CPU 同士で 10 年戦わせると国の取り合いが起きる', () => {
  const s = game('oda', 11);
  for (let i = 0; i < 120 && !s.ended; i++) { runAi(s, { includePlayer: true }); advanceMonth(s); }
  const neutral = Object.values(s.provinces).filter((p) => !p.owner).length;
  assert.ok(neutral < 11, '空白地が減っている');
  assert.ok(aliveDaimyos(s).length < DAIMYOS.length, '滅んだ家がある');
  const top = aliveDaimyos(s).map((d) => daimyoSummary(s, d.id)).sort((a, b) => b.score - a.score)[0];
  assert.ok(top.provinces >= 3);
  // 状態に矛盾がないこと
  for (const g of Object.values(s.generals)) {
    if (g.status !== 'active') continue;
    assert.equal(s.provinces[g.province].owner, g.daimyo, `${g.name} が他家の国にいる`);
    assert.ok(s.daimyos[g.daimyo].alive);
  }
  for (const p of Object.values(s.provinces)) assert.ok(p.soldiers >= 0);
});

// ------------------------------------------------------------------ 命令の回数・身分・探索・登場

test('ひとつの国で出せる命令は月 3 回まで', () => {
  const s = game('oda');
  const gs = generalsOf(s, 'oda').filter((g) => g.province === 'owari');
  assert.ok(gs.length >= 4);
  assert.equal(commandsLeft(s, 'owari'), LIMIT.commandsPerProvince);
  for (let i = 0; i < 3; i++) assert.ok(execute(s, { type: 'train', general: gs[i].id }).ok);
  assert.equal(commandsLeft(s, 'owari'), 0);
  const r = execute(s, { type: 'train', general: gs[3].id });
  assert.equal(r.ok, false);
  assert.match(r.text, /月 3 回/);
  assert.ok(commandList(s, gs[3].id).every((c) => !c.enabled));
  advanceMonth(s);
  assert.equal(commandsLeft(s, 'owari'), LIMIT.commandsPerProvince);
});

test('身分によって率いられる兵の上限が違い、超えると出陣できない', () => {
  const s = game('oda');
  const nobunaga = lord(s, 'oda');
  assert.equal(rankName(nobunaga), '当主');
  assert.equal(leadCap(nobunaga), 12000);
  const low = generalsOf(s, 'oda').find((g) => g.rank === 0);
  assert.ok(low, '足軽頭がいる');
  assert.equal(leadCap(low), RANKS[0].lead);
  s.provinces.owari.soldiers = 10000;
  const r = execute(s, { type: 'march', general: low.id, target: 'mikawa', soldiers: 5000 });
  assert.equal(r.ok, false);
  assert.match(r.text, /率いられる兵/);
  assert.ok(execute(s, { type: 'march', general: low.id, target: 'mikawa', soldiers: RANKS[0].lead }).ok);
});

test('功績がたまると昇進する', () => {
  const s = game('oda');
  const low = generalsOf(s, 'oda').find((g) => g.rank === 0);
  low.merit = RANKS[1].merit - 1;
  execute(s, { type: 'train', general: low.id });
  assert.equal(low.rank, 1);
  assert.equal(rankName(low), '侍大将');
  assert.ok(s.log.some((l) => l.text.includes(`${low.name}が侍大将に昇進`)));
});

test('探索で在野の武将を見つけて家臣にできる', () => {
  const s = game('oda', 2);
  const ronin = roninIn(s, 'owari');
  assert.ok(ronin.length > 0, '尾張に在野がいる');
  const before = generalsOf(s, 'oda').length;
  let joined = false;
  for (let i = 0; i < 40 && !joined; i++) {
    const g = generalsOf(s, 'oda').find((x) => !x.acted && x.province === 'owari');
    const r = execute(s, { type: 'explore', general: g.id });
    assert.ok(r.ok, r.text);
    joined = Boolean(r.joined);
    advanceMonth(s);
  }
  assert.ok(joined);
  assert.equal(generalsOf(s, 'oda').length, before + 1);
  assert.ok(s.log.some((l) => l.text.includes('家臣に迎えた')));
});

test('登場年を迎えた武将は家に仕官し、家が滅んでいれば在野になる', () => {
  const s = game('oda', 1);
  const masamune = Object.values(s.generals).find((g) => g.name === '伊達政宗');
  assert.equal(masamune.status, 'unborn');
  s.year = 1580; s.month = 12;
  advanceMonth(s);
  assert.equal(s.year, 1581);
  assert.equal(masamune.status, 'active');
  assert.equal(masamune.daimyo, 'date');
  assert.equal(masamune.province, 'mutsu');
  assert.ok(s.log.some((l) => l.text.includes('伊達政宗が元服')));

  const s2 = game('oda', 1);
  s2.daimyos.date.alive = false;
  const m2 = Object.values(s2.generals).find((g) => g.name === '伊達政宗');
  s2.year = 1581; s2.month = 1;
  advanceMonth(s2);
  assert.equal(m2.status, 'ronin');
  assert.equal(m2.daimyo, null);
});

test('家が滅ぶと家臣は在野になる', () => {
  const s = game('oda', 3);
  s.provinces.owari.soldiers = 15000;
  const before = roninIn(s, 'mikawa').length;
  const b = execute(s, { type: 'march', general: lord(s, 'oda').id, target: 'mikawa', soldiers: 12000 }).battle;
  while (!b.done) battleRound(s, b);
  assert.equal(s.daimyos.matsudaira.alive, false);
  for (const id of b.captured) releaseCaptured(s, id);
  assert.ok(roninIn(s, 'mikawa').length > before);
  assert.ok(Object.values(s.generals).every((g) => g.status !== 'gone'));
});

test('相手の家をすべて滅ぼすと天下統一になる', () => {
  const s = game('oda', 1);
  for (const d of Object.values(s.daimyos)) {
    if (d.id === 'oda') continue;
    d.alive = false;
  }
  s.daimyos.matsudaira.alive = true;
  s.provinces.mikawa.soldiers = 0;
  const b = execute(s, { type: 'march', general: lord(s, 'oda').id, target: 'mikawa', soldiers: 1000 }).battle;
  assert.ok(b.done);
  assert.equal(s.ended?.result, 'win');
});
