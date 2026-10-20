// 端到端：真酒馆 + 模拟模型。桌面 1280×860 和 iPhone 16 Pro（393×852 @3x）各跑一遍
// 用法：ST_URL=http://127.0.0.1:8123 MOCK_LOG=… SHOTS=… node tests/e2e.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ST = process.env.ST_URL || 'http://127.0.0.1:8123';
const LOG = process.env.MOCK_LOG;
const SHOTS = process.env.SHOTS || path.join(__dirname, '.work', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
let failed = 0;
const ok = (cond, msg) => { if (cond) console.log('PASS', msg); else { failed++; console.log('FAIL', msg); } };
const mockCalls = () => (LOG && fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const lastCall = () => mockCalls().slice(-1)[0];
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function boot(page) {
  await page.goto(ST, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.SillyTavern && document.getElementById('xjc_wand'), null, { timeout: 60000 });
}

async function setupData(page) {
  return page.evaluate(async () => {
    const c = SillyTavern.getContext();
    const h = c.getRequestHeaders();
    const world = {
      entries: {
        0: { uid: 0, key: [], keysecondary: [], comment: '雨城常驻', content: '雨城一年有两百天在下雨，老城区的路灯是黄色的。<char>总说<USER>是唯一不嫌雨烦的人，{{char}}会去{{user}}家楼下等。', constant: true, selective: false, order: 100, position: 0, disable: false, probability: 100, useProbability: true },
        1: { uid: 1, key: ['便利店'], keysecondary: [], comment: '便利店', content: '街角的便利店叫「晴天」，店员阿哲总在打瞌睡。', constant: false, selective: false, order: 100, position: 0, disable: false, probability: 100, useProbability: true },
      },
    };
    await fetch('/api/worldinfo/edit', { method: 'POST', headers: h, body: JSON.stringify({ name: '雨城', data: world }) });
    // 每次从干净状态开始：删掉上次的测试角色（连同聊天），清空插件数据
    const list = await (await fetch('/api/characters/all', { method: 'POST', headers: h, body: '{}' })).json();
    for (const x of list.filter(x => x.name === '林晚')) {
      await fetch('/api/characters/delete', { method: 'POST', headers: h, body: JSON.stringify({ avatar_url: x.avatar, delete_chats: true }) });
    }
    const s = await import('/scripts/extensions/third-party/st-xiao-ju-chang/src/store.js');
    for (const k of [...s.LIBRARY, ...s.HEAVY]) s.state[k] = [];
    s.state.settings = { ...s.state.settings, seeded: true, api: 'st', currentComboId: 'c_store', theme: 'magazine', canvas: 'theme', tail: { ...s.state.settings.tail, enabled: false, auto: false, button: true } };
    s.seedDefaults(false);
    await s.saveAll();
    c.saveSettingsDebounced();
    document.dispatchEvent(new CustomEvent('xjc-settings'));
    {
      const fd = new FormData();
      fd.append('ch_name', '林晚');
      fd.append('description', '林晚是{{user}}楼下的邻居，开夜班出租车，车里永远放着一把多余的伞。');
      fd.append('personality', '嘴硬心软，不爱解释，只对<user>例外');
      fd.append('scenario', '雨季的老城区');
      fd.append('first_mes', '你又没带伞？');
      fd.append('world', '雨城');
      const hh = { ...h }; delete hh['Content-Type'];
      await fetch('/api/characters/create', { method: 'POST', headers: hh, body: fd });
    }
    return true;
  });
}

async function openChar(page) {
  await page.evaluate(async () => {
    const c = SillyTavern.getContext();
    await c.getCharacters();
    const id = c.characters.findIndex(x => x.name === '林晚');
    await c.selectCharacterById(id);
  });
  await page.waitForFunction(() => document.querySelectorAll('#chat .mes').length >= 1, null, { timeout: 20000 });
  // 连上模拟接口，酒馆才显示发送按钮
  if (await page.locator('#send_but.displayNone').count()) {
    await page.evaluate(() => document.getElementById('api_button_openai')?.click());
    await page.waitForSelector('#send_but:not(.displayNone)', { timeout: 20000 });
  }
}

async function sendChat(page, text) {
  const before = await page.locator('#chat .mes').count();
  await page.fill('#send_textarea', text);
  await page.click('#send_but');
  await page.waitForFunction(n => document.querySelectorAll('#chat .mes').length >= n + 2 && !document.querySelector('#chat .mes .mes_text:empty'), before, { timeout: 30000 });
  await sleep(600);
}

const frameText = (page, sel) => page.frameLocator(sel).locator('body').innerText({ timeout: 15000 }).catch(() => '');
async function waitResult(page) {
  await page.waitForFunction(() => {
    const card = document.querySelector('.xjc-result');
    return card && card.querySelector('.xjc-ops') && !document.querySelector('.xjc-result .xjc-spin');
  }, null, { timeout: 30000 });
}

async function desktop(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && /小剧场|xjc|xiao-ju/.test(m.text())) errors.push(m.text()); });
  await boot(page);
  await setupData(page);
  await page.evaluate(() => window.XiaoJuChang.open('stage'));
  await page.waitForSelector('.xjc-root:not([hidden]) .xjc-actions');
  const noChat = await page.evaluate(() => ({ notice: !!document.querySelector('.xjc-stage-notice .xjc-cast'), disabled: document.querySelector('.xjc-actions .pri').disabled }));
  ok(noChat.notice && noChat.disabled, '没打开角色聊天时提示并禁用生成');
  await page.evaluate(() => window.XiaoJuChang.close());
  await openChar(page);
  await sendChat(page, '今天又下雨了，我在便利店门口躲雨。');

  // 1. 打开面板，默认组合（文字 + theater 包裹），跟随酒馆 API
  await page.click('#extensionsMenuButton').catch(() => {});
  await page.click('#xjc_wand');
  await page.waitForSelector('.xjc-root:not([hidden]) .xjc-combo-card');
  ok(await page.locator('.xjc-stage-notice .xjc-cast').count() === 0, '打开了角色聊天时不显示提示');
  await page.screenshot({ path: `${SHOTS}/d-01-stage.png` });
  await page.click('.xjc-actions .pri');
  await waitResult(page);
  const t1 = await frameText(page, '.xjc-result iframe');
  ok(t1.includes('便利店') && !t1.includes('<theater>'), '文字小剧场渲染并剥掉包裹标签');
  ok((await page.textContent('.xjc-result h3')).includes('雨夜便利店'), '标题行被解析');
  const call1 = lastCall();
  const sys = call1.messages[0].content;
  ok(/<CharacterSheet>[\s\S]*林晚[\s\S]*多余的伞/.test(sys), '材料带角色卡');
  ok(sys.includes('两百天在下雨'), '材料带常驻世界书');
  ok(sys.includes('晴天'), '材料带关键词激活的世界书（聊天里提到便利店）');
  ok(sys.includes('夜班护士'), '材料带用户人设');
  ok(sys.includes('<RecentChat>') && sys.includes('躲雨'), '材料带最近聊天');
  ok(call1.messages[2].content.startsWith('<Brief>') && call1.messages[2].content.includes('深夜便利店'), 'Brief 带提示词');
  ok(!/\{\{(user|char)\}\}/.test(JSON.stringify(call1.messages)), '宏全部展开');
  ok(/林晚/.test(call1.messages[2].content), '{{char}} 展开成当前聊天的角色');
  const userName = await page.evaluate(() => SillyTavern.getContext().name1);
  ok(sys.includes(`林晚总说${userName}是唯一不嫌雨烦的人，林晚会去${userName}家楼下等`), '世界书里的 <char> <USER> {{char}} {{user}} 都换成名字');
  ok(sys.includes(`只对${userName}例外`), '角色卡里的 <user> 换成名字');
  ok(!/<(user|char|bot)>/i.test(JSON.stringify(call1.messages)), '没有残留 <user> <char> <bot>');
  const exp = await page.evaluate(async () => {
    const m = await import('/scripts/extensions/third-party/st-xiao-ju-chang/src/macros.js');
    return m.expandMacros('<user>和<Char>、<BOT>，{{user}}和{{char}}', { user: '我', char: '林晚', macros: [] });
  });
  ok(exp === '我和林晚、林晚，我和林晚', `提示词里的两种写法都展开（${exp}）`);
  ok(call1.max_tokens >= 4096 || call1.max_tokens === undefined || call1.max_tokens > 300, `跟随酒馆时用插件的长度（${call1.max_tokens}）`);
  await page.screenshot({ path: `${SHOTS}/d-02-result-text.png` });

  // 2. 换塔罗屋（HTML 交互），点 iframe 里的 data-action 续写
  await page.click('.xjc-scrollx >> text=塔罗屋');
  await page.click('.xjc-actions .pri');
  await waitResult(page);
  const fr = page.frameLocator('.xjc-result iframe');
  ok(await fr.locator('[data-ready="1"]').count() === 1, 'HTML 里的脚本在沙盒里执行');
  const h = await page.$eval('.xjc-result iframe', f => f.getBoundingClientRect().height);
  ok(h > 60 && h < 600, `iframe 高度按内容回传（${Math.round(h)}px）`);
  await page.screenshot({ path: `${SHOTS}/d-03-result-html.png` });
  const n0 = mockCalls().length;
  await fr.locator('button[data-action="翻开第一张"]').click();
  await page.waitForFunction(() => document.querySelector('.xjc-actions .pri')?.disabled === false, null, { timeout: 30000 });
  await waitResult(page);
  const cont = mockCalls().slice(n0)[0];
  ok(cont && cont.messages[2].content.includes('翻开第一张'), 'data-action 带着选择续写');
  const sandboxed = await page.$eval('.xjc-result iframe', f => f.getAttribute('sandbox'));
  ok(!sandboxed.includes('allow-same-origin'), 'iframe 没有同源权限');

  // 3. 新建一个分两步出的 HTML 组合
  await page.click('.xjc-tabs button[data-v="library"]');
  await page.click('text=＋ 新建小剧场');
  await page.fill('.xjc-sheet input[placeholder^="比如：深夜"]', '目击帖测试');
  await page.click('.xjc-sheet .xjc-seg >> text=HTML');
  await page.check('.xjc-sheet .xjc-toggle:has-text("分两步出") input');
  await page.screenshot({ path: `${SHOTS}/d-04-combo-editor.png` });
  await page.click('.xjc-sheet-ft >> text="保存"');
  await page.click('.xjc-tabs button[data-v="stage"]');
  ok((await page.textContent('.xjc-combo-card .nm')) === '目击帖测试', '新建后成为当前小剧场');
  const n1 = mockCalls().length;
  await page.click('.xjc-actions .pri');
  await waitResult(page);
  const t3 = await frameText(page, '.xjc-result iframe');
  ok(mockCalls().length - n1 === 2, '分两步出发了两次请求');
  ok(t3.includes('伞明显往一边歪') && t3.includes('侦探'), '第二步把字填进骨架');

  // 4. 自配 API：拉模型、测试、设为默认、流式
  await page.click('.xjc-tabs button[data-v="settings"]');
  await page.click('.xjc-view[data-view="settings"] .xjc-seg >> text=API');
  await page.click('text=＋ 新增 API');
  await page.fill('.xjc-sheet input[placeholder^="随便起个名"]', '模拟中转');
  await page.fill('.xjc-sheet input[type="url"]', 'http://127.0.0.1:5297/v1');
  await page.fill('.xjc-sheet input[placeholder="sk-…"]', 'sk-test-123');
  await page.click('.xjc-sheet >> text=拉取模型列表');
  await page.waitForFunction(() => document.querySelector('.xjc-sheet select:not([hidden])')?.options.length > 2, null, { timeout: 15000 });
  ok(true, '拉到模型列表');
  await page.selectOption('.xjc-sheet select:not([hidden]) >> nth=-1', 'mock-large');
  await page.check('.xjc-sheet .xjc-toggle:has-text("设为默认出口") input');
  await page.screenshot({ path: `${SHOTS}/d-05-api-editor.png` });
  await page.click('.xjc-sheet-ft >> text=保存并测试');
  await page.waitForFunction(() => [...document.querySelectorAll('#toast-container .toast')].some(t => t.textContent.includes('通了')), null, { timeout: 15000 });
  const test = lastCall();
  ok(test.auth === 'Bearer sk-test-123' && test.model === 'mock-large', '自配 API 经酒馆后端转发，带上密钥和模型');
  await page.click('.xjc-sheet-ft >> text="保存"');
  await page.click('.xjc-tabs button[data-v="stage"]');
  await page.click('.xjc-scrollx >> text=深夜便利店偶遇');
  await page.click('.xjc-actions .pri');
  let sawStreaming = false;
  for (let i = 0; i < 40; i++) {
    const s = await page.textContent('.xjc-result').catch(() => '');
    if (/正在演《/.test(s) && (await frameText(page, '.xjc-result iframe')).length > 2) { sawStreaming = true; break; }
    await sleep(100);
  }
  await waitResult(page);
  const st = lastCall();
  ok(st.stream === true && st.model === 'mock-large', '默认出口改成自配 API 并流式请求');
  ok(sawStreaming, '边写边显示');
  ok((await frameText(page, '.xjc-result iframe')).includes('关东煮'), '流式结束后完整渲染');

  // 5. 收藏 + 收藏页 + 全屏
  await page.click('.xjc-ops >> text=♡ 收藏');
  await page.click('.xjc-tabs button[data-v="fav"]');
  ok(await page.locator('.xjc-view[data-view="fav"] .xjc-item').count() === 1, '收藏页有一条');
  await page.click('.xjc-view[data-view="fav"] .xjc-item');
  await page.waitForSelector('.xjc-viewer .xjc-frame');
  await page.screenshot({ path: `${SHOTS}/d-06-viewer.png` });
  await page.click('.xjc-viewer >> text=‹ 返回');

  // 6. 楼层功能默认关：没有「挂到聊天」、消息菜单里没有面具按钮；打开后才有
  await page.click('.xjc-tabs button[data-v="stage"]');
  ok(!(await page.locator('.xjc-ops >> text=挂到聊天').isVisible()), '楼层功能默认关：结果里没有「挂到聊天」');
  ok(await page.evaluate(() => { const b = document.querySelector('#chat .mes .xjc-mes-btn'); return !!b && getComputedStyle(b).display === 'none'; }), '楼层功能默认关：消息菜单里没有面具按钮');
  ok(await page.locator('.xjc-view[data-view="fav"] .xjc-seg').count() === 0, '楼层功能默认关：收藏页不显示「本聊天」');
  await page.click('.xjc-tabs button[data-v="settings"]');
  await page.click('.xjc-view[data-view=settings] .xjc-seg button:has-text("聊天内")');
  await page.click('.xjc-toggle:has-text("在楼层里显示小剧场")');
  await page.click('.xjc-tabs button[data-v="stage"]');
  await page.click('.xjc-ops >> text=挂到聊天');
  await sleep(800);
  await page.click('.xjc-x');
  ok(await page.locator('#chat .mes .xjc-tail-card').count() === 1, '面板结果挂到最新消息下');

  // 7. 消息菜单里的面具按钮
  const lastMes = page.locator('#chat .mes').last();
  await lastMes.hover();
  await lastMes.locator('.extraMesButtonsHint').click();
  await lastMes.locator('.xjc-mes-btn').click();
  await page.waitForFunction(() => document.querySelectorAll('#chat .mes .xjc-tail-card').length >= 2 && !document.querySelector('.xjc-tail-busy'), null, { timeout: 30000 });
  ok(true, '消息按钮出了一篇');
  await page.screenshot({ path: `${SHOTS}/d-07-chat-tail.png` });

  // 7b. 换主题：面板、聊天卡片、iframe 正文一起换，不用重开
  ok(await page.evaluate(() => document.querySelector('.xjc-root').dataset.xjcTheme) === 'magazine', '默认主题是杂志');
  await page.evaluate(() => window.XiaoJuChang.open('settings'));
  await page.click('.xjc-view[data-view=settings] .xjc-seg button:has-text("外观")');
  await page.click('.xjc-th[data-v=terminal]');
  await page.waitForTimeout(400);
  const th = await page.evaluate(() => ({
    root: document.querySelector('.xjc-root').dataset.xjcTheme,
    tails: [...document.querySelectorAll('.xjc-tail-card')].every(n => n.dataset.xjcTheme === 'terminal'),
    frame: document.querySelector('.xjc-tail-card iframe')?.contentDocument === null,
  }));
  ok(th.root === 'terminal' && th.tails, '换成终端：面板和聊天卡片都换了');
  const frameTheme = await page.frames().find(f => f.parentFrame() && f.url() === 'about:srcdoc')?.evaluate(() => [document.documentElement.dataset.t, getComputedStyle(document.body).backgroundColor]);
  ok(frameTheme && frameTheme[0] === 'terminal' && frameTheme[1] === 'rgb(15, 20, 17)', `正文 iframe 跟着换（${frameTheme}）`);
  ok((await page.evaluate(async () => (await import('/scripts/extensions/third-party/st-xiao-ju-chang/src/store.js')).state.settings.theme)) === 'terminal', '主题存进设置');
  await page.click('.xjc-th[data-v=magazine]');

  // 7b2. 输入框不吃酒馆主题的样式；界面字号整体缩放
  const inputs = await page.evaluate(() => {
    const st = document.createElement('style');
    st.id = 'fake-st-theme';
    st.textContent = 'body input, body textarea, body select { background-color: rgb(100, 100, 100) !important; color: rgb(1, 1, 1) !important; }';
    document.head.appendChild(st);
    const i = document.querySelector('.xjc-root input[type=text]');
    const cs = getComputedStyle(i);
    const r = [cs.backgroundColor, cs.color];
    st.remove();
    return r;
  });
  ok(!inputs.includes('rgb(100, 100, 100)') && !inputs.includes('rgb(1, 1, 1)'), `输入框用小剧场主题的颜色，不跟酒馆主题（${inputs}）`);
  const fs0 = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.xjc-panel')).fontSize));
  await page.click('.xjc-field:has-text("界面字号") .xjc-seg button:has-text("特小")');
  const fs1 = await page.evaluate(() => [parseFloat(getComputedStyle(document.querySelector('.xjc-panel')).fontSize), parseFloat(getComputedStyle(document.querySelector('.xjc-hd h2')).fontSize)]);
  ok(Math.abs(fs1[0] - fs0 * 0.8) < 0.2 && fs1[1] < 30 * 0.85, `界面字号「特小」整体缩小（${fs0} → ${fs1}）`);
  await page.click('.xjc-field:has-text("界面字号") .xjc-seg button:has-text("标准")');

  // 7c. 新主题、导入 CSS 自定义主题、动效开关
  await page.click('.xjc-th[data-v=xuan]');
  ok(await page.evaluate(() => document.querySelector('.xjc-root').dataset.xjcTheme) === 'xuan', '新主题「宣纸」能用');
  const cssFile = path.join(SHOTS, '测试主题.css');
  fs.writeFileSync(cssFile, '[data-xjc-custom] { --xjc-ui-bg: rgb(1, 2, 3); --xjc-canvas-bg: rgb(4, 5, 6); }\n/* ===== 正文 CSS（放进小剧场内容的 iframe 里） ===== */\n.xjc-text p { letter-spacing: 3px; }\n');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('.xjc-btn:has-text("导入 CSS 文件")')]);
  await chooser.setFiles(cssFile);
  await page.waitForFunction(() => document.querySelector('.xjc-root').dataset.xjcCustom, null, { timeout: 5000 });
  await sleep(500);
  const custom = await page.evaluate(() => ({
    bg: getComputedStyle(document.querySelector('.xjc-panel')).backgroundColor,
    base: document.querySelector('.xjc-root').dataset.xjcTheme,
    style: !!document.getElementById('xjc-custom-css'),
    tile: !!document.querySelector('.xjc-th.on b')?.textContent.includes('测试主题'),
  }));
  ok(custom.style && custom.base === 'xuan' && custom.tile, `导入 CSS 成为自定义主题，基于当前主题（${custom.base}）`);
  ok(custom.bg.includes('1, 2, 3') || custom.bg.includes('rgb(1, 2, 3)'), `自定义变量生效（面板底色 ${custom.bg}）`);
  const tailFrame = page.frames().find(f => f.parentFrame() && f.url() === 'about:srcdoc');
  const frc = await tailFrame?.evaluate(() => [getComputedStyle(document.body).backgroundColor, getComputedStyle(document.querySelector('.xjc-text p')).letterSpacing]);
  ok(frc && frc[0] === 'rgb(4, 5, 6)' && frc[1] === '3px', `正文 iframe 用上自定义颜色和正文 CSS（${frc}）`);
  await page.click('.xjc-th[data-v=magazine]');
  ok(await page.evaluate(() => !document.getElementById('xjc-custom-css') && !document.querySelector('.xjc-root').dataset.xjcCustom), '切回内置主题后自定义 CSS 撤掉');
  await page.click('.xjc-toggle:has-text("动效")');
  ok(await page.evaluate(() => document.body.classList.contains('xjc-motion-off')), '关掉动效');
  await page.click('.xjc-toggle:has-text("动效")');

  // 7d. 文本批量建小剧场、暗柜档案导入
  const combos0 = await page.evaluate(async () => (await import('/scripts/extensions/third-party/st-xiao-ju-chang/src/store.js')).state.combos.length);
  await page.click('.xjc-tabs button[data-v="library"]');
  await page.click('.xjc-view[data-view=library] .xjc-btn:has-text("导入")');
  await page.fill('.xjc-sheet textarea', '## 天台烟花 #场景\n{{char}}和{{user}}在天台等跨年烟花。\n\n## 打工日记 #形式\n用{{char}}的打工日记写今天。');
  await page.click('.xjc-sheet .xjc-toggle:has-text("每条同时建成一个小剧场")');
  await page.click('.xjc-sheet .xjc-btn:has-text("导入文本")');
  await sleep(300);
  const after = await page.evaluate(async () => { const s = (await import('/scripts/extensions/third-party/st-xiao-ju-chang/src/store.js')).state; return { n: s.combos.length, names: s.combos.map(c => c.name), p: s.prompts.some(p => p.title === '天台烟花') }; });
  ok(after.n === combos0 + 2 && after.names.includes('打工日记') && after.p, '文本批量导入：两条提示词各建了一个小剧场');
  const darkFile = path.join(SHOTS, '暗柜.json');
  fs.writeFileSync(darkFile, JSON.stringify({ templateSnapshot: { title: '午夜电台', tags: ['电台'], aiInstruction: '{{char}}在午夜电台读听众来信。', outputContract: '输出一段电台节目单 HTML。' } }));
  await page.click('.xjc-view[data-view=library] .xjc-btn:has-text("导入")');
  const [ch2] = await Promise.all([page.waitForEvent('filechooser'), page.click('.xjc-sheet .xjc-btn:has-text("选文件")')]);
  await ch2.setFiles(darkFile);
  await sleep(500);
  const dark = await page.evaluate(async () => { const s = (await import('/scripts/extensions/third-party/st-xiao-ju-chang/src/store.js')).state; const c = s.combos.find(x => x.name === '午夜电台'); return c && { n: c.promptIds.length, mode: c.output.mode, tags: c.tags }; });
  ok(dark && dark.n === 2 && dark.mode === 'mixed' && dark.tags.includes('暗柜'), '暗柜档案导入成两条提示词 + 一个小剧场');

  // 7e. 删提示词时从小剧场里摘掉引用
  const cleaned = await page.evaluate(async () => {
    const s = (await import('/scripts/extensions/third-party/st-xiao-ju-chang/src/store.js')).state;
    return s.combos.find(x => x.name === '午夜电台').promptIds[0];
  });
  await page.click('.xjc-view[data-view=library] .xjc-seg button:has-text("提示词")');
  await page.click('.xjc-view[data-view=library] .xjc-item:has-text("午夜电台 · 剧情指令")');
  await page.click('.xjc-sheet .xjc-btn:has-text("删除")');
  await page.locator('.xjc-sheet').last().locator('.xjc-btn.danger').click();
  await sleep(300);
  const refs = await page.evaluate(async id => (await import('/scripts/extensions/third-party/st-xiao-ju-chang/src/store.js')).state.combos.find(x => x.name === '午夜电台').promptIds.includes(id), cleaned);
  ok(!refs, '删掉的提示词从小剧场里摘掉了');

  // 7f. 写回记忆（世界书）+ 走酒馆预设
  await page.evaluate(async () => {
    const s = await import('/scripts/extensions/third-party/st-xiao-ju-chang/src/store.js');
    const c = s.state.combos.find(x => x.id === 'c_store');
    c.writeBack = true; c.channel = 'preset'; c.output.staged = false;
    await s.save('combos');
    await s.setSetting({ currentComboId: 'c_store', api: 'st', writeBackFeature: true });
  });
  const before7f = mockCalls().length;
  await page.click('.xjc-tabs button[data-v="stage"]');
  await page.click('.xjc-actions .pri');
  await page.waitForFunction(() => !document.querySelector('.xjc-actions .pri').disabled && document.querySelector('.xjc-result .xjc-ops'), null, { timeout: 30000 });
  const q = mockCalls().slice(before7f).find(c => JSON.stringify(c.messages).includes('<Brief>'));
  const qs = q ? JSON.stringify(q.messages) : '';
  ok(q && !qs.includes('<CharacterSheet>') && qs.includes('林晚是'), '走酒馆预设：材料由酒馆拼（有角色卡、没有插件自己的 <CharacterSheet>）');
  await sleep(1500);
  const lore = await page.evaluate(async () => {
    const c = SillyTavern.getContext();
    const name = c.chatMetadata.world_info;
    if (!name) return null;
    const data = await c.loadWorldInfo(name);
    return { name, entries: Object.values(data.entries || {}).map(e => e.comment) };
  });
  ok(lore && lore.entries.some(t => t.startsWith('小剧场《')), `写回记忆：写进聊天绑定的世界书（${lore && lore.name}）`);
  await page.evaluate(async () => {
    const s = await import('/scripts/extensions/third-party/st-xiao-ju-chang/src/store.js');
    const c = s.state.combos.find(x => x.id === 'c_store');
    c.writeBack = false; c.channel = 'own';
    await s.save('combos');
    await s.setSetting({ writeBackFeature: false });
  });
  await page.evaluate(() => window.XiaoJuChang.close());

  // 8. 自动出（概率 100）
  await page.evaluate(async () => {
    const m = await import('/scripts/extensions/third-party/st-xiao-ju-chang/src/store.js');
    await m.setSetting({ tail: { ...m.state.settings.tail, auto: true, chance: 100 } });
  });
  await sendChat(page, '那我们一起走吧。');
  await page.waitForFunction(() => {
    const last = [...document.querySelectorAll('#chat .mes')].pop();
    return last && last.querySelector('.xjc-tail-card') && !document.querySelector('.xjc-tail-busy');
  }, null, { timeout: 30000 });
  ok(true, 'AI 回复后自动出');
  const calls = mockCalls();
  const mainChat = calls.filter(c => !c.messages.some(m => typeof m.content === 'string' && m.content.includes('<Brief>')));
  ok(mainChat.every(c => !JSON.stringify(c.messages).includes('牌面朝下') && !JSON.stringify(c.messages).includes('<Brief>')), '聊天里的小剧场不会发给模型');

  // 9. 刷新后还在；手动收起的那篇刷新后还是收起的
  await page.locator('#chat .mes .xjc-tail-card').first().locator('.xjc-tail-hd .ttl').click();
  ok(await page.locator('#chat .mes .xjc-tail-card').first().locator('.xjc-tail-bd').isHidden(), '点标题栏收起');
  await sleep(1500);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.SillyTavern && document.getElementById('xjc_wand'), null, { timeout: 60000 });
  await openChar(page);
  await page.waitForFunction(() => document.querySelectorAll('#chat .mes .xjc-tail-card').length >= 3, null, { timeout: 15000 }).catch(() => {});
  ok(await page.locator('#chat .mes .xjc-tail-card').count() >= 3, '刷新后聊天里的小剧场还在');
  const states = await page.evaluate(() => [...document.querySelectorAll('#chat .mes .xjc-tail-card')].map(n => n.querySelector('.xjc-tail-bd').hidden));
  ok(states[0] === true && states.slice(1).every(h => h === false), `刷新后收起的保持收起，其余照默认展开（${states}）`);
  await page.click('#extensionsMenuButton').catch(() => {});
  await page.click('#xjc_wand');
  await page.click('.xjc-tabs button[data-v="fav"]');
  ok(await page.locator('.xjc-view[data-view="fav"] .xjc-item').count() === 1, '刷新后收藏还在');
  await page.click('.xjc-view[data-view="fav"] .xjc-seg >> text=本聊天');
  ok(await page.locator('.xjc-view[data-view="fav"] .xjc-item').count() >= 3, '「本聊天」列出挂在消息下的小剧场');

  // 10. 导入 Float 小剧场整包
  const imported = await page.evaluate(async () => {
    const d = await import('/scripts/extensions/third-party/st-xiao-ju-chang/src/data.js');
    const s = await import('/scripts/extensions/third-party/st-xiao-ju-chang/src/store.js');
    const n = await d.importBundle({ app: 'float.xiaojuchang', version: 1, prompts: [{ id: 'p_x', title: 'Float 来的', tags: ['场景'], content: '一段测试' }], combos: [{ id: 'c_x', name: 'Float 组合', promptIds: ['p_x'], memory: { mode: 'host', rounds: 6 }, writeBack: true, rawChannel: true, output: { mode: 'text' } }] });
    const c = s.state.combos.find(x => x.name === 'Float 组合');
    return { n, ctx: c && c.context, hasRaw: c && ('rawChannel' in c), linked: c && s.state.prompts.some(p => p.id === c.promptIds[0] && p.title === 'Float 来的') };
  });
  ok(imported.n === 2 && imported.ctx?.chat === 'recent' && imported.ctx?.rounds === 6 && !imported.hasRaw && imported.linked, 'Float 整包导入并换算字段');

  ok(errors.length === 0, `没有页面错误${errors.length ? '：' + errors.join(' | ') : ''}`);
  await ctx.close();
}

async function mobile(browser) {
  const ctx = await browser.newContext({
    viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await boot(page);
  await openChar(page);
  // 模拟 iPhone 刘海 / 底部横条的安全区
  await page.addStyleTag({ content: ':root{--tt-inset-top:59px;--tt-inset-bottom:34px}' });
  await page.evaluate(() => window.XiaoJuChang.open('stage'));
  await page.waitForSelector('.xjc-root:not([hidden]) .xjc-combo-card');
  const box = await page.$eval('.xjc-panel', n => { const r = n.getBoundingClientRect(); return { w: r.width, h: r.height }; });
  ok(box.w === 393 && box.h === 852, `手机上面板铺满（${box.w}×${box.h}）`);
  const hdTop = await page.$eval('.xjc-hd', n => n.getBoundingClientRect().top);
  ok(hdTop >= 59, `顶部让开安全区（${hdTop}px）`);
  const tabsBottom = await page.$eval('.xjc-tabs', n => { const r = n.getBoundingClientRect(); return { bottom: r.bottom, pad: parseFloat(getComputedStyle(n).paddingBottom) }; });
  ok(tabsBottom.pad >= 34 && tabsBottom.bottom <= 852, `底栏让开横条（padding ${tabsBottom.pad}px）`);
  const overflow = await page.$eval('.xjc-body', n => n.scrollWidth - n.clientWidth);
  ok(overflow <= 0, `没有横向溢出（${overflow}）`);
  await page.screenshot({ path: `${SHOTS}/m-01-stage.png` });
  await page.tap('.xjc-actions .pri');
  await waitResult(page);
  await page.screenshot({ path: `${SHOTS}/m-02-result.png` });
  await page.tap('.xjc-ops >> text=⤢ 全屏');
  await page.waitForSelector('.xjc-viewer .xjc-frame');
  const vbar = await page.$eval('.xjc-viewer-bar', n => n.getBoundingClientRect().top);
  ok(vbar >= 59, `全屏查看器让开安全区（${vbar}px）`);
  await page.screenshot({ path: `${SHOTS}/m-03-viewer.png` });
  await page.tap('.xjc-viewer >> text=‹ 返回');
  await page.tap('.xjc-tabs button[data-v="library"]');
  await page.screenshot({ path: `${SHOTS}/m-04-library.png` });
  await page.tap('.xjc-view[data-view="library"] .xjc-item >> nth=0');
  await page.waitForSelector('.xjc-sheet');
  const sheet = await page.$eval('.xjc-sheet', n => { const r = n.getBoundingClientRect(); return { l: r.left, w: r.width, b: r.bottom }; });
  ok(sheet.l === 0 && sheet.w === 393 && Math.round(sheet.b) === 852, '编辑抽屉从底部弹出、铺满宽度');
  await page.screenshot({ path: `${SHOTS}/m-05-editor.png` });
  await page.tap('.xjc-sheet .xjc-x');
  await page.tap('.xjc-tabs button[data-v="settings"]');
  await page.tap('.xjc-view[data-view="settings"] .xjc-seg >> text=API');
  await page.screenshot({ path: `${SHOTS}/m-06-settings-api.png` });
  await page.tap('.xjc-view[data-view="settings"] .xjc-seg >> text=聊天内');
  await page.screenshot({ path: `${SHOTS}/m-07-settings-chat.png` });
  await page.tap('.xjc-x');
  await page.evaluate(() => document.querySelector('#chat .mes .xjc-tail-card')?.scrollIntoView());
  await sleep(500);
  await page.screenshot({ path: `${SHOTS}/m-08-chat-tail.png` });
  const inputFont = await page.evaluate(() => { window.XiaoJuChang.open('stage'); return getComputedStyle(document.querySelector('.xjc-extra input')).fontSize; });
  ok(inputFont === '16px', '输入框 16px，iOS 点进去不会放大页面');
  ok(errors.length === 0, `手机端没有页面错误${errors.length ? '：' + errors.join(' | ') : ''}`);
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    await desktop(browser);
    await mobile(browser);
  } catch (e) {
    failed++;
    console.log('FAIL 异常', e.message.split('\n')[0]);
    console.log(e.stack.split('\n').slice(1, 4).join('\n'));
    for (const ctx of browser.contexts()) for (const pg of ctx.pages()) {
      await pg.screenshot({ path: `${SHOTS}/fail.png` }).catch(() => {});
      console.log('页面状态', await pg.evaluate(() => ({ sheets: document.querySelectorAll('.xjc-sheet').length, top: (() => { const b = document.querySelector('.xjc-tabs button[data-v="stage"]').getBoundingClientRect(); const n = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return n && (n.className || n.tagName) + ' ' + (n.id || ''); })() })).catch(x => x.message));
    }
  }
  await browser.close();
  console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
  process.exit(failed ? 1 : 0);
})();
