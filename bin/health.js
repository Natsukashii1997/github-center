// 健康检查（#48）：node bin/health.js（在仓库目录下跑）。猛鬼兽每天 09:50 的工程自检调用，输出原样发到飞书私聊：
// 没问题什么都不打印；有问题打印一段中文。检查本身出错时退出码非 0。见 src/remote/health.js。
import { readSettings } from '../src/settings/index.js';
import { lastRun } from '../src/update-steps.js';
import { readRemote, serverStatus, listBackups } from '../src/remote/index.js';
import { healthProblems } from '../src/remote/health.js';

const remote = readRemote('data');
let server = null;
if (remote) {
  try {
    server = serverStatus(remote);
  } catch (e) {
    server = e;
  }
}
const problems = healthProblems({ run: lastRun('data'), settings: readSettings('data'), remote: Boolean(remote), server, backups: listBackups('data') });
if (problems.length) console.log(`🌟 Github·Tidings 自检\n${problems.map((p) => `- ${p}`).join('\n')}`);
