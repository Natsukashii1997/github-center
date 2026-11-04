// 接缝 1：出榜管线。上游全部来自录制数据，不访问网络。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rankDay, readLatestSnapshot, readStatus } from '../src/ranking/index.js';
import { readCandidates } from '../src/ranking/store.js';
import { completenessFloor } from '../src/ranking/check.js';
import { recordedUpstream } from './helpers/recorded-upstream.js';

const day = '2026-10-22';
const now = () => new Date('2026-10-23T08:40:00Z');
const fresh = () => mkdtempSync(join(tmpdir(), 'gc-rank-'));
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const noSleep = async () => {};
const fixture = (path) => JSON.parse(readFileSync(new URL(`./fixtures/upstream/${path}`, import.meta.url)));

// 只跑近 1 天；返回这个窗口的结果。
async function d1({ upstream = recordedUpstream(), dataDir = fresh(), ...opts } = {}) {
  const r = await rankDay({ day, dataDir, fetch: upstream.fetch, token: 't', now, windows: ['d1'], lists: [], sleep: noSleep, ...opts });
  return r.windows.d1;
}

// 预先放好某天的全站 Star 事件合计（代替下载），用来设定每个项目的事件记录次数。
function seedEvents(dataDir, d, rows) {
  mkdirSync(join(dataDir, 'events'), { recursive: true });
  writeFileSync(join(dataDir, 'events', `${d}.json`), JSON.stringify({ day: d, source: 'gharchive', fallbackHours: [], rows }));
}

// 录制素材里每个有官方历史的项目，事件记录次数设成统计日当天新增的一半（记录比例 50%）。
function halfRecorded() {
  return ['1903522', '1140828898', '1266797999', '1273427276', '1200597263', '1241364151', '1428842369', '1423101235', '1246285721', '1420922340',
    '1429685674', '1422525548', '1143604550', '937253475', '214587193', '160919119', '1092047360', '518122174', '1284084888', '1145981909',
    '1306722822', '1178268818', '1330431542', '42976210'].map((id) => {
    const gain = fixture(`history/${id}.json`).find((w) => w.week === 1792281600).days[4];
    return { id: Number(id), name: fixture(`repos/${id}.json`).full_name, events: Math.floor(gain / 2) };
  });
}

test('近 1 天榜单取前 20，末位并列一起上榜，同分同名次', async () => {
  const { snapshot } = await d1();
  const rows = snapshot.entries.map((e) => [e.rank, e.fullName, e.gain]);
  assert.equal(rows.length, 21);
  assert.deepEqual(rows.slice(0, 7), [
    [1, 'php/php-src', 5200],
    [2, 'anthropics/knowledge-work-plugins', 3100],
    [3, 'DietrichGebert/ponytail', 2400],
    [4, 'cloudflare/security-audit-skill', 1800],
    [5, 'Graphify-Labs/graphify', 1500],
    [5, 'nicholasx417/WinNative-Components', 1500],
    [7, 'GabrielTaiga/Taiga-Launcher-for-Steam', 1200],
  ]);
  assert.deepEqual(rows.slice(19).map(([r, , g]) => [r, g]), [[20, 120], [20, 120]]);
  assert.equal(snapshot.entries[0].total, 193409);
  assert.equal(snapshot.statDay, day);
  assert.equal(snapshot.window, 'd1');
});

test('每个上榜数字都能追溯到保存的官方原始响应', async () => {
  const dataDir = fresh();
  const { snapshot } = await d1({ dataDir });
  // 2026-10-22 是周四：所在周从 2026-10-18 周日 00:00 UTC（1792281600）起，第 4 格。
  assert.deepEqual(snapshot.bucket, { week: 1792281600, dayIndex: 4 });
  for (const e of snapshot.entries) {
    const history = readFileSync(join(dataDir, e.evidence.history.path));
    assert.equal(sha256(history), e.evidence.history.sha256);
    assert.match(e.evidence.history.url, /^https:\/\/api\.github\.com\/.+\/stargazers\/history\?per_page=6$/);
    assert.equal(JSON.parse(history).find((w) => w.week === 1792281600).days[4], e.gain);
    const project = readFileSync(join(dataDir, e.evidence.project.path));
    assert.equal(sha256(project), e.evidence.project.sha256);
    assert.equal(JSON.parse(project).stargazers_count, e.total);
  }
});

test('同一统计日重跑不覆盖已发布的快照，也不再请求上游', async () => {
  const dataDir = fresh();
  const first = await rankDay({ day, dataDir, fetch: recordedUpstream().fetch, token: 't', now, sleep: noSleep, windows: ['d1', 'd7'], lists: [] });
  assert.equal(first.windows.d1.status, 'published');
  const before = readFileSync(join(dataDir, first.windows.d1.path));
  const again = recordedUpstream();
  const second = await rankDay({ day, dataDir, fetch: again.fetch, token: 't', now: () => new Date('2026-10-23T09:10:00Z'), sleep: noSleep, windows: ['d1'], lists: [] });
  assert.equal(second.windows.d1.status, 'exists');
  assert.equal(second.windows.d1.path, first.windows.d1.path);
  assert.deepEqual(readFileSync(join(dataDir, first.windows.d1.path)), before);
  assert.equal(again.calls.length, 0);
});

test('候选来自全站事件和官方热门日榜；事件计数只用来找候选和自检，每个项目的记录次数不进快照', async () => {
  const upstream = recordedUpstream();
  const { snapshot } = await d1({ upstream });
  // 事件数据里 15 个项目（含 php/php-src 用旧名出现的一次），热门日榜 9 个，按项目 id 去重后 23 个。
  assert.deepEqual(snapshot.candidates, { total: 23, verified: 23, archive: 15, trending: 9, fallbackHours: [], backfilledDays: [], unavailable: [], failed: [] });
  assert.deepEqual(snapshot.requests, { history: 23, project: 21, graphql: 1 });
  assert.equal(upstream.calls.filter((c) => c.url.startsWith('https://data.gharchive.org/2026-10-22-')).length, 24);
  assert.equal(upstream.calls.filter((c) => c.url.startsWith('https://play.clickhouse.com/')).length, 0);
  for (const e of snapshot.entries) assert.deepEqual(Object.keys(e), ['rank', 'projectId', 'fullName', 'gain', 'total', 'evidence']);
  assert.equal(snapshot.entries.filter((e) => e.projectId === 1903522).length, 1);
  assert.ok(!JSON.stringify(snapshot).includes('events'));
});

test('某小时 GH Archive 缺失时，用 ClickHouse 公开库补这一小时的候选', async () => {
  const upstream = recordedUpstream({ missingArchiveHours: [5] });
  const { snapshot } = await d1({ upstream });
  assert.deepEqual(snapshot.candidates.fallbackHours, [5]);
  assert.equal(snapshot.candidates.total, 24);
  const ch = upstream.calls.filter((c) => c.url.startsWith('https://play.clickhouse.com/'));
  assert.equal(ch.length, 1);
  assert.match(ch[0].body, /'2026-10-22 05:00:00'/);
  // ClickHouse 只给项目名：按名字读官方星数历史；只有上榜才再读项目信息拿 id。
  assert.ok(upstream.calls.some((c) => c.url === 'https://api.github.com/repos/star-history/star-history/stargazers/history?per_page=6'));
});

test('统计日还没结束时拒绝出榜，不请求上游', async () => {
  const upstream = recordedUpstream();
  await assert.rejects(rankDay({ day: '2026-10-23', dataDir: fresh(), fetch: upstream.fetch, token: 't', now }), /还没结束/);
  assert.equal(upstream.calls.length, 0);
});

test('数据源中断时按更新失败处理，不写快照，失败原因记下来', async () => {
  const dataDir = fresh();
  const r = await d1({ dataDir, upstream: recordedUpstream({ failing: [/github\.com\/trending/] }) });
  assert.equal(r.status, 'failed');
  assert.match(r.error, /热门日榜/);
  assert.equal(readLatestSnapshot(dataDir), null);
  assert.equal(readStatus(dataDir).boards.d1.status, 'failed');
});

test('官方星数历史里缺统计日那一周、全部候选都核不了时不发布（缺失不补零）', async () => {
  const dataDir = fresh();
  const r = await d1({ dataDir, day: '2026-09-01' });
  assert.equal(r.status, 'failed');
  assert.match(r.error, /缺统计日 2026-09-01 那一周/);
  assert.equal(readLatestSnapshot(dataDir), null);
});

test('统计日那天还不存在的新项目当天新增就是 0，不算缺失', async () => {
  const r = await d1({ day: '2026-10-08' });
  assert.equal(r.status, 'published');
  assert.equal(r.snapshot.entries.length, 8);
  assert.ok(!r.snapshot.entries.some((e) => e.fullName === 'DietrichGebert/ponytail'));
  assert.equal(r.snapshot.candidates.failed.length, 0);
});

test('某小时 GH Archive 缺失、ClickHouse 也没有数据时不发布', async () => {
  const dataDir = fresh();
  const r = await d1({ dataDir, upstream: recordedUpstream({ missingArchiveHours: [7] }) });
  assert.equal(r.status, 'failed');
  assert.match(r.error, /第 7 小时/);
  assert.equal(readLatestSnapshot(dataDir), null);
});

test('上榜项目的项目信息读不到时不发布', async () => {
  const dataDir = fresh();
  const r = await d1({ dataDir, upstream: recordedUpstream({ notFound: [/\/repositories\/1903522$/] }) });
  assert.equal(r.status, 'failed');
  assert.match(r.error, /php\/php-src 的项目信息/);
  assert.equal(readLatestSnapshot(dataDir), null);
});

test('官方接口查不到的候选记进快照，不悄悄丢掉', async () => {
  const { status, snapshot } = await d1({ upstream: recordedUpstream({ notFound: [/\/repositories\/1241364151\/stargazers/] }) });
  assert.equal(status, 'published');
  assert.deepEqual(snapshot.candidates.unavailable, ['nicholasx417/WinNative-Components']);
  assert.ok(!snapshot.entries.some((e) => e.fullName === 'nicholasx417/WinNative-Components'));
});

test('小时文件下载到一半断开时，不崩溃，改用 ClickHouse 补这一小时', async () => {
  const { status, snapshot } = await d1({ upstream: recordedUpstream({ brokenArchiveHours: [5] }) });
  assert.equal(status, 'published');
  assert.deepEqual(snapshot.candidates.fallbackHours, [5]);
  assert.equal(snapshot.candidates.total, 24);
});

// ---- #3：近 7/30 天、每日自检、更新失败 ----

const sumDays = (id, days) => {
  const weeks = fixture(`history/${id}.json`);
  return days.reduce((s, d) => {
    const t = Date.parse(`${d}T00:00:00Z`) / 1000;
    const i = new Date(t * 1000).getUTCDay();
    return s + (weeks.find((w) => w.week === t - i * 86400)?.days[i] ?? 0);
  }, 0);
};

test('近 7、30 天按统计日累计官方新增；更早的日子从 ClickHouse 按天补候选', async () => {
  const dataDir = fresh();
  const upstream = recordedUpstream({ clickhouseDayRows: [{ repo_name: 'star-history/star-history', stars: 1 }] });
  const r = await rankDay({ day, dataDir, fetch: upstream.fetch, token: 't', now, sleep: noSleep, lists: [] });
  const d7 = r.windows.d7.snapshot;
  const d30 = r.windows.d30.snapshot;
  assert.equal(d7.from, '2026-10-16');
  assert.equal(d30.from, '2026-09-23');
  assert.deepEqual(d7.candidates.backfilledDays, ['2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21']);
  assert.equal(d30.candidates.backfilledDays.length, 29);
  const week = ['2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22'];
  assert.equal(d7.entries.find((e) => e.projectId === 1903522).gain, sumDays('1903522', week));
  assert.equal(d7.entries.find((e) => e.projectId === 1903522).gain, 13027);
  // ponytail 只有最近 2 周的历史（新建项目），更早的日子按 0 算。
  const month = Array.from({ length: 30 }, (_, i) => new Date(Date.parse('2026-09-23T00:00:00Z') + i * 86400e3).toISOString().slice(0, 10));
  assert.equal(d30.entries.find((e) => e.projectId === 1266797999).gain, sumDays('1266797999', month));
  // 同一次运行里每个候选只读一次官方星数历史，三个窗口共用；当天的 GH Archive 也只下载一遍。
  const historyCalls = upstream.calls.filter((c) => c.url.includes('/stargazers/history'));
  assert.equal(new Set(historyCalls.map((c) => c.url)).size, historyCalls.length);
  assert.equal(upstream.calls.filter((c) => c.url.startsWith('https://data.gharchive.org/')).length, 24);
  assert.equal(upstream.calls.filter((c) => String(c.body).includes('INTERVAL 1 DAY')).length, 29);
  assert.ok(existsSync(join(dataDir, 'events', '2026-09-23.json')));
});

test('自检通过：事件记录够多，候选门槛下的漏失概率小于百分之一，不标注', async () => {
  const dataDir = fresh();
  seedEvents(dataDir, day, halfRecorded());
  const { snapshot } = await d1({ dataDir });
  assert.equal(snapshot.check.passed, true);
  assert.ok(snapshot.check.missProbability < 0.01);
  assert.equal(snapshot.check.recordRatio, 0.5);
  assert.equal(snapshot.check.expectedRecords, 60); // 50% × 第 20 名的 120
  assert.equal(snapshot.incomplete, false);
});

test('自检不通过：先降低候选门槛、补核新进的候选，再排名自检', async () => {
  const dataDir = fresh();
  seedEvents(dataDir, day, halfRecorded());
  const upstream = recordedUpstream();
  // 候选先只取事件记录前 5 名：门槛 750 次，远高于第 20 名应有的约 60 次。
  const { snapshot } = await d1({ dataDir, upstream, limit: 5 });
  assert.equal(snapshot.check.passed, true);
  assert.ok(snapshot.check.threshold > 1 && snapshot.check.threshold < 60);
  assert.equal(snapshot.entries.length, 21);
  assert.equal(snapshot.candidates.total, 22);
  // 扩大候选时已核过的不再请求。
  assert.equal(snapshot.requests.history, 22);
  assert.equal(new Set(upstream.calls.map((c) => c.url + (c.body ?? ''))).size, upstream.calls.length);
});

test('候选扩到当天全部有记录的项目仍不通过：标“可能不完整”，写出漏失概率', async () => {
  const { snapshot } = await d1();
  assert.equal(snapshot.check.passed, false);
  assert.equal(snapshot.check.threshold, 1);
  assert.ok(snapshot.check.missProbability >= 0.01);
  assert.equal(snapshot.incomplete, true);
});

test('候选到上限仍不通过就停下，如实标注“可能不完整”', async () => {
  const dataDir = fresh();
  seedEvents(dataDir, day, halfRecorded());
  // 事件记录第 9 名是 435 次：上限 8 个时门槛最低只能降到 436。
  const { snapshot } = await d1({ dataDir, limit: 5, maxCandidates: 8 });
  assert.equal(snapshot.check.threshold, 436);
  assert.equal(snapshot.candidates.archive, 8);
  assert.equal(snapshot.check.passed, false);
  assert.equal(snapshot.incomplete, true);
});

test('任何一个官方核数失败（重试后仍失败）：照样发布，标“可能不完整”', async () => {
  const dataDir = fresh();
  seedEvents(dataDir, day, halfRecorded());
  const { status, snapshot } = await d1({ dataDir, upstream: recordedUpstream({ failing: [/\/repositories\/1241364151\/stargazers/] }) });
  assert.equal(status, 'published');
  assert.equal(snapshot.check.passed, true);
  assert.equal(snapshot.candidates.failed.length, 1);
  assert.equal(snapshot.candidates.failed[0].name, 'nicholasx417/WinNative-Components');
  assert.match(snapshot.candidates.failed[0].reason, /503/);
  assert.equal(snapshot.incomplete, true);
  assert.ok(!snapshot.entries.some((e) => e.fullName === 'nicholasx417/WinNative-Components'));
  assert.equal(snapshot.candidates.total, 24);
  assert.equal(snapshot.requests.history, 24 + 2); // 失败的那个重试了 2 次
});

test('大面积核数失败按更新失败处理，不发布', async () => {
  const dataDir = fresh();
  const r = await d1({ dataDir, upstream: recordedUpstream({ failing: [/\/repositories\/(1241364151|1200597263)\/stargazers/] }) });
  assert.equal(r.status, 'failed');
  assert.match(r.error, /23 个候选里 2 个核数失败/);
  assert.equal(readLatestSnapshot(dataDir), null);
});

test('更新失败时保留上一次快照；重跑更早的日子不盖掉这条失败记录', async () => {
  const dataDir = fresh();
  const earlier = await d1({ dataDir, day: '2026-10-08' });
  assert.equal(earlier.status, 'published');
  const before = readFileSync(join(dataDir, earlier.path));

  const failed = await d1({ dataDir, upstream: recordedUpstream({ failing: [/github\.com\/trending/] }) });
  assert.equal(failed.status, 'failed');
  assert.deepEqual(readFileSync(join(dataDir, earlier.path)), before);
  assert.equal(readLatestSnapshot(dataDir).statDay, '2026-10-08');
  assert.deepEqual(readStatus(dataDir).boards.d1, { day, at: now().toISOString(), status: 'failed', error: failed.error });

  assert.equal((await d1({ dataDir, day: '2026-10-08' })).status, 'exists');
  assert.equal(readStatus(dataDir).boards.d1.day, day);
});

test('近 7 天合并多天事件：ClickHouse 补的日子没有项目 id，按名字并进同一项目，不丢前几天的记录', async () => {
  const week = ['2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21'];
  const run = async (earlier) => {
    const dataDir = fresh();
    for (const d of week) seedEvents(dataDir, d, []);
    seedEvents(dataDir, '2026-10-21', earlier);
    seedEvents(dataDir, day, halfRecorded());
    const r = await rankDay({ day, dataDir, fetch: recordedUpstream().fetch, token: 't', now, sleep: noSleep, windows: ['d7'], lists: [] });
    return r.windows.d7.snapshot;
  };
  const withIds = await run(halfRecorded());
  const nameOnly = await run(halfRecorded().map((r) => ({ ...r, id: null })));
  const lastDayOnly = await run([]);
  assert.equal(nameOnly.check.recordRatio, withIds.check.recordRatio);
  assert.equal(nameOnly.candidates.total, withIds.candidates.total);
  assert.ok(nameOnly.check.recordRatio > lastDayOnly.check.recordRatio);
});

test('每期另存全部已核数的候选：按涨星排，带描述、topics、当前总 Star，能追溯到官方原始响应，不含记录次数', async () => {
  const dataDir = fresh();
  const { snapshot } = await d1({ dataDir });
  const file = readCandidates(dataDir, 'd1', day);
  assert.equal(file.items.length, 23);
  assert.equal(snapshot.candidates.verified, 23);
  assert.deepEqual(file.items.map((x) => x.gain), [...file.items.map((x) => x.gain)].sort((a, b) => b - a));
  const php = file.items[0];
  assert.deepEqual({ ...php, evidence: undefined }, { id: 1903522, fullName: 'php/php-src', gain: 5200, total: 41490, description: 'The PHP Interpreter', topics: [], evidence: undefined });
  assert.equal(JSON.parse(readFileSync(join(dataDir, php.evidence.history))).find((w) => w.week === 1792281600).days[4], 5200);
  assert.ok(JSON.parse(readFileSync(join(dataDir, php.evidence.meta))).data);
  assert.deepEqual(file.check, { threshold: snapshot.check.threshold, recordRatio: snapshot.check.recordRatio, completenessFloor: snapshot.check.completenessFloor });
  assert.equal(snapshot.check.completenessFloor, completenessFloor(snapshot.check));
  assert.ok(!JSON.stringify(file).includes('records') && !JSON.stringify(file).includes('"events"'));
  // 同一统计日重跑不重写。
  const before = readFileSync(join(dataDir, 'candidates', 'd1', `${day}.json`));
  await d1({ dataDir });
  assert.deepEqual(readFileSync(join(dataDir, 'candidates', 'd1', `${day}.json`)), before);
});

test('取候选资料失败不影响出榜：候选照存，描述、topics、总 Star 记为 null', async () => {
  const dataDir = fresh();
  const r = await d1({ dataDir, upstream: recordedUpstream({ failing: [/api\.github\.com\/graphql$/] }) });
  assert.equal(r.status, 'published');
  const file = readCandidates(dataDir, 'd1', day);
  assert.equal(file.items.length, 23);
  assert.deepEqual(file.meta, { found: 0, missing: 23 });
  assert.deepEqual({ total: file.items[0].total, description: file.items[0].description, topics: file.items[0].topics, meta: file.items[0].evidence.meta }, { total: null, description: null, topics: null, meta: null });
});

test('近 1、7、30 天共用一次运行取到的资料：每个候选只查一次', async () => {
  const dataDir = fresh();
  const upstream = recordedUpstream({ clickhouseDayRows: [{ repo_name: 'star-history/star-history', stars: 1 }] });
  const r = await rankDay({ day, dataDir, fetch: upstream.fetch, token: 't', now, sleep: noSleep, lists: [] });
  const queries = upstream.calls.filter((c) => c.url === 'https://api.github.com/graphql').map((c) => JSON.parse(c.body).query);
  const names = queries.flatMap((q) => [...q.matchAll(/repository\(owner: "([^"]+)", name: "([^"]+)"\)/g)].map((m) => `${m[1]}/${m[2]}`.toLowerCase()));
  assert.equal(new Set(names).size, names.length);
  assert.equal(queries.length, Object.values(r.windows).reduce((s, w) => s + w.snapshot.requests.graphql, 0));
  for (const w of ['d7', 'd30']) assert.equal(readCandidates(dataDir, w, day).items.length, r.windows[w].snapshot.candidates.verified);
});
