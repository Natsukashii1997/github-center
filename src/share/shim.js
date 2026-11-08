// 分享页的垫片（#63、#71，由 index.js 内联进每一页，在页面脚本之前运行；发现页就是外层，其余三页在外层的 srcdoc iframe 里）：
// 头像换成外层的内嵌图，站内链接交给外层切页，安装指令从外层的数据里取，收藏、投票、换卡这类要账号的操作提示不可用。
// Artifact 只放行同源和 data:，GitHub 头像地址一律不能真去请求。
(() => {
  const AV = window.__AV || {};
  // 外层：带着安装指令数据的那页（发现页自己，见 index.js 的 shell）；iframe 里的页才找 parent。
  // 不能一律用 parent：Artifact 里外层页本身也套在 claude.ai 的 iframe 里，parent 跨域，读属性就抛错（2026-11-08 线上实测点不动）
  const top = '__INSTALL_GZ' in window ? window : window.parent;
  const avKey = (src) => {
    let m = /avatars\.githubusercontent\.com\/u\/(\d+)/.exec(src);
    if (m) return `u/${m[1]}`;
    m = /github\.com\/([^/?#]+)\.png/.exec(src);
    return m ? `n/${m[1].toLowerCase()}` : null;
  };
  const fixImg = (img) => {
    const src = img.getAttribute('src');
    if (!src || src.startsWith('data:')) return;
    const k = avKey(src);
    if (k) img.setAttribute('src', AV[k] || 'data:image/gif;base64,R0lGODlhAQABAAAAACw=');
  };
  const scan = (root) => {
    if (root.nodeType !== 1) return;
    if (root.tagName === 'IMG') fixImg(root);
    root.querySelectorAll?.('img').forEach(fixImg);
  };
  // 页面用 innerHTML 拼卡片：在解析前就把头像地址换掉，免得先发出被拦的请求
  const AV_URL = /https:\/\/(?:avatars\.githubusercontent\.com\/u\/\d+|github\.com\/[^/"'?\s]+\.png)\?[^"'\s]*/g;
  const rewrite = (html) => (typeof html === 'string' && html.includes('https://') ? html.replace(AV_URL, (u) => AV[avKey(u)] || 'data:image/gif;base64,R0lGODlhAQABAAAAACw=') : html);
  const inner = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  Object.defineProperty(Element.prototype, 'innerHTML', { ...inner, set(v) { inner.set.call(this, rewrite(v)); } });
  const adj = Element.prototype.insertAdjacentHTML;
  Element.prototype.insertAdjacentHTML = function (pos, html) { return adj.call(this, pos, rewrite(html)); };
  new MutationObserver((ms) => ms.forEach((m) => {
    if (m.type === 'attributes') fixImg(m.target);
    else m.addedNodes.forEach(scan);
  })).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });

  // 站内地址 → 外层的哪一页；没有的返回 null
  const map = (href) => ({ '/': 'index', '/stars': 'stars', '/favorites': 'favorites', '/settings': 'settings' })[new URL(href, 'http://x').pathname] ?? null;
  const say = (msg) => {
    let el = document.getElementById('snap-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'snap-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(say.t);
    say.t = setTimeout(() => el.classList.remove('on'), 2200);
  };
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href^="/"]');
    if (!a) return;
    e.preventDefault();
    const to = map(a.getAttribute('href'));
    if (to && top.__tidingsGo) top.__tidingsGo(to);
    else say('这是只读快照，这一页打不开');
  }, true);
  // 页面想把选中的窗口、项目写进地址栏：srcdoc 页没有可改的地址，只记状态、不改地址
  for (const k of ['pushState', 'replaceState']) {
    const orig = history[k].bind(history);
    history[k] = (s, t) => orig(s, t);
  }

  // 接口：安装指令从外层的数据取；收藏、换卡不可用
  const realFetch = window.fetch.bind(window);
  let install;
  // 安装指令在外层，gzip 后 base64（9MB → 约 440KB），第一次用时解开
  // 解开的结果存在外层，四页共用一份
  const loadInstall = () => (install ??= (top.__installP ??= (async () => {
    const bin = Uint8Array.from(atob(top.__INSTALL_GZ), (c) => c.charCodeAt(0));
    return new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
  })().catch(() => (top.__installP = undefined, {}))));
  // 页面空下来就先取好，点「复制」时不用等下载
  addEventListener('load', () => (window.requestIdleCallback ?? setTimeout)(loadInstall));
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.startsWith('/api/install')) {
      loadInstall();
      const q = new URL(url, 'http://x').searchParams;
      const t = (await install)[`${q.get('project')}|${q.get('ai')}|${q.get('skill') ?? ''}`];
      return new Response(t ?? '', { status: t ? 200 : 404 });
    }
    if (url.startsWith('/api/')) {
      say('这是只读快照，收藏和修改不可用');
      return new Response('{}', { status: 403 });
    }
    return realFetch(input, init);
  };
})();
