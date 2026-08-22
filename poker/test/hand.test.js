import test from 'node:test';
import assert from 'node:assert/strict';

import { CATEGORY, createDeck, evaluate } from '../src/hand.js';

const card = (text) => {
  const suit = text[0];
  const rank = { T: 10, J: 11, Q: 12, K: 13, A: 14 }[text[1]] ?? Number(text.slice(1));
  return { id: `${suit}${rank}`, suit, rank };
};
const hand = (text) => text.split(' ').map(card);
const rank = (text) => evaluate(hand(text));

test('デッキは 52 枚で重複がない', () => {
  const deck = createDeck();
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck.map((c) => c.id)).size, 52);
});

test('役のカテゴリを正しく判定する', () => {
  assert.equal(rank('sA sK sQ sJ sT h2 d3').category, CATEGORY.STRAIGHT_FLUSH);
  assert.equal(rank('h7 h6 h5 h4 h3 sA dK').category, CATEGORY.STRAIGHT_FLUSH);
  assert.equal(rank('hA dA cA sA h2 d3 c4').category, CATEGORY.QUADS);
  assert.equal(rank('h9 d9 c9 s2 h2 d3 c4').category, CATEGORY.FULL_HOUSE);
  assert.equal(rank('h2 h5 h9 hJ hK s3 d4').category, CATEGORY.FLUSH);
  assert.equal(rank('h9 d8 c7 s6 h5 d3 c2').category, CATEGORY.STRAIGHT);
  assert.equal(rank('h9 d9 c9 s2 h5 d3 c4').category, CATEGORY.TRIPS);
  assert.equal(rank('h9 d9 c5 s5 h2 d3 c7').category, CATEGORY.TWO_PAIR);
  assert.equal(rank('h9 d9 c5 s2 hT d3 c7').category, CATEGORY.PAIR);
  assert.equal(rank('h9 d7 c5 s2 hT d3 cQ').category, CATEGORY.HIGH_CARD);
});

test('A-2-3-4-5 は 5 ハイのストレートとして扱う', () => {
  const wheel = rank('hA d2 c3 s4 h5 dK cQ');
  assert.equal(wheel.category, CATEGORY.STRAIGHT);
  assert.equal(wheel.ranks[0], 5, 'A ハイではなく 5 ハイ');
  // 同じ 5 枚がスーテッドならストレートフラッシュ
  assert.equal(rank('sA s2 s3 s4 s5 h9 d9').category, CATEGORY.STRAIGHT_FLUSH);
});

test('ロイヤルフラッシュに名前がつく', () => {
  assert.equal(rank('sA sK sQ sJ sT h2 d3').name, 'ロイヤルフラッシュ');
  assert.equal(rank('sK sQ sJ sT s9 h2 d3').name, 'ストレートフラッシュ（Kハイ）');
});

test('7 枚から最強の 5 枚を選ぶ', () => {
  // ツーペアではなくフラッシュを選ぶ
  assert.equal(rank('h2 h5 h9 hJ hK s9 d5').category, CATEGORY.FLUSH);
  // スリーカード 2 組はフルハウスになり、大きいほうが 3 枚側
  const boat = rank('h9 d9 c9 s5 h5 d5 c2');
  assert.equal(boat.category, CATEGORY.FULL_HOUSE);
  assert.deepEqual(boat.ranks.slice(0, 2), [9, 5]);
  // 3 組ペアがあるときは上位 2 組＋最高キッカー
  const twoPair = rank('h9 d9 c5 s5 h2 d2 cA');
  assert.deepEqual(twoPair.ranks.slice(0, 3), [9, 5, 14]);
});

test('フラッシュは同じスートの上位 5 枚で比べる', () => {
  const six = rank('h2 h5 h9 hJ hK h7 d3');
  assert.deepEqual(six.ranks, [13, 11, 9, 7, 5], '2 は落ちる');
});

test('キッカーで優劣がつく', () => {
  assert.ok(rank('hA dA c9 s7 h2').score > rank('hA dA c8 s7 h2').score, '第 1 キッカーで決まる');
  assert.ok(rank('hK dK c2 s3 h4 d6 c7').score > rank('hQ dQ cA sK hJ d9 c8').score, 'ペアの大きさが優先');
  assert.equal(rank('hA dA c9 s7 h2').score, rank('sA cA h9 d7 s2').score, 'スートは強さに関係ない');
});

test('A から始まる 4 枚に低いカードが揃うとストレートになる', () => {
  // A-2-3-4-5 が成立するので、A のペアではなく 5 ハイのストレート
  const result = rank('hA dA c9 s5 h2 d3 c4');
  assert.equal(result.category, CATEGORY.STRAIGHT);
  assert.equal(result.ranks[0], 5);
});

test('カテゴリの強さは順序どおり', () => {
  const ordered = [
    'h9 d7 c5 s2 hT d3 cQ', 'h9 d9 c5 s2 hT d3 c7', 'h9 d9 c5 s5 h2 d3 c7',
    'h9 d9 c9 s2 h5 d3 c4', 'h9 d8 c7 s6 h5 d3 c2', 'h2 h5 h9 hJ hK s3 d4',
    'h9 d9 c9 s2 h2 d3 c4', 'hA dA cA sA h2 d3 c4', 'sA sK sQ sJ sT h2 d3',
  ].map((text) => rank(text).score);
  for (let i = 1; i < ordered.length; i++) {
    assert.ok(ordered[i] > ordered[i - 1], `${i} 番目のほうが強いはず`);
  }
});
