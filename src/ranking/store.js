// 文件存储：每次运行的官方原始响应单独存放；快照按统计日只写一次，已存在就不覆盖。
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';

export const WINDOW = 'd1';
const snapshotDir = join('snapshots', WINDOW);
const snapshotPath = (day) => join(snapshotDir, `${day}.json`);

export function openStore(dataDir, runId) {
  return {
    saveRaw(kind, name, res) {
      const path = join('runs', runId, 'raw', kind, `${name}.json`);
      mkdirSync(dirname(join(dataDir, path)), { recursive: true });
      writeFileSync(join(dataDir, path), res.body);
      return { url: res.url, path, sha256: createHash('sha256').update(res.body).digest('hex'), date: res.date };
    },
    publish(snapshot) {
      const path = snapshotPath(snapshot.statDay);
      mkdirSync(join(dataDir, snapshotDir), { recursive: true });
      try {
        writeFileSync(join(dataDir, path), JSON.stringify(snapshot, null, 2) + '\n', { flag: 'wx' });
        return { status: 'published', path };
      } catch (e) {
        if (e.code === 'EEXIST') return { status: 'exists', path };
        throw e;
      }
    },
  };
}

export function findSnapshot(dataDir, day) {
  const path = snapshotPath(day);
  return existsSync(join(dataDir, path)) ? { path, snapshot: JSON.parse(readFileSync(join(dataDir, path), 'utf8')) } : null;
}

export function readLatestSnapshot(dataDir) {
  const dir = join(dataDir, snapshotDir);
  if (!existsSync(dir)) return null;
  const latest = readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().pop();
  return latest ? JSON.parse(readFileSync(join(dir, latest), 'utf8')) : null;
}
