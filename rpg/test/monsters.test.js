import test from 'node:test';
import assert from 'node:assert/strict';

import { ART, artOf, drawMonster, fade, shade } from '../src/monsters.js';
import { MONSTERS } from '../src/engine.js';

const HEX = /^#[0-9a-f]{6}$/i;
const PAINTS = ['blob', 'beast', 'bug', 'mushroom', 'frog', 'humanoid', 'robed', 'armor', 'flyer', 'ghost', 'golem', 'worm', 'tree', 'demon'];

test('すべての魔物に 絵が用意されている', () => {
  for (const monster of MONSTERS) {
    assert.ok(ART[monster.id], `${monster.name} の絵がない`);
  }
});

test('絵のデータに 幽霊の魔物がいない', () => {
  const ids = new Set(MONSTERS.map((m) => m.id));
  for (const id of Object.keys(ART)) {
    assert.ok(ids.has(id), `${id} は もう魔物として存在しない`);
  }
});

test('絵の設定が 壊れていない', () => {
  for (const [id, art] of Object.entries(ART)) {
    assert.ok(PAINTS.includes(art.paint), `${id}: 知らない型 ${art.paint}`);
    for (const [key, value] of Object.entries(art)) {
      if (typeof value === 'string' && key !== 'paint' && key !== 'mood' && key !== 'mouth' && key !== 'weapon') {
        assert.ok(HEX.test(value), `${id}: ${key} が色になっていない（${value}）`);
      }
    }
    if (art.mood) assert.ok(['cute', 'fierce', 'calm'].includes(art.mood), `${id}: 知らない表情`);
    if (art.mouth) assert.ok(['smile', 'frown', 'fang'].includes(art.mouth), `${id}: 知らない口`);
    if (art.weapon) assert.ok([true, 'axe', 'sword', 'bow'].includes(art.weapon), `${id}: 知らない武器`);
  }
});

test('型ごとに ちゃんと使われている', () => {
  const used = new Set(Object.values(ART).map((a) => a.paint));
  for (const paint of used) assert.ok(PAINTS.includes(paint));
  assert.ok(used.size >= 10, `絵の型が 少なすぎる: ${used.size}`);
});

test('ボスには それぞれ 別の見た目がある', () => {
  const bosses = MONSTERS.filter((m) => m.boss).map((m) => ART[m.id]);
  const looks = bosses.map((a) => `${a.paint}:${a.body || a.cloth || a.trunk}`);
  assert.equal(new Set(looks).size, looks.length, 'ボスの見た目が かぶっている');
});

test('知らない魔物を描こうとしても 落ちない', () => {
  assert.equal(drawMonster(null, 'そんな魔物はいない', 0, 0, 100), false);
  assert.equal(artOf('そんな魔物はいない'), null);
});

test('色を明るく／暗くできる', () => {
  assert.equal(shade('#808080', 0), '#808080');
  assert.equal(shade('#000000', 1), '#ffffff');
  assert.equal(shade('#ffffff', -1), '#000000');
  const dark = shade('#5bd57f', -0.4);
  assert.ok(HEX.test(dark));
  assert.ok(parseInt(dark.slice(1, 3), 16) < 0x5b);
});

test('色を 半透明にできる', () => {
  assert.equal(fade('#5bd57f', 0.5), 'rgba(91,213,127,0.5)');
  assert.equal(fade('#000000', 0), 'rgba(0,0,0,0)');
  assert.equal(fade('#ffffff', 1), 'rgba(255,255,255,1)');
});
