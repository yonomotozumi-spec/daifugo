/** 画面まわり。ルール判定は engine.js、CPU の思考は ai.js に任せる。 */

import {
  DEFAULT_RULES, Game, PHASE, RANK_LABELS, SUIT_MARK,
  canPlay, cardLabel, describeCombo, enumerateCombos, parseCombo,
  sortHand, suitKeyMarks,
} from './engine.js';
import { decide } from './ai.js';
import {
  DEFAULT_LENGTH, MATCH_LENGTHS, POINTS,
  applyRound, createMatch, isOver, roundsLeft, standings, verdict,
} from './match.js';

const $ = (id) => document.getElementById(id);
const HUMAN = 0;
const CPU_DELAY = 700;
const STORAGE_KEY = 'daifugo:rules';
const MATCH_KEY = 'daifugo:match';

let game;
let match;
let selected = new Set();
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

function loadMatchLength() {
  const saved = Number(localStorage.getItem(MATCH_KEY));
  return MATCH_LENGTHS.includes(saved) ? saved : DEFAULT_LENGTH;
}

function saveMatchLength(rounds) {
  try { localStorage.setItem(MATCH_KEY, String(rounds)); } catch { /* 保存できなくても遊べる */ }
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

  $('badge-round').textContent = `ラウンド ${game.round} / ${match.rounds}`;
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
  const rows = standings(match);
  for (const row of rows) {
    const p = game.players[row.index];
    const li = document.createElement('li');
    if (row.index === HUMAN) li.className = 'me-row';
    const name = document.createElement('span');
    // 1 位には王冠。同点のときは全員につく
    name.textContent = `${row.rank === 1 && match.played > 0 ? '👑 ' : ''}${p.name}`;
    const pts = document.createElement('span');
    pts.className = 'pts';
    pts.textContent = `${row.points} pt`;
    li.append(name, pts);
    list.append(li);
  }

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
  applyRound(match, game.players);
  render();

  const list = $('result-list');
  list.replaceChildren();
  for (const index of game.finishOrder) {
    const p = game.players[index];
    const li = document.createElement('li');
    li.textContent = `${p.title}：${p.name}（+${POINTS[p.title] ?? 0}pt → ${match.scores[index]}pt）`;
    if (index === HUMAN) li.className = 'me-row';
    list.append(li);
  }
  $('result-title').textContent = `ラウンド ${game.round} 終了 — あなたは ${game.players[HUMAN].title}`;
  $('result-note').textContent = isOver(match)
    ? 'これで最終ラウンド。総合結果を見よう'
    : `残り ${roundsLeft(match)} ラウンド`;
  $('result-next').textContent = isOver(match) ? '総合結果へ' : '次のラウンドへ';
  $('dlg-result').showModal();
}

/** 全ラウンドを終えたときの総合成績。 */
function showFinal() {
  const names = game.players.map((p) => p.name);
  const rows = standings(match);
  const medals = ['🥇', '🥈', '🥉'];

  const list = $('final-list');
  list.replaceChildren();
  for (const row of rows) {
    const li = document.createElement('li');
    if (row.index === HUMAN) li.className = 'me-row';
    const left = document.createElement('span');
    left.textContent = `${medals[row.rank - 1] ?? `${row.rank}位`} ${names[row.index]}${row.tied ? '（同順位）' : ''}`;
    const right = document.createElement('span');
    right.className = 'pts';
    const titles = ['大富豪', '富豪', '貧民', '大貧民']
      .filter((t) => row.titles[t])
      .map((t) => `${t}${row.titles[t]}`)
      .join(' ');
    right.textContent = `${row.points} pt`;
    li.append(left, right);
    li.title = titles;
    list.append(li);
  }

  const you = rows.find((r) => r.index === HUMAN);
  $('final-title').textContent = verdict(match, names);
  $('final-note').textContent = you.rank === 1
    ? (you.tied ? '同点で分け合っての優勝！' : `${match.rounds} ラウンドを制した！`)
    : `あなたは ${you.rank} 位（${you.points}pt）。次はもっと上を狙おう`;
  $('final-title').classList.toggle('win', you.rank === 1);
  $('dlg-final').showModal();
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

function newGame(rules, rounds = match?.rounds ?? DEFAULT_LENGTH) {
  clearTimeout(timer);
  match = createMatch(rounds);
  game = new Game({ rules });
  beginRound();
}

function openSettings() {
  const form = $('settings-form');
  for (const key of Object.keys(DEFAULT_RULES)) {
    const input = form.elements[key];
    if (input) input.checked = Boolean(game.rules[key]);
  }
  if (form.elements.matchRounds) form.elements.matchRounds.value = String(match.rounds);
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
  const rounds = Number(event.target.elements.matchRounds?.value) || DEFAULT_LENGTH;
  saveRules(rules);
  saveMatchLength(rounds);
  $('dlg-settings').close();
  newGame(rules, rounds);
});

$('result-next').addEventListener('click', () => {
  $('dlg-result').close();
  if (isOver(match)) {
    showFinal();
    return;
  }
  game.startRound();
  beginRound();
});

$('final-again').addEventListener('click', () => {
  $('dlg-final').close();
  newGame(game.rules);
});

document.addEventListener('keydown', (event) => {
  if (event.target.closest('dialog')) return;
  if (event.key === 'Enter' && !$('btn-play').disabled) humanPlay();
  if (event.key === 'p' && !$('btn-pass').disabled) humanPass();
  if (event.key === 'Escape') { selected.clear(); render(); }
});

newGame(loadRules(), loadMatchLength());
