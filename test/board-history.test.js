// #24 历史榜：一次官方搜索取全站前 100，存当天快照；失败保留上一次快照并写明失败的日期。网络全部模拟。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { githubClient } from '../src/ranking/github.js';
import { updateHistory, readHistoryBoard, parseHistory, SEARCH_NOTE } from '../src/boards/index.js';

const item = (n) => ({ id: 1000 + n, full_name: `o${n}/r${n}`, owner: { id: 50 + n }, stargazers_count: 500_000 - n * 100, description: `项目 ${n}`, language: n % 2 ? 'Go' : null, topics: ['t'], pushed_at: '2026-11-02T00:00:00Z' });
const searchBody = (count = 120, extra = {}) => JSON.stringify({ total_count: 4321, incomplete_results: false, items: Array.from({ length: count }, (_, i) => item(i + 1)).reverse(), ...extra });

// 按顺序回给定的响应，记下请求的地址。
function fakeGh(responses) {
  const urls = [];
  const fetch = async (url) => {
    urls.push(url);
    const r = responses.shift();
    if (r instanceof Error) throw r;
    return new Response(r.body, { status: r.status ?? 200, headers: { date: 'Mon, 02 Nov 2026 02:00:00 GMT' } });
  };
  return { gh: githubClient({ fetch, token: 't', sleep: async () => {} }), urls };
}
const at = (iso) => () => new Date(iso);

test('解析：按总 Star 从高到低取前 100，带页面要的字段', () => {
  const { totalCount, entries } = parseHistory(searchBody());
  assert.equal(totalCount, 4321);
  assert.equal(entries.length, 100);
  assert.deepEqual(entries[0], { rank: 1, repo: 'o1/r1', id: 1001, ownerId: 51, total: 499_900, description: '项目 1', language: 'Go', topics: ['t'], pushedAt: '2026-11-02T00:00:00Z' });
  assert.equal(entries[99].repo, 'o100/r100');
  assert.equal(entries[1].language, null);
  assert.throws(() => parseHistory(searchBody(5, { incomplete_results: true })), /结果不全/);
  assert.throws(() => parseHistory('{"message":"x"}'), /没有 items/);
});

test('每天一次：存当天快照，网站读前 50；同一天重跑不再请求', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'gc-hist-'));
  const { gh, urls } = fakeGh([{ body: searchBody() }]);
  const r = await updateHistory({ dataDir, gh, now: at('2026-11-02T02:00:00Z') });
  assert.equal(r.status, 'published');
  assert.equal(r.path, join('snapshots', 'history', '2026-11-02.json'));
  assert.equal(r.requests, 1);
  assert.equal(urls.length, 1);
  assert.match(urls[0], /search\/repositories\?q=stars%3A%3E%3D10000%20fork%3Atrue&sort=stars&order=desc&per_page=100/);
  assert.equal(r.snapshot.entries.length, 100);
  assert.ok(existsSync(join(dataDir, r.snapshot.evidence.path)), '原始响应另存');

  const b = readHistoryBoard(dataDir);
  assert.deepEqual([b.day, b.fetchedAt, b.entries.length, b.entries[0].repo, b.failure, b.note], ['2026-11-02', '2026-11-02T02:00:00.000Z', 50, 'o1/r1', null, SEARCH_NOTE]);

  const again = await updateHistory({ dataDir, gh, now: at('2026-11-02T20:00:00Z') });
  assert.equal(again.status, 'exists');
  assert.equal(urls.length, 1, '同一天不再请求');
});

test('失败：保留上一次快照，写明失败的真实日期和原因；之后成功了提示消失', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'gc-hist-'));
  assert.equal(readHistoryBoard(dataDir), null, '还没有快照');
  const { gh } = fakeGh([{ body: searchBody() }, { status: 422, body: 'Validation Failed' }, { body: searchBody(5, { incomplete_results: true }) }, { body: searchBody() }]);
  await updateHistory({ dataDir, gh, now: at('2026-11-01T02:00:00Z') });

  const failed = await updateHistory({ dataDir, gh, now: at('2026-11-02T02:00:00Z') });
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /返回 422/);
  let b = readHistoryBoard(dataDir);
  assert.equal(b.day, '2026-11-01', '保留上一次快照');
  assert.equal(b.entries.length, 50);
  assert.deepEqual([b.failure.day, b.failure.at], ['2026-11-02', '2026-11-02T02:00:00.000Z']);
  assert.match(b.failure.error, /422/);

  // 搜索结果不全也不发布。
  const partial = await updateHistory({ dataDir, gh, now: at('2026-11-03T02:00:00Z') });
  assert.equal(partial.status, 'failed');
  assert.deepEqual(readdirSync(join(dataDir, 'snapshots', 'history')), ['2026-11-01.json']);
  assert.equal(readHistoryBoard(dataDir).failure.day, '2026-11-03');

  await updateHistory({ dataDir, gh, now: at('2026-11-04T02:00:00Z') });
  b = readHistoryBoard(dataDir);
  assert.deepEqual([b.day, b.failure], ['2026-11-04', null]);
});

test('第一次就失败：没有快照也给出失败信息', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'gc-hist-'));
  const { gh } = fakeGh([new Error('boom'), new Error('boom'), new Error('boom')]);
  const r = await updateHistory({ dataDir, gh, now: at('2026-11-02T02:00:00Z') });
  assert.equal(r.status, 'failed');
  const b = readHistoryBoard(dataDir);
  assert.deepEqual([b.day, b.entries, b.failure.day], [null, [], '2026-11-02']);
});
