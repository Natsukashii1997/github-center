// AI 接入（#69，全局规则 P-13）：本应用里哪些东西是 AI 产出的、谁做、怎么接进来、读什么、写到哪里，现在能不能用。
// 设置页「AI 接入」一栏（web/settings.js）、自检命令 npm run ai（bin/ai.js）、健康检查（remote/health.js）都只从这里取，
// AGENTS.md「AI 接入」一节和这里保持一致：改了 AI 功能，两处一起改。
// 可用状态存在 data/ai-status.json：每次跑 AI 功能前在 Mac 上查一次（装没装、登没登录），跑完记各执行方最近一次调用的成败；
// 这个文件随数据推到服务器（../remote 的 pushData），服务器上的设置页照着显示，自己不查（服务器上没有这两个命令行）。
import { join } from 'node:path';
import { readJson, writeAtomic } from './ranking/store.js';
import { checkAgents, NAMES, VIA } from './agent.js';
import { AGENTS, agentOf } from './settings/index.js';

export const VIAS = { [VIA]: '本机 CLI' };
export const STATES = { ok: '可用', missing: '未安装', 'logged-out': '未登录', error: '检查出错' };

// 用到 AI 的功能。task 同设置里的 agentFor、effort 的键。
export const FEATURES = [
  {
    task: 'profiles', name: '补资料', makes: '项目页的一句话、用途、场景、说明标签、定义标签、使用条件、Skill 用途',
    reads: 'GitHub 上的 README、主要文档、仓库目录、SKILL.md（外部内容，只当资料）',
    writes: 'data/profiles/<项目 id>.json 的 generated',
    when: '每日更新「补资料」一步（npm run profiles）',
  },
  {
    task: 'classify', name: '归类', makes: '各榜单项目的类别（分类榜、首页分类）',
    reads: '项目名称、GitHub 简介、topics；复核时加补资料写的简介和 Skill 名',
    writes: 'data/categories.json',
    when: '每日更新「归类」一步（npm run classify）',
  },
  {
    task: 'picks', name: '精选标签建议', makes: '精选榜候选项目的建议标签，按它填没固定的卡',
    reads: '候选池项目的 GitHub 简介和 topics、精选标签清单',
    writes: 'data/center.db 的 pick_pool 表（推到服务器时经 data/pick-pool.json）',
    when: '每日更新「精选榜」一步（npm run picks）',
  },
];

// 对外开放：外部 AI 连进来读写本应用的数据。
export const OPENINGS = [
  {
    who: '猛鬼兽（Hermes）', via: '读本机文件、跑本机命令（没有接口）', on: true,
    reads: 'data/settings.json 的周报推送一项、data/weekly/<统计日>.card.json；每天 09:50 跑 node bin/health.js',
    writes: '不写本应用的数据；把周报卡片、自检结果发到所有者的飞书私聊',
    off: '周报：设置页「定时与推送」关掉周报推送；自检：在 digital-twin 里停猛鬼兽的工程自检定时任务',
  },
  {
    who: 'MCP', via: 'MCP 开放', on: false,
    reads: '没有开放（规划中：查涨星榜、查项目资料、列收藏、加收藏，只本机能连）',
    writes: '—', off: '—',
  },
];

// 数据对象：本应用只展示或采集、AI 没替它产出内容的 AI 数据。本应用没有。
export const DATA_OBJECTS = [];

const FILE = 'ai-status.json';
const file = (dataDir) => join(dataDir, FILE);

// { checkedAt, agents: { codex, claude: { state, version, detail } }, calls: { codex, claude: { lastOk: { at, task }, lastFail: { at, task, error } } } }；没有返回 null。
export function readAiStatus(dataDir) {
  try {
    const s = readJson(file(dataDir));
    return s && typeof s === 'object' ? s : null;
  } catch {
    return null;
  }
}

function update(dataDir, fn) {
  const s = readAiStatus(dataDir) ?? {};
  fn(s);
  writeAtomic(file(dataDir), JSON.stringify(s, null, 2) + '\n');
  return s;
}

export const saveChecks = (dataDir, agents, now = new Date()) => update(dataDir, (s) => {
  s.checkedAt = now.toISOString();
  s.agents = agents;
});

// 一次运行完记各执行方最近一次成败（stats.calls 来自 agent.js 的 agentJson）。
export const recordCalls = (dataDir, task, stats, now = new Date()) => update(dataDir, (s) => {
  s.calls ??= {};
  for (const [by, c] of Object.entries(stats?.calls ?? {})) {
    const row = (s.calls[by] ??= {});
    if (c.ok) row.lastOk = { at: now.toISOString(), task };
    if (c.fail) row.lastFail = { at: now.toISOString(), task, error: String(c.lastError ?? '').slice(0, 300) };
  }
});

const taskName = (task) => FEATURES.find((f) => f.task === task)?.name ?? task;
const stateText = (a) => `${STATES[a?.state] ?? '没查过'}${a?.detail ? `：${a.detail}` : ''}`;

// 选定的执行方用不了时的原因（一句中文），能用返回 null。relay 只在两家都用不了时算不能用。
export function unavailable(task, mode, agents) {
  const ok = (by) => agents?.[by]?.state === 'ok';
  if (mode === 'relay') {
    if (ok('codex') || ok('claude')) return null;
    return `设置页「AI 接入」给${taskName(task)}选的是 Codex 优先·Claude 接力，但两家现在都用不了（Codex ${stateText(agents?.codex)}；Claude ${stateText(agents?.claude)}）：这一步不跑。在本机修好（如重新登录）后重跑。`;
  }
  if (ok(mode)) return null;
  return `设置页「AI 接入」给${taskName(task)}选的是只用 ${NAMES[mode]}，但 ${NAMES[mode]} 现在${stateText(agents?.[mode])}：这一步不跑，也不自动换另一家。在本机修好（如重新登录），或去设置页换执行方。`;
}

export class AgentUnavailable extends Error {}

// 跑 AI 功能前：查一次两家的可用状态并存下，按设置决定这次用谁。用不了就抛 AgentUnavailable（命令行打出来、退出码 1）。
// 返回传给 agentJson 的 { agent, codexDown }。
export async function prepareAgent(dataDir, settings, task, { check = checkAgents, now = new Date() } = {}) {
  const agent = agentOf(settings, task);
  const agents = await check();
  saveChecks(dataDir, agents, now);
  const bad = unavailable(task, agent, agents);
  if (bad) throw new AgentUnavailable(bad);
  return { agent, codexDown: agent === 'relay' && agents.codex?.state !== 'ok' };
}

// 命令行（bin/profiles.js 等）用：prepareAgent 之外再打一行用谁；用不了就打印原因、退出码 1，这一步不跑。
export async function useAgent(dataDir, settings, task, opts) {
  try {
    const use = await prepareAgent(dataDir, settings, task, opts);
    console.log(`执行方：${AGENTS[use.agent]}${use.codexDown ? '（Codex 现在用不了，这次全部交给 Claude）' : ''}｜接入方式：${VIAS[VIA]}`);
    return use;
  } catch (e) {
    if (!(e instanceof AgentUnavailable)) throw e;
    console.log(e.message);
    process.exit(1);
  }
}

// 设置页和自检命令共用的整体情况。
export function aiAccess(dataDir, settings) {
  const status = readAiStatus(dataDir);
  return {
    defaultAgent: settings.agent,
    status,
    features: FEATURES.map((f) => {
      const set = settings.agentFor?.[f.task] ?? 'default';
      const mode = agentOf(settings, f.task);
      return { ...f, set, mode, via: VIA, problem: status?.agents ? unavailable(f.task, mode, status.agents) : null };
    }),
    openings: OPENINGS,
    dataObjects: DATA_OBJECTS,
  };
}

// 健康检查用：选定执行方用不了的功能，每个一句。没查过（没有 ai-status.json）不报。
export const aiProblems = (dataDir, settings) => aiAccess(dataDir, settings).features.filter((f) => f.problem).map((f) => f.problem);

// 自检命令的文字版。
export function describeAi(access) {
  const { status } = access;
  const when = (iso) => (iso ? new Date(iso).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '—');
  const lines = [`AI 接入 · GitHub 快速中心（检查时间 ${when(status?.checkedAt)}）`, '', `默认执行方：${AGENTS[access.defaultAgent]}`, '', '执行方：'];
  for (const by of Object.keys(NAMES)) {
    const a = status?.agents?.[by];
    const c = status?.calls?.[by];
    lines.push(`  ${NAMES[by]}｜${STATES[a?.state] ?? '没查过'}${a?.version ? `｜${a.version}` : ''}${a?.detail ? `｜${a.detail}` : ''}`);
    if (c?.lastOk) lines.push(`    最近成功：${when(c.lastOk.at)}（${taskName(c.lastOk.task)}）`);
    if (c?.lastFail) lines.push(`    最近失败：${when(c.lastFail.at)}（${taskName(c.lastFail.task)}）${c.lastFail.error}`);
  }
  lines.push('', '功能清单（功能｜执行方｜接入方式｜读｜写）：');
  for (const f of access.features) {
    lines.push(`  ${f.name}｜${AGENTS[f.mode]}${f.set === 'default' ? '（跟随默认）' : '（单独指定）'}｜${VIAS[f.via]}｜${f.reads}｜${f.writes}`);
    if (f.problem) lines.push(`    ⚠ ${f.problem}`);
  }
  lines.push('', '对外开放：');
  for (const o of access.openings) lines.push(`  ${o.who}｜${o.via}｜${o.on ? '开放' : '没有开放'}｜读：${o.reads}｜写：${o.writes}｜关掉：${o.off}`);
  lines.push('', `数据对象：${access.dataObjects.length ? access.dataObjects.map((d) => d.name).join('、') : '无（本应用不展示、不采集 AI 的数据）'}`);
  return lines.join('\n');
}
