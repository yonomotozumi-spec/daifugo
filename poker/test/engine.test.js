import test from 'node:test';
import assert from 'node:assert/strict';

import { PHASE, STREET, Table } from '../src/engine.js';
import { mulberry32 } from '../src/hand.js';
import { decide } from '../src/ai.js';

const card = (text) => {
  const suit = text[0];
  const rank = { T: 10, J: 11, Q: 12, K: 13, A: 14 }[text[1]] ?? Number(text.slice(1));
  return { id: `${suit}${rank}`, suit, rank };
};
const hand = (text) => text.split(' ').map(card);
// ハンド中は場に出ているぶん（ポット）を足す。ハンドが終われば全部スタックに戻っている。
const chipTotal = (t) =>
  t.players.reduce((sum, p) => sum + p.chips, 0) + (t.phase === PHASE.BETTING ? t.pot : 0);

function table(names, options = {}) {
  return new Table({ playerNames: names, rng: mulberry32(1), options });
}

/** 手札とボードを固定したハンドを作る。ボードは "f1 f2 f3 turn river" の 5 枚。 */
function rigged(holes, board, options = {}) {
  const t = table(holes.map((_, i) => `P${i}`), options);
  t.startHand();
  holes.forEach((text, i) => { t.players[i].hole = hand(text); });
  const b = hand(board);
  // 場に出るのは配列の末尾から。フロップ→ターン→リバーの順に取り出される。
  t.deck = [...hand('c2 c3 c4 c5 c6'), b[4], b[3], b[0], b[1], b[2]];
  return t;
}

// ---------------------------------------------------------------- 席とブラインド

test('4 人ならボタンの左が SB、その左が BB、最初の手番は BB の左', () => {
  const t = table(['A', 'B', 'C', 'D']);
  t.startHand();
  assert.equal(t.players[t.button].name, 'A');
  assert.equal(t.players[1].committed, 50, 'B が SB');
  assert.equal(t.players[2].committed, 100, 'C が BB');
  assert.equal(t.current.name, 'D', '最初の手番は BB の左');
  assert.equal(t.pot, 150);
});

test('ヘッズアップではボタンが SB で、プリフロップの先手番になる', () => {
  const t = table(['A', 'B']);
  t.startHand();
  assert.equal(t.players[t.button].committed, 50, 'ボタンが SB');
  assert.equal(t.toAct, t.button, 'ボタンから動く');
});

// ---------------------------------------------------------------- ベッティング

test('BB まで全員が降りるとブラインドを総取りする', () => {
  const t = table(['A', 'B', 'C', 'D']);
  t.startHand();
  const before = chipTotal(t);
  t.act(3, { type: 'fold' });
  t.act(0, { type: 'fold' });
  t.act(1, { type: 'fold' });
  assert.equal(t.phase, PHASE.HAND_END);
  assert.equal(t.players[2].chips, 10000 + 50, 'BB が SB のぶんだけ増える');
  assert.equal(chipTotal(t), before);
});

test('全員コールでフロップに進み、ボタンの左から動き出す', () => {
  const t = table(['A', 'B', 'C', 'D']);
  t.startHand();
  t.act(3, { type: 'call' });
  t.act(0, { type: 'call' });
  t.act(1, { type: 'call' });
  assert.equal(t.street, STREET.PREFLOP, 'BB にはまだオプションが残る');
  t.act(2, { type: 'check' });
  assert.equal(t.street, STREET.FLOP);
  assert.equal(t.community.length, 3);
  assert.equal(t.current.name, 'B', 'ボタン A の左は B');
  assert.equal(t.pot, 400);
});

test('レイズが入ると、すでにコールした人にも手番が戻る', () => {
  const t = table(['A', 'B', 'C', 'D']);
  t.startHand();
  t.act(3, { type: 'call' });
  t.act(0, { type: 'raise', amount: 300 });
  assert.equal(t.currentBet, 300);
  assert.equal(t.toAct, 1);
  t.act(1, { type: 'fold' });
  t.act(2, { type: 'fold' });
  assert.equal(t.toAct, 3, 'コール済みの D がもう一度手番になる');
  assert.equal(t.street, STREET.PREFLOP);
});

test('最低レイズ額を下回る指定は最低額まで引き上げられる', () => {
  const t = table(['A', 'B', 'C', 'D']);
  t.startHand();
  const legal = t.legalActions(3);
  assert.equal(legal.minRaiseTo, 200);
  t.act(3, { type: 'raise', amount: 120 });
  assert.equal(t.players[3].streetBet, 200, '最低額の 200 に切り上げ');
});

test('誰もコールできない額まではレイズできない', () => {
  const t = table(['A', 'B'], { startingChips: 500 });
  t.startHand();
  t.players[1].chips = 200; // 相手は 200 + 既出の 100 までしか出せない
  const legal = t.legalActions(t.toAct);
  assert.equal(legal.maxRaiseTo, 300, '相手が出せる上限で頭打ちになる');
});

test('チェックできない場面ではチェックが弾かれる', () => {
  const t = table(['A', 'B', 'C', 'D']);
  t.startHand();
  const result = t.act(3, { type: 'check' });
  assert.equal(result.ok, false);
  assert.equal(t.toAct, 3, '手番は移らない');
});

test('手番でないプレイヤーの着手は通らない', () => {
  const t = table(['A', 'B', 'C', 'D']);
  t.startHand();
  assert.equal(t.act(0, { type: 'fold' }).ok, false);
});

// ---------------------------------------------------------------- ポット

test('オールインの額に応じてメインポットとサイドポットに分かれる', () => {
  const t = table(['A', 'B', 'C', 'D']);
  t.startHand();
  const amounts = [1000, 3000, 3000, 500];
  t.players.forEach((p, i) => { p.committed = amounts[i]; p.folded = i === 3; });

  const pots = t.buildPots();
  assert.equal(pots.length, 3);
  assert.deepEqual(pots.map((p) => p.amount), [2000, 1500, 4000]);
  assert.deepEqual(pots[0].eligible, [0, 1, 2], '降りた D は取り分なし');
  assert.deepEqual(pots[1].eligible, [0, 1, 2]);
  assert.deepEqual(pots[2].eligible, [1, 2], '1000 で止まった A は届かない');
  assert.equal(pots.reduce((s, p) => s + p.amount, 0), 7500);
});

// ---------------------------------------------------------------- ショーダウン

test('強い手がポットを取る', () => {
  const t = rigged(['hA dA', 'hK dK'], 'c2 d7 s9 hJ c4');
  t.act(t.toAct, { type: 'raise', amount: 10000 });
  t.act(t.toAct, { type: 'call' });
  assert.equal(t.phase, PHASE.GAME_OVER);
  assert.equal(t.players[0].chips, 20000, 'AA が総取り');
  assert.equal(t.players[1].chips, 0);
});

test('ボードで役が決まると引き分けになる', () => {
  const t = rigged(['h2 d3', 'h4 d5'], 'sA sK sQ sJ sT');
  t.act(t.toAct, { type: 'raise', amount: 10000 });
  t.act(t.toAct, { type: 'call' });
  assert.equal(t.players[0].chips, 10000, '半分ずつ戻る');
  assert.equal(t.players[1].chips, 10000);
});

test('割り切れないポットの端数は 1 チップだけずれる', () => {
  const t = rigged(['h2 d3', 'h4 d5'], 'sA sK sQ sJ sT', { startingChips: 75, smallBlind: 5, bigBlind: 10 });
  t.act(t.toAct, { type: 'raise', amount: 75 });
  t.act(t.toAct, { type: 'call' });
  const [a, b] = t.players.map((p) => p.chips);
  assert.equal(a + b, 150, 'チップの総量は変わらない');
  assert.equal(Math.abs(a - b), 0, '150 は 2 人で割り切れる');
});

test('サイドポットつきのショーダウンでチップが増減しない', () => {
  const t = rigged(['hA dA', 'hK dK', 'h2 d2', 'h7 d8'], 'c9 dT sJ hQ c3');
  t.players[0].chips = 1000 - t.players[0].committed;
  t.players[1].chips = 4000 - t.players[1].committed;
  const before = chipTotal(t);
  let guard = 0;
  while (t.phase === PHASE.BETTING) {
    if (++guard > 100) assert.fail('ハンドが終わらない');
    const legal = t.legalActions(t.toAct);
    t.act(t.toAct, legal.canRaise ? { type: 'raise', amount: legal.maxRaiseTo } : { type: 'call' });
  }
  assert.equal(chipTotal(t), before, 'チップの総量は変わらない');
  assert.ok(t.showdown, 'ショーダウンまで進んでいる');
});

// ---------------------------------------------------------------- 通し

test('CPU 同士で決着までプレイしてもチップが増減しない', () => {
  for (let seed = 1; seed <= 4; seed++) {
    const t = new Table({ rng: mulberry32(seed) });
    let hands = 0;
    while (t.phase !== PHASE.GAME_OVER) {
      assert.ok(++hands < 400, '決着がつかない');
      t.startHand();
      let guard = 0;
      while (t.phase === PHASE.BETTING) {
        assert.ok(++guard < 300, 'ベッティングが終わらない');
        const move = decide(t, t.toAct);
        const result = t.act(t.toAct, move);
        assert.ok(result.ok, `CPU が反則手を選んだ: ${result.reason}`);
      }
      assert.equal(chipTotal(t), 40000, 'チップの総量は変わらない');
      assert.ok(t.players.every((p) => p.chips >= 0), 'マイナスのチップはない');
    }
    assert.equal(t.players.filter((p) => !p.out).length, 1, '生き残りは 1 人');
  }
});
