// 每日更新：npm run update 手动跑；launchd（scripts/schedule.sh）每 15 分钟叫醒一次 `--scheduled`，到了设置页里的时间才真跑（见 src/update-steps.js）。
// 按顺序跑 src/update-steps.js 里的几步，一步失败照样跑后面的，最后一行写 `exit N`。
// 每一步都是用同一个 node 起的子进程（launchd 直接启动 node，不经过 /bin/sh，见全局坑 G-05）；各步本身都能安全重跑。
// 每次开跑先读设置页的设置（data/settings.json）：关掉的数据源对应的步骤跳过。手动跑不看时间和每日更新开关。
import { spawnSync } from 'node:child_process';
import { readSettings } from '../src/settings/index.js';
import { planSteps, isDue, readRunState, markRun } from '../src/update-steps.js';

const settings = readSettings('data');
const now = new Date();
// 定时叫醒但没到点（或今天已跑过、每日更新关掉）：不写日志，直接退出。
if (process.argv.includes('--scheduled') && !isDue(settings, readRunState('data'), now)) process.exit(0);
markRun('data', now);

const stamp = () => new Date().toISOString();
console.log(`${stamp()} 每日更新开始`);
const failed = [];
for (const { name, args, skip } of planSteps(settings)) {
  if (skip) {
    console.log(`${stamp()} 跳过 ${name}：${skip}`);
    continue;
  }
  console.log(`${stamp()} ▶ ${name}`);
  const r = spawnSync(process.execPath, args, { stdio: 'inherit' });
  const code = r.status ?? 1;
  console.log(`${stamp()} ${name} 退出码 ${code}${r.error ? `：${r.error.message}` : ''}`);
  if (code !== 0) failed.push(name);
}
console.log(`${stamp()} 每日更新结束：${failed.length ? `失败 ${failed.join('、')}` : '全部成功'}`);
console.log(`exit ${failed.length ? 1 : 0}`);
process.exitCode = failed.length ? 1 : 0;
