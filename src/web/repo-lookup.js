// 所有者换卡时联网查一次 GitHub（#27）：粘贴的地址本地没有时，查这一个仓库的项目 id、名字、总 Star、作者 id 和描述。
// 只发一次请求、10 秒超时、不重试；没有这个公开仓库回 null，GitHub 出错抛错。token 可省（公开仓库匿名也能查，额度小）。
// fullName 来自 repo-link.js 的 parseRepoInput，只含字母数字和 . _ -，直接拼进地址。
export function repoLookup({ fetch, token, timeoutMs = 10_000 }) {
  return async (fullName) => {
    let res;
    try {
      res = await fetch(`https://api.github.com/repos/${fullName}`, {
        headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'github-center', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new Error(e.name === 'TimeoutError' ? `${timeoutMs / 1000} 秒没有回应` : '连不上 GitHub');
    }
    if (res.status === 404) return null;
    if (res.status === 403 || res.status === 429) throw new Error(`GitHub 拒绝了请求（${res.status}），多半是查询额度用完了，过一会儿再试`);
    if (!res.ok) throw new Error(`GitHub 返回 ${res.status}`);
    const r = await res.json();
    if (r.private) return null;
    return { id: r.id, fullName: r.full_name, ownerId: r.owner?.id ?? null, total: r.stargazers_count, description: r.description ?? null };
  };
}
