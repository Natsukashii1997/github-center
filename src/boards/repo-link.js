// 从帖子链接和正文里认出指向 GitHub 仓库的链接（热点榜 #25；精选榜换卡时粘贴的地址也用它）。
// 只认 github.com（或 www.github.com）下 /<作者>/<仓库> 形式的地址；gist、raw、组织页、话题页这类不是仓库的路径不算。
// 返回 'owner/repo'（保留原文大小写，去掉末尾的 .git 和句点）；同一段文字里大小写不同的同一仓库只算一次。

// github.com 第一段是这些的，不是作者名（GitHub 保留的站内路径）。
const RESERVED = new Set([
  'about', 'apps', 'blog', 'collections', 'contact', 'customer-stories', 'enterprise', 'events', 'explore', 'features',
  'login', 'join', 'marketplace', 'new', 'notifications', 'orgs', 'organizations', 'pricing', 'pulls', 'issues', 'readme',
  'search', 'security', 'settings', 'site', 'sponsors', 'team', 'topics', 'trending', 'codespaces', 'resources', 'solutions', 'users',
]);
// 作者名：字母数字和连字符，最长 39；仓库名：字母数字和 . _ -。前面不能紧挨字母数字或句点（排除 gist.github.com、notgithub.com）。
const LINK = /(?<![\w.-])(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]+)/gi;

function clean(owner, repo) {
  const name = repo.replace(/\.git$/i, '').replace(/\.+$/, '');
  if (!name || name === '.' || name === '..' || RESERVED.has(owner.toLowerCase())) return null;
  return `${owner}/${name}`;
}

export function findRepos(text) {
  const out = new Map();
  for (const m of String(text ?? '').matchAll(LINK)) {
    const repo = clean(m[1], m[2]);
    if (repo && !out.has(repo.toLowerCase())) out.set(repo.toLowerCase(), repo);
  }
  return [...out.values()];
}

// 只接受“一个仓库”：粘贴的 GitHub 地址，或直接写的 owner/repo。认不出返回 null。
export function parseRepoInput(text) {
  const s = String(text ?? '').trim();
  const [first] = findRepos(s);
  if (first) return first;
  const m = /^([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]+)$/.exec(s);
  return m ? clean(m[1], m[2]) : null;
}
