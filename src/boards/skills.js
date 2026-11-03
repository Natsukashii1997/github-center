// Skill 历史榜（所有者 2026-11-03 改定：分类榜的历史榜按 Skill 安装量排）：每天抓一次 skills.sh 首页，
// 页面里嵌着全时段排行榜（几百个 Skill，每个带来源 source、skillId、名字、累计安装量 installs），按安装量倒序全部存下。
// 网站上同一来源（GitHub 仓库或网站）的几个 Skill 合成一行，按其中安装量最高的一个排，展示前 50 个来源（所有者 2026-11-03 定）。
// 只读公开页面、不调用它的 /api/（要 Vercel OIDC token）；条款允许合理使用和自存缓存，robots.txt 允许首页。
// 同一天（UTC）已存过就不再请求；失败时保留上一次快照，status.json 记下失败的日期和原因（同历史榜 history.js）。
import { join } from 'node:path';
import { openStore, findSnapshot, readLatestSnapshot, readStatus, recordStatus, newerFailure, writeOnce } from '../ranking/store.js';

export const BOARD = 'skills';
export const URL = 'https://www.skills.sh/';
export const SHOW = 50;
// 少于这么多条就当页面结构变了，不发布。
const MIN = 50;
export const NOTE = '数据来自 skills.sh 全时段排行榜。同一来源的几个 Skill 合成一行，数字是其中安装量最高的那个 Skill 的累计安装次数。';

// 页面里每个 Skill 是一段 JSON（嵌在脚本里，引号转义成 \"）。source 是 GitHub 的 作者/仓库，少数是网址（如 open.feishu.cn）。
const ITEM = /\{"source":"([^"]+)","skillId":"([^"]+)","name":"([^"]+)","installs":(\d+)/g;
const REPO = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/;

export function parseSkills(html) {
  const text = String(html).replaceAll('\\"', '"');
  const bySkill = new Map();
  for (const [, source, skillId, name, installs] of text.matchAll(ITEM)) {
    const k = `${source}/${skillId}`.toLowerCase();
    if (!bySkill.has(k)) bySkill.set(k, { source, skillId, name, installs: Number(installs) });
  }
  if (bySkill.size < MIN) throw new Error(`页面里只认出 ${bySkill.size} 个 Skill，页面结构可能变了，不发布`);
  return [...bySkill.values()]
    .sort((a, b) => b.installs - a.installs || a.name.localeCompare(b.name))
    .map((s) => ({ s, repo: REPO.test(s.source) ? s.source : null }))
    .map(({ s, repo }, n) => ({
      rank: n + 1,
      skill: s.name,
      skillId: s.skillId,
      source: s.source,
      // GitHub 仓库才有；网址来源的为 null（网站上点了去 skills.sh）。
      repo,
      installs: s.installs,
      // skills.sh 上的页面：GitHub 来源是 /作者/仓库/skillId，网址来源是 /site/网址/skillId。
      url: `https://skills.sh/${repo ? '' : 'site/'}${s.source}/${s.skillId}`,
    }));
}

// 按来源合成一行（entries 已按安装量倒序）：名字和安装量取最高的那个 Skill，count 是这个来源上榜的 Skill 个数。
// 一个来源只有一个 Skill 时链到这个 Skill 的页面，有几个时链到 skills.sh 上这个来源的页面。
export function groupBySource(entries) {
  const bySource = new Map();
  for (const e of entries) {
    const g = bySource.get(e.source.toLowerCase());
    if (g) g.count++;
    else bySource.set(e.source.toLowerCase(), { skill: e.skill, source: e.source, repo: e.repo, installs: e.installs, count: 1, url: e.url });
  }
  return [...bySource.values()].map((g, n) => ({
    rank: n + 1,
    ...g,
    url: g.count > 1 ? `https://skills.sh/${g.repo ? '' : 'site/'}${g.source}` : g.url,
  }));
}

// 跑一次：返回 { status: 'published' | 'exists' | 'failed', path?, snapshot?, error?, requests }。
// 请求或读页面出错时隔 5 秒再试一次（偶尔会很慢）；返回不是 200 不重试。
export async function updateSkills({ dataDir, fetch = globalThis.fetch, now = () => new Date(), timeoutMs = 30_000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const at = now();
  const day = at.toISOString().slice(0, 10);
  const done = findSnapshot(dataDir, BOARD, day);
  if (done) return { status: 'exists', ...done, requests: 0 };
  let requests = 0;
  const get = async () => {
    requests++;
    const res = await fetch(URL, { headers: { 'user-agent': 'github-center (personal)' }, signal: AbortSignal.timeout(timeoutMs) });
    return { res, body: res.ok ? await res.text() : null };
  };
  try {
    const { res, body } = await get().catch(async () => { await sleep(5000); return get(); });
    if (!res.ok) throw new Error(`skills.sh 返回 ${res.status}`);
    const entries = parseSkills(body);
    const store = openStore(dataDir, `${BOARD}_${at.toISOString().replace(/[:.]/g, '-')}`);
    const evidence = store.saveRaw('page', BOARD, { url: URL, body, date: res.headers.get('date') }, 'html');
    const snapshot = { board: BOARD, statDay: day, fetchedAt: at.toISOString(), source: URL, evidence, entries };
    const r = writeOnce(dataDir, join('snapshots', BOARD, `${day}.json`), JSON.stringify(snapshot, null, 2));
    recordStatus(dataDir, { day, at: at.toISOString(), boards: { [BOARD]: { status: r.status } } });
    return { ...r, snapshot, requests };
  } catch (e) {
    const error = e.name === 'TimeoutError' ? `skills.sh ${timeoutMs / 1000} 秒没有回应` : e.message;
    recordStatus(dataDir, { day, at: at.toISOString(), boards: { [BOARD]: { status: 'failed', error } } });
    return { status: 'failed', error, requests };
  }
}

// 网站读：最近一次快照按来源合并后的前 show 个，和它之后有没有更新失败。没有快照返回 null。
// 返回 { day, fetchedAt, entries, failure: { day, at, error } | null, note }。
export function readSkillsBoard(dataDir, { show = SHOW } = {}) {
  const snapshot = readLatestSnapshot(dataDir, BOARD);
  const failure = newerFailure(readStatus(dataDir), BOARD, snapshot);
  if (!snapshot) return failure ? { day: null, fetchedAt: null, entries: [], failure, note: NOTE } : null;
  return {
    day: snapshot.statDay,
    fetchedAt: snapshot.fetchedAt,
    entries: groupBySource(snapshot.entries).slice(0, show),
    failure: failure && { day: failure.day, at: failure.at, error: failure.error },
    note: NOTE,
  };
}
