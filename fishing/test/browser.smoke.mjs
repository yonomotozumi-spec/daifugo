/**
 * 釣りゲームの通し確認。実ブラウザでキャスト → 合わせ → 寄せ → 売却まで遊ぶ。
 *
 *   npx --yes http-server . -p 8123 &        # どんな静的サーバーでもよい
 *   npm i -D playwright && npx playwright install chromium
 *   node fishing/test/browser.smoke.mjs
 *
 * 環境に Chromium がすでにある場合は PW_CHROMIUM=/path/to/chrome で指定できる。
 * スクリーンショットは fishing/test/screenshots/ に出る。
 */

import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

// 値段や名前はゲーム側から読む（バランス調整のたびに直さなくて済むように）
import { ACHIEVEMENTS, FISH, GEAR, HAPTICS, RODS, SPOTS, WEATHERS, hapticFor, rankAt } from '../src/engine.js';
import { SOUND_NAMES } from '../src/sound.js';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8123/fishing/';
const OUT = new URL('./screenshots/', import.meta.url).pathname;
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

const shot = (name) => page.screenshot({ path: `${OUT}${name}.png` });
const mode = () => page.evaluate(() => window.fishing.mode);
const money = () => page.evaluate(() => window.fishing.player.money);

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.fishing);
await page.waitForTimeout(600);
await shot('01-idle');

// ---------------------------------------------------------------- はじめての案内

const coach = await page.evaluate(() => ({
  shown: !document.getElementById('coach').hidden,
  text: document.getElementById('coach-text').textContent,
}));
if (!coach.shown) throw new Error('はじめての案内が出ていない');
if (!coach.text.includes('キャスト')) throw new Error(`案内の中身がちがう: ${coach.text}`);
console.log(`案内: 「${coach.text}」`);

// ---------------------------------------------------------------- 3 匹釣る

let caught = 0;
let sold = 0;
for (let step = 0; step < 900 && caught < 3; step++) {
  const m = await mode();

  if (m === 'idle') {
    await page.click('#btn-action');
  } else if (m === 'bite') {
    await page.click('#btn-action');                 // 合わせる
    if (caught === 0) await shot('02-hooked');
  } else if (m === 'fight') {
    // 魚より下にバーがあるときだけ巻く（人間がやることと同じ）
    const hold = await page.evaluate(() => {
      const f = window.fishing.fight;
      return f ? f.barY > f.fishY : false;
    });
    await page.keyboard[hold ? 'down' : 'up']('Space');
    if (caught === 0 && step % 30 === 5) await shot('03-fight');
  } else if (m === 'result') {
    await page.keyboard.up('Space');
    caught++;
    if (caught === 1) await shot('04-result');
    const name = await page.locator('#result-name').innerText();
    const price = await page.locator('#result-price').innerText();
    console.log(`釣果 ${caught}: ${name} / ${price}円`);
    const before = await money();
    await page.click('#btn-sell');
    await page.waitForTimeout(900);
    const after = await money();
    if (after <= before) throw new Error('売っても所持金が増えていない');
    sold++;
    if (caught === 1) await shot('05-sold');
  }
  await page.waitForTimeout(120);
}
await page.keyboard.up('Space');

if (caught < 3) throw new Error(`3 匹釣れなかった（${caught} 匹）`);
console.log(`売却 ${sold} 回 / 所持金 ${await money()}円`);

// ---------------------------------------------------------------- ショップ

await page.evaluate(() => { window.fishing.player.money = 20000; window.fishing.render(); });
await page.click('#btn-shop');
await page.waitForTimeout(400);
await shot('06-shop');

// 2 つ目の竿を買う
const rodCard = page.locator('.shop-item').nth(1);
const rodName = await rodCard.locator('h3').innerText();
await rodCard.locator('button').click();
await page.waitForTimeout(500);
const afterBuy = await money();
if (afterBuy !== 20000 - RODS[1].price) throw new Error(`購入後の所持金がおかしい: ${afterBuy}`);
const badge = await page.locator('#badge-rod').innerText();
if (badge !== rodName) throw new Error(`買った竿が装備されていない: ${badge}`);
console.log(`購入: ${rodName} → 残り ${afterBuy}円`);

// 道具は買い切り。買うと「使用中」になり、効果の合計が出る
await page.click('.tab[data-kind="gear"]');
await page.waitForTimeout(250);
const gearCard = page.locator('.shop-item').first();
const gearName = await gearCard.locator('h3').innerText();
const beforeGear = await money();
await gearCard.locator('button').click();
await page.waitForTimeout(400);
const afterGear = await money();
if (afterGear !== beforeGear - GEAR[0].price) throw new Error(`道具の代金が引かれていない: ${afterGear}`);
const gearBtn = await page.locator('.shop-item').first().locator('button').innerText();
if (gearBtn !== '使用中') throw new Error(`買った道具が使われていない: ${gearBtn}`);
const summary = await page.locator('#gear-summary').innerText();
if (!summary.includes('売値')) throw new Error(`効果の合計が出ていない: ${summary}`);
console.log(`購入: ${gearName.trim()} → ${summary}`);
await shot('06b-shop-gear');

// 釣り場も買って移動する
await page.click('.tab[data-kind="spot"]');
await page.waitForTimeout(200);
await page.locator('.shop-item').nth(1).locator('button').click();
await page.waitForTimeout(300);
await shot('07-shop-spot');
const spot = await page.locator('#badge-spot').innerText();
if (spot !== SPOTS[1].name) throw new Error(`釣り場が変わっていない: ${spot}`);
const finalMoney = await money();
if (finalMoney !== afterGear - SPOTS[1].price) throw new Error(`釣り場の代金が引かれていない: ${finalMoney}`);

await page.keyboard.press('Escape');
await page.waitForTimeout(400);
await shot('08-river');

// ---------------------------------------------------------------- 天気

const weatherText = await page.locator('#badge-weather').innerText();
if (!WEATHERS.some((w) => weatherText.includes(w.label))) {
  throw new Error(`天気が表示されていない: ${weatherText}`);
}
console.log(`天気: ${weatherText}`);

// ---------------------------------------------------------------- 図鑑

await page.click('#btn-book');
await page.waitForTimeout(400);
await shot('09-book');
const found = await page.locator('.book-cell:not(.unknown)').count();
if (found < 1) throw new Error('図鑑に記録が残っていない');
console.log(`図鑑: ${found} 種`);
await page.keyboard.press('Escape');

// ---------------------------------------------------------------- セーブ

await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => window.fishing);
const reloaded = await money();
if (reloaded !== finalMoney) throw new Error(`セーブが復元されない: ${reloaded} !== ${finalMoney}`);
const keptRod = await page.locator('#badge-rod').innerText();
if (keptRod !== rodName) throw new Error(`買った竿が消えている: ${keptRod}`);
console.log('リロード後も所持金と持ち物が残っている');

// ---------------------------------------------------------------- はじめから

await page.click('#btn-reset');
await page.waitForTimeout(300);
if (!(await page.locator('#dlg-reset').evaluate((d) => d.open))) throw new Error('確認が出ない');
const willLose = await page.locator('#reset-list').innerText();
if (!willLose.includes('所持金')) throw new Error(`消えるものが出ていない: ${willLose}`);

// やめるを押したら何も消えない
await page.click('#reset-cancel');
await page.waitForTimeout(300);
if (await money() !== finalMoney) throw new Error('やめたのに消えた');

await page.click('#btn-reset');
await page.waitForTimeout(300);
await page.click('#reset-ok');
await page.waitForTimeout(600);

const afterReset = await page.evaluate(() => ({
  money: window.fishing.player.money,
  rods: window.fishing.player.rods,
  gears: window.fishing.player.gears,
  spots: window.fishing.player.spots,
  records: Object.keys(window.fishing.player.records).length,
  saved: localStorage.getItem('fishing:save'),
  mode: window.fishing.mode,
}));
if (afterReset.money !== 0) throw new Error(`所持金が残っている: ${afterReset.money}`);
if (afterReset.rods.length !== 1 || afterReset.gears.length !== 0) throw new Error('道具が残っている');
if (afterReset.spots.length !== 1) throw new Error('釣り場が残っている');
if (afterReset.records !== 0) throw new Error('図鑑が残っている');
if (afterReset.mode !== 'idle') throw new Error(`遊べる状態に戻っていない: ${afterReset.mode}`);
if (JSON.parse(afterReset.saved).money !== 0) throw new Error('保存が上書きされていない');
console.log('はじめから: 所持金・道具・釣り場・図鑑がすべて初期状態に戻った');

// リロードしても初期状態のまま
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => window.fishing);
if (await money() !== 0) throw new Error('リロードで元に戻ってしまった');

// ---------------------------------------------------------------- 難所（鍵つきの釣り場）

const hardSpot = SPOTS.find((s) => s.hard === 1);
const keyFish = FISH.find((f) => f.id === hardSpot.require);

const reopenSpotTab = async () => {
  await page.click('.tab[data-kind="rod"]');
  await page.click('.tab[data-kind="spot"]');
  await page.waitForTimeout(200);
};

// お金があっても、鍵の魚を釣るまでは行けない
await page.evaluate(() => { window.fishing.player.money = 5000000; window.fishing.render(); });
await page.click('#btn-shop');
await reopenSpotTab();
const hardCard = page.locator('.shop-item').nth(SPOTS.indexOf(hardSpot));
const hardName = await hardCard.locator('h3').innerText();
if (!hardName.includes(hardSpot.name)) throw new Error(`難所のカードが見つからない: ${hardName}`);
if (!hardName.includes('🔥')) throw new Error(`難度の印が出ていない: ${hardName}`);
const lockNote = await hardCard.locator('.shop-note').innerText();
if (!lockNote.includes('🔒') || !lockNote.includes(keyFish.name)) {
  throw new Error(`鍵の案内が出ていない: ${lockNote}`);
}
if (!(await hardCard.locator('button').isDisabled())) throw new Error('鍵つきなのに買えてしまう');
await shot('10-locked');

// 鍵の魚を釣った扱いにすると開く
await page.evaluate((id) => {
  window.fishing.player.records[id] = { count: 1, weightKg: 50, lengthCm: 150, price: 400000 };
  window.fishing.save();
}, keyFish.id);
await reopenSpotTab();
if (await hardCard.locator('button').isDisabled()) throw new Error('ヌシを釣っても開かない');
await hardCard.locator('button').click();
await page.waitForTimeout(400);
const hardBadge = await page.locator('#badge-spot').innerText();
if (hardBadge !== hardSpot.name) throw new Error(`難所へ移動できていない: ${hardBadge}`);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
await shot('11-hard-spot');
console.log(`難所: ${keyFish.name}を釣るまで鍵がかかり、釣ると ${hardSpot.name} へ行けた`);

// 難所では潮に流され、ラインへの負荷も大きい
let hazard = null;
for (let step = 0; step < 900 && !hazard; step++) {
  const m = await mode();
  if (m === 'idle' || m === 'bite') await page.click('#btn-action');
  else if (m === 'fight') {
    hazard = await page.evaluate(() => {
      const f = window.fishing.fight;
      return f && { drift: f.drift, stress: f.stress, tough: f.tough, hard: f.hard };
    });
  } else if (m === 'result') {
    await page.click('#btn-sell');
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(110);
}
await page.keyboard.up('Space');
if (!hazard) throw new Error('難所で 1 匹も掛からなかった');
if (!(hazard.drift > 0)) throw new Error(`難所なのに流されない: ${JSON.stringify(hazard)}`);
if (!(hazard.stress > 1)) throw new Error(`難所なのに負荷が増えない: ${JSON.stringify(hazard)}`);
if (!(hazard.tough > 1)) throw new Error(`難所なのに魚が軽い: ${JSON.stringify(hazard)}`);
if (hazard.hard !== 1) throw new Error(`難度が伝わっていない: ${JSON.stringify(hazard)}`);
console.log(`難所の勝負: 流れ ${hazard.drift} / 負荷 ${hazard.stress.toFixed(2)} / 重さ ×${hazard.tough}`);

// ---------------------------------------------------------------- やりこみ（熟練度・実績・お題）

// 池に戻って 1 匹釣り、経験値とお題が動くことを見る
await page.evaluate(() => { window.fishing.player.spot = 'pond'; window.fishing.render(); });
let grindCaught = false;
for (let step = 0; step < 900 && !grindCaught; step++) {
  const m = await mode();
  if (m === 'idle' || m === 'bite') {
    await page.click('#btn-action');
  } else if (m === 'fight') {
    const hold = await page.evaluate(() => {
      const f = window.fishing.fight;
      return f ? f.barY > f.fishY : false;
    });
    await page.keyboard[hold ? 'down' : 'up']('Space');
  } else if (m === 'result') {
    await page.keyboard.up('Space');
    await page.click('#btn-sell');
    await page.waitForTimeout(800);
    grindCaught = true;
  }
  await page.waitForTimeout(110);
}
await page.keyboard.up('Space');
if (!grindCaught) throw new Error('やりこみの確認で 1 匹も釣れなかった');

const grind = await page.evaluate(() => ({
  xp: window.fishing.player.xp,
  achieved: window.fishing.player.achieved.length,
  quests: (window.fishing.player.daily.quests || []).map((q) => ({ kind: q.kind, goal: q.goal, progress: q.progress })),
  rankBadge: document.getElementById('badge-rank').textContent,
  dailyRows: document.querySelectorAll('#daily-list .daily-item').length,
}));
if (!(grind.xp > 0)) throw new Error('経験値が入っていない');
if (grind.achieved < 1) throw new Error('実績がひとつも達成されていない');
if (grind.quests.length !== 3) throw new Error(`お題が 3 つではない（${grind.quests.length}）`);
if (grind.dailyRows !== 3) throw new Error(`お題が画面に出ていない（${grind.dailyRows} 行）`);
if (!grind.rankBadge.startsWith('Lv.')) throw new Error(`熟練度が出ていない: ${grind.rankBadge}`);
const castQuest = grind.quests.find((q) => q.kind === 'casts');
if (castQuest && castQuest.progress < 1) throw new Error('キャストのお題が進んでいない');
console.log(`やりこみ: ${grind.rankBadge} / 経験値 ${grind.xp} / 実績 ${grind.achieved} 件 / お題 ${grind.quests.length} 個`);

// ランクが上がると、上のバーと記録の画面に出る
await page.evaluate(() => {
  const p = window.fishing.player;
  p.xp = 250000;
  p.catches = 1200;
  p.casts = 900;
  p.earned = 2000000;
  p.dailyDone = 60;
  window.fishing.render();
});
await page.click('#btn-quest');
await page.waitForTimeout(400);
await shot('12-quest');
const quest = await page.evaluate(() => ({
  level: document.getElementById('rank-level').textContent,
  name: document.getElementById('rank-name').textContent,
  fill: document.getElementById('rank-fill').style.width,
  effect: document.getElementById('rank-effect').textContent,
  cards: document.querySelectorAll('.ach-item').length,
  doneCards: document.querySelectorAll('.ach-item.done').length,
  titles: document.querySelectorAll('.title-chip').length,
  head: document.getElementById('quest-progress').textContent,
}));
if (quest.cards !== ACHIEVEMENTS.length) throw new Error(`実績カードの数が合わない: ${quest.cards}`);
if (!quest.effect.includes('売値')) throw new Error(`ランクの効果が出ていない: ${quest.effect}`);
if (!quest.fill) throw new Error('経験値バーが伸びていない');
console.log(`記録の画面: ${quest.level} ${quest.name} / ${quest.head} / 称号 ${quest.titles} 個`);

// 実績を達成すると称号が増え、つけかえられる
const before = await page.evaluate(() => document.querySelectorAll('.title-chip').length);
if (before < 2) throw new Error(`称号が足りない（${before} 個）`);

const readTitle = () => page.evaluate(() => {
  const el = document.getElementById('badge-title');
  return { hidden: el.hidden, text: el.textContent, saved: JSON.parse(localStorage.getItem('fishing:save')).title };
});

// まだつけていない称号に切りかえられること
const wanted = await page.locator('.title-chip:not(.on)').first().innerText();
await page.locator('.title-chip:not(.on)').first().click();
await page.waitForTimeout(300);
const put = await readTitle();
if (put.hidden) throw new Error('称号をつけても上のバーに出ない');
if (!put.text.includes(wanted)) throw new Error(`つけた称号と違う: ${put.text} / ${wanted}`);
if (put.saved !== wanted) throw new Error(`称号が保存されていない: ${put.saved}`);

// もう一度押すと外れる
await page.locator('.title-chip.on').first().click();
await page.waitForTimeout(300);
const off = await readTitle();
if (!off.hidden) throw new Error('称号を外しても消えない');
if (off.saved !== null) throw new Error(`外した称号が保存に残っている: ${off.saved}`);
console.log(`称号: 「${wanted}」をつけ外しして保存できた`);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// きらめき個体は、値段も図鑑の扱いも別
const shiny = await page.evaluate(() => {
  const p = window.fishing.player;
  p.shinies = { funa: { count: 1, weightKg: 1, lengthCm: 30, price: 5000 } };
  p.records.funa = p.records.funa || { count: 1, weightKg: 1, lengthCm: 30, price: 1000 };
  window.fishing.save();
  return true;
});
if (!shiny) throw new Error('きらめきの記録を作れなかった');
await page.click('#btn-book');
await page.waitForTimeout(400);
const book = await page.evaluate(() => ({
  shinyCells: document.querySelectorAll('.book-cell.shiny').length,
  progress: document.getElementById('book-progress').textContent,
}));
if (book.shinyCells < 1) throw new Error('図鑑にきらめきの印が出ていない');
if (!book.progress.includes('✨')) throw new Error(`図鑑の見出しにきらめきの数が出ていない: ${book.progress}`);
console.log(`図鑑: ${book.progress}`);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// ---------------------------------------------------------------- バックアップ

await page.evaluate(() => { window.fishing.player.money = 777000; window.fishing.save(); });
await page.click('#btn-backup');
await page.waitForTimeout(400);
const backup = await page.evaluate(() => ({
  text: document.getElementById('backup-out').value,
  summary: document.getElementById('backup-summary').textContent,
}));
if (!backup.text.includes('fishing-save')) throw new Error(`書き出しの形がちがう: ${backup.text.slice(0, 60)}`);
if (!backup.summary.includes('777,000円')) throw new Error(`見出しに所持金が出ていない: ${backup.summary}`);
await shot('13-backup');

// 記録を変えてから読み込むと、書き出した時点まで戻る
await page.evaluate(() => {
  window.fishing.player.money = 1;
  window.fishing.player.records = {};
  window.fishing.save();
});
await page.evaluate((text) => {
  document.getElementById('backup-in').value = text;
}, backup.text);
await page.click('#backup-load');
await page.waitForTimeout(600);
const restored = await page.evaluate(() => ({
  money: window.fishing.player.money,
  records: Object.keys(window.fishing.player.records).length,
  saved: JSON.parse(localStorage.getItem('fishing:save')).money,
  msg: document.getElementById('backup-msg').textContent,
}));
if (restored.money !== 777000) throw new Error(`読み込んでも戻らない: ${restored.money}`);
if (restored.records < 1) throw new Error('図鑑が戻っていない');
if (restored.saved !== 777000) throw new Error('読み込んだ内容が保存されていない');
console.log(`バックアップ: 書き出して読み直すと所持金と図鑑が戻った（${restored.msg.slice(0, 40)}）`);

// おかしなデータは断る
await page.evaluate(() => { document.getElementById('backup-in').value = 'こわれたデータ'; });
await page.click('#backup-load');
await page.waitForTimeout(300);
const refused = await page.evaluate(() => ({
  msg: document.getElementById('backup-msg').textContent,
  bad: document.getElementById('backup-msg').className.includes('bad'),
  money: window.fishing.player.money,
}));
if (!refused.bad) throw new Error(`こわれたデータを読んでしまった: ${refused.msg}`);
if (refused.money !== 777000) throw new Error('断ったのに記録が変わった');
console.log(`バックアップ: こわれたデータは「${refused.msg}」と断った`);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// ---------------------------------------------------------------- 音

const soundState = await page.evaluate(() => ({
  muted: window.fishing.sound.muted,
  icon: document.getElementById('sound-icon').textContent,
}));
if (soundState.muted) throw new Error('はじめから消音になっている');
if (soundState.icon !== '🔊') throw new Error(`音の印がちがう: ${soundState.icon}`);

await page.click('#btn-sound');
await page.waitForTimeout(250);
const muted = await page.evaluate(() => ({
  muted: window.fishing.sound.muted,
  icon: document.getElementById('sound-icon').textContent,
  saved: localStorage.getItem('fishing:muted'),
}));
if (!muted.muted || muted.icon !== '🔇') throw new Error(`消音に切りかわらない: ${JSON.stringify(muted)}`);
if (muted.saved !== '1') throw new Error('消音が保存されていない');

await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => window.fishing);
const afterReload = await page.evaluate(() => document.getElementById('sound-icon').textContent);
if (afterReload !== '🔇') throw new Error('リロードで消音が元に戻った');
await page.click('#btn-sound');
await page.waitForTimeout(250);
console.log('音: 切りかえと保存ができ、リロードしても覚えている');

// ---------------------------------------------------------------- 音と振動の設定

await page.click('#btn-settings');
await page.waitForTimeout(400);
const settings = await page.evaluate(() => ({
  sound: document.getElementById('set-sound').checked,
  ambience: document.getElementById('set-ambience').checked,
  haptics: document.getElementById('set-haptics').checked,
  hapticsOff: document.getElementById('set-haptics').disabled,
  note: document.getElementById('haptics-note').textContent,
  canVibrate: 'vibrate' in navigator,
}));
if (!settings.sound) throw new Error('効果音の切りかえが合っていない');
if (!settings.ambience) throw new Error('環境音がはじめから切れている');
if (settings.canVibrate === settings.hapticsOff) throw new Error(`振動の切りかえが端末と合っていない: ${settings.note}`);
await shot('14-settings');

// 環境音だけ切っても、効果音は残る
await page.click('#set-ambience');
await page.waitForTimeout(300);
const ambience = await page.evaluate(() => ({
  on: window.fishing.sound.ambienceOn,
  saved: localStorage.getItem('fishing:ambience'),
  sound: !window.fishing.sound.muted,
}));
if (ambience.on || ambience.saved !== '0') throw new Error('環境音を切っても保存されない');
if (!ambience.sound) throw new Error('環境音を切ると効果音まで消える');
await page.click('#set-ambience');
await page.waitForTimeout(200);
console.log(`設定: 効果音 ${SOUND_NAMES.length} 種／環境音の切りかえ／振動「${settings.note}」`);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// ---------------------------------------------------------------- 釣れたときの振動

// navigator.vibrate を差し替えて、実際に呼ばれるパターンを見る
await page.evaluate(() => {
  window.__vibes = [];
  Object.defineProperty(navigator, 'vibrate', {
    configurable: true,
    value: (pattern) => { window.__vibes.push(pattern); return true; },
  });
});
await page.evaluate(() => { window.fishing.player.spot = 'pond'; window.fishing.render(); });

let vibed = null;
for (let step = 0; step < 900 && !vibed; step++) {
  const m = await mode();
  if (m === 'idle' || m === 'bite') {
    await page.click('#btn-action');
  } else if (m === 'fight') {
    const hold = await page.evaluate(() => {
      const f = window.fishing.fight;
      return f ? f.barY > f.fishY : false;
    });
    await page.keyboard[hold ? 'down' : 'up']('Space');
  } else if (m === 'result') {
    await page.keyboard.up('Space');
    vibed = await page.evaluate(() => {
      const card = document.getElementById('result-card');
      const r = card.pendingResult;
      return {
        vibes: window.__vibes,
        fish: r.fish.id,
        junk: Boolean(r.fish.junk),
        boss: Boolean(r.fish.boss),
        shiny: Boolean(r.shiny),
        isNew: Boolean(r.isNew),
        sizeRatio: r.sizeRatio,
      };
    });
  }
  await page.waitForTimeout(110);
}
await page.keyboard.up('Space');
if (!vibed) throw new Error('振動の確認で 1 匹も釣れなかった');

const wantedBuzz = hapticFor({
  fish: FISH.find((f) => f.id === vibed.fish),
  shiny: vibed.shiny,
  isNew: vibed.isNew,
  sizeRatio: vibed.sizeRatio,
});
const shown = vibed.vibes.map((v) => JSON.stringify(v));
if (!shown.includes(JSON.stringify(HAPTICS.bite))) throw new Error(`アタリで震えていない: ${shown.join(' ')}`);
if (!shown.includes(JSON.stringify(wantedBuzz))) {
  throw new Error(`釣れたときの震えかたが違う（欲しい ${JSON.stringify(wantedBuzz)} / 実際 ${shown.join(' ')}）`);
}
console.log(`振動: ${vibed.fish} を釣って ${JSON.stringify(wantedBuzz)} で震えた（${vibed.vibes.length} 回）`);

// 設定で切ると震えなくなる
await page.click('#btn-settings');
await page.waitForTimeout(300);
await page.click('#set-haptics');
await page.waitForTimeout(200);
await page.evaluate(() => { window.__vibes = []; });
await page.click('#set-try');
await page.waitForTimeout(300);
const afterOff = await page.evaluate(() => ({
  vibes: window.__vibes.length,
  saved: localStorage.getItem('fishing:haptics'),
}));
if (afterOff.vibes > 0) throw new Error('振動を切っても震える');
if (afterOff.saved !== '0') throw new Error('振動の設定が保存されない');
await page.click('#set-haptics');
await page.waitForTimeout(200);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
console.log('振動: 設定で切ると震えなくなり、設定は保存される');

if (errors.length) {
  console.error('コンソールエラー:', errors);
  throw new Error(`${errors.length} 件のエラー`);
}

await browser.close();
console.log('OK: 通し確認をすべて通過しました');
