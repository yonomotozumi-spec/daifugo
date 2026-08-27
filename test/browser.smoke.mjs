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

// ---------------------------------------------------------------- 総合結果
// 3 ラウンドに設定してやり直し、最後まで戦って優勝が決まるところまで見る。

await page.click('#btn-settings');
await page.waitForTimeout(300);
await page.selectOption('#settings-form select[name="matchRounds"]', '3');
await page.click('#settings-form button[type="submit"]');
await page.waitForTimeout(800);
if (!(await page.locator('#badge-round').innerText()).includes('/ 3')) {
  throw new Error(`ラウンド数の設定が効いていない: ${await page.locator('#badge-round').innerText()}`);
}

for (let round = 1; round <= 3; round++) {
  for (let i = 0; i < 500; i++) {
    if (await dialogOpen('dlg-result')) break;
    if (await dialogOpen('dlg-exchange')) {
      await page.click('#exchange-auto');
      await page.click('#exchange-ok');
      await page.waitForTimeout(400);
      continue;
    }
    if (!(await page.locator('#btn-hint').isDisabled())) {
      await page.click('#btn-hint');
      if (!(await page.locator('#btn-play').isDisabled())) await page.click('#btn-play');
      else await page.click('#btn-pass');
    }
    await page.waitForTimeout(120);
  }
  if (!(await dialogOpen('dlg-result'))) throw new Error(`${round} ラウンド目が終わらなかった`);
  const label = await page.locator('#result-next').innerText();
  const expected = round === 3 ? '総合結果へ' : '次のラウンドへ';
  if (label !== expected) throw new Error(`${round} ラウンド目のボタンが「${label}」`);
  await page.click('#result-next');
  await page.waitForTimeout(700);
}

if (!(await dialogOpen('dlg-final'))) throw new Error('総合結果が出なかった');
const verdict = await page.locator('#final-title').innerText();
const rows = (await page.locator('#final-list li').allInnerTexts());
const points = rows.map((t) => Number(t.match(/(\d+)\s*pt/)?.[1] ?? -1));
console.log('総合結果:', verdict, '/', rows.join(' / ').replace(/\n/g, ' '));

if (rows.length !== 4) throw new Error(`総合結果の行数がおかしい: ${rows.length}`);
if (points.some((p) => p < 0)) throw new Error('ポイントが読めない行がある');
// 3 ラウンド × (3+2+1+0) = 18 点が全員に配られている
const total = points.reduce((a, b) => a + b, 0);
if (total !== 18) throw new Error(`ポイントの合計が合わない: ${total}`);
// 上から順に並んでいること
for (let i = 1; i < points.length; i++) {
  if (points[i] > points[i - 1]) throw new Error(`順位が並んでいない: ${points}`);
}
if (!/優勝/.test(verdict)) throw new Error(`優勝の表示がない: ${verdict}`);
await page.screenshot({ path: `${OUT}final.png` });

// もう一度あそぶとポイントが 0 に戻る
await page.click('#final-again');
await page.waitForTimeout(800);
const reset = await page.locator('#scores').innerText();
if (!/0 pt[\s\S]*0 pt[\s\S]*0 pt[\s\S]*0 pt/.test(reset)) {
  throw new Error(`やり直してもポイントが残っている: ${reset.replace(/\n/g, ' ')}`);
}
console.log('もう一度あそぶ: ポイントが 0 に戻った');

// ---------------------------------------------------------------- 設定を戻す

await page.click('#btn-settings');
await page.waitForTimeout(300);
await page.selectOption('#settings-form select[name="matchRounds"]', '10');
await page.click('#settings-form button[type="submit"]');
await page.waitForTimeout(700);
if (!(await page.locator('#badge-round').innerText()).includes('/ 10')) throw new Error('設定が反映されていない');

await page.click('#btn-settings');
await page.waitForTimeout(300);
await page.click('#settings-reset');
await page.waitForTimeout(700);
const backToDefault = await page.locator('#badge-round').innerText();
if (!backToDefault.includes('/ 5')) throw new Error(`初期設定に戻っていない: ${backToDefault}`);
const savedRounds = await page.evaluate(() => localStorage.getItem('daifugo:match'));
if (savedRounds !== null) throw new Error(`保存が消えていない: ${savedRounds}`);
console.log('初期設定に戻す: ラウンド数と保存が初期状態に戻った');

// ---------------------------------------------------------------- スマホ

await page.setViewportSize({ width: 420, height: 860 });
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}mobile.png` });

// 長押しでカードが選択・拡大されないこと
const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
for (const key of ['user-scalable=no', 'maximum-scale=1']) {
  if (!viewport.includes(key)) throw new Error(`viewport に ${key} がない: ${viewport}`);
}
for (const sel of ['.card', '#btn-play', '.hand']) {
  const css = await page.locator(sel).first().evaluate((el) => {
    const s = getComputedStyle(el);
    return { select: s.webkitUserSelect || s.userSelect, touch: s.touchAction };
  });
  if (css.select !== 'none') throw new Error(`${sel} が長押しで選択できてしまう (${css.select})`);
  if (!['manipulation', 'none'].includes(css.touch)) throw new Error(`${sel} でダブルタップ拡大が起きる (${css.touch})`);
}
const cssText = await (await page.request.get(new URL('src/style.css', BASE).href)).text();
if (!cssText.includes('-webkit-touch-callout: none')) throw new Error('style.css に -webkit-touch-callout がない');
console.log('スマホ: 拡大・長押しメニューの抑止あり');

await browser.close();
if (errors.length) {
  console.error('コンソールエラー:', errors);
  process.exit(1);
}
console.log('コンソールエラーなし ✔');
