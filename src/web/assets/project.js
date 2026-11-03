// 项目页 /p/作者/仓库名（2026-11-03 起和首页右侧详情栏同一份内容，见 bw.js 的 drawer）：整页放在白雾外壳里。
// 顶行写它在所在的第一个涨星榜上的名次（不在榜上写“项目页”）和数据日期；从收藏页直达某条 Skill 时滚到那一条并高亮。
(() => {
  const { D, esc, view, drawer, act, syncStars, status, move } = BW;
  const pg = D.page, host = document.getElementById('page');
  if (pg.missing) {
    host.innerHTML = `<div class="empty"><b>找不到这个项目</b>地址里的 ${esc(pg.repo)} 可能写错了，或者它还没有上过榜。<p><a class="btn" href="/">去看涨星榜</a></p></div>`;
    return;
  }
  // 不在涨星榜上时没有那次运行的数字，总 Star 取它所在榜单快照里的数。
  const it = view(pg.repo, pg.run);
  if (it.total == null) it.total = pg.total;
  const r = pg.ranks.find((x) => x.w === pg.win);
  const cur = r && { w: r.w, rank: r.rank, tie: r.tie, mv: move(r.mv), st: status(r) };
  host.innerHTML = drawer(it, { cur, w: r ? pg.win : null, page: pg });
  syncStars(host);
  document.addEventListener('click', act);
  const el = document.getElementById(decodeURIComponent(location.hash.slice(1)));
  if (el) { el.classList.add('hit'); el.scrollIntoView({ block: 'center' }); }
})();
