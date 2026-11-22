// 已收录项目名单（#114 收到这一处）：「这个项目在不在中心里、去哪取它的资料和数字」只在这里判断，补资料、归类、健康检查、
// 项目页、收藏页、发现页、收藏接口都从这里取。各函数从原处原样搬来，返回顺序、去重规则和优先级不变：
// - boardProjects：网站上各榜单当前显示的项目（补资料按它的顺序排优先级）；findOnBoards 在里面找一个。
// - profileProjects：要补资料的项目 = boardProjects + 发现页（原分类榜）上显示的。
// - categoryListed：只上了分类涨星榜的项目（不生成项目资料，数字和描述取候选）；onCategoryBoard、categoryListedById 是它的两种查法。
// - knownProjects：本地已有数字的项目（发现页换卡、详情栏描述用）；onCategoriesPage 再加上精选卡。
// - listTotals：各榜最新快照里每个项目的总 Star。
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readLatestSnapshot } from './store.js';
import { readCandidates } from './ranking/files.js';
import { WINDOWS } from './ranking/stat-day.js';
import { SINCES } from './ranking/lists.js';
import { CATEGORIES, readCategories } from './categories/store.js';
import { gainersInCategory } from './categories/boards.js';
import { readSkillsBoard } from './boards/skills.js';
import { readHotBoard } from './boards/hot.js';
import { openPicks } from './boards/picks.js';
import { poolFrom } from './boards/picks-update.js';

// 网站上各榜单当前显示的项目（每个榜前 20 含并列；官方热门榜每页前 20），去重；近 1 天涨星榜排最前，先生成。
export function boardProjects(dataDir) {
  const seen = new Set();
  const out = [];
  const add = (e) => {
    const keys = [`name:${e.fullName.toLowerCase()}`, ...(e.projectId ? [`id:${e.projectId}`] : [])];
    if (keys.some((k) => seen.has(k))) return;
    keys.forEach((k) => seen.add(k));
    out.push({ id: e.projectId ?? null, name: e.fullName });
  };
  const trending = readLatestSnapshot(dataDir, 'trending');
  const pages = (sinces) => sinces.flatMap((s) => trending?.pages[s]?.entries.slice(0, 20) ?? []);
  for (const w of Object.keys(WINDOWS)) readLatestSnapshot(dataDir, w)?.entries.forEach(add);
  pages(SINCES).forEach(add);
  return out;
}

// 榜单上的这个项目（按名字不分大小写，或按项目 id），不在榜单上返回 undefined。
export const findOnBoards = (dataDir, { name, id }) => boardProjects(dataDir).find((p) => (id ? p.id === id : p.name.toLowerCase() === name.toLowerCase()));

// 要补资料的项目：涨星榜和官方热门榜上的先补（boardProjects），再补分类榜上显示的：精选榜各标签的卡、历史榜（Skill 安装量）前 50 所在的 GitHub 仓库、热点榜前 15。
// 按项目 id（没有 id 的按名字，不分大小写）去重。还没有库（data/center.db）时不建库，只是没有精选卡。
export function profileProjects(dataDir) {
  const out = boardProjects(dataDir);
  const seen = new Set(out.flatMap((p) => [`name:${p.name.toLowerCase()}`, ...(p.id ? [`id:${p.id}`] : [])]));
  const add = (id, name) => {
    const keys = [`name:${name.toLowerCase()}`, ...(id ? [`id:${id}`] : [])];
    if (keys.some((k) => seen.has(k))) return;
    keys.forEach((k) => seen.add(k));
    out.push({ id: id ?? null, name });
  };
  if (existsSync(join(dataDir, 'center.db'))) {
    const picks = openPicks(dataDir);
    try {
      for (const t of picks.board(null).tags) t.cards.forEach((c) => add(c.projectId, c.fullName));
    } finally {
      picks.close();
    }
  }
  for (const e of readSkillsBoard(dataDir)?.entries ?? []) if (e.repo) add(null, e.repo);
  for (const e of readHotBoard(dataDir)?.entries ?? []) add(e.id, e.repo);
  return out;
}

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

// 收藏接口用：只上了分类榜的这个项目（按项目 id），返回 { id, name } 或 undefined。
export const onCategoryBoard = (dataDir, id) => {
  const entry = [...categoryListed(dataDir).values()].flat().find((b) => b.entry.projectId === id)?.entry;
  return entry ? { id, name: entry.fullName } : undefined;
};

// 收藏页用：categoryListed 按项目 id 索引（同一 id 出现在几个名字下时，后面的覆盖前面的，同 Map 的写法）。
export const categoryListedById = (dataDir) => new Map([...categoryListed(dataDir).values()].map((list) => [list[0].entry.projectId, list]));

// 本地已有数字的项目（按项目 id）：历史榜最近一期前 100、涨星榜三个窗口这一期的候选（同精选候选池的来源），再加热点榜上核过的。
// 换卡只能换进这些项目（总 Star、作者 id 取这里，不信页面传来的数字）；卡片和详情栏的 GitHub 描述也取这里。
export function knownProjects(dataDir) {
  const byId = new Map();
  for (const x of poolFrom(dataDir, Infinity)) byId.set(x.id, x);
  for (const e of readHotBoard(dataDir, { show: Infinity })?.entries ?? []) {
    if (e.id && !byId.has(e.id)) byId.set(e.id, { id: e.id, fullName: e.repo, ownerId: e.ownerId, total: e.total, description: e.description });
  }
  return byId;
}

// 详情栏里的收藏按钮：分类榜上的项目（本地有数字的、精选卡）也能收藏。返回 { id, name } 或 undefined。
export function onCategoriesPage(dataDir, picks, id) {
  const k = knownProjects(dataDir).get(id);
  if (k) return { id, name: k.fullName };
  const card = picks.board(null).tags.flatMap((t) => t.cards).find((c) => c.projectId === id);
  return card ? { id, name: card.fullName } : undefined;
}

// 各榜最新快照里每个项目的总 Star（更新时的数字）：按项目 id 和名字都能查；收藏页和不在涨星榜上的项目页用。
export function listTotals(dataDir) {
  const byId = new Map(), byName = new Map();
  const note = (e) => {
    if (e.total == null) return;
    if (e.projectId && !byId.has(e.projectId)) byId.set(e.projectId, e.total);
    if (!byName.has(e.fullName.toLowerCase())) byName.set(e.fullName.toLowerCase(), e.total);
  };
  for (const b of Object.keys(WINDOWS)) readLatestSnapshot(dataDir, b)?.entries.forEach(note);
  // 全站 Star 前 100（boards/history.js）。2026-11-22 前查的是累计高星榜（和它同一条搜索）和新项目榜，#110 起这两个榜不再生成。
  readLatestSnapshot(dataDir, 'history')?.entries.forEach((e) => note({ projectId: e.id, fullName: e.repo, total: e.total }));
  const trending = readLatestSnapshot(dataDir, 'trending');
  for (const s of SINCES) trending?.pages[s]?.entries.forEach(note);
  return { of: (id, name) => (id && byId.get(id)) ?? byName.get(name.toLowerCase()) ?? null };
}
