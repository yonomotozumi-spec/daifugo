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

/**
 * 引き出し（下から出る日誌）の中のボタンを押す。
 * 中身は position: fixed で縦になぞるので、いったん見える位置まで送ってから、
 * その座標を直に触る（Playwright の tap は、この入れ子をうまく追えない）。
 */
async function tapInSheet(page, selector, label = selector) {
  const seat = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return {
      inView: r.top >= 0 && r.bottom <= window.innerHeight,
      x: Math.round(r.left + r.width / 2),
      y: Math.round(r.top + r.height / 2),
    };
  }, selector);
  if (!seat) fail(`${label} が見つからない`);
  if (!seat.inView) fail(`日誌をなぞっても ${label} に届かない`);
  await page.waitForTimeout(250);
  await page.touchscreen.tap(seat.x, seat.y);
}

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

/**
 * 所持金の桁が増えても上部バーがはみ出さないこと。
 * 実際に遊ぶと桁が増えていくのに、テストがいつも 0 円で走っていて見逃していた。
 */
async function checkWideMoney() {
  const widths = [320, 360, 375, 390, 430];
  const monies = [0, 12345, 1234567, 987654321];
  for (const width of widths) {
    for (const money of monies) {
      const ctx = await browser.newContext({
        viewport: { width, height: 800 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2,
      });
      const page = await ctx.newPage();
      await page.goto(BASE, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => window.fishing);
      // いちばん幅を食う状態で見る（最高ランク＋いちばん長い称号つき）
      await page.evaluate((m) => {
        const p = window.fishing.player;
        p.money = m;
        p.xp = 999999;
        p.achieved = ['rank20', 'bossAll', 'catch1000'];
        p.title = '伝説の釣り人';
        window.fishing.render();
      }, money);
      await page.waitForTimeout(150);
      const box = await page.evaluate(() => ({
        over: document.documentElement.scrollWidth - window.innerWidth,
        wallet: Math.round(document.getElementById('wallet').getBoundingClientRect().height),
      }));
      if (box.over > 1) fail(`${width}px / ${money.toLocaleString()}円 で ${box.over}px はみ出している`);
      // 桁が増えると所持金が縦に折り返して読めなくなることがあった
      if (box.wallet > 40) fail(`${width}px / ${money.toLocaleString()}円 で所持金が縦に潰れている (${box.wallet}px)`);
      await ctx.close();
    }
  }
  console.log(`はみ出し: ${widths.join('/')}px × 所持金 0〜9.8億 すべて OK`);
}

/**
 * 難所のカードは行数が多い（難度・負荷・流れ・重さ）ので、
 * 狭い画面でショップがはみ出さないかを見ておく。
 */
async function checkHardSpotCard() {
  const width = 360;
  const ctx = await browser.newContext({
    viewport: { width, height: 780 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.fishing);
  await page.evaluate(() => { window.fishing.player.money = 5000000; window.fishing.render(); });
  await page.tap('#btn-shop');
  await page.tap('.tab[data-kind="spot"]');
  await page.waitForTimeout(350);

  const card = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.shop-item')];
    const hard = cards.find((c) => c.classList.contains('locked'));
    if (!hard) return null;
    hard.scrollIntoView();
    const rect = hard.getBoundingClientRect();
    return {
      note: hard.querySelector('.shop-note').textContent,
      rows: hard.querySelectorAll('.shop-stats div').length,
      disabled: hard.querySelector('button').disabled,
      right: Math.round(rect.right),
      over: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  if (!card) fail('狭い画面で鍵つきの釣り場カードが出ていない');
  if (!card.note.includes('🔒')) fail(`鍵の案内が出ていない: ${card.note}`);
  if (!card.disabled) fail('鍵つきなのに買えてしまう');
  if (card.rows < 7) fail(`難所の説明が足りない（${card.rows} 行）`);
  if (card.over > 1) fail(`ショップが ${card.over}px はみ出している`);
  if (card.right > width) fail(`カードが画面からはみ出している（右端 ${card.right}px）`);
  await page.screenshot({ path: `${OUT}mobile-hard-spot.png` });
  await ctx.close();
  console.log(`難所のカード: ${width}px でもはみ出さず、鍵の案内が出ている`);
}

/**
 * 記録の画面（熟練度・称号・実績）と、日誌の中の「今日のお題」。
 * 行数が多いので、狭い画面で読めるかを見ておく。
 */
async function checkQuestScreen() {
  const width = 390;
  const ctx = await browser.newContext({
    viewport: { width, height: 780 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.fishing);
  await page.evaluate(() => {
    const p = window.fishing.player;
    p.xp = 120000;
    p.catches = 1200;
    p.casts = 900;
    window.fishing.render();
  });

  await page.tap('#btn-quest');
  await page.waitForTimeout(450);
  const quest = await page.evaluate(() => ({
    level: document.getElementById('rank-level').textContent,
    cards: document.querySelectorAll('.ach-item').length,
    titles: document.querySelectorAll('.title-chip').length,
    over: document.documentElement.scrollWidth - window.innerWidth,
    tap: Math.round(document.querySelector('.title-chip')?.getBoundingClientRect().height ?? 0),
  }));
  if (!quest.level.startsWith('Lv.')) fail(`熟練度が出ていない: ${quest.level}`);
  if (quest.cards < 30) fail(`実績が出ていない（${quest.cards} 件）`);
  if (quest.titles < 1) fail('称号が出ていない');
  if (quest.tap < 36) fail(`称号のボタンが小さすぎる（${quest.tap}px）`);
  if (quest.over > 1) fail(`記録の画面が ${quest.over}px はみ出している`);
  await page.screenshot({ path: `${OUT}mobile-quest.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // 日誌を引き出すと、今日のお題が読める
  await page.tap('#btn-log');
  await page.waitForTimeout(450);
  const daily = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#daily-list .daily-item')];
    const panels = [...document.querySelectorAll('.sidebar .panel')];
    const name = (el, i) => el.querySelector('h2')?.textContent?.trim() ?? `panel ${i}`;
    let overlap = '';
    let squashed = '';
    for (let i = 0; i < panels.length; i++) {
      const box = panels[i].getBoundingClientRect();
      if (i > 0 && box.top < panels[i - 1].getBoundingClientRect().bottom - 1) overlap = name(panels[i], i);
      // 見出しだけになって中身が読めない状態も拾う
      if (box.height < 60) squashed = `${name(panels[i], i)}（${Math.round(box.height)}px）`;
    }
    return {
      rows: rows.length,
      overlap,
      squashed,
      over: document.documentElement.scrollWidth - window.innerWidth,
      right: Math.max(0, ...rows.map((r) => Math.round(r.getBoundingClientRect().right))),
      text: rows.map((r) => r.querySelector('.daily-label').textContent).join(' / '),
    };
  });
  if (daily.rows !== 3) fail(`お題が 3 つ出ていない（${daily.rows}）`);
  // パネルどうしが重なっていないこと（高さが足りないと重なって読めなくなる）
  if (daily.overlap) fail(`日誌の中で「${daily.overlap}」が重なっている`);
  if (daily.squashed) fail(`日誌の中で「${daily.squashed}」が潰れている`);
  if (daily.over > 1) fail(`日誌が ${daily.over}px はみ出している`);
  if (daily.right > width) fail(`お題が画面からはみ出している（右端 ${daily.right}px）`);
  await page.screenshot({ path: `${OUT}mobile-daily.png` });

  // 案内の吹き出しが、水面のタップを食べていないこと
  const coach = await page.evaluate(() => {
    const el = document.getElementById('coach');
    return { hidden: el.hidden, through: getComputedStyle(el).pointerEvents === 'none' };
  });
  if (!coach.hidden && !coach.through) fail('はじめての案内がタップをさえぎっている');

  // 音と振動の設定も、狭い幅でスイッチが押せること
  // 設定は日誌の下のほうにあるので、なぞって出せることも一緒に見る
  await tapInSheet(page, '#btn-settings', '音と振動の設定');
  await page.waitForTimeout(450);
  const settings = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.switch-row')];
    return {
      rows: rows.length,
      over: document.documentElement.scrollWidth - window.innerWidth,
      switches: [...document.querySelectorAll('.switch')].map((el) => {
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right) };
      }),
      note: document.getElementById('haptics-note').textContent,
    };
  });
  if (settings.rows !== 3) fail(`設定の項目が 3 つではない（${settings.rows}）`);
  if (settings.over > 1) fail(`設定の画面が ${settings.over}px はみ出している`);
  for (const sw of settings.switches) {
    if (sw.h < 28 || sw.w < 44) fail(`スイッチが小さすぎる（${sw.w}x${sw.h}px）`);
    if (sw.right > width) fail(`スイッチが画面からはみ出している（右端 ${sw.right}px）`);
  }
  await page.screenshot({ path: `${OUT}mobile-settings.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  console.log(`設定の画面: ${width}px でスイッチ ${settings.switches.length} 個が押せる／振動「${settings.note.slice(0, 20)}…」`);

  // バックアップの画面も狭い幅で読めること
  await tapInSheet(page, '#btn-backup', 'バックアップ');
  await page.waitForTimeout(450);
  const backup = await page.evaluate(() => {
    const out = document.getElementById('backup-out');
    return {
      hasText: out.value.includes('fishing-save'),
      over: document.documentElement.scrollWidth - window.innerWidth,
      right: Math.round(out.getBoundingClientRect().right),
      buttons: [...document.querySelectorAll('#dlg-backup button, #dlg-backup .file-btn')]
        .map((b) => Math.round(b.getBoundingClientRect().height)),
    };
  });
  if (!backup.hasText) fail('書き出しの中身が出ていない');
  if (backup.over > 1) fail(`バックアップの画面が ${backup.over}px はみ出している`);
  if (backup.right > width) fail(`書き出し欄が画面からはみ出している（右端 ${backup.right}px）`);
  const small = backup.buttons.filter((h) => h < 36);
  if (small.length) fail(`指で押すには小さいボタンがある（${small.join(', ')}px）`);
  await page.screenshot({ path: `${OUT}mobile-backup.png` });
  console.log(`バックアップの画面: ${width}px でボタン ${backup.buttons.length} 個が押せる大きさ`);

  await ctx.close();
  console.log(`記録の画面: ${width}px で実績 ${quest.cards} 件・称号 ${quest.titles} 個／お題「${daily.text}」`);
}

await checkWideMoney();
await checkHardSpotCard();
await checkQuestScreen();
await playOn('iphone', 'iPhone 13');
await playOn('iphone-landscape', 'iPhone 13 landscape');
await playOn('ipad', 'iPad (gen 7)');
await checkManifest();
await checkIosCss();
await checkLongPressReel();
await checkOffline();

await browser.close();
console.log('OK: スマホ・タブレットでの通し確認をすべて通過しました');
