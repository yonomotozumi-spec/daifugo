/**
 * 実ブラウザでの通し確認。
 *
 *   npx --yes http-server . -p 8123 &        # どんな静的サーバーでもよい
 *   npm i -D playwright && npx playwright install chromium
 *   node test/browser.smoke.mjs
 *
 * 環境に Chromium がすでにある場合は PW_CHROMIUM=/path/to/chrome で指定できる。
 * スクリーンショットは test/screenshots/ に出る。
 */

import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8123/';
const OUT = new URL('./screenshots/', import.meta.url).pathname;
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

const dialogOpen = (id) => page.locator(`#${id}`).evaluate((d) => d.open);

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
console.log('配られた手札:', await page.locator('#hand .card').count(), '枚');
await page.screenshot({ path: `${OUT}initial.png` });

// ヒントに従って着手し続け、1 ラウンドを終わらせる。
for (let i = 0; i < 400; i++) {
  if (await dialogOpen('dlg-result')) break;
  if (!(await page.locator('#btn-hint').isDisabled())) {
    await page.click('#btn-hint');
    if (!(await page.locator('#btn-play').isDisabled())) await page.click('#btn-play');
    else await page.click('#btn-pass');
  }
  await page.waitForTimeout(150);
  if (i === 12) await page.screenshot({ path: `${OUT}midgame.png` });
}

if (!(await dialogOpen('dlg-result'))) throw new Error('ラウンドが終わらなかった');
console.log('結果:', (await page.locator('#result-list').innerText()).replace(/\n/g, ' / '));
await page.screenshot({ path: `${OUT}result.png` });

// 2 ラウンド目：カード交換のダイアログが出れば自動選択で通す。
await page.click('#result-next');
await page.waitForTimeout(800);
if (await dialogOpen('dlg-exchange')) {
  await page.click('#exchange-auto');
  await page.screenshot({ path: `${OUT}exchange.png` });
  await page.click('#exchange-ok');
  await page.waitForTimeout(600);
}
console.log('現在:', await page.locator('#badge-round').textContent());

await page.setViewportSize({ width: 420, height: 860 });
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}mobile.png` });

await browser.close();
if (errors.length) {
  console.error('コンソールエラー:', errors);
  process.exit(1);
}
console.log('コンソールエラーなし ✔');
