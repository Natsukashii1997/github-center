// 健康检查（#48）：node bin/health.js（在仓库目录下跑）。猛鬼兽每天 09:50 的工程自检调用，输出原样发到飞书私聊：
// 没问题什么都不打印；有问题打印一段中文。检查本身出错时退出码非 0。见 src/remote/health.js。
import { readSettings } from '../src/settings/index.js';
import { lastRun } from '../src/update-steps.js';
import { readRemote, serverStatus, listBackups } from '../src/remote/index.js';
import { healthProblems } from '../src/remote/health.js';
import { boardProjects, readProfile, findProfile, currentGenerated } from '../src/profiles/store.js';
import { aiProblems } from '../src/ai-access.js';

const remote = readRemote('data');
let server = null;
if (remote) {
  try {
    server = serverStatus(remote);
  } catch (e) {
    server = e;
  }
}
// 各榜单前 20 里还没有和当前资料对上的简介的项目（#52）。只读快照和项目资料文件，不开库；
// 分类榜上的项目没生成成功时，补资料这一步退出码为 1，上面“有步骤失败”会报。
const unfinished = boardProjects('data')
  .filter((p) => !currentGenerated(p.id ? readProfile('data', p.id) : findProfile('data', p.name)))
  .map((p) => p.name);
const settings = readSettings('data');
const problems = healthProblems({ run: lastRun('data'), settings, ai: aiProblems('data', settings), remote: Boolean(remote), server, backups: listBackups('data'), unfinished });
if (problems.length) console.log(`🌟 Github·Tidings 自检\n${problems.map((p) => `- ${p}`).join('\n')}`);
