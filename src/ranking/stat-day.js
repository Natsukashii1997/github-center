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
