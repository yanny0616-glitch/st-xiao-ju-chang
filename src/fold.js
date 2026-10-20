// 楼层里小剧场收起时的样子。内置几种写成 CSS 字符串（$ 换成各自的选择器），「自定」用用户自己写的 CSS；
// 样式挂在 .xjc-tail[data-fold] 上，外观页的预览也用同一套，所见即所得
import { state } from './store.js';

export const FOLDS = [
  { v: 'pill', l: '胶囊', d: '收成一个小标签，几篇排一行，按钮点开才有' },
  { v: 'slim', l: '细条', d: '矮一点的整行标题栏，按钮还在' },
  { v: 'line', l: '一行小字', d: '没有底色和边框，最省地方' },
  { v: 'bar', l: '标题栏', d: '整行标题栏，带类型和按钮（原来的样子）' },
  { v: 'custom', l: '自定', d: '自己写 CSS' },
];

const CSS = {
  pill: `
$ { flex-direction: row; flex-wrap: wrap; align-items: flex-start; gap: 6px; }
$ > :not(.closed) { flex: 1 1 100%; }
$ .xjc-tail-card.closed { border-radius: 99px; max-width: 100%; }
$ .xjc-tail-card.closed .xjc-tail-hd { padding: 3px 12px; font-size: .8em; }
$ .xjc-tail-card.closed .xjc-tb, $ .xjc-tail-card.closed .ttl small { display: none; }
$ .xjc-tail-card.closed .ttl b { margin-right: 4px; }
$ .xjc-tail-card.closed .ttl::after { content: " ›"; opacity: .5; }`,
  slim: `
$ .xjc-tail-card.closed .xjc-tail-hd { padding: 1px 4px 1px 10px; font-size: .8em; }
$ .xjc-tail-card.closed .xjc-tb { width: 24px; height: 24px; font-size: .9em; }
$ .xjc-tail-card.closed .ttl small { display: none; }`,
  line: `
$ { gap: 2px; }
$ .xjc-tail-card.closed { border: 0; background: transparent; box-shadow: none; border-radius: 0; }
$ .xjc-tail-card.closed .xjc-tail-hd { padding: 2px 0; font-size: .78em; opacity: .75; }
$ .xjc-tail-card.closed .xjc-tail-hd:hover { opacity: 1; }
$ .xjc-tail-card.closed .xjc-tb, $ .xjc-tail-card.closed .ttl small { display: none; }
$ .xjc-tail-card.closed .ttl { text-decoration: underline dotted; text-underline-offset: 3px; }
$ .xjc-tail-card.closed .ttl::after { content: " · 展开"; opacity: .6; text-decoration: none; }`,
  bar: '',
};

const sel = v => `.xjc-tail[data-fold="${v}"]`;
/** 某个内置样式写成指定选择器下的 CSS（「自定」以它为起点时用） */
export const foldCss = (base, target = base) => (CSS[base] || '').replaceAll('$', sel(target)).trim();
export const currentFold = () => (FOLDS.some(x => x.v === state.settings.foldStyle) ? state.settings.foldStyle : 'pill');
/** 自定样式的 CSS：没写过就从胶囊开始 */
export const customFoldCss = () => (typeof state.settings.foldCss === 'string' && state.settings.foldCss.trim() ? state.settings.foldCss : foldCss('pill', 'custom'));

/** 把样式表放进 <head>，并把页面上已有的楼层小剧场换成当前样式；draft 是编辑中还没保存的自定 CSS */
export function applyFold(draft) {
  let st = document.getElementById('xjc-fold-style');
  if (!st) { st = document.createElement('style'); st.id = 'xjc-fold-style'; document.head.appendChild(st); }
  st.textContent = [...['pill', 'slim', 'line'].map(v => foldCss(v)), draft ?? customFoldCss()].join('\n');
  const v = currentFold();
  document.querySelectorAll('#chat .xjc-tail').forEach(b => { b.dataset.fold = v; });
}
