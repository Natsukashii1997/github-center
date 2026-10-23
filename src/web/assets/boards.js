// 其他榜单（#14）：照冻结方案 t1b-pages-r1 的 design/t1b-pages/boards.html。新项目榜、官方热门榜（日/周/月）、累计高星榜并排各前 20；
// 分类胶囊同时筛三个榜（#10，在榜内过滤、名次重排，写明没归类的个数）；换周期、换分类只在本页重画。
(() => {
  const { $, $$, esc, num, wan, I, D, q } = GC;
  const { P, compactRow, wireOpen, enter, project } = GP;
  const PER = [['daily', '日榜', '今日'], ['weekly', '周榜', '本周'], ['monthly', '月榜', '本月']];
  let cat = D.cats.includes(q.get('cat')) ? q.get('cat') : null, period = PER.some(([id]) => id === q.get('since')) ? q.get('since') : 'daily';
  GC.topbar('其他榜单');
  GC.setStatus(D.top);
  $('#lede').innerHTML = D.day ? `统计日 ${GC.md(GC.utc(D.day))}（UTC）。三个榜各前 20 名，末位并列一起列出；点项目进项目页。` : '每天统计日结束后自动生成。';
  GC.notes($('#notes'), D.notes);
  const placeCat = GC.chips($('#cats'), cat, (c) => { if (c !== cat) { cat = c; render(); } });
  const head = (title, sub) => `<div class="col-h"><h2>${title}</h2><p class="sub">${sub}</p></div>`;
  const remember = () => {
    const u = new URL(location.href);
    if (cat) u.searchParams.set('cat', cat); else u.searchParams.delete('cat');
    if (period !== 'daily') u.searchParams.set('since', period); else u.searchParams.delete('since');
    history.replaceState(null, '', u);
  };

  function col(id, title, sub, list, rows, number, subn, extra = '', foot = '') {
    if (!list) return `<section class="col" id="${id}" aria-label="${title}">${head(title, sub)}${extra}${GC.emptyHTML('inbox', `还没有${title}`, '每天统计日结束后自动生成。')}</section>`;
    const shown = rows.filter((r) => !cat || P(r.repo).cats.includes(cat));
    const notes = [];
    if (cat && shown.length && shown.length < 20) notes.push(`<div class="note">${I.tag}<b>不足 20 个</b><p>「${esc(cat)}」在本榜只有 ${shown.length} 个项目，全部列出。</p></div>`);
    const un = cat ? rows.filter((r) => !P(r.repo).cats.length).length : 0;
    if (un) notes.push(`<div class="note">${I.sparkle}<b>还没归类</b><p>本榜还有 ${un} 个项目没归类，归好后按分类列出。</p></div>`);
    const empty = shown.length ? '' : GC.emptyHTML('inbox', '这个分类在本榜没有项目', '换个分类看看。');
    return `<section class="col" id="${id}" aria-label="${title}">${head(title, sub)}${extra}${notes.join('')}${empty}<ol class="crows">${shown.map((r, i) => compactRow(r, { rank: cat ? i + 1 : r.rank, number: number(r), sub: subn(r), href: project(r.repo, 'boards') })).join('')}</ol>${foot}</section>`;
  }
  function render() {
    placeCat(cat);
    const L = D.lists, word = PER.find((x) => x[0] === period)[2];
    const hot = L.trending?.pages[period];
    $('#three').innerHTML = [
      col('new', '新项目榜', '近 30 天创建 · 按总 Star', L.new, L.new?.entries ?? [], (r) => num(r.total), (r) => `创建于 <span class="num">${GC.mdShort(GC.utc(r.created))}</span>`, '', L.new ? `<p class="foot">${GC.md(GC.utc(L.new.from))}至 ${GC.md(GC.utc(L.new.statDay))}（UTC）创建的项目，含 fork。${esc(D.searchNote)}</p>` : ''),
      col('trending', '官方热门榜', 'GitHub Trending 原样顺序', L.trending, hot?.entries ?? [], (r) => (r.gain == null ? '暂缺' : `<small>+</small>${num(r.gain)}`), () => `${word}新增`, '<div id="period" role="group" aria-label="热门榜周期"></div>', hot ? `<p class="foot">官方 Trending 原样排序，全部语言；排序规则由 GitHub 决定，不是纯涨星。新增数是官方页面上标注的数字${hot.count > 20 ? `；官方页面共 ${hot.count} 个，这里列前 20 个` : ''}。</p>` : ''),
      col('top', '累计高星榜', '全站按总 Star', L.top, L.top?.entries ?? [], (r) => wan(r.total), () => '总 Star', '', L.top ? `<p class="foot">${esc(D.searchNote)}</p>` : ''),
    ].join('');
    if (L.trending) GC.seg($('#period'), PER.map(([id, t]) => [id, t]), period, (id) => { period = id; render(); }, 56);
    wireOpen($('#three'));
    enter($('#three'), '.crow');
    remember();
  }
  render();
})();
