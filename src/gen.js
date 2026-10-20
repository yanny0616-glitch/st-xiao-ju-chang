// 生成：组合 → [材料, 前置要求, <Brief>] → 模型 → 切成文字段 / HTML 段
import { ctx, clone, byId, esc, uid, plain, toast } from './util.js';
import { expandMacros, shuffle } from './macros.js';
import { state } from './store.js';
import { LENGTH_CHARS, LENGTH_LABEL } from './defaults.js';
import { instr } from './instr.js';
import { buildMaterials, callModel, callQuiet, writeBackToLore, resolveTarget, userName, currentChar } from './host.js';
import { resolveCombo } from './follow.js';

const STYLE_HINT = { vars: 'styleVars', strict: 'styleStrict' };
const styleHint = style => (STYLE_HINT[style] ? instr(STYLE_HINT[style]) : '');

// 组合快照带上可重放的依赖；之后改库、删条目，收藏「按这套再来」仍是当时的要求。随机池保留候选，重放时重新抽
export function captureCombo(combo) {
  // 「跟随全局」的项在这一刻换成具体值，之后「按这套再来」也照这一次的来
  const copy = clone(resolveCombo(combo));
  if (!copy._dependencies) {
    copy._dependencies = clone({
      preamble: byId(state.preambles, combo.preambleId) || state.preambles[0] || null,
      prompts: (combo.promptIds || []).map(id => byId(state.prompts, id)).filter(Boolean),
      randoms: state.randoms, macros: state.macros,
      length: resolveLength(combo),
    });
  }
  return copy;
}
function comboPrompts(combo) {
  const listed = combo._dependencies ? combo._dependencies.prompts : (combo.promptIds || []).map(id => byId(state.prompts, id)).filter(Boolean);
  return [...(combo._virtualPrompts || []), ...listed];
}
function comboPreamble(combo) {
  return combo._dependencies ? combo._dependencies.preamble : byId(state.preambles, combo.preambleId) || state.preambles[0];
}
export function resolveLength(combo) {
  if (combo._dependencies) return combo._dependencies.length;
  const o = combo.output || {};
  if (o.length === 'custom') return { chars: Math.max(50, Number(o.customChars) || 900), label: '自定' };
  if (o.length && o.length !== 'default') return { chars: LENGTH_CHARS[o.length] || 900, label: LENGTH_LABEL[o.length] };
  if (!state.settings.lengthLimit) return null;
  const k = state.settings.defaultLength || 'medium';
  return { chars: LENGTH_CHARS[k] || 900, label: LENGTH_LABEL[k] };
}
function macroCtx(combo, charName) {
  const len = resolveLength(combo);
  return { user: userName(), char: charName, length: len ? `约 ${len.chars} 字` : '篇幅不限', macros: combo._dependencies ? combo._dependencies.macros : state.macros };
}
/** 先展开插件自己的宏，剩下的（{{persona}}、{{getvar::}}、{{lastMessage}}…）交给酒馆 */
function expand(text, mctx) {
  const ours = expandMacros(text, mctx);
  try { return ctx().substituteParams(ours, mctx.user, mctx.char); } catch { return ours; }
}
function drawRandoms(combo) {
  const rule = combo.random || {};
  const n = Math.max(0, Number(rule.count) || 0);
  if (!n) return [];
  const inc = new Set(rule.include || []), exc = new Set(rule.exclude || []);
  const randoms = combo._dependencies ? combo._dependencies.randoms : state.randoms;
  let pool = randoms.filter(r => {
    const tags = r.tags || [];
    if (tags.some(t => exc.has(t))) return false;
    return !inc.size || tags.some(t => inc.has(t));
  });
  if (!pool.length) pool = randoms.filter(r => !(r.tags || []).some(t => exc.has(t)));
  return shuffle(pool).slice(0, n);
}

/** <Brief> 全文 + 这次用了什么 */
function buildTasks(combo, extra, charName, phase = null) {
  const mctx = macroCtx(combo, charName);
  const prompts = comboPrompts(combo);
  const randoms = phase && phase.randoms ? phase.randoms : drawRandoms(combo);
  const len = resolveLength(combo);
  const o = combo.output || {};
  const lines = ['<Brief>'];
  const who = combo.who || 'persona';
  const hasPersona = !!String(ctx().powerUserSettings?.persona_description || '').trim();
  if (who === 'persona') lines.push(`【身份】${instr(hasPersona ? 'whoPersona' : 'whoPersonaBare', { 用户: mctx.user })}`);
  else if (who === 'custom') lines.push(`【身份】${instr('whoCustom', { 身份: expand(combo.whoText || '', mctx) || '由你根据场景安排' })}`);
  else lines.push(`【身份】${instr('whoNone', { 用户: mctx.user, 角色: mctx.char })}`);
  let i = 1;
  for (const p of prompts) lines.push(`【任务 ${i++} · ${p.title}】${expand(p.content, mctx)}`);
  for (const r of randoms) lines.push(`【随机附加 · ${r.title}】${expand(r.content, mctx)}`);
  if (extra) lines.push(`【本次追加】${expand(extra, mctx)}`);
  const out = [];
  const kind = phase && phase.kind;
  const titleLine = instr('title');
  if (kind === 'shell') {
    out.push(instr('shell') + ' ' + instr('htmlRules'));
    if (styleHint(o.style)) out.push(styleHint(o.style));
    out.push(titleLine);
  } else if (kind === 'fill') {
    lines.push(`【骨架】页面骨架已经定稿，下面是它的文字脉络，[[编号]] 就是要你填的位置：\n${phase.outline}`);
    lines.push(`【占位清单】\n${phase.slots.map(x => `[[${x.n}]] ${x.hint || '正文'}`).join('\n')}`);
    out.push(instr('fill'));
    if (len) out.push(instr('fillLength', { 字数: len.chars }));
  } else {
    if (o.mode === 'html') out.push(instr('outHtml') + (prompts.some(p => (p.tags || []).includes('前端')) ? '' : ' ' + instr('htmlRules')));
    else if (o.mode === 'mixed') out.push(instr('outMixed') + ' ' + instr('htmlRules'));
    else out.push(instr('outText'));
    if (len) out.push(instr('length', { 字数: len.chars }));
    if (o.wrapTag) out.push(instr('wrap', { 标签: o.wrapTag }));
    if (o.mode !== 'text' && styleHint(o.style)) out.push(styleHint(o.style));
    out.push(titleLine);
  }
  lines.push(`【输出要求】${out.join(' ')}`);
  lines.push('</Brief>');
  const ctxOpt = combo.context || {};
  return {
    tasks: lines.join('\n'), randoms,
    snapshot: {
      comboId: combo.id || '', comboName: combo.name, preambleName: (comboPreamble(combo) || {}).name || '',
      prompts: prompts.map(p => p.title), randoms: randoms.map(r => r.title), who, output: { ...o },
      length: len ? `${len.label} · 约 ${len.chars} 字` : '不限',
      context: { chat: ctxOpt.chat || 'none', rounds: ctxOpt.rounds || 12, worldInfo: ctxOpt.worldInfo !== false, summary: ctxOpt.summary !== false },
      extra: extra || '', staged: kind === 'shell',
    },
  };
}

// ── 分两步出：第一步骨架带 data-slot 占位，第二步按编号填字 ──
const SLOT_RE = /<([a-zA-Z][\w-]*)\b([^>]*?\sdata-slot="(\d+)"[^>]*)>([\s\S]*?)<\/\1>/g;
function extractSlots(html) {
  const slots = [], seen = new Set();
  for (const m of html.matchAll(SLOT_RE)) {
    const n = m[3];
    if (seen.has(n)) continue;
    seen.add(n);
    const hint = (m[2].match(/data-hint="([^"]*)"/) || [])[1] || '';
    slots.push({ n, hint: hint.replace(/&quot;/g, '"').trim() });
  }
  const outline = html.replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ').replace(SLOT_RE, ' [[$3]] ')
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d|section|article|header|footer)>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim().slice(0, 4000);
  return { slots, outline };
}
export function parseFill(text) {
  const map = {};
  const body = String(text).replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, '').replace(/```[a-z]*\n?|```/g, '');
  for (const m of body.matchAll(/\[\[(\d+)\]\]\s*([\s\S]*?)(?=\n\s*\[\[\d+\]\]|$)/g)) {
    const t = m[2].trim();
    if (t) map[m[1]] = t;
  }
  return map;
}
const slotHtml = text => esc(text).replace(/&lt;br\s*\/?&gt;/gi, '<br>').replace(/\n/g, '<br>');
function fillSlots(html, map) {
  return html.replace(SLOT_RE, (whole, tag, attrs, n) => (map[n] ? `<${tag}${attrs}>${slotHtml(map[n])}</${tag}>` : whole));
}

/** 流式增量里思维链标签可能还没闭合，预览前先剥掉 */
export function previewText(text) {
  return String(text || '').replace(/<(think|thinking|reasoning)>[\s\S]*?(<\/\1>|$)/gi, '').replace(/^\s+/, '');
}
function looksHtml(s) {
  return /^\s*(<!doctype|<html|<style|<div|<section|<article|<main|<body|<table|<ul|<ol|<header|<span|<p\b)/i.test(s)
    || (/<\w+[^>]*>/.test(s) && /<\/\w+>/.test(s) && (s.match(/<\w+/g) || []).length >= 3);
}
export function postProcess(raw, combo) {
  let text = String(raw).replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, '').trim();
  let title = '';
  const grab = () => {
    const tm = text.match(/^\s*(?:<!--\s*)?(?:标题|题目|Title)\s*[:：]\s*(.{1,40}?)\s*(?:-->)?\s*$/m);
    if (tm) { title = tm[1].replace(/^[「《"']|[」》"']$/g, ''); text = text.replace(tm[0], '').trim(); }
  };
  grab();
  const tag = (combo.output || {}).wrapTag;
  if (tag) {
    const found = [...text.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi'))].map(m => m[1].trim()).filter(Boolean);
    text = found.length ? found.join('\n\n') : text.replace(new RegExp(`<\\/?${tag}[^>]*>`, 'gi'), '').trim();
  }
  if (!title) grab();
  const segments = [];
  const fence = /```(?:html|HTML)?\s*\n([\s\S]*?)```/g;
  let last = 0, m;
  while ((m = fence.exec(text)) !== null) {
    const before = text.slice(last, m.index).trim();
    if (before) segments.push({ type: 'text', content: before });
    const inner = m[1].trim();
    if (inner) segments.push({ type: looksHtml(inner) ? 'html' : 'text', content: inner });
    last = m.index + m[0].length;
  }
  const rest = text.slice(last).trim();
  if (rest) segments.push({ type: (combo.output || {}).mode !== 'text' && looksHtml(rest) ? 'html' : 'text', content: rest });
  if (!title) {
    const html = segments.find(s => s.type === 'html');
    const h = html && (html.content.match(/<h[1-3][^>]*>([^<]{1,40})<\/h[1-3]>/i) || html.content.match(/<title>([^<]{1,40})<\/title>/i));
    if (h) title = h[1].trim();
    else {
      const t = segments.find(s => s.type === 'text');
      if (t) title = t.content.split(/\n/)[0].replace(/<[^>]*>/g, '').replace(/^[#*\s「《]+|[」》*]+$/g, '').trim().slice(0, 18);
    }
  }
  return { title: title || combo.name || '小剧场', segments };
}

// ── 选组合 ──
export function aiPickCombo() {
  // 菜单用带「形式」标签的提示词；一条都没有就用全部提示词
  const tagged = state.prompts.filter(p => (p.tags || []).includes('形式'));
  const forms = tagged.length ? tagged : state.prompts;
  const menu = forms.map((p, i) => `${i + 1}. ${p.title}：${p.content.replace(/\s+/g, ' ').slice(0, 80)}…`).join('\n');
  const scenes = state.prompts.filter(p => (p.tags || []).includes('场景')).map(p => p.title).join(' / ');
  const picker = { id: '', title: 'AI 自选', content: instr('aiPick', { 场景: scenes || '任意', 菜单: menu }) };
  return {
    id: '', name: 'AI 自选', tags: ['随机'], preambleId: state.settings.defaultPreambleId || (state.preambles[0] || {}).id,
    promptIds: [], _virtualPrompts: [picker],
    random: { count: 1, include: [], exclude: [] },
    output: { mode: 'mixed', wrapTag: '', length: 'default', customChars: 900, style: '', staged: false },
    context: null, who: '', channel: '', writeBack: null, whoText: '', api: '', weight: 1,
  };
}
export function weightedRandomCombo() {
  const pool = state.combos.map(c => ({ c, w: Math.max(0, Number(c.weight) || 0) })).filter(x => x.w > 0);
  if (state.settings.randomIncludesAi) pool.push({ c: aiPickCombo(), w: 1 });
  const total = pool.reduce((a, x) => a + x.w, 0);
  if (!total) return state.combos[0] || aiPickCombo();
  let r = Math.random() * total;
  for (const x of pool) { r -= x.w; if (r <= 0) return x.c; }
  return pool[pool.length - 1].c;
}

/**
 * 主入口。opts: { extra, uptoIndex, signal, onStream({kind,text,fill}), onShell(result) }
 * 返回结果对象（可直接存进最近/收藏/消息），取消时返回 null
 */
/** 生成一篇；小剧场开了「写回记忆」就顺手写进聊天的世界书（失败只提示，不影响结果） */
export async function generateTheater(comboIn, opts = {}) {
  const result = await generateOnce(comboIn, opts);
  if (result && !opts.signal?.aborted && state.settings.writeBackFeature && result.comboCopy?.writeBack) {
    writeBackToLore(result).then(name => { if (name) toast(`已写回世界书「${name}」`); }).catch(e => { console.warn('[小剧场] 写回世界书失败', e); toast(`写回世界书失败：${e.message || e}`); });
  }
  return result;
}

async function generateOnce(comboIn, opts = {}) {
  const combo = captureCombo(comboIn);
  const signal = opts.signal;
  const ctxOpt = combo.context || { chat: 'recent', rounds: 12 };
  const mat = await buildMaterials({ context: ctxOpt, who: combo.who, uptoIndex: opts.uptoIndex });
  const mctx = macroCtx(combo, mat.charName);
  const pre = comboPreamble(combo);
  const preamble = pre ? expand(pre.content, mctx) : '只输出 <Brief> 要求的内容。';
  const target = resolveTarget(combo.api);
  // 「走酒馆预设」只对「跟随酒馆当前 API」有效；材料由酒馆自己拼，这里不再重复带。
  // 酒馆拼的时候总是带整段聊天，没法截到某一楼，所以在更早的楼层下出时改用插件自己拼
  const olderFloor = opts.uptoIndex != null && opts.uptoIndex < (ctx().chat || []).length - 1;
  const wantPreset = combo.channel === 'preset';
  const quiet = wantPreset && target === 'st' && !olderFloor;
  const channelNote = !wantPreset ? '' : quiet ? '走酒馆预设'
    : target !== 'st' ? '插件自己拼（出口不是「跟随酒馆当前 API」，走不了酒馆预设）'
    : '插件自己拼（在更早的楼层下出，酒馆预设会带上之后的聊天，所以没走预设）';
  const wantStream = !!opts.onStream && state.settings.streamPreview !== false;
  const cancelled = () => !!signal?.aborted;

  // 每一步实际发给模型的消息，存进结果里给「ⓘ」看
  const sent = [];
  const call = async (tasks, kind) => {
    if (quiet) {
      const prompt = `${preamble}\n\n${tasks}`;
      const rec = { kind, via: 'preset', messages: [{ role: 'system', content: prompt }], partial: true };
      sent.push(rec);
      const r = await callQuiet(prompt);
      if (r.sent?.length) Object.assign(rec, { messages: r.sent, partial: false });
      return r;
    }
    const messages = [
      { role: 'system', content: mat.text },
      { role: 'system', content: preamble },
      { role: 'user', content: tasks },
    ];
    sent.push({ kind, via: target, messages: messages.map(m => ({ ...m })) });
    const onChunk = wantStream ? text => {
      if (cancelled()) return;
      const t = previewText(text);
      opts.onStream(kind === 'fill' ? { kind, text: t, fill: parseFill(t) } : { kind, text: t });
    } : undefined;
    return callModel(messages, { target, onChunk, signal });
  };
  const base = {
    id: uid('r'), characterName: mat.charName, characterAvatar: currentChar()?.avatar || '',
    createdAt: new Date().toISOString(), comboCopy: combo, target, request: sent, ...(channelNote ? { channelNote } : {}),
  };

  const o = combo.output || {};
  if (o.staged && o.mode === 'html') {
    const shellTask = buildTasks(combo, opts.extra, mat.charName, { kind: 'shell' });
    const shell = await call(shellTask.tasks, 'shell');
    if (cancelled()) return null;
    if (!shell.text.trim()) throw new Error('模型没有返回骨架。');
    const parsed = postProcess(shell.text, combo);
    const seg = parsed.segments.find(x => x.type === 'html');
    const found = seg ? extractSlots(seg.content) : { slots: [] };
    // 模型没按占位写就当一次性成品，不再跑第二步
    if (!seg || !found.slots.length) return { ...base, raw: shell.text, title: parsed.title, segments: parsed.segments, snapshot: { ...shellTask.snapshot, staged: false }, model: shell.model };
    const shellResult = { ...base, raw: shell.text, title: parsed.title, segments: parsed.segments, snapshot: shellTask.snapshot, model: shell.model, pending: true };
    opts.onShell?.(shellResult);
    const fillTask = buildTasks(combo, opts.extra, mat.charName, { kind: 'fill', randoms: shellTask.randoms, slots: found.slots, outline: found.outline });
    let fill;
    try { fill = await call(fillTask.tasks, 'fill'); }
    catch (e) { e.shellResult = shellResult; throw e; }
    if (cancelled()) return null;
    const map = parseFill(fill.text);
    if (!Object.keys(map).length) { const e = new Error('第二步没填出文字，骨架已保留。'); e.shellResult = shellResult; throw e; }
    const segments = parsed.segments.map(x => (x === seg ? { type: 'html', content: fillSlots(seg.content, map) } : x));
    return { ...shellResult, pending: false, raw: `${shell.text}\n\n<!-- 填字 -->\n${fill.text}`, segments, model: shell.model || fill.model };
  }
  const { tasks, snapshot } = buildTasks(combo, opts.extra, mat.charName);
  const { text, model } = await call(tasks, 'text');
  if (cancelled()) return null;
  if (!text.trim()) throw new Error('模型没有返回内容。');
  const parsed = postProcess(text, combo);
  return { ...base, raw: text, title: parsed.title, segments: parsed.segments, snapshot, model };
}

/** 交互型 HTML 里点了带 data-action 的按钮：带着上一篇和选择再写一篇 */
export function continueExtra(result, choice) {
  const prev = segmentsOf(result).map(s => (s.type === 'text' ? s.content : plain(s.content))).join('\n\n').slice(0, 6000);
  return instr('continue', { 上一篇: prev, 选择: choice });
}

export function segmentsOf(result) {
  const list = Array.isArray(result?.segments) ? result.segments.filter(s => s && typeof s.content === 'string') : [];
  if (list.length) return list;
  const raw = typeof result?.raw === 'string' ? result.raw.trim() : '';
  return raw ? [{ type: 'text', content: raw }] : [{ type: 'text', content: '这条记录的内容已经丢失了。' }];
}
export function kindOf(result) {
  const types = new Set(segmentsOf(result).map(s => s.type));
  return types.size > 1 ? 'mixed' : (types.has('html') ? 'html' : 'text');
}
export const KIND_LABEL = { html: '前端型', text: '文字型', mixed: '组合型' };
export function charCount(result) {
  return segmentsOf(result).reduce((a, s) => a + (s.type === 'html' ? plain(s.content) : s.content).replace(/\s+/g, '').length, 0);
}
export function resultPlainText(result) {
  return segmentsOf(result).map(s => (s.type === 'text' ? s.content : plain(s.content))).join('\n\n');
}
export function contextLabel(c) {
  if (!c) return '';
  const parts = [c.chat === 'recent' ? `最近 ${c.rounds || 12} 轮` : '不带聊天'];
  if (c.worldInfo === false) parts.push('不带世界书');
  return parts.join(' · ');
}
