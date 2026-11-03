// 每日更新最后一步（#46）：把网站要的数据推到服务器，再让服务器把精选榜候选池写进库并补卡（见 src/remote）；
// 然后把服务器的库备份回 Mac（#48，data/backups/，留 14 份）。推和备份各管各的，一个失败不影响另一个。
// 没有 data/remote.json 就是只在本机跑，什么都不做。有一项失败退出码为 1，写进每日更新的日志，第二天照常再来。
import { readRemote, pushData, backupDb } from '../src/remote/index.js';
import { beijing } from '../src/update-steps.js';

const remote = readRemote('data');
if (!remote) console.log('没有 data/remote.json：只在本机跑，不推');
else {
  try {
    console.log(`推到服务器 ${remote.ssh}:${remote.dir}：${pushData('data', remote)}`);
  } catch (e) {
    console.log(`推到服务器失败：${e.message}`);
    process.exitCode = 1;
  }
  try {
    const b = backupDb('data', remote, beijing(new Date()).day);
    console.log(`备份服务器的库：${b.path}（账号 ${b.accounts} 个）${b.removed.length ? `，删掉旧备份 ${b.removed.join('、')}` : ''}`);
  } catch (e) {
    console.log(`备份服务器的库失败：${e.message}`);
    process.exitCode = 1;
  }
}
