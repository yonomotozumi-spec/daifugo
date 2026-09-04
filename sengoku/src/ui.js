/**
 * 画面の進行と DOM の操作。ルールは engine.js、CPU の思考は ai.js にある。
 */

import { DAIMYOS, GENERALS, LIMIT, PROVINCES } from './data.js';
import * as E from './engine.js';
import { runAi } from './ai.js';
import { createMap } from './map.js';

const $ = (id) => document.getElementById(id);
const SAVE_KEY = 'sengoku.save.v1';
const HELP_KEY = 'sengoku.help.seen';
const fmt = (n) => Number(n).toLocaleString('ja-JP');

let game = null;
let map = null;
const view = { selected: null, mode: null, targets: [], general: null, openGeneral: null };

// ------------------------------------------------------------------ 保存

function save() {
  try { localStorage.setItem(SAVE_KEY, E.serialize(game)); } catch { /* 保存できなくても遊べる */ }
}
function loadSave() {
  try {
    const text = localStorage.getItem(SAVE_KEY);
    return text ? E.deserialize(text) : null;
  } catch { return null; }
}
function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}

// ------------------------------------------------------------------ 小物

let toastTimer = 0;
function toast(text, kind = '') {
  const t = $('toast');
  t.textContent = text;
  t.className = `toast ${kind}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

function openDialog(dlg) {
  if (!dlg.open) dlg.showModal();
}

const ownerName = (pid) => {
  const o = game.provinces[pid].owner;
  return o ? game.daimyos[o].name : '空白地（国人衆）';
};
const ownerColor = (pid) => {
  const o = game.provinces[pid].owner;
  return o ? game.daimyos[o].color : '#8d8f86';
};

function difficulty(id) {
  const n = PROVINCES.filter((p) => p.owner === id).length;
  if (id === 'oda' || id === 'matsudaira') return '★★★';
  if (n >= 3) return '★';
  if (n === 2) return '★★';
  return '★★★';
}

// ------------------------------------------------------------------ 開始

function buildStartDialog() {
  const grid = $('daimyo-grid');
  grid.innerHTML = '';
  for (const d of DAIMYOS) {
    const lord = GENERALS.find((g) => g.daimyo === d.id && g.lord);
    const n = PROVINCES.filter((p) => p.owner === d.id).length;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'daimyo-card';
    btn.dataset.id = d.id;
    btn.style.setProperty('--c', d.color);
    btn.innerHTML = `
      <span class="dc-head"><i class="dot"></i><b>${d.name}</b><span class="dc-stars">${difficulty(d.id)}</span></span>
      <span class="dc-lord">当主 ${lord.name}　${n} か国</span>
      <span class="dc-intro">${d.intro}</span>`;
    btn.addEventListener('click', () => startGame(d.id));
    grid.appendChild(btn);
  }
}

function startGame(id) {
  game = E.createGame({ player: id });
  focusCapital();
  $('dlg-start').close();
  save();
  renderAll();
  centerMap();
  let seen = false;
  try { seen = localStorage.getItem(HELP_KEY) === '1'; } catch { /* ignore */ }
  if (!seen) {
    openDialog($('dlg-help'));
    try { localStorage.setItem(HELP_KEY, '1'); } catch { /* ignore */ }
  }
  toast(`${game.daimyos[id].name}で天下統一を目指そう！`, 'good');
}

/** 本拠を選び、最初に動ける武将の命令欄を開く */
function focusCapital() {
  const capital = game.daimyos[game.player].capital;
  const selected = game.provinces[capital].owner === game.player ? capital : (E.provincesOf(game, game.player)[0]?.id ?? capital);
  const first = E.generalsIn(game, selected).find((g) => g.daimyo === game.player && !g.acted);
  Object.assign(view, { selected, mode: null, targets: [], general: null, openGeneral: first ? first.id : null });
}

function resumeGame(saved) {
  game = saved;
  focusCapital();
  $('dlg-start').close();
  renderAll();
  centerMap();
  if (game.ended) showEnd();
}

// ------------------------------------------------------------------ 描画

function renderAll() {
  if (!game) return;
  renderStatus();
  map.update(game, view);
  renderPanel();
  renderLog();
  renderLegend();
  renderHint();
}

function renderStatus() {
  const me = game.daimyos[game.player];
  $('st-dot').style.background = me.color;
  $('st-name').textContent = me.name;
  $('st-date').textContent = E.dateLabel(game);
  $('st-gold').textContent = fmt(me.gold);
  $('st-rice').textContent = fmt(me.rice);
  const ps = E.provincesOf(game, game.player);
  $('st-power').textContent = `国 ${ps.length} ／ 兵 ${fmt(ps.reduce((s, p) => s + p.soldiers, 0))}`;
  const left = E.generalsOf(game, game.player).filter((g) => !g.acted).length;
  $('btn-end').textContent = left ? `月を終える（未行動 ${left}）` : '月を終える';
  $('btn-end').disabled = Boolean(game.ended);
}

function renderHint() {
  const h = $('map-hint');
  if (view.mode) {
    const g = game.generals[view.general];
    h.textContent = view.mode === 'march'
      ? `${g.name}が攻め込む国を地図で選んでください（光っている国）。やめるときは別の場所をクリック`
      : `${g.name}の移動先を地図で選んでください（光っている国）。やめるときは別の場所をクリック`;
    h.hidden = false;
  } else {
    h.hidden = true;
  }
}

function renderLegend() {
  const box = $('map-legend');
  const list = E.aliveDaimyos(game)
    .map((d) => E.daimyoSummary(game, d.id))
    .sort((a, b) => b.score - a.score);
  box.innerHTML = list.map((d) => `<span class="chip${d.id === game.player ? ' me' : ''}"><i class="dot" style="background:${d.color}"></i>${d.name.replace(/家$/, '')} ${d.provinces}</span>`).join('')
    + '<span class="chip"><i class="dot" style="background:#8d8f86"></i>空白地</span>';
}

function statRow(label, value, max, cls = '') {
  const pct = Math.round((value / max) * 100);
  return `<div class="stat ${cls}"><span class="stat-label">${label}</span><div class="bar"><i style="width:${pct}%"></i></div><span class="stat-value">${value}</span></div>`;
}

function renderPanel() {
  const box = $('province-panel');
  if (!view.selected) { renderOverview(box); return; }
  const p = game.provinces[view.selected];
  const mine = p.owner === game.player;
  const gens = E.generalsIn(game, p.id);
  const allied = E.isAllied(game, game.player, p.owner);
  const canReach = E.adjacent(p.id).some((id) => game.provinces[id].owner === game.player);

  let html = `
    <div class="pp-head">
      <button type="button" class="ghost small" id="btn-overview" title="国の一覧に戻る">‹ 一覧</button>
      <i class="dot" style="background:${ownerColor(p.id)}"></i>
      <h2>${p.name}</h2>
      <span class="pp-owner">${ownerName(p.id)}${allied ? '（同盟中）' : ''}</span>
    </div>
    <div class="stats">
      ${statRow('農業', p.agri, LIMIT.agri)}
      ${statRow('商業', p.comm, LIMIT.comm)}
      ${statRow('防御', p.defense, LIMIT.defense)}
      ${statRow('民忠', p.loyalty, LIMIT.loyalty, p.loyalty < 30 ? 'warn' : '')}
      ${statRow('訓練', p.training, LIMIT.training)}
      <div class="stat soldiers"><span class="stat-label">兵</span><b>${fmt(p.soldiers)}</b><span class="stat-sub">人</span></div>
    </div>`;

  if (!mine && !p.owner) html += '<p class="hint">大名のいない空白地。国人衆が守っている。</p>';
  if (!mine && canReach && !allied) html += '<p class="hint">自分の国と隣り合っている。武将の「出陣」で攻め込める。</p>';

  html += `<h3>武将 <span class="count">${gens.length}</span></h3>`;
  if (!gens.length) {
    html += `<p class="hint">${p.owner ? 'この国に武将はいない。' : '国人衆が治めている。'}</p>`;
  } else {
    html += '<ul class="generals">';
    for (const g of gens) {
      const open = mine && view.openGeneral === g.id && !g.acted;
      html += `<li class="general${g.acted ? ' acted' : ''}${open ? ' open' : ''}" data-id="${g.id}">
        <div class="g-row">
          <span class="g-name">${g.name}${g.lord ? '<em class="lord">当主</em>' : ''}</span>
          <span class="g-stats"><span>統 ${g.lead}</span><span>武 ${g.valor}</span><span>政 ${g.pol}</span></span>
          ${mine ? (g.acted ? '<span class="tag">行動済み</span>' : `<button type="button" class="small${open ? ' ghost' : ' primary'}" data-cmd-open="${g.id}">${open ? '閉じる' : '命令'}</button>`) : ''}
        </div>
        ${open ? renderCommands(g) : ''}
      </li>`;
    }
    html += '</ul>';
  }

  const nb = E.adjacent(p.id).map((id) => `<button type="button" class="link" data-select="${id}">${game.provinces[id].name}</button>`).join('・');
  html += `<p class="neighbors">隣接：${nb}</p>`;
  box.innerHTML = html;

  $('btn-overview').addEventListener('click', () => { view.selected = null; cancelMode(); renderAll(); });
  box.querySelectorAll('[data-cmd-open]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.cmdOpen;
    view.openGeneral = view.openGeneral === id ? null : id;
    cancelMode();
    renderAll();
  }));
  box.querySelectorAll('[data-select]').forEach((b) => b.addEventListener('click', () => selectProvince(b.dataset.select)));
  box.querySelectorAll('[data-cmd]').forEach((b) => b.addEventListener('click', () => {
    const g = game.generals[b.dataset.general];
    const cmd = E.commandList(game, g.id).find((c) => c.type === b.dataset.cmd);
    onCommand(g, cmd);
  }));
}

function renderCommands(g) {
  const cmds = E.commandList(game, g.id);
  return `<div class="cmds">${cmds.map((c) => `
    <button type="button" class="cmd" data-cmd="${c.type}" data-general="${g.id}" ${c.enabled ? '' : 'disabled'} title="${c.desc}${c.enabled ? '' : `　※${c.reason}`}">
      <span class="cmd-icon">${c.icon}</span>
      <span class="cmd-label">${c.label}</span>
      <span class="cmd-sub">${c.enabled ? c.effect : c.reason}</span>
      <span class="cmd-cost">${c.cost}</span>
    </button>`).join('')}</div>`;
}

function renderOverview(box) {
  const ps = E.provincesOf(game, game.player);
  let html = '<div class="pp-head"><h2>自分の国</h2></div>';
  html += '<p class="hint">国をクリックすると、そこにいる武将に命令できます。地図の自分の国をクリックしても同じです。</p>';
  html += '<ul class="overview">';
  for (const p of ps) {
    const gens = E.generalsIn(game, p.id);
    const left = gens.filter((g) => !g.acted).length;
    html += `<li><button type="button" class="ov" data-select="${p.id}">
      <b>${p.name}</b><span>兵 ${fmt(p.soldiers)}</span>
      <span>武将 ${gens.length}</span>
      <span class="${left ? 'todo' : 'done'}">${left ? `未行動 ${left}` : gens.length ? '行動済み' : '—'}</span>
    </button></li>`;
  }
  html += '</ul>';
  const me = game.daimyos[game.player];
  const allies = Object.entries(me.alliance).filter(([, until]) => until > game.turn);
  if (allies.length) {
    html += `<p class="hint">同盟：${allies.map(([id, until]) => `${game.daimyos[id].name}（あと ${until - game.turn} か月）`).join('、')}</p>`;
  }
  box.innerHTML = html;
  box.querySelectorAll('[data-select]').forEach((b) => b.addEventListener('click', () => selectProvince(b.dataset.select)));
}

function renderLog() {
  const ol = $('log');
  const entries = game.log.slice(-40).reverse();
  ol.innerHTML = entries.map((e) => `<li class="${e.kind}"><span class="log-date">${e.date}</span>${e.text}</li>`).join('');
}

// ------------------------------------------------------------------ 操作

function selectProvince(id) {
  if (view.mode) {
    if (view.targets.includes(id)) { chooseTarget(id); return; }
    cancelMode();
  }
  view.selected = id;
  if (game.provinces[id].owner === game.player) {
    const first = E.generalsIn(game, id).find((g) => !g.acted);
    view.openGeneral = first ? first.id : null;
  } else {
    view.openGeneral = null;
  }
  renderAll();
}

function cancelMode() {
  view.mode = null;
  view.targets = [];
  view.general = null;
}

function after() {
  save();
  renderAll();
  if (game.ended) showEnd();
}

function onCommand(g, cmd) {
  if (!cmd || !cmd.enabled) { if (cmd) toast(cmd.reason, 'bad'); return; }
  switch (cmd.type) {
    case 'develop': case 'commerce': case 'fortify': case 'recruit': case 'train': case 'charity': {
      const r = E.execute(game, { type: cmd.type, general: g.id });
      toast(r.text, r.ok ? 'good' : 'bad');
      openNextGeneral(g.province);
      after();
      break;
    }
    case 'move': case 'march':
      view.mode = cmd.type;
      view.targets = cmd.targets;
      view.general = g.id;
      renderAll();
      break;
    case 'goodwill': case 'alliance':
      openDiplomacy(g, cmd);
      break;
    default:
  }
}

/** 同じ国で次に動ける武将の命令欄を開いておく */
function openNextGeneral(pid) {
  const next = E.generalsIn(game, pid).find((g) => !g.acted);
  view.openGeneral = next ? next.id : null;
}

// --- 兵の数

function chooseTarget(targetId) {
  const g = game.generals[view.general];
  const from = game.provinces[g.province];
  const to = game.provinces[targetId];
  const march = view.mode === 'march';
  const dlg = $('dlg-troops');
  const range = $('troops-range');
  const max = from.soldiers;
  range.max = max;
  range.min = march ? Math.min(100, max) : 0;
  range.step = 100;
  range.value = march ? Math.max(100, Math.floor((max * 0.8) / 100) * 100) : Math.floor((max * 0.5) / 100) * 100;
  $('troops-title').textContent = march ? `${to.name}へ出陣` : `${to.name}へ移動`;
  $('troops-text').textContent = march
    ? `${g.name}が${from.name}から${to.name}（${ownerName(targetId)}）へ攻め込みます。守り手は兵 ${fmt(to.soldiers)}、防御 ${to.defense}。何人で出陣しますか？`
    : `${g.name}が${from.name}から${to.name}へ移ります。何人連れて行きますか？（0 でも移動できます）`;

  const refresh = () => {
    const n = Number(range.value);
    $('troops-value').textContent = `${fmt(n)} 人`;
    if (march) {
      const rice = Math.ceil(n / 100) * E.COST.marchRicePer100;
      const ratio = E.attackPower(n, g, from.training) / Math.max(1, E.defensePower(game, targetId));
      const odds = ratio >= 1.8 ? '有利' : ratio >= 1.3 ? 'やや有利' : ratio >= 1.0 ? '互角' : '不利';
      $('troops-note').textContent = `兵糧 米 ${rice}（残り ${fmt(game.daimyos[game.player].rice)}）／ 戦力の見立て：${odds}（${ratio.toFixed(1)} 倍）`;
      $('troops-ok').disabled = n < 100 || game.daimyos[game.player].rice < rice;
    } else {
      $('troops-note').textContent = `${from.name}に残る兵：${fmt(max - n)}`;
      $('troops-ok').disabled = false;
    }
  };
  range.oninput = refresh;
  refresh();
  $('troops-ok').onclick = () => {
    dlg.close();
    const n = Number(range.value);
    const r = E.execute(game, { type: view.mode, general: g.id, target: targetId, soldiers: n });
    cancelMode();
    if (!r.ok) { toast(r.text, 'bad'); renderAll(); return; }
    if (r.battle) {
      openNextGeneral(from.id);
      renderAll();
      openBattle(r.battle);
    } else {
      toast(r.text, 'good');
      view.selected = targetId;
      openNextGeneral(targetId);
      after();
    }
  };
  $('troops-cancel').onclick = () => { dlg.close(); cancelMode(); renderAll(); };
  openDialog(dlg);
}

// --- 外交

function openDiplomacy(g, cmd) {
  const dlg = $('dlg-diplomacy');
  const me = game.daimyos[game.player];
  const alliance = cmd.type === 'alliance';
  $('diplomacy-title').textContent = alliance ? '同盟を申し込む' : '贈り物をする';
  $('diplomacy-text').textContent = alliance
    ? `金 ${E.COST.alliance} を使って同盟を申し込みます。友好が高いほど成功しやすく、失敗すると友好が少し下がります。`
    : `金 ${E.COST.goodwill} で贈り物をします。${g.name}の政治が高いほど友好が上がります。`;
  const list = $('diplomacy-list');
  const cands = E.aliveDaimyos(game).filter((d) => d.id !== game.player);
  list.innerHTML = cands.map((d) => {
    const f = me.friendship[d.id];
    const allied = E.isAllied(game, game.player, d.id);
    const ok = alliance ? (f >= 60 && !allied) : true;
    const sum = E.daimyoSummary(game, d.id);
    return `<li><button type="button" class="dip" data-daimyo="${d.id}" ${ok ? '' : 'disabled'}>
      <i class="dot" style="background:${d.color}"></i><b>${d.name}</b>
      <span>${sum.provinces} か国 ／ 兵 ${fmt(sum.soldiers)}</span>
      <span class="friend">友好 ${f}${allied ? '（同盟中）' : ''}</span>
    </button></li>`;
  }).join('');
  list.querySelectorAll('[data-daimyo]').forEach((b) => b.addEventListener('click', () => {
    dlg.close();
    const r = E.execute(game, { type: cmd.type, general: g.id, daimyo: b.dataset.daimyo });
    toast(r.text, r.ok && r.success !== false ? 'good' : 'bad');
    openNextGeneral(g.province);
    after();
  }));
  $('diplomacy-cancel').onclick = () => dlg.close();
  openDialog(dlg);
}

// --- 合戦

function openBattle(b) {
  const dlg = $('dlg-battle');
  const att = $('battle-att');
  const def = $('battle-def');
  const ag = game.generals[b.attacker];
  const dg = E.bestGeneral(b.defenders.map((id) => game.generals[id]));
  const defOwner = b.defenderDaimyo ? game.daimyos[b.defenderDaimyo].name : '国人衆';
  $('battle-title').textContent = `${game.provinces[b.target].name}の戦い`;
  att.querySelector('.side-name').textContent = `${game.daimyos[b.attackerDaimyo].name}　${ag.name}`;
  def.querySelector('.side-name').textContent = `${defOwner}　${dg ? dg.name : '国人衆'}`;
  att.style.setProperty('--c', game.daimyos[b.attackerDaimyo].color);
  def.style.setProperty('--c', b.defenderDaimyo ? game.daimyos[b.defenderDaimyo].color : '#8d8f86');

  const render = () => {
    att.querySelector('.side-soldiers').textContent = `兵 ${fmt(Math.max(0, b.attSoldiers))} ／ ${fmt(b.attStart)}`;
    def.querySelector('.side-soldiers').textContent = `兵 ${fmt(Math.max(0, b.defSoldiers))} ／ ${fmt(b.defStart)}`;
    att.querySelector('.meter i').style.width = `${b.attStart ? (Math.max(0, b.attSoldiers) / b.attStart) * 100 : 0}%`;
    def.querySelector('.meter i').style.width = `${b.defStart ? (Math.max(0, b.defSoldiers) / b.defStart) * 100 : 0}%`;
    const ol = $('battle-log');
    ol.innerHTML = b.log.map((l) => `<li class="${l.result ? `result ${l.result}` : ''}">${l.text}</li>`).join('');
    ol.scrollTop = ol.scrollHeight;
    $('battle-attack').classList.toggle('hidden', b.done);
    $('battle-retreat').classList.toggle('hidden', b.done);
    $('battle-close').classList.toggle('hidden', !b.done);
    renderStatus();
  };
  $('battle-attack').onclick = () => { E.battleRound(game, b); render(); };
  $('battle-retreat').onclick = () => { E.battleRetreat(game, b); render(); };
  $('battle-close').onclick = () => {
    dlg.close();
    if (b.result === 'win') view.selected = b.target;
    after();
    promptCaptures(b.captured.filter((id) => game.generals[id].status === 'captured'));
  };
  render();
  openDialog(dlg);
}

function promptCaptures(ids) {
  if (!ids.length) return;
  const [id, ...rest] = ids;
  const g = game.generals[id];
  const dlg = $('dlg-capture');
  $('capture-text').textContent = `${g.name}（統率 ${g.lead}・武勇 ${g.valor}・政治 ${g.pol}）を捕らえました。`;
  $('capture-note').textContent = g.lord ? '相手の当主です。家臣になることはめったにありません。' : '家臣に誘うと、断られることもあります。断られた武将はもとの家へ帰ります。';
  $('capture-recruit').onclick = () => {
    dlg.close();
    const r = E.recruitCaptured(game, id, game.player);
    if (!r.joined) E.releaseCaptured(game, id);
    toast(r.text, r.joined ? 'good' : 'bad');
    after();
    promptCaptures(rest);
  };
  $('capture-release').onclick = () => {
    dlg.close();
    const r = E.releaseCaptured(game, id);
    toast(r.text);
    after();
    promptCaptures(rest);
  };
  openDialog(dlg);
}

// --- 月の終わり

function tryEndMonth() {
  if (game.ended) return;
  const left = E.generalsOf(game, game.player).filter((g) => !g.acted);
  if (left.length) {
    $('confirm-end-text').textContent = `まだ命令していない武将が ${left.length} 人います（${left.slice(0, 4).map((g) => g.name).join('、')}${left.length > 4 ? ' ほか' : ''}）。このまま月を終えますか？`;
    $('confirm-end-ok').onclick = () => { $('dlg-confirm-end').close(); endMonth(); };
    $('confirm-end-cancel').onclick = () => $('dlg-confirm-end').close();
    openDialog($('dlg-confirm-end'));
    return;
  }
  endMonth();
}

function endMonth() {
  cancelMode();
  game.report = [];
  const before = { provinces: E.provincesOf(game, game.player).length };
  runAi(game);
  if (!game.ended) E.advanceMonth(game);
  view.openGeneral = null;
  if (view.selected && game.provinces[view.selected].owner === game.player) {
    const first = E.generalsIn(game, view.selected).find((g) => !g.acted);
    view.openGeneral = first ? first.id : null;
  }
  save();
  renderAll();
  showReport(before);
}

function showReport(before) {
  const entries = game.report.filter((e) => !e.text.startsWith('収入：')).slice(-30);
  const income = game.report.find((e) => e.text.startsWith('収入：'));
  const lost = before.provinces - E.provincesOf(game, game.player).length;
  $('report-title').textContent = `${E.dateLabel(game)}の月報`;
  const li = [];
  if (income) li.push(`<li class="info">${income.text}</li>`);
  for (const e of entries) li.push(`<li class="${e.kind}">${e.text}</li>`);
  if (lost > 0) li.push(`<li class="bad">国を ${lost} つ失った……</li>`);
  if (!li.length) li.push('<li class="info">とくに変わったことはなかった。</li>');
  $('report-list').innerHTML = li.join('');
  $('report-close').onclick = () => { $('dlg-report').close(); if (game.ended) showEnd(); };
  openDialog($('dlg-report'));
}

function showEnd() {
  if (!game.ended) return;
  const win = game.ended.result === 'win';
  $('end-title').textContent = win ? '天下統一！' : '滅亡……';
  $('end-text').textContent = game.ended.text + (win ? ' 見事、乱世を終わらせました。' : ' またの挑戦をお待ちしています。');
  $('end-again').onclick = () => { $('dlg-end').close(); clearSave(); showStart(); };
  openDialog($('dlg-end'));
}

// --- 勢力一覧

function openRanking() {
  const tbody = $('ranking-table').querySelector('tbody');
  const me = game.daimyos[game.player];
  const rows = E.aliveDaimyos(game).map((d) => E.daimyoSummary(game, d.id)).sort((a, b) => b.score - a.score);
  tbody.innerHTML = rows.map((d, i) => {
    const mine = d.id === game.player;
    const until = me.alliance[d.id];
    return `<tr class="${mine ? 'me' : ''}">
      <td><i class="dot" style="background:${d.color}"></i>${i + 1}. ${d.name}</td>
      <td>${d.lord}</td><td>${d.provinces}</td><td>${fmt(d.soldiers)}</td><td>${d.generals}</td>
      <td>${mine ? '—' : me.friendship[d.id]}</td>
      <td>${mine ? '—' : until && until > game.turn ? `あと ${until - game.turn} か月` : ''}</td>
    </tr>`;
  }).join('');
  $('ranking-close').onclick = () => $('dlg-ranking').close();
  openDialog($('dlg-ranking'));
}

// --- 開始画面

function showStart() {
  const saved = loadSave();
  const btn = $('btn-continue');
  btn.classList.toggle('hidden', !saved || Boolean(saved.ended));
  btn.onclick = () => resumeGame(saved);
  openDialog($('dlg-start'));
}

/** 選んでいる国（なければ本拠）が見えるように地図をスクロールする */
function centerMap() {
  if (!game) return;
  const pid = view.selected || game.daimyos[game.player].capital;
  const p = PROVINCES.find((x) => x.id === pid);
  const box = $('map-scroll');
  const svg = $('map');
  const W = svg.clientWidth;
  const H = svg.clientHeight;
  if (!p || !W || !H) return;
  const k = Math.min(W / 920, H / 640); // preserveAspectRatio: meet
  const x = (W - 920 * k) / 2 + p.x * k;
  const y = (H - 640 * k) / 2 + p.y * k;
  box.scrollTo({ left: x - box.clientWidth / 2, top: y - box.clientHeight / 2, behavior: 'smooth' });
}

// ------------------------------------------------------------------ 起動

function init() {
  map = createMap($('map'), { onSelect: selectProvince });
  buildStartDialog();

  $('btn-end').addEventListener('click', tryEndMonth);
  $('btn-help').addEventListener('click', () => openDialog($('dlg-help')));
  $('help-close').addEventListener('click', () => $('dlg-help').close());
  $('btn-ranking').addEventListener('click', openRanking);
  $('btn-menu').addEventListener('click', () => openDialog($('dlg-menu')));
  $('menu-close').addEventListener('click', () => $('dlg-menu').close());
  $('menu-new').addEventListener('click', () => { $('dlg-menu').close(); showStart(); });
  $('map-wrap').addEventListener('click', (e) => {
    if (view.mode && !e.target.closest('.node') && !e.target.closest('.map-zoom')) { cancelMode(); renderAll(); }
  });
  // 地図の拡大縮小（狭い画面では最初から少し拡大しておく）
  let zoom = window.matchMedia('(max-width: 900px)').matches ? 1.8 : 1;
  const applyZoom = () => {
    $('map-wrap').style.setProperty('--zoom', zoom);
    $('zoom-out').disabled = zoom <= 1;
    $('zoom-in').disabled = zoom >= 3;
  };
  $('zoom-in').addEventListener('click', () => { zoom = Math.min(3, zoom + 0.4); applyZoom(); centerMap(); });
  $('zoom-out').addEventListener('click', () => { zoom = Math.max(1, zoom - 0.4); applyZoom(); centerMap(); });
  applyZoom();
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && view.mode && !document.querySelector('dialog[open]')) { cancelMode(); renderAll(); }
  });
  // 「大名を選ぶ」は Esc で閉じない
  $('dlg-start').addEventListener('cancel', (e) => { if (!game) e.preventDefault(); });

  showStart();

  window.sengoku = {
    get game() { return game; },
    view, E, runAi,
    select: selectProvince, endMonth, render: renderAll, start: startGame,
  };
}

init();
