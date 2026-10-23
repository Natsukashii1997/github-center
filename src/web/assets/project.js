// 项目页（#14）：照冻结方案 t1b-pages-r1 的 design/t1b-pages/project.html。左边读（简介、使用条件带原文、Skill 列表超过 8 个折叠），
// 右边一直跟着的侧栏放这一期榜单的数字、走势、安装目标、复制安装指令（#7）、收藏（#8）。从收藏页直达某条 Skill 时先展开折叠区再滚过去。
(() => {
  const { $, $$, esc, I, D, q } = GC;
  const { backOf, avImg, name, cats, readOf, condList, skillList, sources, statStrip, chartOf, wireFavs, wireCopy, wireMore } = GP;
  const pg = D.page;
  const [href, label, nav] = backOf(q.get('from'));
  GC.topbar(nav);
  GC.setStatus(pg.top);
  const main = $('#main'), side = $('#side');
  if (pg.missing) {
    main.innerHTML = `<a class="back" href="${href}">${I.back}<span>${label}</span></a>${GC.emptyHTML('inbox', '找不到这个项目', '地址里的项目名可能写错了，或者它还没有上过榜。', [href, label.replace('返回', '去看')])}`;
    side.hidden = true;
    return;
  }
  const p = D.projects[pg.repo], run = pg.run ? p.runs[pg.run] : null;
  let target = D.ais[0][0], win = pg.win;
  main.innerHTML = `<a class="back" href="${href}">${I.back}<span>${label}</span></a>
    <div class="title">${avImg(p, 112)}<div><h2>${name(p)}</h2><div class="meta">${p.cats.length ? cats(p) : '<span>还没归类</span>'}${p.lang ? `<span>${esc(p.lang)}</span>` : ''}${p.created ? `<span>创建于 ${GC.md(GC.utc(p.created))}</span>` : ''}</div></div></div>
    <div class="ranks">${pg.ranks.length ? pg.ranks.map((r) => `<span>${r.label}第 ${r.rank} 名${r.tie ? '（并列）' : ''}</span>`).join('') : '<span>不在当前三个涨星榜的前 20 名里</span>'}</div>
    ${readOf(p, pg)}${condList(p, pg)}${skillList(p, pg)}${sources(pg)}`;
  side.innerHTML = `${statStrip(run, win)}${chartOf(run, win)}
    <div><span class="k">安装到</span><div data-target></div></div>
    <button class="btn btn-p btn-w" type="button" data-copy${p.installable ? '' : ' disabled title="项目资料还没读到，暂时不能生成安装指令"'}>${I.copy}<span>复制安装指令</span></button>
    <div class="acts"><button class="btn btn-g" type="button" data-fav data-fav-text data-fav-id="${esc(p.repo)}">${I.star}<span>收藏</span></button><a class="btn btn-g btn-i" href="https://github.com/${esc(p.repo)}" target="_blank" rel="noopener" title="在 GitHub 打开" aria-label="在 GitHub 打开">${I.external}</a></div>`;
  GC.seg($('[data-target]', side), D.ais, target, (t) => { target = t; }, 160);
  const copy = $('[data-copy]', side);
  copy.addEventListener('click', () => GC.copyInstall(copy, p, target));
  const fav = $('[data-fav]', side);
  GC.setFavBtn(fav, GC.favs.has(p.repo), true);
  fav.addEventListener('click', () => GC.toggleFav(p, null, fav));
  $$('button.stat', side).forEach((b) => b.addEventListener('click', () => { win = b.dataset.win; GC.sweepBars(side, win); }));
  wireFavs(main); wireCopy(main, () => target); wireMore(main);
  GC.anim(main, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 240 });
  GC.growBars(side);
  const hash = decodeURIComponent(location.hash.slice(1));
  if (hash) {
    const el = document.getElementById(hash);
    if (el?.closest('.skill-more')) $('.more', main)?.click();
    // 浏览器加载完会再按锚点贴顶滚一次（被顶栏挡住），所以加载完再居中一次。
    const center = () => el?.scrollIntoView({ block: 'center' });
    center();
    if (document.readyState !== 'complete') addEventListener('load', () => requestAnimationFrame(center), { once: true });
  }
})();
