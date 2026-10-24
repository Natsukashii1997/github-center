// 样稿 signals-r1（#16）副本：照 6cf1b5b 的 src/web/assets/home.js，只在阅读卡顶行加了连续上榜（r.streak）；其余一字未改。
// 首页涨星榜（#13）：照冻结方案 t1b-r2 的 design/t1b/index.html。数据全在页面里，切换近 1/7/30 天只在本页重画：
// 名次相同的行从旧位置滑到新位置，新上榜的淡入；选中的项目还在榜上就只换高亮和走势里的天数。
// 分类筛选（#10）同样只在本页重画：换成服务端算好的分类榜（这一期全部已核数的候选里按分类重新取前 20）。
(() => {
  const { $, D, q } = GC;
  let win = Object.hasOwn(D.windows, q.get('w')) ? q.get('w') : 'd1', cat = D.cats.includes(q.get('cat')) ? q.get('cat') : null, sel = q.get('sel'), rows = [], shown = null;
  const rowsEl = $('#rows'), card = $('#card'), mark = $('#selmark');

  GC.topbar('涨星榜');
  const placeWin = GC.tabs($('#wins'), GC.WINDOWS.map((w) => [w.id, w.label]), win, (id) => { if (id !== win) { win = id; render(); } });
  const placeCat = GC.chips($('#cats'), cat, (c) => { if (c !== cat) { cat = c; render(); } });

  const W = () => D.windows[win];
  // 当前显示的那份榜：选了分类就是这个窗口的分类榜（窗口还没有榜单时没有分类榜，照窗口显示）。
  const B = () => (cat && W().byCat?.[cat]) || W();
  const eyebrow = (r) => `<span>第 ${r.rank} 名${r.tie ? '（并列）' : ''} · ${W().label}</span>${r.streak ? `<span class="streak">${r.streak}</span>` : ''}<span class="num">+${GC.num(r.gain)}</span>`;
  // 刷新后停在同一个窗口、分类和项目上
  const remember = () => {
    const u = new URL(location.href);
    u.searchParams.set('w', win);
    if (cat) u.searchParams.set('cat', cat); else u.searchParams.delete('cat');
    if (sel) u.searchParams.set('sel', sel); else u.searchParams.delete('sel');
    history.replaceState(null, '', u);
  };
  function select(repo) {
    if (repo === sel) return;
    sel = repo;
    GC.placeSel(rowsEl, mark, sel);
    showCard();
    remember();
  }
  // 换项目：正文淡入上移、走势按日期升起；同一项目换窗口：只换高亮（两期榜单出自不同次运行时数字可能不同，照换项目重画）
  function showCard() {
    const r = rows.find((x) => x.repo === sel);
    if (!r) { const e = B().empty; card.innerHTML = GC.emptyHTML('inbox', e.title, e.text); shown = null; return; }
    const key = `${r.repo}@${r.run}`;
    if (shown === key) { $('.eyebrow', card).innerHTML = eyebrow(r); GC.sweepBars(card, win); return; }
    const p = D.projects[r.repo];
    card.innerHTML = GC.cardHTML(p, { eyebrow: eyebrow(r), run: r.run, win, mode: 'pane' });
    GC.wireCard(card, p);
    GC.anim(GC.$('.body', card), [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 240 });
    GC.growBars(card);
    shown = key;
  }

  function render() {
    const w = W();
    placeWin(win);
    placeCat(cat);
    GC.setStatus(w.top);
    $('#lede').innerHTML = w.lede ? `${w.lede.span}。全站 <span class="num">${GC.num(w.lede.candidates)}</span> 个候选，官方核数 <span class="num">${GC.num(w.lede.checks)}</span> 次。` : '';
    GC.notes($('#notes'), cat && w.byCat ? [...w.notes, ...w.byCat[cat].notes] : w.notes);
    rows = B().entries;
    if (!rows.some((r) => r.repo === sel)) sel = rows[0]?.repo || null;
    GC.reconcile(rowsEl, rows, { key: (r) => r.repo, create: (r) => GC.rowCreate(r, select), update: GC.rowUpdate });
    if (!rows.length) rowsEl.innerHTML = '';
    GC.placeSel(rowsEl, mark, sel);
    showCard();
    remember();
  }

  // 键盘：焦点在榜单行上时，方向键换选中（焦点跟着走），回车打开项目页；行里的收藏按钮照常响应自己的回车。
  rowsEl.addEventListener('keydown', (e) => {
    if (!e.target.classList.contains('row')) return;
    if (e.key === 'Enter') { location.href = GC.pageOf(sel); return; }
    if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return;
    e.preventDefault();
    const i = rows.findIndex((r) => r.repo === sel);
    const n = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    select(n.repo);
    const li = rowsEl.querySelector(`[data-key="${CSS.escape(n.repo)}"]`);
    li.focus({ preventScroll: true });
    li.scrollIntoView({ block: 'nearest' });
  });

  render();
})();
