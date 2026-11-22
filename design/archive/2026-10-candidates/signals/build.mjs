// 样稿 signals-r1 拼装脚本（#16）：名次变化、连续上榜、项目页维护信号。
// 调正式的数据组装函数（homeData、projectData、dailyData）读正式 data/（只读，不写任何东西），在结果上加三类信号，
// 生成静态页：index.html（首页）、project-*.html（项目页）、daily.html（日报）、components.html（组件板：全部状态，
// 用真实项目资料，名次变化和期数是示例，板上标明）。
// 页面用 assets/ 里的副本（src/web/assets 复制过来，只改了 gc.js、home.js、project.js 三处，见各文件开头），新样式全在 assets/signals.css。
// 名次变化和连续期数的算法写在这里，是日后 #17 生产实现的原型；维护信号的取法是 #18 的原型。
//
//   node design/candidates/signals/build.mjs            用 releases.json 里存好的版本数据拼页面
//   GITHUB_TOKEN=… node design/candidates/signals/build.mjs --fetch   先重新取一遍样稿用到的项目的最新正式版
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../..');
const DATA = join(ROOT, 'data');
const RELEASES = join(HERE, 'releases.json');
// 正式代码默认取仓库里的 src/；工作区有别人未提交的 src 改动时，用 SIGNALS_SRC 指向某个提交导出的干净副本
// （git archive <提交> src | tar -x -C <目录>），样稿只认已提交的版本。
const SRC = process.env.SIGNALS_SRC ? join(process.env.SIGNALS_SRC, 'src') : join(ROOT, 'src');
const load = (p) => import(pathToFileURL(join(SRC, p)).href);
const { homeData, homePage, embed } = await load('web/home.js');
const { projectData, projectPage, dailyData, dailyPage } = await load('web/pages.js');
const { findSnapshot, readCandidates, readLatestSnapshot } = await load('ranking/store.js');
const { readCategories, gainersInCategory } = await load('categories/index.js');
const { findProfile } = await load('profiles/index.js');

// ── 名次变化与连续上榜（#17 的原型） ──
// 名次变化从哪一期起显示（所有者 2026-10-24）：近 1 天从 10-23 起；近 7/30 天和分类榜从 10-24 起
// （10-22 那期近 7/30 天受已修的合并 bug 影响可能有漏；分类候选从 10-23 起才存）。这一期之前的那一期是最早能当“上一期”的。
const FROM = { d1: '2026-10-23', d7: '2026-10-24', d30: '2026-10-24', cat: '2026-10-24' };
const fromOf = (w, cat) => (cat ? FROM.cat : FROM[w]);
const prevDay = (day) => new Date(Date.parse(`${day}T00:00:00Z`) - 86400e3).toISOString().slice(0, 10);
const keyOf = (e) => String(e.projectId ?? e.id ?? e.fullName.toLowerCase());

// 某一期的一份榜（总榜或分类榜）的条目；那天没有这份榜就是 null。分类榜按那一期存下的候选重新取前 20（同首页）。
const find = readCategories(DATA).get;
function boardAt(w, cat, day) {
  if (!cat) return findSnapshot(DATA, w, day)?.snapshot.entries ?? null;
  const candidates = readCandidates(DATA, w, day);
  return candidates ? gainersInCategory({ candidates, find, category: cat }).entries : null;
}

// 这一期每个项目的名次变化：上一期在前 20（含并列）里就比名次，不在就是“新进”。上一期缺、或这一期还没到起始期，返回 null（不标）。
export function moves(w, cat, day, entries) {
  if (day < fromOf(w, cat)) return null;
  const prev = boardAt(w, cat, prevDay(day));
  if (!prev) return null;
  const was = new Map(prev.map((e) => [keyOf(e), e.rank]));
  return new Map(entries.map((e) => {
    const p = was.get(keyOf(e));
    const d = p == null ? null : p - e.rank;
    return [keyOf(e), d == null ? { kind: 'new' } : d > 0 ? { kind: 'up', n: d } : d < 0 ? { kind: 'down', n: -d } : { kind: 'flat' }];
  }));
}

// 连续期数：从这一期往前一天一天数，那一期在第 1 名（并列第 1 也算）/ 在前 20 就加一，中间缺一期（没有榜，或不在榜上）就停。
// 最早只数到起始期的上一期。N≥2 才显示；第 1 优先。
export function streak(w, cat, day, key) {
  const earliest = prevDay(fromOf(w, cat));
  let first = 0, top = 0, stillFirst = true;
  for (let d = day; d >= earliest; d = prevDay(d)) {
    const e = boardAt(w, cat, d)?.find((x) => keyOf(x) === key);
    if (!e) break;
    top++;
    if (stillFirst && e.rank === 1) first++; else stillFirst = false;
  }
  if (first >= 2) return `连续 ${first} 期第 1`;
  if (top >= 2) return `连续 ${top} 期前 20`;
  return null;
}

const NO_PREV = { icon: 'calendar', title: '没有上一期', text: '暂不显示名次变化。' };

// 一份榜的行加上名次变化和连续期数；没有上一期就加提示条。rows 是 homeData 给的行，raw 是同顺序的快照条目。
function mark(rows, raw, notes, w, cat, day) {
  const mv = moves(w, cat, day, raw);
  if (!mv) { if (rows.length) notes.push(NO_PREV); }
  rows.forEach((r, i) => {
    const k = keyOf(raw[i]);
    if (mv) r.mv = mv.get(k);
    const s = streak(w, cat, day, k);
    if (s) r.streak = s;
  });
}

// ── 维护信号（#18 的原型） ──
// 最近推送取项目资料里的 pushedAt；最新正式版取 GitHub 的 releases/latest（它排除预发布和草稿）：
// 200 → 有正式版；404 → 还没发过正式版；其他情况（网络错、限流、5xx）→ 未知。只写事实，不打分。
async function fetchRelease(repo, token) {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { accept: 'application/vnd.github+json', ...(token ? { authorization: `Bearer ${token}` } : {}) } });
    if (res.status === 404) return { state: 'none' };
    if (!res.ok) return { state: 'unknown' };
    const r = await res.json();
    return { state: 'ok', tag: r.tag_name, day: r.published_at.slice(0, 10), url: r.html_url };
  } catch { return { state: 'unknown' }; }
}
function maintOf(repo, releases) {
  const pushed = findProfile(DATA, repo)?.pushedAt?.slice(0, 10) ?? null;
  return { pushed, release: releases.items[repo] ?? { state: 'unknown' } };
}

// ── 拼页面 ──
const ctx = { account: { id: 0, name: '常浩' }, favorites: { savedIn: () => new Set(), list: () => [] } };
const rel = (html) => html.replace(/"\/assets\//g, '"assets/')
  .replace('</head>', '<link rel="stylesheet" href="assets/signals.css">\n<script src="assets/sample.js"></script>\n</head>');

const SAMPLE_PROJECTS = { 'project.html': 'morluto/rea', 'project-new.html': 'YuJunZhiXue/dsh-purge', 'project-down.html': 'Graphify-Labs/graphify', 'project-norel.html': 'peach-mitao/peach' };

if (process.argv.includes('--fetch')) {
  const repos = new Set(Object.values(SAMPLE_PROJECTS));
  const items = {};
  for (const repo of repos) items[repo] = await fetchRelease(repo, process.env.GITHUB_TOKEN);
  writeFileSync(RELEASES, JSON.stringify({ fetchedAt: new Date().toISOString(), items }, null, 2) + '\n');
}
const releases = JSON.parse(readFileSync(RELEASES, 'utf8'));

// 首页：三个窗口的总榜和各分类榜
const latestDay = (w) => readLatestSnapshot(DATA, w)?.statDay ?? null;
const home = homeData(DATA, ctx);
for (const [w, win] of Object.entries(home.windows)) {
  const day = latestDay(w);
  if (!day) continue;
  mark(win.entries, findSnapshot(DATA, w, day).snapshot.entries, win.notes, w, null, day);
  const candidates = readCandidates(DATA, w, day);
  for (const [cat, b] of Object.entries(win.byCat ?? {})) mark(b.entries, candidates ? gainersInCategory({ candidates, find, category: cat }).entries : [], b.notes, w, cat, day);
}
writeFileSync(join(HERE, 'index.html'), rel(homePage(home)));

// 项目页：名次胶囊加名次变化和连续期数，名字下面那行加维护信号
for (const [file, repo] of Object.entries(SAMPLE_PROJECTS)) {
  const data = projectData(DATA, repo, ctx);
  const id = String(data.page.id);
  for (const r of data.page.ranks) {
    const day = latestDay(r.w);
    const raw = findSnapshot(DATA, r.w, day).snapshot.entries;
    const mv = moves(r.w, null, day, raw);
    r.mv = mv ? mv.get(id) : null;
    r.streak = streak(r.w, null, day, id);
  }
  data.page.maint = maintOf(repo, releases);
  writeFileSync(join(HERE, file), rel(projectPage(data)));
}

// 日报：概览后面加一句（几个新进前 10、谁连续第 1）；列表行不加记号。不写“新进”二字：行里的“新进”指上一期不在前 20，
// 这里数的是上一期不在前 10 的，同一个词两个意思会混（T1b #3）。
const daily = dailyData(DATA, ctx);
if (daily.daily) {
  const parts = [];
  for (const [w, win] of Object.entries(daily.daily.windows)) {
    if (!win.statDay || win.statDay < FROM[w]) continue;
    const prev = boardAt(w, null, prevDay(win.statDay));
    if (!prev) continue;
    const was = new Map(prev.map((e) => [keyOf(e), e.rank]));
    const fresh = win.entries.filter((e) => !(was.get(String(e.id)) <= 10)).length;
    const first = win.entries.filter((e) => e.rank === 1).map((e) => [e.repo, streak(w, null, win.statDay, String(e.id))]).filter(([, s]) => s?.endsWith('第 1'));
    parts.push(`${win.label}前 10 里有 ${fresh} 个上一期不在前 10${first.length ? `，${first.map(([repo, s]) => `${repo} ${s}`).join('、')}` : ''}`);
  }
  if (parts.length) daily.daily.overview += `${parts.join('；')}。`;
}
writeFileSync(join(HERE, 'daily.html'), rel(dailyPage(daily)));
// 组件板：真实项目资料（取首页那份），状态用示例。画法在 assets/board.js，用的是和页面同一套组件函数。
const BOARD_REPOS = ['morluto/rea', 'peach-mitao/peach', 'Gathin23/cleanyourtv', 'YuJunZhiXue/dsh-purge', 'Graphify-Labs/graphify', 'debpalash/VoiceStudio', 'xerj-org/xerj'];
const board = { ...home, windows: { d1: { label: home.windows.d1.label }, d7: { label: home.windows.d7.label }, d30: { label: home.windows.d30.label } },
  projects: Object.fromEntries(BOARD_REPOS.map((r) => [r, home.projects[r]])), run: home.windows.d1.entries[0].run, overview: daily.daily?.overview ?? '' };
writeFileSync(join(HERE, 'components.html'), rel(readFileSync(join(HERE, 'components.tpl.html'), 'utf8').replace('__DATA__', embed(board))));
console.log('样稿已生成：index.html、%s、daily.html、components.html', Object.keys(SAMPLE_PROJECTS).join('、'));
