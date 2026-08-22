/**
 * CPU の思考。手札の勝率をモンテカルロで見積もり、ポットオッズと突き合わせて決める。
 * 性格ごとに強気さとブラフ頻度を変えてあるので、3 人が同じ打ち方にはならない。
 */

import { createDeck, evaluate } from './hand.js';

export const PERSONALITIES = [
  { key: 'tight', label: 'タイト', aggression: 0.85, bluff: 0.05, margin: 0.05 },
  { key: 'solid', label: 'バランス', aggression: 1.0, bluff: 0.12, margin: 0.02 },
  { key: 'loose', label: 'ルース', aggression: 1.3, bluff: 0.24, margin: -0.03 },
];

/**
 * 自分の勝率をモンテカルロで見積もる。
 * 残りのボードと相手の手札をランダムに配り、勝ち 1 点・n 人で分け合ったら 1/n 点で平均する。
 */
export function equity(hole, community, opponents, iterations = 400, rng = Math.random) {
  if (opponents <= 0) return 1;
  const known = new Set([...hole, ...community].map((c) => c.id));
  const rest = createDeck().filter((c) => !known.has(c.id));
  const boardNeeded = 5 - community.length;
  const draw = boardNeeded + opponents * 2;
  let total = 0;

  for (let i = 0; i < iterations; i++) {
    for (let k = 0; k < draw; k++) {
      const j = k + Math.floor(rng() * (rest.length - k));
      const tmp = rest[k]; rest[k] = rest[j]; rest[j] = tmp;
    }
    const board = community.concat(rest.slice(0, boardNeeded));
    const mine = evaluate(hole.concat(board)).score;

    let best = -1;
    let tied = 0;
    for (let o = 0; o < opponents; o++) {
      const offset = boardNeeded + o * 2;
      const score = evaluate([rest[offset], rest[offset + 1], ...board]).score;
      if (score > best) { best = score; tied = 1; }
      else if (score === best) tied += 1;
    }
    if (mine > best) total += 1;
    else if (mine === best) total += 1 / (tied + 1);
  }
  return total / iterations;
}

const round = (value, unit) => Math.max(unit, Math.round(value / unit) * unit);

/**
 * 手番の CPU の着手を決める。
 * 返り値は { type: 'fold' | 'check' | 'call' | 'raise', amount?, equity }。
 */
export function decide(table, index = table.toAct, style = personalityFor(index)) {
  const player = table.players[index];
  const legal = table.legalActions(index);
  const rng = table.rng;
  const opponents = table.contenders().length - 1;
  const iterations = table.street === 'preflop' ? 300 : 500;
  const eq = equity(player.hole, table.community, opponents, iterations, rng);

  const pot = table.pot;
  const toCall = legal.callAmount;
  const unit = table.smallBlind;

  // 誰もベットしていない：チェックか、こちらから仕掛けるか。
  if (toCall === 0) {
    const wantsValue = eq >= 0.58 / style.aggression;
    const bluffs = legal.canRaise && rng() < style.bluff;
    if ((wantsValue || bluffs) && legal.canRaise) {
      const fraction = wantsValue ? 0.5 + rng() * 0.35 : 0.4 + rng() * 0.2;
      const target = round(Math.max(pot, table.bigBlind * 2) * fraction, unit);
      const amount = Math.min(Math.max(target, legal.minRaiseTo), legal.maxRaiseTo);
      return { type: 'raise', amount, equity: eq };
    }
    return { type: 'check', equity: eq };
  }

  // ベットに対して：オッズが合うか。
  const potOdds = toCall / (pot + toCall);
  const allInCall = toCall >= player.chips;
  const needed = potOdds - style.margin + (allInCall ? 0.06 : 0); // 全部乗せるなら少し慎重に

  if (eq < needed) {
    // 相手のベットが小さければ、少し不利でも見てみる。
    if (toCall <= table.bigBlind && eq > 0.2 && !allInCall) return { type: 'call', equity: eq };
    return { type: 'fold', equity: eq };
  }

  const canReraise = legal.canRaise && legal.minRaiseTo > table.currentBet;
  if (canReraise && eq > 0.72 && rng() < 0.75 * style.aggression) {
    const target = round((pot + toCall * 2) * (0.6 + rng() * 0.4), unit);
    const amount = Math.min(Math.max(target, legal.minRaiseTo), legal.maxRaiseTo);
    return { type: 'raise', amount, equity: eq };
  }
  return { type: 'call', equity: eq };
}

export function personalityFor(index) {
  return PERSONALITIES[(index - 1 + PERSONALITIES.length) % PERSONALITIES.length];
}
