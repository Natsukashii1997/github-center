// 项目归类（#10）：网站各榜单这一期涉及的项目都归上类。涨星榜是三个窗口这一期全部已核数的候选（分类榜在里面重新取前 20），
// 其他三个榜单是榜上的项目；分类榜上显示的（精选卡、历史榜前 50 所在的仓库、热点榜前 15，和补资料同一份名单 profileProjects）也归。按名称、描述和 topics 一批批交给可替换的归类器；已归过的不重归。
// 各榜单显示的项目（每榜前 20）有了项目页资料后，再用完整资料复核一次；资料变了再复核。
// 一批归类失败不影响其他批，当轮重试 3 轮（#52），还不行这些项目算“还没归类”，下次运行再归；每归完一批就存一次，中途停下不丢已归的。
//
// 归类器接口：{ version, classify(items, { review }) → { results: [{ i, categories }], ai? } }，i 是项目在这一批里的序号，ai 是这一批的留痕（#69，存在每条归类上）；
// items 是 { fullName, description, topics }，复核时另有 what、problem、skills（Skill 名字）。
import { WINDOWS } from '../ranking/stat-day.js';
import { readLatestSnapshot, readCandidates, openStore } from '../ranking/store.js';
import { fetchMeta } from '../ranking/meta.js';
import { withRetries } from '../retry.js';
import { readProfile, findProfile, currentGenerated } from '../profiles/store.js';
import { profileProjects } from '../profiles/update.js';
import { readCategories, saveCategories, categoryKey, pickCategories, lookup } from './store.js';

const BATCH = 50;
const REVIEW_BATCH = 20;
// Codex 归类慢，4 个同时跑（#50 实测：2→4 快 1.7 倍；6 开始限流、单次变慢并出现失败）。
const CONCURRENCY = 4;

const chunks = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

// 这一期各榜单涉及的项目，去重。涨星榜候选自带描述和 topics；其他榜单上还没归过类的项目用 GraphQL 补取。
async function targets({ dataDir, gh, now, cats }) {
  const seen = new Set();
  const out = [];
  const add = (x) => {
    const keys = [`name:${x.fullName.toLowerCase()}`, ...(x.id ? [String(x.id)] : [])];
    if (keys.some((k) => seen.has(k))) return false;
    keys.forEach((k) => seen.add(k));
    out.push(x);
    return true;
  };
  for (const w of Object.keys(WINDOWS)) {
    const snap = readLatestSnapshot(dataDir, w);
    const file = snap && readCandidates(dataDir, w, snap.statDay);
    for (const c of file?.items ?? []) add({ id: c.id, fullName: c.fullName, description: c.description, topics: c.topics });
  }
  const trending = readLatestSnapshot(dataDir, 'trending');
  const listed = [
    ...['new', 'top'].flatMap((l) => readLatestSnapshot(dataDir, l)?.entries ?? []),
    ...Object.values(trending?.pages ?? {}).flatMap((p) => p.entries),
  ].map((e) => ({ id: e.projectId ?? null, fullName: e.fullName, description: null, topics: null }));
  for (const p of profileProjects(dataDir)) listed.push({ id: p.id, fullName: p.name, description: null, topics: null });
  const missing = listed.filter((x) => !cats.get(x) && add(x));
  let requests = 0;
  if (missing.length && gh) {
    const store = openStore(dataDir, `categories_${now().toISOString().replace(/[:.]/g, '-')}`);
    const before = gh.stats.graphql;
    const { meta } = await fetchMeta({ gh, store, items: missing.map((x) => ({ id: x.id, name: x.fullName })), label: 'lists' });
    missing.forEach((x, i) => meta[i] && Object.assign(x, { id: meta[i].id, fullName: meta[i].fullName, description: meta[i].description, topics: meta[i].topics }));
    requests = gh.stats.graphql - before;
  }
  return { list: out, requests };
}

export async function updateCategories({ dataDir, classifier, gh, now = () => new Date(), batch = BATCH, reviewBatch = REVIEW_BATCH, sleep }) {
  const cats = readCategories(dataDir);
  const items = cats.items;
  const { list, requests } = await targets({ dataDir, gh, now, cats });

  // 归上类就记下（项目有了 id 时，换掉原来按名字存的那条）。返回归上类的个数。
  function apply(group, results, source, extra = () => ({}), ai = null) {
    let n = 0;
    for (const r of Array.isArray(results) ? results : []) {
      const x = Number.isInteger(r?.i) ? group[r.i] : null;
      const categories = x ? pickCategories(r.categories) : [];
      if (!categories.length) continue;
      if (x.id) delete items[categoryKey({ fullName: x.fullName })];
      items[categoryKey(x)] = { id: x.id ?? null, fullName: x.fullName, categories, source, version: classifier.version, at: now().toISOString(), ...(ai ? { ai } : {}), ...extra(x) };
      n++;
    }
    return n;
  }

  // 失败的批当轮重试（#52，见 src/retry.js）；失败数和错误只算重试完还失败的。
  async function run(todo, size, review, extra) {
    const groups = chunks(todo, size);
    const { results, rounds } = await withRetries(groups, {
      concurrency: CONCURRENCY,
      attempt: async (group) => {
        try {
          const { results, ai } = await classifier.classify(group.map((x) => x.view ?? x), { review });
          const classified = apply(group, results, review ? 'review' : 'batch', extra, ai);
          saveCategories(dataDir, items);
          return { classified };
        } catch (e) {
          return { error: e.message };
        }
      },
      isFailed: (r) => r.error != null,
      ...(sleep && { sleep }),
    });
    const stat = { todo: todo.length, classified: 0, failed: 0, errors: [], rounds };
    results.forEach((r, i) => {
      if (r.error == null) stat.classified += r.classified;
      else { stat.failed += groups[i].length; stat.errors.push(r.error); }
    });
    stat.unclassified = stat.todo - stat.classified - stat.failed;
    return stat;
  }

  const batchTodo = list.filter((x) => !cats.get(x));
  const batchStat = await run(batchTodo, batch, false);

  // 复核：榜上项目（含分类榜上显示的）有了和当前资料对得上的简介，且还没按这份资料复核过。没有 id 的按名字找资料。
  const reviewTodo = [];
  const find = lookup(items);
  for (const p of profileProjects(dataDir)) {
    const profile = p.id ? readProfile(dataDir, p.id) : findProfile(dataDir, p.name);
    const gen = currentGenerated(profile);
    if (!gen) continue;
    const done = find({ id: profile.projectId, fullName: profile.fullName });
    if (done?.source === 'review' && done.profileHash === profile.material.hash) continue;
    const m = profile.material;
    reviewTodo.push({
      id: profile.projectId,
      fullName: profile.fullName,
      profileHash: m.hash,
      view: { fullName: profile.fullName, description: m.description, topics: m.topics, what: gen.what, problem: gen.problem, skills: m.skills.map((s) => s.name) },
    });
  }
  const reviewStat = await run(reviewTodo, reviewBatch, true, (x) => ({ profileHash: x.profileHash }));

  return { targets: list.length, requests: { graphql: requests }, batch: batchStat, review: reviewStat };
}
