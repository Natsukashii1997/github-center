// 每日更新：npm run update（scripts/schedule.sh 装进 launchd，每天北京时间 10:00 跑）：按顺序跑 src/update-steps.js 里的几步，一步失败照样跑后面的，最后一行写 `exit N`。
// 每一步都是用同一个 node 起的子进程（launchd 直接启动 node，不经过 /bin/sh，见全局坑 G-05）；各步本身都能安全重跑。
// 每次开跑先读设置页的设置（data/settings.json）：每日更新关掉就不跑；关掉的数据源对应的步骤跳过。
import { spawnSync } from 'node:child_process';
import { readSettings } from '../src/settings/index.js';
import { planSteps } from '../src/update-steps.js';

const stamp = () => new Date().toISOString();
console.log(`${stamp()} 每日更新开始`);
const steps = planSteps(readSettings('data'));
if (!steps) {
  console.log(`${stamp()} 每日更新已在设置页关掉，这次不跑`);
  console.log(`${stamp()} 每日更新结束：已关掉`);
  console.log('exit 0');
  process.exit(0);
}
const failed = [];
for (const { name, args, skip } of steps) {
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
