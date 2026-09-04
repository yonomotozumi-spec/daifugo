/**
 * 戦国シミュレーションの通し確認。実ブラウザで
 * 大名を選ぶ → 内政 → 出陣（合戦） → 月を終える → 再読み込みで続きから、まで遊ぶ。
 *
 *   npx --yes http-server . -p 8123 &        # どんな静的サーバーでもよい
 *   npm i -D playwright && npx playwright install chromium
 *   node sengoku/test/browser.smoke.mjs
 *
 * 環境に Chromium がすでにある場合は PW_CHROMIUM=/path/to/chrome で指定できる。
 * スクリーンショットは sengoku/test/screenshots/ に出る。
 */

import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8123/sengoku/';
const OUT = new URL('./screenshots/', import.meta.url).pathname;
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

const shot = (name) => page.screenshot({ path: `${OUT}${name}.png` });
const game = (fn) => page.evaluate(fn);
const assert = (cond, msg) => { if (!cond) throw new Error(`確認失敗: ${msg}`); };

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.sengoku);
await page.waitForSelector('#dlg-start[open]');
await shot('01-start');

// ---------------------------------------------------------------- 大名を選ぶ
await page.click('.daimyo-card[data-id="oda"]');
await page.waitForSelector('#dlg-help[open]');
await page.click('#help-close');
await page.waitForFunction(() => window.sengoku.game && window.sengoku.game.player === 'oda');
assert(await page.textContent('#st-name') === '織田家', '選んだ家がヘッダーに出る');
await shot('02-map');

// ---------------------------------------------------------------- 内政
// 尾張は最初から選ばれていて、当主の命令欄が開いている
await page.waitForSelector('.general.open [data-cmd="develop"]');
const agriBefore = await game(() => window.sengoku.game.provinces.owari.agri);
await page.click('.general.open [data-cmd="develop"]');
await page.waitForFunction((a) => window.sengoku.game.provinces.owari.agri > a, agriBefore);
assert(await game(() => window.sengoku.game.generals.g0.acted), '信長が行動済みになる');
await shot('03-develop');

// 次の武将（柴田勝家）の命令欄が自動で開く → 徴兵
await page.waitForSelector('.general.open [data-cmd="recruit"]');
const soldiersBefore = await game(() => window.sengoku.game.provinces.owari.soldiers);
await page.click('.general.open [data-cmd="recruit"]');
await page.waitForFunction((n) => window.sengoku.game.provinces.owari.soldiers > n, soldiersBefore);

// ---------------------------------------------------------------- 出陣
await page.evaluate(() => { window.sengoku.game.provinces.owari.soldiers = 12000; window.sengoku.render(); });
await page.waitForSelector('.general.open [data-cmd="march"]');
await page.click('.general.open [data-cmd="march"]');
await page.waitForSelector('#map-hint:not([hidden])');
await page.waitForSelector('.node.target');
await shot('04-march-targets');
await page.click('.node[data-id="mikawa"]');
await page.waitForSelector('#dlg-troops[open]');
await page.evaluate(() => {
  const r = document.getElementById('troops-range');
  r.value = 10000;
  r.dispatchEvent(new Event('input'));
});
await shot('05-troops');
await page.click('#troops-ok');
await page.waitForSelector('#dlg-battle[open]');
await shot('06-battle');
for (let i = 0; i < 12; i++) {
  const done = await page.isHidden('#battle-attack');
  if (done) break;
  await page.click('#battle-attack');
  await page.waitForTimeout(80);
}
await page.waitForSelector('#battle-close:not(.hidden)');
await shot('07-battle-done');
await page.click('#battle-close');
const mikawaOwner = await game(() => window.sengoku.game.provinces.mikawa.owner);
assert(mikawaOwner === 'oda', `三河を落とせる（owner=${mikawaOwner}）`);

// 捕らえた武将が出たら解放する
for (let i = 0; i < 5; i++) {
  const open = await page.isVisible('#dlg-capture[open]');
  if (!open) break;
  if (i === 0) await shot('08-capture');
  await page.click('#capture-release');
  await page.waitForTimeout(80);
}

// ---------------------------------------------------------------- 月を終える
await page.click('#btn-end');
await page.waitForSelector('#dlg-confirm-end[open]'); // まだ動いていない武将がいる
await page.click('#confirm-end-ok');
await page.waitForSelector('#dlg-report[open]');
await shot('09-report');
await page.click('#report-close');
assert(await game(() => window.sengoku.game.month) === 5, '月が進む');
assert(await game(() => window.sengoku.game.generals.g0.acted) === false, '翌月は再び動ける');

// ---------------------------------------------------------------- 勢力一覧
await page.click('#btn-ranking');
await page.waitForSelector('#dlg-ranking[open]');
await shot('10-ranking');
await page.click('#ranking-close');

// ---------------------------------------------------------------- 続きから
const turnBefore = await game(() => window.sengoku.game.turn);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('#dlg-start[open]');
await page.waitForSelector('#btn-continue:not(.hidden)');
await page.click('#btn-continue');
await page.waitForFunction((t) => window.sengoku.game && window.sengoku.game.turn === t, turnBefore);
assert(await game(() => window.sengoku.game.provinces.mikawa.owner) === 'oda', '保存した続きから遊べる');

// ---------------------------------------------------------------- スマホ幅
await page.setViewportSize({ width: 390, height: 844 });
await page.click('#zoom-in');
await page.click('#zoom-in');
await page.waitForTimeout(800);
await shot('11-mobile');

await browser.close();

if (errors.length) {
  console.error('ブラウザでエラーが出ました:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('OK: 戦国シミュレーションの通し確認が完了');
