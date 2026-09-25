/** 画面まわりとゲーム進行。抽選と判定は engine.js、描画は scene.js に任せる。 */

import {
  CHARMS, FIGHT, FISH, RARITY, SHOP_KINDS, SPOTS,
  Fight, advanceWeather, biteDelay, buy, buyCharm, charmCount, collectionProgress,
  createPlayer, equip, equippedLure, equippedRod, fishOfSpot, gearEffects, hookWindow,
  normalizePlayer, owns, pickFish, recordCatch, rollEvent, sell, sizeLabel,
  shortMoney, sizeTitle, spotById, tickEvent, timeAt, useCharm, weatherById, yen,
  MAX_POWER, isHardSpot, spotHazard, spotLocked,
  ACHIEVEMENTS, RANKS, SHINY, achievementState, checkAchievements, dailyProgress,
  earnedTitles, gainXp, nextRank, progressDaily, rankEffects, rankOf, rankProgress, refreshDaily,
  setTitle, shinyKinds, todayKey, totalEffects,
  advanceTutorial, exportSave, importSave, saveSummary, tutorialStep,
} from './engine.js';
import { CAST_TIME, LAND_TIME, Scene } from './scene.js';
import { sound } from './sound.js';

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
let timer2 = null;        // 着水音など、進行とは別に鳴らすもの
let gestured = false;     // 一度でも画面に触れたか（音と振動はそれから）
let lastFrame = 0;
let shopKind = 'rod';
let displayMoney = player.money;
let announcedSpot = null;   // 「行けるようになった」と知らせ済みの釣り場
let happening = null;       // いま起きているできごと { event, left }
let charmState = null;      // 使っているお札 { charm, left }

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

/** 狭い画面では所持金の桁を詰める（上部バーがはみ出さないように）。 */
const narrowScreen = () => window.matchMedia?.('(max-width: 900px)').matches ?? false;

/** 所持金はパチパチ数字が上がる。 */
function renderMoney(animate = true) {
  const el = $('money');
  const narrow = narrowScreen();
  $('wallet').title = `${player.money.toLocaleString('ja-JP')}円`;
  if (!animate) {
    displayMoney = player.money;
    el.textContent = shortMoney(displayMoney, narrow);
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
    el.textContent = shortMoney(displayMoney, narrow);
    if (t < 1) requestAnimationFrame(tick);
  };
  $('wallet').classList.remove('bump');
  void $('wallet').offsetWidth;
  $('wallet').classList.add('bump');
  requestAnimationFrame(tick);
  checkNewSpot();
}

function renderHud() {
  const rank = rankOf(player);
  const rankBadge = $('badge-rank');
  rankBadge.querySelector('.r-lv').textContent = `Lv.${rank.level}`;
  rankBadge.querySelector('.r-name').textContent = rank.name;
  rankBadge.title = `熟練度 Lv.${rank.level}「${rank.name}」 ${player.xp.toLocaleString('ja-JP')} 経験値`;
  const titleBadge = $('badge-title');
  titleBadge.hidden = !player.title;
  if (player.title) titleBadge.textContent = `《${player.title}》`;

  const spot = spotById(player.spot);
  const time = timeAt(player.timeIndex);
  $('badge-spot').textContent = spot.name;
  $('badge-spot').dataset.hard = String(spot.hard ?? 0);
  $('badge-spot').title = isHardSpot(spot) ? `難所（${'🔥'.repeat(spot.hard)}）：${spot.note}` : spot.note;
  $('badge-time').textContent = time.label;
  $('badge-time').dataset.time = time.id;
  const weather = weatherById(player.weather);
  const badge = $('badge-weather');
  badge.querySelector('.w-emoji').textContent = weather.emoji;
  badge.querySelector('.w-label').textContent = weather.label;
  badge.dataset.weather = weather.id;
  badge.title = `${weather.label}：${weather.note}`;
  $('badge-rod').textContent = equippedRod(player).name;
  $('badge-lure').textContent = equippedLure(player).name;
  $('stat-casts').textContent = player.casts;
  $('stat-catches').textContent = player.catches;
  $('stat-earned').textContent = yen(player.earned);
  const prog = collectionProgress(player, player.spot);
  $('stat-book').textContent = `${prog.found} / ${prog.total}`;
  scene.setSpot(player.spot);
  scene.setTime(time.id);
  scene.setWeather(player.weather);
  renderEvent();
}

/** いま効いているできごと・お札の帯。 */
function renderEvent() {
  const banner = $('event-banner');
  const active = [happening, charmState].filter(Boolean);
  banner.hidden = active.length === 0;
  if (!active.length) return;
  banner.textContent = active
    .map(({ event, charm, left }) => {
      const item = event ?? charm;
      return `${item.emoji} ${item.label ?? item.name}（あと ${left} 投）`;
    })
    .join('　');
  banner.dataset.event = happening?.event.id ?? 'charm';
}

/**
 * 難所の鍵になっている魚を釣ったら、その場で知らせる。
 * ショップを開かないと気づけないのでは、せっかくのヌシがもったいない。
 */
function announceUnlock(fish) {
  const opened = SPOTS.find((s) => s.require === fish.id);
  if (!opened) return;
  announcedSpot = null;
  log(`🔓 ${opened.name}への道が開いた！ ${yen(opened.price)}で行ける`, 'legendary');
}

/**
 * 新しい釣り場に手が届いたら知らせる。
 * ショップの奥に隠れていると、池だけで終わってしまうので。
 */
function checkNewSpot() {
  const next = SPOTS.find((s) => !owns(player, 'spot', s.id)
    && player.money >= s.price && !spotLocked(player, s));
  $('btn-shop').classList.toggle('has-new', Boolean(next));
  if (!next || announcedSpot === next.id) return;
  announcedSpot = next.id;
  log(`${next.name}に行けるようになった！ ショップの「釣り場」から移動できる`, 'money');
  setStatus(`🎣 ${next.name}に行けるようになった！`, 'good');
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
  reportDaily(progressDaily(player, { type: 'cast' }));

  // 天気は数投ごとに変わる
  const { weather, changed } = advanceWeather(player, Math.random);
  if (changed) log(`天気が${weather.label}になった。${weather.note}`, weather.id === 'storm' ? 'bad' : '');

  // できごとは、何も起きていないときだけ引く
  if (!happening) {
    const event = rollEvent(Math.random, { active: happening });
    if (event) {
      happening = { event, left: event.casts };
      log(event.start, 'epic');
      setStatus(`${event.emoji} ${event.start}`, 'alert');
      buzz([20, 40, 20]);
    }
  }

  renderHud();
  save();

  setMode(MODE.cast);
  setAction('…', { disabled: true });
  setStatus('キャスト！');
  setHint('');
  sound.play('cast');
  scene.cast(0.35 + Math.random() * 0.6);
  timer2 = setTimeout(() => sound.play('splash'), CAST_TIME * 700);

  timer = setTimeout(() => {
    setMode(MODE.wait);
    setAction('合わせる', { disabled: false });
    setStatus('アタリを待とう…');
    setHint('ウキが沈んだ瞬間に合わせる');
    const delay = biteDelay(Math.random, {
      lure: equippedLure(player),
      timeIndex: player.timeIndex,
      gear: totalEffects(player),
      weather: weatherById(player.weather),
      event: happening?.event,
      charm: charmState?.charm.effect,
      spot: spotById(player.spot),
    });
    timer = setTimeout(startBite, delay * 1000);
  }, CAST_TIME * 1000);
}

function startBite() {
  pending = pickFish(player.spot, {
    rng: Math.random,
    rod: equippedRod(player),
    lure: equippedLure(player),
    timeIndex: player.timeIndex,
    gear: totalEffects(player),
    weather: weatherById(player.weather),
    event: happening?.event,
    charm: charmState?.charm.effect,
  });
  setMode(MODE.bite);
  scene.bite();
  sound.play('bite');
  buzz(35);
  setAction('合わせる！', { hot: true });
  setStatus('きた！ 合わせろ！', 'alert');
  timer = setTimeout(() => missBite('逃げられた… 合わせが遅かった'), hookWindow(totalEffects(player)) * 1000);
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
  markTutorial('hooked');
  const rod = equippedRod(player);
  fight = new Fight({
    fish: pending.fish, rod, sizeRatio: pending.sizeRatio, rng: Math.random,
    gear: totalEffects(player),
    weather: weatherById(player.weather),
    charm: charmState?.charm.effect,
    spot: spotById(player.spot),
  });
  setMode(MODE.fight);
  scene.hook(fight);
  setAction('巻く（長押し）', { hot: true });

  if (pending.fish.boss) {
    // ヌシは別格。名乗りを上げてから始める
    buzz([40, 60, 40, 60, 90]);
    sound.play('boss');
    scene.shake = 14;
    setStatus(`👑 ${pending.fish.name} — ${pending.fish.title}！`, 'alert');
    setHint(fight.rages.length > 1
      ? '二度も本気を出してくる。長い勝負になる'
      : '半分まで寄せると暴れ出す。焦らずバーに入れ続ける');
    log(`👑 ${pending.fish.name}（${pending.fish.title}）が掛かった！`, 'legendary');
    return;
  }

  buzz(20);
  const heavy = pending.fish.power > rod.power;
  setStatus(heavy ? '重い！ かなりの大物だ' : '掛かった！ 巻き上げろ！', heavy ? 'alert' : '');
  if (heavy) setHint('竿が負けている。巻きっぱなしはライン切れ');
  else if (fight.drift) setHint('流れが強い。手を止めると押し戻される');
  else setHint('魚を緑のバーに入れ続ける');
}

function finishFight(phase) {
  sound.stopReel();
  const result = pending;
  fight = null;
  pending = null;
  holding = false;
  setMode(MODE.busy);

  if (phase === FIGHT.caught) {
    scene.land(result);
    sound.play('catch');
    buzz([25, 45, 90]);
    const isNew = recordCatch(player, result, { weather: player.weather });
    result.isNew = isNew;
    result.xp = gainXp(player, result);
    announceUnlock(result.fish);
    if (result.shiny) {
      log(`${SHINY.emoji} ${result.fish.name}が光っている！ きらめき個体だ`, 'legendary');
      sound.play('shiny');
      buzz([30, 40, 30, 40, 60]);
    }
    if (result.xp.leveledUp) {
      sound.play('level');
      log(`🎖️ 熟練度が上がった！ Lv.${result.xp.rank.level}「${result.xp.rank.name}」`, 'epic');
    }
    reportDaily(progressDaily(player, { type: 'catch', result }));
    reportAchievements();
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
  sound.play(phase === FIGHT.snapped ? 'snap' : 'escape');
  buzz(phase === FIGHT.snapped ? [70, 50, 70] : 40);
  setStatus(text, 'bad');
  setHint(phase === FIGHT.snapped ? 'もっと強い竿を買おう' : '');
  log(text, 'bad');
  timer = setTimeout(backToIdle, 1100);
}

function backToIdle() {
  clearTimeout(timer);
  // 1 投ぶん進める。終わったら知らせる
  if (happening) {
    const next = tickEvent(happening);
    if (!next) log(happening.event.end);
    happening = next;
  }
  if (charmState) {
    const next = tickEvent(charmState);
    if (!next) log(`${charmState.charm.name}の効き目が切れた`);
    charmState = next;
  }
  scene.reset();
  setMode(MODE.idle);
  setAction('キャスト');
  setStatus('竿を振って釣りを始めよう');
  setHint('');
  checkDaily();   // 日をまたいで遊んでいたら、ここで新しいお題になる
  bumpTutorial();
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

  const bossLine = $('result-boss');
  bossLine.hidden = !result.fish.boss;
  if (result.fish.boss) bossLine.textContent = `👑 ${result.fish.title} — ${result.fish.tale}`;
  $('result-shiny').hidden = !result.shiny;
  const xpLine = $('result-xp');
  xpLine.hidden = !result.xp;
  if (result.xp) {
    xpLine.textContent = result.xp.leveledUp
      ? `+${result.xp.gained} 経験値 → Lv.${result.xp.rank.level} ${result.xp.rank.name}！`
      : `+${result.xp.gained} 経験値`;
    xpLine.dataset.up = result.xp.leveledUp ? 'true' : 'false';
  }
  card.dataset.shiny = result.shiny ? 'true' : 'false';
  card.dataset.boss = result.fish.boss ? 'true' : 'false';
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
  sound.play('coin');
  buzz(15);
  sell(player, result);
  reportDaily(progressDaily(player, { type: 'sell', price: result.price }));
  reportAchievements();
  save();
  log(`${result.fish.name}を ${yen(result.price)} で売った`, 'money');
  hideResult();
  backToIdle();
  setStatus(`${yen(result.price)} で売れた！`, 'good');
  renderMoney();   // ここで新しい釣り場に届いたら、その知らせで上書きする
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
      sound.startReel();
      break;
    case MODE.result:
      sellResult();
      break;
    default:
      break;
  }
}

function release() {
  sound.stopReel();
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
  return kind === 'charm' ? CHARMS : SHOP_KINDS[kind].list;
}

function itemStats(kind, item) {
  if (kind === 'rod') {
    // 星は 5 つまで。それより強い竿は「★★★★★+2」のように足して出す
    const stars = '★'.repeat(Math.min(5, item.power))
      + (item.power > 5 ? `+${item.power - 5}` : '☆'.repeat(5 - item.power));
    return [
      ['パワー', stars],
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
  if (kind === 'gear') return effectRows(item.effects);
  if (kind === 'charm') {
    return [
      ...effectRows(item.effect),
      ['効く長さ', `${item.casts} 投`],
      ['持っている数', `${charmCount(player, item.id)} 枚`],
    ];
  }

  const all = fishOfSpot(item.id);
  const found = all.filter((f) => player.records[f.id]).length;
  const rows = [
    ['魚の種類', `${all.length}種`],
    ['発見済み', `${found}種`],
    ['最高額の魚', yen(Math.max(...all.map((f) => f.value)) * 2)],
  ];
  if (isHardSpot(item)) {
    const h = spotHazard(item);
    rows.push(
      ['難度', '🔥'.repeat(item.hard)],
      ['ラインの負荷', `+${Math.round(h.stress * 100)}%`],
      ['流れの強さ', h.drift >= 0.05 ? '激流' : h.drift >= 0.03 ? '強い' : 'ある'],
      ['魚の重さ', `×${h.tough.toFixed(1)}`],
    );
  }
  return rows;
}

/** 道具の効果を「○○ +12%」の形に直す。 */
const EFFECT_LABELS = {
  sell: ['売値', (v) => `+${Math.round(v * 100)}%`],
  noSnap: ['ライン切れ', () => 'しない'],
  minRarity: ['釣れる魚', (v) => `${RARITY[v]?.label ?? v}以上`],
  bossBoost: ['ヌシの出やすさ', (v) => `×${v}`],
  escapeCut: ['逃げにくさ', (v) => `+${Math.round(v * 100)}%`],
  hookWindow: ['合わせの猶予', (v) => `+${v.toFixed(2)}秒`],
  biteSpeed: ['アタリの速さ', (v) => `+${Math.round(v * 100)}%`],
  rarityBonus: ['レア度アップ', (v) => `+${Math.round(v * 100)}%`],
  junkCut: ['ゴミ回避', (v) => `+${Math.round(v * 100)}%`],
  line: ['ライン強度', (v) => `+${v.toFixed(1)}`],
  driftCut: ['流れへの踏ん張り', (v) => `+${Math.round(v * 1000)}`],
  shinyBonus: ['きらめきの出やすさ', (v) => `+${Math.round(v * 100)}%`],
  calm: ['難所の荒れ', () => 'おさまる'],
  reel: ['寄せ速度', (v) => `+${Math.round(v * 100)}`],
  barH: ['バーの広さ', (v) => `+${Math.round(v * 100)}`],
};

function effectRows(effects) {
  return Object.entries(effects)
    .filter(([, v]) => v)
    .map(([key, v]) => {
      const [label, format] = EFFECT_LABELS[key] ?? [key, (x) => String(x)];
      return [label, format(v)];
    });
}

function renderShop() {
  $('shop-money').textContent = yen(player.money);

  // 道具のタブでは、いま効いている合計を上に出す
  const totals = effectRows(gearEffects(player));
  const summary = $('gear-summary');
  summary.hidden = shopKind !== 'gear';
  if (shopKind === 'gear') {
    summary.textContent = totals.length
      ? `いまの効果： ${totals.map(([k, v]) => `${k} ${v}`).join('　')}`
      : 'まだ道具を持っていません。買うとずっと効きます';
  }
  for (const tab of document.querySelectorAll('.tab')) {
    tab.classList.toggle('active', tab.dataset.kind === shopKind);
  }
  const list = $('shop-list');
  list.innerHTML = '';
  // お札には装備の概念がないので、SHOP_KINDS に無いことがある
  const equipKey = SHOP_KINDS[shopKind]?.equip;

  for (const item of shopItems(shopKind)) {
    if (shopKind === 'charm') {
      list.append(charmCard(item));
      continue;
    }
    const has = owns(player, shopKind, item.id);
    const equipped = player[equipKey] === item.id;
    // 難所は、ひとつ前のヌシを釣るまで鍵がかかっている
    const lock = shopKind === 'spot' && !has ? spotLocked(player, item) : null;
    const card = document.createElement('article');
    card.className = `shop-item${equipped ? ' equipped' : ''}${has ? ' owned' : ''}`
      + `${lock ? ' locked' : ''}${isHardSpot(item) ? ' hard' : ''}`;

    const head = document.createElement('div');
    head.className = 'shop-item-head';
    const mark = isHardSpot(item) ? `<span class="hard-mark">${'🔥'.repeat(item.hard)}</span>` : '';
    head.innerHTML = `<h3>${item.emoji ? `${item.emoji} ` : ''}${item.name}${mark}</h3>`;
    const price = document.createElement('span');
    price.className = 'shop-price';
    price.textContent = has ? '購入済み' : yen(item.price);
    if (!has && player.money < item.price) price.classList.add('short');
    head.append(price);

    const note = document.createElement('p');
    note.className = 'shop-note';
    note.textContent = lock
      ? `🔒 ${spotById(lock.spot).name}のヌシ「${lock.name}」を釣ると開く`
      : item.note;

    const stats = document.createElement('dl');
    stats.className = 'shop-stats';
    for (const [label, value] of itemStats(shopKind, item)) {
      const div = document.createElement('div');
      div.innerHTML = `<dt>${label}</dt><dd>${value}</dd>`;
      stats.append(div);
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = has || lock ? 'ghost' : 'primary';
    const equipLabel = shopKind === 'spot' ? '移動する' : '装備する';
    // 道具は付け替えがないので、持っていれば「使用中」で固定
    btn.textContent = shopKind === 'gear'
      ? (has ? '使用中' : '買う')
      : equipped ? (shopKind === 'spot' ? '釣り中' : '装備中') : has ? equipLabel : '買う';
    if (lock) btn.textContent = '🔒 まだ行けない';
    btn.disabled = Boolean(lock) || (shopKind === 'gear' && has) || equipped
      || (!has && player.money < item.price);
    btn.addEventListener('click', () => {
      if (has) {
        if (shopKind === 'gear') return;
        equip(player, shopKind, item.id);
        shopMsg(`${item.name}に${shopKind === 'spot' ? '移動した' : 'かえた'}`);
        log(shopKind === 'spot' ? `${item.name}へ移動した` : `${item.name}を装備した`);
      } else {
        const res = buy(player, shopKind, item.id);
        if (!res.ok) return shopMsg(res.error, true);
        sound.play('buy');
        shopMsg(`${item.name}を購入！`);
        log(`${item.name}を ${yen(item.price)} で購入した`, 'money');
        renderMoney();
        card.classList.add('bought');
      }
      save();
      announcedSpot = null;
      checkNewSpot();
      renderHud();
      renderShop();
      if (mode === MODE.idle) backToIdle();
    });

    card.append(head, note, stats, btn);
    list.append(card);
  }
}

/** お札のカード。買う（何枚でも）と、使う。 */
function charmCard(item) {
  const held = charmCount(player, item.id);
  const card = document.createElement('article');
  card.className = `shop-item charm-item${held ? ' owned' : ''}`;

  const head = document.createElement('div');
  head.className = 'shop-item-head';
  head.innerHTML = `<h3>${item.emoji} ${item.name}</h3>`;
  const price = document.createElement('span');
  price.className = 'shop-price';
  price.textContent = yen(item.price);
  if (player.money < item.price) price.classList.add('short');
  head.append(price);

  const note = document.createElement('p');
  note.className = 'shop-note';
  note.textContent = item.note;

  const stats = document.createElement('dl');
  stats.className = 'shop-stats';
  for (const [label, value] of itemStats('charm', item)) {
    const div = document.createElement('div');
    div.innerHTML = `<dt>${label}</dt><dd>${value}</dd>`;
    stats.append(div);
  }

  const row = document.createElement('div');
  row.className = 'charm-actions';

  const buyBtn = document.createElement('button');
  buyBtn.type = 'button';
  buyBtn.className = 'primary';
  buyBtn.textContent = '買う';
  buyBtn.disabled = player.money < item.price;
  buyBtn.addEventListener('click', () => {
    const res = buyCharm(player, item.id, 1);
    if (!res.ok) return shopMsg(res.error, true);
    shopMsg(`${item.name}を買った（${charmCount(player, item.id)}枚）`);
    log(`${item.name}を ${yen(item.price)} で買った`, 'money');
    save();
    renderMoney();
    renderShop();
  });

  const useBtn = document.createElement('button');
  useBtn.type = 'button';
  useBtn.className = 'ghost';
  useBtn.textContent = held ? `使う（${held}）` : '持っていない';
  useBtn.disabled = !held || charmState !== null || mode !== MODE.idle;
  useBtn.addEventListener('click', () => {
    const charm = useCharm(player, item.id);
    if (!charm) return shopMsg('持っていません', true);
    charmState = { charm, left: charm.casts };
    save();
    renderEvent();
    renderShop();
    log(`${charm.name}を使った。${charm.note}`, 'epic');
    setStatus(`${charm.emoji} ${charm.name}を使った`, 'good');
    $('dlg-shop').close();
  });

  row.append(buyBtn, useBtn);
  card.append(head, note, stats, row);
  return card;
}

function shopMsg(text, bad = false) {
  const el = $('shop-msg');
  el.textContent = text;
  el.className = `shop-msg${bad ? ' bad' : ' good'}`;
  el.classList.remove('pulse');
  void el.offsetWidth;
  el.classList.add('pulse');
}

// ---------------------------------------------------------------- やりこみ（熟練度・実績・お題）

/** 実績を拾って、達成したぶんを日誌に出す。 */
function reportAchievements() {
  const unlocked = checkAchievements(player);
  if (!unlocked.length) return unlocked;
  for (const a of unlocked) {
    const extra = a.title ? ` と称号「${a.title}」` : '';
    log(`🏅 実績「${a.name}」達成！ ${yen(a.reward)}${extra}をもらった`, 'legendary');
  }
  // はじめての称号は自動でつける（あとから記録の画面でかえられる）
  if (!player.title) {
    const first = unlocked.find((a) => a.title);
    if (first) setTitle(player, first.title);
  }
  setStatus(`🏅 実績「${unlocked[0].name}」達成！`, 'good');
  sound.play('achieve');
  buzz([30, 50, 30]);
  scene.coins(12);
  renderMoney(false);
  renderHud();
  return unlocked;
}

/** 達成したお題を日誌に出す。 */
function reportDaily(done) {
  for (const q of done) {
    log(`📅 お題「${q.label}」達成！ ${yen(q.reward)}をもらった`, 'money');
  }
  if (done.length) {
    sound.play('coin');
    buzz(40);
    renderMoney(false);
    setStatus(`📅 お題「${done[0].label}」達成！`, 'good');
  }
  renderDaily();
}

/** 日付が変わっていたら、お題を引き直す。 */
function checkDaily({ quiet = false } = {}) {
  if (!refreshDaily(player, todayKey())) return false;
  if (!quiet) log('📅 今日のお題が届いた。日誌の上に出ています', 'epic');
  renderDaily();
  save();
  return true;
}

/** お題の進み具合の書きかたは、種類によって変える。 */
function questAmount(q) {
  if (q.kind === 'sell') return `${shortMoney(q.progress)} / ${shortMoney(q.goal)}円`;
  if (q.kind === 'size') return `${q.progress} / ${q.goal}cm`;
  return `${q.progress} / ${q.goal}`;
}

function renderDaily() {
  const quests = player.daily?.quests ?? [];
  const list = $('daily-list');
  list.replaceChildren();
  for (const q of quests) {
    const li = document.createElement('li');
    li.className = `daily-item${q.done ? ' done' : ''}`;

    const label = document.createElement('span');
    label.className = 'daily-label';
    label.textContent = `${q.done ? '✅ ' : ''}${q.label}`;

    const num = document.createElement('span');
    num.className = 'daily-num';
    num.textContent = questAmount(q);

    const bar = document.createElement('span');
    bar.className = 'daily-bar';
    const fill = document.createElement('i');
    fill.style.width = `${Math.round(Math.min(1, q.progress / q.goal) * 100)}%`;
    bar.append(fill);

    const reward = document.createElement('span');
    reward.className = 'daily-reward';
    reward.textContent = `賞金 ${yen(q.reward)}`;

    li.append(label, num, bar, reward);
    list.append(li);
  }
  const prog = dailyProgress(player);
  $('daily-count').textContent = `${prog.done} / ${prog.total}`;
  $('daily-panel').classList.toggle('all-done', prog.total > 0 && prog.done === prog.total);
}

function openQuest() {
  markTutorial('sawQuest');
  // 開いた時点で届いているものは、ここでも拾っておく
  reportAchievements();
  renderQuest();
  $('dlg-quest').showModal();
}

function renderQuest() {
  const rank = rankOf(player);
  const next = nextRank(player.xp);
  $('rank-level').textContent = `Lv.${rank.level}`;
  $('rank-name').textContent = rank.name;
  $('rank-next').textContent = next
    ? `次の「${next.name}」まで あと ${(next.need - player.xp).toLocaleString('ja-JP')}`
    : `最高位 — 経験値 ${player.xp.toLocaleString('ja-JP')}`;
  $('rank-fill').style.width = `${Math.round(rankProgress(player.xp) * 100)}%`;
  const eff = effectRows(rankEffects(player));
  $('rank-effect').textContent = eff.length
    ? `いまの効果： ${eff.map(([k, v]) => `${k} ${v}`).join('　')}`
    : '釣るほど、売値やアタリの速さが少しずつ良くなります';

  renderTitles();
  renderAchievements();

  const done = player.achieved.length;
  $('quest-progress').textContent = `実績 ${done} / ${ACHIEVEMENTS.length}`;
}

function renderTitles() {
  const titles = earnedTitles(player);
  const box = $('title-list');
  box.replaceChildren();
  $('title-empty').hidden = titles.length > 0;
  $('title-count').textContent = `${titles.length} / ${ACHIEVEMENTS.filter((a) => a.title).length}`;
  for (const title of titles) {
    const btn = document.createElement('button');
    btn.type = 'button';
    const on = player.title === title;
    btn.className = `title-chip${on ? ' on' : ''}`;
    btn.textContent = on ? `《${title}》` : title;
    btn.addEventListener('click', () => {
      setTitle(player, on ? null : title);
      save();
      renderHud();
      renderTitles();
    });
    box.append(btn);
  }
}

function renderAchievements() {
  const rows = ACHIEVEMENTS.map((a) => ({ a, state: achievementState(player, a) }));
  // まだのものを、達成に近い順に上へ
  rows.sort((x, y) => (Number(x.state.done) - Number(y.state.done)) || (y.state.ratio - x.state.ratio));

  const list = $('ach-list');
  list.replaceChildren();
  for (const { a, state } of rows) {
    const card = document.createElement('article');
    card.className = `ach-item${state.done ? ' done' : ''}`;

    const head = document.createElement('div');
    head.className = 'ach-head';
    head.innerHTML = `<span class="ach-icon">${a.icon}</span><strong>${a.name}</strong>`;
    const reward = document.createElement('span');
    reward.className = 'ach-reward';
    reward.textContent = state.done ? '達成' : yen(a.reward);
    head.append(reward);

    const note = document.createElement('p');
    note.className = 'ach-note';
    note.textContent = a.note;

    const bar = document.createElement('div');
    bar.className = 'ach-bar';
    const fill = document.createElement('i');
    fill.style.width = `${Math.round(state.ratio * 100)}%`;
    bar.append(fill);

    const num = document.createElement('span');
    num.className = 'ach-num';
    const shown = Math.min(state.value, a.goal);
    num.textContent = `${shown.toLocaleString('ja-JP')} / ${a.goal.toLocaleString('ja-JP')}`;

    card.append(head, note, bar, num);
    if (a.title) {
      const chip = document.createElement('span');
      chip.className = 'ach-title';
      chip.textContent = `称号「${a.title}」`;
      card.append(chip);
    }
    list.append(card);
  }
  $('ach-count').textContent = `${player.achieved.length} / ${ACHIEVEMENTS.length}`;
}

// ---------------------------------------------------------------- はじめての案内

/** いま出す案内を画面に反映する。 */
function renderCoach() {
  const step = tutorialStep(player);
  const box = $('coach');
  box.hidden = !step;
  if (step) $('coach-text').textContent = step.text;
}

/** 条件を満たしていれば案内を進める。 */
function bumpTutorial() {
  if (advanceTutorial(player)) {
    renderCoach();
    save();
  }
}

/** 案内に「ここまで見た」の印をつける。 */
function markTutorial(key) {
  const state = player.tutorial;
  if (!state || state.done || state[key]) return;
  state[key] = true;
  bumpTutorial();
}

// ---------------------------------------------------------------- 音

function renderSound() {
  const on = !sound.muted;
  $('sound-icon').textContent = on ? '🔊' : '🔇';
  $('sound-label').textContent = on ? '音' : '消音';
  $('btn-sound').setAttribute('aria-pressed', String(!on));
  $('btn-sound').title = on ? '音を消す' : '音を出す';
}

// ---------------------------------------------------------------- バックアップ

function backupMsg(text, bad = false) {
  const el = $('backup-msg');
  el.textContent = text;
  el.className = `shop-msg${text ? (bad ? ' bad' : ' good') : ''}`;
}

function openBackup() {
  $('backup-out').value = exportSave(player);
  $('backup-summary').textContent = saveSummary(player);
  $('backup-in').value = '';
  backupMsg('');
  $('dlg-backup').showModal();
}

async function copyBackup() {
  const box = $('backup-out');
  try {
    await navigator.clipboard.writeText(box.value);
    backupMsg('コピーしました。メモ帳などに貼って保存してください');
  } catch {
    // 書き込みを許してくれない端末では、選択だけしておく
    box.focus();
    box.select();
    backupMsg('選択しました。長押し（Ctrl+C）でコピーしてください');
  }
}

function downloadBackup() {
  const name = `fishing-save-${todayKey()}.json`;
  try {
    const url = URL.createObjectURL(new Blob([$('backup-out').value], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    backupMsg(`${name} を保存しました`);
  } catch {
    backupMsg('この端末では保存できません。コピーを使ってください', true);
  }
}

/** 読み込んだ記録に差し替える。 */
function loadBackup(text) {
  const res = importSave(text);
  if (!res.ok) return backupMsg(res.error, true);

  clearTimeout(timer);
  clearTimeout(timer2);
  sound.stopReel();
  player = res.player;
  fight = null;
  pending = null;
  holding = false;
  happening = null;
  charmState = null;
  announcedSpot = null;
  displayMoney = player.money;

  hideResult();
  checkDaily({ quiet: true });
  renderMoney(false);
  renderHud();
  renderDaily();
  renderCoach();
  backToIdle();
  save();

  const when = res.savedAt ? `（${res.savedAt.slice(0, 10)} の控え）` : '';
  backupMsg(`読み込みました${when}： ${saveSummary(player)}`);
  log(`💾 バックアップを読み込んだ。${saveSummary(player)}`, 'epic');
  setStatus('バックアップを読み込んだ', 'good');
  sound.play('achieve');
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
      const shiny = player.shinies?.[f.id];
      const cell = document.createElement('div');
      cell.className = `book-cell${rec ? '' : ' unknown'}${shiny ? ' shiny' : ''}`;
      cell.style.setProperty('--rarity', RARITY[f.rarity].color);
      if (f.boss) cell.classList.add('boss');
      cell.innerHTML = rec
        ? `<span class="book-emoji">${f.emoji}</span>
           <strong>${shiny ? `${SHINY.emoji} ` : ''}${f.boss ? '👑 ' : ''}${f.name}</strong>
           ${f.boss ? `<small class="book-title">${f.title}</small>` : ''}
           <small>最大 ${rec.lengthCm}cm / ${rec.weightKg}kg</small>
           <small>${rec.count}匹 ・ 最高 ${yen(rec.price)}</small>
           ${shiny ? `<small class="book-shiny">${SHINY.emoji} きらめき ${shiny.count}匹</small>` : ''}`
        : `<span class="book-emoji">${f.boss ? '👑' : '❔'}</span>
           <strong>${f.boss ? 'ヌシ' : '？？？'}</strong>
           <small>${RARITY[f.rarity].label}</small>`;
      grid.append(cell);
    }
    section.append(grid);
    book.append(section);
  }
  const shinies = shinyKinds(player);
  $('book-progress').textContent = shinies
    ? `${found} / ${FISH.length} 種 ・ ${SHINY.emoji} ${shinies} 種`
    : `${found} / ${FISH.length} 種`;
  $('dlg-book').showModal();
}

// ---------------------------------------------------------------- ループ

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;

  if (mode === MODE.fight && fight) {
    const phase = fight.update(dt, holding);
    if (fight.justEnraged) {
      setStatus('ヌシが暴れ出した！', 'bad');
      setHint('速くなる。バーを先回りさせる');
      scene.shake = 16;
      scene.flash = 0.4;
      scene.flashColor = '255,120,110';
      buzz([80, 40, 80]);
    }
    if (phase !== FIGHT.fighting) finishFight(phase);
  }
}

// ---------------------------------------------------------------- はじめから

/** いま何を持っているか。消す前に見せて、勘違いで消させないようにする。 */
function resetSummary() {
  const caught = Object.keys(player.records).length;
  const charms = Object.values(player.charms ?? {}).reduce((a, b) => a + b, 0);
  const rank = rankOf(player);
  const shinies = shinyKinds(player);
  return [
    `所持金 ${yen(player.money)}`,
    `図鑑 ${caught} 種（${player.catches} 匹）`,
    ...(shinies ? [`${SHINY.emoji} きらめき ${shinies} 種`] : []),
    `熟練度 Lv.${rank.level}「${rank.name}」`,
    `実績 ${player.achieved.length} / ${ACHIEVEMENTS.length}`,
    `竿 ${player.rods.length} 本 ・ ルアー ${player.lures.length} 個 ・ 道具 ${player.gears.length} 個`,
    `行ける釣り場 ${player.spots.length} か所`,
    ...(charms ? [`お札 ${charms} 枚`] : []),
  ];
}

function openReset() {
  const list = $('reset-list');
  list.replaceChildren();
  for (const line of resetSummary()) {
    const li = document.createElement('li');
    li.textContent = line;
    list.append(li);
  }
  $('dlg-reset').showModal();
}

/** 保存を消して、最初の状態に戻す。 */
function resetSave() {
  clearTimeout(timer);
  clearTimeout(timer2);
  sound.stopReel();
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* 消せなくても続ける */ }

  player = createPlayer();
  fight = null;
  pending = null;
  holding = false;
  happening = null;
  charmState = null;
  announcedSpot = null;
  displayMoney = 0;

  hideResult();
  $('log').replaceChildren();
  scene.setHolding(false);
  renderMoney(false);
  backToIdle();
  save();

  log('はじめからやり直した。今日はいい天気だ。');
  setStatus('はじめからやり直した', 'good');
}

// ---------------------------------------------------------------- アプリとして使う

/**
 * 手にも伝える。対応していない端末では黙って無視される。
 * 指が一度も触れていないうちは、ブラウザが断ってくる（起動直後の実績など）ので鳴らさない。
 */
function buzz(pattern) {
  if (!gestured) return;
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

/**
 * 長押しでコピー・翻訳のメニューが出ないようにする。
 * CSS だけだと iOS の版によってはすり抜けるので、イベント側でも止めておく。
 * 日誌や図鑑など、読ませたい場所ではふつうに選べるままにする。
 */
function suppressLongPressMenu() {
  const readable = (target) => target.closest?.('dialog, .sidebar');

  document.addEventListener('contextmenu', (e) => {
    if (readable(e.target)) return;
    e.preventDefault();
  });

  // 釣り場では、指を置いた時点で選択を始めさせない。
  // pointerdown のほうが先に飛ぶので、キャストや巻き上げには影響しない。
  // ただし中に置いてあるボタン（売る・逃がす）はタップを潰さないよう素通しする。
  $('stage').addEventListener('touchstart', (e) => {
    if (e.target.closest('button, a')) return;
    if (e.cancelable) e.preventDefault();
  }, { passive: false });

  // 巻き上げボタンは click を使っていないので、そのまま止めてよい
  $('btn-action').addEventListener('touchstart', (e) => {
    if (e.cancelable) e.preventDefault();
  }, { passive: false });

  document.addEventListener('selectstart', (e) => {
    if (readable(e.target)) return;
    e.preventDefault();
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
  window.addEventListener('resize', () => { scene.resize(); renderMoney(false); });
  // サイドバーの伸縮などでも canvas の解像度を追従させる
  if (window.ResizeObserver) new ResizeObserver(() => scene.resize()).observe($('stage'));

  renderMoney(false);
  renderHud();
  // はじめて遊ぶときは、お題が届いた案内は出さない（日誌がうるさくなるので）
  const firstRun = player.casts === 0 && !player.daily?.date;
  checkDaily({ quiet: firstRun });
  renderDaily();
  renderSound();
  renderCoach();
  reportAchievements();
  checkNewSpot();
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
      else if (mode === MODE.fight) { holding = true; scene.setHolding(true); sound.startReel(); }
    } else if (e.key === 's' || e.key === 'S') {
      openShop();
    } else if (e.key === 'z' || e.key === 'Z') {
      openBook();
    } else if (e.key === 'a' || e.key === 'A') {
      openQuest();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' || e.key === ' ') release();
  });
  window.addEventListener('blur', release);

  $('btn-reset').addEventListener('click', openReset);
  $('reset-cancel').addEventListener('click', () => $('dlg-reset').close());
  $('reset-ok').addEventListener('click', () => {
    $('dlg-reset').close();
    resetSave();
  });

  $('btn-shop').addEventListener('click', () => openShop());
  $('btn-book').addEventListener('click', openBook);
  $('btn-quest').addEventListener('click', openQuest);
  $('btn-sound').addEventListener('click', () => {
    sound.toggle();
    renderSound();
    if (!sound.muted) sound.play('coin');
  });

  $('btn-backup').addEventListener('click', openBackup);
  $('backup-copy').addEventListener('click', copyBackup);
  $('backup-download').addEventListener('click', downloadBackup);
  $('backup-load').addEventListener('click', () => loadBackup($('backup-in').value));
  $('backup-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      loadBackup(await file.text());
    } catch {
      backupMsg('ファイルを読めませんでした', true);
    }
    e.target.value = '';
  });

  $('coach-skip').addEventListener('click', () => {
    player.tutorial.done = true;
    renderCoach();
    save();
  });

  // スマホのブラウザは、指が触れるまで音を鳴らさせてくれない
  const wake = () => { gestured = true; sound.unlock(); };
  window.addEventListener('pointerdown', wake, { once: true });
  window.addEventListener('keydown', wake, { once: true });
  $('btn-sell').addEventListener('click', sellResult);
  $('btn-release').addEventListener('click', releaseResult);

  registerServiceWorker();
  setupInstall();
  setupLogSheet();
  suppressLongPressMenu();
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
    get charm() { return charmState; },
    get happening() { return happening; },
    scene,
    save,
    reset: resetSave,
    render() { renderMoney(false); renderHud(); renderDaily(); renderCoach(); },
    sound,
  };

  lastFrame = performance.now();
  requestAnimationFrame(frame);
}

init();
