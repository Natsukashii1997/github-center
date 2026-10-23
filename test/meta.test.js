// 候选资料（#10）：GitHub GraphQL 按批取描述、topics、当前总 Star。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchMeta, metaQuery } from '../src/ranking/meta.js';

const node = (i) => ({ databaseId: i, nameWithOwner: `o/r${i}`, description: `第 ${i} 个`, stargazerCount: i * 10, repositoryTopics: { nodes: [{ topic: { name: 'ai' } }] } });

// 假 GraphQL：按查询里的名字回仓库；override 换掉某几个的返回，failBatch 那一批整批失败。
function fakeGh({ failBatch = -1, override = {} } = {}) {
  const queries = [];
  return {
    queries,
    graphql: async (q) => {
      queries.push(q);
      if (queries.length - 1 === failBatch) throw new Error('返回 502');
      const data = {};
      for (const m of q.matchAll(/(r\d+): repository\(owner: "o", name: "r(\d+)"\)/g)) data[m[1]] = m[2] in override ? override[m[2]] : node(Number(m[2]));
      return { url: 'https://api.github.com/graphql', body: JSON.stringify({ data }), date: 'd' };
    },
  };
}
const store = { saveRaw: (kind, name) => ({ path: `runs/x/raw/${kind}/${name}.json` }) };
const items = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `o/r${i + 1}` }));

test('一次查 100 个仓库：150 个分 2 批，结果和输入同样顺序，原始响应各存一份', async () => {
  const gh = fakeGh();
  const r = await fetchMeta({ gh, store, items: items(150), label: 'd7' });
  assert.equal(gh.queries.length, 2);
  assert.equal(r.failed, 0);
  assert.deepEqual(r.meta[0], { id: 1, fullName: 'o/r1', description: '第 1 个', topics: ['ai'], total: 10, evidence: 'runs/x/raw/meta/d7-0.json' });
  assert.equal(r.meta[149].id, 150);
  assert.equal(r.meta[149].evidence, 'runs/x/raw/meta/d7-1.json');
});

test('查不到的、id 对不上的（这个名字已是另一个仓库）不给资料', async () => {
  const gh = fakeGh({ override: { 2: null, 3: { ...node(3), databaseId: 999 } } });
  const r = await fetchMeta({ gh, store, items: items(3), label: 'd1' });
  assert.equal(r.meta[0].id, 1);
  assert.equal(r.meta[1], null);
  assert.equal(r.meta[2], null);
});

test('只有名字的候选按 GraphQL 的 databaseId 补上 id；一批失败不影响别的批', async () => {
  const gh = fakeGh({ failBatch: 0 });
  const list = [...items(100), { name: 'o/r777' }];
  const r = await fetchMeta({ gh, store, items: list, label: 'd30' });
  assert.equal(r.failed, 100);
  assert.ok(r.meta.slice(0, 100).every((m) => m === null));
  assert.equal(r.meta[100].id, 777);
});

test('查询把名字按 JSON 字符串写入，名字里的引号不会改变查询', () => {
  const q = metaQuery([{ name: 'a"b/c' }]);
  assert.match(q, /r0: repository\(owner: "a\\"b", name: "c"\)/);
});
