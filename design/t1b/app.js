// GitHub 快速中心 · T1b 共用逻辑与组件拼装（方向「导读」）。页面只调用这里的函数，组件的结构只在这里写一次。
window.GC = (() => {
  const D = window.GC_DATA, I = window.ICONS;
  const { meta, projects } = D;
  const CATS = ['AI 应用工具', 'Agent／MCP', '工作流自动化', '知识管理与办公效率', 'Skill', '开发框架与组件库', '数据库与数据工具', '开发者工具与基础设施', '其他'];
  const WINDOWS = [{ id: 'd1', label: '近 1 天', days: 1 }, { id: 'd7', label: '近 7 天', days: 7 }, { id: 'd30', label: '近 30 天', days: 30 }];
  const SPAN = { d1: 1, d7: 7, d30: 30 };
  const AI = { claude: 'Claude Code', codex: 'Codex' };
  const list = Object.values(projects);
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ── 数字与日期 ──
  const sum = (a) => a.reduce((s, x) => s + x, 0);
  const gainOf = (p, win) => sum(p.series.slice(-SPAN[win]));
  const num = (n) => n.toLocaleString('en-US');
  const wan = (n) => (n >= 10000 ? `${(n / 10000).toFixed(n >= 1000000 ? 0 : 1)} 万` : num(n));
  const statDate = new Date(meta.statDay + 'T00:00:00Z');
  const dayAt = (i) => new Date(statDate.getTime() - (29 - i) * 86400000);
  const md = (d) => `${d.getUTCMonth() + 1} 月 ${d.getUTCDate()} 日`;
  const mdShort = (d) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  const iso = (s) => new Date(s.length === 10 ? s + 'T00:00:00Z' : s + ':00+08:00');
  const mdIso = (s) => { const d = iso(s); return s.length === 10 ? md(d) : `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const avatar = (p, s = 64) => `https://avatars.githubusercontent.com/u/${p.owner}?s=${s}&v=4`;
  const ownerOf = (p) => p.repo.split('/')[0];
  const nameOf = (p) => p.repo.split('/')[1];

  // ── 名次：并列同名次；取前 20，末位并列一并收入 ──
  function rankBy(rows, key) {
    rows.sort((a, b) => b[key] - a[key]);
    const cut = rows.length > 20 ? rows.filter((r) => r[key] >= rows[19][key]) : rows;
    let rank = 0;
    return cut.map((r, i) => {
      if (i === 0 || r[key] !== cut[i - 1][key]) rank = i + 1;
      return { ...r, rank, tie: cut.filter((x) => x[key] === r[key]).length > 1 };
    });
  }
  const byCat = (cat) => list.filter((p) => !cat || p.cats.includes(cat));
  const ranking = (win, cat) => rankBy(byCat(cat).map((p) => ({ ...p, gain: gainOf(p, win) })), 'gain');

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

  // ── 收藏（候选页只记在内存里） ──
  const favs = new Set(D.favorites.filter((f) => f.type === 'repo').map((f) => f.repo));
  const favSkills = new Set(D.favorites.filter((f) => f.type === 'skill').map((f) => `${f.repo}#${f.skill}`));
  function setFavBtn(btn, on, withText) {
    btn.setAttribute('aria-pressed', on);
    btn.setAttribute('aria-label', on ? '取消收藏' : '收藏');
    btn.querySelector('svg').outerHTML = on ? I['star-fill'] : I.star;
    if (withText) btn.querySelector('span').textContent = on ? '已收藏' : '收藏';
  }
  function toggleFav(id, btn, withText) {
    const set = id.includes('#') ? favSkills : favs, on = !set.has(id);
    on ? set.add(id) : set.delete(id);
    setFavBtn(btn, on, withText);
    if (on) anim(btn.querySelector('svg'), [{ transform: 'scale(.7)' }, { transform: 'scale(1.08)' }, { transform: 'scale(1)' }], { duration: 280 });
    const name = id.replace('#', ' 的 Skill ');
    toast(on ? `已收藏 ${name}` : `已取消收藏 ${name}`, on ? 'star-fill' : 'star');
  }

  // ── 安装指令 ──
  function installText(repo, target, skill) {
    const what = skill ? `仓库 ${repo} 里名为「${skill}」的 Skill` : ` GitHub 项目 ${repo}`;
    return `请在你所在的这台电脑上，为 ${AI[target]} 安装${what}（https://github.com/${repo}）。\n1. 先阅读项目官方 README 和安装文档，按文档步骤安装和配置，不要猜测命令。\n2. 装好后实际调用一次，确认能正常使用。\n3. 如果需要账号、API Key 或付费，停下来告诉我缺什么，不要自行注册或付费。\n4. 最后用两三句话告诉我：它装在哪里、怎么调用、第一次可以怎么试。`;
  }
  async function copyInstall(btn, repo, target, skill, small) {
    try { await navigator.clipboard.writeText(installText(repo, target, skill)); } catch { /* 候选页里复制失败也照常演示 */ }
    const label = small ? '复制安装' : '复制安装指令';
    btn.dataset.done = '';
    btn.innerHTML = `${I.check}<span>已复制</span>`;
    anim(btn.firstElementChild, [{ transform: 'scale(.6)' }, { transform: 'scale(1.05)' }, { transform: 'scale(1)' }], { duration: 260 });
    toast(`已复制，粘贴给 ${AI[target]} 即可安装`);
    clearTimeout(btn._t);
    btn._t = setTimeout(() => { delete btn.dataset.done; btn.innerHTML = `${I.copy}<span>${label}</span>`; }, 2000);
  }
  let target = 'claude';

  // ── 页面状态（候选页用演示面板切换） ──
  const STATUS = {
    ok: { tone: 'ok', top: `10 月 22 日数据 · 16:52 更新` },
    partial: { tone: 'warn', top: '可能不完整 · 10 月 22 日数据', title: '可能不完整', text: '10 月 22 日有 3 个候选项目暂时读不到官方星数，名次可能有出入。', icon: 'warn' },
    failed: { tone: 'bad', top: '更新失败 · 显示 10 月 22 日数据', title: '更新失败', text: '10 月 23 日的更新失败，下面是上次成功的 10 月 22 日数据。', icon: 'error' },
  };
  STATUS.loading = STATUS.ok;

  // ── 顶栏 ──
  const NAV = [['index.html', '涨星榜'], ['boards.html', '其他榜单'], ['daily.html', '日报'], ['favorites.html', '我的收藏']];
  function topbar(active) {
    const el = $('header.top');
    el.innerHTML = `<div class="top-in">
      <a class="brand" href="index.html"><span class="mark" aria-hidden="true"></span>GitHub 快速中心</a>
      <nav class="nav" aria-label="主导航">${NAV.map(([h, t]) => `<a href="${h}"${t === active ? ' aria-current="page"' : ''}>${t}</a>`).join('')}</nav>
      <div class="top-r"><span class="fresh"><span class="dot" id="gc-dot"></span><span id="gc-fresh"></span></span><span class="who"><b>常浩</b><a href="login.html">退出</a></span></div>
    </div>`;
    setStatus('ok');
  }
  function setStatus(state) {
    const st = STATUS[state];
    const dot = $('#gc-dot');
    if (!dot) return;
    dot.dataset.tone = st.tone;
    $('#gc-fresh').textContent = st.top;
  }
  // 提示条：状态优先，其次是不足 20 个；两者同时出现时都显示
  function notes(el, state, short) {
    const st = STATUS[state], parts = [];
    if (st.title) parts.push(`<div class="note" data-tone="${st.tone}">${I[st.icon]}<b>${st.title}</b><p>${st.text}</p></div>`);
    if (short) parts.push(`<div class="note">${I.tag}<b>不足 20 个</b><p>${short}</p></div>`);
    el.innerHTML = parts.join('');
  }

  // ── 下划线标签 / 分类胶囊 / 分段控件 ──
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
  function chips(el, cur, onPick) {
    el.classList.add('chips');
    el.innerHTML = [null, ...CATS].map((c) => `<button type="button" data-cat="${c || ''}">${c || '全部'}</button>`).join('');
    $$('button', el).forEach((b) => b.addEventListener('click', () => onPick(b.dataset.cat || null)));
    const place = (c) => $$('button', el).forEach((b) => b.setAttribute('aria-pressed', (b.dataset.cat || null) === c));
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
  // kind：gain（窗口新增，首页与热门榜）/ created（新项目榜）/ total（累计高星榜）
  function rowCreate(p, onPick) {
    const li = document.createElement('li');
    li.className = 'row';
    li.setAttribute('role', 'option');
    li.innerHTML = `<div class="rk"><b></b><i hidden>并列</i></div>
      <img class="av" alt="" loading="lazy" referrerpolicy="no-referrer" src="${avatar(p, 56)}">
      <div class="tx"><div class="nm" title="${esc(p.repo)}"><span class="o">${esc(ownerOf(p))}/</span><span class="n">${esc(nameOf(p))}</span></div><div class="ds" title="${esc(p.what)}">${esc(p.what)}</div><div class="tg"></div></div>
      <div class="nums"><div class="g"></div><div class="t"></div></div>
      <button class="ib" type="button">${I.star}</button>`;
    const fav = $('.ib', li);
    setFavBtn(fav, favs.has(p.repo));
    fav.addEventListener('click', (e) => { e.stopPropagation(); toggleFav(p.repo, fav); });
    li.addEventListener('click', () => onPick(p.repo));
    return li;
  }
  function rowUpdate(li, r, kind, gainLabel) {
    $('.rk b', li).textContent = r.rank;
    $('.rk i', li).hidden = !r.tie;
    li.toggleAttribute('data-top', r.rank <= 3);
    const tags = r.cats.map((c) => `<span>${c}</span>`).join('');
    if (kind === 'created') {
      $('.tg', li).innerHTML = tags;
      swap($('.g', li), `<span class="g-k">总 Star</span>${num(r.total)}`);
      $('.t', li).innerHTML = `创建于 <span class="num">${mdShort(iso(r.created))}</span>`;
    } else if (kind === 'total') {
      $('.tg', li).innerHTML = tags;
      swap($('.g', li), `${num(r.total)}`);
      $('.t', li).innerHTML = `近 30 天 <span class="num">+${num(gainOf(r, 'd30'))}</span>`;
    } else {
      $('.tg', li).innerHTML = tags;
      swap($('.g', li), `${gainLabel ? `<span class="g-k">${gainLabel}</span>` : ''}<small>+</small>${num(r.gain)}`);
      $('.t', li).innerHTML = `总 <span class="num">${wan(r.total)}</span>`;
    }
  }
  const rowSkeleton = (n) => Array.from({ length: n }, () => `<li class="row"><span class="sk" style="width:16px;justify-self:end"></span><span class="av"></span><div><span class="sk" style="width:46%"></span><span class="sk" style="width:82%;margin-top:9px"></span><span class="sk" style="width:30%;margin-top:9px"></span></div><span class="sk" style="width:48px"></span><span></span></li>`).join('');

  // 选中块：跟着选中行滑动
  function placeSel(listEl, mark, key) {
    const li = key ? listEl.querySelector(`[data-key="${CSS.escape(key)}"]`) : null;
    $$('.row', listEl).forEach((x) => x.setAttribute('aria-selected', x === li));
    mark.style.visibility = li ? '' : 'hidden';
    if (li) mark.style.transform = `translateY(${li.offsetTop}px)`;
  }

  // ── 阅读卡（首页右栏与项目页共用） ──
  // ctx：{ eyebrow, win（高亮哪个窗口，可空）, mode: 'pane' | 'page', generating }
  function cardHTML(p, ctx) {
    const span = ctx.win ? SPAN[ctx.win] : 0, max = Math.max(...p.series, 1);
    // 项目页里三个窗口数字可以点，点哪个就把走势里对应的天数高亮
    const tag = ctx.mode === 'page' ? 'button' : 'div';
    const stats = WINDOWS.map((w) => `<${tag} class="stat"${tag === 'button' ? ` type="button" data-win="${w.id}" aria-pressed="${w.id === ctx.win}"` : ''}${w.id === ctx.win ? ' data-on' : ''}><span class="k">${w.label}新增</span><span class="v">+${num(gainOf(p, w.id))}</span></${tag}>`).join('');
    const read = ctx.generating
      ? `<div class="gen">${I.sparkle}<span>简介生成中，通常几分钟内完成；下面的数字已是官方数据。</span></div><div class="gen-lines"><span class="sk" style="width:92%;height:14px"></span><span class="sk" style="width:76%;height:14px"></span><span class="sk" style="width:84%;height:14px"></span></div>`
      : `<div class="read"><div><div class="k">它是做什么的</div><p>${esc(p.what)}。</p></div><div><div class="k">解决什么问题</div><p>${esc(p.problem)}。</p></div></div>`;
    const skills = p.skills.length ? `<div class="skills"><div class="sec-k">包含的 Skill · ${p.skills.length} 个</div>${p.skills.map((s) => {
      const id = `${p.repo}#${s.name}`, on = favSkills.has(id);
      return `<div class="skill"><code>${esc(s.name)}</code><span>${esc(s.desc)}</span><span class="acts"><button class="ib" type="button" data-skill-fav="${esc(s.name)}" aria-pressed="${on}" aria-label="${on ? '取消收藏' : '收藏'}">${on ? I['star-fill'] : I.star}</button><button class="btn btn-g btn-s" type="button" data-skill-copy="${esc(s.name)}">${I.copy}<span>复制安装</span></button></span></div>`;
    }).join('')}</div>` : '';
    return `<div class="body">
      ${ctx.eyebrow ? `<div class="eyebrow">${ctx.eyebrow}</div>` : ''}
      <div class="title"><img class="av" alt="" data-key="${esc(p.repo)}" referrerpolicy="no-referrer" src="${avatar(p, 96)}"><div><h2><span class="o">${esc(ownerOf(p))}/</span>${esc(nameOf(p))}</h2><div class="meta">${p.cats.map((c) => `<span>${c}</span>`).join('')}${p.lang ? `<span>${esc(p.lang)}</span>` : ''}<span>创建于 ${md(iso(p.created))}</span></div></div></div>
      <div class="stats">${stats}<div class="stat"><span class="k">总 Star</span><span class="v">${wan(p.total)}</span></div></div>
      <div class="chart"><div class="chart-k"><span>近 30 天每日新增</span><span>最高一天 <span class="num">${num(max)}</span></span></div>
        <div class="cbars">${p.series.map((v, i) => `<i class="${i >= 30 - span ? 'on' : ''}" style="--h:${(v / max) * 100}%;--m:${v > 0 ? 1 : 0}px" title="${md(dayAt(i))}：${num(v)}"></i>`).join('')}</div>
        <div class="cdates"><span>${mdShort(dayAt(0))}</span><span>${mdShort(dayAt(15))}</span><span>${mdShort(dayAt(29))}</span></div></div>
      ${read}
      ${p.conditions.length ? `<div class="cond"><b>使用条件</b>${p.conditions.map(esc).join('；')}</div>` : ''}
      ${skills}
      ${ctx.mode === 'pane' ? '<p class="hint"><kbd>↑</kbd> <kbd>↓</kbd> 在榜单里上下切换项目</p>' : ''}
    </div>
    <div class="dock" role="group" aria-label="安装与收藏">
      <span class="k">安装到</span><div data-target></div>
      <button class="btn btn-p" type="button" data-copy>${I.copy}<span>复制安装指令</span></button>
      <span class="sp"></span>
      <button class="btn btn-g" type="button" data-fav>${I.star}<span>收藏</span></button>
      <a class="btn btn-g btn-i" href="https://github.com/${esc(p.repo)}" target="_blank" rel="noopener" title="在 GitHub 打开" aria-label="在 GitHub 打开">${I.external}</a>
    </div>`;
  }
  function wireCard(card, p) {
    seg($('[data-target]', card), Object.entries(AI), target, (t) => { target = t; }, 100);
    const copy = $('[data-copy]', card);
    copy.addEventListener('click', () => copyInstall(copy, p.repo, target));
    const fav = $('[data-fav]', card);
    setFavBtn(fav, favs.has(p.repo), true);
    fav.addEventListener('click', () => toggleFav(p.repo, fav, true));
    $$('[data-skill-fav]', card).forEach((b) => b.addEventListener('click', () => toggleFav(`${p.repo}#${b.dataset.skillFav}`, b)));
    $$('[data-skill-copy]', card).forEach((b) => b.addEventListener('click', () => copyInstall(b, p.repo, target, b.dataset.skillCopy, true)));
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
  const cardSkeleton = () => `<div class="body"><span class="sk" style="width:30%"></span><span class="sk" style="width:60%;height:22px;margin-top:20px"></span><span class="sk" style="width:100%;height:60px;margin-top:28px"></span><span class="sk" style="width:100%;height:76px;margin-top:22px"></span><span class="sk" style="width:90%;margin-top:28px"></span><span class="sk" style="width:70%;margin-top:12px"></span></div>`;
  const emptyHTML = (icon, title, text, action) => `<div class="empty"><div class="ic">${I[icon]}</div><b>${title}</b>${text}${action ? `<div><a class="btn btn-g" href="${action[0]}">${action[1]}</a></div>` : ''}</div>`;

  // 头像读不到时换成首字母
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.classList.contains('av')) return;
    const d = document.createElement('span');
    d.className = img.className + ' av-fb';
    d.textContent = (img.closest('[data-key]')?.dataset.key || '?')[0].toUpperCase();
    img.replaceWith(d);
  }, true);

  // ── 演示面板：只用于候选对比，切换页面状态与主题 ──
  const THEMES = ['system', 'light', 'dark'], THEME_LABEL = { system: '跟随系统', light: '浅色', dark: '深色' };
  let theme = 'system';
  const setTheme = (t) => { theme = t; if (t === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t; };
  const q = new URLSearchParams(location.search);
  if (q.get('theme')) setTheme(q.get('theme'));
  function demo(states, onState) {
    const el = document.createElement('div');
    el.className = 'gc-demo';
    el.innerHTML = `<span>示例数据</span>${states.length > 1 ? `<select aria-label="页面状态">${states.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>` : ''}<button type="button">${THEME_LABEL[theme]}</button>`;
    const sel = $('select', el), tb = $('button', el);
    sel?.addEventListener('change', () => onState(sel.value));
    tb.addEventListener('click', () => { setTheme(THEMES[(THEMES.indexOf(theme) + 1) % 3]); tb.textContent = THEME_LABEL[theme]; });
    document.body.appendChild(el);
    if (q.get('state') && sel) { sel.value = q.get('state'); onState(q.get('state')); }
  }

  return { D, I, meta, projects, list, CATS, WINDOWS, SPAN, AI, $, $$, esc, num, wan, md, mdShort, mdIso, iso, dayAt, gainOf, ranking, rankBy, byCat, reduced, anim, reconcile, swap, toast, favs, favSkills, toggleFav, setFavBtn, installText, copyInstall, STATUS, topbar, setStatus, notes, tabs, chips, seg, rowCreate, rowUpdate, rowSkeleton, placeSel, cardHTML, wireCard, growBars, sweepBars, cardSkeleton, emptyHTML, avatar, ownerOf, nameOf, demo, q };
})();
