// 每日更新最后一步（#46）：把网站要的数据推到服务器，再让服务器把精选榜候选池写进库并补卡（见 src/remote）。
// 没有 data/remote.json 就是只在本机跑，什么都不做。推失败退出码为 1，写进每日更新的日志，第二天照常再推。
import { readRemote, pushData } from '../src/remote/index.js';

const remote = readRemote('data');
if (!remote) console.log('没有 data/remote.json：只在本机跑，不推');
else {
  try {
    console.log(`推到服务器 ${remote.ssh}:${remote.dir}：${pushData('data', remote)}`);
  } catch (e) {
    console.log(`推到服务器失败：${e.message}`);
    process.exitCode = 1;
  }
}
