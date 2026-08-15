/**
 * 大富豪（大貧民）のルールエンジン。
 * DOM に依存しないので、ブラウザと Node の両方から読み込める。
 */

export const SUITS = ['s', 'h', 'd', 'c'];
export const SUIT_MARK = { s: '♠', h: '♥', d: '♦', c: '♣' };
export const RED_SUITS = new Set(['h', 'd']);
export const JOKER_RANK = 16;

/** 3 が最弱、2 が最強。ジョーカーは別枠で JOKER_RANK。 */
export const RANK_LABELS = {
  3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
  11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2',
};

export const DEFAULT_RULES = {
  revolution: true,   // 革命（同ランク4枚 / 5枚以上の階段で強さが逆転）
  eightCut: true,     // 8切り（8を含む手を出すと場が流れて同じ人が親）
  suitLock: true,     // 縛り（同じスートが2回続くとそのスートしか出せない）
  sequence: true,     // 階段（同じスートの3枚以上の連番）
  spade3: true,       // スペ3返し（ジョーカー1枚に♠3で返せる）
  exchange: true,     // 2ラウンド目以降のカード交換（税金）
  jokers: 2,
};

export const RANK_TITLES = ['大富豪', '富豪', '貧民', '大貧民'];

// ---------------------------------------------------------------- カード

export function cardLabel(card) {
  return card.joker ? 'JOKER' : SUIT_MARK[card.suit] + RANK_LABELS[card.rank];
}

export function createDeck(rules = DEFAULT_RULES) {
  const deck = [];
  for (const suit of SUITS) {
    for (let rank = 3; rank <= 15; rank++) {
      deck.push({ id: `${suit}${rank}`, suit, rank, joker: false });
    }
  }
  for (let i = 0; i < (rules.jokers ?? 2); i++) {
    deck.push({ id: `joker${i}`, suit: null, rank: JOKER_RANK, joker: true });
  }
  return deck;
}

/** 再現可能な乱数（テストと棋譜の再現用）。 */
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

/** 手札の並び順：革命中は強い順が変わるので表示側と揃える。 */
export function sortHand(hand, revolution = false) {
  return hand.slice().sort((a, b) => {
    if (a.joker !== b.joker) return a.joker ? 1 : -1;
    if (a.joker) return 0;
    if (a.rank !== b.rank) return revolution ? b.rank - a.rank : a.rank - b.rank;
    return SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);
  });
}

// ---------------------------------------------------------------- 役の判定

/**
 * 出そうとしているカードの組を役として解釈する。成立しなければ null。
 *
 * - 同ランクの 1〜4 枚（ジョーカーはワイルド）
 * - 同じスートの 3 枚以上の連番（ジョーカーは間の穴埋めのみ。端の延長には使えない）
 * - ジョーカーのみ（常に最強）
 */
export function parseCombo(cards, rules = DEFAULT_RULES) {
  if (!Array.isArray(cards) || cards.length === 0) return null;
  if (new Set(cards.map((c) => c.id)).size !== cards.length) return null;

  const jokers = cards.filter((c) => c.joker);
  const normals = cards.filter((c) => !c.joker);
  const count = cards.length;

  if (normals.length === 0) {
    return {
      type: 'set', count, rank: JOKER_RANK, low: JOKER_RANK,
      suits: [], jokerCount: jokers.length, allJoker: true, cards: cards.slice(),
    };
  }

  const ranks = [...new Set(normals.map((c) => c.rank))];
  if (ranks.length === 1) {
    return {
      type: 'set', count, rank: ranks[0], low: ranks[0],
      suits: normals.map((c) => c.suit).sort(), jokerCount: jokers.length,
      allJoker: false, cards: cards.slice(),
    };
  }

  if (rules.sequence && count >= 3) {
    const suits = [...new Set(normals.map((c) => c.suit))];
    if (suits.length === 1) {
      const sorted = normals.map((c) => c.rank).sort((a, b) => a - b);
      const span = sorted[sorted.length - 1] - sorted[0] + 1;
      const holes = span - normals.length;
      if (span === count && holes === jokers.length) {
        return {
          type: 'sequence', count, rank: sorted[sorted.length - 1], low: sorted[0],
          suits, jokerCount: jokers.length, allJoker: false, cards: cards.slice(),
        };
      }
    }
  }
  return null;
}

/** 場の役との強さ比較に使う数値。革命中は上下が入れ替わる（ジョーカーは常に最強）。 */
export function comboStrength(combo, revolution) {
  if (combo.allJoker) return 999;
  return revolution ? JOKER_RANK - combo.rank : combo.rank;
}

/** 縛り判定用のスート集合。ジョーカーはスートを持たないので無視する。 */
export function suitKey(combo) {
  return combo.suits.slice().sort().join('');
}

export function suitKeyMarks(key) {
  return key.split('').map((s) => SUIT_MARK[s]).join('');
}

export function isRevolutionPlay(combo, rules) {
  if (!rules.revolution) return false;
  if (combo.type === 'set') return combo.count >= 4;
  return combo.type === 'sequence' && combo.count >= 5;
}

export function hasEight(combo) {
  return combo.cards.some((c) => !c.joker && c.rank === 8);
}

export function describeCombo(combo) {
  const cards = combo.cards.map(cardLabel).join(' ');
  if (combo.type === 'sequence') return `${cards}（階段${combo.count}）`;
  const names = { 1: '', 2: 'ペア', 3: '3枚', 4: '4枚' };
  const suffix = names[combo.count] ?? `${combo.count}枚`;
  return suffix ? `${cards}（${suffix}）` : cards;
}

/**
 * その役を今の場に出せるか。state は { field, revolution, lock, rules }。
 * 返り値は { ok, reason }。
 */
export function canPlay(combo, state) {
  if (!combo) return { ok: false, reason: 'その組み合わせでは出せません' };
  const { field, rules } = state;
  if (!field) return { ok: true };

  const f = field.combo;
  if (combo.type !== f.type) {
    return { ok: false, reason: f.type === 'sequence' ? '階段で出してください' : '同じ種類で出してください' };
  }
  if (combo.count !== f.count) {
    return { ok: false, reason: `${f.count}枚で出してください` };
  }
  if (rules.suitLock && state.lock && suitKey(combo) !== state.lock) {
    return { ok: false, reason: `縛り中：${suitKeyMarks(state.lock)} で出してください` };
  }
  if (rules.spade3 && f.allJoker && f.count === 1 &&
      combo.count === 1 && !combo.allJoker && combo.rank === 3 && combo.suits[0] === 's') {
    return { ok: true, spade3: true };
  }
  if (comboStrength(combo, state.revolution) <= comboStrength(f, state.revolution)) {
    return { ok: false, reason: '場より強い手が必要です' };
  }
  return { ok: true };
}

// ---------------------------------------------------------------- 候補手の列挙

function combinations(items, k) {
  const out = [];
  const cur = [];
  (function rec(start) {
    if (cur.length === k) { out.push(cur.slice()); return; }
    for (let i = start; i < items.length; i++) {
      cur.push(items[i]);
      rec(i + 1);
      cur.pop();
    }
  })(0);
  return out;
}

/** 手札から作れる役の候補をすべて列挙する（CPU と「出せる手」のハイライト用）。 */
export function enumerateCombos(hand, rules = DEFAULT_RULES) {
  const jokers = hand.filter((c) => c.joker);
  const normals = hand.filter((c) => !c.joker);
  const seen = new Set();
  const out = [];

  const add = (cards) => {
    const key = cards.map((c) => c.id).sort().join(',');
    if (seen.has(key)) return;
    const combo = parseCombo(cards, rules);
    if (!combo) return;
    seen.add(key);
    out.push(combo);
  };

  const byRank = new Map();
  for (const card of normals) {
    if (!byRank.has(card.rank)) byRank.set(card.rank, []);
    byRank.get(card.rank).push(card);
  }

  for (const group of byRank.values()) {
    for (let take = 1; take <= group.length; take++) {
      for (const picked of combinations(group, take)) {
        for (let jn = 0; jn <= jokers.length; jn++) {
          if (take + jn > 4) continue;
          add(picked.concat(jokers.slice(0, jn)));
        }
      }
    }
  }
  for (let jn = 1; jn <= jokers.length; jn++) add(jokers.slice(0, jn));

  if (rules.sequence) {
    for (const suit of SUITS) {
      const bySuitRank = new Map(normals.filter((c) => c.suit === suit).map((c) => [c.rank, c]));
      if (bySuitRank.size < 3 - jokers.length) continue;
      for (let lo = 3; lo <= 15; lo++) {
        for (let len = 3; len <= 15 - lo + 1; len++) {
          const window = [];
          let holes = 0;
          for (let r = lo; r < lo + len; r++) {
            const card = bySuitRank.get(r);
            if (card) window.push(card);
            else holes++;
          }
          if (holes > jokers.length) break;
          // 端がジョーカーだと役が確定しないので、両端は実カードに限る。
          if (!bySuitRank.has(lo) || !bySuitRank.has(lo + len - 1)) continue;
          add(window.concat(jokers.slice(0, holes)));
        }
      }
    }
  }
  return out;
}

/** 今の場に対して合法な役だけを返す。 */
export function legalCombos(hand, state) {
  return enumerateCombos(hand, state.rules).filter((c) => canPlay(c, state).ok);
}

// ---------------------------------------------------------------- ゲーム進行

export const PHASE = {
  EXCHANGE: 'exchange',
  PLAYING: 'playing',
  ROUND_END: 'roundEnd',
};

export class Game {
  constructor({ playerNames = ['あなた', 'リク', 'ミナ', 'カイ'], rules = {}, rng = Math.random } = {}) {
    this.rules = { ...DEFAULT_RULES, ...rules };
    this.rng = rng;
    this.players = playerNames.map((name, index) => ({
      index, name, isCPU: index !== 0, hand: [], title: null, lastTitle: null,
    }));
    this.round = 0;
    this.log = [];
    this.startRound();
  }

  // --- ラウンド開始 -------------------------------------------------

  startRound() {
    this.round += 1;
    const deck = shuffle(createDeck(this.rules), this.rng);
    for (const p of this.players) p.hand = [];
    deck.forEach((card, i) => this.players[i % this.players.length].hand.push(card));
    for (const p of this.players) {
      p.lastTitle = p.title;
      p.title = null;
      p.hand = sortHand(p.hand);
    }

    this.field = null;
    this.lock = null;
    this.revolution = false;
    this.passed = new Set();
    this.finishOrder = [];
    this.lastWinner = null;
    this.log = [];

    const hasTitles = this.players.some((p) => p.lastTitle !== null);
    if (this.rules.exchange && hasTitles) {
      this.phase = PHASE.EXCHANGE;
      this.exchange = this.#buildExchange();
      this.turn = this.#firstPlayer();
    } else {
      this.exchange = null;
      this.phase = PHASE.PLAYING;
      this.turn = this.#firstPlayer();
    }
    this.#push(`ラウンド ${this.round} 開始`);
  }

  #firstPlayer() {
    const daihinmin = this.players.find((p) => p.lastTitle === '大貧民');
    if (daihinmin) return daihinmin.index;
    const withDiamond3 = this.players.find((p) => p.hand.some((c) => c.suit === 'd' && c.rank === 3));
    return withDiamond3 ? withDiamond3.index : 0;
  }

  /** 大富豪⇔大貧民で2枚、富豪⇔貧民で1枚を交換する。 */
  #buildExchange() {
    const byTitle = {};
    for (const p of this.players) if (p.lastTitle) byTitle[p.lastTitle] = p;
    const pairs = [];
    if (byTitle['大富豪'] && byTitle['大貧民']) pairs.push({ rich: byTitle['大富豪'].index, poor: byTitle['大貧民'].index, count: 2 });
    if (byTitle['富豪'] && byTitle['貧民']) pairs.push({ rich: byTitle['富豪'].index, poor: byTitle['貧民'].index, count: 1 });
    return { pairs, given: {} };
  }

  /** 交換で「上位者が下位者に渡すカード」。未指定なら弱い順に自動選択。 */
  autoGive(playerIndex, count) {
    return sortHand(this.players[playerIndex].hand, false).slice(0, count);
  }

  /** 下位者が上位者に渡す（強制で最強のカード）。 */
  autoTribute(playerIndex, count) {
    return sortHand(this.players[playerIndex].hand, false).slice(-count).reverse();
  }

  /**
   * 交換を確定する。selections は { プレイヤー番号: カード配列 }（上位者の分だけ）。
   * 指定がなければ弱いカードを自動で選ぶ。
   */
  commitExchange(selections = {}) {
    if (this.phase !== PHASE.EXCHANGE) return;
    for (const pair of this.exchange.pairs) {
      const rich = this.players[pair.rich];
      const poor = this.players[pair.poor];
      const tribute = this.autoTribute(pair.poor, pair.count);
      const chosen = selections[pair.rich] ?? this.autoGive(pair.rich, pair.count);
      const give = chosen.slice(0, pair.count);

      poor.hand = poor.hand.filter((c) => !tribute.some((t) => t.id === c.id));
      rich.hand = rich.hand.filter((c) => !give.some((g) => g.id === c.id));
      rich.hand.push(...tribute);
      poor.hand.push(...give);
      rich.hand = sortHand(rich.hand);
      poor.hand = sortHand(poor.hand);
      this.#push(`${poor.name} → ${rich.name} に ${tribute.map(cardLabel).join(' ')}／${rich.name} → ${poor.name} に ${give.map(cardLabel).join(' ')}`);
    }
    this.exchange = null;
    this.phase = PHASE.PLAYING;
  }

  // --- 状態の参照 ---------------------------------------------------

  get current() {
    return this.players[this.turn];
  }

  get stateForRules() {
    return { field: this.field, revolution: this.revolution, lock: this.lock, rules: this.rules };
  }

  activePlayers() {
    return this.players.filter((p) => p.hand.length > 0);
  }

  legalPlays(playerIndex = this.turn) {
    return legalCombos(this.players[playerIndex].hand, this.stateForRules);
  }

  canPass(playerIndex = this.turn) {
    return this.field !== null && playerIndex === this.turn && this.phase === PHASE.PLAYING;
  }

  // --- 着手 ---------------------------------------------------------

  /** カードを出す。成功したら { ok: true, events }、失敗なら { ok: false, reason }。 */
  play(playerIndex, cards) {
    if (this.phase !== PHASE.PLAYING) return { ok: false, reason: 'いまは出せません' };
    if (playerIndex !== this.turn) return { ok: false, reason: '手番ではありません' };

    const player = this.players[playerIndex];
    const owned = cards.every((c) => player.hand.some((h) => h.id === c.id));
    if (!owned) return { ok: false, reason: '手札にないカードです' };

    const combo = parseCombo(cards, this.rules);
    const verdict = canPlay(combo, this.stateForRules);
    if (!verdict.ok) return { ok: false, reason: verdict.reason };

    player.hand = player.hand.filter((c) => !cards.some((x) => x.id === c.id));
    const events = [];
    const previous = this.field;
    this.field = { combo, playerIndex };
    this.passed.delete(playerIndex);
    this.#push(`${player.name}：${describeCombo(combo)}`);

    if (verdict.spade3) {
      events.push('spade3');
      this.#push('スペ3返し！');
    }
    if (isRevolutionPlay(combo, this.rules)) {
      this.revolution = !this.revolution;
      events.push('revolution');
      this.#push(this.revolution ? '革命！ カードの強さが逆転' : '革命返し！ 強さが元に戻った');
    }
    if (this.rules.suitLock && previous && !combo.allJoker &&
        suitKey(combo) !== '' && suitKey(combo) === suitKey(previous.combo) && !this.lock) {
      this.lock = suitKey(combo);
      events.push('lock');
      this.#push(`縛り発生：${suitKeyMarks(this.lock)}`);
    }

    if (player.hand.length === 0) {
      this.#finish(playerIndex);
      events.push('finished');
    }

    const eightCut = this.rules.eightCut && hasEight(combo);
    if (eightCut) {
      events.push('eightCut');
      this.#push('8切り！ 場が流れます');
    }

    if (this.#checkRoundEnd()) return { ok: true, events };

    if (eightCut) {
      this.#clearField(playerIndex);
    } else {
      this.#advanceAfterPlay(playerIndex);
    }
    return { ok: true, events };
  }

  pass(playerIndex) {
    if (this.phase !== PHASE.PLAYING) return { ok: false, reason: 'いまはパスできません' };
    if (playerIndex !== this.turn) return { ok: false, reason: '手番ではありません' };
    if (!this.field) return { ok: false, reason: '場が空のときはパスできません' };

    this.passed.add(playerIndex);
    this.#push(`${this.players[playerIndex].name}：パス`);
    this.#advanceAfterPlay(playerIndex);
    return { ok: true, events: ['pass'] };
  }

  // --- 内部処理 -----------------------------------------------------

  #finish(playerIndex) {
    this.finishOrder.push(playerIndex);
    this.passed.delete(playerIndex);
    this.#push(`${this.players[playerIndex].name} あがり！（${this.finishOrder.length}位）`);
  }

  #checkRoundEnd() {
    const remaining = this.players.filter((p) => p.hand.length > 0);
    if (remaining.length > 1) return false;
    for (const p of remaining) this.finishOrder.push(p.index);
    this.finishOrder.forEach((index, place) => {
      this.players[index].title = RANK_TITLES[place] ?? null;
    });
    this.phase = PHASE.ROUND_END;
    this.field = null;
    this.lock = null;
    this.#push(`ラウンド ${this.round} 終了：` +
      this.finishOrder.map((i, place) => `${RANK_TITLES[place]}=${this.players[i].name}`).join('／'));
    return true;
  }

  /** from の次に「まだ上がっておらず、パスもしていない」プレイヤー。いなければ null。 */
  #nextEligible(from) {
    const n = this.players.length;
    for (let step = 1; step <= n; step++) {
      const index = (from + step) % n;
      const p = this.players[index];
      if (p.hand.length > 0 && !this.passed.has(index)) return index;
    }
    return null;
  }

  #advanceAfterPlay(from) {
    const next = this.#nextEligible(from);
    const owner = this.field ? this.field.playerIndex : null;
    if (next === null || next === owner) {
      this.#clearField(owner);
      return;
    }
    this.turn = next;
  }

  /** 場を流し、leader（上がっていれば次の人）から再開する。 */
  #clearField(leader) {
    this.field = null;
    this.lock = null;
    this.passed.clear();
    this.lastWinner = leader;
    let next = leader;
    if (next === null || this.players[next].hand.length === 0) {
      const n = this.players.length;
      const base = next === null ? this.turn : next;
      next = null;
      for (let step = 1; step <= n; step++) {
        const index = (base + step) % n;
        if (this.players[index].hand.length > 0) { next = index; break; }
      }
    }
    if (next !== null) {
      this.turn = next;
      this.#push(`場が流れました → ${this.players[next].name} の番`);
    }
  }

  #push(text) {
    this.log.push(text);
    if (this.log.length > 200) this.log.shift();
  }
}
