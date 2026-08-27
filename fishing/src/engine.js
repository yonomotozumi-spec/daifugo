/**
 * 釣りゲームのロジック。
 * DOM に依存しないので、ブラウザと Node の両方から読み込める。
 * 描画は scene.js、画面まわりは ui.js に任せる。
 */

// ---------------------------------------------------------------- 乱数

/** 再現可能な乱数（テストとリプレイ用）。 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 重み付き抽選。weights は items と同じ長さの正の数。 */
export function weightedPick(items, weights, rng = Math.random) {
  const total = weights.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return items[items.length - 1];
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r < 0) return items[i];
  }
  return items[items.length - 1];
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// ---------------------------------------------------------------- レア度

export const RARITY = {
  common: { id: 'common', label: 'ふつう', weight: 100, color: '#cfd8dc', mult: 1 },
  uncommon: { id: 'uncommon', label: 'めずらしい', weight: 42, color: '#8ce99a', mult: 1.2 },
  rare: { id: 'rare', label: 'レア', weight: 14, color: '#74c0fc', mult: 1.45 },
  epic: { id: 'epic', label: '超レア', weight: 3.6, color: '#d0a2ff', mult: 1.8 },
  legendary: { id: 'legendary', label: '伝説', weight: 0.6, color: '#ffd43b', mult: 2.4 },
};

export const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

// ---------------------------------------------------------------- 時間帯

/** キャストするたびに進む。夜ほどレアが出やすい。 */
export const TIMES = [
  { id: 'morning', label: '朝', rarityBonus: 0.10, biteBonus: 0.10 },
  { id: 'noon', label: '昼', rarityBonus: 0.00, biteBonus: 0.00 },
  { id: 'evening', label: '夕', rarityBonus: 0.18, biteBonus: 0.05 },
  { id: 'night', label: '夜', rarityBonus: 0.35, biteBonus: -0.05 },
];

export const timeAt = (index) => TIMES[((index % TIMES.length) + TIMES.length) % TIMES.length];

// ---------------------------------------------------------------- 天気

/**
 * 天気。数キャストごとに変わる。
 * rarityBonus / biteBonus はルアーや時間帯と同じ枠に足す。
 * stress はラインへの負荷の増しぶん（荒れた日ほど切れやすい）。
 * bigSize は大物寄りの補正。
 */
export const WEATHERS = [
  {
    id: 'sunny', label: '晴れ', emoji: '☀️', weight: 32,
    rarityBonus: 0, biteBonus: 0, stress: 0, bigSize: 0,
    note: 'おだやかな一日',
  },
  {
    id: 'cloudy', label: 'くもり', emoji: '☁️', weight: 26,
    rarityBonus: 0.06, biteBonus: 0.10, stress: 0, bigSize: 0,
    note: '魚の警戒がゆるむ',
  },
  {
    id: 'rain', label: '雨', emoji: '🌧️', weight: 20,
    rarityBonus: 0.10, biteBonus: 0.25, stress: 0.1, bigSize: 0.05,
    note: '雨は釣り人の味方。アタリが増える',
  },
  {
    id: 'fog', label: '霧', emoji: '🌫️', weight: 13,
    rarityBonus: 0.30, biteBonus: -0.08, stress: 0, bigSize: 0.05,
    note: '何が出るか分からない。珍しい魚が寄る',
  },
  {
    id: 'storm', label: '嵐', emoji: '⛈️', weight: 9,
    rarityBonus: 0.40, biteBonus: 0.15, stress: 0.6, bigSize: 0.18,
    note: '大物が動く。ただしラインが切れやすい',
  },
];

export const weatherById = (id) => WEATHERS.find((w) => w.id === id) || WEATHERS[0];

/** 天気が続くキャスト数の幅。 */
export const WEATHER_SPAN = [3, 6];

/**
 * キャストのたびに呼ぶ。持ちが尽きたら次の天気を引く。
 * @returns {{weather: object, changed: boolean}}
 */
export function advanceWeather(player, rng = Math.random) {
  const left = (player.weatherLeft ?? 0) - 1;
  // 持ちが残っていればそのまま。知らない天気が入っていたら引き直す
  const known = weatherById(player.weather).id === player.weather;
  if (left > 0 && known) {
    player.weatherLeft = left;
    return { weather: weatherById(player.weather), changed: false };
  }
  const next = weightedPick(WEATHERS, WEATHERS.map((w) => w.weight), rng);
  const [min, max] = WEATHER_SPAN;
  player.weather = next.id;
  player.weatherLeft = min + Math.floor(rng() * (max - min + 1));
  return { weather: next, changed: true };
}

// ---------------------------------------------------------------- できごと

/**
 * 釣りの最中にたまに起きること。
 * fever … しばらくアタリが速くレアが出やすい
 * nushi … 次の 1 投はレア以上が確定する
 */
export const EVENTS = {
  fever: {
    id: 'fever', label: '大漁タイム', emoji: '🌟', casts: 5, chance: 0.06,
    rarityBonus: 0.25, biteSpeed: 0.35,
    start: '魚の群れが入ってきた！ 大漁タイム！',
    end: '群れが去っていった…',
  },
  nushi: {
    id: 'nushi', label: 'ヌシの気配', emoji: '👑', casts: 1, chance: 0.03,
    rarityBonus: 0, biteSpeed: 0, minRarity: 'rare',
    start: '水面がざわめいている… ヌシの気配だ',
    end: '気配が消えた',
  },
};

/**
 * できごとを引く。すでに何か起きているあいだは引かない。
 * @returns {object|null}
 */
export function rollEvent(rng = Math.random, { active = null } = {}) {
  if (active) return null;
  for (const event of Object.values(EVENTS)) {
    if (rng() < event.chance) return event;
  }
  return null;
}

/** できごとの残りキャストを減らす。0 になったら終わり。 */
export function tickEvent(state) {
  if (!state) return null;
  const left = state.left - 1;
  return left > 0 ? { ...state, left } : null;
}

// ---------------------------------------------------------------- 釣り場

export const SPOTS = [
  { id: 'pond', name: '池', price: 0, note: 'はじまりの池。小物中心だが、たまに主が出る' },
  { id: 'river', name: '渓流', price: 500, note: '流れが速く、引きの強い魚が多い' },
  { id: 'harbor', name: '漁港', price: 2500, note: '堤防から狙う。夜のほうがよく釣れる' },
  { id: 'ice', name: '氷上の湖', price: 4000, note: '氷に穴を開けて釣る。寒いが魚は上等' },
  { id: 'sea', name: '海', price: 6000, note: '大物の宝庫。強い竿がないと切られる' },
  { id: 'island', name: '南の島', price: 16000, note: '透きとおった海。見たことのない色の魚がいる' },
  { id: 'cave', name: '地底湖', price: 22000, note: '鍾乳洞の奥。光の差さない水に何かがいる' },
  { id: 'deep', name: '深海', price: 32000, note: '光の届かない世界。何が出るか分からない' },
];

// ---------------------------------------------------------------- 竿

/**
 * power  … これ未満の力の魚は余裕。上回られるとラインに負荷がかかる
 * reel   … バーに捉えているときの寄せの速さ
 * barH   … 寄せバーの高さ（大きいほど簡単）
 * line   … ラインの粘り。大きいほど負荷に耐える
 */
export const RODS = [
  { id: 'nobe', name: 'のべ竿', price: 0, power: 1, reel: 0.42, barH: 0.26, line: 1.0, note: '竹でできた素朴な竿' },
  { id: 'glass', name: 'グラスロッド', price: 900, power: 2, reel: 0.48, barH: 0.28, line: 1.3, note: 'しなやかで扱いやすい入門機' },
  { id: 'carbon', name: 'カーボンロッド', price: 4200, power: 3, reel: 0.55, barH: 0.30, line: 1.7, note: '軽くて強い。渓流の主力' },
  { id: 'offshore', name: '船竿ブルーウェイク', price: 16000, power: 4, reel: 0.62, barH: 0.32, line: 2.2, note: '海の大物と真正面から殴り合える' },
  { id: 'legend', name: '伝説の竿・龍鱗', price: 60000, power: 5, reel: 0.72, barH: 0.36, line: 3.0, note: '深海の主すら寄せきる' },
];

// ---------------------------------------------------------------- ルアー

/**
 * rarityBonus … レア度の出やすさ（レア度が高いほど強く効く）
 * biteSpeed   … アタリが来るまでの短縮率
 * junkCut     … ゴミが釣れる確率のカット率
 * spotBonus   … 釣り場ごとの得意・不得意
 */
export const LURES = [
  {
    id: 'worm', name: 'ミミズ', price: 0, rarityBonus: 0, biteSpeed: 0, junkCut: 0,
    spotBonus: {}, note: '掘れば無限に手に入る。万能だが平凡',
  },
  {
    id: 'spinner', name: 'スピナー', price: 600, rarityBonus: 0.12, biteSpeed: 0.20, junkCut: 0.3,
    spotBonus: { river: 1.6, pond: 1.2 }, note: '回転で誘う。淡水に強い',
  },
  {
    id: 'minnow', name: 'ミノー', price: 3200, rarityBonus: 0.22, biteSpeed: 0.28, junkCut: 0.5,
    spotBonus: { sea: 1.6, harbor: 1.5, river: 1.2 }, note: '小魚そっくりの動き。海と漁港で本領を発揮',
  },
  {
    id: 'jig', name: 'メタルジグ', price: 11000, rarityBonus: 0.34, biteSpeed: 0.34, junkCut: 0.65,
    spotBonus: { deep: 1.8, island: 1.4, sea: 1.3, harbor: 1.2 }, note: '深く速く沈む。深場攻略の必需品',
  },
  {
    id: 'aurora', name: 'オーロラルアー', price: 38000, rarityBonus: 0.60, biteSpeed: 0.42, junkCut: 0.85,
    spotBonus: { pond: 1.3, river: 1.3, harbor: 1.4, sea: 1.4, island: 1.5, deep: 1.6 }, note: '七色に光り、伝説を引き寄せる',
  },
];


// ---------------------------------------------------------------- 道具

/**
 * 買い切りの道具。買った時点からずっと効く（付け替えはない）。
 * 効果は足し算で重なる。
 *
 * sell        … 売値の上乗せ（0.12 なら +12%）
 * escapeCut   … 魚の逃げ足を削る
 * hookWindow  … 合わせられる猶予（秒）
 * biteSpeed   … アタリまでの短縮（ルアーと同じ枠）
 * rarityBonus … レアの出やすさ（ルアーと同じ枠）
 * junkCut     … ゴミ回避（ルアーと同じ枠）
 * line / reel / barH … 竿の性能への上乗せ
 */
export const GEAR = [
  {
    id: 'cooler', name: 'クーラーボックス', price: 1200, emoji: '🧊',
    effects: { sell: 0.12 }, note: '鮮度が落ちない。魚が高く売れる',
  },
  {
    id: 'chum', name: 'コマセバケツ', price: 1800, emoji: '🪣',
    effects: { biteSpeed: 0.15 }, note: '撒き餌で魚を寄せる。アタリが早く来る',
  },
  {
    id: 'net', name: 'タモ網', price: 2600, emoji: '🥅',
    effects: { escapeCut: 0.15 }, note: '水際ですくえる。魚に逃げられにくい',
  },
  {
    id: 'glasses', name: '偏光グラス', price: 4000, emoji: '🕶️',
    effects: { hookWindow: 0.45 }, note: '水中が見える。合わせの猶予が伸びる',
  },
  {
    id: 'light', name: 'ヘッドライト', price: 6000, emoji: '🔦',
    effects: { rarityBonus: 0.08 }, note: '夜でも手元が見える。珍しい魚を逃さない',
  },
  {
    id: 'spool', name: '太糸スプール', price: 9000, emoji: '🧵',
    effects: { line: 0.6 }, note: '切れにくい糸。大物に耐えられる',
  },
  {
    id: 'ereel', name: '電動リール', price: 15000, emoji: '⚙️',
    effects: { reel: 0.08 }, note: 'ぐいぐい巻ける。寄せが速くなる',
  },
  {
    id: 'bignet', name: '大型ランディングネット', price: 20000, emoji: '🪝',
    effects: { barH: 0.03, escapeCut: 0.08 }, note: '大きな網。寄せバーが広がる',
  },
  {
    id: 'sonar', name: '魚群探知機', price: 45000, emoji: '📡',
    effects: { junkCut: 0.4, biteSpeed: 0.12 }, note: '魚のいる場所が分かる。ゴミを避けられる',
  },
  {
    id: 'charm', name: '大漁祈願のお守り', price: 70000, emoji: '🎏',
    effects: { rarityBonus: 0.15, sell: 0.1 }, note: '漁港の神社で授かった。ご利益は本物らしい',
  },
];

export const gearById = (id) => GEAR.find((g) => g.id === id) || null;

/** 効果なしの状態。 */
export const NO_GEAR = {
  sell: 0, escapeCut: 0, hookWindow: 0, biteSpeed: 0,
  rarityBonus: 0, junkCut: 0, line: 0, reel: 0, barH: 0,
};

/** 持っている道具の効果を合計する。 */
export function gearEffects(player) {
  const total = { ...NO_GEAR };
  for (const id of player?.gears ?? []) {
    const gear = gearById(id);
    if (!gear) continue;
    for (const [key, value] of Object.entries(gear.effects)) {
      total[key] = (total[key] ?? 0) + value;
    }
  }
  return total;
}

// ---------------------------------------------------------------- 魚

/**
 * weight … [最小kg, 最大kg]   length … [最小cm, 最大cm]
 * value  … 標準サイズでの買取価格の目安
 * power  … 竿の power と比べる。上回るとラインに負荷
 * speed  … 寄せバーから逃げる速さ   escape … バーを外したときに逃げる速さ
 */
export const FISH = [
  // ------------------------------------------------ 池
  { id: 'funa', name: 'フナ', emoji: '🐟', spot: 'pond', rarity: 'common', weight: [0.1, 1.2], length: [12, 34], value: 70, power: 1, speed: 0.34, escape: 0.28, color: '#9fb0a8' },
  { id: 'zarigani', name: 'ザリガニ', emoji: '🦞', spot: 'pond', rarity: 'common', weight: [0.03, 0.3], length: [6, 16], value: 45, power: 1, speed: 0.22, escape: 0.24, color: '#d1533f' },
  { id: 'boot', name: '長ぐつ', emoji: '🥾', spot: 'pond', rarity: 'common', weight: [0.4, 1.6], length: [24, 32], value: 5, power: 1, speed: 0.05, escape: 0.10, color: '#6b5a4a', junk: true },
  { id: 'bass', name: 'ブラックバス', emoji: '🐟', spot: 'pond', rarity: 'uncommon', weight: [0.4, 4.2], length: [22, 62], value: 340, power: 2, speed: 0.56, escape: 0.36, color: '#5e7f4b' },
  { id: 'koi', name: 'コイ', emoji: '🎏', spot: 'pond', rarity: 'uncommon', weight: [1.5, 9], length: [35, 92], value: 480, power: 2, speed: 0.38, escape: 0.34, color: '#c9803f' },
  { id: 'namazu', name: 'ナマズ', emoji: '🐟', spot: 'pond', rarity: 'rare', weight: [1, 7], length: [40, 105], value: 900, power: 3, speed: 0.30, escape: 0.40, color: '#5a5241' },
  { id: 'kingyo', name: '出目金', emoji: '🐠', spot: 'pond', rarity: 'rare', weight: [0.02, 0.25], length: [5, 18], value: 1200, power: 1, speed: 0.62, escape: 0.30, color: '#e2543a' },
  { id: 'suppon', name: 'スッポン', emoji: '🐢', spot: 'pond', rarity: 'epic', weight: [0.8, 5], length: [20, 45], value: 4200, power: 3, speed: 0.26, escape: 0.46, color: '#4e5a43' },
  { id: 'nushi', name: '池の主', emoji: '🐉', spot: 'pond', rarity: 'legendary', weight: [12, 40], length: [110, 210], value: 16000, power: 5, speed: 0.52, escape: 0.56, color: '#3f6f8f' },

  // ------------------------------------------------ 渓流
  { id: 'ayu', name: 'アユ', emoji: '🐟', spot: 'river', rarity: 'common', weight: [0.05, 0.4], length: [12, 30], value: 180, power: 1, speed: 0.48, escape: 0.30, color: '#93a88c' },
  { id: 'yamame', name: 'ヤマメ', emoji: '🐟', spot: 'river', rarity: 'common', weight: [0.08, 0.8], length: [15, 38], value: 240, power: 2, speed: 0.52, escape: 0.34, color: '#8b7f66' },
  { id: 'can', name: '空きカン', emoji: '🥫', spot: 'river', rarity: 'common', weight: [0.02, 0.1], length: [10, 14], value: 8, power: 1, speed: 0.06, escape: 0.10, color: '#8e9aa3', junk: true },
  { id: 'iwana', name: 'イワナ', emoji: '🐟', spot: 'river', rarity: 'uncommon', weight: [0.2, 1.6], length: [20, 52], value: 620, power: 2, speed: 0.46, escape: 0.38, color: '#6f6450' },
  { id: 'nijimasu', name: 'ニジマス', emoji: '🐟', spot: 'river', rarity: 'uncommon', weight: [0.3, 3], length: [25, 70], value: 700, power: 3, speed: 0.54, escape: 0.36, color: '#7f8fb0' },
  { id: 'unagi', name: 'ウナギ', emoji: '🐍', spot: 'river', rarity: 'rare', weight: [0.3, 2.5], length: [40, 120], value: 2600, power: 3, speed: 0.66, escape: 0.44, color: '#4a4a3c' },
  { id: 'sakuramasu', name: 'サクラマス', emoji: '🌸', spot: 'river', rarity: 'rare', weight: [1, 6], length: [40, 78], value: 3000, power: 4, speed: 0.58, escape: 0.42, color: '#c08497' },
  { id: 'ito', name: 'イトウ', emoji: '🐟', spot: 'river', rarity: 'epic', weight: [3, 22], length: [60, 150], value: 9000, power: 4, speed: 0.50, escape: 0.50, color: '#6a7f6a' },
  { id: 'kappa', name: 'カッパの皿', emoji: '🥏', spot: 'river', rarity: 'legendary', weight: [0.2, 1], length: [18, 30], value: 26000, power: 2, speed: 0.72, escape: 0.58, color: '#7fc8a9' },

  // ------------------------------------------------ 漁港
  { id: 'haze', name: 'ハゼ', emoji: '🐟', spot: 'harbor', rarity: 'common', weight: [0.02, 0.3], length: [8, 26], value: 200, power: 1, speed: 0.44, escape: 0.28, color: '#a09477' },
  { id: 'mebaru', name: 'メバル', emoji: '🐟', spot: 'harbor', rarity: 'common', weight: [0.08, 0.9], length: [12, 33], value: 450, power: 1, speed: 0.46, escape: 0.34, color: '#6b6a75' },
  { id: 'kasago', name: 'カサゴ', emoji: '🐡', spot: 'harbor', rarity: 'common', weight: [0.1, 1.2], length: [15, 36], value: 520, power: 2, speed: 0.36, escape: 0.38, color: '#a3524a' },
  { id: 'bicycle', name: '沈んだ自転車', emoji: '🚲', spot: 'harbor', rarity: 'common', weight: [8, 16], length: [100, 180], value: 15, power: 2, speed: 0.06, escape: 0.12, color: '#5b6870', junk: true },
  { id: 'kouika', name: 'コウイカ', emoji: '🦑', spot: 'harbor', rarity: 'uncommon', weight: [0.2, 2], length: [15, 42], value: 2200, power: 2, speed: 0.52, escape: 0.40, color: '#cfc3d8' },
  { id: 'anago', name: 'アナゴ', emoji: '🐍', spot: 'harbor', rarity: 'uncommon', weight: [0.2, 1.5], length: [40, 100], value: 2800, power: 2, speed: 0.62, escape: 0.44, color: '#6b5f4e' },
  { id: 'kurodai', name: 'クロダイ', emoji: '🐟', spot: 'harbor', rarity: 'uncommon', weight: [0.4, 4.5], length: [25, 66], value: 3000, power: 3, speed: 0.50, escape: 0.42, color: '#4f5a63' },
  { id: 'tachiuo', name: 'タチウオ', emoji: '🗡️', spot: 'harbor', rarity: 'rare', weight: [0.3, 3.2], length: [60, 155], value: 4200, power: 3, speed: 0.64, escape: 0.46, color: '#c8cdd4' },
  { id: 'suzuki', name: 'スズキ', emoji: '🐟', spot: 'harbor', rarity: 'rare', weight: [1, 9], length: [40, 105], value: 5200, power: 4, speed: 0.58, escape: 0.48, color: '#8d99a6' },
  { id: 'kanpachi', name: 'カンパチ', emoji: '🐟', spot: 'harbor', rarity: 'epic', weight: [3, 25], length: [50, 130], value: 11000, power: 4, speed: 0.66, escape: 0.52, color: '#b9a05e' },
  { id: 'kinkurodai', name: '黄金のクロダイ', emoji: '✨', spot: 'harbor', rarity: 'legendary', weight: [3, 12], length: [50, 80], value: 48000, power: 5, speed: 0.60, escape: 0.58, color: '#e8c15a' },

  // ------------------------------------------------ 氷上の湖
  { id: 'wakasagi', name: 'ワカサギ', emoji: '🐟', spot: 'ice', rarity: 'common', weight: [0.01, 0.12], length: [5, 16], value: 400, power: 1, speed: 0.42, escape: 0.26, color: '#cfd8e2' },
  { id: 'chika', name: 'チカ', emoji: '🐟', spot: 'ice', rarity: 'common', weight: [0.02, 0.25], length: [8, 24], value: 520, power: 1, speed: 0.46, escape: 0.30, color: '#b7c4cf' },
  { id: 'kajika', name: 'カジカ', emoji: '🐡', spot: 'ice', rarity: 'common', weight: [0.05, 0.6], length: [10, 28], value: 700, power: 2, speed: 0.28, escape: 0.36, color: '#8a7f6d' },
  { id: 'sled', name: '落とし物のソリ', emoji: '🛷', spot: 'ice', rarity: 'common', weight: [2, 8], length: [60, 110], value: 40, power: 2, speed: 0.06, escape: 0.12, color: '#9a6f4a', junk: true },
  { id: 'amemasu', name: 'アメマス', emoji: '🐟', spot: 'ice', rarity: 'uncommon', weight: [0.5, 5], length: [30, 75], value: 3200, power: 3, speed: 0.50, escape: 0.40, color: '#7d8b93' },
  { id: 'himemasu', name: 'ヒメマス', emoji: '🐟', spot: 'ice', rarity: 'uncommon', weight: [0.3, 2.5], length: [25, 55], value: 3600, power: 2, speed: 0.54, escape: 0.38, color: '#c2645f' },
  { id: 'kurione', name: 'クリオネ', emoji: '🧊', spot: 'ice', rarity: 'rare', weight: [0.005, 0.05], length: [1, 5], value: 9000, power: 1, speed: 0.70, escape: 0.34, color: '#ffb3c7' },
  { id: 'ohyou', name: 'オヒョウ', emoji: '🐟', spot: 'ice', rarity: 'rare', weight: [10, 180], length: [80, 260], value: 11000, power: 5, speed: 0.34, escape: 0.48, color: '#6b6f6a' },
  { id: 'kurokawa', name: 'イトウ（氷下）', emoji: '🐟', spot: 'ice', rarity: 'epic', weight: [5, 30], length: [70, 160], value: 24000, power: 4, speed: 0.52, escape: 0.52, color: '#5f7a63' },
  { id: 'chouzame', name: 'シロチョウザメ', emoji: '🐊', spot: 'ice', rarity: 'legendary', weight: [40, 400], length: [150, 500], value: 95000, power: 5, speed: 0.46, escape: 0.58, color: '#9aa7a0' },

  // ------------------------------------------------ 海
  { id: 'aji', name: 'アジ', emoji: '🐟', spot: 'sea', rarity: 'common', weight: [0.1, 0.9], length: [15, 42], value: 520, power: 1, speed: 0.44, escape: 0.32, color: '#9aa7ae' },
  { id: 'saba', name: 'サバ', emoji: '🐟', spot: 'sea', rarity: 'common', weight: [0.3, 2.2], length: [25, 55], value: 680, power: 2, speed: 0.58, escape: 0.36, color: '#5f7d92' },
  { id: 'bottle', name: 'ペットボトル', emoji: '🧴', spot: 'sea', rarity: 'common', weight: [0.05, 0.6], length: [20, 32], value: 10, power: 1, speed: 0.08, escape: 0.10, color: '#a8c6d6', junk: true },
  { id: 'tai', name: 'マダイ', emoji: '🐠', spot: 'sea', rarity: 'uncommon', weight: [0.5, 6], length: [30, 88], value: 2600, power: 3, speed: 0.48, escape: 0.40, color: '#d4736f' },
  { id: 'hirame', name: 'ヒラメ', emoji: '🐟', spot: 'sea', rarity: 'uncommon', weight: [0.6, 7], length: [30, 95], value: 3000, power: 3, speed: 0.34, escape: 0.42, color: '#8d8471' },
  { id: 'ika', name: 'アオリイカ', emoji: '🦑', spot: 'sea', rarity: 'uncommon', weight: [0.2, 3], length: [18, 48], value: 2400, power: 2, speed: 0.62, escape: 0.38, color: '#c7b7d6' },
  { id: 'tako', name: 'マダコ', emoji: '🐙', spot: 'sea', rarity: 'rare', weight: [0.5, 5], length: [30, 90], value: 4000, power: 3, speed: 0.30, escape: 0.50, color: '#b1596a' },
  { id: 'buri', name: 'ブリ', emoji: '🐟', spot: 'sea', rarity: 'rare', weight: [2, 14], length: [50, 130], value: 5200, power: 4, speed: 0.60, escape: 0.44, color: '#6c8ba0' },
  { id: 'same', name: 'ホホジロザメ', emoji: '🦈', spot: 'sea', rarity: 'epic', weight: [80, 900], length: [200, 560], value: 18000, power: 5, speed: 0.46, escape: 0.54, color: '#5b6a74' },
  { id: 'manbou', name: 'マンボウ', emoji: '🐡', spot: 'sea', rarity: 'epic', weight: [40, 600], length: [120, 320], value: 15000, power: 5, speed: 0.22, escape: 0.48, color: '#93a2a8' },
  { id: 'kajiki', name: 'クロカジキ', emoji: '🗡️', spot: 'sea', rarity: 'legendary', weight: [60, 500], length: [200, 450], value: 52000, power: 5, speed: 0.70, escape: 0.60, color: '#3d5a7a' },

  // ------------------------------------------------ 南の島
  { id: 'clownfish', name: 'カクレクマノミ', emoji: '🐠', spot: 'island', rarity: 'common', weight: [0.02, 0.15], length: [4, 12], value: 1100, power: 1, speed: 0.58, escape: 0.32, color: '#f08a3c' },
  { id: 'bannerfish', name: 'ハタタテダイ', emoji: '🐠', spot: 'island', rarity: 'common', weight: [0.05, 0.5], length: [10, 26], value: 1300, power: 1, speed: 0.52, escape: 0.34, color: '#f2e6c8' },
  { id: 'coconut', name: 'ヤシの実', emoji: '🥥', spot: 'island', rarity: 'common', weight: [0.8, 2.5], length: [18, 30], value: 25, power: 1, speed: 0.08, escape: 0.12, color: '#8a6a45', junk: true },
  { id: 'ise_ebi', name: 'イセエビ', emoji: '🦞', spot: 'island', rarity: 'uncommon', weight: [0.3, 2.2], length: [20, 48], value: 4600, power: 2, speed: 0.30, escape: 0.44, color: '#b8452f' },
  { id: 'napoleon', name: 'ナポレオンフィッシュ', emoji: '🐟', spot: 'island', rarity: 'uncommon', weight: [5, 45], length: [60, 190], value: 7500, power: 4, speed: 0.40, escape: 0.44, color: '#3f8f8a' },
  { id: 'takaragai', name: 'タカラガイ', emoji: '🐚', spot: 'island', rarity: 'rare', weight: [0.02, 0.2], length: [3, 11], value: 6800, power: 1, speed: 0.20, escape: 0.30, color: '#e6c9a8' },
  { id: 'umigame', name: 'アオウミガメ', emoji: '🐢', spot: 'island', rarity: 'rare', weight: [20, 130], length: [60, 145], value: 9500, power: 4, speed: 0.34, escape: 0.46, color: '#4b7a52' },
  { id: 'manta', name: 'オニイトマキエイ', emoji: '🐟', spot: 'island', rarity: 'epic', weight: [60, 600], length: [200, 520], value: 27000, power: 5, speed: 0.48, escape: 0.52, color: '#37506b' },
  { id: 'bashoukajiki', name: 'バショウカジキ', emoji: '🗡️', spot: 'island', rarity: 'epic', weight: [25, 90], length: [180, 330], value: 31000, power: 5, speed: 0.74, escape: 0.58, color: '#2f5f8f' },
  { id: 'jinbee', name: 'ジンベエザメ', emoji: '🦈', spot: 'island', rarity: 'legendary', weight: [300, 2000], length: [400, 1200], value: 160000, power: 5, speed: 0.44, escape: 0.60, color: '#4a6274' },

  // ------------------------------------------------ 地底湖
  { id: 'shirauo', name: 'チカイシラウオ', emoji: '🐟', spot: 'cave', rarity: 'common', weight: [0.01, 0.1], length: [4, 14], value: 2000, power: 1, speed: 0.50, escape: 0.32, color: '#e4e8ee' },
  { id: 'doukutsuebi', name: 'ドウクツヌマエビ', emoji: '🦐', spot: 'cave', rarity: 'common', weight: [0.01, 0.15], length: [3, 12], value: 2400, power: 1, speed: 0.34, escape: 0.34, color: '#e0c9c0' },
  { id: 'stalactite', name: '折れた鍾乳石', emoji: '🪨', spot: 'cave', rarity: 'common', weight: [1, 9], length: [20, 70], value: 60, power: 2, speed: 0.05, escape: 0.12, color: '#8d8477', junk: true },
  { id: 'komori', name: 'コウモリ', emoji: '🦇', spot: 'cave', rarity: 'uncommon', weight: [0.02, 0.3], length: [8, 30], value: 3000, power: 1, speed: 0.78, escape: 0.44, color: '#4a4048' },
  { id: 'blindfish', name: 'メナシウオ', emoji: '🐠', spot: 'cave', rarity: 'uncommon', weight: [0.05, 0.8], length: [8, 26], value: 9000, power: 2, speed: 0.46, escape: 0.40, color: '#f0e6e0' },
  { id: 'sanshouuo', name: 'オオサンショウウオ', emoji: '🦎', spot: 'cave', rarity: 'rare', weight: [3, 30], length: [50, 150], value: 12000, power: 4, speed: 0.24, escape: 0.50, color: '#6a6255' },
  { id: 'kaseki', name: '化石魚', emoji: '🦴', spot: 'cave', rarity: 'rare', weight: [0.5, 8], length: [20, 90], value: 20000, power: 3, speed: 0.30, escape: 0.46, color: '#c9bfa5' },
  { id: 'suishou', name: '水晶のかたまり', emoji: '💎', spot: 'cave', rarity: 'epic', weight: [0.3, 5], length: [10, 40], value: 42000, power: 2, speed: 0.14, escape: 0.40, color: '#a9d8ea' },
  { id: 'chiteiryu', name: '地底湖のヌシ', emoji: '🐲', spot: 'cave', rarity: 'legendary', weight: [30, 200], length: [180, 420], value: 140000, power: 5, speed: 0.56, escape: 0.62, color: '#3f4a5a' },

  // ------------------------------------------------ 深海
  { id: 'kinmedai', name: 'キンメダイ', emoji: '🐠', spot: 'deep', rarity: 'common', weight: [0.5, 4], length: [25, 60], value: 1800, power: 2, speed: 0.40, escape: 0.36, color: '#d4544a' },
  { id: 'takaashi', name: 'タカアシガニ', emoji: '🦀', spot: 'deep', rarity: 'uncommon', weight: [3, 19], length: [60, 300], value: 6000, power: 3, speed: 0.26, escape: 0.44, color: '#c06a55' },
  { id: 'anko', name: 'チョウチンアンコウ', emoji: '🎣', spot: 'deep', rarity: 'rare', weight: [0.3, 3], length: [15, 60], value: 9500, power: 3, speed: 0.34, escape: 0.50, color: '#3b3f4d' },
  { id: 'mendako', name: 'メンダコ', emoji: '🐙', spot: 'deep', rarity: 'rare', weight: [0.05, 0.6], length: [8, 22], value: 11000, power: 2, speed: 0.44, escape: 0.46, color: '#e08fa0' },
  { id: 'daiouika', name: 'ダイオウイカ', emoji: '🦑', spot: 'deep', rarity: 'epic', weight: [50, 280], length: [300, 900], value: 34000, power: 5, speed: 0.56, escape: 0.56, color: '#a2637f' },
  { id: 'ryuuguu', name: 'リュウグウノツカイ', emoji: '🎗️', spot: 'deep', rarity: 'epic', weight: [20, 180], length: [300, 800], value: 40000, power: 4, speed: 0.64, escape: 0.58, color: '#b8c4d8' },
  { id: 'probe', name: '壊れた探査機', emoji: '🛰️', spot: 'deep', rarity: 'common', weight: [3, 20], length: [40, 120], value: 30, power: 2, speed: 0.07, escape: 0.12, color: '#7a828c', junk: true },
  { id: 'rabuka', name: 'ラブカ', emoji: '🦈', spot: 'deep', rarity: 'rare', weight: [8, 60], length: [100, 200], value: 14000, power: 4, speed: 0.52, escape: 0.50, color: '#4a4550' },
  { id: 'kinka', name: '沈没船の金貨', emoji: '🪙', spot: 'deep', rarity: 'epic', weight: [0.02, 0.4], length: [3, 8], value: 38000, power: 1, speed: 0.16, escape: 0.34, color: '#e0bb54' },
  { id: 'coelacanth', name: 'シーラカンス', emoji: '🐊', spot: 'deep', rarity: 'legendary', weight: [25, 95], length: [110, 200], value: 120000, power: 5, speed: 0.50, escape: 0.62, color: '#4f6f6a' },
];

export const fishById = (id) => FISH.find((f) => f.id === id) || null;
export const rodById = (id) => RODS.find((r) => r.id === id) || null;
export const lureById = (id) => LURES.find((l) => l.id === id) || null;
export const spotById = (id) => SPOTS.find((s) => s.id === id) || null;
export const fishOfSpot = (spotId) => FISH.filter((f) => f.spot === spotId);

// ---------------------------------------------------------------- 抽選

/**
 * 1 匹ぶんの抽選。レア度・ルアー・時間帯・竿の強さで重みを変える。
 * @returns {{fish: object, weightKg: number, lengthCm: number, sizeRatio: number, price: number}}
 */
export function pickFish(spotId, {
  rng = Math.random, rod, lure, timeIndex = 1, gear = NO_GEAR, weather = null, event = null,
} = {}) {
  const all = fishOfSpot(spotId);
  if (!all.length) throw new Error(`unknown spot: ${spotId}`);

  // ヌシの気配のときはレア以上しか掛からない
  const floor = event?.minRarity ? RARITY_ORDER.indexOf(event.minRarity) : -1;
  const rareOnly = floor >= 0
    ? all.filter((f) => !f.junk && RARITY_ORDER.indexOf(f.rarity) >= floor)
    : [];
  const candidates = rareOnly.length ? rareOnly : all;

  const time = timeAt(timeIndex);
  const bonus = (lure?.rarityBonus ?? 0) + time.rarityBonus + (gear.rarityBonus ?? 0)
    + (weather?.rarityBonus ?? 0) + (event?.rarityBonus ?? 0);
  const junkCut = clamp((lure?.junkCut ?? 0) + (gear.junkCut ?? 0), 0, 0.95);
  const power = rod?.power ?? 1;

  const weights = candidates.map((f) => {
    let w = RARITY[f.rarity].weight;
    // レア度が高いほどボーナスが強く乗る
    w *= Math.pow(1 + bonus, RARITY_ORDER.indexOf(f.rarity));
    w *= lure?.spotBonus?.[f.spot] ?? 1;
    if (f.junk) w *= Math.max(0.05, 1 - junkCut);
    // 竿に対して強すぎる魚は掛かりにくい（掛かっても切られる）
    if (f.power > power + 1) w *= 0.3;
    return w;
  });

  const fish = weightedPick(candidates, weights, rng);
  // 大物ほど出にくいように偏らせる。ボーナスや荒天だとやや大物寄り
  const sizeRatio = Math.pow(rng(), Math.max(0.6, 2.3 - bonus * 0.8 - (weather?.bigSize ?? 0) * 2));
  const weightKg = round2(lerp(fish.weight[0], fish.weight[1], sizeRatio));
  const lengthCm = Math.round(lerp(fish.length[0], fish.length[1], sizeRatio));
  const price = Math.max(1, Math.round(priceOf(fish, weightKg) * (1 + (gear.sell ?? 0))));
  return { fish, weightKg, lengthCm, sizeRatio, price };
}

const lerp = (a, b, t) => a + (b - a) * t;
const round2 = (v) => Math.round(v * 100) / 100;

/** 買取価格。大きいほど高く、レア度でさらに倍率がかかる。 */
export function priceOf(fish, weightKg) {
  const [min, max] = fish.weight;
  const ratio = max > min ? clamp((weightKg - min) / (max - min), 0, 1) : 0.5;
  const price = fish.value * (0.6 + 1.7 * ratio) * RARITY[fish.rarity].mult;
  return Math.max(1, Math.round(price));
}

/** アタリが来るまでの秒数。 */
export function biteDelay(rng = Math.random, {
  lure, timeIndex = 1, gear = NO_GEAR, weather = null, event = null,
} = {}) {
  const speed = clamp(
    (lure?.biteSpeed ?? 0) + timeAt(timeIndex).biteBonus + (gear.biteSpeed ?? 0)
    + (weather?.biteBonus ?? 0) + (event?.biteSpeed ?? 0),
    -0.3, 0.85,
  );
  return round2((0.9 + rng() * 3.6) * (1 - speed) + 0.35);
}

/** アタリに合わせられる猶予（秒）。道具で伸ばせる。 */
export const HOOK_WINDOW = 1.1;

export const hookWindow = (gear = NO_GEAR) => HOOK_WINDOW + (gear.hookWindow ?? 0);

// ---------------------------------------------------------------- ファイト

export const FIGHT = {
  fighting: 'fighting',
  caught: 'caught',   // 釣り上げた
  escaped: 'escaped', // バーを外し続けて逃げられた
  snapped: 'snapped', // ラインが切れた
};

/**
 * 寄せのミニゲーム。
 * 上下に動く「寄せバー」で魚を捉え続けると progress が伸びる。
 * 竿より強い魚を掛けると strain（ラインへの負荷）がたまり、振り切ると切れる。
 *
 * update(dt, holding) を毎フレーム呼ぶだけ。0..1 の値しか持たないので描画側は好きに使える。
 */
export class Fight {
  constructor({ fish, rod, sizeRatio = 0.5, rng = Math.random, gear = NO_GEAR, weather = null }) {
    this.fish = fish;
    // 道具のぶんを足した竿として扱う（描画側は rod をそのまま見ればよい）
    this.rod = {
      ...rod,
      reel: rod.reel + (gear.reel ?? 0),
      line: rod.line + (gear.line ?? 0),
      barH: Math.min(0.5, rod.barH + (gear.barH ?? 0)),
    };
    this.rng = rng;
    // 大物ほど強い＆重い
    this.power = fish.power + sizeRatio * 0.9;
    this.speed = fish.speed * (0.85 + sizeRatio * 0.45);
    this.escapeRate = fish.escape * (0.85 + sizeRatio * 0.35) * (1 - clamp(gear.escapeCut ?? 0, 0, 0.6));
    // 荒れた日ほどラインに負荷がかかる
    this.stress = 1 + clamp(weather?.stress ?? 0, 0, 1);

    this.barH = this.rod.barH;
    this.barY = 0.5;
    this.barV = 0;
    this.fishY = 0.5;
    this.fishTarget = 0.5;
    this.nextMove = 0;
    this.progress = 0.24;
    this.strain = 0;
    this.time = 0;
    this.phase = FIGHT.fighting;
    this.inBar = true;
    this.dash = 0; // 演出用：直前に走った量
  }

  /** バーの上端・下端（描画用）。 */
  get barTop() { return clamp(this.barY - this.barH / 2, 0, 1); }
  get barBottom() { return clamp(this.barY + this.barH / 2, 0, 1); }

  /**
   * @param {number} dt      経過秒（0.05 で頭打ちにしておくと重い端末でも壊れない）
   * @param {boolean} holding リールを巻いているか
   */
  update(dt, holding) {
    if (this.phase !== FIGHT.fighting) return this.phase;
    const step = Math.min(dt, 0.05);
    this.time += step;

    // --- 寄せバー：押すと上がり、離すと落ちる
    this.barV += (holding ? -1.9 : 1.5) * step;
    this.barV = clamp(this.barV, -0.95, 0.95);
    this.barY += this.barV * step;
    const half = this.barH / 2;
    if (this.barY < half) { this.barY = half; this.barV *= -0.25; }
    if (this.barY > 1 - half) { this.barY = 1 - half; this.barV *= -0.25; }

    // --- 魚：ときどき行き先を変えて、たまに走る
    this.nextMove -= step;
    this.dash = Math.max(0, this.dash - step * 3);
    if (this.nextMove <= 0) {
      const dashing = this.rng() < 0.28;
      this.fishTarget = clamp(this.rng(), 0.05, 0.95);
      if (dashing) {
        this.fishTarget = this.fishY < 0.5 ? 0.95 : 0.05;
        this.dash = 1;
      }
      this.nextMove = 0.25 + this.rng() * (dashing ? 0.5 : 1.1);
    }
    const move = this.speed * step * (this.dash > 0 ? 2.1 : 1);
    const diff = this.fishTarget - this.fishY;
    this.fishY = clamp(this.fishY + clamp(diff, -move, move), 0, 1);

    // --- 判定
    this.inBar = Math.abs(this.fishY - this.barY) <= half;
    if (this.inBar) {
      this.progress += this.rod.reel * step;
      this.strain += Math.max(0, this.power - this.rod.power) * 0.5 * this.stress / this.rod.line * step;
    } else {
      this.progress -= this.escapeRate * 0.55 * step;
      this.strain -= 0.55 * step;
    }
    this.progress = clamp(this.progress, 0, 1);
    this.strain = clamp(this.strain, 0, 1);

    if (this.strain >= 1) this.phase = FIGHT.snapped;
    else if (this.progress >= 1) this.phase = FIGHT.caught;
    else if (this.progress <= 0) this.phase = FIGHT.escaped;
    return this.phase;
  }
}

// ---------------------------------------------------------------- プレイヤー

export const START_MONEY = 0;

/** セーブデータの初期値。 */
export function createPlayer(over = {}) {
  return {
    money: START_MONEY,
    rods: ['nobe'],
    lures: ['worm'],
    spots: ['pond'],
    gears: [],
    rod: 'nobe',
    lure: 'worm',
    spot: 'pond',
    timeIndex: 0,
    weather: 'sunny',
    weatherLeft: 0,
    casts: 0,
    catches: 0,
    earned: 0,
    records: {}, // fishId -> { count, weightKg, lengthCm, price }
    ...over,
  };
}

export const equippedRod = (player) => rodById(player.rod) || RODS[0];
export const equippedLure = (player) => lureById(player.lure) || LURES[0];

export const SHOP_KINDS = {
  rod: { list: RODS, owned: 'rods', equip: 'rod' },
  lure: { list: LURES, owned: 'lures', equip: 'lure' },
  gear: { list: GEAR, owned: 'gears' },   // 買ったらずっと効く。付け替えはない
  spot: { list: SPOTS, owned: 'spots', equip: 'spot' },
};

export function owns(player, kind, id) {
  return player[SHOP_KINDS[kind].owned].includes(id);
}

/**
 * 購入。買えたら true と残金を返す。所持金が足りなければ理由つきで false。
 * 買った道具はそのまま装備する（釣り場なら移動する）。
 */
export function buy(player, kind, id) {
  const conf = SHOP_KINDS[kind];
  if (!conf) return { ok: false, error: '不明な商品です' };
  const item = conf.list.find((x) => x.id === id);
  if (!item) return { ok: false, error: '不明な商品です' };
  if (owns(player, kind, id)) return { ok: false, error: 'すでに持っています' };
  if (player.money < item.price) {
    return { ok: false, error: `${(item.price - player.money).toLocaleString()}円 足りません` };
  }
  player.money -= item.price;
  player[conf.owned].push(id);
  if (conf.equip) player[conf.equip] = id;
  return { ok: true, item, money: player.money };
}

/** 装備の切り替え（持っているものだけ）。 */
export function equip(player, kind, id) {
  const conf = SHOP_KINDS[kind];
  if (!conf?.equip || !owns(player, kind, id)) return false;
  player[conf.equip] = id;
  return true;
}

/** 釣った魚を売る。図鑑の記録は売っても残る。 */
export function sell(player, result) {
  player.money += result.price;
  player.earned += result.price;
  return player.money;
}

/**
 * 図鑑に登録する。自己ベストを更新したときだけ true を返す。
 */
export function recordCatch(player, result) {
  const prev = player.records[result.fish.id];
  player.catches += 1;
  if (!prev) {
    player.records[result.fish.id] = {
      count: 1, weightKg: result.weightKg, lengthCm: result.lengthCm, price: result.price,
    };
    return true;
  }
  prev.count += 1;
  if (result.weightKg > prev.weightKg) {
    prev.weightKg = result.weightKg;
    prev.lengthCm = result.lengthCm;
    prev.price = result.price;
    return true;
  }
  return false;
}

/** 図鑑の進捗（釣り場ごと）。 */
export function collectionProgress(player, spotId) {
  const all = fishOfSpot(spotId);
  const found = all.filter((f) => player.records[f.id]);
  return { found: found.length, total: all.length };
}

/** 壊れたセーブデータでも遊べるように、既知の値だけ拾って組み立て直す。 */
export function normalizePlayer(raw) {
  const base = createPlayer();
  if (!raw || typeof raw !== 'object') return base;
  const pickList = (value, list, fallback) => {
    const ids = Array.isArray(value) ? value.filter((id) => list.some((x) => x.id === id)) : [];
    return ids.length ? [...new Set([...fallback, ...ids])] : fallback;
  };
  const player = {
    ...base,
    money: Number.isFinite(raw.money) ? Math.max(0, Math.floor(raw.money)) : 0,
    rods: pickList(raw.rods, RODS, ['nobe']),
    lures: pickList(raw.lures, LURES, ['worm']),
    spots: pickList(raw.spots, SPOTS, ['pond']),
    gears: Array.isArray(raw.gears) ? raw.gears.filter((id) => gearById(id)) : [],
    timeIndex: Number.isFinite(raw.timeIndex) ? Math.floor(raw.timeIndex) : 0,
    weather: WEATHERS.some((w) => w.id === raw.weather) ? raw.weather : 'sunny',
    weatherLeft: Number.isFinite(raw.weatherLeft) ? clamp(Math.floor(raw.weatherLeft), 0, 20) : 0,
    casts: Number.isFinite(raw.casts) ? raw.casts : 0,
    catches: Number.isFinite(raw.catches) ? raw.catches : 0,
    earned: Number.isFinite(raw.earned) ? raw.earned : 0,
    records: {},
  };
  for (const [id, rec] of Object.entries(raw.records || {})) {
    if (!fishById(id) || !rec || typeof rec !== 'object') continue;
    player.records[id] = {
      count: Math.max(1, Math.floor(rec.count) || 1),
      weightKg: Number(rec.weightKg) || 0,
      lengthCm: Math.round(Number(rec.lengthCm) || 0),
      price: Math.round(Number(rec.price) || 0),
    };
  }
  player.rod = player.rods.includes(raw.rod) ? raw.rod : player.rods[player.rods.length - 1];
  player.lure = player.lures.includes(raw.lure) ? raw.lure : player.lures[player.lures.length - 1];
  player.spot = player.spots.includes(raw.spot) ? raw.spot : player.spots[player.spots.length - 1];
  return player;
}

// ---------------------------------------------------------------- 表示用

export const yen = (v) => `${Math.round(v).toLocaleString('ja-JP')}円`;

export function sizeLabel(result) {
  const kg = result.weightKg;
  const w = kg >= 10 ? `${kg.toFixed(1)}kg` : `${kg.toFixed(2)}kg`;
  return `${result.lengthCm}cm / ${w}`;
}

/** 自己ベスト比の称号。演出のトリガーにも使う。 */
export function sizeTitle(sizeRatio) {
  if (sizeRatio >= 0.92) return { label: '規格外！', tone: 'huge' };
  if (sizeRatio >= 0.7) return { label: '大物！', tone: 'big' };
  if (sizeRatio <= 0.12) return { label: 'チビ', tone: 'small' };
  return null;
}
