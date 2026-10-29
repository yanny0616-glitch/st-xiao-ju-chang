// 首次启用时播种的内置内容：两套前置、一批提示词、随机池、宏、几份组合。用户可随意改删
// 默认的 HTML 规范只管怎么写；要不要围栏、要不要说明文字是输出形式的事，在内置指令里
const MOBILE_HTML_RULES = "HTML 可含 style 与 script 标签；宽度 100%，不要给根元素或 body 设 100vh / position:fixed / overflow:hidden，高度由内容自然撑开；不引用任何外部资源（图片用 CSS 或 emoji 代替）；字号以手机竖屏阅读为准，正文 13～14px。";

// HTML 规范：库里一类，小剧场选用哪条（跟随全局 / 某条 / 不带），HTML、混排、分两步的骨架会带
const DEFAULT_SPECS = [
  { id: "spec_mobile", name: "手机通用", builtin: true, content: MOBILE_HTML_RULES },
];

const DEFAULT_PREAMBLES = [
  { id: "pre_strict", name: "重约束版 · 只交成品", builtin: true, content:
`这一次不是聊天，是一次交付。你要按 <Brief> 里的规格，把手上的材料做成一件能直接看的成品。

前面给到的角色卡、用户人设、世界书、剧情总结和聊天记录都是原料。读懂人物怎么说话、彼此之间有什么分寸，然后把这些拆开重新用。不要整段搬运原料，不要接着聊天记录往下续写，那不是这次要的东西。

<Brief> 是唯一的规格书，也是唯一的交付物。要 HTML 就给能直接渲染的 HTML；要特定格式的文本就严格照那个格式走。除了成品本身，不写开场白、不写说明、不解释你做了什么、不在结尾加任何提示。` },
  { id: "pre_lite", name: "简洁版", builtin: true, content:
`用前面给出的角色卡、世界书和聊天记录理解人物，然后只输出 <Brief> 里要的东西。不复述设定，不续写聊天，不加解释。` },
];

const DEFAULT_PROMPTS = [
  { id: "p_scene_store", title: "深夜便利店", tags: ["场景", "日常"], content: "场景：雨夜，24 小时便利店。{{user}} 在关东煮前排队，{{char}} 刚下班进门，肩膀被雨打湿。灯管有一根在闪。店员在打瞌睡。" },
  { id: "p_scene_trip", title: "出差第三天", tags: ["场景", "日常"], content: "场景：{{char}} 出差第三天，两地时差三小时。{{user}} 这边已经深夜，{{char}} 那边刚开完会。今天两人只发过三条消息。" },
  { id: "p_scene_live", title: "深夜直播", tags: ["场景", "搞笑"], content: "场景：{{char}} 深夜开了一场直播（游戏 / 聊天 / 做饭随你定），{{user}} 在观众席里，弹幕里有人认出了 {{user}} 的 ID。" },
  { id: "p_scene_tarot", title: "深巷塔罗屋", tags: ["场景", "神秘"], content: "场景：一条没有路灯的巷子尽头有间塔罗屋，{{user}} 推门进去，坐在牌桌后面的是 {{char}}。只抽三张牌，每张都对应着两个人真实发生过的事。" },
  { id: "p_if_wait", title: "B 线 · TA 一直在等我", tags: ["if 线"], content: "前提改写：{{char}} 其实早就知道 {{user}} 今晚会来，之前的每一次偶遇都不是偶遇。不要点破，只在细节里留痕迹。" },
  { id: "p_if_stranger", title: "A 线 · TA 没认出我", tags: ["if 线"], content: "前提改写：{{char}} 因为某个原因暂时没认出 {{user}}，用陌生人的方式对待 {{user}}。让 {{user}} 在这种陌生里发现一点熟悉。" },
  { id: "p_form_novel", title: "小说体", tags: ["形式", "文字"], content: "形式：小说体。第三人称有限视角，跟随 {{char}} 或 {{user}} 其中一人。分段短，对白用「」。总长 {{篇幅}}。结尾停在一个未完成的动作上，不要总结、不要升华。" },
  { id: "p_form_extra", title: "番外短篇", tags: ["形式", "文字"], content: "形式：一篇番外短篇，写正文里没发生过、但完全符合两人关系的一件小事。有一个具体的物件贯穿全篇。总长 {{篇幅}}。" },
  { id: "p_form_inner", title: "内心 OS", tags: ["形式", "文字"], content: "形式：{{char}} 的内心独白，第一人称。只写 {{char}} 想说没说的话，允许语无伦次，允许自我否定。不超过 {{篇幅}}。" },
  { id: "p_form_phone", title: "手机聊天体", tags: ["形式", "前端"], content: "形式：模拟手机信息界面的 HTML。顶部是联系人 {{char}} 与在线状态，气泡左右分列（{{char}} 在左、{{user}} 在右），有已读 / 撤回 / 输入中之类的细节，时间戳围绕 {{time}} 前后半小时。总共 12～25 条消息。" },
  { id: "p_form_danmaku", title: "弹幕体", tags: ["形式", "前端"], content: "形式：HTML。一个 16:9 的深色播放器画面（用 CSS 画出画面主体，不用图片），画面上方是从右往左飘的弹幕层，30～60 条弹幕，用 CSS 动画实现，弹幕密度随剧情起伏；画面下方一行标题与在线人数。弹幕内容要有路人、粉丝、黑粉、认出 {{user}} 的人。" },
  { id: "p_form_status", title: "状态栏 + 正文", tags: ["形式", "前端"], content: "形式：HTML。顶部一张状态卡（时间 / 地点 / 天气 / {{char}} 当前心情 / 对 {{user}} 的好感变化 {{random:+1,+2,+3,-1}}），用网格排版；下面是正文纯文字，分段。正文总长 {{篇幅}}。" },
  { id: "p_form_forum", title: "论坛帖", tags: ["形式", "前端"], content: "形式：HTML，一个论坛 / 贴吧帖子页面。楼主发帖讲述目击到 {{char}} 和 {{user}} 的一件事，下面 8～15 层回复，有盖楼、有反驳、有当事人小号。每层带用户名、楼层号、时间。" },
  { id: "p_form_hot", title: "微博热搜", tags: ["形式", "前端"], content: "形式：HTML，一个热搜榜页面。榜单 8～10 条，其中 2～3 条与 {{char}} 和 {{user}} 有关（用化名或 ID），点开第一条是话题页：3～5 条博文 + 评论。" },
  { id: "p_form_tarot", title: "塔罗牌（可交互）", tags: ["形式", "前端", "交互"], content: "形式：可交互的 HTML。三张背面朝上的牌横排，点击翻面（CSS 3D 翻转），每张翻开后显示牌面（用 CSS 画）、牌名、正逆位和一段与 {{char}} 和 {{user}} 关系有关的解读。三张全翻开后，底部出现 {{char}} 说的一句话。" },
];

const DEFAULT_RANDOMS = [
  { id: "r_au", title: "平行世界 AU", tags: ["AU", "番外"], content: "把这一段放到「{{随机词:世界}}」的设定里重演，人物性格与关系不变，只换世界。" },
  { id: "r_detail", title: "今天的一个小细节", tags: ["细节"], content: "写一个正文里没出现、但一定发生过的小动作或小物件。" },
  { id: "r_bystander", title: "旁观者视角", tags: ["番外"], content: "用店员 / 路人 / 宠物 / 出租车司机的视角看这两个人。" },
  { id: "r_unsaid", title: "TA 没说出口的话", tags: ["内心"], content: "只写 {{char}} 想说没说的那三句，以及为什么没说。" },
  { id: "r_tenyears", title: "十年后", tags: ["番外", "AU"], content: "十年后的某一天，两人因为同一件小事又想起了今天。" },
  { id: "r_weather", title: "天气插曲", tags: ["细节"], content: "今天的天气是「{{随机词:天气}}」，让它实际影响一件事。" },
];

const DEFAULT_MACROS = [
  { id: "m_world", name: "世界", kind: "words", values: ["妖怪共居", "赛博义体", "蒸汽飞艇", "深海城邦", "荒原公路", "修仙宗门", "民国戏班", "海盗船", "旧马戏团", "末日避难所", "时间循环", "记忆对调", "身份对调", "武侠江湖", "星际货运", "异能事务所", "凶宅民宿", "剧本杀现场", "动物拟人", "平行婚姻"] },
  { id: "m_weather", name: "天气", kind: "words", values: ["暴雨", "小雪", "起雾", "闷热", "台风前夜", "初春回暖", "深秋大风"] },
  { id: "m_affinity", name: "好感", kind: "number", min: 1, max: 5 },
];

const ctxRecent = rounds => ({ chat: "recent", rounds, worldInfo: true, summary: true });
const ctxNone = () => ({ chat: "none", rounds: 12, worldInfo: true, summary: false });
const out = (mode, wrapTag = "") => ({ mode, wrapTag, length: "default", customChars: 900, style: "", staged: null, spec: "" });
const combo = (id, name, tags, preambleId, promptIds, random, output, context, weight) => ({ id, name, tags, preambleId, parts: [{ id: `pt_${id}`, name: "", items: promptIds.map(p => `p:${p}`), pick: 0 }], random, output, context, who: "", whoText: "", channel: "", writeBack: null, api: "", weight });

const DEFAULT_COMBOS = [
  combo("c_store", "深夜便利店偶遇", ["日常", "心动", "雨"], "pre_strict", ["p_scene_store", "p_if_wait", "p_form_novel"], { count: 0, include: ["细节"], exclude: [] }, out("text", "theater"), null, 3),
  combo("c_live", "直播间翻车现场", ["搞笑", "弹幕"], "pre_strict", ["p_scene_live", "p_form_danmaku"], { count: 0, include: [], exclude: [] }, out("html"), ctxRecent(8), 2),
  combo("c_call", "未接来电", ["虐", "手机"], "pre_strict", ["p_scene_trip", "p_form_phone"], { count: 0, include: ["细节"], exclude: ["AU"] }, out("html"), ctxRecent(30), 1),
  combo("c_au", "平行世界抽卡", ["AU", "随机"], "pre_lite", ["p_form_extra"], { count: 0, include: ["AU", "番外"], exclude: [] }, out("text", "theater"), ctxNone(), 2),
  combo("c_tarot", "塔罗屋", ["神秘", "交互"], "pre_strict", ["p_scene_tarot", "p_form_tarot"], { count: 0, include: [], exclude: [] }, out("html"), null, 2),
];

const DEFAULT_SETTINGS = Object.freeze({
  theme: "magazine", uiScale: 1, fontScale: 1, lineHeight: "mid", canvas: "theme", played: 0, motion: true,
  defaultWho: "persona", defaultChat: "recent", defaultRounds: 12, defaultWorldInfo: true, recentOpen: false, wiSource: "sync", wiAdd: [], wiRemove: [], defaultSummary: true, writeBackDefault: false, writeBackFeature: false, foldStyle: "pill", foldCss: "", defaultChannel: "own",
  lengthLimit: true, defaultLength: "medium", defaultStyle: "free", defaultSpecId: "spec_mobile", stagedDefault: false, streamPreview: true, notifyDone: true,
  randomIncludesAi: true, recentKeep: 10, currentComboId: "c_store", defaultPreambleId: "pre_strict",
  api: "st", maxTokens: 4096,
  tail: { enabled: false, button: true, askExtra: false, auto: false, autoOnSwipe: false, chance: 30, pick: "random", comboId: "", expanded: false },
  seeded: false,
});
const LENGTH_CHARS = { short: 400, medium: 900, long: 1800 };
const LENGTH_LABEL = { short: "短", medium: "中", long: "长", custom: "自定", default: "跟设置" };

// 0.5.1 及以前的内置「HTML 规则」原文：迁移时从提示词里找出来去掉
const LEGACY_HTML_RULES = "HTML 规则：输出一段完整、可直接渲染的 HTML 片段（可含 style 与 script 标签），不要 markdown 围栏、不要解释文字；宽度 100%，不要给根元素或 body 设 100vh / position:fixed / overflow:hidden，高度由内容自然撑开；不引用任何外部资源（图片用 CSS 或 emoji 代替）；字号以手机竖屏阅读为准，正文 13～14px。";

export { MOBILE_HTML_RULES, LEGACY_HTML_RULES, DEFAULT_SPECS, DEFAULT_PREAMBLES, DEFAULT_PROMPTS, DEFAULT_RANDOMS, DEFAULT_MACROS, DEFAULT_COMBOS, DEFAULT_SETTINGS, LENGTH_CHARS, LENGTH_LABEL };
