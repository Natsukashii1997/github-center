// 设置（所有者 2026-11-03 加设置页，原型 design/candidates/redesign/brand/settings.html#A）：存在 data/settings.json，没存过就用默认值。
// 数据源开关、AI 接入（默认执行方、各功能的执行方）、补资料／归类／精选的思考强度、每日更新时间、周报推送。只有所有者能改（见 web/settings.js），保存前整份校验，不合规就整份不存。
// 谁读：bin/update.js（每日更新开关、整步跳过）、出榜和热点榜（来源开关）、补资料／归类／精选榜（智能体、思考强度）；每次运行开头读一次。
// 周报推送（weekly）本仓库不读：猛鬼兽（Hermes）每 15 分钟读一次 data/settings.json 决定发不发（#61，约定见 docs/handoff/weekly-hermes.md）。
// 改默认值或字段时同步改 digital-twin 的 hermes/scripts/tidings_weekly.py。
import { join } from 'node:path';
import { readJson, writeAtomic } from '../ranking/store.js';

// 能开关的数据源。GH Archive 是涨星榜的基础数据，必须开；Reddit 还没接（要先有免费的应用凭证），只能关。
export const SOURCES = ['trending', 'gharchive', 'clickhouse', 'skills', 'hn', 'v2ex', 'reddit'];
export const REQUIRED = new Set(['gharchive']);
export const UNAVAILABLE = new Set(['reddit']);
// 补资料、归类、精选榜交给哪个执行方（2026-11-04 所有者加；#69 按全局规则 P-13 改成三选一，可按功能单独指定）：
// 只用 Codex、只用 Claude 时，不可用就报错，不换另一家；「Codex 优先·Claude 接力」是所有者 2026-11-07 选定保留的明示选项，规则见 ../agent.js。
export const AGENTS = { codex: '只用 Codex', claude: '只用 Claude', relay: 'Codex 优先·Claude 接力' };
// 各功能的执行方：default 跟随上面的默认执行方，否则同 AGENTS。
export const AGENT_TASKS = ['profiles', 'classify', 'picks'];
export const FOLLOW = 'default';
// 思考强度：页面上的低／中／高，对应 codex 的 model_reasoning_effort、claude 的 --effort。
export const EFFORTS = { low: '低', medium: '中', high: '高' };
export const EFFORT_TASKS = ['profiles', 'classify', 'picks'];
// 统计日是 GitHub 统计日（美国太平洋时间），冬令时北京 16:00 才结束（夏令时 15:00），GH Archive 最后一个小时文件还要再晚约 1 小时，
// 所以每日更新不能早于 17:00；按 15 分钟一档（#83，ADR 0001 的 2026-11-08 补充）。
export const EARLIEST = '17:00';
// 周报用的是当天每日更新出的近 7 天榜，所以周报推送不能早于每日更新时间；迁移时放在每日更新后 1.5 小时（默认 18:00 → 19:30），最晚 23:45。
const WEEKLY_AFTER = 90;
export const DAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export const DEFAULTS = {
  sources: Object.fromEntries(SOURCES.map((s) => [s, !UNAVAILABLE.has(s)])),
  agent: 'relay',   // #69 前的默认（Codex，失败 Claude 接力），行为不变
  agentFor: Object.fromEntries(AGENT_TASKS.map((t) => [t, FOLLOW])),
  effort: Object.fromEntries(EFFORT_TASKS.map((t) => [t, 'low'])),
  daily: { on: true, at: '18:00' },   // #83 起 18:00（之前 10:00），统计日结束后 2 小时
  weekly: { on: true, day: 1, at: '19:30' },   // 所有者 2026-11-06 定默认开、周一；#83 起 19:30（之前 11:30）
};

export class SettingsError extends Error {}

const path = (dataDir) => join(dataDir, 'settings.json');
const isAgentFor = (v) => v === FOLLOW || Object.hasOwn(AGENTS, v);
const isTime = (t) => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
const minutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const clock = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
// 周报推送时间早于每日更新时，迁到每日更新后 1.5 小时（最晚 23:45）；否则照旧。
export const weeklyAfter = (daily, weekly) => (weekly < daily ? clock(Math.min(minutes(daily) + WEEKLY_AFTER, minutes('23:45'))) : weekly);

// 读设置：文件里缺的项用默认值补上，认不出的项丢掉（文件被手改坏了也不影响页面和更新）。
// #83 出榜推后 8 小时后的迁移：存的每日更新是按 15 分钟一档的时间、但早于 17:00（如以前的默认 10:00），改按 18:00；周报推送早于每日更新的，改按每日更新后 1.5 小时。
// 只在读的时候改，不悄悄写文件；改了哪几项记在 migrated（原值 → 新值），设置页提示一句，所有者下次保存时写回。
// 猛鬼兽直接读文件，tidings_weekly.py 按同一条规则算周报时间。
export function readSettings(dataDir) {
  let saved = null;
  try {
    saved = readJson(path(dataDir));
  } catch {
    saved = null;
  }
  const s = saved && typeof saved === 'object' ? saved : {};
  const pick = (v, ok, d) => (ok(v) ? v : d);
  const migrated = [];
  const early = isTime(s.daily?.at) && s.daily.at < EARLIEST && Number(s.daily.at.slice(3)) % 15 === 0;
  const dailyAt = early ? DEFAULTS.daily.at : pick(s.daily?.at, (v) => checkDaily(v) === null, DEFAULTS.daily.at);
  if (early) migrated.push({ key: 'daily.at', from: s.daily.at, to: dailyAt });
  const savedWeekly = pick(s.weekly?.at, isTime, DEFAULTS.weekly.at);
  const weeklyAt = weeklyAfter(dailyAt, savedWeekly);
  if (weeklyAt !== savedWeekly && isTime(s.weekly?.at)) migrated.push({ key: 'weekly.at', from: savedWeekly, to: weeklyAt });
  return {
    sources: Object.fromEntries(SOURCES.map((k) => [k, REQUIRED.has(k) ? true : UNAVAILABLE.has(k) ? false : pick(s.sources?.[k], (v) => typeof v === 'boolean', DEFAULTS.sources[k])])),
    // #69 前存的 codex 实际是「Codex 失败 Claude 接力」，按 relay 读（那时还没有 agentFor），行为不变；#69 后存的照原样。
    agent: s.agent === 'codex' && !s.agentFor ? 'relay' : pick(s.agent, (v) => Object.hasOwn(AGENTS, v), DEFAULTS.agent),
    agentFor: Object.fromEntries(AGENT_TASKS.map((k) => [k, pick(s.agentFor?.[k], isAgentFor, FOLLOW)])),
    effort: Object.fromEntries(EFFORT_TASKS.map((k) => [k, pick(s.effort?.[k], (v) => Object.hasOwn(EFFORTS, v), DEFAULTS.effort[k])])),
    daily: { on: pick(s.daily?.on, (v) => typeof v === 'boolean', DEFAULTS.daily.on), at: dailyAt },
    weekly: {
      on: pick(s.weekly?.on, (v) => typeof v === 'boolean', DEFAULTS.weekly.on),
      day: pick(s.weekly?.day, (v) => Number.isInteger(v) && v >= 0 && v < 7, DEFAULTS.weekly.day),
      at: weeklyAt,
    },
    ...(migrated.length ? { migrated } : {}),
    ...(typeof s.savedAt === 'string' ? { savedAt: s.savedAt } : {}),
  };
}

// 每日更新时间不合规时返回原因，合规返回 null。
export function checkDaily(at) {
  if (!isTime(at)) return '时间格式不对，要写成 18:00 这样';
  if (at < EARLIEST) return `不能早于 ${EARLIEST}：GitHub 统计日按美国太平洋时间，北京 16:00 才结束（夏令时 15:00），原始数据还要再晚约 1 小时`;
  if (Number(at.slice(3)) % 15) return '按 15 分钟一档：分钟只能是 00、15、30、45';
  return null;
}

// 页面提交的表单（字段名见 settingsFields）→ 整份设置；有一项不合规就抛 SettingsError，什么都不存。
export function parseSettings(form) {
  const get = (k) => {
    const v = form.get(k);
    if (v === null) throw new SettingsError(`缺少 ${k}`);
    return v;
  };
  const bool = (k) => {
    const v = get(k);
    if (v !== 'on' && v !== 'off') throw new SettingsError(`${k} 只能是 on 或 off`);
    return v === 'on';
  };
  const sources = {};
  for (const k of SOURCES) {
    sources[k] = bool(`sources.${k}`);
    if (REQUIRED.has(k) && !sources[k]) throw new SettingsError('GH Archive 是涨星榜的基础数据，不能关');
    if (UNAVAILABLE.has(k) && sources[k]) throw new SettingsError('Reddit 还没接，不能打开');
  }
  const agent = get('agent');
  if (!Object.hasOwn(AGENTS, agent)) throw new SettingsError(`默认执行方只能是 ${Object.keys(AGENTS).join('、')}`);
  const agentFor = {};
  for (const k of AGENT_TASKS) {
    agentFor[k] = get(`agentFor.${k}`);
    if (!isAgentFor(agentFor[k])) throw new SettingsError(`功能的执行方只能是 ${[FOLLOW, ...Object.keys(AGENTS)].join('、')}`);
  }
  const effort = {};
  for (const k of EFFORT_TASKS) {
    effort[k] = get(`effort.${k}`);
    if (!Object.hasOwn(EFFORTS, effort[k])) throw new SettingsError(`思考强度只能是 ${Object.keys(EFFORTS).join('、')}`);
  }
  const at = get('daily.at');
  const bad = checkDaily(at);
  if (bad) throw new SettingsError(`每日更新时间${bad}`);
  const day = get('weekly.day');
  if (!/^[0-6]$/.test(day)) throw new SettingsError('周报推送的星期不对');
  const wat = get('weekly.at');
  if (!isTime(wat)) throw new SettingsError('周报推送时间格式不对，要写成 19:30 这样');
  if (wat < at) throw new SettingsError(`周报推送时间 ${wat} 不能早于每日更新时间 ${at}：周报用的是当天每日更新出的榜`);
  return { sources, agent, agentFor, effort, daily: { on: bool('daily.on'), at }, weekly: { on: bool('weekly.on'), day: Number(day), at: wat } };
}

// 某个功能实际用的执行方（codex、claude、relay）：单独指定了就用它，否则跟随默认。
export const agentOf = (settings, task) => (settings.agentFor?.[task] && settings.agentFor[task] !== FOLLOW ? settings.agentFor[task] : settings.agent);

// 存整份设置（先写临时文件再改名），返回存下的内容。
export function saveSettings(dataDir, settings, now = () => new Date()) {
  const saved = { ...settings, savedAt: now().toISOString() };
  writeAtomic(path(dataDir), JSON.stringify(saved, null, 2) + '\n');
  return saved;
}
