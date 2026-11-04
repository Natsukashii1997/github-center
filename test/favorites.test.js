// #8：收藏项目与单个 Skill。全部走登录后的 HTTP（接缝 2），两个账号的收藏互不可见。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { http, form, serve, testAccount, dataOf } from './helpers/web.js';

// 一个有资料的项目（两个 Skill），另有一个在榜单上、还没读到资料的项目。
const profilePath = (dir) => join(dir, 'profiles', '101.json');
function dataDirWithProfile() {
  const dir = mkdtempSync(join(tmpdir(), 'gc-fav-'));
  mkdirSync(join(dir, 'profiles'), { recursive: true });
  mkdirSync(join(dir, 'snapshots', 'd1'), { recursive: true });
  writeFileSync(join(dir, 'snapshots', 'd1', '2026-10-22.json'), JSON.stringify({ window: 'd1', statDay: '2026-10-22', generatedAt: '2026-10-23T08:40:00Z', entries: [{ rank: 1, projectId: 202, fullName: 'acme/tiny', gain: 9, total: 99 }] }));
  writeFileSync(profilePath(dir), JSON.stringify({
    projectId: 101,
    fullName: 'acme/agent-kit',
    defaultBranch: 'main',
    material: {
      hash: 'h1',
      listing: ['README.md', 'skills/'],
      readme: { path: 'README.md', htmlUrl: 'https://github.com/acme/agent-kit/blob/main/README.md', truncated: false },
      docs: [],
      skills: [{ path: 'skills/pdf', name: 'pdf', description: 'Read PDFs.' }, { path: 'skills/notes', name: 'notes', description: 'Take notes.' }],
      fetchedAt: '2026-10-23T02:00:00Z',
    },
    generated: null,
  }));
  return dir;
}
const post = (site, fields, headers = {}) => http(site.url + 'favorites', form(fields, { cookie: site.cookie, ...headers }));
const add = (site, skill = '') => post(site, { project_id: '101', skill, action: 'add', next: '/p/acme/agent-kit' });
const remove = (site, skill = '') => post(site, { project_id: '101', skill, action: 'remove', next: '/favorites' });
// #14 起页面由页面脚本画出，这里看嵌入的数据。“我的收藏”每条：[项目名, Skill 路径或空]，新收藏的在前。
const favs = (body) => dataOf(body).items.map((f) => [f.repo, f.skill?.path ?? '']);
// 项目页上这个项目的收藏状态：项目本身、已收藏的 Skill。
const savedOn = (body, repo = 'acme/agent-kit') => { const p = dataOf(body).projects[repo]; return { saved: p.saved, skills: p.savedSkills }; };
// 另一个账号登录，拿到它的会话 Cookie。
async function loginAs(site, dataDir, name) {
  const res = await http(site.url + 'login', form({ name, password: testAccount(dataDir, name) }));
  return { ...site, cookie: res.headers['set-cookie'][0].split(';')[0] };
}

test('收藏和取消收藏项目、单个 Skill；“我的收藏”列出全部，能直达项目页', async () => {
  const site = await serve(dataDirWithProfile());
  try {
    let page = await site.get('p/acme/agent-kit');
    assert.deepEqual(savedOn(page.body), { saved: false, skills: [] });
    assert.deepEqual(dataOf(page.body).projects['acme/agent-kit'].skills.map((s) => s.path), ['skills/pdf', 'skills/notes']);
    assert.deepEqual(favs((await site.get('favorites')).body), []);

    const r = await add(site);
    assert.equal(r.status, 303);
    assert.equal(r.headers.location, '/p/acme/agent-kit');
    await add(site, 'skills/pdf');
    // 重复收藏不报错，也不会多出一条。
    assert.equal((await add(site, 'skills/pdf')).status, 303);

    page = await site.get('p/acme/agent-kit');
    assert.deepEqual(savedOn(page.body), { saved: true, skills: ['skills/pdf'] });

    const mine = await site.get('favorites');
    assert.match(mine.body, /<title>收藏 · Github·Tidings<\/title>/);
    // 新收藏的在前；都能在站内打开（页面脚本把 Skill 链到项目页上那一条 #skill-<路径>）。
    const items = dataOf(mine.body).items;
    assert.deepEqual(favs(mine.body), [['acme/agent-kit', 'skills/pdf'], ['acme/agent-kit', '']]);
    assert.deepEqual(items.map((f) => [f.openable, f.renamed, f.skill?.missing ?? null]), [[true, false, false], [true, false, null]]);
    assert.equal(items[0].skill.name, 'pdf');
    assert.equal((await site.get('p/acme/agent-kit')).status, 200);

    const gone = await remove(site);
    assert.equal(gone.headers.location, '/favorites');
    assert.deepEqual(favs((await site.get('favorites')).body), [['acme/agent-kit', 'skills/pdf']]);
    await remove(site, 'skills/pdf');
    assert.deepEqual(favs((await site.get('favorites')).body), []);
  } finally {
    site.close();
  }
});

test('退出再登录，收藏仍在', async () => {
  const dataDir = dataDirWithProfile();
  const site = await serve(dataDir);
  try {
    await add(site, 'skills/notes');
    await http(site.url + 'logout', form({}, { cookie: site.cookie }));
    assert.equal((await site.get('favorites')).status, 303, '退出后旧 Cookie 进不去');
    const again = await loginAs(site, dataDir, 'tester');
    const mine = await http(again.url + 'favorites', { headers: { cookie: again.cookie } });
    assert.deepEqual(favs(mine.body), [['acme/agent-kit', 'skills/notes']]);
  } finally {
    site.close();
  }
});

test('两个账号的收藏互不可见，也动不了对方的收藏', async () => {
  const dataDir = dataDirWithProfile();
  const a = await serve(dataDir);
  try {
    const b = await loginAs(a, dataDir, 'other');
    await add(a);
    await add(a, 'skills/pdf');
    const getB = (path) => http(b.url + path, { headers: { cookie: b.cookie } });
    assert.deepEqual(favs((await getB('favorites')).body), []);
    assert.deepEqual(savedOn((await getB('p/acme/agent-kit')).body), { saved: false, skills: [] });
    // B 取消同一个项目，只影响 B 自己（本来就没有），A 的还在。
    await remove(b);
    await add(b, 'skills/notes');
    assert.deepEqual(favs((await a.get('favorites')).body), [['acme/agent-kit', 'skills/pdf'], ['acme/agent-kit', '']]);
    assert.deepEqual(favs((await getB('favorites')).body), [['acme/agent-kit', 'skills/notes']]);
  } finally {
    a.close();
  }
});

test('只接受本站这个端口提交的表单（登录、退出、收藏都是）；未登录不能收藏；没有资料的项目或 Skill 不能收藏', async () => {
  const dataDir = dataDirWithProfile();
  const site = await serve(dataDir);
  try {
    const own = site.url.slice(0, -1);
    const otherPort = `http://127.0.0.1:${Number(new URL(site.url).port) + 1}`;
    // 本机别的端口上的网页代为提交：浏览器会带上会话 Cookie，所以要按端口挡住。
    assert.equal((await post(site, { project_id: '101', skill: '', action: 'add' }, { origin: otherPort })).status, 403);
    assert.equal((await post(site, { project_id: '101', skill: '', action: 'add' }, { origin: 'http://localhost:9' })).status, 403);
    assert.equal((await http(site.url + 'login', form({ name: 'tester', password: 'x' }, { origin: otherPort }))).status, 403);
    assert.equal((await http(site.url + 'logout', form({}, { cookie: site.cookie, origin: otherPort }))).status, 403);
    assert.deepEqual(favs((await site.get('favorites')).body), []);
    assert.equal((await post(site, { project_id: '101', skill: '', action: 'add' }, { origin: own })).status, 303);
    assert.equal((await post(site, { project_id: '101', skill: '', action: 'remove' }, { origin: own.replace('127.0.0.1', 'localhost') })).status, 303);

    // 未登录：被引导去登录，什么也没存。
    const anon = await http(site.url + 'favorites', form({ project_id: '101', skill: '', action: 'add' }));
    assert.equal(anon.status, 303);
    assert.match(anon.headers.location, /^\/login\?next=/);
    assert.deepEqual(favs((await site.get('favorites')).body), []);

    assert.equal((await post(site, { project_id: '999', skill: '', action: 'add' })).status, 404);
    assert.equal((await post(site, { project_id: 'abc', skill: '', action: 'add' })).status, 404);
    assert.equal((await post(site, { project_id: '101', skill: 'skills/none', action: 'add' })).status, 404);
    assert.equal((await post(site, { project_id: '101', skill: '', action: 'delete-all' })).status, 400);
    // 跳回地址同样只认本站路径。
    assert.equal((await post(site, { project_id: '101', skill: '', action: 'add', next: '//evil.example/' })).headers.location, '/');
  } finally {
    site.close();
  }
});

test('还没读到资料的上榜项目也能收藏整个项目（不能收藏 Skill）；收藏 Skill 后跳回页上那一条', async () => {
  const site = await serve(dataDirWithProfile());
  try {
    const page = await site.get('p/acme/tiny');
    // 简介生成中：在榜上但还没有资料，能收藏整个项目，没有 Skill 可收藏。
    const d = dataOf(page.body);
    assert.deepEqual([d.page.hasProfile, d.projects['acme/tiny'].what, d.projects['acme/tiny'].id, d.projects['acme/tiny'].skills], [false, null, 202, []]);
    assert.deepEqual(savedOn(page.body, 'acme/tiny'), { saved: false, skills: [] });
    assert.equal((await post(site, { project_id: '202', skill: '', action: 'add', next: '/p/acme/tiny' })).status, 303);
    assert.equal((await post(site, { project_id: '202', skill: 'skills/x', action: 'add' })).status, 404);
    assert.equal((await post(site, { project_id: '0', skill: '', action: 'add' })).status, 404);
    assert.deepEqual(favs((await site.get('favorites')).body), [['acme/tiny', '']]);
    assert.equal(savedOn((await site.get('p/acme/tiny')).body, 'acme/tiny').saved, true);

    const r = await post(site, { project_id: '101', skill: 'skills/pdf', action: 'add', next: '/p/acme/agent-kit#skill-skills/pdf' });
    assert.equal(r.headers.location, '/p/acme/agent-kit#skill-skills/pdf');
  } finally {
    site.close();
  }
});

test('项目改名、Skill 从仓库删掉、项目资料不在了：“我的收藏”照样列出，写明情况，也能取消', async () => {
  const dataDir = dataDirWithProfile();
  const site = await serve(dataDir);
  try {
    await add(site);
    await add(site, 'skills/pdf');
    const profile = JSON.parse(readFileSync(profilePath(dataDir), 'utf8'));
    profile.fullName = 'acme/agent-kit-2';
    profile.material.skills = profile.material.skills.filter((s) => s.path !== 'skills/pdf');
    writeFileSync(profilePath(dataDir), JSON.stringify(profile));
    let mine = (await site.get('favorites')).body;
    // 用改名后的名字直达（写明原来收藏时的名字）；删掉的 Skill 写明。
    assert.deepEqual(favs(mine), [['acme/agent-kit-2', 'skills/pdf'], ['acme/agent-kit-2', '']]);
    assert.deepEqual(dataOf(mine).items.map((f) => [f.savedName, f.renamed, f.openable, f.skill?.missing ?? null]), [['acme/agent-kit', true, true, true], ['acme/agent-kit', true, true, null]]);
    assert.equal((await site.get('p/acme/agent-kit-2')).status, 200);

    rmSync(profilePath(dataDir));
    mine = (await site.get('favorites')).body;
    // 资料不在了：用收藏时的名字列出，站内打不开（页面脚本改链到 GitHub 原项目）。
    assert.deepEqual(dataOf(mine).items.map((f) => [f.repo, f.hasProfile, f.openable]), [['acme/agent-kit', false, false], ['acme/agent-kit', false, false]]);
    await remove(site, 'skills/pdf');
    await remove(site);
    assert.deepEqual(favs((await site.get('favorites')).body), []);
  } finally {
    site.close();
  }
});

test('收藏接口（首页上的收藏按钮用）：收藏和取消回 JSON，拒绝也回 JSON；别的端口来的请求拒绝', async () => {
  const dataDir = dataDirWithProfile();
  const site = await serve(dataDir);
  const api = (fields, headers = {}) => http(site.url + 'api/favorites', form(fields, { cookie: site.cookie, ...headers }));
  try {
    const added = await api({ project_id: '101', skill: '', action: 'add' });
    assert.deepEqual([added.status, JSON.parse(added.body)], [200, { saved: true }]);
    assert.equal((await api({ project_id: '101', skill: 'skills/pdf', action: 'add' })).status, 200);
    // 没读到资料的上榜项目也能收藏整个项目（同 #8）。
    assert.equal((await api({ project_id: '202', skill: '', action: 'add' })).status, 200);
    let mine = favs((await site.get('favorites')).body).map((f) => f.join(' '));
    assert.deepEqual(mine.sort(), ['acme/agent-kit ', 'acme/agent-kit skills/pdf', 'acme/tiny '].sort());
    const removed = await api({ project_id: '101', skill: '', action: 'remove' });
    assert.deepEqual(JSON.parse(removed.body), { saved: false });
    mine = favs((await site.get('favorites')).body).map((f) => f.join(' '));
    assert.ok(!mine.includes('acme/agent-kit '));
    const missing = await api({ project_id: '101', skill: 'skills/nope', action: 'add' });
    assert.deepEqual([missing.status, JSON.parse(missing.body)], [404, { error: '没有这个项目或 Skill 的资料' }]);
    const odd = await api({ project_id: '101', skill: '', action: 'add' }, { origin: 'http://127.0.0.1:5999' });
    assert.deepEqual([odd.status, JSON.parse(odd.body)], [403, { error: '只接受本站提交的表单' }]);
  } finally {
    site.close();
  }
});

test('我的收藏按类别分组（#22 收藏架）：项目归第一个分类，Skill 收藏全归「Skill」组；组按收藏数从多到少；卡片一句话取补资料，没生成就空着', async () => {
  const dataDir = dataDirWithProfile();
  // 101 已生成一句话等短字段；303 是旧版生成（没有一句话）；202 在榜上、还没资料。
  const profile = JSON.parse(readFileSync(profilePath(dataDir), 'utf8'));
  profile.generated = { materialHash: 'h1', what: '做什么', problem: '解决什么', conditions: [], skillPurposes: {}, line: '给智能体配一套工具', use: ['读 PDF'], scene: ['整理资料'], tag: '智能体工具', type: 'Skill' };
  writeFileSync(profilePath(dataDir), JSON.stringify(profile));
  writeFileSync(join(dataDir, 'profiles', '303.json'), JSON.stringify({ ...profile, projectId: 303, fullName: 'acme/flow', generated: { materialHash: 'h1', what: '旧版', problem: '旧版', conditions: [], skillPurposes: {} } }));
  writeFileSync(join(dataDir, 'categories.json'), JSON.stringify({ items: {
    101: { id: 101, fullName: 'acme/agent-kit', categories: ['Agent／MCP', 'Skill'], source: 'batch' },
    202: { id: 202, fullName: 'acme/tiny', categories: ['Agent／MCP'], source: 'batch' },
    303: { id: 303, fullName: 'acme/flow', categories: ['工作流自动化'], source: 'batch' },
  } }));
  const site = await serve(dataDir);
  try {
    for (const [id, skill] of [['303', ''], ['101', ''], ['101', 'skills/pdf'], ['101', 'skills/notes'], ['202', '']]) await post(site, { project_id: id, skill, action: 'add' });
    const d = dataOf((await site.get('favorites')).body);
    // 新收藏的在前；两组一样多时最近收藏的组在前。
    assert.deepEqual(d.items.map((x) => [x.repo, x.skill?.path ?? '', x.shelf, x.cat, x.line]), [
      ['acme/tiny', '', 'Agent／MCP', 'Agent／MCP', null],
      ['acme/agent-kit', 'skills/notes', 'Skill', 'Agent／MCP', 'Take notes.'],
      ['acme/agent-kit', 'skills/pdf', 'Skill', 'Agent／MCP', 'Read PDFs.'],
      ['acme/agent-kit', '', 'Agent／MCP', 'Agent／MCP', '给智能体配一套工具'],
      ['acme/flow', '', '工作流自动化', '工作流自动化', null],
    ]);
    assert.deepEqual(d.shelves, [{ name: 'Agent／MCP', n: 2 }, { name: 'Skill', n: 2 }, { name: '工作流自动化', n: 1 }]);
    // 详情栏要的：说明标签、定义标签等短字段跟着项目走；在涨星榜上的带名次，统计格高亮那个窗口。
    const kit = d.projects['acme/agent-kit'];
    assert.deepEqual([kit.tag, kit.type, kit.use, kit.scene], ['智能体工具', 'Skill', ['读 PDF'], ['整理资料']]);
    assert.deepEqual([d.projects['acme/flow'].line, d.projects['acme/flow'].tag, d.projects['acme/flow'].type], [null, null, null]);
    assert.deepEqual([d.views['acme/tiny'].win, d.views['acme/tiny'].ranks.map((r) => r.rank)], ['d1', [1]]);
    assert.deepEqual([d.views['acme/agent-kit'].win, d.views['acme/agent-kit'].ranks], [null, []]);
    // Skill 从仓库删掉：照样在「Skill」组，标成已不在仓库。
    profile.material.skills = profile.material.skills.filter((s) => s.path !== 'skills/pdf');
    writeFileSync(profilePath(dataDir), JSON.stringify(profile));
    const after = dataOf((await site.get('favorites')).body).items.find((x) => x.skill?.path === 'skills/pdf');
    assert.deepEqual([after.shelf, after.skill.missing], ['Skill', true]);
  } finally {
    site.close();
  }
});
