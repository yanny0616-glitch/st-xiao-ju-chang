// 面板：舞台 / 库 / 收藏 / 设置
import { ctx, el, btn, esc, uid, clone, byId, toast, fail, fmtTime, copyText, saveFile, pickFile } from './util.js';
import { state, save, setSetting, upsert, remove, seedDefaults, saveAll, backendName } from './store.js';
import { DEFAULT_SETTINGS, LENGTH_LABEL } from './defaults.js';
import { currentChar, apiTargets, targetLabel, resolveTarget, API_FORMATS, fetchModels, callModel } from './host.js';
import {
  generateTheater, weightedRandomCombo, aiPickCombo, continueExtra, segmentsOf, kindOf, KIND_LABEL, charCount,
  resultPlainText, contextLabel, postProcess,
} from './gen.js';
import { mountFrame, updateReading, applyTheme, themeName, markTheme, activeCustom, BUILTIN_THEMES, CANVAS_LABEL } from './frame.js';
import {
  field, input, textarea, select, toggle, seg, tagsToText, textToTags, openSheet, setSheetHost, closeAllSheets,
  closeTopSheet, confirmSheet, snapshotInfo, requestView, openViewer, closeViewer, viewerOpen,
} from './ui.js';
import { exportBundle, exportCombo, importBundle, classifyJson, parseTextBlocks, addRows, combosFromPrompts, importDarkArchives, clearLibrary } from './data.js';
import { isFavorite, toggleFavorite, chatTheaters } from './favs.js';
import { attachToLatest } from './chat.js';

let root = null, panelEl = null, bodyEl = null, kickerEl = null;
let tab = 'stage', libTab = 'combos', setTab = 'gen', favTab = 'fav', favFilter = 'all', promptFilter = '';
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
  chip('随机', c.random?.count ? `抽 ${c.random.count}${(c.random.include || []).length ? ' · #' + c.random.include.join(' #') : ''}` : '不抽');
  chip('输出', `${{ text: '文字', html: 'HTML', mixed: '混排' }[c.output?.mode] || '文字'}${c.output?.staged && c.output?.mode === 'html' ? ' · 分两步' : ''}`);
  chip('上下文', c.channel === 'preset' ? '走酒馆预设' : contextLabel(c.context));
  if (c.writeBack && S().writeBackFeature) chip('写回', '世界书');
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
  // 和 Float 一样：舞台只放当前这一个，点卡片弹出列表换
  const cur = currentCombo();
  const card = el('div', 'xjc-combo-card');
  card.dataset.scene = String(state.combos.indexOf(cur) + 1);
  card.title = '点一下换一个小剧场';
  card.onclick = e => { if (!e.target.closest('.xjc-btn')) pickCombo(); };
  const row = el('div', 'xjc-row nowrap');
  row.append(el('div', 'nm xjc-grow', cur.name), btn('编辑', () => editCombo(cur), 'xjc-btn sm ghost'), btn('换一个 ›', pickCombo, 'xjc-btn sm'));
  card.append(row, comboChips(cur));
  box.appendChild(card);
}

/** 选小剧场：可搜索、按标签筛；点一行就设为当前 */
function pickCombo() {
  openSheet(`选小剧场（${state.combos.length}）`, (body, foot, closeIt) => {
    let q = '', tag = '';
    const curId = currentCombo()?.id;
    if (state.combos.length > 6) {
      const search = input('', '搜名字 / 标签');
      search.type = 'search';
      search.oninput = () => { q = search.value.trim().toLowerCase(); draw(); };
      body.appendChild(search);
    }
    const tags = allTags(state.combos);
    const chips = el('div', 'xjc-chips');
    chips.style.margin = '10px 0 4px';
    if (tags.length) body.appendChild(chips);
    const list = el('div', 'xjc-list');
    list.style.marginTop = '8px';
    body.appendChild(list);
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
      const shown = state.combos.filter(c => (!tag || (c.tags || []).includes(tag)) && (!q || (c.name + ' ' + (c.tags || []).join(' ')).toLowerCase().includes(q)));
      if (!shown.length) list.appendChild(el('div', 'xjc-empty', '没有匹配的小剧场'));
      for (const c of shown) {
        const on = c.id === curId;
        const it = itemRow(c.name, `${(c.tags || []).map(t => '#' + t).join(' ') || '无标签'} · ${c.plays || 0} 次${c.lastUsedAt ? ' · ' + fmtTime(c.lastUsedAt) : ''}`, () => {
          setSetting({ currentComboId: c.id }); closeIt(); renderPick();
        }, on ? '当前' : '');
        if (on) it.classList.add('on');
        it.appendChild(btn('编辑', e => { e.stopPropagation(); closeIt(); editCombo(c); }, 'xjc-btn sm ghost'));
        list.appendChild(it);
      }
    };
    drawTags();
    draw();
    foot.appendChild(btn('＋ 新建小剧场', () => { closeIt(); editCombo(null); }, 'xjc-btn'));
  });
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
  const h3 = el('h3', '', result.title || snap.comboName || '无题');
  hd.appendChild(h3);
  if (!pending) {
    // 和 Float 一样：右上角就是全屏，点标题也行
    hd.appendChild(btn('⤢ 全屏', () => viewResult(result), 'xjc-btn sm ghost xjc-fs'));
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
    const favBtn = btn(isFavorite(result) ? '♥ 已收藏' : '♡ 收藏', () => {
      const on = toggleFavorite(result);
      favBtn.textContent = on ? '♥ 已收藏' : '♡ 收藏';
      renderRecent();
    }, 'xjc-btn');
    ops.appendChild(favBtn);
    ops.appendChild(btn('挂到聊天', async () => {
      try { const at = await attachToLatest(result); toast(`已挂到第 ${at} 楼下面`, 'success'); } catch (e) { fail(e); }
    }, 'xjc-btn xjc-attach'));
    ops.appendChild(btn('复制', async () => toast((await copyText(`${result.title}\n\n${resultPlainText(result)}`)) ? '已复制正文' : '复制失败'), 'xjc-btn ghost'));
    ops.appendChild(btn('ⓘ', () => openSheet('这一篇用了什么', b => {
      b.appendChild(snapshotInfo(result));
      b.appendChild(el('div', 'xjc-sec', '发给模型的内容'));
      b.appendChild(requestView(result));
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
  let phase = `${currentChar()?.name || '角色'} 正在演《${combo.name}》`;
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
    if (c) { c.plays = (c.plays || 0) + 1; c.lastUsedAt = result.createdAt; save('combos'); }
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
    const cur = c.id === state.settings.currentComboId;
    list.appendChild(itemRow(`${c.name}${cur ? ' · 当前' : ''}`, `${(c.tags || []).map(t => '#' + t).join(' ')} ${n} 条提示词 · ${c.channel === 'preset' ? '走酒馆预设' : contextLabel(c.context)}`, () => editCombo(c), `权重 ${c.weight ?? 1} · ${c.plays || 0} 次${c.lastUsedAt ? ' · ' + fmtTime(c.lastUsedAt) : ''}`));
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
  for (const p of state.preambles) { const used = state.combos.filter(c => c.preambleId === p.id).length; list.appendChild(itemRow(p.name, p.content.replace(/\s+/g, ' ').slice(0, 70), () => editText('preambles', p), [p.id === state.settings.defaultPreambleId ? '默认' : '', used ? `${used} 个小剧场在用` : ''].filter(Boolean).join(' · '))); }
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
        if (isPre && state.preambles.length <= 1) { toast('至少留一条前置要求'); return; }
        const used = kind !== 'randoms' ? state.combos.filter(x => (isPre ? x.preambleId === row.id : (x.promptIds || []).includes(row.id))).map(x => x.name) : [];
        const warn = isPre ? `「${used.join('、')}」在用它，删了之后它们改用第一条前置。确定删除？` : `「${used.join('、')}」在用它，删了这些小剧场里就少了这一条。确定删除？`;
        if (!(await confirmSheet('删除', used.length ? warn : '确定删除？', '删除', true))) return;
        await remove(kind, row.id);
        if (used.length) {
          const fb = state.preambles[0]?.id || '';
          for (const x of state.combos) {
            if (isPre && x.preambleId === row.id) x.preambleId = fb;
            if (!isPre) x.promptIds = (x.promptIds || []).filter(id => id !== row.id);
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
    context: { chat: s.defaultChat === 'none' ? 'none' : 'recent', rounds: Number(s.defaultRounds) || 12, worldInfo: s.defaultWorldInfo !== false, summary: s.defaultSummary !== false },
    who: s.defaultWho || 'persona', whoText: '', api: '', weight: 1, channel: s.defaultChannel === 'preset' ? 'preset' : 'own', writeBack: !!s.writeBackDefault,
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
    body.append(field('随机池', rc, `池里共 ${state.randoms.length} 条`), field('只抽', tagPick('include'), '点选标签；都不选 = 全池'), field('排除', tagPick('exclude'), '带这些标签的不抽'));

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
    const ctxBox = el('div');
    body.appendChild(field('通道', seg([{ v: 'own', l: '插件自己拼' }, { v: 'preset', l: '走酒馆预设' }], d.channel === 'preset' ? 'preset' : 'own', v => { d.channel = v; ctxBox.hidden = v === 'preset'; }),
      '自己拼：只带下面勾的材料，不带酒馆预设里的破限/文风。走酒馆预设：用酒馆的完整生成流程（预设、角色卡、世界书、聊天记录都由酒馆拼），只对「跟随酒馆当前 API」有效，不能边写边显示。'));
    body.appendChild(ctxBox);
    ctxBox.hidden = d.channel === 'preset';
    const ctxPush = (...nodes) => ctxBox.append(...nodes);
    const rounds = input(d.context.rounds, '', 'number');
    const roundsF = field('带几轮', rounds, '一轮 = 你一句 + TA 一句');
    ctxPush(field('聊天记录', seg([{ v: 'recent', l: '最近 N 轮' }, { v: 'none', l: '不带' }], d.context.chat, v => { d.context.chat = v; roundsF.hidden = v !== 'recent'; })));
    ctxPush(roundsF);
    roundsF.hidden = d.context.chat !== 'recent';
    const wi = toggle('带世界书（按聊天内容激活，和酒馆一样）', d.context.worldInfo);
    const sm = toggle('带剧情总结（酒馆「总结」扩展的内容）', d.context.summary);
    ctxPush(wi, sm);
    const wb = toggle('写回记忆：生成后把梗概写成一条世界书条目，放进这个聊天绑定的世界书（没有就新建一本）', d.writeBack);
    if (S().writeBackFeature) body.appendChild(wb);
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
      random: { count: Number(rc.value) || 0, include: [...(d.random.include || [])], exclude: [...(d.random.exclude || [])] },
      output: { ...d.output, length: lenSel.value, customChars: Math.max(50, Number(custom.value) || 900), style: styleSel.value, wrapTag: wrap.value.trim().replace(/[^\w-]/g, ''), staged: stagedT.input.checked },
      context: { ...d.context, rounds: Math.max(1, Math.min(100, Number(rounds.value) || 12)), worldInfo: wi.input.checked, summary: sm.input.checked },
      whoText: whoText.value.trim(), api: api.value, weight: Math.max(0, Number(weight.value) || 0),
      channel: d.channel === 'preset' ? 'preset' : 'own', writeBack: wb.input.checked,
    });
    if (row) {
      foot.appendChild(btn('删除', async () => {
        if (!(await confirmSheet('删除小剧场', `删除「${row.name}」？收藏里按它生成的作品不受影响。`, '删除', true))) return;
        remove('combos', row.id);
        closeIt(); renderLibrary(); renderPick();
      }, 'xjc-btn danger'));
      foot.appendChild(btn('导出', () => saveFile(JSON.stringify(exportCombo(collect()), null, 2), `小剧场-${row.name}.json`), 'xjc-btn ghost'));
      foot.appendChild(btn('复制一份', () => { const c = collect(); upsert('combos', { ...c, id: uid('c'), name: c.name + ' 副本', plays: 0, lastUsedAt: '' }); closeIt(); renderLibrary(); }, 'xjc-btn ghost'));
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
      const shown = state.prompts.filter(x => (!filter || (x.tags || []).includes(filter)) && (!q || (x.title + x.content).toLowerCase().includes(q)));
      if (!shown.length) list.appendChild(el('div', 'xjc-empty', '没有匹配的提示词'));
      for (const p of shown) {
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
    body.appendChild(el('p', 'xjc-hint', '① 粘贴文本：每条用一行「## 标题 #标签 #标签」开头，下面是内容，可以一次贴很多条。② 选文件：本插件导出的、Float 小剧场 APP 导出的直接进库；暗柜「夜间档案」每份变成两条提示词 + 一个小剧场；其它 JSON（酒馆预设、世界书、角色卡、别人的生成器）会把里面像提示词的段落列出来让你挑。'));
    const ta = textarea('', 8, '## 雨夜便利店 #场景 #日常\n写{{char}}在深夜便利店……\n\n## 弹幕流 #形式 #前端\n输出一段带弹幕滚动的 HTML……');
    body.appendChild(ta);
    let kind = 'prompts';
    const asCombo = toggle('每条同时建成一个小剧场（直接能在舞台上选）', false);
    body.appendChild(field('文本导成', seg([{ v: 'prompts', l: '提示词' }, { v: 'preambles', l: '前置要求' }, { v: 'randoms', l: '随机条目' }], kind, v => { kind = v; asCombo.hidden = v !== 'prompts'; })));
    body.appendChild(asCombo);
    const importRows = async rows => {
      const made = await addRows(kind, rows);
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
    body.appendChild(field('导成', seg([{ v: 'prompts', l: '提示词' }, { v: 'preambles', l: '前置要求' }, { v: 'randoms', l: '随机条目' }], kind, v => { kind = v; tagF.hidden = v === 'preambles'; })));
    body.appendChild(tagF);
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
      await addRows(kind, found.filter((f, i) => picked.has(i)).map(f => ({ title: f.name, content: f.content, tags: [...tags] })));
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
  const list = el('div', 'xjc-list');
  list.style.marginTop = '12px';
  const shown = [...state.favorites].reverse().filter(r => favFilter === 'all' || (favFilter === 'html' ? kindOf(r) !== 'text' : kindOf(r) === 'text'));
  if (!shown.length) list.appendChild(el('div', 'xjc-empty', '这一类还没有收藏。'));
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
  box.appendChild(el('div', 'xjc-sec', '新建小剧场的默认值'));
  const roundsIn = input(S().defaultRounds, '', 'number');
  roundsIn.onchange = () => setSetting({ defaultRounds: Math.max(1, Math.min(100, Number(roundsIn.value) || 12)) });
  const roundsF = field('带几轮', roundsIn);
  box.appendChild(field('我在戏里是谁', seg([{ v: 'persona', l: '我的人设' }, { v: 'custom', l: '自定身份' }, { v: 'none', l: '旁观' }], S().defaultWho || 'persona', v => setSetting({ defaultWho: v }))));
  box.appendChild(field('通道', seg([{ v: 'own', l: '插件自己拼' }, { v: 'preset', l: '走酒馆预设' }], S().defaultChannel || 'own', v => setSetting({ defaultChannel: v }))));
  box.appendChild(field('聊天记录', seg([{ v: 'recent', l: '最近 N 轮' }, { v: 'none', l: '不带' }], S().defaultChat || 'recent', v => { setSetting({ defaultChat: v }); roundsF.hidden = v !== 'recent'; })));
  box.appendChild(roundsF);
  roundsF.hidden = (S().defaultChat || 'recent') !== 'recent';
  box.appendChild(toggle('带世界书', S().defaultWorldInfo !== false, v => setSetting({ defaultWorldInfo: v })));
  box.appendChild(toggle('带剧情总结', S().defaultSummary !== false, v => setSetting({ defaultSummary: v })));
  if (S().writeBackFeature) box.appendChild(toggle('写回记忆（写进聊天的世界书）', !!S().writeBackDefault, v => setSetting({ writeBackDefault: v })));
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
  box.appendChild(el('p', 'xjc-hint', '可选功能，默认关闭。打开后小剧场可以挂在聊天楼层下面：用到截至那条消息的聊天记录，只是给你看的，不会发给模型、不影响后续聊天。存在那条消息里，换一个回复（swipe）就跟着换。'));
  const more = el('div');
  box.appendChild(toggle('在楼层里显示小剧场', t.enabled, v => { put({ enabled: v }); more.hidden = !v; document.dispatchEvent(new CustomEvent('xjc-settings')); }));
  box.appendChild(more);
  more.hidden = !t.enabled;
  box = more;
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
      foot.appendChild(btn('删除', async () => {
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

