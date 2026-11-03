// 设置页批 2：设置接到每日更新上。每日更新开关和整步跳过、出榜（官方热门、ClickHouse）、热点榜（HN、V2EX）、三项思考强度。网络全部模拟。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULTS } from '../src/settings/index.js';
import { planSteps, STEPS } from '../src/update-steps.js';
import { lastRun } from '../src/web/settings.js';
import { rankDay } from '../src/ranking/index.js';
import { updateHot } from '../src/boards/index.js';
import { codexGenerator } from '../src/profiles/codex.js';
import { codexClassifier } from '../src/categories/codex.js';
import { codexTagger } from '../src/boards/picks-codex.js';
import { recordedUpstream } from './helpers/recorded-upstream.js';

const fresh = () => mkdtempSync(join(tmpdir(), 'gc-apply-'));
const withSettings = (over) => ({ ...DEFAULTS, ...over, sources: { ...DEFAULTS.sources, ...over.sources } });

test('每日更新：关掉就整次不跑；skills.sh 关掉跳过历史榜；HN、V2EX 都关才跳过热点榜', () => {
  assert.equal(planSteps(withSettings({ daily: { on: false, at: '10:00' } })), null);
  assert.deepEqual(planSteps(DEFAULTS).map((s) => s.skip), STEPS.map(() => null));
  const skip = (sources) => Object.fromEntries(planSteps(withSettings({ sources })).filter((s) => s.skip).map((s) => [s.name, s.skip]));
  assert.deepEqual(skip({ skills: false }), { '历史榜（Skill 安装量）': '设置页里关掉了 skills.sh' });
  assert.deepEqual(skip({ hn: false }), {});
  assert.deepEqual(skip({ hn: false, v2ex: false }), { 热点榜: '设置页里关掉了 Hacker News 和 V2EX' });
  // 关掉每日更新的那次运行，设置页上写「已关掉」，不算成功也不算失败。
  assert.deepEqual(lastRun('2026-11-04T02:00:00.000Z 每日更新开始\n2026-11-04T02:00:00.000Z 每日更新已在设置页关掉，这次不跑\n2026-11-04T02:00:00.000Z 每日更新结束：已关掉\nexit 0\n'),
    { startedAt: '2026-11-04T02:00:00.000Z', endedAt: '2026-11-04T02:00:00.000Z', failed: [], off: true, running: false });
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
  assert.match(r.windows.d1.error, /第 5 小时 GH Archive 缺失，ClickHouse 已在设置页关掉/);
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
  await codexClassifier({ bin: codex.bin, effort: 'high' }).classify([{ fullName: 'a/b', description: 'x', topics: [] }]);
  await codexTagger({ bin: codex.bin, effort: 'medium' }).suggest([{ name: '智能体' }], [{ fullName: 'a/b', description: 'x', topics: [] }]);
  await codexClassifier({ bin: codex.bin }).classify([{ fullName: 'a/b', description: 'x', topics: [] }]);
  await codexGenerator({ bin: codex.bin, effort: 'high' }).generate({ fullName: 'a/b', description: 'x', topics: [], listing: [], readme: null, docs: [], skills: [] }).catch(() => null);
  assert.deepEqual(codex.efforts(), ['model_reasoning_effort="high"', 'model_reasoning_effort="medium"', 'model_reasoning_effort="low"', 'model_reasoning_effort="high"']);
});
