// 「跟随全局」：小剧场里这几项留空（null / ''）就用「设置 → 生成」里的全局值，选了才是自定
import { state, save } from './store.js';
import { byId } from './util.js';

export const WHO_LABEL = { persona: '我的人设', custom: '自定身份', none: '旁观' };
export const CHANNEL_LABEL = { own: '插件自己拼', preset: '走酒馆预设' };
export const STYLE_LABEL = { free: '不约束', vars: '给主题变量', strict: '严格只用主题色' };

export function globalContext() {
  const s = state.settings;
  return { chat: s.defaultChat === 'none' ? 'none' : 'recent', rounds: Number(s.defaultRounds) || 12, worldInfo: s.defaultWorldInfo !== false, summary: s.defaultSummary !== false };
}
export const globalWho = () => (WHO_LABEL[state.settings.defaultWho] ? state.settings.defaultWho : 'persona');
export const globalChannel = () => (state.settings.defaultChannel === 'preset' ? 'preset' : 'own');
export const globalStyle = () => (STYLE_LABEL[state.settings.defaultStyle] ? state.settings.defaultStyle : 'free');
export const globalStaged = () => !!state.settings.stagedDefault;
/** 全局的 HTML 规范：库里某条的 id，或 'none' = 不带；默认那条被删了就用第一条 */
export const globalSpec = () => { const id = state.settings.defaultSpecId; return id === 'none' ? 'none' : byId(state.specs, id) ? id : (state.specs[0]?.id || 'none'); };
export const specLabel = id => (id === 'none' ? '不带' : byId(state.specs, id)?.name || '不带');
export const globalWriteBack = () => !!state.settings.writeBackDefault;

/** 把「跟随全局」的项换成具体值（幂等）；生成和快照都用这份 */
export function resolveCombo(c) {
  const o = c.output || {};
  return {
    ...c,
    context: c.context && typeof c.context === 'object' ? c.context : globalContext(),
    who: WHO_LABEL[c.who] ? c.who : globalWho(),
    // 身份跟随全局、全局是自定身份时，小剧场自己没写身份就用全局写的
    whoText: !WHO_LABEL[c.who] && globalWho() === 'custom' && !String(c.whoText || '').trim() ? (state.settings.defaultWhoText || '') : c.whoText,
    channel: CHANNEL_LABEL[c.channel] ? c.channel : globalChannel(),
    writeBack: typeof c.writeBack === 'boolean' ? c.writeBack : globalWriteBack(),
    output: { ...o, style: STYLE_LABEL[o.style] ? o.style : globalStyle(), staged: typeof o.staged === 'boolean' ? o.staged : globalStaged(), spec: o.spec === 'none' || byId(state.specs, o.spec) ? o.spec : globalSpec() },
  };
}

/** 旧数据：和当时全局一样的值改成「跟随全局」，之后改全局就一起变。只做一次 */
export async function migrateFollow() {
  if (state.settings.followMigrated) return;
  const g = globalContext();
  const same = (a, b) => a && b && a.chat === b.chat && (a.chat === 'none' || Number(a.rounds) === Number(b.rounds)) && (a.worldInfo !== false) === b.worldInfo && (a.summary !== false) === b.summary;
  for (const c of state.combos) {
    if (same(c.context, g)) c.context = null;
    if (c.who === globalWho() && c.who !== 'custom') c.who = '';
    if (c.channel === globalChannel()) c.channel = '';
    if (c.writeBack === globalWriteBack()) c.writeBack = null;
    if (c.output) {
      if (c.output.style === globalStyle()) c.output.style = '';
      if (c.output.staged === globalStaged()) c.output.staged = null;
    }
  }
  state.settings.followMigrated = true;
  await Promise.all([save('combos'), save('settings')]);
}
