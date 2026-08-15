/** 画面まわりとゲーム進行。抽選と判定は engine.js、描画は scene.js に任せる。 */

import {
  FIGHT, FISH, HOOK_WINDOW, RARITY, SHOP_KINDS, SPOTS,
  Fight, biteDelay, buy, collectionProgress, createPlayer, equip,
  equippedLure, equippedRod, fishOfSpot, normalizePlayer, owns, pickFish,
  recordCatch, sell, sizeLabel, sizeTitle, spotById, timeAt, yen,
} from './engine.js';
import { CAST_TIME, LAND_TIME, Scene } from './scene.js';

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'fishing:save';

/** 画面の状態。scene 側の見た目と 1 対 1 ではないので別に持つ。 */
const MODE = {
  idle: 'idle',     // 待機。キャストできる
  cast: 'cast',     // 飛んでいる最中
  wait: 'wait',     // アタリ待ち
  bite: 'bite',     // 合わせられる猶予
  fight: 'fight',   // 寄せている
  result: 'result', // 釣果カードを出している
  busy: 'busy',     // 演出中で操作を受けない
};

let player = load();
let scene;
let mode = MODE.idle;
let fight = null;
let pending = null;      // 掛かっている魚（抽選済み）
let holding = false;
let timer = null;
let lastFrame = 0;
let shopKind = 'rod';
let displayMoney = player.money;

// ---------------------------------------------------------------- セーブ

function load() {
  try {
    return normalizePlayer(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'));
  } catch {
    return createPlayer();
  }
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(player)); } catch { /* 保存できなくても遊べる */ }
}

// ---------------------------------------------------------------- 表示

function setStatus(text, tone = '') {
  const el = $('status');
  el.textContent = text;
  el.className = `hud-status ${tone}`;
  el.classList.remove('pulse');
  void el.offsetWidth;   // アニメーションを頭から流し直す
  el.classList.add('pulse');
}

function setHint(text) {
  $('hint').textContent = text || '';
}

function log(text, tone = '') {
  const li = document.createElement('li');
  li.textContent = text;
  if (tone) li.className = tone;
  const list = $('log');
  list.prepend(li);
  while (list.children.length > 40) list.lastElementChild.remove();
}

/** 所持金はパチパチ数字が上がる。 */
function renderMoney(animate = true) {
  const el = $('money');
  if (!animate) {
    displayMoney = player.money;
    el.textContent = displayMoney.toLocaleString('ja-JP');
    return;
  }
  const from = displayMoney;
  const to = player.money;
  if (from === to) return;
  const start = performance.now();
  const dur = 700;
  const tick = (now) => {
    const t = Math.min(1, (now - start) / dur);
    displayMoney = Math.round(from + (to - from) * (1 - (1 - t) * (1 - t)));
    el.textContent = displayMoney.toLocaleString('ja-JP');
    if (t < 1) requestAnimationFrame(tick);
  };
  $('wallet').classList.remove('bump');
  void $('wallet').offsetWidth;
  $('wallet').classList.add('bump');
  requestAnimationFrame(tick);
}

function renderHud() {
  const spot = spotById(player.spot);
  const time = timeAt(player.timeIndex);
  $('badge-spot').textContent = spot.name;
  $('badge-time').textContent = time.label;
  $('badge-time').dataset.time = time.id;
  $('badge-rod').textContent = equippedRod(player).name;
  $('badge-lure').textContent = equippedLure(player).name;
  $('stat-casts').textContent = player.casts;
  $('stat-catches').textContent = player.catches;
  $('stat-earned').textContent = yen(player.earned);
  const prog = collectionProgress(player, player.spot);
  $('stat-book').textContent = `${prog.found} / ${prog.total}`;
  scene.setSpot(player.spot);
  scene.setTime(time.id);
}

function setAction(label, { disabled = false, hot = false } = {}) {
  const btn = $('btn-action');
  btn.textContent = label;
  btn.disabled = disabled;
  btn.classList.toggle('hot', hot);
}

// ---------------------------------------------------------------- 進行

function setMode(next) {
  mode = next;
}

function cast() {
  if (mode !== MODE.idle) return;
  clearTimeout(timer);
  hideResult();
  player.casts += 1;
  player.timeIndex += 1;
  renderHud();
  save();

  setMode(MODE.cast);
  setAction('…', { disabled: true });
  setStatus('キャスト！');
  setHint('');
  scene.cast(0.35 + Math.random() * 0.6);

  timer = setTimeout(() => {
    setMode(MODE.wait);
    setAction('合わせる', { disabled: false });
    setStatus('アタリを待とう…');
    setHint('ウキが沈んだ瞬間に合わせる');
    const delay = biteDelay(Math.random, { lure: equippedLure(player), timeIndex: player.timeIndex });
    timer = setTimeout(startBite, delay * 1000);
  }, CAST_TIME * 1000);
}

function startBite() {
  pending = pickFish(player.spot, {
    rng: Math.random,
    rod: equippedRod(player),
    lure: equippedLure(player),
    timeIndex: player.timeIndex,
  });
  setMode(MODE.bite);
  scene.bite();
  buzz(35);
  setAction('合わせる！', { hot: true });
  setStatus('きた！ 合わせろ！', 'alert');
  timer = setTimeout(() => missBite('逃げられた… 合わせが遅かった'), HOOK_WINDOW * 1000);
}

function missBite(text) {
  clearTimeout(timer);
  pending = null;
  setMode(MODE.busy);
  scene.fail('escaped');
  setStatus(text, 'bad');
  setHint('');
  log(text, 'bad');
  timer = setTimeout(backToIdle, 900);
}

function hook() {
  clearTimeout(timer);
  const rod = equippedRod(player);
  fight = new Fight({
    fish: pending.fish, rod, sizeRatio: pending.sizeRatio, rng: Math.random,
  });
  setMode(MODE.fight);
  scene.hook(fight);
  buzz(20);
  setAction('巻く（長押し）', { hot: true });
  const heavy = pending.fish.power > rod.power;
  setStatus(heavy ? '重い！ かなりの大物だ' : '掛かった！ 巻き上げろ！', heavy ? 'alert' : '');
  setHint(heavy ? '竿が負けている。巻きっぱなしはライン切れ' : '魚を緑のバーに入れ続ける');
}

function finishFight(phase) {
  const result = pending;
  fight = null;
  pending = null;
  holding = false;
  setMode(MODE.busy);

  if (phase === FIGHT.caught) {
    scene.land(result);
    buzz([25, 45, 90]);
    const isNew = recordCatch(player, result);
    result.isNew = isNew;
    save();
    setStatus('釣り上げた！', 'good');
    setHint('');
    timer = setTimeout(() => showResult(result), LAND_TIME * 1000);
    return;
  }

  const text = phase === FIGHT.snapped
    ? `ラインが切れた… ${result.fish.name}には竿が負けている`
    : `${result.fish.name}に逃げられた…`;
  scene.fail(phase === FIGHT.snapped ? 'snapped' : 'escaped');
  buzz(phase === FIGHT.snapped ? [70, 50, 70] : 40);
  setStatus(text, 'bad');
  setHint(phase === FIGHT.snapped ? 'もっと強い竿を買おう' : '');
  log(text, 'bad');
  timer = setTimeout(backToIdle, 1100);
}

function backToIdle() {
  clearTimeout(timer);
  scene.reset();
  setMode(MODE.idle);
  setAction('キャスト');
  setStatus('竿を振って釣りを始めよう');
  setHint('');
  renderHud();
}

// ---------------------------------------------------------------- 釣果カード

function showResult(result) {
  setMode(MODE.result);
  const card = $('result-card');
  const rarity = RARITY[result.fish.rarity];
  $('result-rarity').textContent = rarity.label;
  $('result-rarity').style.setProperty('--rarity', rarity.color);
  $('result-emoji').textContent = result.fish.emoji;
  $('result-name').textContent = result.fish.name;
  $('result-size').textContent = sizeLabel(result);
  $('result-price').textContent = result.price.toLocaleString('ja-JP');

  const title = sizeTitle(result.sizeRatio);
  $('result-title').hidden = !title;
  if (title) {
    $('result-title').textContent = title.label;
    $('result-title').dataset.tone = title.tone;
  }
  $('result-new').hidden = !result.isNew;

  card.dataset.rarity = result.fish.rarity;
  card.hidden = false;
  card.classList.remove('in');
  void card.offsetWidth;
  card.classList.add('in');

  // ボタンは場所を空けたまま消す（canvas の高さが変わらないように）
  $('btn-action').classList.add('invisible');
  setHint('スペースキーでも売れる');
  const rarityNote = ['epic', 'legendary'].includes(result.fish.rarity) ? '！！' : '';
  log(`${result.fish.name}（${sizeLabel(result)}）を釣った${rarityNote}`, result.fish.rarity);
  renderHud();
  card.pendingResult = result;
}

function hideResult() {
  const card = $('result-card');
  card.hidden = true;
  card.pendingResult = null;
  $('btn-action').classList.remove('invisible');
}

function sellResult() {
  const card = $('result-card');
  const result = card.pendingResult;
  if (!result) return;
  scene.coins(14);
  buzz(15);
  sell(player, result);
  save();
  renderMoney();
  log(`${result.fish.name}を ${yen(result.price)} で売った`, 'money');
  hideResult();
  backToIdle();
  setStatus(`${yen(result.price)} で売れた！`, 'good');
}

function releaseResult() {
  const card = $('result-card');
  const result = card.pendingResult;
  if (!result) return;
  scene.ring(scene.lure.x, scene.waterY(), 1.2);
  scene.splash(scene.lure.x, scene.waterY(), 10, 1);
  log(`${result.fish.name}を逃がした（記録は残る）`);
  hideResult();
  backToIdle();
  setStatus('また大きくなって会おう');
}

// ---------------------------------------------------------------- 入力

function press() {
  switch (mode) {
    case MODE.idle:
      cast();
      break;
    case MODE.wait:
      missBite('早合わせ！ 何も掛かっていない');
      break;
    case MODE.bite:
      hook();
      break;
    case MODE.fight:
      holding = true;
      scene.setHolding(true);
      break;
    case MODE.result:
      sellResult();
      break;
    default:
      break;
  }
}

function release() {
  if (mode === MODE.fight) {
    holding = false;
    scene.setHolding(false);
  }
}

// ---------------------------------------------------------------- ショップ

function openShop(kind = shopKind) {
  shopKind = kind;
  renderShop();
  $('dlg-shop').showModal();
}

function shopItems(kind) {
  return SHOP_KINDS[kind].list;
}

function itemStats(kind, item) {
  if (kind === 'rod') {
    return [
      ['パワー', '★'.repeat(item.power) + '☆'.repeat(5 - item.power)],
      ['寄せ速度', `${Math.round(item.reel * 100)}`],
      ['バーの広さ', `${Math.round(item.barH * 100)}`],
      ['ライン強度', `${item.line.toFixed(1)}`],
    ];
  }
  if (kind === 'lure') {
    const spots = Object.entries(item.spotBonus || {})
      .map(([id, v]) => `${spotById(id)?.name ?? id}×${v.toFixed(1)}`).join(' ');
    return [
      ['レア度アップ', `+${Math.round(item.rarityBonus * 100)}%`],
      ['アタリの速さ', `+${Math.round(item.biteSpeed * 100)}%`],
      ['ゴミ回避', `${Math.round(item.junkCut * 100)}%`],
      ['得意な場所', spots || '—'],
    ];
  }
  const all = fishOfSpot(item.id);
  const found = all.filter((f) => player.records[f.id]).length;
  return [
    ['魚の種類', `${all.length}種`],
    ['発見済み', `${found}種`],
    ['最高額の魚', yen(Math.max(...all.map((f) => f.value)) * 2)],
  ];
}

function renderShop() {
  $('shop-money').textContent = yen(player.money);
  for (const tab of document.querySelectorAll('.tab')) {
    tab.classList.toggle('active', tab.dataset.kind === shopKind);
  }
  const list = $('shop-list');
  list.innerHTML = '';
  const equipKey = SHOP_KINDS[shopKind].equip;

  for (const item of shopItems(shopKind)) {
    const has = owns(player, shopKind, item.id);
    const equipped = player[equipKey] === item.id;
    const card = document.createElement('article');
    card.className = `shop-item${equipped ? ' equipped' : ''}${has ? ' owned' : ''}`;

    const head = document.createElement('div');
    head.className = 'shop-item-head';
    head.innerHTML = `<h3>${item.name}</h3>`;
    const price = document.createElement('span');
    price.className = 'shop-price';
    price.textContent = has ? '購入済み' : yen(item.price);
    if (!has && player.money < item.price) price.classList.add('short');
    head.append(price);

    const note = document.createElement('p');
    note.className = 'shop-note';
    note.textContent = item.note;

    const stats = document.createElement('dl');
    stats.className = 'shop-stats';
    for (const [label, value] of itemStats(shopKind, item)) {
      const div = document.createElement('div');
      div.innerHTML = `<dt>${label}</dt><dd>${value}</dd>`;
      stats.append(div);
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = has ? 'ghost' : 'primary';
    const equipLabel = shopKind === 'spot' ? '移動する' : '装備する';
    btn.textContent = equipped ? (shopKind === 'spot' ? '釣り中' : '装備中') : has ? equipLabel : '買う';
    btn.disabled = equipped || (!has && player.money < item.price);
    btn.addEventListener('click', () => {
      if (has) {
        equip(player, shopKind, item.id);
        shopMsg(`${item.name}に${shopKind === 'spot' ? '移動した' : 'かえた'}`);
        log(shopKind === 'spot' ? `${item.name}へ移動した` : `${item.name}を装備した`);
      } else {
        const res = buy(player, shopKind, item.id);
        if (!res.ok) return shopMsg(res.error, true);
        shopMsg(`${item.name}を購入！`);
        log(`${item.name}を ${yen(item.price)} で購入した`, 'money');
        renderMoney();
        card.classList.add('bought');
      }
      save();
      renderHud();
      renderShop();
      if (mode === MODE.idle) backToIdle();
    });

    card.append(head, note, stats, btn);
    list.append(card);
  }
}

function shopMsg(text, bad = false) {
  const el = $('shop-msg');
  el.textContent = text;
  el.className = `shop-msg${bad ? ' bad' : ' good'}`;
  el.classList.remove('pulse');
  void el.offsetWidth;
  el.classList.add('pulse');
}

// ---------------------------------------------------------------- 図鑑

function openBook() {
  const book = $('book');
  book.innerHTML = '';
  let found = 0;
  for (const spot of SPOTS) {
    const section = document.createElement('section');
    const list = fishOfSpot(spot.id);
    const prog = collectionProgress(player, spot.id);
    found += prog.found;
    section.innerHTML = `<h3>${spot.name} <span>${prog.found} / ${prog.total}</span></h3>`;
    const grid = document.createElement('div');
    grid.className = 'book-grid';
    for (const f of list) {
      const rec = player.records[f.id];
      const cell = document.createElement('div');
      cell.className = `book-cell${rec ? '' : ' unknown'}`;
      cell.style.setProperty('--rarity', RARITY[f.rarity].color);
      cell.innerHTML = rec
        ? `<span class="book-emoji">${f.emoji}</span>
           <strong>${f.name}</strong>
           <small>最大 ${rec.lengthCm}cm / ${rec.weightKg}kg</small>
           <small>${rec.count}匹 ・ 最高 ${yen(rec.price)}</small>`
        : `<span class="book-emoji">❔</span><strong>？？？</strong><small>${RARITY[f.rarity].label}</small>`;
      grid.append(cell);
    }
    section.append(grid);
    book.append(section);
  }
  $('book-progress').textContent = `${found} / ${FISH.length} 種`;
  $('dlg-book').showModal();
}

// ---------------------------------------------------------------- ループ

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;

  if (mode === MODE.fight && fight) {
    const phase = fight.update(dt, holding);
    if (phase !== FIGHT.fighting) finishFight(phase);
  }
}

// ---------------------------------------------------------------- アプリとして使う

/** 手にも伝える。対応していない端末では黙って無視される。 */
function buzz(pattern) {
  try { navigator.vibrate?.(pattern); } catch { /* 触覚がなくても遊べる */ }
}

/** ホーム画面から起動しているか。 */
const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);   // iPadOS

/** オフラインでも遊べるようにキャッシュを仕込む。 */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (!['https:', 'http:'].includes(location.protocol)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* 入れられなくても遊べる */ });
  });
}

/**
 * 「アプリとして追加」ボタン。
 * Android / デスクトップ Chrome は beforeinstallprompt が来たときだけ出し、
 * iOS は仕組みがないので手順を書いたダイアログを出す。
 */
function setupInstall() {
  const btn = $('btn-install');
  let deferred = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    if (!isStandalone()) btn.classList.remove('hidden');
  });

  window.addEventListener('appinstalled', () => {
    deferred = null;
    btn.classList.add('hidden');
    log('アプリとして追加した。ホーム画面から遊べます。');
  });

  if (isIOS() && !isStandalone()) btn.classList.remove('hidden');

  btn.addEventListener('click', async () => {
    if (deferred) {
      deferred.prompt();
      const { outcome } = await deferred.userChoice;
      if (outcome === 'accepted') btn.classList.add('hidden');
      deferred = null;
      return;
    }
    $('dlg-ios').showModal();
  });
}

/** 狭い画面で日誌を下から引き出す。 */
function setupLogSheet() {
  const sheet = $('sidebar');
  const backdrop = $('sheet-backdrop');
  const btn = $('btn-log');

  const setOpen = (open) => {
    sheet.classList.toggle('open', open);
    backdrop.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  };

  btn.addEventListener('click', () => setOpen(!sheet.classList.contains('open')));
  backdrop.addEventListener('click', () => setOpen(false));
  // つまみを下に払っても閉じられる
  sheet.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.sheet-grip')) return;
    const startY = e.clientY;
    const end = (up) => {
      window.removeEventListener('pointerup', end);
      if (up.clientY - startY > 30) setOpen(false);
    };
    window.addEventListener('pointerup', end);
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setOpen(false);
  });
}

// ---------------------------------------------------------------- 起動

function init() {
  scene = new Scene($('scene'));
  scene.start();
  window.addEventListener('resize', () => scene.resize());
  // サイドバーの伸縮などでも canvas の解像度を追従させる
  if (window.ResizeObserver) new ResizeObserver(() => scene.resize()).observe($('stage'));

  renderMoney(false);
  renderHud();
  setAction('キャスト');
  log('今日はいい天気だ。釣りに行こう。');

  const btn = $('btn-action');
  btn.addEventListener('pointerdown', (e) => { e.preventDefault(); press(); });
  btn.addEventListener('pointerup', release);
  btn.addEventListener('pointercancel', release);
  btn.addEventListener('pointerleave', release);

  // ステージのどこを押しても操作できる（結果カードの上は除く）
  $('stage').addEventListener('pointerdown', (e) => {
    // 釣果カードが出ているあいだは、水面をクリックしても売ってしまわないようにする
    if (mode === MODE.result || e.target.closest('.result-card')) return;
    press();
  });
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);

  window.addEventListener('keydown', (e) => {
    if (e.target.closest('dialog')) return;
    if (e.code === 'Space' || e.key === ' ') {
      e.preventDefault();
      if (!e.repeat) press();
      else if (mode === MODE.fight) { holding = true; scene.setHolding(true); }
    } else if (e.key === 's' || e.key === 'S') {
      openShop();
    } else if (e.key === 'z' || e.key === 'Z') {
      openBook();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' || e.key === ' ') release();
  });
  window.addEventListener('blur', release);

  $('btn-shop').addEventListener('click', () => openShop());
  $('btn-book').addEventListener('click', openBook);
  $('btn-sell').addEventListener('click', sellResult);
  $('btn-release').addEventListener('click', releaseResult);

  registerServiceWorker();
  setupInstall();
  setupLogSheet();
  // 画面の向きが変わったら canvas を作り直す
  window.addEventListener('orientationchange', () => setTimeout(() => scene.resize(), 250));
  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => { shopKind = tab.dataset.kind; renderShop(); });
  }

  // 通し確認（test/browser.smoke.mjs）から中の状態を覗くための窓口。
  window.fishing = {
    get mode() { return mode; },
    get fight() { return fight; },
    get player() { return player; },
    scene,
    save,
    render() { renderMoney(false); renderHud(); },
  };

  lastFrame = performance.now();
  requestAnimationFrame(frame);
}

init();
