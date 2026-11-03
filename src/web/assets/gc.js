// GitHub 快速中心 · #14 那套共用组件，2026-11-03 白雾重设计（#21）后只剩我的收藏和登录页在用（首页、项目页改用 bw.js）：
// 数字、动效、提示气泡、收藏（POST /api/favorites）、复制安装指令（GET /api/install）、空状态、头像。顶栏改由服务端白雾外壳画。
window.GC = (() => {
  const D = JSON.parse(document.getElementById('gc-data').textContent), I = window.ICONS;
  const AI = Object.fromEntries(D.ais);
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ── 数字与日期 ──
  const num = (n) => n.toLocaleString('en-US');
  const wan = (n) => (n >= 10000 ? `${(n / 10000).toFixed(n >= 1000000 ? 0 : 1)} 万` : num(n));
  const avatar = (p, s = 64) => (p.ownerId ? `https://avatars.githubusercontent.com/u/${p.ownerId}?s=${s}&v=4` : `https://github.com/${ownerOf(p)}.png?size=${s}`);
  const ownerOf = (p) => p.repo.split('/')[0];
  const nameOf = (p) => p.repo.split('/')[1];

  // ── 动效 ──
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const EASE = 'cubic-bezier(.25, 1, .5, 1)';
  const anim = (el, kf, o) => (reduced() || !el ? null : el.animate(kf, { easing: EASE, ...o }));

  // ── 提示气泡 ──
  let toastEl, toastTimer;
  function toast(msg, icon = 'check') {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; toastEl.setAttribute('role', 'status'); document.body.appendChild(toastEl); }
    toastEl.innerHTML = `${I[icon] || ''}<span>${esc(msg)}</span>`;
    toastEl.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('on'), 2000);
  }

  // ── 收藏：写进账号（POST /api/favorites），写成功才改按钮；同一个按钮请求没回来前不再发 ──
  const favs = new Set(Object.values(D.projects).filter((p) => p.saved).map((p) => p.repo));
  const favSkills = new Set(Object.values(D.projects).flatMap((p) => p.savedSkills.map((s) => `${p.repo}#${s}`)));
  function setFavBtn(btn, on, withText) {
    btn.setAttribute('aria-pressed', on);
    btn.setAttribute('aria-label', on ? '取消收藏' : '收藏');
    btn.querySelector('svg').outerHTML = on ? I['star-fill'] : I.star;
    if (withText) btn.querySelector('span').textContent = on ? '已收藏' : '收藏';
  }
  // 同一个项目（或 Skill）在页面上可能有两个按钮（榜单行和阅读卡），写成功后一起改。
  const favButtons = (id) => $$(`[data-fav-id="${CSS.escape(id)}"]`);
  async function toggleFav(p, skill, btn) {
    const id = skill ? `${p.repo}#${skill.path}` : p.repo;
    const set = skill ? favSkills : favs, on = !set.has(id);
    if (btn.dataset.busy) return;
    btn.dataset.busy = '';
    let ok = false;
    try {
      const res = await fetch('/api/favorites', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ project_id: p.id, skill: skill?.path ?? '', action: on ? 'add' : 'remove' }) });
      ok = res.ok;
    } catch { /* 网络错误按失败处理 */ }
    delete btn.dataset.busy;
    if (!ok) { toast(on ? '没能收藏，请稍后再试' : '没能取消收藏，请稍后再试', 'error'); return; }
    on ? set.add(id) : set.delete(id);
    favButtons(id).forEach((b) => setFavBtn(b, on, b.hasAttribute('data-fav-text')));
    if (on) anim(btn.querySelector('svg'), [{ transform: 'scale(.7)' }, { transform: 'scale(1.08)' }, { transform: 'scale(1)' }], { duration: 280 });
    const name = skill ? `${p.repo} 的 Skill ${skill.name}` : p.repo;
    toast(on ? `已收藏 ${name}` : `已取消收藏 ${name}`, on ? 'star-fill' : 'star');
  }

  // ── 安装指令：由服务端按项目资料拼出（GET /api/install），复制进剪贴板 ──
  async function copyInstall(btn, p, target, skill, small) {
    const q = new URLSearchParams({ project: p.id, ai: target, ...(skill ? { skill: skill.path } : {}) });
    const text = fetch(`/api/install?${q}`).then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))));
    let ok = true;
    try {
      // 先把剪贴板占住再等指令回来，点击的那一刻就算数；不支持的浏览器等指令回来再写。
      if (window.ClipboardItem && navigator.clipboard.write) await navigator.clipboard.write([new ClipboardItem({ 'text/plain': text.then((t) => new Blob([t], { type: 'text/plain' })) })]);
      else await navigator.clipboard.writeText(await text);
    } catch { ok = false; }
    if (!ok) { toast('没能自动复制，请到项目页里手动复制', 'error'); return; }
    const label = small ? '复制安装' : '复制安装指令';
    btn.dataset.done = '';
    btn.innerHTML = `${I.check}<span>已复制</span>`;
    anim(btn.firstElementChild, [{ transform: 'scale(.6)' }, { transform: 'scale(1.05)' }, { transform: 'scale(1)' }], { duration: 260 });
    toast(`已复制，粘贴给 ${AI[target]} 即可安装`);
    clearTimeout(btn._t);
    btn._t = setTimeout(() => { delete btn.dataset.done; btn.innerHTML = `${I.copy}<span>${label}</span>`; }, 2000);
  }
  const emptyHTML = (icon, title, text, action) => `<div class="empty"><div class="ic">${I[icon]}</div><b>${esc(title)}</b>${esc(text)}${action ? `<div><a class="btn btn-g" href="${action[0]}">${action[1]}</a></div>` : ''}</div>`;

  // 头像读不到时换成首字母
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.classList.contains('av')) return;
    const d = document.createElement('span');
    d.className = img.className + ' av-fb';
    d.textContent = (img.closest('[data-key]')?.dataset.key || '?')[0].toUpperCase();
    img.replaceWith(d);
  }, true);

  return { D, I, AI, $, $$, esc, num, wan, reduced, anim, toast, favs, favSkills, toggleFav, setFavBtn, copyInstall, emptyHTML, avatar, ownerOf, nameOf };
})();
