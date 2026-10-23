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
    const repo = readFileSync(join(dataDir, e.evidence.repo.path));
    assert.equal(sha256(repo), e.evidence.repo.sha256);
    assert.equal(JSON.parse(repo).stargazers_count, e.total);
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
  assert.deepEqual(snapshot.candidates, { total: 23, archive: 14, trending: 9, fallbackHours: [] });
  assert.deepEqual(snapshot.requests, { history: 23, repo: 21 });
  assert.equal(calls.filter((c) => c.url.startsWith('https://data.gharchive.org/2026-10-22-')).length, 24);
  assert.equal(calls.filter((c) => c.url.startsWith('https://play.clickhouse.com/')).length, 0);
  for (const e of snapshot.entries) assert.deepEqual(Object.keys(e), ['rank', 'repoId', 'fullName', 'gain', 'total', 'evidence']);
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
  assert.ok(calls.some((c) => c.url === 'https://api.github.com/repos/star-history/star-history/stargazers/history?per_page=6'));
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
