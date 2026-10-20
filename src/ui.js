// 表单控件、面板内抽屉、确认框、全屏查看器
import { el, btn, esc, fmtTime, copyText, toast } from './util.js';
import { mountFrame, markTheme } from './frame.js';
import { segmentsOf, contextLabel, KIND_LABEL, kindOf, charCount } from './gen.js';
import { targetLabel } from './host.js';

export function field(label, control, hint) {
  // 只有单个输入框才用 <label>；包着一排按钮时点标题会误触第一个按钮
  const w = el(/^(INPUT|SELECT|TEXTAREA)$/.test(control.tagName) ? 'label' : 'div', 'xjc-field');
  w.appendChild(el('span', 'lb', label));
  w.appendChild(control);
  if (hint) w.appendChild(el('p', 'xjc-hint', hint));
  return w;
}
export function input(value, ph, type = 'text') {
  const i = el('input');
  i.type = type;
  i.value = value ?? '';
  if (ph) i.placeholder = ph;
  i.autocomplete = 'off';
  i.spellcheck = false;
  return i;
}
export function textarea(value, rows = 5, ph) {
  const t = el('textarea');
  t.value = value ?? '';
  t.rows = rows;
  if (ph) t.placeholder = ph;
  return t;
}
export function select(options, value) {
  const s = el('select');
  for (const o of options) {
    const op = el('option', '', o.l);
    op.value = o.v;
    s.appendChild(op);
  }
  s.value = value;
  if (s.value !== value && options.length) s.value = options[0].v;
  return s;
}
export function toggle(label, checked, onChange) {
  const w = el('label', 'xjc-toggle');
  const c = el('input');
  c.type = 'checkbox';
  c.checked = !!checked;
  if (onChange) c.addEventListener('change', () => onChange(c.checked));
  w.append(c, el('span', '', label));
  w.input = c;
  return w;
}
/** 分段选择：options [{v,l}]，返回节点，node.value 读当前值 */
export function seg(options, value, onChange) {
  const w = el('div', 'xjc-seg');
  w.value = value;
  for (const o of options) {
    const b = el('button', o.v === value ? 'on' : '', o.l);
    b.type = 'button';
    b.addEventListener('click', () => {
      w.value = o.v;
      w.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      onChange?.(o.v);
    });
    w.appendChild(b);
  }
  return w;
}
export const tagsToText = tags => (tags || []).join(' ');
export const textToTags = text => [...new Set(String(text || '').split(/[\s,，、#]+/).map(s => s.trim()).filter(Boolean))].slice(0, 20);

// ── 抽屉（挂在面板里，可叠） ──
let sheetHost = null;
const sheets = [];
export function setSheetHost(node) { sheetHost = node; }
/**
 * build(body, footer, close) 填内容；返回 close
 */
export function openSheet(title, build, onClose) {
  const host = sheetHost || document.body;
  const mask = el('div', 'xjc-sheet-mask');
  const box = el('div', 'xjc-sheet');
  const hd = el('div', 'xjc-sheet-hd');
  hd.appendChild(el('h3', '', title));
  const body = el('div', 'xjc-sheet-bd');
  const foot = el('div', 'xjc-sheet-ft');
  const close = () => {
    mask.remove(); box.remove();
    const i = sheets.indexOf(close);
    if (i >= 0) sheets.splice(i, 1);
    onClose?.();
  };
  const x = el('button', 'xjc-x', '✕');
  x.type = 'button';
  x.setAttribute('aria-label', '关闭');
  x.onclick = close;
  hd.appendChild(x);
  mask.onclick = close;
  box.append(hd, body, foot);
  host.append(mask, box);
  sheets.push(close);
  build(body, foot, close);
  if (!foot.children.length) foot.remove();
  return close;
}
export function closeAllSheets() { while (sheets.length) sheets[sheets.length - 1](); }
export function hasSheet() { return sheets.length > 0; }
export function closeTopSheet() { if (sheets.length) { sheets[sheets.length - 1](); return true; } return false; }

export function confirmSheet(title, text, okLabel = '确定', danger = false) {
  return new Promise(resolve => {
    let answer = false;
    openSheet(title, (body, foot, close) => {
      body.appendChild(el('p', '', text));
      foot.append(
        btn('取消', close, 'xjc-btn ghost'),
        btn(okLabel, () => { answer = true; close(); }, danger ? 'xjc-btn danger' : 'xjc-btn pri'),
      );
    }, () => resolve(answer));
  });
}

// ── 这一篇用了什么 ──
export function snapshotInfo(result) {
  const s = result.snapshot || {};
  const dl = el('dl', 'xjc-kv');
  const row = (k, v) => { if (!v) return; dl.append(el('dt', '', k), el('dd', '', v)); };
  row('小剧场', s.comboName);
  if (s.follow) row(s.follow.mode === 'ask' ? '追问' : '接着写', `《${s.follow.of || '上一篇'}》`);
  row('前置', s.preambleName);
  row('提示词', (s.prompts || []).join('、'));
  for (const pt of s.parts || []) row(`${pt.name || '随机段'}（${pt.of} 条里抽）`, (pt.used || []).join('、'));
  row(s.randomsForced ? '随机（有指定的）' : '随机附加', (s.randoms || []).join('、'));
  row('输出', `${KIND_LABEL[kindOf(result)]} · 篇幅 ${s.length || '不限'}${s.staged ? ' · 分两步' : ''}`);
  row('上下文', contextLabel(s.context));
  row('通道', result.channelNote);
  row('身份', s.who === 'custom' ? '自定身份' : s.who === 'none' ? '旁观' : '用户人设');
  row('出口', `${targetLabel(result.target)}${result.model ? ' · ' + result.model : ''}`);
  if (s.follow?.ask) row('要求', s.follow.ask);
  if (s.extra) row('追加', s.extra.length > 120 ? s.extra.slice(0, 120) + '…' : s.extra);
  row('时间', `${fmtTime(result.createdAt)} · ${charCount(result)} 字`);
  return dl;
}

// ── 这一篇实际发给模型的内容 ──
const STEP_LABEL = { shell: '第一步 · 页面骨架', fill: '第二步 · 填字', text: '' };
const ROLE_LABEL = { system: 'system', user: 'user', assistant: 'assistant', prompt: '整段提示词' };
export function requestText(result) {
  return (result.request || []).map(r => [STEP_LABEL[r.kind] ? `===== ${STEP_LABEL[r.kind]} =====` : '', ...r.messages.map(m => `[${ROLE_LABEL[m.role] || m.role}]\n${m.content}`)].filter(Boolean).join('\n\n')).join('\n\n');
}
export function requestView(result) {
  const box = el('div', 'xjc-req');
  const reqs = Array.isArray(result?.request) ? result.request.filter(r => r && Array.isArray(r.messages)) : [];
  if (!reqs.length) {
    box.appendChild(el('p', 'xjc-hint', '这一篇没有记录发送内容（更新前生成的，或者挂在楼层里的——楼层里不存这份，免得聊天文件变大）。'));
    return box;
  }
  for (const r of reqs) {
    if (reqs.length > 1 && STEP_LABEL[r.kind]) box.appendChild(el('div', 'xjc-req-step', STEP_LABEL[r.kind]));
    if (r.via === 'preset') box.appendChild(el('p', 'xjc-hint', r.partial
      ? '走酒馆预设：没抓到酒馆拼好的完整内容，下面只是插件补的前置和 <Brief>；酒馆还会按预设加上角色卡、世界书、聊天记录。'
      : '走酒馆预设：下面是酒馆按预设拼好、实际发出去的内容。'));
    for (const m of r.messages) {
      const d = el('details', 'xjc-req-msg');
      const n = String(m.content || '').length;
      const sum = el('summary');
      sum.append(el('b', '', ROLE_LABEL[m.role] || m.role), el('span', '', ` · ${n} 字 · ${String(m.content || '').replace(/\s+/g, ' ').slice(0, 40)}${n > 40 ? '…' : ''}`));
      d.append(sum, el('pre', 'xjc-pre', m.content || ''));
      // 用户能改的部分（<Brief>）默认展开，材料很长默认收起
      if (m.role === 'user' && r.messages.length > 1) d.open = true;
      box.appendChild(d);
    }
  }
  box.appendChild(btn('复制发送内容', async () => toast((await copyText(requestText(result))) ? '已复制发送内容' : '复制失败'), 'xjc-btn sm'));
  return box;
}

// ── 全屏查看器（面板和聊天共用） ──
let viewer = null;
export function openViewer(result, { actions = [], onAction } = {}) {
  closeViewer();
  const root = el('div', 'xjc-viewer');
  root.dataset.ttMobileSurface = 'backdrop';
  markTheme(root);
  const bar = el('div', 'xjc-viewer-bar');
  bar.appendChild(btn('‹ 返回', closeViewer, 'xjc-btn ghost sm'));
  bar.appendChild(el('div', 'ttl', result.title || '小剧场'));
  const info = el('div', 'xjc-viewer-info');
  info.hidden = true;
  info.appendChild(snapshotInfo(result));
  info.appendChild(el('div', 'xjc-sec', '发给模型的内容'));
  info.appendChild(requestView(result));
  bar.appendChild(btn('ⓘ', () => { info.hidden = !info.hidden; }, 'xjc-btn ghost sm'));
  for (const a of actions) {
    const b = btn(a.label, async () => { const keep = await a.run(result, b); if (!keep) closeViewer(); }, 'xjc-btn sm');
    if (a.title) b.title = a.title;
    bar.appendChild(b);
  }
  const body = el('div', 'xjc-viewer-body');
  root.append(bar, body, info, el('div', 'xjc-viewer-foot'));
  document.body.appendChild(root);
  mountFrame(body, segmentsOf(result), { fill: true, onAction: onAction ? text => { closeViewer(); onAction(text); } : null });
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); closeViewer(); } };
  document.addEventListener('keydown', onKey, true);
  viewer = { root, onKey };
}
export function closeViewer() {
  if (!viewer) return;
  document.removeEventListener('keydown', viewer.onKey, true);
  viewer.root.remove();
  viewer = null;
}
export const viewerOpen = () => !!viewer;
export { esc };
