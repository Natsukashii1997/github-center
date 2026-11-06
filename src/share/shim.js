// 只读快照的垫片（#63，由 index.js 内联进每一页，在页面脚本之前运行）：头像换成 tidings-avatars.js 里的内嵌图，
// 站内链接换成快照里的页面，安装指令从同目录的 tidings-install.gz.txt 取，收藏、投票、换卡这类要账号的操作提示不可用。
// Artifact 只放行同源和 data:，GitHub 头像地址一律不能真去请求。
(() => {
  const AV = window.__AV || {};
  const HOME = window.__HOME;           // 发现页（主页面）的相对地址
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

  // 站内地址 → 快照里的页面；没有的返回 null
  const map = (href) => {
    const u = new URL(href, 'http://x');
    if (u.pathname === '/' ) return HOME + u.search + u.hash;
    const page = { '/stars': 'stars.html', '/favorites': 'favorites.html', '/settings': 'settings.html' }[u.pathname];
    return page ? page + u.search + u.hash : null;
  };
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
    if (to) location.href = to;
    else say('这是只读快照，这一页打不开');
  }, true);
  // 页面改地址栏时只保留 ?参数 和 #，不改路径
  for (const k of ['pushState', 'replaceState']) {
    const orig = history[k].bind(history);
    history[k] = (s, t, url) => {
      if (url == null) return orig(s, t);
      const u = new URL(url, location.href);
      return orig(s, t, location.pathname + u.search + u.hash);
    };
  }

  // 接口：安装指令从快照文件取；收藏、换卡不可用
  const realFetch = window.fetch.bind(window);
  let install;
  // 安装指令 gzip 压过再转成 base64 文本（9MB → 约 440KB；Artifact 不托管 .gz）
  const loadInstall = () => (install ??= realFetch('tidings-install.gz.txt').then(async (r) => {
    const bin = Uint8Array.from(atob((await r.text()).trim()), (c) => c.charCodeAt(0));
    return new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
  }).catch(() => (install = undefined, {})));
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
