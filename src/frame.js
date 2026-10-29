// 渲染：AI 写的 HTML/JS 整块放进沙盒 iframe（没有 allow-same-origin，拿不到酒馆的页面、存储和密钥）；
// 纯文字也进同一种 iframe，配色和字体跟小剧场主题（或选定的画布）
import { applyFold } from './fold.js';
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
  // 长图：iframe 里画好的 PNG 传回来
  if (d.type === 'snap' && entry.snaps?.has(d.req)) {
    const p = entry.snaps.get(d.req);
    entry.snaps.delete(d.req);
    if (d.blob instanceof Blob && d.blob.size) p.resolve(d.blob); else p.reject(new Error(d.error || '长图没生成出来'));
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
  // 正文字号 = 界面字号 × 正文自己的倍数
  const size = Math.round(14 * (Number(s.uiScale) || 1) * (Number(s.fontScale) || 1) * 10) / 10;
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

// 纯文字里的 Markdown：标题、> 引用、列表、分隔线、粗体 / 斜体 / 删除线 / 行内代码、||剧透||（点一下显示）。
// 每行先转义再套标签，模型写的 HTML 不会被当成代码执行
function inlineMd(s) {
  return s
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\|\|(.+?)\|\|/g, '<span class="xjc-spoiler">$1</span>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s](?:[^*]*?[^*\s])?)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>');
}
const LIST_RE = /^\s*([-*+]|\d+[.)])\s+/;
export function textToHtml(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [];
  const flush = () => { if (para.length) out.push(`<p>${para.map(l => inlineMd(esc(l))).join('<br>')}</p>`); para = []; };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) { flush(); continue; }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { flush(); out.push(`<h${h[1].length} class="xjc-h">${inlineMd(esc(h[2]))}</h${h[1].length}>`); continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); out.push('<hr>'); continue; }
    if (/^\s*>/.test(line)) {
      flush();
      const q = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
      i--;
      out.push(`<blockquote>${textToHtml(q.join('\n'))}</blockquote>`);
      continue;
    }
    if (LIST_RE.test(line)) {
      flush();
      const ordered = /^\s*\d/.test(line);
      const items = [];
      while (i < lines.length && LIST_RE.test(lines[i]) && /^\s*\d/.test(lines[i]) === ordered) items.push(lines[i++].replace(LIST_RE, ''));
      i--;
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map(it => `<li>${inlineMd(esc(it))}</li>`).join('')}</${tag}>`);
      continue;
    }
    para.push(line);
  }
  flush();
  return out.join('');
}

// 长图：酒馆这边碰不到沙盒 iframe 里的内容，所以把截图库（modern-screenshot，MIT，在 vendor/）送进 iframe，在里面画成 PNG 传回来。
// 截图库默认开一个小框读浏览器的默认样式、好省掉和默认一样的样式；在沙盒里那个小框是另一个来源、读不到，会直接报错。
// 这里给它一个空的替身：读不到默认样式时它就把样式全部原样写上，图片一样，只是慢一点
// 画布按设备的上限收着：总像素不超过 1600 万、最长边不超过 16000，太长的就降一点清晰度，免得手机上画不出来
let snapLib = null;
const screenshotLib = () => (snapLib ||= fetch(new URL('../vendor/modern-screenshot.js', import.meta.url)).then(r => { if (!r.ok) throw new Error(`截图库加载失败（${r.status}）`); return r.text(); }).catch(e => { snapLib = null; throw e; }));
const SNAP_SCRIPT = `window.addEventListener("message",function(e){var d=e.data;if(e.source!==parent||!d||d.source!=="xjc-parent"||d.id!==XJC_ID||d.type!=="snap")return;
function done(m){var o={source:"xjc-frame",type:"snap",id:XJC_ID,req:d.req};for(var k in m)o[k]=m[k];parent.postMessage(o,"*")}
try{if(!window.modernScreenshot){var sc=document.createElement("script");sc.textContent=d.lib;document.head.appendChild(sc)}
var c=document.getElementById("xjc-content"),w=Math.ceil(Math.max(c.scrollWidth,c.getBoundingClientRect().width)),h=Math.ceil(Math.max(c.scrollHeight,c.getBoundingClientRect().height));
var s=Math.max(.3,Math.min(2,Math.sqrt(16e6/(w*h)),16000/h,16000/w));
var M=window.modernScreenshot;M.createContext(c,{scale:s,width:w,height:h,backgroundColor:getComputedStyle(document.body).backgroundColor,timeout:15000,type:"image/png"}).then(function(x){
x.sandbox={contentWindow:null,remove:function(){}};
return M.domToBlob(x).then(function(b){try{M.destroyContext(x)}catch(_){}return b})}).then(function(b){done({blob:b})},function(err){done({error:String(err&&err.message||err)})})}catch(err){done({error:String(err&&err.message||err)})}});`;

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
.xjc-text .xjc-h{margin:1em 0 .6em;line-height:1.35;color:var(--xjc-acc)}.xjc-text .xjc-h:first-child{margin-top:0}
.xjc-text h1{font-size:1.45em}.xjc-text h2{font-size:1.3em}.xjc-text h3{font-size:1.15em}.xjc-text h4,.xjc-text h5,.xjc-text h6{font-size:1em}
.xjc-text blockquote{margin:0 0 .9em;padding:.2em 0 .2em .9em;border-left:3px solid var(--xjc-acc);opacity:.88}
.xjc-text blockquote p{text-indent:0!important}
.xjc-text ul,.xjc-text ol{margin:0 0 .9em;padding-left:1.4em}.xjc-text li{margin:.2em 0}
.xjc-text hr{border:0;border-top:1px solid var(--xjc-line);margin:1.2em 0}
.xjc-text code{font-family:ui-monospace,Menlo,monospace;font-size:.9em;padding:0 .3em;border-radius:3px;background:color-mix(in srgb,var(--xjc-line) 45%,transparent)}
.xjc-spoiler{border-radius:3px;background:var(--xjc-ink);color:transparent;cursor:pointer;transition:all .2s}.xjc-spoiler.on{background:color-mix(in srgb,var(--xjc-line) 45%,transparent);color:inherit}
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
var XJC_ID=id;${SNAP_SCRIPT}
document.addEventListener("click",function(e){var sp=e.target&&e.target.closest?e.target.closest(".xjc-spoiler"):null;if(sp){sp.classList.toggle("on");return}var a=e.target&&e.target.closest?e.target.closest("[data-action]"):null;if(a){parent.postMessage({source:"xjc-frame",type:"action",id:id,text:a.getAttribute("data-action")||a.textContent||""},"*")}});})();</${script}>
</body></html>`;
}

/**
 * 挂一个 iframe。opts: { fill: 是否铺满容器（全屏），onAction(text) }
 * 返回 handle：{ iframe, stream(segments, writing), fillSlots(map), snapshot() → PNG Blob, destroy() }
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
  const entry = { iframe, onAction: opts.onAction, fill: !!opts.fill, snaps: new Map() };
  frames.set(id, entry);
  container.appendChild(iframe);
  const post = msg => { try { iframe.contentWindow?.postMessage({ source: 'xjc-parent', id, ...msg }, '*'); } catch { /* ignore */ } };
  return {
    iframe,
    // 边写边显示：文字段按 Markdown 画，HTML 段原样放进去、末尾没写完的标签先截掉。
    // 用 innerHTML 放进去的 <script> 不会运行，写完以后整篇重新渲染，脚本和交互那时才生效
    stream(segs, writing) {
      post({ type: 'text', html: segs.map((s, i) => (s.type === 'html'
        ? `<div class="xjc-html">${s.content.replace(/<[^>]*$/, '')}</div>`
        : `<article class="xjc-text${writing && i === segs.length - 1 ? ' writing' : ''}">${textToHtml(s.content)}</article>`)).join('\n') });
    },
    fillSlots(map) { post({ type: 'fill', slots: map }); },
    setAction(fn) { entry.onAction = fn; },
    async snapshot() {
      const lib = await screenshotLib();
      const req = ++seq;
      return new Promise((resolve, reject) => {
        entry.snaps.set(req, { resolve, reject });
        post({ type: 'snap', lib, req });
        setTimeout(() => { if (entry.snaps.delete(req)) reject(new Error('长图生成超时')); }, 60000);
      });
    },
    destroy() { frames.delete(id); iframe.remove(); },
  };
}

/** 导出成一个单独的 .html：和插件里看到的一样（主题、排版、交互都在），不依赖插件，任何浏览器都能打开 */
export function standaloneHtml(segments, title) {
  return frameDoc(segments, 'export', false)
    .replace('<head>', `<head><title>${esc(title || '小剧场')}</title>`)
    .replace('</style><style id="xjc-user">', '#xjc-content{max-width:860px;margin:0 auto;padding:24px 16px}\n</style><style id="xjc-user">');
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
  document.documentElement.style.setProperty('--xjc-fs', String(Number(state.settings.uiScale) || 1));
  syncCustomStyle();
  document.querySelectorAll('[data-xjc-theme]').forEach(markTheme);
  document.body.classList.toggle('xjc-motion-off', state.settings.motion === false);
  applyFold();
  updateReading();
}
