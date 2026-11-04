// #48 健康检查：没问题不出声；每日更新太久没跑、卡住、有步骤失败，服务器连不上或网站没在跑，备份缺失或过旧，各说一句。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { healthProblems } from '../src/remote/health.js';

const settings = { daily: { on: true, at: '10:00' } };
// 北京时间 2026-11-04 09:50（UTC 01:50），猛鬼兽工程自检的时间。
const now = new Date('2026-11-04T01:50:00Z');
const run = (startedAt, extra = {}) => ({ startedAt, failed: [], running: false, endedAt: startedAt, ...extra });
const ok = { run: run('2026-11-03T02:00:00Z'), settings, remote: true, server: 'active', backups: ['center-2026-11-03.db', 'center-2026-11-02.db'], now };

test('昨天跑过、服务器在跑、备份是昨天的：什么都不说', () => {
  assert.deepEqual(healthProblems(ok), []);
  // 没配服务器时只看每日更新。
  assert.deepEqual(healthProblems({ ...ok, remote: false, server: null, backups: [] }), []);
  // 每日更新关掉了就不催。
  assert.deepEqual(healthProblems({ ...ok, run: run('2026-10-20T02:00:00Z'), settings: { daily: { on: false, at: '10:00' } } }), []);
});

test('每日更新太久没跑：到了更新时间再过 2 小时才要求今天跑过', () => {
  const stale = healthProblems({ ...ok, run: run('2026-11-01T02:05:00Z') });
  assert.deepEqual(stale, ['每日更新 3 天没跑了（最后一次 2026-11-01 10:05）：Mac 可能一直关机或睡着，网站上的数据停在那天。']);
  const noon = new Date('2026-11-04T03:30:00Z'); // 北京时间 11:30，不到 12:00
  assert.deepEqual(healthProblems({ ...ok, now: noon }), []);
  const late = new Date('2026-11-04T04:10:00Z'); // 北京时间 12:10
  assert.match(healthProblems({ ...ok, now: late })[0], /每日更新 1 天没跑了/);
  assert.equal(healthProblems({ ...ok, run: null })[0], '每日更新还没跑过（data/logs/update.log 里没有记录）。');
});

test('卡住和步骤失败', () => {
  const stuck = healthProblems({ ...ok, run: run('2026-11-03T22:00:00Z', { running: true, endedAt: undefined }) });
  assert.deepEqual(stuck, ['每日更新从 2026-11-04 06:00 开始，3 小时了还没结束，可能卡住了。']);
  assert.deepEqual(healthProblems({ ...ok, run: run('2026-11-04T01:00:00Z', { running: true }) }), [], '刚开始跑不算卡住');
  const failed = healthProblems({ ...ok, run: run('2026-11-03T02:00:00Z', { failed: ['补资料', '推到服务器、备份库'] }) });
  assert.deepEqual(failed, ['最近一次每日更新（2026-11-03）有步骤失败：补资料、推到服务器、备份库。详情看 data/logs/update.log。']);
});

test('服务器和备份', () => {
  assert.deepEqual(healthProblems({ ...ok, server: new Error('Connection timed out') }), ['连不上服务器：Connection timed out']);
  assert.deepEqual(healthProblems({ ...ok, server: 'failed' }), ['服务器上的网站没在跑（systemctl 状态：failed）。']);
  assert.deepEqual(healthProblems({ ...ok, backups: [] }), ['还没有服务器库的备份（data/backups/ 是空的）。']);
  assert.deepEqual(healthProblems({ ...ok, backups: ['center-2026-11-02.db'] }), [], '前天的备份还行');
  assert.deepEqual(healthProblems({ ...ok, backups: ['center-2026-10-31.db'] }), ['服务器库的最新备份是 2026-10-31，已经 4 天没备份了。']);
});

test('榜单项目的简介重试后还没生成成功：报出个数和前 5 个名字（#52）', () => {
  assert.deepEqual(healthProblems({ ...ok, unfinished: ['acme/a', 'acme/b'] }),
    ['有 2 个榜单项目的简介没生成成功（重试过也没成），网站上先显示旧简介或 GitHub 描述：acme/a、acme/b。详情看 data/logs/update.log。']);
  const many = ['a/1', 'a/2', 'a/3', 'a/4', 'a/5', 'a/6'];
  assert.match(healthProblems({ ...ok, unfinished: many })[0], /^有 6 个榜单项目.*：a\/1、a\/2、a\/3、a\/4、a\/5 等。/);
});
