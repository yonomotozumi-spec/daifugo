import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { SFX, SONGS, noteFreq, parseTrack, songForMap, trackLength } from '../src/audio.js';
import { MAPS } from '../src/world.js';

const ui = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');

// ------------------------------------------------------------------ 音の高さ

test('音名を Hz に直せる', () => {
  assert.equal(noteFreq('A4'), 440);
  assert.ok(Math.abs(noteFreq('A5') - 880) < 0.001, '1 オクターブ上が 2 倍になっていない');
  assert.ok(Math.abs(noteFreq('C#5') - 554.365) < 0.01);
  assert.ok(noteFreq('C0') > 0 && noteFreq('C0') < 20, '低い音が おかしい');
  assert.equal(noteFreq('H4'), null);
  assert.equal(noteFreq('あ'), null);
});

test('譜面を読める', () => {
  const notes = parseTrack('C4 - . E4');
  assert.equal(notes.length, 3);
  assert.equal(notes[0].steps, 2, '「-」で 音がのびていない');
  assert.equal(notes[1].freq, null, '「.」が 休みになっていない');
  assert.equal(notes[2].note, 'E4');
  assert.equal(trackLength('C4 - . E4'), 4);
  assert.throws(() => parseTrack('C4 ドレミ'), /読めない音符/);
});

// ------------------------------------------------------------------ 曲

test('どの曲も 演奏できる形になっている', () => {
  for (const [name, song] of Object.entries(SONGS)) {
    assert.ok(song.tempo >= 60 && song.tempo <= 220, `${name}: テンポが 極端`);
    assert.ok(song.tracks.length >= 1, `${name}: トラックがない`);
    const length = trackLength(song.tracks[0].notes);
    for (const track of song.tracks) {
      assert.equal(trackLength(track.notes), length, `${name}: トラックの長さが そろっていない`);
      assert.ok(['square', 'triangle', 'sawtooth', 'sine', 'noise'].includes(track.wave), `${name}: 知らない音色 ${track.wave}`);
      assert.ok(track.vol > 0 && track.vol <= 1, `${name}: 音量が 範囲外`);
      assert.doesNotThrow(() => parseTrack(track.notes), `${name}: 読めない音符がある`);
    }
    // 全部 休みの曲は ないこと
    const sounding = song.tracks.some((t) => parseTrack(t.notes).some((n) => n.freq !== null));
    assert.ok(sounding, `${name}: 音が ひとつも 鳴らない`);
  }
});

test('曲の長さが ほどよい', () => {
  for (const [name, song] of Object.entries(SONGS)) {
    const seconds = (trackLength(song.tracks[0].notes) * 30) / song.tempo;
    if (song.loop) assert.ok(seconds >= 8 && seconds <= 40, `${name}: ループが ${seconds.toFixed(1)} 秒（短すぎ／長すぎ）`);
    else assert.ok(seconds <= 10, `${name}: 一度きりの曲が ${seconds.toFixed(1)} 秒と 長い`);
  }
});

test('場面ごとの曲が そろっている', () => {
  for (const name of ['title', 'town', 'port', 'field', 'cave', 'castle', 'battle', 'boss', 'victory', 'gameover', 'ending']) {
    assert.ok(SONGS[name], `${name} の曲がない`);
  }
  assert.equal(SONGS.victory.loop, false, 'ファンファーレが ループしている');
  assert.equal(SONGS.gameover.loop, false);
  assert.ok(SONGS.boss.tempo > SONGS.field.tempo, 'ボス戦が フィールドより ゆっくり');
  assert.ok(SONGS.battle.tempo > SONGS.town.tempo, '戦闘曲が 村より ゆっくり');
});

test('どのマップにも 鳴らす曲が決まっている', () => {
  for (const [id, map] of Object.entries(MAPS)) {
    const song = songForMap(map);
    assert.ok(SONGS[song], `${id}: 知らない曲 ${song}`);
  }
  assert.equal(songForMap(MAPS.town), 'town');
  assert.equal(songForMap(MAPS.port), 'port');
  assert.equal(songForMap(MAPS.lighthouse), 'port', '港の建物の中で 曲が変わってしまう');
  assert.equal(songForMap(MAPS.world), 'field');
  assert.equal(songForMap(MAPS.cave), 'cave');
  assert.equal(songForMap(MAPS.mine), 'cave');
  assert.equal(songForMap(MAPS.castle), 'castle');
  assert.equal(songForMap(null), 'town');
});

// ------------------------------------------------------------------ 効果音

test('効果音のデータが 壊れていない', () => {
  for (const [name, parts] of Object.entries(SFX)) {
    assert.ok(parts.length >= 1, `${name}: 中身がない`);
    for (const part of parts) {
      assert.ok(['tone', 'noise'].includes(part.type), `${name}: 知らない種類 ${part.type}`);
      assert.ok(part.from > 0 && part.to > 0, `${name}: 周波数が 0 以下（指数カーブが壊れる）`);
      assert.ok(part.dur > 0 && part.dur <= 1, `${name}: 長さが ${part.dur} 秒`);
      assert.ok(part.vol > 0 && part.vol <= 0.5, `${name}: 音量が 大きすぎる`);
      if (part.delay) assert.ok(part.delay >= 0 && part.delay < 1, `${name}: 遅らせすぎ`);
    }
  }
});

test('画面から呼んでいる音は すべて実在する', () => {
  for (const [, name] of ui.matchAll(/audio\.sfx\('([a-zA-Z-]+)'\)/g)) {
    assert.ok(SFX[name], `ui.js が 知らない効果音 ${name} を鳴らそうとしている`);
  }
  for (const [, name] of ui.matchAll(/audio\.play\('([a-zA-Z]+)'\)/g)) {
    assert.ok(SONGS[name], `ui.js が 知らない曲 ${name} をかけようとしている`);
  }
  for (const [, name] of ui.matchAll(/audio\.jingle\('([a-zA-Z]+)'/g)) {
    assert.ok(SONGS[name], `ui.js が 知らない曲 ${name} を鳴らそうとしている`);
  }
});

test('戦闘のメッセージに ついている効果は すべて音が割りあててある', () => {
  const table = /const BATTLE_SFX = \{([\s\S]*?)\};/.exec(ui);
  assert.ok(table, 'ui.js に 戦闘の効果音表がない');
  const mapped = new Set([...table[1].matchAll(/'?([a-z-]+)'?\s*:/g)].map((m) => m[1]));
  // engine.js が使う fx のうち、音をつけたいもの
  for (const fx of ['swing', 'hit-monster', 'critical', 'hit-hero', 'hit-hero-magic', 'cast', 'heal', 'dead', 'defeat']) {
    assert.ok(mapped.has(fx), `${fx} に 音が ついていない`);
  }
});
