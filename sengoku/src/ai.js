/**
 * コンピュータ大名の思考ルーチン。
 *
 * 家ごとに毎月「いちばん落としやすい隣国」を狙いとして決め、国ごとに
 * 月 3 回の命令を「攻める → 前線へ兵を送る → 内政」の順に使う。
 * 命令を出す武将は、戦なら統率・武勇、内政なら政治の高い者を選ぶ。
 */

import {
  COST, adjacent, aliveDaimyos, attackPower, battleRetreat, battleRound, commandList, commandsLeft,
  defensePower, execute, generalsIn, isAllied, leadCap, provincesOf, rand, recruitCaptured,
  releaseCaptured, roninIn,
} from './engine.js';

/** プレイヤー以外の大名を全員動かす。戦闘の記録を返す。includePlayer はテスト用。 */
export function runAi(state, { includePlayer = false } = {}) {
  const battles = [];
  for (const d of aliveDaimyos(state)) {
    if ((d.id === state.player && !includePlayer) || state.ended) continue;
    const plan = makePlan(state, d.id);
    for (const p of provincesOf(state, d.id)) {
      if (state.ended || !state.daimyos[d.id].alive || p.owner !== d.id) continue;
      actProvince(state, d.id, p, plan, battles);
    }
  }
  return battles;
}

const isEnemy = (state, me, pid) => {
  const owner = state.provinces[pid].owner;
  return owner !== me && !isAllied(state, me, owner);
};

const fightStat = (g) => g.lead * 0.6 + g.valor * 0.4;

/** 今月の狙い（攻める国と、そこへ兵を集める前線の国）を決める */
function makePlan(state, me) {
  let best = null;
  for (const p of provincesOf(state, me)) {
    for (const t of adjacent(p.id)) {
      if (!isEnemy(state, me, t)) continue;
      const tp = state.provinces[t];
      // 空白地と弱い国を好む。プレイヤーには少しだけ遠慮する
      let score = defensePower(state, t);
      if (!tp.owner) score *= 0.8;
      if (tp.owner === state.player) score *= 1.1;
      if (!best || score < best.score) best = { target: t, score };
    }
  }
  if (!best) return null;
  const stagingCands = adjacent(best.target).filter((id) => state.provinces[id].owner === me);
  const staging = stagingCands.reduce((a, b) => (state.provinces[a].soldiers >= state.provinces[b].soldiers ? a : b));
  return { target: best.target, staging };
}

/** ひとつの国で、命令の残り回数ぶんだけ動く */
function actProvince(state, me, p, plan, battles) {
  const d = state.daimyos[me];
  const nb = adjacent(p.id);
  const enemies = nb.filter((id) => isEnemy(state, me, id));
  const atFront = plan && plan.staging === p.id;
  let moved = false;
  let recruited = 0;

  for (let guard = 0; guard < 6 && commandsLeft(state, p.id) > 0 && !state.ended && p.owner === me; guard++) {
    const free = generalsIn(state, p.id).filter((g) => !g.acted);
    if (!free.length) break;
    const byFight = [...free].sort((a, b) => fightStat(b) - fightStat(a));
    const byPol = [...free].sort((a, b) => b.pol - a.pol);
    const byLead = [...free].sort((a, b) => b.lead - a.lead);
    const can = (g, type) => commandList(state, g.id).find((c) => c.type === type)?.enabled;

    // 1. 攻める（前線の国で、率いられる兵が多い順に大将を探す）
    if (atFront && p.soldiers >= 2500 && !state.ended) {
      const leaders = [...free].sort((a, b) => Math.min(leadCap(b), p.soldiers) * (1 + fightStat(b) / 200) - Math.min(leadCap(a), p.soldiers) * (1 + fightStat(a) / 200));
      const g = leaders[0];
      const send = Math.min(Math.floor(p.soldiers * 0.8), leadCap(g));
      const rice = Math.ceil(send / 100) * COST.marchRicePer100;
      const ratio = attackPower(send, g, p.training) / Math.max(1, defensePower(state, plan.target));
      // 最初の 1 年はプレイヤーに少しだけ手加減する
      const need = state.provinces[plan.target].owner === state.player && state.turn < 12 ? 1.7 : 1.3;
      if (send >= 1000 && ratio >= need && d.rice >= rice + 300 && can(g, 'march')) {
        const r = execute(state, { type: 'march', general: g.id, target: plan.target, soldiers: send });
        if (r.ok && r.battle) {
          const b = r.battle;
          while (!b.done) {
            if (b.attSoldiers < b.attStart * 0.4) battleRetreat(state, b);
            else battleRound(state, b);
          }
          for (const id of b.captured) {
            if (state.generals[id].status !== 'captured') continue;
            const res = rand(state) < 0.7 ? recruitCaptured(state, id, me) : { joined: false };
            if (!res.joined) releaseCaptured(state, id);
          }
          battles.push(b);
          continue;
        }
      }
    }

    // 2. 前線へ兵を送る（自分の国が敵と接していないとき）
    if (plan && !atFront && !moved && enemies.length === 0 && p.soldiers > 1200 && nb.includes(plan.staging)) {
      const g = [...free].sort((a, b) => leadCap(b) - leadCap(a))[0];
      if (can(g, 'move')) {
        execute(state, { type: 'move', general: g.id, target: plan.staging, soldiers: Math.min(Math.floor(p.soldiers * 0.7), leadCap(g)) });
        moved = true;
        continue;
      }
    }

    // 2b. 武将のいない自分の城には、余っている武将をひとり送る
    if (free.length >= 4 && !moved) {
      const empty = nb.find((id) => state.provinces[id].owner === me && generalsIn(state, id).length === 0);
      const g = [...free].filter((x) => !x.lord).sort((a, b) => leadCap(a) - leadCap(b))[0];
      if (empty && g && can(g, 'move')) {
        execute(state, { type: 'move', general: g.id, target: empty, soldiers: Math.min(500, Math.floor(p.soldiers * 0.2), leadCap(g)) });
        moved = true;
        continue;
      }
    }

    // 3. 内政
    if (p.loyalty < 35 && can(byPol[0], 'charity')) { execute(state, { type: 'charity', general: byPol[0].id }); continue; }
    const wantSoldiers = atFront ? 9000 : enemies.length ? 4500 : 2000;
    const rich = d.gold > 400;
    if (p.soldiers < wantSoldiers && recruited < 2 && can(byLead[0], 'recruit') && (rich || d.gold >= 150) && p.loyalty >= 45 && rand(state) < (atFront ? 0.9 : 0.5)) {
      execute(state, { type: 'recruit', general: byLead[0].id });
      recruited++;
      continue;
    }
    if (roninIn(state, p.id).length && d.gold >= 80 && rand(state) < 0.35 && can(byPol[0], 'explore')) {
      execute(state, { type: 'explore', general: byPol[0].id });
      continue;
    }
    const options = [
      ['develop', p.agri / 120, 1.0],
      ['commerce', p.comm / 120, d.gold < 200 ? 1.6 : 1.0],
      ['fortify', p.defense / 100, enemies.length ? 1.2 : 0.6],
    ].filter(([t]) => can(byPol[0], t)).sort((a, b) => (a[1] / a[2]) - (b[1] / b[2]));
    if (options.length && rand(state) < 0.85) { execute(state, { type: options[0][0], general: byPol[0].id }); continue; }
    if (p.training < 95 && can(byFight[0], 'train')) { execute(state, { type: 'train', general: byFight[0].id }); continue; }
    if (options.length) { execute(state, { type: options[0][0], general: byPol[0].id }); continue; }
    if (p.loyalty < 80 && can(byPol[0], 'charity')) { execute(state, { type: 'charity', general: byPol[0].id }); continue; }
    if (can(byFight[0], 'train')) { execute(state, { type: 'train', general: byFight[0].id }); continue; }
    break;
  }
}
