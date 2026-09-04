/**
 * 戦国シミュレーションのマスターデータ。
 * 1560 年（桶狭間の戦いの年）の勢力図をもとにしている。
 *
 *   城（province） … 約 130 城。それぞれが領地（マス）を持つ。位置と隣接は mapdata.js
 *   大名（daimyo） … 19 家。国を持たない「空白地」は国人衆が守っている
 *   武将（general） … 約 1150 人（generals.js）。統率 / 武勇 / 政治 の 3 能力と身分
 *
 * 数字はすべてゲーム用の目安で、史実の石高などとは一致しない。
 */

// ------------------------------------------------------------------ 城（領地）

import { CASTLE_INFO, LINKS as MAP_LINKS } from './mapdata.js';

/**
 * ゲームの「国」は 1 つの城とその領地のこと（コードでは province と呼んでいる）。
 * 城の位置・国名・隣接は mapdata.js（tools/build-map.py が作る）にあり、
 * ここでは持ち主と最初の数値を決める。表にない城は本城/支城と持ち主から既定値を使う。
 *
 *   id: [大名 or null, 農業, 商業, 防御, 兵数]
 */
const OWNER = {
  // 九州
  satsuma: ['shimazu', 55, 40, 70, 5000], izumi: ['shimazu', 35, 30, 45, 2000], miyakonojo: ['shimazu', 35, 25, 45, 2000],
  hyuga: ['shimazu', 40, 30, 45, 2500],
  hizen: ['ryuzoji', 50, 55, 60, 4000],
  chikuzen: ['otomo', 55, 70, 55, 4000], iwaya: ['otomo', 35, 35, 50, 2000], kokura: ['otomo', 35, 45, 45, 2000],
  bungo: ['otomo', 60, 65, 65, 5500], niujima: ['otomo', 35, 40, 55, 2000],
  // 中国
  nagato: ['mori', 50, 60, 55, 3500], katsuyama: ['mori', 30, 40, 45, 2000], tomita: ['mori', 35, 35, 45, 2000],
  aki: ['mori', 55, 60, 75, 6000], sakurao: ['mori', 35, 40, 45, 2000], bingo: ['mori', 50, 50, 50, 3000],
  hieo: ['mori', 30, 25, 45, 1500], sanbonmatsu: ['mori', 30, 25, 45, 1500],
  izumo: ['amago', 55, 55, 80, 5500], shirakage: ['amago', 30, 30, 45, 2000], hoki: ['amago', 40, 35, 45, 2500],
  yamabuki: ['amago', 30, 50, 50, 2000],
  // 四国
  tosa: ['chosokabe', 45, 35, 55, 3500],
  sanuki: ['miyoshi', 45, 50, 45, 2500], awa: ['miyoshi', 50, 45, 60, 4000], hakuchi: ['miyoshi', 30, 25, 45, 1500],
  sumoto: ['miyoshi', 30, 35, 45, 1500],
  // 近畿
  settsu: ['miyoshi', 55, 85, 60, 5000], iimori: ['miyoshi', 40, 55, 60, 3000], kishiwada: ['miyoshi', 35, 55, 50, 2000],
  yamashiro: ['miyoshi', 50, 95, 55, 4000],
  minamiomi: ['rokkaku', 60, 70, 70, 4500], kitaomi: ['azai', 55, 50, 65, 4000],
  echizen: ['asakura', 60, 60, 65, 5000], kanegasaki: ['asakura', 30, 40, 50, 2000],
  // 中部
  echigo: ['uesugi', 65, 60, 75, 7000], tochio: ['uesugi', 40, 35, 50, 2500], shibata: ['uesugi', 45, 40, 45, 2500],
  kozuke: ['uesugi', 50, 45, 55, 3500], numata: ['uesugi', 30, 25, 50, 1500],
  mino: ['saito', 65, 55, 75, 5500], ogaki: ['saito', 40, 40, 50, 2000], gujo: ['saito', 25, 25, 45, 1500],
  owari: ['oda', 65, 70, 55, 5000], inuyama: ['oda', 30, 35, 50, 1500],
  mikawa: ['matsudaira', 55, 45, 55, 3500],
  yoshida: ['imagawa', 35, 35, 50, 2000], totomi: ['imagawa', 50, 45, 50, 3500], kakegawa: ['imagawa', 35, 35, 50, 2000],
  suruga: ['imagawa', 60, 65, 65, 5500],
  kai: ['takeda', 50, 45, 70, 6000], shinano: ['takeda', 55, 40, 60, 5000], kaizu: ['takeda', 40, 30, 60, 3000],
  takato: ['takeda', 30, 25, 55, 2000], iida: ['takeda', 30, 30, 45, 1500],
  // 関東
  nirayama: ['hojo', 30, 35, 60, 2000], musashi: ['hojo', 65, 65, 60, 5500], edo: ['hojo', 45, 55, 55, 3000],
  hachigata: ['hojo', 35, 30, 60, 2500], iwatsuki: ['hojo', 40, 35, 50, 2000], sagami: ['hojo', 55, 60, 90, 6000],
  hitachi: ['satake', 55, 50, 60, 4500], mito: ['satake', 35, 35, 45, 2000],
  // 東北
  dewa: ['date', 50, 40, 55, 3500], mutsu: ['date', 55, 45, 65, 5000],
  // 空白地のうち、少し豊かな所
  higo: [null, 60, 40, 50, 3000], harima: [null, 60, 55, 55, 3500], bizen: [null, 50, 50, 50, 3000],
  yamato: [null, 55, 55, 55, 3000], kii: [null, 40, 55, 55, 3500], ise: [null, 55, 60, 50, 3500],
  iyo: [null, 45, 45, 50, 3000], etchu: [null, 50, 45, 45, 3000], oyama: [null, 50, 50, 55, 4000],
  boso: [null, 50, 45, 50, 3500], shimotsuke: [null, 45, 40, 50, 3000], yamagata: [null, 45, 35, 50, 3000],
  kurokawa: [null, 50, 40, 60, 3500], oshu: [null, 45, 30, 50, 3000], tajima: [null, 35, 40, 45, 2000],
  tottori: [null, 35, 35, 50, 2500],
};

export const PROVINCES = CASTLE_INFO.map(([id, name, kuni, x, y, main]) => {
  const row = OWNER[id];
  const owner = row ? row[0] : null;
  const def = main ? [owner, 40, 35, 50, 2500] : [owner, 30, 25, 40, owner ? 1500 : 1200];
  const [, agri, comm, defense, soldiers] = row || def;
  return { id, name, kuni, main, x, y, agri, comm, defense, soldiers, owner };
});

// 隣接（領地が接している城どうし）。'sea' は海路。
export const LINKS = MAP_LINKS;

// ------------------------------------------------------------------ 大名

// [id, 家名, 色, 本拠, 金, 米, 紹介]
const D = [
  ['oda', '織田家', '#e04b3a', 'owari', 500, 4000, '尾張一国から天下布武を目指す。周りは強敵だらけだが、家臣団は粒ぞろい'],
  ['imagawa', '今川家', '#8e6ad6', 'suruga', 700, 6000, '海道一の弓取り。上洛を狙える国力があるが、隣の尾張は侮れない'],
  ['matsudaira', '松平家', '#3aa374', 'mikawa', 300, 3000, '三河一国の小勢力。今川と織田に挟まれ、生き残りが最初の目標'],
  ['takeda', '武田家', '#c9302c', 'kai', 800, 6000, '甲斐の虎。精強な騎馬軍団を率いる。越後の上杉とは宿命の好敵手'],
  ['uesugi', '上杉家', '#2f7fd1', 'echigo', 800, 7000, '越後の龍。軍神と呼ばれる当主の戦の強さは天下一'],
  ['hojo', '北条家', '#f0a03a', 'sagami', 900, 7000, '関東の覇者。難攻不落の小田原城と豊かな国力が武器'],
  ['date', '伊達家', '#3e8a8a', 'mutsu', 500, 5000, '奥州の雄。周りは空白地が多く、じっくり力を蓄えられる'],
  ['satake', '佐竹家', '#b47a3c', 'hitachi', 400, 4000, '常陸の名門。北条の圧力をしのぎつつ北へ伸びたい'],
  ['saito', '斎藤家', '#6d8b3a', 'mino', 500, 5000, '美濃の蝮の後継ぎ。稲葉山城は堅く、尾張の織田とは因縁がある'],
  ['azai', '浅井家', '#4fb0c6', 'kitaomi', 400, 4000, '北近江の若き当主。朝倉との盟友関係が頼り'],
  ['asakura', '朝倉家', '#7f5a9e', 'echizen', 600, 5500, '越前の名家。一乗谷の栄華を守れるか'],
  ['rokkaku', '六角家', '#a0a03a', 'minamiomi', 500, 4000, '南近江の守護大名。京に近く商業は盛ん'],
  ['miyoshi', '三好家', '#d65f8e', 'yamashiro', 1000, 7000, '京を押さえる天下人。四国から畿内まで八つの城を持つ最大勢力'],
  ['mori', '毛利家', '#3f8f3f', 'aki', 900, 7000, '中国地方の覇者。三本の矢の結束で尼子・大友と戦う'],
  ['amago', '尼子家', '#5f6fb0', 'izumo', 500, 4500, '山陰の雄。月山富田城は堅城。毛利との争いが続く'],
  ['chosokabe', '長宗我部家', '#c47f3a', 'tosa', 300, 3500, '土佐の小勢力。まずは四国統一を目指す'],
  ['otomo', '大友家', '#d6a33a', 'bungo', 700, 6000, '北九州の大大名。雷神・立花道雪が支える'],
  ['ryuzoji', '龍造寺家', '#8a6f4f', 'hizen', 400, 4000, '肥前の熊。大友の隙をうかがう'],
  ['shimazu', '島津家', '#2c5aa0', 'satsuma', 600, 5000, '薩摩の猛者。四兄弟の武勇で九州制覇を目指す'],
];

export const DAIMYOS = D.map(([id, name, color, capital, gold, rice, intro]) => ({
  id, name, color, capital, gold, rice, intro,
}));

// ------------------------------------------------------------------ 武将

import { GENERAL_ROWS } from './generals.js';

/** 身分。上の身分ほど多くの兵を率いて出陣・移動できる。功績がたまると昇進する */
export const RANKS = [
  { id: 0, name: '足軽頭', lead: 1500, merit: 0 },
  { id: 1, name: '侍大将', lead: 3000, merit: 30 },
  { id: 2, name: '部将', lead: 5000, merit: 80 },
  { id: 3, name: '家老', lead: 8000, merit: 200 },
];
export const LORD_LEAD = 12000; // 当主が率いられる兵

/** 能力の合計から最初の身分を決める */
export function initialRank(lead, valor, pol) {
  const sum = lead + valor + pol;
  if (sum >= 225) return 3;
  if (sum >= 190) return 2;
  if (sum >= 155) return 1;
  return 0;
}

const seenDaimyo = new Set();
export const GENERALS = GENERAL_ROWS.map(([name, daimyo, province, lead, valor, pol, appear], i) => {
  const lord = Boolean(daimyo) && !seenDaimyo.has(daimyo);
  if (daimyo) seenDaimyo.add(daimyo);
  return {
    id: `g${i}`, name, daimyo, province, lead, valor, pol,
    appear: appear || null,
    lord,
    rank: lord ? 3 : initialRank(lead, valor, pol),
  };
});

// ------------------------------------------------------------------ ゲームの定数

export const START_YEAR = 1560;
export const START_MONTH = 4;

export const COST = {
  develop: 30,      // 開墾・商業 の金
  fortify: 40,      // 築城 の金
  recruitPer100: 10, // 徴兵 100 人あたりの金
  charity: 150,     // 施し で配る米
  goodwill: 60,     // 親善 の金
  alliance: 150,    // 同盟 の金
  explore: 20,      // 探索 の金
  marchRicePer100: 5, // 出陣 100 人あたりの米
};

export const LIMIT = {
  agri: 120, comm: 120, defense: 100, loyalty: 100, training: 100,
  soldiersPerProvince: 15000,
  allianceMonths: 24,
  battleRounds: 10,
  commandsPerProvince: 3, // 1 つの国で 1 か月に出せる命令の数
};
