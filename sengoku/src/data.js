/**
 * 戦国シミュレーションのマスターデータ。
 * 1560 年（桶狭間の戦いの年）の勢力図をもとにしている。
 *
 *   国（province） … 44 か国。x / y は地図上の位置（viewBox 920 x 640）
 *   大名（daimyo） … 19 家。国を持たない「空白地」は国人衆が守っている
 *   武将（general） … 各家に 3〜6 人。統率 / 武勇 / 政治 の 3 能力
 *
 * 数字はすべてゲーム用の目安で、史実の石高などとは一致しない。
 */

// ------------------------------------------------------------------ 国

// [id, 名前, 島, x, y, 農業, 商業, 防御, 兵数, 大名 or null]
const P = [
  // 九州
  ['satsuma', '薩摩', 'kyushu', 92, 585, 55, 40, 70, 5000, 'shimazu'],
  ['hyuga', '日向', 'kyushu', 158, 552, 40, 30, 45, 2500, 'shimazu'],
  ['higo', '肥後', 'kyushu', 108, 515, 60, 40, 50, 3000, null],
  ['hizen', '肥前', 'kyushu', 58, 452, 50, 55, 60, 4000, 'ryuzoji'],
  ['chikuzen', '筑前', 'kyushu', 118, 428, 55, 70, 55, 4000, 'otomo'],
  ['bungo', '豊後', 'kyushu', 182, 482, 60, 65, 65, 5500, 'otomo'],
  // 中国
  ['nagato', '長門', 'honshu', 196, 396, 50, 60, 55, 3500, 'mori'],
  ['aki', '安芸', 'honshu', 256, 404, 55, 60, 75, 6000, 'mori'],
  ['bingo', '備後', 'honshu', 316, 404, 50, 50, 50, 3000, 'mori'],
  ['izumo', '出雲', 'honshu', 252, 336, 55, 55, 80, 5500, 'amago'],
  ['hoki', '伯耆', 'honshu', 322, 330, 40, 35, 45, 2500, 'amago'],
  ['bizen', '備前', 'honshu', 376, 404, 50, 50, 50, 3000, null],
  ['harima', '播磨', 'honshu', 432, 378, 60, 55, 55, 3500, null],
  ['tajima', '但馬', 'honshu', 400, 322, 35, 40, 45, 2000, null],
  // 四国
  ['iyo', '伊予', 'shikoku', 252, 488, 45, 45, 50, 3000, null],
  ['tosa', '土佐', 'shikoku', 306, 532, 45, 35, 55, 3500, 'chosokabe'],
  ['sanuki', '讃岐', 'shikoku', 340, 470, 45, 50, 45, 2500, 'miyoshi'],
  ['awa', '阿波', 'shikoku', 398, 492, 50, 45, 60, 4000, 'miyoshi'],
  // 近畿
  ['settsu', '摂津', 'honshu', 456, 436, 55, 85, 60, 5000, 'miyoshi'],
  ['yamashiro', '山城', 'honshu', 500, 380, 50, 95, 55, 4000, 'miyoshi'],
  ['yamato', '大和', 'honshu', 516, 444, 55, 55, 55, 3000, null],
  ['kii', '紀伊', 'honshu', 480, 498, 40, 55, 55, 3500, null],
  ['minamiomi', '南近江', 'honshu', 562, 376, 60, 70, 70, 4500, 'rokkaku'],
  ['kitaomi', '北近江', 'honshu', 556, 314, 55, 50, 65, 4000, 'azai'],
  ['echizen', '越前', 'honshu', 574, 256, 60, 60, 65, 5000, 'asakura'],
  ['ise', '伊勢', 'honshu', 578, 440, 55, 60, 50, 3500, null],
  // 中部
  ['mino', '美濃', 'honshu', 620, 360, 65, 55, 75, 5500, 'saito'],
  ['owari', '尾張', 'honshu', 636, 424, 65, 70, 55, 5000, 'oda'],
  ['mikawa', '三河', 'honshu', 692, 448, 55, 45, 55, 3500, 'matsudaira'],
  ['totomi', '遠江', 'honshu', 752, 456, 50, 45, 50, 3500, 'imagawa'],
  ['suruga', '駿河', 'honshu', 812, 440, 60, 65, 65, 5500, 'imagawa'],
  ['kai', '甲斐', 'honshu', 770, 392, 50, 45, 70, 6000, 'takeda'],
  ['shinano', '信濃', 'honshu', 706, 352, 55, 40, 60, 5000, 'takeda'],
  ['etchu', '越中', 'honshu', 640, 286, 50, 45, 45, 3000, null],
  ['echigo', '越後', 'honshu', 712, 268, 65, 60, 75, 7000, 'uesugi'],
  // 関東
  ['kozuke', '上野', 'honshu', 770, 322, 50, 45, 55, 3500, 'uesugi'],
  ['musashi', '武蔵', 'honshu', 826, 356, 65, 65, 60, 5500, 'hojo'],
  ['sagami', '相模', 'honshu', 866, 412, 55, 60, 90, 6000, 'hojo'],
  ['boso', '房総', 'honshu', 896, 466, 50, 45, 50, 3500, null],
  ['shimotsuke', '下野', 'honshu', 822, 290, 45, 40, 50, 3000, null],
  ['hitachi', '常陸', 'honshu', 884, 332, 55, 50, 60, 4500, 'satake'],
  // 東北
  ['dewa', '出羽', 'honshu', 776, 206, 50, 40, 55, 3500, 'date'],
  ['mutsu', '陸奥', 'honshu', 846, 224, 55, 45, 65, 5000, 'date'],
  ['oshu', '奥州', 'honshu', 868, 150, 45, 30, 50, 3000, null],
];

export const PROVINCES = P.map(([id, name, island, x, y, agri, comm, defense, soldiers, owner]) => ({
  id, name, island, x, y, agri, comm, defense, soldiers, owner,
}));

// 隣接（道でつながっている国どうし）。'sea' は海路。
export const LINKS = [
  ['satsuma', 'hyuga'], ['satsuma', 'higo'], ['hyuga', 'higo'], ['hyuga', 'bungo'],
  ['higo', 'hizen'], ['higo', 'chikuzen'], ['higo', 'bungo'], ['hizen', 'chikuzen'],
  ['chikuzen', 'bungo'], ['chikuzen', 'nagato', 'sea'], ['bungo', 'iyo', 'sea'],

  ['nagato', 'aki'], ['nagato', 'izumo'], ['aki', 'bingo'], ['aki', 'izumo'], ['izumo', 'hoki'],
  ['bingo', 'hoki'], ['bingo', 'bizen'], ['hoki', 'bizen'], ['hoki', 'tajima'], ['bizen', 'harima'],
  ['tajima', 'harima'], ['tajima', 'yamashiro'], ['harima', 'settsu'],
  ['bizen', 'sanuki', 'sea'], ['aki', 'iyo', 'sea'],

  ['iyo', 'tosa'], ['iyo', 'sanuki'], ['tosa', 'sanuki'], ['tosa', 'awa'], ['sanuki', 'awa'],
  ['awa', 'kii', 'sea'], ['awa', 'settsu', 'sea'],

  ['settsu', 'yamashiro'], ['settsu', 'yamato'], ['settsu', 'kii'], ['yamashiro', 'minamiomi'],
  ['yamashiro', 'yamato'], ['yamato', 'ise'], ['yamato', 'kii'], ['kii', 'ise'],
  ['minamiomi', 'kitaomi'], ['minamiomi', 'ise'], ['minamiomi', 'mino'], ['kitaomi', 'echizen'],
  ['kitaomi', 'mino'], ['echizen', 'etchu'], ['echizen', 'mino'], ['ise', 'owari'],

  ['mino', 'owari'], ['mino', 'shinano'], ['owari', 'mikawa'], ['mikawa', 'totomi'],
  ['mikawa', 'shinano'], ['totomi', 'suruga'], ['totomi', 'shinano'], ['suruga', 'kai'],
  ['suruga', 'sagami'], ['kai', 'shinano'], ['kai', 'musashi'], ['shinano', 'echigo'],
  ['shinano', 'kozuke'], ['shinano', 'etchu'], ['etchu', 'echigo'],

  ['kozuke', 'musashi'], ['kozuke', 'shimotsuke'], ['kozuke', 'echigo'], ['musashi', 'sagami'],
  ['musashi', 'boso'], ['musashi', 'shimotsuke'], ['musashi', 'hitachi'], ['sagami', 'boso', 'sea'],
  ['boso', 'hitachi'], ['shimotsuke', 'hitachi'], ['shimotsuke', 'mutsu'], ['hitachi', 'mutsu'],

  ['dewa', 'mutsu'], ['dewa', 'echigo'], ['dewa', 'oshu'], ['mutsu', 'oshu'],
];

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
  ['miyoshi', '三好家', '#d65f8e', 'yamashiro', 1000, 7000, '京を押さえる天下人。四国から畿内まで四か国を持つ最大勢力'],
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

// [名前, 大名, 国, 統率, 武勇, 政治]  先頭の 1 人が当主
const G = [
  ['織田信長', 'oda', 'owari', 95, 88, 92],
  ['柴田勝家', 'oda', 'owari', 85, 90, 50],
  ['木下秀吉', 'oda', 'owari', 80, 60, 95],
  ['丹羽長秀', 'oda', 'owari', 75, 65, 85],
  ['前田利家', 'oda', 'owari', 78, 88, 60],

  ['今川義元', 'imagawa', 'suruga', 80, 60, 85],
  ['朝比奈泰朝', 'imagawa', 'totomi', 70, 72, 55],
  ['岡部元信', 'imagawa', 'suruga', 76, 80, 50],
  ['瀬名氏俊', 'imagawa', 'totomi', 55, 50, 65],

  ['松平元康', 'matsudaira', 'mikawa', 90, 80, 88],
  ['酒井忠次', 'matsudaira', 'mikawa', 82, 72, 70],
  ['石川数正', 'matsudaira', 'mikawa', 70, 55, 80],
  ['本多忠勝', 'matsudaira', 'mikawa', 88, 98, 40],

  ['武田信玄', 'takeda', 'kai', 98, 85, 92],
  ['山県昌景', 'takeda', 'shinano', 90, 92, 50],
  ['馬場信春', 'takeda', 'shinano', 88, 85, 60],
  ['高坂昌信', 'takeda', 'kai', 85, 70, 65],
  ['真田幸隆', 'takeda', 'shinano', 85, 70, 80],

  ['上杉謙信', 'uesugi', 'echigo', 100, 100, 65],
  ['直江実綱', 'uesugi', 'echigo', 70, 55, 85],
  ['柿崎景家', 'uesugi', 'kozuke', 80, 90, 30],
  ['宇佐美定満', 'uesugi', 'echigo', 85, 65, 70],
  ['斎藤朝信', 'uesugi', 'kozuke', 75, 75, 60],

  ['北条氏康', 'hojo', 'sagami', 90, 75, 95],
  ['北条綱成', 'hojo', 'musashi', 88, 90, 50],
  ['北条氏政', 'hojo', 'sagami', 70, 60, 75],
  ['松田憲秀', 'hojo', 'musashi', 65, 50, 75],
  ['北条幻庵', 'hojo', 'sagami', 60, 45, 88],

  ['伊達晴宗', 'date', 'mutsu', 75, 65, 80],
  ['伊達輝宗', 'date', 'dewa', 70, 60, 75],
  ['鬼庭良直', 'date', 'mutsu', 70, 80, 50],
  ['伊達実元', 'date', 'dewa', 70, 72, 55],

  ['佐竹義昭', 'satake', 'hitachi', 75, 70, 70],
  ['佐竹義重', 'satake', 'hitachi', 85, 88, 70],
  ['太田資正', 'satake', 'hitachi', 78, 80, 60],

  ['斎藤義龍', 'saito', 'mino', 82, 78, 70],
  ['竹中半兵衛', 'saito', 'mino', 90, 45, 80],
  ['稲葉一鉄', 'saito', 'mino', 78, 82, 60],
  ['安藤守就', 'saito', 'mino', 65, 60, 60],

  ['浅井長政', 'azai', 'kitaomi', 85, 85, 65],
  ['遠藤直経', 'azai', 'kitaomi', 72, 85, 45],
  ['磯野員昌', 'azai', 'kitaomi', 80, 90, 35],

  ['朝倉義景', 'asakura', 'echizen', 45, 40, 65],
  ['朝倉景鏡', 'asakura', 'echizen', 60, 60, 55],
  ['山崎吉家', 'asakura', 'echizen', 72, 70, 50],
  ['真柄直隆', 'asakura', 'echizen', 60, 95, 20],

  ['六角義賢', 'rokkaku', 'minamiomi', 65, 55, 70],
  ['蒲生定秀', 'rokkaku', 'minamiomi', 70, 65, 75],
  ['蒲生賢秀', 'rokkaku', 'minamiomi', 65, 60, 70],

  ['三好長慶', 'miyoshi', 'yamashiro', 88, 70, 88],
  ['松永久秀', 'miyoshi', 'yamashiro', 85, 65, 95],
  ['三好義賢', 'miyoshi', 'awa', 80, 75, 70],
  ['篠原長房', 'miyoshi', 'sanuki', 70, 60, 80],
  ['三好長逸', 'miyoshi', 'settsu', 72, 70, 60],
  ['十河一存', 'miyoshi', 'settsu', 75, 88, 40],

  ['毛利元就', 'mori', 'aki', 95, 70, 100],
  ['吉川元春', 'mori', 'aki', 92, 95, 55],
  ['小早川隆景', 'mori', 'bingo', 90, 70, 92],
  ['毛利隆元', 'mori', 'nagato', 65, 50, 80],
  ['宍戸隆家', 'mori', 'nagato', 65, 70, 60],

  ['尼子晴久', 'amago', 'izumo', 78, 70, 70],
  ['尼子義久', 'amago', 'izumo', 55, 50, 60],
  ['山中幸盛', 'amago', 'hoki', 80, 92, 45],
  ['亀井秀綱', 'amago', 'hoki', 60, 55, 70],

  ['長宗我部国親', 'chosokabe', 'tosa', 75, 70, 65],
  ['長宗我部元親', 'chosokabe', 'tosa', 88, 75, 85],
  ['吉良親貞', 'chosokabe', 'tosa', 70, 75, 55],
  ['谷忠澄', 'chosokabe', 'tosa', 50, 40, 80],

  ['大友宗麟', 'otomo', 'bungo', 70, 50, 88],
  ['立花道雪', 'otomo', 'chikuzen', 95, 90, 70],
  ['高橋紹運', 'otomo', 'chikuzen', 88, 85, 65],
  ['吉弘鑑理', 'otomo', 'bungo', 70, 70, 55],

  ['龍造寺隆信', 'ryuzoji', 'hizen', 85, 88, 60],
  ['鍋島直茂', 'ryuzoji', 'hizen', 88, 80, 90],
  ['成松信勝', 'ryuzoji', 'hizen', 60, 85, 30],

  ['島津貴久', 'shimazu', 'satsuma', 80, 70, 85],
  ['島津義久', 'shimazu', 'satsuma', 78, 60, 90],
  ['島津義弘', 'shimazu', 'hyuga', 95, 98, 60],
  ['島津歳久', 'shimazu', 'satsuma', 75, 65, 80],
  ['島津家久', 'shimazu', 'hyuga', 88, 90, 55],
];

export const GENERALS = G.map(([name, daimyo, province, lead, valor, pol], i) => ({
  id: `g${i}`, name, daimyo, province, lead, valor, pol,
  lord: i === 0 || G[i - 1][1] !== daimyo,
}));

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
  marchRicePer100: 5, // 出陣 100 人あたりの米
};

export const LIMIT = {
  agri: 120, comm: 120, defense: 100, loyalty: 100, training: 100,
  soldiersPerProvince: 15000,
  allianceMonths: 24,
  battleRounds: 10,
};
