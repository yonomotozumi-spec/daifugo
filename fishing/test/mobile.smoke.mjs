/**
 * スマホ・タブレットでの通し確認。
 * 実機に近い画面サイズとタッチ操作で遊べるか、
 * ホーム画面アプリ（PWA）として成立しているかまで見る。
 *
 *   npx --yes http-server . -p 8123 &
 *   npm i -D playwright && npx playwright install chromium
 *   node fishing/test/mobile.smoke.mjs
 *
 * スクリーンショットは fishing/test/screenshots/ に出る。
 */

import { mkdir } from 'node:fs/promises';
import { chromium, devices } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8123/fishing/';
const OUT = new URL('./screenshots/', import.meta.url).pathname;
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const fail = (msg) => { throw new Error(msg); };

/** 端末ごとに、指だけで釣り上げられるか見る。 */
async function playOn(label, deviceName) {
  const ctx = await browser.newContext(devices[deviceName]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.fishing);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}mobile-${label}.png` });

  // 画面からはみ出していないこと（横スクロールが出ると台無しなので）
  const overflow = await page.evaluate(() => ({
    x: document.documentElement.scrollWidth - window.innerWidth,
    y: document.body.scrollHeight - window.innerHeight,
  }));
  if (overflow.x > 1) fail(`${label}: 横にはみ出している (${overflow.x}px)`);

  // 指の届く大きさか（Apple/Google の目安は 44px）
  const size = await page.locator('#btn-action').boundingBox();
  if (size.height < 44) fail(`${label}: 操作ボタンが小さすぎる (${size.height}px)`);

  // 長押しでコピーのメニューが出ないこと（リールを長押しで巻くので致命的）
  const pressable = ['#btn-action', '#stage', '#btn-shop', '#scene'];
  for (const sel of pressable) {
    const css = await page.locator(sel).evaluate((el) => {
      const s = getComputedStyle(el);
      return { select: s.webkitUserSelect || s.userSelect, callout: s.webkitTouchCallout };
    });
    if (css.select !== 'none') fail(`${label}: ${sel} が長押しで選択できてしまう (${css.select})`);
    if (css.callout && css.callout !== 'none') fail(`${label}: ${sel} で長押しメニューが出る (${css.callout})`);
  }

  let caught = false;
  for (let i = 0; i < 600 && !caught; i++) {
    const mode = await page.evaluate(() => window.fishing.mode);
    if (mode === 'idle' || mode === 'bite') {
      await page.tap('#btn-action');
    } else if (mode === 'fight') {
      // 魚より下にバーがあるときだけ押さえる
      const hold = await page.evaluate(() => {
        const f = window.fishing.fight;
        return f ? f.barY > f.fishY : false;
      });
      const box = await page.locator('#btn-action').boundingBox();
      if (hold) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
      } else {
        await page.mouse.up();
      }
    } else if (mode === 'result') {
      await page.mouse.up().catch(() => {});
      caught = true;
    }
    await page.waitForTimeout(110);
  }
  if (!caught) fail(`${label}: 指だけで釣り上げられなかった`);

  // 釣果カードから売る
  const before = await page.evaluate(() => window.fishing.player.money);
  await page.tap('#btn-sell');
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => window.fishing.player.money);
  if (after <= before) fail(`${label}: 売っても所持金が増えない`);

  // 日誌の引き出し（狭い画面のときだけ出る）
  if (await page.locator('#btn-log').isVisible()) {
    await page.tap('#btn-log');
    await page.waitForTimeout(450);
    if (!(await page.locator('#sidebar').evaluate((el) => el.classList.contains('open')))) {
      fail(`${label}: 日誌の引き出しが開かない`);
    }
    const vp = page.viewportSize();
    await page.mouse.click(vp.width / 2, 90);   // 引き出しの外をつつくと閉じる
    await page.waitForTimeout(400);
    if (await page.locator('#sidebar').evaluate((el) => el.classList.contains('open'))) {
      fail(`${label}: 日誌の引き出しが閉じない`);
    }
  }

  // ショップが指で開けて、はみ出さないこと
  await page.tap('#btn-shop');
  await page.waitForTimeout(400);
  const dlg = await page.locator('#dlg-shop').boundingBox();
  if (dlg.width > page.viewportSize().width) fail(`${label}: ショップが画面からはみ出している`);
  await page.keyboard.press('Escape');

  const sw = await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()));
  if (!sw) fail(`${label}: Service Worker が登録されていない`);

  if (errors.length) fail(`${label}: ${errors.join(' | ')}`);
  console.log(`${label}: 指だけで釣って売れた（${after - before}円）／はみ出しなし／SW あり`);
  await ctx.close();
}

/** ホーム画面アプリとしての体裁。 */
async function checkManifest() {
  const ctx = await browser.newContext(devices['iPhone 13']);
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });

  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  if (!href) fail('manifest が読み込まれていない');
  const res = await page.request.get(new URL(href, BASE).href);
  if (!res.ok()) fail(`manifest が取れない (${res.status()})`);
  const m = await res.json();

  for (const key of ['name', 'short_name', 'start_url', 'display', 'icons']) {
    if (!m[key]) fail(`manifest に ${key} がない`);
  }
  if (m.display !== 'standalone') fail('display が standalone でない');
  if (!m.icons.some((i) => i.purpose?.includes('maskable'))) fail('maskable アイコンがない');

  for (const icon of m.icons) {
    const r = await page.request.get(new URL(icon.src, BASE).href);
    if (!r.ok()) fail(`アイコンが取れない: ${icon.src}`);
  }
  const apple = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  if (!apple) fail('apple-touch-icon がない');
  if (!(await page.request.get(new URL(apple, BASE).href)).ok()) fail('apple-touch-icon が取れない');

  console.log(`manifest: ${m.name}／アイコン ${m.icons.length} 種／${m.display}`);
  await ctx.close();
}

/**
 * 指で長押ししたときに、ちゃんとリールが巻けるか。
 * 長押しメニューを止める処理でタップやホールドを潰してしまうことがあるので、
 * 本物のタッチイベントを流して確かめる。
 */
async function checkLongPressReel() {
  const ctx = await browser.newContext(devices['iPhone 13']);
  const page = await ctx.newPage();
  const client = await ctx.newCDPSession(page);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.fishing);

  const touch = async (type, box) => {
    const points = type === 'touchEnd' ? [] : [{
      x: box.x + box.width / 2, y: box.y + box.height / 2, radiusX: 6, radiusY: 6, force: 1, id: 1,
    }];
    await client.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  };

  // アタリが来るまで投げ直す
  let hooked = false;
  for (let i = 0; i < 400 && !hooked; i++) {
    const mode = await page.evaluate(() => window.fishing.mode);
    const box = await page.locator('#btn-action').boundingBox();
    if (mode === 'idle' || mode === 'bite') {
      await touch('touchStart', box);
      await touch('touchEnd', box);
    }
    if (await page.evaluate(() => window.fishing.mode) === 'fight') hooked = true;
    await page.waitForTimeout(110);
  }
  if (!hooked) fail('長押しの確認までたどり着けなかった');

  // 指を置いたままにする → 巻いている状態になること
  const box = await page.locator('#btn-action').boundingBox();
  await touch('touchStart', box);
  await page.waitForTimeout(500);
  const holdingWhileDown = await page.evaluate(() => window.fishing.scene.holding);
  await touch('touchEnd', box);
  await page.waitForTimeout(200);
  const holdingAfterUp = await page.evaluate(() => window.fishing.scene.holding);

  if (!holdingWhileDown) fail('指を置いてもリールを巻かない');
  if (holdingAfterUp) fail('指を離しても巻き続けている');

  // 選択が始まっていないこと（長押しメニューはここから出る）
  const selected = await page.evaluate(() => String(window.getSelection?.() || '').length);
  if (selected > 0) fail(`長押しで文字が選択されている（${selected} 文字）`);

  console.log('長押し: 指を置くと巻けて、離すと止まる／文字は選択されない');
  await ctx.close();
}

/**
 * iOS 向けの指定が配信物に入っているか。
 * -webkit-touch-callout は Chromium が実装していないので、
 * 計算済みスタイルではなく CSS そのものを読んで確かめる。
 */
async function checkIosCss() {
  const ctx = await browser.newContext(devices['iPhone 13']);
  const page = await ctx.newPage();
  const css = await (await page.request.get(new URL('src/style.css', BASE).href)).text();
  for (const decl of ['-webkit-touch-callout: none', '-webkit-user-select: none', '-webkit-tap-highlight-color']) {
    if (!css.includes(decl)) fail(`style.css に ${decl} がない`);
  }

  const html = await (await page.request.get(BASE)).text();
  for (const tag of ['apple-mobile-web-app-capable', 'apple-mobile-web-app-status-bar-style', 'viewport-fit=cover']) {
    if (!html.includes(tag)) fail(`index.html に ${tag} がない`);
  }
  console.log('iOS 向けの指定: 長押しメニュー抑止・全画面・切り欠き対応すべてあり');
  await ctx.close();
}

/** 通信を切っても遊べるか。 */
async function checkOffline() {
  const ctx = await browser.newContext(devices['iPhone 13']);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.fishing);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForTimeout(1500);
  await page.evaluate(() => { window.fishing.player.money = 1234; window.fishing.save(); });

  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.fishing, { timeout: 15000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}mobile-offline.png` });

  if (await page.evaluate(() => window.fishing.player.money) !== 1234) fail('オフライン時にセーブが復元されない');
  if (!(await page.evaluate(() => document.getElementById('scene').width > 0))) fail('オフライン時に描画されない');

  await page.tap('#btn-action');
  await page.waitForTimeout(1200);
  if (await page.evaluate(() => window.fishing.mode) === 'idle') fail('オフライン時にキャストできない');
  if (errors.length) fail(`オフライン時のエラー: ${errors.join(' | ')}`);

  console.log('オフライン: 機内モードでも起動して遊べる');
  await ctx.close();
}

await playOn('iphone', 'iPhone 13');
await playOn('iphone-landscape', 'iPhone 13 landscape');
await playOn('ipad', 'iPad (gen 7)');
await checkManifest();
await checkIosCss();
await checkLongPressReel();
await checkOffline();

await browser.close();
console.log('OK: スマホ・タブレットでの通し確認をすべて通過しました');
