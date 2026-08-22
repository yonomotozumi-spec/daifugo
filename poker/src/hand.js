/**
 * ポーカーの役判定。7 枚から最強の 5 枚を選ぶ。
 * DOM に依存しないので、ブラウザと Node の両方から読み込める。
 */

export const SUITS = ['s', 'h', 'd', 'c'];
export const SUIT_MARK = { s: '♠', h: '♥', d: '♦', c: '♣' };
export const RANK_LABELS = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
  11: 'J', 12: 'Q', 13: 'K', 14: 'A',
};

/** 役の強さ。数字が大きいほど強い。 */
export const CATEGORY = {
  HIGH_CARD: 0, PAIR: 1, TWO_PAIR: 2, TRIPS: 3, STRAIGHT: 4,
  FLUSH: 5, FULL_HOUSE: 6, QUADS: 7, STRAIGHT_FLUSH: 8,
};

const CATEGORY_NAMES = [
  'ハイカード', 'ワンペア', 'ツーペア', 'スリーカード', 'ストレート',
  'フラッシュ', 'フルハウス', 'フォーカード', 'ストレートフラッシュ',
];

export function cardLabel(card) {
  return SUIT_MARK[card.suit] + RANK_LABELS[card.rank];
}

export function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (let rank = 2; rank <= 14; rank++) deck.push({ id: `${suit}${rank}`, suit, rank });
  }
  return deck;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(cards, rng = Math.random) {
  const out = cards.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * 連続する 5 ランクがあれば、その最高位を返す（なければ 0）。
 * A は 5-4-3-2-A のロー・ストレートにも使える。
 */
function straightHigh(rankMask) {
  // A はランク 1 としても立てて、A-2-3-4-5 を拾えるようにする。
  const mask = rankMask | (((rankMask >> 14) & 1) << 1);
  for (let high = 14; high >= 5; high--) {
    const need = 0b11111 << (high - 4);
    if ((mask & need) === need) return high;
  }
  return 0;
}

/** 除外ランクを避けて、高い順に n 個のキッカーを拾う。 */
function kickers(counts, exclude, n) {
  const out = [];
  for (let rank = 14; rank >= 2 && out.length < n; rank--) {
    if (counts[rank] > 0 && !exclude.includes(rank)) out.push(rank);
  }
  return out;
}

/** 役をひとつの整数に畳む。カテゴリが最上位、続いて 5 つのタイブレーク。 */
function makeScore(category, ranks) {
  let score = category;
  for (let i = 0; i < 5; i++) score = score * 16 + (ranks[i] ?? 0);
  return score;
}

/**
 * 5〜7 枚から最強の役を求める。
 * 返り値は { score, category, ranks, name }。score 同士を比較すれば強弱が決まる。
 */
export function evaluate(cards) {
  const counts = new Array(15).fill(0);
  const bySuit = { s: [], h: [], d: [], c: [] };
  let rankMask = 0;
  for (const card of cards) {
    counts[card.rank] += 1;
    bySuit[card.suit].push(card.rank);
    rankMask |= 1 << card.rank;
  }

  let flushSuit = null;
  for (const suit of SUITS) if (bySuit[suit].length >= 5) flushSuit = suit;

  if (flushSuit) {
    let flushMask = 0;
    for (const rank of bySuit[flushSuit]) flushMask |= 1 << rank;
    const high = straightHigh(flushMask);
    if (high) return finish(CATEGORY.STRAIGHT_FLUSH, [high]);
  }

  const quads = [];
  const trips = [];
  const pairs = [];
  for (let rank = 14; rank >= 2; rank--) {
    if (counts[rank] === 4) quads.push(rank);
    else if (counts[rank] === 3) trips.push(rank);
    else if (counts[rank] === 2) pairs.push(rank);
  }

  if (quads.length) return finish(CATEGORY.QUADS, [quads[0], ...kickers(counts, [quads[0]], 1)]);

  if (trips.length) {
    const partners = [...trips.slice(1), ...pairs];
    if (partners.length) return finish(CATEGORY.FULL_HOUSE, [trips[0], Math.max(...partners)]);
  }

  if (flushSuit) {
    const top = bySuit[flushSuit].slice().sort((a, b) => b - a).slice(0, 5);
    return finish(CATEGORY.FLUSH, top);
  }

  const high = straightHigh(rankMask);
  if (high) return finish(CATEGORY.STRAIGHT, [high]);

  if (trips.length) return finish(CATEGORY.TRIPS, [trips[0], ...kickers(counts, [trips[0]], 2)]);
  if (pairs.length >= 2) {
    return finish(CATEGORY.TWO_PAIR, [pairs[0], pairs[1], ...kickers(counts, [pairs[0], pairs[1]], 1)]);
  }
  if (pairs.length === 1) return finish(CATEGORY.PAIR, [pairs[0], ...kickers(counts, [pairs[0]], 3)]);
  return finish(CATEGORY.HIGH_CARD, kickers(counts, [], 5));
}

function finish(category, ranks) {
  return { score: makeScore(category, ranks), category, ranks, name: describe(category, ranks) };
}

function describe(category, ranks) {
  const label = (rank) => RANK_LABELS[rank];
  switch (category) {
    case CATEGORY.STRAIGHT_FLUSH:
      return ranks[0] === 14 ? 'ロイヤルフラッシュ' : `ストレートフラッシュ（${label(ranks[0])}ハイ）`;
    case CATEGORY.QUADS: return `フォーカード（${label(ranks[0])}）`;
    case CATEGORY.FULL_HOUSE: return `フルハウス（${label(ranks[0])} over ${label(ranks[1])}）`;
    case CATEGORY.FLUSH: return `フラッシュ（${label(ranks[0])}ハイ）`;
    case CATEGORY.STRAIGHT: return `ストレート（${label(ranks[0])}ハイ）`;
    case CATEGORY.TRIPS: return `スリーカード（${label(ranks[0])}）`;
    case CATEGORY.TWO_PAIR: return `ツーペア（${label(ranks[0])} と ${label(ranks[1])}）`;
    case CATEGORY.PAIR: return `ワンペア（${label(ranks[0])}）`;
    default: return `ハイカード（${label(ranks[0])}）`;
  }
}

export function categoryName(category) {
  return CATEGORY_NAMES[category];
}
