/** 画面まわり。ルール判定は engine.js、役の判定は hand.js、CPU の思考は ai.js に任せる。 */

import { PHASE, Table, labelOf } from './engine.js';
import { RANK_LABELS, SUIT_MARK, evaluate } from './hand.js';
import { decide, personalityFor } from './ai.js';

const $ = (id) => document.getElementById(id);
const HUMAN = 0;
const CPU_DELAY = 850;
const STORAGE_KEY = 'poker:options';

let table;
let timer = null;
let raiseMode = false;
let raiseValue = 0;

const yen = (n) => n.toLocaleString('ja-JP');

// ---------------------------------------------------------------- 部品

function loadOptions() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveOptions(options) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(options)); } catch { /* 保存できなくても遊べる */ }
}

function cardEl(card, { small = false, dim = false } = {}) {
  const el = document.createElement('div');
  el.className = 'card';
  if (small) el.classList.add('small');
  if (dim) el.classList.add('dim');
  if (card.suit === 'h' || card.suit === 'd') el.classList.add('red');
  const corner = document.createElement('span');
  corner.className = 'corner';
  corner.textContent = RANK_LABELS[card.rank];
  const pip = document.createElement('span');
  pip.className = 'pip';
  pip.textContent = SUIT_MARK[card.suit];
  el.append(corner, pip);
  el.setAttribute('aria-label', `${SUIT_MARK[card.suit]}${RANK_LABELS[card.rank]}`);
  return el;
}

function backEl({ small = false } = {}) {
  const el = document.createElement('div');
  el.className = small ? 'card small back' : 'card back';
  el.setAttribute('aria-label', '伏せられたカード');
  return el;
}

function tag(text, className = '') {
  const el = document.createElement('span');
  el.className = `chip-tag ${className}`.trim();
  el.textContent = text;
  return el;
}

function setMessage(text, ok = false) {
  const el = $('message');
  el.textContent = text;
  el.classList.toggle('ok', ok);
}

/** ショーダウンまで進んだハンドでは、降りていない人の手札を見せる。 */
function shouldReveal(player) {
  return player.index === HUMAN ||
    (table.showdown && !table.showdown.uncontested && !player.folded && !player.out);
}

// ---------------------------------------------------------------- 描画

function render() {
  const myTurn = table.phase === PHASE.BETTING && table.toAct === HUMAN;

  $('badge-hand').textContent = `ハンド ${table.handNo}`;
  $('badge-blinds').textContent = `${yen(table.smallBlind)} / ${yen(table.bigBlind)}`;
  $('badge-street').textContent = labelOf(table.street);
  $('pot').textContent = yen(table.pot);

  renderSeats();
  renderBoard();
  renderMe(myTurn);
  renderControls(myTurn);
  renderSidebar();
}

function renderSeats() {
  const box = $('seats');
  box.replaceChildren();
  for (let i = 1; i < table.players.length; i++) {
    const p = table.players[i];
    const seat = document.createElement('div');
    seat.className = 'seat';
    if (table.phase === PHASE.BETTING && table.toAct === i) seat.classList.add('acting');
    if (p.folded && !p.out) seat.classList.add('folded');
    if (p.out) seat.classList.add('out');

    const head = document.createElement('div');
    head.className = 'seat-head';
    const name = document.createElement('span');
    name.className = 'seat-name';
    name.textContent = p.name;
    name.append(tag(personalityFor(i).label));
    if (table.button === i) name.append(tag('D', 'button-tag'));
    if (p.allIn) name.append(tag('ALL IN', 'allin'));
    const chips = document.createElement('span');
    chips.className = 'seat-chips';
    chips.textContent = p.out ? '敗退' : yen(p.chips);
    head.append(name, chips);

    const cards = document.createElement('div');
    cards.className = 'seat-cards';
    if (!p.out && p.hole.length) {
      for (const card of p.hole) {
        cards.append(shouldReveal(p) ? cardEl(card, { small: true, dim: p.folded }) : backEl({ small: true }));
      }
    }
    if (p.streetBet > 0) {
      const bet = document.createElement('span');
      bet.className = 'bet';
      bet.textContent = yen(p.streetBet);
      cards.append(bet);
    }

    const action = document.createElement('div');
    action.className = 'seat-action';
    action.textContent = p.out ? '' : p.lastAction;

    seat.append(head, cards, action);
    box.append(seat);
  }
}

function renderBoard() {
  const box = $('community');
  box.replaceChildren();
  for (const card of table.community) box.append(cardEl(card));
  for (let i = table.community.length; i < 5; i++) {
    const slot = document.createElement('div');
    slot.className = 'card back';
    slot.style.visibility = 'hidden';
    box.append(slot);
  }

  const notes = [];
  if (table.phase === PHASE.BETTING) {
    notes.push(table.toAct === HUMAN ? 'あなたの番です' : `${table.current.name} が考え中…`);
  }
  if (table.currentBet > 0 && table.phase === PHASE.BETTING) notes.push(`現在のベット ${yen(table.currentBet)}`);
  $('board-note').textContent = notes.join(' ／ ');
}

function renderMe(myTurn) {
  const me = table.players[HUMAN];
  const box = $('my-hole');
  box.replaceChildren();
  for (const card of me.hole) box.append(cardEl(card, { dim: me.folded }));

  $('my-chips').textContent = me.out ? '敗退' : yen(me.chips);
  const badge = $('my-badge');
  badge.replaceChildren();
  if (table.button === HUMAN) badge.append(tag('D', 'button-tag'));
  if (me.allIn) badge.append(tag('ALL IN', 'allin'));
  if (me.folded && !me.out) badge.append(tag('フォールド'));

  $('strength').textContent = me.hole.length ? describeMyHand(me) : '';

  const parts = [];
  if (me.streetBet > 0) parts.push(`このストリートで ${yen(me.streetBet)} 出しています`);
  if (myTurn) {
    const legal = table.legalActions(HUMAN);
    if (legal.callAmount > 0) parts.push(`コールに ${yen(legal.callAmount)} 必要`);
  }
  $('to-call').textContent = parts.join(' ／ ');
}

function describeMyHand(me) {
  if (table.community.length === 0) {
    const [a, b] = [...me.hole].sort((x, y) => y.rank - x.rank);
    if (a.rank === b.rank) return `ポケット${RANK_LABELS[a.rank]}`;
    const suited = a.suit === b.suit ? 'スーテッド' : 'オフスート';
    return `${RANK_LABELS[a.rank]}-${RANK_LABELS[b.rank]} ${suited}`;
  }
  return evaluate([...me.hole, ...table.community]).name;
}

function renderControls(myTurn) {
  const fold = $('btn-fold');
  const check = $('btn-check');
  const raise = $('btn-raise');
  const hint = $('btn-hint');

  if (!myTurn) {
    for (const button of [fold, check, raise, hint]) button.disabled = true;
    closeRaisePanel();
    return;
  }

  const legal = table.legalActions(HUMAN);
  fold.disabled = false;
  hint.disabled = false;
  check.disabled = false;
  check.textContent = legal.canCheck ? 'チェック' : `コール ${yen(legal.callAmount)}`;
  raise.disabled = !legal.canRaise;
  raise.textContent = table.currentBet === 0 ? 'ベット' : (legal.isAllInRaise ? 'オールイン' : 'レイズ');

  if (raiseMode) syncRaisePanel(legal);
}

function renderSidebar() {
  const stacks = $('stacks');
  stacks.replaceChildren();
  for (const p of table.players) {
    const li = document.createElement('li');
    if (p.out) li.className = 'out';
    const name = document.createElement('span');
    name.textContent = p.name;
    const amount = document.createElement('span');
    amount.className = 'amount';
    amount.textContent = yen(p.chips);
    li.append(name, amount);
    stacks.append(li);
  }

  const log = $('log');
  log.replaceChildren();
  for (const line of table.log.slice(-50).reverse()) {
    const li = document.createElement('li');
    li.textContent = line;
    log.append(li);
  }
}

// ---------------------------------------------------------------- レイズの操作

function openRaisePanel() {
  const legal = table.legalActions(HUMAN);
  raiseMode = true;
  raiseValue = legal.minRaiseTo;
  $('raise-panel').classList.remove('hidden');
  syncRaisePanel(legal);
}

function closeRaisePanel() {
  raiseMode = false;
  $('raise-panel').classList.add('hidden');
}

function syncRaisePanel(legal) {
  const slider = $('raise-slider');
  const step = Math.max(1, table.smallBlind);
  raiseValue = Math.min(Math.max(raiseValue, legal.minRaiseTo), legal.maxRaiseTo);
  slider.min = String(legal.minRaiseTo);
  slider.max = String(legal.maxRaiseTo);
  slider.step = String(step);
  slider.value = String(raiseValue);
  slider.disabled = legal.minRaiseTo >= legal.maxRaiseTo;
  $('raise-amount').textContent = yen(raiseValue);
  $('raise-confirm').textContent = raiseValue >= legal.maxRaiseTo ? 'オールイン' : `${yen(raiseValue)} にする`;
}

function presetAmount(fraction) {
  const legal = table.legalActions(HUMAN);
  if (fraction === 'max') return legal.maxRaiseTo;
  const me = table.players[HUMAN];
  const potAfterCall = table.pot + legal.callAmount;
  const target = me.streetBet + legal.callAmount + Math.round(potAfterCall * fraction);
  return Math.min(Math.max(target, legal.minRaiseTo), legal.maxRaiseTo);
}

// ---------------------------------------------------------------- 進行

function step() {
  render();
  if (table.phase === PHASE.GAME_OVER) {
    showResult(true);
    return;
  }
  if (table.phase === PHASE.HAND_END) {
    showResult(false);
    return;
  }
  if (table.current.isCPU) {
    clearTimeout(timer);
    timer = setTimeout(cpuMove, CPU_DELAY);
  }
}

function cpuMove() {
  if (table.phase !== PHASE.BETTING || !table.current.isCPU) return;
  const index = table.toAct;
  const move = decide(table, index);
  const result = table.act(index, move);
  if (!result.ok) table.act(index, { type: 'fold' }); // 念のための保険
  step();
}

function humanAct(action) {
  const result = table.act(HUMAN, action);
  if (!result.ok) {
    setMessage(result.reason);
    return;
  }
  closeRaisePanel();
  setMessage('');
  step();
}

function showHint() {
  const move = decide(table, HUMAN, personalityFor(1));
  const percent = Math.round(move.equity * 100);
  const label = {
    fold: 'フォールド', check: 'チェック', call: 'コール',
    raise: table.currentBet === 0 ? 'ベット' : 'レイズ',
  }[move.type];
  const amount = move.type === 'raise' ? `（${yen(move.amount)} まで）` : '';
  setMessage(`勝率およそ ${percent}%。おすすめは ${label}${amount}`, true);
}

function showResult(gameOver) {
  const dialog = gameOver ? $('dlg-over') : $('dlg-result');
  if (gameOver) {
    const winner = table.players.find((p) => !p.out);
    $('over-title').textContent = winner && winner.index === HUMAN ? 'あなたの優勝！' : 'ゲーム終了';
    $('over-body').textContent = winner
      ? `${winner.name} が ${yen(winner.chips)} を独り占めしました（${table.handNo} ハンド）。`
      : '決着がつきました。';
    dialog.showModal();
    return;
  }

  const body = $('result-body');
  body.replaceChildren();
  const shown = table.players.filter((p) => p.hole.length && (!p.out || p.won > 0));
  const winners = new Set(table.showdown ? table.showdown.pots.flatMap((pot) => pot.winners) : []);

  for (const p of shown) {
    const row = document.createElement('div');
    row.className = 'result-row';
    if (winners.has(p.index)) row.classList.add('winner');

    const name = document.createElement('span');
    name.textContent = p.name;

    const cards = document.createElement('span');
    cards.className = 'cards';
    const reveal = !p.folded && (!table.showdown?.uncontested || p.index === HUMAN);
    for (const card of p.hole) cards.append(reveal ? cardEl(card, { small: true }) : backEl({ small: true }));

    const label = document.createElement('span');
    const evaluated = table.showdown?.hands?.[p.index];
    label.textContent = p.folded ? 'フォールド' : (evaluated ? evaluated.name : '');

    const amount = document.createElement('span');
    amount.className = p.won > 0 ? 'won' : 'lost';
    amount.textContent = p.won > 0 ? `+${yen(p.won)}` : '';

    row.append(name, cards, label, amount);
    body.append(row);
  }

  const me = table.players[HUMAN];
  $('result-title').textContent = me.won > 0
    ? `${yen(me.won)} を獲得しました`
    : (me.folded ? 'このハンドは降りました' : 'このハンドは負けました');
  dialog.showModal();
}

// ---------------------------------------------------------------- 起動

function newGame(options) {
  clearTimeout(timer);
  closeRaisePanel();
  table = new Table({ options });
  table.startHand();
  setMessage('');
  step();
}

function currentOptions() {
  const saved = loadOptions();
  return {
    startingChips: saved.startingChips ?? 10000,
    smallBlind: saved.smallBlind ?? 50,
    bigBlind: (saved.smallBlind ?? 50) * 2,
    blindUpEvery: saved.blindUpEvery ?? 0,
  };
}

$('btn-fold').addEventListener('click', () => humanAct({ type: 'fold' }));
$('btn-check').addEventListener('click', () => {
  const legal = table.legalActions(HUMAN);
  humanAct({ type: legal.canCheck ? 'check' : 'call' });
});
$('btn-raise').addEventListener('click', () => {
  const legal = table.legalActions(HUMAN);
  if (legal.isAllInRaise) {
    humanAct({ type: 'raise', amount: legal.maxRaiseTo });
    return;
  }
  if (raiseMode) closeRaisePanel();
  else openRaisePanel();
});
$('btn-hint').addEventListener('click', showHint);

$('raise-slider').addEventListener('input', (event) => {
  raiseValue = Number(event.target.value);
  syncRaisePanel(table.legalActions(HUMAN));
});
$('raise-confirm').addEventListener('click', () => humanAct({ type: 'raise', amount: raiseValue }));
$('raise-cancel').addEventListener('click', () => { closeRaisePanel(); render(); });
for (const button of document.querySelectorAll('.raise-presets [data-fraction]')) {
  button.addEventListener('click', () => {
    const raw = button.dataset.fraction;
    raiseValue = presetAmount(raw === 'max' ? 'max' : Number(raw));
    syncRaisePanel(table.legalActions(HUMAN));
  });
}

$('result-next').addEventListener('click', () => {
  $('dlg-result').close();
  table.startHand();
  step();
});
$('over-restart').addEventListener('click', () => {
  $('dlg-over').close();
  newGame(currentOptions());
});

$('btn-settings').addEventListener('click', () => {
  const form = $('settings-form');
  const options = currentOptions();
  form.elements.startingChips.value = String(options.startingChips);
  form.elements.blinds.value = String(options.smallBlind);
  form.elements.blindUpEvery.value = String(options.blindUpEvery);
  $('dlg-settings').showModal();
});
$('settings-cancel').addEventListener('click', () => $('dlg-settings').close());
$('settings-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.target;
  const smallBlind = Number(form.elements.blinds.value);
  const options = {
    startingChips: Number(form.elements.startingChips.value),
    smallBlind,
    bigBlind: smallBlind * 2,
    blindUpEvery: Number(form.elements.blindUpEvery.value),
  };
  saveOptions(options);
  $('dlg-settings').close();
  newGame(options);
});

document.addEventListener('keydown', (event) => {
  if (event.target.closest('dialog')) return;
  if (table.phase !== PHASE.BETTING || table.toAct !== HUMAN) return;
  if (event.key === 'f' && !$('btn-fold').disabled) humanAct({ type: 'fold' });
  if (event.key === 'c' && !$('btn-check').disabled) $('btn-check').click();
  if (event.key === 'r' && !$('btn-raise').disabled) $('btn-raise').click();
});

newGame(currentOptions());
