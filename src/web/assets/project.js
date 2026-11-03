// 项目页 /p/作者/仓库名（2026-11-03 起和首页右侧详情栏同一份内容，见 bw.js 的 drawer）：整页放在白雾外壳里。
// 项目页另写依据（读了哪些文件）和条件说明；从收藏页直达某条 Skill 时滚到那一条并高亮。
(() => {
  const { D, esc, view, drawer, act, syncStars } = BW;
  const pg = D.page, host = document.getElementById('page');
  if (pg.missing) {
    host.innerHTML = `<div class="empty"><b>找不到这个项目</b>地址里的 ${esc(pg.repo)} 可能写错了，或者它还没有上过榜。<p><a class="btn" href="/">去看涨星榜</a></p></div>`;
    return;
  }
  // 不在涨星榜上时没有那次运行的数字，总 Star 取它所在榜单快照里的数。
  const it = view(pg.repo, pg.run);
  if (it.total == null) it.total = pg.total;
  host.innerHTML = drawer(it, { w: pg.ranks.length ? pg.win : null, ranks: pg.ranks, page: pg });
  syncStars(host);
  document.addEventListener('click', act);
  const el = document.getElementById(decodeURIComponent(location.hash.slice(1)));
  if (el) { el.classList.add('hit'); el.scrollIntoView({ block: 'center' }); }
})();
