// 接缝 2：本机网站首页。首页只读快照和更新记录，访问时不调用外部接口。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { get } from 'node:http';
import { startServer } from '../src/web/server.js';

const fixture = new URL('./fixtures/snapshot-d1-2026-10-22.json', import.meta.url);
function dataDirWithSnapshot() {
  const dir = mkdtempSync(join(tmpdir(), 'gc-web-'));
  mkdirSync(join(dir, 'snapshots', 'd1'), { recursive: true });
  copyFileSync(fixture, join(dir, 'snapshots', 'd1', '2026-10-22.json'));
  return dir;
}
// 在 #2 的快照上补齐 #3 的字段，写成任意窗口的快照。
function writeSnapshot(dir, window, extra) {
  const base = JSON.parse(readFileSync(fixture, 'utf8'));
  const snapshot = {
    ...base,
    window,
    from: '2026-10-22',
    candidates: { ...base.candidates, backfilledDays: [], failed: [] },
    check: { passed: true, missProbability: 1e-9, threshold: 30, recordRatio: 0.01, expectedRecords: 60 },
    incomplete: false,
    ...extra,
  };
  mkdirSync(join(dir, 'snapshots', window), { recursive: true });
  writeFileSync(join(dir, 'snapshots', window, `${snapshot.statDay}.json`), JSON.stringify(snapshot));
}
const page = (url) => new Promise((resolve, reject) => {
  get(url, (res) => { let body = ''; res.setEncoding('utf8'); res.on('data', (c) => (body += c)); res.on('end', () => resolve({ status: res.statusCode, body })); }).on('error', reject);
});
async function visit(dataDir, path = '') {
  const { server, url } = await startServer({ dataDir, port: 0 });
  try {
    return await page(url + path);
  } finally {
    server.close();
  }
}

test('首页显示近 1 天榜单：名次、项目、当天新增、当前总 Star、统计日期、更新时间', async () => {
  const { status, body } = await visit(dataDirWithSnapshot());
  assert.equal(status, 200);
  assert.match(body, /统计日 2026-10-22（UTC）/);
  assert.match(body, /更新于 2026-10-23 16:40（北京时间）/);
  const rows = [...body.matchAll(/<tr><td>(\d+)<\/td><td><a href="https:\/\/github\.com\/([^"]+)">[^<]+<\/a><\/td><td>\+([\d,]+)<\/td><td>([\d,]+)<\/td><\/tr>/g)].map((m) => m.slice(1));
  assert.deepEqual(rows.slice(0, 7), [
    ['1', 'php/php-src', '5,200', '193,409'],
    ['2', 'anthropics/knowledge-work-plugins', '3,100', '115,709'],
    ['3', 'DietrichGebert/ponytail', '2,400', '89,809'],
    ['4', 'cloudflare/security-audit-skill', '1,800', '67,609'],
    ['5', 'Graphify-Labs/graphify', '1,500', '56,509'],
    ['5', 'nicholasx417/WinNative-Components', '1,500', '56,509'],
    ['7', 'GabrielTaiga/Taiga-Launcher-for-Steam', '1,200', '45,409'],
  ]);
  // 这份快照生成于自检上线之前，页面如实说明。
  assert.match(body, /没有做完整性自检/);
});

test('网站只监听本机地址', async () => {
  const { server } = await startServer({ dataDir: dataDirWithSnapshot(), port: 0 });
  try {
    assert.equal(server.address().address, '127.0.0.1');
  } finally {
    server.close();
  }
});

test('访问首页时不调用任何外部接口', async (t) => {
  const outbound = t.mock.method(globalThis, 'fetch', async () => { throw new Error('首页不应发外部请求'); });
  const { status } = await visit(dataDirWithSnapshot());
  assert.equal(status, 200);
  assert.equal(outbound.mock.callCount(), 0);
});

test('还没有任何快照时，首页如实说明', async () => {
  const { status, body } = await visit(mkdtempSync(join(tmpdir(), 'gc-web-')));
  assert.equal(status, 200);
  assert.match(body, /还没有近 1 天的榜单/);
});

test('可以切换近 7、30 天，页面写明统计到哪一天', async () => {
  const dir = dataDirWithSnapshot();
  writeSnapshot(dir, 'd7', { from: '2026-10-16' });
  writeSnapshot(dir, 'd30', { from: '2026-09-23' });
  const home = await visit(dir);
  assert.match(home.body, /<a href="\/\?w=d7">近 7 天<\/a>/);
  assert.match(home.body, /<a href="\/\?w=d30">近 30 天<\/a>/);
  const week = await visit(dir, '?w=d7');
  assert.equal(week.status, 200);
  assert.match(week.body, /统计到 2026-10-22（UTC），2026-10-16 至 2026-10-22/);
  assert.match(week.body, /<th>近 7 天新增 Star<\/th>/);
  assert.doesNotMatch(week.body, /可能不完整|没有做完整性自检/);
  const month = await visit(dir, '?w=d30');
  assert.match(month.body, /统计到 2026-10-22（UTC），2026-09-23 至 2026-10-22/);
  assert.equal((await visit(dir, '?w=d3')).status, 404);
});

test('自检不通过或有候选核数失败时，标“可能不完整”并写出漏失概率', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gc-web-'));
  writeSnapshot(dir, 'd1', {
    check: { passed: false, missProbability: 1.1e-4, threshold: 1, recordRatio: 0.011, expectedRecords: 9.1 },
    candidates: { total: 3900, archive: 3891, trending: 9, fallbackHours: [], backfilledDays: [], unavailable: [], failed: [{ name: 'a/b', reason: '503' }] },
    incomplete: true,
  });
  const { body } = await visit(dir);
  assert.match(body, /可能不完整：自检未通过，估计漏掉一个该上榜项目的概率约万分之 1\.1（要求小于百万分之一）；1 个候选的官方核数失败。/);
  // 事件记录次数和候选门槛只用于自检，不上页面。
  assert.doesNotMatch(body, /3891|门槛/);
});

test('更新失败时仍显示上一次的榜单，写明它的真实日期和失败原因', async () => {
  const dir = dataDirWithSnapshot();
  writeFileSync(join(dir, 'status.json'), JSON.stringify({ boards: { d1: { day: '2026-10-23', at: '2026-10-24T02:10:00.000Z', status: 'failed', error: '官方热门日榜返回 503' } } }));
  const { body } = await visit(dir);
  assert.match(body, /统计日 2026-10-23 的榜单更新失败：官方热门日榜返回 503。下面仍是统计日 2026-10-22 的榜单。/);
  assert.match(body, /统计日 2026-10-22（UTC）/);
  assert.match(body, /<a href="https:\/\/github\.com\/php\/php-src">/);
  // 失败的日子比当前快照旧（重跑更早的日子失败）时不提示。
  writeFileSync(join(dir, 'status.json'), JSON.stringify({ boards: { d1: { day: '2026-10-21', at: '2026-10-24T02:10:00.000Z', status: 'failed', error: 'x' } } }));
  assert.doesNotMatch((await visit(dir)).body, /更新失败/);
});
