// #25 热点榜：认出指向 GitHub 仓库的链接，热度 = 点赞 + 评论按仓库合计（分来源），每天一次快照，近 7 天走势从每日快照拼出。网络全部模拟。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findRepos, parseRepoInput, aggregate, heatOf, updateHot, backfillHot, readHotBoard, jsonGetter } from '../src/boards/index.js';
import { hnPost, v2exPost, V2EX_LISTS } from '../src/boards/hot.js';

test('仓库链接识别：只认 github.com/<作者>/<仓库>，去掉 .git 和末尾句点，同一仓库不分大小写只算一次', () => {
  assert.deepEqual(findRepos('https://github.com/acme/tool'), ['acme/tool']);
  assert.deepEqual(findRepos('see https://www.github.com/Acme/Tool.git and http://github.com/acme/tool/blob/main/README.md'), ['Acme/Tool']);
  assert.deepEqual(findRepos('项目地址：github.com/a-b/c_d.js。欢迎试用'), ['a-b/c_d.js']);
  assert.deepEqual(findRepos('[x](https://github.com/o/r#readme) (https://github.com/o2/r2?tab=x)'), ['o/r', 'o2/r2']);
  assert.deepEqual(findRepos('结尾句点 github.com/o/r.'), ['o/r']);
  // 不是仓库的：gist、raw、用户主页、站内保留路径、别的域名。
  assert.deepEqual(findRepos('https://gist.github.com/u/abc https://raw.githubusercontent.com/o/r/main/x https://github.com/acme'), []);
  assert.deepEqual(findRepos('https://github.com/topics/ai https://github.com/orgs/acme/people https://github.com/sponsors/u https://notgithub.com/o/r'), []);
  assert.deepEqual(findRepos(null), []);
  assert.equal(parseRepoInput('  https://github.com/acme/tool/tree/main '), 'acme/tool');
  assert.equal(parseRepoInput('acme/tool'), 'acme/tool');
  assert.equal(parseRepoInput('acme'), null);
  assert.equal(parseRepoInput('topics/ai'), null);
});

test('帖子：HN 只看帖子链接，V2EX 看标题和正文；V2EX 没有点赞只算回复', () => {
  const h = hnPost({ objectID: '42', title: 'Show HN: Tool', url: 'https://github.com/acme/tool', points: 120, num_comments: 30, created_at_i: 1793600000, story_text: 'github.com/x/y' });
  assert.deepEqual(h, { source: 'hn', id: '42', url: 'https://news.ycombinator.com/item?id=42', title: 'Show HN: Tool', createdAt: new Date(1793600000e3).toISOString(), points: 120, comments: 30, repos: ['acme/tool'] });
  assert.equal(heatOf(h), 150);
  const v = v2exPost({ id: 7, title: '分享：小工具', content: '地址 https://github.com/acme/tool', replies: 12, created: 1793600000, url: 'https://www.v2ex.com/t/7' });
  assert.deepEqual([v.source, v.points, v.comments, v.repos, heatOf(v)], ['v2ex', 0, 12, ['acme/tool'], 12]);
  assert.equal(hnPost({ objectID: '1', created_at_i: 1, url: null }).points, 0);
});

test('热度计算：按仓库合计（不分大小写），分来源记份额，按热度从高到低', () => {
  const posts = [
    { source: 'hn', id: '1', points: 100, comments: 20, repos: ['acme/tool'] },
    { source: 'hn', id: '2', points: 5, comments: 0, repos: ['Acme/Tool', 'beta/lib'] },
    { source: 'v2ex', id: '3', points: 0, comments: 40, repos: ['acme/tool'] },
    { source: 'v2ex', id: '4', points: 0, comments: 200, repos: ['gamma/app'] },
  ];
  const r = aggregate(posts);
  assert.deepEqual(r.map((x) => [x.key, x.heat, x.sources, x.posts]), [
    ['gamma/app', 200, { hn: 0, v2ex: 200 }, 1],
    ['acme/tool', 165, { hn: 125, v2ex: 40 }, 3],
    ['beta/lib', 5, { hn: 5, v2ex: 0 }, 1],
  ]);
});

// —— 模拟上游 ——
const DAY = 86400;
const T0 = Date.parse('2026-11-01T02:00:00Z') / 1000;
// HN：按请求里的时间段回落在段内的 hits。
function hnServer(hits) {
  return (url) => {
    const f = new URL(url).searchParams.get('numericFilters');
    const [, lo, hi] = /created_at_i>(\d+),created_at_i<=(\d+)/.exec(f);
    const inside = hits.filter((h) => h.created_at_i > Number(lo) && h.created_at_i <= Number(hi));
    return { nbHits: inside.length, hits: inside };
  };
}
// V2EX：每个列表回同一批主题（默认）；topics 可以按列表给。
const v2exServer = (topics) => (url) => (typeof topics === 'function' ? topics(url) : topics);
function upstream({ hn = [], v2ex = [], fail = {} }) {
  const calls = [];
  const get = async (url) => {
    calls.push(url);
    if (url.startsWith('https://hn.algolia.com/')) {
      if (fail.hn) throw new Error('HN 挂了');
      return hnServer(hn)(url);
    }
    if (fail.v2ex) throw new Error('V2EX 挂了');
    return v2exServer(v2ex)(url);
  };
  return { get, calls };
}
// GraphQL：按名字查表（小写）；表里没有的回 null。
function fakeGh(table) {
  const gh = { stats: { graphql: 0 } };
  gh.graphql = async (q) => {
    gh.stats.graphql++;
    const data = {};
    for (const [, alias, owner, name] of q.matchAll(/(r\d+): repository\(owner: "([^"]+)", name: "([^"]+)"\)/g)) {
      const hit = table[`${owner}/${name}`.toLowerCase()];
      data[alias] = hit ? { databaseId: hit.id, nameWithOwner: hit.name, description: hit.desc ?? null, stargazerCount: 10, owner: { databaseId: hit.owner ?? 9 } } : null;
    }
    return { body: JSON.stringify({ data }) };
  };
  return gh;
}
const hit = (id, url, points, comments, t) => ({ objectID: String(id), title: `t${id}`, url, points, num_comments: comments, created_at_i: t });
const topic = (id, content, replies, t) => ({ id, title: `v${id}`, content, replies, created: t, url: `https://www.v2ex.com/t/${id}` });
const TABLE = {
  'acme/tool': { id: 1, name: 'acme/tool', owner: 11, desc: '一个工具' },
  'acme/old-name': { id: 1, name: 'acme/tool', owner: 11 },
  'beta/lib': { id: 2, name: 'beta/lib', owner: 22 },
};
const at = (t) => () => new Date(t * 1000);

test('每天一次：两个来源各 7 次请求、GraphQL 一次；改过名的合并，查不到的去掉；合集帖不计；同一天不重跑', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'gc-hot-'));
  const up = upstream({
    hn: [
      hit(1, 'https://github.com/acme/tool', 100, 50, T0 - 3600),
      hit(2, 'https://github.com/acme/old-name', 10, 0, T0 - 3 * DAY),
      hit(3, 'https://github.com/ghost/deleted', 500, 500, T0 - DAY / 2),
      hit(4, 'https://example.com/post', 900, 900, T0 - 3600),
      hit(5, 'https://github.com/beta/lib', 7, 1, T0 - 8 * DAY), // 窗口外
    ],
    v2ex: [topic(70, 'https://github.com/beta/lib', 30, T0 - DAY), topic(71, '合集 github.com/a/1 github.com/a/2 github.com/a/3 github.com/a/4', 999, T0 - DAY)],
  });
  const gh = fakeGh(TABLE);
  const r = await updateHot({ dataDir, gh, get: up.get, now: at(T0) });
  assert.equal(r.status, 'published');
  assert.equal(r.path, join('snapshots', 'hot', '2026-11-01.json'));
  assert.equal(up.calls.filter((u) => u.includes('algolia')).length, 7);
  assert.equal(up.calls.filter((u) => u.includes('v2ex')).length, V2EX_LISTS.length);
  assert.equal(gh.stats.graphql, 1);
  const s = r.snapshot;
  assert.deepEqual(s.sources.hn, { status: 'ok', fetched: 3, posts: 3 });
  assert.deepEqual(s.sources.v2ex, { status: 'ok', fetched: 1, posts: 1 });
  assert.deepEqual(s.resolve, { requested: 4, found: 3, failed: false });
  assert.deepEqual(s.entries.map((e) => [e.rank, e.repo, e.id, e.ownerId, e.heat, e.sources, e.aliases]), [
    [1, 'acme/tool', 1, 11, 160, { hn: 160, v2ex: 0 }, ['acme/tool', 'acme/old-name']],
    [2, 'beta/lib', 2, 22, 30, { hn: 0, v2ex: 30 }, ['beta/lib']],
  ]);

  const again = await updateHot({ dataDir, gh, get: up.get, now: at(T0 + 3600) });
  assert.equal(again.status, 'exists');
  assert.equal(up.calls.length, 7 + V2EX_LISTS.length, '同一天不再请求');

  const b = readHotBoard(dataDir);
  assert.deepEqual([b.day, b.days, b.complete, b.entries.length, b.failure], ['2026-11-01', 1, false, 2, null]);
  assert.deepEqual(b.entries[0].series.map((x) => x.heat), [null, null, null, null, null, null, 160]);
  assert.equal(b.entries[0].change, null, '没有前一天的快照');
});

test('走势：每天各量一次；V2EX 看不到的旧帖沿用上次量到的数；不满 7 天写明已记几天；比前一天涨跌', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'gc-hot-'));
  const gh = fakeGh(TABLE);
  // 第 1 天：HN 一帖 50 热度，V2EX 一帖 20 回复。
  await updateHot({ dataDir, gh, get: upstream({ hn: [hit(1, 'https://github.com/acme/tool', 40, 10, T0 - 3600)], v2ex: [topic(70, 'github.com/beta/lib', 20, T0 - 3600)] }).get, now: at(T0) });
  // 第 2 天：HN 那帖涨到 100；V2EX 列表里已经没有它了（只给最新的），沿用 20。
  await updateHot({ dataDir, gh, get: upstream({ hn: [hit(1, 'https://github.com/acme/tool', 80, 20, T0 - 3600)], v2ex: [] }).get, now: at(T0 + DAY) });
  // 第 3 天跳过；第 4 天：HN 那帖还在窗口里，V2EX 那帖被重新看到、回复涨到 26。
  await updateHot({ dataDir, gh, get: upstream({ hn: [hit(1, 'https://github.com/acme/tool', 80, 20, T0 - 3600)], v2ex: [topic(70, 'github.com/beta/lib', 26, T0 - 3600)] }).get, now: at(T0 + 3 * DAY) });
  let b = readHotBoard(dataDir);
  assert.deepEqual([b.day, b.days, b.complete], ['2026-11-04', 3, false]);
  const tool = b.entries.find((e) => e.repo === 'acme/tool');
  const lib = b.entries.find((e) => e.repo === 'beta/lib');
  assert.deepEqual(tool.series.map((x) => [x.day, x.heat]), [['2026-10-29', null], ['2026-10-30', null], ['2026-10-31', null], ['2026-11-01', 50], ['2026-11-02', 100], ['2026-11-03', null], ['2026-11-04', 100]]);
  assert.deepEqual(lib.series.map((x) => x.heat).slice(3), [20, 20, null, 26]);
  assert.equal(tool.change, null, '前一天（11-03）没有快照');

  // 第 5 天：V2EX 那帖回复 39（比前一天 +50%）；HN 那帖还在。
  await updateHot({ dataDir, gh, get: upstream({ hn: [hit(1, 'https://github.com/acme/tool', 80, 20, T0 - 3600)], v2ex: [topic(70, 'github.com/beta/lib', 39, T0 - 3600)] }).get, now: at(T0 + 4 * DAY) });
  b = readHotBoard(dataDir);
  assert.deepEqual(b.entries.find((e) => e.repo === 'beta/lib').change, { yesterday: 26, delta: 13, ratio: 0.5 });
  assert.equal(b.days, 4);

  // 帖子发出满 7 天就出窗口（HN 那帖在 T0-1h 发，T0+7d 已出窗口；V2EX 沿用的也一样）。
  await updateHot({ dataDir, gh, get: upstream({ hn: [], v2ex: [] }).get, now: at(T0 + 7 * DAY) });
  b = readHotBoard(dataDir);
  assert.deepEqual([b.entries.length, b.days], [0, 4], '11-02 至 11-08 里存了 11-02、04、05、08 四天');
});

test('一个来源失败：照常发布、写明，沿用它上一次的帖子；两个都失败：不发布，保留上一次快照并写明失败日期', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'gc-hot-'));
  const gh = fakeGh(TABLE);
  await updateHot({ dataDir, gh, get: upstream({ hn: [hit(1, 'https://github.com/acme/tool', 40, 10, T0 - 3600)], v2ex: [] }).get, now: at(T0) });
  const r = await updateHot({ dataDir, gh, get: upstream({ fail: { hn: true }, v2ex: [topic(70, 'github.com/beta/lib', 5, T0)] }).get, now: at(T0 + DAY) });
  assert.equal(r.status, 'published');
  assert.deepEqual(r.snapshot.sources.hn, { status: 'failed', error: 'HN 挂了', posts: 1 });
  assert.deepEqual(r.snapshot.entries.map((e) => [e.repo, e.heat]), [['acme/tool', 50], ['beta/lib', 5]]);

  const dead = await updateHot({ dataDir, gh, get: upstream({ fail: { hn: true, v2ex: true } }).get, now: at(T0 + 2 * DAY) });
  assert.equal(dead.status, 'failed');
  assert.match(dead.error, /Hacker News：HN 挂了；V2EX：/);
  const b = readHotBoard(dataDir);
  assert.equal(b.day, '2026-11-02', '保留上一次快照');
  assert.equal(b.failure.day, '2026-11-03');

  // V2EX 个别列表失败只跳过那个列表。
  const some = await updateHot({ dataDir, gh, get: upstream({ hn: [], v2ex: (url) => (url.includes('node_name=github') ? { status: 'error', message: 'Object Not Found' } : []) }).get, now: at(T0 + 3 * DAY) });
  assert.equal(some.snapshot.sources.v2ex.status, 'ok');
  assert.equal(some.snapshot.sources.v2ex.errors.length, 1);
  assert.match(some.snapshot.sources.v2ex.errors[0], /node_name=github 返回的不是主题列表/);
});

test('GraphQL 失败：不去掉任何仓库，id 记为空，写明未核', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'gc-hot-'));
  const gh = { stats: { graphql: 0 }, graphql: async () => { throw new Error('401'); } };
  const r = await updateHot({ dataDir, gh, get: upstream({ hn: [hit(1, 'https://github.com/acme/tool', 1, 1, T0 - 60)] }).get, now: at(T0) });
  assert.deepEqual(r.snapshot.resolve, { requested: 1, found: 0, failed: true });
  assert.deepEqual(r.snapshot.entries.map((e) => [e.repo, e.id, e.heat]), [['acme/tool', null, 2]]);
  assert.ok(JSON.parse(readFileSync(join(dataDir, r.path), 'utf8')).posts.length === 1, '快照里存下帖子');
});

test('公开接口：429 按 retry-after 等了再试，5xx 重试，4xx 直接报错', async () => {
  const waits = [];
  const replies = [new Response('', { status: 429, headers: { 'retry-after': '7' } }), new Response('', { status: 503 }), new Response('{"ok":1}'), new Response('nope', { status: 404 })];
  const http = jsonGetter({ fetch: async () => replies.shift(), sleep: async (ms) => waits.push(ms), gapMs: 0 });
  assert.deepEqual(await http.get('https://x/a'), { ok: 1 });
  assert.deepEqual(waits, [7000, 10000]);
  await assert.rejects(http.get('https://x/b'), /返回 404：nope/);
  assert.equal(http.stats.requests, 4);
});

test('补录：过去没存快照的日子按那天北京 18:00 回推，HN 用现在的数、V2EX 只用见过的帖子（取最近一次的数），记 backfilled，不改 status.json', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'gc-hot-'));
  const gh = fakeGh(TABLE);
  const hn = [hit(1, 'https://github.com/acme/tool', 80, 20, T0 - 3600), hit(2, 'https://github.com/beta/lib', 5, 5, T0 + DAY)];
  // 11-03、11-04 正常各量一次：V2EX 那帖（10-31 发）先 20 后 26 个回复；另一帖 11-02 才发。
  await updateHot({ dataDir, gh, get: upstream({ hn, v2ex: [topic(70, 'github.com/beta/lib', 20, T0 - 3600)] }).get, now: at(T0 + 2 * DAY) });
  await updateHot({ dataDir, gh, get: upstream({ hn, v2ex: [topic(70, 'github.com/beta/lib', 26, T0 - 3600), topic(71, 'github.com/acme/tool', 9, T0 + DAY)] }).get, now: at(T0 + 3 * DAY) });
  const status = readFileSync(join(dataDir, 'status.json'), 'utf8');

  const up = upstream({ hn });
  const r = await backfillHot({ dataDir, gh, get: up.get, day: '2026-11-01', now: at(T0 + 3 * DAY + 3600) });
  assert.equal(r.status, 'published');
  const s = r.snapshot;
  assert.deepEqual([s.statDay, s.fetchedAt, s.window.from], ['2026-11-01', '2026-11-01T10:00:00.000Z', '2026-10-25T10:00:00.000Z']);
  assert.match(s.backfilled.note, /^补录：.*偏高.*偏低$/);
  assert.equal(s.backfilled.at, new Date((T0 + 3 * DAY + 3600) * 1000).toISOString());
  assert.equal(up.calls.length, 7, 'HN 7 次，V2EX 不请求');
  assert.ok(up.calls.every((u) => u.startsWith('https://hn.algolia.com/')));
  assert.deepEqual(s.sources, { hn: { status: 'ok', fetched: 1, posts: 1 }, v2ex: { status: 'ok', fetched: 0, posts: 1 } });
  assert.deepEqual(s.entries.map((e) => [e.repo, e.heat]), [['acme/tool', 100], ['beta/lib', 26]]);
  assert.equal(readFileSync(join(dataDir, 'status.json'), 'utf8'), status);

  const b = readHotBoard(dataDir);
  assert.deepEqual([b.day, b.days, b.backfilled], ['2026-11-04', 3, ['2026-11-01']]);
  assert.equal(b.entries.find((e) => e.repo === 'acme/tool').series[3].heat, 100);

  assert.equal((await backfillHot({ dataDir, gh, get: up.get, day: '2026-11-01', now: at(T0 + 3 * DAY + 3600) })).status, 'exists');
  assert.equal((await backfillHot({ dataDir, gh, get: up.get, day: '2026-11-03', now: at(T0 + 3 * DAY + 3600) })).status, 'exists');
  await assert.rejects(backfillHot({ dataDir, gh, get: up.get, day: '2026-11-04', now: at(T0 + 3 * DAY + 3600) }), /只能补今天以前的日子/);
  assert.equal(up.calls.length, 7);
});
