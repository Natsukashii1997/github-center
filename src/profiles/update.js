// 项目资料（#6）：给各榜单上的项目读 README、主要文档、仓库目录和 Skill，交给可替换的生成器写简介和使用条件。
// 补哪些项目只在 profileProjects 一处定：涨星榜和官方热门榜（boardProjects）排前面，再加分类榜上显示的（#27）。
// 只为首次上榜或资料过期的生成：项目没有新提交、简介和默认分支也没变就不重读；重读后资料哈希没变就不重新生成。
// 生成失败（含 Codex 登录失效）时不拿猜测的内容顶替：项目页显示“简介生成中”，下次运行再试。
//
// 生成器接口：{ version, generate(material) → { what, problem, line, use, scene, tag, type, conditions: [{ kind, text, quote }], skills: [{ path, purpose }] } }。
// version 变了，所有项目重新生成。
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { githubClient } from '../ranking/github.js';
import { openStore } from '../ranking/store.js';
import { mapLimit } from '../ranking/rank-day.js';
import { isSkillFile, parseSkill } from './skills.js';
import { boardProjects, readProfile, saveProfile } from './store.js';
import { readHistoryBoard } from '../boards/history.js';
import { readHotBoard } from '../boards/hot.js';
import { openPicks } from '../boards/picks.js';

export const CONDITION_KINDS = ['付费', '账号', '密钥', '环境'];
// 定义标签（#23）：项目是什么，只能是这几种之一。
export const PROJECT_TYPES = ['Skill', 'MCP', 'Agent', 'AI 应用', '插件', '框架', '工具', '应用', '内容'];
// 白雾首页用的短字段（#23）的格式：一句话、说明标签的字数上限，主要用途、使用场景的条数和每条字数上限（按字符数算，英文字母也算 1 个）。
export const SHORT_FORMAT = { line: 24, tag: [2, 6], items: [2, 4], item: 40 };
// 交给生成器的原文上限：README 最多 4 万字，其他文档最多 5 份、合计 3 万字，更长的截断并注明。
export const README_LIMIT = 40_000;
const MAX_DOCS = 5;
const DOCS_LIMIT = 30_000;
// 一个仓库最多读这么多个 SKILL.md；仓库根目录最多列这么多项。
const MAX_SKILLS = 200;
const MAX_LISTING = 200;
// 同时处理的项目数：Codex 生成慢，2 个就够每天跑完。
const CONCURRENCY = 2;
const RAW = 'https://raw.githubusercontent.com';
const RAW_TIMEOUT_MS = 30_000;
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

// 主要文档：根目录和 docs/、doc/ 下一层的 Markdown（不含 README、更新记录、许可证、贡献指南之类，
// 也不含 AGENTS.md、CLAUDE.md 这类写给项目自己开发用 AI 的指令），安装、上手、用法、要求、配置类的排前面。
const SKIP_DOC = /^(readme|changelog|changes|history|license|licence|code_of_conduct|contributing|security|authors|notice|agents|claude|gemini)\b/i;
const KEY_DOC = /install|setup|getting[-_ ]?started|quick[-_ ]?start|usage|require|config|prerequisite/i;
function docPaths(entries) {
  const docs = entries.filter((e) => {
    if (e.type !== 'blob' || !/\.mdx?$/i.test(e.path) || isSkillFile(e.path)) return false;
    const parts = e.path.split('/');
    return (parts.length === 1 || (parts.length === 2 && /^docs?$/i.test(parts[0]))) && !SKIP_DOC.test(parts.at(-1));
  }).map((e) => e.path);
  return docs.sort((a, b) => KEY_DOC.test(b) - KEY_DOC.test(a) || a.localeCompare(b)).slice(0, MAX_DOCS);
}

// 读一个项目的资料：README（GitHub 选定的那份）、主要文档、仓库根目录、所有按约定写的 Skill。
// 读不全就整个算失败，保留上一次的资料。
async function readMaterial({ info, gh, fetch, store }) {
  const c = { id: info.id, name: info.full_name };
  const file = (path) => rawFile({ fetch, fullName: info.full_name, ref: info.default_branch, path });
  const evidence = { docs: [], skills: [] };
  let readme = null;
  const readmeRes = await gh.readme(c);
  if (readmeRes) {
    const body = JSON.parse(readmeRes.body);
    evidence.readme = store.saveRaw('readme', String(info.id), readmeRes);
    // 超过 1MB 的文件接口不给内容，改从原文件读。
    const text = body.encoding === 'base64' ? Buffer.from(body.content, 'base64').toString('utf8') : (await file(body.path)).body;
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
  const docs = [];
  let budget = DOCS_LIMIT;
  for (const path of docPaths(entries)) {
    if (budget <= 0) break;
    const res = await file(path);
    evidence.docs.push(store.saveRaw('doc', `${info.id}/${path.replace(/\.mdx?$/i, '')}`, res, 'md'));
    docs.push({ path, text: res.body.slice(0, budget), truncated: res.body.length > budget });
    budget -= res.body.length;
  }
  const skillFiles = entries.filter((e) => e.type === 'blob' && isSkillFile(e.path)).map((e) => e.path).sort();
  const skills = (await mapLimit(skillFiles.slice(0, MAX_SKILLS), 4, async (path) => {
    const res = await file(path);
    evidence.skills.push(store.saveRaw('skill', `${info.id}/${path.replace(/\.md$/, '')}`, res, 'md'));
    return parseSkill(path, res.body);
  })).filter(Boolean);
  const material = {
    fullName: info.full_name,
    description: info.description,
    topics: info.topics ?? [],
    listing: entries.filter((e) => !e.path.includes('/')).slice(0, MAX_LISTING).map((e) => (e.type === 'tree' ? `${e.path}/` : e.path)),
    readme,
    docs,
    skills,
    treeTruncated,
    skillsTruncated: skillFiles.length > MAX_SKILLS,
  };
  return { material, evidence };
}

// 比对摘录用：Markdown 链接和图片只留文字，去掉 HTML 标签、Markdown 记号、首尾标点，引号统一，忽略大小写和空白。
const EDGE = /^[\s"'.,;:!?。，；：！？、-]+|[\s"'.,;:!?。，；：！？、-]+$/g;
const normalize = (s) => s
  .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/<[^>]*>/g, ' ')
  .replace(/[“”„«»]/g, '"')
  .replace(/[‘’]/g, "'")
  .replace(/[*_`#>|\\]/g, '')
  .replace(/\s+/g, ' ')
  .toLowerCase()
  .replace(EDGE, '');
// 摘录太短（如只摘一个词）证明不了一条条件。
const MIN_QUOTE = 10;

// 首页短字段（#23）：格式不对（超长、条数不对、定义标签不在固定取值里）整个算生成失败，不截断凑数。
const chars = (s) => [...s].length;
function shortFields(result) {
  const { line: lineMax, tag: [tagMin, tagMax], items: [minItems, maxItems], item: itemMax } = SHORT_FORMAT;
  const line = result?.line?.trim() ?? '';
  const tag = result?.tag?.trim() ?? '';
  if (!line || chars(line) > lineMax) throw new Error(`一句话为空或超过 ${lineMax} 个字：${line}`);
  if (chars(tag) < tagMin || chars(tag) > tagMax) throw new Error(`说明标签要 ${tagMin}–${tagMax} 个字：${tag}`);
  if (!PROJECT_TYPES.includes(result.type)) throw new Error(`定义标签不在固定取值里：${result.type}`);
  const list = (name, label) => {
    const items = Array.isArray(result[name]) ? result[name].map((x) => String(x).trim()) : [];
    if (items.length < minItems || items.length > maxItems) throw new Error(`${label}要 ${minItems}–${maxItems} 条，给了 ${items.length} 条`);
    const bad = items.find((x) => !x || chars(x) > itemMax);
    if (bad !== undefined) throw new Error(`${label}有一条为空或超过 ${itemMax} 个字：${bad}`);
    return items;
  };
  return { line, use: list('use', '主要用途'), scene: list('scene', '使用场景'), tag, type: result.type };
}

// 生成结果只留有原文依据的：使用条件的摘录必须真的出现在读到的原文里，对不上的丢掉并记数。
function keepGrounded(result, material) {
  const what = result?.what?.trim();
  const problem = result?.problem?.trim();
  if (!what || !problem) throw new Error('生成结果里没有简介');
  const short = shortFields(result);
  const source = normalize([material.description ?? '', material.readme?.text ?? '', ...material.docs.map((d) => d.text), ...material.skills.map((s) => s.description)].join('\n'));
  const all = result.conditions ?? [];
  const conditions = all
    .filter((c) => CONDITION_KINDS.includes(c.kind) && c.text?.trim() && normalize(c.quote ?? '').length >= MIN_QUOTE && source.includes(normalize(c.quote)))
    .map((c) => ({ kind: c.kind, text: c.text.trim(), quote: c.quote.trim() }));
  const paths = new Set(material.skills.map((s) => s.path));
  const skillPurposes = Object.fromEntries((result.skills ?? []).filter((s) => paths.has(s.path) && s.purpose?.trim()).map((s) => [s.path, s.purpose.trim()]));
  return { what, problem, ...short, conditions, droppedConditions: all.length - conditions.length, skillPurposes };
}

// 项目页维护信号（#18）：最新正式版。每次补资料都重查（每项目 1 次官方请求），只写事实：
// 有 → 版本号、发布时间、链接；没有正式版 → none；查失败 → unknown（不沿用旧的，免得把过时的当成最新）。
async function latestRelease(gh, info) {
  try {
    const res = await gh.latestRelease({ id: info.id, name: info.full_name });
    if (!res) return { state: 'none' };
    const r = JSON.parse(res.body);
    return { state: 'ok', tag: r.tag_name, publishedAt: r.published_at, url: r.html_url };
  } catch {
    return { state: 'unknown' };
  }
}

async function updateOne({ c, dataDir, gh, fetch, store, generator, now }) {
  const res = await gh.project(c);
  if (!res) return { name: c.name, status: 'missing' };
  const info = JSON.parse(res.body);
  const old = readProfile(dataDir, info.id);
  const at = now().toISOString();
  const release = await latestRelease(gh, info);
  const base = { projectId: info.id, fullName: info.full_name, htmlUrl: info.html_url, description: info.description, defaultBranch: info.default_branch, pushedAt: info.pushed_at, release, checkedAt: at };
  const upToDate = (g, hash) => g && g.materialHash === hash && g.version === generator.version;
  // 没有新提交，GitHub 上的简介、topics、默认分支也没变，资料就没变。
  const sameSource = old?.material && old.pushedAt === info.pushed_at && old.defaultBranch === info.default_branch
    && old.material.description === info.description && JSON.stringify(old.material.topics) === JSON.stringify(info.topics ?? []);
  if (sameSource && upToDate(old.generated, old.material.hash)) {
    saveProfile(dataDir, { ...old, ...base });
    return { name: info.full_name, status: 'unchanged' };
  }
  let read;
  try {
    read = await readMaterial({ info, gh, fetch, store });
  } catch (e) {
    // 资料读不全：保留上一次的资料和简介，来源信息也不更新，下次运行重读（最新正式版照这次查到的写）。
    if (old) saveProfile(dataDir, { ...old, release, checkedAt: at, lastError: { at, message: e.message } });
    return { name: info.full_name, status: 'error', error: e.message };
  }
  const { material, evidence } = read;
  const hash = sha256(JSON.stringify(material));
  const { readme, docs, ...rest } = material;
  const saved = {
    ...rest,
    hash,
    readme: readme && { path: readme.path, htmlUrl: readme.htmlUrl, truncated: readme.truncated },
    docs: docs.map(({ path, truncated }) => ({ path, truncated })),
    fetchedAt: at,
    evidence: { project: store.saveRaw('project', String(info.id), res), ...evidence },
  };
  if (upToDate(old?.generated, hash)) {
    saveProfile(dataDir, { ...base, material: saved, generated: old.generated, lastError: null });
    return { name: info.full_name, status: 'reused' };
  }
  try {
    const generated = { version: generator.version, materialHash: hash, at: now().toISOString(), ...keepGrounded(await generator.generate(material), material) };
    saveProfile(dataDir, { ...base, material: saved, generated, lastError: null });
    return { name: info.full_name, status: 'generated' };
  } catch (e) {
    // 旧简介照样存着（依据的是旧资料，页面不显示它，只显示“简介生成中”）。
    saveProfile(dataDir, { ...base, material: saved, generated: old?.generated ?? null, lastError: { at, message: e.message } });
    return { name: info.full_name, status: 'failed', error: e.message };
  }
}

// 要补资料的项目：涨星榜和官方热门榜上的先补（boardProjects），再补分类榜上显示的：精选榜各标签的卡、历史榜前 50、热点榜前 15。
// 按项目 id（没有 id 的按名字，不分大小写）去重。还没有库（data/center.db）时不建库，只是没有精选卡。
export function profileProjects(dataDir) {
  const out = boardProjects(dataDir);
  const seen = new Set(out.flatMap((p) => [`name:${p.name.toLowerCase()}`, ...(p.id ? [`id:${p.id}`] : [])]));
  const add = (id, name) => {
    const keys = [`name:${name.toLowerCase()}`, ...(id ? [`id:${id}`] : [])];
    if (keys.some((k) => seen.has(k))) return;
    keys.forEach((k) => seen.add(k));
    out.push({ id: id ?? null, name });
  };
  if (existsSync(join(dataDir, 'center.db'))) {
    const picks = openPicks(dataDir);
    try {
      for (const t of picks.board(null).tags) t.cards.forEach((c) => add(c.projectId, c.fullName));
    } finally {
      picks.close();
    }
  }
  for (const e of readHistoryBoard(dataDir)?.entries ?? []) add(e.id, e.repo);
  for (const e of readHotBoard(dataDir)?.entries ?? []) add(e.id, e.repo);
  return out;
}

// 跑一次：处理网站上各榜单当前显示的项目（profileProjects）。一个项目出错不影响其他项目。
export async function updateProfiles({ dataDir, fetch = globalThis.fetch, token, generator, now = () => new Date(), sleep }) {
  const runId = `profiles_${now().toISOString().replace(/[:.]/g, '-')}`;
  const store = openStore(dataDir, runId);
  const gh = githubClient({ fetch, token, sleep });
  const projects = profileProjects(dataDir);
  const results = await mapLimit(projects, CONCURRENCY, (c) =>
    updateOne({ c, dataDir, gh, fetch, store, generator, now }).catch((e) => ({ name: c.name, status: 'error', error: e.message })));
  return { runId, results, requests: gh.stats };
}
