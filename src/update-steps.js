import { openSync, readSync, fstatSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { readJson, writeAtomic } from './ranking/store.js';

// 每日更新的步骤（bin/update.js 按顺序跑）：先出涨星榜和全站 Star 前 100、热点榜，精选榜的候选池才齐；补资料、归类放在后面，当天新上榜的项目就能当天补上。
// 最后一步把数据推到服务器（#46，没有 data/remote.json 时什么都不做）。
// 设置页（../settings）关掉的数据源：一步只靠它的整步跳过（skills.sh → 历史榜；HN、V2EX 都关 → 热点榜），日志写明原因；
// 只关掉一部分来源的步骤照跑，由那一步自己读设置跳过那个来源。
export const STEPS = [
  { name: '出榜', args: ['--use-env-proxy', 'bin/rank-day.js'] },
  { name: '全站 Star 前 100', args: ['--use-env-proxy', 'bin/history.js'] },
  { name: '历史榜（Skill 安装量）', args: ['--use-env-proxy', 'bin/skills.js'], off: (s) => !s.sources.skills && 'skills.sh' },
  { name: '热点榜', args: ['--use-env-proxy', 'bin/hot.js'], off: (s) => !s.sources.hn && !s.sources.v2ex && 'Hacker News 和 V2EX' },
  { name: '精选榜', args: ['bin/picks.js'] },
  { name: '补资料', args: ['--use-env-proxy', 'bin/profiles.js'] },
  { name: '归类', args: ['--use-env-proxy', 'bin/classify.js'] },
  { name: '周报', args: ['bin/weekly.js'] },
  { name: '校准报告', args: ['bin/calibrate.js'] },
  { name: '推到服务器', args: ['bin/push.js'] },
];

// 这次要跑的步骤：{ name, args, skip }，skip 是跳过的原因（不跳过为 null）。
export function planSteps(settings) {
  return STEPS.map(({ name, args, off }) => {
    const by = off?.(settings);
    return { name, args, skip: by ? `设置页里关掉了 ${by}` : null };
  });
}

// 定时（scripts/schedule.sh）：launchd 每天北京时间 09:00–23:45 每 15 分钟叫醒一次 `bin/update.js --scheduled`，电脑睡着错过的醒来补一次。
// 到点才跑：每日更新开着、北京时间已到设置里的时间、今天（北京时间）还没跑过；没到点就什么都不写直接退出。
// 每次开跑（含手动 npm run update）记下日期（data/update-state.json），同一天不再定时跑第二次，失败了也等第二天。
const STATE = (dataDir) => join(dataDir, 'update-state.json');
export const beijing = (now) => {
  const iso = new Date(now.getTime() + 8 * 3600_000).toISOString();
  return { day: iso.slice(0, 10), time: iso.slice(11, 16) };
};
// 没有记录文件时（批 3 之前跑过的）按日志里最近一次开跑的日期算，免得装好定时后当天又跑一次。
export function readRunState(dataDir) {
  try {
    const saved = readJson(STATE(dataDir));
    if (saved) return saved;
  } catch {
    // 文件坏了按日志算
  }
  const run = lastRun(dataDir);
  return run ? { day: beijing(new Date(run.startedAt)).day, startedAt: run.startedAt } : null;
}
export const markRun = (dataDir, now) => writeAtomic(STATE(dataDir), JSON.stringify({ day: beijing(now).day, startedAt: now.toISOString() }) + '\n');
export const ranToday = (state, now) => state?.day === beijing(now).day;
export function isDue(settings, state, now) {
  return settings.daily.on && beijing(now).time >= settings.daily.at && !ranToday(state, now);
}

// 日志只读最后 64KB：够找到最近一次每日更新的开始、各步退出码和结束行。
function logTail(file, bytes = 65_536) {
  let fd;
  try {
    fd = openSync(file, 'r');
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    return buf.toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

// 最近一次每日更新（本文件 bin/update.js 写的日志格式）：开始时刻、结束时刻、失败的步骤；还没结束的算正在更新。
export function parseRun(log) {
  const lines = log.split('\n');
  const startAt = lines.findLastIndex((l) => / 每日更新开始$/.test(l));
  if (startAt < 0) return null;
  const run = { startedAt: lines[startAt].split(' ')[0], failed: [] };
  for (const l of lines.slice(startAt + 1)) {
    const step = l.match(/^\S+ (.+) 退出码 (\d+)/);
    if (step && step[2] !== '0') run.failed.push(step[1]);
    const end = l.match(/^(\S+) 每日更新结束：/);
    if (end) run.endedAt = end[1];
  }
  run.running = !run.endedAt;
  return run;
}
export const lastRun = (dataDir) => parseRun(logTail(join(dataDir, 'logs', 'update.log')));
