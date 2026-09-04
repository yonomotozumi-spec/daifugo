/**
 * 武将の顔絵を SVG で自動生成する。
 * 名前から作った乱数と能力値で、顔立ち・ひげ・かぶり物・前立てが決まる。
 * 同じ武将はいつ描いても同じ顔になる。
 */

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** 名前ごとに固定の乱数列を返す */
function seeded(name) {
  let a = hash(name) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SKINS = ['#f2d3b3', '#e9c39d', '#dcae86', '#f5dcc4', '#c9946c'];
const HAIRS = ['#1d1a17', '#2b2420', '#3a2f28', '#6b6660'];

/**
 * @param {object} g   武将 { name, lead, valor, pol, lord, rank }
 * @param {string} color 家の色（在野は灰色）
 * @param {number} size  描く大きさ（px）
 */
export function portraitSVG(g, color = '#8d8f86', size = 64) {
  const r = seeded(g.name);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const skin = pick(SKINS);
  const hair = g.pol >= 80 && r() < 0.35 ? HAIRS[3] : pick(HAIRS.slice(0, 3));
  const faceW = 20 + Math.floor(r() * 6);      // 顔の横幅
  const faceH = 27 + Math.floor(r() * 5);      // 顔の縦
  const jaw = r();                              // あごの形
  const eyeStyle = Math.floor(r() * 3);
  const browAngle = (g.valor - 50) / 12 + (r() - 0.5) * 4; // 武勇が高いほどつり上がる
  const mouthStyle = r();
  const beard = g.valor >= 70 ? Math.floor(r() * 4) : Math.floor(r() * 3); // 0 なし 1 口ひげ 2 あごひげ 3 もじゃもじゃ
  const scar = g.valor >= 85 && r() < 0.5;
  let head; // 0 兜 1 烏帽子 2 月代 3 頭巾
  const hv = r();
  if (g.valor >= 75) head = hv < 0.6 ? 0 : hv < 0.9 ? 2 : 3;
  else if (g.pol >= 80) head = hv < 0.45 ? 1 : hv < 0.8 ? 2 : 3;
  else head = hv < 0.35 ? 0 : hv < 0.55 ? 1 : hv < 0.9 ? 2 : 3;
  const crest = Math.floor(r() * 5); // 前立て
  const armor = shade(color, -0.25);
  const cx = 50;
  const cy = 66;
  const out = [];

  // 背景
  out.push(`<defs><linearGradient id="pbg-${hash(g.name)}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(color, 0.25)}"/><stop offset="1" stop-color="${shade(color, -0.35)}"/></linearGradient></defs>`);
  out.push(`<rect width="100" height="120" fill="url(#pbg-${hash(g.name)})"/>`);
  if (g.lord) out.push('<rect x="2" y="2" width="96" height="116" fill="none" stroke="#f3d37a" stroke-width="3"/>');

  // 肩と鎧
  out.push(`<path d="M8 120 L18 100 Q50 84 82 100 L92 120 Z" fill="${armor}"/>`);
  out.push(`<path d="M30 120 L50 96 L70 120 Z" fill="${shade(color, 0.1)}"/>`);
  out.push(`<path d="M22 104 L50 92 L78 104" fill="none" stroke="#f3d37a" stroke-width="2" opacity="0.7"/>`);

  // 首
  out.push(`<rect x="${cx - 8}" y="${cy + faceH - 10}" width="16" height="16" fill="${shade(skin, -0.12)}"/>`);

  // 顔
  const faceTop = cy - faceH;
  if (jaw < 0.35) {
    // 角ばったあご
    out.push(`<path d="M${cx - faceW} ${cy - 6} Q${cx - faceW} ${faceTop} ${cx} ${faceTop} Q${cx + faceW} ${faceTop} ${cx + faceW} ${cy - 6} L${cx + faceW - 4} ${cy + faceH - 6} Q${cx} ${cy + faceH + 2} ${cx - faceW + 4} ${cy + faceH - 6} Z" fill="${skin}"/>`);
  } else {
    out.push(`<ellipse cx="${cx}" cy="${cy}" rx="${faceW}" ry="${faceH}" fill="${skin}"/>`);
  }
  // 耳
  out.push(`<ellipse cx="${cx - faceW - 1}" cy="${cy + 2}" rx="3.5" ry="5" fill="${shade(skin, -0.08)}"/>`);
  out.push(`<ellipse cx="${cx + faceW + 1}" cy="${cy + 2}" rx="3.5" ry="5" fill="${shade(skin, -0.08)}"/>`);

  // 髪（月代・頭巾以外は横だけ）
  if (head === 2) {
    out.push(`<path d="M${cx - faceW} ${cy - 4} Q${cx - faceW - 2} ${faceTop + 6} ${cx - 10} ${faceTop + 6} L${cx - 10} ${faceTop + 12} Q${cx - faceW + 6} ${faceTop + 16} ${cx - faceW + 2} ${cy - 2} Z" fill="${hair}"/>`);
    out.push(`<path d="M${cx + faceW} ${cy - 4} Q${cx + faceW + 2} ${faceTop + 6} ${cx + 10} ${faceTop + 6} L${cx + 10} ${faceTop + 12} Q${cx + faceW - 6} ${faceTop + 16} ${cx + faceW - 2} ${cy - 2} Z" fill="${hair}"/>`);
    // ちょんまげ
    out.push(`<path d="M${cx - 3} ${faceTop + 2} Q${cx} ${faceTop - 10} ${cx + 12} ${faceTop - 2}" fill="none" stroke="${hair}" stroke-width="5" stroke-linecap="round"/>`);
  } else if (head !== 3) {
    out.push(`<path d="M${cx - faceW} ${cy - 2} Q${cx - faceW} ${faceTop + 4} ${cx} ${faceTop + 2} Q${cx + faceW} ${faceTop + 4} ${cx + faceW} ${cy - 2} L${cx + faceW - 3} ${cy - 4} Q${cx} ${faceTop + 10} ${cx - faceW + 3} ${cy - 4} Z" fill="${hair}"/>`);
  }

  // 目・眉
  const ey = cy - 4;
  for (const sgn of [-1, 1]) {
    const ex = cx + sgn * (faceW * 0.45);
    if (eyeStyle === 0) {
      out.push(`<path d="M${ex - 5} ${ey} Q${ex} ${ey - 3} ${ex + 5} ${ey}" fill="none" stroke="#2a211b" stroke-width="2"/>`);
    } else if (eyeStyle === 1) {
      out.push(`<ellipse cx="${ex}" cy="${ey}" rx="4.5" ry="3" fill="#fff"/><circle cx="${ex + sgn * 0.5}" cy="${ey}" r="2" fill="#2a211b"/>`);
    } else {
      out.push(`<path d="M${ex - 5} ${ey - 1} L${ex + 5} ${ey + 1}" stroke="#2a211b" stroke-width="2.2" stroke-linecap="round"/>`);
    }
    const by = ey - 7;
    out.push(`<path d="M${ex - 6} ${by + sgn * browAngle * 0.5} L${ex + 6} ${by - sgn * browAngle * 0.5}" stroke="${hair}" stroke-width="${g.valor >= 70 ? 3.2 : 2.2}" stroke-linecap="round"/>`);
  }
  // 鼻
  out.push(`<path d="M${cx} ${cy - 2} L${cx - 3} ${cy + 8} L${cx + 2} ${cy + 8}" fill="none" stroke="${shade(skin, -0.3)}" stroke-width="1.6" stroke-linecap="round"/>`);
  // 口
  const my = cy + 15;
  if (mouthStyle < 0.4) out.push(`<path d="M${cx - 6} ${my} Q${cx} ${my + 3} ${cx + 6} ${my}" fill="none" stroke="#7a3b30" stroke-width="2"/>`);
  else if (mouthStyle < 0.75) out.push(`<path d="M${cx - 6} ${my} L${cx + 6} ${my}" stroke="#7a3b30" stroke-width="2" stroke-linecap="round"/>`);
  else out.push(`<path d="M${cx - 6} ${my + 1} Q${cx} ${my - 2} ${cx + 6} ${my + 1}" fill="none" stroke="#7a3b30" stroke-width="2"/>`);

  // ひげ
  if (beard === 1 || beard === 3) {
    out.push(`<path d="M${cx - 9} ${my - 4} Q${cx} ${my - 8} ${cx + 9} ${my - 4} Q${cx} ${my - 3} ${cx - 9} ${my - 4} Z" fill="${hair}"/>`);
  }
  if (beard === 2) {
    out.push(`<path d="M${cx - 5} ${my + 5} Q${cx} ${my + 16} ${cx + 5} ${my + 5} Z" fill="${hair}"/>`);
  }
  if (beard === 3) {
    out.push(`<path d="M${cx - faceW + 4} ${cy + 4} Q${cx - faceW + 2} ${cy + faceH + 2} ${cx} ${cy + faceH + 4} Q${cx + faceW - 2} ${cy + faceH + 2} ${cx + faceW - 4} ${cy + 4} Q${cx + faceW - 8} ${cy + faceH - 6} ${cx} ${my + 4} Q${cx - faceW + 8} ${cy + faceH - 6} ${cx - faceW + 4} ${cy + 4} Z" fill="${hair}"/>`);
  }
  // 傷
  if (scar) out.push(`<path d="M${cx + faceW * 0.5} ${cy - 14} L${cx + faceW * 0.3} ${cy + 2}" stroke="#b0605a" stroke-width="1.6"/>`);

  // かぶり物
  if (head === 0) {
    // 兜
    const iron = pick(['#3b3a3f', '#4a3f35', '#2f2f36', '#5a3a2e']);
    out.push(`<path d="M${cx - faceW - 6} ${faceTop + 10} Q${cx - faceW - 2} ${faceTop - 14} ${cx} ${faceTop - 14} Q${cx + faceW + 2} ${faceTop - 14} ${cx + faceW + 6} ${faceTop + 10} Q${cx} ${faceTop + 2} ${cx - faceW - 6} ${faceTop + 10} Z" fill="${iron}"/>`);
    // 吹返し
    out.push(`<path d="M${cx - faceW - 8} ${faceTop + 8} L${cx - faceW - 12} ${faceTop + 20} L${cx - faceW + 2} ${faceTop + 16} Z" fill="${iron}"/>`);
    out.push(`<path d="M${cx + faceW + 8} ${faceTop + 8} L${cx + faceW + 12} ${faceTop + 20} L${cx + faceW - 2} ${faceTop + 16} Z" fill="${iron}"/>`);
    out.push(`<path d="M${cx - faceW - 4} ${faceTop + 8} Q${cx} ${faceTop + 1} ${cx + faceW + 4} ${faceTop + 8}" fill="none" stroke="#f3d37a" stroke-width="1.5"/>`);
    // 前立て
    const gold = '#f3d37a';
    const ty = faceTop - 12;
    if (crest === 0) out.push(`<path d="M${cx - 14} ${ty - 2} A14 14 0 0 1 ${cx + 14} ${ty - 2} A10 10 0 0 0 ${cx - 14} ${ty - 2} Z" fill="${gold}"/>`);           // 三日月
    else if (crest === 1) out.push(`<circle cx="${cx}" cy="${ty - 4}" r="7" fill="${gold}"/>`);                                                                   // 日輪
    else if (crest === 2) out.push(`<path d="M${cx - 4} ${ty + 4} L${cx - 14} ${ty - 16} L${cx - 6} ${ty - 2} Z M${cx + 4} ${ty + 4} L${cx + 14} ${ty - 16} L${cx + 6} ${ty - 2} Z" fill="${gold}"/>`); // 鍬形
    else if (crest === 3) out.push(`<path d="M${cx - 6} ${ty + 4} Q${cx - 22} ${ty - 6} ${cx - 16} ${ty - 18} Q${cx - 12} ${ty - 2} ${cx - 4} ${ty + 2} Z M${cx + 6} ${ty + 4} Q${cx + 22} ${ty - 6} ${cx + 16} ${ty - 18} Q${cx + 12} ${ty - 2} ${cx + 4} ${ty + 2} Z" fill="#3b3a3f" stroke="${gold}" stroke-width="1"/>`); // 水牛の角
    else out.push(`<path d="M${cx} ${ty - 18} L${cx + 4} ${ty + 2} L${cx - 4} ${ty + 2} Z" fill="${gold}"/>`);                                                    // 剣
  } else if (head === 1) {
    // 烏帽子
    out.push(`<path d="M${cx - faceW + 4} ${faceTop + 8} L${cx - 8} ${faceTop - 20} Q${cx + 4} ${faceTop - 26} ${cx + 10} ${faceTop - 18} L${cx + faceW - 2} ${faceTop + 8} Q${cx} ${faceTop} ${cx - faceW + 4} ${faceTop + 8} Z" fill="#1c1a1a"/>`);
    out.push(`<path d="M${cx - faceW + 2} ${faceTop + 9} Q${cx} ${faceTop + 2} ${cx + faceW} ${faceTop + 9}" fill="none" stroke="#f3d37a" stroke-width="1.2" opacity="0.6"/>`);
  } else if (head === 3) {
    // 頭巾
    const cloth = pick(['#e9e2d2', '#3b3b46', '#5d4a3c']);
    out.push(`<path d="M${cx - faceW - 6} ${cy + 8} Q${cx - faceW - 6} ${faceTop - 8} ${cx} ${faceTop - 10} Q${cx + faceW + 6} ${faceTop - 8} ${cx + faceW + 6} ${cy + 8} L${cx + faceW - 2} ${cy + 6} Q${cx + faceW - 2} ${faceTop + 4} ${cx} ${faceTop + 2} Q${cx - faceW + 2} ${faceTop + 4} ${cx - faceW + 2} ${cy + 6} Z" fill="${cloth}"/>`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 120" width="${size}" height="${Math.round(size * 1.2)}" class="portrait" role="img" aria-label="${g.name}">${out.join('')}</svg>`;
}

/** 色を明るく（amount > 0）または暗く（amount < 0）する */
function shade(hex, amount) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = (v) => {
    const c = amount >= 0 ? v + (255 - v) * amount : v * (1 + amount);
    return Math.max(0, Math.min(255, Math.round(c)));
  };
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
