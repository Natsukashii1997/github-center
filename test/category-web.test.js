// 网站上的分类（#10）：项目带上分类（详情栏、项目页写明）；只上了分类榜的项目能打开、能收藏。
// 2026-11-03 起（#21）首页不再按分类筛选（分类榜另成一页，后续批次），其他三个榜单页已删。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { visit, serve, http, form } from './helpers/web.js';

const day = '2026-10-22';
const fixture = new URL('./fixtures/snapshot-d1-2026-10-22.json', import.meta.url);
const put = (dir, path, obj) => {
  mkdirSync(join(dir, path, '..'), { recursive: true });
  writeFileSync(join(dir, path), JSON.stringify(obj));
};
const dataOf = (body) => JSON.parse(body.match(/<script type="application\/json" id="gc-data">([^<]*)<\/script>/)[1]);
const WEEK = (d) => Date.parse(`${d}T00:00:00Z`) / 1000;
const weeks = [0, 1, 2, 3, 4, 5].map((i) => ({ week: WEEK('2026-10-18') - i * 7 * 86400, days: [1, 1, 1, 1, 1, 1, 1] }));

// 近 1 天快照（#2 的素材）加上这一期的候选和分类：php/php-src 在涨星榜第 1；x/skill-only 只在候选里。
function seed({ candidates = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'gc-catweb-'));
  mkdirSync(join(dir, 'snapshots', 'd1'), { recursive: true });
  copyFileSync(fixture, join(dir, 'snapshots', 'd1', `${day}.json`));
  const snap = JSON.parse(readFileSync(fixture, 'utf8'));
  const history = 'runs/r1/raw/history/x.json';
  put(dir, history, weeks);
  if (candidates) {
    put(dir, `candidates/d1/${day}.json`, {
      window: 'd1', statDay: day, runId: snap.runId, check: { threshold: 1, recordRatio: 0.01, completenessFloor: 1500 },
      items: [
        { id: 1903522, fullName: 'php/php-src', gain: 5200, total: 193409, description: 'The PHP Interpreter', topics: [], evidence: { history, meta: null } },
        { id: 777, fullName: 'x/skill-only', gain: 1600, total: 2400, description: 'skills', topics: [], evidence: { history, meta: null } },
        { id: 778, fullName: 'y/skill-small', gain: 900, total: null, description: null, topics: null, evidence: { history, meta: null } },
        { id: 779, fullName: 'z/not-yet', gain: 3000, total: 10, description: null, topics: null, evidence: { history, meta: null } },
      ],
    });
  }
  put(dir, 'categories.json', { items: {
    1903522: { id: 1903522, fullName: 'php/php-src', categories: ['开发者工具与基础设施', 'Skill'], source: 'batch' },
    777: { id: 777, fullName: 'x/skill-only', categories: ['Skill'], source: 'batch' },
    778: { id: 778, fullName: 'y/skill-small', categories: ['Skill'], source: 'batch' },
  } });
  return dir;
}

test('首页不嵌分类榜，只放涨星榜上的项目；项目带着分类（详情栏写）', async () => {
  const data = dataOf((await visit(seed(), 'stars')).body);
  assert.equal(data.cats, undefined);
  assert.ok(!JSON.stringify(data.windows).includes('byCat'));
  // 只在分类榜候选里的项目不进首页数据。
  assert.deepEqual(Object.keys(data.projects).sort(), [...new Set(Object.values(data.windows).flatMap((w) => w.entries.map((e) => e.repo)))].sort());
  assert.equal(data.projects['x/skill-only'], undefined);
  assert.deepEqual(data.projects['php/php-src'].cats, ['开发者工具与基础设施', 'Skill']);
});

test('只上了分类榜的项目不生成项目资料（所有者 2026-10-24 选 B）：项目页打得开、写明不生成简介，能收藏', async () => {
  const dir = seed();
  const site = await serve(dir);
  try {
    // 项目页：数字取它所在分类榜那次运行，侧栏没有涨星榜名次，写明不生成简介。
    const page = await site.get('p/x/skill-only');
    assert.equal(page.status, 200);
    const data = dataOf(page.body);
    assert.deepEqual([data.page.catOnly, data.page.hasProfile, data.page.ranks, data.page.win], [true, false, [], 'd1']);
    const card = data.projects['x/skill-only'];
    assert.deepEqual([card.catOnly, card.desc, card.runs[data.page.run].total], [true, 'skills', 2400]);
    // 收藏：分类榜上的项目也能收，收藏页里能点进站内页面，总 Star 取候选里的。
    const saved = await http(site.url + 'api/favorites', form({ action: 'add', project_id: '777' }, { cookie: site.cookie }));
    assert.equal(saved.status, 200);
    const fav = dataOf((await site.get('favorites')).body);
    assert.deepEqual(fav.items.map((f) => [f.repo, f.catOnly, f.openable, f.total]), [['x/skill-only', true, true, 2400]]);
    assert.equal(fav.projects['x/skill-only'].desc, 'skills');
    // 不在任何榜单上的仍然找不到。
    assert.equal((await site.get('p/nobody/nothing')).status, 404);
  } finally {
    site.close();
  }
});

test('项目页写明分类；还没归类的写“还没归类”', async () => {
  const dir = seed();
  // 页面脚本按 projects[名字].cats 写分类，空的写“还没归类”。
  const catsOf = async (repo) => dataOf((await visit(dir, `p/${repo}`)).body).projects[repo].cats;
  assert.deepEqual(await catsOf('php/php-src'), ['开发者工具与基础设施', 'Skill']);
  assert.deepEqual(await catsOf('anthropics/knowledge-work-plugins'), []);
});
