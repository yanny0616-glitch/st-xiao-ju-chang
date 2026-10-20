// 收藏：存整篇（含当时的组合快照），可以「按这套再来」
import { ctx, clone, uid } from './util.js';
import { state, save } from './store.js';

export function isFavorite(r) {
  return !!r && state.favorites.some(f => f.id === r.id);
}
/** 切换收藏，返回切换后是否已收藏 */
export function toggleFavorite(r) {
  if (!r.id) r.id = uid('r');
  if (isFavorite(r)) {
    state.favorites = state.favorites.filter(f => f.id !== r.id);
    save('favorites');
    return false;
  }
  state.favorites.push({ ...clone(r), favoritedAt: new Date().toISOString() });
  save('favorites');
  return true;
}

/**
 * 这条消息当前这个回复（swipe）下的小剧场。酒馆生成新回复时会把消息的 extra 原样带过去，
 * 所以每篇记下自己属于第几个回复（swipe），别的回复带过来的不算；老数据没记的照旧显示
 */
export function ownTheaters(m) {
  const sid = Number(m?.swipe_id) || 0;
  return (Array.isArray(m?.extra?.xjc) ? m.extra.xjc : []).filter(t => t && t.id && (t.swipe == null || t.swipe === sid));
}
/** 把别的回复带过来的清掉，返回有没有清 */
export function pruneForeign(m) {
  if (!Array.isArray(m?.extra?.xjc)) return false;
  const own = ownTheaters(m);
  if (own.length === m.extra.xjc.length) return false;
  m.extra.xjc = own;
  return true;
}

/** 当前聊天里挂在消息下面的小剧场，新的在前 */
export function chatTheaters() {
  const chat = ctx().chat || [];
  const out = [];
  chat.forEach((m, mesId) => {
    for (const t of ownTheaters(m)) out.push({ mesId, theater: t });
  });
  return out.reverse();
}
