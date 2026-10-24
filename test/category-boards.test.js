// 按分类筛选涨星榜（#10）：在已核数候选里按分类重新取前 20，完整性下限以下的标出来。其他榜单在页面里榜内过滤，见 category-web.test.js。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gainersInCategory } from '../src/categories/boards.js';
import { lookup } from '../src/categories/store.js';

// n 个候选，涨星从 base 起每个少 10；cats(i) 给第 i 个的分类（null 表示还没归类）。
function setup({ n, base = 5000, floor = 1000, cats }) {
  const items = Array.from({ length: n }, (_, i) => ({ id: i + 1, fullName: `o/p${i + 1}`, gain: base - i * 10, total: 1, description: null, topics: null, evidence: {} }));
  const records = {};
  items.forEach((x, i) => {
    const c = cats(i);
    if (c) records[String(x.id)] = { id: x.id, fullName: x.fullName, categories: c };
  });
  return { candidates: { check: { completenessFloor: floor }, items }, find: lookup(records) };
}

test('分类里已核数的项目够多：重新取前 20，名次在分类里重排，不看涨星榜名次', () => {
  const { candidates, find } = setup({ n: 60, cats: (i) => (i % 2 ? ['Skill'] : ['其他']) });
  const r = gainersInCategory({ candidates, find, category: 'Skill' });
  assert.equal(r.entries.length, 20);
  assert.deepEqual(r.entries.slice(0, 3).map((e) => [e.rank, e.fullName, e.gain]), [[1, 'o/p2', 4990], [2, 'o/p4', 4970], [3, 'o/p6', 4950]]);
  assert.equal(r.unclassified, 0);
});

test('不足 20 个：如实给实际个数', () => {
  const { candidates, find } = setup({ n: 40, cats: (i) => (i < 3 ? ['数据库与数据工具'] : ['其他']) });
  const r = gainersInCategory({ candidates, find, category: '数据库与数据工具' });
  assert.equal(r.entries.length, 3);
  assert.deepEqual(r.entries.map((e) => e.rank), [1, 2, 3]);
});

test('完整性下限：涨星低于下限的照样列出并标出来，等于下限的不标', () => {
  // 涨星 1,200、1,190 …：下限 1,100 时前 11 个（1,200 到 1,100）不标，之后都标。
  const { candidates, find } = setup({ n: 20, base: 1200, floor: 1100, cats: () => ['Skill'] });
  const r = gainersInCategory({ candidates, find, category: 'Skill' });
  assert.equal(r.floor, 1100);
  assert.equal(r.entries.length, 20);
  assert.deepEqual(r.entries.map((e) => e.belowFloor), [...Array(11).fill(false), ...Array(9).fill(true)]);
  assert.equal(r.entries[10].gain, 1100);
});

test('完整性下限估计不了（记录比例为 0）时全部标出来', () => {
  const { candidates, find } = setup({ n: 3, floor: null, cats: () => ['Skill'] });
  assert.ok(gainersInCategory({ candidates, find, category: 'Skill' }).entries.every((e) => e.belowFloor));
});

test('一个项目跨两个分类：两个分类榜里都有它，各自按分类里的名次', () => {
  const { candidates, find } = setup({ n: 5, cats: (i) => (i === 2 ? ['Agent／MCP', 'Skill'] : i < 2 ? ['Agent／MCP'] : ['Skill']) });
  const agent = gainersInCategory({ candidates, find, category: 'Agent／MCP' });
  const skill = gainersInCategory({ candidates, find, category: 'Skill' });
  assert.deepEqual(agent.entries.map((e) => [e.rank, e.fullName]), [[1, 'o/p1'], [2, 'o/p2'], [3, 'o/p3']]);
  assert.deepEqual(skill.entries.map((e) => [e.rank, e.fullName]), [[1, 'o/p3'], [2, 'o/p4'], [3, 'o/p5']]);
});

test('末位并列一起进分类榜；涨星为 0 的不进', () => {
  const { candidates, find } = setup({ n: 25, cats: () => ['Skill'] });
  candidates.items[20].gain = candidates.items[19].gain;
  candidates.items[24].gain = 0;
  const r = gainersInCategory({ candidates, find, category: 'Skill' });
  assert.equal(r.entries.length, 21);
  assert.deepEqual(r.entries.slice(19).map((e) => e.rank), [20, 20]);
  const all = gainersInCategory({ candidates: { ...candidates, items: candidates.items.slice(20) }, find, category: 'Skill' });
  assert.ok(all.entries.every((e) => e.gain > 0));
});

test('还没归类的项目：只数涨星够得上这份名单的', () => {
  // 第 0、45 个没归类：名单满 20 个，最后一名 4,800；第 0 个（5,000）够得上，第 45 个（4,550）够不上。名单不满 20 个时没归类的都算。
  const { candidates, find } = setup({ n: 60, cats: (i) => (i === 0 || i === 45 ? null : ['Skill']) });
  const r = gainersInCategory({ candidates, find, category: 'Skill' });
  assert.equal(r.entries.at(-1).gain, 4800);
  assert.equal(r.unclassified, 1);
  const few = setup({ n: 10, cats: (i) => (i < 2 ? ['Skill'] : i === 9 ? null : ['其他']) });
  assert.equal(gainersInCategory({ ...few, category: 'Skill' }).unclassified, 1);
});
