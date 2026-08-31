/**
 * テキサスホールデム（ノーリミット）の進行エンジン。
 * DOM に依存しないので、ブラウザと Node の両方から読み込める。
 */

import { createDeck, evaluate, shuffle } from './hand.js';

export const STREET = { PREFLOP: 'preflop', FLOP: 'flop', TURN: 'turn', RIVER: 'river', SHOWDOWN: 'showdown' };
export const PHASE = { BETTING: 'betting', HAND_END: 'handEnd', GAME_OVER: 'gameOver' };

const STREET_ORDER = [STREET.PREFLOP, STREET.FLOP, STREET.TURN, STREET.RIVER];
const CARDS_PER_STREET = { flop: 3, turn: 1, river: 1 };

export const DEFAULT_OPTIONS = {
  startingChips: 10000,
  smallBlind: 50,
  bigBlind: 100,
  blindUpEvery: 0, // 0 なら据え置き。n を指定すると n ハンドごとにブラインドが倍になる
};

export class Table {
  constructor({
    playerNames = ['あなた', 'リク', 'ミナ', 'カイ'],
    options = {},
    rng = Math.random,
  } = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.rng = rng;
    this.players = playerNames.map((name, index) => ({
      index,
      name,
      isCPU: index !== 0,
      chips: this.options.startingChips,
      hole: [],
      folded: false,
      allIn: false,
      out: false,
      streetBet: 0,   // このストリートで出した額
      committed: 0,   // このハンドで出した合計
      lastAction: '',
      won: 0,
    }));
    this.handNo = 0;
    this.button = this.players.length - 1;
    this.log = [];
    this.showdown = null;
    this.phase = PHASE.HAND_END;
    this.smallBlind = this.options.smallBlind;
    this.bigBlind = this.options.bigBlind;
  }

  // ---------------------------------------------------------------- ハンド開始

  startHand() {
    if (this.livePlayers().length < 2) {
      this.phase = PHASE.GAME_OVER;
      return;
    }
    this.handNo += 1;
    if (this.options.blindUpEvery > 0 && this.handNo > 1 &&
        (this.handNo - 1) % this.options.blindUpEvery === 0) {
      this.smallBlind *= 2;
      this.bigBlind *= 2;
      this.#push(`ブラインドが上がりました：${this.smallBlind} / ${this.bigBlind}`);
    }

    this.deck = shuffle(createDeck(), this.rng);
    this.community = [];
    this.street = STREET.PREFLOP;
    this.phase = PHASE.BETTING;
    this.showdown = null;
    this.lastAggressor = null;

    for (const p of this.players) {
      p.hole = [];
      p.folded = p.out;
      p.allIn = false;
      p.streetBet = 0;
      p.committed = 0;
      p.lastAction = '';
      p.won = 0;
    }

    this.button = this.#nextLive(this.button);
    const live = this.livePlayers();
    const heads = live.length === 2;
    const sbSeat = heads ? this.button : this.#nextLive(this.button);
    const bbSeat = this.#nextLive(sbSeat);

    for (const p of live) p.hole = [this.deck.pop(), this.deck.pop()];

    this.#post(sbSeat, this.smallBlind, 'SB');
    this.#post(bbSeat, this.bigBlind, 'BB');
    this.currentBet = this.bigBlind;
    this.minRaise = this.bigBlind;
    this.acted = new Set();
    this.bbSeat = bbSeat;
    this.toAct = heads ? sbSeat : this.#nextActor(bbSeat);

    this.#push(`ハンド ${this.handNo} 開始（ボタン：${this.players[this.button].name}）`);
    this.#skipIfNoDecision();
  }

  #post(index, amount, label) {
    const paid = this.#commit(index, amount);
    this.players[index].lastAction = `${label} ${paid}`;
    this.#push(`${this.players[index].name}：${label} ${paid}`);
  }

  /** チップを場に出す。足りなければオールイン。実際に出した額を返す。 */
  #commit(index, amount) {
    const p = this.players[index];
    const paid = Math.min(amount, p.chips);
    p.chips -= paid;
    p.streetBet += paid;
    p.committed += paid;
    if (p.chips === 0) p.allIn = true;
    return paid;
  }

  // ---------------------------------------------------------------- 参照

  livePlayers() {
    return this.players.filter((p) => !p.out);
  }

  /** まだ勝負に残っている（降りていない）プレイヤー。 */
  contenders() {
    return this.players.filter((p) => !p.out && !p.folded);
  }

  /** これから意思決定できるプレイヤー。 */
  actors() {
    return this.contenders().filter((p) => !p.allIn);
  }

  get pot() {
    return this.players.reduce((sum, p) => sum + p.committed, 0);
  }

  get current() {
    return this.players[this.toAct];
  }

  /** 手番のプレイヤーが取れる選択肢。 */
  legalActions(index = this.toAct) {
    const p = this.players[index];
    const toCall = Math.min(this.currentBet - p.streetBet, p.chips);
    // 誰にもコールできない額は積んでも意味がないので、相手の最大額で頭打ちにする。
    const rivals = this.contenders().filter((o) => o.index !== index);
    const rivalMax = rivals.length ? Math.max(...rivals.map((o) => o.streetBet + o.chips)) : 0;
    const maxRaiseTo = Math.min(p.streetBet + p.chips, Math.max(this.currentBet, rivalMax));
    const wantRaiseTo = this.currentBet + this.minRaise;
    return {
      canFold: true,
      canCheck: toCall === 0,
      canCall: toCall > 0,
      callAmount: toCall,
      canRaise: maxRaiseTo > this.currentBet,
      minRaiseTo: Math.min(wantRaiseTo, maxRaiseTo),
      maxRaiseTo,
      isAllInRaise: maxRaiseTo <= wantRaiseTo,
    };
  }

  // ---------------------------------------------------------------- 着手

  /** action は { type: 'fold' | 'check' | 'call' | 'raise', amount? }。amount はレイズ後の合計額。 */
  act(index, action) {
    if (this.phase !== PHASE.BETTING) return { ok: false, reason: 'いまは着手できません' };
    if (index !== this.toAct) return { ok: false, reason: '手番ではありません' };
    const p = this.players[index];
    const legal = this.legalActions(index);

    switch (action.type) {
      case 'fold':
        p.folded = true;
        p.lastAction = 'フォールド';
        this.#push(`${p.name}：フォールド`);
        break;

      case 'check':
        if (!legal.canCheck) return { ok: false, reason: 'チェックできません' };
        p.lastAction = 'チェック';
        this.#push(`${p.name}：チェック`);
        break;

      case 'call': {
        if (!legal.canCall) return { ok: false, reason: 'コールできません' };
        const paid = this.#commit(index, legal.callAmount);
        p.lastAction = p.allIn ? `コール ${paid}（オールイン）` : `コール ${paid}`;
        this.#push(`${p.name}：${p.lastAction}`);
        break;
      }

      case 'raise': {
        if (!legal.canRaise) return { ok: false, reason: 'レイズできません' };
        const raiseTo = Math.min(Math.max(action.amount ?? legal.minRaiseTo, legal.minRaiseTo), legal.maxRaiseTo);
        const paid = this.#commit(index, raiseTo - p.streetBet);
        const raiseBy = p.streetBet - this.currentBet;
        const opening = this.currentBet === 0;
        const fullRaise = raiseBy >= this.minRaise;
        if (p.streetBet > this.currentBet) this.currentBet = p.streetBet;
        if (fullRaise) {
          this.minRaise = raiseBy;
          this.acted = new Set(); // 全員に再度アクションの権利が戻る
        }
        this.lastAggressor = index;
        const verb = opening ? 'ベット' : 'レイズ';
        p.lastAction = p.allIn ? `${verb} ${paid}（オールイン）` : `${verb} → ${p.streetBet}`;
        this.#push(`${p.name}：${p.lastAction}`);
        break;
      }

      default:
        return { ok: false, reason: '不明なアクションです' };
    }

    this.acted.add(index);
    this.#afterAction();
    return { ok: true };
  }

  #afterAction() {
    if (this.contenders().length === 1) {
      this.#awardUncontested();
      return;
    }
    if (this.#roundComplete()) {
      this.#nextStreet();
      return;
    }
    this.toAct = this.#nextActor(this.toAct);
  }

  #roundComplete() {
    const actors = this.actors();
    if (actors.length === 0) return true;
    if (actors.length === 1 && this.contenders().length - actors.length > 0) {
      // 他が全員オールイン。残った 1 人がコール（または降り）を済ませていれば終わり。
      return this.acted.has(actors[0].index) && actors[0].streetBet >= this.currentBet;
    }
    return actors.every((p) => this.acted.has(p.index) && p.streetBet === this.currentBet);
  }

  #nextStreet() {
    if (this.street === STREET.RIVER) {
      this.#runShowdown();
      return;
    }
    const next = STREET_ORDER[STREET_ORDER.indexOf(this.street) + 1];
    this.street = next;
    this.community.push(...this.deck.splice(-CARDS_PER_STREET[next]));
    for (const p of this.players) p.streetBet = 0;
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
    this.acted = new Set();
    this.lastAggressor = null;
    this.#push(`--- ${labelOf(next)}：${this.community.map((c) => c.id).length} 枚公開 ---`);
    this.toAct = this.#nextActor(this.button);
    this.#skipIfNoDecision();
  }

  /** 意思決定できる人が 1 人以下なら、残りのボードを開いてショーダウンまで進める。 */
  #skipIfNoDecision() {
    while (this.phase === PHASE.BETTING && this.#roundComplete()) {
      if (this.contenders().length === 1) {
        this.#awardUncontested();
        return;
      }
      this.#nextStreet();
    }
  }

  #awardUncontested() {
    const winner = this.contenders()[0];
    const pot = this.pot;
    winner.chips += pot;
    winner.won = pot;
    this.showdown = { pots: [{ amount: pot, winners: [winner.index], eligible: [winner.index] }], hands: {}, uncontested: true };
    this.#push(`${winner.name} が ${pot} を獲得（全員フォールド）`);
    this.#endHand();
  }

  #runShowdown() {
    this.street = STREET.SHOWDOWN;
    const hands = {};
    for (const p of this.contenders()) {
      hands[p.index] = evaluate([...p.hole, ...this.community]);
    }
    const pots = this.buildPots();
    for (const pot of pots) {
      const eligible = pot.eligible.filter((i) => hands[i]);
      const best = Math.max(...eligible.map((i) => hands[i].score));
      pot.winners = eligible.filter((i) => hands[i].score === best);
      const share = Math.floor(pot.amount / pot.winners.length);
      let remainder = pot.amount - share * pot.winners.length;
      // 端数はボタンの左隣から順に配る。
      for (const index of this.#orderFromButton(pot.winners)) {
        const extra = remainder > 0 ? 1 : 0;
        remainder -= extra;
        this.players[index].chips += share + extra;
        this.players[index].won += share + extra;
      }
      const names = pot.winners.map((i) => this.players[i].name).join('・');
      this.#push(`${names} が ${pot.amount} を獲得（${hands[pot.winners[0]].name}）`);
    }
    this.showdown = { pots, hands, uncontested: false };
    this.#endHand();
  }

  /**
   * オールインを考慮してメインポットとサイドポットに分ける。
   * 各プレイヤーの拠出額の段階ごとに 1 つのポットを作る。
   */
  buildPots() {
    const levels = [...new Set(this.players.filter((p) => p.committed > 0).map((p) => p.committed))]
      .sort((a, b) => a - b);
    const pots = [];
    let previous = 0;
    for (const level of levels) {
      let amount = 0;
      const eligible = [];
      for (const p of this.players) {
        amount += Math.min(p.committed, level) - Math.min(p.committed, previous);
        if (!p.folded && p.committed >= level) eligible.push(p.index);
      }
      if (amount > 0) pots.push({ amount, eligible, winners: [] });
      previous = level;
    }
    return pots;
  }

  #endHand() {
    for (const p of this.players) {
      if (p.chips === 0 && !p.out) {
        p.out = true;
        this.#push(`${p.name} は持ちチップがなくなりました`);
      }
    }
    this.phase = this.livePlayers().length < 2 ? PHASE.GAME_OVER : PHASE.HAND_END;
    if (this.phase === PHASE.GAME_OVER) {
      const winner = this.livePlayers()[0];
      if (winner) this.#push(`ゲーム終了：${winner.name} の優勝`);
    }
  }

  // ---------------------------------------------------------------- 座席まわり

  #nextLive(from) {
    const n = this.players.length;
    for (let step = 1; step <= n; step++) {
      const index = (from + step) % n;
      if (!this.players[index].out) return index;
    }
    return from;
  }

  #nextActor(from) {
    const n = this.players.length;
    for (let step = 1; step <= n; step++) {
      const index = (from + step) % n;
      const p = this.players[index];
      if (!p.out && !p.folded && !p.allIn) return index;
    }
    return from;
  }

  #orderFromButton(indexes) {
    const n = this.players.length;
    const order = [];
    for (let step = 1; step <= n; step++) {
      const index = (this.button + step) % n;
      if (indexes.includes(index)) order.push(index);
    }
    return order;
  }

  #push(text) {
    this.log.push(text);
    if (this.log.length > 300) this.log.shift();
  }
}

export function labelOf(street) {
  return { preflop: 'プリフロップ', flop: 'フロップ', turn: 'ターン', river: 'リバー', showdown: 'ショーダウン' }[street];
}
