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
  // 新装的酒馆第一次打开会弹欢迎窗，挡住发送按钮；有就关掉
  // 弹窗出来得有早有晚，多看几次
  for (let i = 0; i < 8; i++) {
    await sleep(500);
    for (const sel of ['dialog.popup[open] .popup-button-ok', 'dialog.popup[open] .popup-button-close']) {
      const b = page.locator(sel).first();
      if (await b.isVisible().catch(() => false)) await b.click().catch(() => {});
    }
  }
}

async function setupData(page) {
  return page.evaluate(async () => {
    const c = SillyTavern.getContext();
    const h = c.getRequestHeaders();
    const world = {
      entries: {
        0: { uid: 0, key: [], keysecondary: [], comment: '雨城常驻', content: '雨城一年有两百天在下雨，老城区的路灯是黄色的。<char>总说<USER>是唯一不嫌雨烦的人，{{char}}会去{{user}}家楼下等。', constant: true, selective: false, order: 100, position: 0, disable: false, probability: 100, useProbability: true },
        1: { uid: 1, key: ['便利店'], keysecondary: [], comment: '便利店', content: '街角的便利店叫「晴天」，店员阿哲总在打瞌睡。', constant: false, selective: false, order: 100, position: 0, disable: false, probability: 100, useProbability: true },
        // 数据库插件那样的 @深度 条目
        2: { uid: 2, key: [], keysecondary: [], comment: 'TavernDB-ACU-CustomExport-纪要-1', content: '【深度纪要】上周两人在天台看过一次流星。', constant: true, selective: false, order: 10000, position: 4, depth: 1, role: 0, disable: false, probability: 100, useProbability: true },
        // 很长的常驻条目：世界书预算要按对话补全的上下文算，按文本补全的小上下文算会把所有条目都挤掉
        3: { uid: 3, key: [], keysecondary: [], comment: '长设定', content: '【长设定开头】' + '雨城的老城区有很多窄巷，巷口有卖糖水的小摊。'.repeat(220), constant: true, selective: false, order: 200, position: 1, disable: false, probability: 100, useProbability: true },
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
    s.state.settings = { ...s.state.settings, seeded: true, api: 'st', currentComboId: 'c_store', theme: 'magazine', canvas: 'theme', tail: { ...s.state.settings.tail, enabled: false, auto: false, button: true, askExtra: false, expanded: true }, foldStyle: 'pill', foldCss: '' };
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
  // 写好了提醒：面板关着时弹一条可点的提示；页面在后台时等回到页面再补
  const newest = () => page.evaluate(async () => (await import('/scripts/extensions/third-party/st-xiao-ju-chang/src/store.js')).state.recent[0]?.id);
  const waitNew = async old => { for (let i = 0; i < 150 && (await newest()) === old; i++) await sleep(200); };
  let old = await newest();
  await page.click('.xjc-actions .pri');
  await page.evaluate(() => window.XiaoJuChang.close());
  await waitNew(old);
  const doneToast = page.locator('#toast-container .toast:has(.toast-title:text-is("小剧场写好了"))').last();
  await doneToast.waitFor({ timeout: 10000 });
  await doneToast.click();
  ok(await page.locator('.xjc-root:not([hidden]) .xjc-result .xjc-ops').count() === 1, '面板关着时写好了会弹提示，点一下回到舞台看这篇');
  await page.evaluate(() => { window.toastr?.clear(); Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); });
  old = await newest();
  await page.click('.xjc-actions .pri');
  await waitNew(old);
  await sleep(300);
  const whileHidden = await page.locator('#toast-container .toast-title:text-is("小剧场写好了")').count();
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  await page.locator('#toast-container .toast-title:text-is("小剧场写好了")').first().waitFor({ timeout: 5000 }).catch(() => {});
  ok(whileHidden === 0 && await page.locator('#toast-container .toast-title:text-is("小剧场写好了")').count() === 1, '页面在后台时写好了，回到酒馆再弹提示');
  await page.evaluate(() => window.toastr?.clear());
  const call1 = lastCall();
  ok(call1.stream === true, '跟随酒馆当前 API 也发流式请求（酒馆里流式关着也一样），长篇不会被中转站超时掐断');
  const sys = call1.messages[0].content;
  ok(/<CharacterSheet>[\s\S]*林晚[\s\S]*多余的伞/.test(sys), '材料带角色卡');
  ok(sys.includes('两百天在下雨'), '材料带常驻世界书');
  ok(sys.includes('晴天'), '材料带关键词激活的世界书（聊天里提到便利店）');
  ok(sys.includes('【长设定开头】'), '长的世界书条目也带上（不受酒馆世界书预算限制）');
  const rc = (sys.match(/<RecentChat>([\s\S]*?)<\/RecentChat>/) || [])[1] || '';
  const dAt = rc.indexOf('【深度纪要】上周两人在天台看过一次流星。');
  const msgsAfter = dAt < 0 ? -1 : (rc.slice(dAt).match(/\n[^\n：]{1,20}：/g) || []).length;
  ok(dAt > 0 && msgsAfter === 1, `@深度 1 的条目插在最后一条消息前面（后面有 ${msgsAfter} 条消息）`);
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
  await page.click('.xjc-combo-card .xjc-btn:has-text("换一个")');
  await page.locator('.xjc-sheet .xjc-item', { hasText: '塔罗屋' }).first().click();
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
  ok(await page.locator('.xjc-sheet .xjc-field:has(> .lb:text-is("只抽"))').isHidden(), '随机选「不抽」时不显示「只抽 / 排除」');
  ok(await page.locator('.xjc-sheet .xjc-field:has(> .lb:text-is("带几轮"))').isHidden() && await page.locator('.xjc-sheet .xjc-field:has(> .lb:text-is("材料")) button.on').textContent() === '跟随全局', '新建小剧场的材料默认「跟随全局」，不展开具体选项');
  await page.click('.xjc-sheet .xjc-field:has(> .lb:text-is("材料")) .xjc-seg button:text-is("自定")');
  ok(await page.locator('.xjc-sheet .xjc-field:has(> .lb:text-is("带几轮"))').isVisible(), '选「自定」才出现带几轮、世界书');
  await page.click('.xjc-sheet .xjc-field:has(> .lb:text-is("材料")) .xjc-seg button:text-is("跟随全局")');
  ok(await page.evaluate(() => { const i = document.querySelector('.xjc-sheet .xjc-toggle input'); return !i || getComputedStyle(i, '::before').content === 'none'; }), '开关上没有酒馆复选框的勾');
  await page.click('.xjc-sheet .xjc-seg button:text-is("HTML")');
  await page.click('.xjc-sheet .xjc-field:has(> .lb:text-is("分两步出")) .xjc-seg button:text-is("分两步")');
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
  await page.click('.xjc-ops .xjc-btn[title="这一篇用了什么"]');
  const reqTxt = await page.textContent('.xjc-sheet .xjc-req');
  ok(reqTxt.includes('第一步') && reqTxt.includes('第二步') && reqTxt.includes('<Brief>') && reqTxt.includes('<CharacterSheet>'), '「ⓘ」里能看到每一步发给模型的内容');
  await page.click('.xjc-sheet .xjc-x');

  // 3b. 附加要求：平时收着，点开填了才带上
  ok(await page.locator('.xjc-extra textarea').isHidden() && await page.locator('.xjc-extra-open').isVisible(), '附加要求默认收起');
  await page.click('.xjc-extra-open');
  await page.fill('.xjc-extra textarea', '这次让TA吃醋测试');
  await page.click('.xjc-actions .pri');
  await waitResult(page);
  ok(JSON.stringify(lastCall().messages).includes('这次让TA吃醋测试'), '附加要求发给了模型');
  await page.click('.xjc-extra-box .xjc-btn:has-text("不用了")');
  ok(await page.locator('.xjc-extra textarea').isHidden() && (await page.inputValue('.xjc-extra textarea')) === '', '「不用了」清空并收起');

  // 3c. 不建小剧场，直接挑提示词生成；觉得好再存成小剧场
  const pTitles = await page.evaluate(async () => (await import('/scripts/extensions/third-party/st-xiao-ju-chang/src/store.js')).state.prompts.slice(0, 2).map(p => ({ t: p.title, c: p.content.split(/\{\{[^}]*\}\}|[\n，。]/).sort((a, b) => b.length - a.length)[0].slice(0, 10) })));
  await page.click('.xjc-combo-card .xjc-btn:has-text("换一个")');
  await page.click('.xjc-sheet .xjc-seg button:has-text("直接用提示词")');
  for (const p of pTitles) await page.click(`.xjc-sheet .xjc-item:has(.t:text-is("${p.t}"))`);
  await page.click('.xjc-sheet-ft .xjc-btn:has-text("用这 2 条")');
  ok((await page.textContent('.xjc-combo-card .nm')).includes('临时'), '舞台上是临时拼的（直接用提示词）');
  const nCombos = await page.evaluate(async () => (await import('/scripts/extensions/third-party/st-xiao-ju-chang/src/store.js')).state.combos.length);
  await page.click('.xjc-actions .pri');
  await waitResult(page);
  const tmpSys = lastCall().messages.map(m => m.content).join('\n');
  ok(pTitles.every(p => tmpSys.includes(p.c)), `直接用提示词生成：选的几条都发给了模型（${pTitles.map(p => p.t + ':' + tmpSys.includes(p.c)).join(' ')}）`);
  await page.click('.xjc-combo-card .xjc-btn:has-text("存成小剧场")');
  await page.click('.xjc-sheet-ft >> text="保存"');
  const after3c = await page.evaluate(async () => { const s = (await import('/scripts/extensions/third-party/st-xiao-ju-chang/src/store.js')).state; const c = s.combos.find(x => x.id === s.settings.currentComboId); return { n: s.combos.length, ids: (c?.parts || []).flatMap(pt => pt.items).length }; });
  ok(after3c.n === nCombos + 1 && after3c.ids === 2 && !(await page.textContent('.xjc-combo-card .nm')).includes('临时'), '「存成小剧场」存进库并放到舞台');

  // 3c2. 舞台上「这次抽」：带随机的小剧场可以指定这次用哪几条；「直接用提示词」能选前置要求
  const pickTitle = await page.evaluate(async () => {
    const s = await import('/scripts/extensions/third-party/st-xiao-ju-chang/src/store.js');
    const c = s.state.combos.find(x => x.id === 'c_store');
    c.random = { count: 1, include: [], exclude: [], groups: [] };
    await s.save('combos');
    await s.setSetting({ currentComboId: 'c_store', stagePick: null });
    window.XiaoJuChang.open('stage');
    return s.state.randoms[2].title;
  });
  ok((await page.textContent('.xjc-combo-card .xjc-pickrow')).includes('随机 1 条'), '带随机的小剧场，舞台卡片上有「这次抽：随机」');
  await page.click('.xjc-combo-card .xjc-pickrow .xjc-btn:has-text("指定")');
  await page.click(`.xjc-sheet .xjc-item:has(.t:text-is("${pickTitle}"))`);
  await page.click('.xjc-sheet-ft .xjc-btn:has-text("用这 1 条")');
  ok((await page.textContent('.xjc-combo-card .xjc-pickrow')).includes(pickTitle), '指定后卡片上显示这次用的条目');
  await page.click('.xjc-actions .pri');
  await waitResult(page);
  const pickSnap = await page.evaluate(async () => { const s = (await import('/scripts/extensions/third-party/st-xiao-ju-chang/src/store.js')).state; return { snap: s.recent[0].snapshot, copy: '_forcedRandomIds' in (s.recent[0].comboCopy || {}) }; });
  ok(pickSnap.snap.randoms.length === 1 && pickSnap.snap.randoms[0] === pickTitle && pickSnap.snap.randomsForced && !pickSnap.copy, `这次用的是指定的那条（${pickSnap.snap.randoms}），「按这套再来」不会沿用指定`);
  await page.click('.xjc-combo-card .xjc-pickrow .xjc-btn:has-text("改回随机")');
  ok((await page.textContent('.xjc-combo-card .xjc-pickrow')).includes('随机 1 条'), '「改回随机」恢复随机抽');
  await page.evaluate(async () => { const s = await import('/scripts/extensions/third-party/st-xiao-ju-chang/src/store.js'); const c = s.state.combos.find(x => x.id === 'c_store'); c.random = { count: 0, include: [], exclude: [], groups: [] }; await s.save('combos'); });
  // 选一条不是默认的前置要求
  const preName = await page.evaluate(async () => { const s = (await import('/scripts/extensions/third-party/st-xiao-ju-chang/src/store.js')).state; return s.preambles.find(p => p.id !== (s.settings.defaultPreambleId || s.preambles[0].id)).name; });
  await page.evaluate(() => window.XiaoJuChang.open('stage'));
  await page.click('.xjc-combo-card .xjc-btn:has-text("换一个")');
  await page.click('.xjc-sheet .xjc-seg button:has-text("直接用提示词")');
  await page.selectOption('.xjc-sheet .xjc-field:has(> .lb:text-is("前置要求")) select', { label: preName });
  await page.locator('.xjc-sheet .xjc-item').first().click();
  await page.click('.xjc-sheet-ft .xjc-btn:has-text("用这 1 条")');
  ok((await page.textContent('.xjc-combo-card .xjc-chips')).includes(preName), `「直接用提示词」能选前置要求（${preName}）`);
  await page.click('.xjc-actions .pri');
  await waitResult(page);
  ok(await page.evaluate(async n => (await import('/scripts/extensions/third-party/st-xiao-ju-chang/src/store.js')).state.recent[0].snapshot.preambleName === n, preName), '选的前置要求用在了这次生成');
  await page.evaluate(async () => (await import('/scripts/extensions/third-party/st-xiao-ju-chang/src/store.js')).setSetting({ currentComboId: 'c_store' }));

  // 3e. 分组：提示词放进分组，库里按组显示、可折叠；选提示词能整组加入；随机能只从某个组里抽
  await page.evaluate(async () => {
    const s = await import('/scripts/extensions/third-party/st-xiao-ju-chang/src/store.js');
    for (const [i, t] of ['三张牌阵', '凯尔特十字', '单张抽牌'].entries()) s.state.prompts.push({ id: `p_tarot${i}`, title: t, tags: ['塔罗'], group: '塔罗形式', content: `【塔罗形式${i}】用${t}的形式写。` });
    await s.save('prompts');
  });
  await page.click('.xjc-tabs button[data-v="library"]');
  await page.click('.xjc-view[data-view="library"] .xjc-seg button:has-text("提示词")');
  const grpHd = page.locator('.xjc-view[data-view="library"] .xjc-grp-hd:has(b:text-is("塔罗形式"))');
  ok(await grpHd.count() === 1 && (await grpHd.locator('.n').textContent()) === '3', '库里按分组显示，组名后面是条数');
  await grpHd.click();
  ok(await page.locator('.xjc-view[data-view="library"] .xjc-grp:has(.xjc-grp-hd b:text-is("塔罗形式")) > .xjc-list').isHidden(), '点组标题能折叠');
  await grpHd.click();
  await page.click('.xjc-view[data-view="library"] .xjc-btn:has-text("按第一个标签分组")');
  await page.locator('.xjc-sheet').last().locator('.xjc-btn:text-is("分组")').click();
  const autoG = await page.evaluate(async () => (await import('/scripts/extensions/third-party/st-xiao-ju-chang/src/store.js')).state.prompts.filter(p => !p.group).length);
  ok(autoG === 0, '「按第一个标签分组」把没分组的都按标签分好');
  await page.locator('.xjc-view[data-view="library"] .xjc-grp-hd:has(b:text-is("场景")) .xjc-btn[title="改名"]').click();
  await page.fill('.xjc-sheet input[placeholder="新名字"]', '场景库');
  await page.locator('.xjc-sheet').last().locator('.xjc-btn:text-is("改名")').click();
  ok(await page.locator('.xjc-view[data-view="library"] .xjc-grp-hd b:text-is("场景库")').count() === 1, '分组能改名');
  await page.locator('.xjc-view[data-view="library"] .xjc-grp-hd:has(b:text-is("场景库")) .xjc-btn[title="解散分组"]').click();
  await page.locator('.xjc-sheet').last().locator('.xjc-btn:text-is("解散")').click();
  ok(await page.locator('.xjc-view[data-view="library"] .xjc-grp-hd b:text-is("场景库")').count() === 0 && await page.locator('.xjc-view[data-view="library"] .xjc-grp-hd b:text-is("未分组")').count() === 1, '解散分组：条目回到「未分组」');
  // 编辑小剧场：选提示词整组加入
  await page.click('.xjc-view[data-view="library"] .xjc-seg button:has-text("小剧场")');
  await page.click('text=＋ 新建小剧场');
  await page.click('.xjc-sheet .xjc-btn:has-text("＋ 选提示词")');
  await page.locator('.xjc-sheet').last().locator('.xjc-grp-hd:has(b:text-is("塔罗形式")) .xjc-btn:has-text("整组加入")').click();
  await page.locator('.xjc-sheet').last().locator('.xjc-sheet-ft .xjc-btn:has-text("确定")').click();
  ok(await page.locator('.xjc-sheet .xjc-ordered .xjc-item').count() === 3, '选提示词：整组加入');
  // 分段：「牌阵」段放三种塔罗形式、随机抽 1；再加一段「主题」放一条场景并移到前面
  const ed = page.locator('.xjc-sheet').last();
  await ed.locator('.xjc-field:has(> .lb:text-is("名字")) input').fill('塔罗分段');
  await ed.locator('.xjc-part').nth(0).locator('.xjc-part-hd input').fill('牌阵');
  await ed.locator('.xjc-part').nth(0).locator('.xjc-seg button:has-text("从里面随机")').click();
  await ed.locator('.xjc-btn:has-text("＋ 加一段")').click();
  await ed.locator('.xjc-part').nth(1).locator('.xjc-part-hd input').fill('主题');
  await ed.locator('.xjc-part').nth(1).locator('.xjc-btn:has-text("＋ 选提示词")').click();
  await page.locator('.xjc-sheet').last().locator('input[placeholder="搜标题 / 内容"]').fill('深巷');
  await page.locator('.xjc-sheet').last().locator('label.xjc-check:has-text("深巷塔罗屋") input').check();
  await page.locator('.xjc-sheet').last().locator('.xjc-sheet-ft .xjc-btn:has-text("确定")').click();
  await ed.locator('.xjc-part').nth(1).locator('.xjc-btn[title="这一段上移"]').click();
  ok((await ed.locator('.xjc-part').nth(0).locator('.xjc-part-hd input').inputValue()) === '主题' && await ed.locator('.xjc-part').nth(0).locator('.xjc-field:has(> .lb:text-is("这一段"))').count() === 0, '分段能调顺序；只有一条的段没有「随机」可选');
  await ed.locator('.xjc-sheet-ft .xjc-btn:has-text("保存并试生成")').click();
  await waitResult(page);
  const segBrief = () => page.evaluate(async () => { const r = (await import('/scripts/extensions/third-party/st-xiao-ju-chang/src/store.js')).state.recent[0]; return { u: r.request[0].messages.map(m => m.content).join('\n'), snap: r.snapshot, title: r.title }; });
  let sb = await segBrief();
  const forms = ['三张牌阵', '凯尔特十字', '单张抽牌'].filter(t => sb.u.includes(`【牌阵 · ${t}】`));
  ok(!sb.u.includes('【任务') && sb.u.includes('写成同一篇') && sb.u.indexOf('【主题 · 深巷塔罗屋】') >= 0 && sb.u.indexOf('【主题 · 深巷塔罗屋】') < sb.u.indexOf('【牌阵 · ') && forms.length === 1, `几条提示词合成同一篇（不再是任务 1、任务 2），按段的顺序，「牌阵」段只抽了一种（${forms}）`);
  ok((await page.textContent('.xjc-combo-card .xjc-chips')).includes('随机抽 1 / 3') && (await page.textContent('.xjc-combo-card .xjc-pickrow')).includes('随机 1 条'), '舞台卡片显示「牌阵 随机抽 1 / 3」和「这次抽」');
  await page.click('.xjc-combo-card .xjc-pickrow .xjc-btn:has-text("指定")');
  ok(await page.locator('.xjc-sheet .xjc-sec:has-text("牌阵 · 平时随机抽 1 条")').count() === 1, '「这次抽」按段列出');
  await page.click('.xjc-sheet .xjc-item:has(.t:text-is("凯尔特十字"))');
  await page.click('.xjc-sheet-ft .xjc-btn:has-text("用这 1 条")');
  await page.click('.xjc-actions .pri');
  await waitResult(page);
  sb = await segBrief();
  ok(sb.u.includes('【牌阵 · 凯尔特十字】') && !sb.u.includes('【牌阵 · 三张牌阵】') && !sb.u.includes('【牌阵 · 单张抽牌】') && sb.snap.randomsForced, '「这次抽」指定段里的一条，就用这一条');
  await page.click('.xjc-combo-card .xjc-pickrow .xjc-btn:has-text("改回随机")');
  // 接着写 / 追问：带上前文，沿用这一篇抽到的牌阵
  const prevTitle = sb.title;
  await page.click('.xjc-ops .xjc-btn:has-text("接着写 / 追问")');
  await page.click('.xjc-sheet .xjc-seg button:text-is("追问")');
  await page.fill('.xjc-sheet .xjc-field:has(> .lb:text-is("这次的要求")) textarea', '那逆位呢？');
  await page.click('.xjc-sheet-ft .xjc-btn:has-text("出一篇")');
  await waitResult(page);
  sb = await segBrief();
  ok(sb.snap.follow?.mode === 'ask' && sb.u.includes('接着问：那逆位呢？') && sb.u.includes(`《${prevTitle}》`) && sb.u.includes('【牌阵 · 凯尔特十字】'), '追问：带上上一篇的正文和问题，沿用上一篇抽到的牌阵');
  ok((await page.textContent('.xjc-result-hd .kind')).includes(`追问《${prevTitle}》`), '结果卡上写着追问的是哪一篇');
  await page.click('.xjc-ops .xjc-btn:has-text("接着写 / 追问")');
  await page.click('.xjc-sheet-ft .xjc-btn:has-text("出一篇")');
  await waitResult(page);
  const thread = await page.evaluate(async () => (await import('/scripts/extensions/third-party/st-xiao-ju-chang/src/store.js')).state.recent[0].thread?.length);
  sb = await segBrief();
  ok(thread === 2 && sb.snap.follow?.mode === 'write' && sb.u.includes(`《${prevTitle}》`), `接着写：可以一直往下接，前文带着前面 ${thread} 篇`);
  await page.click('.xjc-ops .xjc-btn:has-text("再来一条")');
  await waitResult(page);
  sb = await segBrief();
  ok(sb.snap.follow?.mode === 'write' && sb.u.includes('接着最后这一篇往下写'), '接着写出来的那篇「再来一条」，还是接着同一篇重写');
  await page.evaluate(async () => { const s = await import('/scripts/extensions/third-party/st-xiao-ju-chang/src/store.js'); s.state.combos = s.state.combos.filter(c => c.name !== '塔罗分段'); await s.save('combos'); await s.setSetting({ currentComboId: 'c_store', stagePick: null }); });
  await page.click('.xjc-tabs button[data-v="library"]');
  const tarot = await page.evaluate(async () => {
    const base = '/scripts/extensions/third-party/st-xiao-ju-chang/src/';
    const s = await import(base + 'store.js');
    const g = await import(base + 'gen.js');
    const combo = { ...s.state.combos.find(x => x.id === 'c_store'), parts: [{ id: 'pt_t', name: '牌阵', items: ['g:塔罗形式'], pick: 1 }], random: { count: 0, include: [], exclude: [], groups: [] }, output: { mode: 'text' } };
    const seen = new Set();
    for (let i = 0; i < 3; i++) {
      const r = await g.generateTheater(combo, {});
      const sys = r.request[0].messages.map(m => m.content).join('\n');
      const hits = [0, 1, 2].filter(k => sys.includes(`【塔罗形式${k}】`));
      if (hits.length !== 1) return { bad: hits.length };
      seen.add(hits[0]);
    }
    s.state.prompts = s.state.prompts.filter(p => !p.id.startsWith('p_tarot'));
    await s.save('prompts');
    return { bad: 0, seen: seen.size };
  });
  ok(tarot.bad === 0, `整组放进一段、随机抽 1：每次只用「塔罗形式」组里的一种（3 次抽到 ${tarot.seen} 种）`);

  // 3d. 内置指令可以改：改了「纯文字」的输出要求，发给模型的就是改过的；恢复默认后回到原样
  await page.click('.xjc-tabs button[data-v="settings"]');
  await page.click('.xjc-view[data-view="settings"] .xjc-seg >> text=生成');
  await page.click('.xjc-view[data-view="settings"] .xjc-btn:has-text("编辑内置指令")');
  const outTextBox = page.locator('.xjc-sheet .xjc-field:has(> .lb:has-text("纯文字")) textarea').first();
  await outTextBox.fill('只写纯文字，每段不超过三句。【改过的纯文字要求】');
  ok(await page.locator('.xjc-sheet .xjc-field:has(> .lb:has-text("纯文字")) .xjc-temp').first().isVisible(), '改过的内置指令标「已改」');
  await page.click('.xjc-sheet-ft >> text="保存"');
  const instrRun = await page.evaluate(async () => {
    const base = '/scripts/extensions/third-party/st-xiao-ju-chang/src/';
    const s = await import(base + 'store.js');
    const g = await import(base + 'gen.js');
    const c = { ...s.state.combos.find(x => x.id === 'c_store'), output: { ...s.state.combos.find(x => x.id === 'c_store').output, mode: 'text' } };
    const r = await g.generateTheater(c, {});
    return r.request[0].messages.map(m => m.content).join('\n');
  });
  ok(instrRun.includes('【改过的纯文字要求】') && !instrRun.includes('只输出纯文字正文'), '改过的内置指令发给了模型');
  await page.click('.xjc-view[data-view="settings"] .xjc-btn:has-text("编辑内置指令")');
  await page.click('.xjc-sheet-ft .xjc-btn:has-text("全部恢复默认")');
  await page.locator('.xjc-sheet').last().locator('.xjc-btn:text-is("恢复")').click();
  await page.click('.xjc-sheet-ft >> text="保存"');
  ok(await page.evaluate(async () => Object.keys((await import('/scripts/extensions/third-party/st-xiao-ju-chang/src/store.js')).state.settings.instr || {}).length === 0), '内置指令全部恢复默认');

  // 3e. HTML 规范是库里的一类：跟随全局带默认那条，小剧场可以指定别的或不带，纯文字不带
  const specRun = await page.evaluate(async () => {
    const base = '/scripts/extensions/third-party/st-xiao-ju-chang/src/';
    const s = await import(base + 'store.js');
    const g = await import(base + 'gen.js');
    s.state.specs.push({ id: 'spec_test', name: '测试规范', content: '【自定的HTML规范】可以用 Font Awesome。' });
    const c0 = s.state.combos.find(x => x.id === 'c_store');
    const run = async output => (await g.generateTheater({ ...c0, output: { ...c0.output, ...output } }, {})).request[0].messages.map(m => m.content).join('\n');
    const out = { def: await run({ mode: 'html', spec: '' }), own: await run({ mode: 'mixed', spec: 'spec_test' }), none: await run({ mode: 'html', spec: 'none' }), text: await run({ mode: 'text', spec: 'spec_test' }) };
    s.state.specs = s.state.specs.filter(x => x.id !== 'spec_test');
    return out;
  });
  ok(specRun.def.includes('【HTML 规范】') && specRun.def.includes('不引用任何外部资源'), 'HTML 小剧场跟随全局：带默认的「手机通用」规范');
  ok(specRun.own.includes('【自定的HTML规范】') && !specRun.own.includes('不引用任何外部资源'), '小剧场指定别的规范：只带那条，不再带默认的');
  ok(!specRun.none.includes('【HTML 规范】') && !specRun.text.includes('【HTML 规范】'), '选「不带」或纯文字：不带 HTML 规范');
  ok(await page.evaluate(async () => (await import('/scripts/extensions/third-party/st-xiao-ju-chang/src/store.js')).state.combos.filter(c => c.output?.mode === 'html').every(c => c.output.spec !== 'none')), '新装：自带的 HTML 小剧场都跟随全局 HTML 规范（不会被迁移成「不带」）');
  // AI 自选：没有带「形式」标签的提示词时，用全部提示词当菜单
  const aiMenu = await page.evaluate(async () => {
    const base = '/scripts/extensions/third-party/st-xiao-ju-chang/src/';
    const s = await import(base + 'store.js');
    const g = await import(base + 'gen.js');
    const keep = s.state.prompts.map(p => p.tags);
    s.state.prompts.forEach(p => { p.tags = (p.tags || []).filter(t => t !== '形式'); });
    const menu = g.aiPickCombo()._virtualPrompts[0].content;
    s.state.prompts.forEach((p, i) => { p.tags = keep[i]; });
    return menu.includes('1. ') && menu.includes(s.state.prompts[0].title);
  });
  ok(aiMenu, 'AI 自选：没有「形式」标签时用全部提示词当菜单');
  await page.click('.xjc-tabs button[data-v="stage"]');

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
  await page.click('.xjc-combo-card .xjc-btn:has-text("换一个")');
  await page.locator('.xjc-sheet .xjc-item', { hasText: '深夜便利店偶遇' }).first().click();
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
  await sleep(800);
  const files5 = await page.evaluate(async () => {
    const get = async n => { const r = await fetch(`/user/files/xiao-ju-chang-${n}.json?t=${Date.now()}`, { cache: 'no-store' }); return r.ok ? r.json() : null; };
    return { fav: await get('favorites'), apis: await get('apis'), bagApis: 'apis' in (SillyTavern.getContext().extensionSettings.xiaoJuChang || {}) };
  });
  ok(Array.isArray(files5.fav) && files5.fav.length === 1, '收藏存成酒馆服务器上的用户文件（换设备、换浏览器都在）');
  ok(Array.isArray(files5.apis) && files5.apis.some(a => a.key === 'sk-test-123') && !files5.bagApis, `API 配置（含密钥）存在单独的文件里，不在 settings.json（文件 ${files5.apis && files5.apis.length} 条，settings 里有：${files5.bagApis}）`);
  // 最近 / 收藏按角色：默认只看当前角色；收藏多了能搜
  const scopeT = await page.evaluate(async () => {
    const s = await import('/scripts/extensions/third-party/st-xiao-ju-chang/src/store.js');
    const keepR = s.state.recent, keepF = s.state.favorites;
    const fake = (i, who) => ({ id: 'r_fake' + i + who, title: `假的${who}${i}`, characterName: who, segments: [{ type: 'text', content: 'x' }], snapshot: { comboName: '假小剧场' } });
    s.state.recent = [fake(0, '别人'), ...keepR];
    s.state.favorites = [...keepF, ...[1, 2, 3, 4, 5, 6].map(i => fake(i, '林晚')), fake(7, '别人')];
    window.XiaoJuChang.open('stage');
    const rec = document.querySelector('.xjc-stage-recent');
    const r1 = !rec.textContent.includes('假的别人0') && !!rec.querySelector('.xjc-chip');
    [...rec.querySelectorAll('.xjc-chip')].find(c => c.textContent.includes('全部角色')).click();
    const r2 = document.querySelector('.xjc-stage-recent').textContent.includes('假的别人0');
    await s.setSetting({ recentScope: 'char' });
    window.XiaoJuChang.open('fav');
    const favView = document.querySelector('.xjc-view[data-view="fav"]');
    const f1 = favView.textContent.includes('假的林晚1') && !favView.textContent.includes('假的别人7');
    const q = favView.querySelector('input[type=search]');
    q.value = '林晚3'; q.dispatchEvent(new Event('input'));
    const f2 = favView.querySelectorAll('.xjc-item').length === 1;
    s.state.recent = keepR; s.state.favorites = keepF;
    q.value = ''; q.dispatchEvent(new Event('input'));
    return { r1, r2, f1, f2 };
  });
  ok(scopeT.r1 && scopeT.r2, `「最近」默认只看当前角色，可切到全部角色（${JSON.stringify(scopeT)}）`);
  ok(scopeT.f1 && scopeT.f2, '收藏默认只看当前角色，能搜索');
  await page.click('.xjc-tabs button[data-v="fav"]');
  await page.click('.xjc-view[data-view="fav"] .xjc-item');
  await page.waitForSelector('.xjc-viewer .xjc-frame');
  const vbox = await page.$eval('.xjc-viewer', n => { const r = n.getBoundingClientRect(); return { l: Math.round(r.left), w: Math.round(r.width), shade: !!document.querySelector('.xjc-viewer-shade') }; });
  ok(vbox.w === 920 && vbox.l === 180 && vbox.shade, `电脑上全屏和面板一样大、居中（${JSON.stringify(vbox)}）`);
  await page.screenshot({ path: `${SHOTS}/d-06-viewer.png` });
  await page.click('.xjc-viewer-shade', { position: { x: 20, y: 20 } });
  ok(await page.locator('.xjc-viewer').count() === 0 && await page.locator('.xjc-viewer-shade').count() === 0, '点全屏外面的暗处就关掉');

  // 6. 楼层功能默认关：没有「挂到聊天」、消息菜单里没有面具按钮；打开后才有
  await page.click('.xjc-tabs button[data-v="stage"]');
  await page.click('.xjc-result-hd h3');
  await page.waitForSelector('.xjc-viewer .xjc-frame', { timeout: 5000 });
  ok(await page.locator('.xjc-result-hd .xjc-fs').isVisible(), '结果卡右上角有「全屏」，点标题也能直接全屏');
  await page.click('.xjc-viewer >> text=‹ 返回');
  ok(!(await page.locator('.xjc-ops >> text=挂到聊天').isVisible()), '楼层功能默认关：结果里没有「挂到聊天」');
  ok(await page.evaluate(() => { const b = document.querySelector('#chat .mes .xjc-mes-btn'); return !!b && getComputedStyle(b).display === 'none'; }), '楼层功能默认关：消息菜单里没有面具按钮');
  ok(await page.locator('.xjc-view[data-view="fav"] .xjc-seg').count() === 0, '楼层功能默认关：收藏页不显示「本聊天」');
  await page.click('.xjc-tabs button[data-v="settings"]');
  await page.click('.xjc-view[data-view=settings] .xjc-seg button:has-text("聊天内")');
  await page.click('.xjc-toggle:has-text("在楼层里显示小剧场")');
  await page.click('.xjc-toggle:has-text("先填这次的附加要求")');
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
  const pop = page.locator('.popup:visible .popup-input').last();
  await pop.fill('楼层附加要求测试');
  await page.locator('.popup:visible .popup-button-ok').last().click();
  await page.waitForFunction(() => document.querySelectorAll('#chat .mes .xjc-tail-card').length >= 2 && !document.querySelector('.xjc-tail-busy'), null, { timeout: 30000 });
  ok(true, '消息按钮出了一篇');
  ok(JSON.stringify(lastCall().messages).includes('楼层附加要求测试'), '面具按钮先问附加要求，填的内容发给了模型');
  // 7a. 楼层里的「接着写 / 追问」：小输入框，新的一篇挂在同一楼
  const nTail = await page.locator('#chat .mes .xjc-tail-card').count();
  const tailCard = page.locator('#chat .mes .xjc-tail-card').last();
  await tailCard.locator('.xjc-tb[title="接着写 / 追问"]').click();
  await tailCard.locator('.xjc-tail-follow textarea').fill('楼层追问测试');
  await tailCard.locator('.xjc-tail-fb:text-is("追问")').click();
  await page.waitForFunction(n => document.querySelectorAll('#chat .mes .xjc-tail-card').length > n && !document.querySelector('.xjc-tail-busy'), nTail, { timeout: 30000 });
  const tailAsk = JSON.stringify(lastCall().messages);
  ok(tailAsk.includes('接着问：楼层追问测试') && !tailAsk.includes('【接在聊天后面】'), '楼层里追问：带上那一篇和问题，挂在同一楼');
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
    const i = document.querySelector('.xjc-root input[type=text], .xjc-root textarea');
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
  const dark = await page.evaluate(async () => { const s = (await import('/scripts/extensions/third-party/st-xiao-ju-chang/src/store.js')).state; const c = s.combos.find(x => x.name === '午夜电台'); return c && { n: c.parts.flatMap(pt => pt.items).length, mode: c.output.mode, tags: c.tags }; });
  ok(dark && dark.n === 2 && dark.mode === 'mixed' && dark.tags.includes('暗柜'), '暗柜档案导入成两条提示词 + 一个小剧场');

  // 7d1. 世界书：选文件认出条目（禁用的标出来），从酒馆世界书直接挑
  const bookFile = path.join(SHOTS, '剧本世界书.json');
  fs.writeFileSync(bookFile, JSON.stringify({ entries: {
    1: { uid: 1, displayIndex: 1, key: ['弹幕'], comment: '弹幕流', content: '输出一段带弹幕滚动的 HTML。', disable: true },
    0: { uid: 0, displayIndex: 0, key: ['雨夜'], comment: '雨夜电话亭', content: '{{char}}在雨夜的电话亭给{{user}}打电话。', constant: true },
  } }));
  await page.click('.xjc-view[data-view=library] .xjc-btn:has-text("导入")');
  const [ch3] = await Promise.all([page.waitForEvent('filechooser'), page.click('.xjc-sheet .xjc-btn:has-text("选文件")')]);
  await ch3.setFiles(bookFile);
  await page.waitForSelector('.xjc-sheet h3:has-text("世界书「剧本世界书」")');
  const bookRows = await page.$$eval('.xjc-sheet .xjc-check', ns => ns.map(n => ({ t: n.textContent, off: n.classList.contains('xjc-off'), on: n.querySelector('input').checked })));
  ok(bookRows.length === 2 && bookRows[0].t.includes('雨夜电话亭') && bookRows[0].t.includes('蓝灯') && bookRows[1].off && bookRows[1].t.includes('已禁用') && !bookRows.some(r => r.on),
    `世界书文件：按酒馆顺序列条目、用标题当名字、禁用的标出来、默认不勾（${JSON.stringify(bookRows)}）`);
  await page.click('.xjc-sheet .xjc-check:has-text("雨夜电话亭") input');
  await page.click('.xjc-sheet .xjc-btn.pri');
  await sleep(300);
  await page.click('.xjc-view[data-view=library] .xjc-btn:has-text("导入")');
  await page.click('.xjc-sheet .xjc-btn:has-text("从酒馆世界书选")');
  await page.click('.xjc-sheet .xjc-pick-book:has-text("雨城")');
  await page.waitForSelector('.xjc-sheet h3:has-text("世界书「雨城」")');
  await page.screenshot({ path: `${SHOTS}/d-07b-import-book.png` });
  await page.click('.xjc-sheet .xjc-check:has-text("便利店") input');
  await page.click('.xjc-sheet .xjc-seg >> text=随机条目');
  await page.click('.xjc-sheet .xjc-btn.pri');
  await sleep(300);
  const fromBook = await page.evaluate(async () => { const s = (await import('/scripts/extensions/third-party/st-xiao-ju-chang/src/store.js')).state; return { p: s.prompts.find(x => x.title === '雨夜电话亭')?.content, r: s.randoms.find(x => x.title === '便利店')?.content, off: s.prompts.some(x => x.title === '弹幕流') }; });
  ok(fromBook.p?.includes('电话亭') && !fromBook.off, '世界书文件里勾的条目导成提示词，没勾的不导');
  ok(fromBook.r?.includes('晴天'), '从酒馆世界书「雨城」直接挑条目导成随机条目');

  // 7d1a. 提示词批量管理：勾几条放进新分组，再移出
  await page.click('.xjc-view[data-view=library] .xjc-seg button:has-text("提示词")');
  await page.click('.xjc-view[data-view=library] .xjc-btn:has-text("批量管理")');
  await page.click('.xjc-view[data-view=library] .xjc-item:has(.t:text-is("天台烟花"))');
  await page.click('.xjc-view[data-view=library] .xjc-item:has(.t:text-is("打工日记"))');
  await page.click('.xjc-batch-bar .xjc-btn:has-text("放进分组")');
  await page.selectOption('.xjc-sheet select', '\u0000new');
  await page.fill('.xjc-sheet .xjc-grp-pick input', '批量测试');
  await page.click('.xjc-sheet-ft .xjc-btn:has-text("放进去")');
  await sleep(300);
  ok((await page.evaluate(async () => (await import('/scripts/extensions/third-party/st-xiao-ju-chang/src/store.js')).state.prompts.filter(p => p.group === '批量测试').length)) === 2, '批量管理：勾两条放进新分组');
  await page.click('.xjc-grp-hd:has(b:text-is("批量测试")) .xjc-btn:has-text("全选")');
  await page.click('.xjc-batch-bar .xjc-btn:has-text("放进分组")');
  await page.click('.xjc-sheet-ft .xjc-btn:has-text("放进去")');
  await sleep(300);
  ok((await page.evaluate(async () => (await import('/scripts/extensions/third-party/st-xiao-ju-chang/src/store.js')).state.prompts.filter(p => p.group === '批量测试').length)) === 0, '批量管理：分组标题上全选，选「未分组」移出');
  await page.click('.xjc-view[data-view=library] .xjc-btn:has-text("退出批量")');

  // 7d1b. 「换一个」里可以标爱用、按爱用筛选；小剧场和提示词都能点开看全文
  await page.click('.xjc-tabs button[data-v="stage"]');
  await page.click('.xjc-combo-card .xjc-btn:has-text("换一个")');
  await page.click('.xjc-sheet .xjc-item:has-text("塔罗屋") .xjc-btn[title="标为爱用"]');
  await page.click('.xjc-sheet .xjc-chip:has-text("爱用")');
  const favNames = await page.$$eval('.xjc-sheet .xjc-list .xjc-item .t', ts => ts.map(t => t.textContent));
  ok(favNames.length === 1 && favNames[0] === '塔罗屋', `「★ 爱用」筛选（${favNames}）`);
  await page.click('.xjc-sheet .xjc-item:has-text("塔罗屋") .xjc-btn[title="查看"]');
  ok((await page.locator('.xjc-sheet summary').allTextContents()).includes('深巷塔罗屋'), '小剧场详情列出提示词');
  await page.click('.xjc-sheet-ft .xjc-btn:has-text("用这个")');
  await page.click('.xjc-combo-card .xjc-btn:has-text("换一个")');
  await page.click('.xjc-sheet .xjc-seg button:has-text("直接用提示词")');
  await page.evaluate(() => document.querySelectorAll('.xjc-sheet details').forEach(d => { d.open = true; }));
  await page.click('.xjc-sheet .xjc-item:has(.t:text-is("深夜便利店")) .xjc-btn[title="查看"]');
  ok((await page.textContent('.xjc-sheet .xjc-pre-full')).includes('店员在打瞌睡'), '提示词详情显示全文');
  await page.click('.xjc-sheet-ft .xjc-btn:has-text("爱用") >> nth=-1');
  ok(await page.evaluate(async () => (await import('/scripts/extensions/third-party/st-xiao-ju-chang/src/store.js')).state.prompts.find(p => p.title === '深夜便利店').fav === true), '提示词也能标爱用');
  await page.click('.xjc-sheet .xjc-x >> nth=-1');
  await page.click('.xjc-sheet .xjc-x');
  await page.click('.xjc-tabs button[data-v="library"]');

  // 7d2. 舞台选小剧场：点卡片弹列表，能搜索，点一行设为当前
  await page.click('.xjc-tabs button[data-v="stage"]');
  await page.click('.xjc-combo-card .nm');
  await page.fill('.xjc-sheet input[type=search]', '午夜');
  const pickN = await page.locator('.xjc-sheet .xjc-item').count();
  await page.locator('.xjc-sheet .xjc-item', { hasText: '午夜电台' }).click();
  ok(pickN === 1 && (await page.textContent('.xjc-combo-card .nm')) === '午夜电台' && await page.locator('.xjc-sheet').count() === 0, `选小剧场列表能搜索（${pickN} 条），点了就换成当前`);
  await page.click('.xjc-tabs button[data-v="library"]');

  // 7e. 删提示词时从小剧场里摘掉引用
  const cleaned = await page.evaluate(async () => {
    const s = (await import('/scripts/extensions/third-party/st-xiao-ju-chang/src/store.js')).state;
    return s.combos.find(x => x.name === '午夜电台').parts[0].items[0].slice(2);
  });
  await page.click('.xjc-view[data-view=library] .xjc-seg button:has-text("提示词")');
  await page.click('.xjc-view[data-view=library] .xjc-item:has-text("午夜电台 · 剧情指令")');
  await page.click('.xjc-sheet .xjc-btn[title="删除"]');
  await page.locator('.xjc-sheet').last().locator('.xjc-btn.danger').click();
  await sleep(300);
  const refs = await page.evaluate(async id => (await import('/scripts/extensions/third-party/st-xiao-ju-chang/src/store.js')).state.combos.find(x => x.name === '午夜电台').parts.some(pt => pt.items.includes(`p:${id}`)), cleaned);
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
  ok(q && q.stream === true, '走酒馆预设也是流式请求');
  const qreq = await page.evaluate(async () => (await import('/scripts/extensions/third-party/st-xiao-ju-chang/src/store.js')).state.recent[0].request);
  ok(qreq && qreq[0].via === 'preset' && !qreq[0].partial && JSON.stringify(qreq[0].messages).includes('林晚是') && JSON.stringify(qreq[0].messages).includes('<Brief>'), '走酒馆预设：记下的是酒馆拼好、实际发出去的消息');
  // 在更早的楼层下出：酒馆预设会带上之后的聊天，自动改用插件自己拼
  const older = await page.evaluate(async () => {
    const base = '/scripts/extensions/third-party/st-xiao-ju-chang/src/';
    const s = await import(base + 'store.js');
    const g = await import(base + 'gen.js');
    const c = { ...s.state.combos.find(x => x.id === 'c_store'), writeBack: false };
    const r = await g.generateTheater(c, { uptoIndex: 0 });
    return { note: r.channelNote || '', via: r.request?.[0]?.via, sys: r.request?.[0]?.messages?.[0]?.content || '' };
  });
  ok(older.via !== 'preset' && older.note.includes('更早的楼层') && older.sys.includes('<CharacterSheet>'), `走酒馆预设 + 更早的楼层：改用插件自己拼并注明（${older.note}）`);
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

  // 7g. 跟随全局：改全局轮数，跟随的小剧场跟着变；上下文和酒馆一样（隐藏楼层不带、提示词正则生效）
  const g7 = await page.evaluate(async () => {
    const base = '/scripts/extensions/third-party/st-xiao-ju-chang/src/';
    const s = await import(base + 'store.js');
    const f = await import(base + 'follow.js');
    const c = s.state.combos.find(x => x.id === 'c_store');
    await s.setSetting({ defaultRounds: 1 });
    const r1 = f.resolveCombo(c).context.rounds;
    await s.setSetting({ defaultRounds: 12 });
    return { follows: c.context === null, r1, newOne: s.state.combos.find(x => x.name === '目击帖测试')?.context };
  });
  ok(g7.follows && g7.r1 === 1 && g7.newOne === null, '跟随全局的小剧场随全局设置变');
  const leak = await page.evaluate(async () => {
    const c = SillyTavern.getContext();
    const h = await import('/scripts/extensions/third-party/st-xiao-ju-chang/src/host.js');
    const first = c.chat.find(m => !m.is_user && !m.is_system);
    const keep = first.mes;
    first.mes += '\n【秘密】正则该清掉这句';
    const hid = c.chat.find(m => m.is_user && !m.is_system);
    hid.is_system = true;
    const before = (await h.buildMaterials({ context: { chat: 'recent', rounds: 12, worldInfo: false, summary: false } })).text;
    c.extensionSettings.regex = [...(c.extensionSettings.regex || []), { id: 'xjc-test', scriptName: '小剧场测试', findRegex: '/【秘密】[^\\n]*/g', replaceString: '', trimStrings: [], placement: [1, 2], disabled: false, markdownOnly: false, promptOnly: true, runOnEdit: false, substituteRegex: 0, minDepth: null, maxDepth: null }];
    const after = (await h.buildMaterials({ context: { chat: 'recent', rounds: 12, worldInfo: false, summary: false } })).text;
    c.extensionSettings.regex = c.extensionSettings.regex.filter(x => x.id !== 'xjc-test');
    first.mes = keep; hid.is_system = false;
    return { before: before.includes('【秘密】'), after: after.includes('【秘密】'), hidden: after.includes(hid.mes) };
  });
  ok(leak.before && !leak.after, `上下文套用酒馆的提示词正则（套之前有：${leak.before}，套之后有：${leak.after}）`);
  ok(!leak.hidden, '隐藏的楼层不进上下文');

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
  // 换一个回复（swipe）默认不自动出
  const briefs = () => mockCalls().filter(c => JSON.stringify(c.messages).includes('<Brief>')).length;
  const b0 = briefs();
  const lastM = page.locator('#chat .mes').last();
  await lastM.hover();
  await lastM.locator('.swipe_right').click();
  await page.waitForFunction(() => { const l = [...document.querySelectorAll('#chat .mes')].pop(); return l && !l.querySelector('.xjc-tail-card') && !l.querySelector('.mes_text:empty'); }, null, { timeout: 30000 });
  await sleep(2500);
  ok(briefs() === b0 && !(await page.locator('#chat .mes').last().locator('.xjc-tail-card').count()), '换一个回复（swipe）时默认不自动出');
  await page.locator('#chat .mes').last().hover();
  await page.locator('#chat .mes').last().locator('.swipe_left').click();
  await page.waitForFunction(() => [...document.querySelectorAll('#chat .mes')].pop()?.querySelector('.xjc-tail-card'), null, { timeout: 10000 }).catch(() => {});
  ok(await page.locator('#chat .mes').last().locator('.xjc-tail-card').count() === 1, '滑回原来的回复，那篇小剧场还在（新回复不会带上旧回复的小剧场）');
  const calls = mockCalls();
  const mainChat = calls.filter(c => !c.messages.some(m => typeof m.content === 'string' && m.content.includes('<Brief>')));
  ok(mainChat.every(c => !JSON.stringify(c.messages).includes('牌面朝下') && !JSON.stringify(c.messages).includes('<Brief>')), '聊天里的小剧场不会发给模型');

  // 9. 刷新后还在；手动收起的那篇刷新后还是收起的
  await page.locator('#chat .mes .xjc-tail-card').first().locator('.xjc-tail-hd .ttl').click();
  ok(await page.locator('#chat .mes .xjc-tail-card').first().locator('.xjc-tail-bd').isHidden(), '点标题栏收起');
  // 老数据搬家：settings.json 里的 API 配置、服务器上还没有文件 → 刷新后搬进文件，settings.json 里删掉
  await page.evaluate(async () => {
    const c = SillyTavern.getContext();
    const apis = await (await fetch(`/user/files/xiao-ju-chang-apis.json?t=${Date.now()}`, { cache: 'no-store' })).json();
    await fetch('/api/files/delete', { method: 'POST', headers: c.getRequestHeaders(), body: JSON.stringify({ path: 'user/files/xiao-ju-chang-apis.json' }) });
    c.extensionSettings.xiaoJuChang.apis = [...apis, { id: 'a_mig', name: '老配置', format: 'openai', url: 'http://127.0.0.1:5297/v1', key: 'sk-old', model: 'm' }];
    await (await import('/script.js')).saveSettings();
  });
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
  const mig = await page.evaluate(async () => {
    const s = await import('/scripts/extensions/third-party/st-xiao-ju-chang/src/store.js');
    const f = await fetch(`/user/files/xiao-ju-chang-apis.json?t=${Date.now()}`, { cache: 'no-store' });
    const file = f.ok ? await f.json() : [];
    const r = { inState: s.state.apis.some(a => a.id === 'a_mig'), inFile: file.some(a => a.id === 'a_mig'), bag: 'apis' in SillyTavern.getContext().extensionSettings.xiaoJuChang };
    s.state.apis = s.state.apis.filter(a => a.id !== 'a_mig');
    await s.save('apis');
    return r;
  });
  ok(mig.inState && mig.inFile && !mig.bag, `以前存在 settings.json 里的 API 配置自动搬进单独的文件（${JSON.stringify(mig)}）`);
  await page.click('.xjc-view[data-view="fav"] .xjc-seg >> text=本聊天');
  ok(await page.locator('.xjc-view[data-view="fav"] .xjc-item').count() >= 3, '「本聊天」列出挂在消息下的小剧场');

  // 9b. 楼层里的折叠样式：默认胶囊（只包住标题），外观里换样式聊天里立刻变；自定 CSS 边改边看
  const fold0 = await page.evaluate(async () => {
    const d = await import('/scripts/extensions/third-party/st-xiao-ju-chang/src/defaults.js');
    const card = document.querySelector('#chat .xjc-tail-card.closed');
    const mes = card.closest('.mes_block') || card.parentElement;
    return { def: d.DEFAULT_SETTINGS.tail.expanded === false && d.DEFAULT_SETTINGS.foldStyle === 'pill', fold: card.parentElement.dataset.fold, w: card.getBoundingClientRect().width, full: card.parentElement.getBoundingClientRect().width, h: card.getBoundingClientRect().height };
  });
  ok(fold0.def && fold0.fold === 'pill' && fold0.w < fold0.full * 0.8 && fold0.h < 36, `默认收起、胶囊样式，只包住标题（${Math.round(fold0.w)}/${Math.round(fold0.full)} 宽，${Math.round(fold0.h)} 高）`);
  await page.click('.xjc-tabs button[data-v="settings"]');
  await page.click('.xjc-view[data-view=settings] .xjc-seg button:has-text("外观")');
  await page.click('.xjc-fold-opt[data-v="line"]');
  const foldLine = await page.evaluate(() => { const c = document.querySelector('#chat .xjc-tail-card.closed'); return { fold: c.parentElement.dataset.fold, border: getComputedStyle(c).borderTopWidth }; });
  ok(foldLine.fold === 'line' && foldLine.border === '0px', '换成「一行小字」，聊天里收起的小剧场立刻跟着变');
  await page.click('.xjc-fold-opt[data-v="custom"]');
  await page.fill('.xjc-fold-edit textarea', '.xjc-tail[data-fold="custom"] .xjc-tail-card.closed { outline: 3px solid rgb(1, 2, 3); }');
  const foldPv = await page.evaluate(() => getComputedStyle(document.querySelector('.xjc-fold-opt[data-v="custom"] .xjc-tail-card')).outlineColor);
  ok(foldPv === 'rgb(1, 2, 3)', '自定折叠样式：边改边预览');
  await page.click('.xjc-fold-edit .xjc-btn:has-text("保存自定样式")');
  const foldSaved = await page.evaluate(async () => (await import('/scripts/extensions/third-party/st-xiao-ju-chang/src/store.js')).state.settings.foldCss.includes('rgb(1, 2, 3)') && getComputedStyle(document.querySelector('#chat .xjc-tail-card.closed')).outlineColor === 'rgb(1, 2, 3)');
  ok(foldSaved, '自定折叠样式保存后聊天里生效');
  await page.click('.xjc-fold-opt[data-v="pill"]');
  await page.screenshot({ path: `${SHOTS}/d-08-fold.png` });
  await page.click('.xjc-x');

  // 10. 导入 Float 小剧场整包
  const imported = await page.evaluate(async () => {
    const d = await import('/scripts/extensions/third-party/st-xiao-ju-chang/src/data.js');
    const s = await import('/scripts/extensions/third-party/st-xiao-ju-chang/src/store.js');
    const n = await d.importBundle({ app: 'float.xiaojuchang', version: 1, prompts: [{ id: 'p_x', title: 'Float 来的', tags: ['场景'], content: '一段测试' }], combos: [{ id: 'c_x', name: 'Float 组合', promptIds: ['p_x'], memory: { mode: 'host', rounds: 6 }, writeBack: true, rawChannel: true, output: { mode: 'text' } }] });
    const c = s.state.combos.find(x => x.name === 'Float 组合');
    return { n, ctx: c && c.context, hasRaw: c && ('rawChannel' in c), linked: c && s.state.prompts.some(p => `p:${p.id}` === c.parts[0]?.items[0] && p.title === 'Float 来的') };
  });
  ok(imported.n === 2 && imported.ctx === null && !imported.hasRaw && imported.linked, 'Float 整包导入并换算字段（「跟宿主记忆」→ 跟随全局）');

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
  await page.tap('.xjc-result-hd .xjc-fs');
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
  await page.evaluate(() => window.XiaoJuChang.open('stage'));
  await page.tap('.xjc-extra-open');
  const inputFont = await page.evaluate(() => { return [getComputedStyle(document.querySelector('.xjc-extra textarea')).fontSize, document.querySelector('meta[name=viewport]')?.content || '']; });
  ok(inputFont[0] === '14px' && /maximum-scale=1/.test(inputFont[1]), `手机输入框和正文一样大（${inputFont[0]}），viewport 禁止缩放所以 iOS 不会放大`);
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
