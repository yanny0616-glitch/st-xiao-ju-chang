// 模拟 OpenAI 兼容接口：按 <Brief> 里的输出要求返回文字 / HTML / 骨架 / 填字，支持流式。记录每次请求到 MOCK_LOG
import http from 'node:http';
import fs from 'node:fs';

const PORT = Number(process.env.MOCK_PORT || 5297);
const LOG = process.env.MOCK_LOG || '';
let n = 0;

function reply(messages) {
  const all = messages.map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
  const brief = all.slice(all.lastIndexOf('<Brief>'));
  if (/只回复两个字/.test(all)) return '收到';
  if (/只做页面骨架/.test(brief)) {
    return '标题：骨架测试\n<div style="padding:12px;border:1px solid var(--xjc-line)"><h3>论坛 · 目击帖</h3><p>楼主：<span data-slot="1" data-hint="楼主正文 60 字"></span></p><p>2 楼：<span data-slot="2" data-hint="回复 20 字"></span></p><p>3 楼：<span data-slot="3" data-hint="回复 20 字"></span></p></div>';
  }
  if (/只输出各占位的文字/.test(brief)) {
    return '[[1]]\n昨晚在便利店门口看见两个人撑同一把伞，伞明显往一边歪。\n[[2]]\n楼主你这观察力不去当侦探可惜了\n[[3]]\n……我好像知道是谁';
  }
  if (/整体输出为一段 HTML/.test(brief) || /允许 HTML 与纯文字混排/.test(brief)) {
    return '标题：三张牌\n<div class="deck" style="display:flex;gap:8px;padding:8px"><button data-action="翻开第一张" style="flex:1;padding:24px 0;background:var(--xjc-acc);color:var(--xjc-bg);border:0;border-radius:8px">第一张</button><button data-action="翻开第二张" style="flex:1;padding:24px 0;border:1px solid var(--xjc-line);background:transparent;color:var(--xjc-ink);border-radius:8px">第二张</button></div><p style="padding:0 8px">牌面朝下，等你来翻。</p><script>document.querySelector(".deck").dataset.ready="1"</script>';
  }
  const tag = (brief.match(/包在 <(\w+)><\/\1> 标签内/) || [])[1];
  const body = '雨下得很密。便利店的灯管闪了一下，又亮起来。\n\n「你也没带伞？」TA 把湿透的外套搭在手臂上，声音比平时低。\n\n关东煮的汤在锅里咕嘟咕嘟，店员打了个哈欠。两个人并排站着，谁都没先开口。';
  return `标题：雨夜便利店\n${tag ? `<${tag}>${body}</${tag}>` : body}`;
}

http.createServer((req, res) => {
  let raw = '';
  req.on('data', c => { raw += c; });
  req.on('end', () => {
    if (req.url.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-small' }, { id: 'mock-large' }] }));
      return;
    }
    let body = {};
    try { body = JSON.parse(raw || '{}'); } catch { /* ignore */ }
    const messages = body.messages || [];
    const text = reply(messages);
    n++;
    if (LOG) fs.appendFileSync(LOG, JSON.stringify({ n, url: req.url, auth: req.headers.authorization || '', model: body.model, stream: !!body.stream, max_tokens: body.max_tokens, temperature: body.temperature, messages }) + '\n');
    const delay = Number(process.env.MOCK_DELAY || 300);
    if (body.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const parts = text.match(/[\s\S]{1,12}/g) || [];
      let i = 0;
      const tick = () => {
        if (i >= parts.length) { res.write('data: [DONE]\n\n'); res.end(); return; }
        res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: parts[i++] } }] })}\n\n`);
        setTimeout(tick, 40);
      };
      setTimeout(tick, delay);
      return;
    }
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'x', object: 'chat.completion', model: body.model || 'mock', choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    }, delay);
  });
}).listen(PORT, '127.0.0.1', () => console.log(`mock ai on ${PORT}`));
