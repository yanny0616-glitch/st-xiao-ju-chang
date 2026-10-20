// 小工具：DOM、转义、id、提示
export const ctx = () => SillyTavern.getContext();
export const isTT = () => Boolean(window.__TAURITAVERN__);

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
export function btn(label, onClick, cls) {
  const b = el('button', cls || 'xjc-btn', label);
  b.type = 'button';
  if (onClick) b.addEventListener('click', onClick);
  return b;
}
export const uid = (p = 'x') => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
export const clone = v => (v == null ? v : JSON.parse(JSON.stringify(v)));
export const byId = (list, id) => (id ? list.find(x => x.id === id) : undefined) || null;

export function toast(msg, kind = 'info') {
  if (window.toastr) window.toastr[kind]?.(msg, '小剧场');
  else console.log('[小剧场]', msg);
}
export function fail(e) {
  console.error('[小剧场]', e);
  toast(e?.message || String(e), 'error');
}
export function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = n => String(n).padStart(2, '0');
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay ? `今天 ${p(d.getHours())}:${p(d.getMinutes())}` : `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
export const plain = html => String(html)
  .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, '')
  .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>|<\/h\d>/gi, '\n')
  .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = el('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
    return ok;
  }
}

/** 下载文件：优先用酒馆自己的 download()，TauriTavern 在 iOS/Android 上会接管成系统保存面板 */
export async function saveFile(text, name, type = 'application/json') {
  try {
    const utils = await import('/scripts/utils.js');
    if (typeof utils.download === 'function') { await utils.download(text, name, type); return; }
  } catch (e) { console.warn('[小剧场] 酒馆 download 不可用，改用浏览器下载', e); }
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function pickFile(accept = '.json,.txt,application/json,text/plain') {
  return new Promise((resolve, reject) => {
    const input = el('input');
    input.type = 'file'; input.accept = accept;
    input.style.display = 'none';
    input.addEventListener('change', async () => {
      const f = input.files && input.files[0];
      input.remove();
      if (!f) return resolve(null);
      try { resolve({ name: f.name, text: await f.text() }); } catch (e) { reject(e); }
    });
    document.body.appendChild(input);
    input.click();
  });
}
