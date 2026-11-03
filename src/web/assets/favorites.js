// 我的收藏（#22，白雾定稿 design/candidates/redesign/fav.html：C 收藏架、A 书签丝带卡片、A 侧栏只留类别目录）。
// 数据是服务端嵌进页面的这个人的收藏（src/web/pages.js 的 favoritesData）：items 新的在前，每条带分组 shelf；shelves 是排好序的组。
// 丝带就是「已收藏」：点它取消（真写进账号，走 bw.js 的收藏），丝带变灰缩短、卡片变淡；再点恢复。复制安装指令同样走 bw.js。
// 点卡片在本页右侧打开这个项目的详情栏（bw.js 的 drawer，和首页、项目页同一份内容）；Skill 卡打开后滚到那一条。顶栏搜索只过滤本页。
(() => {
  const { D, esc, view, drawer, act, syncStars, noCopy } = BW;
  // 类别色（同定稿原型）：丝带取项目的第一个分类，Skill 收藏也取所属项目的；还没归类的用灰。
  const CC = { 'Agent／MCP': '#0969da', Skill: '#8250df', 'AI 应用工具': '#bf3989', '开发者工具与基础设施': '#1a7f37', '开发框架与组件库': '#0f8f8a', '工作流自动化': '#bc4c00', '知识管理与办公效率': '#9a6700', '数据库与数据工具': '#3a43b8', 其他: '#8c959f' };
  const GONE = '这个 Skill 已经不在仓库里了，可能被改名或删掉。';
  const $ = (id) => document.getElementById(id);
  // 收藏时间写北京时间 M/D
  const md = (iso) => { const d = new Date(Date.parse(iso) + 8 * 3600e3); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`; };
  const items = D.items.map((x) => ({ ...x, p: D.projects[x.repo] }));
  let q = '', sel = null;

  // 报头：账号名、项目和 Skill 各几个、最近一次收藏的日期（只读）
  const nP = items.filter((x) => !x.skill).length;
  $('mast').innerHTML = `<div><div class="kick"><span>GitHub · 我的收藏 · ${esc(D.account.name)}</span></div><h1>我的收藏</h1></div>
    <div class="tick">${[['项目', nP, '个'], ['Skill', items.length - nP, '个'], ['最近收藏', items.length ? md(items[0].at) : '—', '']].map(([k, v, u]) => `<div><div class="k">${k}</div><div class="v">${v}${u ? `<small>${u}</small>` : ''}</div></div>`).join('')}</div><div class="band"></div>`;

  const avatar = (p) => (p.ownerId ? `https://avatars.githubusercontent.com/u/${p.ownerId}?s=64&v=4` : `https://github.com/${p.repo.split('/')[0]}.png?size=64`);
  function card(x) {
    const [owner, name] = x.repo.split('/'), gone = Boolean(x.skill?.missing);
    const skillAttr = x.skill ? ` data-skill="${esc(x.skill.path)}"` : '';
    const copy = gone ? '<button class="lnk" disabled>装不了</button>' : `<button class="lnk" data-copy="${esc(x.repo)}"${skillAttr}${noCopy(x.p)}>复制安装指令</button>`;
    return `<article class="tile${x.repo === sel ? ' is-sel' : ''}" data-open="${esc(x.repo)}"${x.skill ? ` data-to="${esc(x.skill.path)}"` : ''}${gone ? ' data-gone' : ''} style="--c:${CC[x.cat] ?? CC.其他}">
      <button class="rib" data-star="${esc(x.repo)}"${skillAttr} title="点丝带取消收藏，再点恢复"></button>
      <div class="fh"><img class="av" src="${esc(avatar(x.p))}" width="32" height="32" alt=""><div class="m"><b>${esc(x.skill ? x.skill.name : name)}</b><span class="fr">${x.skill ? `来自 ${esc(x.repo)}` : esc(owner)}</span></div></div>
      <p>${esc(gone ? GONE : x.line ?? '')}</p>
      <div class="ttg">${x.skill ? '<span class="kt sk">Skill</span>' : '<span class="kt pj">项目</span>'}${gone ? '<span class="kt gone">已不在仓库</span>' : ''}</div>
      <div class="tf"><span>收藏于 ${md(x.at)}</span>${copy}</div></article>`;
  }

  // 搜索：项目名、作者、Skill 名、一句话或 Skill 说明、分类、说明标签、定义标签、主要用途、使用场景
  const hay = (x) => [x.repo, x.skill?.name, x.line, x.shelf, ...x.p.cats, x.p.tag, x.p.type, ...(x.p.use ?? []), ...(x.p.scene ?? [])].filter(Boolean).join(' ').toLowerCase();
  function render() {
    const shown = items.filter((x) => !q || hay(x).includes(q));
    const groups = D.shelves.map((s) => [s.name, shown.filter((x) => x.shelf === s.name)]).filter(([, xs]) => xs.length);
    $('shelf').innerHTML = !items.length ? '<div class="empty"><b>还没有收藏</b>在涨星榜或项目详情里点 ☆，收藏项目或单个 Skill，就会收在这里。<p><a class="btn" href="/">去看涨星榜</a></p></div>'
      : !shown.length ? '<div class="empty"><b>没有符合条件的收藏</b>换个关键词试试。</div>'
        : `<div class="fcx"><aside class="idx" aria-label="类别"><span class="ih">类别</span><a href="#" data-jump="">全部<b>${shown.length}</b></a>${groups.map(([g, xs], i) => `<a href="#g-${i}" data-jump="${i}">${esc(g)}<b>${xs.length}</b></a>`).join('')}</aside>
          <div class="shelves">${groups.map(([g, xs], i) => `<section class="shelf" id="g-${i}"><h3>${esc(g)}<small>${xs.length}</small></h3><div class="shrow">${xs.map(card).join('')}</div></section>`).join('')}</div></div>`;
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

  // 详情栏：卡片数字取服务端给的那次运行；不在涨星榜上时总 Star 另给。顶行没有本页的名次，写「我的收藏」。
  const mark = () => document.querySelectorAll('.tile').forEach((n) => n.classList.toggle('is-sel', n.dataset.open === sel));
  function close() {
    sel = null;
    document.body.classList.remove('drawer-open');
    mark();
  }
  function open(repo, skill) {
    const v = D.views[repo], it = view(repo, v.run), host = $('drawer');
    if (it.total == null) it.total = v.total;
    host.innerHTML = drawer(it, { w: v.win, ranks: v.ranks, home: true });
    host.querySelector('.dw-top > span').textContent = '我的收藏';
    syncStars(host);
    const body = host.querySelector('.dw-body'), hit = skill && document.getElementById(`skill-${skill}`);
    body.scrollTop = 0;
    if (hit) { hit.classList.add('hit'); body.scrollTop = hit.getBoundingClientRect().top - body.getBoundingClientRect().top - body.clientHeight / 3; }
    sel = repo;
    document.body.classList.add('drawer-open');
    mark();
  }

  document.addEventListener('click', (ev) => {
    if (act(ev)) return;
    const t = ev.target.closest('[data-jump],[data-close],[data-open]');
    if (!t) return;
    if ('jump' in t.dataset) { ev.preventDefault(); return jump(t.dataset.jump); }
    if ('close' in t.dataset) return close();
    if (sel === t.dataset.open && !t.dataset.to) return close();
    open(t.dataset.open, t.dataset.to);
  });
  document.addEventListener('input', (ev) => { if (ev.target.matches('[data-q]')) { q = ev.target.value.trim().toLowerCase(); render(); } });
  // 键盘：/ 聚焦搜索，输入框里 Esc 失焦；Esc 关详情栏；详情栏开着时 ↑↓（也认 j/k）按本页卡片顺序换项目
  document.addEventListener('keydown', (ev) => {
    if (ev.target.matches?.('input, select')) { if (ev.key === 'Escape') ev.target.blur(); return; }
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
