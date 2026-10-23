// 账号与登录会话（#5）：不开放注册，所有者在本机用命令开账号（自己的和伙伴的）、重置密码。
// 密码由命令随机生成、只显示一次，库里只存 scrypt 哈希（每个账号单独加盐）；
// 登录后发一个随机会话令牌放在 Cookie 里，库里只存令牌的哈希，30 天后失效。存在 data/center.db（Node 自带 SQLite）。
import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { openCenterDb } from './center-db.js';

export const SESSION_DAYS = 30;
export const ROLES = { owner: '所有者', partner: '伙伴' };
const hashToken = (token) => createHash('sha256').update(token).digest('hex');
const hashPassword = (password, salt) => scryptSync(password, salt, 64).toString('hex');
const newPassword = () => randomBytes(12).toString('base64url');

export function openAccounts(dataDir) {
  const db = openCenterDb(dataDir);
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts(id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, role TEXT NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES accounts(id), expires_at INTEGER NOT NULL);
  `);
  const byName = db.prepare('SELECT * FROM accounts WHERE name = ?');
  const newCredentials = () => {
    const password = newPassword();
    const salt = randomBytes(16).toString('hex');
    return { password, salt, hash: hashPassword(password, salt) };
  };
  return {
    // 新建账号，返回初始密码（只此一次）。所有者只能有一个。
    create({ name, role }) {
      if (!/^[\p{L}\p{N}._-]{1,32}$/u.test(name)) throw new Error('账号名只能用字母、数字、汉字和 . _ -，最长 32 个字');
      if (!Object.hasOwn(ROLES, role)) throw new Error(`身份只能是 ${Object.keys(ROLES).join(' 或 ')}`);
      if (byName.get(name)) throw new Error(`已经有账号 ${name}`);
      const owner = db.prepare("SELECT name FROM accounts WHERE role = 'owner'").get();
      if (role === 'owner' && owner) throw new Error(`已经有所有者账号 ${owner.name}；伙伴账号请加 --partner`);
      // 账号和密码哈希一条语句写进去，不会留下没有密码的半成品账号。
      const { password, salt, hash } = newCredentials();
      db.prepare('INSERT INTO accounts(name, role, salt, hash, created_at) VALUES (?, ?, ?, ?, ?)').run(name, role, salt, hash, new Date().toISOString());
      return password;
    },
    // 重置密码，返回新密码；这个账号已登录的地方全部退出。
    resetPassword(name) {
      const account = byName.get(name);
      if (!account) throw new Error(`没有账号 ${name}`);
      const { password, salt, hash } = newCredentials();
      db.prepare('DELETE FROM sessions WHERE account_id = ?').run(account.id);
      db.prepare('UPDATE accounts SET salt = ?, hash = ? WHERE id = ?').run(salt, hash, account.id);
      return password;
    },
    list: () => db.prepare('SELECT name, role, created_at FROM accounts ORDER BY id').all(),
    // 账号密码对就返回新会话令牌，不对返回 null。
    login(name, password, now = Date.now()) {
      const account = byName.get(name);
      const expected = Buffer.from(account?.hash ?? '0'.repeat(128), 'hex');
      const actual = Buffer.from(hashPassword(String(password), account?.salt ?? 'no-such-account'), 'hex');
      if (!account || !timingSafeEqual(expected, actual)) return null;
      const token = randomBytes(32).toString('base64url');
      db.prepare('INSERT INTO sessions(token_hash, account_id, expires_at) VALUES (?, ?, ?)').run(hashToken(token), account.id, now + SESSION_DAYS * 86400e3);
      return token;
    },
    // 有效会话返回账号（id、名字和身份），过期的顺手删掉。
    session(token, now = Date.now()) {
      if (!token) return null;
      db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
      return db.prepare('SELECT a.id, a.name, a.role FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ?').get(hashToken(token)) ?? null;
    },
    logout: (token) => void db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token ?? '')),
    close: () => db.close(),
  };
}
