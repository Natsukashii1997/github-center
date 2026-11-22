import { openSync, readSync, fstatSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { readJson, writeAtomic } from './store.js';

// 每日更新的步骤（bin/update.js 按顺序跑）：先出涨星榜和全站 Star 前 100、热点榜，精选榜的候选池才齐；补资料、归类放在后面，当天新上榜的项目就能当天补上。
// 出榜出完最近一期，还会把前 5 个统计日里涨星榜缺的期次补出来（#103，ranking/backfill.js）；回补失败不算这一步失败。
// 最后一步把数据推到服务器、把服务器的库备份回来（#46、#48，没有 data/remote.json 时什么都不做）。
// 设置页（../settings）关掉的数据源：一步只靠它的整步跳过（skills.sh → 历史榜；HN、V2EX 都关 → 热点榜），日志写明原因；
// 只关掉一部分来源的步骤照跑，由那一步自己读设置跳过那个来源。
// id 是代码内部用的稳定英文名（#114）；name 是中文步骤名，日志、data/update-state.json 的 failed、设置页、健康检查都用它，不要改。
export const STEPS = [
  { id: 'rank', name: '出榜', args: ['--use-env-proxy', 'bin/rank-day.js'] },
  { id: 'history', name: '全站 Star 前 100', args: ['--use-env-proxy', 'bin/history.js'] },
  { id: 'skills', name: '历史榜（Skill 安装量）', args: ['--use-env-proxy', 'bin/skills.js'], off: (s) => !s.sources.skills && 'skills.sh' },
  { id: 'hot', name: '热点榜', args: ['--use-env-proxy', 'bin/hot.js'], off: (s) => !s.sources.hn && !s.sources.v2ex && 'Hacker News 和 V2EX' },
  { id: 'picks', name: '精选榜', args: ['bin/picks.js'] },
  { id: 'profiles', name: '补资料', args: ['--use-env-proxy', 'bin/profiles.js'] },
  { id: 'classify', name: '归类', args: ['--use-env-proxy', 'bin/classify.js'] },
  { id: 'weekly', name: '周报', args: ['bin/weekly.js'] },
  { id: 'push', name: '推到服务器、备份库', args: ['bin/push.js'] },
];

// 这次要跑的步骤：{ id, name, args, skip }，skip 是跳过的原因（不跳过为 null）。
export function planSteps(settings) {
  return STEPS.map(({ id, name, args, off }) => {
    const by = off?.(settings);
    return { id, name, args, skip: by ? `设置页里关掉了 ${by}` : null };
  });
}

// 定时（scripts/schedule.sh）：launchd 每天北京时间 09:00–23:45 每 15 分钟叫醒一次 `bin/update.js --scheduled`，电脑睡着错过的醒来补一次。
// 到点才跑：每日更新开着、北京时间已到设置里的时间、今天（北京时间）还没跑过；没到点就什么都不写直接退出。
// 每次开跑（含手动 npm run update）记下日期（data/update-state.json），同一天不再定时整套跑第二次；有步骤失败的，当天按 retryOf 重试（#94）。
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
// 开跑时记日期、开跑时刻和这是当天第几次重试（整套跑是 0）；跑完再补上结束时刻和失败的步骤（finishRun）。
export const markRun = (dataDir, now, retries = 0) => writeAtomic(STATE(dataDir), JSON.stringify({ day: beijing(now).day, startedAt: now.toISOString(), retries }) + '\n');
export function finishRun(dataDir, now, failed) {
  const state = readJson(STATE(dataDir)) ?? {};
  writeAtomic(STATE(dataDir), JSON.stringify({ ...state, endedAt: now.toISOString(), failed }) + '\n');
}
export const ranToday = (state, now) => state?.day === beijing(now).day;
export function isDue(settings, state, now) {
  return settings.daily.on && beijing(now).time >= settings.daily.at && !ranToday(state, now);
}

// 失败后当天重试（#94，常浩 2026-11-20 定）：今天这次有步骤失败，上一次跑完满 30 分钟，就再跑一次；当天最多重试 2 次，北京 22:00 起不再试。
// 跑哪几步：失败的步骤，加上排在第一个失败步骤后面、要用前面结果的步骤（例如出榜补上了，周报才写得出新的一期）；
// 各自取数、不读别的步骤结果的步骤，只有自己失败才重跑。没跑完（没有结束时刻，可能还在跑或中途被杀）不重试。
export const RETRY = { max: 2, gapMinutes: 30, until: '22:00' };
// 各自取数的步骤（按 id）：出榜、全站 Star 前 100、历史榜、热点榜。state.failed 和返回的 steps 照旧是中文步骤名。
const INDEPENDENT = new Set(['rank', 'history', 'skills', 'hot']);
export function retryOf(settings, state, now) {
  if (!settings.daily.on || !ranToday(state, now) || !state.failed?.length || !state.endedAt) return null;
  const n = (state.retries ?? 0) + 1;
  if (n > RETRY.max || beijing(now).time >= RETRY.until) return null;
  if (now.getTime() - Date.parse(state.endedAt) < RETRY.gapMinutes * 60_000) return null;
  const first = STEPS.findIndex((x) => state.failed.includes(x.name));
  if (first < 0) return null;
  const steps = STEPS.filter((x, i) => state.failed.includes(x.name) || (i > first && !INDEPENDENT.has(x.id))).map((x) => x.name);
  return { n, failed: state.failed, steps };
}

// 日志只读最后 256KB：够找到最近一次每日更新的开始、各步退出码和结束行。平时一次更新约 14KB；
// 回补（#103）最多再打 15 个窗口，每个 2–3KB，连缺 5 天时一次约 60KB，原来的 64KB 没有余量。
function logTail(file, bytes = 262_144) {
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
