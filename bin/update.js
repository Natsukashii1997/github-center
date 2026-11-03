// 每日更新：npm run update（scripts/schedule.sh 装进 launchd，每天北京时间 10:00 跑）：按顺序跑下面几步，一步失败照样跑后面的，最后一行写 `exit N`。
// 每一步都是用同一个 node 起的子进程（launchd 直接启动 node，不经过 /bin/sh，见全局坑 G-05）；各步本身都能安全重跑。
// 先出涨星榜和全站 Star 前 100、热点榜，精选榜的候选池才齐；补资料、归类放在后面，当天新上榜的项目就能当天补上。
import { spawnSync } from 'node:child_process';

const STEPS = [
  ['出榜', ['--use-env-proxy', 'bin/rank-day.js']],
  ['全站 Star 前 100', ['--use-env-proxy', 'bin/history.js']],
  ['历史榜（Skill 安装量）', ['--use-env-proxy', 'bin/skills.js']],
  ['热点榜', ['--use-env-proxy', 'bin/hot.js']],
  ['精选榜', ['bin/picks.js']],
  ['补资料', ['--use-env-proxy', 'bin/profiles.js']],
  ['归类', ['--use-env-proxy', 'bin/classify.js']],
  ['周报', ['bin/weekly.js']],
  ['校准报告', ['bin/calibrate.js']],
];

const stamp = () => new Date().toISOString();
console.log(`${stamp()} 每日更新开始`);
const failed = [];
for (const [name, args] of STEPS) {
  console.log(`${stamp()} ▶ ${name}`);
  const r = spawnSync(process.execPath, args, { stdio: 'inherit' });
  const code = r.status ?? 1;
  console.log(`${stamp()} ${name} 退出码 ${code}${r.error ? `：${r.error.message}` : ''}`);
  if (code !== 0) failed.push(name);
}
console.log(`${stamp()} 每日更新结束：${failed.length ? `失败 ${failed.join('、')}` : '全部成功'}`);
console.log(`exit ${failed.length ? 1 : 0}`);
process.exitCode = failed.length ? 1 : 0;
