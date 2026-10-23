// 网站上的分类（#10）：首页每个窗口的分类榜和行上的分类嵌进页面；其他三个榜单按分类在榜内过滤；项目页写明分类。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CATEGORIES } from '../src/categories/index.js';
import { visit } from './helpers/web.js';

const day = '2026-10-22';
const fixture = new URL('./fixtures/snapshot-d1-2026-10-22.json', import.meta.url);
const put = (dir, path, obj) => {
  mkdirSync(join(dir, path, '..'), { recursive: true });
  writeFileSync(join(dir, path), JSON.stringify(obj));
};
const dataOf = (body) => JSON.parse(body.match(/<script type="application\/json" id="gc-data">([^<]*)<\/script>/)[1]);
const WEEK = (d) => Date.parse(`${d}T00:00:00Z`) / 1000;
const weeks = [0, 1, 2, 3, 4, 5].map((i) => ({ week: WEEK('2026-10-18') - i * 7 * 86400, days: [1, 1, 1, 1, 1, 1, 1] }));

// 近 1 天快照（#2 的素材）加上这一期的候选和分类：php/php-src 在总榜第 1；x/skill-only 只在候选里。
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

test('首页嵌入 9 个分类和每个窗口的分类榜：在已核数候选里按分类重新排名，行上和卡片用项目的分类', async () => {
  const r = await visit(seed());
  assert.match(r.body, /<div id="cats" role="group" aria-label="分类"><\/div>/);
  const data = dataOf(r.body);
  assert.deepEqual(data.cats, CATEGORIES);
  const skill = data.windows.d1.byCat.Skill;
  assert.deepEqual(skill.entries.map((e) => [e.rank, e.repo, e.gain]), [[1, 'php/php-src', 5200], [2, 'x/skill-only', 1600], [3, 'y/skill-small', 900]]);
  // 只在候选里的项目也进了卡片数据，数字取它这次运行存下的星数历史；总 Star 取不到就是 null（页面写“暂缺”）。
  const only = data.projects['x/skill-only'];
  assert.deepEqual(only.cats, ['Skill']);
  assert.equal(only.runs[skill.entries[1].run].series.length, 30);
  assert.equal(data.projects['y/skill-small'].runs[skill.entries[2].run].total, null);
  assert.deepEqual(data.projects['php/php-src'].cats, ['开发者工具与基础设施', 'Skill']);
  // 一个项目跨两个分类，两个分类榜里都有它。
  assert.equal(data.windows.d1.byCat['开发者工具与基础设施'].entries[0].repo, 'php/php-src');
  // 提示条：第 3 名起低于完整性下限、不足 20 个、还有够得上名单却没归类的项目（z/not-yet）。
  assert.deepEqual(skill.notes.map((n) => n.title), ['可能有漏', '不足 20 个', '还没归类']);
  assert.equal(skill.notes[0].text, '第 3 名起涨星低于完整性下限 +1,500：涨星比下限少的项目，事件数据可能没记到，名单可能不全。');
  assert.equal(skill.notes[1].text, '「Skill」在近 1 天只核出 3 个项目，全部列出。');
  assert.equal(skill.notes[2].text, '还有 1 个涨星够得上这份名单的项目没归类，归好后补进来。');
  assert.equal(data.windows.d1.byCat['数据库与数据工具'].empty.title, '这个分类当期没有核出项目');
  assert.ok(!JSON.stringify(data).includes('"raw"'));
});

test('这一期出榜时还没另存候选：分类榜如实说明还没有，总榜照常', async () => {
  const data = dataOf((await visit(seed({ candidates: false }))).body);
  assert.equal(data.windows.d1.entries.length, 7);
  const b = data.windows.d1.byCat.Skill;
  assert.deepEqual([b.entries, b.empty.title], [[], '这一期还没有分类榜']);
});

test('新项目榜、累计高星榜、官方热门榜按分类在榜内过滤，名次重排，写明没归类的个数；不认识的分类当作全部', async () => {
  const dir = seed();
  const entries = [
    { rank: 1, projectId: 1903522, fullName: 'php/php-src', total: 900, createdAt: '2026-10-01T00:00:00Z' },
    { rank: 2, projectId: 5, fullName: 'u/unknown', total: 800, createdAt: '2026-10-02T00:00:00Z' },
    { rank: 3, projectId: 777, fullName: 'x/skill-only', total: 700, createdAt: '2026-10-03T00:00:00Z' },
  ];
  put(dir, `snapshots/new/${day}.json`, { list: 'new', statDay: day, generatedAt: '2026-10-23T08:40:00.000Z', from: '2026-09-23', entries });
  put(dir, `snapshots/trending/${day}.json`, { list: 'trending', statDay: day, generatedAt: '2026-10-23T08:40:00.000Z', pages: Object.fromEntries(['daily', 'weekly', 'monthly'].map((s) => [s, { fetchedAt: null, entries: entries.map((e) => ({ ...e, periodStars: 1 })) }])) });
  const page = await visit(dir, `new?cat=${encodeURIComponent('Skill')}`);
  const rows = [...page.body.matchAll(/<tr><td>(\d+)<\/td><td><a href="\/p\/([^"]+)">/g)].map((m) => [Number(m[1]), m[2]]);
  assert.deepEqual(rows, [[1, 'php/php-src'], [2, 'x/skill-only']]);
  assert.match(page.body, /<strong>Skill<\/strong>/);
  assert.match(page.body, /本榜还有 1 个项目没归类/);
  assert.match(page.body, /<td>开发者工具与基础设施、Skill<\/td>/);
  const all = await visit(dir, 'new?cat=nope');
  assert.equal([...all.body.matchAll(/<tr><td>\d+<\/td>/g)].length, 3);
  assert.match(all.body, /<strong>全部<\/strong>/);
  const hot = await visit(dir, `trending?since=weekly&cat=${encodeURIComponent('开发者工具与基础设施')}`);
  assert.deepEqual([...hot.body.matchAll(/<tr><td>(\d+)<\/td><td><a href="\/p\/([^"]+)">/g)].map((m) => [Number(m[1]), m[2]]), [[1, 'php/php-src']]);
  // 切换日、周、月时带上分类；切换分类时带上日、周、月。
  assert.match(hot.body, /href="\/trending\?since=daily&amp;cat=%E5%BC%80/);
  assert.match(hot.body, /href="\/trending\?since=weekly&amp;cat=Skill"/);
  const none = await visit(dir, `top?cat=${encodeURIComponent('其他')}`);
  assert.match(none.body, /还没有累计高星榜/);
});

test('项目页写明分类；还没归类的写“还没归类”', async () => {
  const dir = seed();
  assert.match((await visit(dir, 'p/php/php-src')).body, /<p>分类：开发者工具与基础设施、Skill<\/p>/);
  assert.match((await visit(dir, 'p/anthropics/knowledge-work-plugins')).body, /<p>分类：还没归类<\/p>/);
});
