import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_LENGTH, MATCH_LENGTHS, POINTS,
  applyRound, createMatch, isOver, roundsLeft, standings, verdict, winners,
} from '../src/match.js';

const NAMES = ['あなた', 'リク', 'カイ', 'ミナ'];

/** 称号の並び（0位から）でラウンドを 1 つ進める。 */
const round = (match, order) => applyRound(
  match,
  order.map((index, i) => ({ index, title: ['大富豪', '富豪', '貧民', '大貧民'][i] })),
);

test('称号のポイントは 3 / 2 / 1 / 0', () => {
  assert.deepEqual(POINTS, { 大富豪: 3, 富豪: 2, 貧民: 1, 大貧民: 0 });
});

test('はじめは全員 0 点で、まだ決着していない', () => {
  const m = createMatch(5);
  assert.deepEqual(m.scores, [0, 0, 0, 0]);
  assert.equal(m.played, 0);
  assert.equal(isOver(m), false);
  assert.equal(roundsLeft(m), 5);
});

test('知らないラウンド数を渡されても既定に戻す', () => {
  assert.equal(createMatch(7).rounds, DEFAULT_LENGTH);
  assert.equal(createMatch().rounds, DEFAULT_LENGTH);
  for (const n of MATCH_LENGTHS) assert.equal(createMatch(n).rounds, n);
});

test('ラウンドを重ねるとポイントがたまる', () => {
  const m = createMatch(3);
  round(m, [1, 0, 2, 3]);   // リクが大富豪、あなたが富豪
  assert.deepEqual(m.scores, [2, 3, 1, 0]);
  round(m, [0, 1, 3, 2]);
  assert.deepEqual(m.scores, [5, 5, 1, 1]);
  assert.equal(m.played, 2);
  assert.equal(roundsLeft(m), 1);
  assert.equal(isOver(m), false);
});

test('決めたラウンド数をこなすと決着する', () => {
  const m = createMatch(3);
  for (let i = 0; i < 3; i++) round(m, [0, 1, 2, 3]);
  assert.equal(isOver(m), true);
  assert.equal(roundsLeft(m), 0);
});

test('総合順位はポイントの多い順', () => {
  const m = createMatch(3);
  round(m, [1, 0, 2, 3]);   // リク3 / あなた2 / カイ1 / ミナ0
  round(m, [1, 2, 0, 3]);   // リク6 / カイ3 / あなた3 / ミナ0
  const rows = standings(m);
  assert.deepEqual(rows.map((r) => r.points), [6, 3, 3, 0]);
  assert.equal(rows[0].index, 1);
  // あなたとカイは称号の内訳まで同じなので同順位、次は 4 位から
  assert.deepEqual(rows.map((r) => r.rank), [1, 2, 2, 4]);
  assert.deepEqual(winners(m).map((r) => r.index), [1]);
});

test('順位は飛び番になる（2位が2人なら次は4位）', () => {
  const m = createMatch(3);
  round(m, [1, 0, 2, 3]);
  round(m, [1, 2, 0, 3]);
  assert.deepEqual(standings(m).map((r) => r.rank), [1, 2, 2, 4]);
});

test('同点なら大富豪の回数が多いほうが上', () => {
  const m = createMatch(4);
  // あなた：大富豪1 + 大貧民1 = 3pt、リク：富豪1 + 貧民1 = 3pt
  round(m, [0, 1, 2, 3]);
  round(m, [2, 3, 1, 0]);
  const rows = standings(m);
  const you = rows.find((r) => r.index === 0);
  const riku = rows.find((r) => r.index === 1);
  assert.equal(you.points, riku.points, '前提：同点であること');
  assert.ok(you.rank < riku.rank, '大富豪を取ったほうが上にならない');
  assert.equal(you.tied, false);
});

test('まったく同じ成績なら同順位になる', () => {
  const m = createMatch(4);
  round(m, [0, 1, 2, 3]);
  round(m, [1, 0, 3, 2]);
  const rows = standings(m);
  const top = rows.filter((r) => r.rank === 1);
  assert.equal(top.length, 2, '同じ成績の 2 人が 1 位になっていない');
  assert.ok(top.every((r) => r.tied));
  assert.deepEqual(rows.map((r) => r.rank), [1, 1, 3, 3]);
});

test('優勝者の読み上げ文', () => {
  const m = createMatch(3);
  round(m, [1, 0, 2, 3]);
  assert.equal(verdict(m, NAMES), 'リク の優勝！（3pt）');

  const tie = createMatch(3);
  round(tie, [0, 1, 2, 3]);
  round(tie, [1, 0, 3, 2]);
  assert.match(verdict(tie, NAMES), /あなた と リク が同点で優勝！（5pt）/);
});

test('全員が 0 点でも順位はつく（同順位）', () => {
  const m = createMatch(3);
  const rows = standings(m);
  assert.equal(rows.length, 4);
  assert.ok(rows.every((r) => r.rank === 1 && r.tied));
});

test('人数を変えても動く', () => {
  const m = createMatch(3, 3);
  assert.deepEqual(m.scores, [0, 0, 0]);
  applyRound(m, [{ index: 2, title: '大富豪' }, { index: 0, title: '富豪' }, { index: 1, title: '大貧民' }]);
  assert.deepEqual(standings(m).map((r) => r.index), [2, 0, 1]);
});
