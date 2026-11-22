// 分享页（#63、#71）：把本机网站的发现、涨星、收藏、设置四页导出成一个自包含文件 tidings.html，
// 不靠本机服务：既作 Claude Artifact 分享页的主页面发布，也能直接发给人用 Chrome 打开。
// 本进程起一个临时网站（端口 0，不碰常驻的 5310）取页面和安装指令，再下载项目头像。
// 文件结构：外层就是发现页，涨星、收藏、设置各放进同源的 srcdoc iframe，用到才建、页内切换，不跳转页面（#71：Artifact 里跳到附带页面打不开）；
// 头像（data: 图）和安装指令（gzip 后 base64，按「项目 id|AI|Skill 路径」查）放在外层，四页共用。
// 访客视角：不带账号名、收藏、投票，收藏页为空，设置页只读；页头写「只读快照 · M 月 D 日」。
// Artifact 只放行同源和 data:，所以样式脚本全内联、头像内嵌；每页里的垫片见 shim.js。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { request } from 'node:http';
import { gzipSync } from 'node:zlib';
import { startServer } from '../web/server.js';
import { openAccounts } from '../web/accounts.js';
import { embed } from '../web/home.js';
import { mapLimit } from '../map-limit.js';

export const PAGES = [['index', '/'], ['stars', '/stars'], ['favorites', '/favorites'], ['settings', '/settings']];
const ASSETS = new URL('../web/assets/', import.meta.url);
const SHIM = new URL('./shim.js', import.meta.url);
const DATA = /(<script type="application\/json" id="gc-data">)([^<]*)(<\/script>)/;
// 收藏星标、投票、换卡、账号头像都是个人的，分享页里藏起来
const CSS = `[data-star], .vote, [data-swap], .me, form[action="/logout"] { display: none !important; }
.share-tag { font-size: 12px; color: #57606a; border: 1px solid #d0d7de; border-radius: 999px; padding: 2px 10px; white-space: nowrap; }
#snap-toast { position: fixed; z-index: 61; left: 50%; top: 18px; transform: translate(-50%, -8px); opacity: 0; transition: .2s; padding: 8px 14px; border-radius: 8px; background: #1f2328; color: #fff; font-size: 13px; pointer-events: none; }
#snap-toast.on { opacity: 1; transform: translate(-50%, 0); }`;

// 去掉个人的东西：收藏、投票（自己投的和票数，单人使用时票数也就是自己的票）、能不能改、账号名；收藏页整页给空的
export function scrub(kind, data) {
  const d = structuredClone(data);
  for (const p of Object.values(d.projects ?? {})) Object.assign(p, { saved: false, savedSkills: [] });
  if (d.picks && typeof d.picks === 'object') {
    d.picks.canEdit = false;
    for (const t of d.picks.tags ?? []) for (const c of t.cards ?? []) Object.assign(c, { up: 0, down: 0, mine: 0 });
  }
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

// 一页：换数据、内联样式脚本、加垫片和只读标签（站内链接留着，由垫片交给外层切换）
export function sharePage(html, kind, data, label) {
  const m = DATA.exec(html);
  html = html.slice(0, m.index) + m[1] + embed(data) + m[3] + html.slice(m.index + m[0].length);
  html = html.replace(/<link rel="stylesheet" href="\/assets\/([\w.-]+\.css)">/g, (_, f) => `<style>\n${readFileSync(new URL(f, ASSETS), 'utf8')}\n</style>`);
  html = html.replace(/<script src="\/assets\/([\w.-]+\.js)"><\/script>/g, (_, f) => `<script>\n${readFileSync(new URL(f, ASSETS), 'utf8').replace(/<\/script/gi, '<\\/script')}\n</script>`);
  if (/(?:href|src)="\/assets\//.test(html)) throw new Error(`${kind} 页里还有没内联的 /assets/ 文件`);
  const head = `<style>\n${CSS}\n</style>\n<script>\n${readFileSync(SHIM, 'utf8')}\n</script>\n`;
  if (!html.includes('</title>')) throw new Error(`${kind} 页没有 <title>`);
  html = html.replace('</title>', `</title>\n${head}`);
  html = html.replace(/<span class="me"[^>]*>.*?<\/span>/g, '');
  const r = html.indexOf('<div class="r">');
  if (r < 0 || r > html.indexOf('</header>')) throw new Error(`${kind} 页的页头里没有放标签的位置`);
  return html.replace('<div class="r">', `<div class="r"><span class="share-tag" title="这是分享用的只读快照，不会自动更新">只读快照 · ${label}</span>`);
}

// 外层就是发现页本身，另外三页各放进同源的 srcdoc iframe 盖在上面，用到才建、页内切换。头像、安装指令放在外层，四页共用。
// 切页不改地址：Artifact 查看器看到地址变了会重载整页（2026-11-08 线上实测）。
// 打开时认 #stars、#favorites、#prefs 直达某页（claude.ai 保留 #settings）；只对直接打开的文件和本地网站有效，Artifact 查看器不把 hash 带进页面。
// Artifact 发布时外面还会套一层 doctype/html/head/body，浏览器会把重复的外层标签并掉，同一个文件两处都能用。
const HASHES = { stars: 'stars', favorites: 'favorites', settings: 'prefs' };
const TITLES = { index: '发现', stars: '涨星', favorites: '收藏', settings: '设置' };
export function shell(pages, avatars, install) {
  const { index, ...rest } = pages;
  const data = `<script>\nwindow.__AV = ${embed(avatars)};\nwindow.__INSTALL_GZ = ${embed(install)};\n</script>\n`;
  const views = `<style>
.tidings-view { position: fixed; inset: 0; width: 100%; height: 100%; border: 0; z-index: 2147483000; background: #f6f8fa; }
.tidings-view[hidden] { display: none; }
</style>
<script>
(() => {
  const PAGES = ${embed(rest)};
  const HASHES = ${embed(HASHES)};
  const TITLES = ${embed(TITLES)};
  const views = {};
  // 每页的垫片调它切页：发现页就是外层，收起所有 iframe；其余用到才建，建过的留着（切回来保留原来的滚动和展开状态）
  window.__tidingsGo = (kind) => {
    if (kind !== 'index' && !PAGES[kind]) kind = 'index';
    if (kind !== 'index' && !views[kind]) {
      const f = document.createElement('iframe');
      f.className = 'tidings-view';
      f.title = TITLES[kind];
      f.srcdoc = PAGES[kind];
      document.body.append(f);
      views[kind] = f;
    }
    for (const [k, f] of Object.entries(views)) f.hidden = k !== kind;
    document.title = (kind === 'index' ? '' : TITLES[kind] + ' · ') + 'Github·Tidings';
  };
  const start = Object.keys(HASHES).find((k) => location.hash === '#' + HASHES[k]);
  if (start) window.__tidingsGo(start);
})();
</script>
`;
  let html = index.replace(/<title>[^<]*<\/title>/, '<title>Github·Tidings</title>');
  html = html.replace('</title>', `</title>\n${data}`);      // 在垫片之前，垫片读外层的头像
  const end = html.lastIndexOf('</body>');
  if (end < 0) throw new Error('发现页没有 </body>');
  return html.slice(0, end) + views + html.slice(end);
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

const MIME = [[[0x89, 0x50, 0x4e, 0x47], 'image/png'], [[0xff, 0xd8], 'image/jpeg'], [[0x47, 0x49, 0x46], 'image/gif']];
const sniff = (b) => MIME.find(([sig]) => sig.every((x, i) => b[i] === x))?.[1] ?? (b.slice(8, 12).toString() === 'WEBP' ? 'image/webp' : null);

// 导出。account 不填就用所有者账号（只用来打开页面，账号名和收藏不进分享页）。fetch 用来下载头像，测试时换成假的。
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
    const datas = Object.fromEntries(PAGES.map(([kind]) => {
      const m = DATA.exec(raw[kind]);
      if (!m) throw new Error(`${kind} 页里没有找到嵌入数据（gc-data），页面结构可能改了`);
      return [kind, scrub(kind, JSON.parse(m[2]))];
    }));
    const jobs = [...installJobs(Object.values(datas)).entries()];
    const install = {};
    await mapLimit(jobs, 8, async ([key, j]) => {
      const q = new URLSearchParams({ project: j.project, ai: j.ai, ...(j.skill ? { skill: j.skill } : {}) });
      const r = await local(`${url}api/install?${q}`);
      if (r.status === 200) install[key] = r.text;
    });
    const urls = [...avatarUrls(Object.values(datas)).entries()];
    const avatars = {};
    await mapLimit(urls, 12, async ([key, u]) => {
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
    const pages = Object.fromEntries(PAGES.map(([kind]) => [kind, sharePage(raw[kind], kind, datas[kind], label)]));
    write('tidings.html', shell(pages, avatars, gzipSync(JSON.stringify(install), { level: 9 }).toString('base64')));
    return { files: written, avatars: [Object.keys(avatars).length, urls.length], install: [Object.keys(install).length, jobs.length], label };
  } finally {
    server.close();
  }
}
