// 我的收藏（#14）：照冻结方案 t1b-pages-r1 的 design/t1b-pages/favorites.html。项目和 Skill 都是一张卡，卡上直接复制安装、取消收藏；
// 胶囊按种类筛。Skill 卡直达项目页上那一条；项目改名、Skill 已不在仓库、项目资料没读到或已不在都写明（#8），也都能取消。
(() => {
  const { $, $$, esc, I, D } = GC;
  const { P, gridCard, wireOpen, wireCopy, wireFavs, enter, project } = GP;
  GC.topbar('我的收藏');
  GC.setStatus(D.top);
  let kind = null, items = D.items;
  const el = $('#kinds');
  el.classList.add('chips');
  el.innerHTML = [[null, '全部'], ['repo', '项目'], ['skill', 'Skill']].map(([k, t]) => `<button type="button" data-k="${k || ''}">${t}</button>`).join('');
  $$('button', el).forEach((b) => b.addEventListener('click', () => { kind = b.dataset.k || null; render(); }));
  const idOf = (f) => (f.skill ? `${f.repo}#${f.skill.path}` : f.repo);
  const card = (f) => {
    const p = P(f.repo);
    const href = f.openable ? project(f.repo, 'favorites') : `https://github.com/${f.repo}`;
    if (f.skill) return gridCard(p, { href: f.skill.missing || !f.openable ? href : `${href}#skill-${encodeURIComponent(f.skill.path)}`, at: f.at, skill: { ...f.skill, desc: f.skill.desc ?? '' }, warn: !f.openable ? '项目资料已不在，站内页面打不开；可以在 GitHub 打开，或取消收藏。' : f.skill.missing ? '这个 Skill 已不在仓库里，可能改名或删除了；可以取消收藏。' : '', noCopy: f.skill.missing || !p.installable, external: !f.openable });
    const warn = !f.openable ? '项目资料已不在，站内页面打不开；可以在 GitHub 打开，或取消收藏。' : f.renamed ? `收藏时叫 ${f.savedName}，项目已改名；点进去看的是新名字的页面。` : f.catOnly ? '只上了分类榜的项目不生成简介和 Skill 列表。' : !f.hasProfile ? '项目资料还没读到，简介和 Skill 列表会在每天出榜后补上。' : '';
    return gridCard(p, { href, at: f.at, warn, noCopy: !p.installable, external: !f.openable, label: `总 Star ${f.total == null ? '暂缺' : GC.wan(f.total)}` });
  };
  function render() {
    $$('button', el).forEach((b) => b.setAttribute('aria-pressed', (b.dataset.k || null) === kind));
    const grid = $('#grid');
    const shown = items.filter((f) => !kind || (kind === 'skill') === Boolean(f.skill));
    const repos = items.filter((f) => !f.skill).length, skills = items.length - repos;
    $('#lede').textContent = items.length ? `${repos} 个项目，${skills} 个 Skill。按收藏时间从新到旧排；只有你自己看得到。` : '只有你自己看得到。';
    grid.innerHTML = shown.length ? shown.map(card).join('')
      : items.length ? GC.emptyHTML('inbox', kind === 'repo' ? '还没有收藏项目' : '还没有收藏 Skill', '换个种类看看，或者去项目页收藏。')
        : GC.emptyHTML('star', '还没有收藏', '在榜单或项目页点星标，就会收在这里。', ['/', '去看涨星榜']);
    wireOpen(grid); wireCopy(grid, () => D.ais[0][0]);
    // 取消收藏：写成功后卡片右移淡出，再从网格里拿掉
    wireFavs(grid, (b) => {
      const id = b.dataset.favId;
      if (GC.favs.has(id) || GC.favSkills.has(id)) return;
      GC.anim(b.closest('.gcard'), [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(8px)' }], { duration: 160, easing: 'cubic-bezier(.5, 0, .75, 0)', fill: 'forwards' });
      setTimeout(() => { items = items.filter((f) => idOf(f) !== id); render(); }, GC.reduced() ? 0 : 160);
    });
    enter(grid, '.gcard');
  }
  render();
})();
