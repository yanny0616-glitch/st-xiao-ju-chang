// 小剧场的提示词按「段」排：每段放几条提示词或整个分组，可以全部用，也可以从里面随机抽几条；各段按顺序拼成同一篇的要求
// 段里的条目：'p:<提示词 id>' 是单条，'g:<分组名>' 是提示词库里的整个分组（以后放进这个组的也算）
import { state } from './store.js';
import { byId, uid } from './util.js';

export const newPart = (items = [], pick = 0, name = '') => ({ id: uid('pt'), name, items, pick });

/** 旧格式（promptIds + 随机里选的提示词分组）换成段；已经是段的原样返回 */
export function partsOf(c) {
  if (Array.isArray(c?.parts)) return c.parts;
  const parts = [];
  const ids = Array.isArray(c?.promptIds) ? c.promptIds.filter(x => typeof x === 'string') : [];
  if (ids.length) parts.push(newPart(ids.map(id => `p:${id}`)));
  const groups = (c?.random?.groups || []).filter(g => String(g).startsWith('prompts/')).map(g => `g:${String(g).slice(8)}`);
  if (groups.length) parts.push(newPart(groups, Math.max(1, Number(c.random.count) || 1), '随机'));
  return parts;
}

/** 一段实际能用的提示词（分组按当前库展开，去重） */
export function partPool(part, prompts = state.prompts) {
  const out = [], seen = new Set();
  for (const it of part.items || []) {
    const list = it.startsWith('g:') ? prompts.filter(p => (p.group || '') === it.slice(2)) : [byId(prompts, it.slice(2))].filter(Boolean);
    for (const p of list) if (!seen.has(p.id)) { seen.add(p.id); out.push(p); }
  }
  return out;
}

/** 一段里的条目显示成什么 */
export function itemLabel(it) {
  if (it.startsWith('g:')) return `整组 · ${it.slice(2) || '未分组'}（${state.prompts.filter(p => (p.group || '') === it.slice(2)).length} 条）`;
  return byId(state.prompts, it.slice(2))?.title || '';
}
export const itemAlive = it => (it.startsWith('g:') ? true : !!byId(state.prompts, it.slice(2)));

/** 用到这条提示词的小剧场（单条引用；整组引用不算，删条目时组还在） */
export const usesPrompt = (c, id) => partsOf(c).some(pt => (pt.items || []).includes(`p:${id}`));
/** 这个小剧场引用到的全部提示词（导出用） */
export const comboPromptIds = c => [...new Set(partsOf(c).flatMap(pt => partPool(pt).map(p => p.id)))];

/** 存在库里的小剧场都换成段的格式（只做一次） */
export function migrateParts(combos) {
  let changed = false;
  for (const c of combos) {
    if (Array.isArray(c.parts)) continue;
    c.parts = partsOf(c);
    delete c.promptIds;
    if (c.random) {
      const left = (c.random.groups || []).filter(g => !String(g).startsWith('prompts/'));
      if ((c.random.groups || []).length && !left.length) c.random.count = 0;
      c.random.groups = left;
    }
    changed = true;
  }
  return changed;
}
