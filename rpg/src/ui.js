/** 画面まわりとゲーム進行。ルールは engine.js / world.js、描画は scene.js に任せる。 */

import {
  Battle, addItem, allGearById, buy, claimReward, createHero, hasItem, innCost, itemById,
  itemList, normalizeHero, onDefeat, sell, sellPrice, spellsOf, statsOf, stayInn, useItem,
  weightedPick,
} from './engine.js';
import {
  SHOPS, canWalk, chestAt, encounterChance, encountersAt, frontOf,
  mapById, npcAt, signAt, warpAt,
} from './world.js';
import { Scene } from './scene.js';

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'rpg:save';
const STEP_MS = 150;          // 1 マス歩くのにかかる時間
const TYPE_MS = 22;           // 1 文字あたりの表示速度

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const state = {
  hero: null,
  map: null,
  npcs: [],
  scene: null,
  mode: 'title',              // title / field / busy / battle
  held: null,                 // 押しっぱなしの方向
  moving: null,               // { dir, t }
  ox: 0, oy: 0, frame: 0,
  flash: 0,
  sinceBattle: 0,             // 最後の戦闘からの歩数
  battle: null,
  view: null,                 // 戦闘中の見た目
  pending: null,              // 入力待ち（メッセージ／メニュー）
  typing: null,
};

// ---------------------------------------------------------------- セーブ

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    return raw ? normalizeHero(raw) : null;
  } catch {
    return null;
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.hero));
    return true;
  } catch {
    return false;   // 保存できなくても遊べる
  }
}

// ---------------------------------------------------------------- 表示

function renderHud() {
  const hero = state.hero;
  if (!hero) return;
  const s = statsOf(hero);
  $('hud-name').textContent = hero.name;
  $('hud-level').textContent = s.level;
  $('hud-hp').textContent = `${hero.hp}/${s.maxHp}`;
  $('hud-mp').textContent = `${hero.mp}/${s.maxMp}`;
  $('hud-gold').textContent = hero.gold;
  $('hud-hp').classList.toggle('low', hero.hp <= s.maxHp * 0.25);
}

function showPlace(name) {
  const el = $('place');
  el.textContent = name;
  el.hidden = false;
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
}

/** メッセージを 1 枚出して、決定が押されるまで待つ。 */
function say(text) {
  return new Promise((resolve) => {
    const win = $('message');
    const p = $('message-text');
    const cursor = $('message-cursor');
    win.hidden = false;
    cursor.hidden = true;
    p.textContent = '';
    let i = 0;
    clearInterval(state.typing);
    state.typing = setInterval(() => {
      p.textContent = text.slice(0, ++i);
      if (i >= text.length) {
        clearInterval(state.typing);
        state.typing = null;
        cursor.hidden = false;
      }
    }, TYPE_MS);
    state.pending = {
      kind: 'message',
      finish() {
        if (state.typing) {                 // 表示中なら まず全部出す
          clearInterval(state.typing);
          state.typing = null;
          p.textContent = text;
          cursor.hidden = false;
          return false;
        }
        return true;
      },
      resolve,
    };
  });
}

function hideMessage() {
  $('message').hidden = true;
}

/** メッセージを続けて出す。 */
async function sayAll(lines) {
  for (const line of lines) await say(line);
}

/**
 * コマンドウィンドウ。items は [{label, sub, value, disabled}]。
 * 返り値は選んだ value（キャンセルなら null）。
 */
function menu({ title = '', items, cancel = true, wide = false }) {
  return new Promise((resolve) => {
    const win = $('menu');
    const list = $('menu-list');
    const heading = $('menu-title');
    heading.textContent = title;
    heading.hidden = !title;
    win.classList.toggle('wide', wide);
    win.hidden = false;
    list.innerHTML = '';

    items.forEach((item, i) => {
      const li = document.createElement('li');
      li.innerHTML = `<span>${item.label}</span>${item.sub ? `<span class="sub">${item.sub}</span>` : ''}`;
      if (item.disabled) li.classList.add('disabled');
      li.addEventListener('click', () => {
        if (item.disabled) return;
        state.pending.index = i;
        highlight();
        pick();
      });
      list.append(li);
    });

    const highlight = () => {
      [...list.children].forEach((li, i) => li.classList.toggle('selected', i === state.pending.index));
      list.children[state.pending.index]?.scrollIntoView({ block: 'nearest' });
    };

    const close = () => { win.hidden = true; state.pending = null; };
    const pick = () => {
      const item = items[state.pending.index];
      if (!item || item.disabled) return;
      close();
      resolve(item.value);
    };

    let index = items.findIndex((i) => !i.disabled);
    state.pending = {
      kind: 'menu',
      index: index < 0 ? 0 : index,
      move(delta) {
        const n = items.length;
        for (let step = 1; step <= n; step++) {
          const next = (state.pending.index + delta * step + n * step) % n;
          if (!items[next].disabled) { state.pending.index = next; break; }
        }
        highlight();
      },
      pick,
      cancel: cancel ? () => { close(); resolve(null); } : null,
    };
    highlight();
  });
}

/** はい／いいえ。 */
const confirm = async (title) => (await menu({ title, items: [{ label: 'はい', value: true }, { label: 'いいえ', value: false }] })) === true;

function showSheet(title, rows) {
  return new Promise((resolve) => {
    const win = $('sheet');
    $('sheet-title').textContent = title;
    $('sheet-body').innerHTML = rows
      .map(([dt, dd, full]) => `<div class="${full ? 'full' : ''}"><dt>${dt}</dt><dd>${dd}</dd></div>`)
      .join('');
    win.hidden = false;
    state.pending = {
      kind: 'sheet',
      finish: () => true,
      resolve: () => { win.hidden = true; resolve(); },
    };
  });
}

// ---------------------------------------------------------------- マップ

function enterMap(id, x, y, dir = 'down') {
  const hero = state.hero;
  const map = mapById(id);
  state.map = map;
  hero.map = id;
  hero.x = x;
  hero.y = y;
  hero.dir = dir;
  state.ox = 0;
  state.oy = 0;
  state.moving = null;
  state.sinceBattle = 0;
  // 倒した魔王は もう玉座にいない。
  state.npcs = map.npcs
    .filter((n) => !(n.kind === 'boss' && hero.flags.bossDead))
    .map((n) => ({ ...n, dir: n.dir || 'down', frame: 0 }));
  if (map.kind !== 'room') showPlace(map.name);
  renderHud();
  save();
}

/** 通れるか。壁だけでなく人・宝箱・立て札もふさぐ。 */
function blocked(x, y) {
  const map = state.map;
  if (!canWalk(map, x, y)) return true;
  if (npcAt(state.npcs, x, y)) return true;
  if (chestAt(map, state.hero.chests, x, y)) return true;
  if (signAt(map, x, y)) return true;
  return false;
}

function tryMove(dir) {
  const hero = state.hero;
  hero.dir = dir;
  const d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir];
  const nx = hero.x + d[0];
  const ny = hero.y + d[1];
  if (blocked(nx, ny)) {
    state.frame = (state.frame + 1) % 2;
    return false;
  }
  state.moving = { dir, t: 0, dx: d[0], dy: d[1] };
  return true;
}

async function finishStep() {
  const hero = state.hero;
  const map = state.map;
  hero.steps++;
  state.sinceBattle++;

  const warp = warpAt(map, hero.x, hero.y);
  if (warp) {
    await useWarp(warp);
    return;
  }

  const chance = encounterChance(map, hero.x, hero.y);
  if (state.sinceBattle > 2 && Math.random() < chance) {
    const table = encountersAt(map, hero.x, hero.y);
    const picked = weightedPick(table, (m) => m.w);
    await startBattle(picked.id);
  }
}

async function useWarp(warp) {
  const hero = state.hero;
  if (warp.require && !hasItem(hero, warp.require)) {
    await runFlow(async () => {
      await say(warp.requireText || 'ここからは 先へ 進めない。');
      // 一歩下がる
      const back = { up: [0, 1], down: [0, -1], left: [1, 0], right: [-1, 0] }[hero.dir];
      if (back && !blocked(hero.x + back[0], hero.y + back[1])) {
        hero.x += back[0];
        hero.y += back[1];
      }
      hideMessage();
    });
    return;
  }
  if (warp.require && warp.openText && !hero.flags[`open:${warp.to}`]) {
    hero.flags[`open:${warp.to}`] = true;
    await runFlow(async () => {
      await say(warp.openText);
      hideMessage();
    });
  }
  enterMap(warp.to, warp.tx, warp.ty, warp.dir || hero.dir);
}

// ---------------------------------------------------------------- 会話・調べる

async function interact() {
  const hero = state.hero;
  const map = state.map;
  const front = frontOf(map, hero.x, hero.y, hero.dir);
  const npc = npcAt(state.npcs, front.x, front.y);
  if (npc) { await talkTo(npc); return; }

  const chest = chestAt(map, hero.chests, front.x, front.y);
  if (chest) { await openChest(chest); return; }

  const sign = signAt(map, front.x, front.y);
  if (sign) { await runFlow(async () => { await say(sign.text); hideMessage(); }); }
}

async function talkTo(npc) {
  npc.dir = { up: 'down', down: 'up', left: 'right', right: 'left' }[state.hero.dir] || npc.dir;
  await runFlow(async () => {
    switch (npc.kind) {
      case 'shop': await shop(npc); break;
      case 'inn': await inn(npc); break;
      case 'save': await scribe(npc); break;
      case 'elder': await elder(npc); break;
      case 'boss': await boss(npc); break;
      default: await sayAll(npc.lines);
    }
    hideMessage();
  });
}

async function openChest(chest) {
  const hero = state.hero;
  await runFlow(async () => {
    hero.chests.push(chest.id);
    if (chest.gold) {
      hero.gold += chest.gold;
      await say(`宝箱を あけた！\n${chest.gold} ゴールドを 手にいれた！`);
    } else if (chest.gear) {
      const gear = allGearById(chest.gear);
      hero[gear.slot] = gear.id;
      await say(`宝箱を あけた！\n${gear.name}を 手にいれた！\nさっそく 身につけた。`);
    } else if (chest.item) {
      const item = itemById(chest.item);
      if (!addItem(hero, chest.item)) {
        hero.chests.pop();
        await say('しかし 荷物が いっぱいだ！');
      } else {
        await say(`宝箱を あけた！\n${item.name}を 手にいれた！`);
        if (chest.fanfare) await say('たまは あたたかい光を はなっている。\n魔王の城の 結界を 破れるはずだ！');
      }
    }
    hideMessage();
    renderHud();
    save();
  });
}

async function elder(npc) {
  const hero = state.hero;
  if (hero.flags.bossDead) {
    await sayAll(['よくぞ 魔王を たおしてくれた！', 'お前は この村の……\nいや 世界の ほこりじゃ。']);
    return;
  }
  await sayAll(hero.flags.elder ? npc.done : npc.lines);
  if (!hero.flags.elder && npc.gift) {
    hero.flags.elder = true;
    hero.gold += npc.gift.gold || 0;
    if (npc.gift.item) addItem(hero, npc.gift.item);
    await say(npc.gift.text);
    renderHud();
    save();
  }
}

/** 玉座の魔王。話しかけると 最後の戦いが始まる。 */
async function boss(npc) {
  await sayAll(npc.lines);
  hideMessage();
  await startBattle(npc.monster);
}

async function scribe(npc) {
  await sayAll(npc.lines);
  if (await confirm('きろくを つける？')) {
    await say(save() ? 'ぼうけんの きろくを かきとめた。\nいつでも つづきから 遊べる。' : 'うまく 書きとめられなかった……');
  } else {
    await say('また いつでも おいで。');
  }
}

async function inn(npc) {
  const hero = state.hero;
  const cost = innCost(hero);
  await say(`${npc.lines[0]}\nひとばん ${cost} ゴールドだよ。`);
  if (!(await confirm('とまる？'))) {
    await say('また どうぞ。');
    return;
  }
  const res = stayInn(hero);
  await say(res.text);
  renderHud();
  if (res.ok) save();
}

async function shop(npc) {
  const hero = state.hero;
  const shopData = SHOPS[npc.shop];
  await say(npc.lines[0]);
  for (;;) {
    const what = await menu({
      title: `${shopData.name}　所持金 ${hero.gold} G`,
      wide: true,
      items: [{ label: 'かう', value: 'buy' }, { label: 'うる', value: 'sell' }, { label: 'やめる', value: null }],
    });
    if (!what) break;

    if (what === 'buy') {
      const goods = shopData.goods.map((id) => {
        const gear = allGearById(id);
        const item = itemById(id);
        const g = gear || item;
        const equipped = gear && hero[gear.slot] === gear.id;
        return {
          label: g.name + (equipped ? '（装備中）' : ''),
          sub: `${g.price} G`,
          value: id,
          disabled: hero.gold < g.price || equipped,
        };
      });
      goods.push({ label: 'やめる', value: null });
      const id = await menu({ title: `なにを 買う？　${hero.gold} G`, items: goods, wide: true });
      if (!id) continue;
      const res = buy(hero, id);
      await say(res.text);
      renderHud();
      save();
      continue;
    }

    const owned = itemList(hero)
      .filter(({ item }) => sellPrice(item.id) > 0)
      .map(({ item, count }) => ({ label: `${item.name} × ${count}`, sub: `${sellPrice(item.id)} G`, value: item.id }));
    if (!owned.length) {
      await say('売れそうな 品は 持っていないようだね。');
      continue;
    }
    owned.push({ label: 'やめる', value: null });
    const id = await menu({ title: 'なにを 売る？', items: owned, wide: true });
    if (!id) continue;
    const item = itemById(id);
    if (await confirm(`${item.name}を ${sellPrice(id)} G で 買い取るよ。`)) {
      const res = sell(hero, id);
      await say(res.text);
      renderHud();
      save();
    }
  }
  await say('まいど ありがとう！');
}

// ---------------------------------------------------------------- メニュー

async function openMainMenu() {
  await runFlow(async () => {
    for (;;) {
      const pick = await menu({
        items: [
          { label: 'つよさ', value: 'status' },
          { label: 'どうぐ', value: 'item' },
          { label: 'じゅもん', value: 'spell' },
          { label: 'セーブ', value: 'save' },
          { label: 'とじる', value: null },
        ],
      });
      if (!pick) break;
      if (pick === 'status') await showStatus();
      if (pick === 'item') { if (await useItemMenu('field')) break; }
      if (pick === 'spell') { if (await castMenu('field')) break; }
      if (pick === 'save') {
        await say(save() ? 'ぼうけんの きろくを かきとめた。' : 'うまく 書きとめられなかった……');
        hideMessage();
      }
    }
    hideMessage();
  });
}

async function showStatus() {
  const hero = state.hero;
  const s = statsOf(hero);
  await showSheet('つよさ', [
    ['なまえ', hero.name],
    ['レベル', s.level],
    ['HP', `${hero.hp} / ${s.maxHp}`],
    ['MP', `${hero.mp} / ${s.maxMp}`],
    ['ちから', s.str],
    ['すばやさ', s.agi],
    ['こうげき力', s.atk],
    ['しゅび力', s.def],
    ['経験値', hero.exp],
    ['つぎのレベルまで', s.nextExp === null ? '——' : s.nextExp],
    ['ゴールド', `${hero.gold} G`],
    ['あるいた歩数', hero.steps],
    ['ぶき', s.weapon.name, true],
    ['よろい', s.armor.name, true],
    ['たて', s.shield.id === 'none' ? 'なし' : s.shield.name, true],
  ]);
}

/** 道具を使う。戦闘中に使えたら true（＝ターンを消費した）。 */
async function useItemMenu(where) {
  const hero = state.hero;
  const list = itemList(hero).filter(({ item }) => (where === 'battle' ? item.battle : true));
  if (!list.length) {
    await say('道具を なにも 持っていない。');
    if (where === 'field') hideMessage();
    return false;
  }
  const items = list.map(({ item, count }) => ({ label: `${item.name} × ${count}`, sub: item.desc, value: item.id, wide: true }));
  items.push({ label: 'やめる', value: null });
  const id = await menu({ title: 'どうぐ', items, wide: true });
  if (!id) return false;

  if (where === 'battle') return { type: 'item', id };

  const res = useItem(hero, id, 'field');
  await say(res.text);
  renderHud();
  if (res.warp) {
    hideMessage();
    await warpHome();
    return true;
  }
  save();
  return false;
}

/** 呪文を選ぶ。戦闘中は選んだ行動を返す。 */
async function castMenu(where) {
  const hero = state.hero;
  const known = spellsOf(hero).filter((s) => (where === 'battle' ? s.kind !== 'warp' : s.field));
  if (!known.length) {
    await say(where === 'battle' ? 'つかえる 呪文が ない。' : 'まだ 呪文を おぼえていない。');
    if (where === 'field') hideMessage();
    return false;
  }
  const items = known.map((s) => ({
    label: s.name,
    sub: `${s.mp} MP`,
    value: s.id,
    disabled: hero.mp < s.mp,
  }));
  items.push({ label: 'やめる', value: null });
  const id = await menu({ title: `じゅもん　MP ${hero.mp}`, items, wide: true });
  if (!id) return false;
  if (where === 'battle') return { type: 'spell', id };

  const spell = known.find((s) => s.id === id);
  hero.mp -= spell.mp;
  await say(`${hero.name}は ${spell.name}を となえた！`);
  if (spell.kind === 'heal') {
    const s = statsOf(hero);
    const heal = spell.power === 'full' ? s.maxHp - hero.hp : Math.min(s.maxHp - hero.hp, spell.power[0] + Math.floor(Math.random() * (spell.power[1] - spell.power[0] + 1)));
    hero.hp += heal;
    await say(heal > 0 ? `HP が ${heal} 回復した。` : 'しかし HP は 満タンだ。');
  } else if (spell.kind === 'warp') {
    renderHud();
    hideMessage();
    await warpHome();
    return true;
  }
  renderHud();
  save();
  return false;
}

async function warpHome() {
  state.flash = 1;
  await wait(320);
  state.flash = 0;
  enterMap('town', 10, 11, 'down');
  renderHud();
}

// ---------------------------------------------------------------- 戦闘

async function startBattle(monsterId) {
  const hero = state.hero;
  const battle = new Battle(hero, monsterId, Math.random);
  state.battle = battle;
  state.mode = 'battle';
  state.held = null;

  for (let i = 0; i < 3; i++) {          // 出会いがしらの点滅
    state.flash = 0.85;
    await wait(70);
    state.flash = 0;
    await wait(60);
  }

  state.view = {
    monster: battle.monster,
    kind: state.map.kind === 'castle' ? 'castle' : state.map.kind === 'cave' ? 'cave' : 'field',
    big: !!battle.monster.boss,
    flash: 0, shake: 0, dead: 0, fade: 0,
  };
  renderEnemy();

  await playLines(battle.start());

  while (!battle.over) {
    const action = await chooseCommand();
    const lines = battle.command(action);
    await playLines(lines);
  }

  await endBattle();
}

function renderEnemy() {
  const battle = state.battle;
  $('enemy').hidden = !battle;
  if (!battle) return;
  $('enemy-name').textContent = battle.monster.name;
  $('enemy-gauge').style.width = `${Math.max(0, (battle.monster.hp / battle.monster.maxHp) * 100)}%`;
}

async function chooseCommand() {
  for (;;) {
    const pick = await menu({
      items: [
        { label: 'たたかう', value: 'attack' },
        { label: 'じゅもん', value: 'spell' },
        { label: 'どうぐ', value: 'item' },
        { label: 'にげる', value: 'flee' },
      ],
      cancel: false,
    });
    if (pick === 'attack') return { type: 'attack' };
    if (pick === 'flee') return { type: 'flee' };
    if (pick === 'spell') {
      const action = await castMenu('battle');
      if (action) return action;
    }
    if (pick === 'item') {
      const action = await useItemMenu('battle');
      if (action) return action;
    }
  }
}

/** 戦闘メッセージを演出つきで流す。 */
async function playLines(lines) {
  for (const line of lines) {
    if (line.fx === 'hit-monster' || line.fx === 'critical') {
      state.view.flash = 1;
      state.view.shake = 5;
    }
    if (line.fx === 'hit-hero' || line.fx === 'hit-hero-magic') {
      state.view.shake = 9;
      $('stage').animate(
        [{ filter: 'brightness(2.2) saturate(0.4)' }, { filter: 'none' }],
        { duration: 240, easing: 'ease-out' },
      );
    }
    if (line.fx === 'defeat') {
      state.view.dead = 0.001;
      await wait(120);
    }
    renderEnemy();
    renderHud();
    await say(line.text);
  }
}

async function endBattle() {
  const hero = state.hero;
  const battle = state.battle;

  if (battle.result === 'win') {
    const { exp, gold, levels } = claimReward(hero, battle);
    renderHud();
    if (exp || gold) await say(`経験値 ${exp} ポイントを かくとくした。\n${gold} ゴールドを 手にいれた！`);
    for (const up of levels) {
      renderHud();
      await say(`${hero.name}は レベル ${up.level} に あがった！`);
      for (const spell of up.spells) await say(`${spell.name}の 呪文を おぼえた！`);
    }
    if (battle.monster.boss) { await ending(); return; }
  } else if (battle.result === 'lose') {
    await say('……');
    const { lost } = onDefeat(hero);
    await say(`目をさますと 村の 宿屋の ベッドだった。\n${lost} ゴールドを 落としてしまった……`);
    closeBattle();
    enterMap('town', 10, 11, 'down');
    renderHud();
    save();
    return;
  } else {
    state.sinceBattle = 0;
  }

  closeBattle();
  save();
}

function closeBattle() {
  state.battle = null;
  state.view = null;
  state.mode = 'field';
  state.sinceBattle = 0;
  $('enemy').hidden = true;
  hideMessage();
  renderHud();
}

async function ending() {
  const hero = state.hero;
  hero.flags.bossDead = true;
  state.view.fade = 0;
  for (let i = 0; i <= 20; i++) { state.view.fade = i / 20; await wait(40); }

  await sayAll([
    'まおう ダークロードは 光の中に 消えていった……',
    '長かった 闇の夜が 明け\n世界に 朝が もどってきた。',
    `${hero.name}は 村へと 帰っていった。`,
    'ゆうしゃの ぼうけんは ここで おしまい。\nでも 旅は まだまだ 続けられる。',
    '━━ ひかりのつるぎ  かんぜんクリア ━━\n遊んでくれて ありがとう！',
  ]);

  closeBattle();
  enterMap('town', 10, 11, 'down');
  const s = statsOf(hero);
  hero.hp = s.maxHp;
  hero.mp = s.maxMp;
  renderHud();
  save();
}

// ---------------------------------------------------------------- 進行のわく

let busy = false;

/** 会話やメニューのあいだは 歩けないようにする。 */
async function runFlow(fn) {
  if (busy) return;
  busy = true;
  const before = state.mode;
  state.mode = 'busy';
  try {
    await fn();
  } finally {
    state.mode = before === 'busy' ? 'field' : before;
    busy = false;
  }
}

// ---------------------------------------------------------------- 入力

function press(key) {
  const pending = state.pending;

  if (pending?.kind === 'menu') {
    if (key === 'up') pending.move(-1);
    else if (key === 'down') pending.move(1);
    else if (key === 'ok') pending.pick();
    else if (key === 'cancel') pending.cancel?.();
    return;
  }

  if (pending?.kind === 'message' || pending?.kind === 'sheet') {
    if (key === 'ok' || key === 'cancel') {
      if (pending.finish()) {
        state.pending = null;
        pending.resolve();
      }
    }
    return;
  }

  if (state.mode !== 'field') return;
  if (key === 'ok') { interact(); return; }
  if (key === 'cancel') { openMainMenu(); return; }
}

function setHeld(dir) {
  state.held = dir;
}

function onKeyDown(e) {
  const map = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right',
  };
  const dir = map[e.key];
  if (dir) {
    e.preventDefault();
    if (state.pending?.kind === 'menu') { press(dir === 'left' ? 'up' : dir === 'right' ? 'down' : dir); return; }
    setHeld(dir);
    // 軽く押しただけでも すぐ 向きが変わる／一歩あるく
    if (state.mode === 'field' && !state.moving && !state.pending) tryMove(dir);
    return;
  }
  if (e.key === 'Enter' || e.key === ' ' || e.key === 'z' || e.key === 'Z') {
    e.preventDefault();
    press('ok');
  } else if (e.key === 'Escape' || e.key === 'x' || e.key === 'X') {
    e.preventDefault();
    press('cancel');
  }
}

function onKeyUp(e) {
  const map = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right',
  };
  if (map[e.key] && state.held === map[e.key]) state.held = null;
}

function setupTouch() {
  for (const btn of document.querySelectorAll('.dbtn')) {
    const dir = btn.dataset.dir;
    const on = (e) => {
      e.preventDefault();
      btn.classList.add('on');
      if (state.pending?.kind === 'menu') { press(dir === 'left' ? 'up' : dir === 'right' ? 'down' : dir); return; }
      setHeld(dir);
      if (state.mode === 'field' && !state.moving && !state.pending) tryMove(dir);
    };
    const off = () => { btn.classList.remove('on'); if (state.held === dir) state.held = null; };
    btn.addEventListener('pointerdown', on);
    btn.addEventListener('pointerup', off);
    btn.addEventListener('pointerleave', off);
    btn.addEventListener('pointercancel', off);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  $('btn-a').addEventListener('click', () => press('ok'));
  $('btn-b').addEventListener('click', () => press('cancel'));
  $('message').addEventListener('click', () => press('ok'));
  $('sheet').addEventListener('click', () => press('ok'));
}

// ---------------------------------------------------------------- ループ

let lastFrame = 0;

function update(dt) {
  if (state.flash > 0) state.flash = Math.max(0, state.flash - dt / 400);

  if (state.view) {
    state.view.flash = Math.max(0, state.view.flash - dt / 260);
    state.view.shake = Math.max(0, state.view.shake - dt / 60);
    if (state.view.dead > 0) state.view.dead = Math.min(1, state.view.dead + dt / 500);
  }

  if (state.mode !== 'field') return;

  if (state.moving) {
    state.moving.t += dt;
    const p = Math.min(1, state.moving.t / STEP_MS);
    state.ox = state.moving.dx * (p - 1);
    state.oy = state.moving.dy * (p - 1);
    if (p >= 1) {
      const hero = state.hero;
      hero.x += state.moving.dx;
      hero.y += state.moving.dy;
      state.ox = 0;
      state.oy = 0;
      state.frame = (state.frame + 1) % 2;
      state.moving = null;
      finishStep();
    }
    return;
  }

  if (state.held) tryMove(state.held);
}

function frame(now) {
  const dt = Math.min(64, now - lastFrame);
  lastFrame = now;
  update(dt);

  if (state.mode === 'battle' && state.view) {
    state.scene.drawBattle(state.view, dt);
  } else if (state.map) {
    const hero = state.hero;
    state.scene.drawField(
      {
        map: state.map,
        hero: { x: hero.x, y: hero.y, dir: hero.dir, ox: state.ox, oy: state.oy, frame: state.frame },
        npcs: state.npcs,
        opened: hero.chests,
        flash: state.flash,
      },
      dt,
    );
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- 立ち上げ

function startGame(hero) {
  state.hero = hero;
  state.mode = 'field';
  $('title').hidden = true;
  $('hud').hidden = false;
  state.scene.resize();
  enterMap(hero.map, hero.x, hero.y, hero.dir);
  renderHud();
  if (!hero.flags.opening) {
    hero.flags.opening = true;
    runFlow(async () => {
      await sayAll([
        'まおう ダークロードが よみがえり\n世界は 闇に つつまれた。',
        `${hero.name}よ。\nまずは ちょうろうの家を たずねるのじゃ。`,
      ]);
      hideMessage();
      save();
    });
  }
}

function init() {
  state.scene = new Scene($('scene'));
  window.addEventListener('resize', () => state.scene.resize());
  window.addEventListener('orientationchange', () => setTimeout(() => state.scene.resize(), 250));
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', () => { state.held = null; });
  setupTouch();

  const saved = load();
  if (saved) {
    $('btn-continue').hidden = false;
    $('btn-continue').addEventListener('click', () => startGame(saved));
  }
  $('btn-new').addEventListener('click', async () => {
    if (saved && !window.confirm('いまの ぼうけんの きろくは 消えます。よろしいですか？')) return;
    startGame(createHero());
  });

  // 通し確認（test/browser.smoke.mjs）から中をのぞくための窓口。
  window.rpg = {
    get state() { return state; },
    get hero() { return state.hero; },
    get mode() { return state.mode; },
    get battle() { return state.battle; },
    get pending() { return state.pending; },
    press,
    move(dir) { setHeld(dir); },
    stop() { state.held = null; },
    teleport(map, x, y) { enterMap(map, x, y, 'down'); },
    encounter(id) { startBattle(id); },   // 待たずに返す（テストから操作できるように）
    save,
    reset() { localStorage.removeItem(STORAGE_KEY); },
  };

  lastFrame = performance.now();
  requestAnimationFrame(frame);
}

init();
