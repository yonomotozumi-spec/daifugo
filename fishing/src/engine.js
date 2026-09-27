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

/** ルアー・時間帯・道具・天気・できごと・お札の効果を足し合わせる。 */
const sumOf = (key, mods) => mods.reduce((total, m) => total + (m?.[key] ?? 0), 0);

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

/**
 * 釣り場。price を払えば行ける。
 *
 * 終盤の 3 か所は「難所」で、お金だけでは開かない。
 * require … この魚を釣っていないと買えない（ひとつ前の難所のヌシ）
 * hard    … 難度（1〜3）。表示と演出用
 * stress  … ラインにかかる負荷の増しぶん（天気の stress と同じ枠）
 * drift   … 潮に流されて、寄せがじりじり戻る量（毎秒）
 * fishSpeed … 魚の動きの速さの倍率
 * biteBonus … アタリの速さ（マイナスなら渋い）
 * tough  … 寄せにくさ。大きいほど巻き上げに時間がかかる
 */
export const SPOTS = [
  { id: 'pond', name: '池', price: 0, note: 'はじまりの池。小物中心だが、たまに主が出る' },
  { id: 'river', name: '渓流', price: 500, note: '流れが速く、引きの強い魚が多い' },
  { id: 'harbor', name: '漁港', price: 2500, note: '堤防から狙う。夜のほうがよく釣れる' },
  { id: 'ice', name: '氷上の湖', price: 4000, note: '氷に穴を開けて釣る。寒いが魚は上等' },
  { id: 'sea', name: '海', price: 6000, note: '大物の宝庫。強い竿がないと切られる' },
  { id: 'island', name: '南の島', price: 16000, note: '透きとおった海。見たことのない色の魚がいる' },
  { id: 'cave', name: '地底湖', price: 22000, note: '鍾乳洞の奥。光の差さない水に何かがいる' },
  { id: 'deep', name: '深海', price: 32000, note: '光の届かない世界。何が出るか分からない' },
  {
    id: 'ruin', name: '海底神殿', price: 90000, hard: 1, require: 'coelacanth',
    stress: 0.35, drift: 0.020, fishSpeed: 1.08, biteBonus: -0.12, tough: 1.5,
    note: '沈んだ石の柱が並ぶ。魚は重く、糸への負担が大きい',
  },
  {
    id: 'crater', name: '火口湖', price: 240000, hard: 2, require: 'wadatsumi',
    stress: 0.55, drift: 0.035, fishSpeed: 1.14, biteBonus: -0.20, tough: 1.8,
    note: '湯気の立つ熱い水。湧き上がる流れに寄せを押し戻される',
  },
  {
    id: 'abyss', name: '奈落の淵', price: 700000, hard: 3, require: 'enrin',
    stress: 0.80, drift: 0.055, fishSpeed: 1.20, biteBonus: -0.28, tough: 2.2,
    note: '海溝のいちばん底。並の道具では糸も竿も保たない',
  },
];

/** 難所かどうか（hard が 1 以上）。 */
export const isHardSpot = (spot) => Number(spot?.hard ?? 0) > 0;

/** 釣り場の難度補正。ふつうの釣り場はすべて 0。 */
export function spotHazard(spot) {
  const s = typeof spot === 'string' ? spotById(spot) : spot;
  return {
    stress: s?.stress ?? 0,
    drift: s?.drift ?? 0,
    fishSpeed: s?.fishSpeed ?? 1,
    biteBonus: s?.biteBonus ?? 0,
    tough: s?.tough ?? 1,
  };
}

/**
 * まだ開いていない難所なら、鍵になっている魚を返す。開いていれば null。
 */
export function spotLocked(player, spot) {
  const s = typeof spot === 'string' ? spotById(spot) : spot;
  if (!s?.require) return null;
  if (player?.records?.[s.require]) return null;
  return fishById(s.require);
}

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
  { id: 'abyssrod', name: '深淵竿・鋼牙', price: 150000, power: 6, reel: 0.80, barH: 0.38, line: 3.9, note: '海底神殿の重い魚に耐えるために鍛えられた' },
  { id: 'mythrod', name: '神竿・天ノ釣', price: 520000, power: 7, reel: 0.90, barH: 0.42, line: 5.0, note: '奈落の主と渡り合える、ただひとつの竿' },
];

/** 竿のパワーの上限（表示の星の数）。 */
export const MAX_POWER = Math.max(...RODS.map((r) => r.power));

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
  {
    id: 'phantom', name: '幽玄ルアー', price: 130000, rarityBonus: 0.85, biteSpeed: 0.50, junkCut: 0.90,
    spotBonus: { ruin: 1.8, crater: 1.5, cave: 1.5, deep: 1.4 },
    note: '水中で消えたり現れたりする。難所の魚だけが反応する',
  },
  {
    id: 'kami', name: '神饌ルアー', price: 380000, rarityBonus: 1.30, biteSpeed: 0.55, junkCut: 0.95,
    spotBonus: { abyss: 2.0, crater: 1.8, ruin: 1.6, deep: 1.5, island: 1.4 },
    note: '神へ供える餌。奈落の底にいるものさえ振り向く',
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
  {
    id: 'harness', name: 'ファイティングハーネス', price: 110000, emoji: '🦺',
    effects: { line: 0.9, reel: 0.04 }, note: '体で竿を支える。腕だけで釣るより格段に粘れる',
  },
  {
    id: 'anchor', name: '潮止めアンカー', price: 180000, emoji: '⚓',
    effects: { driftCut: 0.03 }, note: '流れに踏ん張れる。難所で寄せが押し戻されにくくなる',
  },
  {
    id: 'drone', name: '水中ドローン', price: 320000, emoji: '🛸',
    effects: { rarityBonus: 0.2, junkCut: 0.5, hookWindow: 0.3 }, note: '潜って魚を探す。狙った魚を見てから合わせられる',
  },
];

export const gearById = (id) => GEAR.find((g) => g.id === id) || null;

/** 効果なしの状態。 */
export const NO_GEAR = {
  sell: 0, escapeCut: 0, hookWindow: 0, biteSpeed: 0,
  rarityBonus: 0, junkCut: 0, line: 0, reel: 0, barH: 0, driftCut: 0, shinyBonus: 0,
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

// ---------------------------------------------------------------- お札（使い切り）

/**
 * 一度使うと無くなる道具。ためたお金の使いどころ。
 * 効果の書きかたは、できごと（EVENTS）と同じ枠に足される。
 */
export const CHARMS = [
  {
    id: 'chumball', name: '撒き餌の玉', price: 800, emoji: '🍡', casts: 1,
    effect: { biteSpeed: 0.5, rarityBonus: 0.15 },
    note: '次の 1 投だけ、アタリがすぐ来る',
  },
  {
    id: 'lucky', name: '幸運の札', price: 5000, emoji: '🍀', casts: 1,
    effect: { rarityBonus: 0.6 },
    note: '次の 1 投だけ、珍しい魚が寄ってくる',
  },
  {
    id: 'safety', name: '安全ピンの札', price: 6000, emoji: '🧷', casts: 1,
    effect: { noSnap: true },
    note: '次の 1 投だけ、ラインが切れない',
  },
  {
    id: 'timing', name: '時合いの札', price: 9000, emoji: '🌟', casts: 5,
    effect: { rarityBonus: 0.25, biteSpeed: 0.35 },
    note: '5 投のあいだ、大漁タイムになる',
  },
  {
    id: 'boss', name: 'ヌシの札', price: 25000, emoji: '👑', casts: 1,
    effect: { minRarity: 'epic', bossBoost: 10 },
    note: '次の 1 投だけ、その釣り場のヌシが出やすくなる',
  },
  {
    id: 'calm', name: '凪の札', price: 40000, emoji: '🌊', casts: 3,
    effect: { calm: true },
    note: '3 投のあいだ、難所の荒れた流れと重さが消える',
  },
  {
    id: 'oracle', name: '神託の札', price: 150000, emoji: '🔮', casts: 1,
    effect: { minRarity: 'legendary', bossBoost: 20 },
    note: '次の 1 投は伝説が確定する。難所のヌシを狙い撃ちできる',
  },
];

export const charmById = (id) => CHARMS.find((c) => c.id === id) || null;

/** 持っている枚数。 */
export const charmCount = (player, id) => Math.max(0, Math.floor(player?.charms?.[id] ?? 0));

/** 買う。何枚でも買える。 */
export function buyCharm(player, id, count = 1) {
  const charm = charmById(id);
  if (!charm) return { ok: false, error: '不明なお札です' };
  const n = Math.max(1, Math.floor(count));
  const cost = charm.price * n;
  if (player.money < cost) {
    return { ok: false, error: `${(cost - player.money).toLocaleString()}円 足りません` };
  }
  player.money -= cost;
  player.charms = { ...player.charms, [id]: charmCount(player, id) + n };
  return { ok: true, charm, count: n, money: player.money };
}

/**
 * 1 枚使う。持っていなければ null。
 * 抽選やファイトに渡すのは charm.effect のほう（charm そのものではない）。
 */
export function useCharm(player, id) {
  const charm = charmById(id);
  if (!charm || charmCount(player, id) < 1) return null;
  player.charms = { ...player.charms, [id]: charmCount(player, id) - 1 };
  return charm;
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
  { id: 'nushi', name: '池の主', emoji: '🐉', spot: 'pond', rarity: 'legendary', weight: [12, 40], length: [110, 210], value: 16000, power: 5, speed: 0.52, escape: 0.56, color: '#3f6f8f' , boss: true, title: '沼の古老', tale: 'この池に何十年も棲みついている' },

  // ------------------------------------------------ 渓流
  { id: 'ayu', name: 'アユ', emoji: '🐟', spot: 'river', rarity: 'common', weight: [0.05, 0.4], length: [12, 30], value: 180, power: 1, speed: 0.48, escape: 0.30, color: '#93a88c' },
  { id: 'yamame', name: 'ヤマメ', emoji: '🐟', spot: 'river', rarity: 'common', weight: [0.08, 0.8], length: [15, 38], value: 240, power: 2, speed: 0.52, escape: 0.34, color: '#8b7f66' },
  { id: 'can', name: '空きカン', emoji: '🥫', spot: 'river', rarity: 'common', weight: [0.02, 0.1], length: [10, 14], value: 8, power: 1, speed: 0.06, escape: 0.10, color: '#8e9aa3', junk: true },
  { id: 'iwana', name: 'イワナ', emoji: '🐟', spot: 'river', rarity: 'uncommon', weight: [0.2, 1.6], length: [20, 52], value: 620, power: 2, speed: 0.46, escape: 0.38, color: '#6f6450' },
  { id: 'nijimasu', name: 'ニジマス', emoji: '🐟', spot: 'river', rarity: 'uncommon', weight: [0.3, 3], length: [25, 70], value: 700, power: 3, speed: 0.54, escape: 0.36, color: '#7f8fb0' },
  { id: 'unagi', name: 'ウナギ', emoji: '🐍', spot: 'river', rarity: 'rare', weight: [0.3, 2.5], length: [40, 120], value: 2600, power: 3, speed: 0.66, escape: 0.44, color: '#4a4a3c' },
  { id: 'sakuramasu', name: 'サクラマス', emoji: '🌸', spot: 'river', rarity: 'rare', weight: [1, 6], length: [40, 78], value: 3000, power: 4, speed: 0.58, escape: 0.42, color: '#c08497' },
  { id: 'ito', name: 'イトウ', emoji: '🐟', spot: 'river', rarity: 'epic', weight: [3, 22], length: [60, 150], value: 9000, power: 4, speed: 0.50, escape: 0.50, color: '#6a7f6a' },
  { id: 'kappa', name: 'カッパの皿', emoji: '🥏', spot: 'river', rarity: 'legendary', weight: [0.2, 1], length: [18, 30], value: 26000, power: 4, speed: 0.86, escape: 0.62, color: '#7fc8a9' , boss: true, title: '川の悪戯', tale: '皿だけが流れてくる。持ち主は誰も見ていない' },

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
  { id: 'kinkurodai', name: '黄金のクロダイ', emoji: '✨', spot: 'harbor', rarity: 'legendary', weight: [3, 12], length: [50, 80], value: 48000, power: 5, speed: 0.60, escape: 0.58, color: '#e8c15a' , boss: true, title: '堤防の主', tale: '月夜にだけ姿を見せる金色の魚' },

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
  { id: 'chouzame', name: 'シロチョウザメ', emoji: '🐊', spot: 'ice', rarity: 'legendary', weight: [40, 400], length: [150, 500], value: 95000, power: 5, speed: 0.46, escape: 0.58, color: '#9aa7a0' , boss: true, title: '氷底の帝王', tale: '氷の下を悠然と泳ぐ古代魚' },

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
  { id: 'kajiki', name: 'クロカジキ', emoji: '🗡️', spot: 'sea', rarity: 'legendary', weight: [60, 500], length: [200, 450], value: 52000, power: 5, speed: 0.70, escape: 0.60, color: '#3d5a7a' , boss: true, title: '海の弾丸', tale: '船を引きずって走ると言われる' },

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
  { id: 'jinbee', name: 'ジンベエザメ', emoji: '🦈', spot: 'island', rarity: 'legendary', weight: [300, 2000], length: [400, 1200], value: 160000, power: 5, speed: 0.44, escape: 0.60, color: '#4a6274' , boss: true, title: '青の巨神', tale: '島の言い伝えに出てくる守り神' },

  // ------------------------------------------------ 地底湖
  { id: 'shirauo', name: 'チカイシラウオ', emoji: '🐟', spot: 'cave', rarity: 'common', weight: [0.01, 0.1], length: [4, 14], value: 2000, power: 1, speed: 0.50, escape: 0.32, color: '#e4e8ee' },
  { id: 'doukutsuebi', name: 'ドウクツヌマエビ', emoji: '🦐', spot: 'cave', rarity: 'common', weight: [0.01, 0.15], length: [3, 12], value: 2400, power: 1, speed: 0.34, escape: 0.34, color: '#e0c9c0' },
  { id: 'stalactite', name: '折れた鍾乳石', emoji: '🪨', spot: 'cave', rarity: 'common', weight: [1, 9], length: [20, 70], value: 60, power: 2, speed: 0.05, escape: 0.12, color: '#8d8477', junk: true },
  { id: 'komori', name: 'コウモリ', emoji: '🦇', spot: 'cave', rarity: 'uncommon', weight: [0.02, 0.3], length: [8, 30], value: 3000, power: 1, speed: 0.78, escape: 0.44, color: '#4a4048' },
  { id: 'blindfish', name: 'メナシウオ', emoji: '🐠', spot: 'cave', rarity: 'uncommon', weight: [0.05, 0.8], length: [8, 26], value: 9000, power: 2, speed: 0.46, escape: 0.40, color: '#f0e6e0' },
  { id: 'sanshouuo', name: 'オオサンショウウオ', emoji: '🦎', spot: 'cave', rarity: 'rare', weight: [3, 30], length: [50, 150], value: 12000, power: 4, speed: 0.24, escape: 0.50, color: '#6a6255' },
  { id: 'kaseki', name: '化石魚', emoji: '🦴', spot: 'cave', rarity: 'rare', weight: [0.5, 8], length: [20, 90], value: 20000, power: 3, speed: 0.30, escape: 0.46, color: '#c9bfa5' },
  { id: 'suishou', name: '水晶のかたまり', emoji: '💎', spot: 'cave', rarity: 'epic', weight: [0.3, 5], length: [10, 40], value: 42000, power: 2, speed: 0.14, escape: 0.40, color: '#a9d8ea' },
  { id: 'chiteiryu', name: '地底湖のヌシ', emoji: '🐲', spot: 'cave', rarity: 'legendary', weight: [30, 200], length: [180, 420], value: 140000, power: 5, speed: 0.56, escape: 0.62, color: '#3f4a5a' , boss: true, title: '闇を統べるもの', tale: '地底湖の底で待っている' },

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
  { id: 'coelacanth', name: 'シーラカンス', emoji: '🐊', spot: 'deep', rarity: 'legendary', weight: [25, 95], length: [110, 200], value: 120000, power: 5, speed: 0.50, escape: 0.62, color: '#4f6f6a' , boss: true, title: '太古の生き証人', tale: '一億年を泳ぎ続けてきた' },

  // ------------------------------------------------ 海底神殿（難所 1）
  { id: 'tenjikudai', name: 'ミヤコテンジクダイ', emoji: '🐠', spot: 'ruin', rarity: 'common', weight: [0.05, 0.6], length: [8, 22], value: 16000, power: 2, speed: 0.58, escape: 0.40, color: '#e8d38a' },
  { id: 'sazanami', name: 'サザナミヤッコ', emoji: '🐠', spot: 'ruin', rarity: 'common', weight: [0.3, 2.4], length: [18, 46], value: 18000, power: 3, speed: 0.54, escape: 0.42, color: '#3f7fa8' },
  { id: 'tablet', name: '割れた石板', emoji: '🪧', spot: 'ruin', rarity: 'common', weight: [2, 14], length: [30, 80], value: 200, power: 3, speed: 0.06, escape: 0.14, color: '#8e8878', junk: true },
  { id: 'yakougai', name: 'ヤコウガイ', emoji: '🐚', spot: 'ruin', rarity: 'uncommon', weight: [0.5, 3], length: [12, 28], value: 22000, power: 2, speed: 0.18, escape: 0.38, color: '#cfe3d0' },
  { id: 'shakogai', name: 'オオシャコガイ', emoji: '🦪', spot: 'ruin', rarity: 'uncommon', weight: [8, 120], length: [40, 130], value: 24000, power: 5, speed: 0.12, escape: 0.44, color: '#b9d8d4' },
  { id: 'ammonite', name: 'アンモナイト', emoji: '🌀', spot: 'ruin', rarity: 'rare', weight: [1, 18], length: [20, 90], value: 30000, power: 4, speed: 0.28, escape: 0.48, color: '#a89060' },
  { id: 'sodeika', name: 'ソデイカ', emoji: '🦑', spot: 'ruin', rarity: 'rare', weight: [5, 40], length: [60, 180], value: 32000, power: 5, speed: 0.62, escape: 0.54, color: '#b06a86' },
  { id: 'tamakai', name: 'タマカイ', emoji: '🐟', spot: 'ruin', rarity: 'epic', weight: [40, 380], length: [120, 280], value: 55000, power: 6, speed: 0.40, escape: 0.56, color: '#5a6a4e' },
  { id: 'goldmask', name: '黄金の面', emoji: '🎭', spot: 'ruin', rarity: 'epic', weight: [1, 9], length: [18, 40], value: 60000, power: 2, speed: 0.16, escape: 0.42, color: '#e4c052' },
  { id: 'wadatsumi', name: 'ワダツミの使い', emoji: '🐉', spot: 'ruin', rarity: 'legendary', weight: [80, 700], length: [250, 700], value: 260000, power: 6, speed: 0.56, escape: 0.62, color: '#2f6f88', boss: true, rages: 2, title: '神殿の門番', tale: '柱のあいだを回りながら、参るものを見定めている' },

  // ------------------------------------------------ 火口湖（難所 2）
  { id: 'hinoko', name: 'ヒノコハゼ', emoji: '🐟', spot: 'crater', rarity: 'common', weight: [0.02, 0.4], length: [6, 20], value: 35000, power: 2, speed: 0.66, escape: 0.44, color: '#e2793f' },
  { id: 'iouuo', name: 'イオウゴケウオ', emoji: '🐡', spot: 'crater', rarity: 'common', weight: [0.2, 2.2], length: [14, 40], value: 38000, power: 3, speed: 0.44, escape: 0.46, color: '#c9b24a' },
  { id: 'slag', name: '溶けた鉄くず', emoji: '🪨', spot: 'crater', rarity: 'common', weight: [3, 25], length: [20, 70], value: 300, power: 3, speed: 0.06, escape: 0.14, color: '#5c5148', junk: true },
  { id: 'magmaebi', name: 'マグマエビ', emoji: '🦐', spot: 'crater', rarity: 'uncommon', weight: [0.1, 1.6], length: [8, 30], value: 46000, power: 3, speed: 0.52, escape: 0.48, color: '#d4543f' },
  { id: 'caldera', name: 'カルデラマス', emoji: '🐟', spot: 'crater', rarity: 'uncommon', weight: [1.5, 16], length: [40, 110], value: 52000, power: 4, speed: 0.60, escape: 0.50, color: '#8a5f57' },
  { id: 'hinokami', name: 'ヒノカミイモリ', emoji: '🦎', spot: 'crater', rarity: 'rare', weight: [2, 26], length: [40, 140], value: 66000, power: 5, speed: 0.34, escape: 0.54, color: '#a33f33' },
  { id: 'kokuyou', name: '黒曜石のかたまり', emoji: '💠', spot: 'crater', rarity: 'rare', weight: [1, 12], length: [12, 50], value: 72000, power: 3, speed: 0.14, escape: 0.44, color: '#2f2a33' },
  { id: 'youganunagi', name: '溶岩ウナギ', emoji: '🐍', spot: 'crater', rarity: 'epic', weight: [3, 40], length: [80, 260], value: 110000, power: 6, speed: 0.78, escape: 0.60, color: '#e05a2a' },
  { id: 'karyuran', name: '火竜の卵', emoji: '🥚', spot: 'crater', rarity: 'epic', weight: [2, 18], length: [16, 48], value: 130000, power: 3, speed: 0.20, escape: 0.46, color: '#f0a24a' },
  { id: 'enrin', name: '炎鱗', emoji: '🐲', spot: 'crater', rarity: 'legendary', weight: [120, 900], length: [300, 800], value: 520000, power: 7, speed: 0.60, escape: 0.64, color: '#b83a22', boss: true, rages: 2, title: '火口の主', tale: '湖の底でとぐろを巻き、湯を沸かし続けている' },

  // ------------------------------------------------ 奈落の淵（難所 3）
  { id: 'narakuhadaka', name: 'ナラクハダカ', emoji: '🐟', spot: 'abyss', rarity: 'common', weight: [0.05, 0.9], length: [8, 26], value: 80000, power: 3, speed: 0.62, escape: 0.48, color: '#5a6f7f' },
  { id: 'yomikurage', name: 'ヨミノクラゲ', emoji: '🎐', spot: 'abyss', rarity: 'common', weight: [0.3, 8], length: [20, 120], value: 90000, power: 3, speed: 0.30, escape: 0.52, color: '#9a7fc0' },
  { id: 'rustanchor', name: '錆びた錨', emoji: '⚓', spot: 'abyss', rarity: 'common', weight: [20, 200], length: [80, 240], value: 500, power: 4, speed: 0.05, escape: 0.16, color: '#6b5a4a', junk: true },
  { id: 'gusokumushi', name: 'シンカイオオグソクムシ', emoji: '🦟', spot: 'abyss', rarity: 'uncommon', weight: [0.5, 5], length: [15, 55], value: 120000, power: 4, speed: 0.36, escape: 0.50, color: '#b2a189' },
  { id: 'fukaebi', name: 'フカミノエビ', emoji: '🦐', spot: 'abyss', rarity: 'uncommon', weight: [0.3, 4], length: [12, 46], value: 140000, power: 4, speed: 0.58, escape: 0.52, color: '#d06a70' },
  { id: 'yoroizame', name: 'ヨロイザメ', emoji: '🦈', spot: 'abyss', rarity: 'rare', weight: [15, 160], length: [120, 320], value: 180000, power: 6, speed: 0.58, escape: 0.58, color: '#3f4650' },
  { id: 'narakuhoshi', name: '奈落の星', emoji: '💫', spot: 'abyss', rarity: 'rare', weight: [0.5, 9], length: [14, 60], value: 200000, power: 3, speed: 0.24, escape: 0.50, color: '#8fb6e0' },
  { id: 'krakenarm', name: 'クラーケンの腕', emoji: '🦑', spot: 'abyss', rarity: 'epic', weight: [60, 900], length: [300, 1400], value: 320000, power: 7, speed: 0.66, escape: 0.62, color: '#7a3f66' },
  { id: 'sunkencrown', name: '沈んだ王冠', emoji: '👑', spot: 'abyss', rarity: 'epic', weight: [0.5, 6], length: [14, 36], value: 380000, power: 2, speed: 0.18, escape: 0.44, color: '#efd06a' },
  { id: 'narakunushi', name: '奈落の主', emoji: '👁️', spot: 'abyss', rarity: 'legendary', weight: [400, 4000], length: [500, 1800], value: 1200000, power: 7, speed: 0.64, escape: 0.66, color: '#241f33', boss: true, rages: 2, title: '淵をのぞく者', tale: 'のぞきこんだ者を、底からのぞき返しているという' },
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
  rng = Math.random, rod, lure, timeIndex = 1, gear = NO_GEAR,
  weather = null, event = null, charm = null,
} = {}) {
  const all = fishOfSpot(spotId);
  if (!all.length) throw new Error(`unknown spot: ${spotId}`);

  // ヌシの気配やお札のときはレア以上しか掛からない
  const minRarity = charm?.minRarity ?? event?.minRarity;
  const floor = minRarity ? RARITY_ORDER.indexOf(minRarity) : -1;
  const rareOnly = floor >= 0
    ? all.filter((f) => !f.junk && RARITY_ORDER.indexOf(f.rarity) >= floor)
    : [];
  const candidates = rareOnly.length ? rareOnly : all;

  const time = timeAt(timeIndex);
  const mods = [lure, time, gear, weather, event, charm];
  const bonus = sumOf('rarityBonus', mods);
  const junkCut = clamp(sumOf('junkCut', mods), 0, 0.95);
  const power = rod?.power ?? 1;
  const bossBoost = sumOf('bossBoost', mods);

  const weights = candidates.map((f) => {
    let w = RARITY[f.rarity].weight;
    // レア度が高いほどボーナスが強く乗る
    w *= Math.pow(1 + bonus, RARITY_ORDER.indexOf(f.rarity));
    w *= lure?.spotBonus?.[f.spot] ?? 1;
    if (f.junk) w *= Math.max(0.05, 1 - junkCut);
    // 竿に対して強すぎる魚は掛かりにくい（掛かっても切られる）
    if (f.power > power + 1) w *= 0.3;
    // ヌシの札を使っているとボスが寄ってくる
    if (f.boss && bossBoost > 0) w *= bossBoost;
    return w;
  });

  const fish = weightedPick(candidates, weights, rng);
  // 大物ほど出にくいように偏らせる。ボーナスや荒天だとやや大物寄り
  const sizeRatio = Math.pow(rng(), Math.max(0.6, 2.3 - bonus * 0.8 - (weather?.bigSize ?? 0) * 2));
  const weightKg = round2(lerp(fish.weight[0], fish.weight[1], sizeRatio));
  const lengthCm = Math.round(lerp(fish.length[0], fish.length[1], sizeRatio));
  // まれに光った個体が掛かる。ゴミは光らない
  const shinyRate = clamp(SHINY.rate * (1 + sumOf('shinyBonus', mods)), 0, 0.5);
  const shiny = !fish.junk && rng() < shinyRate;
  const price = Math.max(1, Math.round(
    priceOf(fish, weightKg) * (1 + (gear.sell ?? 0)) * (shiny ? SHINY.priceMult : 1),
  ));
  return { fish, weightKg, lengthCm, sizeRatio, price, shiny };
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
  lure, timeIndex = 1, gear = NO_GEAR, weather = null, event = null, charm = null, spot = null,
} = {}) {
  // 難所は biteBonus がマイナスなので、そのぶんアタリが渋くなる
  const place = charm?.calm ? null : (typeof spot === 'string' ? spotById(spot) : spot);
  const mods = [lure, timeAt(timeIndex), gear, weather, event, charm, place];
  // 「アタリの速さ」の呼び名がデータによって違うので、両方を足す
  const speed = clamp(sumOf('biteSpeed', mods) + sumOf('biteBonus', mods), -0.3, 0.85);
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
  constructor({
    fish, rod, sizeRatio = 0.5, rng = Math.random, gear = NO_GEAR,
    weather = null, charm = null, spot = null,
  }) {
    this.fish = fish;
    // 道具のぶんを足した竿として扱う（描画側は rod をそのまま見ればよい）
    this.rod = {
      ...rod,
      reel: rod.reel + (gear.reel ?? 0),
      line: rod.line + (gear.line ?? 0),
      barH: Math.min(0.5, rod.barH + (gear.barH ?? 0)),
    };
    this.rng = rng;
    // 難所の補正。凪の札を使っているあいだは荒れがおさまる（魚の重さ自体は変わらない）
    const calm = Boolean(charm?.calm);
    const raw = spotHazard(spot);
    const hazard = calm ? { ...spotHazard(null), tough: raw.tough } : raw;
    this.calm = calm;
    this.hard = Number((typeof spot === 'string' ? spotById(spot) : spot)?.hard ?? 0);
    // 寄せにくさ。難所の魚は重く、ヌシはさらに倍かかる
    this.tough = Math.max(1, hazard.tough * (fish.tough ?? 1) * (fish.boss ? 2 : 1));
    // 大物ほど強い＆重い
    this.power = fish.power + sizeRatio * 0.9;
    this.speed = fish.speed * (0.85 + sizeRatio * 0.45) * hazard.fishSpeed;
    this.escapeRate = fish.escape * (0.85 + sizeRatio * 0.35) * (1 - clamp(gear.escapeCut ?? 0, 0, 0.6));
    // 荒れた日と難所ほどラインに負荷がかかる
    this.stress = 1 + clamp((weather?.stress ?? 0) + hazard.stress, 0, 1.8);
    // 潮に流されて、寄せがじりじり戻る。アンカーで抑えられる
    this.drift = Math.max(0, hazard.drift - (gear.driftCut ?? 0));
    // 安全ピンの札を使っていれば、負荷がたまっても切れない
    this.noSnap = Boolean(charm?.noSnap);

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

    // ボスは途中で本気を出す。難所のヌシは二段構え
    this.boss = Boolean(fish.boss);
    this.rages = this.boss ? (Fight.RAGE_STEPS[fish.rages ?? 1] ?? [Fight.ENRAGE_AT]) : [];
    this.rageLevel = 0;         // 何段階まで暴れたか
    this.enraged = false;
    this.justEnraged = false;   // 演出側が 1 回だけ拾うための合図
  }

  /** ボスが暴れ出す寄せ具合。 */
  static get ENRAGE_AT() { return 0.55; }

  /** 段数ごとの、暴れ出す寄せ具合。 */
  static get RAGE_STEPS() { return { 1: [0.55], 2: [0.38, 0.72] }; }

  /** 暴れるたびの速さの倍率。二段目は少し控えめ。 */
  static get RAGE_BOOST() { return [1.45, 1.25]; }

  /** バーの上端・下端（描画用）。 */
  get barTop() { return clamp(this.barY - this.barH / 2, 0, 1); }
  get barBottom() { return clamp(this.barY + this.barH / 2, 0, 1); }

  /**
   * @param {number} dt      経過秒（0.05 で頭打ちにしておくと重い端末でも壊れない）
   * @param {boolean} holding リールを巻いているか
   */
  update(dt, holding) {
    this.justEnraged = false;
    if (this.phase !== FIGHT.fighting) return this.phase;
    const step = Math.min(dt, 0.05);
    this.time += step;

    // ボスは寄せられると暴れ出す。速く、逃げ足も強くなる
    if (this.rageLevel < this.rages.length && this.progress >= this.rages[this.rageLevel]) {
      const boost = Fight.RAGE_BOOST[this.rageLevel] ?? 1.25;
      this.rageLevel += 1;
      this.enraged = true;
      this.justEnraged = true;
      this.speed *= boost;
      this.escapeRate *= 1 + (boost - 1) * 0.78;
      this.nextMove = 0;
    }

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
      this.progress += (this.rod.reel / this.tough) * step;
      this.strain += Math.max(0, this.power - this.rod.power) * 0.5 * this.stress / this.rod.line * step;
    } else {
      // 重い魚は寄せるのも遅いが、離されるのも遅い
      this.progress -= (this.escapeRate * 0.55 / Math.sqrt(this.tough)) * step;
      this.strain -= 0.55 * step;
    }
    // 難所の流れ。捉えていてもじりじり押し戻される
    if (this.drift) this.progress -= this.drift * step;
    this.progress = clamp(this.progress, 0, 1);
    this.strain = clamp(this.strain, 0, 1);

    if (this.noSnap) this.strain = Math.min(this.strain, 0.97);
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
    charms: {},   // お札の枚数
    rod: 'nobe',
    lure: 'worm',
    spot: 'pond',
    timeIndex: 0,
    weather: 'sunny',
    weatherLeft: 0,
    casts: 0,
    catches: 0,
    earned: 0,
    records: {},   // fishId -> { count, weightKg, lengthCm, price }
    shinies: {},   // きらめき個体だけの図鑑（同じ形）
    xp: 0,         // 熟練度
    achieved: [],  // 達成した実績の id
    title: null,   // つけている称号
    dailyDone: 0,  // お題をこなした回数
    weathersSeen: [],   // 釣ったことのある天気
    best: { price: 0, lengthCm: 0, weightKg: 0 },
    daily: { date: '', seen: '', quests: [] },
    tutorial: { step: 0, done: false },   // はじめての案内
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
  const lock = kind === 'spot' ? spotLocked(player, item) : null;
  if (lock) return { ok: false, error: `${lock.name}を釣ると開きます` };
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
 * きらめき個体は、ふつうの図鑑とは別の枠にも残る。
 */
export function recordCatch(player, result, { weather = null } = {}) {
  player.catches += 1;
  recordBest(player, result, weather);
  if (result.shiny) {
    player.shinies = player.shinies || {};
    const prevShiny = player.shinies[result.fish.id];
    if (!prevShiny) {
      player.shinies[result.fish.id] = {
        count: 1, weightKg: result.weightKg, lengthCm: result.lengthCm, price: result.price,
      };
    } else {
      prevShiny.count += 1;
      if (result.weightKg > prevShiny.weightKg) {
        prevShiny.weightKg = result.weightKg;
        prevShiny.lengthCm = result.lengthCm;
        prevShiny.price = result.price;
      }
    }
  }
  const prev = player.records[result.fish.id];
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

/** 実績とお題で使う、通しの自己ベスト。 */
function recordBest(player, result, weather) {
  const best = player.best || (player.best = { price: 0, lengthCm: 0, weightKg: 0 });
  best.price = Math.max(best.price ?? 0, result.price ?? 0);
  best.lengthCm = Math.max(best.lengthCm ?? 0, result.lengthCm ?? 0);
  best.weightKg = Math.max(best.weightKg ?? 0, result.weightKg ?? 0);
  const id = typeof weather === 'string' ? weather : weather?.id;
  if (id && weatherById(id).id === id) {
    player.weathersSeen = player.weathersSeen || [];
    if (!player.weathersSeen.includes(id)) player.weathersSeen.push(id);
  }
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
    charms: Object.fromEntries(
      Object.entries(raw.charms || {})
        .filter(([id, n]) => charmById(id) && Number.isFinite(n) && n > 0)
        .map(([id, n]) => [id, Math.min(99, Math.floor(n))]),
    ),
    timeIndex: Number.isFinite(raw.timeIndex) ? Math.floor(raw.timeIndex) : 0,
    weather: WEATHERS.some((w) => w.id === raw.weather) ? raw.weather : 'sunny',
    weatherLeft: Number.isFinite(raw.weatherLeft) ? clamp(Math.floor(raw.weatherLeft), 0, 20) : 0,
    casts: Number.isFinite(raw.casts) ? raw.casts : 0,
    catches: Number.isFinite(raw.catches) ? raw.catches : 0,
    earned: Number.isFinite(raw.earned) ? raw.earned : 0,
    xp: Number.isFinite(raw.xp) ? Math.max(0, Math.floor(raw.xp)) : 0,
    dailyDone: Number.isFinite(raw.dailyDone) ? Math.max(0, Math.floor(raw.dailyDone)) : 0,
    achieved: Array.isArray(raw.achieved) ? raw.achieved.filter((id) => achievementById(id)) : [],
    weathersSeen: Array.isArray(raw.weathersSeen)
      ? raw.weathersSeen.filter((id) => WEATHERS.some((w) => w.id === id))
      : [],
    best: {
      price: Math.max(0, Math.round(Number(raw.best?.price) || 0)),
      lengthCm: Math.max(0, Math.round(Number(raw.best?.lengthCm) || 0)),
      weightKg: Math.max(0, Number(raw.best?.weightKg) || 0),
    },
    records: {},
    shinies: {},
    daily: { date: '', seen: '', quests: [] },
    tutorial: {
      step: clamp(Math.floor(Number(raw.tutorial?.step) || 0), 0, TUTORIAL.length),
      done: Boolean(raw.tutorial?.done),
      hooked: Boolean(raw.tutorial?.hooked),
      sawQuest: Boolean(raw.tutorial?.sawQuest),
    },
  };
  const readBook = (raw2, into) => {
    for (const [id, rec] of Object.entries(raw2 || {})) {
      if (!fishById(id) || !rec || typeof rec !== 'object') continue;
      into[id] = {
        count: Math.max(1, Math.floor(rec.count) || 1),
        weightKg: Number(rec.weightKg) || 0,
        lengthCm: Math.round(Number(rec.lengthCm) || 0),
        price: Math.round(Number(rec.price) || 0),
      };
    }
  };
  readBook(raw.records, player.records);
  readBook(raw.shinies, player.shinies);

  // 称号は、実績を持っているときだけ有効
  player.title = earnedTitles(player).includes(raw.title) ? raw.title : null;

  // 今日のお題。日付が違えば、あとで引き直される
  const quests = Array.isArray(raw.daily?.quests) ? raw.daily.quests : [];
  player.daily = {
    date: typeof raw.daily?.date === 'string' ? raw.daily.date : '',
    seen: typeof raw.daily?.seen === 'string' ? raw.daily.seen : (raw.daily?.date ?? ''),
    quests: quests
      .filter((q) => q && DAILY_KINDS.some((k) => k.id === q.kind) && Number.isFinite(q.goal))
      .map((q) => ({
        kind: q.kind,
        label: String(q.label ?? ''),
        goal: Math.max(1, Math.round(q.goal)),
        progress: Math.max(0, Math.round(Number(q.progress) || 0)),
        done: Boolean(q.done),
        reward: Math.max(0, Math.round(Number(q.reward) || 0)),
        ...(q.spot ? { spot: String(q.spot) } : {}),
        ...(q.rarity ? { rarity: String(q.rarity) } : {}),
      })),
  };
  player.rod = player.rods.includes(raw.rod) ? raw.rod : player.rods[player.rods.length - 1];
  player.lure = player.lures.includes(raw.lure) ? raw.lure : player.lures[player.lures.length - 1];
  player.spot = player.spots.includes(raw.spot) ? raw.spot : player.spots[player.spots.length - 1];
  return player;
}

// ---------------------------------------------------------------- きらめき個体

/**
 * まれに掛かる、光った個体。
 * 値段も経験値も跳ね上がり、図鑑にはふつうの記録とは別に残る。
 */
export const SHINY = {
  rate: 1 / 120,
  priceMult: 5,
  xpMult: 3,
  label: 'きらめき',
  emoji: '✨',
};

/** きらめき個体を何種つかまえたか。 */
export const shinyKinds = (player) => Object.keys(player?.shinies ?? {}).length;

// ---------------------------------------------------------------- 熟練度（釣り人ランク）

/**
 * 釣るほどたまる経験値でランクが上がる。
 * ランクの効果は道具と同じ枠に足されるので、遊び続けるほど少しずつ楽になる。
 */
export const RANKS = [
  { level: 1, name: '見習い', need: 0 },
  { level: 2, name: '駆け出し', need: 60 },
  { level: 3, name: '一人前', need: 180 },
  { level: 4, name: '常連', need: 400 },
  { level: 5, name: '腕利き', need: 800 },
  { level: 6, name: '玄人', need: 1500 },
  { level: 7, name: '手練れ', need: 2600 },
  { level: 8, name: '達人', need: 4200 },
  { level: 9, name: '匠', need: 6500 },
  { level: 10, name: '名人', need: 9800 },
  { level: 11, name: '豪腕', need: 14500 },
  { level: 12, name: '剛の者', need: 21000 },
  { level: 13, name: '海を知る者', need: 30000 },
  { level: 14, name: '竿の聖', need: 42000 },
  { level: 15, name: '釣仙人', need: 58000 },
  { level: 16, name: '魚見の眼', need: 80000 },
  { level: 17, name: '龍を釣る者', need: 110000 },
  { level: 18, name: '深淵の漁夫', need: 150000 },
  { level: 19, name: '伝説の釣り人', need: 210000 },
  { level: 20, name: '釣聖', need: 300000 },
];

export const MAX_RANK = RANKS[RANKS.length - 1].level;

/** 1 匹ぶんの経験値。レア度と大きさ、ヌシ・きらめきで増える。 */
export function xpFor(result) {
  const fish = result?.fish;
  if (!fish) return 0;
  if (fish.junk) return 1;
  const base = { common: 10, uncommon: 25, rare: 60, epic: 150, legendary: 500 }[fish.rarity] ?? 10;
  const size = 1 + (result.sizeRatio ?? 0.5);
  const boss = fish.boss ? 2 : 1;
  const shiny = result.shiny ? SHINY.xpMult : 1;
  return Math.max(1, Math.round(base * size * boss * shiny));
}

/** その経験値でのランク。 */
export function rankAt(xp) {
  const total = Math.max(0, Number(xp) || 0);
  let rank = RANKS[0];
  for (const r of RANKS) if (total >= r.need) rank = r;
  return rank;
}

export const rankOf = (player) => rankAt(player?.xp ?? 0);

/** 次のランク（最高位なら null）。 */
export function nextRank(xp) {
  const now = rankAt(xp);
  return RANKS.find((r) => r.level === now.level + 1) ?? null;
}

/** いまのランクの中での進み具合（0..1）。最高位なら 1。 */
export function rankProgress(xp) {
  const total = Math.max(0, Number(xp) || 0);
  const now = rankAt(total);
  const next = nextRank(total);
  if (!next) return 1;
  return clamp((total - now.need) / (next.need - now.need), 0, 1);
}

/**
 * ランクによる恒久ボーナス。道具の効果と同じ形で返す。
 * 1 段ごとに少しずつなので、序盤の手触りは変えずに、長く遊ぶほど効いてくる。
 */
export function rankEffects(player) {
  const step = rankOf(player).level - 1;
  return {
    ...NO_GEAR,
    sell: step * 0.01,
    rarityBonus: step * 0.005,
    biteSpeed: step * 0.005,
    line: step * 0.03,
    shinyBonus: step * 0.03,
  };
}

/** 道具とランクを合わせた、いま効いている効果の合計。 */
export function totalEffects(player) {
  const gear = gearEffects(player);
  const rank = rankEffects(player);
  const total = { ...NO_GEAR };
  for (const key of Object.keys(total)) total[key] = (gear[key] ?? 0) + (rank[key] ?? 0);
  return total;
}

/** 経験値を足す。ランクが上がったかどうかも返す。 */
export function gainXp(player, result) {
  const before = rankOf(player);
  const gained = xpFor(result);
  player.xp = Math.max(0, (player.xp ?? 0) + gained);
  const after = rankOf(player);
  return { gained, rank: after, leveledUp: after.level > before.level };
}

// ---------------------------------------------------------------- 実績と称号

const countRecords = (player, match) =>
  FISH.filter((f) => match(f) && player?.records?.[f.id]).length;

const completeSpots = (player) =>
  SPOTS.filter((s) => {
    const prog = collectionProgress(player, s.id);
    return prog.total > 0 && prog.found === prog.total;
  }).length;

/**
 * やりこみの目印。value(player) が goal に届くと達成。
 * reward は賞金、title があると称号が増える（実績の画面でつけかえられる）。
 */
export const ACHIEVEMENTS = [
  // ---- 釣った数
  { id: 'first', icon: '🎣', name: 'はじめの一匹', note: '1 匹釣る', goal: 1, reward: 300, value: (p) => p.catches },
  { id: 'catch100', icon: '🐟', name: '百匹釣り', note: '100 匹釣る', goal: 100, reward: 5000, value: (p) => p.catches },
  { id: 'catch1000', icon: '🐠', name: '千匹釣り', note: '1000 匹釣る', goal: 1000, reward: 120000, title: '千匹の主', value: (p) => p.catches },
  { id: 'cast500', icon: '💪', name: '投げ続けて 500 回', note: '500 回キャストする', goal: 500, reward: 20000, value: (p) => p.casts },

  // ---- 図鑑
  { id: 'book10', icon: '📖', name: '図鑑 10 種', note: '10 種を図鑑に載せる', goal: 10, reward: 1500, value: (p) => Object.keys(p.records).length },
  { id: 'book40', icon: '📗', name: '図鑑 40 種', note: '40 種を図鑑に載せる', goal: 40, reward: 25000, value: (p) => Object.keys(p.records).length },
  { id: 'book80', icon: '📘', name: '図鑑 80 種', note: '80 種を図鑑に載せる', goal: 80, reward: 150000, title: '記録係', value: (p) => Object.keys(p.records).length },
  { id: 'bookAll', icon: '📚', name: '図鑑コンプリート', note: `全 ${FISH.length} 種を図鑑に載せる`, goal: FISH.length, reward: 2000000, title: '図鑑の主', value: (p) => Object.keys(p.records).length },
  { id: 'spotComplete', icon: '🏅', name: 'ひと釣り場を完全制覇', note: 'どこか 1 か所の魚をすべて釣る', goal: 1, reward: 30000, value: completeSpots },
  { id: 'spotAll', icon: '🏆', name: '全釣り場を完全制覇', note: '11 か所すべての魚を釣りきる', goal: SPOTS.length, reward: 3000000, title: '水辺の王', value: completeSpots },

  // ---- ヌシ
  { id: 'boss1', icon: '👑', name: 'はじめてのヌシ', note: 'ヌシを 1 体釣る', goal: 1, reward: 8000, value: (p) => countRecords(p, (f) => f.boss) },
  { id: 'boss5', icon: '👑', name: 'ヌシ狩り', note: 'ヌシを 5 体釣る', goal: 5, reward: 60000, value: (p) => countRecords(p, (f) => f.boss) },
  { id: 'bossAll', icon: '🐉', name: '全ヌシ制覇', note: '11 体のヌシをすべて釣る', goal: SPOTS.length, reward: 1500000, title: 'ヌシ狩り', value: (p) => countRecords(p, (f) => f.boss) },

  // ---- 難所
  { id: 'hardVisit', icon: '🏛️', name: '難所へ踏み込む', note: '難所の釣り場へ行く', goal: 1, reward: 20000, value: (p) => p.spots.filter((id) => isHardSpot(spotById(id))).length },
  { id: 'hardBoss', icon: '🕳️', name: '奈落の主を釣る', note: '奈落の淵のヌシを釣る', goal: 1, reward: 1000000, title: '淵をのぞいた者', value: (p) => (p.records.narakunushi ? 1 : 0) },
  { id: 'hardBook', icon: '🌋', name: '難所の魚 20 種', note: '難所の魚を 20 種釣る', goal: 20, reward: 400000, value: (p) => countRecords(p, (f) => isHardSpot(spotById(f.spot))) },

  // ---- きらめき
  { id: 'shiny1', icon: '✨', name: 'はじめてのきらめき', note: 'きらめき個体を 1 種釣る', goal: 1, reward: 10000, value: shinyKinds },
  { id: 'shiny10', icon: '✨', name: 'きらめき 10 種', note: 'きらめき個体を 10 種釣る', goal: 10, reward: 120000, value: shinyKinds },
  { id: 'shiny30', icon: '🌈', name: 'きらめき 30 種', note: 'きらめき個体を 30 種釣る', goal: 30, reward: 800000, title: '虹を釣る者', value: shinyKinds },

  // ---- お金と大物
  { id: 'earn10k', icon: '💰', name: '売上 1 万円', note: '通算 10,000 円ぶん売る', goal: 10000, reward: 2000, value: (p) => p.earned },
  { id: 'earn1m', icon: '💰', name: '売上 100 万円', note: '通算 1,000,000 円ぶん売る', goal: 1000000, reward: 80000, value: (p) => p.earned },
  { id: 'earn100m', icon: '🏦', name: '売上 1 億円', note: '通算 100,000,000 円ぶん売る', goal: 100000000, reward: 5000000, title: '長者', value: (p) => p.earned },
  { id: 'big10k', icon: '🎏', name: '一匹 1 万円', note: '1 匹で 10,000 円の魚を釣る', goal: 10000, reward: 5000, value: (p) => p.best?.price ?? 0 },
  { id: 'big1m', icon: '🎇', name: '一匹 100 万円', note: '1 匹で 1,000,000 円の魚を釣る', goal: 1000000, reward: 300000, title: '大物師', value: (p) => p.best?.price ?? 0 },
  { id: 'long200', icon: '📏', name: '全長 2 メートル', note: '200cm 以上の魚を釣る', goal: 200, reward: 12000, value: (p) => p.best?.lengthCm ?? 0 },
  { id: 'long500', icon: '📐', name: '全長 5 メートル', note: '500cm 以上の魚を釣る', goal: 500, reward: 200000, value: (p) => p.best?.lengthCm ?? 0 },

  // ---- 天気とそろえもの
  { id: 'weatherAll', icon: '🌈', name: '晴れの日も嵐の日も', note: '5 種類すべての天気で釣る', goal: WEATHERS.length, reward: 40000, value: (p) => (p.weathersSeen ?? []).length },
  { id: 'rodAll', icon: '🎣', name: '竿をすべてそろえる', note: `竿 ${RODS.length} 本を買う`, goal: RODS.length, reward: 150000, value: (p) => p.rods.length },
  { id: 'lureAll', icon: '🪝', name: 'ルアーをすべてそろえる', note: `ルアー ${LURES.length} 個を買う`, goal: LURES.length, reward: 150000, value: (p) => p.lures.length },
  { id: 'gearAll', icon: '🧰', name: '道具をすべてそろえる', note: `道具 ${GEAR.length} 種を買う`, goal: GEAR.length, reward: 250000, title: '道具自慢', value: (p) => p.gears.length },

  // ---- ランクとお題
  { id: 'rank5', icon: '⭐', name: 'ランク 5', note: '熟練度を 5 まで上げる', goal: 5, reward: 8000, value: (p) => rankOf(p).level },
  { id: 'rank10', icon: '🌟', name: 'ランク 10', note: '熟練度を 10 まで上げる', goal: 10, reward: 100000, value: (p) => rankOf(p).level },
  { id: 'rank20', icon: '💫', name: '釣聖', note: '熟練度を 20 まで上げる', goal: MAX_RANK, reward: 3000000, title: '釣聖', value: (p) => rankOf(p).level },
  { id: 'daily10', icon: '📅', name: 'お題 10 回', note: '日替わりのお題を 10 回こなす', goal: 10, reward: 30000, value: (p) => p.dailyDone ?? 0 },
  { id: 'daily50', icon: '🗓️', name: 'お題 50 回', note: '日替わりのお題を 50 回こなす', goal: 50, reward: 400000, title: '皆勤', value: (p) => p.dailyDone ?? 0 },
];

export const achievementById = (id) => ACHIEVEMENTS.find((a) => a.id === id) || null;

/** 達成ぐあい。0..1 と、いまの値・目標をまとめて返す。 */
export function achievementState(player, achievement) {
  const value = Math.max(0, Number(achievement.value(player)) || 0);
  const done = (player.achieved ?? []).includes(achievement.id);
  return { value, goal: achievement.goal, ratio: clamp(value / achievement.goal, 0, 1), done };
}

/**
 * 達成したものを拾って、賞金を渡す。新しく達成したものだけを返す。
 * 賞金でさらに別の実績が開くことがあるので、増えなくなるまで回す。
 */
export function checkAchievements(player) {
  player.achieved = player.achieved ?? [];
  const unlocked = [];
  for (let pass = 0; pass < 3; pass++) {
    let added = 0;
    for (const a of ACHIEVEMENTS) {
      if (player.achieved.includes(a.id)) continue;
      if (achievementState(player, a).value < a.goal) continue;
      player.achieved.push(a.id);
      player.money += a.reward;
      unlocked.push(a);
      added++;
    }
    if (!added) break;
  }
  return unlocked;
}

/** 手に入れている称号。 */
export const earnedTitles = (player) =>
  ACHIEVEMENTS.filter((a) => a.title && (player?.achieved ?? []).includes(a.id)).map((a) => a.title);

/** 称号をつける。持っていなければ何もしない（null は「外す」）。 */
export function setTitle(player, title) {
  if (title === null) { player.title = null; return true; }
  if (!earnedTitles(player).includes(title)) return false;
  player.title = title;
  return true;
}

// ---------------------------------------------------------------- 日替わりのお題

/** 文字列から種を作る（同じ日なら同じお題になるように）。 */
function seedOf(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** その日の鍵。端末の日付をそのまま使う。 */
export function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * お題の種類。make() がその日のお題を組み立てる。
 * 行ける釣り場に合わせて中身と賞金を変えるので、序盤でも無理な注文は出ない。
 */
export const DAILY_KINDS = [
  {
    id: 'count',
    make: (rng, ctx) => {
      const spot = ctx.spots[Math.floor(rng() * ctx.spots.length)];
      const goal = 3 + Math.floor(rng() * 4);
      return { goal, spot: spot.id, label: `${spot.name}で ${goal} 匹釣る` };
    },
  },
  {
    id: 'rarity',
    make: (rng, ctx) => {
      const rarity = ctx.tier >= 6 ? 'epic' : ctx.tier >= 3 ? 'rare' : 'uncommon';
      const goal = rarity === 'epic' ? 1 + Math.floor(rng() * 2) : 2 + Math.floor(rng() * 3);
      return { goal, rarity, label: `${RARITY[rarity].label}以上を ${goal} 匹釣る` };
    },
  },
  {
    id: 'sell',
    make: (rng, ctx) => {
      const goal = Math.round(ctx.unit * (6 + Math.floor(rng() * 6)));
      return { goal, label: `${goal.toLocaleString('ja-JP')}円ぶん売る` };
    },
  },
  {
    id: 'size',
    make: (rng, ctx) => {
      const goal = Math.round(ctx.big * (0.45 + rng() * 0.25) / 10) * 10;
      return { goal, label: `${goal}cm 以上の魚を釣る` };
    },
  },
  {
    id: 'casts',
    make: (rng) => {
      const goal = 12 + Math.floor(rng() * 13);
      return { goal, label: `${goal} 回キャストする` };
    },
  },
  {
    id: 'boss',
    need: (ctx) => ctx.tier >= 4,
    make: () => ({ goal: 1, label: 'ヌシを 1 体釣る' }),
  },
  {
    id: 'shiny',
    need: (ctx) => ctx.tier >= 2,
    make: () => ({ goal: 1, label: 'きらめき個体を 1 匹釣る' }),
  },
  {
    id: 'junk',
    make: (rng) => {
      const goal = 2 + Math.floor(rng() * 3);
      return { goal, label: `ゴミを ${goal} 個拾って水をきれいにする` };
    },
  },
];

export const DAILY_COUNT = 3;

/** その日のお題を 3 つ引く。同じ日・同じ持ち物なら、何度引いても同じものが出る。 */
export function rollDailies(dateKey, player) {
  const owned = SPOTS.filter((s) => (player?.spots ?? ['pond']).includes(s.id));
  const spots = owned.length ? owned : [SPOTS[0]];
  const tier = SPOTS.indexOf(spots[spots.length - 1]);
  const fishHere = spots.flatMap((s) => fishOfSpot(s.id)).filter((f) => !f.junk);
  const ctx = {
    spots,
    tier,
    // 賞金と売上のお題は、いちばん奥の釣り場の相場に合わせる
    unit: Math.max(200, Math.round(median(fishHere.map((f) => f.value)) * 2)),
    // ヌシは別格なので、大きさのお題はふつうの魚で届く範囲にする
    big: Math.max(40, Math.max(...fishHere.filter((f) => !f.boss).map((f) => f.length[1]))),
  };
  const rng = mulberry32(seedOf(`${dateKey}#${tier}`));
  const pool = DAILY_KINDS.filter((k) => !k.need || k.need(ctx));
  const quests = [];
  const used = new Set();
  let guard = 0;
  while (quests.length < DAILY_COUNT && guard++ < 50) {
    const kind = pool[Math.floor(rng() * pool.length)];
    if (used.has(kind.id)) continue;
    used.add(kind.id);
    const made = kind.make(rng, ctx);
    quests.push({
      kind: kind.id, progress: 0, done: false,
      reward: rewardFor(kind.id, made, ctx),
      ...made,
    });
  }
  return quests;
}

const median = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/** お題の賞金。手間の重さと、いまの釣り場の相場で決める。 */
function rewardFor(kindId, made, ctx) {
  const weight = {
    count: 1.4, rarity: 1.8, sell: 1.2, size: 1.6, casts: 1.0, boss: 4, shiny: 4, junk: 1.1,
  }[kindId] ?? 1;
  return Math.max(300, Math.round(ctx.unit * weight * 2 / 100) * 100);
}

/**
 * 日付が変わっていたらお題を引き直す。引き直したら true。
 * 端末の時計を戻しても引き直さない（賞金を何度ももらえてしまうため）。
 */
export function refreshDaily(player, dateKey = todayKey()) {
  const daily = player.daily;
  const seen = daily?.seen || daily?.date || '';
  const has = Array.isArray(daily?.quests) && daily.quests.length > 0;
  if (has && dateKey <= seen) return false;
  player.daily = {
    date: dateKey,
    seen: dateKey > seen ? dateKey : seen,
    quests: rollDailies(dateKey, player),
  };
  return true;
}

/**
 * お題の進みを足す。
 * event は { type: 'cast' } / { type: 'catch', result, spot } / { type: 'sell', price }。
 * 達成したお題は賞金を渡して、そのぶんを返す。
 */
export function progressDaily(player, event) {
  const quests = player.daily?.quests;
  if (!Array.isArray(quests)) return [];
  const done = [];
  for (const q of quests) {
    if (q.done) continue;
    const before = q.progress;
    if (event.type === 'cast' && q.kind === 'casts') q.progress += 1;
    if (event.type === 'sell' && q.kind === 'sell') q.progress += Math.max(0, event.price ?? 0);
    if (event.type === 'catch') {
      const fish = event.result?.fish;
      if (!fish) continue;
      if (q.kind === 'count' && fish.spot === q.spot && !fish.junk) q.progress += 1;
      if (q.kind === 'junk' && fish.junk) q.progress += 1;
      if (q.kind === 'rarity' && !fish.junk
        && RARITY_ORDER.indexOf(fish.rarity) >= RARITY_ORDER.indexOf(q.rarity)) q.progress += 1;
      if (q.kind === 'size') q.progress = Math.max(q.progress, event.result.lengthCm ?? 0);
      if (q.kind === 'boss' && fish.boss) q.progress += 1;
      if (q.kind === 'shiny' && event.result.shiny) q.progress += 1;
    }
    if (q.progress === before) continue;
    if (q.progress >= q.goal) {
      q.progress = q.goal;
      q.done = true;
      player.money += q.reward;
      player.dailyDone = (player.dailyDone ?? 0) + 1;
      done.push(q);
    }
  }
  return done;
}

/** 今日のお題の進み（済み / 全部）。 */
export function dailyProgress(player) {
  const quests = player.daily?.quests ?? [];
  return { done: quests.filter((q) => q.done).length, total: quests.length };
}

// ---------------------------------------------------------------- セーブの持ち出し

/**
 * 書き出しの形。中身を足しても古いデータが読めるように、版を入れておく。
 * localStorage は端末のデータを消すと一緒に消えてしまうので、
 * 遊んだ記録を自分で持ち出せるようにする。
 */
export const SAVE_FORMAT = 'fishing-save';
export const SAVE_VERSION = 1;

/** いまの記録を 1 本の文字列にする。 */
export function exportSave(player, { at = new Date() } = {}) {
  return JSON.stringify({
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    savedAt: at.toISOString(),
    player,
  });
}

/**
 * 書き出した文字列から記録を読み直す。
 * 書き出しの形でも、セーブそのもの（localStorage の中身）でも受け取る。
 * @returns {{ok: true, player: object, savedAt: string|null} | {ok: false, error: string}}
 */
export function importSave(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return { ok: false, error: 'データが空です' };
  let raw;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: 'データの形が違います。コピーし損ねていませんか' };
  }
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'データの形が違います' };

  const wrapped = raw.format === SAVE_FORMAT;
  if (!wrapped && !looksLikeSave(raw)) {
    return { ok: false, error: 'この釣りゲームのデータではないようです' };
  }
  if (wrapped && Number(raw.version) > SAVE_VERSION) {
    return { ok: false, error: '新しい版のデータです。アプリを更新してください' };
  }
  const body = wrapped ? raw.player : raw;
  if (!body || typeof body !== 'object') return { ok: false, error: '中身が入っていません' };
  return {
    ok: true,
    player: normalizePlayer(body),
    savedAt: wrapped && typeof raw.savedAt === 'string' ? raw.savedAt : null,
  };
}

/** 書き出しの形をかぶせていない、素のセーブかどうか。 */
function looksLikeSave(raw) {
  return ['money', 'records', 'rods', 'spots', 'casts'].some((key) => key in raw);
}

/** 書き出したデータの見出し（何匹釣ったころのものか）。 */
export function saveSummary(player) {
  return [
    `所持金 ${Math.round(player?.money ?? 0).toLocaleString('ja-JP')}円`,
    `図鑑 ${Object.keys(player?.records ?? {}).length} 種`,
    `Lv.${rankOf(player).level} ${rankOf(player).name}`,
  ].join(' ・ ');
}

// ---------------------------------------------------------------- はじめての案内

/**
 * 最初の数投だけ出す手引き。
 * need(player) が真になったら次へ進む。全部終わると二度と出ない。
 */
export const TUTORIAL = [
  { id: 'cast', text: 'まずは「キャスト」。竿を振って糸を投げよう', need: (p) => p.casts >= 1 },
  { id: 'hook', text: 'ウキが沈んだら「合わせる」。一瞬しか猶予はない', need: (p) => p.catches >= 1 || Boolean(p.tutorial?.hooked) },
  { id: 'reel', text: '長押しで巻ける。魚を緑のバーに入れ続けよう', need: (p) => p.catches >= 1 },
  { id: 'sell', text: '釣った魚は「売る」でお金になる', need: (p) => p.earned > 0 },
  { id: 'shop', text: 'お金がたまったらショップへ。竿を買うと大きい魚が獲れる', need: (p) => p.rods.length > 1 },
  { id: 'quest', text: '🏅 記録に、熟練度と実績と今日のお題がまとまっている', need: (p) => Boolean(p.tutorial?.sawQuest) },
];

/** いま出す案内。終わっていれば null。 */
export function tutorialStep(player) {
  const state = player?.tutorial;
  if (!state || state.done) return null;
  const step = TUTORIAL[state.step ?? 0];
  if (!step) return null;
  return step;
}

/**
 * 案内を 1 つ進める。条件を満たしていなければ何もしない。
 * @returns {boolean} 進んだかどうか
 */
export function advanceTutorial(player) {
  const state = player?.tutorial;
  if (!state || state.done) return false;
  let moved = false;
  // 一気に条件を満たしていることもあるので、進められるだけ進める
  while (!state.done) {
    const step = TUTORIAL[state.step];
    if (!step) { state.done = true; moved = true; break; }
    if (!step.need(player)) break;
    state.step += 1;
    moved = true;
    if (state.step >= TUTORIAL.length) state.done = true;
  }
  return moved;
}

// ---------------------------------------------------------------- 手ごたえ（振動）

/**
 * 振動のパターン（ミリ秒。鳴らす・休む・鳴らす…の順）。
 * 何が起きたのかを、画面を見ていなくても指で分かるように変えてある。
 *
 * iPhone / iPad の Safari は振動に対応していないので、Android などでだけ効く。
 */
export const HAPTICS = {
  bite: [35],
  catch: [25, 45, 90],
  big: [30, 40, 30, 40, 140],
  boss: [60, 60, 60, 60, 220],
  shiny: [20, 30, 20, 30, 20, 30, 140],
  record: [25, 40, 25, 40, 110],
  junk: [20],
  snap: [70, 50, 70],
  escape: [40],
  level: [30, 50, 30, 50, 90],
  achieve: [30, 50, 30],
  quest: [25, 40, 60],
  rage: [80, 40, 80],
  dash: [16],
  hook: [40, 60, 40, 60, 90],
  heavy: [20],      // ふつうの魚に掛かった合図
  sell: [15],       // 売れた
  event: [20, 40, 20],  // 大漁タイムなどの始まり
};

/**
 * 釣れた 1 匹に合う振動を選ぶ。
 * 珍しいものほど長く、刻みも増える。
 */
export function hapticFor(result) {
  const fish = result?.fish;
  if (!fish) return HAPTICS.catch;
  if (fish.boss) return HAPTICS.boss;
  if (result.shiny) return HAPTICS.shiny;
  if (fish.junk) return HAPTICS.junk;
  if (result.isNew) return HAPTICS.record;
  if ((result.sizeRatio ?? 0) >= 0.7) return HAPTICS.big;
  return HAPTICS.catch;
}

// ---------------------------------------------------------------- 表示用

export const yen = (v) => `${Math.round(v).toLocaleString('ja-JP')}円`;

/**
 * 狭い画面向けに桁を詰めた所持金。「12.3万」「1.20億」のようにする。
 * 桁が増えると上部バーが横に伸びて、画面からはみ出してしまうため。
 */
export function shortMoney(value, narrow = true) {
  const v = Math.round(value);
  if (!narrow || v < 10000) return v.toLocaleString('ja-JP');
  // 切り捨てにする。9,999,999 円が「1,000万」に見えると持ち金を勘違いする
  const cut = (x, digits) => Math.floor(x * 10 ** digits) / 10 ** digits;
  if (v < 100000000) {
    const man = v / 10000;
    return `${man < 100 ? cut(man, 1).toFixed(1) : Math.floor(man).toLocaleString('ja-JP')}万`;
  }
  return `${cut(v / 100000000, 2).toFixed(2)}億`;
}

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
