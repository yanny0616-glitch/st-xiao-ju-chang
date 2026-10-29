// 导入导出：本插件整包、Float 小剧场 APP 整包（自动换算字段）、「## 标题 #标签」纯文本、其它 JSON 扫段落
import { uid, clone } from './util.js';
import { state, save, saveAll, LIBRARY } from './store.js';
import { scanLooseJson } from './scan.js';
import { partsOf, comboPromptIds, newPart } from './parts.js';

export const APP_ID = 'st.xiaojuchang';
const strip = r => { const { createdAt, updatedAt, ...rest } = r; return rest; };

export function exportBundle({ withApis = false, withFavorites = true } = {}) {
  return {
    app: APP_ID, version: 1, exportedAt: new Date().toISOString(),
    preambles: state.preambles.map(strip), prompts: state.prompts.map(strip), randoms: state.randoms.map(strip),
    macros: state.macros.map(strip), combos: state.combos.map(strip), themes: state.themes.map(strip),
    ...(withFavorites ? { favorites: clone(state.favorites) } : {}),
    ...(withApis ? { apis: clone(state.apis) } : {}),
  };
}
export function exportCombo(combo) {
  const ids = new Set(comboPromptIds(combo));
  return {
    app: APP_ID, version: 1, kind: 'combo',
    combos: [strip(combo)], preambles: state.preambles.filter(p => p.id === combo.preambleId).map(strip),
    prompts: state.prompts.filter(p => ids.has(p.id)).map(strip),
    randoms: combo.random?.count ? state.randoms.map(strip) : [],
    macros: state.macros.map(strip),
  };
}

const str = (v, max = 20000) => (typeof v === 'string' ? v.slice(0, max) : '');
const tags = v => (Array.isArray(v) ? v.filter(t => typeof t === 'string' && t.trim()).map(t => t.trim().slice(0, 30)).slice(0, 20) : []);
const num = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

/** Float 小剧场的组合：记忆三选一换成聊天上下文；写回记忆改成写进聊天的世界书；纯裸通道就是本插件默认的「自己拼」 */
function normalizeCombo(c) {
  // 上下文 / 身份 / 通道 / 写回 / HTML 风格 / 分两步：空着 = 跟随全局。Float 的「跟宿主记忆」也当跟随全局
  const mem = c.memory || {};
  const context = c.context && typeof c.context === 'object' ? c.context
    : mem.mode === 'none' ? { chat: 'none', rounds: 12, worldInfo: true, summary: false }
    : mem.mode === 'recent' ? { chat: 'recent', rounds: mem.rounds || 12, worldInfo: true, summary: true } : null;
  const o = c.output || {};
  // 旧版随机里只选了提示词分组：那部分已经换成一段随机，随机池就不再抽
  const oldGroups = Array.isArray(c.random?.groups) ? c.random.groups : [];
  const movedOut = !Array.isArray(c.parts) && oldGroups.length > 0 && oldGroups.every(g => String(g).startsWith('prompts/'));
  return {
    id: str(c.id, 80), name: str(c.name, 60) || '未命名', tags: tags(c.tags),
    preambleId: str(c.preambleId, 80),
    // 段：每段 items 是 'p:提示词id' 或 'g:分组名'，pick 0 = 全用，n = 随机抽 n 条。旧的 promptIds 换成一段
    parts: partsOf(c).slice(0, 20).map(pt => ({ ...newPart(), id: str(pt.id, 80) || newPart().id, name: str(pt.name, 30), pick: num(pt.pick, 0, 0, 20), items: (Array.isArray(pt.items) ? pt.items : []).map(String).filter(x => /^[pg]:/.test(x)).slice(0, 100) })),
    // groups：从随机池哪些分组里抽，'randoms/组名'；空 = 整个随机池（旧版选的提示词分组已经换成段）
    random: { count: movedOut ? 0 : num(c.random?.count, 0, 0, 5), include: tags(c.random?.include), exclude: tags(c.random?.exclude), groups: (Array.isArray(c.random?.groups) ? c.random.groups : []).map(String).filter(g => /^randoms\/.{1,30}$/.test(g)).slice(0, 30) },
    output: {
      mode: ['text', 'html', 'mixed'].includes(o.mode) ? o.mode : 'text', wrapTag: /^[a-zA-Z][\w-]{0,30}$/.test(o.wrapTag || '') ? o.wrapTag : '',
      length: ['default', 'short', 'medium', 'long', 'custom'].includes(o.length) ? o.length : 'default', customChars: num(o.customChars, 900, 50, 20000),
      style: ['free', 'vars', 'strict'].includes(o.style) ? o.style : '', staged: typeof o.staged === 'boolean' ? o.staged : null,
    },
    context: context ? { chat: context.chat === 'none' ? 'none' : 'recent', rounds: num(context.rounds, 12, 1, 100), worldInfo: context.worldInfo !== false, summary: context.summary !== false } : null,
    who: c.who === 'observer' ? 'none' : ['persona', 'custom', 'none'].includes(c.who) ? c.who : '', whoText: str(c.whoText, 2000),
    channel: ['own', 'preset'].includes(c.channel) ? c.channel : '', writeBack: typeof c.writeBack === 'boolean' ? c.writeBack : null,
    plays: num(c.plays && typeof c.plays === 'object' ? Object.values(c.plays).reduce((a, x) => a + (Number(x) || 0), 0) : c.plays ?? c.useCount, 0, 0, 1e9), lastUsedAt: str(c.lastUsedAt, 40),
    api: typeof c.api === 'string' ? c.api : '', weight: num(c.weight, 1, 0, 100),
  };
}
const normalizers = {
  preambles: r => ({ id: str(r.id, 80), name: str(r.name, 60) || '未命名', content: str(r.content) }),
  prompts: r => ({ id: str(r.id, 80), title: str(r.title, 60) || '未命名', tags: tags(r.tags), group: str(r.group, 30), content: str(r.content) }),
  randoms: r => ({ id: str(r.id, 80), title: str(r.title, 60) || '未命名', tags: tags(r.tags), group: str(r.group, 30), content: str(r.content) }),
  macros: r => ({
    id: str(r.id, 80), name: str(r.name, 30) || '未命名', kind: r.kind === 'number' ? 'number' : 'words',
    values: Array.isArray(r.values) ? r.values.filter(v => typeof v === 'string').slice(0, 500) : [], min: num(r.min, 1, -1e6, 1e6), max: num(r.max, 10, -1e6, 1e6),
  }),
  combos: normalizeCombo,
  themes: r => ({ id: str(r.id, 80), name: str(r.name, 40) || '自定义主题', base: str(r.base, 20) || 'magazine', css: str(r.css, 200000), canvasCss: str(r.canvasCss, 100000) }),
  apis: r => ({ id: str(r.id, 80), name: str(r.name, 60), format: ['openai', 'claude', 'gemini'].includes(r.format) ? r.format : 'openai', url: str(r.url, 500), key: str(r.key, 500), model: str(r.model, 200), temperature: num(r.temperature, 1, 0, 2), maxTokens: num(r.maxTokens, 4096, 64, 200000), stream: r.stream !== false }),
};

/** 合并导入：同 id 覆盖，没有的新增；组合里的引用按新 id 改写。返回条数 */
export async function importBundle(data) {
  if (!data || typeof data !== 'object') throw new Error('不是有效的导出文件。');
  const idMap = Object.create(null);
  let n = 0;
  for (const name of ['preambles', 'prompts', 'randoms', 'macros', 'apis', 'themes', 'combos']) {
    const rows = Array.isArray(data[name]) ? data[name] : [];
    for (const raw of rows) {
      if (!raw || typeof raw !== 'object') continue;
      const row = normalizers[name](raw);
      if (name === 'combos') {
        row.preambleId = idMap[row.preambleId] || row.preambleId;
        for (const pt of row.parts) pt.items = pt.items.map(it => (it.startsWith('p:') && idMap[it.slice(2)] ? `p:${idMap[it.slice(2)]}` : it));
      }
      const srcId = row.id;
      const keep = srcId && state[name].some(x => x.id === srcId);
      if (!keep) row.id = uid(name.slice(0, 3));
      if (srcId) idMap[srcId] = row.id;
      const i = state[name].findIndex(x => x.id === row.id);
      if (i >= 0) state[name][i] = { ...state[name][i], ...row, updatedAt: new Date().toISOString() };
      else state[name].push({ ...row, createdAt: new Date().toISOString() });
      n++;
    }
  }
  if (Array.isArray(data.favorites)) {
    for (const f of data.favorites) {
      if (!f || typeof f !== 'object' || !Array.isArray(f.segments)) continue;
      if (state.favorites.some(x => x.id === f.id)) continue;
      state.favorites.push({ ...f, id: f.id || uid('f'), createdAt: f.createdAt || new Date().toISOString() });
      n++;
    }
  }
  await saveAll();
  return n;
}

export function isOwnBundle(data) {
  return data && typeof data === 'object' && (data.app === APP_ID || data.app === 'float.xiaojuchang');
}

/** 「## 标题 #标签」开头的纯文本，一块一条 */
export function parseTextBlocks(text) {
  const out = [];
  for (const b of String(text || '').split(/^##\s*/m).map(s => s.trim()).filter(Boolean)) {
    const nl = b.indexOf('\n');
    const head = nl < 0 ? b : b.slice(0, nl);
    const content = nl < 0 ? '' : b.slice(nl + 1).trim();
    const t = [...head.matchAll(/#(\S+)/g)].map(m => m[1]);
    const title = head.replace(/#\S+/g, '').trim();
    if (title && content) out.push({ title, tags: t, content });
  }
  return out;
}

/** 暗柜「夜间档案」：单个档案、{templateSnapshot} 包着的、或一组 */
function darkArchives(data) {
  const one = t => { const src = t && typeof t === 'object' && t.templateSnapshot ? t.templateSnapshot : t; return src && typeof src === 'object' && typeof src.aiInstruction === 'string' && src.aiInstruction.trim() ? src : null; };
  const list = Array.isArray(data) ? data.map(one) : [one(data)];
  return list.length && list.every(Boolean) ? list : null;
}

/** 世界书条目 → 挑选列表的一行：名字用标题，带上开关和蓝绿灯 */
export const bookRow = e => ({
  name: String(e.comment || e.name || (e.key || e.keys || []).join('、') || `条目 ${e.uid ?? ''}`).trim().slice(0, 60),
  content: String(e.content).trim(), off: !!e.disable || e.enabled === false, lamp: e.constant ? 'constant' : e.vectorized ? 'vectorized' : 'normal',
});
/** 酒馆导出的世界书文件，按酒馆里的显示顺序。角色卡不算：卡里除了世界书还有别的段落，走通用扫描 */
function worldBook(data) {
  const raw = data?.entries && typeof data.entries === 'object' ? Object.values(data.entries) : [];
  const list = raw.filter(e => e && typeof e === 'object' && typeof e.content === 'string' && e.content.trim() && Array.isArray(e.key || e.keys));
  if (!list.length || list.length < raw.length / 2) return null;
  const at = e => e.displayIndex ?? e.uid ?? 0;
  return list.sort((x, y) => at(x) - at(y)).map(bookRow);
}

/** 返回 { bundle } 或 { dark: [...] } 或 { book: [...] } 或 { rows: [{title, tags, content}] } 或 { loose: [...] } */
export function classifyJson(data) {
  if (isOwnBundle(data)) return { bundle: data };
  const dark = darkArchives(data);
  if (dark) return { dark };
  const book = worldBook(data);
  if (book) return { book };
  if (Array.isArray(data) && data.length && data.every(t => t && typeof t.title === 'string' && typeof t.content === 'string')) {
    return { rows: data.map(t => ({ title: t.title, tags: tags(t.tags), content: t.content })) };
  }
  const found = scanLooseJson(data);
  if (!found.length) throw new Error('这个 JSON 里没找到像提示词的段落。');
  return { loose: found };
}

/** 加进某个库，返回新建的条目 */
export async function addRows(kind, rows, extra = {}) {
  const made = [];
  for (const r of rows) {
    const row = kind === 'preambles'
      ? { id: uid('pre'), name: String(r.title || r.name).slice(0, 60), content: r.content, createdAt: new Date().toISOString() }
      : { id: uid(kind.slice(0, 3)), title: String(r.title || r.name).slice(0, 60), tags: r.tags || [], group: String(extra.group || r.group || '').trim().slice(0, 30), content: r.content, createdAt: new Date().toISOString() };
    state[kind].push(row);
    made.push(row);
  }
  await save(kind);
  return made;
}

/** 批量建小剧场：每条提示词各建一个，用默认前置，其余设置走默认 */
export async function combosFromPrompts(prompts, extra = {}) {
  const pre = state.settings.defaultPreambleId || state.preambles[0]?.id || '';
  for (const p of prompts) {
    const c = normalizeCombo({ name: p.title, tags: p.tags, preambleId: pre, promptIds: [p.id], weight: 1, ...extra });
    c.id = uid('com');
    c.createdAt = new Date().toISOString();
    state.combos.push(c);
  }
  await save('combos');
  return prompts.length;
}

/** 暗柜档案 → 剧情指令 + 输出契约两条提示词 + 一个小剧场（混排输出） */
export async function importDarkArchives(list) {
  let n = 0;
  for (const src of list) {
    const title = String(src.title || '暗柜档案').trim().slice(0, 50);
    const rows = [{ title: `${title} · 剧情指令`, tags: ['暗柜', '场景'], content: String(src.aiInstruction) }];
    if (typeof src.outputContract === 'string' && src.outputContract.trim()) rows.push({ title: `${title} · 输出契约`, tags: ['暗柜', '形式'], content: src.outputContract });
    const made = await addRows('prompts', rows);
    const c = normalizeCombo({
      name: title, tags: ['暗柜', ...tags(src.tags).slice(0, 4)], preambleId: state.settings.defaultPreambleId || state.preambles[0]?.id || '',
      promptIds: made.map(r => r.id), output: { mode: 'mixed' }, weight: 2,
    });
    c.id = uid('com');
    c.createdAt = new Date().toISOString();
    state.combos.push(c);
    n++;
  }
  await save('combos');
  return n;
}

export function clearLibrary() {
  for (const name of LIBRARY) if (name !== 'apis' && name !== 'themes') state[name] = [];
}
