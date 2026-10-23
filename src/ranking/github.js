// GitHub 官方接口：星数历史（核数）和仓库信息（当前总 Star）。原始响应原样交给调用方保存。
const API = 'https://api.github.com';
const base = (c) => (c.id ? `/repositories/${c.id}` : `/repos/${c.name}`);

export function githubClient({ fetch, token }) {
  const stats = { history: 0, repo: 0 };
  async function get(path) {
    const url = API + path;
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'github-center' },
    });
    const body = await res.text();
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`${url} 返回 ${res.status}：${body.slice(0, 200)}`);
    return { url, body, date: res.headers.get('date') };
  }
  return {
    stats,
    history: (c) => (stats.history++, get(`${base(c)}/stargazers/history?per_page=6`)),
    repo: (c) => (stats.repo++, get(base(c))),
  };
}
