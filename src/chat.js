// 聊天里的小剧场：消息菜单里的面具按钮、AI 回复后自动出、挂在消息下面显示。
// 存在 message.extra.xjc（跟着 swipe 走），不进 mes 正文，所以不会发给模型
import { ctx, el, uid, byId, toast, fail, copyText } from './util.js';
import { state } from './store.js';
import { generateTheater, weightedRandomCombo, aiPickCombo, continueExtra, resultPlainText, KIND_LABEL, kindOf } from './gen.js';
import { mountFrame } from './frame.js';
import { openViewer } from './ui.js';
import { currentChar } from './host.js';
import { isFavorite, toggleFavorite } from './favs.js';

const running = new Map(); // message 对象 → { ctrl }
const collapsed = new Set(); // 收起的小剧场 id（只在这次打开里记）
const opened = new Set(); // 默认收起时手动展开的

// ── 存 ──
function slim(result) {
  const { comboCopy, ...rest } = result;
  const copy = comboCopy ? { ...comboCopy } : null;
  if (copy) delete copy._dependencies;
  return { ...rest, comboCopy: copy };
}
async function pushTheater(msg, result) {
  const c = ctx();
  const idx = c.chat.indexOf(msg);
  if (idx < 0) {
    state.recent.unshift(result);
    toast('聊天已经换了，这篇放进了面板的「最近」');
    return -1;
  }
  msg.extra = msg.extra || {};
  msg.extra.xjc = [...(Array.isArray(msg.extra.xjc) ? msg.extra.xjc : []), slim(result)];
  await c.saveChat();
  renderTail(idx);
  return idx;
}

/** 面板里的「挂到聊天」：挂到最新一条 AI 回复（没有就最新一条消息） */
export async function attachToLatest(result) {
  const c = ctx();
  if (!currentChar()) throw new Error('先打开一个角色聊天。');
  let idx = -1;
  for (let i = c.chat.length - 1; i >= 0; i--) {
    const m = c.chat[i];
    if (m && !m.is_system) { if (idx < 0) idx = i; if (!m.is_user) { idx = i; break; } }
  }
  if (idx < 0) throw new Error('聊天里还没有消息。');
  const at = await pushTheater(c.chat[idx], { ...result, id: uid('r') });
  return at;
}

// ── 生成 ──
function pickCombo() {
  const t = state.settings.tail;
  if (t.pick === 'ai') return aiPickCombo();
  if (t.pick === 'combo') return byId(state.combos, t.comboId) || weightedRandomCombo();
  return weightedRandomCombo();
}
export async function generateFor(mesId, { combo, extra } = {}) {
  const c = ctx();
  const msg = c.chat[mesId];
  if (!msg || msg.is_system) return;
  if (running.has(msg)) { toast('这条下面的小剧场还在写'); return; }
  if (!currentChar()) { toast('先打开一个角色聊天'); return; }
  const use = combo || pickCombo();
  if (!use) { toast('还没有小剧场，先在面板的「库」里建一个'); return; }
  const ctrl = new AbortController();
  running.set(msg, { ctrl, name: use.name, t0: Date.now() });
  renderTail(mesId);
  const tail = '【接在聊天后面】这一篇挂在刚才这条消息下面，内容要和这条消息里刚发生的事有关，可以是它的番外、旁观视角或另一种呈现，但不要复述原文。';
  try {
    const result = await generateTheater(use, { uptoIndex: mesId, extra: [tail, extra].filter(Boolean).join('\n'), signal: ctrl.signal });
    if (!result || ctrl.signal.aborted) return;
    running.delete(msg);
    await pushTheater(msg, result);
  } catch (e) {
    if (!ctrl.signal.aborted) fail(new Error(`小剧场没写出来：${e.message || e}`));
  } finally {
    running.delete(msg);
    const idx = ctx().chat.indexOf(msg);
    if (idx >= 0) renderTail(idx);
  }
}

// ── 显示 ──
function mesEl(mesId) { return document.querySelector(`#chat .mes[mesid="${mesId}"]`); }

async function confirmDelete() {
  const c = ctx();
  try {
    if (c.callGenericPopup && c.POPUP_TYPE) return !!(await c.callGenericPopup('删除这篇小剧场？', c.POPUP_TYPE.CONFIRM));
  } catch { /* ignore */ }
  return window.confirm('删除这篇小剧场？');
}

function tailCard(mesId, theater) {
  const card = el('div', 'xjc-tail-card');
  card.dataset.id = theater.id;
  const hd = el('div', 'xjc-tail-hd');
  const ttl = el('div', 'ttl');
  ttl.innerHTML = '<b><i class="fa-solid fa-masks-theater"></i> 小剧场</b>';
  ttl.appendChild(document.createTextNode(theater.title || '无题'));
  ttl.appendChild(el('small', '', `${KIND_LABEL[kindOf(theater)]} · ${theater.snapshot?.comboName || ''}`));
  hd.appendChild(ttl);
  const body = el('div', 'xjc-tail-bd');
  const isOpen = () => (state.settings.tail.expanded ? !collapsed.has(theater.id) : opened.has(theater.id));
  const mount = () => {
    if (body.firstChild) return;
    mountFrame(body, theater.segments || [], { onAction: text => generateFor(currentIndex(), { combo: theater.comboCopy, extra: continueExtra(theater, text) }) });
  };
  const currentIndex = () => Number(card.closest('.mes')?.getAttribute('mesid') ?? mesId);
  const tb = (icon, title, fn) => {
    const b = el('button', 'xjc-tb');
    b.innerHTML = `<i class="${icon}"></i>`;
    b.type = 'button';
    b.title = title;
    b.addEventListener('click', e => { e.stopPropagation(); fn(b); });
    hd.appendChild(b);
    return b;
  };
  const heart = on => (on ? 'fa-solid fa-heart' : 'fa-regular fa-heart');
  tb('fa-solid fa-expand', '全屏', () => openViewer(theater, {
    actions: [
      { label: isFavorite(theater) ? '♥' : '♡', title: '收藏', run: (r, b) => { b.textContent = toggleFavorite(r) ? '♥' : '♡'; return true; } },
      { label: '复制', run: async r => { toast((await copyText(`${r.title}\n\n${resultPlainText(r)}`)) ? '已复制' : '复制失败'); return true; } },
    ],
    onAction: text => generateFor(currentIndex(), { combo: theater.comboCopy, extra: continueExtra(theater, text) }),
  }));
  tb('fa-solid fa-rotate-right', '再来一条（同一套）', () => generateFor(currentIndex(), { combo: theater.comboCopy || undefined }));
  const favBtn = tb(heart(isFavorite(theater)), '收藏', b => { const on = toggleFavorite(theater); b.innerHTML = `<i class="${heart(on)}"></i>`; b.classList.toggle('on', on); });
  favBtn.classList.toggle('on', isFavorite(theater));
  tb('fa-solid fa-trash-can', '删除', async () => {
    if (!(await confirmDelete())) return;
    const i = currentIndex();
    const m = ctx().chat[i];
    if (!m?.extra?.xjc) return;
    m.extra.xjc = m.extra.xjc.filter(t => t.id !== theater.id);
    await ctx().saveChat();
    renderTail(i);
  });
  hd.addEventListener('click', () => {
    const now = !isOpen();
    if (state.settings.tail.expanded) { if (now) collapsed.delete(theater.id); else collapsed.add(theater.id); }
    else if (now) opened.add(theater.id); else opened.delete(theater.id);
    body.hidden = !now;
    if (now) mount();
  });
  body.hidden = !isOpen();
  card.append(hd, body);
  if (!body.hidden) requestAnimationFrame(mount);
  return card;
}

export function renderTail(mesId) {
  const node = mesEl(mesId);
  if (!node) return;
  const m = ctx().chat[mesId];
  const list = (m?.extra?.xjc || []).filter(t => t && t.id);
  const job = m && running.get(m);
  let box = node.querySelector('.xjc-tail');
  if (!list.length && !job) { box?.remove(); return; }
  if (!box) {
    box = el('div', 'xjc-tail');
    const text = node.querySelector('.mes_text');
    if (text) text.after(box); else node.querySelector('.mes_block')?.appendChild(box);
  }
  // 已经挂着的 iframe 不重挂，保留交互状态
  const want = new Set(list.map(t => t.id));
  for (const card of [...box.querySelectorAll('.xjc-tail-card')]) if (!want.has(card.dataset.id)) card.remove();
  for (const t of list) if (!box.querySelector(`.xjc-tail-card[data-id="${CSS.escape(t.id)}"]`)) box.insertBefore(tailCard(mesId, t), box.querySelector('.xjc-tail-busy'));
  box.querySelector('.xjc-tail-busy')?.remove();
  if (job) {
    const b = el('div', 'xjc-tail-busy');
    b.append(el('i', 'xjc-spin'), el('span', 'xjc-grow', `正在写小剧场 · ${job.name}`));
    const cancel = el('button', 'xjc-tb', '取消');
    cancel.type = 'button';
    cancel.style.cssText = 'width:auto;padding:0 8px;border:0;background:transparent;color:inherit;cursor:pointer;opacity:.7';
    cancel.onclick = () => { job.ctrl.abort(); running.delete(m); renderTail(mesId); };
    b.appendChild(cancel);
    box.appendChild(b);
  }
}
export function renderAll() {
  const chat = ctx().chat || [];
  document.querySelectorAll('#chat .mes[mesid]').forEach(node => {
    const id = Number(node.getAttribute('mesid'));
    if (chat[id]?.extra?.xjc?.length || node.querySelector('.xjc-tail')) renderTail(id);
  });
}

// ── 接线 ──
function syncButton() {
  document.body.classList.toggle('xjc-no-mes-btn', !state.settings.tail.button);
}
function addButtonTo(container) {
  if (!container || container.querySelector('.xjc-mes-btn')) return;
  const b = el('div', 'mes_button xjc-mes-btn fa-solid fa-masks-theater interactable');
  b.title = '出一篇小剧场';
  b.tabIndex = 0;
  container.prepend(b);
}
export function initChat() {
  const c = ctx();
  const ev = c.eventTypes;
  addButtonTo(document.querySelector('#message_template .extraMesButtons'));
  document.querySelectorAll('#chat .mes .extraMesButtons').forEach(addButtonTo);
  const style = el('style');
  style.textContent = 'body.xjc-no-mes-btn .xjc-mes-btn{display:none!important}';
  document.head.appendChild(style);
  syncButton();
  document.addEventListener('xjc-settings', syncButton);
  document.addEventListener('click', e => {
    const b = e.target.closest?.('.xjc-mes-btn');
    if (!b) return;
    const id = Number(b.closest('.mes')?.getAttribute('mesid'));
    if (Number.isFinite(id)) generateFor(id);
  });
  const later = fn => (...args) => setTimeout(() => fn(...args), 0);
  c.eventSource.on(ev.CHAT_CHANGED, later(renderAll));
  c.eventSource.on(ev.MORE_MESSAGES_LOADED, later(renderAll));
  c.eventSource.on(ev.MESSAGE_DELETED, later(renderAll));
  for (const name of ['USER_MESSAGE_RENDERED', 'MESSAGE_SWIPED', 'MESSAGE_UPDATED', 'MESSAGE_EDITED']) {
    if (ev[name]) c.eventSource.on(ev[name], later(id => renderTail(Number(id))));
  }
  c.eventSource.on(ev.CHARACTER_MESSAGE_RENDERED, later((id, type) => {
    const mesId = Number(id);
    renderTail(mesId);
    const t = state.settings.tail;
    if (!t.auto || ['first_message', 'continue', 'impersonate'].includes(type)) return;
    const m = ctx().chat[mesId];
    if (!m || m.is_user || m.is_system || m.extra?.xjc?.length) return;
    if (Math.random() * 100 >= (Number(t.chance) || 0)) return;
    generateFor(mesId);
  }));
  renderAll();
}
