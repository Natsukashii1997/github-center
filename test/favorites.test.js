// #8：收藏项目与单个 Skill。全部走登录后的 HTTP（接缝 2），两个账号的收藏互不可见。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { http, form, serve, testAccount } from './helpers/web.js';

// 一个有资料的项目（两个 Skill），另有一个在榜单上、还没读到资料的项目。
const profilePath = (dir) => join(dir, 'profiles', '101.json');
function dataDirWithProfile() {
  const dir = mkdtempSync(join(tmpdir(), 'gc-fav-'));
  mkdirSync(join(dir, 'profiles'), { recursive: true });
  mkdirSync(join(dir, 'snapshots', 'd1'), { recursive: true });
  writeFileSync(join(dir, 'snapshots', 'd1', '2026-10-22.json'), JSON.stringify({ window: 'd1', statDay: '2026-10-22', entries: [{ rank: 1, projectId: 202, fullName: 'acme/tiny', gain: 9, total: 99 }] }));
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
const favoriteLinks = (body) => [...body.matchAll(/<li><a href="([^"]+)">([^<]+)<\/a>/g)].map((m) => [m[1], m[2]]);
// 另一个账号登录，拿到它的会话 Cookie。
async function loginAs(site, dataDir, name) {
  const res = await http(site.url + 'login', form({ name, password: testAccount(dataDir, name) }));
  return { ...site, cookie: res.headers['set-cookie'][0].split(';')[0] };
}

test('收藏和取消收藏项目、单个 Skill；“我的收藏”列出全部，能直达项目页', async () => {
  const site = await serve(dataDirWithProfile());
  try {
    let page = await site.get('p/acme/agent-kit');
    assert.match(page.body, /<button>收藏这个项目<\/button>/);
    assert.equal((page.body.match(/<button>收藏这个 Skill<\/button>/g) ?? []).length, 2);
    assert.match((await site.get('favorites')).body, /还没有收藏。/);

    const r = await add(site);
    assert.equal(r.status, 303);
    assert.equal(r.headers.location, '/p/acme/agent-kit');
    await add(site, 'skills/pdf');
    // 重复收藏不报错，也不会多出一条。
    assert.equal((await add(site, 'skills/pdf')).status, 303);

    page = await site.get('p/acme/agent-kit');
    assert.match(page.body, /<button>取消收藏这个项目<\/button>/);
    const item = (path) => page.body.match(new RegExp(`<li id="skill-${path}">([\\s\\S]*?)</li>`))[1];
    assert.match(item('skills/pdf'), /<input type="hidden" name="action" value="remove">[\s\S]*<button>取消收藏这个 Skill<\/button>/);
    assert.match(item('skills/notes'), /<input type="hidden" name="action" value="add">[\s\S]*<button>收藏这个 Skill<\/button>/);

    const mine = await site.get('favorites');
    assert.match(mine.body, /<h1>我的收藏<\/h1>/);
    assert.match(mine.body, /共 2 条，只有你自己看得到。/);
    // 新收藏的在前；Skill 直达项目页上那一条。
    assert.deepEqual(favoriteLinks(mine.body), [['/p/acme/agent-kit#skill-skills/pdf', 'acme/agent-kit 里的 Skill：pdf'], ['/p/acme/agent-kit', 'acme/agent-kit']]);
    assert.equal((await site.get('p/acme/agent-kit')).status, 200);

    const gone = await remove(site);
    assert.equal(gone.headers.location, '/favorites');
    assert.deepEqual(favoriteLinks((await site.get('favorites')).body).map(([href]) => href), ['/p/acme/agent-kit#skill-skills/pdf']);
    await remove(site, 'skills/pdf');
    assert.match((await site.get('favorites')).body, /还没有收藏。/);
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
    assert.deepEqual(favoriteLinks(mine.body), [['/p/acme/agent-kit#skill-skills/notes', 'acme/agent-kit 里的 Skill：notes']]);
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
    assert.match((await getB('favorites')).body, /还没有收藏。/);
    assert.match((await getB('p/acme/agent-kit')).body, /<button>收藏这个项目<\/button>/);
    // B 取消同一个项目，只影响 B 自己（本来就没有），A 的还在。
    await remove(b);
    await add(b, 'skills/notes');
    assert.deepEqual(favoriteLinks((await a.get('favorites')).body).map(([href]) => href), ['/p/acme/agent-kit#skill-skills/pdf', '/p/acme/agent-kit']);
    assert.deepEqual(favoriteLinks((await getB('favorites')).body).map(([href]) => href), ['/p/acme/agent-kit#skill-skills/notes']);
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
    assert.match((await site.get('favorites')).body, /还没有收藏。/);
    assert.equal((await post(site, { project_id: '101', skill: '', action: 'add' }, { origin: own })).status, 303);
    assert.equal((await post(site, { project_id: '101', skill: '', action: 'remove' }, { origin: own.replace('127.0.0.1', 'localhost') })).status, 303);

    // 未登录：被引导去登录，什么也没存。
    const anon = await http(site.url + 'favorites', form({ project_id: '101', skill: '', action: 'add' }));
    assert.equal(anon.status, 303);
    assert.match(anon.headers.location, /^\/login\?next=/);
    assert.match((await site.get('favorites')).body, /还没有收藏。/);

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
    assert.match(page.body, /简介生成中/);
    assert.match(page.body, /<input type="hidden" name="project_id" value="202">[\s\S]*?<button>收藏这个项目<\/button>/);
    assert.equal((await post(site, { project_id: '202', skill: '', action: 'add', next: '/p/acme/tiny' })).status, 303);
    assert.equal((await post(site, { project_id: '202', skill: 'skills/x', action: 'add' })).status, 404);
    assert.equal((await post(site, { project_id: '0', skill: '', action: 'add' })).status, 404);
    assert.deepEqual(favoriteLinks((await site.get('favorites')).body), [['/p/acme/tiny', 'acme/tiny']]);

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
    // 用改名后的名字直达；删掉的 Skill 写明。
    assert.deepEqual(favoriteLinks(mine), [['/p/acme/agent-kit-2#skill-skills/pdf', 'acme/agent-kit-2 里的 Skill：pdf'], ['/p/acme/agent-kit-2', 'acme/agent-kit-2']]);
    assert.match(mine, /里的 Skill：pdf<\/a>（仓库里已经没有这个 Skill）/);
    assert.equal((await site.get('p/acme/agent-kit-2')).status, 200);

    rmSync(profilePath(dataDir));
    mine = (await site.get('favorites')).body;
    assert.match(mine, /<li>acme\/agent-kit（项目资料已不在，站内页面打不开；<a href="https:\/\/github\.com\/acme\/agent-kit">在 GitHub 打开<\/a>）/);
    await remove(site, 'skills/pdf');
    await remove(site);
    assert.match((await site.get('favorites')).body, /还没有收藏。/);
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
    let mine = favoriteLinks((await site.get('favorites')).body).map(([, name]) => name);
    assert.deepEqual(mine.sort(), ['acme/agent-kit', 'acme/agent-kit 里的 Skill：pdf', 'acme/tiny'].sort());
    const removed = await api({ project_id: '101', skill: '', action: 'remove' });
    assert.deepEqual(JSON.parse(removed.body), { saved: false });
    mine = favoriteLinks((await site.get('favorites')).body).map(([, name]) => name);
    assert.ok(!mine.includes('acme/agent-kit'));
    const missing = await api({ project_id: '101', skill: 'skills/nope', action: 'add' });
    assert.deepEqual([missing.status, JSON.parse(missing.body)], [404, { error: '没有这个项目或 Skill 的资料' }]);
    const odd = await api({ project_id: '101', skill: '', action: 'add' }, { origin: 'http://127.0.0.1:5999' });
    assert.deepEqual([odd.status, JSON.parse(odd.body)], [403, { error: '只接受本站提交的表单' }]);
  } finally {
    site.close();
  }
});
