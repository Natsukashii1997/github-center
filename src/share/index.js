// 只读快照（#63）：把本机网站的发现、涨星、收藏、设置四页导出成不靠本机服务、别人能直接打开的文件，
// 用来更新 Claude Artifact 上的分享页。本进程起一个临时网站（端口 0，不碰常驻的 5310）取页面和安装指令，再下载项目头像。
// 产物（outDir）：
//   index.html             发现页，去掉外层 html/head/body（Artifact 发布时给主页面套壳），发布时作主页面
//   stars.html / favorites.html / settings.html   完整文档，作附带文件
//   tidings-avatars.js     四页共用的头像（data: 图），浏览器只下一次
//   tidings-install.gz.txt 安装指令，gzip 后 base64（Artifact 不托管 .gz），按「项目 id|AI|Skill 路径」查
// 访客视角：不带账号名、收藏、投票，收藏页为空，设置页只读；页头写「只读快照 · M 月 D 日」。
// Artifact 只放行同源文件和 data:，所以样式脚本全内联、头像内嵌；页面里的垫片见 shim.js。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { request } from 'node:http';
import { gzipSync } from 'node:zlib';
import { startServer } from '../web/server.js';
import { openAccounts } from '../web/accounts.js';

export const PAGES = [['index', '/'], ['stars', '/stars'], ['favorites', '/favorites'], ['settings', '/settings']];
const FILES = { '': 'index.html', stars: 'stars.html', favorites: 'favorites.html', settings: 'settings.html' };
const ASSETS = new URL('../web/assets/', import.meta.url);
const SHIM = new URL('./shim.js', import.meta.url);
const DATA = /(<script type="application\/json" id="gc-data">)([^<]*)(<\/script>)/;
// 收藏星标、投票、换卡、账号头像都是个人的，快照里藏起来
const CSS = `[data-star], .vote, [data-swap], .me, form[action="/logout"] { display: none !important; }
.share-tag { font-size: 12px; color: #57606a; border: 1px solid #d0d7de; border-radius: 999px; padding: 2px 10px; white-space: nowrap; }
#snap-toast { position: fixed; z-index: 61; left: 50%; top: 18px; transform: translate(-50%, -8px); opacity: 0; transition: .2s; padding: 8px 14px; border-radius: 8px; background: #1f2328; color: #fff; font-size: 13px; pointer-events: none; }
#snap-toast.on { opacity: 1; transform: translate(-50%, 0); }`;

// 去掉个人的东西：收藏、能不能改、账号名；收藏页整页给空的
export function scrub(kind, data) {
  const d = structuredClone(data);
  for (const p of Object.values(d.projects ?? {})) Object.assign(p, { saved: false, savedSkills: [] });
  if (d.picks && typeof d.picks === 'object') d.picks.canEdit = false;
  if ('account' in d) d.account = { name: '访客' };
  if (kind === 'favorites') Object.assign(d, { items: [], shelves: [], projects: {}, views: {} });
  if (kind === 'settings') Object.assign(d, { me: '访客', canEdit: false });
  return d;
}

// 头像：项目有 ownerId 按 u/<id>，提到的仓库都按作者名 n/<作者> 再备一份（发现页的历史榜、热点榜只有仓库名）
export function avatarUrls(datas) {
  const urls = new Map();
  for (const d of datas) {
    for (const [, owner] of JSON.stringify(d).matchAll(/"(?:repo|fullName)":"([\w.-]+)\/[\w.-]+"/g)) urls.set(`n/${owner.toLowerCase()}`, `https://github.com/${encodeURIComponent(owner)}.png?size=88`);
    for (const p of Object.values(d.projects ?? {})) if (p.ownerId) urls.set(`u/${p.ownerId}`, `https://avatars.githubusercontent.com/u/${p.ownerId}?s=88&v=4`);
  }
  return urls;
}

// 安装指令：每个能安装的项目 × 每个 AI × （整个项目 + 每个 Skill）
export function installJobs(datas) {
  const jobs = new Map();
  for (const d of datas) {
    for (const p of Object.values(d.projects ?? {})) {
      if (!p.installable) continue;
      for (const [ai] of d.ais ?? []) for (const skill of ['', ...p.skills.map((s) => s.path)]) jobs.set(`${p.id}|${ai}|${skill}`, { project: p.id, ai, skill });
    }
  }
  return jobs;
}

// 一页：换数据、内联样式脚本、加垫片和只读标签、站内链接改成快照里的文件名
export function sharePage(html, kind, data, label) {
  const m = DATA.exec(html);
  if (!m) throw new Error(`${kind} 页里没有找到嵌入数据`);
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  html = html.slice(0, m.index) + m[1] + json + m[3] + html.slice(m.index + m[0].length);
  html = html.replace(/<link rel="stylesheet" href="\/assets\/([\w.-]+\.css)">/g, (_, f) => `<style>\n${readFileSync(new URL(f, ASSETS), 'utf8')}\n</style>`);
  html = html.replace(/<script src="\/assets\/([\w.-]+\.js)"><\/script>/g, (_, f) => `<script>\n${readFileSync(new URL(f, ASSETS), 'utf8').replace(/<\/script/gi, '<\\/script')}\n</script>`);
  if (/(?:href|src)="\/assets\//.test(html)) throw new Error(`${kind} 页里还有没内联的 /assets/ 文件`);
  const head = `<style>\n${CSS}\n</style>\n<script src="tidings-avatars.js"></script>\n<script>window.__HOME = "index.html";</script>\n<script>\n${readFileSync(SHIM, 'utf8')}\n</script>\n`;
  if (!html.includes('</title>')) throw new Error(`${kind} 页没有 <title>`);
  html = html.replace('</title>', `</title>\n${head}`);
  html = html.replace(/<span class="me"[^>]*>.*?<\/span>/g, '');
  const r = html.indexOf('<div class="r">');
  if (r < 0 || r > html.indexOf('</header>')) throw new Error(`${kind} 页的页头里没有放标签的位置`);
  html = html.replace('<div class="r">', `<div class="r"><span class="share-tag" title="这是分享用的只读快照，不会自动更新">只读快照 · ${label}</span>`);
  return html.replace(/href="\/(stars|favorites|settings)?"/g, (_, p = '') => `href="${FILES[p]}"`);
}

// 主页面：Artifact 发布时会套上 doctype/html/head/body，只留 head 里除 charset、viewport 以外的部分和 body 内容；标题用站名
export function artifactMain(html) {
  const head = /<head[^>]*>([\s\S]*)<\/head>/.exec(html)?.[1];
  const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)?.[1];
  if (head == null || body == null) throw new Error('发现页结构不对，找不到 head 或 body');
  return `${head.replace(/<meta charset[^>]*>\s*|<meta name="viewport"[^>]*>\s*/g, '').replace(/<title>[^<]*<\/title>/, '<title>Github·Tidings</title>').trim()}\n${body.trim()}\n`;
}

// 北京时间的「11 月 7 日」
export function dayLabel(now) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric' }).formatToParts(now).map((x) => [x.type, x.value]));
  return `${p.month} 月 ${p.day} 日`;
}

// 本机请求不走代理（--use-env-proxy 下 fetch 可能把 127.0.0.1 也交给代理）
function local(url) {
  return new Promise((resolve, reject) => {
    request(url, { agent: false }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode, text }));
    }).on('error', reject).end();
  });
}

async function pool(items, n, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k]);
    }
  }));
  return out;
}

const MIME = [[[0x89, 0x50, 0x4e, 0x47], 'image/png'], [[0xff, 0xd8], 'image/jpeg'], [[0x47, 0x49, 0x46], 'image/gif']];
const sniff = (b) => MIME.find(([sig]) => sig.every((x, i) => b[i] === x))?.[1] ?? (b.slice(8, 12).toString() === 'WEBP' ? 'image/webp' : null);

// 导出。account 不填就用所有者账号（只用来打开页面，账号名和收藏不进快照）。fetch 用来下载头像，测试时换成假的。
export async function takeShare({ dataDir, outDir, account, fetch = globalThis.fetch, now = new Date() }) {
  const accounts = openAccounts(dataDir);
  let name;
  try {
    const list = accounts.list();
    name = account ?? (list.find((a) => a.role === 'owner') ?? list[0])?.name;
  } finally {
    accounts.close();
  }
  if (!name) throw new Error('还没有账号，先运行 npm run account -- add <名字>');
  const { server, url } = await startServer({ dataDir, port: 0, guest: name });
  try {
    const raw = {};
    for (const [kind, path] of PAGES) {
      const r = await local(url + path.slice(1));
      if (r.status !== 200) throw new Error(`取 ${path} 失败（${r.status}）`);
      raw[kind] = r.text;
    }
    const datas = Object.fromEntries(PAGES.map(([kind]) => [kind, scrub(kind, JSON.parse(DATA.exec(raw[kind])[2]))]));
    const jobs = [...installJobs(Object.values(datas)).entries()];
    const install = {};
    await pool(jobs, 8, async ([key, j]) => {
      const q = new URLSearchParams({ project: j.project, ai: j.ai, ...(j.skill ? { skill: j.skill } : {}) });
      const r = await local(`${url}api/install?${q}`);
      if (r.status === 200) install[key] = r.text;
    });
    const urls = [...avatarUrls(Object.values(datas)).entries()];
    const avatars = {};
    await pool(urls, 12, async ([key, u]) => {
      try {
        const r = await fetch(u);
        if (!r.ok) return;
        const b = Buffer.from(await r.arrayBuffer());
        const mime = sniff(b);
        if (mime) avatars[key] = `data:${mime};base64,${b.toString('base64')}`;
      } catch { /* 下不到的头像页面上留灰底 */ }
    });

    mkdirSync(outDir, { recursive: true });
    const label = dayLabel(now);
    const written = {};
    const write = (file, text) => {
      writeFileSync(join(outDir, file), text);
      written[file] = Buffer.byteLength(text);
    };
    for (const [kind] of PAGES) {
      const html = sharePage(raw[kind], kind, datas[kind], label);
      write(`${kind}.html`, kind === 'index' ? artifactMain(html) : html);
    }
    write('tidings-avatars.js', `window.__AV = ${JSON.stringify(avatars)};\n`);
    write('tidings-install.gz.txt', gzipSync(JSON.stringify(install), { level: 9 }).toString('base64'));
    return { files: written, avatars: [Object.keys(avatars).length, urls.length], install: [Object.keys(install).length, jobs.length], label };
  } finally {
    server.close();
  }
}
