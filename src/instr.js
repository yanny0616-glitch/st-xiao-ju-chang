// 内置指令：<Brief> 里插件自己加的那些话（输出格式、身份、标题、篇幅…）。都能在「设置 → 生成 → 内置指令」里改，改过的存在 settings.instr
import { state } from './store.js';

export const INSTR = [
  { group: '输出形式', key: 'outText', label: '纯文字', text: '只输出纯文字正文，不要 HTML、不要 markdown 标题、不要代码块。' },
  { group: '输出形式', key: 'outHtml', label: 'HTML', text: '整体输出为一段 HTML（不要 markdown 围栏、不要任何 HTML 之外的说明文字）。' },
  { group: '输出形式', key: 'outMixed', label: '混排', text: '允许 HTML 与纯文字混排：HTML 部分用 ```html 围栏包裹，文字部分直接写；两者之间空一行。' },
  { group: '输出形式', key: 'styleVars', label: 'HTML 风格 · 给主题变量', text: '样式提示：页面外层已定义 CSS 变量 --xjc-bg（底色）--xjc-ink（文字）--xjc-acc（强调色）--xjc-line（细线）--xjc-font（字体），优先使用它们，让画面和小剧场当前的主题协调；其余自由发挥。' },
  { group: '输出形式', key: 'styleStrict', label: 'HTML 风格 · 严格只用主题色', text: '样式约束：颜色只能使用 CSS 变量 --xjc-bg --xjc-ink --xjc-acc --xjc-line（可用 color-mix 或透明度派生），字体只用 --xjc-font；不得自带其他颜色值。' },
  { group: '输出形式', key: 'length', label: '篇幅', text: '篇幅约 {字数} 字（HTML 里只算可见文字）。', vars: ['字数'] },
  { group: '输出形式', key: 'wrap', label: '标签包裹', text: '把全部输出包在 <{标签}></{标签}> 标签内，标签外不要有任何内容。', vars: ['标签'] },
  { group: '输出形式', key: 'title', label: '标题', text: '给这一篇起一个不超过 12 字的标题，放在最前面一行，格式：标题：xxx', note: '插件靠「标题：」这一行取标题，改的时候保留这个格式。' },

  { group: '身份', key: 'whoPersona', label: '我的人设（酒馆里写了人设描述）', text: '故事里的「{用户}」就是用户本人，沿用前面给出的用户人设。', vars: ['用户'] },
  { group: '身份', key: 'whoPersonaBare', label: '我的人设（酒馆里没写人设描述）', text: '故事里的「{用户}」就是用户本人。', vars: ['用户'] },
  { group: '身份', key: 'whoCustom', label: '自定身份', text: '用户在这篇里的身份：{身份}。忽略前面的用户人设。', vars: ['身份'], note: '没写身份时，{身份} 是「由你根据场景安排」。' },
  { group: '身份', key: 'whoNone', label: '旁观', text: '用户不出场，只作为旁观者阅读。全篇不要出现「{用户}」这个人，重点写 {角色} 与其他人。', vars: ['用户', '角色'] },

  { group: '分两步出', key: 'shell', label: '第一步：骨架', text: '这一步只做页面骨架，不写正文。输出一段完整可渲染的 HTML（含 style 与 script），把所有将来要放文字的位置用空的占位元素标出来：<span data-slot="1" data-hint="这里放什么、大约多少字"></span>，编号从 1 递增，占位元素内部留空、不要嵌套占位。栏目名、用户名、时间戳、按钮文字这类界面文字直接写死。占位数量按内容需要，通常 5～40 个。不要 markdown 围栏、不要任何 HTML 之外的说明文字。', note: '插件按 data-slot="编号" 找占位，改的时候保留。' },
  { group: '分两步出', key: 'fill', label: '第二步：填字', text: '只输出各占位的文字。格式严格：每段以单独一行 [[编号]] 开头，从下一行起是该处的文字，可用 <br> 换行，不要任何其它 HTML、不要 markdown、不要解释；每个编号都要给到，按编号顺序，不要多不要少。', note: '插件按 [[编号]] 拆开填回去，改的时候保留这个格式。' },
  { group: '分两步出', key: 'fillLength', label: '第二步：篇幅', text: '全部占位的文字合计约 {字数} 字。', vars: ['字数'] },

  { group: '拼提示词', key: 'combine', label: '几条提示词合成一篇', text: '下面这几条要求合在一起，写成同一篇，不是几个分开的任务；不要拆成几篇写。', note: '小剧场里用到两条以上提示词时加在最前面。' },

  { group: '接着写 / 追问', key: 'followWrite', label: '接着写', text: '前面已经写好的小剧场：\n{前文}\n\n接着最后这一篇往下写新的一篇，人物、情境和形式都延续下去，不要重复已经写过的内容。用户这次的要求：{要求}', vars: ['前文', '要求'] },
  { group: '接着写 / 追问', key: 'followAsk', label: '追问', text: '前面已经写好的小剧场：\n{前文}\n\n用户看完最后这一篇，接着问：{要求}\n顺着这一篇的情境来回答，由小剧场里的人来回应，不要跳出来解释或分析。', vars: ['前文', '要求'] },

  { group: '其他', key: 'tail', label: '挂在楼层下出', text: '【接在聊天后面】这一篇挂在刚才这条消息下面，内容要和这条消息里刚发生的事有关，可以是它的番外、旁观视角或另一种呈现，但不要复述原文。', note: '「设置 → 聊天内」可以关掉，关了楼层下出的就不带这句。' },
  { group: '其他', key: 'continue', label: '点了小剧场里的按钮接着写', text: '上一篇正文：\n{上一篇}\n\n用户在上一篇里选择了「{选择}」，接着这个选择往下写新的一篇。', vars: ['上一篇', '选择'] },
  { group: '其他', key: 'aiPick', label: 'AI 自选', text: '从下面的形式里自选一种最适合当前关系与最近发生的事的，严格按那一条的形式要求写；场景可从「{场景}」里挑，也可以自创。\n{菜单}\n先在标题行之后用一行注明「形式：xxx」。', vars: ['场景', '菜单'], note: '菜单是带「形式」标签的提示词（一条都没有时用全部提示词），场景是带「场景」标签的提示词标题。' },
];
const BY_KEY = Object.fromEntries(INSTR.map(x => [x.key, x]));

export const instrDefault = key => BY_KEY[key]?.text ?? '';
export const instrEdited = key => typeof state.settings.instr?.[key] === 'string' && state.settings.instr[key] !== instrDefault(key);

/** 取一条指令（用户改过就用改过的），把 {变量} 换掉 */
export function instr(key, vars = {}) {
  const own = state.settings.instr?.[key];
  const text = typeof own === 'string' ? own : instrDefault(key);
  return text.replace(/\{([^{}\s]{1,6})\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}
