// 我的收藏（#22，白雾定稿 design/candidates/redesign/fav.html：C 收藏架、A 书签丝带卡片、A 侧栏只留类别目录）。
// 候选（#78，所有者 2026-11-08 选定批次 A 原型的 A 版收藏页）：每张卡就地显示决策状态、收藏理由、下一步；按状态筛选；
// 已采用、不采用的默认折叠在各组末尾；点卡上的状态胶囊弹出改状态、理由、下一步，改了就存（弹层和保存在 ho.js，各页共用）。
// 交接（#79）：卡片上「交给 AI ▾」直接复制研究／试用／安装交接；筛选栏「勾选对比」后勾 2–4 张卡，底部生成定向对比交接。
// 数据是服务端嵌进页面的这个人的收藏（src/web/pages.js 的 favoritesData）：items 新的在前，每条带分组 shelf 和决策字段；shelves 是排好序的组。
// 丝带就是「已收藏」：点它取消（真写进账号，走 bw.js 的收藏），丝带变灰缩短、卡片变淡；再点恢复（恢复后是一条新收藏，决策回到默认）。
// 点卡片在本页右侧打开这个项目的详情栏（bw.js 的 drawer，和首页、项目页同一份内容），顶行换成这条收藏的状态；Skill 卡打开后滚到那一条。顶栏搜索只过滤本页。
(() => {
  const { D, esc, view, drawer, act, syncStars, noCopy } = BW;
  const { ST, ST_ORDER } = HO;
  // 类别色（同定稿原型）：丝带取项目的第一个分类，Skill 收藏也取所属项目的；还没归类的用灰。
  const CC = { 'Agent／MCP': '#0969da', Skill: '#8250df', 'AI 应用工具': '#bf3989', '开发者工具与基础设施': '#1a7f37', '开发框架与组件库': '#0f8f8a', '工作流自动化': '#bc4c00', '知识管理与办公效率': '#9a6700', '数据库与数据工具': '#3a43b8', 其他: '#8c959f' };
  const GONE = '这个 Skill 已经不在仓库里了，可能被改名或删掉。';
  const decided = (x) => x.status === 'yes' || x.status === 'no';
  const $ = (id) => document.getElementById(id);
  // 收藏时间写北京时间 M/D
  const md = (iso) => { const d = new Date(Date.parse(iso) + 8 * 3600e3); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`; };
  // 每条的键和 ho.js 一样是"项目 id#Skill 路径"；决策字段以 ho.js 的为准（改了会发 ho:change）。
  const items = D.items.map((x) => ({ ...x, p: D.projects[x.repo], key: `${x.id}#${x.skill?.path ?? ''}` }));
  const byKey = (k) => items.find((x) => x.key === k);
  let q = '', filter = 'all', sel = null, selKey = null, picking = false, need = '';
  const unfold = new Set(), picks = new Set();

  // 报头：项目和 Skill 各几个、待研究几个（只读）
  function mast() {
    const nP = items.filter((x) => !x.skill).length;
    $('mast').innerHTML = `<div><div class="kick"><span>个人收藏 · 本地储存</span></div><h1><span class="tt"><span class="ghost" aria-hidden="true">Clippings</span><b>收藏</b></span></h1></div>
    <div class="tick">${[['项目', nP, '个'], ['Skill', items.length - nP, '个'], ['待研究', items.filter((x) => x.status === 'res').length, '个']].map(([k, v, u]) => `<div><div class="k">${k}</div><div class="v">${v}<small>${u}</small></div></div>`).join('')}</div><div class="band"></div>`;
  }

  const avatar = (p) => (p.ownerId ? `https://avatars.githubusercontent.com/u/${p.ownerId}?s=64&v=4` : `https://github.com/${p.repo.split('/')[0]}.png?size=64`);
  const pickBox = (x) => (picking ? `<label class="f-pk" title="勾选做对比"><input type="checkbox" data-pick="${esc(x.key)}" ${picks.has(x.key) ? 'checked' : ''} aria-label="勾选 ${esc(x.skill ? x.skill.name : x.repo)} 做对比"></label>` : '');
  function card(x) {
    const [owner, name] = x.repo.split('/'), gone = Boolean(x.skill?.missing);
    const skillAttr = x.skill ? ` data-skill="${esc(x.skill.path)}"` : '';
    const copy = gone ? '<button class="lnk" disabled>装不了</button>' : HO.quick(x.p, { skill: x.skill?.path ?? '', disabled: noCopy(x.p) });
    return `<article class="tile${x.repo === sel ? ' is-sel' : ''}${decided(x) ? ' decided' : ''}${picks.has(x.key) ? ' picked' : ''}" data-open="${esc(x.repo)}" data-key="${esc(x.key)}"${x.skill ? ` data-to="${esc(x.skill.path)}"` : ''}${gone ? ' data-gone' : ''} style="--c:${CC[x.cat] ?? CC.其他}">
      <button class="rib" data-star="${esc(x.repo)}"${skillAttr} title="点丝带取消收藏，再点恢复"></button>${pickBox(x)}
      <div class="fh"><img class="av" src="${esc(avatar(x.p))}" width="32" height="32" alt=""><div class="m"><b>${esc(x.skill ? x.skill.name : name)}</b><span class="fr">${x.skill ? `来自 ${esc(x.repo)}` : esc(owner)}</span></div></div>
      <p>${esc(gone ? GONE : x.line ?? '')}</p>
      ${HO.lines(x)}
      <div class="ttg">${x.skill ? '<span class="kt sk">Skill</span>' : '<span class="kt pj">项目</span>'}${HO.chip(x.key)}${gone ? '<span class="kt gone">已不在仓库</span>' : ''}</div>
      <div class="tf"><span>收藏于 ${md(x.at)}${x.handoff ? ` · ${HO.handoffNote(x)}` : ''}</span>${copy}</div></article>`;
  }
  // 一组末尾的「已决定」：默认收成一张，点开后整组展开，末尾留「收起」。
  function pile(name, done) {
    if (!done.length) return '';
    if (unfold.has(name)) return done.map(card).join('') + `<button class="f-pile sm" data-fold="${esc(name)}">收起已决定 ▴</button>`;
    return `<button class="f-pile" data-fold="${esc(name)}"><span class="faces">${done.slice(0, 4).map((x) => `<img src="${esc(avatar(x.p))}" alt="">`).join('')}</span><b>已决定 ${done.length} 个</b><span>${[...new Set(done.map((x) => ST[x.status]))].join('、')} · 展开 ▾</span></button>`;
  }

  // 搜索：项目名、作者、Skill 名、一句话或 Skill 说明、分类、说明标签、定义标签、主要用途、使用场景、收藏理由、下一步
  const hay = (x) => [x.repo, x.skill?.name, x.line, x.shelf, ...x.p.cats, x.p.tag, x.p.type, ...(x.p.use ?? []), ...(x.p.scene ?? []), x.reason, x.next].filter(Boolean).join(' ').toLowerCase();
  function filterBar() {
    const n = (s) => items.filter((x) => s === 'all' || x.status === s).length;
    return `<div class="f-filter"><div class="segs" role="tablist" aria-label="按决策状态筛选">${['all', ...ST_ORDER].map((s) => `<button role="tab" data-filter="${s}" aria-selected="${filter === s}">${s === 'all' ? '全部' : ST[s]}<b>${n(s)}</b></button>`).join('')}</div>
      <button class="btn f-pmode" data-picking aria-pressed="${picking}">${picking ? '退出勾选' : '勾选对比'}</button></div>`;
  }
  // 定向对比（PRD P0-05）：勾 2–4 张卡，围绕"我的需求"生成对比研究交接；条固定在页面底部。
  function cmpBar() {
    const n = picks.size;
    if (!picking) return '';
    if (!n) return '<div class="f-cmp"><span>勾选 2–4 张卡片，可以生成一段围绕你需求的对比研究交接。</span><button class="btn" data-picking>退出</button></div>';
    return `<div class="f-cmp" role="region" aria-label="对比研究"><b>已选 ${n} 个</b>${n < 2 ? '<span class="dim">再选 1 个就能对比</span>' : n > 4 ? '<span class="warn">最多 4 个</span>' : ''}
      <input id="f-need" class="f-in" maxlength="500" placeholder="我的需求，例：多 Agent 跨会话交接要可恢复" value="${esc(need)}" aria-label="我的需求">
      <button class="btn pri" data-cmp ${n < 2 || n > 4 ? 'disabled' : ''}>复制对比研究交接</button><button class="btn" data-clearpicks>清空</button></div>`;
  }
  function render() {
    mast();
    const shown = items.filter((x) => (filter === 'all' || x.status === filter) && (!q || hay(x).includes(q)));
    const groups = D.shelves.map((s) => [s.name, shown.filter((x) => x.shelf === s.name)]).filter(([, xs]) => xs.length);
    // 只看已采用或不采用时不再折叠，直接列出。
    const shelf = ([g, xs], i) => {
      const fold = filter === 'all';
      const live = fold ? xs.filter((x) => !decided(x)) : xs, done = fold ? xs.filter(decided) : [];
      return `<section class="shelf" id="g-${i}"><h3>${esc(g)}<small>${xs.length}</small></h3><div class="shrow">${live.map(card).join('')}${pile(g, done)}</div></section>`;
    };
    $('shelf').innerHTML = !items.length ? '<div class="empty"><b>还没有收藏</b>在涨星榜或项目详情里点 ☆，收藏项目或单个 Skill，就会收在这里。<p><a class="btn" href="/stars">去看涨星榜</a></p></div>'
      : `${filterBar()}${!shown.length ? `<div class="empty"><b>没有符合条件的收藏</b>${q ? '换个关键词试试。' : '这个状态下还没有收藏。'}</div>`
        : `<div class="fcx"><aside class="idx" aria-label="类别"><span class="ih">类别</span><a href="#" data-jump="">全部<b>${shown.length}</b></a>${groups.map(([g, xs], i) => `<a href="#g-${i}" data-jump="${i}">${esc(g)}<b>${xs.length}</b></a>`).join('')}</aside>
          <div class="shelves">${groups.map(shelf).join('')}</div></div>`}${cmpBar()}`;
    syncStars($('shelf'));
    spy();
    if (sel && !shown.some((x) => x.repo === sel)) close();
  }

  // 目录：点了平滑跳到那一组（全部回到页顶）；滚动时高亮当前所在的组（组的顶边过了顶栏下方就算当前）
  function spy() {
    let cur = '';
    document.querySelectorAll('.shelf').forEach((sh) => { if (sh.getBoundingClientRect().top < 140) cur = sh.id.slice(2); });
    document.querySelectorAll('.idx [data-jump]').forEach((a) => a.classList.toggle('on', a.dataset.jump === cur));
  }
  addEventListener('scroll', spy, { passive: true });
  const jump = (i) => (i === '' ? scrollTo({ top: 0, behavior: 'smooth' }) : $(`g-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));

  // 卡片和详情栏顶行跟着这条收藏的最新字段重画。
  function refresh(x) {
    render();
    if (selKey === x.key) decorate();
  }

  // 详情栏：卡片数字取服务端给的那次运行；不在涨星榜上时总 Star 另给。顶行换成这条收藏的状态胶囊；一句话下面的只读理由由 bw.js 按 decKey 画。
  const mark = () => document.querySelectorAll('.tile').forEach((n) => n.classList.toggle('is-sel', n.dataset.open === sel));
  function close() {
    sel = null;
    selKey = null;
    HO.closePop();
    document.body.classList.remove('drawer-open');
    mark();
  }
  function decorate() {
    const x = byKey(selKey), top = $('drawer').querySelector('.dw-top > span');
    if (x && top) top.innerHTML = `收藏于 ${md(x.at)}${x.skill ? ` · Skill ${esc(x.skill.name)}` : ''} ${HO.chip(x.key)}`;
  }
  function open(repo, skill, key) {
    const v = D.views[repo], it = view(repo, v.run), host = $('drawer');
    if (it.total == null) it.total = v.total;
    sel = repo;
    selKey = key ?? `${it.id}#${skill ?? ''}`;
    if (!byKey(selKey)) selKey = items.find((x) => x.repo === repo)?.key ?? null;
    host.innerHTML = drawer(it, { w: v.win, ranks: v.ranks, home: true, decKey: selKey ?? undefined });
    decorate();
    syncStars(host);
    const body = host.querySelector('.dw-body'), hit = skill && document.getElementById(`skill-${skill}`);
    body.scrollTop = 0;
    if (hit) { hit.classList.add('hit'); body.scrollTop = hit.getBoundingClientRect().top - body.getBoundingClientRect().top - body.clientHeight / 3; }
    document.body.classList.add('drawer-open');
    mark();
  }

  document.addEventListener('click', (ev) => {
    if (act(ev)) return;
    const t = ev.target.closest('[data-jump],[data-close],[data-open],[data-filter],[data-fold],[data-picking],[data-clearpicks],[data-cmp],.f-pk,.f-cmp');
    if (!t) return;
    if ('picking' in t.dataset) { picking = !picking; picks.clear(); if (picking) close(); return render(); }
    if ('clearpicks' in t.dataset) { picks.clear(); return render(); }
    if ('cmp' in t.dataset) return HO.compare([...picks].map(byKey).map((x) => ({ p: x.p, skill: x.skill?.path ?? '' })), need, t);
    if (t.matches('.f-pk, .f-cmp')) return;
    // 勾选模式里点整张卡就是勾选或取消，不打开详情栏。
    if (picking && t.dataset.key) { picks.has(t.dataset.key) ? picks.delete(t.dataset.key) : picks.add(t.dataset.key); return render(); }
    if ('filter' in t.dataset) { filter = t.dataset.filter; return render(); }
    if ('fold' in t.dataset) { unfold.has(t.dataset.fold) ? unfold.delete(t.dataset.fold) : unfold.add(t.dataset.fold); return render(); }
    if ('jump' in t.dataset) { ev.preventDefault(); return jump(t.dataset.jump); }
    if ('close' in t.dataset) return close();
    if (sel === t.dataset.open && !t.dataset.to && selKey === t.dataset.key) return close();
    open(t.dataset.open, t.dataset.to, t.dataset.key);
  });
  document.addEventListener('input', (ev) => {
    if (ev.target.matches('[data-q]')) { q = ev.target.value.trim().toLowerCase(); render(); }
    if (ev.target.id === 'f-need') need = ev.target.value;
  });
  document.addEventListener('change', (ev) => {
    const k = ev.target.dataset?.pick;
    if (!k) return;
    ev.target.checked ? picks.add(k) : picks.delete(k);
    render();
  });
  // 决策变了（改状态、记了交接、取消后又收藏）：这一条的字段跟着改，重画。
  document.addEventListener('ho:change', (ev) => {
    const x = byKey(ev.detail.key), d = HO.dec(ev.detail.key);
    if (!x || !d) return;
    Object.assign(x, d);
    refresh(x);
  });
  // 键盘：/ 聚焦搜索，输入框里 Esc 失焦；Esc 关详情栏（弹层、编辑面板先由 ho.js 关）；详情栏开着时 ↑↓（也认 j/k）按本页卡片顺序换项目
  document.addEventListener('keydown', (ev) => {
    if (ev.target.matches?.('input, select, textarea')) { if (ev.key === 'Escape') ev.target.blur(); return; }
    if (ev.key === '/') { ev.preventDefault(); document.querySelector('[data-q]')?.focus(); return; }
    if (ev.key === 'Escape') return close();
    if (!sel || !['ArrowDown', 'ArrowUp', 'j', 'k'].includes(ev.key)) return;
    ev.preventDefault();
    const order = [...new Set([...document.querySelectorAll('.tile')].map((n) => n.dataset.open))];
    const next = order[order.indexOf(sel) + (ev.key === 'ArrowDown' || ev.key === 'j' ? 1 : -1)];
    if (!next) return;
    open(next);
    document.querySelector(`.tile[data-open="${CSS.escape(next)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
  render();
})();
