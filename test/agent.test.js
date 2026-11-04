// 智能体（src/agent.js）：选 Codex 时失败那次 Claude 重做、连续失败 3 次剩下的都交给 Claude；选 Claude 只用 Claude。
// codex、claude 都是假的命令，不碰本机真的 Codex 和 Claude。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentJson, RELAY_AFTER } from '../src/agent.js';

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
const claude = (plan = [], out = "{ type: 'result', is_error: false, structured_output: { by: 'claude' } }") =>
  fake('claude', plan, `process.stdout.write(JSON.stringify(${out}));`);
const req = { schema: { type: 'object' }, input: '材料', effort: 'medium' };

test('选 Codex：成功就不碰 Claude；失败那次改用 Claude 重做，下次照样先试 Codex', async () => {
  const cx = codex(['ok', 'fail', 'ok']);
  const cl = claude();
  const { json, stats } = agentJson({ bin: cx.bin, claudeBin: cl.bin });
  assert.deepEqual(await json(req), { by: 'codex' });
  assert.deepEqual(await json(req), { by: 'claude' });
  assert.deepEqual(await json(req), { by: 'codex' });
  assert.equal(cx.calls().length, 3);
  assert.equal(cl.calls().length, 1);
  assert.equal(stats.relayed, 1);
});

test(`选 Codex：连续失败 ${RELAY_AFTER} 次当额度用完，这次运行剩下的直接交给 Claude，不再试 Codex`, async () => {
  const cx = codex(['fail', 'fail', 'fail']);
  const cl = claude();
  const { json, stats } = agentJson({ bin: cx.bin, claudeBin: cl.bin });
  for (let i = 0; i < 5; i++) assert.deepEqual(await json(req), { by: 'claude' });
  assert.equal(cx.calls().length, RELAY_AFTER);
  assert.equal(cl.calls().length, 5);
  assert.equal(stats.relayed, 5);
});

test('选 Codex：中间成功一次就重新数；Codex 和 Claude 都失败时两边原因都报出来', async () => {
  const cx = codex(['fail', 'fail', 'ok', 'fail', 'fail', 'ok']);
  const cl = claude();
  const { json } = agentJson({ bin: cx.bin, claudeBin: cl.bin });
  for (let i = 0; i < 6; i++) await json(req);
  assert.equal(cx.calls().length, 6);

  const { json: both } = agentJson({ bin: codex(['fail']).bin, claudeBin: claude(['fail']).bin });
  await assert.rejects(both(req), /^Error: Codex 生成失败（退出码 1）：codex 出错了；Claude 接力也失败：Claude 生成失败（退出码 1）：claude 出错了$/);
});

test('选 Claude：只用 Claude，不给工具、不读 MCP 和设置、不留会话，Sonnet，思考强度对应 --effort，在空临时目录里跑', async () => {
  const cx = codex();
  const cl = claude();
  const { json, stats } = agentJson({ agent: 'claude', bin: cx.bin, claudeBin: cl.bin });
  assert.deepEqual(await json(req), { by: 'claude' });
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
  await assert.rejects(agentJson({ agent: 'claude', claudeBin: bad.bin }).json(req), /Claude 生成失败：额度用完了/);
  const empty = claude([], "{ type: 'result', is_error: false }");
  await assert.rejects(agentJson({ agent: 'claude', claudeBin: empty.bin }).json(req), /Claude 生成失败：没有结构化输出/);
});
