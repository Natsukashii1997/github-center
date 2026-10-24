// 日报（#11）：每天出完榜、补完资料和归类后，按近 1 天这一期的统计日写一份日报，网站日报页和飞书消息都用这一份。
// 内容：一段概览（只按当天榜单的数字拼，不经过 AI）、近 1/7/30 天各前 10（末位并列一起列出）。同一项目按近 1、7、30 天的顺序
// 只介绍一次，后面再出现记下第一次出现的位置（页面和消息里写“见上”）。一句话简介取项目资料里已生成的简介。
// 背景只写有据的：项目在它第一次出现的那个时间窗口内发的正式版本（GitHub 官方 Release，跳过草稿和预发布版），附链接；
// 没有就不写，不凭涨星猜原因。按统计日只写一次，已存在就不重写、不再请求上游。飞书消息内容（feishu.js）跟着写成文件。
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { WINDOWS, readLatestSnapshot, readStatus } from '../ranking/index.js';
import { findSnapshot, readJson, writeOnce, writeAtomic, openStore } from '../ranking/store.js';
import { windowDays } from '../ranking/stat-day.js';
import { githubClient, RELEASES_PER_PAGE } from '../ranking/github.js';
import { mapLimit } from '../ranking/rank-day.js';
import { readProfile, findProfile, currentGenerated } from '../profiles/index.js';
import { windowStatus } from '../web/home.js';
import { feishuMarkdown } from './feishu.js';

// 日报每个时间窗口放前 10（需求第 5 条），末位并列一起列出。
export const TOP = 10;
const CONCURRENCY = 4;
const DAY_FILE = /^\d{4}-\d{2}-\d{2}\.json$/;
const label = (w) => `近 ${WINDOWS[w].days} 天`;
const md = (day) => `${Number(day.slice(5, 7))} 月 ${Number(day.slice(8, 10))} 日`;
const num = (n) => n.toLocaleString('en-US');
const CN = ['零', '一', '两', '三'];

export const dailyPath = (day, ext = 'json') => join('daily', `${day}.${ext}`);
export const readDaily = (dataDir, day) => readJson(join(dataDir, dailyPath(day)));
export function readLatestDaily(dataDir) {
  const dir = join(dataDir, 'daily');
  const day = existsSync(dir) ? readdirSync(dir).filter((f) => DAY_FILE.test(f)).sort().pop() : null;
  return day ? readJson(join(dir, day)) : null;
}

// 这个窗口用哪份快照：统计日当天的；当天没有（更新失败或还没出）就用更早里最近的一份，并写明。
function snapshotFor(dataDir, w, day) {
  const exact = findSnapshot(dataDir, w, day);
  if (exact) return exact.snapshot;
  const dir = join(dataDir, 'snapshots', w);
  const earlier = existsSync(dir) ? readdirSync(dir).filter((f) => DAY_FILE.test(f) && f.slice(0, 10) < day).sort().pop() : null;
  return earlier ? readJson(join(dir, earlier)) : null;
}

// 三个窗口各前 10，按近 1、7、30 天的顺序去重：有项目 id 按 id，没有按名字。
// 再出现的条目记下第一次出现的位置（first）；每个项目记下第一次出现的条目和它上了哪几个窗口。
function sections(snapshots) {
  const seen = new Map();
  const windows = {};
  for (const w of Object.keys(WINDOWS)) {
    const s = snapshots[w];
    const top = (s?.entries ?? []).filter((e) => e.rank <= TOP);
    windows[w] = {
      label: label(w),
      statDay: s?.statDay ?? null,
      from: s ? windowDays(s.statDay, WINDOWS[w].days)[0] : null,
      run: s?.runId ?? null,
      entries: top.map((e) => {
        const key = e.projectId ? `id:${e.projectId}` : `name:${e.fullName.toLowerCase()}`;
        const row = { rank: e.rank, tie: top.filter((x) => x.rank === e.rank).length > 1, repo: e.fullName, id: e.projectId ?? null, gain: e.gain, total: e.total, first: null };
        const known = seen.get(key);
        if (known) {
          row.first = { w: known.w, rank: known.row.rank, repo: known.row.repo };
          known.windows.push(w);
        } else seen.set(key, { w, row, windows: [w] });
        return row;
      }),
    };
  }
  return { windows, projects: [...seen.values()] };
}

// 项目在它第一次出现的窗口内发的最新正式版本；查不到、没查全就记下，不当作“没有发”。
async function releaseOf({ gh, store, project, from, day }) {
  try {
    const res = await gh.releases({ id: project.id, name: project.repo });
    if (!res) return { lookup: 'missing', release: null };
    const evidence = store.saveRaw('releases', String(project.id ?? project.repo.replace('/', '__')), res);
    const list = JSON.parse(res.body);
    const inWindow = list.filter((r) => !r.draft && !r.prerelease && r.published_at
      && r.published_at.slice(0, 10) >= from && r.published_at.slice(0, 10) <= day && /^https:\/\/github\.com\//.test(r.html_url ?? ''));
    const latest = inWindow.sort((a, b) => b.published_at.localeCompare(a.published_at))[0];
    // 一页读满、最早的一个还不早于窗口起点：窗口内可能还有没读到的正式版本，不能说没发。
    if (!latest && list.length >= RELEASES_PER_PAGE && !(list.at(-1).created_at?.slice(0, 10) < from)) return { lookup: 'partial', evidence, release: null };
    return { lookup: 'ok', evidence, release: latest ? { tag: latest.tag_name, publishedAt: latest.published_at, url: latest.html_url } : null };
  } catch (e) {
    return { lookup: 'error', error: e.message, release: null };
  }
}

// 概览：只用当天榜单的数字和查到的版本发布拼成，不写原因。
function overviewOf(day, windows, projects) {
  const shown = Object.keys(WINDOWS).filter((w) => windows[w].entries.length);
  const firsts = shown.map((w, i) => {
    const top1 = windows[w].entries.filter((e) => e.rank === 1);
    const when = windows[w].statDay === day ? '' : `（${md(windows[w].statDay)}的数据）`;
    const names = top1.map((e) => e.repo).join('、');
    const gain = top1.length > 1 ? `并列，各 +${num(top1[0].gain)}` : `+${num(top1[0].gain)}`;
    return `${label(w)}${when}第 1 名${i === 0 ? '是' : ''} ${names}（${gain}）`;
  });
  const list = Object.values(projects);
  const repeated = list.filter((p) => p.windows.length > 1).length;
  const released = list.filter((p) => p.release).length;
  const unknown = list.filter((p) => p.lookup !== 'ok').length;
  const parts = [];
  if (firsts.length) parts.push(`${md(day)}，${firsts.join('，')}。`);
  if (list.length) {
    parts.push(`${CN[shown.length]}个榜的前 ${TOP} 共 ${list.length} 个项目${repeated ? `，其中 ${repeated} 个不止上了一个榜` : ''}。`);
    parts.push(released ? `${released} 个项目在所在时间窗口内发了正式版本。`
      : unknown === list.length ? '官方 Release 这次都没查全，没写版本发布。'
      : `${unknown ? '查到的项目' : '这些项目'}在所在时间窗口内都没有发正式版本。`);
  }
  return parts.join('');
}

// 飞书消息内容跟着日报写：日报先写（只写一次），写成了再写消息文件；消息文件不在（中途断掉）就照日报补上。
function ensureFeishu(dataDir, day, daily) {
  const path = dailyPath(day, 'feishu.md');
  if (!existsSync(join(dataDir, path))) writeAtomic(join(dataDir, path), feishuMarkdown(daily ?? readDaily(dataDir, day)));
  return path;
}

// 生成一份日报。statDay 取近 1 天最新一期；已有就不重写。返回 status：published | exists | missing。
export async function buildDaily({ dataDir, fetch = globalThis.fetch, token, now = () => new Date(), sleep }) {
  const d1 = readLatestSnapshot(dataDir, 'd1');
  if (!d1) return { status: 'missing' };
  const day = d1.statDay;
  const path = dailyPath(day);
  if (existsSync(join(dataDir, path))) return { status: 'exists', statDay: day, path, feishuPath: ensureFeishu(dataDir, day) };

  const status = readStatus(dataDir);
  const snapshots = Object.fromEntries(Object.keys(WINDOWS).map((w) => [w, snapshotFor(dataDir, w, day)]));
  const { windows, projects: found } = sections(snapshots);
  // 提示条：每个窗口的更新失败、可能不完整、未做自检（同网站），不是当天的数据、还没有榜单也写明。
  // 更新失败只认这一天的：这个窗口当天没有快照，更新记录里这一天记的是失败。
  const notes = [];
  for (const w of Object.keys(WINDOWS)) {
    const s = snapshots[w];
    const last = status?.boards?.[w];
    const failed = last?.status === 'failed' && last.day === day && s?.statDay !== day ? last : null;
    const own = windowStatus(s, failed).notes;
    if (!s && !failed) own.push({ icon: 'inbox', title: '还没有榜单', text: `还没有${label(w)}的榜单。` });
    else if (s && s.statDay !== day && !failed) own.push({ icon: 'warn', title: '不是当天的数据', text: `${label(w)}这一期还没出，下面是 ${md(s.statDay)}的数据。` });
    notes.push(...own.map((n) => ({ ...n, title: `${label(w)}${n.title}` })));
  }

  const runId = `daily_${now().toISOString().replace(/[:.]/g, '-')}`;
  const store = openStore(dataDir, runId);
  const gh = githubClient({ fetch, token, sleep });
  const looked = await mapLimit(found, CONCURRENCY, ({ w, row }) => releaseOf({ gh, store, project: row, from: windows[w].from, day: windows[w].statDay }));
  // 项目按第一次出现时的名字记；简介取项目资料里和当前资料对得上的那份，没有就是“简介生成中”。
  const projects = {};
  found.forEach(({ w, row, windows: inWindows }, i) => {
    const profile = row.id ? readProfile(dataDir, row.id) : findProfile(dataDir, row.repo);
    const g = currentGenerated(profile);
    projects[row.repo] = { id: row.id, what: g?.what ?? null, problem: g?.problem ?? null, w, windows: inWindows, ...looked[i] };
  });
  const unknown = Object.entries(projects).filter(([, p]) => p.lookup !== 'ok');
  if (unknown.length) notes.push({ icon: 'warn', title: '版本发布没查全', text: `${unknown.length} 个项目的官方 Release 没查全（${unknown.map(([r]) => r).join('、')}），这几个项目没写版本发布。` });

  const daily = { statDay: day, generatedAt: now().toISOString(), runId, overview: overviewOf(day, windows, projects), notes, windows, projects, requests: gh.stats.releases };
  const written = writeOnce(dataDir, path, JSON.stringify(daily, null, 2));
  if (written.status === 'exists') return { status: 'exists', statDay: day, path, feishuPath: ensureFeishu(dataDir, day) };
  return { status: 'published', statDay: day, path, feishuPath: ensureFeishu(dataDir, day, daily), daily };
}
