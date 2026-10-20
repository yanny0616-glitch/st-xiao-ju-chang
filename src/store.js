// 存储：TauriTavern 用宿主的扩展存储（data 目录里，随数据一起备份/同步）；
// 原版酒馆把设置和库放进 extension_settings（存在服务器 settings.json），收藏和最近放浏览器 IndexedDB（体积大，不塞进 settings.json）。
import { ctx, isTT, clone } from './util.js';
import { DEFAULT_PREAMBLES, DEFAULT_PROMPTS, DEFAULT_RANDOMS, DEFAULT_MACROS, DEFAULT_COMBOS, DEFAULT_SETTINGS } from './defaults.js';

const NS = 'xiao-ju-chang';
const ST_KEY = 'xiaoJuChang';
export const LIBRARY = ['preambles', 'prompts', 'randoms', 'macros', 'combos', 'apis'];
export const HEAVY = ['favorites', 'recent'];

export const state = {
  settings: clone(DEFAULT_SETTINGS),
  preambles: [], prompts: [], randoms: [], macros: [], combos: [], apis: [],
  favorites: [], recent: [],
};

// ── 后端 ──
let ttStore = null;
async function ttReady() {
  if (!isTT()) return null;
  if (ttStore) return ttStore;
  try { await (window.__TAURITAVERN__.ready ?? window.__TAURITAVERN_MAIN_READY__); } catch { /* ignore */ }
  ttStore = window.__TAURITAVERN__?.api?.extension?.store || null;
  return ttStore;
}

let idbP = null;
function idb() {
  if (idbP) return idbP;
  idbP = new Promise((resolve, reject) => {
    const req = indexedDB.open('st-xiao-ju-chang', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return idbP;
}
async function idbGet(key) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const r = db.transaction('kv').objectStore('kv').get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idbSet(key, value) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function stBag() {
  const all = ctx().extensionSettings;
  if (!all[ST_KEY] || typeof all[ST_KEY] !== 'object') all[ST_KEY] = {};
  return all[ST_KEY];
}

async function readKey(key) {
  const store = await ttReady();
  if (store) {
    const r = await store.tryGetJson({ namespace: NS, key });
    return r && r.found ? r.value : undefined;
  }
  if (HEAVY.includes(key)) return idbGet(key);
  return clone(stBag()[key]);
}

const queues = new Map();
function writeKey(key, value) {
  const prev = queues.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(async () => {
    const store = await ttReady();
    if (store) return store.setJson({ namespace: NS, key, value });
    if (HEAVY.includes(key)) return idbSet(key, value);
    stBag()[key] = value;
    ctx().saveSettingsDebounced();
  });
  queues.set(key, next);
  return next;
}

export function backendName() {
  return isTT() ? 'TauriTavern 扩展存储' : '酒馆设置 + 浏览器本地（收藏/最近）';
}

// ── 读写 ──
export async function load() {
  const s = await readKey('settings');
  state.settings = { ...clone(DEFAULT_SETTINGS), ...(s && typeof s === 'object' ? s : {}) };
  state.settings.tail = { ...DEFAULT_SETTINGS.tail, ...(s && s.tail) };
  for (const name of [...LIBRARY, ...HEAVY]) {
    const v = await readKey(name);
    state[name] = Array.isArray(v) ? v.filter(x => x && typeof x === 'object' && x.id) : [];
  }
  if (!state.settings.seeded) {
    seedDefaults(false);
    state.settings.seeded = true;
    await saveAll();
  }
}

export function save(name) {
  if (name === 'settings') return writeKey('settings', state.settings);
  if (name === 'recent') state.recent = state.recent.slice(0, Math.max(0, Number(state.settings.recentKeep) || 10));
  return writeKey(name, state[name]);
}
export async function saveAll() {
  await Promise.all(['settings', ...LIBRARY, ...HEAVY].map(save));
}
export function setSetting(patch) {
  Object.assign(state.settings, patch);
  return save('settings');
}

/** 补齐默认库：按 id 和标题比对，已有的跳过；force=false 时只在首启调用 */
export function seedDefaults(force) {
  const add = (name, rows, key) => {
    let n = 0;
    for (const row of rows) {
      if (state[name].some(x => x.id === row.id || (x[key] && x[key] === row[key]))) continue;
      state[name].push({ ...clone(row), createdAt: new Date().toISOString() });
      n++;
    }
    return n;
  };
  let n = 0;
  n += add('preambles', DEFAULT_PREAMBLES, 'name');
  n += add('prompts', DEFAULT_PROMPTS, 'title');
  n += add('randoms', DEFAULT_RANDOMS, 'title');
  n += add('macros', DEFAULT_MACROS, 'name');
  n += add('combos', DEFAULT_COMBOS, 'name');
  if (force) saveAll();
  return n;
}

export function upsert(name, row) {
  const list = state[name];
  const i = list.findIndex(x => x.id === row.id);
  const now = new Date().toISOString();
  if (i >= 0) list[i] = { ...list[i], ...row, updatedAt: now };
  else list.push({ ...row, createdAt: row.createdAt || now });
  save(name);
  return i >= 0 ? list[i] : list[list.length - 1];
}
export function remove(name, id) {
  state[name] = state[name].filter(x => x.id !== id);
  return save(name);
}
