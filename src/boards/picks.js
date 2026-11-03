// 精选榜（#26）：精选标签清单、每个标签 7 张卡的名单、每个账号的赞踩，存在 data/center.db（和账号、收藏同一个库）。
// 精选榜是人工挑选加投票（需求 2026-11-03 重设计变更），和客观的涨星榜、历史榜、热点榜分开。
// 默认填法：Codex 按标签清单给候选项目建议标签（pick_pool.tags，见 picks-update.js），每个标签按总 Star 从高到低填满 7 张；
// 一个项目最多出现在 2 个标签里。所有者用“换卡”换掉某一张，换进来的固定（pinned），之后默认填法不再动它；“恢复成按星数前 7”取消固定、重新填。
// 赞踩：每个账号对“某个标签里的某个项目”最多一票（赞 +1 或踩 −1），可改、可撤回；所有人看到赞、踩总数。
//
// 网站调用（account 是登录后的账号 { id, name, role }）：
//   board(account)                         → { canEdit, tags: [{ id, name, color, order, manual, cards: [{ slot, projectId, fullName, ownerId, total, pinned, up, down, mine }] }] }
//   swap(account, { tagId, slot, project }) → 换卡并固定；project 是 { id, fullName, total?, ownerId? }
//   restore(account, tagId)                → 恢复成按星数前 7
//   vote(account, { tagId, projectId, value }) → value 1 赞、-1 踩、0 撤回；返回这张卡的 { up, down, mine }
//   candidates({ tagId, query, limit })    → 换卡面板的候选：不在这个标签里的项目，按总 Star 从高到低
//   addTag / updateTag / removeTag / reorderTags(account, ...) → 改标签清单
import { openCenterDb } from '../web/center-db.js';
import { parseRepoInput } from './repo-link.js';

export const SLOTS = 7;
export const MAX_TAGS_PER_PROJECT = 2;

// 权限（所有者还没确认，需求里写的是默认做法）：标签清单和换卡只有所有者能改；投票所有登录账号都能投。要改只改这一行。
export const canEdit = (account) => account?.role === 'owner';

// 第一次建表时放进去的标签清单（定稿原型 cat.html 的五类和配色），所有者之后可增删改。
export const DEFAULT_TAGS = [
  { name: '多 Agent 协同', color: '#8250df' },
  { name: '编程技能', color: '#1a7f37' },
  { name: '创作与设计', color: '#bf3989' },
  { name: '本地模型与记忆', color: '#0b6e66' },
  { name: '实用工具', color: '#bc4c00' },
];

// 标签清单的“指纹”：清单变了（增删、改名），候选项目要重新建议标签。
export const tagsetOf = (names) => JSON.stringify([...names].sort());

class PicksError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const deny = () => { throw new PicksError('只有所有者能改精选标签和换卡', 403); };
const COLOR = /^#[0-9a-fA-F]{6}$/;

export function openPicks(dataDir) {
  const db = openCenterDb(dataDir);
  const fresh = !db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'pick_tags'").get();
  db.exec(`
    CREATE TABLE IF NOT EXISTS pick_tags(id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, color TEXT NOT NULL, sort INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS pick_pool(project_id INTEGER PRIMARY KEY, full_name TEXT NOT NULL, owner_id INTEGER, total INTEGER,
      tags TEXT NOT NULL DEFAULT '[]', tagset TEXT, version TEXT, suggested_at TEXT, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS picks(tag_id INTEGER NOT NULL REFERENCES pick_tags(id), slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND ${SLOTS}),
      project_id INTEGER NOT NULL, full_name TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0, pinned_by INTEGER, pinned_at TEXT,
      PRIMARY KEY (tag_id, slot), UNIQUE (tag_id, project_id));
    CREATE TABLE IF NOT EXISTS pick_votes(account_id INTEGER NOT NULL REFERENCES accounts(id), tag_id INTEGER NOT NULL, project_id INTEGER NOT NULL,
      value INTEGER NOT NULL CHECK (value IN (1, -1)), at TEXT NOT NULL, PRIMARY KEY (account_id, tag_id, project_id));
  `);
  if (fresh) DEFAULT_TAGS.forEach((t, i) => db.prepare('INSERT INTO pick_tags(name, color, sort) VALUES (?, ?, ?)').run(t.name, t.color, i + 1));

  const tx = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const r = fn();
      db.exec('COMMIT');
      return r;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };
  const tags = () => db.prepare('SELECT id, name, color, sort AS "order" FROM pick_tags ORDER BY sort, id').all();
  const tagById = (id) => db.prepare('SELECT id, name, color, sort AS "order" FROM pick_tags WHERE id = ?').get(id) ?? null;
  const needTag = (id) => tagById(id) ?? (() => { throw new PicksError('没有这个精选标签', 404); })();
  const tagCount = (projectId, exceptTag) => db.prepare('SELECT COUNT(*) AS n FROM picks WHERE project_id = ? AND tag_id != ?').get(projectId, exceptTag).n;
  const counts = (tagId, projectId, accountId) => {
    const r = db.prepare('SELECT SUM(value = 1) AS up, SUM(value = -1) AS down FROM pick_votes WHERE tag_id = ? AND project_id = ?').get(tagId, projectId);
    const mine = accountId ? db.prepare('SELECT value FROM pick_votes WHERE tag_id = ? AND project_id = ? AND account_id = ?').get(tagId, projectId, accountId)?.value ?? 0 : 0;
    return { up: r.up ?? 0, down: r.down ?? 0, mine };
  };

  // 按默认填法补满这些标签里没固定的位置：先清掉没固定的，再按标签顺序，每个标签取建议了它、按总 Star 从高到低、
  // 还没在这个标签里、出现的标签还不到 2 个的项目。
  function refill(tagIds) {
    const all = tags();
    const todo = all.filter((t) => tagIds.includes(t.id));
    const pool = db.prepare('SELECT project_id, full_name, tags FROM pick_pool WHERE total IS NOT NULL ORDER BY total DESC, project_id').all()
      .map((r) => ({ id: r.project_id, fullName: r.full_name, tags: JSON.parse(r.tags) }));
    for (const t of todo) db.prepare('DELETE FROM picks WHERE tag_id = ? AND pinned = 0').run(t.id);
    const inTags = new Map();
    for (const r of db.prepare('SELECT project_id FROM picks').all()) inTags.set(r.project_id, (inTags.get(r.project_id) ?? 0) + 1);
    const insert = db.prepare('INSERT INTO picks(tag_id, slot, project_id, full_name, pinned) VALUES (?, ?, ?, ?, 0)');
    for (const t of todo) {
      const taken = db.prepare('SELECT slot, project_id FROM picks WHERE tag_id = ?').all(t.id);
      const here = new Set(taken.map((r) => r.project_id));
      const free = Array.from({ length: SLOTS }, (_, i) => i + 1).filter((s) => !taken.some((r) => r.slot === s));
      for (const p of pool) {
        if (!free.length) break;
        if (!p.tags.includes(t.name) || here.has(p.id) || (inTags.get(p.id) ?? 0) >= MAX_TAGS_PER_PROJECT) continue;
        insert.run(t.id, free.shift(), p.id, p.fullName);
        here.add(p.id);
        inTags.set(p.id, (inTags.get(p.id) ?? 0) + 1);
      }
    }
  }

  return {
    canEdit,
    tags,
    tagset: () => tagsetOf(tags().map((t) => t.name)),

    board(account) {
      const cards = db.prepare(`SELECT p.tag_id, p.slot, p.project_id, p.full_name, p.pinned, pool.owner_id, pool.total FROM picks p
        LEFT JOIN pick_pool pool ON pool.project_id = p.project_id ORDER BY p.tag_id, p.slot`).all();
      return {
        canEdit: canEdit(account),
        tags: tags().map((t) => {
          const mine = cards.filter((c) => c.tag_id === t.id).map((c) => ({
            slot: c.slot, projectId: c.project_id, fullName: c.full_name, ownerId: c.owner_id ?? null, total: c.total ?? null, pinned: !!c.pinned,
            ...counts(t.id, c.project_id, account?.id),
          }));
          return { ...t, manual: mine.filter((c) => c.pinned).length, cards: mine };
        }),
      };
    },

    // 换卡：把 tagId 的第 slot 张换成 project（固定下来）。project 已在这个标签里、或已在另外 2 个标签里时拒绝。
    swap(account, { tagId, slot, project }) {
      if (!canEdit(account)) deny();
      return tx(() => {
        const tag = needTag(tagId);
        if (!Number.isInteger(slot) || slot < 1 || slot > SLOTS) throw new PicksError(`位置只能是 1 到 ${SLOTS}`);
        if (!Number.isInteger(project?.id) || project.id <= 0 || !parseRepoInput(project.fullName)) throw new PicksError('项目要有 GitHub 项目 id 和 作者/仓库名');
        const there = db.prepare('SELECT slot FROM picks WHERE tag_id = ? AND project_id = ?').get(tag.id, project.id);
        if (there && there.slot !== slot) throw new PicksError(`「${project.fullName}」已经在「${tag.name}」里了`, 409);
        if (tagCount(project.id, tag.id) >= MAX_TAGS_PER_PROJECT) throw new PicksError(`「${project.fullName}」已经在 ${MAX_TAGS_PER_PROJECT} 个标签里了`, 409);
        const now = new Date().toISOString();
        // 榜外项目（粘贴地址换进来的）也记进候选池，卡片才有总 Star 和头像；不覆盖已有的建议标签。
        db.prepare(`INSERT INTO pick_pool(project_id, full_name, owner_id, total, updated_at) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(project_id) DO UPDATE SET full_name = excluded.full_name, owner_id = COALESCE(excluded.owner_id, owner_id), total = COALESCE(excluded.total, total), updated_at = excluded.updated_at`)
          .run(project.id, project.fullName, project.ownerId ?? null, project.total ?? null, now);
        db.prepare('DELETE FROM picks WHERE tag_id = ? AND slot = ?').run(tag.id, slot);
        db.prepare('INSERT INTO picks(tag_id, slot, project_id, full_name, pinned, pinned_by, pinned_at) VALUES (?, ?, ?, ?, 1, ?, ?)').run(tag.id, slot, project.id, project.fullName, account.id, now);
      });
    },

    // 恢复成按星数前 7：这个标签的卡全部取消固定，按默认填法重填。
    restore(account, tagId) {
      if (!canEdit(account)) deny();
      tx(() => {
        needTag(tagId);
        db.prepare('DELETE FROM picks WHERE tag_id = ?').run(tagId);
        refill([tagId]);
      });
    },

    // 默认填法重填全部标签里没固定的位置（每天 npm run picks 建议完标签后跑；不需要账号）。
    refill: () => tx(() => refill(tags().map((t) => t.id))),

    vote(account, { tagId, projectId, value }) {
      if (!account?.id) throw new PicksError('登录后才能投票', 401);
      if (![1, -1, 0].includes(value)) throw new PicksError('投票只能是 1（赞）、-1（踩）或 0（撤回）');
      if (!db.prepare('SELECT 1 FROM picks WHERE tag_id = ? AND project_id = ?').get(tagId, projectId)) throw new PicksError('这个标签里没有这张卡', 404);
      if (value === 0) db.prepare('DELETE FROM pick_votes WHERE account_id = ? AND tag_id = ? AND project_id = ?').run(account.id, tagId, projectId);
      else db.prepare(`INSERT INTO pick_votes(account_id, tag_id, project_id, value, at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(account_id, tag_id, project_id) DO UPDATE SET value = excluded.value, at = excluded.at`).run(account.id, tagId, projectId, value, new Date().toISOString());
      return counts(tagId, projectId, account.id);
    },

    // 换卡面板的候选：候选池里不在这个标签里的项目，按总 Star 从高到低；query 按仓库名（或粘贴的 GitHub 地址）过滤。
    // 另带 inTags（已在几个标签里），满 2 个的换不进来。
    candidates({ tagId, query = '', limit = 50 }) {
      const repo = parseRepoInput(query);
      const q = (repo ?? query.trim()).toLowerCase();
      return db.prepare(`SELECT pool.project_id AS projectId, pool.full_name AS fullName, pool.owner_id AS ownerId, pool.total,
          (SELECT COUNT(*) FROM picks p WHERE p.project_id = pool.project_id) AS inTags
        FROM pick_pool pool WHERE pool.project_id NOT IN (SELECT project_id FROM picks WHERE tag_id = ?)
          AND (? = '' OR instr(lower(pool.full_name), ?) > 0)
        ORDER BY pool.total IS NULL, pool.total DESC, pool.project_id LIMIT ?`).all(tagId, q, q, limit);
    },

    addTag(account, { name, color }) {
      if (!canEdit(account)) deny();
      const n = String(name ?? '').trim();
      if (!n || n.length > 20) throw new PicksError('标签名要 1 到 20 个字');
      if (!COLOR.test(color ?? '')) throw new PicksError('颜色写成 #rrggbb');
      if (db.prepare('SELECT 1 FROM pick_tags WHERE name = ?').get(n)) throw new PicksError(`已经有标签「${n}」`, 409);
      const sort = (db.prepare('SELECT MAX(sort) AS m FROM pick_tags').get().m ?? 0) + 1;
      return Number(db.prepare('INSERT INTO pick_tags(name, color, sort) VALUES (?, ?, ?)').run(n, color, sort).lastInsertRowid);
    },
    // 改名或改颜色。改名时候选池里已有的建议跟着改名（当作同一个标签，不重新建议）。
    updateTag(account, tagId, { name, color }) {
      if (!canEdit(account)) deny();
      const tag = needTag(tagId);
      const n = name === undefined ? tag.name : String(name).trim();
      if (!n || n.length > 20) throw new PicksError('标签名要 1 到 20 个字');
      if (color !== undefined && !COLOR.test(color)) throw new PicksError('颜色写成 #rrggbb');
      if (n !== tag.name && db.prepare('SELECT 1 FROM pick_tags WHERE name = ?').get(n)) throw new PicksError(`已经有标签「${n}」`, 409);
      tx(() => {
        const oldSet = tagsetOf(tags().map((t) => t.name));
        db.prepare('UPDATE pick_tags SET name = ?, color = ? WHERE id = ?').run(n, color ?? tag.color, tagId);
        if (n === tag.name) return;
        const newSet = tagsetOf(tags().map((t) => t.name));
        const st = db.prepare('UPDATE pick_pool SET tags = ?, tagset = ? WHERE project_id = ?');
        for (const r of db.prepare('SELECT project_id, tags, tagset FROM pick_pool').all()) {
          const list = JSON.parse(r.tags).map((x) => (x === tag.name ? n : x));
          st.run(JSON.stringify(list), r.tagset === oldSet ? newSet : r.tagset, r.project_id);
        }
      });
    },
    // 删标签：连同它的名单和赞踩一起删；候选池里的建议去掉这个标签（不重新建议）。加标签则要等下次 npm run picks 重新建议。
    removeTag(account, tagId) {
      if (!canEdit(account)) deny();
      tx(() => {
        const tag = needTag(tagId);
        const oldSet = tagsetOf(tags().map((t) => t.name));
        db.prepare('DELETE FROM pick_votes WHERE tag_id = ?').run(tagId);
        db.prepare('DELETE FROM picks WHERE tag_id = ?').run(tagId);
        db.prepare('DELETE FROM pick_tags WHERE id = ?').run(tagId);
        const newSet = tagsetOf(tags().map((t) => t.name));
        const st = db.prepare('UPDATE pick_pool SET tags = ?, tagset = ? WHERE project_id = ?');
        for (const r of db.prepare('SELECT project_id, tags, tagset FROM pick_pool').all()) {
          st.run(JSON.stringify(JSON.parse(r.tags).filter((x) => x !== tag.name)), r.tagset === oldSet ? newSet : r.tagset, r.project_id);
        }
      });
    },
    // 按给定的 id 顺序排标签（要给全部标签）。
    reorderTags(account, ids) {
      if (!canEdit(account)) deny();
      const have = tags().map((t) => t.id);
      if (ids.length !== have.length || !have.every((id) => ids.includes(id))) throw new PicksError('要给出全部标签的新顺序');
      tx(() => ids.forEach((id, i) => db.prepare('UPDATE pick_tags SET sort = ? WHERE id = ?').run(i + 1, id)));
    },

    // 候选池（picks-update.js 用）：更新名字、总 Star、作者 id；返回还没按当前标签清单建议过的项目 id。
    upsertPool(rows) {
      const now = new Date().toISOString();
      const up = db.prepare(`INSERT INTO pick_pool(project_id, full_name, owner_id, total, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(project_id) DO UPDATE SET full_name = excluded.full_name, owner_id = COALESCE(excluded.owner_id, owner_id), total = excluded.total, updated_at = excluded.updated_at`);
      tx(() => rows.forEach((r) => up.run(r.id, r.fullName, r.ownerId ?? null, r.total, now)));
      const set = tagsetOf(tags().map((t) => t.name));
      const done = db.prepare('SELECT tagset FROM pick_pool WHERE project_id = ?');
      return rows.filter((r) => done.get(r.id)?.tagset !== set).map((r) => r.id);
    },
    // 记下 Codex 建议的标签（只认当前清单里的名字，最多 2 个）。
    saveSuggestions(results, { version }) {
      const names = tags().map((t) => t.name);
      const set = tagsetOf(names);
      const now = new Date().toISOString();
      const st = db.prepare('UPDATE pick_pool SET tags = ?, tagset = ?, version = ?, suggested_at = ? WHERE project_id = ?');
      tx(() => results.forEach((r) => st.run(JSON.stringify(pickTags(r.tags, names)), set, version, now, r.projectId)));
    },
    close: () => db.close(),
  };
}

// 只认清单里的名字，去重，最多 2 个。
export const pickTags = (raw, names) => [...new Set((Array.isArray(raw) ? raw : []).filter((t) => names.includes(t)))].slice(0, MAX_TAGS_PER_PROJECT);
export { PicksError };
