// 设置页 /settings（所有者 2026-11-03 定稿：原型 design/candidates/redesign/brand/settings.html 的 A 分区原版）：
// 左边分区目录（吸顶），右边一块块设置卡：数据源、定时与推送、智能体、接入（MCP，规划中，只展示）。改一项就存一次（data/settings.json，见 ../settings/index.js）。
// 状态只读本地文件：status.json（各榜单最近一次更新）、最新热点榜快照（HN、V2EX 各自成败）、logs/update.log（上次每日更新）。不调用任何外部接口。
// 只有所有者能改；伙伴看得到，控件都是灰的。
import { openSync, readSync, fstatSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { readStatus, readLatestSnapshot } from '../ranking/store.js';
import { readSettings, parseSettings, saveSettings, SettingsError, EFFORTS, DAYS, EARLIEST, REQUIRED, UNAVAILABLE } from '../settings/index.js';
import { frame } from './home.js';

// 每日更新的定时现在还写死在 scripts/schedule.sh 里（北京时间 10:00）；批 3 改成读设置里的时间。
export const SCHEDULED_AT = '10:00';

// 数据源，按原型 A 的顺序。board：状态取 status.json 里哪个榜单；hot：取最新热点榜快照里这个来源的成败。
// GitHub API 不能关（官方核数、全站 Star 前 100、热点榜认仓库都靠它），只展示。
const SOURCE_ROWS = [
  { key: 'trending', name: 'GitHub 官方热门', host: 'github.com/trending', use: '和事件数据合并成涨星榜候选，新上榜', board: 'trending' },
  { key: 'gharchive', name: 'GH Archive 事件', host: 'data.gharchive.org', use: '算每个项目一天涨了多少星', board: 'd1' },
  { key: 'clickhouse', name: 'ClickHouse 公开库', host: 'play.clickhouse.com', use: '补 GH Archive 缺的小时、近 7 / 30 天更早的日子；关掉后缺的数据补不上', board: 'd30' },
  { key: 'github', name: 'GitHub API', host: 'GITHUB_TOKEN', use: '没有就用本机 gh 登录 · 官方核数、全站 Star 前 100、热点榜认仓库', fixed: true },
  { key: 'skills', name: 'skills.sh', host: 'skills.sh', use: '全时段安装量 · 历史榜', board: 'skills' },
  { key: 'hn', name: 'Hacker News', host: 'hn.algolia.com', use: 'Algolia 公开接口 · 热点榜', hot: true },
  { key: 'v2ex', name: 'V2EX', host: 'v2ex.com/api', use: '公开接口 v1 · 热点榜', hot: true },
  { key: 'reddit', name: 'Reddit', use: '需要一个免费的 Reddit 应用凭证 · 热点榜' },
];
const okState = (s) => (s === 'failed' ? 'failed' : 'ok');

function sourceStatus(dataDir) {
  const status = readStatus(dataDir)?.boards ?? {};
  let hot = null;
  try {
    hot = readLatestSnapshot(dataDir, 'hot');
  } catch {
    hot = null;
  }
  // 热点榜那天所有来源都失败时不存快照、只在 status.json 记失败；比快照新就按失败算。
  const hotFailed = status.hot?.status === 'failed' && (!hot || status.hot.day > hot.statDay) ? status.hot : null;
  return (row) => {
    if (row.board) {
      const b = status[row.board];
      return b ? { state: okState(b.status), day: b.day, ...(b.error ? { error: b.error } : {}) } : { state: 'none' };
    }
    if (row.hot) {
      if (hotFailed) return { state: 'failed', day: hotFailed.day, error: hotFailed.error };
      const x = hot?.sources?.[row.key];
      return x ? { state: okState(x.status), day: hot.statDay, ...(x.error ? { error: x.error } : {}) } : { state: 'none' };
    }
    return null;
  };
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

// 最近一次每日更新（bin/update.js 的日志格式）：开始时刻、结束时刻、结果、失败的步骤；还没结束的算正在更新。
export function lastRun(log) {
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

// 下次每日更新：北京时间今天这个点还没到就是今天，过了就是明天。
export function nextRun(now, at = SCHEDULED_AT) {
  const bj = new Date(now.getTime() + 8 * 3600_000).toISOString().slice(11, 16);
  return { at, today: bj < at };
}

export function settingsData(dataDir, ctx, now = new Date()) {
  const statusOf = sourceStatus(dataDir);
  const settings = readSettings(dataDir);
  return {
    me: ctx.account.name,
    canEdit: ctx.account.role === 'owner',
    guest: ctx.guest,
    // 批 1 只存不用：开关、强度、时间都还没接到每日更新上，页面保存后照实说。
    applied: false,
    settings,
    sources: SOURCE_ROWS.map(({ board, hot, ...row }) => ({ ...row, required: REQUIRED.has(row.key), unavailable: UNAVAILABLE.has(row.key), status: statusOf({ key: row.key, board, hot }) })),
    run: lastRun(logTail(join(dataDir, 'logs', 'update.log'))),
    next: nextRun(now),
    efforts: EFFORTS,
    days: DAYS,
    earliest: EARLIEST,
  };
}

// 改设置（谁能改由 server.js 判断）：整份校验后再存，返回存下的设置；不合规抛 SettingsError。
export const changeSettings = (dataDir, form) => saveSettings(dataDir, parseSettings(form));
export { SettingsError };

export const settingsPage = (data, ctx) => frame({ title: '设置页', active: '设置页', ctx, css: ['bw.css', 'settings.css'], js: ['settings.js'], data,
  body: `  <div class="swrap">
    <section class="hero-box" id="mast"></section>
    <div class="sset">
      <nav class="stoc" id="stoc" aria-label="设置分区"></nav>
      <div class="smain" id="smain"></div>
    </div>
  </div>
  <div class="toast" id="stoast" role="status"></div>` });
