// 项目资料（#6）：给各榜单上的项目读 README、仓库目录和 Skill，交给可替换的生成器写简介和使用条件。
// 只为首次上榜或资料过期的生成：项目没有新提交（pushed_at 没变）就不重读；重读后资料哈希没变就不重新生成。
// 生成失败（含 Codex 登录失效）时不拿猜测的内容顶替：没有旧简介的项目页显示“简介生成中”，下次运行再试。
import { createHash } from 'node:crypto';
import { githubClient } from '../ranking/github.js';
import { openStore } from '../ranking/store.js';
import { mapLimit } from '../ranking/rank-day.js';
import { isSkillFile, parseSkill } from './skills.js';
import { CONDITION_KINDS, README_LIMIT } from './codex.js';
import { boardProjects, readProfile, saveProfile } from './store.js';

const RAW = 'https://raw.githubusercontent.com';
const RAW_TIMEOUT_MS = 30_000;
// 一个仓库最多读这么多个 SKILL.md；仓库根目录最多列这么多项。
const MAX_SKILLS = 200;
const MAX_LISTING = 200;
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');

// raw.githubusercontent.com 不占官方接口额度；失败重试一次。
async function rawFile({ fetch, fullName, ref, path }) {
  const url = `${RAW}/${fullName}/${encodeURIComponent(ref)}/${encodePath(path)}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(RAW_TIMEOUT_MS) });
      if (res.ok) return { url, body: await res.text(), date: res.headers.get('date') };
      throw new Error(`返回 ${res.status}`);
    } catch (e) {
      if (attempt >= 2) throw new Error(`${url} 读取失败：${e.message}`);
    }
  }
}

// 读一个项目的资料：README（GitHub 选定的那份）、仓库根目录、所有按约定写的 Skill。读不全就整个算失败，保留上一次的资料。
async function readMaterial({ info, gh, fetch, store }) {
  const c = { id: info.id, name: info.full_name };
  const evidence = { skills: [] };
  let readme = null;
  const readmeRes = await gh.readme(c);
  if (readmeRes) {
    const body = JSON.parse(readmeRes.body);
    evidence.readme = store.saveRaw('readme', String(info.id), readmeRes);
    // 超过 1MB 的文件接口不给内容，改从原文件读。
    const text = body.encoding === 'base64' ? Buffer.from(body.content, 'base64').toString('utf8') : (await rawFile({ fetch, fullName: info.full_name, ref: info.default_branch, path: body.path })).body;
    readme = { path: body.path, htmlUrl: body.html_url, text: text.slice(0, README_LIMIT), truncated: text.length > README_LIMIT };
  }
  let entries = [];
  let treeTruncated = false;
  if (info.size > 0) {
    const treeRes = await gh.tree(c, info.default_branch);
    if (treeRes) {
      const tree = JSON.parse(treeRes.body);
      evidence.tree = store.saveRaw('tree', String(info.id), treeRes);
      entries = tree.tree;
      treeTruncated = Boolean(tree.truncated);
    }
  }
  const skillFiles = entries.filter((e) => e.type === 'blob' && isSkillFile(e.path)).map((e) => e.path).sort();
  const skills = (await mapLimit(skillFiles.slice(0, MAX_SKILLS), 4, async (path) => {
    const res = await rawFile({ fetch, fullName: info.full_name, ref: info.default_branch, path });
    evidence.skills.push(store.saveRaw('skill', `${info.id}/${path.replace(/\.md$/, '')}`, res, 'md'));
    return parseSkill(path, res.body);
  })).filter(Boolean);
  const material = {
    fullName: info.full_name,
    description: info.description,
    topics: info.topics ?? [],
    listing: entries.filter((e) => !e.path.includes('/')).slice(0, MAX_LISTING).map((e) => (e.type === 'tree' ? `${e.path}/` : e.path)),
    readme,
    skills,
    treeTruncated,
    skillsTruncated: skillFiles.length > MAX_SKILLS,
  };
  return { material, evidence };
}

// 生成结果只留有原文依据的：使用条件的摘录必须真的出现在原文里（忽略大小写、空白和 Markdown 记号），对不上的丢掉。
const normalize = (s) => s.toLowerCase().replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim();
function ground(result, material) {
  const what = result?.what?.trim();
  const problem = result?.problem?.trim();
  if (!what || !problem) throw new Error('生成结果里没有简介');
  const source = normalize([material.description ?? '', material.readme?.text ?? '', ...material.skills.map((s) => s.description)].join('\n'));
  const all = result.conditions ?? [];
  const conditions = all
    .filter((c) => CONDITION_KINDS.includes(c.kind) && c.text?.trim() && normalize(c.quote ?? '').length >= 4 && source.includes(normalize(c.quote)))
    .map((c) => ({ kind: c.kind, text: c.text.trim(), quote: c.quote.trim() }));
  const paths = new Set(material.skills.map((s) => s.path));
  const skillPurposes = Object.fromEntries((result.skills ?? []).filter((s) => paths.has(s.path) && s.purpose?.trim()).map((s) => [s.path, s.purpose.trim()]));
  return { what, problem, conditions, droppedConditions: all.length - conditions.length, skillPurposes };
}

async function updateOne({ c, dataDir, gh, fetch, store, generator, now }) {
  const res = await gh.project(c);
  if (!res) return { name: c.name, status: 'missing' };
  const info = JSON.parse(res.body);
  const old = readProfile(dataDir, info.id);
  const at = now().toISOString();
  const base = { projectId: info.id, fullName: info.full_name, htmlUrl: info.html_url, description: info.description, pushedAt: info.pushed_at, checkedAt: at };
  const current = (g, hash) => g && g.materialHash === hash && g.version === generator.version;
  if (old?.material && old.pushedAt === info.pushed_at && current(old.generated, old.material.hash)) {
    saveProfile(dataDir, { ...old, ...base });
    return { name: info.full_name, status: 'unchanged' };
  }
  let read;
  try {
    read = await readMaterial({ info, gh, fetch, store });
  } catch (e) {
    // 资料读不全：保留上一次的资料和简介，pushedAt 也不更新，下次运行重读。
    if (old) saveProfile(dataDir, { ...old, checkedAt: at, lastError: { at, message: e.message } });
    return { name: info.full_name, status: 'error', error: e.message };
  }
  const { material, evidence } = read;
  const hash = sha256(JSON.stringify(material));
  const { readme, ...rest } = material;
  const saved = { ...rest, hash, readme: readme && { path: readme.path, htmlUrl: readme.htmlUrl, truncated: readme.truncated }, fetchedAt: at, evidence: { project: store.saveRaw('project', String(info.id), res), ...evidence } };
  if (current(old?.generated, hash)) {
    saveProfile(dataDir, { ...base, material: saved, generated: old.generated, lastError: null });
    return { name: info.full_name, status: 'reused' };
  }
  try {
    const generated = { version: generator.version, materialHash: hash, at: now().toISOString(), ...ground(await generator.generate(material), material) };
    saveProfile(dataDir, { ...base, material: saved, generated, lastError: null });
    return { name: info.full_name, status: 'generated' };
  } catch (e) {
    saveProfile(dataDir, { ...base, material: saved, generated: old?.generated ?? null, lastError: { at, message: e.message } });
    return { name: info.full_name, status: 'failed', error: e.message };
  }
}

// 跑一次：处理网站上各榜单当前显示的项目。一个项目出错不影响其他项目。
export async function updateProfiles({ dataDir, fetch = globalThis.fetch, token, generator, now = () => new Date(), sleep, concurrency = 2 }) {
  const runId = `profiles_${now().toISOString().replace(/[:.]/g, '-')}`;
  const store = openStore(dataDir, runId);
  const gh = githubClient({ fetch, token, sleep });
  const projects = boardProjects(dataDir);
  const results = await mapLimit(projects, concurrency, (c) =>
    updateOne({ c, dataDir, gh, fetch, store, generator, now }).catch((e) => ({ name: c.name, status: 'error', error: e.message })));
  return { runId, results, requests: gh.stats };
}
