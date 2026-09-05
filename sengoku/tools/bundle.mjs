/**
 * ゲームを 1 つの HTML ファイルにまとめる（サーバーなしで開ける・公開ページに貼れる形）。
 *
 *   node sengoku/tools/bundle.mjs [出力先.html] [--fragment]
 *
 * ES Modules を 1 つの <script type="module"> に畳み込む。各ファイルを即時関数で包み、
 * import は上の関数の戻り値から取り出す形に書き換える（このゲームの書き方に合わせた簡易版）。
 * --fragment を付けると <html>/<head>/<body> を付けずに中身だけ出す（公開ページ用）。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : join(root, 'dist', 'sengoku.html');
const fragment = process.argv.includes('--fragment');

// 依存の順（先に定義されるものが上）
const ORDER = ['generals', 'mapdata', 'data', 'land', 'engine', 'ai', 'portrait', 'map', 'ui'];
const exportsOf = {};

function transform(name, src) {
  const names = new Set();
  let body = src;
  // export * from './x.js'
  const stars = [];
  body = body.replace(/^export \* from '\.\/(\w+)\.js';\s*$/gm, (_, m) => { stars.push(m); return ''; });
  // export { A, B }  （再エクスポート）
  body = body.replace(/^export \{([^}]+)\};\s*$/gm, (_, list) => {
    list.split(',').map((s) => s.trim()).filter(Boolean).forEach((n) => names.add(n));
    return '';
  });
  // export const / function / let
  body = body.replace(/^export (const|function|let) (\w+)/gm, (_, kw, n) => { names.add(n); return `${kw} ${n}`; });
  // import { A, B as C } from './x.js'  /  import * as E from './x.js'
  const heads = [];
  body = body.replace(/^import \* as (\w+) from '\.\/(\w+)\.js';\s*$/gm, (_, alias, m) => { heads.push(`const ${alias} = M_${m};`); return ''; });
  body = body.replace(/^import \{([^}]+)\} from '\.\/(\w+)\.js';\s*$/gm, (_, list, m) => {
    const items = list.split(',').map((s) => s.trim()).filter(Boolean).map((s) => s.replace(/\s+as\s+/, ': '));
    heads.push(`const { ${items.join(', ')} } = M_${m};`);
    return '';
  });
  if (/^import /m.test(body)) throw new Error(`${name}.js に変換できない import がある`);
  const ret = [...stars.map((m) => `...M_${m}`), ...names].join(', ');
  exportsOf[name] = names;
  return `const M_${name} = (() => {\n${heads.join('\n')}\n${body}\nreturn { ${ret} };\n})();\n`;
}

const js = ORDER.map((n) => transform(n, readFileSync(join(root, 'src', `${n}.js`), 'utf8'))).join('\n');
const css = readFileSync(join(root, 'src', 'style.css'), 'utf8');
const html = readFileSync(join(root, 'index.html'), 'utf8');

const title = /<title>([^<]*)<\/title>/.exec(html)[1];
let bodyHtml = /<body>([\s\S]*)<\/body>/.exec(html)[1]
  .replace(/<script type="module" src="src\/ui\.js"><\/script>/, '')
  .replace(/\s*<a class="topbar-link"[^>]*>[^<]*<\/a>/g, ''); // ほかのゲームへのリンクは 1 ファイル版では外す

const fonts = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700;800&family=Shippori+Mincho:wght@700;800&display=swap">';
const extraCss = `
body { font-family: "Noto Sans JP", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", system-ui, sans-serif; }
.topbar h1, dialog h2, .phase-box h2, .pp-head h2 { font-family: "Shippori Mincho", "Hiragino Mincho ProN", "Yu Mincho", serif; }
`;

const inner = `<title>${title}</title>
${fonts}
<style>
${css}
${extraCss}</style>
${bodyHtml}
<script type="module">
${js}
</script>
`;
const page = fragment ? inner : `<!DOCTYPE html>\n<html lang="ja">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n</head>\n<body>\n${inner}</body>\n</html>\n`;
writeFileSync(out, page);
console.log(`${out} に書き出した（${Math.round(page.length / 1024)} KB）`);
