// 渲染：AI 写的 HTML/JS 整块放进沙盒 iframe（没有 allow-same-origin，拿不到酒馆的页面、存储和密钥）；
// 纯文字也进同一种 iframe，配色和字体跟小剧场主题（或选定的画布）
import { esc } from './util.js';
import { state } from './store.js';
import { byId } from './util.js';

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

const SANS = "-apple-system,'PingFang SC','Noto Sans CJK SC','Microsoft YaHei',sans-serif";
const MONO = "ui-monospace,Menlo,Consolas,'DejaVu Sans Mono','Noto Sans Mono CJK SC',monospace";
const COURIER = "'Courier Prime','Courier New',Courier,'Liberation Mono','Noto Sans Mono CJK SC',monospace";
const KAITI = "'Kaiti SC','STKaiti','KaiTi','BiauKai','AR PL UKai CN','Noto Serif CJK SC',serif";
/** 每套主题正文画布的颜色和字体 */
const THEME_CANVAS = {
  magazine: { bg: '#fbf8f2', ink: '#1c1a17', acc: '#8b2e2e', line: '#d9d1c3', font: SANS },
  sticky: { bg: '#f1ece2', ink: '#2b2622', acc: '#e0572f', line: '#d8cfc0', font: SANS },
  terminal: { bg: '#0f1411', ink: '#cfe7d4', acc: '#7ee787', line: '#213528', font: MONO },
  script: { bg: '#ffffff', ink: '#141414', acc: '#c0392b', line: '#dcdcd6', font: COURIER },
  night: { bg: '#171a22', ink: '#e6dfcf', acc: '#e3b465', line: '#2c3040', font: "'Songti SC','Noto Serif CJK SC','Noto Serif SC',Georgia,serif" },
  letter: { bg: '#fffaf6', ink: '#4a3b3b', acc: '#c4686b', line: '#efd9d0', font: KAITI },
  candy: { bg: '#fffafd', ink: '#4b3f5c', acc: '#ff5f9e', line: '#f6d5e6', font: SANS },
  xuan: { bg: '#f7f1e3', ink: '#2a2622', acc: '#b23a2a', line: '#d8ccb4', font: KAITI },
};
export const BUILTIN_THEMES = [...Object.keys(THEME_CANVAS), 'st'];
const CANVASES = {
  paper: { bg: '#f6f1e8', ink: '#24211d', acc: '#9a3b2e', line: '#ddd3c2' },
  night: { bg: '#16171c', ink: '#e6e3dc', acc: '#d8a657', line: '#33353d' },
};
export const CANVAS_LABEL = { theme: '跟主题', paper: '纸张', night: '夜色' };
/** 当前用的自定义主题（settings.theme = 'custom:<id>'），没有就 null */
export function activeCustom() {
  const t = String(state.settings.theme || '');
  return t.startsWith('custom:') ? byId(state.themes || [], t.slice(7)) : null;
}
/** 实际套用的内置主题：自定义主题套在它的「基于」上 */
export function themeName() {
  const c = activeCustom();
  const t = c ? c.base : state.settings.theme;
  return BUILTIN_THEMES.includes(t) ? t : 'magazine';
}
/** 给节点打上主题标记；面板、全屏、聊天卡片都用它 */
export function markTheme(node) {
  node.dataset.xjcTheme = themeName();
  const c = activeCustom();
  if (c) node.dataset.xjcCustom = c.id; else delete node.dataset.xjcCustom;
}
/** 自定义主题的面板 CSS 放进 <head>，切走就撤掉 */
function syncCustomStyle() {
  let st = document.getElementById('xjc-custom-css');
  const c = activeCustom();
  if (!c || !c.css) { st?.remove(); return; }
  if (!st) { st = document.createElement('style'); st.id = 'xjc-custom-css'; document.head.appendChild(st); }
  if (st.textContent !== c.css) st.textContent = c.css;
}
let probe = null;
/** 读自定义主题里写的 --xjc-canvas-* 变量 */
function canvasOverrides() {
  if (!activeCustom()) return {};
  if (!probe) { probe = document.createElement('div'); probe.className = 'xjc-probe'; probe.hidden = true; document.body.appendChild(probe); }
  markTheme(probe);
  const cs = getComputedStyle(probe);
  const out = {};
  for (const k of ['bg', 'ink', 'acc', 'line', 'font']) { const v = cs.getPropertyValue(`--xjc-canvas-${k}`).trim(); if (v) out[k] = v.replace(/"/g, "'"); }
  return out;
}

export function themeTokens() {
  const s = state.settings;
  const size = Math.round(14 * (Number(s.fontScale) || 1) * 10) / 10;
  const lineHeight = LINE_HEIGHTS[s.lineHeight] || 1.6;
  const theme = themeName();
  const cs = getComputedStyle(document.documentElement);
  const stFont = (cs.getPropertyValue('--mainFontFamily') || getComputedStyle(document.body).fontFamily || 'sans-serif').trim().replace(/"/g, "'");
  const base = THEME_CANVAS[theme];
  const font = base ? base.font : stFont;
  const css = activeCustom()?.canvasCss || '';
  const over = canvasOverrides();
  if (CANVASES[s.canvas]) return { ...CANVASES[s.canvas], font: over.font || font, size, lineHeight, theme, css };
  if (base) return { ...base, ...over, size, lineHeight, theme, css };
  // 「酒馆」主题：酒馆主题色多半是半透明的，iframe 里要实色，叠在一块按文字明暗推出的底色上
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
    font, size, lineHeight, theme, css, ...over,
  };
}

export function textToHtml(text) {
  return String(text).split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
}

function frameDoc(segments, id, fill) {
  const t = themeTokens();
  const body = segments.map(s => (s.type === 'html' ? `<div class="xjc-html">${s.content}</div>` : `<article class="xjc-text">${textToHtml(s.content)}</article>`)).join('\n');
  const script = 'script';
  const userCss = String(t.css || '').replace(/<\/style/gi, '<\\/style');
  return `<!doctype html><html data-t="${t.theme}"${state.settings.motion === false ? ' data-motion="off"' : ''}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
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
html[data-t=magazine] .xjc-text:first-child p:first-child::first-letter{float:left;font-family:'Songti SC','Noto Serif CJK SC','Noto Serif SC',Georgia,serif;font-size:3em;line-height:.85;padding:.12em .14em 0 0;color:var(--xjc-acc);font-weight:700}
html[data-t=sticky] body{font-weight:500}
html[data-t=terminal] .xjc-text p,html[data-t=script] .xjc-text p{text-align:left}
html[data-t=terminal] .xjc-text p{padding-left:1.2em;position:relative}
html[data-t=terminal] .xjc-text p::before{content:"│";position:absolute;left:0;color:var(--xjc-line)}
html[data-t=night] .xjc-text p{text-indent:2em}
html[data-t=letter] body{background-image:linear-gradient(90deg,transparent 18px,#f2cfc8 18px 19px,transparent 19px)}
html[data-t=letter] #xjc-content{padding-left:30px}
html[data-t=candy] .xjc-text p:first-child::first-line{color:var(--xjc-acc);font-weight:700}
html[data-t=xuan] .xjc-text p{text-indent:2em}
html[data-motion=off] *{animation:none!important;transition:none!important}
</style><style id="xjc-user">${userCss}</style></head><body><div id="xjc-content">${body}</div>
<${script}>(function(){var id=${JSON.stringify(id)};var content=document.getElementById("xjc-content");function h(){return Math.max(content.scrollHeight,content.getBoundingClientRect().height)}var last=0;function send(){var v=h();if(Math.abs(v-last)>1){last=v;parent.postMessage({source:"xjc-frame",type:"resize",id:id,height:v},"*")}}
if(window.ResizeObserver){new ResizeObserver(send).observe(content)}window.addEventListener("load",send);setInterval(send,700);send();
window.addEventListener("message",function(e){var d=e.data;if(e.source!==parent||!d||d.source!=="xjc-parent"||d.id!==id)return;if(d.type==="reading"){document.body.style.fontSize=d.size+"px";document.body.style.lineHeight=d.lineHeight;send()}if(d.type==="theme"&&d.vars){var r=document.documentElement;Object.keys(d.vars).forEach(function(k){r.style.setProperty(k,String(d.vars[k]))});r.setAttribute("data-t",String(d.theme||""));if(d.motion===false)r.setAttribute("data-motion","off");else r.removeAttribute("data-motion");var u=document.getElementById("xjc-user");if(u&&typeof d.css==="string")u.textContent=d.css;send()}if(d.type==="text"&&typeof d.html==="string"){content.innerHTML=d.html;send()}if(d.type==="fill"&&d.slots){Object.keys(d.slots).forEach(function(k){var t=String(d.slots[k]).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]}).replace(/&lt;br\\s*\\/?&gt;/gi,"<br>").replace(/\\n/g,"<br>");document.querySelectorAll('[data-slot="'+k+'"]').forEach(function(n){n.innerHTML=t})});send()}});
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

/** 改了字号/行距/主题/画布：送进所有开着的 iframe，不重载，保留交互状态 */
export function updateReading() {
  const t = themeTokens();
  const vars = { '--xjc-bg': t.bg, '--xjc-ink': t.ink, '--xjc-acc': t.acc, '--xjc-line': t.line, '--xjc-font': t.font };
  for (const [id, entry] of frames) {
    if (!entry.iframe.isConnected) { frames.delete(id); continue; }
    try {
      const w = entry.iframe.contentWindow;
      w?.postMessage({ source: 'xjc-parent', type: 'reading', id, size: t.size, lineHeight: t.lineHeight }, '*');
      w?.postMessage({ source: 'xjc-parent', type: 'theme', id, vars, theme: t.theme, css: t.css || '', motion: state.settings.motion !== false }, '*');
    } catch { /* ignore */ }
  }
}

/** 面板、全屏、聊天里的卡片都带 data-xjc-theme，换主题时一起改 */
export function applyTheme() {
  syncCustomStyle();
  document.querySelectorAll('[data-xjc-theme]').forEach(markTheme);
  document.body.classList.toggle('xjc-motion-off', state.settings.motion === false);
  updateReading();
}
