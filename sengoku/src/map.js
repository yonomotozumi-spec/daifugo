/**
 * 日本地図の描画（SVG）。
 * 国の位置に円を置き、ぼかし＋しきい値のフィルタでつなげて陸地らしい形にしている。
 */

import { LINKS, PROVINCES } from './data.js';
import { generalsIn } from './engine.js';

const NS = 'http://www.w3.org/2000/svg';
const NEUTRAL = '#8d8f86';

function el(tag, attrs = {}, parent = null) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  if (parent) parent.appendChild(node);
  return node;
}

const byId = Object.fromEntries(PROVINCES.map((p) => [p.id, p]));

/**
 * 地図を組み立てる。戻り値の update(state, view) で色や兵数を描き直す。
 *   view = { selected: 国 id | null, targets: 国 id の配列（行き先候補）, mode: 'move' | 'march' | null }
 */
export function createMap(svg, { onSelect }) {
  svg.innerHTML = '';

  // --- フィルタと背景
  const defs = el('defs', {}, svg);
  for (const [id, blur, slope, intercept] of [['shore', 10, 30, -10], ['land', 9, 40, -14]]) {
    const f = el('filter', { id, x: '-10%', y: '-10%', width: '120%', height: '120%' }, defs);
    el('feGaussianBlur', { stdDeviation: blur, result: 'b' }, f);
    el('feColorMatrix', { in: 'b', type: 'matrix', values: `1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ${slope} ${intercept}` }, f);
  }
  const sea = el('linearGradient', { id: 'sea', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  el('stop', { offset: '0%', 'stop-color': '#27506b' }, sea);
  el('stop', { offset: '100%', 'stop-color': '#173447' }, sea);
  el('rect', { x: 0, y: 0, width: 920, height: 640, fill: 'url(#sea)' }, svg);

  // 海のさざ波（飾り）
  const waves = el('g', { class: 'waves' }, svg);
  for (let i = 0; i < 14; i++) {
    const x = 40 + ((i * 173) % 840);
    const y = 60 + ((i * 97) % 540);
    el('path', { d: `M${x} ${y} q8 -5 16 0 t16 0`, fill: 'none', stroke: 'rgba(255,255,255,0.18)', 'stroke-width': 1.5 }, waves);
  }

  // --- 陸地（国の円 + 街道の中点の円をぼかしてつなげる）
  const blobPoints = PROVINCES.map((p) => [p.x, p.y, 36]);
  for (const [a, b, kind] of LINKS) {
    if (kind === 'sea') continue;
    const pa = byId[a];
    const pb = byId[b];
    blobPoints.push([(pa.x + pb.x) / 2, (pa.y + pb.y) / 2, 30]);
  }
  const shore = el('g', { filter: 'url(#shore)' }, svg);
  const land = el('g', { filter: 'url(#land)' }, svg);
  for (const [x, y, r] of blobPoints) {
    el('circle', { cx: x, cy: y, r: r + 7, fill: '#6f7d64' }, shore);
    el('circle', { cx: x, cy: y, r, fill: '#d9c99e' }, land);
  }

  // --- 街道と海路
  const roads = el('g', { class: 'roads' }, svg);
  for (const [a, b, kind] of LINKS) {
    const pa = byId[a];
    const pb = byId[b];
    el('line', {
      x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y,
      class: kind === 'sea' ? 'sea-route' : 'road',
    }, roads);
  }

  // --- 国
  const nodes = {};
  const layer = el('g', { class: 'nodes' }, svg);
  for (const p of PROVINCES) {
    const g = el('g', { class: 'node', transform: `translate(${p.x} ${p.y})`, 'data-id': p.id, tabindex: 0, role: 'button' }, layer);
    el('title', { text: p.name }, g);
    el('circle', { class: 'ring', r: 29 }, g);
    el('circle', { class: 'body', r: 21, fill: NEUTRAL }, g);
    el('text', { class: 'name', y: 4, 'text-anchor': 'middle', text: p.name }, g);
    el('rect', { class: 'pill', x: -23, y: 25, width: 46, height: 15, rx: 7.5 }, g);
    el('text', { class: 'soldiers', y: 36, 'text-anchor': 'middle', text: '' }, g);
    const gens = el('g', { class: 'gens', transform: 'translate(17 -17)' }, g);
    el('circle', { r: 8.5 }, gens);
    el('text', { y: 3.5, 'text-anchor': 'middle', text: '' }, gens);
    const todo = el('circle', { class: 'todo', cx: -17, cy: -17, r: 5 }, g);
    todo.setAttribute('visibility', 'hidden');
    g.addEventListener('click', () => onSelect(p.id));
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(p.id); } });
    nodes[p.id] = g;
  }

  function update(state, view) {
    const targets = new Set(view.targets || []);
    for (const p of PROVINCES) {
      const s = state.provinces[p.id];
      const g = nodes[p.id];
      const owner = s.owner ? state.daimyos[s.owner] : null;
      const mine = s.owner === state.player;
      g.querySelector('.body').setAttribute('fill', owner ? owner.color : NEUTRAL);
      g.querySelector('.soldiers').textContent = s.soldiers.toLocaleString('ja-JP');
      const gens = generalsIn(state, p.id);
      const gensEl = g.querySelector('.gens');
      gensEl.setAttribute('visibility', gens.length ? 'visible' : 'hidden');
      gensEl.querySelector('text').textContent = gens.length;
      const todo = mine && gens.some((x) => !x.acted);
      g.querySelector('.todo').setAttribute('visibility', todo ? 'visible' : 'hidden');
      g.querySelector('title').textContent = `${p.name}（${owner ? owner.name : '空白地'}）兵 ${s.soldiers}${gens.length ? `／武将 ${gens.map((x) => x.name).join('・')}` : ''}`;
      g.classList.toggle('mine', mine);
      g.classList.toggle('selected', view.selected === p.id);
      g.classList.toggle('target', targets.has(p.id));
      g.classList.toggle('dim', Boolean(view.mode) && !targets.has(p.id) && view.selected !== p.id);
    }
  }

  return { update };
}
