/**
 * CPU の思考ルーチン。
 * 「弱い手から順に処理し、ジョーカーと 2 は最後まで温存する」という
 * 人間のセオリーをスコア化しただけの、素直な貪欲アルゴリズム。
 */

import { JOKER_RANK, hasEight, isRevolutionPlay } from './engine.js';

/** 革命を考慮した実質的な強さ（3 が最弱で 0、2 が最強で 12、ジョーカーは別枠）。 */
function power(combo, revolution) {
  if (combo.allJoker) return 20;
  return revolution ? JOKER_RANK - combo.rank : combo.rank - 3;
}

/** その役を出すことで、手札に残っている「同じランクの組」を崩してしまう度合い。 */
function breakupPenalty(combo, hand) {
  if (combo.type === 'sequence') return 0;
  const rank = combo.rank;
  const owned = hand.filter((c) => !c.joker && c.rank === rank).length;
  const used = combo.cards.filter((c) => !c.joker).length;
  const left = owned - used;
  return left > 0 && used > 0 ? left * 2.5 : 0;
}

function score(combo, ctx) {
  const { hand, revolution, rules, leading, opponentsLeft } = ctx;
  let value = power(combo, revolution);

  value += combo.jokerCount * 7;
  value += breakupPenalty(combo, hand);
  value -= combo.count * 1.4; // 枚数を減らせる手は歓迎

  if (rules.eightCut && hasEight(combo)) value -= leading ? 1 : 4;
  if (isRevolutionPlay(combo, rules)) value -= revolution ? 1 : 3;

  const remaining = hand.length - combo.count;
  if (remaining === 0) value -= 1000;            // あがり最優先
  else if (remaining <= 2) value -= 6;           // 残り少ないなら攻める
  if (opponentsLeft <= 1) value -= 4;            // 一騎打ちなら出し惜しみしない

  return value;
}

/** 温存したい強い手か（序盤に単騎で切りたくないカード）。 */
function isPremium(combo, revolution) {
  return combo.allJoker || power(combo, revolution) >= 12;
}

/**
 * 手番の CPU の着手を決める。
 * 返り値は { action: 'play', cards } か { action: 'pass' }。
 */
export function decide(game, playerIndex = game.turn) {
  const player = game.players[playerIndex];
  const legal = game.legalPlays(playerIndex);
  if (legal.length === 0) return { action: 'pass' };

  const ctx = {
    hand: player.hand,
    revolution: game.revolution,
    rules: game.rules,
    leading: game.field === null,
    opponentsLeft: game.activePlayers().length - 1,
  };

  const jitter = typeof game.rng === 'function' ? game.rng : Math.random;
  const ranked = legal
    .map((combo) => ({ combo, value: score(combo, ctx) + jitter() * 0.4 }))
    .sort((a, b) => a.value - b.value);

  const best = ranked[0].combo;

  if (!ctx.leading) {
    const finishes = player.hand.length - best.count === 0;
    const nearlyDone = player.hand.length <= 3;
    // 場が 1 枚だけのときに切り札を使うのはもったいない。
    if (!finishes && !nearlyDone && isPremium(best, game.revolution) &&
        game.field.combo.count === 1 && ctx.opponentsLeft > 1) {
      return { action: 'pass' };
    }
  }

  return { action: 'play', cards: best.cards };
}
