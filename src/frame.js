// 渲染：AI 写的 HTML/JS 整块放进沙盒 iframe（没有 allow-same-origin，拿不到酒馆的页面、存储和密钥）；
// 纯文字也进同一种 iframe，颜色跟酒馆主题或选定的画布
import { esc } from './util.js';
import { state } from './store.js';

const frames = new Map();
let seq = 0;
const LINE_HEIGHTS = { tight: 1.45, mid: 1.6, loose: 1.8 };

window.addEventListener('message', e => {
  const d = e.data;
  if (!d || d.source !== 'xjc-frame' || !frames.has(d.id)) return;
  const entry = frames.get(d.id);
  const f = entry.iframe;
  if (!f.isConnected) { frames.delete(d.id); return; }
  if (e.source !== f.contentWindow) return;
  if (d.type === 'resize' && Number.isFinite(d.height) && !entry.fill) {
    f.style.height = `${Math.max(60, Math.min(20000, Math.ceil(d.height)))}px`;
  }
  if (d.type === 'action' && entry.onAction) {
    const text = typeof d.text === 'string' ? d.text.trim().slice(0, 200) : '';
    if (text && f.offsetParent !== null) entry.onAction(text);
  }
});

// ── 颜色 ──
function parseColor(str) {
  const m = String(str || '').match(/rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+%?))?\s*\)/i);
  if (m) {
    let a = m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { r: +m[1], g: +m[2], b: +m[3], a };
  }
  const h = String(str || '').trim().match(/^#([0-9a-f]{3,8})$/i);
  if (h) {
    let x = h[1];
    if (x.length <= 4) x = [...x].map(c => c + c).join('');
    return { r: parseInt(x.slice(0, 2), 16), g: parseInt(x.slice(2, 4), 16), b: parseInt(x.slice(4, 6), 16), a: x.length === 8 ? parseInt(x.slice(6, 8), 16) / 255 : 1 };
  }
  return null;
}
const lum = c => (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
const rgb = c => `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`;
function over(top, bottom) {
  const a = top.a;
  return { r: top.r * a + bottom.r * (1 - a), g: top.g * a + bottom.g * (1 - a), b: top.b * a + bottom.b * (1 - a), a: 1 };
}

const CANVASES = {
  paper: { bg: '#f6f1e8', ink: '#24211d', acc: '#9a3b2e', line: '#ddd3c2' },
  night: { bg: '#16171c', ink: '#e6e3dc', acc: '#d8a657', line: '#33353d' },
};
export const CANVAS_LABEL = { theme: '跟随酒馆主题', paper: '纸张', night: '夜色' };

/** 酒馆主题色多半是半透明的，iframe 里要实色：叠在一块按文字明暗推出的底色上 */
export function themeTokens() {
  const s = state.settings;
  const size = Math.round(14 * (Number(s.fontScale) || 1) * 10) / 10;
  const lineHeight = LINE_HEIGHTS[s.lineHeight] || 1.6;
  const cs = getComputedStyle(document.documentElement);
  const font = (cs.getPropertyValue('--mainFontFamily') || getComputedStyle(document.body).fontFamily || 'sans-serif').trim().replace(/"/g, "'");
  if (CANVASES[s.canvas]) return { ...CANVASES[s.canvas], font, size, lineHeight };
  const ink = parseColor(cs.getPropertyValue('--SmartThemeBodyColor')) || { r: 220, g: 220, b: 210, a: 1 };
  const dark = lum(ink) > 0.5;
  const floor = dark ? { r: 22, g: 22, b: 26, a: 1 } : { r: 250, g: 249, b: 246, a: 1 };
  const tint = parseColor(cs.getPropertyValue('--SmartThemeBlurTintColor'));
  const bg = tint ? over(tint, floor) : floor;
  const accC = parseColor(cs.getPropertyValue('--SmartThemeQuoteColor'));
  const lineC = parseColor(cs.getPropertyValue('--SmartThemeBorderColor'));
  return {
    bg: rgb(bg), ink: rgb({ ...ink, a: 1 }),
    acc: accC ? rgb(accC) : (dark ? '#e0a96d' : '#9a3b2e'),
    line: lineC ? rgb(over(lineC, bg)) : (dark ? '#3a3a40' : '#d9d4c8'),
    font, size, lineHeight,
  };
}

export function textToHtml(text) {
  return String(text).split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
}

function frameDoc(segments, id, fill) {
  const t = themeTokens();
  const body = segments.map(s => (s.type === 'html' ? `<div class="xjc-html">${s.content}</div>` : `<article class="xjc-text">${textToHtml(s.content)}</article>`)).join('\n');
  const script = 'script';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
:root{--xjc-bg:${t.bg};--xjc-ink:${t.ink};--xjc-acc:${t.acc};--xjc-line:${t.line};--xjc-font:${t.font}}
html,body{margin:0;padding:0;background:var(--xjc-bg);color:var(--xjc-ink);font-family:var(--xjc-font);font-size:${t.size}px;line-height:${t.lineHeight};-webkit-text-size-adjust:100%}
#xjc-content{display:flow-root;padding:${fill ? '14px 16px 48px' : '12px 14px'}}
*{box-sizing:border-box}img,video,canvas,svg,iframe{max-width:100%}
.xjc-text p{margin:0 0 .9em;text-align:justify;word-break:break-word}
.xjc-text p:last-child{margin-bottom:0}
.xjc-text+.xjc-html,.xjc-html+.xjc-text,.xjc-html+.xjc-html{margin-top:16px}
.xjc-html{max-width:100%;overflow-x:auto}
[data-slot]:empty{display:inline-block;min-width:4em;min-height:1em;vertical-align:middle;border-radius:3px;background:linear-gradient(90deg,transparent 20%,var(--xjc-line) 50%,transparent 80%) 0 0/200% 100%;animation:xjc-sh 1.4s linear infinite;opacity:.7}
@keyframes xjc-sh{to{background-position:-200% 0}}
.xjc-text.writing p:last-child::after{content:"▍";margin-left:1px;color:var(--xjc-acc);animation:xjc-bl 1s steps(2) infinite}
@keyframes xjc-bl{50%{opacity:0}}
</style></head><body><div id="xjc-content">${body}</div>
<${script}>(function(){var id=${JSON.stringify(id)};var content=document.getElementById("xjc-content");function h(){return Math.max(content.scrollHeight,content.getBoundingClientRect().height)}var last=0;function send(){var v=h();if(Math.abs(v-last)>1){last=v;parent.postMessage({source:"xjc-frame",type:"resize",id:id,height:v},"*")}}
if(window.ResizeObserver){new ResizeObserver(send).observe(content)}window.addEventListener("load",send);setInterval(send,700);send();
window.addEventListener("message",function(e){var d=e.data;if(e.source!==parent||!d||d.source!=="xjc-parent"||d.id!==id)return;if(d.type==="reading"){document.body.style.fontSize=d.size+"px";document.body.style.lineHeight=d.lineHeight;send()}if(d.type==="text"&&typeof d.html==="string"){content.innerHTML=d.html;send()}if(d.type==="fill"&&d.slots){Object.keys(d.slots).forEach(function(k){var t=String(d.slots[k]).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]}).replace(/&lt;br\\s*\\/?&gt;/gi,"<br>").replace(/\\n/g,"<br>");document.querySelectorAll('[data-slot="'+k+'"]').forEach(function(n){n.innerHTML=t})});send()}});
document.addEventListener("click",function(e){var a=e.target&&e.target.closest?e.target.closest("[data-action]"):null;if(a){parent.postMessage({source:"xjc-frame",type:"action",id:id,text:a.getAttribute("data-action")||a.textContent||""},"*")}});})();</${script}>
</body></html>`;
}

/**
 * 挂一个 iframe。opts: { fill: 是否铺满容器（全屏），onAction(text) }
 * 返回 handle：{ iframe, stream(segments, writing), fillSlots(map), destroy() }
 */
export function mountFrame(container, segments, opts = {}) {
  for (const [k, v] of frames) if (!v.iframe.isConnected) frames.delete(k);
  const id = `f${++seq}`;
  const iframe = document.createElement('iframe');
  iframe.className = 'xjc-frame';
  iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals allow-popups');
  iframe.setAttribute('referrerpolicy', 'no-referrer');
  iframe.title = '小剧场';
  if (opts.fill) iframe.classList.add('fill');
  iframe.srcdoc = frameDoc(segments, id, !!opts.fill);
  const entry = { iframe, onAction: opts.onAction, fill: !!opts.fill };
  frames.set(id, entry);
  container.appendChild(iframe);
  const post = msg => { try { iframe.contentWindow?.postMessage({ source: 'xjc-parent', id, ...msg }, '*'); } catch { /* ignore */ } };
  return {
    iframe,
    stream(segs, writing) {
      post({ type: 'text', html: segs.map(s => `<article class="xjc-text${writing ? ' writing' : ''}">${textToHtml(s.content)}</article>`).join('\n') });
    },
    fillSlots(map) { post({ type: 'fill', slots: map }); },
    setAction(fn) { entry.onAction = fn; },
    destroy() { frames.delete(id); iframe.remove(); },
  };
}

/** 改了字号/行距：送进所有开着的 iframe，不重载，保留交互状态 */
export function updateReading() {
  const t = themeTokens();
  for (const [id, entry] of frames) {
    if (!entry.iframe.isConnected) { frames.delete(id); continue; }
    try { entry.iframe.contentWindow?.postMessage({ source: 'xjc-parent', type: 'reading', id, size: t.size, lineHeight: t.lineHeight }, '*'); } catch { /* ignore */ }
  }
}
