// 写完提醒：页面在后台时发系统通知（浏览器允许的话；不允许就等回到页面再补一条提示），
// 在页面上但看不到这篇（面板关着、不在舞台）时弹一条可点的提示
import { state } from './store.js';

const on = () => state.settings.notifyDone !== false;
let missed = [];

/** 点「生成」时顺手问一次通知权限（浏览器要求在点击里问） */
export function askNotifyPermission() {
  if (!on()) return;
  try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {}); } catch { /* ignore */ }
}

function popToast(text, open) {
  if (!window.toastr) return;
  window.toastr.success(text, '小剧场写好了', { onclick: open, timeOut: 8000, extendedTimeOut: 4000 });
}

/** seen：用户此刻是不是正看着这篇；open：点通知后去哪 */
export function notifyDone(title, { seen = false, open = () => {} } = {}) {
  if (!on()) return;
  const text = `《${title || '小剧场'}》${seen ? '' : '，点这里看'}`;
  if (!document.hidden) { if (!seen) popToast(text, open); return; }
  let shown = false;
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      const n = new Notification('小剧场写好了', { body: `《${title || '小剧场'}》`, tag: 'xjc-done' });
      n.onclick = () => { try { window.focus(); } catch { /* ignore */ } open(); n.close(); };
      shown = true;
    }
  } catch { /* 有的 WebView 没有 Notification */ }
  if (!shown) missed.push({ text: `《${title || '小剧场'}》，点这里看`, open });
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden || !missed.length) return;
  const list = missed;
  missed = [];
  if (list.length === 1) popToast(list[0].text, list[0].open);
  else popToast(`写好了 ${list.length} 篇，点这里看最新一篇`, list[list.length - 1].open);
});
