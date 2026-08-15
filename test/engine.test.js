import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_RULES, Game, PHASE, canPlay, createDeck, enumerateCombos,
  mulberry32, parseCombo, sortHand,
} from '../src/engine.js';
import { decide } from '../src/ai.js';

const deck = createDeck();
const card = (id) => {
  const found = deck.find((c) => c.id === id);
  if (!found) throw new Error(`unknown card: ${id}`);
  return found;
};
const jokers = deck.filter((c) => c.joker);
const hand = (...ids) => ids.map(card);

const state = (over = {}) => ({
  field: null, revolution: false, lock: null, rules: DEFAULT_RULES, ...over,
});
const field = (cards) => ({ combo: parseCombo(cards), playerIndex: 0 });

// ------------------------------------------------------------------ デッキ

test('デッキは 52 枚 + ジョーカー 2 枚で、ID が重複しない', () => {
  assert.equal(deck.length, 54);
  assert.equal(new Set(deck.map((c) => c.id)).size, 54);
  assert.equal(deck.filter((c) => c.joker).length, 2);
});

test('手札のソートは革命で逆順になる', () => {
  const h = hand('s15', 's3', 's8');
  assert.deepEqual(sortHand(h, false).map((c) => c.rank), [3, 8, 15]);
  assert.deepEqual(sortHand(h, true).map((c) => c.rank), [15, 8, 3]);
});

// ------------------------------------------------------------------ 役の判定

test('同ランクの組は枚数どおりに成立する', () => {
  assert.equal(parseCombo(hand('s7')).count, 1);
  assert.equal(parseCombo(hand('s7', 'h7')).count, 2);
  assert.equal(parseCombo(hand('s7', 'h7', 'd7', 'c7')).count, 4);
  assert.equal(parseCombo(hand('s7', 'h8')), null);
});

test('ジョーカーは同ランクの組のワイルドになる', () => {
  const combo = parseCombo([card('s7'), jokers[0]]);
  assert.equal(combo.type, 'set');
  assert.equal(combo.rank, 7);
  assert.equal(combo.count, 2);
  assert.equal(combo.jokerCount, 1);
});

test('ジョーカーだけの手は常に最強として扱われる', () => {
  const combo = parseCombo(jokers.slice(0, 1));
  assert.equal(combo.allJoker, true);
  assert.ok(canPlay(combo, state({ field: field(hand('s15')) })).ok);
});

test('階段は同じスートの 3 枚以上の連番', () => {
  const combo = parseCombo(hand('h5', 'h6', 'h7'));
  assert.equal(combo.type, 'sequence');
  assert.equal(combo.rank, 7);
  assert.equal(combo.low, 5);
  assert.equal(parseCombo(hand('h5', 'h6', 'd7')), null, 'スートが混ざったら不成立');
  assert.equal(parseCombo(hand('h5', 'h6', 'h8')), null, '連番でなければ不成立');
  assert.equal(parseCombo(hand('h5', 'h6')), null, '2 枚では階段にならない');
});

test('階段のジョーカーは穴埋めにだけ使える', () => {
  const filled = parseCombo([card('h5'), jokers[0], card('h7')]);
  assert.equal(filled.type, 'sequence');
  assert.equal(filled.rank, 7);
  // 端をジョーカーにすると 5-6-7 とも 6-7-8 とも読めてしまうので不成立にする。
  assert.equal(parseCombo([card('h6'), card('h7'), jokers[0]]), null);
});

test('階段オフのルールでは階段が成立しない', () => {
  assert.equal(parseCombo(hand('h5', 'h6', 'h7'), { ...DEFAULT_RULES, sequence: false }), null);
});

// ------------------------------------------------------------------ 出せるかどうか

test('場より強い同じ枚数・同じ種類しか出せない', () => {
  const s = state({ field: field(hand('s7', 'h7')) });
  assert.ok(canPlay(parseCombo(hand('d9', 'c9')), s).ok);
  assert.ok(!canPlay(parseCombo(hand('d5', 'c5')), s).ok, '弱い手は通らない');
  assert.ok(!canPlay(parseCombo(hand('d9')), s).ok, '枚数違いは通らない');
  assert.ok(!canPlay(parseCombo(hand('h9', 'h10', 'h11')), s).ok, '種類違いは通らない');
});

test('革命中は弱いカードのほうが強い', () => {
  const s = state({ field: field(hand('s7')), revolution: true });
  assert.ok(canPlay(parseCombo(hand('d5')), s).ok);
  assert.ok(!canPlay(parseCombo(hand('d9')), s).ok);
});

test('スペ3返しでジョーカー 1 枚に勝てる', () => {
  const s = state({ field: field(jokers.slice(0, 1)) });
  assert.ok(canPlay(parseCombo(hand('s3')), s).ok);
  assert.ok(!canPlay(parseCombo(hand('h3')), s).ok, '♠以外の 3 では返せない');
  assert.ok(!canPlay(parseCombo(hand('s3')), { ...s, rules: { ...DEFAULT_RULES, spade3: false } }).ok);
});

test('縛り中は同じスートしか出せない', () => {
  const s = state({ field: field(hand('h7')), lock: 'h' });
  assert.ok(canPlay(parseCombo(hand('h9')), s).ok);
  assert.ok(!canPlay(parseCombo(hand('s9')), s).ok);
});

// ------------------------------------------------------------------ 候補手の列挙

test('列挙した候補はすべて役として成立している', () => {
  const combos = enumerateCombos(hand('s3', 'h3', 's4', 's5', 's6').concat(jokers[0]));
  assert.ok(combos.length > 0);
  for (const combo of combos) assert.ok(parseCombo(combo.cards), '成立しない候補が混ざっている');
  assert.ok(combos.some((c) => c.type === 'sequence' && c.count === 4), 's3-s4-s5-s6 の階段が候補にある');
  assert.ok(combos.some((c) => c.type === 'set' && c.rank === 3 && c.count === 3), '3 のペア + ジョーカーが候補にある');
});

// ------------------------------------------------------------------ ゲーム進行

function makeGame(hands, over = {}) {
  const game = new Game({ rng: mulberry32(1) });
  hands.forEach((ids, i) => { game.players[i].hand = hand(...ids); });
  game.field = null;
  game.lock = null;
  game.revolution = false;
  game.passed = new Set();
  game.finishOrder = [];
  game.phase = PHASE.PLAYING;
  game.turn = 0;
  Object.assign(game, over);
  return game;
}

test('手番でないプレイヤーは着手できない', () => {
  const game = makeGame([['s3'], ['s4'], ['s5'], ['s6']]);
  assert.equal(game.play(1, hand('s4')).ok, false);
});

test('場が空のときはパスできない', () => {
  const game = makeGame([['s3'], ['s4'], ['s5'], ['s6']]);
  assert.equal(game.pass(0).ok, false);
});

test('全員パスすると場が流れ、最後に出した人の番に戻る', () => {
  const game = makeGame([['s15', 's3'], ['s4'], ['s5'], ['s6']]);
  assert.ok(game.play(0, hand('s15')).ok);
  assert.equal(game.turn, 1);
  game.pass(1); game.pass(2); game.pass(3);
  assert.equal(game.field, null, '場が流れている');
  assert.equal(game.turn, 0, '最後に出した人が親に戻る');
});

test('8 切りで場が流れ、同じプレイヤーが続けて出せる', () => {
  const game = makeGame([['s8', 's3'], ['h9'], ['d9'], ['c9']]);
  const result = game.play(0, hand('s8'));
  assert.ok(result.events.includes('eightCut'));
  assert.equal(game.field, null);
  assert.equal(game.turn, 0);
});

test('同ランク 4 枚で革命が起き、もう一度で戻る', () => {
  const game = makeGame([['s7', 'h7', 'd7', 'c7'], ['h9'], ['d9'], ['c9']]);
  assert.ok(game.play(0, hand('s7', 'h7', 'd7', 'c7')).ok);
  assert.equal(game.revolution, true);

  const game2 = makeGame([['s7', 'h7', 'd7', 'c7'], ['h9'], ['d9'], ['c9']], { revolution: true });
  game2.play(0, hand('s7', 'h7', 'd7', 'c7'));
  assert.equal(game2.revolution, false);
});

test('同じスートが 2 回続くと縛りが発生する', () => {
  const game = makeGame([['h5'], ['h9'], ['s10'], ['c10']]);
  game.play(0, hand('h5'));
  const result = game.play(1, hand('h9'));
  assert.ok(result.events.includes('lock'));
  assert.equal(game.lock, 'h');
  assert.equal(game.play(2, hand('s10')).ok, false, '別スートは縛られて出せない');
});

test('あがった順に称号がつき、ラウンドが終わる', () => {
  const game = makeGame([['s3'], ['s4'], ['s5'], ['s6', 's7']]);
  game.play(0, hand('s3'));
  game.play(1, hand('s4'));
  game.play(2, hand('s5'));
  assert.equal(game.phase, PHASE.ROUND_END);
  assert.deepEqual(game.players.map((p) => p.title), ['大富豪', '富豪', '貧民', '大貧民']);
});

test('カード交換で大貧民の最強カードが大富豪に渡る', () => {
  const game = new Game({ rng: mulberry32(7) });
  game.players[0].title = '大富豪';
  game.players[1].title = '富豪';
  game.players[2].title = '貧民';
  game.players[3].title = '大貧民';
  game.startRound();

  assert.equal(game.phase, PHASE.EXCHANGE);
  const tribute = game.autoTribute(3, 2).map((c) => c.id);
  const give = game.autoGive(0, 2).map((c) => c.id);
  game.commitExchange();

  assert.ok(tribute.every((id) => game.players[0].hand.some((c) => c.id === id)), '献上カードが大富豪の手札にある');
  assert.ok(give.every((id) => game.players[3].hand.some((c) => c.id === id)), '大富豪が渡したカードが大貧民の手札にある');
  assert.equal(game.players[0].hand.length, 14);
  assert.equal(game.players[3].hand.length, 13);
  assert.equal(game.phase, PHASE.PLAYING);
});

// ------------------------------------------------------------------ 通し

test('CPU 同士で 5 ラウンド回しても破綻しない', () => {
  for (let seed = 1; seed <= 5; seed++) {
    const game = new Game({ rng: mulberry32(seed) });
    for (let round = 0; round < 5; round++) {
      if (game.phase === PHASE.EXCHANGE) game.commitExchange();
      let guard = 0;
      while (game.phase === PHASE.PLAYING) {
        if (++guard > 2000) assert.fail('ラウンドが終わらない');
        const move = decide(game, game.turn);
        const before = game.turn;
        const result = move.action === 'pass' ? game.pass(before) : game.play(before, move.cards);
        assert.ok(result.ok, `CPU が非合法手を選んだ: ${result.reason}`);
      }
      assert.equal(game.finishOrder.length, 4);
      assert.equal(new Set(game.finishOrder).size, 4);
      // 3 人があがった時点で終わるので、残るのは大貧民の手札だけ。
      const holders = game.players.filter((p) => p.hand.length > 0);
      assert.ok(holders.length <= 1);
      if (holders.length === 1) assert.equal(holders[0].title, '大貧民');
      game.startRound();
    }
  }
});
