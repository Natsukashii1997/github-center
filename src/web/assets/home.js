// 首页涨星榜（#13）：照冻结方案 t1b-r2 的 design/t1b/index.html。数据全在页面里，切换近 1/7/30 天只在本页重画：
// 名次相同的行从旧位置滑到新位置，新上榜的淡入；选中的项目还在榜上就只换高亮和走势里的天数。分类筛选由 #10 加上。
(() => {
  const { $, D, q } = GC;
  let win = Object.hasOwn(D.windows, q.get('w')) ? q.get('w') : 'd1', sel = q.get('sel'), rows = [], shown = null;
  const rowsEl = $('#rows'), card = $('#card'), mark = $('#selmark');

  GC.topbar('涨星榜');
  const placeWin = GC.tabs($('#wins'), GC.WINDOWS.map((w) => [w.id, w.label]), win, (id) => { if (id !== win) { win = id; render(); } });

  const W = () => D.windows[win];
  const eyebrow = (r) => `<span>第 ${r.rank} 名${r.tie ? '（并列）' : ''} · ${W().label}</span><span class="num">+${GC.num(r.gain)}</span>`;
  // 刷新后停在同一个窗口和项目上
  const remember = () => {
    const u = new URL(location.href);
    u.searchParams.set('w', win);
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
  // 换项目：正文淡入上移、走势按日期升起；同一项目换窗口：只换高亮
  function showCard() {
    const r = rows.find((x) => x.repo === sel);
    if (!r) { const e = W().empty; card.innerHTML = GC.emptyHTML('inbox', e.title, e.text); shown = null; return; }
    if (shown === r.repo) { $('.eyebrow', card).innerHTML = eyebrow(r); GC.sweepBars(card, win); return; }
    const p = D.projects[r.repo];
    card.innerHTML = GC.cardHTML(p, { eyebrow: eyebrow(r), win, mode: 'pane' });
    GC.wireCard(card, p);
    GC.anim(GC.$('.body', card), [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 240 });
    GC.growBars(card);
    shown = r.repo;
  }

  function render() {
    const w = W();
    placeWin(win);
    GC.setStatus(w.top);
    $('#lede').innerHTML = w.lede ? `${w.lede.span}。全站 <span class="num">${GC.num(w.lede.candidates)}</span> 个候选，官方核数 <span class="num">${GC.num(w.lede.checks)}</span> 次。` : '';
    GC.notes($('#notes'), w.notes);
    rows = w.entries;
    if (!rows.some((r) => r.repo === sel)) sel = rows[0]?.repo || null;
    GC.reconcile(rowsEl, rows, { key: (r) => r.repo, create: (r) => GC.rowCreate(r, select), update: GC.rowUpdate });
    if (!rows.length) rowsEl.innerHTML = '';
    GC.placeSel(rowsEl, mark, sel);
    showCard();
    remember();
  }

  addEventListener('keydown', (e) => {
    if (!rows.length || e.target.closest?.('input, select, textarea')) return;
    const i = rows.findIndex((r) => r.repo === sel);
    if (e.key === 'Enter' && sel && !e.target.closest?.('button, a')) { location.href = GC.pageOf(sel); return; }
    if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return;
    e.preventDefault();
    const n = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    select(n.repo);
    rowsEl.querySelector(`[data-key="${CSS.escape(n.repo)}"]`).scrollIntoView({ block: 'nearest' });
  });

  render();
})();
