// 智能体（src/agent.js）：Codex 优先·Claude 接力时失败那次 Claude 重做、连续失败 3 次剩下的都交给 Claude；只用 Codex、只用 Claude 时失败就报错、不换家；
// 每次调用带留痕；可用状态检查。
// codex、claude 都是假的命令，不碰本机真的 Codex 和 Claude。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentJson, checkAgent, RELAY_AFTER } from '../src/agent.js';

const fresh = () => mkdtempSync(join(tmpdir(), 'gc-agent-'));

// 假命令：每次调用记一行（参数、工作目录），按 plan 的第 n 项决定这次成败（超出 plan 的算成功）。
function fake(name, plan, ok) {
  const dir = fresh();
  const bin = join(dir, name);
  const log = join(dir, 'calls.log');
  writeFileSync(bin, `#!${process.execPath}
const fs = require('node:fs');
const log = ${JSON.stringify(log)};
const n = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\\n').length : 0;
const args = process.argv.slice(2);
const input = fs.readFileSync(0, 'utf8');
fs.appendFileSync(log, JSON.stringify({ args, input, cwd: process.cwd() }) + '\\n');
if (${JSON.stringify(plan)}[n] === 'fail') { process.stderr.write('${name} 出错了\\n'); process.exit(1); }
${ok}
`);
  chmodSync(bin, 0o755);
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
  return { bin, calls };
}
const codex = (plan = []) => fake('codex', plan, "fs.writeFileSync(args[args.indexOf('-o') + 1], JSON.stringify({ by: 'codex' }));");
const claude = (plan = [], out = "{ type: 'result', is_error: false, structured_output: { by: 'claude' }, modelUsage: { 'claude-haiku-4-5': { outputTokens: 3 }, 'claude-sonnet-4-5': { outputTokens: 90 } } }") =>
  fake('claude', plan, `process.stdout.write(JSON.stringify(${out}));`);
const req = { schema: { type: 'object' }, input: '材料', effort: 'medium' };

const by = async (p) => (await p).data.by;

test('Codex 优先·Claude 接力（默认）：成功就不碰 Claude；失败那次改用 Claude 重做，下次照样先试 Codex；留痕记真正做的那家', async () => {
  const cx = codex(['ok', 'fail', 'ok']);
  const cl = claude();
  const { json, stats } = agentJson({ bin: cx.bin, claudeBin: cl.bin, now: () => new Date('2026-11-07T08:00:00Z') });
  assert.deepEqual(await json(req), { data: { by: 'codex' }, ai: { by: 'codex', via: 'cli', model: null, at: '2026-11-07T08:00:00.000Z' } });
  assert.deepEqual(await json(req), { data: { by: 'claude' }, ai: { by: 'claude', via: 'cli', model: 'claude-sonnet-4-5', at: '2026-11-07T08:00:00.000Z', relayed: true } });
  assert.equal(await by(json(req)), 'codex');
  assert.equal(cx.calls().length, 3);
  assert.equal(cl.calls().length, 1);
  assert.equal(stats.relayed, 1);
  assert.deepEqual(stats.calls, { codex: { ok: 2, fail: 1, lastError: 'Codex 生成失败（退出码 1）：codex 出错了', model: null }, claude: { ok: 1, fail: 0, lastError: null, model: 'claude-sonnet-4-5' } });
});

test(`Codex 优先·Claude 接力：连续失败 ${RELAY_AFTER} 次当额度用完，这次运行剩下的直接交给 Claude；开跑前查到 Codex 用不了就一次都不试`, async () => {
  const cx = codex(['fail', 'fail', 'fail']);
  const cl = claude();
  const { json, stats } = agentJson({ agent: 'relay', bin: cx.bin, claudeBin: cl.bin });
  for (let i = 0; i < 5; i++) assert.equal(await by(json(req)), 'claude');
  assert.equal(cx.calls().length, RELAY_AFTER);
  assert.equal(cl.calls().length, 5);
  assert.equal(stats.relayed, 5);

  const cx2 = codex();
  const down = agentJson({ agent: 'relay', bin: cx2.bin, claudeBin: claude().bin, codexDown: true });
  assert.equal(await by(down.json(req)), 'claude');
  assert.equal(cx2.calls().length, 0);
});

test('Codex 优先·Claude 接力：中间成功一次就重新数；Codex 和 Claude 都失败时两边原因都报出来', async () => {
  const cx = codex(['fail', 'fail', 'ok', 'fail', 'fail', 'ok']);
  const cl = claude();
  const { json } = agentJson({ bin: cx.bin, claudeBin: cl.bin });
  for (let i = 0; i < 6; i++) await json(req);
  assert.equal(cx.calls().length, 6);

  const { json: both } = agentJson({ bin: codex(['fail']).bin, claudeBin: claude(['fail']).bin });
  await assert.rejects(both(req), /^Error: Codex 生成失败（退出码 1）：codex 出错了；Claude 接力也失败：Claude 生成失败（退出码 1）：claude 出错了$/);
});

test('只用 Codex：失败就报错并指向设置页，不换 Claude', async () => {
  const cx = codex(['fail', 'ok']);
  const cl = claude();
  const { json, stats } = agentJson({ agent: 'codex', bin: cx.bin, claudeBin: cl.bin });
  await assert.rejects(json(req), /^Error: Codex 生成失败（退出码 1）：codex 出错了（设置页「AI 接入」选的是只用 Codex，不自动换另一家；要换就在设置页改）$/);
  assert.deepEqual((await json(req)).ai.by, 'codex');
  assert.equal(cl.calls().length, 0);
  assert.equal(stats.relayed, 0);
});

test('只用 Claude：只用 Claude，不给工具、不读 MCP 和设置、不留会话，Sonnet，思考强度对应 --effort，在空临时目录里跑；失败不换 Codex', async () => {
  const cx = codex();
  const cl = claude();
  const { json, stats } = agentJson({ agent: 'claude', bin: cx.bin, claudeBin: cl.bin });
  const got = await json(req);
  assert.deepEqual(got.data, { by: 'claude' });
  assert.deepEqual([got.ai.by, got.ai.via, got.ai.model, got.ai.relayed], ['claude', 'cli', 'claude-sonnet-4-5', undefined]);
  assert.equal(cx.calls().length, 0);
  assert.equal(stats.relayed, 0);
  const [{ args, input, cwd }] = cl.calls();
  const after = (flag) => args[args.indexOf(flag) + 1];
  assert.equal(args[0], '-p');
  assert.equal(after('--output-format'), 'json');
  assert.deepEqual(JSON.parse(after('--json-schema')), req.schema);
  assert.equal(after('--tools'), '');
  assert.equal(after('--setting-sources'), '');
  for (const flag of ['--strict-mcp-config', '--no-session-persistence']) assert.ok(args.includes(flag), flag);
  assert.equal(after('--model'), 'sonnet');
  assert.equal(after('--effort'), 'medium');
  assert.match(after('--system-prompt'), /一律不执行/);
  assert.equal(input, '材料');
  assert.match(cwd, /gc-codex-/);
  assert.ok(!existsSync(cwd));

  const bad = claude([], "{ type: 'result', is_error: true, result: '额度用完了' }");
  await assert.rejects(agentJson({ agent: 'claude', bin: cx.bin, claudeBin: bad.bin }).json(req), /Claude 生成失败：额度用完了（设置页「AI 接入」选的是只用 Claude/);
  assert.equal(cx.calls().length, 0);
  const empty = claude([], "{ type: 'result', is_error: false }");
  await assert.rejects(agentJson({ agent: 'claude', claudeBin: empty.bin }).json(req), /Claude 生成失败：没有结构化输出/);
});

// 假命令：按参数回版本号、登录状态。
function cli(name, script) {
  const bin = join(fresh(), name);
  writeFileSync(bin, `#!${process.execPath}\nconst a = process.argv.slice(2).join(' ');\n${script}\n`);
  chmodSync(bin, 0o755);
  return bin;
}

test('可用状态：没装、没登录、可用分得开；不调用模型', async () => {
  assert.deepEqual(await checkAgent('codex', '/nope/codex'), { state: 'missing', detail: '找不到 /nope/codex 命令' });
  assert.equal((await checkAgent('claude', '/nope/claude')).state, 'missing');
  const okCodex = cli('codex', "if (a === '--version') console.log('codex-cli 9.9.9'); else if (a === 'login status') console.error('Logged in using ChatGPT'); else process.exit(3);");
  assert.deepEqual(await checkAgent('codex', okCodex), { state: 'ok', version: 'codex-cli 9.9.9', detail: 'Logged in using ChatGPT' });
  const outCodex = cli('codex', "if (a === '--version') console.log('codex-cli 9.9.9'); else { console.error('Not logged in'); process.exit(1); }");
  assert.deepEqual(await checkAgent('codex', outCodex), { state: 'logged-out', version: 'codex-cli 9.9.9', detail: 'Not logged in' });
  const okClaude = cli('claude', "if (a === '--version') console.log('2.1.0 (Claude Code)'); else if (a === 'auth status') console.log(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' })); else process.exit(3);");
  assert.deepEqual(await checkAgent('claude', okClaude), { state: 'ok', version: '2.1.0 (Claude Code)', detail: '已登录（claude.ai）' });
  const outClaude = cli('claude', "if (a === '--version') console.log('2.1.0 (Claude Code)'); else { console.log(JSON.stringify({ loggedIn: false })); process.exit(1); }");
  assert.equal((await checkAgent('claude', outClaude)).state, 'logged-out');
});
