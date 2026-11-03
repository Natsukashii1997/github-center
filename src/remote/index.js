// 放到服务器上（#46，部署见 docs/deploy.md）：网站在服务器上跑、要登录；每日更新照旧在 Mac 上跑（大陆服务器连不上 GitHub、GH Archive、OpenAI），
// 跑完把网站要的数据推到服务器。两边都写的东西以服务器为准：
//   - 设置（data/settings.json）在服务器的设置页改：每日更新开头先拉回来（pullSettings）。
//   - 账号、收藏、精选标签、换卡、投票在服务器的库里（data/center.db）：库不推、不覆盖。精选榜的候选池和 Codex 建议在 Mac 上算：
//     算之前拉服务器的标签清单和固定的卡（pullPicks），算完把候选池写成 data/pick-pool.json 随数据推上去，由服务器写进库并补卡（scripts/server.sh apply）。
//   - 其余数据（榜单、快照、资料、归类、周报等）只有 Mac 写：pushData 用 rsync 推上去，不推 PUSH_EXCLUDE 里的。
// 连接配置 data/remote.json（不入库）：{ "ssh": "root@服务器", "key": "~/.ssh/私钥", "dir": "/srv/tidings" }。没有这个文件就是只在本机跑，这里什么都不做。
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readJson, writeAtomic } from '../ranking/store.js';
import { openPicks } from '../boards/index.js';

export const PUSH_EXCLUDE = ['runs/', 'logs/', 'center.db', 'center.db-*', 'settings.json', 'update-state.json', 'remote.json', '*.tmp'];
export const POOL_FILE = 'pick-pool.json';

export function readRemote(dataDir) {
  const cfg = readJson(join(dataDir, 'remote.json'));
  if (!cfg) return null;
  if (!cfg.ssh || !cfg.dir) throw new Error('data/remote.json 要有 ssh 和 dir');
  return { ...cfg, key: cfg.key?.replace(/^~(?=\/)/, homedir()) };
}

// ssh 只用这把钥匙、不问密码（launchd 里没人能回答），连不上 15 秒就放弃。run 可换成测试替身。
const sshArgs = (cfg) => [...(cfg.key ? ['-i', cfg.key, '-o', 'IdentitiesOnly=yes'] : []), '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15'];
const defaultRun = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
// 在服务器上跑 scripts/server.sh 的一个子命令，返回标准输出；失败抛错（带服务器的报错）。
function server(cfg, sub, run) {
  const r = run('/usr/bin/ssh', [...sshArgs(cfg), cfg.ssh, `bash ${cfg.dir}/scripts/server.sh ${sub}`]);
  if (r.status !== 0) throw new Error(`服务器 ${sub} 失败（退出码 ${r.status ?? r.error?.message}）：${(r.stderr ?? '').trim().slice(-300)}`);
  return r.stdout;
}

// 服务器上存过设置就拉回来覆盖本机这份；服务器还没存过（输出为空）就不动本机的。返回是否拉到。
export function pullSettings(dataDir, cfg, run = defaultRun) {
  const text = server(cfg, 'settings', run);
  if (!text.trim()) return false;
  JSON.parse(text);
  writeAtomic(join(dataDir, 'settings.json'), text);
  return true;
}

// 把服务器的标签清单和固定的卡照搬进本机库。返回 { tags, pinned } 的个数。
export function pullPicks(dataDir, cfg, run = defaultRun) {
  const state = JSON.parse(server(cfg, 'picks-state', run));
  const picks = openPicks(dataDir);
  try {
    picks.mirror(state);
  } finally {
    picks.close();
  }
  return { tags: state.tags.length, pinned: state.pinned.length };
}

// 本机候选池写成 data/pick-pool.json，等 pushData 推上去。
export function writePool(dataDir) {
  const picks = openPicks(dataDir);
  try {
    const rows = picks.exportPool();
    writeAtomic(join(dataDir, POOL_FILE), JSON.stringify(rows) + '\n');
    return rows.length;
  } finally {
    picks.close();
  }
}

// rsync 推数据（只增改、不删服务器上的文件），再让服务器把候选池写进库、补卡。
export function pushData(dataDir, cfg, run = defaultRun) {
  const ssh = ['/usr/bin/ssh', ...sshArgs(cfg)].join(' ');
  const r = run('/usr/bin/rsync', ['-rtz', ...PUSH_EXCLUDE.map((p) => `--exclude=${p}`), '-e', ssh, `${dataDir.replace(/\/?$/, '/')}`, `${cfg.ssh}:${cfg.dir}/data/`]);
  if (r.status !== 0) throw new Error(`rsync 失败（退出码 ${r.status ?? r.error?.message}）：${(r.stderr ?? '').trim().slice(-300)}`);
  return server(cfg, 'apply', run).trim();
}
