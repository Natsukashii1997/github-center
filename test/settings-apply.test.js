// 设置页批 2：设置接到每日更新上。每日更新开关和整步跳过、出榜（官方热门、ClickHouse）、热点榜（HN、V2EX）、三项思考强度。网络全部模拟。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULTS } from '../src/settings/index.js';
import { planSteps, STEPS, isDue, retryOf, RETRY, readRunState, markRun, finishRun, beijing } from '../src/update-steps.js';
import { rankDay } from '../src/ranking/index.js';
import { updateHot } from '../src/boards/index.js';
import { aiGenerator } from '../src/profiles/prompt.js';
import { aiClassifier } from '../src/categories/prompt.js';
import { aiTagger } from '../src/boards/picks-prompt.js';
import { recordedUpstream } from './helpers/recorded-upstream.js';

const fresh = () => mkdtempSync(join(tmpdir(), 'gc-apply-'));
const withSettings = (over) => ({ ...DEFAULTS, ...over, sources: { ...DEFAULTS.sources, ...over.sources } });

test('每日更新：skills.sh 关掉跳过历史榜；HN、V2EX 都关才跳过热点榜', () => {
  assert.deepEqual(planSteps(DEFAULTS).map((s) => s.skip), STEPS.map(() => null));
  const skip = (sources) => Object.fromEntries(planSteps(withSettings({ sources })).filter((s) => s.skip).map((s) => [s.name, s.skip]));
  assert.deepEqual(skip({ skills: false }), { '历史榜（Skill 安装量）': '设置页里关掉了 skills.sh' });
  assert.deepEqual(skip({ hn: false }), {});
  assert.deepEqual(skip({ hn: false, v2ex: false }), { 热点榜: '设置页里关掉了 Hacker News 和 V2EX' });
});

test('定时叫醒：每日更新开着、北京时间到了设置的时间、今天还没跑过才跑；开跑记下日期', () => {
  const at = (bj) => new Date(Date.parse(`${bj}+08:00`));
  const s = withSettings({ daily: { on: true, at: '11:15' } });
  assert.deepEqual(beijing(at('2026-11-04T00:30:00')), { day: '2026-11-04', time: '00:30' });
  assert.equal(isDue(s, null, at('2026-11-04T11:00:00')), false, '没到点');
  assert.equal(isDue(s, null, at('2026-11-04T11:15:00')), true);
  assert.equal(isDue(s, { day: '2026-11-03' }, at('2026-11-04T14:07:00')), true, '睡过了点，醒来补跑');
  assert.equal(isDue(s, { day: '2026-11-04' }, at('2026-11-04T11:30:00')), false, '今天跑过了');
  assert.equal(isDue(withSettings({ daily: { on: false, at: '11:15' } }), null, at('2026-11-04T12:00:00')), false, '关掉了');

  const dir = fresh();
  assert.equal(readRunState(dir), null);
  // 还没有记录文件：按日志里最近一次开跑的日期（北京时间）算，装好定时后当天不会再跑一次。
  mkdirSync(join(dir, 'logs'));
  writeFileSync(join(dir, 'logs', 'update.log'), '2026-11-03T16:30:00.000Z 每日更新开始\n2026-11-03T16:40:00.000Z 每日更新结束：全部成功\nexit 0\n');
  assert.deepEqual(readRunState(dir), { day: '2026-11-04', startedAt: '2026-11-03T16:30:00.000Z' });
  assert.equal(isDue(s, readRunState(dir), at('2026-11-04T12:00:00')), false);
  markRun(dir, at('2026-11-05T11:15:00'));
  assert.ok(existsSync(join(dir, 'update-state.json')));
  assert.deepEqual(readRunState(dir), { day: '2026-11-05', startedAt: '2026-11-05T03:15:00.000Z', retries: 0 });
  // 跑完补上结束时刻和失败的步骤（#94）。
  finishRun(dir, at('2026-11-05T12:40:00'), ['出榜']);
  assert.deepEqual(readRunState(dir), { day: '2026-11-05', startedAt: '2026-11-05T03:15:00.000Z', retries: 0, endedAt: '2026-11-05T04:40:00.000Z', failed: ['出榜'] });
});

test('#94 失败后当天重试：上次跑完满 30 分钟、当天最多 2 次、北京 22:00 起不试；重跑失败的步骤和后面要用它结果的步骤', () => {
  const at = (bj) => new Date(Date.parse(`${bj}+08:00`));
  const s = withSettings({ daily: { on: true, at: '18:00' } });
  const failedRun = (failed, extra = {}) => ({ day: '2026-11-16', startedAt: '2026-11-16T10:00:46.000Z', retries: 0, endedAt: '2026-11-16T11:33:00.000Z', failed, ...extra });
  // 11-16 那次：出榜失败，19:33 跑完。
  const run = failedRun(['出榜']);
  assert.equal(retryOf(s, run, at('2026-11-16T20:00:00')), null, '跑完不满 30 分钟');
  const r = retryOf(s, run, at('2026-11-16T20:03:00'));
  assert.deepEqual(r, { n: 1, failed: ['出榜'], steps: ['出榜', '精选榜', '补资料', '归类', '周报', '推到服务器、备份库'] });
  // 各自取数的步骤只有自己失败才重跑；最后一步失败只重跑它自己。
  assert.deepEqual(retryOf(s, failedRun(['热点榜', '补资料']), at('2026-11-16T20:03:00')).steps, ['热点榜', '精选榜', '补资料', '归类', '周报', '推到服务器、备份库']);
  assert.deepEqual(retryOf(s, failedRun(['全站 Star 前 100']), at('2026-11-16T20:03:00')).steps, ['全站 Star 前 100', '精选榜', '补资料', '归类', '周报', '推到服务器、备份库']);
  assert.deepEqual(retryOf(s, failedRun(['推到服务器、备份库']), at('2026-11-16T20:03:00')).steps, ['推到服务器、备份库']);
  // 次数、截止时间、不重试的情况。
  assert.equal(retryOf(s, failedRun(['出榜'], { retries: 1 }), at('2026-11-16T20:03:00')).n, 2);
  assert.equal(retryOf(s, failedRun(['出榜'], { retries: RETRY.max }), at('2026-11-16T20:03:00')), null, '当天已重试 2 次');
  assert.equal(retryOf(s, run, at('2026-11-16T22:00:00')), null, '22:00 起不试');
  assert.equal(retryOf(s, run, at('2026-11-16T21:59:00')).n, 1);
  assert.equal(retryOf(s, run, at('2026-11-17T18:30:00')), null, '不是今天的失败，由整套跑接手');
  assert.equal(retryOf(s, failedRun([]), at('2026-11-16T20:03:00')), null, '全部成功');
  assert.equal(retryOf(s, failedRun(['出榜'], { endedAt: undefined }), at('2026-11-16T20:03:00')), null, '还没跑完');
  assert.equal(retryOf(s, { day: '2026-11-16', startedAt: '2026-11-16T10:00:46.000Z' }, at('2026-11-16T20:03:00')), null, '旧记录没有失败步骤');
  assert.equal(retryOf(s, failedRun(['改了名的步骤']), at('2026-11-16T20:03:00')), null, '认不出的步骤不重试');
  assert.equal(retryOf(withSettings({ daily: { on: false, at: '18:00' } }), run, at('2026-11-16T20:03:00')), null, '每日更新关掉了');
  // 重试开跑时记下第几次，并清掉上次的结束时刻：没跑完前不会再叫起第二次。
  const dir = fresh();
  markRun(dir, at('2026-11-16T20:03:00'), 1);
  assert.equal(retryOf(s, readRunState(dir), at('2026-11-16T21:00:00')), null);
  finishRun(dir, at('2026-11-16T20:40:00'), ['出榜']);
  assert.equal(retryOf(s, readRunState(dir), at('2026-11-16T21:10:00')).n, 2);
});

// 出榜：用录制的上游（统计日 2026-10-22），只跑近 1 天。
const day = '2026-10-22';
const now = () => new Date('2026-10-23T08:40:00Z');
const rank = (upstream, opts) => rankDay({ day, dataDir: fresh(), fetch: upstream.fetch, token: 't', now, sleep: async () => {}, ...opts });

test('出榜：关掉官方热门，候选只来自事件数据，不请求热门页、不出官方热门榜', async () => {
  const upstream = recordedUpstream();
  const r = await rank(upstream, { windows: ['d1'], lists: ['trending'], sources: { trending: false, clickhouse: true } });
  assert.equal(r.windows.d1.status, 'published');
  assert.equal(r.windows.d1.snapshot.candidates.trending, 0);
  assert.equal(r.windows.d1.snapshot.candidates.archive, r.windows.d1.snapshot.candidates.total);
  assert.equal(upstream.calls.filter((c) => c.url.startsWith('https://github.com/trending')).length, 0);
  assert.deepEqual(r.lists, {});
});

test('出榜：关掉 ClickHouse，GH Archive 缺的小时补不上，按更新失败处理，不请求 ClickHouse', async () => {
  const upstream = recordedUpstream({ missingArchiveHours: [5] });
  const r = await rank(upstream, { windows: ['d1'], lists: [], sources: { trending: true, clickhouse: false } });
  assert.equal(r.windows.d1.status, 'failed');
  assert.match(r.windows.d1.error, /GH Archive 缺 UTC 2026-10-23T05:00Z 这一小时，ClickHouse 已在设置页关掉/);
  assert.equal(upstream.calls.filter((c) => c.url.startsWith('https://play.clickhouse.com/')).length, 0);
});

// 热点榜：HN 关掉不请求，沿用它上一次、仍在 7 天窗口内的帖子；快照里记 off。
const DAY = 86400;
const T0 = Date.parse('2026-11-01T02:00:00Z') / 1000;
function hotUpstream({ hn = [], v2ex = [] }) {
  const calls = [];
  const get = async (url) => {
    calls.push(url);
    if (url.startsWith('https://hn.algolia.com/')) {
      const [, lo, hi] = /created_at_i>(\d+),created_at_i<=(\d+)/.exec(new URL(url).searchParams.get('numericFilters'));
      const inside = hn.filter((h) => h.created_at_i > Number(lo) && h.created_at_i <= Number(hi));
      return { nbHits: inside.length, hits: inside };
    }
    return v2ex;
  };
  return { get, calls };
}
function fakeGh() {
  const gh = { stats: { graphql: 0 } };
  gh.graphql = async (q) => {
    gh.stats.graphql++;
    const data = {};
    for (const [, alias, owner, name] of q.matchAll(/(r\d+): repository\(owner: "([^"]+)", name: "([^"]+)"\)/g)) data[alias] = { databaseId: name.length, nameWithOwner: `${owner}/${name}`, description: null, stargazerCount: 10, owner: { databaseId: 9 } };
    return { body: JSON.stringify({ data }) };
  };
  return gh;
}

test('热点榜：关掉 HN 不请求它，沿用上一次的 HN 帖子；两个都关也不算失败', async () => {
  const dataDir = fresh();
  const gh = fakeGh();
  const hit = { objectID: '1', title: 't', url: 'https://github.com/acme/tool', points: 40, num_comments: 10, created_at_i: T0 - 3600 };
  const topic = { id: 7, title: 'v', content: 'github.com/beta/lib', replies: 5, created: T0, url: 'https://www.v2ex.com/t/7' };
  await updateHot({ dataDir, gh, get: hotUpstream({ hn: [hit] }).get, now: () => new Date(T0 * 1000) });
  const up = hotUpstream({ hn: [hit], v2ex: [topic] });
  const r = await updateHot({ dataDir, gh, get: up.get, now: () => new Date((T0 + DAY) * 1000), enabled: { hn: false, v2ex: true } });
  assert.equal(r.status, 'published');
  assert.deepEqual(r.snapshot.sources.hn, { status: 'off', posts: 1 });
  assert.equal(r.snapshot.sources.v2ex.status, 'ok');
  assert.equal(up.calls.filter((u) => u.startsWith('https://hn.algolia.com/')).length, 0);
  assert.deepEqual(r.snapshot.entries.map((e) => [e.repo, e.heat]).sort(), [['acme/tool', 50], ['beta/lib', 5]]);

  const both = await updateHot({ dataDir, gh, get: hotUpstream({}).get, now: () => new Date((T0 + 2 * DAY) * 1000), enabled: { hn: false, v2ex: false } });
  assert.equal(both.status, 'published');
  assert.deepEqual(Object.values(both.snapshot.sources).map((x) => x.status), ['off', 'off']);
});

// 假的 codex：记下命令行参数，往 -o 指定的文件里写一份空结果。
function fakeCodex() {
  const dir = fresh();
  const bin = join(dir, 'codex');
  const log = join(dir, 'args.log');
  writeFileSync(bin, `#!${process.execPath}
const fs = require('node:fs');
const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(a) + '\\n');
fs.writeFileSync(a[a.indexOf('-o') + 1], JSON.stringify({ results: [], what: '', problem: '', line: '', use: [], scene: [], tag: '', type: '', conditions: [], skillPurposes: [] }));
`);
  chmodSync(bin, 0o755);
  const efforts = () => readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l).find((x) => x.startsWith('model_reasoning_effort=')));
  return { bin, efforts };
}

test('思考强度：补资料、归类、精选榜各自按设置传给 codex，不给就用默认 low', async () => {
  const codex = fakeCodex();
  await aiClassifier({ bin: codex.bin, effort: 'high' }).classify([{ fullName: 'a/b', description: 'x', topics: [] }]);
  await aiTagger({ bin: codex.bin, effort: 'medium' }).suggest([{ name: '智能体' }], [{ fullName: 'a/b', description: 'x', topics: [] }]);
  await aiClassifier({ bin: codex.bin }).classify([{ fullName: 'a/b', description: 'x', topics: [] }]);
  await aiGenerator({ bin: codex.bin, effort: 'high' }).generate({ fullName: 'a/b', description: 'x', topics: [], listing: [], readme: null, docs: [], skills: [] }).catch(() => null);
  assert.deepEqual(codex.efforts(), ['model_reasoning_effort="high"', 'model_reasoning_effort="medium"', 'model_reasoning_effort="low"', 'model_reasoning_effort="high"']);
});
