// 回补缺期（#103，所有者 2026-11-20 定）：出榜只出最近一个已结束的统计日，那天没出成（上游超时、Mac 关着、跑到一半被杀），
// 这一期就永久缺了（统计日 11-15 缺过）。所以每次出完最近一期，再看它之前的 BACKFILL_DAYS 个统计日，涨星榜三个窗口缺哪期补哪期。
// 为什么是 5 天：官方星数历史只给当周加前 5 周（周日起算，按太平洋日换周），近 30 天榜要用到 29 天前那一格。
// 最坏情况是太平洋周日出榜：最近一期之前第 5 天的近 30 天榜正好用到最老那一格，第 6 天就缺一周、核数失败。
// 所以 5 天是周日也补得出的上限，没有余量；周一到周六出榜时有 1 到 6 天余量。周日这个边界格是按接口返回推出来的，还没在真实上游碰到过。
// 官方热门榜只能取到运行当时的数据，补旧期次时不生成（见 rank-day.js 的 rankDay）。
// 回补出的数字是回补那一刻读到的官方日桶，和按时出的不会一模一样：日桶过了日界还会小幅往下掉（取消 Star、被 GitHub 清掉的账号）。
// 2026-11-20 在数据副本上实测：晚 2 天回补 11-18 的近 1 天榜，前 20 名单不变，新增中位少 0.1%，个别少 9%，4 个名次变了；
// 晚 4 天回补 11-16 的近 7 天榜，新增中位少 0.25%，末位换了 1 个项目。回补的期次够用来和后面的期次比名次、算连续期数，不当作按时出的原样。
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { WINDOWS, windowDays } from './stat-day.js';

export const BACKFILL_DAYS = 5;

const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.json$/;
function publishedDays(dataDir, window) {
  const dir = join(dataDir, 'snapshots', window);
  return existsSync(dir) ? readdirSync(dir).flatMap((f) => f.match(DAY_FILE)?.[1] ?? []) : [];
}

// latest 之前的 days 个统计日里缺的期次，新的在前：[{ day, windows }]，windows 是那天没有快照的窗口。
// 只算两期之间的洞：某个窗口第一次出榜之前的日子不算缺，全新的数据目录不会一上来补 5 天。latest 自己不算（它由这次出榜负责）。
export function missingDays(dataDir, latest, { days = BACKFILL_DAYS, windows = Object.keys(WINDOWS) } = {}) {
  const have = Object.fromEntries(windows.map((w) => [w, new Set(publishedDays(dataDir, w))]));
  const first = Object.fromEntries(windows.map((w) => [w, [...have[w]].sort()[0] ?? null]));
  return windowDays(latest, days + 1)
    .slice(0, -1)
    .reverse()
    .map((day) => ({ day, windows: windows.filter((w) => first[w] && first[w] < day && !have[w].has(day)) }))
    .filter((g) => g.windows.length);
}

// 出榜带回补。rankOne(day, { windows?, backfill? }) 跑一个统计日并返回 { failed }（bin/rank-day.js 里连打印一起做）。
// explicit：命令行点名了日期，只出那一天、不回补。最近一期没出成时不回补：上游多半正有问题（11-16 那次超时拖了一个半小时），
// 不再加码，等当天重试（#94）或下次每日更新出成了再补。回补失败只体现在 backfilled 里，不算这次出榜失败：
// 否则一个补不出来的旧期次会连着几天把出榜判成失败、触发当天重试；它由健康检查报出来（remote/health.js）。
export async function rankWithBackfill({ dataDir, day, explicit = false, rankOne }) {
  const { failed } = await rankOne(day, {});
  const backfilled = [];
  if (!explicit && !failed) {
    for (const gap of missingDays(dataDir, day)) backfilled.push({ ...gap, failed: (await rankOne(gap.day, { windows: gap.windows, backfill: true })).failed });
  }
  return { failed, backfilled };
}
