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
const hero = () => page.evaluate(() => ({ ...window.rpg.hero }));
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
  for (let i = 0; i < 200 && (await mode()) === 'battle'; i++) {
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
ok('村から ぼうけんが始まる', (await hero()).map === 'town' && (await mode()) === 'field');
await shot('02-town');

// ---------------------------------------------------------------- 道具屋で買い物

await page.evaluate(() => window.rpg.teleport('item', 4, 3));
await page.waitForTimeout(200);
await page.keyboard.press('ArrowUp');                 // カウンターの向こうの店主を向く
await page.waitForTimeout(200);

const before = await hero();
await page.keyboard.press('Enter');                   // 話しかける
await page.waitForTimeout(300);
await clearMessages(4);
await shot('03-shop');
await page.keyboard.press('Enter');                   // かう
await page.waitForTimeout(200);
await page.keyboard.press('Enter');                   // やくそう
await page.waitForTimeout(300);
await clearMessages(4);
const afterBuy = await hero();
ok('やくそうを 買えた', afterBuy.items.herb === before.items.herb + 1 && afterBuy.gold < before.gold);

// メニューを閉じて店を出る
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
ok('村の外に 出られた', (await hero()).map === 'world');
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

await page.evaluate(() => { window.rpg.hero.exp = 100; window.rpg.hero.weapon = 'steel'; });
await page.evaluate(() => window.rpg.encounter('slime'));
await page.waitForTimeout(600);
await fight('attack');
const won = await hero();
ok('スライムに 勝って経験値をもらえた', won.exp > 100);
await shot('06-after-battle');

// ---------------------------------------------------------------- ほらあな・城

await page.evaluate(() => window.rpg.teleport('cave', 11, 16));
await page.waitForTimeout(400);
ok('ほらあなに 入れた', (await hero()).map === 'cave');
await shot('07-cave');

await page.evaluate(() => { window.rpg.hero.exp = 5200; window.rpg.hero.weapon = 'light'; window.rpg.hero.armor = 'lightArmor'; });
await page.evaluate(() => window.rpg.teleport('castle', 11, 4));
await page.waitForTimeout(400);
await shot('08-castle');

// ---------------------------------------------------------------- 結界とラスボス

await page.evaluate(() => {
  window.rpg.hero.items = { herb: 6 };            // ひかりのたま は まだ持っていない
  window.rpg.teleport('world', 18, 3);
});
await page.waitForTimeout(300);
await walk('up', 1);
await page.waitForTimeout(400);
ok('たまが無いと 結界に はじかれる', (await hero()).map === 'world');
await shot('09-barrier');
await clearMessages(4);

await page.evaluate(() => { window.rpg.hero.items.orb = 1; });
await walk('up', 1);
await page.waitForTimeout(400);
await clearMessages(4);
ok('ひかりのたまで 結界が破れる', (await hero()).map === 'castle');

// 玉座の魔王に 話しかけて 最後の戦い（演出の確認なので 主人公は思いきり強くしておく）
await page.evaluate(() => {
  const h = window.rpg.hero;
  h.exp = 7800;
  h.weapon = 'light';
  h.armor = 'lightArmor';
  h.shield = 'mirrorShield';
  h.bonusHp = 500;
  h.hp = 700;
  window.rpg.teleport('castle', 11, 3);
});
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
const cleared = await hero();
ok('魔王を たおして エンディングになる', cleared.flags.bossDead === true && cleared.map === 'town');
await shot('11-ending');

// ---------------------------------------------------------------- セーブ

await page.evaluate(() => window.rpg.save());
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('rpg:save')));
ok('ぼうけんの きろくが 残る', saved && saved.flags.bossDead === true);

ok('コンソールにエラーが出ていない', errors.length === 0);
if (errors.length) console.log(errors.slice(0, 10));

await browser.close();
console.log(process.exitCode ? '\n失敗あり' : '\nすべて ok');
