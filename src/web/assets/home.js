// 首页涨星榜（2026-11-03 白雾定稿 r7，design/candidates/redesign/r7.html、r2.js 的 app 落地）：报头（新鲜度、第一名、新面孔、飙升最多）、
// 筛选条（近 1/7/30 天、状态）、前三卡、其余上榜的行；点项目从右侧滑出详情栏，↑↓ 换项目，Esc 关闭，/ 聚焦搜索。
// 数据全在页面里，切换窗口只在本页重画。筛选或搜索时不单列前三，命中的都进列表，名次保持原样。刷新后停在同一个窗口和项目上（?w=、?sel=）。
(() => {
  const { D, esc, num, wan, md, pad, PER, chart, st, item, gen, noCopy, drawer, act, syncStars } = BW;
  const $ = (id) => document.getElementById(id);
  const q = new URLSearchParams(location.search);
  const s = { w: Object.hasOwn(D.windows, q.get('w')) ? q.get('w') : 'd1', st: '', q: '', sel: q.get('sel') };
  let b, shown = [];

  const board = (w) => { const W = D.windows[w]; return { W, w, items: W.entries.map((e) => item(w, e)) }; };
  // 它在三个窗口的涨星榜上各排第几（详情栏“项目信息”里写）
  const ranksOf = (repo) => Object.entries(D.windows).flatMap(([w, W]) => W.entries.filter((e) => e.repo === repo).map((e) => ({ w, label: W.label, rank: e.rank, tie: e.tie, mv: e.mv ?? null, streak: e.streak ?? null })));
  const desc = (it) => (it.what != null ? `${it.what}${it.problem ?? ''}` : gen(it));
  const av = (it, n) => `<img class="av" src="${esc(it.avatar)}" width="${n}" height="${n}" alt="">`;
  const copyBtn = (it) => `<button class="btn sm" data-copy="${esc(it.repo)}"${noCopy(it)}>复制安装指令</button>`;
  const skills = (it, n = 3) => (it.skills.length ? `<span class="sk">${it.skills.slice(0, n).map((x) => `<code>${esc(x.name)}</code>`).join('')}${it.skills.length > n ? `<em>等 ${it.skills.length} 个 Skill</em>` : ''}</span>` : '');

  // 报头：数据新鲜度（统计日的次日采集，所以减 1）、第一名、新面孔、飙升最多；口径放在标题的悬停说明里
  function head() {
    const { W, items } = b;
    if (!W.day) return `<div><div class="kick"><span>GitHub · ${esc(W.label)}</span><span class="fresh ${W.top.tone === 'bad' ? 'bad' : 'warn'}"><i></i>${esc(W.top.text)}</span></div><h1>涨星榜</h1></div><div class="tick"></div>`;
    const late = Math.round((Date.now() - Date.parse(W.day)) / 864e5) - 1;
    const tone = W.top.tone === 'bad' ? 'bad' : late > 0 || W.top.tone === 'warn' ? 'warn' : '';
    const [top] = items;
    const hasPrev = items.some((it) => it.e.mv);
    const fresh = items.filter((it) => it.e.mv?.kind === 'new');
    const rise = items.filter((it) => it.e.mv?.kind === 'up').sort((x, y) => y.e.mv.n - x.e.mv.n)[0];
    return `<div><div class="kick"><span>GitHub · ${esc(W.label)} · ${md(W.day)}</span><span class="fresh ${tone}" title="${esc(W.top.text)}"><i></i>${late <= 0 ? '数据是最新的' : `已 ${late} 天没有新数据`}</span></div><h1 title="口径：${esc(W.lede.span)}，全站 ${W.lede.candidates} 个候选，官方核数 ${W.lede.checks} 次">涨星榜</h1></div>
      <div class="tick">${top ? `
        <div><div class="k">第一名</div><div class="v"><b data-open="${esc(top.repo)}">${esc(top.name)}</b><small>${top.st?.kind === 'crown' ? esc(top.st.text) : '本期登顶'}</small></div></div>
        <div><div class="k">新面孔</div>${hasPrev ? `<div class="v">${fresh.length} 个</div><div class="fc">${fresh.slice(0, 6).map((it) => `<span class="face" data-open="${esc(it.repo)}" title="${esc(it.repo)}">${av(it, 18)}</span>`).join('')}</div>` : '<div class="v"><small>暂无上一期</small></div>'}</div>
        <div><div class="k">飙升最多</div><div class="v">${rise ? `<b data-open="${esc(rise.repo)}">${esc(rise.name)}</b><small class="up">▲${rise.e.mv.n}</small>` : '<small>暂无名次变化</small>'}</div></div>` : ''}
      </div>`;
  }
  const fbar = () => `<div class="segs" role="group" aria-label="时间窗口">${Object.entries(D.windows).map(([w, W]) => `<button data-w="${w}" aria-selected="${w === s.w}">${esc(W.label)}</button>`).join('')}</div>
    <span class="sp"></span>
    <label class="dd">状态：<select data-sel="st"><option value="">全部</option>${[['crown', '蝉联第一'], ['new', '首次上榜'], ['rise', '飙升'], ['stay', '在榜多期']].map(([v, t]) => `<option value="${v}"${s.st === v ? ' selected' : ''}>${t}</option>`).join('')}</select></label>`;
  const notes = (list) => list.map((n) => `<p${n.tone ? ` data-tone="${n.tone}"` : ''}><b>${esc(n.title)}</b>${esc(n.text)}</p>`).join('');

  // 前三卡：名次、名字、状态标签、说明；底部涨星、总星并排，柱图和行一样
  const two = (it) => `<div class="two"><div><b class="g">+${num(it.gain)}<small>${PER[it.w]}</small></b><span>本期新增</span></div><div><b class="tot">${it.total == null ? '暂缺' : `★ ${wan(it.total)}`}</b><span>总 Star</span></div></div>`;
  const card = (it, n1) => `<article class="card ${n1 ? 'n1 top' : ''}" data-open="${esc(it.repo)}">
    <div class="rk">${pad(it.rank)}</div>
    <div class="id">${av(it, n1 ? 32 : 24)}<span class="nm">${esc(it.name)}</span><span class="ow">${esc(it.owner)}</span></div>
    <div class="tg">${st(it)}</div>
    <div class="wt">${esc(desc(it))}</div>
    <div class="ft">${two(it)}${chart(it)}</div>
  </article>`;
  const hero = ([a, x, y]) => `${card(a, true)}<div class="r">${x ? card(x) : ''}${y ? card(y) : ''}</div>`;
  const row = (it) => `<div class="row" data-open="${esc(it.repo)}">
    <div class="rk">${it.rank}<span class="mv ${it.mv.c}">${esc(it.mv.t)}</span>${it.tie ? '<span class="tie">并列</span>' : ''}</div>
    <div class="mid">
      <div class="l1">${av(it, 20)}<span class="nm">${esc(it.name)}</span><span class="ow">${esc(it.owner)}</span></div>
      <div class="ds">${esc(it.what ?? gen(it))}</div>
      <div class="ft">${copyBtn(it)}${skills(it)}</div>
    </div>
    ${chart(it)}
    <div class="num"><div class="g">+${num(it.gain)}<small>${PER[it.w]}</small></div><div class="tot">${it.total == null ? '暂缺' : `★ ${wan(it.total)}`}</div><span class="u">总 Star</span>${st(it)}</div>
    <button class="star" data-star="${esc(it.repo)}" aria-label="收藏"></button>
  </div>`;

  function render() {
    b = board(s.w);
    const k = s.q.trim().toLowerCase();
    const filtered = Boolean(s.st || k);
    shown = b.items.filter((it) => (!s.st || it.st?.kind === s.st) && (!k || `${it.repo} ${it.what ?? ''} ${it.problem ?? ''}`.toLowerCase().includes(k)));
    $('head').innerHTML = head();
    $('fbar').innerHTML = fbar();
    $('notes').innerHTML = notes(b.W.notes);
    const podium = !filtered && shown.length > 0;
    $('hero').innerHTML = podium ? hero(shown.slice(0, 3)) : '';
    $('hero').hidden = !podium;
    const rest = podium ? shown.slice(3) : shown;
    $('sec').hidden = podium && !rest.length;
    $('list').innerHTML = rest.map(row).join('') || (b.W.empty ? `<div class="empty"><b>${esc(b.W.empty.title)}</b>${esc(b.W.empty.text)}</div>` : '<div class="empty">没有符合条件的项目</div>');
    $('count').textContent = filtered ? `筛出 ${shown.length} 个` : rest.length ? `No.${pad(rest[0].rank)} – ${pad(rest.at(-1).rank)}` : '';
    if (s.sel && !shown.some((it) => it.repo === s.sel)) close(); else if (s.sel) open(s.sel, false);
    syncStars();
    remember();
  }
  function remember() {
    const u = new URL(location.href);
    u.searchParams.set('w', s.w);
    if (s.sel) u.searchParams.set('sel', s.sel); else u.searchParams.delete('sel');
    history.replaceState(null, '', u);
  }
  function close() {
    s.sel = null;
    document.body.classList.remove('drawer-open');
    document.querySelectorAll('.is-sel').forEach((n) => n.classList.remove('is-sel'));
    remember();
  }
  function open(repo, scroll = true) {
    const it = b.items.find((x) => x.repo === repo);
    if (!it) return close();
    s.sel = repo;
    const host = $('drawer');
    host.innerHTML = drawer(it, { cur: it, w: s.w, ranks: ranksOf(repo), home: true });
    host.querySelector('.dw-body').scrollTop = 0;
    document.body.classList.add('drawer-open');
    document.querySelectorAll('[data-open]').forEach((n) => n.classList.toggle('is-sel', n.dataset.open === repo));
    const el = document.querySelector(`.row[data-open="${CSS.escape(repo)}"]`);
    if (scroll && el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    syncStars(host);
    remember();
  }

  document.addEventListener('click', (ev) => {
    if (act(ev) || ev.target.closest('a[href]')) return;
    const t = ev.target.closest('[data-w],[data-close],[data-open]');
    if (!t) return;
    if (t.dataset.w) { s.w = t.dataset.w; render(); return; }
    if ('close' in t.dataset) return close();
    s.sel === t.dataset.open ? close() : open(t.dataset.open);
  });
  document.addEventListener('input', (ev) => { if (ev.target.matches('[data-q]')) { s.q = ev.target.value; render(); } });
  document.addEventListener('change', (ev) => { if (ev.target.dataset?.sel) { s[ev.target.dataset.sel] = ev.target.value; render(); } });
  // 详情栏开着时 ↑↓（或 j/k）换项目，Esc 关闭；/ 聚焦搜索
  document.addEventListener('keydown', (ev) => {
    if (ev.target.matches?.('input, select')) { if (ev.key === 'Escape') ev.target.blur(); return; }
    if (ev.key === '/') { ev.preventDefault(); document.querySelector('[data-q]')?.focus(); return; }
    if (ev.key === 'Escape') return close();
    if (!s.sel || !['ArrowDown', 'ArrowUp', 'j', 'k'].includes(ev.key)) return;
    ev.preventDefault();
    const i = shown.findIndex((it) => it.repo === s.sel) + (ev.key === 'ArrowDown' || ev.key === 'j' ? 1 : -1);
    if (shown[i]) open(shown[i].repo);
  });
  render();
})();
