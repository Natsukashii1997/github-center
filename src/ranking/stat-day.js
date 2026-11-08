// 统计日 = GitHub 统计日（美国太平洋时间）：官方星数历史的日桶按太平洋时间分日，日终即定稿（ADR 0001 的 2026-11-08 补充，#75、#83）。
// 太平洋 D 日 = UTC D 08:00 至 D+1 08:00（冬令时），夏令时是 07:00 至 07:00；切换那天只有 23 或 25 个小时。
// 官方星数历史以周日为周起点，week 写成该周日的 UTC 零点，days[0..6] 依次是周日到周六，所以按日期换算第几周第几格不受时区影响。
const PACIFIC = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });

function check(day) {
  const t = Date.parse(`${day}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(t)) throw new Error(`统计日格式应为 YYYY-MM-DD：${day}`);
  return t;
}

// 某一刻在太平洋时间是哪一天（YYYY-MM-DD）。
export function pacificDay(at) {
  const p = Object.fromEntries(PACIFIC.formatToParts(new Date(at)).map(({ type, value }) => [type, value]));
  return `${p.year}-${p.month}-${p.day}`;
}

const shift = (day, n) => new Date(check(day) + n * 86400e3).toISOString().slice(0, 10);

export function bucketOf(day) {
  const t = check(day);
  const dayIndex = new Date(t).getUTCDay();
  return { week: t / 1000 - dayIndex * 86400, dayIndex };
}

// 太平洋 D 日零点是 UTC 的哪一刻（毫秒）：冬令时 08:00Z，夏令时 07:00Z。
function startOf(day) {
  for (const h of ['08', '07']) {
    const t = Date.parse(`${day}T${h}:00:00Z`);
    if (pacificDay(t) === day && pacificDay(t - 1) !== day) return t;
  }
  throw new Error(`算不出 ${day} 的太平洋零点`);
}

// 统计日 D 的起止（UTC 毫秒，含起不含止）。
export function dayRange(day) {
  check(day);
  return { from: startOf(day), to: startOf(shift(day, 1)) };
}

// 统计日 D 覆盖的 UTC 小时（GH Archive 一个小时一个文件），按时间先后；平时 24 个，夏令时切换那天 23 或 25 个。
export function dayHours(day) {
  const { from, to } = dayRange(day);
  return Array.from({ length: (to - from) / 3600e3 }, (_, i) => {
    const iso = new Date(from + i * 3600e3).toISOString();
    return { date: iso.slice(0, 10), hour: Number(iso.slice(11, 13)) };
  });
}

// 最近一个已经过完的统计日：太平洋时间的昨天。
export function lastEndedDay(now) {
  return shift(pacificDay(now), -1);
}

// 近 1、7、30 天：截至统计日（含）往前数的统计日，按日累计；since 是同一时间跨度的官方热门榜。
export const WINDOWS = { d1: { days: 1, since: 'daily' }, d7: { days: 7, since: 'weekly' }, d30: { days: 30, since: 'monthly' } };

export function windowDays(day, n) {
  return Array.from({ length: n }, (_, i) => shift(day, i - (n - 1)));
}
