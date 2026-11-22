// 设置页 /settings（所有者 2026-11-03 定稿：原型 design/candidates/redesign/brand/settings.html 的 A 分区原版）：
// 左边分区目录（吸顶），右边一块块设置卡：数据源、定时与推送，「AI 接入」四张（AI 执行方、AI 功能、对外开放、数据对象，#69 全局规则 P-13，所有者 2026-11-08 选 C 版：
// design 稿见 issue #69），账号与访问。改一项就存一次（data/settings.json，见 ../settings/index.js）。
// 状态只读本地文件：status.json（各榜单最近一次更新）、最新热点榜快照（HN、V2EX 各自成败）、logs/update.log（上次每日更新）、
// ai-status.json（两家执行方的可用状态和最近调用，Mac 上跑 AI 功能前查好推上来，见 ../ai-access.js）。不调用任何外部接口，也不在这里查执行方。
// 只有所有者能改；伙伴看得到，控件都是灰的。
import { readStatus, readLatestSnapshot } from '../store.js';
import { readSettings, parseSettings, saveSettings, SettingsError, AGENTS, EFFORTS, DAYS, EARLIEST, REQUIRED, UNAVAILABLE } from '../settings/index.js';
import { lastRun, readRunState, ranToday } from '../update-steps.js';
import { frame } from './frame.js';
import { aiAccess, VIAS, STATES } from '../ai-access.js';
import { NAMES } from '../agent.js';

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
const okState = (s) => (s === 'failed' ? 'failed' : s === 'off' ? 'off' : 'ok');

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

// 下次每日更新：今天（北京时间）已经跑过就是明天，没跑过就是今天（过了设置的时间还没跑的，下一次定时叫醒就跑）。
export const nextRun = (now, at, state) => ({ at, today: !ranToday(state, now) });

export function settingsData(dataDir, ctx, now = new Date()) {
  const statusOf = sourceStatus(dataDir);
  const settings = readSettings(dataDir);
  return {
    me: ctx.account.name,
    canEdit: ctx.account.role === 'owner',
    guest: ctx.guest,
    settings,
    sources: SOURCE_ROWS.map(({ board, hot, ...row }) => ({ ...row, required: REQUIRED.has(row.key), unavailable: UNAVAILABLE.has(row.key), status: statusOf({ key: row.key, board, hot }) })),
    run: lastRun(dataDir),
    next: nextRun(now, settings.daily.at, readRunState(dataDir)),
    agents: AGENTS,
    ai: { ...aiAccess(dataDir, settings), names: NAMES, vias: VIAS, states: STATES },
    efforts: EFFORTS,
    days: DAYS,
    earliest: EARLIEST,
  };
}

// 改设置（谁能改由 server.js 判断）：整份校验后再存，返回存下的设置；不合规抛 SettingsError。
export const changeSettings = (dataDir, form) => saveSettings(dataDir, parseSettings(form));
export { SettingsError };

export const settingsPage = (data, ctx) => frame({ title: '设置', active: '设置', ctx, css: ['bw.css', 'settings.css'], js: ['settings.js'], data,
  body: `  <div class="swrap">
    <section class="hero-box" id="mast"></section>
    <div class="sset">
      <nav class="stoc" id="stoc" aria-label="设置分区"></nav>
      <div class="smain" id="smain"></div>
    </div>
  </div>
  <div class="toast" id="stoast" role="status"></div>` });
