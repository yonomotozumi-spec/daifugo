/** 画面まわり。ルール判定は engine.js、CPU の思考は ai.js に任せる。 */

import {
  DEFAULT_RULES, Game, PHASE, RANK_LABELS, SUIT_MARK,
  canPlay, cardLabel, describeCombo, enumerateCombos, parseCombo,
  sortHand, suitKeyMarks,
} from './engine.js';
import { decide } from './ai.js';

const $ = (id) => document.getElementById(id);
const HUMAN = 0;
const CPU_DELAY = 700;
const POINTS = { 大富豪: 3, 富豪: 2, 貧民: 1, 大貧民: 0 };
const STORAGE_KEY = 'daifugo:rules';

let game;
let selected = new Set();
let scores = [0, 0, 0, 0];
let says = ['', '', '', ''];
let busy = false;
let timer = null;

// ---------------------------------------------------------------- 部品

function loadRules() {
  try {
    return { ...DEFAULT_RULES, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_RULES };
  }
}

function saveRules(rules) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rules)); } catch { /* 保存できなくても遊べる */ }
}

function cardEl(card, clickable = false) {
  const el = document.createElement(clickable ? 'button' : 'div');
  if (clickable) el.type = 'button';
  el.className = 'card';
  if (card.joker) el.classList.add('joker');
  else if (card.suit === 'h' || card.suit === 'd') el.classList.add('red');
  el.dataset.id = card.id;

  const corner = document.createElement('span');
  corner.className = 'corner';
  const pip = document.createElement('span');
  pip.className = 'pip';
  if (card.joker) {
    corner.textContent = 'JK';
    pip.textContent = '★';
  } else {
    corner.textContent = RANK_LABELS[card.rank];
    pip.textContent = SUIT_MARK[card.suit];
  }
  el.append(corner, pip);
  el.setAttribute('aria-label', cardLabel(card));
  return el;
}

const selectedCards = () => game.players[HUMAN].hand.filter((c) => selected.has(c.id));

function say(index, text) {
  says[index] = text;
}

function setMessage(text, ok = false) {
  const el = $('message');
  el.textContent = text;
  el.classList.toggle('ok', ok);
}

// ---------------------------------------------------------------- 描画

function render() {
  const myTurn = game.phase === PHASE.PLAYING && game.turn === HUMAN && !busy;

  $('badge-round').textContent = `ラウンド ${game.round}`;
  $('badge-revolution').classList.toggle('hidden', !game.revolution);
  $('badge-lock').classList.toggle('hidden', !game.lock);
  if (game.lock) $('badge-lock').textContent = `縛り ${suitKeyMarks(game.lock)}`;

  renderOpponents();
  renderField(myTurn);
  renderHand(myTurn);
  renderControls(myTurn);
  renderSidebar();
}

function renderOpponents() {
  const box = $('opponents');
  box.replaceChildren();
  for (let i = 1; i < game.players.length; i++) {
    const p = game.players[i];
    const seat = document.createElement('div');
    seat.className = 'seat';
    if (game.phase === PHASE.PLAYING && game.turn === i) seat.classList.add('active');
    if (p.hand.length === 0) seat.classList.add('done');

    const head = document.createElement('div');
    head.className = 'seat-head';
    const name = document.createElement('span');
    name.textContent = p.name;
    head.append(name);
    if (p.title || p.lastTitle) head.append(titleChip(p.title || p.lastTitle));
    const count = document.createElement('span');
    count.className = 'seat-count';
    count.textContent = p.hand.length ? `${p.hand.length}枚` : 'あがり';
    head.append(count);

    const backs = document.createElement('div');
    backs.className = 'backs';
    for (let n = 0; n < Math.min(p.hand.length, 18); n++) {
      const back = document.createElement('span');
      back.className = 'back';
      backs.append(back);
    }

    const bubble = document.createElement('div');
    bubble.className = 'seat-say';
    bubble.textContent = says[i];

    seat.append(head, backs, bubble);
    box.append(seat);
  }
}

function titleChip(title) {
  const chip = document.createElement('span');
  chip.className = 'title-chip';
  if (title === '貧民' || title === '大貧民') chip.classList.add('poor');
  chip.textContent = title;
  return chip;
}

function renderField(myTurn) {
  const cards = $('field-cards');
  cards.replaceChildren();
  const empty = $('field-empty');

  if (game.field) {
    empty.classList.add('hidden');
    for (const card of game.field.combo.cards) cards.append(cardEl(card));
  } else {
    empty.classList.remove('hidden');
  }

  const notes = [];
  if (game.field) notes.push(`${game.players[game.field.playerIndex].name} の ${describeCombo(game.field.combo)}`);
  if (game.lock) notes.push(`縛り：${suitKeyMarks(game.lock)} のみ`);
  if (game.revolution) notes.push('革命中：3 が最強');
  if (game.phase === PHASE.PLAYING && !myTurn && game.current.isCPU) notes.push(`${game.current.name} が考え中…`);
  $('field-note').textContent = notes.join(' ／ ');
}

function renderHand(myTurn) {
  const me = game.players[HUMAN];
  const box = $('hand');
  box.replaceChildren();

  const playableIds = new Set();
  if (myTurn) {
    for (const combo of enumerateCombos(me.hand, game.rules)) {
      if (canPlay(combo, game.stateForRules).ok) {
        for (const c of combo.cards) playableIds.add(c.id);
      }
    }
  }

  for (const card of sortHand(me.hand, game.revolution)) {
    const el = cardEl(card, true);
    el.classList.toggle('selected', selected.has(card.id));
    el.classList.toggle('playable', playableIds.has(card.id));
    el.disabled = !myTurn;
    el.addEventListener('click', () => toggleCard(card.id));
    box.append(el);
  }

  $('my-count').textContent = `${me.hand.length}枚`;
  const chip = $('my-title');
  const title = me.title || me.lastTitle;
  chip.classList.toggle('hidden', !title);
  if (title) {
    chip.textContent = title;
    chip.classList.toggle('poor', title === '貧民' || title === '大貧民');
  }
}

function renderControls(myTurn) {
  const cards = selectedCards();
  const combo = cards.length ? parseCombo(cards, game.rules) : null;
  const verdict = combo ? canPlay(combo, game.stateForRules) : null;

  $('btn-play').disabled = !myTurn || !verdict?.ok;
  $('btn-pass').disabled = !myTurn || !game.canPass(HUMAN);
  $('btn-clear').disabled = cards.length === 0;
  $('btn-hint').disabled = !myTurn;

  if (!myTurn) {
    setMessage('');
    return;
  }
  if (!cards.length) {
    setMessage(game.field ? 'カードを選んで「出す」、無理なら「パス」' : 'あなたの番です。好きな手から出せます', true);
  } else if (!combo) {
    setMessage('その組み合わせは役になりません');
  } else if (!verdict.ok) {
    setMessage(verdict.reason);
  } else {
    setMessage(`${describeCombo(combo)} を出せます`, true);
  }
}

function renderSidebar() {
  const list = $('scores');
  list.replaceChildren();
  game.players.forEach((p, i) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = p.name;
    const pts = document.createElement('span');
    pts.className = 'pts';
    pts.textContent = `${scores[i]} pt`;
    li.append(name, pts);
    list.append(li);
  });

  const log = $('log');
  log.replaceChildren();
  for (const line of game.log.slice(-40).reverse()) {
    const li = document.createElement('li');
    li.textContent = line;
    log.append(li);
  }
}

// ---------------------------------------------------------------- 操作

function toggleCard(id) {
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);
  render();
}

function humanPlay() {
  const cards = selectedCards();
  const result = game.play(HUMAN, cards);
  if (!result.ok) {
    setMessage(result.reason);
    return;
  }
  selected.clear();
  say(HUMAN, '');
  afterMove();
}

function humanPass() {
  const result = game.pass(HUMAN);
  if (!result.ok) {
    setMessage(result.reason);
    return;
  }
  selected.clear();
  afterMove();
}

function showHint() {
  const move = decide(game, HUMAN);
  if (move.action === 'pass') {
    selected.clear();
    render();
    setMessage('出せる手がありません。パスしましょう');
    return;
  }
  selected = new Set(move.cards.map((c) => c.id));
  render();
  setMessage(`おすすめ：${describeCombo(parseCombo(move.cards, game.rules))}`, true);
}

function afterMove() {
  render();
  if (game.phase === PHASE.ROUND_END) {
    endRound();
    return;
  }
  runCPU();
}

function runCPU() {
  clearTimeout(timer);
  if (game.phase !== PHASE.PLAYING) return;
  if (!game.current.isCPU) {
    busy = false;
    render();
    return;
  }
  busy = true;
  render();
  timer = setTimeout(() => {
    const index = game.turn;
    const move = decide(game, index);
    const result = move.action === 'pass' ? game.pass(index) : game.play(index, move.cards);
    if (!result.ok) {
      // 念のため：非合法手を選んだらパスに落とす（場が空ならその場で打ち切る）。
      if (game.field) game.pass(index);
      else { busy = false; render(); return; }
    }
    say(index, move.action === 'pass' ? 'パス' : describeCombo(parseCombo(move.cards, game.rules)));
    render();
    if (game.phase === PHASE.ROUND_END) {
      endRound();
      return;
    }
    runCPU();
  }, CPU_DELAY);
}

// ---------------------------------------------------------------- ラウンド進行

function beginRound() {
  selected.clear();
  says = ['', '', '', ''];
  busy = false;

  if (game.phase === PHASE.EXCHANGE) {
    const pair = game.exchange.pairs.find((p) => p.rich === HUMAN);
    if (pair) {
      render();
      openExchange(pair);
      return;
    }
    game.commitExchange();
  }
  render();
  runCPU();
}

function endRound() {
  busy = true;
  for (const p of game.players) scores[p.index] += POINTS[p.title] ?? 0;
  render();

  const list = $('result-list');
  list.replaceChildren();
  for (const index of game.finishOrder) {
    const p = game.players[index];
    const li = document.createElement('li');
    li.textContent = `${p.title}：${p.name}`;
    if (index === HUMAN) li.className = 'me-row';
    list.append(li);
  }
  $('result-title').textContent = `ラウンド ${game.round} 終了 — あなたは ${game.players[HUMAN].title}`;
  $('dlg-result').showModal();
}

function openExchange(pair) {
  const dialog = $('dlg-exchange');
  const box = $('exchange-hand');
  const ok = $('exchange-ok');
  let picked = new Set();

  const refresh = () => {
    box.replaceChildren();
    for (const card of sortHand(game.players[HUMAN].hand, false)) {
      const el = cardEl(card, true);
      el.classList.toggle('selected', picked.has(card.id));
      el.addEventListener('click', () => {
        if (picked.has(card.id)) picked.delete(card.id);
        else if (picked.size < pair.count) picked.add(card.id);
        refresh();
      });
      box.append(el);
    }
    ok.disabled = picked.size !== pair.count;
    ok.textContent = `この${pair.count}枚を渡す`;
  };

  const poor = game.players[pair.poor];
  $('exchange-text').textContent =
    `あなたは ${game.players[HUMAN].lastTitle} です。${poor.name}（${poor.lastTitle}）に渡すカードを ${pair.count} 枚選んでください。` +
    `代わりに ${poor.name} の強いカード ${pair.count} 枚を受け取ります。`;

  $('exchange-auto').onclick = () => {
    picked = new Set(game.autoGive(HUMAN, pair.count).map((c) => c.id));
    refresh();
  };
  ok.onclick = () => {
    game.commitExchange({ [HUMAN]: game.players[HUMAN].hand.filter((c) => picked.has(c.id)) });
    dialog.close();
    render();
    runCPU();
  };

  refresh();
  dialog.showModal();
}

// ---------------------------------------------------------------- 起動

function newGame(rules) {
  clearTimeout(timer);
  scores = [0, 0, 0, 0];
  game = new Game({ rules });
  beginRound();
}

function openSettings() {
  const form = $('settings-form');
  for (const key of Object.keys(DEFAULT_RULES)) {
    const input = form.elements[key];
    if (input) input.checked = Boolean(game.rules[key]);
  }
  $('dlg-settings').showModal();
}

$('btn-play').addEventListener('click', humanPlay);
$('btn-pass').addEventListener('click', humanPass);
$('btn-clear').addEventListener('click', () => { selected.clear(); render(); });
$('btn-hint').addEventListener('click', showHint);
$('btn-settings').addEventListener('click', openSettings);
$('settings-cancel').addEventListener('click', () => $('dlg-settings').close());

$('settings-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const rules = { ...game.rules };
  for (const key of Object.keys(DEFAULT_RULES)) {
    const input = event.target.elements[key];
    if (input) rules[key] = input.checked;
  }
  saveRules(rules);
  $('dlg-settings').close();
  newGame(rules);
});

$('result-next').addEventListener('click', () => {
  $('dlg-result').close();
  game.startRound();
  beginRound();
});

document.addEventListener('keydown', (event) => {
  if (event.target.closest('dialog')) return;
  if (event.key === 'Enter' && !$('btn-play').disabled) humanPlay();
  if (event.key === 'p' && !$('btn-pass').disabled) humanPass();
  if (event.key === 'Escape') { selected.clear(); render(); }
});

newGame(loadRules());
