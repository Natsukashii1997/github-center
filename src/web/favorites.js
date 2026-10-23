// 收藏（#8）：登录后可以收藏一个项目，也可以只收藏仓库里的某个 Skill；收藏跟着账号走，每个人的只属于自己。
// 存在 data/center.db。一条收藏是“项目 id ＋ Skill 路径”，收藏整个项目时 Skill 路径为空；名字另存一份，项目改名或资料没了也能列出来。
import { openCenterDb } from './accounts.js';

export function openFavorites(dataDir) {
  const db = openCenterDb(dataDir);
  db.exec(`CREATE TABLE IF NOT EXISTS favorites(
    account_id INTEGER NOT NULL REFERENCES accounts(id), project_id INTEGER NOT NULL, full_name TEXT NOT NULL,
    skill_path TEXT NOT NULL DEFAULT '', skill_name TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
    PRIMARY KEY (account_id, project_id, skill_path))`);
  return {
    // 已经收藏过的再收藏一次不报错。
    add: (accountId, { projectId, fullName, skillPath = '', skillName = '' }) => void db
      .prepare('INSERT OR IGNORE INTO favorites(account_id, project_id, full_name, skill_path, skill_name, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(accountId, projectId, fullName, skillPath, skillName, new Date().toISOString()),
    remove: (accountId, projectId, skillPath = '') => void db.prepare('DELETE FROM favorites WHERE account_id = ? AND project_id = ? AND skill_path = ?').run(accountId, projectId, skillPath),
    // 这个人的全部收藏，新收藏的在前。
    list: (accountId) => db.prepare('SELECT project_id AS projectId, full_name AS fullName, skill_path AS skillPath, skill_name AS skillName, created_at AS createdAt FROM favorites WHERE account_id = ? ORDER BY created_at DESC, rowid DESC').all(accountId),
    // 这个人在某个项目上收藏了哪些（整个项目记为 ''）。
    savedIn: (accountId, projectId) => new Set(db.prepare('SELECT skill_path FROM favorites WHERE account_id = ? AND project_id = ?').all(accountId, projectId).map((r) => r.skill_path)),
    close: () => db.close(),
  };
}
