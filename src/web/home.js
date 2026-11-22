// 首页涨星榜（#13 起；2026-11-03 起按白雾定稿 r7 重做，#21）。服务端把近 1/7/30 天三个窗口的快照、上榜项目的资料和这个人的收藏
// 整理成一份数据嵌进页面，页面脚本（assets/bw.js、assets/home.js）画出来，切换窗口不再请求服务端。
// 名次、新增和总 Star 只取快照。卡片上的数字和 30 天走势取这一期榜单那次运行存下的官方原始响应：三个窗口的快照可能出自
// 不同次运行（某个窗口失败后重跑），同一张卡上的数字和柱子来自同一份响应才对得上。缺数据的那天留空位，不补零。
// 首页按定义标签筛选，不按分类（分类榜另成一页，后续批次）；只上了分类榜的项目仍由 categoryListed 认出来，项目页和收藏用。
// 各页共用的项目卡转换在 project-card.js，HTML 外壳在 frame.js（#114 拆出）。
import { readLatestSnapshot, readStatus, newerFailure, WINDOWS } from '../ranking/index.js';
import { readCandidates } from '../ranking/files.js';
import { CATEGORIES, readCategories, gainersInCategory } from '../categories/index.js';
import { dayRange } from '../ranking/stat-day.js';
import { rankHistory, markRows } from '../ranking/moves.js';
import { INSTALL_AIS, PROJECT_TYPES } from '../profiles/index.js';
import { decisionsOf } from './favorites.js';
import { project } from './project-card.js';
import { frame } from './frame.js';

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

// 顶栏的更新状态、提示条：更新失败（比当前快照新的那天失败了）优先，其次是可能不完整；生成于自检上线之前的旧快照如实说明。
export function windowStatus(snapshot, failed) {
  const notes = [];
  if (failed) notes.push({ tone: 'bad', icon: 'error', title: '更新失败', text: `${md(failed.day)}的更新失败：${failed.error}。${snapshot ? `下面是上次成功的 ${md(snapshot.statDay)}数据。` : ''}` });
  if (snapshot?.incomplete) {
    const why = [];
    if (!snapshot.check.passed) why.push(`自检未通过，估计漏掉一个该上榜项目的概率${chance(snapshot.check.missProbability)}（要求小于百分之一）`);
    if (snapshot.candidates.failed.length) why.push(`${snapshot.candidates.failed.length} 个候选的官方核数失败`);
    notes.push({ tone: 'warn', icon: 'warn', title: '可能不完整', text: `${why.join('；')}，名次可能有出入。` });
  }
  if (snapshot && !snapshot.check) notes.push({ icon: 'warn', title: '未做自检', text: '这份榜单生成于每日自检上线之前，没有做完整性自检。' });
  // #83：官方日桶按美国太平洋时间分日、日终才定稿。统计日结束前出的榜（#83 之前每天北京 10:00 出）最后一天没数完；按每期的出榜时刻判断，不写死日期。
  if (snapshot?.generatedAt && Date.parse(snapshot.generatedAt) < dayRange(snapshot.statDay).to) {
    notes.push({ icon: 'warn', title: '最后一天未数完', text: `这一期在 ${md(snapshot.statDay)}的 GitHub 统计日（美国太平洋时间）结束前生成（以前每天北京 10:00 出榜），最后一天还没数完，名次可能有偏差，近 1 天影响最大。` });
  }
  let top;
  if (!snapshot) top = { tone: failed ? 'bad' : 'warn', text: failed ? '更新失败 · 还没有数据' : '还没有数据' };
  else if (failed) top = { tone: 'bad', text: `更新失败 · 显示 ${md(snapshot.statDay)}数据` };
  else if (snapshot.incomplete) top = { tone: 'warn', text: `可能不完整 · ${md(snapshot.statDay)}数据` };
  else top = { tone: 'ok', text: `${md(snapshot.statDay)}数据 · ${hhmm(snapshot.generatedAt)} 更新` };
  return { top, notes };
}

const rowsOf = (entries, snapshot) => {
  const ranks = entries.map((e) => e.rank);
  return entries.map((e) => ({ repo: e.fullName, rank: e.rank, tie: ranks.filter((r) => r === e.rank).length > 1, gain: e.gain, run: snapshot.runId }));
};

// 候选当成榜单条目用（卡片按它这次运行存下的官方星数历史取数字）。
const candidateEntry = (c) => ({ projectId: c.id, fullName: c.fullName, gain: c.gain, total: c.total, description: c.description ?? null, evidence: { history: { path: c.evidence.history } } });

// 最新一期各窗口分类榜上的项目（#10），按小写名字索引，值和首页卡片的 onBoards 同形（每个窗口一条）。
// 只上了分类榜、不在其他榜单上的项目不生成项目资料（所有者 2026-10-24 选 B）：项目页和收藏靠它认出来，用候选里的描述和数字。
export function categoryListed(dataDir) {
  const find = readCategories(dataDir).get;
  const byName = new Map();
  for (const w of Object.keys(WINDOWS)) {
    const snapshot = readLatestSnapshot(dataDir, w);
    const candidates = snapshot && readCandidates(dataDir, w, snapshot.statDay);
    if (!candidates) continue;
    for (const category of CATEGORIES) for (const c of gainersInCategory({ candidates, find, category }).entries) {
      const key = c.fullName.toLowerCase();
      if (!byName.has(key)) byName.set(key, []);
      if (!byName.get(key).some((b) => b.w === w)) byName.get(key).push({ w, snapshot, entry: candidateEntry(c) });
    }
  }
  return byName;
}

function board(w, snapshot, status, history) {
  const { top, notes } = windowStatus(snapshot, newerFailure(status, w, snapshot));
  if (!snapshot) return { label: label(w), top, notes, entries: [], empty: { title: `还没有${label(w)}的榜单`, text: '每天统计日结束后自动生成。' } };
  return {
    label: label(w),
    top,
    notes,
    day: snapshot.statDay,
    lede: {
      span: w === 'd1' ? `GitHub 统计日 ${md(snapshot.statDay)}（美国太平洋时间）` : `GitHub 统计日 ${md(snapshot.from)}至 ${md(snapshot.statDay)}（美国太平洋时间）`,
      candidates: snapshot.candidates.total,
      checks: snapshot.requests.history + snapshot.requests.project,
    },
    entries: marked(history, w, snapshot, notes),
    empty: snapshot.entries.length ? null : { title: '这一期没有核出项目', text: '换个时间窗口看看。' },
  };
}

// 总榜的行加上名次变化和连续期数（#17）；没有可比的上一期时提示条写在这个窗口的提示条后面。
function marked(history, w, snapshot, notes) {
  const rows = rowsOf(snapshot.entries, snapshot);
  markRows(history, { w, day: snapshot.statDay, rows, raw: snapshot.entries, notes });
  return rows;
}

export function homeData(dataDir, ctx) {
  const status = readStatus(dataDir);
  const find = readCategories(dataDir).get;
  const snapshots = Object.fromEntries(Object.keys(WINDOWS).map((w) => [w, readLatestSnapshot(dataDir, w)]));
  const history = rankHistory(dataDir, find);
  const windows = Object.fromEntries(Object.entries(snapshots).map(([w, s]) => [w, board(w, s, status, history)]));
  // 卡片要的项目：三个窗口涨星榜上的，按项目归在一起。
  const seen = new Map();
  for (const [w, snapshot] of Object.entries(snapshots)) for (const entry of snapshot?.entries ?? []) {
    if (!seen.has(entry.fullName)) seen.set(entry.fullName, []);
    seen.get(entry.fullName).push({ w, snapshot, entry });
  }
  for (const list of seen.values()) list.sort((a, b) => Date.parse(b.snapshot.generatedAt) - Date.parse(a.snapshot.generatedAt));
  return {
    account: { name: ctx.account.name },
    ais: Object.entries(INSTALL_AIS).map(([id, ai]) => [id, ai.name]),
    decisions: decisionsOf(ctx.favorites, ctx.account.id),
    types: PROJECT_TYPES,
    windows,
    projects: Object.fromEntries([...seen].map(([name, list]) => [name, project(dataDir, list, ctx, find)])),
  };
}

// 首页涨星榜：报头、筛选条、前三卡、其余上榜的行，点项目从右侧滑出详情栏（assets/home.js 画）。
// 和分类榜一样整页滚动、顶栏吸顶、底部留 30vh 空白（所有者 2026-11-03 改，原来是整页不滚、只有榜单盒子内部滚）。
export const homePage = (data, ctx) => frame({ title: '涨星', active: '涨星', ctx, css: ['bw.css'], js: ['bw.js', 'ho.js', 'home.js'], data,
  bar: '<label class="search"><span>⌕</span><input data-q placeholder="搜项目名、标签、用途" aria-label="搜项目名、标签、用途"><span class="kbd">/</span></label>',
  body: `  <div class="wrap">
    <section class="hero-box" id="head"></section>
    <section class="box">
      <div class="fbar" id="fbar"></div>
      <div class="notes" id="notes"></div>
      <div class="scroll" id="scroll">
        <div class="podium" id="hero"></div>
        <div class="sec" id="sec"><b>其余上榜</b><span id="count"></span><span class="tip">点任一项目，详情从右侧滑出</span></div>
        <div id="list"></div>
      </div>
    </section>
  </div>
  <div class="scrim" data-close></div>
  <aside class="drawer" id="drawer" aria-label="详情栏"></aside>` });
