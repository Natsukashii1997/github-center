// 本机网站：只监听 127.0.0.1；首页只读快照和更新记录，访问时不调用任何外部接口。样式从简，视觉由 #13 负责。
import { createServer } from 'node:http';
import { readLatestSnapshot, readStatus, WINDOWS } from '../ranking/index.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const num = (n) => n.toLocaleString('en-US');
const beijing = (iso) => new Date(Date.parse(iso) + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
const label = (w) => `近 ${WINDOWS[w].days} 天`;

// 漏失概率写成“约万分之 1.1”这样的说法。
function chance(p) {
  if (p >= 0.01) return `约 ${(p * 100).toFixed(1)}%`;
  const units = [[1e-3, '千分之'], [1e-4, '万分之'], [1e-5, '十万分之'], [1e-6, '百万分之'], [1e-7, '千万分之'], [1e-8, '亿分之']];
  const [u, name] = units.find(([u]) => p >= u) ?? units.at(-1);
  return `约${name} ${(p / u).toFixed(1)}`;
}

function notices(window, snapshot, status) {
  const out = [];
  const last = status?.windows?.[window];
  if (last?.status === 'failed' && (!snapshot || last.day > snapshot.statDay)) {
    out.push(`统计日 ${esc(last.day)} 的榜单更新失败：${esc(last.error)}${snapshot ? `。下面仍是统计日 ${esc(snapshot.statDay)} 的榜单。` : ''}`);
  }
  if (snapshot?.incomplete) {
    const why = [];
    if (!snapshot.check.passed) why.push(`自检未通过，估计漏掉一个该上榜项目的概率${chance(snapshot.check.missProbability)}（要求小于百万分之一）`);
    if (snapshot.candidates.failed.length) why.push(`${snapshot.candidates.failed.length} 个候选的官方核数失败`);
    out.push(`可能不完整：${why.join('；')}。`);
  }
  return out.map((t) => `<p class="warn">${t}</p>`).join('\n');
}

function home(window, snapshot, status) {
  const tabs = Object.keys(WINDOWS).map((w) => (w === window ? `<strong>${label(w)}</strong>` : `<a href="/?w=${w}">${label(w)}</a>`)).join('　');
  const span = snapshot && (window === 'd1' ? `统计日 ${esc(snapshot.statDay)}（UTC）` : `统计到 ${esc(snapshot.statDay)}（UTC），${esc(snapshot.from)} 至 ${esc(snapshot.statDay)}`);
  const body = snapshot
    ? `<p>${span}　更新于 ${beijing(snapshot.generatedAt)}（北京时间）</p>
${notices(window, snapshot, status)}
<table>
<thead><tr><th>名次</th><th>项目</th><th>${window === 'd1' ? '当天' : label(window)}新增 Star</th><th>当前总 Star</th></tr></thead>
<tbody>
${snapshot.entries.map((e) => `<tr><td>${e.rank}</td><td><a href="https://github.com/${esc(e.fullName)}">${esc(e.fullName)}</a></td><td>+${num(e.gain)}</td><td>${num(e.total)}</td></tr>`).join('\n')}
</tbody>
</table>
<p class="note">数字来自 GitHub 官方 Star 历史；前 20 名，末位并列一起列出。${snapshot.check ? '' : '这份榜单生成于每日自检上线之前，没有做完整性自检。'}</p>`
    : `${notices(window, null, status)}\n<p>还没有${label(window)}的榜单。先运行一次 <code>npm run rank</code>。</p>`;
  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>涨星榜 · ${label(window)}</title>
<style>body{font:14px/1.6 system-ui,-apple-system,"PingFang SC",sans-serif;margin:40px auto;max-width:880px;padding:0 24px;color:#202a30;background:#faf9f6}table{width:100%;border-collapse:collapse}th,td{padding:8px 10px;border-bottom:1px solid #dfe4e1;text-align:left}td:nth-child(3),td:nth-child(4),th:nth-child(3),th:nth-child(4){text-align:right;font-variant-numeric:tabular-nums}a{color:#176b75;text-decoration:none}.note{color:#657176;font-size:12px}.warn{color:#8a4b0f}</style>
</head>
<body>
<h1>涨星榜 · ${label(window)}</h1>
<nav>${tabs}</nav>
${body}
</body>
</html>
`;
}

export function startServer({ dataDir, port = 5310 }) {
  const server = createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(405).end();
    const url = new URL(req.url, 'http://127.0.0.1');
    const window = url.searchParams.get('w') ?? 'd1';
    if (url.pathname !== '/' || !Object.hasOwn(WINDOWS, window)) return res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('没有这个页面');
    const html = home(window, readLatestSnapshot(dataDir, window), readStatus(dataDir));
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(req.method === 'HEAD' ? undefined : html);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` }));
  });
}
