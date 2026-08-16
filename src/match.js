/**
 * 何ラウンドか戦って、合計ポイントで優勝を決めるための持ち回り。
 * DOM に依存しないので Node からテストできる。
 */

/** ラウンドごとの称号でもらえるポイント。 */
export const POINTS = { 大富豪: 3, 富豪: 2, 貧民: 1, 大貧民: 0 };

/** 1 ゲームの長さ（ラウンド数）。設定から選ぶ。 */
export const MATCH_LENGTHS = [3, 5, 10];
export const DEFAULT_LENGTH = 5;

/** 同点のときの決め手に使う称号の順。 */
const TIEBREAK = ['大富豪', '富豪', '貧民', '大貧民'];

export function createMatch(rounds = DEFAULT_LENGTH, playerCount = 4) {
  return {
    rounds: MATCH_LENGTHS.includes(rounds) ? rounds : DEFAULT_LENGTH,
    played: 0,
    scores: Array(playerCount).fill(0),
    // 誰が何回どの称号を取ったか（同点のときの決め手）
    titles: Array.from({ length: playerCount }, () => ({})),
  };
}

/**
 * 1 ラウンドぶんの結果を足す。
 * @param {{index: number, title: string}[]} players
 */
export function applyRound(match, players) {
  for (const p of players) {
    match.scores[p.index] += POINTS[p.title] ?? 0;
    const record = match.titles[p.index];
    record[p.title] = (record[p.title] ?? 0) + 1;
  }
  match.played += 1;
  return match;
}

/** 決着がついたか。 */
export const isOver = (match) => match.played >= match.rounds;

/** あと何ラウンドか。 */
export const roundsLeft = (match) => Math.max(0, match.rounds - match.played);

/**
 * 総合順位。ポイントの多い順、同点なら大富豪→富豪→貧民の回数で比べる。
 * それでも並んだら同順位（同じ rank）にする。
 * @returns {{index: number, points: number, rank: number, tied: boolean, titles: object}[]}
 */
export function standings(match) {
  const rows = match.scores.map((points, index) => ({
    index,
    points,
    titles: match.titles[index],
  }));

  const compare = (a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    for (const title of TIEBREAK) {
      const diff = (b.titles[title] ?? 0) - (a.titles[title] ?? 0);
      if (diff !== 0) return diff;
    }
    return 0;
  };

  rows.sort(compare);

  let rank = 0;
  rows.forEach((row, i) => {
    if (i === 0 || compare(rows[i - 1], row) !== 0) rank = i + 1;
    row.rank = rank;
  });
  for (const row of rows) row.tied = rows.some((o) => o !== row && o.rank === row.rank);
  return rows;
}

/** 優勝者（同点なら複数）。 */
export const winners = (match) => standings(match).filter((r) => r.rank === 1);

/** 「3人が同点で優勝」のような一言。 */
export function verdict(match, names) {
  const top = winners(match);
  const points = top[0]?.points ?? 0;
  if (top.length === 1) return `${names[top[0].index]} の優勝！（${points}pt）`;
  return `${top.map((r) => names[r.index]).join(' と ')} が同点で優勝！（${points}pt）`;
}
