// 面板：舞台 / 库 / 收藏 / 设置
import { ctx, el, btn, esc, uid, clone, byId, toast, fail, fmtTime, copyText, saveFile, pickFile } from './util.js';
import { state, save, setSetting, upsert, remove, seedDefaults, saveAll, backendName } from './store.js';
import { DEFAULT_SETTINGS, LENGTH_LABEL } from './defaults.js';
import { currentChar, apiTargets, targetLabel, resolveTarget, API_FORMATS, fetchModels, callModel } from './host.js';
import {
  generateTheater, weightedRandomCombo, aiPickCombo, continueExtra, segmentsOf, kindOf, KIND_LABEL, charCount,
  resultPlainText, contextLabel, postProcess,
} from './gen.js';
import { mountFrame, updateReading, applyTheme, themeName, CANVAS_LABEL } from './frame.js';
import {
  field, input, textarea, select, toggle, seg, tagsToText, textToTags, openSheet, setSheetHost, closeAllSheets,
  closeTopSheet, confirmSheet, snapshotInfo, openViewer, closeViewer, viewerOpen,
} from './ui.js';
import { exportBundle, exportCombo, importBundle, classifyJson, parseTextBlocks, addRows, clearLibrary } from './data.js';
import { isFavorite, toggleFavorite, chatTheaters } from './favs.js';
import { attachToLatest } from './chat.js';

let root = null, panelEl = null, bodyEl = null, kickerEl = null;
let tab = 'stage', libTab = 'combos', setTab = 'gen', favTab = 'fav', promptFilter = '';
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
  root.dataset.xjcTheme = themeName();
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
  const extra = input('', '加一句这次的要求（可空），比如：下雨天、写得甜一点');
  stageBox.extraInput = extra;
  stageBox.extra.className = 'xjc-extra';
  stageBox.extra.appendChild(extra);
  stageBox.genBtn = btn('生成一篇', () => {
    const c = currentCombo();
    if (!c) { toast('先在「库」里建一个小剧场'); switchTab('library'); return; }
    run(c, stageBox.extraInput.value.trim());
  }, 'xjc-btn pri');
  stageBox.rndBtn = btn('随机', () => run(weightedRandomCombo(), stageBox.extraInput.value.trim()), 'xjc-btn');
  stageBox.aiBtn = btn('AI 自选', () => run(aiPickCombo(), stageBox.extraInput.value.trim()), 'xjc-btn');
  stageBox.rndBtn.insertAdjacentHTML('afterbegin', '<i class="fa-solid fa-dice"></i>');
  stageBox.actions.append(stageBox.genBtn, stageBox.rndBtn, stageBox.aiBtn);
  v.append(stageBox.notice, stageBox.pick, stageBox.extra, stageBox.actions, stageBox.result, stageBox.recent);
}

function currentCombo() { return byId(state.combos, state.settings.currentComboId) || state.combos[0] || null; }
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

function comboChips(c) {
  const chips = el('div', 'xjc-chips');
  const chip = (k, v) => { const s = el('span', 'xjc-chip'); s.style.cursor = 'default'; s.appendChild(el('b', '', k)); s.appendChild(document.createTextNode(v)); chips.appendChild(s); };
  const titles = (c.promptIds || []).map(id => (byId(state.prompts, id) || {}).title).filter(Boolean);
  chip('提示词', titles.length ? titles.join(' · ') : '无');
  if (c.random?.count) chip('随机', `抽 ${c.random.count}`);
  chip('输出', `${{ text: '文字', html: 'HTML', mixed: '混排' }[c.output?.mode] || '文字'}${c.output?.staged && c.output?.mode === 'html' ? ' · 分两步' : ''}`);
  chip('上下文', contextLabel(c.context));
  chip('出口', targetLabel(resolveTarget(c.api)).replace(/^连接配置 · |^自配 · /, ''));
  return chips;
}

function renderPick() {
  const box = stageBox.pick;
  box.innerHTML = '';
  if (!state.combos.length) {
    box.appendChild(el('div', 'xjc-empty', '还没有小剧场，去「库」里建一个。'));
    return;
  }
  const cur = currentCombo();
  const strip = el('div', 'xjc-scrollx');
  for (const c of state.combos) {
    const chip = el('button', 'xjc-chip' + (c.id === cur.id ? ' on' : ''), c.name);
    chip.type = 'button';
    chip.onclick = () => { setSetting({ currentComboId: c.id }); renderPick(); };
    strip.appendChild(chip);
  }
  box.appendChild(strip);
  const card = el('div', 'xjc-combo-card');
  card.dataset.scene = String(state.combos.indexOf(cur) + 1);
  const row = el('div', 'xjc-row nowrap');
  row.append(el('div', 'nm xjc-grow', cur.name), btn('编辑', () => editCombo(cur), 'xjc-btn sm ghost'));
  card.append(row, comboChips(cur));
  box.appendChild(card);
  requestAnimationFrame(() => strip.querySelector('.on')?.scrollIntoView({ block: 'nearest', inline: 'center' }));
}

function renderRecent() {
  const box = stageBox.recent;
  box.innerHTML = '';
  if (!state.recent.length) return;
  box.appendChild(el('div', 'xjc-sec', `最近 · 保留 ${state.settings.recentKeep} 篇`));
  const list = el('div', 'xjc-list');
  for (const r of state.recent) list.appendChild(resultItem(r, () => { showResult(r); stageBox.result.scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
  box.appendChild(list);
}

function resultItem(r, onClick, endText) {
  const item = el('div', 'xjc-item');
  const mid = el('div', 'xjc-grow');
  mid.appendChild(el('div', 't', `${isFavorite(r) ? '♥ ' : ''}${r.title || '无题'}`));
  mid.appendChild(el('div', 'd', `${KIND_LABEL[kindOf(r)]} · ${r.snapshot?.comboName || ''}`));
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
  hd.appendChild(el('div', 'kind', `${pending ? '写作中' : KIND_LABEL[kindOf(result)]} · ${snap.comboName || result.comboName || '小剧场'}${picks.length ? ' · 随机 ' + picks.join('、') : ''}`));
  hd.appendChild(el('h3', '', result.title || snap.comboName || '无题'));
  const statusEl = el('div', 'xjc-status');
  statusEl.hidden = true;
  const wrap = el('div', 'xjc-frame-wrap');
  card.append(hd, statusEl, wrap);
  const segs = pending && !(result.segments || []).length ? [] : segmentsOf(result);
  const frame = mountFrame(wrap, segs, { onAction: pending ? null : text => continueFrom(result, text) });
  if (!pending) {
    const meta = el('div', 'xjc-meta');
    meta.append(el('span', '', fmtTime(result.createdAt)), el('span', '', `${charCount(result)} 字${result.model ? ' · ' + result.model : ''}`));
    card.appendChild(meta);
    const ops = el('div', 'xjc-ops');
    ops.appendChild(btn('再来一条', () => again(result), 'xjc-btn'));
    const favBtn = btn(isFavorite(result) ? '♥ 已收藏' : '♡ 收藏', () => {
      const on = toggleFavorite(result);
      favBtn.textContent = on ? '♥ 已收藏' : '♡ 收藏';
      renderRecent();
    }, 'xjc-btn');
    ops.appendChild(favBtn);
    ops.appendChild(btn('⤢ 全屏', () => viewResult(result), 'xjc-btn'));
    ops.appendChild(btn('挂到聊天', async () => {
      try { const at = await attachToLatest(result); toast(`已挂到第 ${at} 楼下面`, 'success'); } catch (e) { fail(e); }
    }, 'xjc-btn'));
    ops.appendChild(btn('复制', async () => toast((await copyText(`${result.title}\n\n${resultPlainText(result)}`)) ? '已复制正文' : '复制失败'), 'xjc-btn ghost'));
    ops.appendChild(btn('ⓘ', () => openSheet('这一篇用了什么', b => {
      b.appendChild(snapshotInfo(result));
      b.appendChild(el('div', 'xjc-sec', '模型原文'));
      b.appendChild(el('pre', 'xjc-pre', result.raw || ''));
    }), 'xjc-btn ghost'));
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
  run(combo, result.snapshot?.extra || '');
}
function continueFrom(result, text) {
  const combo = comboOf(result);
  if (!combo) { toast('这篇的配置已经找不到了'); return; }
  open('stage');
  run(combo, continueExtra(result, text));
}

function streamSegments(text) {
  const body = text.replace(/^\s*(?:标题|题目|Title)\s*[:：].*\n?/, '').replace(/<\/?[a-zA-Z][\w-]*>/g, '');
  return body.trim() ? [{ type: 'text', content: body }] : [];
}

export async function run(combo, extra = '') {
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
  let phase = '正在写';
  let words = 0;
  const cancel = () => {
    if (!busy || busy.token !== token) return;
    ctrl.abort();
    busy = null;
    clearInterval(timer);
    updateBusyButtons();
    setStatus(target === 'st' ? '已取消等待（跟随酒馆 API 时那次请求会继续跑完，回来的结果直接丢掉）' : '已取消', { spin: false });
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
      extra, signal: ctrl.signal, onStream,
      onShell: shell => { if (busy?.token !== token) return; phase = '骨架已出，正在填字'; words = 0; showResult(shell, { pending: true }); tick(); },
    });
    clearTimeout(pendingPaint);
    if (!result || busy?.token !== token) return;
    state.recent.unshift(result);
    save('recent');
    const c = byId(state.combos, combo.id);
    if (c) { c.plays = (c.plays || 0) + 1; save('combos'); }
    setSetting({ played: (Number(state.settings.played) || 0) + 1 });
    renderKicker();
    showResult(result);
    renderRecent();
  } catch (e) {
    clearTimeout(pendingPaint);
    if (busy?.token !== token) return;
    if (ctrl.signal.aborted) return;
    console.error('[小剧场]', e);
    const retry = () => run(combo, extra);
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
  { v: 'combos', l: '小剧场' }, { v: 'prompts', l: '提示词' }, { v: 'randoms', l: '随机' }, { v: 'preambles', l: '前置' },
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
    const n = (c.promptIds || []).length;
    list.appendChild(itemRow(c.name, `${(c.tags || []).map(t => '#' + t).join(' ')} ${n} 条提示词 · ${contextLabel(c.context)}`, () => editCombo(c), `权重 ${c.weight ?? 1}${c.plays ? ` · 演过 ${c.plays}` : ''}`));
  }
  box.appendChild(list);
}
function allTags(list) { return [...new Set(list.flatMap(x => x.tags || []))]; }
function libPrompts(box) {
  const row = el('div', 'xjc-row');
  row.append(btn('＋ 新增提示词', () => editText('prompts', null), 'xjc-btn pri'), btn('批量导入', importFlow, 'xjc-btn'));
  box.appendChild(row);
  const tags = allTags(state.prompts);
  if (tags.length) {
    const chips = el('div', 'xjc-chips');
    chips.style.marginTop = '12px';
    for (const t of ['', ...tags]) {
      const c = el('button', 'xjc-chip' + (promptFilter === t ? ' on' : ''), t || '全部');
      c.type = 'button';
      c.onclick = () => { promptFilter = t; renderLibrary(); };
      chips.appendChild(c);
    }
    box.appendChild(chips);
  }
  const list = el('div', 'xjc-list');
  list.style.marginTop = '12px';
  const rows = state.prompts.filter(p => !promptFilter || (p.tags || []).includes(promptFilter));
  if (!rows.length) list.appendChild(el('div', 'xjc-empty', '场景、if 线、文字形式、前端形式都放这里，用标签区分。'));
  for (const p of rows) list.appendChild(itemRow(p.title, `${(p.tags || []).map(t => '#' + t).join(' ')} ${p.content.replace(/\s+/g, ' ').slice(0, 60)}`, () => editText('prompts', p)));
  box.appendChild(list);
}
function libRandoms(box) {
  box.appendChild(el('div', 'xjc-sec', '随机池 · 生成时按规则抽'));
  const l1 = el('div', 'xjc-list');
  for (const r of state.randoms) l1.appendChild(itemRow(r.title, `${(r.tags || []).map(t => '#' + t).join(' ')} ${r.content.replace(/\s+/g, ' ').slice(0, 60)}`, () => editText('randoms', r)));
  box.appendChild(l1);
  const r1 = el('div', 'xjc-row');
  r1.style.marginTop = '10px';
  r1.appendChild(btn('＋ 新增随机条目', () => editText('randoms', null), 'xjc-btn'));
  box.appendChild(r1);
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
  for (const p of state.preambles) list.appendChild(itemRow(p.name, p.content.replace(/\s+/g, ' ').slice(0, 70), () => editText('preambles', p), p.id === state.settings.defaultPreambleId ? '默认' : ''));
  box.appendChild(list);
  box.appendChild(el('p', 'xjc-hint', '发给模型的顺序：① 材料（角色卡、用户人设、世界书、总结、最近聊天，按小剧场的设置取）② 前置要求 ③ <Brief>（提示词、随机、输出要求）。酒馆预设里的破限、文风、正文格式条目都不会带进来；需要的话写进前置要求。'));
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
    const c = textarea(row?.content, isPre ? 12 : 8, isPre ? '整段 system 框架' : '可以用 {{user}} {{char}} {{篇幅}} {{随机词:世界}} 等宏');
    body.appendChild(field('内容', c));
    let def = null;
    if (isPre) { def = toggle('设为默认（AI 自选、新建小剧场用它）', row && row.id === state.settings.defaultPreambleId); body.appendChild(def); }
    if (row) {
      foot.appendChild(btn('删除', async () => {
        const used = kind !== 'randoms' ? state.combos.filter(x => (isPre ? x.preambleId === row.id : (x.promptIds || []).includes(row.id))).map(x => x.name) : [];
        if (!(await confirmSheet('删除', used.length ? `「${used.join('、')}」在用它，删了这些小剧场里就少了这一条。确定删除？` : '确定删除？', '删除', true))) return;
        remove(kind, row.id);
        closeIt(); renderLibrary();
      }, 'xjc-btn danger'));
    }
    foot.appendChild(btn('保存', () => {
      const title = t.value.trim();
      if (!title) { toast('标题不能空'); return; }
      const data = isPre ? { id: row?.id || uid('pre'), name: title, content: c.value } : { id: row?.id || uid(kind.slice(0, 3)), title, tags: textToTags(tg.value), content: c.value };
      const saved = upsert(kind, data);
      if (isPre && def.input.checked) setSetting({ defaultPreambleId: saved.id });
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
    if (row) foot.appendChild(btn('删除', () => { remove('macros', row.id); closeIt(); renderLibrary(); }, 'xjc-btn danger'));
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
    id: '', name: '', tags: [], preambleId: s.defaultPreambleId || state.preambles[0]?.id || '', promptIds: [],
    random: { count: 0, include: [], exclude: [] },
    output: { mode: 'text', wrapTag: '', length: 'default', customChars: 900, style: s.defaultStyle || 'free', staged: !!s.stagedDefault },
    context: { chat: 'recent', rounds: 12, worldInfo: true, summary: true },
    who: 'persona', whoText: '', api: '', weight: 1,
  };
}

function editCombo(row) {
  const d = clone(row || newCombo());
  d.output = { ...newCombo().output, ...d.output };
  d.context = { ...newCombo().context, ...d.context };
  d.random = { ...newCombo().random, ...d.random };
  openSheet(row ? `编辑「${row.name}」` : '新建小剧场', (body, foot, closeIt) => {
    const name = input(d.name, '比如：深夜便利店偶遇');
    body.appendChild(field('名字', name));
    const tg = input(tagsToText(d.tags), '空格分隔');
    body.appendChild(field('标签', tg));

    body.appendChild(el('div', 'xjc-sec', '提示词'));
    const pre = select(state.preambles.map(p => ({ v: p.id, l: p.name })), d.preambleId);
    body.appendChild(field('前置要求', pre));
    const ordered = el('div', 'xjc-ordered');
    const drawPrompts = () => {
      ordered.innerHTML = '';
      d.promptIds = d.promptIds.filter(id => byId(state.prompts, id));
      if (!d.promptIds.length) ordered.appendChild(el('div', 'xjc-hint', '还没选提示词。'));
      d.promptIds.forEach((id, i) => {
        const p = byId(state.prompts, id);
        const item = el('div', 'xjc-item');
        const mid = el('div', 'xjc-grow');
        mid.append(el('div', 't', `${i + 1}. ${p.title}`), el('div', 'd', (p.tags || []).map(t => '#' + t).join(' ')));
        item.appendChild(mid);
        const mv = (k) => { const j = i + k; if (j < 0 || j >= d.promptIds.length) return; [d.promptIds[i], d.promptIds[j]] = [d.promptIds[j], d.promptIds[i]]; drawPrompts(); };
        item.append(btn('↑', () => mv(-1), 'xjc-btn sm ghost'), btn('↓', () => mv(1), 'xjc-btn sm ghost'), btn('✕', () => { d.promptIds.splice(i, 1); drawPrompts(); }, 'xjc-btn sm ghost'));
        ordered.appendChild(item);
      });
    };
    drawPrompts();
    body.appendChild(ordered);
    body.appendChild(btn('＋ 选提示词', () => pickPrompts(d.promptIds, ids => { d.promptIds = ids; drawPrompts(); }), 'xjc-btn sm'));

    body.appendChild(el('div', 'xjc-sec', '随机'));
    const rc = select([0, 1, 2, 3, 4, 5].map(n => ({ v: String(n), l: n ? `抽 ${n} 条` : '不抽' })), String(d.random.count || 0));
    const inc = input(tagsToText(d.random.include), '只从这些标签里抽（空 = 全部）');
    const exc = input(tagsToText(d.random.exclude), '排除这些标签');
    const rtags = allTags(state.randoms);
    body.append(field('随机池', rc), field('只抽', inc, rtags.length ? `随机池标签：${rtags.join(' ')}` : ''), field('排除', exc));

    body.appendChild(el('div', 'xjc-sec', '输出'));
    const stagedT = toggle('分两步出：先出页面骨架立刻显示，再按占位填字（适合大页面）', d.output.staged);
    const syncStaged = () => { stagedT.hidden = d.output.mode !== 'html'; };
    body.appendChild(field('形式', seg([{ v: 'text', l: '纯文字' }, { v: 'html', l: 'HTML' }, { v: 'mixed', l: '混排' }], d.output.mode, v => { d.output.mode = v; syncStaged(); })));
    body.appendChild(stagedT);
    syncStaged();
    const lenSel = select(['default', 'short', 'medium', 'long', 'custom'].map(k => ({ v: k, l: k === 'default' ? '跟设置' : `${LENGTH_LABEL[k]}${k === 'custom' ? '' : ` · 约 ${{ short: 400, medium: 900, long: 1800 }[k]} 字`}` })), d.output.length);
    const custom = input(d.output.customChars, '字数', 'number');
    const customF = field('自定字数', custom);
    const syncLen = () => { customF.hidden = lenSel.value !== 'custom'; };
    lenSel.onchange = syncLen;
    const g = el('div', 'xjc-grid2');
    g.append(field('篇幅', lenSel), customF);
    body.appendChild(g);
    syncLen();
    const styleSel = select([{ v: 'free', l: '不约束' }, { v: 'vars', l: '给主题变量' }, { v: 'strict', l: '严格只用主题色' }], d.output.style);
    const wrap = input(d.output.wrapTag, '比如 theater（空 = 不包）');
    const g2 = el('div', 'xjc-grid2');
    g2.append(field('HTML 风格', styleSel), field('标签包裹', wrap));
    body.appendChild(g2);

    body.appendChild(el('div', 'xjc-sec', '上下文'));
    const rounds = input(d.context.rounds, '', 'number');
    const roundsF = field('带几轮', rounds, '一轮 = 你一句 + TA 一句');
    body.appendChild(field('聊天记录', seg([{ v: 'recent', l: '最近 N 轮' }, { v: 'none', l: '不带' }], d.context.chat, v => { d.context.chat = v; roundsF.hidden = v !== 'recent'; })));
    body.appendChild(roundsF);
    roundsF.hidden = d.context.chat !== 'recent';
    const wi = toggle('带世界书（按聊天内容激活，和酒馆一样）', d.context.worldInfo);
    const sm = toggle('带剧情总结（酒馆「总结」扩展的内容）', d.context.summary);
    body.append(wi, sm);
    const whoText = input(d.whoText, '比如：TA 的新同事');
    const whoF = field('自定身份', whoText);
    body.appendChild(field('我在戏里是谁', seg([{ v: 'persona', l: '我的人设' }, { v: 'custom', l: '自定身份' }, { v: 'none', l: '旁观' }], d.who, v => { d.who = v; whoF.hidden = v !== 'custom'; })));
    body.appendChild(whoF);
    whoF.hidden = d.who !== 'custom';

    body.appendChild(el('div', 'xjc-sec', '其他'));
    const api = select([{ v: '', l: `跟设置（${targetLabel(state.settings.api)}）` }, ...apiTargets()], d.api || '');
    const weight = input(d.weight ?? 1, '', 'number');
    const g3 = el('div', 'xjc-grid2');
    g3.append(field('出口', api), field('随机权重', weight, '「随机」按权重抽，0 = 不参与'));
    body.appendChild(g3);

    const collect = () => ({
      ...d, id: d.id || uid('c'), name: name.value.trim() || '未命名小剧场', tags: textToTags(tg.value), preambleId: pre.value,
      random: { count: Number(rc.value) || 0, include: textToTags(inc.value), exclude: textToTags(exc.value) },
      output: { ...d.output, length: lenSel.value, customChars: Math.max(50, Number(custom.value) || 900), style: styleSel.value, wrapTag: wrap.value.trim().replace(/[^\w-]/g, ''), staged: stagedT.input.checked },
      context: { ...d.context, rounds: Math.max(1, Math.min(100, Number(rounds.value) || 12)), worldInfo: wi.input.checked, summary: sm.input.checked },
      whoText: whoText.value.trim(), api: api.value, weight: Math.max(0, Number(weight.value) || 0),
    });
    if (row) {
      foot.appendChild(btn('删除', async () => {
        if (!(await confirmSheet('删除小剧场', `删除「${row.name}」？收藏里按它生成的作品不受影响。`, '删除', true))) return;
        remove('combos', row.id);
        closeIt(); renderLibrary(); renderPick();
      }, 'xjc-btn danger'));
      foot.appendChild(btn('导出', () => saveFile(JSON.stringify(exportCombo(collect()), null, 2), `小剧场-${row.name}.json`), 'xjc-btn ghost'));
      foot.appendChild(btn('复制一份', () => { const c = collect(); upsert('combos', { ...c, id: uid('c'), name: c.name + ' 副本', plays: 0 }); closeIt(); renderLibrary(); }, 'xjc-btn ghost'));
    }
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

function pickPrompts(selected, done) {
  const chosen = new Set(selected);
  openSheet('选提示词', (body, foot, closeIt) => {
    let filter = '';
    const chips = el('div', 'xjc-chips');
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
      for (const p of state.prompts.filter(x => !filter || (x.tags || []).includes(filter))) {
        const row = el('label', 'xjc-check');
        const cb = el('input');
        cb.type = 'checkbox';
        cb.checked = chosen.has(p.id);
        cb.onchange = () => (cb.checked ? chosen.add(p.id) : chosen.delete(p.id));
        const mid = el('div', 'xjc-grow');
        mid.append(el('div', '', `${p.title} ${(p.tags || []).map(t => '#' + t).join(' ')}`), el('div', 'd', p.content));
        row.append(cb, mid);
        list.appendChild(row);
      }
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
    body.appendChild(el('p', 'xjc-hint', '① 粘贴文本：每条用一行「## 标题 #标签 #标签」开头，下面是内容，导成提示词。② 选文件：本插件导出的、Float 小剧场 APP 导出的直接进库；其它 JSON（酒馆预设、世界书、角色卡、别人的生成器）会把里面像提示词的段落列出来让你挑。'));
    const ta = textarea('', 8, '## 雨夜便利店 #场景 #日常\n写{{char}}在深夜便利店……\n\n## 弹幕流 #形式 #前端\n输出一段带弹幕滚动的 HTML……');
    body.appendChild(ta);
    foot.appendChild(btn('选文件', async () => {
      try {
        const f = await pickFile();
        if (!f) return;
        let data;
        try { data = JSON.parse(f.text); }
        catch {
          const rows = parseTextBlocks(f.text);
          if (!rows.length) throw new Error('文件既不是 JSON，也没有「## 标题」格式的内容。');
          await addRows('prompts', rows);
          closeIt(); renderLibrary(); toast(`导入 ${rows.length} 条提示词`, 'success');
          return;
        }
        const kind = classifyJson(data);
        if (kind.bundle) { const n = await importBundle(kind.bundle); closeIt(); refresh(); toast(`导入 ${n} 条`, 'success'); return; }
        if (kind.rows) { await addRows('prompts', kind.rows); closeIt(); renderLibrary(); toast(`导入 ${kind.rows.length} 条提示词`, 'success'); return; }
        closeIt();
        pickLoose(kind.loose);
      } catch (e) { fail(e); }
    }, 'xjc-btn'));
    foot.appendChild(btn('导入文本', async () => {
      const rows = parseTextBlocks(ta.value);
      if (!rows.length) { toast('没解析到内容，检查「## 标题」格式'); return; }
      await addRows('prompts', rows);
      closeIt(); renderLibrary(); toast(`导入 ${rows.length} 条提示词`, 'success');
    }, 'xjc-btn pri'));
  });
}
function pickLoose(found) {
  openSheet(`挑要导入的段落（${found.length}）`, (body, foot, closeIt) => {
    const picked = new Set();
    let kind = 'prompts';
    body.appendChild(field('导成', seg([{ v: 'prompts', l: '提示词' }, { v: 'preambles', l: '前置要求' }, { v: 'randoms', l: '随机条目' }], kind, v => { kind = v; })));
    const boxes = [];
    for (const [i, f] of found.entries()) {
      const row = el('label', 'xjc-check');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.onchange = () => (cb.checked ? picked.add(i) : picked.delete(i));
      boxes.push(cb);
      const mid = el('div', 'xjc-grow');
      mid.append(el('div', '', f.name), el('div', 'd', f.content));
      row.append(cb, mid);
      body.appendChild(row);
    }
    foot.appendChild(btn('全选', () => boxes.forEach((cb, i) => { cb.checked = true; picked.add(i); }), 'xjc-btn ghost'));
    foot.appendChild(btn('导入所选', async () => {
      if (!picked.size) { toast('先勾几条'); return; }
      await addRows(kind, [...picked].map(i => ({ title: found[i].name, content: found[i].content, tags: [] })));
      closeIt(); renderLibrary(); toast(`导入 ${picked.size} 条`, 'success');
    }, 'xjc-btn pri'));
  });
}

// ── 收藏 ──
function renderFav() {
  const v = views.fav;
  v.innerHTML = '';
  const theaters = chatTheaters();
  v.appendChild(seg([{ v: 'fav', l: `收藏 ${state.favorites.length}` }, { v: 'chat', l: `本聊天 ${theaters.length}` }], favTab, x => { favTab = x; renderFav(); }));
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
  const list = el('div', 'xjc-list');
  for (const f of [...state.favorites].reverse()) {
    list.appendChild(resultItem(f, () => openViewer(f, {
      actions: [
        { label: '按这套再来', run: r => { again(r); return false; } },
        { label: '复制', run: async r => { toast((await copyText(`${r.title}\n\n${resultPlainText(r)}`)) ? '已复制' : '复制失败'); return true; } },
        { label: '取消收藏', run: r => { toggleFavorite(r); renderFav(); return false; } },
      ],
      onAction: text => continueFrom(f, text),
    })));
  }
  box.appendChild(list);
}

// ── 设置 ──
const SET_TABS = [{ v: 'gen', l: '生成' }, { v: 'api', l: 'API' }, { v: 'chat', l: '聊天内' }, { v: 'look', l: '外观' }, { v: 'data', l: '数据' }];
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
  box.appendChild(field('默认出口', tgt, '「跟随酒馆当前 API」不能边写边显示，也不能真正中断；连接配置和自配 API 可以。每个小剧场还能单独指定出口。'));
  const mt = input(S().maxTokens, '', 'number');
  mt.onchange = () => setSetting({ maxTokens: Math.max(256, Number(mt.value) || 4096) });
  box.appendChild(field('最大输出长度（token）', mt, '用于跟随酒馆和连接配置。HTML 小剧场很吃长度，建议 4000 以上。自配 API 在各自配置里设。'));
  box.appendChild(toggle('边写边显示', S().streamPreview !== false, v => setSetting({ streamPreview: v })));
  box.appendChild(toggle('篇幅限制', S().lengthLimit, v => setSetting({ lengthLimit: v })));
  box.appendChild(field('默认篇幅', seg(['short', 'medium', 'long'].map(k => ({ v: k, l: LENGTH_LABEL[k] })), S().defaultLength, v => setSetting({ defaultLength: v }))));
  box.appendChild(toggle('「随机」里也可能抽到 AI 自选', S().randomIncludesAi, v => setSetting({ randomIncludesAi: v })));
  const style = select([{ v: 'free', l: '不约束' }, { v: 'vars', l: '给主题变量' }, { v: 'strict', l: '严格只用主题色' }], S().defaultStyle);
  style.onchange = () => setSetting({ defaultStyle: style.value });
  box.appendChild(field('新建小剧场的 HTML 风格', style));
  box.appendChild(toggle('新建小剧场默认「分两步出」', S().stagedDefault, v => setSetting({ stagedDefault: v })));
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
    if (row) foot.appendChild(btn('删除', async () => {
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
  box.appendChild(el('p', 'xjc-hint', '小剧场可以挂在聊天消息下面：用到截至那条消息的聊天记录，只是给你看的，不会发给模型、不影响后续聊天。存在那条消息里，换一个回复（swipe）就跟着换。'));
  box.appendChild(toggle('消息的「…」菜单里加面具按钮（点一下为这条出一篇）', t.button, v => { put({ button: v }); document.dispatchEvent(new CustomEvent('xjc-settings')); }));
  box.appendChild(toggle('AI 回复后自动出一篇', t.auto, v => put({ auto: v })));
  const chance = input(t.chance, '', 'number');
  chance.onchange = () => put({ chance: Math.max(1, Math.min(100, Number(chance.value) || 30)) });
  box.appendChild(field('自动出的概率（%）', chance, '100 = 每条回复都出。'));
  const comboSel = select(state.combos.map(c => ({ v: c.id, l: c.name })), t.comboId || state.combos[0]?.id);
  comboSel.onchange = () => put({ comboId: comboSel.value });
  const cf = field('用这个小剧场', comboSel);
  box.appendChild(field('出哪种', seg([{ v: 'random', l: '按权重随机' }, { v: 'ai', l: 'AI 自选' }, { v: 'combo', l: '固定一个' }], t.pick, v => { put({ pick: v, comboId: comboSel.value }); cf.hidden = v !== 'combo'; })));
  box.appendChild(cf);
  cf.hidden = t.pick !== 'combo';
  box.appendChild(toggle('默认展开', t.expanded, v => put({ expanded: v })));
}

const THEMES = [
  { v: 'magazine', l: '杂志', d: '米白纸面 · 宋体报头', pv: 'mag' },
  { v: 'sticky', l: '便签墙', d: '彩色便签 · 胶带', pv: 'stk' },
  { v: 'terminal', l: '终端', d: '黑底绿字 · 等宽', pv: 'trm' },
  { v: 'script', l: '剧本', d: '打字机 · 装订孔', pv: 'scr' },
  { v: 'st', l: '酒馆', d: '跟你的酒馆 UI 主题', pv: 'st' },
];
function setLook(box) {
  const reread = () => { updateReading(); };
  const grid = el('div', 'xjc-themes');
  for (const t of THEMES) {
    const b = el('button', 'xjc-th' + (themeName() === t.v ? ' on' : ''));
    b.type = 'button';
    b.dataset.v = t.v;
    b.append(el('div', `pv pv-${t.pv}`), el('b', '', t.l), el('span', '', t.d));
    b.onclick = () => {
      setSetting({ theme: t.v });
      grid.querySelectorAll('.xjc-th').forEach(x => x.classList.toggle('on', x === b));
      applyTheme();
    };
    grid.appendChild(b);
  }
  box.appendChild(field('主题', grid, '面板、正文、全屏和聊天里挂的小剧场一起换。'));
  box.appendChild(field('小剧场字号', seg([{ v: 0.9, l: '小' }, { v: 1, l: '标准' }, { v: 1.1, l: '大' }, { v: 1.2, l: '特大' }].map(x => ({ v: String(x.v), l: x.l })), String(S().fontScale), v => { setSetting({ fontScale: Number(v) }); reread(); })));
  box.appendChild(field('行距', seg([{ v: 'tight', l: '紧' }, { v: 'mid', l: '适中' }, { v: 'loose', l: '松' }], S().lineHeight, v => { setSetting({ lineHeight: v }); reread(); })));
  box.appendChild(field('正文底色', seg(Object.entries(CANVAS_LABEL).map(([v, l]) => ({ v, l })), S().canvas, v => { setSetting({ canvas: v }); reread(); }), '正文的底色和文字色，默认跟着主题走。AI 写的 HTML 用 --xjc-bg 等变量就能配色一致。'));
}

function setData(box) {
  box.appendChild(el('p', 'xjc-hint', `存在：${backendName()}。`));
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
      if (!(await confirmSheet('重置库', '小剧场、提示词、随机、前置全部恢复成默认（收藏、最近、API 保留）。', '重置', true))) return;
      clearLibrary(); seedDefaults(false); state.settings = { ...clone(DEFAULT_SETTINGS), api: state.settings.api, tail: state.settings.tail, seeded: true };
      await saveAll(); toast('已重置'); renderSettings();
    }, 'xjc-btn danger'),
  );
  box.appendChild(r2);
}

