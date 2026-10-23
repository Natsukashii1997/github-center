// 日报页（#14 先出页面壳与三个前 10；概览与飞书推送由 #11 做）：照冻结方案 t1b-pages-r1 的 design/t1b-pages/daily.html。
// 近 1 天前 10 是主角（简介＋这一期那次运行的近 30 天走势）；近 7 天、近 30 天前 10 收在右侧一直跟着的栏里。
(() => {
  const { $, esc, num, I, D } = GC;
  const { P, ditem, compactRow, project, wireOpen, phead } = GP;
  GC.topbar('日报');
  GC.setStatus(D.top);
  const main = $('#main'), rail = $('#rail');
  if (!D.day) {
    main.innerHTML = `${phead('日报', '每天出榜后自动生成。')}${GC.emptyHTML('inbox', '还没有日报', '每天统计日结束后出榜，出完就会出现在这里。', ['/', '先看涨星榜'])}`;
    rail.hidden = true;
    return;
  }
  const day = GC.md(GC.utc(D.day));
  const W = D.windows, runOf = (r) => P(r.repo).runs[r.run];
  const section = (w) => (W[w].entries.length
    ? `<section id="${w}"><h2>${W[w].label}前 10</h2><ol class="dlist">${W[w].entries.map((r) => ditem(r, { id: `${w}-${r.rank}`, href: project(r.repo, 'daily'), run: runOf(r) })).join('')}</ol></section>`
    : `<section id="${w}"><h2>${W[w].label}前 10</h2>${GC.emptyHTML('inbox', W[w].empty?.title ?? '这一期没有核出项目', W[w].empty?.text ?? '')}</section>`);
  main.innerHTML = `${phead(`${day}日报`, `统计日 ${day}（UTC）。`)}<div id="notes"></div>
    ${section('d1')}
    <p class="foot">数字来自 GitHub 官方数据；项目介绍由 AI 根据项目文档写成。概览和飞书推送还没上线。</p>`;
  GC.notes($('#notes'), D.notes);
  const sec = (w) => `<section id="rail-${w}"><h2>${W[w].label}前 10</h2>${W[w].entries.length ? `<ol class="crows">${W[w].entries.map((r) => compactRow(r, { number: `<small>+</small>${num(r.gain)}`, href: project(r.repo, 'daily') })).join('')}</ol>` : `<p class="foot">${esc(W[w].empty?.title ?? '还没有')}</p>`}</section>`;
  rail.innerHTML = `${sec('d7')}${sec('d30')}`;
  wireOpen(rail);
  GC.anim(main, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 240 });
})();
