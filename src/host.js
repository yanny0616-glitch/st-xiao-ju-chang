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
  return { chid: Number(chid), name: c.characters[chid].name };
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
/** 截至 uptoIndex（含）的最近 rounds 轮，跳过系统消息和隐藏消息 */
export function recentChat(rounds, uptoIndex) {
  const chat = ctx().chat || [];
  const end = uptoIndex == null ? chat.length : Math.min(chat.length, uptoIndex + 1);
  const want = Math.max(1, Math.min(100, Number(rounds) || 12)) * 2;
  const out = [];
  for (let i = end - 1; i >= 0 && out.length < want; i--) {
    const m = chat[i];
    if (!m || m.is_system || !m.mes) continue;
    out.unshift({ role: m.is_user ? 'user' : 'assistant', name: m.name, text: cleanMes(m).slice(0, 4000) });
  }
  return out;
}

/** 拼一段 system 材料。opts: { context, who, uptoIndex } */
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

  const history = context.chat === 'recent' ? recentChat(context.rounds, uptoIndex) : [];

  if (context.worldInfo !== false && typeof c.getWorldInfoPrompt === 'function') {
    try {
      // 世界书扫描要的是「新的在前」的消息文本，和酒馆自己生成时一致；dry run 不触发激活事件
      const scan = (history.length ? history : recentChat(4, uptoIndex)).map(m => `${m.name}: ${m.text}`).reverse();
      const wi = await c.getWorldInfoPrompt(scan, c.maxContext || 8192, true);
      const text = [wi?.worldInfoBefore, wi?.worldInfoAfter].filter(s => s && s.trim()).join('\n');
      if (text) parts.push(`<WorldInfo>\n${sub(text.trim(), name)}\n</WorldInfo>`);
    } catch (e) { console.warn('[小剧场] 世界书读取失败', e); }
  }

  if (context.summary !== false) {
    const summary = c.extensionPrompts?.['1_memory']?.value;
    if (summary && summary.trim()) parts.push(`<Summary>\n${sub(summary.trim(), name)}\n</Summary>`);
  }

  if (history.length) {
    parts.push('<RecentChat>\n' + history.map(m => `${m.name}：${m.text}`).join('\n') + '\n</RecentChat>');
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
    const stream = api.stream !== false && !!onChunk;
    const payload = payloadFor(api, { messages, stream, max_tokens: Number(api.maxTokens) || maxTokens });
    const res = await c.ChatCompletionService.processRequest(payload, {}, true, signal);
    const text = typeof res === 'function' ? await drain(res, onChunk, signal) : (res?.content ?? '');
    return { text, model: api.model, streamed: stream };
  }
  if (t.startsWith('profile:')) {
    const id = t.slice(8);
    const svc = c.ConnectionManagerRequestService;
    if (!svc) throw new Error('当前酒馆没有连接配置功能，换个出口。');
    const stream = !!onChunk;
    const res = await svc.sendRequest(id, messages, maxTokens, { stream, signal, extractData: true, includePreset: true, includeInstruct: true });
    const text = typeof res === 'function' ? await drain(res, onChunk, signal) : (res?.content ?? '');
    const profile = (c.extensionSettings?.connectionManager?.profiles || []).find(p => p.id === id);
    return { text, model: profile?.model || '', streamed: stream };
  }
  // 跟随酒馆：generateRaw 不带预设里的提示词条目，只用当前 API 和采样参数；不流式
  const text = await c.generateRaw({ prompt: messages, responseLength: maxTokens, trimNames: false });
  let model = '';
  try { model = c.mainApi === 'openai' ? c.getChatCompletionModel?.() : c.onlineStatus; } catch { /* ignore */ }
  return { text: String(text || ''), model: model && model !== 'no_connection' ? String(model) : '', streamed: false };
}

/** 「走酒馆预设」：用酒馆自己的生成流程（预设里的破限/文风、角色卡、世界书、聊天记录都由酒馆拼），小剧场只补前置和 <Brief>。不流式 */
export async function callQuiet(prompt) {
  const c = ctx();
  if (typeof c.generateQuietPrompt !== 'function') throw new Error('这个酒馆版本不支持「走酒馆预设」，换回「插件自己拼」。');
  // 回复长度占掉上下文的话，酒馆会把前面的内容全挤掉；最多给上下文的一半
  const maxCtx = Number(c.mainApi === 'openai' ? c.chatCompletionSettings?.openai_max_context : c.maxContext) || 0;
  const want = Math.max(256, Number(state.settings.maxTokens) || 4096);
  const responseLength = maxCtx ? Math.max(256, Math.min(want, Math.floor(maxCtx / 2))) : want;
  const text = await c.generateQuietPrompt({ quietPrompt: prompt, responseLength, removeReasoning: true });
  if (text == null) throw new Error('酒馆没有出结果：先在酒馆里连上 API（插头图标），或者这个小剧场改回「插件自己拼」。');
  let model = '';
  try { model = c.mainApi === 'openai' ? c.getChatCompletionModel?.() : c.onlineStatus; } catch { /* ignore */ }
  return { text: String(text || ''), model: model && model !== 'no_connection' ? String(model) : '', streamed: false };
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
