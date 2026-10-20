// 导入导出：本插件整包、Float 小剧场 APP 整包（自动换算字段）、「## 标题 #标签」纯文本、其它 JSON 扫段落
import { uid, clone } from './util.js';
import { state, save, saveAll, LIBRARY } from './store.js';
import { scanLooseJson } from './scan.js';

export const APP_ID = 'st.xiaojuchang';
const strip = r => { const { createdAt, updatedAt, ...rest } = r; return rest; };

export function exportBundle({ withApis = false, withFavorites = true } = {}) {
  return {
    app: APP_ID, version: 1, exportedAt: new Date().toISOString(),
    preambles: state.preambles.map(strip), prompts: state.prompts.map(strip), randoms: state.randoms.map(strip),
    macros: state.macros.map(strip), combos: state.combos.map(strip),
    ...(withFavorites ? { favorites: clone(state.favorites) } : {}),
    ...(withApis ? { apis: clone(state.apis) } : {}),
  };
}
export function exportCombo(combo) {
  const ids = new Set(combo.promptIds || []);
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

/** Float 小剧场的组合：记忆三选一换成聊天上下文；写回记忆、纯裸通道在酒馆里没有对应，丢掉 */
function normalizeCombo(c) {
  const mem = c.memory || {};
  const context = c.context && typeof c.context === 'object' ? c.context : {
    chat: mem.mode === 'none' ? 'none' : 'recent', rounds: mem.rounds || 12, worldInfo: true, summary: mem.mode !== 'none',
  };
  const o = c.output || {};
  return {
    id: str(c.id, 80), name: str(c.name, 60) || '未命名', tags: tags(c.tags),
    preambleId: str(c.preambleId, 80), promptIds: Array.isArray(c.promptIds) ? c.promptIds.filter(x => typeof x === 'string') : [],
    random: { count: num(c.random?.count, 0, 0, 5), include: tags(c.random?.include), exclude: tags(c.random?.exclude) },
    output: {
      mode: ['text', 'html', 'mixed'].includes(o.mode) ? o.mode : 'text', wrapTag: /^[a-zA-Z][\w-]{0,30}$/.test(o.wrapTag || '') ? o.wrapTag : '',
      length: ['default', 'short', 'medium', 'long', 'custom'].includes(o.length) ? o.length : 'default', customChars: num(o.customChars, 900, 50, 20000),
      style: ['free', 'vars', 'strict'].includes(o.style) ? o.style : 'free', staged: !!o.staged,
    },
    context: { chat: context.chat === 'none' ? 'none' : 'recent', rounds: num(context.rounds, 12, 1, 100), worldInfo: context.worldInfo !== false, summary: context.summary !== false },
    who: ['persona', 'custom', 'none'].includes(c.who) ? c.who : 'persona', whoText: str(c.whoText, 2000),
    api: typeof c.api === 'string' ? c.api : '', weight: num(c.weight, 1, 0, 100),
  };
}
const normalizers = {
  preambles: r => ({ id: str(r.id, 80), name: str(r.name, 60) || '未命名', content: str(r.content) }),
  prompts: r => ({ id: str(r.id, 80), title: str(r.title, 60) || '未命名', tags: tags(r.tags), content: str(r.content) }),
  randoms: r => ({ id: str(r.id, 80), title: str(r.title, 60) || '未命名', tags: tags(r.tags), content: str(r.content) }),
  macros: r => ({
    id: str(r.id, 80), name: str(r.name, 30) || '未命名', kind: r.kind === 'number' ? 'number' : 'words',
    values: Array.isArray(r.values) ? r.values.filter(v => typeof v === 'string').slice(0, 500) : [], min: num(r.min, 1, -1e6, 1e6), max: num(r.max, 10, -1e6, 1e6),
  }),
  combos: normalizeCombo,
  apis: r => ({ id: str(r.id, 80), name: str(r.name, 60), format: ['openai', 'claude', 'gemini'].includes(r.format) ? r.format : 'openai', url: str(r.url, 500), key: str(r.key, 500), model: str(r.model, 200), temperature: num(r.temperature, 1, 0, 2), maxTokens: num(r.maxTokens, 4096, 64, 200000), stream: r.stream !== false }),
};

/** 合并导入：同 id 覆盖，没有的新增；组合里的引用按新 id 改写。返回条数 */
export async function importBundle(data) {
  if (!data || typeof data !== 'object') throw new Error('不是有效的导出文件。');
  const idMap = Object.create(null);
  let n = 0;
  for (const name of ['preambles', 'prompts', 'randoms', 'macros', 'apis', 'combos']) {
    const rows = Array.isArray(data[name]) ? data[name] : [];
    for (const raw of rows) {
      if (!raw || typeof raw !== 'object') continue;
      const row = normalizers[name](raw);
      if (name === 'combos') {
        row.preambleId = idMap[row.preambleId] || row.preambleId;
        row.promptIds = row.promptIds.map(id => idMap[id] || id);
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

/** 返回 { bundle } 或 { rows: [{title, tags, content}] } 或 { loose: [...] } */
export function classifyJson(data) {
  if (isOwnBundle(data)) return { bundle: data };
  if (Array.isArray(data) && data.length && data.every(t => t && typeof t.title === 'string' && typeof t.content === 'string')) {
    return { rows: data.map(t => ({ title: t.title, tags: tags(t.tags), content: t.content })) };
  }
  const found = scanLooseJson(data);
  if (!found.length) throw new Error('这个 JSON 里没找到像提示词的段落。');
  return { loose: found };
}

export function addRows(kind, rows) {
  for (const r of rows) {
    if (kind === 'preambles') state.preambles.push({ id: uid('pre'), name: String(r.title || r.name).slice(0, 60), content: r.content, createdAt: new Date().toISOString() });
    else state[kind].push({ id: uid(kind.slice(0, 3)), title: String(r.title || r.name).slice(0, 60), tags: r.tags || [], content: r.content, createdAt: new Date().toISOString() });
  }
  return save(kind);
}

export function clearLibrary() {
  for (const name of LIBRARY) if (name !== 'apis') state[name] = [];
}
