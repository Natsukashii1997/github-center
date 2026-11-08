// #78（PRD v2.1 P0-04）：每条收藏的决策状态、收藏理由、下一步，状态改变时间和最近交接。全部走登录后的 HTTP。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { http, form, serve, testAccount, dataOf } from './helpers/web.js';

function dataDir() {
  const dir = mkdtempSync(join(tmpdir(), 'gc-favd-'));
  mkdirSync(join(dir, 'profiles'), { recursive: true });
  writeFileSync(join(dir, 'profiles', '101.json'), JSON.stringify({
    projectId: 101, fullName: 'acme/agent-kit', defaultBranch: 'main', generated: null,
    material: { hash: 'h1', listing: ['README.md'], readme: { path: 'README.md', htmlUrl: 'https://github.com/acme/agent-kit/blob/main/README.md', truncated: false }, docs: [], skills: [{ path: 'skills/pdf', name: 'pdf', description: 'Read PDFs.' }], fetchedAt: '2026-10-23T02:00:00Z' },
  }));
  return dir;
}
const api = (site, fields) => http(site.url + 'api/favorites', form(fields, { cookie: site.cookie }));
const body = (res) => [res.status, JSON.parse(res.body)];
const item = async (site, skill = '') => dataOf((await http(site.url + 'favorites', { headers: { cookie: site.cookie } })).body).items.find((x) => (x.skill?.path ?? '') === skill);
const pick = (x) => ({ status: x.status, reason: x.reason, next: x.next, handoff: x.handoff });
async function loginAs(site, dir, name) {
  const res = await http(site.url + 'login', form({ name, password: testAccount(dir, name) }));
  return { ...site, cookie: res.headers['set-cookie'][0].split(';')[0] };
}

test('新收藏默认「感兴趣」，理由和下一步留空；改状态、理由、下一步后刷新还在', async () => {
  const site = await serve(dataDir());
  try {
    await api(site, { project_id: '101', skill: '', action: 'add' });
    let x = await item(site);
    assert.deepEqual(pick(x), { status: 'int', reason: '', next: '', handoff: null });
    assert.equal(x.statusAt, null);

    const [code, saved] = body(await api(site, { project_id: '101', skill: '', action: 'update', status: 'res', reason: '  想和猛鬼兽对比 ', next_step: '先研究记忆存在哪里' }));
    assert.equal(code, 200);
    assert.deepEqual([saved.status, saved.reason, saved.next], ['res', '想和猛鬼兽对比', '先研究记忆存在哪里']);
    x = await item(site);
    assert.deepEqual(pick(x), { status: 'res', reason: '想和猛鬼兽对比', next: '先研究记忆存在哪里', handoff: null });
    assert.ok(Date.parse(x.statusAt) > 0);

    // 只改理由、或者"改"成同一个状态，状态改变时间不动；理由可以清空。
    const first = x.statusAt;
    await new Promise((r) => setTimeout(r, 5));
    await api(site, { project_id: '101', skill: '', action: 'update', reason: '' });
    await api(site, { project_id: '101', skill: '', action: 'update', status: 'res' });
    x = await item(site);
    assert.deepEqual([x.reason, x.next, x.statusAt], ['', '先研究记忆存在哪里', first]);
    // 换状态才更新时间。
    await api(site, { project_id: '101', skill: '', action: 'update', status: 'no', reason: '要云端账号，不适合本机' });
    x = await item(site);
    assert.equal(x.status, 'no');
    assert.ok(x.statusAt > first);
  } finally {
    site.close();
  }
});

test('Skill 收藏各自有状态；取消收藏再收藏回到默认', async () => {
  const site = await serve(dataDir());
  try {
    await api(site, { project_id: '101', skill: '', action: 'add' });
    await api(site, { project_id: '101', skill: 'skills/pdf', action: 'add' });
    await api(site, { project_id: '101', skill: 'skills/pdf', action: 'update', status: 'yes', next_step: '已装进 Claude Code' });
    assert.equal((await item(site)).status, 'int');
    assert.deepEqual([(await item(site, 'skills/pdf')).status, (await item(site, 'skills/pdf')).next], ['yes', '已装进 Claude Code']);
    await api(site, { project_id: '101', skill: 'skills/pdf', action: 'remove' });
    await api(site, { project_id: '101', skill: 'skills/pdf', action: 'add' });
    assert.deepEqual(pick(await item(site, 'skills/pdf')), { status: 'int', reason: '', next: '', handoff: null });
  } finally {
    site.close();
  }
});

test('拒绝：不认识的状态、理由或下一步太长、改没收藏的那一条；别的账号改不了我的', async () => {
  const dir = dataDir();
  const site = await serve(dir);
  try {
    await api(site, { project_id: '101', skill: '', action: 'add' });
    assert.deepEqual(body(await api(site, { project_id: '101', skill: '', action: 'update', status: 'done' })), [400, { error: '不认识的决策状态' }]);
    assert.deepEqual(body(await api(site, { project_id: '101', skill: '', action: 'update', reason: '长'.repeat(501) })), [400, { error: '理由最多 500 字' }]);
    assert.deepEqual(body(await api(site, { project_id: '101', skill: '', action: 'update', next_step: '长'.repeat(501) })), [400, { error: '下一步最多 500 字' }]);
    assert.deepEqual(body(await api(site, { project_id: '101', skill: 'skills/pdf', action: 'update', status: 'res' })), [404, { error: '还没收藏这一条' }]);
    const other = await loginAs(site, dir, 'other');
    assert.deepEqual(body(await api(other, { project_id: '101', skill: '', action: 'update', status: 'yes' })), [404, { error: '还没收藏这一条' }]);
    assert.equal((await item(site)).status, 'int');
    // 另一个账号收藏同一个项目，两边的状态各管各的。
    await api(other, { project_id: '101', skill: '', action: 'add' });
    await api(other, { project_id: '101', skill: '', action: 'update', status: 'yes', reason: '我在用' });
    assert.deepEqual([(await item(site)).status, (await item(site)).reason], ['int', '']);
    assert.deepEqual([(await item(other)).status, (await item(other)).reason], ['yes', '我在用']);
  } finally {
    site.close();
  }
});

test('复制交接记"最近交接"：只表示复制过；没收藏的照常复制、不记；类型只认研究、试用、安装', async () => {
  const site = await serve(dataDir());
  try {
    assert.deepEqual(body(await api(site, { project_id: '101', skill: '', action: 'handoff', type: '安装' })), [200, { recorded: false }]);
    await api(site, { project_id: '101', skill: '', action: 'add' });
    assert.deepEqual(body(await api(site, { project_id: '101', skill: '', action: 'handoff', type: '安装' })), [200, { recorded: true }]);
    let x = await item(site);
    assert.equal(x.handoff.type, '安装');
    assert.ok(Date.parse(x.handoff.at) > 0);
    // 记交接不改状态，也不动状态改变时间。
    assert.deepEqual([x.status, x.statusAt], ['int', null]);
    await api(site, { project_id: '101', skill: '', action: 'handoff', type: '研究' });
    assert.equal((await item(site)).handoff.type, '研究');
    assert.deepEqual(body(await api(site, { project_id: '101', skill: '', action: 'handoff', type: '部署' })), [400, { error: '不认识的交接类型' }]);
  } finally {
    site.close();
  }
});

test('旧库里已有的收藏：启动时自动补上新字段，按默认值显示，不丢收藏', async () => {
  const dir = dataDir();
  const db = new DatabaseSync(join(dir, 'center.db'));
  db.exec(`CREATE TABLE favorites(
    account_id INTEGER NOT NULL, project_id INTEGER NOT NULL, full_name TEXT NOT NULL,
    skill_path TEXT NOT NULL DEFAULT '', skill_name TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
    PRIMARY KEY (account_id, project_id, skill_path))`);
  db.prepare('INSERT INTO favorites VALUES (1, 101, ?, ?, ?, ?)').run('acme/agent-kit', '', '', '2026-11-01T00:00:00.000Z');
  db.close();
  const site = await serve(dir);
  try {
    const x = await item(site);
    assert.equal(x.repo, 'acme/agent-kit');
    assert.deepEqual(pick(x), { status: 'int', reason: '', next: '', handoff: null });
    await api(site, { project_id: '101', skill: '', action: 'update', status: 'res' });
    assert.equal((await item(site)).status, 'res');
  } finally {
    site.close();
  }
});
