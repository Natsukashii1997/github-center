// 每日更新的步骤（bin/update.js 按顺序跑）：先出涨星榜和全站 Star 前 100、热点榜，精选榜的候选池才齐；补资料、归类放在后面，当天新上榜的项目就能当天补上。
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
];

// 这次要跑的步骤：{ name, args, skip }，skip 是跳过的原因（不跳过为 null）。每日更新整个关掉时返回 null。
export function planSteps(settings) {
  if (!settings.daily.on) return null;
  return STEPS.map(({ name, args, off }) => {
    const by = off?.(settings);
    return { name, args, skip: by ? `设置页里关掉了 ${by}` : null };
  });
}
