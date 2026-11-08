// 我的收藏（#22，白雾定稿 design/candidates/redesign/fav.html：C 收藏架、A 书签丝带卡片、A 侧栏只留类别目录）。
// 候选（#78，所有者 2026-11-08 选定批次 A 原型的 A 版收藏页）：每张卡就地显示决策状态、收藏理由、下一步；按状态筛选；
// 已采用、不采用的默认折叠在各组末尾；点卡上的状态胶囊弹出改状态、理由、下一步，改了就存（POST /api/favorites action=update）。
// 数据是服务端嵌进页面的这个人的收藏（src/web/pages.js 的 favoritesData）：items 新的在前，每条带分组 shelf 和决策字段；shelves 是排好序的组。
// 丝带就是「已收藏」：点它取消（真写进账号，走 bw.js 的收藏），丝带变灰缩短、卡片变淡；再点恢复。复制安装指令同样走 bw.js，已收藏的会记最近交接。
// 点卡片在本页右侧打开这个项目的详情栏（bw.js 的 drawer，和首页、项目页同一份内容），顶部换成这条收藏的状态和只读的理由、下一步；Skill 卡打开后滚到那一条。顶栏搜索只过滤本页。
(() => {
  const { D, esc, view, drawer, act, syncStars, noCopy, toast } = BW;
  // 类别色（同定稿原型）：丝带取项目的第一个分类，Skill 收藏也取所属项目的；还没归类的用灰。
  const CC = { 'Agent／MCP': '#0969da', Skill: '#8250df', 'AI 应用工具': '#bf3989', '开发者工具与基础设施': '#1a7f37', '开发框架与组件库': '#0f8f8a', '工作流自动化': '#bc4c00', '知识管理与办公效率': '#9a6700', '数据库与数据工具': '#3a43b8', 其他: '#8c959f' };
  const GONE = '这个 Skill 已经不在仓库里了，可能被改名或删掉。';
  // 决策状态（PRD P0-04）：筛选和弹层都按这个顺序；说明写在弹层里。
  const ST = { int: '感兴趣', res: '待研究', yes: '已采用', no: '不采用' };
  const ST_ORDER = ['res', 'int', 'yes', 'no'];
  const ST_HINT = { int: '有兴趣，还没定用途', res: '准备弄清能不能用', yes: '决定用了', no: '记下原因，免得重复研究' };
  const decided = (x) => x.status === 'yes' || x.status === 'no';
  const $ = (id) => document.getElementById(id);
  // 收藏时间写北京时间 M/D
  const md = (iso) => { const d = new Date(Date.parse(iso) + 8 * 3600e3); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`; };
  const items = D.items.map((x) => ({ ...x, p: D.projects[x.repo], key: `${x.repo}#${x.skill?.path ?? ''}` }));
  const byKey = (k) => items.find((x) => x.key === k);
  let q = '', filter = 'all', sel = null, selKey = null;
  const unfold = new Set();

  // 报头：项目和 Skill 各几个、待研究几个（只读）
  function mast() {
    const nP = items.filter((x) => !x.skill).length;
    $('mast').innerHTML = `<div><div class="kick"><span>个人收藏 · 本地储存</span></div><h1><span class="tt"><span class="ghost" aria-hidden="true">Clippings</span><b>收藏</b></span></h1></div>
    <div class="tick">${[['项目', nP, '个'], ['Skill', items.length - nP, '个'], ['待研究', items.filter((x) => x.status === 'res').length, '个']].map(([k, v, u]) => `<div><div class="k">${k}</div><div class="v">${v}<small>${u}</small></div></div>`).join('')}</div><div class="band"></div>`;
  }

  const avatar = (p) => (p.ownerId ? `https://avatars.githubusercontent.com/u/${p.ownerId}?s=64&v=4` : `https://github.com/${p.repo.split('/')[0]}.png?size=64`);
  const chip = (x) => `<button class="f-st" data-s="${x.status}" data-stmenu="${esc(x.key)}" aria-haspopup="dialog" aria-label="状态：${ST[x.status]}，点开改状态、理由和下一步">${ST[x.status]}</button>`;
  const handoffText = (x) => (x.handoff ? `<span class="f-ho">${esc(x.handoff.type)}交接 ${md(x.handoff.at)}</span>` : '');
  function lines(x) {
    const why = x.reason ? esc(x.reason) : `<span class="empty">${x.status === 'no' ? '没写为什么不适合' : '没写'}，点状态补一句</span>`;
    return `<dl class="f-lines"><div><dt>${x.status === 'no' ? '不适合' : '为什么'}</dt><dd>${why}</dd></div>${x.next ? `<div><dt>下一步</dt><dd class="nx">${esc(x.next)}</dd></div>` : ''}</dl>`;
  }
  function card(x) {
    const [owner, name] = x.repo.split('/'), gone = Boolean(x.skill?.missing);
    const skillAttr = x.skill ? ` data-skill="${esc(x.skill.path)}"` : '';
    const copy = gone ? '<button class="lnk" disabled>装不了</button>' : `<button class="lnk" data-copy="${esc(x.repo)}"${skillAttr}${noCopy(x.p)}>复制安装指令</button>`;
    return `<article class="tile${x.repo === sel ? ' is-sel' : ''}${decided(x) ? ' decided' : ''}" data-open="${esc(x.repo)}" data-key="${esc(x.key)}"${x.skill ? ` data-to="${esc(x.skill.path)}"` : ''}${gone ? ' data-gone' : ''} style="--c:${CC[x.cat] ?? CC.其他}">
      <button class="rib" data-star="${esc(x.repo)}"${skillAttr} title="点丝带取消收藏，再点恢复"></button>
      <div class="fh"><img class="av" src="${esc(avatar(x.p))}" width="32" height="32" alt=""><div class="m"><b>${esc(x.skill ? x.skill.name : name)}</b><span class="fr">${x.skill ? `来自 ${esc(x.repo)}` : esc(owner)}</span></div></div>
      <p>${esc(gone ? GONE : x.line ?? '')}</p>
      ${lines(x)}
      <div class="ttg">${x.skill ? '<span class="kt sk">Skill</span>' : '<span class="kt pj">项目</span>'}${chip(x)}${gone ? '<span class="kt gone">已不在仓库</span>' : ''}</div>
      <div class="tf"><span>收藏于 ${md(x.at)}${x.handoff ? ` · ${handoffText(x)}` : ''}</span>${copy}</div></article>`;
  }
  // 一组末尾的「已决定」：默认收成一张，点开后整组展开，末尾留「收起」。
  function pile(name, done) {
    if (!done.length) return '';
    if (unfold.has(name)) return done.map(card).join('') + `<button class="f-pile sm" data-fold="${esc(name)}">收起已决定 ▴</button>`;
    return `<button class="f-pile" data-fold="${esc(name)}"><span class="faces">${done.map((x) => `<img src="${esc(avatar(x.p))}" alt="">`).join('')}</span><b>已决定 ${done.length} 个</b><span>${[...new Set(done.map((x) => ST[x.status]))].join('、')} · 展开 ▾</span></button>`;
  }

  // 搜索：项目名、作者、Skill 名、一句话或 Skill 说明、分类、说明标签、定义标签、主要用途、使用场景、收藏理由、下一步
  const hay = (x) => [x.repo, x.skill?.name, x.line, x.shelf, ...x.p.cats, x.p.tag, x.p.type, ...(x.p.use ?? []), ...(x.p.scene ?? []), x.reason, x.next].filter(Boolean).join(' ').toLowerCase();
  function filterBar() {
    const n = (s) => items.filter((x) => s === 'all' || x.status === s).length;
    return `<div class="f-filter"><div class="segs" role="tablist" aria-label="按决策状态筛选">${['all', ...ST_ORDER].map((s) => `<button role="tab" data-filter="${s}" aria-selected="${filter === s}">${s === 'all' ? '全部' : ST[s]}<b>${n(s)}</b></button>`).join('')}</div></div>`;
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
          <div class="shelves">${groups.map(shelf).join('')}</div></div>`}`;
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

  // ── 改状态、理由、下一步：弹层。状态点了就存；理由和下一步停笔 0.6 秒或离开输入框时存。写成功才算数，失败提示并恢复。 ──
  async function save(x, change) {
    let r;
    try { r = await fetch('/api/favorites', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ project_id: x.id, skill: x.skill?.path ?? '', action: 'update', ...change }) }); } catch { /* 网络错误按失败处理 */ }
    const res = r && (await r.json().catch(() => null));
    if (!r?.ok || !res) { toast(res?.error ?? '没能保存，请稍后再试'); return false; }
    Object.assign(x, res);
    return true;
  }
  const pop = () => document.querySelector('.f-pop');
  function closePop() { pop()?.remove(); }
  function popBody(x) {
    return `<div class="f-sat">现在是「${ST[x.status]}」${x.statusAt ? ` · 状态改于 ${md(x.statusAt)}` : ` · 收藏于 ${md(x.at)}`}</div>
      ${ST_ORDER.map((s) => `<button class="it" data-setst="${s}" aria-pressed="${x.status === s}"><span class="f-st" data-s="${s}">${ST[s]}</span><small>${ST_HINT[s]}</small></button>`).join('')}
      <div class="sep"></div>
      <label for="f-why">${x.status === 'no' ? '为什么不适合（以后不用再研究一遍）' : '为什么收藏'}<textarea id="f-why" rows="2" maxlength="500" data-edit="reason">${esc(x.reason)}</textarea></label>
      <label for="f-next">下一步<input id="f-next" maxlength="500" data-edit="next_step" value="${esc(x.next)}" placeholder="例：先验证是否支持断点恢复"></label>`;
  }
  function openPop(btn, x) {
    closePop();
    const el = Object.assign(document.createElement('div'), { className: 'f-pop' });
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', '改状态、理由和下一步');
    el.dataset.key = x.key;
    el.innerHTML = popBody(x);
    document.body.append(el);
    const r = btn.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
    let left = r.left, top = r.bottom + 6;
    if (left + w > innerWidth - 12) left = innerWidth - w - 12;
    if (top + h > innerHeight - 12) top = r.top - h - 6;
    el.style.left = `${Math.max(8, left)}px`;
    el.style.top = `${Math.max(58, top) + scrollY}px`;
    el.querySelector('[aria-pressed="true"]')?.focus();
  }
  // 卡片和详情栏顶部跟着这条收藏的最新字段重画（弹层开着时不重画弹层，免得打断输入）。
  function refresh(x) {
    render();
    if (selKey === x.key) decorate();
  }
  const timers = new Map();
  function edited(input) {
    const x = byKey(pop()?.dataset.key);
    if (!x) return;
    clearTimeout(timers.get(input.dataset.edit));
    timers.set(input.dataset.edit, setTimeout(async () => {
      const field = input.dataset.edit, value = input.value.trim(), now = field === 'reason' ? x.reason : x.next;
      if (value === now) return;
      if (await save(x, { [field]: value })) refresh(x);
    }, 600));
  }

  // 详情栏：卡片数字取服务端给的那次运行；不在涨星榜上时总 Star 另给。顶行换成这条收藏的状态胶囊，标题下加一行只读的理由和下一步。
  const mark = () => document.querySelectorAll('.tile').forEach((n) => n.classList.toggle('is-sel', n.dataset.open === sel));
  function close() {
    sel = null;
    selKey = null;
    closePop();
    document.body.classList.remove('drawer-open');
    mark();
  }
  function decorate() {
    const x = byKey(selKey), host = $('drawer');
    if (!x) return;
    host.querySelector('.dw-top > span').innerHTML = `收藏于 ${md(x.at)}${x.skill ? ` · Skill ${esc(x.skill.name)}` : ''} ${chip(x)}`;
    host.querySelector('.f-dec')?.remove();
    const anchor = host.querySelector('.dw-line') ?? host.querySelector('.dw-gen') ?? host.querySelector('.dw-tags');
    anchor?.insertAdjacentHTML('afterend', `<div class="f-dec">${lines(x)}${x.handoff ? `<p>最近交接：${handoffText(x)}（只表示复制过，不代表做完）</p>` : ''}</div>`);
  }
  function open(repo, skill, key) {
    const v = D.views[repo], it = view(repo, v.run), host = $('drawer');
    if (it.total == null) it.total = v.total;
    host.innerHTML = drawer(it, { w: v.win, ranks: v.ranks, home: true });
    sel = repo;
    selKey = key ?? `${repo}#${skill ?? ''}`;
    if (!byKey(selKey)) selKey = items.find((x) => x.repo === repo)?.key ?? null;
    decorate();
    syncStars(host);
    const body = host.querySelector('.dw-body'), hit = skill && document.getElementById(`skill-${skill}`);
    body.scrollTop = 0;
    if (hit) { hit.classList.add('hit'); body.scrollTop = hit.getBoundingClientRect().top - body.getBoundingClientRect().top - body.clientHeight / 3; }
    document.body.classList.add('drawer-open');
    mark();
  }

  document.addEventListener('click', async (ev) => {
    const inPop = ev.target.closest('.f-pop');
    if (inPop) {
      const b = ev.target.closest('[data-setst]');
      const x = byKey(inPop.dataset.key);
      if (!b || !x || b.dataset.setst === x.status) return;
      if (await save(x, { status: b.dataset.setst })) {
        toast(`已改为「${ST[x.status]}」`);
        inPop.innerHTML = popBody(x);
        inPop.querySelector('[aria-pressed="true"]')?.focus();
        refresh(x);
      }
      return;
    }
    const m = ev.target.closest('[data-stmenu]');
    if (m) { ev.stopPropagation(); const x = byKey(m.dataset.stmenu); if (pop()?.dataset.key === x.key) return closePop(); return openPop(m, x); }
    closePop();
    if (act(ev)) return;
    const t = ev.target.closest('[data-jump],[data-close],[data-open],[data-filter],[data-fold]');
    if (!t) return;
    if ('filter' in t.dataset) { filter = t.dataset.filter; return render(); }
    if ('fold' in t.dataset) { unfold.has(t.dataset.fold) ? unfold.delete(t.dataset.fold) : unfold.add(t.dataset.fold); return render(); }
    if ('jump' in t.dataset) { ev.preventDefault(); return jump(t.dataset.jump); }
    if ('close' in t.dataset) return close();
    if (sel === t.dataset.open && !t.dataset.to && selKey === t.dataset.key) return close();
    open(t.dataset.open, t.dataset.to, t.dataset.key);
  });
  document.addEventListener('input', (ev) => {
    if (ev.target.matches('[data-q]')) { q = ev.target.value.trim().toLowerCase(); render(); return; }
    if (ev.target.closest('.f-pop [data-edit]')) edited(ev.target);
  });
  document.addEventListener('focusout', (ev) => { if (ev.target.closest?.('.f-pop [data-edit]')) { clearTimeout(timers.get(ev.target.dataset.edit)); timers.delete(ev.target.dataset.edit); edited(ev.target); } });
  // 复制安装指令后 bw.js 记了最近交接：更新这一条。
  document.addEventListener('bw:handoff', (ev) => {
    const x = byKey(`${ev.detail.repo}#${ev.detail.skill}`);
    if (!x) return;
    x.handoff = { type: ev.detail.type, at: ev.detail.at };
    refresh(x);
  });
  // 键盘：/ 聚焦搜索，输入框里 Esc 失焦；Esc 先关弹层再关详情栏；详情栏开着时 ↑↓（也认 j/k）按本页卡片顺序换项目
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && pop()) { const m = document.querySelector(`[data-stmenu="${CSS.escape(pop().dataset.key)}"]`); closePop(); m?.focus(); return; }
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
