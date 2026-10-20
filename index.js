// 小剧场 · SillyTavern / TauriTavern 扩展入口
import { ctx, el, fail } from './src/util.js';
import { state, load, setSetting } from './src/store.js';
import * as panel from './src/panel.js';
import { initChat } from './src/chat.js';

function addWandItem() {
  const menu = document.getElementById('extensionsMenu');
  if (!menu || document.getElementById('xjc_wand')) return;
  const item = el('div', 'list-group-item flex-container flexGap5 interactable');
  item.id = 'xjc_wand';
  item.tabIndex = 0;
  item.innerHTML = '<div class="fa-solid fa-masks-theater extensionsMenuExtension"></div><span>小剧场</span>';
  item.addEventListener('click', () => panel.open('stage'));
  menu.appendChild(item);
}

function addSettingsDrawer() {
  const host = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
  if (!host || document.getElementById('xjc_settings')) return;
  const wrap = el('div', 'xjc-settings');
  wrap.id = 'xjc_settings';
  wrap.innerHTML = `
    <div class="inline-drawer">
      <div class="inline-drawer-toggle inline-drawer-header">
        <b><i class="fa-solid fa-masks-theater"></i> 小剧场</b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
      </div>
      <div class="inline-drawer-content">
        <div class="xjc-drawer-row"><div class="menu_button menu_button_icon" id="xjc_open"><i class="fa-solid fa-masks-theater"></i><span>打开小剧场</span></div></div>
        <label class="checkbox_label"><input type="checkbox" id="xjc_btn_toggle"><span>消息菜单里加面具按钮（为这条出一篇）</span></label>
        <label class="checkbox_label"><input type="checkbox" id="xjc_auto_toggle"><span>AI 回复后自动出一篇小剧场</span></label>
        <small>也可以从输入框左边的魔杖菜单打开。其余设置在面板的「设置」里。</small>
      </div>
    </div>`;
  host.appendChild(wrap);
  wrap.querySelector('#xjc_open').addEventListener('click', () => panel.open('stage'));
  const btnT = wrap.querySelector('#xjc_btn_toggle');
  const autoT = wrap.querySelector('#xjc_auto_toggle');
  const sync = () => { btnT.checked = !!state.settings.tail.button; autoT.checked = !!state.settings.tail.auto; };
  sync();
  btnT.addEventListener('change', () => { setSetting({ tail: { ...state.settings.tail, button: btnT.checked } }); document.dispatchEvent(new CustomEvent('xjc-settings')); });
  autoT.addEventListener('change', () => setSetting({ tail: { ...state.settings.tail, auto: autoT.checked } }));
  document.addEventListener('xjc-settings', sync);
}

async function init() {
  try {
    if (window.__TAURITAVERN__) {
      try { await (window.__TAURITAVERN__.ready ?? window.__TAURITAVERN_MAIN_READY__); } catch { /* ignore */ }
    }
    await load();
    addWandItem();
    addSettingsDrawer();
    initChat();
    const c = ctx();
    c.eventSource.on(c.eventTypes.CHAT_CHANGED, () => setTimeout(panel.refresh, 0));
    window.XiaoJuChang = { open: panel.open, close: panel.close };
  } catch (e) {
    fail(e);
  }
}

// 第三方扩展可能在 APP_READY 之后才加载；APP_READY 会对晚注册的监听自动补发
const c = ctx();
c.eventSource.on(c.eventTypes.APP_READY, init);
