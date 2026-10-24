// 日报页（#11、#14）：照冻结方案 t1b-pages-r1 的 design/t1b-pages/daily.html。内容是每天生成的那份日报（飞书消息用的也是这一份）：
// 概览；近 1 天前 10 是主角（简介＋这一期那次运行的近 30 天走势）；近 7、30 天前 10 和版本发布收在右侧一直跟着的栏里。
// 同一项目只介绍一次：近 7、30 天里前面已介绍过的项目写“见上”。还没生成时显示方案的空状态。
(() => {
  const { $, esc, num, D } = GC;
  const { P, ditem, compactRow, relRow, project, wireOpen, phead, bjLong } = GP;
  GC.topbar('日报');
  GC.setStatus(D.top);
  const main = $('#main'), rail = $('#rail');
  const R = D.daily;
  if (!R) {
    main.innerHTML = `${phead('日报', '每天出榜和补资料跑完后自动生成。')}<div id="notes"></div>${GC.emptyHTML('inbox', '今天的日报还没生成', '出榜和补资料跑完就会出现在这里，飞书消息内容也一起生成。', ['/', '先看涨星榜'])}`;
    GC.notes($('#notes'), D.notes);
    rail.hidden = true;
    return;
  }
  const day = GC.md(GC.utc(R.statDay)), W = R.windows;
  const none = (w) => (W[w].statDay ? '这一期没有核出项目。' : `还没有${W[w].label}的榜单。`);
  // 近 1 天是第一个窗口，不会有“见上”。
  main.innerHTML = `${phead(`${day}日报`, `统计日 ${day}（UTC），${bjLong(R.generatedAt)} 生成。飞书里收到的就是这一份。`)}<div id="notes"></div>
    <p class="overview-wide">${esc(R.overview)}</p>
    <section id="d1"><h2>${W.d1.label}前 10</h2>${W.d1.entries.length ? `<ol class="dlist">${W.d1.entries.map((r) => ditem(r, { id: `d1-${r.rank}`, href: project(r.repo, 'daily'), run: P(r.repo).runs[W.d1.run] })).join('')}</ol>` : GC.emptyHTML('inbox', none('d1'), '')}</section>
    <p class="foot">数字来自 GitHub 官方数据；项目介绍由 AI 根据项目文档写成；概览按当天榜单的数字写成，版本发布取自项目的官方 Release。</p>`;
  GC.notes($('#notes'), D.notes);
  const row = (r) => compactRow(r, { number: `<small>+</small>${num(r.gain)}`, href: project(r.repo, 'daily'), ...(r.first ? { desc: `见上：${W[r.first.w].label}第 ${r.first.rank} 名` } : {}) });
  const sec = (w) => `<section id="rail-${w}"><h2>${W[w].label}前 10</h2>${W[w].entries.length ? `<ol class="crows">${W[w].entries.map(row).join('')}</ol>` : `<p class="foot">${none(w)}</p>`}</section>`;
  const rel = `<section id="rel"><h2>版本发布</h2>${R.releases.map((r) => relRow(r, 'daily')).join('')}<p class="foot">${R.releases.length ? '只列上榜项目在所在时间窗口内发的正式版本。' : '上榜项目在所在时间窗口内没有查到正式版本。'}</p></section>`;
  rail.innerHTML = `${sec('d7')}${sec('d30')}${rel}`;
  wireOpen(rail);
  GC.anim(main, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 240 });
})();
