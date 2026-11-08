// 统计日 = GitHub 统计日（美国太平洋时间）：日界、最近一个已结束的统计日、每天要读的 UTC 小时（#83，ADR 0001 的 2026-11-08 补充）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastEndedDay, dayRange, dayHours, bucketOf, windowDays, pacificDay } from '../src/ranking/stat-day.js';

const at = (iso) => new Date(iso);
const iso = (ms) => new Date(ms).toISOString();

test('冬令时：太平洋零点是 08:00Z（北京 16:00），07:59Z 还算前一天没过完', () => {
  assert.equal(lastEndedDay(at('2026-11-09T07:59:00Z')), '2026-11-07');
  assert.equal(lastEndedDay(at('2026-11-09T08:00:00Z')), '2026-11-08');
  // 原来北京 10:00（02:00Z）出"昨天"的榜，那天其实还没过完。
  assert.equal(lastEndedDay(at('2026-11-09T02:00:00Z')), '2026-11-07');
  assert.equal(lastEndedDay(at('2026-11-09T10:00:00Z')), '2026-11-08');
});

test('夏令时：太平洋零点是 07:00Z（北京 15:00），06:59Z 还算前一天没过完', () => {
  assert.equal(lastEndedDay(at('2026-10-23T06:59:00Z')), '2026-10-21');
  assert.equal(lastEndedDay(at('2026-10-23T07:00:00Z')), '2026-10-22');
});

test('跨月、跨年按太平洋日期退一天', () => {
  assert.equal(lastEndedDay(at('2027-01-01T08:00:00Z')), '2026-12-31');
  assert.equal(lastEndedDay(at('2027-01-01T07:59:00Z')), '2026-12-30');
  assert.equal(lastEndedDay(at('2026-12-01T08:00:00Z')), '2026-11-30');
});

test('冬令时切回那天（2026-11-01）有 25 个小时：UTC 07:00 至次日 08:00', () => {
  const { from, to } = dayRange('2026-11-01');
  assert.deepEqual([iso(from), iso(to)], ['2026-11-01T07:00:00.000Z', '2026-11-02T08:00:00.000Z']);
  const hours = dayHours('2026-11-01');
  assert.equal(hours.length, 25);
  assert.deepEqual([hours[0], hours.at(-1)], [{ date: '2026-11-01', hour: 7 }, { date: '2026-11-02', hour: 7 }]);
  assert.equal(lastEndedDay(at('2026-11-02T07:59:00Z')), '2026-10-31');
  assert.equal(lastEndedDay(at('2026-11-02T08:00:00Z')), '2026-11-01');
  // 前一天（夏令时最后一天）照旧 07:00 结束。
  assert.equal(lastEndedDay(at('2026-11-01T06:59:00Z')), '2026-10-30');
  assert.equal(lastEndedDay(at('2026-11-01T07:00:00Z')), '2026-10-31');
});

test('夏令时开始那天（2027-03-14）只有 23 个小时：UTC 08:00 至次日 07:00', () => {
  const { from, to } = dayRange('2027-03-14');
  assert.deepEqual([iso(from), iso(to)], ['2027-03-14T08:00:00.000Z', '2027-03-15T07:00:00.000Z']);
  assert.equal(dayHours('2027-03-14').length, 23);
  assert.equal(lastEndedDay(at('2027-03-15T06:59:00Z')), '2027-03-13');
  assert.equal(lastEndedDay(at('2027-03-15T07:00:00Z')), '2027-03-14');
});

test('平常的日子读 24 个 UTC 小时：冬令时 D 08 时至 D+1 07 时，夏令时 D 07 时至 D+1 06 时', () => {
  const winter = dayHours('2026-11-07');
  assert.equal(winter.length, 24);
  assert.deepEqual([winter[0], winter[15], winter[16], winter.at(-1)], [
    { date: '2026-11-07', hour: 8 }, { date: '2026-11-07', hour: 23 }, { date: '2026-11-08', hour: 0 }, { date: '2026-11-08', hour: 7 },
  ]);
  const summer = dayHours('2026-10-22');
  assert.equal(summer.length, 24);
  assert.deepEqual([summer[0], summer.at(-1)], [{ date: '2026-10-22', hour: 7 }, { date: '2026-10-23', hour: 6 }]);
});

test('第几周第几格按日期换算，不受时区影响；近 N 天窗口跨切换日也是逐日', () => {
  assert.deepEqual(bucketOf('2026-11-07'), { week: Date.parse('2026-11-01T00:00:00Z') / 1000, dayIndex: 6 });
  assert.deepEqual(bucketOf('2026-11-08'), { week: Date.parse('2026-11-08T00:00:00Z') / 1000, dayIndex: 0 });
  assert.deepEqual(windowDays('2026-11-02', 3), ['2026-10-31', '2026-11-01', '2026-11-02']);
  assert.equal(pacificDay(at('2026-11-08T07:59:59Z')), '2026-11-07');
  assert.throws(() => dayRange('2026-13-01'), /统计日格式/);
});
