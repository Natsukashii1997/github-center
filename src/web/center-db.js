// 账号、会话（#5）和收藏（#8）共用的库 data/center.db（Node 自带 SQLite）。网站和开账号命令会同时打开它：
// 用 WAL 让读写互不阻塞，碰上对方正在写就最多等 5 秒，而不是立刻报错。
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export function openCenterDb(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, 'center.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  return db;
}
