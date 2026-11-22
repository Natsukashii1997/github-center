// 网站各页的 HTML 外壳（#114 从 home.js 拆出）：白雾外壳 frame、品牌图标和字标、嵌入页面数据的 embed、HTML 转义 esc。
// 嵌进 <script type="application/json">：把 < 和行分隔符转义，项目文字里出现 </script> 也不会提前结束脚本。
export const embed = (data) => JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

// 白雾外壳（2026-11-03 重设计，定稿原型 design/candidates/redesign/r7.html）：白底、反色 ASCII 鲨鱼背景、顶栏是涨星榜／分类榜／收藏页／设置页（设置页见 settings.js）。
// 分类榜见 categories.js（#27）。css、js 是这一页另要的样式和脚本（shell.css 放最后，外壳的底色优先于收藏页还在用的旧样式）。
// 三页都整页滚动、顶栏吸顶。
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// 导航（所有者 2026-11-04 定）：发现（原分类榜，常用，放第一个、打开网站就是它）、涨星（原涨星榜，/stars）、收藏、设置。
const NAV = [['/', '发现'], ['/stars', '涨星'], ['/favorites', '收藏'], ['/settings', '设置']];
// 品牌 Github·Tidings（所有者 2026-11-03 定稿，design/candidates/redesign/brand/）：报徽图标（粗圈、实心海面、星）+ 衬线斜体字标。
// 顶栏、登录页和浏览器标签图标共用同一个 SVG。
const MARK_SVG = '<svg viewBox="0 0 24 24"><defs><clipPath id="tdc"><circle cx="12" cy="12" r="10.4"/></clipPath></defs><circle cx="12" cy="12" r="11" fill="#fff"/><g clip-path="url(#tdc)"><path d="M-4 14.6q2.5-2.6 5 0t5 0 5 0 5 0 5 0 5 0 5 0 5 0 5 0 5 0V30H-4z" fill="#0969da"/><path d="M-9 18.8q2.5-2.4 5 0t5 0 5 0 5 0 5 0 5 0 5 0 5 0 5 0 5 0" fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="round" opacity=".75"/></g><polygon points="12,3.2 13.23,6.5 16.76,6.65 14,8.85 14.94,12.25 12,10.3 9.06,12.25 10,8.85 7.24,6.65 10.77,6.5" fill="#1f2328" stroke="#1f2328" stroke-width=".9" stroke-linejoin="round"/><circle cx="12" cy="12" r="11" fill="none" stroke="#1f2328" stroke-width="2"/></svg>';
export const MARK = MARK_SVG.replace('<svg ', '<svg class="logo" width="24" height="24" aria-hidden="true" ');
export const WORDMARK = '<span class="wm">Github<span class="d">·</span>Tidings</span>';
export const FAVICON = `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(MARK_SVG.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '))}">`;
export const frame = ({ title, active, ctx, css = [], js = [], data, body, bar = '' }) => `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Github·Tidings</title>
${FAVICON}
${[...css, 'shell.css'].map((f) => `<link rel="stylesheet" href="/assets/${f}">`).join('\n')}
</head>
<body>
<canvas class="sea" id="sea" aria-hidden="true"></canvas>
<div class="fog"></div>
<div class="app">
  <header class="bar">
    <a class="brand" href="/">${MARK}${WORDMARK}</a>
    <nav class="nav" aria-label="主导航">${NAV.map(([h, t]) => `<a href="${h}"${t === active ? ' aria-current="page"' : ''}>${t}</a>`).join('')}</nav>
    <div class="r">${bar}<span class="me" title="${esc(ctx.account.name)}${ctx.guest ? ' · 免登录' : ''}">${esc([...ctx.account.name][0] ?? '?')}</span>${ctx.guest ? '' : '<form method="post" action="/logout"><button class="out" type="submit">退出</button></form>'}</div>
  </header>
${body}
</div>
<script type="application/json" id="gc-data">${embed(data)}</script>
<script src="/assets/sharks.js"></script>
<script src="/assets/shell.js"></script>
${js.map((f) => `<script src="/assets/${f}"></script>`).join('\n')}
</body>
</html>
`;
