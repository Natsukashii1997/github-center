// #27 分类榜页面（2026-11-04 起叫「发现」，是首页 /）：嵌进页面的三块数据（精选、历史、热点）和详情栏内容；精选榜接口 POST /api/picks/<操作> 的权限、
// 投票、换卡（只换进本地有数据或所有者联网查到的项目）、恢复、候选（含粘贴 GitHub 地址）、联网查仓库、改标签清单；分类榜上的项目能收藏。
// 除 repoLookup 本身外全部走登录后的 HTTP。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { http, form, serve, testAccount, dataOf } from './helpers/web.js';
import { openAccounts } from '../src/web/accounts.js';
import { updatePicks, DEFAULT_TAGS } from '../src/boards/index.js';
import { repoLookup } from '../src/web/repo-lookup.js';

const put = (dir, path, obj) => {
  mkdirSync(join(dir, path, '..'), { recursive: true });
  writeFileSync(join(dir, path), JSON.stringify(obj));
};
const [AGENT, SKILL] = DEFAULT_TAGS.map((t) => t.name);

// 全站 Star 前 10 个（精选候选池；h/p1 有生成好的资料和分类，其余只有 GitHub 描述）；Skill 历史榜 5 个（h/p1 两个 Skill、h/p9、
// 一个网址来源、一个本地没有数据的仓库）；热点榜 2 个（只记了 1 天）；近 1 天候选里另有 c/extra。
// 精选：h/p1..p8 建议了多 Agent 协同，h/p1 另加编程技能。
async function seed() {
  const dir = mkdtempSync(join(tmpdir(), 'gc-cat27-'));
  put(dir, 'snapshots/history/2026-11-03.json', { statDay: '2026-11-03', fetchedAt: '2026-11-03T01:00:00Z', totalCount: 999, entries: Array.from({ length: 10 }, (_, i) => ({ rank: i + 1, repo: `h/p${i + 1}`, id: i + 1, ownerId: 100 + i, total: 100_000 - i * 1000, description: `GitHub 描述 ${i + 1}`, topics: [] })) });
  put(dir, 'snapshots/hot/2026-11-03.json', { statDay: '2026-11-03', fetchedAt: '2026-11-03T02:00:00Z', sources: { hn: { status: 'ok' }, v2ex: { status: 'failed', error: 'x' } },
    entries: [
      { rank: 1, repo: 't/hot', id: 900, ownerId: 9, description: 'hot thing', total: 50, heat: 120, sources: { hn: 100, v2ex: 20 }, posts: 2, aliases: ['t/hot'] },
      { rank: 2, repo: 'h/p2', id: 2, ownerId: 101, description: 'GitHub 描述 2', total: 99_000, heat: 40, sources: { hn: 40, v2ex: 0 }, posts: 1, aliases: ['h/p2'] },
    ],
    posts: [{ source: 'hn', id: '1', createdAt: '2026-11-02T00:00:00Z', points: 100, comments: 0, repos: ['t/hot'] }, { source: 'v2ex', id: '2', createdAt: '2026-11-02T00:00:00Z', points: 0, comments: 20, repos: ['t/hot'] }, { source: 'hn', id: '3', createdAt: '2026-11-02T00:00:00Z', points: 30, comments: 10, repos: ['h/p2'] }] });
  put(dir, 'snapshots/skills/2026-11-03.json', { board: 'skills', statDay: '2026-11-03', fetchedAt: '2026-11-03T01:30:00Z', entries: [{ rank: 1, skill: 'skill-a', skillId: 'skill-a', source: 'h/p1', repo: 'h/p1', installs: 4000000, url: 'https://skills.sh/h/p1/skill-a' }, { rank: 2, skill: 'skill-b', skillId: 'skill-b', source: 'h/p1', repo: 'h/p1', installs: 2000000, url: 'https://skills.sh/h/p1/skill-b' }, { rank: 3, skill: 'skill-c', skillId: 'skill-c', source: 'h/p9', repo: 'h/p9', installs: 1500000, url: 'https://skills.sh/h/p9/skill-c' }, { rank: 4, skill: 'lark-x', skillId: 'lark-x', source: 'open.feishu.cn', repo: null, installs: 1000000, url: 'https://skills.sh/open.feishu.cn/lark-x' }, { rank: 5, skill: 'skill-z', skillId: 'skill-z', source: 'z/unknown', repo: 'z/unknown', installs: 500000, url: 'https://skills.sh/z/unknown/skill-z' }] });
  put(dir, 'snapshots/d1/2026-11-03.json', { window: 'd1', statDay: '2026-11-03', generatedAt: '2026-11-03T08:00:00Z', entries: [] });
  put(dir, 'candidates/d1/2026-11-03.json', { window: 'd1', statDay: '2026-11-03', check: { threshold: 1, recordRatio: 0.01, completenessFloor: 1500 }, items: [{ id: 700, fullName: 'c/extra', total: 5_000, description: 'extra one', topics: [] }] });
  put(dir, 'categories.json', { items: { 1: { id: 1, fullName: 'h/p1', categories: ['Skill', '其他'] }, 4242: { id: 4242, fullName: 'z/unknown', categories: ['Skill'] } } });
  // z/unknown 不在候选池里，只在归类记录里有 id；有了 id 才读得到它的项目资料。
  put(dir, 'profiles/4242.json', { projectId: 4242, fullName: 'z/unknown', material: { hash: 'z', listing: [], readme: null, docs: [], skills: [], fetchedAt: '2026-11-03T00:00:00Z' },
    generated: { materialHash: 'z', what: '做什么', problem: '解决什么', line: '没在候选池的一句话', use: [], scene: [], tag: '工具', type: 'Skill', conditions: [], skillPurposes: {} } });
  put(dir, 'profiles/1.json', { projectId: 1, fullName: 'h/p1', material: { hash: 'h', listing: [], readme: null, docs: [], skills: [{ path: 's/a', name: 'a', description: 'A' }], fetchedAt: '2026-11-03T00:00:00Z' },
    generated: { materialHash: 'h', what: '做什么', problem: '解决什么', line: '一句话一', use: ['用途一', '用途二', '用途三', '用途四'], scene: ['场景一'], tag: '编程规范', type: 'Skill', conditions: [], skillPurposes: {} } });
  const accounts = openAccounts(dir);
  accounts.create({ name: 'boss', role: 'owner' });
  accounts.close();
  await updatePicks({ dataDir: dir, tagger: { version: 'fake', suggest: async (tags, items) => ({ results: items.map((x, i) => ({ i, tags: x.fullName === 'h/p1' ? [AGENT, SKILL] : /^h\/p[2-8]$/.test(x.fullName) ? [AGENT] : [] })) }) } });
  return dir;
}
const api = (site, op, fields, headers = {}) => http(`${site.url}api/picks/${op}`, form(fields, { cookie: site.cookie, ...headers })).then((r) => ({ ...r, json: JSON.parse(r.body || 'null') }));
async function asOwner(site, dir) {
  const res = await http(site.url + 'login', form({ name: 'boss', password: testAccount(dir, 'boss') }));
  const cookie = res.headers['set-cookie'][0].split(';')[0];
  return { ...site, cookie, get: (path = '') => http(site.url + path, { headers: { cookie } }) };
}
const tagOf = (data, name) => data.picks.tags.find((t) => t.name === name);

test('分类榜页面：导航可点；精选、历史、热点三块数据和详情栏内容，没生成资料的只给 GitHub 描述', async () => {
  const dir = await seed();
  const site = await serve(dir);
  try {
    const res = await site.get('');
    assert.equal(res.status, 200);
    assert.match(res.body, /<title>发现 · Github·Tidings<\/title>/);
    assert.match(res.body, /<a href="\/" aria-current="page">发现<\/a>/);
    const d = dataOf(res.body);
    assert.equal(d.day, '2026-11-03');

    // 精选：伙伴不能改；每类按总 Star 前 7；赞踩为 0
    assert.equal(d.picks.canEdit, false);
    assert.equal(d.picks.slots, 7);
    assert.deepEqual(d.picks.tags.map((t) => t.name), DEFAULT_TAGS.map((t) => t.name));
    assert.deepEqual(tagOf(d, AGENT).cards.map((c) => c.repo), ['h/p1', 'h/p2', 'h/p3', 'h/p4', 'h/p5', 'h/p6', 'h/p7']);
    assert.equal(tagOf(d, AGENT).note, DEFAULT_TAGS[0].note);
    assert.deepEqual(Object.keys(tagOf(d, AGENT).cards[0]).sort(), ['down', 'mine', 'pinned', 'projectId', 'repo', 'slot', 'total', 'up']);

    // 历史榜（Skill 安装量）：名次、Skill 名、个数、来源、安装量、skills.sh 地址、所在项目的第一个分类；网址来源的没有 repo
    // 同一来源合成一行：h/p1 的两个 Skill 是一行，取安装量最高的 skill-a，注明 2 个
    assert.deepEqual(d.hist.entries[0], { rank: 1, skill: 'skill-a', count: 2, mirrors: 0, source: 'h/p1', repo: 'h/p1', installs: 4_000_000, url: 'https://skills.sh/h/p1', cat: 'Skill' });
    assert.deepEqual(d.hist.entries.map((e) => [e.rank, e.skill, e.count, e.repo, e.cat]), [[1, 'skill-a', 2, 'h/p1', 'Skill'], [2, 'skill-c', 1, 'h/p9', null], [3, 'lark-x', 1, null, null], [4, 'skill-z', 1, 'z/unknown', 'Skill']]);
    assert.match(d.hist.note, /skills\.sh/);
    // 不在候选池里的仓库：按名字从归类记录找到 id，读得到项目资料和分类
    assert.deepEqual([d.projects['z/unknown'].line, d.hist.entries[3].cat], ['没在候选池的一句话', 'Skill']);
    // 热点榜：只记了 1 天，走势 7 格只有最后一格；前一天没有记录时涨跌为 null；各来源份额
    assert.deepEqual([d.hot.days, d.hot.complete, d.hot.backfilled], [1, false, []]);
    assert.match(d.hot.backfillNote, /^补录：/);
    assert.deepEqual(d.hot.entries[0].series, [null, null, null, null, null, null, 120]);
    assert.equal(d.hot.entries[0].change, null);
    assert.deepEqual(d.hot.entries[0].sources, { hn: 100, v2ex: 20 });
    assert.deepEqual(d.hot.sources, { hn: { name: 'Hacker News', status: 'ok' }, v2ex: { name: 'V2EX', status: 'failed' } });

    // 详情栏内容：有资料的带一句话和用途；没资料的不凑文字，只带 GitHub 描述；不在涨星榜上的总 Star 另给
    const p1 = d.projects['h/p1'], p9 = d.projects['h/p9'], hot = d.projects['t/hot'];
    assert.deepEqual([p1.line, p1.use.length, p1.type, p1.skills.length, p1.cats[0]], ['一句话一', 4, 'Skill', 1, 'Skill']);
    assert.deepEqual([p9.line, p9.what, p9.ghDesc, p9.ownerId], [null, null, 'GitHub 描述 9', 108]);
    assert.deepEqual([hot.line, hot.ghDesc, hot.ownerId], [null, 'hot thing', 9]);
    assert.equal(d.views['h/p9'].total, 92_000);
    assert.ok(d.projects['h/p7'] && d.views['h/p7'], '精选卡的项目也有详情栏内容');
  } finally {
    site.close();
  }
});

test('精选接口权限：伙伴只能投票，换卡、恢复、改标签回 403；没登录 401；只收 POST；别的网站提交 403', async () => {
  const dir = await seed();
  const site = await serve(dir);
  try {
    const d = dataOf((await site.get('')).body);
    const agent = tagOf(d, AGENT).id;
    for (const [op, fields] of [['swap', { tag: agent, slot: 1, project: 9 }], ['restore', { tag: agent }], ['tags', { action: 'add', name: '安全', color: '#cf222e' }], ['tags', { action: 'remove', tag: agent }]]) {
      const r = await api(site, op, fields);
      assert.equal(r.status, 403, `${op} ${JSON.stringify(fields)}`);
      assert.equal(r.json.error, '只有所有者能改精选标签和换卡');
    }
    // 投票：赞、改踩、撤回；只能投榜上的卡
    assert.deepEqual((await api(site, 'vote', { tag: agent, project: 1, value: 1 })).json, { up: 1, down: 0, mine: 1 });
    assert.deepEqual((await api(site, 'vote', { tag: agent, project: 1, value: -1 })).json, { up: 0, down: 1, mine: -1 });
    assert.deepEqual((await api(site, 'vote', { tag: agent, project: 1, value: 0 })).json, { up: 0, down: 0, mine: 0 });
    assert.equal((await api(site, 'vote', { tag: agent, project: 9, value: 1 })).status, 404);
    assert.equal((await api(site, 'vote', { tag: agent, project: 1, value: 5 })).status, 400);
    // 自己投的在页面上高亮（mine），别人只看到总数
    await api(site, 'vote', { tag: agent, project: 2, value: 1 });
    assert.deepEqual(tagOf(dataOf((await site.get('')).body), AGENT).cards[1].mine, 1);
    const boss = await asOwner(site, dir);
    const seen = tagOf(dataOf((await boss.get('')).body), AGENT).cards[1];
    assert.deepEqual([seen.up, seen.mine], [1, 0]);

    assert.equal((await api(site, 'nothing', {})).status, 404);
    assert.equal((await http(`${site.url}api/picks/vote`, { headers: { cookie: site.cookie } })).status, 405);
    assert.equal((await api(site, 'vote', { tag: agent, project: 1, value: 1 }, { origin: 'http://evil.example' })).status, 403);
    const anon = await http(`${site.url}api/picks/vote`, form({ tag: agent, project: 1, value: 1 }));
    assert.deepEqual([anon.status, JSON.parse(anon.body).error], [401, '未登录']);
  } finally {
    site.close();
  }
});

test('所有者：换卡只换进本地有数据的项目（含粘贴的 GitHub 地址），换进来的标「手动」；恢复成按星数前 7；改标签清单', async () => {
  const dir = await seed();
  const site = await asOwner(await serve(dir), dir);
  try {
    let d = dataOf((await site.get('')).body);
    assert.equal(d.picks.canEdit, true);
    const agent = tagOf(d, AGENT).id;

    // 候选：不在这一类里的，按总 Star；带已在几个标签里；粘贴地址按仓库认；本地没有的回 missing；已在这一类的回 already
    let c = (await api(site, 'candidates', { tag: agent, q: '' })).json;
    assert.deepEqual(c.items.slice(0, 3).map((x) => [x.fullName, x.inTags]), [['h/p8', 0], ['h/p9', 0], ['h/p10', 0]]);
    assert.ok(c.items.some((x) => x.fullName === 't/hot'), '热点榜上核过的项目也能换进来');
    assert.ok(!c.items.some((x) => x.fullName === 'h/p1'));
    c = (await api(site, 'candidates', { tag: agent, q: 'https://github.com/c/extra/tree/main' })).json;
    assert.deepEqual([c.items.map((x) => x.fullName), c.missing, c.already], [['c/extra'], null, null]);
    c = (await api(site, 'candidates', { tag: agent, q: 'https://github.com/no/where' })).json;
    assert.deepEqual([c.items, c.missing], [[], 'no/where']);
    c = (await api(site, 'candidates', { tag: agent, q: 'github.com/h/p3' })).json;
    assert.equal(c.already, 'h/p3');

    // 换卡：名字和总 Star 取本地数据；回新的名单和卡片内容
    const r = await api(site, 'swap', { tag: agent, slot: 2, project: 700 });
    assert.equal(r.status, 200);
    assert.deepEqual(tagOf(r.json, AGENT).cards[1], { slot: 2, repo: 'c/extra', projectId: 700, total: 5_000, pinned: true, up: 0, down: 0, mine: 0 });
    assert.equal(tagOf(r.json, AGENT).manual, 1);
    assert.equal(r.json.projects['c/extra'].ghDesc, 'extra one');
    // 本地没有的项目、已在这一类里的、位置不对的：拒绝
    assert.equal((await api(site, 'swap', { tag: agent, slot: 3, project: 123456 })).status, 404);
    assert.equal((await api(site, 'swap', { tag: agent, slot: 3, project: 700 })).status, 409);
    assert.equal((await api(site, 'swap', { tag: agent, slot: 9, project: 9 })).status, 400);
    assert.equal((await api(site, 'swap', { tag: 999, slot: 1, project: 9 })).status, 404);
    d = dataOf((await site.get('')).body);
    assert.deepEqual(tagOf(d, AGENT).cards.map((c) => c.repo), ['h/p1', 'c/extra', 'h/p3', 'h/p4', 'h/p5', 'h/p6', 'h/p7']);

    const back = await api(site, 'restore', { tag: agent });
    assert.deepEqual([tagOf(back.json, AGENT).manual, tagOf(back.json, AGENT).cards.map((c) => c.repo)], [0, ['h/p1', 'h/p2', 'h/p3', 'h/p4', 'h/p5', 'h/p6', 'h/p7']]);

    // 标签清单：加（带说明）、改说明、排序、删；名字重复 409
    let t = await api(site, 'tags', { action: 'add', name: '安全', color: '#cf222e', note: '代码和系统安全' });
    assert.deepEqual(t.json.picks.tags.at(-1), { id: t.json.picks.tags.at(-1).id, name: '安全', color: '#cf222e', note: '代码和系统安全', manual: 0, cards: [] });
    const safe = t.json.picks.tags.at(-1).id;
    assert.equal((await api(site, 'tags', { action: 'add', name: '安全', color: '#cf222e' })).status, 409);
    t = await api(site, 'tags', { action: 'update', tag: safe, note: '安全审计' });
    assert.equal(t.json.picks.tags.at(-1).note, '安全审计');
    const ids = t.json.picks.tags.map((x) => x.id);
    t = await api(site, 'tags', { action: 'reorder', ids: [...ids].reverse().join(',') });
    assert.equal(t.json.picks.tags[0].name, '安全');
    t = await api(site, 'tags', { action: 'remove', tag: safe });
    assert.ok(!t.json.picks.tags.some((x) => x.name === '安全'));
    assert.equal((await api(site, 'tags', { action: 'rename' })).status, 400);
  } finally {
    site.close();
  }
});

test('所有者换卡：粘贴的地址本地没有时联网查一次 GitHub，查到的能换进来；伙伴不能查；查不到、出错、没开联网的回原因', async () => {
  const dir = await seed();
  const asked = [];
  const lookupRepo = async (repo) => {
    asked.push(repo);
    if (repo === 'boom/x') throw new Error('GitHub 返回 500');
    return repo === 'fresh/one' ? { id: 5000, fullName: 'Fresh/One', ownerId: 55, total: 1234, description: 'fresh' } : repo === 'h/p3' ? { id: 3, fullName: 'h/p3', ownerId: 102, total: 98_000, description: null } : null;
  };
  const partner = await serve(dir, { lookupRepo });
  const site = await asOwner(partner, dir);
  try {
    const agent = tagOf(dataOf((await site.get('')).body), AGENT).id;
    const p = await api(partner, 'lookup', { tag: agent, q: 'https://github.com/fresh/one' });
    assert.deepEqual([p.status, p.json.error], [403, '只有所有者能改精选标签和换卡']);
    assert.deepEqual(asked, []);

    // 先是 missing，再联网查：回一行候选（名字、总 Star、作者 id 取 GitHub）
    assert.equal((await api(site, 'candidates', { tag: agent, q: 'https://github.com/fresh/one' })).json.missing, 'fresh/one');
    const r = await api(site, 'lookup', { tag: agent, q: 'https://github.com/fresh/one' });
    assert.deepEqual(r.json.item, { projectId: 5000, fullName: 'Fresh/One', ownerId: 55, total: 1234, inTags: 0, description: 'fresh', line: null });
    assert.deepEqual(asked, ['fresh/one']);
    const sw = await api(site, 'swap', { tag: agent, slot: 2, project: 5000 });
    assert.equal(sw.status, 200);
    assert.deepEqual(tagOf(sw.json, AGENT).cards[1], { slot: 2, repo: 'Fresh/One', projectId: 5000, total: 1234, pinned: true, up: 0, down: 0, mine: 0 });

    // 已在这一类里的回 already；查不到 404；GitHub 出错 502；认不出地址 400
    assert.deepEqual((await api(site, 'lookup', { tag: agent, q: 'h/p3' })).json, { already: 'h/p3' });
    assert.deepEqual(await api(site, 'lookup', { tag: agent, q: 'no/where' }).then((x) => [x.status, x.json.error]), [404, 'GitHub 上没有公开仓库「no/where」']);
    assert.deepEqual(await api(site, 'lookup', { tag: agent, q: 'boom/x' }).then((x) => [x.status, x.json.error]), [502, '联网查 GitHub 没成功：GitHub 返回 500']);
    assert.equal((await api(site, 'lookup', { tag: agent, q: 'not a repo' })).status, 400);
  } finally {
    site.close();
  }
  const off = await asOwner(await serve(dir), dir);
  try {
    const agent = tagOf(dataOf((await off.get('')).body), AGENT).id;
    assert.equal((await api(off, 'lookup', { tag: agent, q: 'fresh/one' })).status, 503);
  } finally {
    off.close();
  }
});

test('repoLookup：查一个公开仓库，带 token；404 和私有仓库回 null；别的状态抛错', async () => {
  const calls = [];
  const reply = { 'a/b': [200, { id: 7, full_name: 'A/b', owner: { id: 70 }, stargazers_count: 12, description: 'd' }], 'p/q': [200, { id: 8, full_name: 'p/q', private: true }], 'x/y': [404, {}], 'e/e': [500, {}], 'r/l': [403, {}] };
  const fetch = async (url, init) => {
    calls.push([url, init.headers.authorization]);
    if (url.endsWith('/t/o')) throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    const [status, body] = reply[url.split('/repos/')[1]];
    return { status, ok: status === 200, json: async () => body };
  };
  const find = repoLookup({ fetch, token: 't0k' });
  assert.deepEqual(await find('a/b'), { id: 7, fullName: 'A/b', ownerId: 70, total: 12, description: 'd' });
  assert.deepEqual(calls[0], ['https://api.github.com/repos/a/b', 'Bearer t0k']);
  assert.equal(await find('p/q'), null);
  assert.equal(await find('x/y'), null);
  await assert.rejects(find('e/e'), /GitHub 返回 500/);
  await assert.rejects(find('r/l'), /额度用完/);
  await assert.rejects(find('t/o'), /10 秒没有回应/);
  assert.equal((await (repoLookup({ fetch, token: '' }))('a/b')).id, 7);
  assert.equal(calls.at(-1)[1], undefined);
});

test('分类榜上的项目（历史榜、热点榜，没有项目资料）能收藏，出现在我的收藏', async () => {
  const dir = await seed();
  const site = await serve(dir);
  try {
    const r = await http(`${site.url}api/favorites`, form({ project_id: '900', action: 'add' }, { cookie: site.cookie }));
    assert.equal(r.status, 200);
    assert.equal((await http(`${site.url}api/favorites`, form({ project_id: '10', action: 'add' }, { cookie: site.cookie }))).status, 200);
    assert.equal((await http(`${site.url}api/favorites`, form({ project_id: '424242', action: 'add' }, { cookie: site.cookie }))).status, 404);
    assert.deepEqual(dataOf((await site.get('favorites')).body).items.map((x) => x.repo), ['h/p10', 't/hot']);
    assert.equal(dataOf((await site.get('')).body).projects['t/hot'].saved, true);
  } finally {
    site.close();
  }
});

test('没有任何分类榜数据时页面照样打开，三块都是空的', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gc-cat27-empty-'));
  const site = await serve(dir);
  try {
    const res = await site.get('');
    assert.equal(res.status, 200);
    const d = dataOf(res.body);
    assert.deepEqual([d.hist, d.hot, d.day], [null, null, null]);
    assert.deepEqual(d.picks.tags.map((t) => t.cards.length), [0, 0, 0, 0, 0]);
  } finally {
    site.close();
  }
});
