/**
 * RPG の通し確認。実ブラウザで 村を歩き、店で買い物し、魔物と戦うところまで遊ぶ。
 *
 *   npx --yes http-server . -p 8123 &        # どんな静的サーバーでもよい
 *   npm i -D playwright && npx playwright install chromium
 *   node rpg/test/browser.smoke.mjs
 *
 * 環境に Chromium がすでにある場合は PW_CHROMIUM=/path/to/chrome で指定できる。
 * スクリーンショットは rpg/test/screenshots/ に出る。
 */

import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8123/rpg/';
const OUT = new URL('./screenshots/', import.meta.url).pathname;
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 1120, height: 760 } });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

const shot = (name) => page.screenshot({ path: `${OUT}${name}.png` });
const game = () => page.evaluate(() => JSON.parse(JSON.stringify(window.rpg.save)));
const partySize = () => page.evaluate(() => window.rpg.party.length);
const mode = () => page.evaluate(() => window.rpg.mode);
const pending = () => page.evaluate(() => window.rpg.pending?.kind || null);

const ok = (label, cond) => {
  console.log(`${cond ? '  ok' : 'NG  '} ${label}`);
  if (!cond) process.exitCode = 1;
};

/** メッセージが出ているあいだ 決定を押し続ける。 */
async function clearMessages(limit = 40) {
  for (let i = 0; i < limit; i++) {
    if ((await pending()) !== 'message') return;
    await page.keyboard.press('Enter');
    await page.waitForTimeout(90);
  }
}

/** 戦闘が終わるまで コマンドを選び続ける。 */
async function fight(command) {
  for (let i = 0; i < 500 && (await mode()) === 'battle'; i++) {
    if ((await pending()) === 'menu') {
      if (command === 'flee') {
        await page.keyboard.press('ArrowUp');      // いちばん下＝にげる
        await page.waitForTimeout(60);
      }
      await page.keyboard.press('Enter');
    } else {
      await page.keyboard.press('Enter');          // メッセージ送り
    }
    await page.waitForTimeout(90);
  }
}

async function walk(dir, steps) {
  const key = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' }[dir];
  for (let i = 0; i < steps; i++) {
    await page.keyboard.down(key);
    await page.waitForTimeout(170);
    await page.keyboard.up(key);
    await page.waitForTimeout(40);
    if ((await mode()) === 'battle') return false;   // 途中で魔物に出会った
  }
  return true;
}

// ---------------------------------------------------------------- はじめる

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.removeItem('rpg:save'));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => window.rpg);
await shot('01-title');

await page.click('#btn-new');
await page.waitForTimeout(400);
await clearMessages();
ok('村から ぼうけんが始まる', (await game()).map === 'town' && (await mode()) === 'field');
ok('はじめは ゆうしゃ ひとり', (await partySize()) === 1);
await shot('02-town');

// ---------------------------------------------------------------- 道具屋で買い物

await page.evaluate(() => window.rpg.teleport('item', 4, 3));
await page.waitForTimeout(200);
await page.keyboard.press('ArrowUp');                 // カウンターの向こうの店主を向く
await page.waitForTimeout(200);

const before = await game();
await page.keyboard.press('Enter');                   // 話しかける
await page.waitForTimeout(300);
await clearMessages(4);
await shot('03-shop');
await page.keyboard.press('Enter');                   // かう
await page.waitForTimeout(200);
await page.keyboard.press('Enter');                   // いやしそう
await page.waitForTimeout(300);
await clearMessages(4);
const afterBuy = await game();
ok('いやしそうを 買えた', afterBuy.items.herb === before.items.herb + 1 && afterBuy.gold < before.gold);

// メニューを閉じて店を出る
for (let i = 0; i < 6 && (await mode()) !== 'field'; i++) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  await clearMessages(3);
}

// ---------------------------------------------------------------- 仲間にする

await page.evaluate(() => window.rpg.teleport('inn', 2, 5));
await page.waitForTimeout(250);
await page.keyboard.press('ArrowUp');            // やどやの せんし を向く
await page.waitForTimeout(200);
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
for (let i = 0; i < 12 && (await pending()) === 'message'; i++) {   // 口上を読む
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
}
await shot('03b-recruit');
await page.keyboard.press('Enter');              // 「はい」
await page.waitForTimeout(250);
await clearMessages(6);
ok('せんしが 仲間になった', (await partySize()) === 2);

for (let i = 0; i < 6 && (await mode()) !== 'field'; i++) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  await clearMessages(3);
}

// ---------------------------------------------------------------- 村の外へ

await page.evaluate(() => window.rpg.teleport('town', 8, 11));
await page.waitForTimeout(200);
await walk('down', 4);
await page.waitForTimeout(300);
ok('村の外に 出られた', (await game()).map === 'world');
await shot('04-world');

// ---------------------------------------------------------------- 魔物と戦う

let met = false;
for (let i = 0; i < 12 && !met; i++) {
  const dir = i % 2 === 0 ? 'left' : 'right';
  met = !(await walk(dir, 6));
}
ok('歩いていると 魔物が出る', met);
if (met) {
  await page.waitForTimeout(500);
  await shot('05-battle');
  // 「にげる」を選んで戦闘から抜ける
  await fight('flee');
  ok('戦闘から もどってこられた', (await mode()) === 'field');
}

// ---------------------------------------------------------------- 勝って レベルが上がる

await page.evaluate(() => {
  for (const m of window.rpg.party) { m.exp = 100; m.weapon = 'steel'; m.hp = 60; }
});
await page.evaluate(() => window.rpg.encounter('slime'));
await page.waitForTimeout(600);
await fight('attack');
const won = await game();
ok('ぷるんに 勝って 全員が経験値をもらえた', won.party.every((m) => m.exp > 100));
await shot('06-after-battle');

// ---------------------------------------------------------------- ほらあな・城

await page.evaluate(() => window.rpg.teleport('cave', 11, 16));
await page.waitForTimeout(400);
ok('ほらあなに 入れた', (await game()).map === 'cave');
await shot('07-cave');

// 見張りつきの宝箱（洞くつの主）
await page.evaluate(() => {
  for (const m of window.rpg.party) { m.exp = 1150; m.weapon = 'steel'; m.armor = 'iron'; m.bonusStr = 120; m.hp = 999; }
  window.rpg.teleport('cave', 11, 5);
});
await page.waitForTimeout(300);
await page.keyboard.press('ArrowUp');                 // 宝箱を向く
await page.waitForTimeout(200);
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
for (let i = 0; i < 20 && (await mode()) !== 'battle'; i++) {   // 主が 目をさます
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
}
await shot('07a-guard');
await fight('attack');
await clearMessages(14);
ok('洞くつの主を たおして 欠片を 取れた', (await game()).items.shardA === 1);

await page.evaluate(() => {
  for (const m of window.rpg.party) { m.exp = 5200; m.weapon = 'light'; m.armor = 'lightArmor'; }
  window.rpg.teleport('castle', 11, 7);
});
await page.waitForTimeout(400);
await shot('08-castle');

// ---------------------------------------------------------------- みなとまち と 灯台

await page.evaluate(() => window.rpg.teleport('port', 11, 14));
await page.waitForTimeout(400);
ok('みなとまち サーラ に 着いた', (await game()).map === 'port');
await shot('07b-port');

await page.evaluate(() => window.rpg.teleport('lighthouse', 4, 3));
await page.waitForTimeout(250);
await page.keyboard.press('ArrowUp');
await page.waitForTimeout(200);
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
await clearMessages(8);
ok('欠片が そろわないと 灯台では 何も起きない', (await game()).items.star === undefined);

// ---------------------------------------------------------------- 廃坑の中ボス

await page.evaluate(() => {
  for (const m of window.rpg.party) { m.exp = 2050; m.weapon = 'flame'; m.armor = 'iron'; m.bonusStr = 120; m.hp = 999; }
  window.rpg.teleport('mine', 11, 2);
});
await page.waitForTimeout(400);
await shot('07c-mine');
await page.keyboard.press('ArrowUp');                 // やみの将を向く
await page.waitForTimeout(200);
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
for (let i = 0; i < 20 && (await mode()) !== 'battle'; i++) {   // 前口上
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
}
await shot('07d-midboss');
await fight('attack');
await clearMessages(12);
ok('やみの将を たおして 欠片を 手に入れた', (await game()).items.shardB === 1);

// ---------------------------------------------------------------- 灯台で 欠片を合わせる

await page.evaluate(() => window.rpg.teleport('lighthouse', 4, 3));
await page.waitForTimeout(300);
await page.keyboard.press('ArrowUp');
await page.waitForTimeout(200);
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
await clearMessages(12);
const merged = await game();
ok('ふたつの欠片が 星のしずくに なった', merged.items.star === 1 && !merged.items.shardA && !merged.items.shardB);
await shot('07e-star');

// ---------------------------------------------------------------- 結界とラスボス

await page.evaluate(() => {
  window.rpg.save.items = { herb: 6 };            // 星のしずく は まだ持っていない
  window.rpg.teleport('world', 18, 3);
});
await page.waitForTimeout(300);
await walk('up', 1);
await page.waitForTimeout(400);
ok('しずくが無いと 結界に はじかれる', (await game()).map === 'world');
await shot('09-barrier');
await clearMessages(4);

await page.evaluate(() => { window.rpg.save.items.star = 1; });
await walk('up', 1);
await page.waitForTimeout(400);
await clearMessages(4);
ok('星のしずくで 結界が破れる', (await game()).map === 'castle');

// 玉座の魔王に 話しかけて 最後の戦い（演出の確認なので 主人公は思いきり強くしておく）
await page.evaluate(() => {
  for (const m of window.rpg.party) {
    m.exp = 7800;
    m.weapon = 'light';
    m.armor = 'lightArmor';
    m.shield = 'mirrorShield';
    m.bonusHp = 800;
    m.bonusStr = 150;      // 演出の確認なので 短く終わらせる
    m.hp = 1000;
    m.mp = 200;
  }
  window.rpg.teleport('castle', 11, 5);
});
await page.waitForTimeout(300);
await walk('up', 1);                                // 黒衣の魔導を向く
await page.waitForTimeout(200);
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
for (let i = 0; i < 20 && (await mode()) !== 'battle'; i++) {
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
}
await shot('09b-valdes');
await fight('attack');
await clearMessages(14);
ok('玉座の前の 黒衣の魔導を たおした', (await game()).flags.valdesDead === true);

await page.evaluate(() => window.rpg.teleport('castle', 11, 3));
await page.waitForTimeout(300);
await walk('up', 1);                                // 魔王を向く（ふさがれて向きだけ変わる）
await page.waitForTimeout(200);
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
await shot('10-boss');
for (let i = 0; i < 20 && (await mode()) !== 'battle'; i++) {   // 前口上を読み終える
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
}
await fight('attack');
const cleared = await game();
ok('魔王を たおして エンディングになる', cleared.flags.bossDead === true && cleared.map === 'town');
await shot('11-ending');

// ---------------------------------------------------------------- セーブ

await page.evaluate(() => window.rpg.persist());
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('rpg:save')));
ok('ぼうけんの きろくが 残る', saved && saved.flags.bossDead === true);

ok('コンソールにエラーが出ていない', errors.length === 0);
if (errors.length) console.log(errors.slice(0, 10));

await browser.close();
console.log(process.exitCode ? '\n失敗あり' : '\nすべて ok');
