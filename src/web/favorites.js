// 收藏（#8）：登录后可以收藏一个项目，也可以只收藏仓库里的某个 Skill；收藏跟着账号走，每个人的只属于自己。
// 存在 data/center.db。一条收藏是“项目 id ＋ Skill 路径”，收藏整个项目时 Skill 路径为空；名字另存一份，项目改名或资料没了也能列出来。
// 候选（#78，PRD P0-04）：每条收藏另有决策状态（感兴趣／待研究／已采用／不采用，默认感兴趣）、收藏理由、下一步，
// 状态改变时间（从没改过为空），以及最近一次复制交接的类型和时间（只表示复制过，不代表做完）。都由服务器的网页写，Mac 不推、不覆盖。
import { openCenterDb } from './center-db.js';

export const STATUSES = ['int', 'res', 'yes', 'no'];
export const HANDOFF_TYPES = ['研究', '试用', '安装'];
export const TEXT_MAX = 500;
// 每页都带的这个人全部收藏的决策字段，键是"项目 id#Skill 路径"（整个项目路径为空）：详情栏的状态胶囊和交接要用（#79）。
export const decisionsOf = (favorites, accountId) => Object.fromEntries(favorites.list(accountId).map((f) => [`${f.projectId}#${f.skillPath}`, decisionOf(f)]));
// 页面和接口用的决策字段。
export const decisionOf = (f) => ({ status: f.status, reason: f.reason, next: f.next, statusAt: f.statusAt ?? null, handoff: f.handoffType ? { type: f.handoffType, at: f.handoffAt } : null });

// 旧库（#78 之前建的表）启动时补上新列；已有的收藏按默认值。
const DECISION_COLUMNS = {
  status: "TEXT NOT NULL DEFAULT 'int'", reason: "TEXT NOT NULL DEFAULT ''", next_step: "TEXT NOT NULL DEFAULT ''",
  status_at: 'TEXT', handoff_type: 'TEXT', handoff_at: 'TEXT',
};
const FIELDS = `project_id AS projectId, full_name AS fullName, skill_path AS skillPath, skill_name AS skillName, created_at AS createdAt,
  status, reason, next_step AS next, status_at AS statusAt, handoff_type AS handoffType, handoff_at AS handoffAt`;

export function openFavorites(dataDir) {
  const db = openCenterDb(dataDir);
  db.exec(`CREATE TABLE IF NOT EXISTS favorites(
    account_id INTEGER NOT NULL REFERENCES accounts(id), project_id INTEGER NOT NULL, full_name TEXT NOT NULL,
    skill_path TEXT NOT NULL DEFAULT '', skill_name TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
    PRIMARY KEY (account_id, project_id, skill_path))`);
  const have = new Set(db.prepare('PRAGMA table_info(favorites)').all().map((c) => c.name));
  for (const [name, type] of Object.entries(DECISION_COLUMNS)) if (!have.has(name)) db.exec(`ALTER TABLE favorites ADD COLUMN ${name} ${type}`);
  const one = (accountId, projectId, skillPath) => db.prepare(`SELECT ${FIELDS} FROM favorites WHERE account_id = ? AND project_id = ? AND skill_path = ?`).get(accountId, projectId, skillPath);
  return {
    // 已经收藏过的再收藏一次不报错。
    add: (accountId, { projectId, fullName, skillPath, skillName }) => void db
      .prepare('INSERT OR IGNORE INTO favorites(account_id, project_id, full_name, skill_path, skill_name, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(accountId, projectId, fullName, skillPath, skillName, new Date().toISOString()),
    remove: (accountId, projectId, skillPath) => void db.prepare('DELETE FROM favorites WHERE account_id = ? AND project_id = ? AND skill_path = ?').run(accountId, projectId, skillPath),
    // 这个人的全部收藏，新收藏的在前。
    list: (accountId) => db.prepare(`SELECT ${FIELDS} FROM favorites WHERE account_id = ? ORDER BY created_at DESC, rowid DESC`).all(accountId),
    // 这个人在某个项目上收藏了哪些（整个项目记为 ''）。
    savedIn: (accountId, projectId) => new Set(db.prepare('SELECT skill_path FROM favorites WHERE account_id = ? AND project_id = ?').all(accountId, projectId).map((r) => r.skill_path)),
    // 改状态、理由、下一步（只改给了的；值由调用方先校验）。状态真的变了才记状态改变时间。没收藏这一条返回 null。
    update: (accountId, projectId, skillPath, { status, reason, next }) => {
      const cur = one(accountId, projectId, skillPath);
      if (!cur) return null;
      const changed = status !== undefined && status !== cur.status;
      db.prepare('UPDATE favorites SET status = ?, reason = ?, next_step = ?, status_at = ? WHERE account_id = ? AND project_id = ? AND skill_path = ?')
        .run(status ?? cur.status, reason ?? cur.reason, next ?? cur.next, changed ? new Date().toISOString() : cur.statusAt, accountId, projectId, skillPath);
      return one(accountId, projectId, skillPath);
    },
    // 记最近一次复制交接；没收藏这一条就不记，返回 false。
    handoff: (accountId, projectId, skillPath, type) => db
      .prepare('UPDATE favorites SET handoff_type = ?, handoff_at = ? WHERE account_id = ? AND project_id = ? AND skill_path = ?')
      .run(type, new Date().toISOString(), accountId, projectId, skillPath).changes > 0,
    close: () => db.close(),
  };
}
