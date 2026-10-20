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

/** 当前聊天里挂在消息下面的小剧场，新的在前 */
export function chatTheaters() {
  const chat = ctx().chat || [];
  const out = [];
  chat.forEach((m, mesId) => {
    for (const t of (m?.extra?.xjc || [])) if (t && t.id) out.push({ mesId, theater: t });
  });
  return out.reverse();
}
