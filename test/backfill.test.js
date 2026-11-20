// #103 回补缺期：出完最近一期，再把前 5 个统计日里涨星榜缺的期次补出来；回补失败不算出榜失败；健康检查报缺期。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKFILL_DAYS, missingDays, rankWithBackfill } from '../src/ranking/index.js';
import { healthProblems } from '../src/remote/health.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'gc-backfill-'));
const snap = (dir, w, ...days) => {
  mkdirSync(join(dir, 'snapshots', w), { recursive: true });
  for (const d of days) writeFileSync(join(dir, 'snapshots', w, `${d}.json`), JSON.stringify({ window: w, statDay: d, entries: [] }));
};
const span = (from, to) => {
  const out = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += 86400e3) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};

test('缺期：最近一期之前的 5 个统计日里没有快照的窗口，新的在前；最近一期自己不算', () => {
  assert.equal(BACKFILL_DAYS, 5);
  const dir = tmp();
  const all = span('2026-11-01', '2026-11-22');
  snap(dir, 'd1', ...all.filter((d) => d !== '2026-11-15' && d !== '2026-11-17'));
  snap(dir, 'd7', ...all.filter((d) => d !== '2026-11-15'));
  snap(dir, 'd30', ...all);
  assert.deepEqual(missingDays(dir, '2026-11-19'), [
    { day: '2026-11-17', windows: ['d1'] },
    { day: '2026-11-15', windows: ['d1', 'd7'] },
  ]);
  // 最近一期还没出（正要出）时，它不在缺期里：缺期只看它之前的日子。
  assert.deepEqual(missingDays(dir, '2026-11-20').map((g) => g.day), ['2026-11-17', '2026-11-15']);
  // 超出 5 天的不补：官方星数历史只给 6 周，近 30 天榜最坏只能补 6 天内的。
  assert.deepEqual(missingDays(dir, '2026-11-23').map((g) => g.day), []);
  assert.deepEqual(missingDays(dir, '2026-11-22').map((g) => g.day), ['2026-11-17']);
});

test('缺期：都齐就是空；从没出过榜、或那个窗口第一期之前的日子不算（只补两期之间的洞）', () => {
  const dir = tmp();
  assert.deepEqual(missingDays(dir, '2026-11-19'), []);
  // 全新的数据目录第一次出榜之后：前几天没有快照，但之前也没出过，不补。
  for (const w of ['d1', 'd7', 'd30']) snap(dir, w, '2026-11-19');
  assert.deepEqual(missingDays(dir, '2026-11-20'), []);
  // d1 从 11-16 起出，d7 从 11-18 起出：11-17 只算 d1 的洞。
  snap(dir, 'd1', '2026-11-16', '2026-11-18');
  snap(dir, 'd7', '2026-11-18');
  snap(dir, 'd30', '2026-11-18', '2026-11-17', '2026-11-16', '2026-11-15');
  assert.deepEqual(missingDays(dir, '2026-11-19'), [{ day: '2026-11-17', windows: ['d1'] }]);
});

test('出榜带回补：先出最近一期，再按新到旧补缺期，只补缺的窗口；回补失败不算出榜失败', async () => {
  const dir = tmp();
  const all = span('2026-11-10', '2026-11-18');
  for (const w of ['d1', 'd7', 'd30']) snap(dir, w, ...all.filter((d) => d !== '2026-11-15' && d !== '2026-11-17'));
  snap(dir, 'd30', '2026-11-17');
  const calls = [];
  const rankOne = async (day, opts) => {
    calls.push([day, opts]);
    return { failed: day === '2026-11-15' };
  };
  const r = await rankWithBackfill({ dataDir: dir, day: '2026-11-19', rankOne });
  assert.deepEqual(calls, [
    ['2026-11-19', {}],
    ['2026-11-17', { windows: ['d1', 'd7'], backfill: true }],
    ['2026-11-15', { windows: ['d1', 'd7', 'd30'], backfill: true }],
  ]);
  assert.deepEqual(r, { failed: false, backfilled: [{ day: '2026-11-17', windows: ['d1', 'd7'], failed: false }, { day: '2026-11-15', windows: ['d1', 'd7', 'd30'], failed: true }] });
});

test('出榜带回补：最近一期没出成就不回补（上游多半有问题，不再加码），退出照旧算失败；点名日期的手动出榜不回补；没缺期只跑一次', async () => {
  const dir = tmp();
  for (const w of ['d1', 'd7', 'd30']) snap(dir, w, '2026-11-14', '2026-11-16', '2026-11-18');
  const calls = [];
  const failing = async (day, opts) => (calls.push([day, opts]), { failed: true });
  assert.deepEqual(await rankWithBackfill({ dataDir: dir, day: '2026-11-19', rankOne: failing }), { failed: true, backfilled: [] });
  assert.deepEqual(calls, [['2026-11-19', {}]]);

  calls.length = 0;
  const fine = async (day, opts) => (calls.push([day, opts]), { failed: false });
  // 没有缺期：只出最近一期这一次，不多跑。
  const full = tmp();
  for (const w of ['d1', 'd7', 'd30']) snap(full, w, ...span('2026-11-10', '2026-11-18'));
  assert.deepEqual(await rankWithBackfill({ dataDir: full, day: '2026-11-19', rankOne: fine }), { failed: false, backfilled: [] });
  assert.deepEqual(calls, [['2026-11-19', {}]]);
  calls.length = 0;
  assert.deepEqual(await rankWithBackfill({ dataDir: dir, day: '2026-11-17', explicit: true, rankOne: fine }), { failed: false, backfilled: [] });
  assert.deepEqual(calls, [['2026-11-17', {}]]);
});

test('健康检查：前 5 天有缺期就说缺哪几期，没有就不说；每日更新关着也不说', () => {
  const settings = { daily: { on: true, at: '18:00' } };
  const now = new Date('2026-11-20T01:50:00Z'); // 北京时间 09:50
  const ok = { run: { startedAt: '2026-11-19T10:00:00Z', endedAt: '2026-11-19T10:15:00Z', failed: [], running: false }, settings, remote: false, server: null, backups: [], now };
  assert.deepEqual(healthProblems(ok), []);
  assert.deepEqual(healthProblems({ ...ok, gaps: [] }), []);
  assert.deepEqual(healthProblems({ ...ok, gaps: [{ day: '2026-11-17', windows: ['d1'] }, { day: '2026-11-15', windows: ['d1', 'd7', 'd30'] }] }), [
    '涨星榜缺 2 期：11-17（近 1 天）、11-15（近 1、7、30 天）。每日更新出完最近一期后会自动回补；连着几天还缺，看 data/logs/update.log 里「回补」的报错。',
  ]);
  // 每日更新关着：不会回补，缺期一直在，不天天报同一句。
  assert.deepEqual(healthProblems({ ...ok, settings: { daily: { on: false, at: '18:00' } }, gaps: [{ day: '2026-11-17', windows: ['d1'] }] }), []);
});
