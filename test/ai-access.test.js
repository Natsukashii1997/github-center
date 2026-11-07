// AI 接入（src/ai-access.js，#69，全局规则 P-13）：选定执行方用不了时报错不换家、可用状态和调用成败存进 data/ai-status.json、自检和健康检查报出来。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unavailable, prepareAgent, saveChecks, AgentUnavailable, recordCalls, readAiStatus, aiAccess, aiProblems, describeAi, FEATURES } from '../src/ai-access.js';
import { DEFAULTS } from '../src/settings/index.js';
import { healthProblems } from '../src/remote/health.js';

const fresh = () => mkdtempSync(join(tmpdir(), 'gc-ai-'));
const OK = { state: 'ok', version: 'x', detail: '已登录' };
const OUT = { state: 'logged-out', version: 'x', detail: 'Not logged in' };
const settings = (agent, agentFor = {}) => ({ ...DEFAULTS, agent, agentFor: { ...DEFAULTS.agentFor, ...agentFor } });

test('用不了：只用一家时那家用不了就报错、指向设置页、写明不换家；接力只在两家都用不了时报', () => {
  assert.equal(unavailable('profiles', 'codex', { codex: OK, claude: OUT }), null);
  assert.equal(unavailable('profiles', 'codex', { codex: OUT, claude: OK }), '设置页「AI 接入」给补资料选的是只用 Codex，但 Codex 现在未登录：Not logged in：这一步不跑，也不自动换另一家。在本机修好（如重新登录），或去设置页换执行方。');
  assert.match(unavailable('classify', 'claude', { codex: OK, claude: { state: 'missing', detail: '找不到 claude 命令' } }), /给归类选的是只用 Claude，但 Claude 现在未安装/);
  assert.equal(unavailable('picks', 'relay', { codex: OUT, claude: OK }), null);
  assert.match(unavailable('picks', 'relay', { codex: OUT, claude: OUT }), /给精选标签建议选的是 Codex 优先·Claude 接力，但两家现在都用不了/);
});

test('开跑前：查一次并存下，按功能取执行方；只用 Codex 而 Codex 用不了抛错；接力而 Codex 用不了就整次交给 Claude', async () => {
  const dir = fresh();
  const now = new Date('2026-11-07T08:00:00Z');
  const s = settings('codex', { picks: 'relay' });
  await assert.rejects(prepareAgent(dir, s, 'profiles', { check: async () => ({ codex: OUT, claude: OK }), now }), AgentUnavailable);
  assert.deepEqual(readAiStatus(dir), { checkedAt: '2026-11-07T08:00:00.000Z', agents: { codex: OUT, claude: OK } });
  assert.deepEqual(await prepareAgent(dir, s, 'picks', { check: async () => ({ codex: OUT, claude: OK }), now }), { agent: 'relay', codexDown: true });
  assert.deepEqual(await prepareAgent(dir, s, 'classify', { check: async () => ({ codex: OK, claude: OUT }), now }), { agent: 'codex', codexDown: false });
});

test('调用成败：记各执行方最近一次成功和失败；设置页、自检、健康检查读同一份', () => {
  const dir = fresh();
  recordCalls(dir, 'profiles', { calls: { codex: { ok: 3, fail: 1, lastError: '额度用完' }, claude: { ok: 0, fail: 0, lastError: null } } }, new Date('2026-11-07T08:00:00Z'));
  recordCalls(dir, 'classify', { calls: { codex: { ok: 1, fail: 0, lastError: null }, claude: { ok: 0, fail: 0, lastError: null } } }, new Date('2026-11-07T09:00:00Z'));
  assert.deepEqual(readAiStatus(dir).calls, { codex: { lastOk: { at: '2026-11-07T09:00:00.000Z', task: 'classify' }, lastFail: { at: '2026-11-07T08:00:00.000Z', task: 'profiles', error: '额度用完' } }, claude: {} });

  // 没查过可用状态时不报；查到选定的那家用不了才报，健康检查把这句放在最前面。
  const s = settings('claude', { profiles: 'codex' });
  assert.deepEqual(aiProblems(dir, s), []);
  saveChecks(dir, { codex: OK, claude: OUT });
  const problems = aiProblems(dir, s);
  assert.equal(problems.length, 2);
  assert.match(problems[0], /给归类选的是只用 Claude/);
  assert.match(problems[1], /给精选标签建议选的是只用 Claude/);
  const health = healthProblems({ run: null, settings: { ...s, daily: { on: false, at: '10:00' } }, remote: false, backups: [], ai: problems });
  assert.deepEqual(health, problems);

  // 功能清单：谁做（跟随默认还是单独指定）、怎么接、读什么、写到哪。
  const access = aiAccess(dir, s);
  assert.deepEqual(access.features.map((f) => [f.task, f.set, f.mode, f.via]), [['profiles', 'codex', 'codex', 'cli'], ['classify', 'default', 'claude', 'cli'], ['picks', 'default', 'claude', 'cli']]);
  assert.ok(FEATURES.every((f) => f.reads && f.writes && f.makes));
  assert.deepEqual(access.dataObjects, []);
  const text = describeAi(access);
  assert.match(text, /默认执行方：只用 Claude/);
  assert.match(text, /补资料｜只用 Codex（单独指定）｜本机 CLI｜/);
  assert.match(text, /Codex｜可用｜x｜已登录\n    最近成功：.*（归类）\n    最近失败：.*（补资料）额度用完/);
  assert.match(text, /MCP｜MCP 开放｜没有开放/);
  assert.match(text, /数据对象：无/);
});
