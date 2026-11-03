// 分类榜（#27，白雾定稿 design/candidates/redesign/cat.html）：上面精选榜（聚光轮播 + 说明书卡），下面历史榜和热点榜左右各半。
// 服务端把三块数据（src/boards：readHistoryBoard、readHotBoard、openPicks）和上面每个项目在详情栏要的内容整理成一份数据嵌进页面，
// 页面脚本（assets/categories.js）画出来。访问时不调用任何外部接口：换卡面板里粘贴的 GitHub 地址只在本地已有的数据里找。
// 卡片和行上的文字（一句话、主要用途、定义标签）取补资料生成的项目资料；还没生成的不拿别的字凑，只写明“GitHub 上的描述”。
// 精选榜的改动走 POST /api/picks/<操作>（同收藏接口：要登录、只接受本站提交）；谁能改由 boards/picks.js 的 canEdit 一处判断，
// 拒绝时按 PicksError.status 回 JSON。
import { readHistoryBoard, readHotBoard, HOT_SOURCES, SLOTS, PicksError } from '../boards/index.js';
import { poolFrom } from '../boards/picks-update.js';
import { parseRepoInput } from '../boards/repo-link.js';
import { readCategories } from '../categories/index.js';
import { readProfile, currentGenerated } from '../profiles/index.js';
import { rankHistory } from '../ranking/moves.js';
import { base, detail, latestBoards } from './pages.js';
import { frame } from './home.js';

// 本地已有数字的项目（按项目 id）：历史榜最近一期前 100、涨星榜三个窗口这一期的候选（同精选候选池的来源），再加热点榜上核过的。
// 换卡只能换进这些项目（总 Star、作者 id 取这里，不信页面传来的数字）；卡片和详情栏的 GitHub 描述也取这里。
function known(dataDir) {
  const byId = new Map();
  for (const x of poolFrom(dataDir, Infinity)) byId.set(x.id, x);
  for (const e of readHotBoard(dataDir, { show: Infinity })?.entries ?? []) {
    if (e.id && !byId.has(e.id)) byId.set(e.id, { id: e.id, fullName: e.repo, ownerId: e.ownerId, total: e.total, description: e.description });
  }
  return byId;
}

// 一批项目在详情栏（bw.js 的 drawer）要的内容，和收藏页同一套（pages.js 的 detail）：在涨星榜上的数字取那一期的运行，不在的总 Star 另给。
// 返回 { projects, views, key }：key(x) 是这个项目在页面数据里的名字（资料里改过名的用现在的名字）。
function details(dataDir, ctx, list) {
  const find = readCategories(dataDir).get;
  const opts = { find, history: rankHistory(dataDir, find), snapshots: latestBoards(dataDir) };
  const projects = {}, views = {}, keys = new Map();
  for (const x of list) {
    const id = x.id ?? null, k = id ? `id:${id}` : `name:${x.repo.toLowerCase()}`;
    if (keys.has(k)) continue;
    const profile = id ? readProfile(dataDir, id) : null;
    const { card, ranks, newest } = detail(dataDir, { id, name: profile?.fullName ?? x.repo, profile, onCategory: null }, ctx, opts);
    const g = currentGenerated(profile);
    projects[card.repo] = { ...card, ownerId: card.ownerId ?? x.ownerId ?? null, ghDesc: x.description ?? null, generated: Boolean(g?.line) };
    views[card.repo] = { run: newest[0]?.snapshot.runId ?? null, win: ranks[0]?.w ?? null, total: newest.length ? null : x.total ?? null };
    keys.set(k, card.repo);
  }
  return { projects, views, key: (x) => keys.get(x.id ? `id:${x.id}` : `name:${x.repo.toLowerCase()}`) };
}

// 精选榜：标签清单和每个标签的卡（board(account) 的结果），加上卡片要的项目内容。
function picksPart(dataDir, ctx, picks, have = known(dataDir)) {
  const board = picks.board(ctx.account);
  const list = board.tags.flatMap((t) => t.cards.map((c) => {
    const k = have.get(c.projectId);
    return { id: c.projectId, repo: c.fullName, ownerId: c.ownerId ?? k?.ownerId, total: c.total ?? k?.total, description: k?.description };
  }));
  const { projects, views, key } = details(dataDir, ctx, list);
  return {
    picks: {
      canEdit: board.canEdit,
      slots: SLOTS,
      tags: board.tags.map((t) => ({ id: t.id, name: t.name, color: t.color, note: t.note, manual: t.manual, cards: t.cards.map((c) => ({
        slot: c.slot, repo: key({ id: c.projectId, repo: c.fullName }), projectId: c.projectId, total: c.total ?? have.get(c.projectId)?.total ?? null,
        pinned: c.pinned, up: c.up, down: c.down, mine: c.mine,
      })) })),
    },
    projects,
    views,
  };
}

export function categoriesData(dataDir, ctx, picks) {
  const have = known(dataDir);
  const hist = readHistoryBoard(dataDir);
  const hot = readHotBoard(dataDir);
  const part = picksPart(dataDir, ctx, picks, have);
  const rows = [
    ...(hist?.entries ?? []).map((e) => ({ id: e.id, repo: e.repo, ownerId: e.ownerId, total: e.total, description: e.description })),
    ...(hot?.entries ?? []).map((e) => ({ id: e.id, repo: e.repo, ownerId: e.ownerId, total: e.total, description: e.description })),
  ];
  const { projects, views, key } = details(dataDir, ctx, rows);
  const days = [hist?.day, hot?.day].filter(Boolean).sort();
  return {
    ...base(ctx),
    day: days.at(-1) ?? null,
    picks: part.picks,
    hist: hist && {
      day: hist.day, failure: hist.failure, note: hist.note,
      // 名次照快照；类别取项目的第一个分类（配色和筛选用），还没归类的为 null。
      entries: hist.entries.map((e) => { const repo = key(e); return { rank: e.rank, repo, total: e.total, cat: projects[repo].cats[0] ?? null }; }),
    },
    hot: hot && {
      day: hot.day, days: hot.days, complete: hot.complete, failure: hot.failure,
      sources: Object.fromEntries(Object.entries(hot.sources ?? {}).map(([s, x]) => [s, { name: HOT_SOURCES[s]?.name ?? s, status: x.status }])),
      // 近 7 天热度（从早到晚，那天没存快照为 null）、比前一天的涨跌、各来源的热度份额。
      entries: hot.entries.map((e) => ({ rank: e.rank, repo: key(e), heat: e.heat, posts: e.posts, sources: e.sources, series: e.series.map((s) => s.heat), change: e.change && { delta: e.change.delta, ratio: e.change.ratio } })),
    },
    projects: { ...projects, ...part.projects },
    views: { ...views, ...part.views },
  };
}

// 详情栏里的收藏按钮：分类榜上的项目（本地有数字的、精选卡）也能收藏。返回 { id, name } 或 undefined。
export function onCategoriesPage(dataDir, picks, id) {
  const k = known(dataDir).get(id);
  if (k) return { id, name: k.fullName };
  const card = picks.board(null).tags.flatMap((t) => t.cards).find((c) => c.projectId === id);
  return card ? { id, name: card.fullName } : undefined;
}

// ── 精选榜接口：POST /api/picks/<操作>，表单字段见各操作。成功回 { status: 200, body }；拒绝抛 PicksError（状态码在 status 上）。
const int = (v) => (/^-?\d+$/.test(v ?? '') ? Number(v) : NaN);
const CANDIDATES = 30;

// 换卡面板的候选：不在这个标签里的项目，按总 Star 从高到低；q 是仓库名的一部分或粘贴的 GitHub 地址。
// 候选池（picks.candidates）之外，本地有数字的项目也算；粘贴的地址本地没有时回 missing（站内不联网查 GitHub）。
function candidates(dataDir, picks, form) {
  const tagId = int(form.get('tag'));
  const q = (form.get('q') ?? '').slice(0, 200);
  const board = picks.board(null);
  const tag = board.tags.find((t) => t.id === tagId);
  if (!tag) throw new PicksError('没有这个精选标签', 404);
  const here = new Set(tag.cards.map((c) => c.projectId));
  const inTags = (id) => board.tags.filter((t) => t.cards.some((c) => c.projectId === id)).length;
  const repo = parseRepoInput(q);
  const needle = (repo ?? q.trim()).toLowerCase();
  const have = known(dataDir);
  const byId = new Map(picks.candidates({ tagId, query: q, limit: 200 }).map((c) => [c.projectId, { ...c, description: have.get(c.projectId)?.description ?? null }]));
  for (const x of have.values()) {
    if (here.has(x.id) || byId.has(x.id) || (needle && !x.fullName.toLowerCase().includes(needle))) continue;
    byId.set(x.id, { projectId: x.id, fullName: x.fullName, ownerId: x.ownerId ?? null, total: x.total ?? null, inTags: inTags(x.id), description: x.description ?? null });
  }
  const items = [...byId.values()].sort((a, b) => (b.total ?? -1) - (a.total ?? -1) || a.projectId - b.projectId).slice(0, CANDIDATES)
    .map((c) => ({ ...c, line: currentGenerated(readProfile(dataDir, c.projectId))?.line ?? null }));
  // 粘贴的地址：已在这个标签里的回 already；候选里也没有的回 missing。
  const same = (name) => repo && name.toLowerCase() === repo.toLowerCase();
  const already = tag.cards.find((c) => same(c.fullName))?.fullName ?? null;
  return { items, already, missing: repo && !already && !items.some((c) => same(c.fullName)) ? repo : null };
}

export function picksApi(dataDir, ctx, picks, op, form) {
  const { account } = ctx;
  const tagId = int(form.get('tag'));
  const after = () => picksPart(dataDir, ctx, picks);
  switch (op) {
    case 'vote':
      return picks.vote(account, { tagId, projectId: int(form.get('project')), value: int(form.get('value')) });
    case 'candidates':
      return candidates(dataDir, picks, form);
    case 'swap': {
      // 只换进本地有数字的项目（或已在别的标签里的卡），名字、总 Star、作者 id 取本地数据。权限由 picks.swap 判断，先于查项目。
      if (!picks.canEdit(account)) throw new PicksError('只有所有者能改精选标签和换卡', 403);
      const id = int(form.get('project'));
      const x = known(dataDir).get(id) ?? picks.board(null).tags.flatMap((t) => t.cards).find((c) => c.projectId === id);
      if (!x) throw new PicksError('本地还没有这个项目的数据，换不进来', 404);
      picks.swap(account, { tagId, slot: int(form.get('slot')), project: { id, fullName: x.fullName, total: x.total ?? undefined, ownerId: x.ownerId ?? undefined } });
      return after();
    }
    case 'restore':
      picks.restore(account, tagId);
      return after();
    // 标签清单：action = add（name、color、note）／update（tag 加要改的字段）／remove（tag）／reorder（ids，逗号分隔）。页面上还没有入口（定稿原型没画）。
    case 'tags': {
      const field = (k) => (form.has(k) ? form.get(k) : undefined);
      const action = form.get('action');
      if (action === 'add') picks.addTag(account, { name: field('name'), color: field('color'), note: field('note') });
      else if (action === 'update') picks.updateTag(account, tagId, { name: field('name'), color: field('color'), note: field('note') });
      else if (action === 'remove') picks.removeTag(account, tagId);
      else if (action === 'reorder') picks.reorderTags(account, (form.get('ids') ?? '').split(',').filter(Boolean).map(int));
      else throw new PicksError('不认识的操作');
      return after();
    }
    default:
      throw new PicksError('没有这个接口', 404);
  }
}

// 页面：报头、精选榜（筛选行 + 景深轮播 + 提示行）、历史榜和热点榜两栏；点项目在本页右侧打开详情栏（bw.js）。整页滚动，底部留白给鲨鱼。
export const categoriesPage = (data, ctx) => frame({ title: '分类榜', active: '分类榜', ctx, css: ['bw.css', 'categories.css'], js: ['bw.js', 'categories.js'], data,
  bar: '<label class="search"><span>⌕</span><input data-q placeholder="搜项目名、标签、用途" aria-label="在分类榜里找"><span class="kbd">/</span></label>',
  body: `  <div class="cwrap">
    <section class="hero-box" id="mast"></section>
    <section class="pick" id="sec-pick"></section>
    <section class="duo" id="duo"></section>
  </div>
  <div id="swhost"></div>
  <div class="scrim" data-close></div>
  <aside class="drawer" id="drawer" aria-label="详情栏"></aside>` });
