// 统计日按 UTC 划分。这是已观察到的映射，不是官方保证（research/github-center-daily-validation/stat-day-semantics.md）：
// 官方星数历史以周日 00:00 为周起点，days[0..6] 依次是周日到周六。
export function bucketOf(day) {
  const t = Date.parse(`${day}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(t)) throw new Error(`统计日格式应为 YYYY-MM-DD：${day}`);
  const dayIndex = new Date(t).getUTCDay();
  return { week: t / 1000 - dayIndex * 86400, dayIndex };
}

export function lastEndedDay(now) {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// 近 1、7、30 天：截至统计日（含）往前数的统计日，按日累计；since 是同一时间跨度的官方热门榜。
export const WINDOWS = { d1: { days: 1, since: 'daily' }, d7: { days: 7, since: 'weekly' }, d30: { days: 30, since: 'monthly' } };

export function windowDays(day, n) {
  const t = Date.parse(`${day}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => new Date(t - (n - 1 - i) * 86400e3).toISOString().slice(0, 10));
}
