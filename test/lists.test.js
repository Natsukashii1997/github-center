// #9：新项目榜、官方热门榜、累计高星榜随出榜一起生成快照（接缝 1）；它们的榜单页已删（接缝 2，#21）。上游全部来自录制数据。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rankDay, readLatestSnapshot, readStatus } from '../src/ranking/index.js';
import { recordedUpstream } from './helpers/recorded-upstream.js';
import { visit, dataOf } from './helpers/web.js';

const day = '2026-10-22';
const now = () => new Date('2026-10-23T08:40:00Z');
const fresh = () => mkdtempSync(join(tmpdir(), 'gc-lists-'));
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const run = (opts = {}) => {
  const upstream = opts.upstream ?? recordedUpstream();
  return rankDay({ day, dataDir: opts.dataDir ?? fresh(), fetch: upstream.fetch, token: 't', now, sleep: async () => {}, windows: [], ...opts });
};

test('新项目榜：截至统计日近 30 天内创建的项目，按总 Star 前 20，末位并列一起上榜', async () => {
  const dataDir = fresh();
  const upstream = recordedUpstream();
  const r = await run({ dataDir, upstream });
  const s = r.lists.new.snapshot;
  assert.equal(r.lists.new.status, 'published');
  // 按太平洋统计日：09-23 零点（夏令时）= 07:00Z，10-22 结束前 1 秒 = 10-23 06:59:59Z。
  assert.equal(s.query, 'created:2026-09-23T07:00:00+00:00..2026-10-23T06:59:59+00:00 fork:true');
  assert.ok(upstream.calls.some((c) => c.url.startsWith('https://api.github.com/search/repositories?') && c.url.includes('sort=stars') && c.url.includes('order=desc')));
  assert.equal(s.entries.length, 20);
  assert.deepEqual([s.entries[0].rank, s.entries[0].fullName, s.entries[0].total], [1, 'storytold/photocraft', 71656]);
  assert.match(s.entries[0].createdAt, /^2026-09-30T/);
  assert.equal(s.from, '2026-09-23');
  // 第 18、19 名同为 9,535，同名次；第 20 名照常。
  assert.deepEqual(s.entries.slice(17).map((e) => [e.rank, e.total]), [[18, 9535], [18, 9535], [20, 8766]]);
  const raw = readFileSync(join(dataDir, s.evidence.path));
  assert.equal(sha256(raw), s.evidence.sha256);
  assert.equal(JSON.parse(raw).items[0].stargazers_count, 71656);
});

test('累计高星榜：全站按总 Star 前 20', async () => {
  const r = await run();
  const s = r.lists.top.snapshot;
  assert.equal(s.entries.length, 20);
  assert.deepEqual(s.entries.slice(0, 2).map((e) => [e.rank, e.fullName, e.total]), [[1, 'codecrafters-io/build-your-own-x', 555605], [2, 'sindresorhus/awesome', 523390]]);
  assert.ok(s.entries.every((e, i) => i === 0 || e.total <= s.entries[i - 1].total));
});

test('官方热门榜：日、周、月三页，全部语言，保持原样顺序，原始页面存档', async () => {
  const dataDir = fresh();
  const upstream = recordedUpstream();
  const r = await run({ dataDir, upstream });
  const { pages } = r.lists.trending.snapshot;
  assert.deepEqual(Object.keys(pages), ['daily', 'weekly', 'monthly']);
  for (const since of ['daily', 'weekly', 'monthly']) assert.ok(upstream.calls.some((c) => c.url === `https://github.com/trending?since=${since}`));
  const daily = pages.daily;
  // 原样顺序：php/php-src 在页面上排第 1，虽然它的“今日新增”不是最多的。
  assert.deepEqual(daily.entries.slice(0, 3).map((e) => [e.rank, e.fullName, e.periodStars]), [[1, 'php/php-src', 287], [2, 'anthropics/knowledge-work-plugins', 303], [3, daily.entries[2].fullName, 1948]]);
  assert.equal(daily.entries.length, 9);
  const raw = readFileSync(join(dataDir, daily.evidence.path));
  assert.equal(sha256(raw), daily.evidence.sha256);
  assert.equal(raw.toString(), readFileSync(new URL('./fixtures/upstream/trending-daily.html', import.meta.url), 'utf8'));
});

test('周榜、月榜按页面原样顺序，取页面上写的本周、本月新增', async () => {
  const r = await run({ upstream: recordedUpstream({ realTrendingPages: true }) });
  const { weekly, monthly } = r.lists.trending.snapshot.pages;
  assert.deepEqual(weekly.entries.slice(0, 2).map((e) => [e.rank, e.fullName, e.periodStars, e.total]), [[1, 'morluto/rea', 106341, 370218], [2, 'anthropics/claude-plugins-official', 5649, 44018]]);
  assert.deepEqual(monthly.entries[0], { rank: 1, projectId: monthly.entries[0].projectId, fullName: 'debpalash/VoiceStudio', periodStars: 47620, total: 82365 });
  assert.ok(Number.isInteger(monthly.entries[0].projectId));
});

test('热门榜页面一个项目都解析不出来（页面结构变了）时按更新失败处理，不发布空榜', async () => {
  const dataDir = fresh();
  const upstream = recordedUpstream();
  const fetch = (url, init) => (String(url) === 'https://github.com/trending?since=daily' ? Promise.resolve(new Response('<html></html>')) : upstream.fetch(url, init));
  const r = await rankDay({ day, dataDir, fetch, token: 't', now, sleep: async () => {}, windows: ['d1'] });
  assert.equal(r.lists.trending.status, 'failed');
  assert.match(r.lists.trending.error, /官方热门日榜页面没解析出任何项目/);
  assert.equal(r.windows.d1.status, 'failed');
  assert.equal(readLatestSnapshot(dataDir, 'trending'), null);
});

test('补跑更早的统计日时不生成这三个榜单（只能取到现在的数字，不能记成旧日子的）', async () => {
  const upstream = recordedUpstream();
  const r = await run({ upstream, day: '2026-10-08', windows: ['d1'] });
  assert.deepEqual(r.lists, {});
  assert.equal(r.windows.d1.status, 'published');
  assert.ok(!upstream.calls.some((c) => c.url.includes('/search/')));
});

test('更新记录兼容旧的键名：#9 之前只记涨星榜、键名是 windows', async () => {
  const dataDir = fresh();
  writeFileSync(join(dataDir, 'status.json'), JSON.stringify({ windows: { d7: { day, at: 'x', status: 'failed', error: 'fetch failed' } } }));
  assert.equal(readStatus(dataDir).boards.d7.status, 'failed');
  await run({ dataDir });
  const s = readStatus(dataDir).boards;
  assert.equal(s.d7.error, 'fetch failed');
  assert.equal(s.top.status, 'published');
});

test('同一次运行里官方热门榜每一页只抓一次，涨星榜找候选和官方热门榜共用', async () => {
  const upstream = recordedUpstream();
  await run({ upstream, windows: ['d1'] });
  assert.equal(upstream.calls.filter((c) => c.url === 'https://github.com/trending?since=daily').length, 1);
});

test('搜索结果不全时这个榜单按更新失败处理，其他榜单照常', async () => {
  const dataDir = fresh();
  const r = await run({ dataDir, upstream: recordedUpstream({ incompleteSearch: true }) });
  assert.equal(r.lists.new.status, 'failed');
  assert.match(r.lists.new.error, /搜索结果不全/);
  assert.equal(r.lists.top.status, 'failed');
  assert.equal(r.lists.trending.status, 'published');
  assert.equal(readLatestSnapshot(dataDir, 'new'), null);
});

test('同一统计日重跑不覆盖三个榜单的快照，也不再请求上游', async () => {
  const dataDir = fresh();
  const first = await run({ dataDir });
  const before = readFileSync(join(dataDir, first.lists.trending.path));
  const again = recordedUpstream();
  const second = await run({ dataDir, upstream: again });
  for (const l of ['new', 'trending', 'top']) assert.equal(second.lists[l].status, 'exists');
  assert.deepEqual(readFileSync(join(dataDir, first.lists.trending.path)), before);
  assert.equal(again.calls.length, 0);
});

// ---- 接缝 2：榜单页 ----
// 2026-11-03 起（#21）新项目榜、累计高星榜、官方热门榜不再单独展示（数据照抓，涨星榜找候选还要用），/boards 和旧地址都跳首页。
test('榜单页删除：/boards、/new、/top、/trending 跳涨星；只在这几个榜上的项目，项目页照样打得开', async () => {
  const dataDir = fresh();
  await run({ dataDir });
  for (const path of ['boards', 'boards?since=monthly', 'new', 'top?cat=Skill', 'trending?since=weekly']) {
    const r = await visit(dataDir, path);
    assert.deepEqual([r.status, r.headers.location], [303, '/stars'], path);
  }
  // 只在官方热门榜上的项目：项目页的总 Star 取榜单快照里的数（没有涨星榜那次运行的数字）。
  const pj = dataOf((await visit(dataDir, 'p/php/php-src')).body);
  assert.deepEqual([pj.page.run, pj.page.total, pj.projects['php/php-src'].id > 0], [null, 41378, true]);
});
