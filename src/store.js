// 文件存储（全项目共用：设置、调度、资料、归类、周报、各榜单都用）：读写 JSON、先写临时文件再改名、按路径只写一次；
// 每次运行的官方原始响应单独存放；快照按榜单（涨星榜的每个窗口各算一个）和统计日只写一次，已存在就不覆盖；
// 另存每个榜单最近一次更新的结果。涨星榜专用的已核数候选和全站 Star 事件合计在 ranking/files.js（#114 从这里拆出）。
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, renameSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';

const snapshotPath = (board, day) => join('snapshots', board, `${day}.json`);
export const readJson = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null);

// 先写临时文件再改名，中途断掉不会留下半个文件；临时文件名各次运行不同，两次运行撞上也不互相踩。
export function writeAtomic(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

export function openStore(dataDir, runId) {
  return {
    saveRaw(kind, name, res, ext = 'json') {
      const path = join('runs', runId, 'raw', kind, `${name}.${ext}`);
      mkdirSync(dirname(join(dataDir, path)), { recursive: true });
      writeFileSync(join(dataDir, path), res.body);
      return { url: res.url, path, sha256: createHash('sha256').update(res.body).digest('hex'), date: res.date };
    },
    publish: (board, snapshot) => writeOnce(dataDir, snapshotPath(board, snapshot.statDay), JSON.stringify(snapshot, null, 2)),
  };
}

// 按路径只写一次：已存在就不覆盖（快照、候选、日报都用）。
export function writeOnce(dataDir, path, text) {
  mkdirSync(dirname(join(dataDir, path)), { recursive: true });
  try {
    writeFileSync(join(dataDir, path), text + '\n', { flag: 'wx' });
    return { status: 'published', path };
  } catch (e) {
    if (e.code === 'EEXIST') return { status: 'exists', path };
    throw e;
  }
}

export function findSnapshot(dataDir, board, day) {
  const path = snapshotPath(board, day);
  const snapshot = readJson(join(dataDir, path));
  return snapshot ? { path, snapshot } : null;
}

export function readLatestSnapshot(dataDir, board = 'd1') {
  const dir = join(dataDir, 'snapshots', board);
  if (!existsSync(dir)) return null;
  const latest = readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().pop();
  return latest ? readJson(join(dir, latest)) : null;
}

// 每个榜单只记最新统计日的结果：重跑更早的日子不会盖掉更新的失败记录。
export function recordStatus(dataDir, { day, at, boards }) {
  const status = readStatus(dataDir) ?? { boards: {} };
  for (const [board, r] of Object.entries(boards)) {
    if ((status.boards[board]?.day ?? '') > day) continue;
    status.boards[board] = { day, at, status: r.status, ...(r.error ? { error: r.error } : {}) };
  }
  writeAtomic(join(dataDir, 'status.json'), JSON.stringify(status, null, 2) + '\n');
}

// 某个榜单比当前快照更新的那天更新失败了（重跑更早的日子失败不算）：页面保留快照，写明失败的日期和原因。
export function newerFailure(status, board, snapshot) {
  const last = status?.boards?.[board];
  return last?.status === 'failed' && (!snapshot || last.day > snapshot.statDay) ? last : null;
}

// 2026-10-23 #9 之前这个文件只记涨星榜，键名是 windows；读的时候并进 boards。
export function readStatus(dataDir) {
  const s = readJson(join(dataDir, 'status.json'));
  return s && { boards: { ...s.windows, ...s.boards } };
}
