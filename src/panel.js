// 面板：舞台 / 库 / 收藏 / 设置
import { ctx, el, btn, ibtn, esc, uid, clone, byId, toast, fail, fmtTime, copyText, saveFile, pickFile } from './util.js';
import { state, save, setSetting, upsert, remove, seedDefaults, saveAll, backendName } from './store.js';
import { DEFAULT_SETTINGS, LENGTH_LABEL } from './defaults.js';
import { currentChar, apiTargets, targetLabel, resolveTarget, API_FORMATS, fetchModels, callModel, worldNames, tavernWorlds, loadBook, lampOf } from './host.js';
import {
  generateTheater, weightedRandomCombo, aiPickCombo, continueExtra, segmentsOf, kindOf, KIND_LABEL, charCount, randomCandidates, comboParts, followAgain,
  resultPlainText, contextLabel, postProcess,
} from './gen.js';
import { INSTR, instrDefault, instrEdited } from './instr.js';
import { FOLDS, foldCss, currentFold, customFoldCss, applyFold } from './fold.js';
import { resolveCombo, globalContext, globalWho, globalChannel, globalStyle, globalStaged, globalWriteBack, WHO_LABEL, CHANNEL_LABEL, STYLE_LABEL } from './follow.js';
import { mountFrame, updateReading, applyTheme, themeName, markTheme, activeCustom, BUILTIN_THEMES, CANVAS_LABEL } from './frame.js';
import {
  field, input, textarea, select, toggle, seg, tagsToText, textToTags, openSheet, setSheetHost, closeAllSheets,
  closeTopSheet, confirmSheet, snapshotInfo, requestView, openViewer, closeViewer, viewerOpen,
} from './ui.js';
import { exportBundle, exportCombo, importBundle, classifyJson, parseTextBlocks, addRows, combosFromPrompts, importDarkArchives, clearLibrary } from './data.js';
import { isFavorite, toggleFavorite, chatTheaters } from './favs.js';
import { newPart, partPool, itemLabel, itemAlive, usesPrompt, comboPromptIds } from './parts.js';
import { attachToLatest } from './chat.js';
import { notifyDone } from './notify.js';

let root = null, panelEl = null, bodyEl = null, kickerEl = null;
let tab = 'stage', libTab = 'combos', setTab = 'gen', favTab = 'fav', favFilter = 'all', promptFilter = '', favScope = 'char', favQuery = '';
/** 这篇是不是当前聊天角色的（新的按头像文件认，老的按名字） */
const ofCurrentChar = r => { const c = currentChar(); if (!c) return true; return r.characterAvatar ? r.characterAvatar === c.avatar : r.characterName === c.name; };
/** 「当前角色 / 全部」两个筛选胶囊；全是当前角色的就不显示 */
function scopeChips(all, mine, scope, onPick) {
  const chips = el('div', 'xjc-chips');
  if (!currentChar() || mine === all) return chips;
  for (const o of [{ v: 'char', l: `${currentChar().name} ${mine}` }, { v: 'all', l: `全部角色 ${all}` }]) {
    const c = el('button', 'xjc-chip' + (scope === o.v ? ' on' : ''), o.l);
    c.type = 'button';
    c.onclick = () => onPick(o.v);
    chips.appendChild(c);
  }
  return chips;
}
const views = {};
const stageBox = {};
let busy = null, runSeq = 0;
let current = null; // { result, frame, card, statusEl }

const TABS = [
  { v: 'stage', l: '舞台', i: 'fa-solid fa-masks-theater' },
  { v: 'library', l: '库', i: 'fa-solid fa-book' },
  { v: 'fav', l: '收藏', i: 'fa-solid fa-heart' },
  { v: 'settings', l: '设置', i: 'fa-solid fa-gear' },
];

// ── 外壳 ──
function build() {
  root = el('div', 'xjc-root');
  root.hidden = true;
  root.dataset.ttMobileSurface = 'backdrop';
  markTheme(root);
  root.addEventListener('click', e => { if (e.target === root) close(); });
  panelEl = el('div', 'xjc-panel');
  const hd = el('div', 'xjc-hd');
  const txt = el('div', 'xjc-hd-txt xjc-grow');
  kickerEl = el('div', 'xjc-kicker');
  const h = el('h2');
  h.innerHTML = '小剧场<small>THÉÂTRE DE POCHE</small>';
  txt.append(kickerEl, h);
  hd.appendChild(txt);
  const x = el('button', 'xjc-x', '✕');
  x.type = 'button';
  x.setAttribute('aria-label', '关闭');
  x.onclick = close;
  hd.appendChild(x);
  const tabs = el('div', 'xjc-tabs');
  TABS.forEach((t, i) => {
    const b = el('button');
    b.type = 'button';
    b.dataset.v = t.v;
    b.dataset.k = String(i + 1);
    b.innerHTML = `<i class="${t.i}"></i><span>${t.l}</span>`;
    b.onclick = () => switchTab(t.v);
    tabs.appendChild(b);
  });
  bodyEl = el('div', 'xjc-body');
  for (const t of TABS) {
    views[t.v] = el('section', 'xjc-view');
    views[t.v].dataset.view = t.v;
    bodyEl.appendChild(views[t.v]);
  }
  panelEl.append(hd, tabs, bodyEl);
  root.appendChild(panelEl);
  document.body.appendChild(root);
  setSheetHost(panelEl);
  buildStage();
  document.addEventListener('keydown', e => {
    if (root.hidden || e.key !== 'Escape' || viewerOpen()) return;
    e.stopPropagation();
    if (!closeTopSheet()) close();
  }, true);
}

export function open(which) {
  if (!root) build();
  root.hidden = false;
  switchTab(which || tab);
}
export function close() {
  if (!root) return;
  closeAllSheets();
  root.hidden = true;
}
export const isOpen = () => !!root && !root.hidden;
export function refresh() { if (isOpen()) switchTab(tab); }

/** 报头：第几篇 · 日期 */
function renderKicker() {
  if (!kickerEl) return;
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  kickerEl.innerHTML = '';
  kickerEl.append(el('span', 'no', `NO. ${String((Number(state.settings.played) || 0) + 1).padStart(3, '0')}`), el('span', 'date', `${d.getFullYear()} · ${p(d.getMonth() + 1)} · ${p(d.getDate())}`));
}

function switchTab(v) {
  tab = v;
  renderKicker();
  panelEl.querySelectorAll('.xjc-tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  for (const [k, node] of Object.entries(views)) node.hidden = k !== v;
  if (v === 'stage') renderStage();
  if (v === 'library') renderLibrary();
  if (v === 'fav') renderFav();
  if (v === 'settings') renderSettings();
}

// ── 舞台 ──
function buildStage() {
  const v = views.stage;
  for (const k of ['notice', 'pick', 'extra', 'actions', 'result', 'recent']) stageBox[k] = el('div', `xjc-stage-${k}`);
  stageBox.actions.className = 'xjc-actions';
  // 附加要求：平时收着，点开才填；填的内容跟着这几次生成，「不用了」清空收起
  const extra = textarea('', 3, '这次额外想写的，比如：下雨天、写得甜一点、让 TA 吃醋');
  stageBox.extraInput = extra;
  stageBox.extra.className = 'xjc-extra';
  const open = btn('＋ 这次附加要求', () => setExtra(true), 'xjc-btn sm ghost xjc-extra-open');
  const box = el('div', 'xjc-extra-box');
  const hd = el('div', 'xjc-extra-hd');
  hd.append(el('span', 'lb', '这次附加要求'), btn('不用了', () => { extra.value = ''; setExtra(false); }, 'xjc-btn sm ghost'));
  box.append(hd, extra);
  const setExtra = on => { open.hidden = on; box.hidden = !on; if (on) extra.focus(); };
  stageBox.extra.append(open, box);
  box.hidden = true;
  stageBox.genBtn = btn('生成一篇', () => {
    const c = currentCombo();
    if (!c) { toast('先在「库」里建一个小剧场'); switchTab('library'); return; }
    const ids = stagePicks(c);
    run(ids.length ? { ...c, _forcedRandomIds: ids } : c, stageBox.extraInput.value.trim());
  }, 'xjc-btn pri');
  stageBox.rndBtn = btn('随机', () => run(weightedRandomCombo(), stageBox.extraInput.value.trim()), 'xjc-btn');
  stageBox.aiBtn = btn('AI 自选', () => run(aiPickCombo(), stageBox.extraInput.value.trim()), 'xjc-btn');
  stageBox.rndBtn.insertAdjacentHTML('afterbegin', '<i class="fa-solid fa-dice"></i>');
  stageBox.actions.append(stageBox.genBtn, stageBox.rndBtn, stageBox.aiBtn);
  v.append(stageBox.notice, stageBox.pick, stageBox.extra, stageBox.actions, stageBox.result, stageBox.recent);
}

// 直接用提示词生成：currentComboId 为 TEMP 时，舞台上是用 stagePromptIds 临时拼的小剧场（不进库，其余都跟随全局）
const TEMP = '@prompts';
function tempCombo() {
  const ps = (state.settings.stagePromptIds || []).map(id => byId(state.prompts, id)).filter(Boolean);
  if (!ps.length) return null;
  return {
    ...newCombo(), id: '', temp: true, name: ps.length === 1 ? ps[0].title : `${ps[0].title} 等 ${ps.length} 条`,
    preambleId: byId(state.preambles, state.settings.stagePreambleId) ? state.settings.stagePreambleId : newCombo().preambleId,
    parts: [{ ...newPart(ps.map(p => `p:${p.id}`)), id: 'pt_temp' }], output: { ...newCombo().output, mode: 'mixed' },
  };
}
function currentCombo() {
  if (state.settings.currentComboId === TEMP) { const t = tempCombo(); if (t) return t; }
  return byId(state.combos, state.settings.currentComboId) || state.combos[0] || null;
}
function renderStage() {
  renderNotice();
  renderPick();
  renderRecent();
  updateBusyButtons();
  if (current && !stageBox.result.children.length) showResult(current.result);
}

/** 没打开角色聊天（或在群聊里）时提示一下；平时什么都不显示 */
function renderNotice() {
  const box = stageBox.notice;
  box.innerHTML = '';
  if (currentChar()) return;
  const card = el('div', 'xjc-cast');
  card.appendChild(el('div', 'xjc-grow', ctx().groupId ? '小剧场不支持群聊，切到一个角色聊天再来。' : '先打开一个角色聊天。小剧场用这个聊天的角色卡、世界书和聊天记录，提示词里的 {{char}} 就是这个角色。'));
  box.appendChild(card);
}

function comboChips(raw) {
  const c = resolveCombo(raw);
  const chips = el('div', 'xjc-chips');
  const chip = (k, v) => { const s = el('span', 'xjc-chip'); s.style.cursor = 'default'; s.appendChild(el('b', '', k)); s.appendChild(document.createTextNode(v)); chips.appendChild(s); };
  const pre = byId(state.preambles, c.preambleId);
  if (pre) chip('前置', pre.name);
  // 每段一个：全用的列标题，随机的写「抽 1 / 3」
  const parts = comboParts(c).filter(pt => pt.pool.length);
  if (!parts.length) chip('提示词', '无');
  parts.forEach((pt, i) => chip(pt.name || (parts.length > 1 ? `第 ${i + 1} 段` : '提示词'), pt.pick && pt.pool.length > pt.pick ? `随机抽 ${pt.pick} / ${pt.pool.length}` : pt.pool.map(p => p.title).join(' · ')));
  if (c.random?.count) chip('随机附加', `抽 ${c.random.count}${(c.random.include || []).length ? ' · #' + c.random.include.join(' #') : ''}`);
  chip('输出', `${{ text: '文字', html: 'HTML', mixed: '混排' }[c.output?.mode] || '文字'}${c.output?.staged && c.output?.mode === 'html' ? ' · 分两步' : ''}`);
  chip('上下文', c.channel === 'preset' ? '走酒馆预设' : contextLabel(c.context));
  if (c.writeBack && S().writeBackFeature) chip('写回', '世界书');
  chip('出口', targetLabel(resolveTarget(c.api)).replace(/^连接配置 · |^自配 · /, ''));
  return chips;
}

function renderPick() {
  const box = stageBox.pick;
  box.innerHTML = '';
  const cur = currentCombo();
  if (!cur) {
    if (!state.prompts.length) { box.appendChild(el('div', 'xjc-empty', '还没有小剧场和提示词，去「库」里建一个。')); return; }
    box.appendChild(btn('选小剧场或提示词 ›', pickCombo, 'xjc-btn'));
    return;
  }
  // 和 Float 一样：舞台只放当前这一个，点卡片弹出列表换
  const card = el('div', 'xjc-combo-card');
  card.dataset.scene = String(state.combos.indexOf(cur) + 1);
  card.title = '点一下换一个';
  card.onclick = e => { if (!e.target.closest('.xjc-btn')) pickCombo(); };
  const row = el('div', 'xjc-row nowrap');
  const nm = el('div', 'nm xjc-grow', cur.name);
  if (cur.temp) nm.prepend(el('span', 'xjc-temp', '临时'));
  const edit = cur.temp
    ? btn('存成小剧场', () => { const { temp, ...draft } = cur; editCombo(null, draft); }, 'xjc-btn sm ghost')
    : ibtn('fa-pen', '编辑', () => editCombo(cur));
  row.append(nm, edit, btn('换一个 ›', pickCombo, 'xjc-btn sm'));
  card.append(row, comboChips(cur));
  // 带随机抽取的：这次可以指定用哪几条，不随机
  const pools = stagePools(cur);
  if (pools.length) {
    const ids = stagePicks(cur);
    const pr = el('div', 'xjc-pickrow');
    const text = pools.map(p => {
      const own = p.pool.filter(x => ids.includes(x.id)).map(x => x.title);
      return `${pools.length > 1 ? p.label + '：' : ''}${own.length ? own.join('、') : `随机 ${p.pick} 条`}`;
    }).join('；');
    pr.append(el('span', 'lb', '这次抽'), el('span', 'xjc-grow v', text), btn(ids.length ? '改 ›' : '指定 ›', () => pickRandoms(cur), 'xjc-btn sm ghost'));
    if (ids.length) pr.insertBefore(btn('改回随机', () => { setSetting({ stagePick: null }); renderPick(); }, 'xjc-btn sm ghost'), pr.lastChild);
    card.appendChild(pr);
  }
  box.appendChild(card);
}

/** 这个小剧场里会随机的地方：每个随机段一组，随机池一组 */
function stagePools(c) {
  const out = comboParts(c).map((pt, i) => ({ label: pt.name || `第 ${i + 1} 段`, pick: pt.pick, pool: pt.pool })).filter(p => p.pick && p.pool.length > p.pick);
  if (Number(c.random?.count) > 0) { const pool = randomCandidates(c); if (pool.length) out.push({ label: '随机附加', pick: Number(c.random.count), pool }); }
  return out;
}
/** 舞台上这个小剧场「这次指定」的条目 id（换了小剧场就不算） */
function stagePicks(c) {
  const p = state.settings.stagePick;
  if (!p || !Array.isArray(p.ids) || p.comboId !== (c.temp ? TEMP : c.id)) return [];
  const ok = new Set(stagePools(c).flatMap(x => x.pool.map(r => r.id)));
  return p.ids.filter(id => ok.has(id));
}
/** 从会随机的地方点选，这次就用选中的；没点的那组照常随机。一直生效到改回随机或换小剧场 */
function pickRandoms(c) {
  const pools = stagePools(c);
  const picked = new Set(stagePicks(c));
  openSheet('这次抽哪几条', (body, foot, closeIt) => {
    body.appendChild(el('p', 'xjc-hint', `在这里点选的，接下来生成「${c.name}」都用它们，和其他部分照常搭配；某一组一条都不点就照常随机。改回随机或换了小剧场就恢复，小剧场本身的设置不变。`));
    const list = el('div');
    body.appendChild(list);
    const useBtn = btn('', () => {
      if (!picked.size) { setSetting({ stagePick: null }); } else setSetting({ stagePick: { comboId: c.temp ? TEMP : c.id, ids: [...picked] } });
      closeIt(); renderPick();
    }, 'xjc-btn pri');
    const draw = () => {
      list.innerHTML = '';
      for (const p of pools) {
        list.appendChild(el('div', 'xjc-sec', `${p.label} · 平时随机抽 ${p.pick} 条`));
        const box = el('div', 'xjc-list');
        const order = p.pool.filter(x => picked.has(x.id)).map(x => x.id);
        for (const x of p.pool) {
          const it = itemRow(x.title, `${x.group ? x.group + ' · ' : ''}${(x.tags || []).map(t => '#' + t).join(' ')} ${String(x.content || '').replace(/\s+/g, ' ').slice(0, 40)}`, () => { if (picked.has(x.id)) picked.delete(x.id); else picked.add(x.id); draw(); }, picked.has(x.id) ? `第 ${order.indexOf(x.id) + 1} 条` : '');
          if (picked.has(x.id)) it.classList.add('on');
          box.appendChild(it);
        }
        list.appendChild(box);
      }
      useBtn.textContent = picked.size ? `用这 ${picked.size} 条` : '随机抽';
    };
    foot.appendChild(useBtn);
    draw();
  });
}

/** 选小剧场：可搜索、按标签筛；点一行就设为当前 */
function pickCombo() {
  openSheet('换一个', (body, foot, closeIt) => {
    // 两种选法：选一个存好的小剧场，或者直接挑几条提示词（临时拼，不进库）
    let mode = state.settings.currentComboId === TEMP || !state.combos.length ? 'prompts' : 'combos';
    const modeSeg = seg([{ v: 'combos', l: `小剧场（${state.combos.length}）` }, { v: 'prompts', l: `直接用提示词（${state.prompts.length}）` }], mode, v => { mode = v; q = ''; tag = ''; search.value = ''; build(); });
    body.appendChild(modeSeg);
    let q = '', tag = '';
    const curId = state.settings.currentComboId;
    const picked = new Set(state.settings.currentComboId === TEMP ? state.settings.stagePromptIds || [] : []);
    const search = input('', '搜名字 / 标签');
    search.type = 'search';
    search.style.marginTop = '10px';
    search.oninput = () => { q = search.value.trim().toLowerCase(); draw(); };
    body.appendChild(search);
    const hint = el('p', 'xjc-hint', '点选一条或几条，按顺序拼在一起生成；前置要求在下面选，其他都跟随全局。觉得好用可以在舞台上「存成小剧场」。');
    body.appendChild(hint);
    const preSel = select(state.preambles.map(p => ({ v: p.id, l: p.name })), byId(state.preambles, state.settings.stagePreambleId) ? state.settings.stagePreambleId : (state.settings.defaultPreambleId || state.preambles[0]?.id || ''));
    const preF = field('前置要求', preSel);
    body.appendChild(preF);
    const chips = el('div', 'xjc-chips');
    chips.style.margin = '10px 0 4px';
    body.appendChild(chips);
    const list = el('div', 'xjc-list');
    list.style.marginTop = '8px';
    body.appendChild(list);
    const useBtn = btn('用选中的提示词', () => {
      if (!picked.size) { toast('先点选至少一条提示词'); return; }
      setSetting({ currentComboId: TEMP, stagePromptIds: [...picked], stagePreambleId: preSel.value }); closeIt(); renderPick();
    }, 'xjc-btn pri');
    const newBtn = btn('＋ 新建小剧场', () => { closeIt(); editCombo(null); }, 'xjc-btn');
    foot.append(newBtn, useBtn);
    let tags = [];
    const build = () => {
      tags = allTags(mode === 'combos' ? state.combos : state.prompts);
      chips.hidden = !tags.length;
      hint.hidden = preF.hidden = mode !== 'prompts';
      search.hidden = (mode === 'combos' ? state.combos : state.prompts).length <= 6;
      newBtn.hidden = mode !== 'combos';
      useBtn.hidden = mode !== 'prompts';
      drawTags(); draw();
    };
    const paintUse = () => { useBtn.textContent = picked.size ? `用这 ${picked.size} 条` : '用选中的提示词'; };
    const drawTags = () => {
      chips.innerHTML = '';
      for (const t of ['', ...tags]) {
        const c = el('button', 'xjc-chip' + (tag === t ? ' on' : ''), t ? '#' + t : '全部');
        c.type = 'button';
        c.onclick = () => { tag = t; drawTags(); draw(); };
        chips.appendChild(c);
      }
    };
    const draw = () => {
      list.innerHTML = '';
      if (mode === 'prompts') {
        const shownP = state.prompts.filter(p => (!tag || (p.tags || []).includes(tag)) && (!q || (p.title + ' ' + (p.group || '') + ' ' + (p.tags || []).join(' ')).toLowerCase().includes(q)));
        if (!shownP.length) list.appendChild(el('div', 'xjc-empty', state.prompts.length ? '没有匹配的提示词' : '提示词库是空的'));
        const order = [...picked];
        const rowOf = p => {
          const it = itemRow(p.title, `${(p.tags || []).map(t => '#' + t).join(' ') || '无标签'} · ${String(p.content || '').replace(/\s+/g, ' ').slice(0, 40)}`, () => {
            if (picked.has(p.id)) picked.delete(p.id); else picked.add(p.id);
            draw();
          }, picked.has(p.id) ? `第 ${order.indexOf(p.id) + 1} 条` : '');
          if (picked.has(p.id)) it.classList.add('on');
          return it;
        };
        const whole = (g, inG) => {
          const all = inG.every(p => picked.has(p.id));
          return btn(all ? '整组去掉' : '整组选上', e => { e.stopPropagation(); for (const p of inG) { if (all) picked.delete(p.id); else picked.add(p.id); } draw(); }, 'xjc-btn sm');
        };
        if (shownP.length) groupedList(list, 'prompts', shownP, rowOf, { open: !!(q || tag), manage: false, headExtra: whole });
        paintUse();
        return;
      }
      const shown = state.combos.filter(c => (!tag || (c.tags || []).includes(tag)) && (!q || (c.name + ' ' + (c.tags || []).join(' ')).toLowerCase().includes(q)));
      if (!shown.length) list.appendChild(el('div', 'xjc-empty', '没有匹配的小剧场'));
      for (const c of shown) {
        const on = c.id === curId;
        const it = itemRow(c.name, `${(c.tags || []).map(t => '#' + t).join(' ') || '无标签'} · ${c.plays || 0} 次${c.lastUsedAt ? ' · ' + fmtTime(c.lastUsedAt) : ''}`, () => {
          setSetting({ currentComboId: c.id }); closeIt(); renderPick();
        }, on ? '当前' : '');
        if (on) it.classList.add('on');
        it.appendChild(ibtn('fa-pen', '编辑', e => { e.stopPropagation(); closeIt(); editCombo(c); }));
        list.appendChild(it);
      }
    };
    build();
  });
}

function renderRecent() {
  const box = stageBox.recent;
  box.innerHTML = '';
  if (!state.recent.length) return;
  // 默认只看当前角色的；切到别的角色时不会满屏是别人的
  const mine = state.recent.filter(ofCurrentChar);
  const scope = S().recentScope === 'all' ? 'all' : 'char';
  const chips = scopeChips(state.recent.length, mine.length, scope, v => { setSetting({ recentScope: v }); renderRecent(); });
  const shown = scope === 'all' || !chips.children.length ? state.recent : mine;
  // 默认折叠，点标题展开；展开 / 折叠记在设置里
  const open = !!S().recentOpen;
  const head = el('button', `xjc-sec xjc-sec-fold${open ? ' open' : ''}`, `最近 · ${shown.length} 篇 · 保留 ${state.settings.recentKeep} 篇`);
  head.type = 'button';
  head.setAttribute('aria-expanded', String(open));
  head.onclick = () => { setSetting({ recentOpen: !open }); renderRecent(); };
  box.appendChild(head);
  if (!open) return;
  if (chips.children.length) { chips.style.marginBottom = '8px'; box.appendChild(chips); }
  const list = el('div', 'xjc-list');
  if (!shown.length) list.appendChild(el('div', 'xjc-empty', `${currentChar()?.name || '这个角色'}还没有最近的小剧场。`));
  for (const r of shown) list.appendChild(resultItem(r, () => { showResult(r); stageBox.result.scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
  box.appendChild(list);
}

function resultItem(r, onClick, endText) {
  const item = el('div', 'xjc-item');
  const mid = el('div', 'xjc-grow');
  mid.appendChild(el('div', 't', `${isFavorite(r) ? '♥ ' : ''}${r.title || '无题'}`));
  mid.appendChild(el('div', 'd', [KIND_LABEL[kindOf(r)], r.snapshot?.comboName, r.characterName].filter(Boolean).join(' · ')));
  item.append(mid, el('div', 'end', endText || fmtTime(r.createdAt)));
  item.onclick = onClick;
  return item;
}

function updateBusyButtons() {
  if (!stageBox.genBtn) return;
  const noChar = !currentChar();
  for (const b of [stageBox.genBtn, stageBox.rndBtn, stageBox.aiBtn]) b.disabled = !!busy || noChar;
  stageBox.genBtn.textContent = busy ? '正在写…' : '生成一篇';
}

/** 结果卡。pending=true 时是占位（流式 / 骨架） */
function showResult(result, { pending = false, status = '', onRetry } = {}) {
  const host = stageBox.result;
  host.innerHTML = '';
  const card = el('article', 'xjc-result');
  card.dataset.stdout = pending ? 'stdout · writing…' : `stdout · ${fmtTime(result.createdAt)} · ${charCount(result)} chars`;
  const hd = el('div', 'xjc-result-hd');
  const snap = result.snapshot || {};
  const picks = snap.randoms || [];
  const partPicks = (snap.parts || []).flatMap(pt => pt.used || []);
  const followNote = snap.follow ? ` · ${snap.follow.mode === 'ask' ? '追问' : '接着'}《${snap.follow.of}》` : '';
  hd.appendChild(el('div', 'kind', `${pending ? '写作中' : KIND_LABEL[kindOf(result)]} · ${snap.comboName || result.comboName || '小剧场'}${followNote}${[...partPicks, ...picks].length ? ' · 抽到 ' + [...partPicks, ...picks].join('、') : ''}`));
  const h3 = el('h3', '', result.title || snap.comboName || '无题');
  hd.appendChild(h3);
  if (!pending) {
    // 和 Float 一样：右上角就是全屏，点标题也行
    hd.appendChild(ibtn('fa-expand', '全屏', () => viewResult(result), 'xjc-btn sm ghost icon xjc-fs'));
    h3.classList.add('tap');
    h3.title = '点标题全屏看';
    h3.onclick = () => viewResult(result);
  }
  const statusEl = el('div', 'xjc-status');
  statusEl.hidden = true;
  const wrap = el('div', 'xjc-frame-wrap');
  card.append(hd, statusEl, wrap);
  const segs = pending && !(result.segments || []).length ? [] : segmentsOf(result);
  const frame = mountFrame(wrap, segs, { onAction: pending ? null : text => continueFrom(result, text) });
  if (!pending) {
    const meta = el('div', 'xjc-meta');
    meta.append(el('span', '', `${result.characterName ? result.characterName + ' · ' : ''}${fmtTime(result.createdAt)}`), el('span', '', `${charCount(result)} 字 · ${result.comboCopy?.channel === 'preset' ? '走酒馆预设' : contextLabel(snap.context || result.comboCopy?.context)}${result.model ? ' · ' + result.model : ''}`));
    card.appendChild(meta);
    const ops = el('div', 'xjc-ops');
    ops.appendChild(btn('再来一条', () => again(result), 'xjc-btn'));
    ops.appendChild(btn('接着写 / 追问', () => followSheet(result), 'xjc-btn xjc-follow-btn'));
    const favBtn = btn(isFavorite(result) ? '♥ 已收藏' : '♡ 收藏', () => {
      const on = toggleFavorite(result);
      favBtn.textContent = on ? '♥ 已收藏' : '♡ 收藏';
      renderRecent();
    }, 'xjc-btn');
    ops.appendChild(favBtn);
    ops.appendChild(btn('挂到聊天', async () => {
      try { const at = await attachToLatest(result); toast(`已挂到第 ${at} 楼下面`, 'success'); } catch (e) { fail(e); }
    }, 'xjc-btn xjc-attach'));
    ops.appendChild(ibtn('fa-copy', '复制正文', async () => toast((await copyText(`${result.title}\n\n${resultPlainText(result)}`)) ? '已复制正文' : '复制失败'), 'xjc-btn ghost icon'));
    ops.appendChild(ibtn('fa-circle-info', '这一篇用了什么', () => openSheet('这一篇用了什么', b => {
      b.appendChild(snapshotInfo(result));
      b.appendChild(el('div', 'xjc-sec', '发给模型的内容'));
      b.appendChild(requestView(result));
      b.appendChild(el('div', 'xjc-sec', '模型原文'));
      b.appendChild(el('pre', 'xjc-pre', result.raw || ''));
    }), 'xjc-btn ghost icon'));
    card.appendChild(ops);
  }
  host.appendChild(card);
  current = { result, frame, card, statusEl };
  if (status) setStatus(status, { spin: pending, onRetry });
  return current;
}

function setStatus(text, { spin = true, onCancel, onRetry } = {}) {
  if (!current) return;
  const s = current.statusEl;
  s.innerHTML = '';
  s.hidden = !text;
  if (!text) return;
  if (spin) s.appendChild(el('i', 'xjc-spin'));
  s.appendChild(el('span', 'xjc-grow', text));
  if (onCancel) s.appendChild(btn('取消', onCancel, 'xjc-btn sm ghost'));
  if (onRetry) s.appendChild(btn('重试', onRetry, 'xjc-btn sm'));
}

function viewResult(result) {
  openViewer(result, {
    actions: [
      { label: '再来一条', run: r => { again(r); return false; } },
      { label: '接着写 / 追问', run: r => { followSheet(r); return false; } },
      { label: isFavorite(result) ? '♥' : '♡', title: '收藏', run: (r, b) => { b.textContent = toggleFavorite(r) ? '♥' : '♡'; renderRecent(); return true; } },
    ],
    onAction: text => continueFrom(result, text),
  });
}

function comboOf(result) { return result.comboCopy || byId(state.combos, result.snapshot?.comboId) || null; }
function again(result) {
  const combo = comboOf(result);
  if (!combo) { toast('这篇的配置已经找不到了'); return; }
  open('stage');
  const follow = followAgain(result);
  run(combo, result.snapshot?.extra || '', follow ? { follow } : {});
}
function continueFrom(result, text) {
  const combo = comboOf(result);
  if (!combo) { toast('这篇的配置已经找不到了'); return; }
  open('stage');
  run(combo, continueExtra(result, text));
}

/** 接着写 / 追问：带上这一篇（接着写过几次的再往前带两篇）的正文，用同一套再出一篇；这一篇随机抽到的也沿用 */
function followSheet(result) {
  const combo = comboOf(result);
  if (!combo) { toast('这篇的配置已经找不到了'); return; }
  openSheet(`接着《${result.title || '这一篇'}》`, (body, foot, closeIt) => {
    let mode = 'write', form = 'same';
    const ta = textarea('', 4);
    const PH = { write: '接下来想看什么，比如：第二天早上 TA 发现了那张纸条（可以不写，让 TA 自己往下演）', ask: '想问什么，比如：那这张逆位的月亮是什么意思？' };
    ta.placeholder = PH.write;
    body.appendChild(field('要做什么', seg([{ v: 'write', l: '接着写' }, { v: 'ask', l: '追问' }], mode, v => { mode = v; ta.placeholder = PH[v]; })));
    body.appendChild(field('这次的要求', ta));
    if ((combo.output?.mode || 'text') !== 'text') body.appendChild(field('形式', seg([{ v: 'same', l: '和这一篇一样' }, { v: 'text', l: '纯文字' }], form, v => { form = v; })));
    body.appendChild(el('p', 'xjc-hint', '会带上这一篇的正文，用同一套前置要求和提示词，这一篇随机抽到的也沿用。出来的新一篇照常进「最近」，可以再接着往下。'));
    foot.appendChild(btn('出一篇', () => {
      const text = ta.value.trim();
      if (mode === 'ask' && !text) { toast('写一下想问什么'); return; }
      closeIt();
      closeViewer();
      const c = form === 'text' ? { ...combo, output: { ...combo.output, mode: 'text', staged: false } } : combo;
      run(c, '', { follow: { of: result, mode, text } });
    }, 'xjc-btn pri'));
  });
}

function streamSegments(text) {
  const body = text.replace(/^\s*(?:标题|题目|Title)\s*[:：].*\n?/, '').replace(/<\/?[a-zA-Z][\w-]*>/g, '');
  return body.trim() ? [{ type: 'text', content: body }] : [];
}

export async function run(combo, extra = '', more = {}) {
  if (busy) { toast('上一篇还在写'); return; }
  if (!currentChar()) { toast(ctx().groupId ? '小剧场不支持群聊' : '先打开一个角色聊天'); return; }
  if (!isOpen()) open('stage');
  else if (tab !== 'stage') switchTab('stage');
  const ctrl = new AbortController();
  const token = ++runSeq;
  const t0 = Date.now();
  busy = { ctrl, token };
  updateBusyButtons();
  const target = resolveTarget(combo.api);
  const placeholder = { title: combo.name, snapshot: { comboName: combo.name }, segments: [] };
  showResult(placeholder, { pending: true });
  let phase = `${currentChar()?.name || '角色'} 正在演《${combo.name}》`;
  let words = 0;
  const cancel = () => {
    if (!busy || busy.token !== token) return;
    ctrl.abort();
    busy = null;
    clearInterval(timer);
    updateBusyButtons();
    setStatus('已取消', { spin: false });
  };
  const tick = () => setStatus(`${phase}… ${Math.round((Date.now() - t0) / 1000)} 秒${words ? ` · ${words} 字` : ''}`, { onCancel: cancel });
  const timer = setInterval(() => { if (busy?.token === token) tick(); }, 1000);
  tick();
  let lastPaint = 0, pendingPaint = null;
  const onStream = info => {
    if (busy?.token !== token) return;
    words = info.text.replace(/\s+/g, '').length;
    const paint = () => {
      lastPaint = Date.now();
      if (info.kind === 'fill') current?.frame.fillSlots(info.fill);
      else if (info.kind === 'text' && !/<[a-zA-Z][\w-]*[\s>]/.test(info.text.replace(/<\/?[a-zA-Z][\w-]*>/g, '').slice(0, 400))) {
        current?.frame.stream(streamSegments(info.text), true);
      }
      tick();
    };
    clearTimeout(pendingPaint);
    if (Date.now() - lastPaint > 160) paint(); else pendingPaint = setTimeout(paint, 160);
  };
  try {
    const result = await generateTheater(combo, {
      extra, follow: more.follow, signal: ctrl.signal, onStream,
      onShell: shell => { if (busy?.token !== token) return; phase = '骨架已出，正在填字'; words = 0; showResult(shell, { pending: true }); tick(); },
    });
    clearTimeout(pendingPaint);
    if (!result || busy?.token !== token) return;
    state.recent.unshift(result);
    save('recent');
    const c = byId(state.combos, combo.id);
    if (c) { c.plays = (c.plays || 0) + 1; c.lastUsedAt = result.createdAt; save('combos'); }
    setSetting({ played: (Number(state.settings.played) || 0) + 1 });
    renderKicker();
    showResult(result);
    renderRecent();
    // 面板关着 / 不在舞台 / 页面在后台：用酒馆的提示提醒一下
    notifyDone(result.title, { seen: isOpen() && tab === 'stage', open: () => { open('stage'); showResult(result); } });
  } catch (e) {
    clearTimeout(pendingPaint);
    if (busy?.token !== token) return;
    if (ctrl.signal.aborted) return;
    console.error('[小剧场]', e);
    const retry = () => run(combo, extra, more);
    if (e.shellResult) {
      showResult(e.shellResult, { pending: true });
      setStatus(`第二步失败：${e.message}`, { spin: false, onRetry: retry });
    } else {
      setStatus(`没写出来：${e.message || e}`, { spin: false, onRetry: retry });
    }
  } finally {
    clearInterval(timer);
    if (busy?.token === token) { busy = null; updateBusyButtons(); }
  }
}

// ── 库 ──
const LIB_TABS = [
  { v: 'combos', l: '小剧场' }, { v: 'prompts', l: '提示词' }, { v: 'randoms', l: '随机池' }, { v: 'preambles', l: '前置' },
];
function renderLibrary() {
  const v = views.library;
  v.innerHTML = '';
  const counts = { combos: state.combos.length, prompts: state.prompts.length, randoms: state.randoms.length + state.macros.length, preambles: state.preambles.length };
  v.appendChild(seg(LIB_TABS.map(t => ({ v: t.v, l: `${t.l} ${counts[t.v]}` })), libTab, x => { libTab = x; renderLibrary(); }));
  const box = el('div');
  box.style.marginTop = '12px';
  v.appendChild(box);
  if (libTab === 'combos') libCombos(box);
  if (libTab === 'prompts') libPrompts(box);
  if (libTab === 'randoms') libRandoms(box);
  if (libTab === 'preambles') libPreambles(box);
}
function itemRow(title, desc, onClick, end) {
  const item = el('div', 'xjc-item');
  const mid = el('div', 'xjc-grow');
  mid.append(el('div', 't', title), el('div', 'd', desc));
  item.appendChild(mid);
  if (end) item.appendChild(el('div', 'end', end));
  item.onclick = onClick;
  return item;
}
function libCombos(box) {
  const row = el('div', 'xjc-row');
  row.append(btn('＋ 新建小剧场', () => editCombo(null), 'xjc-btn pri'), btn('导入', importFlow, 'xjc-btn'));
  box.appendChild(row);
  const list = el('div', 'xjc-list xjc-cards');
  list.style.marginTop = '12px';
  if (!state.combos.length) list.appendChild(el('div', 'xjc-empty', '一个小剧场 = 前置要求 + 几条提示词 + 随机规则 + 输出方式。'));
  for (const c of state.combos) {
    const n = comboPromptIds(c).length;
    const cur = c.id === state.settings.currentComboId;
    const rc = resolveCombo(c);
    list.appendChild(itemRow(`${c.name}${cur ? ' · 当前' : ''}`, `${(c.tags || []).map(t => '#' + t).join(' ')} ${n} 条提示词 · ${rc.channel === 'preset' ? '走酒馆预设' : contextLabel(rc.context)}`, () => editCombo(c), `权重 ${c.weight ?? 1} · ${c.plays || 0} 次${c.lastUsedAt ? ' · ' + fmtTime(c.lastUsedAt) : ''}`));
  }
  box.appendChild(list);
}
function allTags(list) { return [...new Set(list.flatMap(x => x.tags || []))]; }
/**
 * 分组：提示词和随机池的条目各有一个 group（像文件夹，一条只在一个组里），列表按组显示、可折叠；
 * 标签照旧用来筛选和「只抽 / 排除」。折叠状态记在 settings.groupFold
 */
const UNGROUPED = '未分组';
function groupsOf(kind) {
  const seen = [];
  for (const r of state[kind]) { const g = (r.group || '').trim(); if (g && !seen.includes(g)) seen.push(g); }
  return seen;
}
function groupInput(kind, value) {
  const i = input(value || '', '比如：塔罗、日常场景（空 = 未分组）');
  const id = `xjc-groups-${kind}`;
  let dl = document.getElementById(id);
  if (!dl) { dl = document.createElement('datalist'); dl.id = id; document.body.appendChild(dl); }
  dl.innerHTML = '';
  for (const g of groupsOf(kind)) { const o = document.createElement('option'); o.value = g; dl.appendChild(o); }
  i.setAttribute('list', id);
  return i;
}
/** 把 rows 按组画进 box；open 为 true 时（在搜索 / 筛标签）全部展开、空组不显示 */
function groupedList(box, kind, rows, buildRow, { open = false, manage = true, onChange = () => {}, headExtra = null } = {}) {
  const groups = groupsOf(kind);
  if (!groups.length) {
    const list = el('div', 'xjc-list');
    for (const r of rows) list.appendChild(buildRow(r));
    box.appendChild(list);
    return;
  }
  const fold = S().groupFold || {};
  for (const g of [...groups, UNGROUPED]) {
    const inG = rows.filter(r => ((r.group || '').trim() || UNGROUPED) === g);
    if (!inG.length && (open || g === UNGROUPED)) continue;
    const key = `${kind}:${g}`;
    const sec = el('div', 'xjc-grp');
    const hd = el('div', 'xjc-grp-hd');
    const closed = !open && !!fold[key];
    sec.classList.toggle('closed', closed);
    hd.append(el('span', 'arw', closed ? '▸' : '▾'), el('b', '', g), el('span', 'n', String(inG.length)));
    if (headExtra) { const x = headExtra(g, inG); if (x) hd.appendChild(x); }
    if (manage && g !== UNGROUPED) {
      hd.appendChild(ibtn('fa-pen', '改名', e => { e.stopPropagation(); renameGroup(kind, g, onChange); }));
      hd.appendChild(ibtn('fa-folder-minus', '解散分组', async e => {
        e.stopPropagation();
        if (!(await confirmSheet('解散分组', `「${g}」里的 ${state[kind].filter(r => r.group === g).length} 条移到「未分组」，条目本身不删。`, '解散'))) return;
        state[kind].forEach(r => { if (r.group === g) r.group = ''; });
        await save(kind);
        onChange();
      }, 'xjc-btn sm ghost'));
    }
    const list = el('div', 'xjc-list');
    list.hidden = closed;
    for (const r of inG) list.appendChild(buildRow(r));
    hd.onclick = () => {
      if (open) return;
      const now = !sec.classList.contains('closed');
      sec.classList.toggle('closed', now);
      list.hidden = now;
      hd.querySelector('.arw').textContent = now ? '▸' : '▾';
      setSetting({ groupFold: { ...(S().groupFold || {}), [key]: now } });
    };
    sec.append(hd, list);
    box.appendChild(sec);
  }
}
function renameGroup(kind, g, onChange) {
  openSheet(`分组「${g}」改名`, (body, foot, closeIt) => {
    const i = input(g, '新名字');
    body.appendChild(field('新名字', i, '和已有的分组同名就合并进去。'));
    foot.appendChild(btn('改名', async () => {
      const n = i.value.trim().slice(0, 30);
      if (!n) { toast('名字不能空'); return; }
      state[kind].forEach(r => { if (r.group === g) r.group = n; });
      const fold = { ...(S().groupFold || {}) };
      if (`${kind}:${g}` in fold) { fold[`${kind}:${n}`] = fold[`${kind}:${g}`]; delete fold[`${kind}:${g}`]; }
      await Promise.all([save(kind), setSetting({ groupFold: fold })]);
      closeIt(); onChange();
    }, 'xjc-btn pri'));
  });
}
const libQuery = { prompts: '', randoms: '' };
const libTag = { prompts: '', randoms: '' };
/** 提示词 / 随机池共用：搜索、标签筛选、按组显示 */
function libEntries(box, kind) {
  const label = kind === 'prompts' ? '提示词' : '随机条目';
  const row = el('div', 'xjc-row');
  row.append(btn(`＋ 新增${label}`, () => editText(kind, null), 'xjc-btn pri'));
  if (kind === 'prompts') row.appendChild(btn('批量导入', importFlow, 'xjc-btn'));
  // 没分过组、但有标签的：一键按第一个标签分好
  const canAuto = state[kind].some(r => !(r.group || '').trim() && (r.tags || []).length);
  if (canAuto) row.appendChild(btn('按第一个标签分组', async () => {
    const n = state[kind].filter(r => !(r.group || '').trim() && (r.tags || []).length).length;
    if (!(await confirmSheet('按标签分组', `把 ${n} 条还没分组的${label}，按各自的第一个标签放进同名分组？已经分了组的不动。`, '分组'))) return;
    state[kind].forEach(r => { if (!(r.group || '').trim() && (r.tags || []).length) r.group = r.tags[0]; });
    await save(kind);
    renderLibrary();
  }, 'xjc-btn ghost'));
  box.appendChild(row);
  if (kind === 'randoms') box.appendChild(el('p', 'xjc-hint', '生成时按小剧场里的「随机」规则从这里抽；「只抽 / 排除」看的是标签。'));
  const list = el('div');
  const paint = () => {
    list.innerHTML = '';
    const q = libQuery[kind].trim().toLowerCase();
    const rows = state[kind].filter(r => (!libTag[kind] || (r.tags || []).includes(libTag[kind])) && (!q || [r.title, r.content, r.group, ...(r.tags || [])].join(' ').toLowerCase().includes(q)));
    if (!state[kind].length) { list.appendChild(el('div', 'xjc-empty', kind === 'prompts' ? '场景、if 线、文字形式、前端形式都放这里，用分组整理，用标签筛选。' : '随机池是空的。')); return; }
    if (!rows.length) { list.appendChild(el('div', 'xjc-empty', '没有匹配的条目。')); return; }
    groupedList(list, kind, rows, r => itemRow(r.title, `${(r.tags || []).map(t => '#' + t).join(' ')} ${String(r.content || '').replace(/\s+/g, ' ').slice(0, 60)}`, () => editText(kind, r)), { open: !!(q || libTag[kind]), onChange: renderLibrary });
  };
  if (state[kind].length > 6) {
    const search = input(libQuery[kind], '搜标题 / 内容 / 分组 / 标签');
    search.type = 'search';
    search.style.marginTop = '12px';
    search.oninput = () => { libQuery[kind] = search.value; paint(); };
    box.appendChild(search);
  }
  const tags = allTags(state[kind]);
  if (tags.length) {
    const chips = el('div', 'xjc-chips');
    chips.style.marginTop = '10px';
    for (const t of ['', ...tags]) {
      const c = el('button', 'xjc-chip' + (libTag[kind] === t ? ' on' : ''), t ? '#' + t : '全部');
      c.type = 'button';
      c.onclick = () => { libTag[kind] = t; chips.querySelectorAll('.xjc-chip').forEach(x => x.classList.toggle('on', x === c)); paint(); };
      chips.appendChild(c);
    }
    box.appendChild(chips);
  }
  list.style.marginTop = '12px';
  box.appendChild(list);
  paint();
}
function libPrompts(box) { libEntries(box, 'prompts'); }
function libRandoms(box) {
  box.appendChild(el('div', 'xjc-sec', '随机池 · 生成时按规则抽'));
  libEntries(box, 'randoms');
  box.appendChild(el('div', 'xjc-sec', '随机宏 · 写在提示词里用'));
  box.appendChild(el('p', 'xjc-hint', '{{随机词:名字}} 从词表抽一个，{{随机词:名字:3}} 抽三个；{{随机数:名字}} 在范围里取整数。另有 {{random::a::b}} {{roll:1d6}} {{time}} {{date}} {{weekday}} {{篇幅}}，酒馆自己的宏也能用。'));
  const l2 = el('div', 'xjc-list');
  for (const m of state.macros) l2.appendChild(itemRow(m.name, m.kind === 'number' ? `随机数 ${m.min}～${m.max}` : `词表 ${m.values.length} 个：${m.values.slice(0, 6).join('、')}`, () => editMacro(m)));
  box.appendChild(l2);
  const r2 = el('div', 'xjc-row');
  r2.style.marginTop = '10px';
  r2.appendChild(btn('＋ 新增宏', () => editMacro(null), 'xjc-btn'));
  box.appendChild(r2);
}
function libPreambles(box) {
  const row = el('div', 'xjc-row');
  row.appendChild(btn('＋ 新增前置要求', () => editText('preambles', null), 'xjc-btn pri'));
  box.appendChild(row);
  const list = el('div', 'xjc-list');
  list.style.marginTop = '12px';
  for (const p of state.preambles) { const used = state.combos.filter(c => c.preambleId === p.id).length; list.appendChild(itemRow(p.name, p.content.replace(/\s+/g, ' ').slice(0, 70), () => editText('preambles', p), [p.id === state.settings.defaultPreambleId ? '默认' : '', used ? `${used} 个小剧场在用` : ''].filter(Boolean).join(' · '))); }
  box.appendChild(list);
  box.appendChild(el('p', 'xjc-hint', '发给模型的顺序：① 材料（角色卡、用户人设、世界书、总结、最近聊天，按小剧场的设置取）② 前置要求 ③ <Brief>（提示词、随机、输出要求）。酒馆预设里的破限、文风、正文格式条目都不会带进来；需要的话写进前置要求。'));
}

/** 内置指令：每条一个输入框，改过的标「已改」、能单独恢复默认；保存时和默认一样的就当没改 */
function editInstr() {
  openSheet('内置指令', (body, foot, closeIt) => {
    body.appendChild(el('p', 'xjc-hint', '{用户} {字数} 这类花括号是插件填的变量，改的时候留着。小剧场的提示词、前置要求在「库」里改；这里是所有小剧场共用的格式要求。'));
    const boxes = new Map();
    let group = '';
    for (const x of INSTR) {
      if (x.group !== group) { group = x.group; body.appendChild(el('div', 'xjc-sec', group)); }
      const ta = textarea(state.settings.instr?.[x.key] ?? x.text, Math.min(8, Math.max(2, Math.ceil(x.text.length / 48))));
      boxes.set(x.key, ta);
      const hints = [x.vars ? `变量：${x.vars.map(v => `{${v}}`).join(' ')}` : '', x.note || ''].filter(Boolean).join(' ');
      // 包一层 div：标题里有「恢复默认」按钮，用 <label> 的话点标题会误点到它
      const wrap = el('div');
      wrap.appendChild(ta);
      const f = field(x.label, wrap, hints);
      const lb = f.querySelector('.lb');
      const reset = btn('恢复默认', () => { ta.value = instrDefault(x.key); paint(); }, 'xjc-btn sm ghost xjc-instr-reset');
      const tag = el('span', 'xjc-temp', '已改');
      const paint = () => { const on = ta.value !== instrDefault(x.key); reset.hidden = !on; tag.hidden = !on; };
      ta.addEventListener('input', paint);
      lb?.append(' ', tag, reset);
      paint();
      body.appendChild(f);
    }
    foot.appendChild(btn('全部恢复默认', async () => {
      if (!(await confirmSheet('全部恢复默认', '所有内置指令都改回默认？', '恢复'))) return;
      for (const [k, ta] of boxes) ta.value = instrDefault(k);
      body.querySelectorAll('textarea').forEach(t => t.dispatchEvent(new Event('input')));
    }, 'xjc-btn ghost'));
    foot.appendChild(btn('保存', async () => {
      const next = {};
      for (const [k, ta] of boxes) if (ta.value.trim() && ta.value !== instrDefault(k)) next[k] = ta.value;
      await setSetting({ instr: next });
      toast('内置指令已保存');
      closeIt();
      renderSettings();
    }, 'xjc-btn pri'));
  });
}

/** 提示词 / 随机条目 / 前置要求 共用一个编辑框 */
function editText(kind, row) {
  const isPre = kind === 'preambles';
  const label = { prompts: '提示词', randoms: '随机条目', preambles: '前置要求' }[kind];
  openSheet(row ? `编辑${label}` : `新增${label}`, (body, foot, closeIt) => {
    const t = input(isPre ? row?.name : row?.title, '标题');
    body.appendChild(field('标题', t));
    let tg = null;
    if (!isPre) {
      tg = input(tagsToText(row?.tags), '空格分隔，比如：场景 日常');
      const known = allTags(state[kind]);
      body.appendChild(field('标签', tg, known.length ? `已有：${known.join(' ')}` : ''));
    }
    // 分组可放可不放；点输入框会列出已有的分组
    const grp = isPre ? null : groupInput(kind, row?.group);
    if (grp) body.appendChild(field('分组', grp, groupsOf(kind).length ? `已有：${groupsOf(kind).join('、')}` : '可以不填。填了库里就按组显示，编辑小剧场时也能整组选、从组里随机抽。'));
    const c = textarea(row?.content, isPre ? 12 : 8, isPre ? '整段 system 框架' : '可以用 {{user}} {{char}} {{篇幅}} {{随机词:世界}} 等宏');
    body.appendChild(field('内容', c));
    let def = null;
    if (isPre) { def = toggle('设为默认（AI 自选、新建小剧场用它）', row && row.id === state.settings.defaultPreambleId); body.appendChild(def); }
    // 新写的提示词可以顺手建成一个小剧场；不建也行，舞台上「换一个 → 直接用提示词」就能用
    let asCombo = null;
    if (!row && kind === 'prompts') { asCombo = toggle('同时建成一个小剧场（只含这一条，其他跟随全局）', false); body.appendChild(asCombo); }
    if (row) {
      foot.appendChild(ibtn('fa-trash-can', '删除', async () => {
        if (isPre && state.preambles.length <= 1) { toast('至少留一条前置要求'); return; }
        const used = kind !== 'randoms' ? state.combos.filter(x => (isPre ? x.preambleId === row.id : usesPrompt(x, row.id))).map(x => x.name) : [];
        const warn = isPre ? `「${used.join('、')}」在用它，删了之后它们改用第一条前置。确定删除？` : `「${used.join('、')}」在用它，删了这些小剧场里就少了这一条。确定删除？`;
        if (!(await confirmSheet('删除', used.length ? warn : '确定删除？', '删除', true))) return;
        await remove(kind, row.id);
        if (used.length) {
          const fb = state.preambles[0]?.id || '';
          for (const x of state.combos) {
            if (isPre && x.preambleId === row.id) x.preambleId = fb;
            if (!isPre) for (const pt of x.parts || []) pt.items = pt.items.filter(it => it !== `p:${row.id}`);
          }
          if (isPre && state.settings.defaultPreambleId === row.id) setSetting({ defaultPreambleId: fb });
          save('combos');
        }
        closeIt(); renderLibrary();
      }, 'xjc-btn danger'));
    }
    foot.appendChild(btn('保存', () => {
      const title = t.value.trim();
      if (!title) { toast('标题不能空'); return; }
      const data = isPre ? { id: row?.id || uid('pre'), name: title, content: c.value } : { id: row?.id || uid(kind.slice(0, 3)), title, tags: textToTags(tg.value), group: grp.value.trim().slice(0, 30), content: c.value };
      const saved = upsert(kind, data);
      if (isPre && def.input.checked) setSetting({ defaultPreambleId: saved.id });
      if (asCombo?.input.checked) combosFromPrompts([saved], { output: { mode: 'mixed' } }).then(() => toast('也建成了一个小剧场'));
      closeIt(); renderLibrary();
    }, 'xjc-btn pri'));
  });
}

function editMacro(row) {
  openSheet(row ? '编辑宏' : '新增宏', (body, foot, closeIt) => {
    const name = input(row?.name, '比如：世界');
    body.appendChild(field('名字', name, '在提示词里写 {{随机词:名字}} 或 {{随机数:名字}}'));
    let kind = row?.kind || 'words';
    const wordsBox = el('div'), numBox = el('div');
    const values = textarea((row?.values || []).join('\n'), 8, '一行一个');
    wordsBox.appendChild(field('词表', values));
    const lo = input(row?.min ?? 1, '', 'number'), hi = input(row?.max ?? 10, '', 'number');
    const g = el('div', 'xjc-grid2');
    g.append(field('最小', lo), field('最大', hi));
    numBox.appendChild(g);
    const sync = () => { wordsBox.hidden = kind !== 'words'; numBox.hidden = kind !== 'number'; };
    body.appendChild(field('类型', seg([{ v: 'words', l: '随机词' }, { v: 'number', l: '随机数' }], kind, v => { kind = v; sync(); })));
    body.append(wordsBox, numBox);
    sync();
    if (row) foot.appendChild(ibtn('fa-trash-can', '删除', () => { remove('macros', row.id); closeIt(); renderLibrary(); }, 'xjc-btn danger'));
    foot.appendChild(btn('保存', () => {
      const n = name.value.trim().replace(/[:：{}]/g, '');
      if (!n) { toast('名字不能空'); return; }
      upsert('macros', { id: row?.id || uid('m'), name: n, kind, values: values.value.split('\n').map(s => s.trim()).filter(Boolean), min: Number(lo.value) || 0, max: Number(hi.value) || 0 });
      closeIt(); renderLibrary();
    }, 'xjc-btn pri'));
  });
}

function newCombo() {
  const s = state.settings;
  return {
    id: '', name: '', tags: [], preambleId: s.defaultPreambleId || state.preambles[0]?.id || '', parts: [],
    random: { count: 0, include: [], exclude: [] },
    // 新建的小剧场全部「跟随全局」，想单独改再在编辑里选
    output: { mode: 'text', wrapTag: '', length: 'default', customChars: 900, style: '', staged: null },
    context: null, who: '', whoText: '', api: '', weight: 1, channel: '', writeBack: null,
  };
}

function editCombo(row, draft = null) {
  const d = clone(row || draft || newCombo());
  d.output = { ...newCombo().output, ...d.output };
  d.random = { ...newCombo().random, ...d.random };
  // 自定上下文时的起点：已有自定值就用它，否则从当前全局值开始改
  const ctxDraft = { ...globalContext(), ...(d.context || {}) };
  const follow = now => `跟随全局（${now}）`;
  openSheet(row ? `编辑「${row.name}」` : '新建小剧场', (body, foot, closeIt) => {
    const name = input(d.name, '比如：深夜便利店偶遇');
    body.appendChild(field('名字', name));
    const tg = input(tagsToText(d.tags), '空格分隔');
    body.appendChild(field('标签', tg));

    body.appendChild(el('div', 'xjc-sec', '提示词'));
    const pre = select(state.preambles.map(p => ({ v: p.id, l: p.name })), d.preambleId);
    body.appendChild(field('前置要求', pre));
    body.appendChild(el('p', 'xjc-hint', '提示词按段排，各段按顺序合成同一篇的要求。每段可以全部用，也可以从里面随机抽几条。比如「主题」段放塔罗的 HTML（全部用），「牌阵」段放几种牌阵（随机抽 1 条）。'));
    d.parts = (d.parts && d.parts.length ? d.parts : [newPart()]).map(pt => ({ ...pt, items: [...(pt.items || [])] }));
    const partsBox = el('div', 'xjc-parts');
    const drawParts = () => {
      partsBox.innerHTML = '';
      d.parts.forEach((pt, i) => {
        pt.items = pt.items.filter(itemAlive);
        const card = el('div', 'xjc-part');
        const hd = el('div', 'xjc-part-hd');
        const nm = input(pt.name || '', d.parts.length > 1 ? `第 ${i + 1} 段的名字（可不填，比如 主题 / 牌阵）` : '这一段的名字（可不填）');
        nm.oninput = () => { pt.name = nm.value.trim().slice(0, 30); };
        hd.appendChild(nm);
        const mvPart = k => { const j = i + k; if (j < 0 || j >= d.parts.length) return; [d.parts[i], d.parts[j]] = [d.parts[j], d.parts[i]]; drawParts(); };
        if (d.parts.length > 1) hd.append(ibtn('fa-arrow-up', '这一段上移', () => mvPart(-1)), ibtn('fa-arrow-down', '这一段下移', () => mvPart(1)), ibtn('fa-trash-can', '删掉这一段', () => { d.parts.splice(i, 1); drawParts(); }));
        card.appendChild(hd);
        const list = el('div', 'xjc-ordered');
        if (!pt.items.length) list.appendChild(el('div', 'xjc-hint', '这一段还是空的。'));
        pt.items.forEach((it, j) => {
          const item = el('div', 'xjc-item');
          const mid = el('div', 'xjc-grow');
          const p = it.startsWith('p:') ? byId(state.prompts, it.slice(2)) : null;
          mid.append(el('div', 't', itemLabel(it)), el('div', 'd', p ? (p.tags || []).map(t => '#' + t).join(' ') : '以后放进这个组的也算在内'));
          item.appendChild(mid);
          const mv = k => { const q = j + k; if (q < 0 || q >= pt.items.length) return; [pt.items[j], pt.items[q]] = [pt.items[q], pt.items[j]]; drawParts(); };
          item.append(ibtn('fa-arrow-up', '上移', () => mv(-1)), ibtn('fa-arrow-down', '下移', () => mv(1)), ibtn('fa-xmark', '移出这一段', () => { pt.items.splice(j, 1); drawParts(); }));
          list.appendChild(item);
        });
        card.appendChild(list);
        const ops = el('div', 'xjc-row');
        ops.append(
          btn('＋ 选提示词', () => pickPrompts(pt.items.filter(x => x.startsWith('p:')).map(x => x.slice(2)), ids => {
            const keep = pt.items.filter(x => x.startsWith('g:') || ids.includes(x.slice(2)));
            pt.items = [...keep, ...ids.filter(id => !pt.items.includes(`p:${id}`)).map(id => `p:${id}`)];
            drawParts();
          }), 'xjc-btn sm'),
          btn('＋ 整个分组', () => pickGroups(pt.items.filter(x => x.startsWith('g:')).map(x => x.slice(2)), gs => {
            pt.items = [...pt.items.filter(x => x.startsWith('p:') || gs.includes(x.slice(2))), ...gs.filter(g => !pt.items.includes(`g:${g}`)).map(g => `g:${g}`)];
            drawParts();
          }), 'xjc-btn sm ghost'),
        );
        card.appendChild(ops);
        // 用法：这一段不止一条时才有得选
        const pool = partPool(pt).length;
        if (pool > 1) {
          const n = select(Array.from({ length: Math.min(pool - 1, 20) }, (_, k) => ({ v: String(k + 1), l: `随机抽 ${k + 1} 条` })), String(Math.min(pt.pick || 1, pool - 1)));
          n.onchange = () => { pt.pick = Number(n.value) || 1; };
          n.hidden = !pt.pick || pt.pick >= pool;
          const how = seg([{ v: 'all', l: `全部用（${pool} 条）` }, { v: 'pick', l: '从里面随机' }], n.hidden ? 'all' : 'pick', v => { pt.pick = v === 'pick' ? Number(n.value) || 1 : 0; n.hidden = v !== 'pick'; });
          const row = el('div', 'xjc-row');
          row.append(how, n);
          card.appendChild(field('这一段', row, '随机的段每次生成从里面抽；舞台上也能「这次抽」指定用哪几条。'));
        } else pt.pick = 0;
        partsBox.appendChild(card);
      });
      partsBox.appendChild(btn('＋ 加一段', () => { d.parts.push(newPart()); drawParts(); }, 'xjc-btn sm'));
    };
    drawParts();
    body.appendChild(partsBox);

    body.appendChild(el('div', 'xjc-sec', '随机附加'));
    const rc = select([0, 1, 2, 3, 4, 5].map(n => ({ v: String(n), l: n ? `抽 ${n} 条` : '不抽' })), String(d.random.count || 0));
    // 随机池自己的分组
    d.random.groups = (d.random.groups || []).filter(g => g.startsWith('randoms/'));
    const groupChoices = groupsOf('randoms').map(g => ({ v: `randoms/${g}`, l: g }));
    const groupBox = el('div', 'xjc-chips');
    for (const o of groupChoices) {
      const c = el('button', 'xjc-chip' + (d.random.groups.includes(o.v) ? ' on' : ''), o.l);
      c.type = 'button';
      c.onclick = () => { const i = d.random.groups.indexOf(o.v); if (i >= 0) d.random.groups.splice(i, 1); else d.random.groups.push(o.v); c.classList.toggle('on', i < 0); };
      groupBox.appendChild(c);
    }
    const groupF = field('从分组抽', groupBox, '都不选 = 从整个随机池抽');
    if (!groupChoices.length) groupF.dataset.none = '1';
    const rtags = allTags(state.randoms);
    const tagPick = key => {
      const box = el('div', 'xjc-chips');
      if (!rtags.length) box.appendChild(el('span', 'xjc-hint', '随机池还没有标签'));
      for (const t of rtags) {
        const c = el('button', 'xjc-chip' + ((d.random[key] || []).includes(t) ? ' on' : ''), '#' + t);
        c.type = 'button';
        c.onclick = () => { const set = new Set(d.random[key] || []); set.has(t) ? set.delete(t) : set.add(t); d.random[key] = [...set]; c.classList.toggle('on', set.has(t)); };
        box.appendChild(c);
      }
      return box;
    };
    const incF = field('只抽', tagPick('include'), '点选标签；都不选 = 不限标签');
    const excF = field('排除', tagPick('exclude'), '带这些标签的不抽');
    const syncRandom = () => { incF.hidden = excF.hidden = rc.value === '0'; groupF.hidden = rc.value === '0' || !!groupF.dataset.none; };
    rc.addEventListener('change', syncRandom);
    body.append(field('从随机池抽', rc, `随机池（${state.randoms.length} 条）里的小料，附加在提示词后面，比如天气、小意外。`), groupF, incF, excF);
    syncRandom();

    body.appendChild(el('div', 'xjc-sec', '输出'));
    const stagedV = typeof d.output.staged === 'boolean' ? (d.output.staged ? 'on' : 'off') : '';
    const stagedT = field('分两步出', seg([{ v: '', l: follow(globalStaged() ? '分两步' : '一次出') }, { v: 'on', l: '分两步' }, { v: 'off', l: '一次出' }], stagedV, v => { d.output.staged = v === '' ? null : v === 'on'; }), '先出页面骨架立刻显示，再按占位填字，适合大页面。');
    let syncHtml = () => {};
    body.appendChild(field('形式', seg([{ v: 'text', l: '纯文字' }, { v: 'html', l: 'HTML' }, { v: 'mixed', l: '混排' }], d.output.mode, v => { d.output.mode = v; syncHtml(); })));
    body.appendChild(stagedT);
    const lenSel = select(['default', 'short', 'medium', 'long', 'custom'].map(k => ({ v: k, l: k === 'default' ? `跟随全局（${state.settings.lengthLimit ? LENGTH_LABEL[state.settings.defaultLength || 'medium'] : '不限'}）` : `${LENGTH_LABEL[k]}${k === 'custom' ? '' : ` · 约 ${{ short: 400, medium: 900, long: 1800 }[k]} 字`}` })), d.output.length);
    const customChars = input(d.output.customChars, '字数', 'number');
    const customF = field('自定字数', customChars);
    const syncLen = () => { customF.hidden = lenSel.value !== 'custom'; };
    lenSel.onchange = syncLen;
    const g = el('div', 'xjc-grid2');
    g.append(field('篇幅', lenSel), customF);
    body.appendChild(g);
    syncLen();
    const styleSel = select([{ v: '', l: `跟随全局（${STYLE_LABEL[globalStyle()]}）` }, ...Object.entries(STYLE_LABEL).map(([v, l]) => ({ v, l }))], d.output.style || '');
    const styleF = field('HTML 风格', styleSel);
    const wrap = input(d.output.wrapTag, '比如 theater（空 = 不包）');
    const g2 = el('div', 'xjc-grid2');
    g2.append(styleF, field('标签包裹', wrap));
    body.appendChild(g2);
    // 纯文字用不到 HTML 风格；分两步只对 HTML
    syncHtml = () => { stagedT.hidden = d.output.mode !== 'html'; styleF.hidden = d.output.mode === 'text'; };
    syncHtml();

    body.appendChild(el('div', 'xjc-sec', '上下文'));
    const ctxBox = el('div');
    // 出口不是「跟随酒馆当前 API」时走不了酒馆预设，通道收起来、说明原因
    let exitIsSt = () => true;
    const channelNote = el('p', 'xjc-hint', '出口不是「跟随酒馆当前 API」，只能插件自己拼，通道不用选。');
    const syncChannel = () => {
      const st = exitIsSt();
      channelF.hidden = !st; channelNote.hidden = st;
      ctxBox.hidden = st && (d.channel || globalChannel()) === 'preset';
    };
    const channelF = field('通道', seg([{ v: '', l: follow(CHANNEL_LABEL[globalChannel()]) }, { v: 'own', l: '插件自己拼' }, { v: 'preset', l: '走酒馆预设' }], d.channel || '', v => { d.channel = v; syncChannel(); }),
      '自己拼：只带下面的材料，不带酒馆预设里的破限/文风。走酒馆预设：用酒馆的完整生成流程（预设、角色卡、世界书、聊天记录都由酒馆拼），聊天补全也能边写边显示；在更早的楼层下出时会自动改用自己拼（酒馆预设没法截掉之后的聊天）。');
    body.append(channelF, channelNote, ctxBox);
    // 材料：默认跟随全局，选「自定」才展开具体选项
    const custom = el('div');
    const gctx = globalContext();
    const gText = `${gctx.chat === 'recent' ? `最近 ${gctx.rounds} 轮` : '不带聊天'}${gctx.worldInfo ? ' · 世界书' : ''}${gctx.summary ? ' · 总结' : ''}`;
    const followHint = el('p', 'xjc-hint', `全局现在是：${gText}。在「设置 → 生成」里改，所有跟随全局的小剧场一起变。`);
    ctxBox.appendChild(field('材料', seg([{ v: 'global', l: '跟随全局' }, { v: 'custom', l: '自定' }], d.context ? 'custom' : 'global', v => { d.context = v === 'custom' ? ctxDraft : null; custom.hidden = v !== 'custom'; followHint.hidden = v === 'custom'; })));
    ctxBox.append(followHint, custom);
    custom.hidden = !d.context;
    followHint.hidden = !!d.context;
    const rounds = input(ctxDraft.rounds, '', 'number');
    const roundsF = field('带几轮', rounds, '一轮 = 你一句 + TA 一句');
    custom.appendChild(field('聊天记录', seg([{ v: 'recent', l: '最近 N 轮' }, { v: 'none', l: '不带' }], ctxDraft.chat, v => { ctxDraft.chat = v; roundsF.hidden = v !== 'recent'; })));
    custom.appendChild(roundsF);
    roundsF.hidden = ctxDraft.chat !== 'recent';
    const wi = toggle('带世界书（和酒馆一样按聊天内容激活）', ctxDraft.worldInfo);
    const sm = toggle('带剧情总结（酒馆「总结」扩展的内容）', ctxDraft.summary);
    custom.append(wi, sm);
    syncChannel();
    const wbV = typeof d.writeBack === 'boolean' ? (d.writeBack ? 'on' : 'off') : '';
    if (S().writeBackFeature) body.appendChild(field('写回记忆', seg([{ v: '', l: follow(globalWriteBack() ? '写回' : '不写') }, { v: 'on', l: '写回' }, { v: 'off', l: '不写' }], wbV, v => { d.writeBack = v === '' ? null : v === 'on'; }), '生成后把梗概写成一条世界书条目，放进这个聊天绑定的世界书。'));
    const whoText = input(d.whoText, '比如：TA 的新同事');
    const whoF = field('自定身份', whoText);
    body.appendChild(field('我在戏里是谁', seg([{ v: '', l: follow(WHO_LABEL[globalWho()]) }, { v: 'persona', l: '我的人设' }, { v: 'custom', l: '自定身份' }, { v: 'none', l: '旁观' }], d.who || '', v => { d.who = v; whoF.hidden = (v || globalWho()) !== 'custom'; })));
    body.appendChild(whoF);
    whoF.hidden = (d.who || globalWho()) !== 'custom';

    body.appendChild(el('div', 'xjc-sec', '其他'));
    const api = select([{ v: '', l: `跟随全局（${targetLabel(state.settings.api)}）` }, ...apiTargets()], d.api || '');
    exitIsSt = () => resolveTarget(api.value) === 'st';
    api.addEventListener('change', syncChannel);
    syncChannel();
    const weight = input(d.weight ?? 1, '', 'number');
    const g3 = el('div', 'xjc-grid2');
    g3.append(field('出口', api), field('随机权重', weight, '「随机」按权重抽，0 = 不参与'));
    body.appendChild(g3);

    const collect = () => ({
      ...d, id: d.id || uid('c'), name: name.value.trim() || '未命名小剧场', tags: textToTags(tg.value), preambleId: pre.value,
      parts: d.parts.filter(pt => pt.items.length).map(pt => ({ id: pt.id || newPart().id, name: pt.name || '', items: [...pt.items], pick: Number(pt.pick) || 0 })),
      random: { count: Number(rc.value) || 0, include: [...(d.random.include || [])], exclude: [...(d.random.exclude || [])], groups: [...(d.random.groups || [])] },
      output: { ...d.output, length: lenSel.value, customChars: Math.max(50, Number(customChars.value) || 900), style: styleSel.value, wrapTag: wrap.value.trim().replace(/[^\w-]/g, '') },
      context: d.context ? { ...ctxDraft, rounds: Math.max(1, Math.min(100, Number(rounds.value) || 12)), worldInfo: wi.input.checked, summary: sm.input.checked } : null,
      whoText: whoText.value.trim(), api: api.value, weight: Math.max(0, Number(weight.value) || 0),
      channel: d.channel || '', writeBack: d.writeBack ?? null,
    });
    if (row) {
      foot.appendChild(ibtn('fa-trash-can', '删除', async () => {
        if (!(await confirmSheet('删除小剧场', `删除「${row.name}」？收藏里按它生成的作品不受影响。`, '删除', true))) return;
        remove('combos', row.id);
        closeIt(); renderLibrary(); renderPick();
      }, 'xjc-btn danger'));
      foot.appendChild(ibtn('fa-file-export', '导出', () => saveFile(JSON.stringify(exportCombo(collect()), null, 2), `小剧场-${row.name}.json`), 'xjc-btn ghost'));
      foot.appendChild(ibtn('fa-clone', '复制一份', () => { const c = collect(); upsert('combos', { ...c, id: uid('c'), name: c.name + ' 副本', plays: 0, lastUsedAt: '' }); closeIt(); renderLibrary(); }, 'xjc-btn ghost'));
    }
    foot.appendChild(btn('保存并试生成', () => {
      const c = collect();
      upsert('combos', c);
      setSetting({ currentComboId: c.id });
      closeIt();
      switchTab('stage');
      run(byId(state.combos, c.id) || c);
    }, 'xjc-btn'));
    foot.appendChild(btn('保存', () => {
      const c = collect();
      upsert('combos', c);
      if (!row) setSetting({ currentComboId: c.id });
      closeIt();
      if (tab === 'library') renderLibrary();
      renderPick();
    }, 'xjc-btn pri'));
  });
}

/** 选整个分组放进一段：以后放进这个组的提示词也算在内 */
function pickGroups(selected, done) {
  const gs = groupsOf('prompts');
  if (!gs.length) { toast('提示词库里还没有分组，先在「库 → 提示词」里给提示词填上分组'); return; }
  const chosen = new Set(selected);
  openSheet('用整个分组', (body, foot, closeIt) => {
    body.appendChild(el('p', 'xjc-hint', '整组放进这一段，以后往这个组里加的提示词也会算进来。想挑其中几条，用「＋ 选提示词」。'));
    const list = el('div', 'xjc-list');
    const draw = () => {
      list.innerHTML = '';
      for (const g of gs) {
        const ps = state.prompts.filter(p => p.group === g);
        const it = itemRow(g, `${ps.length} 条 · ${ps.map(p => p.title).join('、').slice(0, 60)}`, () => { if (chosen.has(g)) chosen.delete(g); else chosen.add(g); draw(); }, chosen.has(g) ? '已选' : '');
        if (chosen.has(g)) it.classList.add('on');
        list.appendChild(it);
      }
    };
    draw();
    body.appendChild(list);
    foot.appendChild(btn('确定', () => { done(gs.filter(g => chosen.has(g))); closeIt(); }, 'xjc-btn pri'));
  });
}

function pickPrompts(selected, done) {
  const chosen = new Set(selected);
  openSheet('选提示词', (body, foot, closeIt) => {
    let filter = '', q = '';
    const search = input('', '搜标题 / 内容');
    search.oninput = () => { q = search.value.trim().toLowerCase(); draw(); };
    body.appendChild(search);
    const chips = el('div', 'xjc-chips');
    chips.style.margin = '10px 0';
    const list = el('div');
    const draw = () => {
      chips.innerHTML = '';
      for (const t of ['', ...allTags(state.prompts)]) {
        const c = el('button', 'xjc-chip' + (filter === t ? ' on' : ''), t || '全部');
        c.type = 'button';
        c.onclick = () => { filter = t; draw(); };
        chips.appendChild(c);
      }
      list.innerHTML = '';
      const shown = state.prompts.filter(x => (!filter || (x.tags || []).includes(filter)) && (!q || (x.title + x.content + (x.group || '')).toLowerCase().includes(q)));
      if (!shown.length) list.appendChild(el('div', 'xjc-empty', '没有匹配的提示词'));
      const boxes = new Map();
      const rowOf = p => {
        const row = el('label', 'xjc-check');
        const cb = el('input');
        cb.type = 'checkbox';
        cb.checked = chosen.has(p.id);
        cb.onchange = () => (cb.checked ? chosen.add(p.id) : chosen.delete(p.id));
        boxes.set(p.id, cb);
        const mid = el('div', 'xjc-grow');
        mid.append(el('div', '', `${p.title} ${(p.tags || []).map(t => '#' + t).join(' ')}`), el('div', 'd', p.content));
        row.append(cb, mid);
        return row;
      };
      // 每组一个「整组加入」：组里都勾上了就变成「整组去掉」
      const whole = (g, inG) => {
        const b = btn('', e => {
          e.stopPropagation();
          const all = inG.every(p => chosen.has(p.id));
          for (const p of inG) { if (all) chosen.delete(p.id); else chosen.add(p.id); const cb = boxes.get(p.id); if (cb) cb.checked = !all; }
          paintWhole();
        }, 'xjc-btn sm');
        const paintWhole = () => { b.textContent = inG.every(p => chosen.has(p.id)) ? '整组去掉' : '整组加入'; };
        paintWhole();
        list.addEventListener('change', paintWhole);
        return b;
      };
      if (shown.length) groupedList(list, 'prompts', shown, rowOf, { open: !!(q || filter), manage: false, headExtra: whole });
    };
    draw();
    body.append(chips, list);
    foot.appendChild(btn('确定', () => {
      const keep = selected.filter(id => chosen.has(id));
      const added = state.prompts.map(p => p.id).filter(id => chosen.has(id) && !keep.includes(id));
      done([...keep, ...added]);
      closeIt();
    }, 'xjc-btn pri'));
  });
}

// ── 导入 ──
function importFlow() {
  openSheet('导入', (body, foot, closeIt) => {
    body.appendChild(el('p', 'xjc-hint', '① 粘贴文本：每条用一行「## 标题 #标签 #标签」开头，下面是内容，可以一次贴很多条。② 选文件：本插件导出的、Float 小剧场 APP 导出的直接进库；暗柜「夜间档案」每份变成两条提示词 + 一个小剧场；其它 JSON（酒馆预设、世界书、角色卡、别人的生成器）会把里面像提示词的段落列出来让你挑。'));
    const ta = textarea('', 8, '## 雨夜便利店 #场景 #日常\n写{{char}}在深夜便利店……\n\n## 弹幕流 #形式 #前端\n输出一段带弹幕滚动的 HTML……');
    body.appendChild(ta);
    let kind = 'prompts';
    const asCombo = toggle('每条同时建成一个小剧场（直接能在舞台上选）', false);
    body.appendChild(field('文本导成', seg([{ v: 'prompts', l: '提示词' }, { v: 'preambles', l: '前置要求' }, { v: 'randoms', l: '随机条目' }], kind, v => { kind = v; asCombo.hidden = v !== 'prompts'; impGroupF.hidden = v === 'preambles'; })));
    body.appendChild(asCombo);
    const impGroup = input('', '可以不填');
    const impGroupF = field('放进分组', impGroup);
    body.appendChild(impGroupF);
    const importRows = async rows => {
      const made = await addRows(kind, rows, kind === 'preambles' ? {} : { group: impGroup.value });
      let msg = `导入 ${rows.length} 条${{ prompts: '提示词', preambles: '前置要求', randoms: '随机条目' }[kind]}`;
      if (kind === 'prompts' && asCombo.input.checked) { await combosFromPrompts(made); msg += `，建了 ${made.length} 个小剧场`; }
      closeIt(); refresh(); toast(msg, 'success');
    };
    foot.appendChild(btn('选文件', async () => {
      try {
        const f = await pickFile();
        if (!f) return;
        let data;
        try { data = JSON.parse(f.text); }
        catch {
          const rows = parseTextBlocks(f.text);
          if (!rows.length) throw new Error('文件既不是 JSON，也没有「## 标题」格式的内容。');
          await importRows(rows);
          return;
        }
        const got = classifyJson(data);
        if (got.bundle) { const n = await importBundle(got.bundle); closeIt(); refresh(); toast(`导入 ${n} 条`, 'success'); return; }
        if (got.dark) { const n = await importDarkArchives(got.dark); closeIt(); refresh(); toast(`导入 ${n} 份暗柜档案，各建了一个小剧场`, 'success'); return; }
        if (got.rows) { await importRows(got.rows); return; }
        closeIt();
        pickLoose(got.loose);
      } catch (e) { fail(e); }
    }, 'xjc-btn'));
    foot.appendChild(btn('导入文本', async () => {
      const rows = parseTextBlocks(ta.value);
      if (!rows.length) { toast('没解析到内容，检查「## 标题」格式'); return; }
      await importRows(rows);
    }, 'xjc-btn pri'));
  });
}
function pickLoose(found) {
  openSheet(`挑要导入的段落（${found.length}）`, (body, foot, closeIt) => {
    const picked = new Set();
    let kind = 'prompts', q = '';
    body.appendChild(el('p', 'xjc-hint', `没认出这个格式，把里面像提示词的 ${found.length} 段列出来了。勾上要的；点正文能展开看全文。`));
    const tagIn = input('', '空格分隔，可空');
    const tagF = field('统一加标签', tagIn);
    const jGroup = input('', '可以不填');
    const jGroupF = field('放进分组', jGroup);
    body.appendChild(field('导成', seg([{ v: 'prompts', l: '提示词' }, { v: 'preambles', l: '前置要求' }, { v: 'randoms', l: '随机条目' }], kind, v => { kind = v; tagF.hidden = jGroupF.hidden = v === 'preambles'; })));
    body.append(tagF, jGroupF);
    if (found.length > 8) {
      const search = input('', '搜名字 / 内容');
      search.oninput = () => { q = search.value.trim().toLowerCase(); draw(); };
      body.appendChild(search);
    }
    const list = el('div');
    body.appendChild(list);
    const okBtn = btn('导入', async () => {
      if (!picked.size) { toast('先勾几条'); return; }
      const tags = kind === 'preambles' ? [] : textToTags(tagIn.value);
      await addRows(kind, found.filter((f, i) => picked.has(i)).map(f => ({ title: f.name, content: f.content, tags: [...tags] })), kind === 'preambles' ? {} : { group: jGroup.value });
      closeIt(); renderLibrary(); toast(`导入 ${picked.size} 条`, 'success');
    }, 'xjc-btn pri');
    const paintOk = () => { okBtn.textContent = picked.size ? `导入 ${picked.size} 条` : '导入'; okBtn.disabled = !picked.size; };
    const visible = () => [...found.entries()].filter(([, f]) => !q || (f.name + f.content).toLowerCase().includes(q));
    const draw = () => {
      list.innerHTML = '';
      const shown = visible();
      if (!shown.length) list.appendChild(el('div', 'xjc-empty', '没有匹配的段落'));
      for (const [i, f] of shown) {
        const row = el('label', 'xjc-check');
        const cb = el('input');
        cb.type = 'checkbox';
        cb.checked = picked.has(i);
        cb.onchange = () => { cb.checked ? picked.add(i) : picked.delete(i); paintOk(); };
        const mid = el('div', 'xjc-grow');
        const ex = el('div', 'd', f.content);
        ex.onclick = e => { e.preventDefault(); ex.classList.toggle('full'); };
        mid.append(el('div', '', f.name), ex);
        if (f.path) mid.appendChild(el('div', 'xjc-path', f.path));
        row.append(cb, mid);
        list.appendChild(row);
      }
      paintOk();
    };
    draw();
    foot.appendChild(btn('全选 / 全不选', () => {
      const shown = visible().map(([i]) => i);
      const every = shown.every(i => picked.has(i));
      shown.forEach(i => (every ? picked.delete(i) : picked.add(i)));
      draw();
    }, 'xjc-btn ghost'));
    foot.appendChild(okBtn);
  });
}

// ── 收藏 ──
function renderFav() {
  const v = views.fav;
  v.innerHTML = '';
  const theaters = chatTheaters();
  // 楼层功能关着、这个聊天里也没挂过，就不显示「本聊天」
  const showChat = state.settings.tail.enabled || theaters.length > 0;
  if (!showChat) favTab = 'fav';
  if (showChat) v.appendChild(seg([{ v: 'fav', l: `收藏 ${state.favorites.length}` }, { v: 'chat', l: `本聊天 ${theaters.length}` }], favTab, x => { favTab = x; renderFav(); }));
  const box = el('div');
  box.style.marginTop = '12px';
  v.appendChild(box);
  if (favTab === 'chat') {
    if (!theaters.length) { box.appendChild(el('div', 'xjc-empty', '这个聊天里还没有挂在消息下面的小剧场。\n消息的「…」菜单里点面具图标，或者在设置里打开「AI 回复后自动出」。')); return; }
    const list = el('div', 'xjc-list');
    for (const { mesId, theater } of theaters) {
      list.appendChild(resultItem(theater, () => openViewer(theater, {
        actions: [
          { label: isFavorite(theater) ? '♥' : '♡', title: '收藏', run: (r, b) => { b.textContent = toggleFavorite(r) ? '♥' : '♡'; return true; } },
        ],
      }), `#${mesId}`));
    }
    box.appendChild(list);
    return;
  }
  if (!state.favorites.length) { box.appendChild(el('div', 'xjc-empty', '还没有收藏。roll 到喜欢的点「♡ 收藏」。')); return; }
  const html = state.favorites.filter(r => kindOf(r) !== 'text').length;
  const chips = el('div', 'xjc-chips');
  for (const o of [{ v: 'all', l: `全部 ${state.favorites.length}` }, { v: 'text', l: `文字型 ${state.favorites.length - html}` }, { v: 'html', l: `前端型 ${html}` }]) {
    const c = el('button', 'xjc-chip' + (favFilter === o.v ? ' on' : ''), o.l);
    c.type = 'button';
    c.onclick = () => { favFilter = o.v; renderFav(); };
    chips.appendChild(c);
  }
  box.appendChild(chips);
  const mine = state.favorites.filter(ofCurrentChar);
  const scope = scopeChips(state.favorites.length, mine.length, favScope, v => { favScope = v; renderFav(); });
  if (scope.children.length) { scope.style.marginTop = '8px'; box.appendChild(scope); }
  const byScope = favScope === 'all' || !scope.children.length ? state.favorites : mine;
  // 收藏多了能搜：标题、小剧场名、角色名、提示词名
  if (state.favorites.length > 6) {
    const q = input(favQuery, '搜标题 / 小剧场 / 角色 / 提示词');
    q.type = 'search';
    q.style.marginTop = '10px';
    q.oninput = () => { favQuery = q.value; paint(); };
    box.appendChild(q);
  }
  const list = el('div', 'xjc-list');
  list.style.marginTop = '12px';
  box.appendChild(list);
  const paint = () => {
  list.innerHTML = '';
  const k = favQuery.trim().toLowerCase();
  const shown = [...byScope].reverse()
    .filter(r => favFilter === 'all' || (favFilter === 'html' ? kindOf(r) !== 'text' : kindOf(r) === 'text'))
    .filter(r => !k || [r.title, r.snapshot?.comboName, r.characterName, ...(r.snapshot?.prompts || [])].filter(Boolean).join(' ').toLowerCase().includes(k));
  if (!shown.length) list.appendChild(el('div', 'xjc-empty', k ? '没有搜到。' : '这一类还没有收藏。'));
  for (const f of shown) {
    list.appendChild(resultItem(f, () => openViewer(f, {
      actions: [
        { label: '按这套再来', run: r => { again(r); return false; } },
        { label: '放到舞台', run: r => { open('stage'); showResult(r); return false; } },
        { label: '复制', run: async r => { toast((await copyText(`${r.title}\n\n${resultPlainText(r)}`)) ? '已复制' : '复制失败'); return true; } },
        { label: '取消收藏', run: r => { toggleFavorite(r); renderFav(); return false; } },
      ],
      onAction: text => continueFrom(f, text),
    })));
  }
  };
  paint();
}

// ── 设置 ──
const SET_TABS = [{ v: 'gen', l: '生成' }, { v: 'api', l: 'API' }, { v: 'chat', l: '聊天内' }, { v: 'look', l: '外观' }, { v: 'data', l: '数据' }];
/** 条目插在哪（和酒馆世界书里的「位置」一样） */
const WI_POS = ['角色定义前', '角色定义后', '作者注释前', '作者注释后', '@深度', '示例消息前', '示例消息后', '出口'];
const wiPos = e => (Number(e.position) === 4 ? `@深度 ${e.depth ?? 4}` : WI_POS[Number(e.position) || 0] || '');

/** 世界书来源：同步酒馆，或者自己选（默认勾上酒馆开着的和角色卡等绑定的，在这上面增减） */
function wiSourceBox() {
  const w = el('div');
  const pickBox = el('div');
  const listBox = el('div', 'xjc-wi-list');
  const fill = async () => {
    const [names, def] = await Promise.all([worldNames(), tavernWorlds()]);
    const add = new Set(S().wiAdd || []), rm = new Set(S().wiRemove || []);
    listBox.innerHTML = '';
    const all = [...new Set([...def.keys(), ...names, ...add])];
    if (!all.length) listBox.appendChild(el('div', 'xjc-empty', '酒馆里还没有世界书'));
    for (const n of all) {
      const row = el('label', 'xjc-check');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = (def.has(n) || add.has(n)) && !rm.has(n);
      cb.onchange = () => {
        const a = new Set(S().wiAdd || []), r = new Set(S().wiRemove || []);
        if (cb.checked) { r.delete(n); if (!def.has(n)) a.add(n); } else { a.delete(n); if (def.has(n)) r.add(n); }
        setSetting({ wiAdd: [...a], wiRemove: [...r] });
      };
      const why = def.get(n) || (names.includes(n) ? '' : '已经不在酒馆里了');
      const mid = el('div', 'xjc-grow', n);
      if (why) mid.appendChild(el('span', 'xjc-wi-why', why));
      const sum = el('div', 'xjc-wi-sum');
      mid.appendChild(sum);
      row.append(cb, mid);
      const entries = el('div', 'xjc-wi-entries');
      listBox.append(row, entries);
      // 条目直接列出来，只显示酒馆里的状态（开 / 关、蓝灯 / 绿灯），要改去酒馆的世界书里改
      if (names.includes(n)) loadBook(n).then(list => {
        const on = list.filter(e => !e.disable);
        const cnt = l => on.filter(e => lampOf(e) === l).length;
        sum.textContent = [`开 ${on.length} / 共 ${list.length}`, cnt('constant') && `🔵 ${cnt('constant')}`, cnt('normal') && `🟢 ${cnt('normal')}`, cnt('vectorized') && `🔗 ${cnt('vectorized')}`].filter(Boolean).join(' · ');
        for (const e of list) {
          const r = el('div', `xjc-wi-entry${e.disable ? ' off' : ''}`);
          const lamp = lampOf(e);
          r.append(
            el('span', 'xjc-wi-lamp', { constant: '🔵', normal: '🟢', vectorized: '🔗' }[lamp]),
            el('span', 'xjc-grow', e.comment || (e.key || []).join('、') || `条目 ${e.uid}`),
            el('span', 'xjc-wi-state', e.disable ? '已禁用' : { constant: '蓝灯', normal: '绿灯', vectorized: '向量' }[lamp]),
            el('span', 'xjc-wi-state', wiPos(e)),
          );
          r.title = (e.key || []).length ? `关键词：${e.key.join('、')}` : '';
          entries.appendChild(r);
        }
      }).catch(() => { sum.textContent = '读不到条目'; });
    }
  };
  const reset = btn('恢复默认', () => { setSetting({ wiAdd: [], wiRemove: [] }); fill(); });
  pickBox.append(field('用哪几本', listBox, '默认勾上酒馆现在开着的、当前角色卡绑定的（还有聊天、人设绑定的），在这上面增减。条目的开关和蓝灯绿灯是酒馆里的状态，要改去酒馆的世界书里改。换了角色，新角色卡绑定的书也会默认勾上；你取消过的书一直不用。'), reset);
  const show = v => { pickBox.hidden = v !== 'pick'; if (v === 'pick') fill(); };
  w.append(field('世界书来源', seg([{ v: 'sync', l: '同步酒馆' }, { v: 'pick', l: '自己选' }], S().wiSource === 'pick' ? 'pick' : 'sync', v => { setSetting({ wiSource: v }); show(v); }),
    '同步酒馆：和酒馆聊天时用的世界书一样。自己选：在插件里勾用哪几本，不改酒馆自己的世界书设置。'), pickBox);
  show(S().wiSource === 'pick' ? 'pick' : 'sync');
  return w;
}

function renderSettings() {
  const v = views.settings;
  v.innerHTML = '';
  v.appendChild(seg(SET_TABS, setTab, x => { setTab = x; renderSettings(); }));
  const box = el('div');
  box.style.marginTop = '14px';
  v.appendChild(box);
  ({ gen: setGen, api: setApi, chat: setChat, look: setLook, data: setData })[setTab](box);
}
const S = () => state.settings;
function setGen(box) {
  const tgt = select(apiTargets(), resolveTarget(''));
  tgt.onchange = () => setSetting({ api: tgt.value });
  box.appendChild(field('默认出口', tgt, '都是流式请求，写得久也不会被中转站超时掐断（酒馆用文本补全时除外）。每个小剧场还能单独指定出口。'));
  const mt = input(S().maxTokens, '', 'number');
  mt.onchange = () => setSetting({ maxTokens: Math.max(256, Number(mt.value) || 4096) });
  box.appendChild(field('最大输出长度（token）', mt, '用于跟随酒馆和连接配置。HTML 小剧场很吃长度，建议 4000 以上。自配 API 在各自配置里设。'));
  box.appendChild(toggle('边写边显示', S().streamPreview !== false, v => setSetting({ streamPreview: v })));
  box.appendChild(toggle('写好了提醒（不在小剧场面板上时，酒馆里弹一条提示，点了去看）', S().notifyDone !== false, v => setSetting({ notifyDone: v })));
  box.appendChild(toggle('「随机」里也可能抽到 AI 自选', S().randomIncludesAi, v => setSetting({ randomIncludesAi: v })));

  // 全局值：小剧场里选「跟随全局」（新建的默认就是）时用这些；小剧场里选了自定的不受影响
  box.appendChild(el('div', 'xjc-sec', '全局默认'));
  box.appendChild(el('p', 'xjc-hint', '小剧场里选「跟随全局」时用这里的设置，新建的小剧场默认全部跟随。想让某个小剧场不一样，就在它的编辑页里选具体的值。'));
  const lenF = field('篇幅', seg(['short', 'medium', 'long'].map(k => ({ v: k, l: LENGTH_LABEL[k] })), S().defaultLength, v => setSetting({ defaultLength: v })));
  box.appendChild(toggle('限制篇幅', S().lengthLimit, v => { setSetting({ lengthLimit: v }); lenF.hidden = !v; }));
  box.appendChild(lenF);
  lenF.hidden = !S().lengthLimit;
  const gWhoText = input(S().defaultWhoText || '', '比如：TA 的新同事');
  gWhoText.onchange = () => setSetting({ defaultWhoText: gWhoText.value.trim() });
  const gWhoF = field('自定身份', gWhoText, '跟随全局的小剧场用这个身份；小剧场里自己写了身份的用它自己的。');
  box.appendChild(field('我在戏里是谁', seg(Object.entries(WHO_LABEL).map(([v, l]) => ({ v, l })), globalWho(), v => { setSetting({ defaultWho: v }); gWhoF.hidden = v !== 'custom'; })));
  box.appendChild(gWhoF);
  gWhoF.hidden = globalWho() !== 'custom';
  box.appendChild(field('通道', seg(Object.entries(CHANNEL_LABEL).map(([v, l]) => ({ v, l })), globalChannel(), v => setSetting({ defaultChannel: v }))));
  const roundsIn = input(S().defaultRounds || 12, '', 'number');
  roundsIn.onchange = () => setSetting({ defaultRounds: Math.max(1, Math.min(100, Number(roundsIn.value) || 12)) });
  const roundsF = field('带几轮', roundsIn, '一轮 = 你一句 + TA 一句');
  box.appendChild(field('聊天记录', seg([{ v: 'recent', l: '最近 N 轮' }, { v: 'none', l: '不带' }], S().defaultChat || 'recent', v => { setSetting({ defaultChat: v }); roundsF.hidden = v !== 'recent'; })));
  box.appendChild(roundsF);
  roundsF.hidden = (S().defaultChat || 'recent') !== 'recent';
  box.appendChild(toggle('带世界书（和酒馆一样按聊天内容激活）', S().defaultWorldInfo !== false, v => setSetting({ defaultWorldInfo: v })));
  box.appendChild(wiSourceBox());
  box.appendChild(toggle('带剧情总结', S().defaultSummary !== false, v => setSetting({ defaultSummary: v })));
  const style = select(Object.entries(STYLE_LABEL).map(([v, l]) => ({ v, l })), globalStyle());
  style.onchange = () => setSetting({ defaultStyle: style.value });
  box.appendChild(field('HTML 风格', style));
  box.appendChild(toggle('HTML 小剧场分两步出', globalStaged(), v => setSetting({ stagedDefault: v })));
  if (S().writeBackFeature) box.appendChild(toggle('写回记忆（写进聊天的世界书）', globalWriteBack(), v => setSetting({ writeBackDefault: v })));
  box.appendChild(el('div', 'xjc-sec', '内置指令'));
  const nEdited = INSTR.filter(x => instrEdited(x.key)).length;
  box.appendChild(el('p', 'xjc-hint', `插件自己加在 <Brief> 里的话：纯文字 / HTML / 混排的输出要求、HTML 规则、篇幅、标题、身份、分两步出、楼层下出、AI 自选等。${nEdited ? `已改 ${nEdited} 条。` : '都是默认的。'}`));
  box.appendChild(btn('编辑内置指令', editInstr, 'xjc-btn'));

  box.appendChild(el('div', 'xjc-sec', '可选功能'));
  box.appendChild(toggle('写回记忆：小剧场里多一个开关，开了的那篇生成后把梗概写进这个聊天绑定的世界书，之后聊天时模型会记得（默认关）', !!S().writeBackFeature, v => { setSetting({ writeBackFeature: v }); renderSettings(); }));
  box.appendChild(el('div', 'xjc-sec', '最近'));
  const keep = input(S().recentKeep, '', 'number');
  keep.onchange = () => { setSetting({ recentKeep: Math.max(0, Math.min(100, Number(keep.value) || 0)) }); save('recent'); };
  box.appendChild(field('「最近」保留几篇', keep, '没收藏的结果只保留这么多，旧的自动丢掉。'));
}

function setApi(box) {
  box.appendChild(el('p', 'xjc-hint', `小剧场可以用和聊天不同的模型。请求经酒馆后端转发，不会有跨域问题，手机上也能用。配置（含密钥）存在：${backendName()}。`));
  const list = el('div', 'xjc-list');
  list.style.margin = '12px 0';
  if (!state.apis.length) list.appendChild(el('div', 'xjc-empty', '还没有自配 API。'));
  for (const a of state.apis) {
    list.appendChild(itemRow(a.name || a.model || '未命名', `${(API_FORMATS.find(f => f.v === a.format) || {}).l?.split('（')[0] || ''} · ${a.model || '未填模型'} · ${a.url || '默认地址'}`, () => editApi(a), resolveTarget('') === `api:${a.id}` ? '默认' : ''));
  }
  box.appendChild(list);
  box.appendChild(btn('＋ 新增 API', () => editApi(null), 'xjc-btn pri'));
}

const URL_HINT = {
  openai: '填到 /v1 为止，比如 https://api.deepseek.com/v1 、https://openrouter.ai/api/v1 ，或你的中转地址',
  claude: '留空 = 官方 https://api.anthropic.com/v1 ；用反代就填反代地址',
  gemini: '留空 = 官方 AI Studio；用反代就填反代地址',
};
function editApi(row) {
  const d = { id: '', name: '', format: 'openai', url: '', key: '', model: '', temperature: 1, maxTokens: 4096, stream: true, ...clone(row || {}) };
  openSheet(row ? '编辑 API' : '新增 API', (body, foot, closeIt) => {
    const name = input(d.name, '随便起个名，比如：DeepSeek');
    body.appendChild(field('名字', name));
    const urlHint = el('p', 'xjc-hint', URL_HINT[d.format]);
    const fmt = select(API_FORMATS, d.format);
    fmt.onchange = () => { d.format = fmt.value; urlHint.textContent = URL_HINT[d.format]; };
    body.appendChild(field('接口格式', fmt));
    const url = input(d.url, 'https://…', 'url');
    const uf = field('地址', url);
    uf.appendChild(urlHint);
    body.appendChild(uf);
    const key = input(d.key, 'sk-…', 'password');
    const kf = field('密钥', key);
    const show = btn('显示', () => { key.type = key.type === 'password' ? 'text' : 'password'; show.textContent = key.type === 'password' ? '显示' : '隐藏'; }, 'xjc-btn sm ghost');
    show.style.marginTop = '6px';
    kf.appendChild(show);
    body.appendChild(kf);
    const model = input(d.model, '比如 deepseek-chat');
    const dl = el('datalist');
    dl.id = uid('dl');
    model.setAttribute('list', dl.id);
    const mf = field('模型', model);
    const modelSel = el('select');
    modelSel.hidden = true;
    modelSel.style.marginTop = '6px';
    modelSel.onchange = () => { if (modelSel.value) model.value = modelSel.value; };
    const fetchBtn = btn('拉取模型列表', async () => {
      fetchBtn.disabled = true; fetchBtn.textContent = '拉取中…';
      try {
        const models = await fetchModels({ ...d, format: fmt.value, url: url.value.trim(), key: key.value.trim() });
        dl.innerHTML = '';
        modelSel.innerHTML = '';
        modelSel.appendChild(el('option', '', `选一个（共 ${models.length} 个）`)).value = '';
        for (const m of models) { const o = el('option', '', m); o.value = m; dl.appendChild(o); modelSel.appendChild(el('option', '', m)).value = m; }
        modelSel.hidden = !models.length;
        toast(models.length ? `拉到 ${models.length} 个模型` : '接口没返回模型，手动填吧');
      } catch (e) { fail(e); }
      fetchBtn.disabled = false; fetchBtn.textContent = '拉取模型列表';
    }, 'xjc-btn sm');
    fetchBtn.style.marginTop = '6px';
    mf.append(dl, modelSel, fetchBtn);
    body.appendChild(mf);
    const temp = input(d.temperature, '', 'number');
    temp.step = '0.05';
    const mt = input(d.maxTokens, '', 'number');
    const g = el('div', 'xjc-grid2');
    g.append(field('温度', temp), field('最大输出（token）', mt));
    body.appendChild(g);
    const stream = toggle('流式（边写边显示；个别中转不支持就关掉）', d.stream !== false);
    body.appendChild(stream);
    const asDefault = toggle('设为默认出口', resolveTarget('') === `api:${d.id}` && !!d.id);
    body.appendChild(asDefault);
    const collect = () => ({
      ...d, id: d.id || uid('api'), name: name.value.trim(), format: fmt.value, url: url.value.trim().replace(/\/+$/, ''), key: key.value.trim(), model: model.value.trim(),
      temperature: Math.max(0, Math.min(2, Number(temp.value) || 0)), maxTokens: Math.max(64, Number(mt.value) || 4096), stream: stream.input.checked,
    });
    if (row) foot.appendChild(ibtn('fa-trash-can', '删除', async () => {
      if (!(await confirmSheet('删除 API', `删除「${row.name || row.model}」？用它的小剧场会改回默认出口。`, '删除', true))) return;
      remove('apis', row.id);
      if (state.settings.api === `api:${row.id}`) setSetting({ api: 'st' });
      closeIt(); renderSettings();
    }, 'xjc-btn danger'));
    const testBtn = btn('保存并测试', async () => {
      const a = upsert('apis', collect());
      d.id = a.id;
      testBtn.disabled = true; testBtn.textContent = '测试中…';
      try {
        const t0 = Date.now();
        const r = await callModel([{ role: 'user', content: '只回复两个字：收到' }], { target: `api:${a.id}` });
        toast(`通了（${((Date.now() - t0) / 1000).toFixed(1)} 秒）：${r.text.trim().slice(0, 40) || '（空回复）'}`, 'success');
      } catch (e) { fail(e); }
      testBtn.disabled = false; testBtn.textContent = '保存并测试';
    }, 'xjc-btn');
    foot.appendChild(testBtn);
    foot.appendChild(btn('保存', () => {
      const a = upsert('apis', collect());
      if (asDefault.input.checked) setSetting({ api: `api:${a.id}` });
      else if (state.settings.api === `api:${a.id}`) setSetting({ api: 'st' });
      closeIt(); renderSettings();
    }, 'xjc-btn pri'));
  });
}

function setChat(box) {
  const t = S().tail;
  const put = patch => setSetting({ tail: { ...S().tail, ...patch } });
  box.appendChild(el('p', 'xjc-hint', '可选功能，默认关闭。打开后小剧场可以挂在聊天楼层下面：用到截至那条消息的聊天记录，只是给你看的，不会发给模型、不影响后续聊天。存在那条消息里，换一个回复（swipe）就跟着换。'));
  const more = el('div');
  box.appendChild(toggle('在楼层里显示小剧场', t.enabled, v => { put({ enabled: v }); more.hidden = !v; document.dispatchEvent(new CustomEvent('xjc-settings')); }));
  box.appendChild(more);
  more.hidden = !t.enabled;
  box = more;
  const askT = toggle('点面具按钮时先填这次的附加要求（可留空，直接确定就照常出）', t.askExtra, v => put({ askExtra: v }));
  box.appendChild(toggle('消息的「…」菜单里加面具按钮（点一下为这条出一篇）', t.button, v => { put({ button: v }); document.dispatchEvent(new CustomEvent('xjc-settings')); askT.hidden = !v; }));
  box.appendChild(askT);
  askT.hidden = !t.button;
  // 自动出关着时，概率和出哪种都用不到，收起来
  const autoBox = el('div');
  box.appendChild(toggle('AI 回复后自动出一篇', t.auto, v => { put({ auto: v }); autoBox.hidden = !v; }));
  box.appendChild(autoBox);
  autoBox.hidden = !t.auto;
  const chance = input(t.chance, '', 'number');
  chance.onchange = () => put({ chance: Math.max(1, Math.min(100, Number(chance.value) || 30)) });
  autoBox.appendChild(field('自动出的概率（%）', chance, '100 = 每条回复都出。'));
  autoBox.appendChild(toggle('换一个回复（swipe）、重新生成时也自动出', t.autoOnSwipe, v => put({ autoOnSwipe: v })));
  const comboSel = select(state.combos.map(c => ({ v: c.id, l: c.name })), t.comboId || state.combos[0]?.id);
  comboSel.onchange = () => put({ comboId: comboSel.value });
  const cf = field('用这个小剧场', comboSel);
  autoBox.appendChild(field('出哪种', seg([{ v: 'random', l: '按权重随机' }, { v: 'ai', l: 'AI 自选' }, { v: 'combo', l: '固定一个' }], t.pick, v => { put({ pick: v, comboId: comboSel.value }); cf.hidden = v !== 'combo'; })));
  autoBox.appendChild(cf);
  cf.hidden = t.pick !== 'combo';
  box.appendChild(toggle('默认展开', t.expanded, v => put({ expanded: v })));
}

const THEMES = [
  { v: 'magazine', l: '杂志', d: '米白纸面 · 宋体报头', pv: 'mag' },
  { v: 'sticky', l: '便签墙', d: '彩色便签 · 胶带', pv: 'stk' },
  { v: 'terminal', l: '终端', d: '黑底绿字 · 等宽', pv: 'trm' },
  { v: 'script', l: '剧本', d: '打字机 · 装订孔', pv: 'scr' },
  { v: 'night', l: '夜读', d: '深蓝夜色 · 琥珀灯', pv: 'ngt' },
  { v: 'letter', l: '信笺', d: '粉笺楷体 · 邮戳', pv: 'ltr' },
  { v: 'candy', l: '糖果', d: '马卡龙 · 圆角', pv: 'cdy' },
  { v: 'xuan', l: '宣纸', d: '米黄宣纸 · 朱印', pv: 'xun' },
  { v: 'st', l: '酒馆', d: '跟你的酒馆 UI 主题', pv: 'st' },
];
const themeLabel = v => (THEMES.find(t => t.v === v) || {}).l || v;

/** 自定义主题的起始模板：把「基于」那套的颜色填进变量，改数值就能换色 */
function themeTemplate(base) {
  const probe = el('div', 'xjc-viewer');
  probe.dataset.xjcTheme = base;
  probe.hidden = true;
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const vals = {};
  for (const k of ['bg', 'chat', 'ink', 'line', 'acc', 'on']) vals[`--xjc-ui-${k}`] = cs.getPropertyValue(`--xjc-ui-${k}`).trim() || 'inherit';
  probe.remove();
  const v = k => vals[k];
  return `/* 自定义主题。改下面的变量就能换配色；也可以写任何 CSS，
   选择器前面加 [data-xjc-custom] 就只作用于小剧场（面板、全屏、聊天里的卡片）。 */
[data-xjc-custom] {
  --xjc-ui-bg: ${v('--xjc-ui-bg')};      /* 面板底色 */
  --xjc-ui-chat: ${v('--xjc-ui-chat')};    /* 卡片、输入框底色 */
  --xjc-ui-ink: ${v('--xjc-ui-ink')};     /* 文字 */
  --xjc-ui-line: ${v('--xjc-ui-line')};    /* 细线、边框 */
  --xjc-ui-acc: ${v('--xjc-ui-acc')};     /* 强调色 */
  --xjc-ui-on: ${v('--xjc-ui-on')};      /* 强调色上的文字 */
  /* 正文（小剧场内容）的颜色，不写就跟「基于」的主题 */
  /* --xjc-canvas-bg: #ffffff; --xjc-canvas-ink: #222; --xjc-canvas-acc: #c00; --xjc-canvas-line: #ddd; */
  /* --xjc-canvas-font: "Kaiti SC", KaiTi, serif; */
}
/* 例：去掉底纹
[data-xjc-custom] .xjc-panel { background-image: none; } */
/* 例：换报头字体
[data-xjc-custom] .xjc-hd h2 { font-family: "Kaiti SC", KaiTi, serif; } */
`;
}
const CANVAS_SPLIT = '/* ===== 正文 CSS（放进小剧场内容的 iframe 里） ===== */';
function themeToCss(t) {
  return `/* xjc-theme ${JSON.stringify({ name: t.name, base: t.base })} */\n${t.css || ''}\n\n${CANVAS_SPLIT}\n${t.canvasCss || ''}\n`;
}
function cssToTheme(text, fallbackName) {
  const head = String(text).match(/^\s*\/\*\s*xjc-theme\s+(\{.*?\})\s*\*\//);
  let meta = {};
  if (head) { try { meta = JSON.parse(head[1]); } catch { /* ignore */ } }
  let body = head ? String(text).slice(head[0].length) : String(text);
  let canvasCss = '';
  const i = body.indexOf(CANVAS_SPLIT);
  if (i >= 0) { canvasCss = body.slice(i + CANVAS_SPLIT.length).trim(); body = body.slice(0, i); }
  return { id: uid('th'), name: String(meta.name || fallbackName || '导入的主题').slice(0, 40), base: BUILTIN_THEMES.includes(meta.base) ? meta.base : themeName(), css: body.trim(), canvasCss };
}
function useTheme(v) { setSetting({ theme: v }); applyTheme(); }

function editTheme(row) {
  const d = row ? clone(row) : { id: uid('th'), name: '我的主题', base: themeName(), css: themeTemplate(themeName()), canvasCss: '' };
  const before = state.settings.theme;
  openSheet(row ? `编辑主题「${row.name}」` : '新建主题', (body, foot, closeIt) => {
    const name = input(d.name, '主题名字');
    body.appendChild(field('名字', name));
    const base = select(THEMES.map(t => ({ v: t.v, l: t.l })), d.base);
    body.appendChild(field('基于', base, '先套用这套内置主题的样子，再叠上你的 CSS。'));
    const css = textarea(d.css, 14);
    css.classList.add('xjc-code');
    body.appendChild(field('面板 CSS', css, '作用于面板、全屏查看和聊天里挂的小剧场卡片。'));
    const ccss = textarea(d.canvasCss, 6, '比如：.xjc-text p { text-indent: 2em; }  p:first-child::first-letter { color: var(--xjc-acc); }');
    ccss.classList.add('xjc-code');
    body.appendChild(field('正文 CSS（可空）', ccss, '放进小剧场内容的 iframe 里：纯文字段落是 .xjc-text p，AI 写的 HTML 在 .xjc-html 里。可用 --xjc-bg --xjc-ink --xjc-acc --xjc-line --xjc-font。'));
    body.appendChild(btn('用「基于」的颜色重新生成模板', () => { css.value = themeTemplate(base.value); }, 'xjc-btn sm'));
    const collect = () => ({ ...d, name: name.value.trim() || '我的主题', base: base.value, css: css.value, canvasCss: ccss.value });
    // 边改边看：先当成当前主题套上，取消就换回原来的
    let previewing = false;
    const preview = () => {
      const t = collect();
      const i = state.themes.findIndex(x => x.id === t.id);
      if (i >= 0) state.themes[i] = { ...state.themes[i], ...t }; else { state.themes.push({ ...t, draft: true }); }
      state.settings.theme = `custom:${t.id}`;
      previewing = true;
      applyTheme();
    };
    let timer = 0;
    for (const n of [css, ccss, name]) n.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(preview, 400); });
    base.addEventListener('change', preview);
    if (row) {
      foot.appendChild(ibtn('fa-trash-can', '删除', async () => {
        if (!(await confirmSheet('删除主题', `删除「${row.name}」？`, '删除', true))) return;
        state.themes = state.themes.filter(x => x.id !== row.id);
        await save('themes');
        previewing = false;
        if (String(state.settings.theme) === `custom:${row.id}` || before === `custom:${row.id}`) useTheme(row.base || 'magazine');
        closeIt(); renderSettings();
      }, 'xjc-btn danger'));
      foot.appendChild(btn('导出 .css', () => saveFile(themeToCss(collect()), `小剧场主题-${collect().name}.css`, 'text/css'), 'xjc-btn ghost'));
    }
    foot.appendChild(btn('保存并使用', async () => {
      const t = collect();
      delete t.draft;
      const i = state.themes.findIndex(x => x.id === t.id);
      if (i >= 0) state.themes[i] = t; else state.themes.push(t);
      await save('themes');
      previewing = false;
      useTheme(`custom:${t.id}`);
      closeIt(); renderSettings(); toast('主题已保存', 'success');
    }, 'xjc-btn pri'));
  }, () => {
    // 关掉没保存：撤回预览
    if (!previewing) return;
    state.themes = state.themes.filter(x => !x.draft);
    if (row) { const i = state.themes.findIndex(x => x.id === row.id); if (i >= 0) state.themes[i] = row; }
    state.settings.theme = before;
    applyTheme();
  });
}
async function importThemeCss() {
  const f = await pickFile('.css,text/css,text/plain');
  if (!f) return;
  const t = cssToTheme(f.text, f.name.replace(/\.(css|txt)$/i, ''));
  if (!t.css && !t.canvasCss) { toast('这个文件是空的'); return; }
  state.themes.push(t);
  await save('themes');
  useTheme(`custom:${t.id}`);
  renderSettings();
  toast(`导入主题「${t.name}」并已套用`, 'success');
}
function setLook(box) {
  const reread = () => { updateReading(); };
  const grid = el('div', 'xjc-themes');
  const cur = String(state.settings.theme || '');
  const tile = (v, label, desc, pv) => {
    const b = el('button', 'xjc-th' + (cur === v || (!activeCustom() && v === themeName() && !cur.startsWith('custom:')) ? ' on' : ''));
    b.type = 'button';
    b.dataset.v = v;
    b.append(el('div', `pv pv-${pv}`), el('b', '', label), el('span', '', desc));
    b.onclick = () => {
      useTheme(v);
      grid.querySelectorAll('.xjc-th').forEach(x => x.classList.toggle('on', x === b));
      renderSettings();
    };
    grid.appendChild(b);
  };
  for (const t of THEMES) tile(t.v, t.l, t.d, t.pv);
  for (const t of state.themes) tile(`custom:${t.id}`, t.name, `自定义 · 基于${themeLabel(t.base)}`, (THEMES.find(x => x.v === t.base) || THEMES[0]).pv);
  box.appendChild(field('主题', grid, '面板、正文、全屏和聊天里挂的小剧场一起换。'));
  const trow = el('div', 'xjc-row');
  trow.style.margin = '-4px 0 14px';
  trow.append(btn('＋ 新建自定义主题', () => editTheme(null), 'xjc-btn sm'), btn('导入 CSS 文件', () => importThemeCss().catch(fail), 'xjc-btn sm'));
  const ac = activeCustom();
  if (ac) trow.appendChild(btn(`编辑「${ac.name}」`, () => editTheme(ac), 'xjc-btn sm pri'));
  box.appendChild(trow);
  box.appendChild(toggle('动效（抽屉滑入、生成时的转圈和闪烁光标）', S().motion !== false, v => { setSetting({ motion: v }); applyTheme(); }));
  box.appendChild(field('界面字号', seg([{ v: 0.8, l: '特小' }, { v: 0.9, l: '小' }, { v: 1, l: '标准' }, { v: 1.1, l: '大' }, { v: 1.2, l: '特大' }].map(x => ({ v: String(x.v), l: x.l })), String(S().uiScale ?? 1), v => { setSetting({ uiScale: Number(v) }); applyTheme(); }), '整个插件一起缩放：面板、全屏、聊天里挂的小剧场和正文。不跟酒馆的字号走。'));
  box.appendChild(field('正文字号', seg([{ v: 0.9, l: '小' }, { v: 1, l: '标准' }, { v: 1.1, l: '大' }, { v: 1.2, l: '特大' }].map(x => ({ v: String(x.v), l: x.l })), String(S().fontScale), v => { setSetting({ fontScale: Number(v) }); reread(); }), '在界面字号的基础上，单独调小剧场正文。'));
  box.appendChild(field('行距', seg([{ v: 'tight', l: '紧' }, { v: 'mid', l: '适中' }, { v: 'loose', l: '松' }], S().lineHeight, v => { setSetting({ lineHeight: v }); reread(); })));
  box.appendChild(field('正文底色', seg(Object.entries(CANVAS_LABEL).map(([v, l]) => ({ v, l })), S().canvas, v => { setSetting({ canvas: v }); reread(); }), '正文的底色和文字色，默认跟着主题走。AI 写的 HTML 用 --xjc-bg 等变量就能配色一致。'));
  foldSection(box);
}

/** 楼层里小剧场收起时的样子：每种带一个预览，点一下就换；「自定」可以写 CSS，边改边看 */
function foldSection(box) {
  box.appendChild(el('div', 'xjc-sec', '楼层里的折叠样式'));
  box.appendChild(el('p', 'xjc-hint', `挂在聊天消息下面的小剧场收起时的样子，颜色跟着主题走。${S().tail.enabled ? '' : '（楼层功能现在没开，在「设置 → 聊天内」打开。）'}新挂上的默认收起，想默认展开在「聊天内」里改。`));
  const sample = v => {
    const tail = el('div', 'xjc-tail');
    tail.dataset.fold = v;
    for (const [t, k] of [['雨夜便利店', '文字型 · 深夜便利店'], ['论坛目击帖', '前端型 · 论坛']]) {
      const card = el('div', 'xjc-tail-card closed');
      markTheme(card);
      const hd = el('div', 'xjc-tail-hd');
      const ttl = el('div', 'ttl');
      ttl.innerHTML = '<b><i class="fa-solid fa-masks-theater"></i> 小剧场</b>';
      ttl.append(document.createTextNode(t), el('small', '', k));
      hd.appendChild(ttl);
      for (const ic of ['fa-expand', 'fa-rotate-right', 'fa-heart', 'fa-trash-can']) { const b = el('span', 'xjc-tb'); b.innerHTML = `<i class="fa-solid ${ic}"></i>`; hd.appendChild(b); }
      card.appendChild(hd);
      tail.appendChild(card);
    }
    return tail;
  };
  const list = el('div', 'xjc-folds');
  const editor = el('div', 'xjc-fold-edit');
  const paint = () => {
    list.querySelectorAll('.xjc-fold-opt').forEach(o => o.classList.toggle('on', o.dataset.v === currentFold()));
    editor.hidden = currentFold() !== 'custom';
  };
  for (const f of FOLDS) {
    const opt = el('div', 'xjc-fold-opt');
    opt.dataset.v = f.v;
    const hd = el('div', 'xjc-fold-hd');
    hd.append(el('b', '', f.l), el('span', '', f.d));
    opt.append(hd, sample(f.v));
    opt.onclick = () => { setSetting({ foldStyle: f.v }); applyFold(); paint(); };
    list.appendChild(opt);
  }
  box.appendChild(list);
  // 自定：从某个内置样式开始改；输入时预览和聊天里的立刻跟着变，点保存才存
  const ta = textarea(customFoldCss(), 9);
  ta.classList.add('xjc-code');
  ta.spellcheck = false;
  ta.addEventListener('input', () => applyFold(ta.value));
  editor.append(
    field('从这个样式开始改', seg(FOLDS.filter(f => f.v !== 'custom').map(f => ({ v: f.v, l: f.l })), '', v => { ta.value = foldCss(v, 'custom') || '/* 标题栏就是不加任何规则的样子，在这里写自己的 */\n.xjc-tail[data-fold="custom"] .xjc-tail-card.closed {\n}'; applyFold(ta.value); })),
    field('自定 CSS', ta, '收起的卡片是 .xjc-tail[data-fold="custom"] .xjc-tail-card.closed；里面 .xjc-tail-hd 是标题栏，.ttl 是标题，.ttl small 是类型，.xjc-tb 是右边的按钮。颜色用 var(--xjc-ui-acc) 这类主题变量，换主题会跟着变。'),
  );
  const row = el('div', 'xjc-row');
  row.append(btn('保存自定样式', async () => { await setSetting({ foldCss: ta.value }); applyFold(); toast('折叠样式已保存'); }, 'xjc-btn pri sm'),
    btn('撤销没保存的', () => { ta.value = customFoldCss(); applyFold(); }, 'xjc-btn ghost sm'));
  editor.appendChild(row);
  box.appendChild(editor);
  paint();
}

function setData(box) {
  box.appendChild(el('p', 'xjc-hint', `${state.combos.length} 个小剧场 · ${state.prompts.length} 条提示词 · ${state.randoms.length} 条随机 · ${state.macros.length} 个宏 · ${state.preambles.length} 条前置 · ${state.themes.length} 个自定义主题 · ${state.favorites.length} 收藏 · ${state.recent.length} 最近。存在：${backendName()}。`));
  box.appendChild(el('div', 'xjc-sec', '导出'));
  const withFav = toggle('包含收藏', true);
  const withApi = toggle('包含 API 配置（含密钥，别发给别人）', false);
  box.append(withFav, withApi);
  const row = el('div', 'xjc-row');
  const bundle = () => JSON.stringify(exportBundle({ withApis: withApi.input.checked, withFavorites: withFav.input.checked }), null, 2);
  row.append(
    btn('导出文件', () => saveFile(bundle(), `小剧场-${new Date().toISOString().slice(0, 10)}.json`), 'xjc-btn pri'),
    btn('复制 JSON', async () => toast((await copyText(bundle())) ? '已复制' : '复制失败'), 'xjc-btn'),
  );
  box.appendChild(row);
  box.appendChild(el('div', 'xjc-sec', '导入'));
  box.appendChild(btn('导入文件或文本…', importFlow, 'xjc-btn'));
  box.appendChild(el('p', 'xjc-hint', '支持本插件导出、Float 小剧场 APP 导出（记忆设置换成聊天上下文，写回记忆和纯裸通道丢掉）、「## 标题」文本、酒馆预设/世界书/角色卡（挑段落）。'));
  box.appendChild(el('div', 'xjc-sec', '整理'));
  const r2 = el('div', 'xjc-row');
  r2.append(
    btn('补齐默认库', () => { const n = seedDefaults(true); toast(n ? `补回 ${n} 条` : '默认库都在'); }, 'xjc-btn'),
    btn('清空最近', async () => { if (await confirmSheet('清空最近', '没收藏的结果都会删掉。', '清空', true)) { state.recent = []; save('recent'); toast('已清空'); } }, 'xjc-btn'),
    btn('清空收藏', async () => { if (await confirmSheet('清空收藏', `删掉全部 ${state.favorites.length} 条收藏？`, '清空', true)) { state.favorites = []; save('favorites'); toast('已清空'); } }, 'xjc-btn danger'),
    btn('重置库', async () => {
      if (!(await confirmSheet('重置库', '小剧场、提示词、随机、前置全部恢复成默认（收藏、最近、API、自定义主题保留）。', '重置', true))) return;
      clearLibrary(); seedDefaults(false); state.settings = { ...clone(DEFAULT_SETTINGS), api: state.settings.api, tail: state.settings.tail, seeded: true };
      await saveAll(); toast('已重置'); renderSettings();
    }, 'xjc-btn danger'),
    btn('重置全部', async () => {
      if (!(await confirmSheet('重置全部', '库、收藏、最近、自定义主题、设置全部删掉，重新放进默认库。自配 API 保留。确定？', '全部重置', true))) return;
      clearLibrary(); state.themes = []; state.favorites = []; state.recent = []; current = null; stageBox.result.innerHTML = '';
      seedDefaults(false); state.settings = { ...clone(DEFAULT_SETTINGS), seeded: true };
      await saveAll(); applyTheme(); document.dispatchEvent(new CustomEvent('xjc-settings')); toast('已全部重置'); renderSettings();
    }, 'xjc-btn danger'),
  );
  box.appendChild(r2);
}

