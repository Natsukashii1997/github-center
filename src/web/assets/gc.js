// GitHub 快速中心 · 网站共用组件（#13 起）。照冻结的视觉方案 t1b-r2（design/t1b/app.js）落地：组件的结构、类名和动效照抄，
// 数据换成页面里嵌入的真实快照与项目资料（服务端 src/web/home.js 整理），收藏和安装指令走本站接口。方案里的演示面板不进入生产。
window.GC = (() => {
  const D = JSON.parse(document.getElementById('gc-data').textContent), I = window.ICONS;
  const WINDOWS = Object.entries(D.windows).map(([id, w]) => ({ id, label: w.label }));
  const SPAN = { d1: 1, d7: 7, d30: 30 };
  const AI = Object.fromEntries(D.ais);
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ── 数字与日期 ──
  const num = (n) => n.toLocaleString('en-US');
  const wan = (n) => (n >= 10000 ? `${(n / 10000).toFixed(n >= 1000000 ? 0 : 1)} 万` : num(n));
  const utc = (day) => new Date(day + 'T00:00:00Z');
  const md = (d) => `${d.getUTCMonth() + 1} 月 ${d.getUTCDate()} 日`;
  const mdShort = (d) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  // 走势的第 i 天（0 是 30 天里最早的一天）；run 是这一期榜单那次运行的数字（见 src/web/home.js）
  const dayAt = (run, i) => new Date(utc(run.seriesDay).getTime() - (29 - i) * 86400000);
  const avatar = (p, s = 64) => (p.ownerId ? `https://avatars.githubusercontent.com/u/${p.ownerId}?s=${s}&v=4` : `https://github.com/${ownerOf(p)}.png?size=${s}`);
  const ownerOf = (p) => p.repo.split('/')[0];
  const nameOf = (p) => p.repo.split('/')[1];
  const pageOf = (repo) => `/p/${repo}`;

  // ── 动效 ──
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const EASE = 'cubic-bezier(.25, 1, .5, 1)';
  const anim = (el, kf, o) => (reduced() || !el ? null : el.animate(kf, { easing: EASE, ...o }));
  // 按 key 复用节点做位置补间：已有的行从旧位置滑到新位置，新出现的行淡入上移。
  function reconcile(listEl, rows, { key, create, update }) {
    const old = new Map($$(':scope > [data-key]', listEl).map((n) => [n.dataset.key, n]));
    const before = new Map([...old].map(([k, n]) => [k, n.getBoundingClientRect().top]));
    $$(':scope > :not([data-key])', listEl).forEach((n) => n.remove());
    const next = rows.map((r, i) => {
      const k = key(r), n = old.get(k) || create(r);
      n.dataset.key = k;
      update(n, r, i);
      return n;
    });
    const keep = new Set(next);
    old.forEach((n) => { if (!keep.has(n)) n.remove(); });
    next.forEach((n) => listEl.appendChild(n));
    next.forEach((n, i) => {
      const was = before.get(n.dataset.key);
      if (was === undefined) anim(n, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 240, delay: Math.min(i, 14) * 16, fill: 'backwards' });
      else { const dy = was - n.getBoundingClientRect().top; if (Math.abs(dy) > 0.5) anim(n, [{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 280 }); }
    });
  }
  function swap(el, html) {
    if (el.innerHTML === html) return;
    el.innerHTML = html;
    anim(el, [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 200 });
  }

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
  let target = D.ais[0][0];

  // ── 顶栏 ──
  const NAV = [['/', '涨星榜'], ['/new', '其他榜单'], ['/favorites', '我的收藏']];
  function topbar(active) {
    const el = $('header.top');
    el.innerHTML = `<div class="top-in">
      <a class="brand" href="/"><span class="mark" aria-hidden="true"></span>GitHub 快速中心</a>
      <nav class="nav" aria-label="主导航">${NAV.map(([h, t]) => `<a href="${h}"${t === active ? ' aria-current="page"' : ''}>${t}</a>`).join('')}</nav>
      <div class="top-r"><span class="fresh"><span class="dot" id="gc-dot"></span><span id="gc-fresh"></span></span><span class="who"><b>${esc(D.account.name)}</b><a href="/login" id="gc-logout">退出</a></span></div>
    </div>`;
    // 退出要用 POST（只接受本站提交）；链接只是外观。
    $('#gc-logout').addEventListener('click', (e) => {
      e.preventDefault();
      const f = document.createElement('form');
      f.method = 'post';
      f.action = '/logout';
      document.body.appendChild(f);
      f.submit();
    });
  }
  function setStatus(top) {
    const dot = $('#gc-dot');
    if (!dot) return;
    dot.dataset.tone = top.tone;
    $('#gc-fresh').textContent = top.text;
  }
  // 提示条：更新失败、可能不完整等，由服务端按快照和更新记录给出
  function notes(el, list) {
    el.innerHTML = list.map((n) => `<div class="note"${n.tone ? ` data-tone="${n.tone}"` : ''}>${I[n.icon]}<b>${esc(n.title)}</b><p>${esc(n.text)}</p></div>`).join('');
  }

  // ── 下划线标签 / 分段控件 ──
  function tabs(el, items, cur, onPick) {
    el.classList.add('tabs');
    el.innerHTML = items.map(([id, t]) => `<button type="button" data-id="${id}">${t}</button>`).join('') + '<span class="tabs-line"></span>';
    $$('button', el).forEach((b) => b.addEventListener('click', () => onPick(b.dataset.id)));
    const place = (id) => {
      const bs = $$('button', el), i = bs.findIndex((b) => b.dataset.id === id);
      bs.forEach((b, k) => b.setAttribute('aria-pressed', k === i));
      $('.tabs-line', el).style.transform = `translateX(${i * bs[0].offsetWidth}px)`;
    };
    place(cur);
    return place;
  }
  function seg(el, items, cur, onPick, w) {
    el.classList.add('seg');
    el.style.setProperty('--seg-w', w + 'px');
    el.innerHTML = '<span class="seg-thumb"></span>' + items.map(([id, t]) => `<button type="button" data-id="${id}">${t}</button>`).join('');
    const place = (id) => {
      const bs = $$('button', el), i = bs.findIndex((b) => b.dataset.id === id);
      bs.forEach((b, k) => b.setAttribute('aria-pressed', k === i));
      $('.seg-thumb', el).style.transform = `translateX(${i * w}px)`;
    };
    $$('button', el).forEach((b) => b.addEventListener('click', () => { place(b.dataset.id); onPick(b.dataset.id); }));
    place(cur);
    return place;
  }

  // ── 榜单行 ──
  // r：快照里的一条（名次、并列、窗口新增）并上项目资料。分类标签（#10）还没有，先留空。
  function rowCreate(r, onPick) {
    const p = D.projects[r.repo];
    const li = document.createElement('li');
    li.className = 'row';
    li.setAttribute('role', 'option');
    li.tabIndex = -1;
    const ds = p.what ?? '简介生成中';
    li.innerHTML = `<div class="rk"><b></b><i hidden>并列</i></div>
      <img class="av" alt="" loading="lazy" referrerpolicy="no-referrer" src="${avatar(p, 56)}">
      <div class="tx"><div class="nm" title="${esc(p.repo)}"><span class="o">${esc(ownerOf(p))}/</span><span class="n">${esc(nameOf(p))}</span></div><div class="ds" title="${esc(ds)}">${esc(ds)}</div><div class="tg"></div></div>
      <div class="nums"><div class="g"></div><div class="t"></div></div>
      <button class="ib" type="button" data-fav-id="${esc(p.repo)}">${I.star}</button>`;
    const fav = $('.ib', li);
    setFavBtn(fav, favs.has(p.repo));
    fav.addEventListener('click', (e) => { e.stopPropagation(); toggleFav(p, null, fav); });
    li.addEventListener('click', () => onPick(p.repo));
    return li;
  }
  function rowUpdate(li, r) {
    const run = D.projects[r.repo].runs[r.run];
    $('.rk b', li).textContent = r.rank;
    $('.rk i', li).hidden = !r.tie;
    li.toggleAttribute('data-top', r.rank <= 3);
    swap($('.g', li), `<small>+</small>${num(r.gain)}`);
    $('.t', li).innerHTML = `总 <span class="num">${wan(run.total)}</span>`;
  }

  // 选中块：跟着选中行滑动。选中的行是榜单在 Tab 顺序里的那一站，其余行用方向键到达。
  function placeSel(listEl, mark, key) {
    const li = key ? listEl.querySelector(`[data-key="${CSS.escape(key)}"]`) : null;
    $$('.row', listEl).forEach((x) => { x.setAttribute('aria-selected', x === li); x.tabIndex = x === li ? 0 : -1; });
    mark.style.visibility = li ? '' : 'hidden';
    if (li) mark.style.transform = `translateY(${li.offsetTop}px)`;
  }

  // ── 阅读卡（首页右栏；#14 起项目页共用） ──
  // ctx：{ eyebrow, run（这一期榜单的运行）, win（高亮哪个窗口，可空）, mode: 'pane' | 'page' }。简介还没生成好就显示“简介生成中”。
  // 窗口里有一天官方数字缺了，这个窗口的新增写“暂缺”，走势里那天留空位。
  function cardHTML(p, ctx) {
    const span = ctx.win ? SPAN[ctx.win] : 0, run = p.runs[ctx.run];
    const tag = ctx.mode === 'page' ? 'button' : 'div';
    const stats = WINDOWS.map((w) => `<${tag} class="stat"${tag === 'button' ? ` type="button" data-win="${w.id}" aria-pressed="${w.id === ctx.win}"` : ''}${w.id === ctx.win ? ' data-on' : ''}><span class="k">${w.label}新增</span><span class="v">${run.gains[w.id] == null ? '暂缺' : `+${num(run.gains[w.id])}`}</span></${tag}>`).join('');
    const read = p.what == null
      ? `<div class="gen">${I.sparkle}<span>简介生成中，通常几分钟内完成；下面的数字已是官方数据。</span></div><div class="gen-lines"><span class="sk" style="width:92%;height:14px"></span><span class="sk" style="width:76%;height:14px"></span><span class="sk" style="width:84%;height:14px"></span></div>`
      : `<div class="read"><div><div class="k">它是做什么的</div><p>${esc(p.what)}</p></div><div><div class="k">解决什么问题</div><p>${esc(p.problem)}</p></div></div>`;
    const chart = run.series ? chartHTML(run, span) : '';
    const skills = p.skills.length ? `<div class="skills"><div class="sec-k">包含的 Skill · ${p.skills.length} 个</div>${p.skills.map((s) => {
      const id = `${p.repo}#${s.path}`, on = favSkills.has(id);
      return `<div class="skill"><code>${esc(s.name)}</code><span>${esc(s.desc)}</span><span class="acts"><button class="ib" type="button" data-fav-id="${esc(id)}" data-skill="${esc(s.path)}" aria-pressed="${on}" aria-label="${on ? '取消收藏' : '收藏'}">${on ? I['star-fill'] : I.star}</button><button class="btn btn-g btn-s" type="button" data-skill-copy="${esc(s.path)}">${I.copy}<span>复制安装</span></button></span></div>`;
    }).join('')}</div>` : '';
    const meta = [p.lang && `<span>${esc(p.lang)}</span>`, p.created && `<span>创建于 ${md(utc(p.created))}</span>`].filter(Boolean).join('');
    return `<div class="body">
      ${ctx.eyebrow ? `<div class="eyebrow">${ctx.eyebrow}</div>` : ''}
      <div class="title"><img class="av" alt="" data-key="${esc(p.repo)}" referrerpolicy="no-referrer" src="${avatar(p, 96)}"><div><h2><span class="o">${esc(ownerOf(p))}/</span>${esc(nameOf(p))}</h2><div class="meta">${meta}</div></div></div>
      <div class="stats">${stats}<div class="stat"><span class="k">总 Star</span><span class="v">${wan(run.total)}</span></div></div>
      ${chart}
      ${read}
      ${p.conditions.length ? `<div class="cond"><b>使用条件</b>${p.conditions.map(esc).join('；')}</div>` : ''}
      ${skills}
      ${ctx.mode === 'pane' ? '<p class="hint"><kbd>↑</kbd> <kbd>↓</kbd> 在榜单里上下切换项目</p>' : ''}
    </div>
    <div class="dock" role="group" aria-label="安装与收藏">
      <span class="k">安装到</span><div data-target></div>
      <button class="btn btn-p" type="button" data-copy${p.installable ? '' : ' disabled title="项目资料还没读到，暂时不能生成安装指令"'}>${I.copy}<span>复制安装指令</span></button>
      <span class="sp"></span>
      <button class="btn btn-g" type="button" data-fav data-fav-text data-fav-id="${esc(p.repo)}">${I.star}<span>收藏</span></button>
      <a class="btn btn-g btn-i" href="https://github.com/${esc(p.repo)}" target="_blank" rel="noopener" title="在 GitHub 打开" aria-label="在 GitHub 打开">${I.external}</a>
    </div>`;
  }
  // 走势：每天一根柱子，缺数据的那天留空位、不画柱（缺失不补零）。柱子只给眼睛看，读屏读下面那句摘要。
  function chartHTML(run, span) {
    const known = run.series.map((v, i) => [v, i]).filter(([v]) => v != null);
    const [max, top] = known.reduce((a, b) => (b[0] > a[0] ? b : a), [0, 0]);
    const missing = run.series.length - known.length;
    const summary = `近 30 天每日新增走势：${md(dayAt(run, 0))}至 ${md(dayAt(run, 29))}，最高一天是 ${md(dayAt(run, top))}，新增 ${num(max)}${missing ? `；有 ${missing} 天缺官方数据` : ''}。`;
    return `<div class="chart"><div class="chart-k"><span>近 30 天每日新增</span><span>最高一天 <span class="num">${num(max)}</span></span></div>
        <div class="cbars" aria-hidden="true">${run.series.map((v, i) => `<i class="${i >= 30 - span ? 'on' : ''}" style="--h:${v == null ? 0 : (v / Math.max(max, 1)) * 100}%;--m:${v > 0 ? 1 : 0}px" title="${md(dayAt(run, i))}：${v == null ? '缺数据' : num(v)}"></i>`).join('')}</div>
        <p class="vh">${summary}</p>
        <div class="cdates" aria-hidden="true"><span>${mdShort(dayAt(run, 0))}</span><span>${mdShort(dayAt(run, 15))}</span><span>${mdShort(dayAt(run, 29))}</span></div></div>`;
  }
  function wireCard(card, p) {
    seg($('[data-target]', card), D.ais, target, (t) => { target = t; }, 100);
    const copy = $('[data-copy]', card);
    copy.addEventListener('click', () => copyInstall(copy, p, target));
    const fav = $('[data-fav]', card);
    setFavBtn(fav, favs.has(p.repo), true);
    fav.addEventListener('click', () => toggleFav(p, null, fav));
    const skillOf = (path) => p.skills.find((s) => s.path === path);
    $$('[data-skill]', card).forEach((b) => b.addEventListener('click', () => toggleFav(p, skillOf(b.dataset.skill), b)));
    $$('[data-skill-copy]', card).forEach((b) => b.addEventListener('click', () => copyInstall(b, p, target, skillOf(b.dataset.skillCopy), true)));
    $$('button.stat', card).forEach((b) => b.addEventListener('click', () => sweepBars(card, b.dataset.win)));
  }
  function growBars(card) {
    $$('.cbars i', card).forEach((b, k) => anim(b, [{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], { duration: 260, delay: 60 + k * 6, fill: 'backwards' }));
  }
  // 同一项目换窗口：只把窗口内的柱子从右往左依次换色
  function sweepBars(card, win) {
    const from = 30 - SPAN[win];
    $$('.cbars i', card).forEach((b, k) => {
      const on = k >= from;
      b.style.transitionDelay = on !== b.classList.contains('on') && !reduced() ? `${(29 - k) * 9}ms` : '0ms';
      b.classList.toggle('on', on);
    });
    $$('.stat', card).forEach((x, i) => { x.toggleAttribute('data-on', WINDOWS[i]?.id === win); if (x.tagName === 'BUTTON') x.setAttribute('aria-pressed', WINDOWS[i]?.id === win); });
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

  const q = new URLSearchParams(location.search);
  return { D, I, WINDOWS, SPAN, AI, $, $$, esc, num, wan, md, mdShort, reduced, anim, reconcile, swap, toast, favs, favSkills, toggleFav, setFavBtn, copyInstall, topbar, setStatus, notes, tabs, seg, rowCreate, rowUpdate, placeSel, cardHTML, wireCard, growBars, sweepBars, emptyHTML, avatar, ownerOf, nameOf, pageOf, q };
})();
