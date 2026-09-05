/**
 * 武将の顔絵を SVG で自動生成する（劇画ふうの塗り）。
 * 名前から作った乱数と能力値で、顔立ち・目・ひげ・かぶり物・前立て・年齢が決まる。
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

const SKINS = ['#f1cfae', '#e8bf98', '#d9a97e', '#f3d7bd', '#c8916a', '#e5b58c'];
const HAIRS = ['#181512', '#241d18', '#33271f', '#3d2e24'];

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

/**
 * @param {object} g   武将 { name, lead, valor, pol, lord, rank, appear }
 * @param {string} color 家の色（在野は灰色）
 * @param {number} size  描く大きさ（px）
 */
export function portraitSVG(g, color = '#8d8f86', size = 64) {
  const r = seeded(g.name);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const id = `p${hash(g.name).toString(36)}`;
  const skin = pick(SKINS);
  const age = g.appear ? 0 : (g.lord || g.rank >= 3 ? 0.4 : 0) + r() * 0.6; // 0 若い … 1 老いている
  const hair = age > 0.75 ? '#8d8a85' : age > 0.55 ? '#5a534c' : pick(HAIRS);
  const faceW = 21 + Math.floor(r() * 6);
  const faceH = 28 + Math.floor(r() * 5);
  const jaw = r();
  const eyeStyle = Math.floor(r() * 3);
  const browAngle = (g.valor - 50) / 10 + (r() - 0.5) * 5;
  const browThick = 2.2 + (g.valor >= 70 ? 1.6 : 0) + r() * 1.2;
  const mouthStyle = r();
  const beard = g.valor >= 70 ? Math.floor(r() * 4) : Math.floor(r() * 3);
  const scar = g.valor >= 85 && r() < 0.5;
  let head;
  const hv = r();
  if (g.valor >= 75) head = hv < 0.62 ? 0 : hv < 0.9 ? 2 : 3;
  else if (g.pol >= 80) head = hv < 0.45 ? 1 : hv < 0.8 ? 2 : 3;
  else head = hv < 0.35 ? 0 : hv < 0.55 ? 1 : hv < 0.9 ? 2 : 3;
  const crest = Math.floor(r() * 5);
  const iron = pick(['#3a3a40', '#4a3d33', '#2e2e35', '#5a3a2d', '#1f2430']);
  const cx = 50;
  const cy = 64;
  const top = cy - faceH;
  const o = [];

  // --- 定義（グラデーション）
  o.push(`<defs>
    <linearGradient id="${id}-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(color, 0.3)}"/><stop offset="1" stop-color="${shade(color, -0.45)}"/></linearGradient>
    <radialGradient id="${id}-vig" cx="0.5" cy="0.45" r="0.7"><stop offset="0.55" stop-color="rgba(0,0,0,0)"/><stop offset="1" stop-color="rgba(0,0,0,0.45)"/></radialGradient>
    <radialGradient id="${id}-skin" cx="0.42" cy="0.35" r="0.8"><stop offset="0" stop-color="${shade(skin, 0.12)}"/><stop offset="0.7" stop-color="${skin}"/><stop offset="1" stop-color="${shade(skin, -0.28)}"/></radialGradient>
    <linearGradient id="${id}-iron" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${shade(iron, 0.35)}"/><stop offset="0.5" stop-color="${iron}"/><stop offset="1" stop-color="${shade(iron, -0.4)}"/></linearGradient>
    <linearGradient id="${id}-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff0b0"/><stop offset="0.5" stop-color="#e2b84d"/><stop offset="1" stop-color="#9a6f1e"/></linearGradient>
    <radialGradient id="${id}-iris" cx="0.4" cy="0.4" r="0.6"><stop offset="0" stop-color="#5a3d2b"/><stop offset="1" stop-color="#1d120c"/></radialGradient>
    <linearGradient id="${id}-cloth" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${shade(color, -0.1)}"/><stop offset="1" stop-color="${shade(color, -0.5)}"/></linearGradient>
  </defs>`);

  // --- 背景
  o.push(`<rect width="100" height="120" fill="url(#${id}-bg)"/>`);
  o.push(`<rect width="100" height="120" fill="url(#${id}-vig)"/>`);
  if (g.lord) o.push('<rect x="2" y="2" width="96" height="116" fill="none" stroke="#f3d37a" stroke-width="2.5"/>');

  // --- 肩・鎧・襟
  o.push(`<path d="M4 120 L14 98 Q30 88 42 90 L50 100 L58 90 Q70 88 86 98 L96 120 Z" fill="url(#${id}-cloth)"/>`);
  o.push(`<path d="M14 98 Q30 88 42 90 L46 100 L30 106 Z M86 98 Q70 88 58 90 L54 100 L70 106 Z" fill="${shade(color, -0.65)}" opacity="0.5"/>`);
  // 襟（白い襦袢と、暗い小袖の合わせ）
  o.push(`<path d="M30 120 L50 92 L70 120 Z" fill="#efe6d3"/>`);
  o.push(`<path d="M36 120 L50 99 L64 120 Z" fill="${shade(color, -0.7)}"/>`);
  o.push(`<path d="M30 120 L50 92 M70 120 L50 92" fill="none" stroke="rgba(0,0,0,0.35)" stroke-width="1"/>`);
  for (let i = 0; i < 3; i++) {
    o.push(`<path d="M${18 + i * 4} ${100 + i * 5} Q50 ${90 + i * 5} ${82 - i * 4} ${100 + i * 5}" fill="none" stroke="rgba(0,0,0,0.35)" stroke-width="1.2"/>`);
  }
  o.push(`<path d="M24 104 L50 92 L76 104" fill="none" stroke="url(#${id}-gold)" stroke-width="2" opacity="0.8"/>`);

  // --- 首
  o.push(`<path d="M${cx - 9} ${cy + faceH - 12} Q${cx} ${cy + faceH - 8} ${cx + 9} ${cy + faceH - 12} L${cx + 9} ${cy + faceH + 6} L${cx - 9} ${cy + faceH + 6} Z" fill="${shade(skin, -0.22)}"/>`);

  // --- 顔
  const face = jaw < 0.35
    ? `M${cx - faceW} ${cy - 8} Q${cx - faceW} ${top} ${cx} ${top} Q${cx + faceW} ${top} ${cx + faceW} ${cy - 8} L${cx + faceW - 3} ${cy + faceH - 8} Q${cx} ${cy + faceH + 3} ${cx - faceW + 3} ${cy + faceH - 8} Z`
    : jaw < 0.7
      ? `M${cx - faceW} ${cy - 6} Q${cx - faceW} ${top} ${cx} ${top} Q${cx + faceW} ${top} ${cx + faceW} ${cy - 6} Q${cx + faceW - 2} ${cy + faceH - 6} ${cx} ${cy + faceH} Q${cx - faceW + 2} ${cy + faceH - 6} ${cx - faceW} ${cy - 6} Z`
      : `M${cx - faceW + 1} ${cy - 4} Q${cx - faceW - 1} ${top} ${cx} ${top} Q${cx + faceW + 1} ${top} ${cx + faceW - 1} ${cy - 4} Q${cx + faceW - 6} ${cy + faceH - 2} ${cx} ${cy + faceH + 1} Q${cx - faceW + 6} ${cy + faceH - 2} ${cx - faceW + 1} ${cy - 4} Z`;
  o.push(`<path d="${face}" fill="url(#${id}-skin)"/>`);
  // 顔の陰（片側と輪郭）
  o.push(`<path d="${face}" fill="none" stroke="${shade(skin, -0.45)}" stroke-width="1.2" opacity="0.7"/>`);
  o.push(`<path d="M${cx + faceW - 6} ${cy - 10} Q${cx + faceW - 2} ${cy + 8} ${cx + 6} ${cy + faceH - 2}" fill="none" stroke="${shade(skin, -0.3)}" stroke-width="5" opacity="0.28" stroke-linecap="round"/>`);
  // 頬骨・こけ
  o.push(`<path d="M${cx - faceW + 6} ${cy + 6} Q${cx - faceW + 9} ${cy + 16} ${cx - 8} ${cy + 22}" fill="none" stroke="${shade(skin, -0.3)}" stroke-width="3" opacity="${0.15 + age * 0.3}" stroke-linecap="round"/>`);
  o.push(`<path d="M${cx + faceW - 6} ${cy + 6} Q${cx + faceW - 9} ${cy + 16} ${cx + 8} ${cy + 22}" fill="none" stroke="${shade(skin, -0.3)}" stroke-width="3" opacity="${0.15 + age * 0.3}" stroke-linecap="round"/>`);
  // 耳
  for (const sgn of [-1, 1]) {
    const ex = cx + sgn * (faceW + 1);
    o.push(`<ellipse cx="${ex}" cy="${cy + 1}" rx="3.6" ry="6" fill="${shade(skin, -0.1)}" stroke="${shade(skin, -0.4)}" stroke-width="0.8"/>`);
    o.push(`<path d="M${ex - sgn * 1} ${cy - 2} Q${ex + sgn * 1.5} ${cy} ${ex - sgn * 0.5} ${cy + 3}" fill="none" stroke="${shade(skin, -0.4)}" stroke-width="0.8"/>`);
  }

  // --- 髪
  if (head === 2) {
    // 月代（頭の上を剃り、横に髪、後ろで髷）
    o.push(`<path d="M${cx - faceW} ${cy - 2} Q${cx - faceW - 3} ${top + 4} ${cx - 12} ${top + 4} L${cx - 12} ${top + 11} Q${cx - faceW + 5} ${top + 15} ${cx - faceW + 1} ${cy - 1} Z" fill="${hair}"/>`);
    o.push(`<path d="M${cx + faceW} ${cy - 2} Q${cx + faceW + 3} ${top + 4} ${cx + 12} ${top + 4} L${cx + 12} ${top + 11} Q${cx + faceW - 5} ${top + 15} ${cx + faceW - 1} ${cy - 1} Z" fill="${hair}"/>`);
    o.push(`<path d="M${cx - 6} ${top + 1} Q${cx} ${top - 12} ${cx + 14} ${top - 3}" fill="none" stroke="${hair}" stroke-width="6" stroke-linecap="round"/>`);
    o.push(`<path d="M${cx - 5} ${top + 1} Q${cx} ${top - 9} ${cx + 12} ${top - 3}" fill="none" stroke="${shade(hair, 0.35)}" stroke-width="1.5" stroke-linecap="round"/>`);
    // 剃った跡
    o.push(`<path d="M${cx - 11} ${top + 6} Q${cx} ${top + 1} ${cx + 11} ${top + 6}" fill="none" stroke="${shade(skin, -0.22)}" stroke-width="3" opacity="0.5"/>`);
  } else if (head !== 3) {
    o.push(`<path d="M${cx - faceW} ${cy - 2} Q${cx - faceW - 1} ${top + 2} ${cx} ${top} Q${cx + faceW + 1} ${top + 2} ${cx + faceW} ${cy - 2} L${cx + faceW - 3} ${cy - 5} Q${cx} ${top + 12} ${cx - faceW + 3} ${cy - 5} Z" fill="${hair}"/>`);
    // 生えぎわの毛
    for (let i = 0; i < 6; i++) {
      const hx = cx - faceW + 6 + i * ((faceW * 2 - 12) / 5);
      o.push(`<path d="M${hx} ${top + 8} q${(i % 2 ? 1 : -1) * 2} 5 0 9" fill="none" stroke="${hair}" stroke-width="1.6" stroke-linecap="round" opacity="0.8"/>`);
    }
  }

  // --- 目・眉
  const ey = cy - 3;
  for (const sgn of [-1, 1]) {
    const ex = cx + sgn * faceW * 0.46;
    // 目のくぼみ
    o.push(`<ellipse cx="${ex}" cy="${ey}" rx="8" ry="5" fill="${shade(skin, -0.35)}" opacity="0.28"/>`);
    if (eyeStyle === 2) {
      // 細い目
      o.push(`<path d="M${ex - 6} ${ey + 0.5} Q${ex} ${ey - 2.5} ${ex + 6} ${ey + 0.5} Q${ex} ${ey + 2.5} ${ex - 6} ${ey + 0.5} Z" fill="#fff5ec"/>`);
      o.push(`<circle cx="${ex + sgn * 0.5}" cy="${ey}" r="1.7" fill="url(#${id}-iris)"/>`);
      o.push(`<path d="M${ex - 6.5} ${ey + 0.5} Q${ex} ${ey - 3.5} ${ex + 6.5} ${ey + 0.5}" fill="none" stroke="#1a120d" stroke-width="2" stroke-linecap="round"/>`);
    } else {
      const ry = eyeStyle === 1 ? 3.6 : 2.8;
      o.push(`<path d="M${ex - 6.5} ${ey + 1} Q${ex} ${ey - ry - 2} ${ex + 6.5} ${ey + 1} Q${ex} ${ey + ry} ${ex - 6.5} ${ey + 1} Z" fill="#fbf4ea"/>`);
      o.push(`<circle cx="${ex + sgn * 0.6}" cy="${ey + 0.2}" r="${eyeStyle === 1 ? 3 : 2.5}" fill="url(#${id}-iris)"/>`);
      o.push(`<circle cx="${ex + sgn * 0.6}" cy="${ey + 0.2}" r="1.2" fill="#0b0705"/>`);
      o.push(`<circle cx="${ex + sgn * 0.6 - 1}" cy="${ey - 1}" r="0.8" fill="#fff" opacity="0.9"/>`);
      // 上まぶた・目尻
      o.push(`<path d="M${ex - 7} ${ey + 1} Q${ex} ${ey - ry - 3} ${ex + 7} ${ey + 0.5}" fill="none" stroke="#1a120d" stroke-width="2.2" stroke-linecap="round"/>`);
      o.push(`<path d="M${ex - 6} ${ey + 2.5} Q${ex} ${ey + ry + 0.5} ${ex + 6} ${ey + 2}" fill="none" stroke="${shade(skin, -0.45)}" stroke-width="0.9" opacity="0.7"/>`);
    }
    // 眉（形のある塗り）
    const by = ey - 8;
    const inner = by + sgn * browAngle * 0.35;
    const outer = by - sgn * browAngle * 0.35;
    o.push(`<path d="M${ex - 8} ${sgn < 0 ? outer : inner} Q${ex} ${by - 3} ${ex + 8} ${sgn < 0 ? inner : outer} Q${ex} ${by - 3 + browThick} ${ex - 8} ${(sgn < 0 ? outer : inner) + browThick * 0.6} Z" fill="${hair}"/>`);
    // 目尻のしわ
    if (age > 0.45) o.push(`<path d="M${ex + sgn * 8} ${ey} l${sgn * 3} -2 M${ex + sgn * 8} ${ey + 2} l${sgn * 3} 1" fill="none" stroke="${shade(skin, -0.45)}" stroke-width="0.8" opacity="0.7"/>`);
  }
  // 眉間のしわ
  if (g.valor >= 80 || age > 0.6) o.push(`<path d="M${cx - 2} ${ey - 9} l-1 5 M${cx + 2} ${ey - 9} l1 5" fill="none" stroke="${shade(skin, -0.45)}" stroke-width="0.9" opacity="0.6"/>`);

  // --- 鼻
  o.push(`<path d="M${cx + 1} ${cy - 4} Q${cx + 4} ${cy + 6} ${cx + 3} ${cy + 9} Q${cx} ${cy + 11} ${cx - 4} ${cy + 9}" fill="none" stroke="${shade(skin, -0.35)}" stroke-width="1.5" stroke-linecap="round"/>`);
  o.push(`<path d="M${cx - 5} ${cy + 9} q2 1 4 0 M${cx + 1} ${cy + 9} q2 1 4 -1" fill="none" stroke="${shade(skin, -0.5)}" stroke-width="1" stroke-linecap="round"/>`);
  o.push(`<path d="M${cx - 1} ${cy - 2} Q${cx - 3} ${cy + 4} ${cx - 3} ${cy + 7}" fill="none" stroke="${shade(skin, 0.25)}" stroke-width="1.5" opacity="0.6" stroke-linecap="round"/>`);
  // ほうれい線
  o.push(`<path d="M${cx - 6} ${cy + 10} Q${cx - 10} ${cy + 18} ${cx - 8} ${cy + 22} M${cx + 6} ${cy + 10} Q${cx + 10} ${cy + 18} ${cx + 8} ${cy + 22}" fill="none" stroke="${shade(skin, -0.4)}" stroke-width="1" opacity="${0.25 + age * 0.5}"/>`);

  // --- 口
  const my = cy + 17;
  const lip = '#8a4a3c';
  if (mouthStyle < 0.4) {
    o.push(`<path d="M${cx - 7} ${my} Q${cx} ${my + 4} ${cx + 7} ${my}" fill="none" stroke="${lip}" stroke-width="1.8" stroke-linecap="round"/>`);
  } else if (mouthStyle < 0.75) {
    o.push(`<path d="M${cx - 7} ${my} L${cx + 7} ${my}" stroke="${lip}" stroke-width="1.8" stroke-linecap="round"/>`);
  } else {
    o.push(`<path d="M${cx - 7} ${my + 1} Q${cx} ${my - 2.5} ${cx + 7} ${my + 1}" fill="none" stroke="${lip}" stroke-width="1.8" stroke-linecap="round"/>`);
  }
  o.push(`<path d="M${cx - 6} ${my + 2.5} Q${cx} ${my + 5} ${cx + 6} ${my + 2.5}" fill="none" stroke="${shade(skin, -0.25)}" stroke-width="1.2" opacity="0.6"/>`);
  o.push(`<path d="M${cx - 6} ${my - 1.5} Q${cx} ${my - 3.5} ${cx + 6} ${my - 1.5}" fill="none" stroke="${shade(skin, 0.2)}" stroke-width="1" opacity="0.6"/>`);

  // --- ひげ（線を重ねて毛らしく）
  const strands = (path, n, w) => {
    for (let i = 0; i < n; i++) o.push(`<path d="${path(i)}" fill="none" stroke="${i % 3 === 0 ? shade(hair, 0.25) : hair}" stroke-width="${w}" stroke-linecap="round" opacity="0.9"/>`);
  };
  if (beard === 1 || beard === 3) {
    o.push(`<path d="M${cx - 10} ${my - 5} Q${cx} ${my - 10} ${cx + 10} ${my - 5} Q${cx} ${my - 3} ${cx - 10} ${my - 5} Z" fill="${hair}"/>`);
    strands((i) => `M${cx - 9 + i * 2} ${my - 6} q${i < 5 ? -1 : 1} 3 ${i < 5 ? -2 : 2} 5`, 10, 1);
  }
  if (beard === 2) {
    o.push(`<path d="M${cx - 5} ${my + 5} Q${cx} ${my + 18} ${cx + 5} ${my + 5} Z" fill="${hair}"/>`);
    strands((i) => `M${cx - 4 + i * 1.6} ${my + 5} q${(i - 2.5) * 0.6} 6 ${(i - 2.5) * 0.9} 11`, 6, 1);
  }
  if (beard === 3) {
    o.push(`<path d="M${cx - faceW + 4} ${cy + 6} Q${cx - faceW + 2} ${cy + faceH + 4} ${cx} ${cy + faceH + 6} Q${cx + faceW - 2} ${cy + faceH + 4} ${cx + faceW - 4} ${cy + 6} Q${cx + faceW - 8} ${cy + faceH - 6} ${cx} ${my + 4} Q${cx - faceW + 8} ${cy + faceH - 6} ${cx - faceW + 4} ${cy + 6} Z" fill="${hair}"/>`);
    strands((i) => `M${cx - faceW + 6 + i * ((faceW * 2 - 12) / 11)} ${cy + faceH - 8} q${(i - 5.5) * 0.4} 6 ${(i - 5.5) * 0.7} 10`, 12, 1.1);
  }
  // --- 傷
  if (scar) {
    o.push(`<path d="M${cx + faceW * 0.55} ${cy - 16} L${cx + faceW * 0.3} ${cy + 4}" stroke="#a45a52" stroke-width="1.8" stroke-linecap="round"/>`);
    o.push(`<path d="M${cx + faceW * 0.5} ${cy - 10} l3 1 M${cx + faceW * 0.44} ${cy - 5} l3 1 M${cx + faceW * 0.38} ${cy} l3 1" stroke="#a45a52" stroke-width="1" stroke-linecap="round"/>`);
  }

  // --- かぶり物
  if (head === 0) {
    // 兜：鉢・眉庇・吹返し・錣（しころ）
    o.push(`<path d="M${cx - faceW - 5} ${top + 9} Q${cx - faceW - 1} ${top - 15} ${cx} ${top - 15} Q${cx + faceW + 1} ${top - 15} ${cx + faceW + 5} ${top + 9} Q${cx} ${top + 1} ${cx - faceW - 5} ${top + 9} Z" fill="url(#${id}-iron)"/>`);
    for (let i = 1; i <= 4; i++) {
      const t = i / 5;
      o.push(`<path d="M${cx - faceW * (1 - t) * 0.9 - (1 - t) * 2} ${top - 14 + t * 22} Q${cx} ${top - 15 + t * 12} ${cx + faceW * (1 - t) * 0.9 + (1 - t) * 2} ${top - 14 + t * 22}" fill="none" stroke="rgba(0,0,0,0.3)" stroke-width="0.8"/>`);
    }
    o.push(`<path d="M${cx - faceW - 5} ${top + 9} Q${cx} ${top + 1} ${cx + faceW + 5} ${top + 9} L${cx + faceW + 4} ${top + 12} Q${cx} ${top + 5} ${cx - faceW - 4} ${top + 12} Z" fill="url(#${id}-gold)"/>`);
    for (const sgn of [-1, 1]) {
      const bx = cx + sgn * (faceW + 6);
      o.push(`<path d="M${bx} ${top + 8} L${bx + sgn * 7} ${top + 22} L${bx - sgn * 5} ${top + 18} Z" fill="url(#${id}-iron)"/>`);
      o.push(`<path d="M${bx + sgn * 2} ${top + 20} L${bx + sgn * 6} ${cy - 2} L${bx - sgn * 4} ${cy + 2} Z" fill="${shade(iron, -0.15)}"/>`);
      o.push(`<path d="M${bx + sgn * 1} ${top + 22} L${bx + sgn * 5} ${cy + 8} L${bx - sgn * 5} ${cy + 10} Z" fill="${shade(iron, -0.3)}"/>`);
    }
    const gold = `url(#${id}-gold)`;
    const ty = top - 13;
    if (crest === 0) o.push(`<path d="M${cx - 16} ${ty - 2} A16 16 0 0 1 ${cx + 16} ${ty - 2} A11 11 0 0 0 ${cx - 16} ${ty - 2} Z" fill="${gold}" stroke="#7a5a1a" stroke-width="0.6"/>`);
    else if (crest === 1) o.push(`<circle cx="${cx}" cy="${ty - 5}" r="8" fill="${gold}" stroke="#7a5a1a" stroke-width="0.6"/>`);
    else if (crest === 2) o.push(`<path d="M${cx - 3} ${ty + 4} L${cx - 16} ${ty - 18} L${cx - 6} ${ty - 2} Z M${cx + 3} ${ty + 4} L${cx + 16} ${ty - 18} L${cx + 6} ${ty - 2} Z" fill="${gold}" stroke="#7a5a1a" stroke-width="0.6"/>`);
    else if (crest === 3) o.push(`<path d="M${cx - 6} ${ty + 4} Q${cx - 24} ${ty - 6} ${cx - 18} ${ty - 20} Q${cx - 13} ${ty - 2} ${cx - 4} ${ty + 2} Z M${cx + 6} ${ty + 4} Q${cx + 24} ${ty - 6} ${cx + 18} ${ty - 20} Q${cx + 13} ${ty - 2} ${cx + 4} ${ty + 2} Z" fill="url(#${id}-iron)" stroke="#f3d37a" stroke-width="1"/>`);
    else o.push(`<path d="M${cx} ${ty - 20} L${cx + 4} ${ty + 2} L${cx - 4} ${ty + 2} Z" fill="${gold}" stroke="#7a5a1a" stroke-width="0.6"/>`);
  } else if (head === 1) {
    // 烏帽子
    o.push(`<path d="M${cx - faceW + 3} ${top + 8} L${cx - 9} ${top - 22} Q${cx + 4} ${top - 28} ${cx + 11} ${top - 19} L${cx + faceW - 1} ${top + 8} Q${cx} ${top} ${cx - faceW + 3} ${top + 8} Z" fill="#171515"/>`);
    o.push(`<path d="M${cx - 6} ${top - 18} Q${cx + 2} ${top - 24} ${cx + 8} ${top - 17}" fill="none" stroke="#3a3535" stroke-width="1.5"/>`);
    o.push(`<path d="M${cx - faceW + 1} ${top + 9} Q${cx} ${top + 2} ${cx + faceW} ${top + 9}" fill="none" stroke="url(#${id}-gold)" stroke-width="1.4" opacity="0.8"/>`);
    o.push(`<path d="M${cx + faceW - 2} ${top + 9} q4 6 3 18" fill="none" stroke="#e9e2d2" stroke-width="1.2"/>`);
  } else if (head === 3) {
    // 頭巾
    const cloth = pick(['#ece5d4', '#3d3d4a', '#5d4a3c', '#7a2e2e']);
    o.push(`<path d="M${cx - faceW - 6} ${cy + 10} Q${cx - faceW - 7} ${top - 9} ${cx} ${top - 11} Q${cx + faceW + 7} ${top - 9} ${cx + faceW + 6} ${cy + 10} L${cx + faceW - 2} ${cy + 8} Q${cx + faceW - 2} ${top + 4} ${cx} ${top + 2} Q${cx - faceW + 2} ${top + 4} ${cx - faceW + 2} ${cy + 8} Z" fill="${cloth}"/>`);
    o.push(`<path d="M${cx - faceW - 6} ${cy + 10} Q${cx - faceW - 7} ${top - 9} ${cx} ${top - 11} Q${cx + faceW + 7} ${top - 9} ${cx + faceW + 6} ${cy + 10}" fill="none" stroke="${shade(cloth, -0.4)}" stroke-width="1.2"/>`);
    o.push(`<path d="M${cx - faceW + 2} ${top + 6} Q${cx} ${top - 2} ${cx + faceW - 2} ${top + 6}" fill="none" stroke="${shade(cloth, -0.3)}" stroke-width="2" opacity="0.6"/>`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 120" width="${size}" height="${Math.round(size * 1.2)}" class="portrait" role="img" aria-label="${g.name}">${o.join('')}</svg>`;
}
