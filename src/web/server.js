// 本机网站：只监听 127.0.0.1；首页只读最新快照，访问时不调用任何外部接口。样式从简，视觉由 #13 负责。
import { createServer } from 'node:http';
import { readLatestSnapshot } from '../ranking/index.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const num = (n) => n.toLocaleString('en-US');
const beijing = (iso) => new Date(Date.parse(iso) + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');

function home(snapshot) {
  const body = snapshot
    ? `<p>统计日 ${esc(snapshot.statDay)}（UTC）　更新于 ${beijing(snapshot.generatedAt)}（北京时间）</p>
<table>
<thead><tr><th>名次</th><th>项目</th><th>当天新增 Star</th><th>当前总 Star</th></tr></thead>
<tbody>
${snapshot.entries.map((e) => `<tr><td>${e.rank}</td><td><a href="https://github.com/${esc(e.fullName)}">${esc(e.fullName)}</a></td><td>+${num(e.gain)}</td><td>${num(e.total)}</td></tr>`).join('\n')}
</tbody>
</table>
<p class="note">数字来自 GitHub 官方 Star 历史；前 20 名，末位并列一起列出。</p>`
    : '<p>还没有榜单。先运行一次 <code>npm run rank</code>。</p>';
  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>涨星榜 · 近 1 天</title>
<style>body{font:14px/1.6 system-ui,-apple-system,"PingFang SC",sans-serif;margin:40px auto;max-width:880px;padding:0 24px;color:#202a30;background:#faf9f6}table{width:100%;border-collapse:collapse}th,td{padding:8px 10px;border-bottom:1px solid #dfe4e1;text-align:left}td:nth-child(3),td:nth-child(4),th:nth-child(3),th:nth-child(4){text-align:right;font-variant-numeric:tabular-nums}a{color:#176b75;text-decoration:none}.note{color:#657176;font-size:12px}</style>
</head>
<body>
<h1>涨星榜 · 近 1 天</h1>
${body}
</body>
</html>
`;
}

export function startServer({ dataDir, port = 5310 }) {
  const server = createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(405).end();
    if (new URL(req.url, 'http://127.0.0.1').pathname !== '/') return res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('没有这个页面');
    const html = home(readLatestSnapshot(dataDir));
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(req.method === 'HEAD' ? undefined : html);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` }));
  });
}
