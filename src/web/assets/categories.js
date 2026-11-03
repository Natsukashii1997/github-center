// 分类榜（#27，白雾定稿 design/candidates/redesign/cat.html：cat.js、pk2.js、all.js 落地，window.HV='c'、window.HD='a'）。
// 数据是服务端嵌进页面的三块（src/web/categories.js）：picks（精选标签和每个标签的卡、赞踩、能不能改）、hist（历史榜：Skill 安装量前 50）、hot（热点榜前 15）；
// 每个项目在详情栏要的内容在 projects / views（和收藏页同一套，详情栏用 bw.js 的 drawer）。
// 精选榜：聚光轮播 + B 说明书卡。切卡只改每张卡的位置变量，transform 过渡让卡片原地滑过去；换类别先收在中间再像发牌一样铺开。
// 赞踩、换卡、恢复都写进库（POST /api/picks/...），写成功才改页面；换卡和恢复只有所有者看得到入口，伙伴只能投票。
// 历史榜按类别真筛选（只留这一类，名次不变）；热点榜按原型不筛。顶栏搜索只过滤本页的历史榜和热点榜。
(() => {
  const { D, esc, num, wan, pad, view, drawer, act, syncStars, toast, noCopy } = BW;
  const $ = (id) => document.getElementById(id);
  // 类别色（同定稿原型 all.js、收藏页）；还没归类的用灰
  const CC = { 'Agent／MCP': '#0969da', Skill: '#8250df', 'AI 应用工具': '#bf3989', '开发者工具与基础设施': '#1a7f37', '开发框架与组件库': '#0f8f8a', '工作流自动化': '#bc4c00', '知识管理与办公效率': '#9a6700', '数据库与数据工具': '#3a43b8', 其他: '#8c959f' };
  const NONE = '还没归类';
  const cc = (c) => CC[c] ?? '#8c959f';
  const SN = { 'Agent／MCP': 'Agent / MCP', 'AI 应用工具': 'AI 应用', '开发者工具与基础设施': '开发者工具', '开发框架与组件库': '开发框架', '工作流自动化': '工作流', '知识管理与办公效率': '知识办公', '数据库与数据工具': '数据库' };
  const HOT = '#cf222e';
  const md = (day) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
  const P = (repo) => D.projects[repo];
  const img = (fullName, ownerId, s) => `<img class="av" src="${esc(ownerId ? `https://avatars.githubusercontent.com/u/${ownerId}?s=${s * 2}&v=4` : `https://github.com/${fullName.split('/')[0]}.png?size=${s * 2}`)}" width="${s}" height="${s}" alt="">`;
  const AV = (repo, s) => img(repo, P(repo)?.ownerId, s);
  // 行上的简介：一句话（补资料生成），还没生成就用 GitHub 上的描述
  const brief = (repo) => P(repo)?.line ?? P(repo)?.ghDesc ?? '';
  let q = '';
  const hay = (repo) => { const p = P(repo); return [repo, p.line, p.ghDesc, ...p.cats, p.tag, p.type, ...(p.use ?? []), ...(p.scene ?? [])].filter(Boolean).join(' ').toLowerCase(); };
  const hit = (repo) => !q || hay(repo).includes(q);

  // ── 报头：右侧三格点了平滑滚到对应的榜 ──
  function mast() {
    const H = D.hist?.entries.length ?? 0, T = D.hot?.entries.length ?? 0;
    const tk = [['pick', '精选榜', `${D.picks.tags.length} 类<small>每类最多 ${D.picks.slots} 张</small>`], ['hist', '历史榜', H ? `前 ${H}<small>Skill 安装量</small>` : '暂无数据'], ['hot', '热点榜', T ? `前 ${T}<small>讨论热度</small>` : '暂无数据']];
    $('mast').innerHTML = `<div><div class="kick"><span>精选 · 历史 · 热点</span></div><h1><span class="tt"><span class="ghost" aria-hidden="true">Boards</span><b>分类榜</b></span></h1></div>
      <div class="tick">${tk.map(([k, n, v]) => `<div data-go="${k}"><div class="k">${n}</div><div class="v">${v}</div></div>`).join('')}</div><div class="band"></div>`;
  }

  // ── 精选榜 ──
  const cf = { k: 0, i: 0 };
  const tag = () => D.picks.tags[cf.k];
  const center = (t) => Math.floor((t?.cards.length ?? 0) / 2);
  cf.i = center(tag());
  const vote = (c) => `<div class="vote"><button data-vote="1" aria-pressed="${c.mine === 1}" title="${c.mine === 1 ? '再点撤回' : '有用'}">▲ <b>${c.up}</b></button><button data-vote="-1" aria-pressed="${c.mine === -1}" title="${c.mine === -1 ? '再点撤回' : '没用'}">▼ <b>${c.down}</b></button></div>`;
  function card(c, i) {
    const p = P(c.repo), [owner, name] = c.repo.split('/'), d = i - cf.i, use = (p.use ?? []).slice(0, 3);
    const text = p.line ? `<p class="g2-ln">${esc(p.line)}</p>` : p.ghDesc ? `<p class="g2-ln gh"><small>中文简介还没生成 · GitHub 上的描述</small>${esc(p.ghDesc)}</p>` : '';
    return `<article class="gl g2" data-cfi="${i}" data-a="${Math.abs(d)}" style="--d:${d};--a:${Math.abs(d)}">
      <div class="g2-hd">${AV(c.repo, 38)}<div style="min-width:0"><h3>${esc(name)}</h3><span>${esc(owner)}${c.pinned ? ' · <i class="man">手动</i>' : ''}</span></div></div>
      ${text}
      ${use.length ? `<div class="g2-sec"><h5>能做什么</h5><ul>${use.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
      <div class="g2-sp"><div><span>类型</span><b>${esc(p.type ?? '—')}</b></div><div><span>总 Star</span><b>${c.total == null ? '—' : wan(c.total)}</b></div><div><span>Skill</span><b>${p.skills.length || '—'}</b></div></div>
      <div class="act only-on">${vote(c)}${D.picks.canEdit ? '<button class="ic" data-swap title="换卡">⇄</button>' : ''}</div></article>`;
  }
  const copyBtn = (c) => (c ? `<button class="lk" data-copy="${esc(c.repo)}"${noCopy(P(c.repo))}>复制安装指令</button>` : '');
  function drawPick() {
    const t = tag();
    if (!t) { $('sec-pick').innerHTML = '<div></div><div class="flow"><div class="empty"><b>还没有精选标签</b></div></div><div></div>'; return; }
    const cur = t.cards[cf.i];
    $('sec-pick').innerHTML = `<nav class="flt" aria-label="精选标签">${D.picks.tags.map((x, k) => `<button class="${k === cf.k ? 'on' : ''}" data-cfk="${k}" style="--c:${esc(x.color)}"${x.note ? ` title="${esc(x.note)}"` : ''}><i></i>${esc(x.name)}</button>`).join('')}</nav>
      <div class="flow" style="--c:${esc(t.color)}"><div class="fw" style="--k:${K}">${t.cards.map(card).join('')}</div>${t.cards.length ? '' : '<div class="empty"><b>这一类还没有卡</b>每天补完标签后按总 Star 补满。</div>'}</div>
      <div class="hint" style="--c:${esc(t.color)}"><span>← → 切换</span><div class="dots">${t.cards.map((_, i) => `<i class="${i === cf.i ? 'on' : ''}" data-cfi="${i}"></i>`).join('')}</div><span>每类最多 ${D.picks.slots} 张 · 默认按总 Star${t.manual ? ` · 手动换了 ${t.manual} 张` : ''}</span>${copyBtn(cur)}</div>`;
    fit();
  }
  // 放大倍数：在 1 倍时量一次卡片铺开的总宽和卡高，按窗口宽度和轮播区高度算；最小 1 倍、最大 1.15 倍
  let K = 1, span = 0, ch = 0;
  function fit() {
    const fw = document.querySelector('.fw');
    if (!fw?.children.length) return;
    if (!span) {
      fw.style.setProperty('--k', 1);
      const box = fw.getBoundingClientRect(), mid = box.left + box.width / 2, rs = [...fw.children].map((e) => e.getBoundingClientRect());
      span = 2 * Math.max(...rs.map((r) => Math.max(mid - r.left, r.right - mid)));
      ch = Math.max(...rs.map((r) => r.height));
    }
    K = Math.max(1, Math.min(1.15, (innerWidth - 32) / span, (fw.parentNode.clientHeight - 24) / ch));
    fw.style.setProperty('--k', K.toFixed(3));
  }
  addEventListener('resize', () => { fit(); fitRows(); });
  // 切卡：只改每张卡的位置变量，不重画
  function move(i) {
    const t = tag();
    cf.i = i;
    document.querySelectorAll('.fw > article').forEach((el, j) => { const d = j - i; el.dataset.a = Math.abs(d); el.style.setProperty('--d', d); el.style.setProperty('--a', Math.abs(d)); });
    document.querySelectorAll('.dots i').forEach((el, j) => el.classList.toggle('on', j === i));
    const old = document.querySelector('.hint [data-copy]');
    if (old) old.outerHTML = copyBtn(t.cards[i]);
  }
  // 换类别：先把卡收在中间、压到后面，下一帧再铺开
  function deal() {
    const els = [...document.querySelectorAll('.fw > article')];
    els.forEach((el) => { el.style.transition = 'none'; el.dataset.a = 3; el.style.setProperty('--d', 0); el.style.setProperty('--a', 3); });
    document.querySelector('.fw')?.offsetWidth;
    els.forEach((el) => (el.style.transition = ''));
    move(cf.i);
  }

  // 写库：表单提交到 /api/picks/<操作>，失败时提示服务端给的原因
  async function api(op, fields) {
    let r;
    try { r = await fetch(`/api/picks/${op}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) }); } catch { toast('网络出错，请稍后再试'); return null; }
    const body = await r.json().catch(() => ({}));
    if (!r.ok) { toast(body.error ?? '没能保存，请稍后再试'); return null; }
    return body;
  }
  // 换卡、恢复之后：用服务端给的新名单和项目内容重画轮播，停在原来那一类、原来的位置
  function apply(res) {
    const id = tag()?.id;
    D.picks = res.picks;
    Object.assign(D.projects, res.projects);
    Object.assign(D.views, res.views);
    cf.k = Math.max(0, D.picks.tags.findIndex((t) => t.id === id));
    cf.i = Math.min(cf.i, Math.max(0, tag().cards.length - 1));
    mast();
    drawPick();
    syncStars();
  }
  let voting = false;
  async function doVote(btn) {
    const t = tag(), c = t.cards[cf.i], v = Number(btn.dataset.vote);
    if (voting) return;
    voting = true;
    const res = await api('vote', { tag: t.id, project: c.projectId, value: c.mine === v ? 0 : v });
    voting = false;
    if (!res) return;
    Object.assign(c, res);
    btn.closest('.vote').outerHTML = vote(c);
  }

  // 换卡面板：候选是不在这一类的项目，按总 Star；可搜仓库名或粘贴 GitHub 地址
  let sw = null, timer;
  function panel() {
    if (!sw) { $('swhost').innerHTML = ''; return; }
    const t = tag(), c = t.cards[sw.i];
    $('swhost').innerHTML = `<div class="sw-mask" data-swclose></div><div class="sw" role="dialog" aria-label="换卡"><div class="sw-h"><b>换掉「${esc(c.repo.split('/')[1])}」</b><span>放进「${esc(t.name)}」的第 ${c.slot} 张</span><button data-swclose aria-label="关闭">✕</button></div>
      <label class="search sw-q"><span>⌕</span><input data-swq placeholder="搜仓库名，或粘贴 GitHub 地址" aria-label="搜仓库名，或粘贴 GitHub 地址"></label>
      <div class="sw-l" id="swl"></div>
      <div class="sw-f"><button class="btn sm" data-reset>恢复成按星数前 ${D.picks.slots}</button></div></div>`;
    list();
    $('swhost').querySelector('[data-swq]').focus();
  }
  function list() {
    const el = $('swl');
    if (!el) return;
    if (!sw.items) { el.innerHTML = '<p>正在找候选…</p>'; return; }
    const note = sw.already ? `<p>「${esc(sw.already)}」已经在这一类里了。</p>` : sw.missing ? `<p>本地数据里还没有「${esc(sw.missing)}」。<button class="btn sm sw-look" data-lookup${sw.looking ? ' disabled' : ''}>${sw.looking ? '正在查…' : '联网查 GitHub'}</button></p>` : '';
    el.innerHTML = note + (sw.items.length ? sw.items.map((x) => `<button data-pick="${x.projectId}"${x.inTags >= 2 ? ' disabled title="已经在 2 个标签里了，换不进来"' : ''}>${img(x.fullName, x.ownerId, 22)}<b>${esc(x.fullName.split('/')[1])}</b><span>${esc(x.line ?? x.description ?? x.fullName)}</span><em>${x.total == null ? '—' : `★ ${wan(x.total)}`}</em></button>`).join('') : note ? '' : '<p>没有符合条件的项目。</p>');
  }
  async function search(text) {
    const seq = (sw.seq = (sw.seq ?? 0) + 1);
    const res = await api('candidates', { tag: tag().id, q: text });
    if (!sw || seq !== sw.seq || !res) return;
    Object.assign(sw, { items: res.items, missing: res.missing, already: res.already, looking: sw.looking && res.missing === sw.missing });
    list();
  }
  // 粘贴的地址本地没有：联网查一次这个仓库，查到就作为唯一的候选
  async function doLookup() {
    const q = sw.missing;
    sw.looking = true;
    list();
    const res = await api('lookup', { tag: tag().id, q });
    if (!sw || sw.missing !== q) return;
    sw.looking = false;
    if (res) Object.assign(sw, { items: res.item ? [res.item] : [], missing: null, already: res.already ?? null });
    list();
  }
  function openSwap() {
    sw = { i: cf.i, items: null };
    panel();
    search('');
  }
  const closeSwap = () => { sw = null; panel(); };
  async function doSwap(id) {
    const t = tag(), c = t.cards[sw.i], x = sw.items.find((it) => it.projectId === id);
    const res = await api('swap', { tag: t.id, slot: c.slot, project: id });
    if (!res) return;
    closeSwap();
    apply(res);
    toast(`已把「${c.repo}」换成「${x?.fullName ?? ''}」`);
  }
  async function doReset() {
    const t = tag();
    const res = await api('restore', { tag: t.id });
    if (!res) return;
    closeSwap();
    apply(res);
    toast(`「${t.name}」已恢复成按星数前 ${D.picks.slots}`);
  }

  // ── 历史榜（横条）和热点榜（C 走势线）：A 报头式栏头，两栏栏头和副行定高 ──
  const H = D.hist?.entries ?? [], MAX = H[0]?.installs || 1;
  const catOf = (x) => x.cat ?? NONE;
  const CATS = [...Object.keys(CC), NONE].map((c) => [c, H.filter((x) => catOf(x) === c).length]).filter(([, n]) => n);
  let ON = '';
  const stale = (b) => (b?.failure ? `<span class="bad" title="${esc(b.failure.error)}">更新失败 · ${b.day ? `显示 ${md(b.day)} 数据` : '还没有数据'}</span> · ` : '');
  const chips = () => [['', H.length], ...CATS].map(([c, n]) => `<button class="${ON === c ? 'on' : ''}" data-hcat="${esc(c)}" style="--c:${c ? cc(c) : '#1f2328'}">${c ? '<i></i>' : ''}${esc(c ? SN[c] ?? c : '全部')}<b>${n}</b></button>`).join('');
  const histTop = () => `<header class="ch"><div><span class="kk">ALL-TIME · 前 ${H.length}</span><h3>历史榜</h3></div><span class="nt"${D.hist?.note ? ` title="${esc(D.hist.note)}"` : ''}>${stale(D.hist)}按 Skill 安装量排</span></header><div class="sub chips">${chips()}</div>`;
  function histRows() {
    if (!D.hist?.entries.length) return '<div class="none"><b>还没有历史榜数据</b>每天抓一次 skills.sh 全时段排行榜。</div>';
    const shown = H.filter((x) => (!ON || catOf(x) === ON) && ((x.repo && hit(x.repo)) || !q || `${x.skill} ${x.source}`.toLowerCase().includes(q)));
    if (!shown.length) return '<div class="none"><b>没有符合条件的 Skill</b></div>';
    // 每行一个来源：安装量最高的 Skill 名（同一来源有几个时注明「等 N 个」）、来源、累计安装量。在 GitHub 上的点了打开所在仓库的详情栏；网址来源的点了去 skills.sh。
    return `<div class="ls">${shown.map((x) => {
      const bar = `<span class="n">${x.rank}</span><div class="hb-bar"><i></i>${x.repo ? AV(x.repo, 20) : `<span class="av ph">${esc(x.source[0].toUpperCase())}</span>`}<b>${esc(x.skill)}</b>${x.count > 1 ? `<small class="cnt">等 ${x.count} 个</small>` : ''}${x.mirrors ? `<small class="cnt" title="同一套 Skill 还放在另外 ${x.mirrors} 个来源">另有 ${x.mirrors} 个来源</small>` : ''}<span>${esc(x.source)}</span><em>${num(x.installs)}</em></div>`;
      const style = `--c:${cc(x.cat)};--p:${(x.installs / MAX * 100).toFixed(2)}%`;
      return x.repo
        ? `<div class="hb-r" data-open="${esc(x.repo)}" data-from="hist" style="${style}" title="${esc(brief(x.repo))}">${bar}</div>`
        : `<a class="hb-r" href="${esc(x.url)}" target="_blank" rel="noopener" style="${style}" title="在 skills.sh 上看">${bar}</a>`;
    }).join('')}</div>`;
  }
  // 近 7 天热度小折线：纵轴从零起；那天没记就断开（不补零），末点画圆点
  function spark(series) {
    const mx = Math.max(1, ...series.filter((v) => v != null));
    const xy = series.map((v, i) => (v == null ? null : [i * 20, 26 - (v / mx) * 22]));
    const runs = [];
    xy.forEach((p, i) => { if (!p) return; if (!xy[i - 1]) runs.push([]); runs.at(-1).push(p); });
    const line = runs.map((r) => r.map(([a, b], i) => `${i ? 'L' : 'M'}${a},${b.toFixed(1)}`).join('')).join('');
    const area = runs.filter((r) => r.length > 1).map((r) => `${r.map(([a, b], i) => `${i ? 'L' : 'M'}${a},${b.toFixed(1)}`).join('')}L${r.at(-1)[0]},28L${r[0][0]},28Z`).join('');
    const last = xy.at(-1);
    return `<svg viewBox="-3 0 126 30" width="124" height="30" aria-hidden="true">${area ? `<path d="${area}" fill="rgba(207,34,46,.08)"/>` : ''}<path d="${line}" fill="none" stroke="${HOT}" stroke-width="1.6" stroke-linejoin="round"/>${last ? `<circle cx="${last[0]}" cy="${last[1].toFixed(1)}" r="2.6" fill="${HOT}"/>` : ''}</svg>`;
  }
  const change = (c) => (!c ? '<small class="dn" title="前一天没有记录">—</small>' : c.ratio == null ? (c.delta > 0 ? '<small class="up" title="前一天热度是 0">↑ 新</small>' : '<small class="dn">—</small>') : `<small class="${c.ratio >= 0 ? 'up' : 'dn'}">${c.ratio >= 0 ? '↑' : '↓'} ${Math.abs(Math.round(c.ratio * 100))}%</small>`);
  // 悬停说明：各来源的热度（点赞 + 评论）和帖子数
  const srcTip = (x) => `${brief(x.repo)}\n${Object.entries(x.sources).filter(([, v]) => v > 0).map(([s, v]) => `${D.hot.sources[s]?.name ?? s} ${num(v)}`).join(' · ')} · ${x.posts} 个帖子`;
  const short = () => (D.hot && !D.hot.complete ? `<span class="short">记录不满 7 天（已记 ${D.hot.days} 天）</span>` : '');
  const hotTop = () => `<header class="ch"><div><span class="kk">TRENDING · 前 ${D.hot?.entries.length ?? 15}</span><h3>热点榜</h3></div><span class="nt"${D.hot ? ` title="${esc(Object.values(D.hot.sources).map((s) => `${s.name}：${s.status === 'ok' ? '已抓到' : s.status === 'off' ? '设置页里关掉了，沿用上次的帖子' : '这次没抓到，沿用上次的帖子'}`).join('；'))}"` : ''}>${stale(D.hot)}按讨论热度排 · 近 7 天</span></header>
    <div class="sub"><span class="key"><svg viewBox="0 0 34 12" width="34" height="12" aria-hidden="true"><path d="M1,9L7,8L13,9L19,6L25,7L33,2" fill="none" stroke="${HOT}" stroke-width="1.5"/><circle cx="33" cy="2" r="1.8" fill="${HOT}"/></svg>近 7 天热度走势</span><span class="key"><b class="up">↑</b> 比昨天</span>${short()}</div>`;
  function hotRows() {
    if (!D.hot?.entries.length) return '<div class="none"><b>还没有热点榜数据</b>每天从 Hacker News、V2EX 找指向 GitHub 仓库的帖子，按点赞加评论算热度。</div>';
    const shown = D.hot.entries.filter((x) => hit(x.repo));
    if (!shown.length) return '<div class="none"><b>没有符合条件的项目</b></div>';
    return `<div class="ls">${shown.map((x) => `<div class="tc-r" data-open="${esc(x.repo)}" data-from="hot" title="${esc(srcTip(x))}"><span class="n">${x.rank}</span>${AV(x.repo, 26)}<div class="m"><b>${esc(x.repo.split('/')[1])}</b><p>${esc(brief(x.repo))}</p></div>
      ${spark(x.series)}<div class="h"><b>${num(x.heat)}</b>${change(x.change)}</div></div>`).join('')}</div>`;
  }
  function drawDuo() {
    $('duo').innerHTML = `<section class="col" id="sec-hist"><div class="top" id="hist-top">${histTop()}</div><div class="scroll">${histRows()}</div></section>
      <section class="col" id="sec-hot"><div class="top">${hotTop()}</div><div class="scroll">${hotRows()}</div></section>`;
    fitRows();
  }
  // 筛类别只重画胶囊和列表，回到列表顶部；栏外的滚动位置不动
  function redrawHist() {
    const chipsEl = document.querySelector('#hist-top .chips'), x = chipsEl.scrollLeft;
    chipsEl.innerHTML = chips();
    chipsEl.scrollLeft = x;
    const sc = document.querySelector('#sec-hist .scroll');
    sc.innerHTML = histRows();
    sc.scrollTop = 0;
    mark();
  }
  // 行高按栏内可见高度算，正好放下 20 行
  function fitRows() {
    const sc = document.querySelector('#sec-hist .scroll');
    if (sc) sc.style.setProperty('--rh', `${(sc.clientHeight - 14) / 20}px`);
  }

  // ── 详情栏：点任一项目在本页右侧打开（bw.js 的 drawer，同首页、收藏页）；↑↓ 按它所在的那个榜换项目 ──
  let sel = null, from = null;
  const host = $('drawer');
  const mark = () => document.querySelectorAll('[data-from]').forEach((n) => n.classList.toggle('is-sel', n.dataset.from === from && n.dataset.open === sel));
  const labelOf = (repo, src) => {
    if (src === 'pick') return `精选榜 · ${tag().name}`;
    const x = (src === 'hist' ? H : D.hot.entries).find((e) => e.repo === repo);
    return `${src === 'hist' ? '历史榜' : '热点榜'} · No.${pad(x.rank)}`;
  };
  function open(repo, src) {
    const v = D.views[repo] ?? {}, it = view(repo, v.run);
    if (it.total == null) it.total = v.total ?? null;
    host.innerHTML = drawer(it, { w: v.win, home: true });
    host.querySelector('.dw-top > span').textContent = labelOf(repo, src);
    syncStars(host);
    host.querySelector('.dw-body').scrollTop = 0;
    sel = repo;
    from = src;
    document.body.classList.add('drawer-open');
    mark();
  }
  function close() {
    sel = from = null;
    document.body.classList.remove('drawer-open');
    mark();
  }
  const order = () => (from === 'pick' ? tag().cards.map((c) => c.repo) : [...document.querySelectorAll(`[data-from="${from}"]`)].map((n) => n.dataset.open));

  document.addEventListener('click', (ev) => {
    if (act(ev)) return;
    const t = ev.target.closest('[data-go],[data-cfk],[data-cfi],[data-vote],[data-swap],[data-swclose],[data-pick],[data-lookup],[data-reset],[data-hcat],[data-close],[data-open]');
    if (!t) return;
    const d = t.dataset;
    if (d.go) return $(`sec-${d.go}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (d.cfk) { cf.k = Number(d.cfk); cf.i = center(tag()); if (from === 'pick') close(); drawPick(); deal(); return; }
    if (d.vote) return doVote(t);
    if ('swap' in d) return openSwap();
    if ('swclose' in d) return closeSwap();
    if (d.pick) return doSwap(Number(d.pick));
    if ('lookup' in d) return doLookup();
    if ('reset' in d) return doReset();
    if (d.cfi) {
      const i = Number(d.cfi);
      if (i !== cf.i || t.tagName === 'I') return move(i);
      // 点中间那张：打开详情栏，再点关掉
      const repo = tag().cards[i].repo;
      return sel === repo && from === 'pick' ? close() : open(repo, 'pick');
    }
    if ('hcat' in d) { ON = d.hcat; if (from === 'hist' && !H.some((x) => x.repo === sel && (!ON || catOf(x) === ON))) close(); return redrawHist(); }
    if ('close' in d) return close();
    if (d.open) return sel === d.open && from === d.from ? close() : open(d.open, d.from);
  });
  document.addEventListener('input', (ev) => {
    if (ev.target.matches('[data-swq]')) { clearTimeout(timer); const v = ev.target.value; timer = setTimeout(() => search(v), 200); return; }
    if (!ev.target.matches('[data-q]')) return;
    q = ev.target.value.trim().toLowerCase();
    document.querySelector('#sec-hist .scroll').innerHTML = histRows();
    document.querySelector('#sec-hot .scroll').innerHTML = hotRows();
    if (from && from !== 'pick' && !hit(sel)) close();
    mark();
  });
  // 键盘：/ 聚焦搜索，输入框里 Esc 失焦；Esc 先关换卡面板，再关详情栏；← → 切精选卡；详情栏开着时 ↑↓（也认 j/k）按所在的榜换项目
  document.addEventListener('keydown', (ev) => {
    if (ev.target.matches?.('input, select')) { if (ev.key === 'Escape') (sw && ev.target.matches('[data-swq]') ? closeSwap() : ev.target.blur()); return; }
    if (ev.key === 'Escape') return sw ? closeSwap() : close();
    if (sw) return;
    if (ev.key === '/') { ev.preventDefault(); document.querySelector('[data-q]')?.focus(); return; }
    if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
      const n = cf.i + (ev.key === 'ArrowRight' ? 1 : -1);
      if (tag() && n >= 0 && n < tag().cards.length) { move(n); if (from === 'pick') open(tag().cards[n].repo, 'pick'); }
      return;
    }
    if (!sel || !['ArrowDown', 'ArrowUp', 'j', 'k'].includes(ev.key)) return;
    ev.preventDefault();
    const list = order(), next = list[list.indexOf(sel) + (ev.key === 'ArrowDown' || ev.key === 'j' ? 1 : -1)];
    if (!next) return;
    if (from === 'pick') move(list.indexOf(next));
    open(next, from);
    document.querySelector(`[data-from="${from}"][data-open="${CSS.escape(next)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });

  mast();
  drawPick();
  drawDuo();
  syncStars();
})();
