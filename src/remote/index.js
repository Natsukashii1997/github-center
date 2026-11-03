// 放到服务器上（#46，部署见 docs/deploy.md）：网站在服务器上跑、要登录；每日更新照旧在 Mac 上跑（大陆服务器连不上 GitHub、GH Archive、OpenAI），
// 跑完把网站要的数据推到服务器。两边都写的东西以服务器为准：
//   - 设置（data/settings.json）在服务器的设置页改：每日更新开头先拉回来（pullSettings）。
//   - 账号、收藏、精选标签、换卡、投票在服务器的库里（data/center.db）：库不推、不覆盖。精选榜的候选池和 Codex 建议在 Mac 上算：
//     算之前拉服务器的标签清单和固定的卡（pullPicks），算完把候选池写成 data/pick-pool.json 随数据推上去，由服务器写进库并补卡（scripts/server.sh apply）。
//   - 其余数据（榜单、快照、资料、归类、周报等）只有 Mac 写：pushData 用 rsync 推上去，不推 PUSH_EXCLUDE 里的。
//   - 服务器的库每天推完后备份回 Mac（backupDb，#48）：data/backups/center-<北京时间日期>.db，留 BACKUP_KEEP 份。
// 连接配置 data/remote.json（不入库）：{ "ssh": "root@服务器", "key": "~/.ssh/私钥", "dir": "/srv/tidings" }。没有这个文件就是只在本机跑，这里什么都不做。
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readdirSync, renameSync, rmSync } from 'node:fs';
import { readJson, writeAtomic } from '../ranking/store.js';
import { openPicks } from '../boards/index.js';

export const PUSH_EXCLUDE = ['runs/', 'logs/', 'backups/', 'center.db', 'center.db-*', 'settings.json', 'update-state.json', 'remote.json', '*.tmp'];
export const POOL_FILE = 'pick-pool.json';

export function readRemote(dataDir) {
  const cfg = readJson(join(dataDir, 'remote.json'));
  if (!cfg) return null;
  if (!cfg.ssh || !cfg.dir) throw new Error('data/remote.json 要有 ssh 和 dir');
  return { ...cfg, key: cfg.key?.replace(/^~(?=\/)/, homedir()) };
}

// ssh 只用这把钥匙、不问密码（launchd 里没人能回答），连不上 15 秒就放弃。run 可换成测试替身。
const sshArgs = (cfg) => [...(cfg.key ? ['-i', cfg.key, '-o', 'IdentitiesOnly=yes'] : []), '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15'];
const defaultRun = (cmd, args, encoding = 'utf8') => spawnSync(cmd, args, { encoding, maxBuffer: 256 * 1024 * 1024 });
// 在服务器上跑 scripts/server.sh 的一个子命令，返回标准输出（encoding 为 'buffer' 时是原样字节）；失败抛错（带服务器的报错）。
function server(cfg, sub, run, encoding) {
  const r = run('/usr/bin/ssh', [...sshArgs(cfg), cfg.ssh, `bash ${cfg.dir}/scripts/server.sh ${sub}`], encoding);
  if (r.status !== 0) throw new Error(`服务器 ${sub} 失败（退出码 ${r.status ?? r.error?.message}）：${String(r.stderr ?? '').trim().slice(-300)}`);
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

// 备份服务器的库（#48）：服务器用 sqlite3 .backup 做一份一致的副本传回来，本机打开核对完整、读得出账号，才存成
// data/backups/center-<day>.db（同一天再备份就覆盖）；只留最新 BACKUP_KEEP 份。返回 { path, accounts, removed }。
export const BACKUP_KEEP = 14;
export const BACKUP_DIR = 'backups';
export function backupDb(dataDir, cfg, day, run = defaultRun) {
  const bytes = server(cfg, 'backup', run, 'buffer');
  const dir = join(dataDir, BACKUP_DIR);
  const tmp = join(dir, `.center-${day}.db.tmp`);
  writeAtomic(tmp, bytes);
  let accounts;
  try {
    // 服务器的库是 WAL 模式，副本转成单文件（journal_mode = DELETE），以后打开不会在备份目录里留下 -wal、-shm。
    const db = new DatabaseSync(tmp);
    try {
      const check = db.prepare('PRAGMA integrity_check').get().integrity_check;
      if (check !== 'ok') throw new Error(`完整性检查没通过：${check}`);
      accounts = db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n;
      db.exec('PRAGMA journal_mode = DELETE');
    } finally {
      db.close();
    }
    if (!accounts) throw new Error('库里没有账号');
  } catch (e) {
    for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) rmSync(f, { force: true });
    throw new Error(`备份的库不能用，没存：${e.message}`);
  }
  const path = join(dir, `center-${day}.db`);
  renameSync(tmp, path);
  const removed = listBackups(dataDir).slice(BACKUP_KEEP);
  for (const f of removed) rmSync(join(dir, f), { force: true });
  return { path, accounts, removed };
}
// 已有的备份文件名，新的在前。
export const listBackups = (dataDir) => {
  try {
    return readdirSync(join(dataDir, BACKUP_DIR)).filter((f) => /^center-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().reverse();
  } catch {
    return [];
  }
};
// 服务器上网站服务的状态（'active' 表示在跑），健康检查用（#48）。
export const serverStatus = (cfg, run = defaultRun) => server(cfg, 'status', run).trim();
