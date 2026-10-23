// 接缝 1：出榜管线。上游全部来自录制数据，不访问网络。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rankDay, readLatestSnapshot } from '../src/ranking/index.js';
import { recordedUpstream } from './helpers/recorded-upstream.js';

const day = '2026-10-22';
const now = () => new Date('2026-10-23T08:40:00Z');
const fresh = () => mkdtempSync(join(tmpdir(), 'gc-rank-'));
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

test('近 1 天榜单取前 20，末位并列一起上榜，同分同名次', async () => {
  const { fetch } = recordedUpstream();
  const { snapshot } = await rankDay({ day, dataDir: fresh(), fetch, token: 't', now });
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
});

test('每个上榜数字都能追溯到保存的官方原始响应', async () => {
  const dataDir = fresh();
  const { fetch } = recordedUpstream();
  const { snapshot } = await rankDay({ day, dataDir, fetch, token: 't', now });
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
  const first = await rankDay({ day, dataDir, fetch: recordedUpstream().fetch, token: 't', now });
  assert.equal(first.status, 'published');
  const before = readFileSync(join(dataDir, first.path));
  const again = recordedUpstream();
  const second = await rankDay({ day, dataDir, fetch: again.fetch, token: 't', now: () => new Date('2026-10-23T09:10:00Z') });
  assert.equal(second.status, 'exists');
  assert.equal(second.path, first.path);
  assert.deepEqual(readFileSync(join(dataDir, first.path)), before);
  assert.equal(again.calls.length, 0);
});

test('候选来自全站事件和官方热门日榜，事件计数只用来找候选、不进快照', async () => {
  const { fetch, calls } = recordedUpstream();
  const { snapshot } = await rankDay({ day, dataDir: fresh(), fetch, token: 't', now });
  // 事件数据里 15 个项目（含 php/php-src 用旧名出现的一次），热门日榜 9 个，按项目 id 去重后 23 个。
  assert.deepEqual(snapshot.candidates, { total: 23, archive: 15, trending: 9, fallbackHours: [], unavailable: [] });
  assert.deepEqual(snapshot.requests, { history: 23, project: 21 });
  assert.equal(calls.filter((c) => c.url.startsWith('https://data.gharchive.org/2026-10-22-')).length, 24);
  assert.equal(calls.filter((c) => c.url.startsWith('https://play.clickhouse.com/')).length, 0);
  for (const e of snapshot.entries) assert.deepEqual(Object.keys(e), ['rank', 'projectId', 'fullName', 'gain', 'total', 'evidence']);
  assert.equal(snapshot.entries.filter((e) => e.projectId === 1903522).length, 1);
  assert.ok(!JSON.stringify(snapshot).includes('events'));
});

test('某小时 GH Archive 缺失时，用 ClickHouse 公开库补这一小时的候选', async () => {
  const { fetch, calls } = recordedUpstream({ missingArchiveHours: [5] });
  const { snapshot } = await rankDay({ day, dataDir: fresh(), fetch, token: 't', now });
  assert.deepEqual(snapshot.candidates.fallbackHours, [5]);
  assert.equal(snapshot.candidates.total, 24);
  const ch = calls.filter((c) => c.url.startsWith('https://play.clickhouse.com/'));
  assert.equal(ch.length, 1);
  assert.match(ch[0].body, /'2026-10-22 05:00:00'/);
  // ClickHouse 只给项目名：先读一次项目信息拿到 id，再按 id 读官方星数历史。
  assert.ok(calls.some((c) => c.url === 'https://api.github.com/repos/star-history/star-history'));
  assert.ok(calls.some((c) => c.url === 'https://api.github.com/repositories/42976210/stargazers/history?per_page=6'));
});

test('统计日还没结束时拒绝出榜，不请求上游', async () => {
  const { fetch, calls } = recordedUpstream();
  await assert.rejects(rankDay({ day: '2026-10-23', dataDir: fresh(), fetch, token: 't', now }), /还没结束/);
  assert.equal(calls.length, 0);
});

test('数据源中断时按更新失败处理，不写快照', async () => {
  const dataDir = fresh();
  const { fetch } = recordedUpstream({ failing: [/github\.com\/trending/] });
  await assert.rejects(rankDay({ day, dataDir, fetch, token: 't', now }), /热门日榜/);
  assert.equal(readLatestSnapshot(dataDir), null);
});

test('官方星数历史里缺统计日那一周时不发布（缺失不补零）', async () => {
  const dataDir = fresh();
  const { fetch } = recordedUpstream();
  await assert.rejects(rankDay({ day: '2026-09-01', dataDir, fetch, token: 't', now }), /缺统计日 2026-09-01 那一周/);
  assert.equal(readLatestSnapshot(dataDir), null);
});

test('统计日那天还不存在的新项目当天新增就是 0，不算缺失', async () => {
  const { fetch } = recordedUpstream();
  const r = await rankDay({ day: '2026-10-08', dataDir: fresh(), fetch, token: 't', now });
  assert.equal(r.status, 'published');
  assert.equal(r.snapshot.entries.length, 8);
  assert.ok(!r.snapshot.entries.some((e) => e.fullName === 'DietrichGebert/ponytail'));
});

test('某小时 GH Archive 缺失、ClickHouse 也没有数据时不发布', async () => {
  const dataDir = fresh();
  const { fetch } = recordedUpstream({ missingArchiveHours: [7] });
  await assert.rejects(rankDay({ day, dataDir, fetch, token: 't', now }), /第 7 小时/);
  assert.equal(readLatestSnapshot(dataDir), null);
});

test('上榜项目的项目信息读不到时不发布', async () => {
  const dataDir = fresh();
  const { fetch } = recordedUpstream({ notFound: [/\/repositories\/1903522$/] });
  await assert.rejects(rankDay({ day, dataDir, fetch, token: 't', now }), /php\/php-src 的项目信息/);
  assert.equal(readLatestSnapshot(dataDir), null);
});

test('官方接口查不到的候选记进快照，不悄悄丢掉', async () => {
  const { fetch } = recordedUpstream({ notFound: [/\/repositories\/1241364151\/stargazers/] });
  const { status, snapshot } = await rankDay({ day, dataDir: fresh(), fetch, token: 't', now });
  assert.equal(status, 'published');
  assert.deepEqual(snapshot.candidates.unavailable, ['nicholasx417/WinNative-Components']);
  assert.ok(!snapshot.entries.some((e) => e.fullName === 'nicholasx417/WinNative-Components'));
});

test('小时文件下载到一半断开时，不崩溃，改用 ClickHouse 补这一小时', async () => {
  const { fetch } = recordedUpstream({ brokenArchiveHours: [5] });
  const { status, snapshot } = await rankDay({ day, dataDir: fresh(), fetch, token: 't', now });
  assert.equal(status, 'published');
  assert.deepEqual(snapshot.candidates.fallbackHours, [5]);
  assert.equal(snapshot.candidates.total, 24);
});
