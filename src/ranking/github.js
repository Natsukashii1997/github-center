// GitHub 官方接口：星数历史（核数）、项目信息（当前总 Star、项目 id）、仓库搜索（新项目榜、累计高星榜），
// 项目资料要读的 README 和仓库目录（#6），按批取候选描述和 topics 的 GraphQL（#10），以及日报背景要的官方 Release（#11）。原始响应原样交给调用方保存。
// 候选有项目 id 时按 id 访问（不受改名影响），只有名字时按名字访问。
const API = 'https://api.github.com';
export const PER_PAGE = 6;
// Release 一次取一页、每页最多 100 个（接口上限）。
export const RELEASES_PER_PAGE = 100;
const path = (c) => (c.id ? `/repositories/${c.id}` : `/repos/${c.name}`);

// 本机 gh 账号的每小时额度（core）和 Codex 的严格实验共用；它给自己留 1,000 次底，这里留得更多，额度紧时先让它用。
// 搜索额度另算（每分钟 30 次），每天只用 2 次，不设预留。GraphQL 额度也另算（每小时 5,000 点），照样留底。
export const RESERVE = 1500;
const RETRIES = 3;
const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// stats 记实际发出的请求次数（含重试）。单个请求最多等 timeoutMs，连接挂住就算失败重试，不让每天的运行卡死。
export function githubClient({ fetch, token, sleep = realSleep, now = Date.now, timeoutMs = 60_000 }) {
  const stats = { history: 0, project: 0, search: 0, readme: 0, tree: 0, graphql: 0, releases: 0 };
  let pauseUntil = 0;
  async function get(kind, p, body) {
    const url = API + p;
    for (let attempt = 1; ; attempt++) {
      if (pauseUntil > now()) await sleep(pauseUntil - now());
      stats[kind]++;
      let res;
      try {
        res = await fetch(url, {
          method: body ? 'POST' : 'GET',
          headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'github-center', ...(body ? { 'content-type': 'application/json' } : {}) },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) {
        if (attempt < RETRIES) { await sleep(attempt * 2000); continue; }
        throw new Error(`${url} 请求失败：${e.message}`);
      }
      const h = res.headers;
      const remaining = h.has('x-ratelimit-remaining') ? Number(h.get('x-ratelimit-remaining')) : null;
      const resetAt = h.has('x-ratelimit-reset') ? Number(h.get('x-ratelimit-reset')) * 1000 + 5000 : null;
      if (h.get('x-ratelimit-resource') !== 'search' && remaining !== null && remaining < RESERVE && resetAt) pauseUntil = Math.max(pauseUntil, resetAt);
      let text;
      try {
        text = await res.text();
      } catch (e) {
        if (attempt < RETRIES) { await sleep(attempt * 2000); continue; }
        throw new Error(`${url} 读取响应失败：${e.message}`);
      }
      if (res.status === 404) return null;
      if (res.ok) return { url, body: text, date: h.get('date') };
      // 被限流：等到额度重置（或按 retry-after）再试。
      if (res.status === 429 || (res.status === 403 && (remaining === 0 || h.has('retry-after')))) {
        const retryAfter = Number(h.get('retry-after'));
        pauseUntil = Math.max(pauseUntil, retryAfter ? now() + retryAfter * 1000 : resetAt ?? now() + 60_000);
        if (attempt < RETRIES * 2) continue;
      } else if (res.status >= 500 && attempt < RETRIES) {
        await sleep(attempt * 2000);
        continue;
      }
      throw new Error(`${url} 返回 ${res.status}：${text.slice(0, 200)}`);
    }
  }
  return {
    stats,
    history: (c) => get('history', `${path(c)}/stargazers/history?per_page=${PER_PAGE}`),
    project: (c) => get('project', path(c)),
    search: (q) => get('search', `/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=100`),
    readme: (c) => get('readme', `${path(c)}/readme`),
    tree: (c, ref) => get('tree', `${path(c)}/git/trees/${encodeURIComponent(ref)}?recursive=1`),
    graphql: (query) => get('graphql', '/graphql', JSON.stringify({ query })),
    // 最近 100 个 Release（按 created_at 从新到旧，含草稿和预发布版，由调用方筛）。
    releases: (c) => get('releases', `${path(c)}/releases?per_page=${RELEASES_PER_PAGE}`),
  };
}
