// #7：安装指令。指令内容按“整个项目或单个 Skill”和“Claude Code 或 Codex”生成（直接测），项目页的选择和复制走登录后的 HTTP（接缝 2）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installInstruction } from '../src/profiles/index.js';
import { visit } from './helpers/web.js';

// 一份存下的项目资料：有 README、一份文档、两个 Skill、.claude-plugin/，简介里整理出一条条件（原文带 < 和换行）。
const profile = () => ({
  projectId: 101,
  fullName: 'acme/agent-kit',
  defaultBranch: 'main',
  material: {
    hash: 'h1',
    listing: ['.claude-plugin/', 'README.md', 'docs/', 'skills/'],
    readme: { path: 'README.md', htmlUrl: 'https://github.com/acme/agent-kit/blob/main/README.md', truncated: false },
    docs: [{ path: 'docs/install.md', truncated: false }],
    skills: [
      { path: 'skills/pdf', name: 'pdf', description: 'Read and fill PDF forms.' },
      { path: 'skills/notes', name: 'notes', description: 'Turn meeting notes\ninto action items.' },
    ],
    fetchedAt: '2026-10-23T02:00:00Z',
  },
  generated: {
    materialHash: 'h1',
    at: '2026-10-23T02:00:00Z',
    what: '把笔记变成能运行的智能体。',
    problem: '少写重复的胶水代码。',
    conditions: [{ kind: '密钥', text: '需要 OpenAI 的 API Key', quote: 'Requires an OpenAI API key\n(<Node 20).' }],
    droppedConditions: 0,
    skillPurposes: { 'skills/pdf': '读取和填写 PDF 表单' },
  },
});
const make = (opts, p = profile()) => installInstruction({ profile: p, ...opts });

test('整个项目、交给 Claude Code：依据项目文档装，查不到先读官方文档、不编命令；缺账号密钥或要付费就停下；装好调用一次并说明用法', () => {
  const text = make({ ai: 'claude-code', skillPath: '' });
  assert.match(text, /^请在你所在的这台电脑上，帮我安装并配置 GitHub 项目 acme\/agent-kit（https:\/\/github\.com\/acme\/agent-kit），装好后确认它能正常调用，最后告诉我怎么用。/);
  assert.match(text, /先读项目文档：README（https:\/\/github\.com\/acme\/agent-kit\/blob\/main\/README\.md）、docs\/install\.md（https:\/\/github\.com\/acme\/agent-kit\/blob\/main\/docs\/install\.md），按文档里写的步骤安装和配置。/);
  assert.match(text, /文档里查不到的步骤，先去读官方文档；还是查不到就停下来告诉我，不要自己编命令。/);
  assert.match(text, /需要账号、API Key、Token 或付费时，停下来告诉我缺什么、去哪里开通，等我处理；不要自己注册、付费/);
  assert.match(text, /装好后实际调用一次/);
  assert.match(text, /最后告诉我：装在了哪里、怎么调用、最常用的一两个用法。/);
  // 项目资料里整理到的条件一并附上（原文压成一行）。
  assert.match(text, /- 密钥：需要 OpenAI 的 API Key（原文：Requires an OpenAI API key \(<Node 20\)\.）/);
  // 只给 Claude Code 的插件提示；仓库里有 Skill 时先问要哪些。
  assert.match(text, /仓库根目录有 \.claude-plugin\/，项目可能支持作为 Claude Code 插件安装/);
  assert.match(text, /仓库里有 2 个 Skill；文档没说要全部装上的，先问我要哪些。/);
  // 中心不替项目编命令行。
  assert.doesNotMatch(text, /npm install|pip install|git clone|brew install/);
  assert.doesNotMatch(make({ ai: 'codex', skillPath: '' }), /\.claude-plugin/);
});

test('单个 Skill、交给 Codex：只装这一个，写明名称、用途、位置；Skill 目录按 Codex 的约定、以官方文档为准；同名先问', () => {
  const text = make({ ai: 'codex', skillPath: 'skills/pdf' });
  assert.match(text, /^请在你所在的这台电脑上，把 GitHub 项目 acme\/agent-kit 里的 Skill「pdf」装进 Codex，装好后确认你能调用它，最后告诉我怎么用。/);
  assert.match(text, /只装这一个 Skill，不装整个仓库。/);
  assert.match(text, /- 用途：读取和填写 PDF 表单/);
  assert.match(text, /- 位置：https:\/\/github\.com\/acme\/agent-kit\/tree\/main\/skills\/pdf（skills\/pdf 目录里的 SKILL\.md/);
  // Codex 放 Skill 的位置各版本说法不一，不写死，只让它查官方文档。
  assert.match(text, /Codex 的 Skill 放在它会加载 Skill 的目录里；不同版本说法不一，先查你所用 Codex 版本的官方文档确认位置，再放进去。/);
  assert.doesNotMatch(text, /~\/\.codex/);
  assert.match(text, /- 项目文档：README（https:\/\/github\.com\/acme\/agent-kit\/blob\/main\/README\.md）、docs\/install\.md/);
  assert.match(text, /要重开会话才能生效的，告诉我去重开/);
  assert.match(text, /同名的 Skill 已经存在时，先问我要不要覆盖。/);
  assert.match(text, /不要自己编命令/);
  assert.match(text, /不要自己注册、付费/);
  // 给 Claude Code 时用它的个人 Skill 目录；没有中文用途就用 SKILL.md 原文的描述。
  const claude = make({ ai: 'claude-code', skillPath: 'skills/notes' });
  assert.match(claude, /Claude Code 的个人 Skill 放在 ~\/\.claude\/skills\/<Skill 名称>\/ 目录里。/);
  assert.match(claude, /- 用途：Turn meeting notes into action items\./);
});

test('仓库根目录本身就是 Skill：只把 SKILL.md 和它用到的文件放进去，不说“不装整个仓库”', () => {
  const p = profile();
  p.material.skills = [{ path: '.', name: 'root-skill', description: 'Does one thing.' }];
  const text = make({ ai: 'claude-code', skillPath: '.' }, p);
  assert.match(text, /要装的：这个仓库本身就是一个 Skill（SKILL\.md 在仓库根目录）。/);
  assert.match(text, /- 位置：https:\/\/github\.com\/acme\/agent-kit（仓库根目录里的 SKILL\.md/);
  assert.match(text, /把仓库里 SKILL\.md 和它用到的文件放进去（仓库自己的开发文件不用带）/);
  assert.doesNotMatch(text, /不装整个仓库/);
});

test('使用条件的说明和项目页一致：还没整理、没整理出、有条件核对不到、文档只读了开头，都如实写上', () => {
  const pending = profile();
  pending.generated = null;
  assert.match(make({ ai: 'codex', skillPath: '' }, pending), /中心还没整理出这个项目的使用条件；装之前先看文档里有没有账号、密钥或付费要求。/);
  // 资料更新后还没重新生成好，旧的条件不用。
  const stale = profile();
  stale.material.hash = 'h2';
  assert.match(make({ ai: 'codex', skillPath: '' }, stale), /中心还没整理出这个项目的使用条件/);
  const none = profile();
  Object.assign(none.generated, { conditions: [], droppedConditions: 2 });
  none.material.readme.truncated = true;
  const text = make({ ai: 'codex', skillPath: '' }, none);
  assert.match(text, /中心在读到的项目文档里没有整理出账号、密钥或付费要求。\n另有 2 条整理出的条件在原文里核对不到，没有列出。\n有的文档较长，中心只读了开头部分，后面可能还写了别的条件。\n装的过程中遇到账号、密钥或付费要求，照规则 2 停下来告诉我。$/);
  assert.doesNotMatch(text, /没有找到账号/);
});

function dataDirWithProfile() {
  const dir = mkdtempSync(join(tmpdir(), 'gc-install-'));
  mkdirSync(join(dir, 'profiles'), { recursive: true });
  writeFileSync(join(dir, 'profiles', '101.json'), JSON.stringify(profile()));
  return dir;
}

test('项目页：默认给 Claude Code、整个项目；能换成 Codex 或单个 Skill；指令在只读框里，有复制按钮和复制成功的提示', async () => {
  const dataDir = dataDirWithProfile();
  const { status, body } = await visit(dataDir, 'p/acme/agent-kit');
  assert.equal(status, 200);
  assert.match(body, /<h2 id="install">安装指令<\/h2>/);
  assert.match(body, /<form method="get" action="\/p\/acme\/agent-kit#install">/);
  assert.match(body, /<option value="claude-code" selected>Claude Code<\/option><option value="codex">Codex<\/option>/);
  assert.match(body, /<option value="" selected>整个项目<\/option><option value="skills\/pdf">Skill：pdf<\/option><option value="skills\/notes">Skill：notes<\/option>/);
  const box = body.match(/<textarea id="install-text" rows="18" readonly>([\s\S]*?)<\/textarea>/)[1];
  assert.match(box, /帮我安装并配置 GitHub 项目 acme\/agent-kit/);
  // 指令里的原文照样转义，不会破坏页面。
  assert.match(box, /\(&lt;Node 20\)/);
  assert.match(body, /<button type="button" id="copy-install">复制指令<\/button> <span id="copy-status" class="note" role="status"><\/span>/);
  assert.match(body, /navigator\.clipboard\.writeText/);
  assert.match(body, /已复制，可以粘贴给你的 AI 了/);

  const skill = await visit(dataDir, 'p/acme/agent-kit?ai=codex&skill=skills%2Fpdf');
  assert.match(skill.body, /<option value="codex" selected>Codex<\/option>/);
  assert.match(skill.body, /<option value="skills\/pdf" selected>Skill：pdf<\/option>/);
  assert.match(skill.body, /把 GitHub 项目 acme\/agent-kit 里的 Skill「pdf」装进 Codex/);

  // 不认识的选择按默认处理，不报错。
  const odd = await visit(dataDir, 'p/acme/agent-kit?ai=cursor&skill=..%2F..%2Fetc');
  assert.equal(odd.status, 200);
  assert.match(odd.body, /<option value="claude-code" selected>/);
  assert.match(odd.body, /帮我安装并配置 GitHub 项目 acme\/agent-kit/);
});
