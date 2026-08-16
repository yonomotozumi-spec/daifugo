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
import { RODS, SPOTS } from '../src/engine.js';

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

// 釣り場も買って移動する
await page.click('.tab[data-kind="spot"]');
await page.waitForTimeout(200);
await page.locator('.shop-item').nth(1).locator('button').click();
await page.waitForTimeout(300);
await shot('07-shop-spot');
const spot = await page.locator('#badge-spot').innerText();
if (spot !== SPOTS[1].name) throw new Error(`釣り場が変わっていない: ${spot}`);
const finalMoney = await money();
if (finalMoney !== afterBuy - SPOTS[1].price) throw new Error(`釣り場の代金が引かれていない: ${finalMoney}`);

await page.keyboard.press('Escape');
await page.waitForTimeout(400);
await shot('08-river');

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

if (errors.length) {
  console.error('コンソールエラー:', errors);
  throw new Error(`${errors.length} 件のエラー`);
}

await browser.close();
console.log('OK: 通し確認をすべて通過しました');
