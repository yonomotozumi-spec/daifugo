/** 画面まわりとゲーム進行。ルールは engine.js / world.js、描画は scene.js に任せる。 */

import {
  Battle, PARTY_LIMIT, addItem, allGearById, buy, claimReward, classById, createSave,
  hasItem, innCost, isDown, itemById, itemList, joinParty, leaderOf, normalizeSave, onDefeat,
  removeItem, sell, sellPrice, spellsOf, statsOf, stayInn, targetsAlly, useItem, weightedPick,
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
  save: null,
  map: null,
  npcs: [],
  scene: null,
  mode: 'title',              // title / field / busy / battle
  held: null,                 // 押しっぱなしの方向
  moving: null,               // { dir, dx, dy, t }
  ox: 0, oy: 0, frame: 0,
  trail: [],                  // 隊列。先頭が通ってきたマスを 3 つぶん覚えておく
  flash: 0,
  sinceBattle: 0,             // 最後の戦闘からの歩数
  battle: null,
  view: null,                 // 戦闘中の見た目
  pending: null,              // 入力待ち（メッセージ／メニュー）
  typing: null,
};

const party = () => state.save.party;
const leader = () => leaderOf(state.save);

// ---------------------------------------------------------------- セーブ

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    return raw ? normalizeSave(raw) : null;
  } catch {
    return null;
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.save));
    return true;
  } catch {
    return false;   // 保存できなくても遊べる
  }
}

// ---------------------------------------------------------------- 表示

function renderHud() {
  if (!state.save) return;
  const box = $('party');
  box.innerHTML = '';
  for (const member of party()) {
    const s = statsOf(member);
    const card = document.createElement('div');
    card.className = `window member${isDown(member) ? ' down' : ''}`;
    const low = member.hp > 0 && member.hp <= s.maxHp * 0.25 ? ' low' : '';
    card.innerHTML = `
      <span class="m-name">${member.name}</span>
      <span class="m-lv">Lv${s.level}</span>
      <span class="m-hp${low}">H ${member.hp}/${s.maxHp}</span>
      <span class="m-mp">${s.maxMp ? `M ${member.mp}/${s.maxMp}` : ''}</span>`;
    box.append(card);
  }
  $('hud-gold').textContent = state.save.gold;
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

    const first = items.findIndex((i) => !i.disabled);
    state.pending = {
      kind: 'menu',
      index: first < 0 ? 0 : first,
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

/** 仲間をひとり選ぶ。 */
async function pickMember(title, { allowDown = true, onlyDown = false } = {}) {
  const items = party().map((member) => {
    const s = statsOf(member);
    return {
      label: member.name,
      sub: isDown(member) ? 'しんでいる' : `H ${member.hp}/${s.maxHp}${s.maxMp ? `  M ${member.mp}/${s.maxMp}` : ''}`,
      value: member,
      disabled: (!allowDown && isDown(member)) || (onlyDown && !isDown(member)),
    };
  });
  if (items.every((i) => i.disabled)) return null;
  items.push({ label: 'やめる', value: null });
  return menu({ title, items, wide: true });
}

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

/** 倒した魔王や 仲間になった人は もうマップに立っていない。 */
function refreshNpcs() {
  const flags = state.save.flags;
  state.npcs = state.map.npcs
    .filter((n) => !(n.kind === 'boss' && flags[n.defeatFlag || 'bossDead']))
    .filter((n) => !(n.kind === 'join' && flags[`join:${n.id}`]))
    .map((n) => ({ ...n, dir: n.dir || 'down', frame: 0 }));
}

function enterMap(id, x, y, dir = 'down') {
  const data = state.save;
  const map = mapById(id);
  state.map = map;
  data.map = id;
  data.x = x;
  data.y = y;
  data.dir = dir;
  state.ox = 0;
  state.oy = 0;
  state.moving = null;
  state.sinceBattle = 0;
  state.trail = [{ x, y, dir }, { x, y, dir }, { x, y, dir }];
  refreshNpcs();
  if (map.kind !== 'room') showPlace(map.name);
  renderHud();
  save();
}

/** 通れるか。壁だけでなく人・宝箱・立て札もふさぐ（仲間はすり抜ける）。 */
function blocked(x, y) {
  const map = state.map;
  if (!canWalk(map, x, y)) return true;
  if (npcAt(state.npcs, x, y)) return true;
  if (chestAt(map, state.save.chests, x, y)) return true;
  if (signAt(map, x, y)) return true;
  return false;
}

function tryMove(dir) {
  const data = state.save;
  data.dir = dir;
  const d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir];
  const nx = data.x + d[0];
  const ny = data.y + d[1];
  if (blocked(nx, ny)) {
    state.frame = (state.frame + 1) % 2;
    return false;
  }
  state.moving = { dir, t: 0, dx: d[0], dy: d[1] };
  return true;
}

async function finishStep() {
  const data = state.save;
  const map = state.map;
  data.steps++;
  state.sinceBattle++;

  const warp = warpAt(map, data.x, data.y);
  if (warp) {
    await useWarp(warp);
    return;
  }

  const chance = encounterChance(map, data.x, data.y);
  if (state.sinceBattle > 2 && Math.random() < chance) {
    const table = encountersAt(map, data.x, data.y);
    const picked = weightedPick(table, (m) => m.w);
    await startBattle(picked.id);
  }
}

async function useWarp(warp) {
  const data = state.save;
  if (warp.require && !hasItem(data, warp.require)) {
    await runFlow(async () => {
      await say(warp.requireText || 'ここからは 先へ 進めない。');
      // 一歩下がる
      const back = { up: [0, 1], down: [0, -1], left: [1, 0], right: [-1, 0] }[data.dir];
      if (back && !blocked(data.x + back[0], data.y + back[1])) {
        data.x += back[0];
        data.y += back[1];
      }
      hideMessage();
    });
    return;
  }
  if (warp.require && warp.openText && !data.flags[`open:${warp.to}`]) {
    data.flags[`open:${warp.to}`] = true;
    await runFlow(async () => {
      await say(warp.openText);
      hideMessage();
    });
  }
  enterMap(warp.to, warp.tx, warp.ty, warp.dir || data.dir);
}

// ---------------------------------------------------------------- 会話・調べる

async function interact() {
  const data = state.save;
  const map = state.map;
  const front = frontOf(map, data.x, data.y, data.dir);
  const npc = npcAt(state.npcs, front.x, front.y);
  if (npc) { await talkTo(npc); return; }

  const chest = chestAt(map, data.chests, front.x, front.y);
  if (chest) { await openChest(chest); return; }

  const sign = signAt(map, front.x, front.y);
  if (sign) { await runFlow(async () => { await say(sign.text); hideMessage(); }); }
}

async function talkTo(npc) {
  npc.dir = { up: 'down', down: 'up', left: 'right', right: 'left' }[state.save.dir] || npc.dir;
  await runFlow(async () => {
    switch (npc.kind) {
      case 'shop': await shop(npc); break;
      case 'inn': await inn(npc); break;
      case 'save': await scribe(npc); break;
      case 'elder': await elder(npc); break;
      case 'join': await recruit(npc); break;
      case 'altar': await altar(npc); break;
      case 'boss': await boss(npc); break;
      default: await sayAll(npc.lines);
    }
    hideMessage();
  });
}

async function openChest(chest) {
  const data = state.save;
  await runFlow(async () => {
    // 見張りつきの宝箱は、まず その魔物を たおさないと 開けられない。
    if (chest.guard && !data.flags[`guard:${chest.id}`]) {
      await sayAll(chest.guardLines || ['宝箱を 魔物が 守っている！']);
      hideMessage();
      if ((await startBattle(chest.guard)) !== 'win') return;
      data.flags[`guard:${chest.id}`] = true;
      save();
    }
    data.chests.push(chest.id);
    if (chest.gold) {
      data.gold += chest.gold;
      await say(`宝箱を あけた！\n${chest.gold} ゴールドを 手にいれた！`);
    } else if (chest.gear) {
      const gear = allGearById(chest.gear);
      await say(`宝箱を あけた！\n${gear.name}を 手にいれた！`);
      const who = (await pickMember(`${gear.name}は だれが 装備する？`)) || leader();
      const old = statsOf(who)[gear.slot];
      who[gear.slot] = gear.id;
      await say(`${who.name}は ${gear.name}を 身につけた！${old.id === 'none' ? '' : `\n${old.name}は しまっておいた。`}`);
    } else if (chest.item) {
      const item = itemById(chest.item);
      if (!addItem(data, chest.item)) {
        data.chests.pop();
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
  const data = state.save;
  if (data.flags.bossDead) {
    await sayAll(['よくぞ 魔王を たおしてくれた！', 'お前たちは この村の……\nいや 世界の ほこりじゃ。']);
    return;
  }
  await sayAll(data.flags.elder ? npc.done : npc.lines);
  if (!data.flags.elder && npc.gift) {
    data.flags.elder = true;
    data.gold += npc.gift.gold || 0;
    if (npc.gift.item) addItem(data, npc.gift.item);
    await say(npc.gift.text);
    renderHud();
    save();
  }
}

/** 仲間にさそう。 */
async function recruit(npc) {
  const data = state.save;
  if (npc.require && !data.flags[npc.require]) {
    await sayAll(npc.waitLines || npc.lines);
    return;
  }
  await sayAll(npc.lines);
  if (party().length >= PARTY_LIMIT) {
    await say('けれど もう これ以上は\n連れて 歩けそうにない……');
    return;
  }
  if (!(await confirm(`${npc.member.name}を 仲間にする？`))) {
    await say('気が変わったら いつでも 声を かけておくれ。');
    return;
  }
  const res = joinParty(data, npc.member.cls, npc.member.name, npc.member.minLevel || 1);
  await say(res.text);
  if (res.ok) {
    data.flags[`join:${npc.id}`] = true;
    if (npc.joinLines) await sayAll(npc.joinLines);
    refreshNpcs();
    renderHud();
    save();
  }
}

/** 立ちふさがる敵。話しかけると 戦いが始まる。勝つと ごほうびが手に入る。 */
async function boss(npc) {
  const data = state.save;
  await sayAll(npc.lines);
  hideMessage();
  const result = await startBattle(npc.monster);
  if (result !== 'win') return;

  data.flags[npc.defeatFlag || 'bossDead'] = true;
  if (npc.onWin) {
    if (npc.onWin.item) addItem(data, npc.onWin.item);
    await sayAll(npc.onWin.lines || []);
  }
  refreshNpcs();
  renderHud();
  save();
}

/** 灯台のような「品物を合わせる」場所。 */
async function altar(npc) {
  const data = state.save;
  if (hasItem(data, npc.gives) || data.flags[`altar:${npc.id}`]) {
    await sayAll(npc.doneLines || npc.waitLines);
    return;
  }
  if (!npc.needs.every((id) => hasItem(data, id))) {
    await sayAll(npc.waitLines);
    return;
  }
  await sayAll(npc.readyLines || []);
  for (const id of npc.needs) removeItem(data, id);
  addItem(data, npc.gives);
  data.flags[`altar:${npc.id}`] = true;
  state.flash = 1;
  await sayAll(npc.giveLines || []);
  renderHud();
  save();
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
  const data = state.save;
  const cost = innCost(data);
  await say(`${npc.lines[0]}\n${party().length}人で ひとばん ${cost} ゴールドだよ。`);
  if (!(await confirm('とまる？'))) {
    await say('また どうぞ。');
    return;
  }
  const res = stayInn(data);
  await say(res.text);
  renderHud();
  if (res.ok) save();
}

async function shop(npc) {
  const data = state.save;
  const shopData = SHOPS[npc.shop];
  await say(npc.lines[0]);
  for (;;) {
    const what = await menu({
      title: `${shopData.name}　所持金 ${data.gold} G`,
      wide: true,
      items: [{ label: 'かう', value: 'buy' }, { label: 'うる', value: 'sell' }, { label: 'やめる', value: null }],
    });
    if (!what) break;

    if (what === 'buy') {
      const goods = shopData.goods.map((id) => {
        const g = allGearById(id) || itemById(id);
        return { label: g.name, sub: `${g.price} G`, value: id, disabled: data.gold < g.price };
      });
      goods.push({ label: 'やめる', value: null });
      const id = await menu({ title: `なにを 買う？　${data.gold} G`, items: goods, wide: true });
      if (!id) continue;

      const gear = allGearById(id);
      let who = leader();
      if (gear) {
        const picked = await pickMember(`${gear.name}は だれに？`);
        if (!picked) continue;
        who = picked;
      }
      const res = buy(data, id, who);
      await say(res.text);
      renderHud();
      save();
      continue;
    }

    const owned = itemList(data)
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
      const res = sell(data, id);
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
  const member = party().length === 1 ? leader() : await pickMember('だれの つよさを 見る？');
  if (!member) return;
  const s = statsOf(member);
  const spells = spellsOf(member).map((sp) => sp.name).join('・') || 'なし';
  await showSheet(`つよさ — ${classById(member.cls).name}`, [
    ['なまえ', member.name],
    ['レベル', s.level],
    ['HP', `${member.hp} / ${s.maxHp}`],
    ['MP', `${member.mp} / ${s.maxMp}`],
    ['ちから', s.str],
    ['すばやさ', s.agi],
    ['こうげき力', s.atk],
    ['しゅび力', s.def],
    ['経験値', member.exp],
    ['つぎのレベルまで', s.nextExp === null ? '——' : s.nextExp],
    ['ぶき', s.weapon.name, true],
    ['よろい', s.armor.name, true],
    ['たて', s.shield.id === 'none' ? 'なし' : s.shield.name, true],
    ['じゅもん', spells, true],
  ]);
}

/**
 * 道具を使う。戦闘中は選んだ行動（{type:'item', id, target}）を返す。
 * フィールドでは、リターナなどで場面が変わったときだけ true を返す。
 */
async function useItemMenu(where, actor = null) {
  const data = state.save;
  const list = itemList(data).filter(({ item }) => (where === 'battle' ? item.battle : true));
  if (!list.length) {
    await say('道具を なにも 持っていない。');
    if (where === 'field') hideMessage();
    return false;
  }
  const items = list.map(({ item, count }) => ({ label: `${item.name} × ${count}`, sub: item.desc, value: item.id }));
  items.push({ label: 'やめる', value: null });
  const id = await menu({ title: 'どうぐ', items, wide: true });
  if (!id) return false;

  const item = itemById(id);
  let target = null;
  if (item.ally && party().length > 1) {
    target = await pickMember(`${item.name}を だれに？`, { onlyDown: item.kind === 'revive' });
    if (!target) return false;
  } else if (item.ally) {
    target = leader();
  }

  if (where === 'battle') return { type: 'item', id, target: target || actor };

  const res = useItem(data, id, target || leader(), 'field');
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

/** 呪文を唱える。戦闘中は選んだ行動を返す。 */
async function castMenu(where, actor = null) {
  const casters = party().filter((m) => !isDown(m) && spellsOf(m).length);
  if (!casters.length) {
    await say('だれも 呪文を おぼえていない。');
    if (where === 'field') hideMessage();
    return false;
  }
  const caster = actor || (casters.length === 1 ? casters[0] : await pickMember('だれが 呪文を つかう？', { allowDown: false }));
  if (!caster) return false;

  const known = spellsOf(caster).filter((s) => (where === 'battle' ? s.kind !== 'warp' : s.field));
  if (!known.length) {
    await say(`${caster.name}は いま つかえる 呪文が ない。`);
    if (where === 'field') hideMessage();
    return false;
  }
  const items = known.map((s) => ({ label: s.name, sub: `${s.mp} MP`, value: s.id, disabled: caster.mp < s.mp }));
  items.push({ label: 'やめる', value: null });
  const id = await menu({ title: `じゅもん — ${caster.name}　MP ${caster.mp}`, items, wide: true });
  if (!id) return false;

  const spell = known.find((s) => s.id === id);
  let target = null;
  if (targetsAlly(spell)) {
    target = party().length === 1 && spell.kind !== 'revive'
      ? leader()
      : await pickMember(`${spell.name}を だれに？`, { onlyDown: spell.kind === 'revive' });
    if (!target) return false;
  }

  if (where === 'battle') return { type: 'spell', id, target };

  // フィールドでの回復・蘇生・帰還
  caster.mp -= spell.mp;
  await say(`${caster.name}は ${spell.name}を となえた！`);
  if (spell.kind === 'heal') {
    const s = statsOf(target);
    const heal = spell.power === 'full'
      ? s.maxHp - target.hp
      : Math.min(s.maxHp - target.hp, spell.power[0] + Math.floor(Math.random() * (spell.power[1] - spell.power[0] + 1)));
    target.hp += heal;
    await say(heal > 0 ? `${target.name}の HP が ${heal} 回復した。` : `しかし ${target.name}の HP は 満タンだ。`);
  } else if (spell.kind === 'revive') {
    if (Math.random() < 0.5) {
      target.hp = Math.max(1, Math.round(statsOf(target).maxHp * 0.5));
      await say(`${target.name}は 生き返った！`);
    } else {
      await say(`しかし ${target.name}は 生き返らなかった……`);
    }
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
}

// ---------------------------------------------------------------- 戦闘

async function startBattle(monsterId) {
  const data = state.save;
  const battle = new Battle(data, monsterId, Math.random);
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
    const actions = await chooseCommands();
    await playLines(battle.resolve(actions));
  }

  const result = battle.result;
  await endBattle();
  return result;
}

function renderEnemy() {
  const battle = state.battle;
  $('enemy').hidden = !battle;
  if (!battle) return;
  $('enemy-name').textContent = battle.monster.name;
  $('enemy-gauge').style.width = `${Math.max(0, (battle.monster.hp / battle.monster.maxHp) * 100)}%`;
}

/**
 * 生きている仲間ぶんのコマンドを 順番に決める。
 * キャンセルで ひとつ前の仲間に戻れる。
 */
async function chooseCommands() {
  const list = party();
  const actions = new Array(list.length).fill(null);
  const living = list.map((m, i) => i).filter((i) => !isDown(list[i]));

  for (let n = 0; n < living.length;) {
    const index = living[n];
    const member = list[index];
    const pick = await menu({
      title: list.length > 1 ? member.name : '',
      items: [
        { label: 'たたかう', value: 'attack' },
        { label: 'じゅもん', value: 'spell', disabled: !spellsOf(member).some((s) => s.kind !== 'warp') },
        { label: 'どうぐ', value: 'item', disabled: !itemList(state.save).some(({ item }) => item.battle) },
        { label: 'にげる', value: 'flee' },
      ],
      cancel: n > 0,          // 先頭の仲間からは 戻れない
    });

    if (pick === null) { n--; continue; }             // ひとつ前の仲間へ
    if (pick === 'attack' || pick === 'flee') { actions[index] = { type: pick }; n++; continue; }
    if (pick === 'spell') {
      const action = await castMenu('battle', member);
      if (action) { actions[index] = action; n++; }
      continue;
    }
    const action = await useItemMenu('battle', member);
    if (action) { actions[index] = action; n++; }
  }
  return actions;
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
  const data = state.save;
  const battle = state.battle;

  if (battle.result === 'win') {
    const { exp, gold, levels } = claimReward(data, battle);
    renderHud();
    if (exp || gold) await say(`経験値 ${exp} ポイントを かくとくした。\n${gold} ゴールドを 手にいれた！`);
    for (const up of levels) {
      renderHud();
      await say(`${up.member.name}は レベル ${up.level} に あがった！`);
      for (const spell of up.spells) await say(`${up.member.name}は ${spell.name}の 呪文を おぼえた！`);
    }
    if (battle.monster.final) { await ending(); return; }
  } else if (battle.result === 'lose') {
    await say('……');
    const { lost } = onDefeat(data);
    await say(`目をさますと 村の 宿屋の ベッドだった。\n${lost} ゴールドを 落としてしまった……`);
    closeBattle();
    enterMap('town', 10, 11, 'down');
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
  const data = state.save;
  data.flags.bossDead = true;
  state.view.fade = 0;
  for (let i = 0; i <= 20; i++) { state.view.fade = i / 20; await wait(40); }

  const names = party().map((m) => m.name);
  await sayAll([
    'まおう ザルガスは 星の光の中に 消えていった……',
    '長かった 闇の夜が 明け\n世界に 朝が もどってきた。',
    '港の 灯台には ふたたび 灯りがともり\n船は 海へ こぎ出していく。',
    `${names.join('と ')}は\n夜明けの 村へと 帰っていった。`,
    'ゆうしゃたちの ぼうけんは ここで おしまい。\nでも 旅は まだまだ 続けられる。',
    '━━ よあけのつるぎ  かんぜんクリア ━━\n遊んでくれて ありがとう！',
  ]);

  closeBattle();
  for (const member of party()) {
    const s = statsOf(member);
    member.hp = s.maxHp;
    member.mp = s.maxMp;
  }
  enterMap('town', 10, 11, 'down');
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

const DIR_KEYS = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right',
};

function onKeyDown(e) {
  const dir = DIR_KEYS[e.key];
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
  const dir = DIR_KEYS[e.key];
  if (dir && state.held === dir) state.held = null;
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
      const data = state.save;
      state.trail.unshift({ x: data.x, y: data.y, dir: data.dir });
      state.trail.length = 3;
      data.x += state.moving.dx;
      data.y += state.moving.dy;
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

/** 隊列を 画面に出す形（座標は小数）にする。先頭が主人公。 */
function partyOnMap() {
  const data = state.save;
  const p = state.moving ? Math.min(1, state.moving.t / STEP_MS) : 1;
  const people = [{
    x: data.x + state.ox,
    y: data.y + state.oy,
    dir: data.dir,
    frame: state.frame,
    look: classById(party()[0].cls).look,
  }];
  for (let i = 1; i < party().length; i++) {
    const to = state.trail[i - 1] || { x: data.x, y: data.y, dir: data.dir };
    const from = state.trail[i] || to;
    people.push({
      x: from.x + (to.x - from.x) * p,
      y: from.y + (to.y - from.y) * p,
      dir: to.dir,
      frame: state.frame,
      look: classById(party()[i].cls).look,
      down: isDown(party()[i]),
    });
  }
  return people;
}

function frame(now) {
  const dt = Math.min(64, now - lastFrame);
  lastFrame = now;
  update(dt);

  if (state.mode === 'battle' && state.view) {
    state.scene.drawBattle(state.view, dt);
  } else if (state.map) {
    state.scene.drawField(
      {
        map: state.map,
        party: partyOnMap(),
        npcs: state.npcs,
        opened: state.save.chests,
        flash: state.flash,
      },
      dt,
    );
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- 立ち上げ

function startGame(data) {
  state.save = data;
  state.mode = 'field';
  $('title').hidden = true;
  state.scene.resize();
  enterMap(data.map, data.x, data.y, data.dir);
  if (!data.flags.opening) {
    data.flags.opening = true;
    runFlow(async () => {
      await sayAll([
        'まおう ザルガスが よみがえり\n世界は 闇に つつまれた。',
        `${leader().name}よ。\nまずは ちょうろうの家を たずねるのじゃ。`,
        'ひとりでは 心ぼそい。\n旅の仲間を さがすのじゃぞ……',
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
  $('btn-new').addEventListener('click', () => {
    if (saved && !window.confirm('いまの ぼうけんの きろくは 消えます。よろしいですか？')) return;
    startGame(createSave());
  });

  // 通し確認（test/browser.smoke.mjs）から中をのぞくための窓口。
  window.rpg = {
    get state() { return state; },
    get save() { return state.save; },
    get party() { return state.save?.party; },
    get leader() { return state.save && leader(); },
    get mode() { return state.mode; },
    get battle() { return state.battle; },
    get pending() { return state.pending; },
    press,
    move(dir) { setHeld(dir); },
    stop() { state.held = null; },
    teleport(map, x, y) { enterMap(map, x, y, 'down'); },
    encounter(id) { startBattle(id); },   // 待たずに返す（テストから操作できるように）
    persist: save,                        // save は上の getter（セーブデータ）なので別名で
    reset() { localStorage.removeItem(STORAGE_KEY); },
  };

  lastFrame = performance.now();
  requestAnimationFrame(frame);
}

init();
