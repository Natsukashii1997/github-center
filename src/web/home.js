// 首页涨星榜（#13）：照冻结的视觉方案 t1b-r2 落地。服务端把近 1/7/30 天三个窗口的快照、上榜项目的资料和这个人的收藏
// 整理成一份数据嵌进页面，页面脚本（assets/home.js）用方案里的共用组件画出来，切换窗口不再请求服务端。
// 名次、新增和总 Star 只取快照。卡片上的数字和 30 天走势取这一期榜单那次运行存下的官方原始响应：三个窗口的快照可能出自
// 不同次运行（某个窗口失败后重跑），同一张卡上的数字和柱子来自同一份响应才对得上。缺数据的那天留空位，不补零。
import { join } from 'node:path';
import { readLatestSnapshot, readStatus, newerFailure, WINDOWS } from '../ranking/index.js';
import { readJson } from '../ranking/store.js';
import { bucketOf, windowDays } from '../ranking/stat-day.js';
import { PER_PAGE } from '../ranking/github.js';
import { readProfile, currentGenerated, skillPurpose, INSTALL_AIS } from '../profiles/index.js';

const SERIES_DAYS = 30;
const label = (w) => `近 ${WINDOWS[w].days} 天`;
const md = (day) => `${Number(day.slice(5, 7))} 月 ${Number(day.slice(8, 10))} 日`;
const hhmm = (iso) => new Date(Date.parse(iso) + 8 * 3600e3).toISOString().slice(11, 16);

// 漏失概率写成“约万分之 1.1”这样的说法。
export function chance(p) {
  if (p >= 0.01) return `约 ${(p * 100).toFixed(1)}%`;
  const units = [[1e-3, '千分之'], [1e-4, '万分之'], [1e-5, '十万分之'], [1e-6, '百万分之'], [1e-7, '千万分之'], [1e-8, '亿分之']];
  const [u, name] = units.find(([u]) => p >= u) ?? units.at(-1);
  return `约${name} ${(p / u).toFixed(1)}`;
}

// 截至统计日（含）的 30 个统计日，每天取官方星数历史里那一格，规则和出榜相同：那一周的历史在就取；项目那天还不存在
// （历史不满一页且最早一周晚于那天）记 0；否则那天缺数据，记 null（缺失不补零）。
export function dailySeries(weeks, statDay) {
  return windowDays(statDay, SERIES_DAYS).map((d) => {
    const b = bucketOf(d);
    const week = weeks.find((w) => w.week === b.week);
    if (week) return week.days[b.dayIndex];
    return weeks.length < PER_PAGE && weeks.every((w) => w.week > b.week) ? 0 : null;
  });
}

// 一次运行里一个项目的数字：30 天走势、三个窗口的新增（窗口里有一天缺数据就记 null）、总 Star。
// 这一期自己的窗口直接用榜上的数字，它和走势出自同一份响应，两者相等。
function runFigures(dataDir, w, snapshot, entry) {
  const weeks = entry.evidence?.history ? readJson(join(dataDir, entry.evidence.history.path)) : null;
  const series = weeks ? dailySeries(weeks, snapshot.statDay) : null;
  const gains = Object.fromEntries(Object.entries(WINDOWS).map(([id, { days }]) => {
    const span = series?.slice(-days);
    return [id, span && !span.includes(null) ? span.reduce((s, x) => s + x, 0) : null];
  }));
  return { seriesDay: snapshot.statDay, series, gains: { ...gains, [w]: entry.gain }, total: entry.total };
}

// 顶栏的更新状态、提示条：更新失败（比当前快照新的那天失败了）优先，其次是可能不完整；生成于自检上线之前的旧快照如实说明。
function windowStatus(snapshot, failed) {
  const notes = [];
  if (failed) notes.push({ tone: 'bad', icon: 'error', title: '更新失败', text: `${md(failed.day)}的更新失败：${failed.error}。${snapshot ? `下面是上次成功的 ${md(snapshot.statDay)}数据。` : ''}` });
  if (snapshot?.incomplete) {
    const why = [];
    if (!snapshot.check.passed) why.push(`自检未通过，估计漏掉一个该上榜项目的概率${chance(snapshot.check.missProbability)}（要求小于百万分之一）`);
    if (snapshot.candidates.failed.length) why.push(`${snapshot.candidates.failed.length} 个候选的官方核数失败`);
    notes.push({ tone: 'warn', icon: 'warn', title: '可能不完整', text: `${why.join('；')}，名次可能有出入。` });
  }
  if (snapshot && !snapshot.check) notes.push({ icon: 'warn', title: '未做自检', text: '这份榜单生成于每日自检上线之前，没有做完整性自检。' });
  let top;
  if (!snapshot) top = { tone: failed ? 'bad' : 'warn', text: failed ? '更新失败 · 还没有数据' : '还没有数据' };
  else if (failed) top = { tone: 'bad', text: `更新失败 · 显示 ${md(snapshot.statDay)}数据` };
  else if (snapshot.incomplete) top = { tone: 'warn', text: `可能不完整 · ${md(snapshot.statDay)}数据` };
  else top = { tone: 'ok', text: `${md(snapshot.statDay)}数据 · ${hhmm(snapshot.generatedAt)} 更新` };
  return { top, notes };
}

function board(w, snapshot, status) {
  const { top, notes } = windowStatus(snapshot, newerFailure(status, w, snapshot));
  if (!snapshot) return { label: label(w), top, notes, entries: [], empty: { title: `还没有${label(w)}的榜单`, text: '每天统计日结束后自动生成。' } };
  const ranks = snapshot.entries.map((e) => e.rank);
  return {
    label: label(w),
    top,
    notes,
    lede: {
      span: w === 'd1' ? `统计日 ${md(snapshot.statDay)}（UTC）` : `统计 ${md(snapshot.from)}至 ${md(snapshot.statDay)}（UTC）`,
      candidates: snapshot.candidates.total,
      checks: snapshot.requests.history + snapshot.requests.project,
    },
    entries: snapshot.entries.map((e) => ({ repo: e.fullName, rank: e.rank, tie: ranks.filter((r) => r === e.rank).length > 1, gain: e.gain, run: snapshot.runId })),
    empty: snapshot.entries.length ? null : { title: '这一期没有核出项目', text: '换个时间窗口看看。' },
  };
}

// 一个上榜项目在卡片上要的全部内容。onBoards：它出现在哪些窗口的快照里，最新生成的在前；语言、创建日期取最新存下的项目信息，
// 数字按运行分开放（runs），卡片按这一期榜单的运行取。
function project(dataDir, onBoards, { account, favorites }) {
  const { entry } = onBoards[0];
  const projectRaw = onBoards.find((b) => b.entry.evidence?.project)?.entry.evidence.project;
  const info = projectRaw ? readJson(join(dataDir, projectRaw.path)) : null;
  const runs = {};
  for (const b of onBoards) runs[b.snapshot.runId] ??= runFigures(dataDir, b.w, b.snapshot, b.entry);
  const profile = readProfile(dataDir, entry.projectId);
  const g = currentGenerated(profile);
  const saved = favorites.savedIn(account.id, entry.projectId);
  return {
    repo: entry.fullName,
    id: entry.projectId,
    ownerId: info?.owner?.id ?? null,
    runs,
    lang: info?.language ?? null,
    created: info?.created_at?.slice(0, 10) ?? null,
    what: g?.what ?? null,
    problem: g?.problem ?? null,
    conditions: g ? g.conditions.map((c) => c.text) : [],
    installable: Boolean(profile?.material),
    skills: (profile?.material?.skills ?? []).map((s) => ({ name: s.name, path: s.path, desc: skillPurpose(s, g) })),
    saved: saved.has(''),
    savedSkills: [...saved].filter(Boolean),
  };
}

export function homeData(dataDir, ctx) {
  const status = readStatus(dataDir);
  const snapshots = Object.fromEntries(Object.keys(WINDOWS).map((w) => [w, readLatestSnapshot(dataDir, w)]));
  const seen = new Map();
  for (const [w, snapshot] of Object.entries(snapshots)) {
    for (const entry of snapshot?.entries ?? []) {
      if (!seen.has(entry.fullName)) seen.set(entry.fullName, []);
      seen.get(entry.fullName).push({ w, snapshot, entry });
    }
  }
  for (const list of seen.values()) list.sort((a, b) => Date.parse(b.snapshot.generatedAt) - Date.parse(a.snapshot.generatedAt));
  return {
    account: { name: ctx.account.name },
    ais: Object.entries(INSTALL_AIS).map(([id, ai]) => [id, ai.name]),
    windows: Object.fromEntries(Object.entries(snapshots).map(([w, s]) => [w, board(w, s, status)])),
    projects: Object.fromEntries([...seen].map(([name, list]) => [name, project(dataDir, list, ctx)])),
  };
}

// 嵌进 <script type="application/json">：把 < 和行分隔符转义，项目文字里出现 </script> 也不会提前结束脚本。
const embed = (data) => JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

export const homePage = (data) => `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>涨星榜 · GitHub 快速中心</title>
<link rel="stylesheet" href="/assets/tokens.css">
<link rel="stylesheet" href="/assets/components.css">
</head>
<body>
<header class="top"></header>
<div class="split">
  <section class="index">
    <div class="phead"><h1>涨星榜</h1><p class="lede" id="lede"></p></div>
    <div id="wins" role="group" aria-label="时间窗口"></div>
    <div id="notes"></div>
    <div class="list"><span class="sel-mark" id="selmark"></span><ol class="rows" id="rows" role="listbox" aria-label="涨星榜"></ol></div>
    <p class="foot">所有数字来自 GitHub 官方数据。</p>
  </section>
  <aside class="reader"><article class="card" id="card" aria-live="polite"></article></aside>
</div>
<script type="application/json" id="gc-data">${embed(data)}</script>
<script src="/assets/icons.js"></script>
<script src="/assets/gc.js"></script>
<script src="/assets/home.js"></script>
</body>
</html>
`;
