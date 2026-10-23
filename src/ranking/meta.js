// 已核数候选的描述、topics 和当前总 Star（#10 归类和分类榜用）：GitHub GraphQL 一次查 100 个仓库，约 1 点额度（与 REST 分开）。
// 按名字查，GitHub 会跟着改名跳转；有 id 的候选核对 databaseId，对不上（这个名字已是另一个仓库）的不用。
// 查不到的给 null；某一批请求失败不影响其他批，失败的个数记下来。
const BATCH = 100;
const FIELDS = 'databaseId nameWithOwner description stargazerCount repositoryTopics(first: 20) { nodes { topic { name } } }';

export function metaQuery(items) {
  const lines = items.map((c, i) => {
    const [owner, name] = c.name.split('/');
    return `  r${i}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { ${FIELDS} }`;
  });
  return `query {\n${lines.join('\n')}\n}`;
}

// items：[{ id?, name }]；label 区分同一次运行里各次调用存下的原始响应。
// 返回和 items 同样顺序的 meta（{ id, fullName, description, topics, total, evidence } 或 null）和失败个数。
export async function fetchMeta({ gh, store, items, label }) {
  const meta = new Array(items.length).fill(null);
  let failed = 0;
  for (let start = 0, n = 0; start < items.length; start += BATCH, n++) {
    const batch = items.slice(start, start + BATCH);
    let data;
    let evidence;
    try {
      const res = await gh.graphql(metaQuery(batch));
      data = JSON.parse(res.body).data;
      if (!data) throw new Error('GraphQL 没有返回数据');
      evidence = store.saveRaw('meta', `${label}-${n}`, res);
    } catch {
      failed += batch.length;
      continue;
    }
    batch.forEach((c, i) => {
      const r = data[`r${i}`];
      if (!r || (c.id && r.databaseId !== c.id)) return;
      meta[start + i] = {
        id: r.databaseId,
        fullName: r.nameWithOwner,
        description: r.description ?? null,
        topics: r.repositoryTopics.nodes.map((t) => t.topic.name),
        total: r.stargazerCount,
        evidence: evidence.path,
      };
    });
  }
  return { meta, failed };
}
