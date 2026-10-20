// 写好了提醒：用酒馆自己的提示（顶上弹出的那种，位置跟着酒馆的设置）。人在酒馆里但看不到这篇时（面板关着、不在舞台、楼层不在屏幕上）弹一条，点了去看；
// 页面在后台时提示会在看不到的时候就消失，所以先记着，回到页面再弹
import { state } from './store.js';

const on = () => state.settings.notifyDone !== false;
let missed = [];

function popToast(text, open) {
  if (!window.toastr) return;
  window.toastr.success(text, '小剧场写好了', { onclick: open, timeOut: 8000, extendedTimeOut: 4000 });
}

/** seen：用户此刻是不是正看着这篇；open：点提示后去哪 */
export function notifyDone(title, { seen = false, open = () => {} } = {}) {
  if (!on()) return;
  const text = `《${title || '小剧场'}》，点这里看`;
  if (document.hidden) missed.push({ text, open });
  else if (!seen) popToast(text, open);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden || !missed.length) return;
  const list = missed;
  missed = [];
  if (list.length === 1) popToast(list[0].text, list[0].open);
  else popToast(`写好了 ${list.length} 篇，点这里看最新一篇`, list[list.length - 1].open);
});
