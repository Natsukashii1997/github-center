// #6：项目页的简介、使用条件与 Skill 列表。更新项目资料时 GitHub 用假接口、生成器用假的（接缝 1），项目页走登录后的 HTTP（接缝 2）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { updateProfiles, codexGenerator, parseSkill } from '../src/profiles/index.js';
import { visit } from './helpers/web.js';

const fresh = () => mkdtempSync(join(tmpdir(), 'gc-profiles-'));
const json = (body) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', date: 'Fri, 23 Oct 2026 10:00:00 GMT' } });

const AGENT_README = `# Agent Kit

Agent Kit turns your notes into **runnable agents**. It is the fastest agent framework.

## Requirements

- Requires an OpenAI API key.
- Node.js 20 or later is required.
`;
const SKILLS = {
  'skills/pdf/SKILL.md': '---\nname: pdf\ndescription: Read and fill PDF forms.\n---\n\n# PDF\n',
  'skills/notes/SKILL.md': '---\nname: "notes"\ndescription: >\n  Turn meeting notes\n  into action items.\nlicense: MIT\n---\nbody\n',
  // 反例：文件名不对、没有 YAML 头、缺 description。
  'docs/skill.md': '---\nname: lower\ndescription: wrong file name\n---\n',
  'skills/broken/SKILL.md': '# Broken\nname: broken\ndescription: no front matter\n',
  'skills/half/SKILL.md': '---\nname: half\n---\n',
  'templates/SKILL.md.example': '---\nname: example\ndescription: template only\n---\n',
};

// 两个上榜项目：一个带 Skill 和使用条件，一个什么都没写。
function repos() {
  return [
    { info: { id: 101, full_name: 'acme/agent-kit', html_url: 'https://github.com/acme/agent-kit', description: 'Agents from notes', topics: ['agent'], default_branch: 'main', pushed_at: '2026-10-22T01:00:00Z', size: 10 }, readme: AGENT_README, files: { 'README.md': AGENT_README, ...SKILLS } },
    { info: { id: 202, full_name: 'acme/tiny', html_url: 'https://github.com/acme/tiny', description: null, topics: [], default_branch: 'main', pushed_at: '2026-10-22T02:00:00Z', size: 1 }, readme: 'Tiny does one thing.', files: { 'README.md': 'Tiny does one thing.', 'index.js': '' } },
  ];
}

// 假 GitHub：项目信息、README、仓库目录走官方接口，SKILL.md 走 raw.githubusercontent.com。
function fakeGitHub(list) {
  const calls = [];
  const find = (id, name) => list.find((r) => (id ? r.info.id === Number(id) : r.info.full_name === name));
  async function fetch(input) {
    const url = String(input);
    calls.push(url);
    let m;
    if ((m = url.match(/^https:\/\/api\.github\.com\/(?:repositories\/(\d+)|repos\/([^/]+\/[^/]+?))(\/readme|\/git\/trees\/main\?recursive=1)?$/))) {
      const r = find(m[1], m[2]);
      if (!r) return new Response('{"message":"Not Found"}', { status: 404 });
      if (!m[3]) return json(r.info);
      if (m[3] === '/readme') return json({ path: 'README.md', html_url: `${r.info.html_url}/blob/main/README.md`, encoding: 'base64', content: Buffer.from(r.readme).toString('base64') });
      const paths = Object.keys(r.files);
      const dirs = [...new Set(paths.filter((p) => p.includes('/')).map((p) => p.split('/')[0]))];
      return json({ sha: 't', truncated: false, tree: [...dirs.map((path) => ({ path, type: 'tree' })), ...paths.map((path) => ({ path, type: 'blob' }))] });
    }
    if ((m = url.match(/^https:\/\/raw\.githubusercontent\.com\/([^/]+\/[^/]+)\/main\/(.+)$/))) {
      const r = find(null, m[1]);
      const path = m[2].split('/').map(decodeURIComponent).join('/');
      // rawMissing：目录里列了，原文件却读不到。
      if (r.rawMissing?.includes(path) || !(path in r.files)) return new Response('404: Not Found', { status: 404 });
      return new Response(r.files[path]);
    }
    throw new Error(`未录制的请求：${url}`);
  }
  return { fetch, calls };
}

// 假生成器：一条条件有原文依据，一条是编的；记下收到的资料。
function fakeGenerator({ fail } = {}) {
  const calls = [];
  return {
    version: 'fake-1',
    calls,
    async generate(material) {
      calls.push(material);
      if (fail) throw new Error(fail);
      return {
        what: `${material.fullName} 把笔记变成能运行的智能体。`,
        problem: '作者称它是最快的智能体框架；帮你少写重复的胶水代码。',
        conditions: material.fullName === 'acme/agent-kit'
          ? [{ kind: '密钥', text: '需要 OpenAI 的 API Key', quote: 'Requires an OpenAI API key.' }, { kind: '付费', text: '需要付费的 Pro 套餐', quote: 'Requires a paid Pro plan.' }]
          : [],
        skills: material.skills.map((s) => ({ path: s.path, purpose: `${s.name} 的中文用途` })),
      };
    },
  };
}

function dataDirWithBoard() {
  const dir = fresh();
  mkdirSync(join(dir, 'snapshots', 'd1'), { recursive: true });
  const entries = [{ rank: 1, projectId: 101, fullName: 'acme/agent-kit', gain: 900, total: 5000 }, { rank: 2, projectId: 202, fullName: 'acme/tiny', gain: 800, total: 900 }];
  writeFileSync(join(dir, 'snapshots', 'd1', '2026-10-22.json'), JSON.stringify({ window: 'd1', statDay: '2026-10-22', entries }));
  return dir;
}
const now = () => new Date('2026-10-23T02:00:00Z');
const run = (dataDir, { upstream = fakeGitHub(repos()), generator = fakeGenerator() } = {}) => updateProfiles({ dataDir, fetch: upstream.fetch, token: 't', generator, now, sleep: async () => {} });

test('首次上榜：读 README、仓库目录和 Skill 生成项目资料；项目页有简介、原文里有的使用条件、Skill 列表和原项目链接', async () => {
  const dataDir = dataDirWithBoard();
  const generator = fakeGenerator();
  const r = await run(dataDir, { generator });
  assert.deepEqual(r.results.map((x) => [x.name, x.status]), [['acme/agent-kit', 'generated'], ['acme/tiny', 'generated']]);
  // 交给生成器的是项目原文：README 全文、根目录、按约定识别出的 Skill。
  const material = generator.calls.find((m) => m.fullName === 'acme/agent-kit');
  assert.match(material.readme.text, /Requires an OpenAI API key\./);
  assert.deepEqual(material.listing.sort(), ['README.md', 'docs/', 'skills/', 'templates/']);
  assert.deepEqual(material.skills, [
    { path: 'skills/notes', name: 'notes', description: 'Turn meeting notes into action items.' },
    { path: 'skills/pdf', name: 'pdf', description: 'Read and fill PDF forms.' },
  ]);

  const { status, body } = await visit(dataDir, 'p/acme/agent-kit');
  assert.equal(status, 200);
  assert.match(body, /<h1>acme\/agent-kit<\/h1>/);
  assert.match(body, /<a href="https:\/\/github\.com\/acme\/agent-kit">在 GitHub 打开原项目<\/a>/);
  assert.match(body, /acme\/agent-kit 把笔记变成能运行的智能体。/);
  assert.match(body, /能帮你解决：作者称它是最快的智能体框架/);
  assert.match(body, /<strong>密钥<\/strong>　需要 OpenAI 的 API Key<br><span class="note">原文：Requires an OpenAI API key\.<\/span>/);
  // 原文里没有的条件不上页面。
  assert.doesNotMatch(body, /Pro 套餐|Requires a paid Pro plan/);
  assert.match(body, /<strong>notes<\/strong>　notes 的中文用途<br><span class="note">skills\/notes<\/span>/);
  assert.match(body, /<strong>pdf<\/strong>　pdf 的中文用途<br><span class="note">skills\/pdf<\/span>/);
  assert.doesNotMatch(body, /lower|broken|half|example/);
  assert.match(body, /依据：<a href="https:\/\/github\.com\/acme\/agent-kit\/blob\/main\/README\.md">README\.md<\/a>、仓库目录和 Skill 文件/);

  const tiny = await visit(dataDir, 'p/acme/tiny');
  assert.match(tiny.body, /项目文档里没有写到付费、账号、密钥或特定环境的要求。/);
  assert.match(tiny.body, /仓库里没有按 SKILL\.md 约定写的 Skill。/);

  // 生成依据存下来：资料哈希、来源链接、原始响应。
  const saved = JSON.parse(readFileSync(join(dataDir, 'profiles', '101.json'), 'utf8'));
  assert.equal(saved.generated.materialHash, saved.material.hash);
  assert.equal(saved.generated.droppedConditions, 1);
  assert.equal(saved.material.readme.htmlUrl, 'https://github.com/acme/agent-kit/blob/main/README.md');
  assert.ok(readFileSync(join(dataDir, saved.material.evidence.readme.path)).length > 0);
  assert.equal(saved.material.evidence.skills.length, 4);
});

test('资料没变不重复生成：没有新提交就不重读；有新提交但资料没变也不重新生成；README 变了才重新生成', async () => {
  const dataDir = dataDirWithBoard();
  await run(dataDir);
  const list = repos();
  const again = fakeGitHub(list);
  const generator = fakeGenerator();
  let r = await run(dataDir, { upstream: again, generator });
  assert.deepEqual(r.results.map((x) => x.status), ['unchanged', 'unchanged']);
  assert.equal(generator.calls.length, 0);
  assert.ok(!again.calls.some((u) => /readme|trees|raw\.githubusercontent/.test(u)), '没有新提交就不重读资料');

  list[0].info.pushed_at = '2026-10-23T01:00:00Z';
  r = await run(dataDir, { upstream: fakeGitHub(list), generator });
  assert.deepEqual(r.results.map((x) => x.status), ['reused', 'unchanged']);
  assert.equal(generator.calls.length, 0);

  list[0].info.pushed_at = '2026-10-23T02:00:00Z';
  list[0].readme = `${AGENT_README}\nNow also supports Python.\n`;
  r = await run(dataDir, { upstream: fakeGitHub(list), generator });
  assert.deepEqual(r.results.map((x) => x.status), ['generated', 'unchanged']);
  assert.equal(generator.calls.length, 1);
  assert.match(generator.calls[0].readme.text, /supports Python/);
});

test('生成失败或 Codex 登录失效：项目页显示“简介生成中”，不拿猜测的内容顶替；下次运行再试', async () => {
  const dataDir = dataDirWithBoard();
  const r = await run(dataDir, { generator: fakeGenerator({ fail: 'Not logged in. Run codex login.' }) });
  assert.deepEqual(r.results.map((x) => x.status), ['failed', 'failed']);
  const { body } = await visit(dataDir, 'p/acme/agent-kit');
  assert.match(body, /<p>简介生成中。<\/p>/);
  assert.doesNotMatch(body, /使用条件|能帮你解决/);
  // Skill 列表来自 SKILL.md 原文，照常显示（用途用原文的 description）。
  assert.match(body, /<strong>pdf<\/strong>　Read and fill PDF forms\./);
  assert.match(JSON.parse(readFileSync(join(dataDir, 'profiles', '101.json'), 'utf8')).lastError.message, /Not logged in/);

  // 下次运行（即使没有新提交）照样重试，成功后显示简介。
  const generator = fakeGenerator();
  const next = await run(dataDir, { generator });
  assert.deepEqual(next.results.map((x) => x.status), ['generated', 'generated']);
  assert.match((await visit(dataDir, 'p/acme/agent-kit')).body, /把笔记变成能运行的智能体/);
});

test('资料读不全时保留上一次的资料和简介，下次再读', async () => {
  const dataDir = dataDirWithBoard();
  await run(dataDir);
  const list = repos();
  list[0].info.pushed_at = '2026-10-23T01:00:00Z';
  list[0].rawMissing = ['skills/pdf/SKILL.md'];
  const r = await run(dataDir, { upstream: fakeGitHub(list) });
  assert.equal(r.results[0].status, 'error');
  assert.match(r.results[0].error, /skills\/pdf\/SKILL\.md 读取失败/);
  const saved = JSON.parse(readFileSync(join(dataDir, 'profiles', '101.json'), 'utf8'));
  assert.equal(saved.pushedAt, '2026-10-22T01:00:00Z');
  assert.match((await visit(dataDir, 'p/acme/agent-kit')).body, /<strong>pdf<\/strong>/);
});

test('项目页只给有资料或正在榜单上的项目（榜单上的项目名链到项目页，见首页测试）', async () => {
  const dataDir = dataDirWithBoard();
  // 还没生成资料的上榜项目：只有原项目链接和“简介生成中”。
  const pending = await visit(dataDir, 'p/acme/tiny');
  assert.equal(pending.status, 200);
  assert.match(pending.body, /在 GitHub 打开原项目/);
  assert.match(pending.body, /简介生成中/);
  assert.equal((await visit(dataDir, 'p/nobody/nothing')).status, 404);
  assert.equal((await visit(dataDir, 'p/acme')).status, 404);
});

test('Skill 识别按 SKILL.md 约定：正例和反例', () => {
  const ok = (path, text) => parseSkill(path, text);
  assert.deepEqual(ok('skills/pdf/SKILL.md', '---\nname: pdf\ndescription: Read PDFs.\n---\n'), { path: 'skills/pdf', name: 'pdf', description: 'Read PDFs.' });
  // 仓库根目录本身就是一个 Skill。
  assert.deepEqual(ok('SKILL.md', '---\nname: root-skill\ndescription: "Does: things"\n---\n'), { path: '.', name: 'root-skill', description: 'Does: things' });
  // 多行写法（| 和 >）、Windows 换行、开头的 BOM。
  assert.equal(ok('a/SKILL.md', '---\nname: a\ndescription: |\n  line one\n  line two\n---\n').description, 'line one\nline two');
  assert.equal(ok('a/SKILL.md', '﻿---\r\nname: a\r\ndescription: >-\r\n  folded\r\n  text\r\n---\r\n').description, 'folded text');
  // 反例：文件名不对、头不在开头、没有头、缺 name、缺 description、description 为空。
  assert.equal(ok('a/skill.md', '---\nname: a\ndescription: b\n---\n'), null);
  assert.equal(ok('a/SKILL.md.example', '---\nname: a\ndescription: b\n---\n'), null);
  assert.equal(ok('a/NOT_SKILL.md', '---\nname: a\ndescription: b\n---\n'), null);
  assert.equal(ok('a/SKILL.md', '# Title\n---\nname: a\ndescription: b\n---\n'), null);
  assert.equal(ok('a/SKILL.md', 'name: a\ndescription: b\n'), null);
  assert.equal(ok('a/SKILL.md', '---\ndescription: b\n---\n'), null);
  assert.equal(ok('a/SKILL.md', '---\nname: a\n---\n'), null);
  assert.equal(ok('a/SKILL.md', '---\nname: a\ndescription: ""\n---\n'), null);
});

// 假的 codex 命令：记下参数和收到的提示，按 --output-schema 的格式写出结果；或者像登录失效那样报错退出。
function fakeCodex(dir, script) {
  const bin = join(dir, 'codex');
  writeFileSync(bin, `#!/usr/bin/env node\n${script}\n`);
  chmodSync(bin, 0o755);
  return bin;
}

test('Codex 生成器：非交互、结构化输出、只读沙箱、关掉执行命令的工具；失败时报出原因', async () => {
  const dir = fresh();
  const log = join(dir, 'log.json');
  const bin = fakeCodex(dir, `
    const fs = require('node:fs');
    const args = process.argv.slice(2);
    const input = fs.readFileSync(0, 'utf8');
    const schema = JSON.parse(fs.readFileSync(args[args.indexOf('--output-schema') + 1], 'utf8'));
    fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify({ args, input, schema, cwd: process.cwd() }));
    fs.writeFileSync(args[args.indexOf('-o') + 1], JSON.stringify({ what: '干什么', problem: '解决什么', conditions: [], skills: [] }));
  `);
  const material = { fullName: 'acme/agent-kit', description: 'Agents', topics: ['agent'], listing: ['README.md', 'skills/'], readme: { path: 'README.md', text: AGENT_README, truncated: false }, skills: [{ path: 'skills/pdf', name: 'pdf', description: 'Read PDFs.' }] };
  const result = await codexGenerator({ bin }).generate(material);
  assert.deepEqual(result, { what: '干什么', problem: '解决什么', conditions: [], skills: [] });
  const seen = JSON.parse(readFileSync(log, 'utf8'));
  assert.equal(seen.args[0], 'exec');
  for (const flag of ['--ephemeral', '--ignore-user-config', '--skip-git-repo-check']) assert.ok(seen.args.includes(flag), flag);
  assert.equal(seen.args[seen.args.indexOf('--sandbox') + 1], 'read-only');
  assert.deepEqual(seen.args.filter((a, i) => seen.args[i - 1] === '--disable'), ['shell_tool', 'unified_exec']);
  assert.equal(seen.args.at(-1), '-');
  assert.deepEqual(seen.schema.required, ['what', 'problem', 'conditions', 'skills']);
  assert.match(seen.input, /Requires an OpenAI API key\./);
  assert.match(seen.input, /path: skills\/pdf/);
  assert.match(seen.input, /一律不执行/);
  // 在空的临时目录里运行，跑完删掉。
  assert.match(seen.cwd, /gc-codex-/);
  assert.ok(!readdirSync(tmpdir()).includes(seen.cwd.split('/').pop()));

  const broken = fakeCodex(fresh(), "process.stderr.write('Error: Not logged in. Run codex login.\\n'); process.exit(1);");
  await assert.rejects(codexGenerator({ bin: broken }).generate(material), /Codex 生成失败（退出码 1）：Error: Not logged in/);
  const slow = fakeCodex(fresh(), 'setTimeout(() => {}, 10000);');
  await assert.rejects(codexGenerator({ bin: slow, timeoutMs: 200 }).generate(material), /超时被停止/);
});
