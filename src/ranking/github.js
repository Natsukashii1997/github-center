// GitHub 官方接口：星数历史（核数）和项目信息（当前总 Star、项目 id）。原始响应原样交给调用方保存。
// 候选有项目 id 时按 id 访问（不受改名影响），只有名字时按名字访问。
const API = 'https://api.github.com';
export const PER_PAGE = 6;
const path = (c) => (c.id ? `/repositories/${c.id}` : `/repos/${c.name}`);

export function githubClient({ fetch, token }) {
  const stats = { history: 0, project: 0 };
  async function get(p) {
    const url = API + p;
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
    history: (c) => (stats.history++, get(`${path(c)}/stargazers/history?per_page=${PER_PAGE}`)),
    project: (c) => (stats.project++, get(path(c))),
  };
}
