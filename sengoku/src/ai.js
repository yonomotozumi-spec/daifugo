/**
 * コンピュータ大名の思考ルーチン。
 *
 * 家ごとに毎月「いちばん落としやすい隣国」を狙いとして決め、
 *   1. 狙いに接した国（前線）に兵を集める
 *   2. 十分に強くなったら前線の武将が攻め込む
 *   3. それ以外の武将は内政（徴兵・開墾・商業・築城・施し・訓練）
 * という順に動く。
 */

import {
  COST, adjacent, aliveDaimyos, attackPower, battleRetreat, battleRound, commandList,
  defensePower, execute, generalsOf, isAllied, provincesOf, rand, recruitCaptured, releaseCaptured,
} from './engine.js';

/** プレイヤー以外の大名を全員動かす。戦闘の記録を返す。includePlayer はテスト用。 */
export function runAi(state, { includePlayer = false } = {}) {
  const battles = [];
  for (const d of aliveDaimyos(state)) {
    if ((d.id === state.player && !includePlayer) || state.ended) continue;
    const plan = makePlan(state, d.id);
    for (const g of generalsOf(state, d.id)) {
      if (state.ended || g.acted || !state.daimyos[d.id].alive) continue;
      const b = actGeneral(state, g, plan);
      if (b) battles.push(b);
    }
  }
  return battles;
}

const isEnemy = (state, me, pid) => {
  const owner = state.provinces[pid].owner;
  return owner !== me && !isAllied(state, me, owner);
};

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

function actGeneral(state, g, plan) {
  const d = state.daimyos[g.daimyo];
  const p = state.provinces[g.province];
  const cmds = commandList(state, g.id);
  const can = (type) => cmds.find((c) => c.type === type)?.enabled;
  const nb = adjacent(p.id);
  const enemies = nb.filter((id) => isEnemy(state, g.daimyo, id));
  const atFront = plan && plan.staging === p.id;

  // 1. 攻める（前線の国にいる武将が、十分に強ければ）
  if (atFront && can('march') && p.soldiers >= 2500) {
    const send = Math.floor(p.soldiers * 0.8);
    const rice = Math.ceil(send / 100) * COST.marchRicePer100;
    const ratio = attackPower(send, g, p.training) / Math.max(1, defensePower(state, plan.target));
    // 最初の 1 年はプレイヤーに少しだけ手加減する
    const need = state.provinces[plan.target].owner === state.player && state.turn < 12 ? 1.7 : 1.3;
    if (ratio >= need && d.rice >= rice + 300) {
      const r = execute(state, { type: 'march', general: g.id, target: plan.target, soldiers: send });
      if (r.ok && r.battle) {
        const b = r.battle;
        while (!b.done) {
          if (b.attSoldiers < b.attStart * 0.4) battleRetreat(state, b);
          else battleRound(state, b);
        }
        for (const id of b.captured) {
          if (state.generals[id].status !== 'captured') continue;
          const res = rand(state) < 0.7 ? recruitCaptured(state, id, g.daimyo) : { joined: false };
          if (!res.joined) releaseCaptured(state, id);
        }
        return b;
      }
    }
  }

  // 2. 前線へ兵を送る（自分の国が敵と接していないとき）
  if (plan && !atFront && enemies.length === 0 && can('move') && p.soldiers > 1200 && nb.includes(plan.staging)) {
    execute(state, { type: 'move', general: g.id, target: plan.staging, soldiers: Math.floor(p.soldiers * 0.7) });
    return null;
  }

  // 3. 内政
  if (p.loyalty < 35 && can('charity')) { execute(state, { type: 'charity', general: g.id }); return null; }
  const wantSoldiers = atFront ? 9000 : enemies.length ? 4500 : 2000;
  const rich = d.gold > 400;
  if (p.soldiers < wantSoldiers && can('recruit') && (rich || d.gold >= 150) && p.loyalty >= 45 && rand(state) < (atFront ? 0.9 : 0.5)) {
    execute(state, { type: 'recruit', general: g.id });
    return null;
  }
  const options = [
    ['develop', p.agri / 120, 1.0],
    ['commerce', p.comm / 120, d.gold < 200 ? 1.6 : 1.0],
    ['fortify', p.defense / 100, enemies.length ? 1.2 : 0.6],
  ].filter(([t]) => can(t)).sort((a, b) => (a[1] / a[2]) - (b[1] / b[2]));
  if (options.length && rand(state) < 0.85) { execute(state, { type: options[0][0], general: g.id }); return null; }
  if (can('train') && p.training < 95) { execute(state, { type: 'train', general: g.id }); return null; }
  if (options.length) { execute(state, { type: options[0][0], general: g.id }); return null; }
  if (can('charity') && p.loyalty < 80) { execute(state, { type: 'charity', general: g.id }); return null; }
  if (can('train')) execute(state, { type: 'train', general: g.id });
  return null;
}
