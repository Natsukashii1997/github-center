// 设置（所有者 2026-11-03 加设置页，原型 design/candidates/redesign/brand/settings.html#A）：存在 data/settings.json，没存过就用默认值。
// 数据源开关、补资料／归类／精选的思考强度、每日更新时间、周报推送。只有所有者能改（见 web/settings.js），保存前整份校验，不合规就整份不存。
// 谁读：bin/update.js（每日更新开关、整步跳过）、出榜和热点榜（来源开关）、补资料／归类／精选榜（思考强度）；每次运行开头读一次。
// 每日更新时间还没接（批 3 接到 launchd），周报推送等猛鬼兽接入。
import { join } from 'node:path';
import { readJson, writeAtomic } from '../ranking/store.js';

// 能开关的数据源。GH Archive 是涨星榜的基础数据，必须开；Reddit 还没接（要先有免费的应用凭证），只能关。
export const SOURCES = ['trending', 'gharchive', 'clickhouse', 'skills', 'hn', 'v2ex', 'reddit'];
export const REQUIRED = new Set(['gharchive']);
export const UNAVAILABLE = new Set(['reddit']);
// 思考强度：页面上的低／中／高，对应 codex 的 model_reasoning_effort。
export const EFFORTS = { low: '低', medium: '中', high: '高' };
export const EFFORT_TASKS = ['profiles', 'classify', 'picks'];
// 统计日按 UTC 划分、北京时间 08:00 才结束，GH Archive 的事件文件还要再晚约 1 小时，所以每日更新不能早于 09:00；按 15 分钟一档。
export const EARLIEST = '09:00';
export const DAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export const DEFAULTS = {
  sources: Object.fromEntries(SOURCES.map((s) => [s, !UNAVAILABLE.has(s)])),
  effort: Object.fromEntries(EFFORT_TASKS.map((t) => [t, 'low'])),
  daily: { on: true, at: '10:00' },
  weekly: { on: false, day: 1, at: '11:30' },
};

export class SettingsError extends Error {}

const path = (dataDir) => join(dataDir, 'settings.json');
const isTime = (t) => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

// 读设置：文件里缺的项用默认值补上，认不出的项丢掉（文件被手改坏了也不影响页面和更新）。
export function readSettings(dataDir) {
  let saved = null;
  try {
    saved = readJson(path(dataDir));
  } catch {
    saved = null;
  }
  const s = saved && typeof saved === 'object' ? saved : {};
  const pick = (v, ok, d) => (ok(v) ? v : d);
  return {
    sources: Object.fromEntries(SOURCES.map((k) => [k, REQUIRED.has(k) ? true : UNAVAILABLE.has(k) ? false : pick(s.sources?.[k], (v) => typeof v === 'boolean', DEFAULTS.sources[k])])),
    effort: Object.fromEntries(EFFORT_TASKS.map((k) => [k, pick(s.effort?.[k], (v) => Object.hasOwn(EFFORTS, v), DEFAULTS.effort[k])])),
    daily: {
      on: pick(s.daily?.on, (v) => typeof v === 'boolean', DEFAULTS.daily.on),
      at: pick(s.daily?.at, (v) => checkDaily(v) === null, DEFAULTS.daily.at),
    },
    weekly: {
      on: pick(s.weekly?.on, (v) => typeof v === 'boolean', DEFAULTS.weekly.on),
      day: pick(s.weekly?.day, (v) => Number.isInteger(v) && v >= 0 && v < 7, DEFAULTS.weekly.day),
      at: pick(s.weekly?.at, isTime, DEFAULTS.weekly.at),
    },
    ...(typeof s.savedAt === 'string' ? { savedAt: s.savedAt } : {}),
  };
}

// 每日更新时间不合规时返回原因，合规返回 null。
export function checkDaily(at) {
  if (!isTime(at)) return '时间格式不对，要写成 10:00 这样';
  if (at < EARLIEST) return `不能早于 ${EARLIEST}：统计日北京时间 08:00 才结束，原始数据还要再晚约 1 小时`;
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
  if (!isTime(wat)) throw new SettingsError('周报推送时间格式不对，要写成 11:30 这样');
  return { sources, effort, daily: { on: bool('daily.on'), at }, weekly: { on: bool('weekly.on'), day: Number(day), at: wat } };
}

// 存整份设置（先写临时文件再改名），返回存下的内容。
export function saveSettings(dataDir, settings, now = () => new Date()) {
  const saved = { ...settings, savedAt: now().toISOString() };
  writeAtomic(path(dataDir), JSON.stringify(saved, null, 2) + '\n');
  return saved;
}
