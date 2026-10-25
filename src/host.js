// 和酒馆打交道：当前聊天的角色、用户人设、世界书、总结、聊天记录，以及三种出口的模型调用
import { ctx } from './util.js';
import { state } from './store.js';

// ── 角色 ──
/** 当前聊天的角色（{{char}}）；没打开角色聊天或在群聊里返回 null */
export function currentChar() {
  const c = ctx();
  if (c.groupId) return null;
  const chid = c.characterId;
  if (chid === undefined || chid === null || chid === '' || !c.characters[chid]) return null;
  return { chid: Number(chid), name: c.characters[chid].name, avatar: c.characters[chid].avatar || '' };
}
export const userName = () => ctx().name1 || '用户';

// ── 材料 ──
/** 角色卡、人设、世界书、总结里的 {{user}} {{char}} <user> <char> 等交给酒馆替换；老写法先自己换一遍，不依赖酒馆版本 */
function sub(text, charName) {
  const c = ctx();
  const t = String(text || '').replace(/<user>/gi, c.name1 || '用户').replace(/<(?:char|bot)>/gi, charName);
  try { return c.substituteParams(t, c.name1, charName); } catch { return t; }
}
function cleanMes(m) {
  return String(m.mes || '').replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, '').trim();
}
let regexMod;
async function regexEngine() {
  if (regexMod === undefined) {
    try { regexMod = await import('/scripts/extensions/regex/engine.js'); } catch { regexMod = null; }
  }
  return regexMod;
}
/**
 * 截至 end（不含）的聊天，和酒馆发给模型时一样处理：跳过隐藏（/hide）和系统消息，
 * 套用「修改提示词」类的正则（按离末尾的深度，min/max depth 照算），被正则清掉的楼层不算
 */
async function promptChat(end) {
  const chat = ctx().chat || [];
  const vis = [];
  for (let i = 0; i < end; i++) { const m = chat[i]; if (m && !m.is_system && m.mes) vis.push(i); }
  const rx = await regexEngine();
  const out = [];
  vis.forEach((i, k) => {
    const m = chat[i];
    let raw = String(m.mes || '');
    if (rx?.getRegexedString && rx.regex_placement) {
      try { raw = rx.getRegexedString(raw, m.is_user ? rx.regex_placement.USER_INPUT : rx.regex_placement.AI_OUTPUT, { isPrompt: true, depth: vis.length - k - 1 }); } catch { /* ignore */ }
    }
    const text = cleanMes({ mes: raw }).slice(0, 4000);
    if (text) out.push({ idx: i, isUser: !!m.is_user, role: m.is_user ? 'user' : 'assistant', name: m.name, text });
  });
  return out;
}
/** 截至 uptoIndex（含）的最近 rounds 轮 */
export async function recentChat(rounds, uptoIndex) {
  const chat = ctx().chat || [];
  const end = uptoIndex == null ? chat.length : Math.min(chat.length, uptoIndex + 1);
  const want = Math.max(1, Math.min(100, Number(rounds) || 12)) * 2;
  return (await promptChat(end)).slice(-want);
}

/** 拼一段 system 材料。opts: { context, who, uptoIndex } */
/**
 * 世界书不设预算：只要激活了（蓝灯常驻、绿灯被聊天触发）就全带上，不管酒馆世界书设置里的百分比和预算上限。
 * 做法是只在这次扫描里给条目标上「不计预算」——条目是酒馆每次扫描新拷的，不影响酒馆自己的数据和正常聊天
 */
/** 酒馆里所有世界书的名字（设置里选世界书用） */
export async function worldNames() {
  try { const wi = await import('/scripts/world-info.js'); return [...(wi.world_names || [])].sort((x, y) => x.localeCompare(y, 'zh')); } catch { return []; }
}

/** 酒馆这会儿会用到的世界书：全局开着的、当前角色卡绑定的（含附加的）、聊天绑定的、人设绑定的。返回 Map 名字 → 来源 */
export async function tavernWorlds() {
  const c = ctx();
  const out = new Map();
  const add = (n, why) => { if (n && !out.has(n)) out.set(n, why); };
  try {
    const wi = await import('/scripts/world-info.js');
    for (const n of wi.selected_world_info || []) add(n, '酒馆已开启');
    const cur = currentChar();
    const ch = cur ? c.characters[cur.chid] : null;
    if (ch) {
      add(ch.data?.extensions?.world, '角色卡绑定');
      const file = String(ch.avatar || '').replace(/\.[^.]+$/, '');
      for (const n of wi.world_info?.charLore?.find(e => e.name === file)?.extraBooks || []) add(n, '角色卡绑定');
    }
    add(c.chatMetadata?.[wi.METADATA_KEY || 'world_info'], '聊天绑定');
    add(c.powerUserSettings?.persona_description_lorebook, '人设绑定');
  } catch (e) { console.warn('[小剧场] 读不到酒馆的世界书设置', e); }
  return out;
}

/** 条目的灯：蓝灯常驻 / 绿灯按关键词 / 向量化（设置里显示状态用） */
export const lampOf = e => (e?.constant ? 'constant' : e?.vectorized ? 'vectorized' : 'normal');
/** 一本世界书的条目，按酒馆里的显示顺序 */
export async function loadBook(name) {
  const data = await ctx().loadWorldInfo(name);
  return Object.values(data?.entries || {}).filter(Boolean).sort((a, b) => (a.displayIndex ?? a.uid) - (b.displayIndex ?? b.uid));
}

/** 选中的几本世界书，按酒馆自己的格式拷一份条目 */
async function loreOf(books) {
  const c = ctx();
  const out = [];
  for (const name of books) {
    try {
      const data = await c.loadWorldInfo(name);
      for (const e of Object.values(data?.entries || {})) if (e) out.push({ ...e, world: name });
    } catch (e) { console.warn(`[小剧场] 读不到世界书「${name}」`, e); }
  }
  return out;
}

/**
 * 世界书来源（设置里二选一）：
 * - 同步酒馆：和酒馆聊天时用的一样
 * - 自己选：默认就是酒馆这会儿开着的 + 角色卡 / 聊天 / 人设绑定的，在这个基础上多勾（wiAdd）或取消（wiRemove）。
 *   只记增减，换了角色，新角色卡绑定的书照样默认带上
 * 两种都照酒馆的扫描规则激活，只在这次扫描里换掉条目列表，不改酒馆的世界书设置
 */
async function scanWorldInfo(scan, scanData) {
  const c = ctx();
  const s = state.settings || {};
  const pick = s.wiSource === 'pick';
  const removed = new Set(pick ? s.wiRemove || [] : []);
  const extra = pick ? await loreOf((s.wiAdd || []).filter(n => n && !removed.has(n))) : [];
  const ev = c.eventTypes?.WORLDINFO_ENTRIES_LOADED;
  if (pick && !ev) throw new Error('这个版本的酒馆不支持自己选世界书');
  const onLoaded = lores => {
    if (pick && lores) {
      const lists = ['globalLore', 'characterLore', 'chatLore', 'personaLore'].filter(k => Array.isArray(lores[k]));
      const have = new Set();
      for (const k of lists) {
        lores[k].splice(0, lores[k].length, ...lores[k].filter(e => !removed.has(e?.world)));
        for (const e of lores[k]) have.add(e?.world);
      }
      if (Array.isArray(lores.globalLore)) lores.globalLore.push(...extra.filter(e => !have.has(e.world)));
    }
    for (const list of Object.values(lores || {})) if (Array.isArray(list)) for (const e of list) if (e) e.ignoreBudget = true;
  };
  if (ev) c.eventSource.on(ev, onLoaded);
  try {
    return await c.getWorldInfoPrompt(scan, 10_000_000, true, scanData);
  } finally {
    if (ev) c.eventSource.removeListener?.(ev, onLoaded);
  }
}

export async function buildMaterials({ context = {}, who = 'persona', uptoIndex }) {
  const c = ctx();
  const cur = currentChar();
  if (!cur) throw new Error('先打开一个角色聊天。');
  const ch = c.characters[cur.chid];
  const name = ch.name;
  const parts = [];
  const card = [`角色：${name}`];
  if (ch.description) card.push(`设定：\n${sub(ch.description, name)}`);
  if (ch.personality) card.push(`性格：${sub(ch.personality, name)}`);
  if (ch.scenario) card.push(`场景：${sub(ch.scenario, name)}`);
  const depth = ch.data?.extensions?.depth_prompt?.prompt;
  if (depth) card.push(`补充：${sub(depth, name)}`);
  parts.push(`<CharacterSheet>\n${card.join('\n')}\n</CharacterSheet>`);

  if (who === 'persona') {
    const persona = c.powerUserSettings?.persona_description;
    if (persona && persona.trim()) parts.push(`<UserPersona name="${userName()}">\n${sub(persona, name)}\n</UserPersona>`);
  }

  const end = uptoIndex == null ? (c.chat || []).length : Math.min((c.chat || []).length, uptoIndex + 1);
  const all = await promptChat(end);
  const want = Math.max(1, Math.min(100, Number(context.rounds) || 12)) * 2;
  const history = context.chat === 'recent' ? all.slice(-want) : [];

  // @深度 的世界书条目（数据库插件的记忆默认就在 @深度 2）：和酒馆一样按深度插进聊天记录，0 = 最后一条之后
  const atDepth = [];
  if (context.worldInfo !== false && typeof c.getWorldInfoPrompt === 'function') {
    try {
      // 和酒馆自己生成时一样：截到这一楼、正则处理过的聊天，「新的在前」交给酒馆扫描，
      // 扫描深度、绿灯关键词、蓝灯常驻按酒馆的世界书设置，不设预算（数据库插件的召回编码也就照常生效）；dry run 不触发激活事件
      const scan = all.map(m => `${m.name}: ${m.text}`).reverse();
      const scanData = {
        personaDescription: c.powerUserSettings?.persona_description || '', characterDescription: ch.description || '',
        characterPersonality: ch.personality || '', characterDepthPrompt: depth || '', scenario: ch.scenario || '',
        creatorNotes: ch.data?.creator_notes || ch.creatorcomment || '', trigger: 'normal',
      };
      const wi = await scanWorldInfo(scan, scanData);
      const ex = (wi?.worldInfoExamples || []).map(e => e?.content);
      const text = [wi?.worldInfoBefore, wi?.worldInfoAfter, ...(wi?.anBefore || []), ...(wi?.anAfter || []), ...ex].filter(s => s && String(s).trim()).join('\n');
      for (const d of wi?.worldInfoDepth || []) {
        const body = (d?.entries || []).filter(s => s && String(s).trim()).join('\n');
        if (body) atDepth.push({ depth: Math.max(0, Number(d.depth) || 0), text: sub(body.trim(), name) });
      }
      const loose = history.length ? '' : atDepth.map(d => d.text).join('\n');
      const all2 = [text && sub(text.trim(), name), loose].filter(Boolean).join('\n');
      if (all2) parts.push(`<WorldInfo>\n${all2}\n</WorldInfo>`);
    } catch (e) { console.warn('[小剧场] 世界书读取失败', e); }
  }

  if (context.summary !== false) {
    const summary = c.extensionPrompts?.['1_memory']?.value;
    if (summary && summary.trim()) parts.push(`<Summary>\n${sub(summary.trim(), name)}\n</Summary>`);
  }

  if (history.length) {
    const lines = history.map(m => `${m.name}：${m.text}`);
    // 从深往浅插，同一深度按酒馆给的顺序
    for (const d of [...atDepth].sort((x, y) => y.depth - x.depth)) lines.splice(Math.max(0, lines.length - d.depth), 0, d.text);
    parts.push('<RecentChat>\n' + lines.join('\n') + '\n</RecentChat>');
  }
  return { text: parts.join('\n\n'), charName: name, historyCount: history.length };
}

// ── 出口 ──
/** 下拉框里能选的出口：跟随酒馆当前 API / 酒馆的连接配置 / 插件里自己配的 API */
export function apiTargets() {
  const list = [{ v: 'st', l: '跟随酒馆当前 API' }];
  const profiles = ctx().extensionSettings?.connectionManager?.profiles || [];
  for (const p of profiles) if (p && p.id) list.push({ v: `profile:${p.id}`, l: `连接配置 · ${p.name || p.id}` });
  for (const a of state.apis) list.push({ v: `api:${a.id}`, l: `自配 · ${a.name || a.model || a.url}` });
  return list;
}
export function targetLabel(v) {
  return (apiTargets().find(x => x.v === v) || {}).l || '跟随酒馆当前 API';
}
export function resolveTarget(comboApi) {
  const v = comboApi || state.settings.api || 'st';
  if (v.startsWith('api:') && !state.apis.some(a => `api:${a.id}` === v)) return 'st';
  if (v.startsWith('profile:') && !apiTargets().some(x => x.v === v)) return 'st';
  return v;
}

export const API_FORMATS = [
  { v: 'openai', l: 'OpenAI 兼容（大多数中转、DeepSeek、OpenRouter…）' },
  { v: 'claude', l: 'Claude 原生' },
  { v: 'gemini', l: 'Gemini 原生（AI Studio）' },
];

/** 自配 API 走酒馆后端转发：浏览器/WebView 不直连第三方，没有跨域问题，iOS 上也一样 */
function payloadFor(api, extra) {
  const base = { model: api.model, temperature: Number.isFinite(Number(api.temperature)) ? Number(api.temperature) : 1, ...extra };
  if (api.format === 'claude') return { ...base, chat_completion_source: 'claude', reverse_proxy: api.url || 'https://api.anthropic.com/v1', proxy_password: api.key || '' };
  if (api.format === 'gemini') return { ...base, chat_completion_source: 'makersuite', reverse_proxy: api.url || 'https://generativelanguage.googleapis.com', proxy_password: api.key || '' };
  return {
    ...base, chat_completion_source: 'custom', custom_url: api.url,
    custom_include_headers: api.key ? JSON.stringify({ Authorization: `Bearer ${api.key}` }) : '',
  };
}

export async function fetchModels(api) {
  const body = payloadFor(api, {});
  delete body.model; delete body.temperature;
  const res = await fetch('/api/backends/chat-completions/status', { method: 'POST', headers: ctx().getRequestHeaders(), body: JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* ignore */ }
  if (!res.ok || !json || json.error) throw new Error(json?.error?.message || json?.message || `拉取失败（${res.status}）`);
  const list = Array.isArray(json.data) ? json.data : Array.isArray(json.models) ? json.models : Array.isArray(json) ? json : [];
  return list.map(m => (typeof m === 'string' ? m : m.id || m.name || '')).map(s => String(s).replace(/^models\//, '')).filter(Boolean).sort();
}

async function drain(gen, onChunk, signal) {
  let text = '';
  for await (const part of gen()) {
    if (signal?.aborted) break;
    text = part?.text ?? text;
    onChunk?.(text);
  }
  return text;
}

// ── 跟随酒馆当前 API（聊天补全）时自己发流式请求 ──
// 酒馆的 generateRaw / 静默生成从不流式，一篇写两三百秒时中间的反代、中转站会先超时（504）；流式一直有数据在走就不会。
// 请求参数用酒馆自己的 createGenerationParameters 按当前连接拼（源、模型、采样、反代、密钥都走酒馆后端），只把 stream 打开
let stMods = null;
async function stModules() {
  if (stMods !== null) return stMods;
  try {
    const [oai, sse] = await Promise.all([import('/scripts/openai.js'), import('/scripts/sse-stream.js')]);
    stMods = typeof oai.createGenerationParameters === 'function' && typeof oai.getStreamingReply === 'function' && typeof sse.getEventSourceStream === 'function' ? { oai, sse } : false;
  } catch { stMods = false; }
  return stMods;
}
/** 当前能不能用流式（聊天补全 + 酒馆版本里有那几个函数） */
async function canStreamSt() {
  return ctx().mainApi === 'openai' && !!(await stModules());
}
const errorOf = (raw, status) => {
  let j = null;
  try { j = JSON.parse(raw); } catch { /* ignore */ }
  const m = j?.error?.message || j?.message || (typeof j?.error === 'string' ? j.error : '') || String(raw || '').slice(0, 200);
  return new Error(m ? `${m}（${status}）` : `请求失败（${status}）`);
};
async function streamSt(messages, { maxTokens, onChunk, signal }) {
  const c = ctx();
  const { oai, sse } = await stModules();
  const model = oai.getChatCompletionModel(oai.oai_settings);
  const { generate_data } = await oai.createGenerationParameters(oai.oai_settings, model, 'quiet', messages);
  generate_data.stream = true;
  generate_data.max_tokens = maxTokens;
  await c.eventSource.emit(c.eventTypes.CHAT_COMPLETION_SETTINGS_READY, generate_data);
  const res = await fetch('/api/backends/chat-completions/generate', { method: 'POST', headers: c.getRequestHeaders(), body: JSON.stringify(generate_data), signal });
  if (!res.ok) throw errorOf(await res.text(), res.status);
  const reader = res.body.pipeThrough(sse.getEventSourceStream()).getReader();
  const st = { reasoning: '', images: [], signature: '', toolSignatures: {} };
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done || value?.data === '[DONE]') break;
    let parsed;
    try { parsed = JSON.parse(value.data); } catch { continue; }
    if (parsed?.error) throw errorOf(value.data, res.status);
    // 思维链不算正文（overrideShowThoughts: false）
    text += oai.getStreamingReply(parsed, st, { overrideShowThoughts: false }) || '';
    onChunk?.(text);
  }
  return { text, model: model ? String(model) : '' };
}

/**
 * 发一次请求。messages 是 [{role, content}]。
 * opts: { target, onChunk, signal } → { text, model, streamed }
 */
export async function callModel(messages, { target, onChunk, signal } = {}) {
  const c = ctx();
  const maxTokens = Math.max(256, Number(state.settings.maxTokens) || 4096);
  const t = target || 'st';
  if (t.startsWith('api:')) {
    const api = state.apis.find(a => `api:${a.id}` === t);
    if (!api) throw new Error('这个自配 API 已被删除。');
    if (!api.model) throw new Error(`「${api.name || '自配 API'}」还没填模型。`);
    if (api.format === 'openai' && !api.url) throw new Error(`「${api.name || '自配 API'}」还没填地址。`);
    // 流式不只是为了边写边显示：一直有数据在走，长篇不会被中转站超时掐断
    const stream = api.stream !== false;
    const payload = payloadFor(api, { messages, stream, max_tokens: Number(api.maxTokens) || maxTokens });
    const res = await c.ChatCompletionService.processRequest(payload, {}, true, signal);
    const text = typeof res === 'function' ? await drain(res, onChunk, signal) : (res?.content ?? '');
    return { text, model: api.model, streamed: stream };
  }
  if (t.startsWith('profile:')) {
    const id = t.slice(8);
    const svc = c.ConnectionManagerRequestService;
    if (!svc) throw new Error('当前酒馆没有连接配置功能，换个出口。');
    const stream = true;
    const res = await svc.sendRequest(id, messages, maxTokens, { stream, signal, extractData: true, includePreset: true, includeInstruct: true });
    const text = typeof res === 'function' ? await drain(res, onChunk, signal) : (res?.content ?? '');
    const profile = (c.extensionSettings?.connectionManager?.profiles || []).find(p => p.id === id);
    return { text, model: profile?.model || '', streamed: stream };
  }
  // 跟随酒馆：不带预设里的提示词条目，只用当前 API 和采样参数。聊天补全自己发流式；文本补全还是 generateRaw（不流式）
  if (await canStreamSt()) {
    const r = await streamSt(messages, { maxTokens, onChunk, signal });
    return { ...r, streamed: true };
  }
  const text = await c.generateRaw({ prompt: messages, responseLength: maxTokens, trimNames: false });
  let model = '';
  try { model = c.mainApi === 'openai' ? c.getChatCompletionModel?.() : c.onlineStatus; } catch { /* ignore */ }
  return { text: String(text || ''), model: model && model !== 'no_connection' ? String(model) : '', streamed: false };
}

/** 「走酒馆预设」：用酒馆自己的生成流程（预设里的破限/文风、角色卡、世界书、聊天记录都由酒馆拼），小剧场只补前置和 <Brief>。不流式 */
export async function callQuiet(prompt, { onChunk, signal } = {}) {
  const c = ctx();
  if (typeof c.generateQuietPrompt !== 'function') throw new Error('这个酒馆版本不支持「走酒馆预设」，换回「插件自己拼」。');
  // 回复长度占掉上下文的话，酒馆会把前面的内容全挤掉；最多给上下文的一半
  const maxCtx = Number(c.mainApi === 'openai' ? c.chatCompletionSettings?.openai_max_context : c.maxContext) || 0;
  const want = Math.max(256, Number(state.settings.maxTokens) || 4096);
  const responseLength = maxCtx ? Math.max(256, Math.min(want, Math.floor(maxCtx / 2))) : want;
  // 酒馆按预设拼好的那份才是真正发出去的；趁它发之前抓下来给「ⓘ」看
  const got = {};
  const ev = c.eventTypes || {};
  const onChat = d => { if (d && !d.dryRun && Array.isArray(d.chat)) got.messages = d.chat.map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) })); };
  const onText = d => { if (d && !d.dryRun && typeof d.prompt === 'string') got.messages = [{ role: 'prompt', content: d.prompt }]; };
  if (ev.CHAT_COMPLETION_PROMPT_READY) c.eventSource.on(ev.CHAT_COMPLETION_PROMPT_READY, onChat);
  if (ev.GENERATE_AFTER_COMBINE_PROMPTS) c.eventSource.on(ev.GENERATE_AFTER_COMBINE_PROMPTS, onText);
  // 聊天补全：先让酒馆按预设拼一遍（dryRun，不真的发），拿到拼好的那份自己流式发
  if (await canStreamSt() && typeof c.generate === 'function') {
    let chat = null;
    const cap = d => { if (d && d.dryRun && Array.isArray(d.chat)) chat = d.chat; };
    c.eventSource.on(ev.CHAT_COMPLETION_PROMPT_READY, cap);
    try { await c.generate('quiet', { quiet_prompt: prompt }, true); } catch (e) { console.warn('[小剧场] 按预设拼提示词失败，改用酒馆静默生成', e); }
    finally { c.eventSource.removeListener?.(ev.CHAT_COMPLETION_PROMPT_READY, cap); }
    if (chat?.length) {
      const sent = chat.map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }));
      const r = await streamSt(JSON.parse(JSON.stringify(chat)), { maxTokens: responseLength, onChunk, signal });
      return { ...r, streamed: true, sent };
    }
  }
  let text;
  try { text = await c.generateQuietPrompt({ quietPrompt: prompt, responseLength, removeReasoning: true }); }
  finally {
    c.eventSource.removeListener?.(ev.CHAT_COMPLETION_PROMPT_READY, onChat);
    c.eventSource.removeListener?.(ev.GENERATE_AFTER_COMBINE_PROMPTS, onText);
  }
  if (text == null) throw new Error('酒馆没有出结果：先在酒馆里连上 API（插头图标），或者这个小剧场改回「插件自己拼」。');
  let model = '';
  try { model = c.mainApi === 'openai' ? c.getChatCompletionModel?.() : c.onlineStatus; } catch { /* ignore */ }
  return { text: String(text || ''), model: model && model !== 'no_connection' ? String(model) : '', streamed: false, sent: got.messages || null };
}

/** 写回记忆：把这篇的梗概写成一条世界书条目，放进这个聊天绑定的世界书（没有就新建一本并绑上） */
export async function writeBackToLore(result) {
  const c = ctx();
  if (!currentChar()) return;
  const wi = await import('/scripts/world-info.js');
  const key = wi.METADATA_KEY || 'world_info';
  let name = c.chatMetadata?.[key];
  if (!name) {
    name = `小剧场记忆 · ${currentChar().name} · ${String(c.getCurrentChatId?.() || Date.now()).slice(-19)}`.replace(/[\\/:*?"<>|]/g, '-');
    await wi.createNewWorldInfo(name, { interactive: false });
    c.chatMetadata[key] = name;
    await c.saveMetadata();
  }
  const data = await c.loadWorldInfo(name);
  if (!data || typeof data !== 'object') throw new Error(`读不到世界书「${name}」。`);
  data.entries = data.entries || {};
  const segs = result.segments || [];
  const text = segs.filter(s => s.type === 'text').map(s => s.content).join('\n') || segs.map(s => String(s.content).replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>|<[^>]+>/gi, ' ')).join(' ');
  const gist = text.replace(/\s+/g, ' ').trim().slice(0, 400);
  if (!gist) return;
  const entry = wi.createWorldInfoEntry(name, data);
  Object.assign(entry, {
    comment: `小剧场《${result.title || '无题'}》`, content: `（小剧场·${result.snapshot?.comboName || ''}）${gist}`,
    constant: true, key: [], disable: false,
  });
  await c.saveWorldInfo(name, data, true);
  try { c.updateWorldInfoList?.(); } catch { /* ignore */ }
  return name;
}
