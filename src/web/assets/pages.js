// 其余 5 页共用的拼装（#14）：照冻结方案 t1b-pages-r1 的 design/t1b-pages/pages.js 落地。组件来自 gc.js；数据是页面里嵌入的真实快照
// 与项目资料（服务端 src/web/pages.js 整理）；收藏走 /api/favorites、安装指令走 /api/install（都在 gc.js 里）。
window.GP = (() => {
  const { D, I, $, $$, esc, num, wan, md, mdShort, anim, avatar, ownerOf, nameOf, favs, favSkills, toggleFav, copyInstall, WINDOWS, SPAN, chartHTML, dayAt, utc } = GC;
  const P = (repo) => D.projects[repo];
  const project = (repo, from) => `/p/${repo}?from=${from}`;
  const cats = (p) => p.cats.map((c) => `<span>${esc(c)}</span>`).join('');
  const avImg = (p, s) => `<img class="av" alt="" loading="lazy" referrerpolicy="no-referrer" data-key="${esc(p.repo)}" src="${avatar(p, s)}">`;
  const name = (p) => `<span class="o">${esc(ownerOf(p))}/</span><span class="n">${esc(nameOf(p))}</span>`;
  const link = (p, href, external) => `<a href="${esc(href)}"${external ? ' target="_blank" rel="noopener"' : ''}>${name(p)}</a>`;
  const ds = (p) => (p.what == null ? '简介生成中' : p.what);
  // 北京时间：M/D HH:MM（收藏时间）与 M 月 D 日 HH:MM（依据行）
  const bj = (iso) => new Date(Date.parse(iso) + 8 * 3600e3);
  const when = (iso) => { const d = bj(iso); return `收藏于 <span class="num">${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}</span>`; };
  const bjLong = (iso) => { const d = bj(iso); return `${md(d)} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
  const FOLD = 8;   // Skill 列表先列几个
  const skillOf = (p, path) => p.skills.find((s) => s.path === path) ?? { path, name: path.split('/').pop() };

  // 收藏按钮（行、卡、Skill 行都用）：写成功后 gc.js 会把页面上同一个 id 的按钮一起改
  function favBtn(p, skill) {
    const id = skill ? `${p.repo}#${skill.path}` : p.repo, on = (skill ? favSkills : favs).has(id);
    return `<button class="ib" type="button" data-fav-id="${esc(id)}" data-fav-repo="${esc(p.repo)}"${skill ? ` data-fav-skill="${esc(skill.path)}"` : ''} aria-pressed="${on}" aria-label="${on ? '取消收藏' : '收藏'}">${on ? I['star-fill'] : I.star}</button>`;
  }
  const wireFavs = (root, after) => $$('[data-fav-repo]', root).forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation(); e.preventDefault();
    const p = P(b.dataset.favRepo);
    await toggleFav(p, b.dataset.favSkill ? skillOf(p, b.dataset.favSkill) : null, b);
    after?.(b);
  }));
  // 点行或卡进项目页（点按钮和链接不算；名字本身是链接，键盘用 Tab 能到）
  const wireOpen = (root) => $$('[data-href]', root).forEach((el) => el.addEventListener('click', (e) => { if (e.target.closest('button, a')) return; location.href = el.dataset.href; }));
  // 复制安装（整个项目或某个 Skill）
  const wireCopy = (root, target) => $$('[data-copy-skill]', root).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); const p = P(b.closest('[data-key]').dataset.key); copyInstall(b, p, target(), b.dataset.copySkill ? skillOf(p, b.dataset.copySkill) : undefined, true); }));
  // 列表进场：淡入上移、错峰（最多错 14 档）
  const enter = (root, sel) => $$(sel, root).forEach((el, i) => anim(el, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 240, delay: Math.min(i % 20, 14) * 16, fill: 'backwards' }));
  // Skill 列表折叠：展开时其余行错峰进场，收起直接藏
  const wireMore = (root) => $$('.more', root).forEach((b) => b.addEventListener('click', () => {
    const box = b.previousElementSibling, open = box.hidden;
    box.hidden = !open;
    b.setAttribute('aria-expanded', open);
    $('span', b).textContent = open ? '收起' : `展开其余 ${b.dataset.rest} 个`;
    if (open) enter(box, '.skill');
  }));

  // 紧凑行：名次、头像、名字（链接）、一句话、右侧主数字
  function compactRow(r, { number, sub, href, rank = r.rank }) {
    const p = P(r.repo);
    return `<li class="crow" data-key="${esc(r.repo)}" data-href="${esc(href)}"${rank <= 3 ? ' data-top' : ''}><div class="rk"><b>${rank}</b></div>${avImg(p, 48)}<div class="tx"><div class="nm" title="${esc(p.repo)}">${link(p, href)}</div><div class="ds" title="${esc(ds(p))}">${esc(ds(p))}</div></div><div class="nums"><div class="g">${number}</div>${sub ? `<div class="t">${sub}</div>` : ''}</div></li>`;
  }
  // 迷你走势（日报主条目）：这一期榜单那次运行的近 30 天每日新增，窗口内高亮；缺数据的那天留空位；没有官方历史的项目写明
  function spark(run, span = 0) {
    if (!run?.series) return '<div class="spark-none">暂无走势（没有这个项目的官方星数历史）</div>';
    const known = run.series.filter((v) => v != null), max = Math.max(...known, 1);
    return `<div class="spark" aria-hidden="true">${run.series.map((v, i) => `<i class="${i >= 30 - span ? 'on' : ''}" style="--h:${v == null ? 0 : (v / max) * 100}%;--m:${v > 0 ? 1 : 0}px" title="${md(dayAt(run, i))}：${v == null ? '缺数据' : num(v)}"></i>`).join('')}</div><div class="spark-k"><span>${mdShort(dayAt(run, 0))}</span><span>最高一天 ${num(max)}</span><span>${mdShort(dayAt(run, 29))}</span></div>`;
  }
  // 网格卡：项目或 Skill；warn 写明异常（Skill 已不在、项目改名、资料没读到或已不在），noCopy 时不给复制按钮，external 时名字链到 GitHub
  function gridCard(p, { href, at, skill, label, warn, noCopy, external }) {
    const head = skill
      ? `<span class="skill-ic">${I.puzzle}</span><div class="tx"><div class="nm"><a href="${esc(href)}"${external ? ' target="_blank" rel="noopener"' : ''}><code>${esc(skill.name)}</code></a></div><div class="ds">来自 ${esc(p.repo)}</div></div>`
      : `${avImg(p, 80)}<div class="tx"><div class="nm" title="${esc(p.repo)}">${link(p, href, external)}</div></div>`;
    const body = warn ? `<div class="warn">${I.warn}<span>${esc(warn)}</span></div>` : `<div class="ds">${esc(skill ? skill.desc : ds(p))}</div>`;
    return `<article class="gcard" data-key="${esc(p.repo)}"${external ? '' : ` data-href="${esc(href)}"`}><div class="head">${head}</div>${body}<div class="tg">${cats(p)}</div><div class="big"><div>${label ? `<div class="t">${label}</div>` : ''}${at ? `<span class="when">${when(at)}</span>` : ''}</div><div class="acts">${noCopy ? '' : `<button class="btn btn-g btn-s" type="button" data-copy-skill="${skill ? esc(skill.path) : ''}">${I.copy}<span>复制安装</span></button>`}${favBtn(p, skill)}</div></div></article>`;
  }
  // 四个统计数（三个窗口是按钮，点哪个走势高亮哪个）＋总 Star；run 是这一期榜单那次运行的数字，不在涨星榜上就全写“暂缺”
  function statStrip(run, win) {
    return `<div class="stats">${WINDOWS.map((w) => `<button class="stat" type="button" data-win="${w.id}" aria-pressed="${w.id === win}"${w.id === win ? ' data-on' : ''}><span class="k">${w.label}新增</span><span class="v">${run?.gains?.[w.id] == null ? '暂缺' : `+${num(run.gains[w.id])}`}</span></button>`).join('')}<div class="stat"><span class="k">总 Star</span><span class="v">${run?.total == null ? '暂缺' : wan(run.total)}</span></div></div>`;
  }
  // 近 30 天走势（和首页阅读卡同一画法，含读屏摘要）
  const chartOf = (run, win) => (run?.series ? chartHTML(run, SPAN[win]) : '<div class="chart"><div class="chart-k"><span>近 30 天每日新增</span><span>暂缺</span></div><div class="spark-none">没有这个项目的官方星数历史。</div></div>');
  // 简介两句；没生成好是“生成中”，资料没读到另说明
  const readOf = (p, page) => (!page.hasProfile
    ? `<div class="gen" data-tone="muted">${I.inbox}<span>项目资料还没读到，简介、使用条件和 Skill 列表会在每天出榜后补上；旁边的数字已是官方数据。</span></div>`
    : p.what == null
      ? `<div class="gen">${I.sparkle}<span>简介生成中，通常几分钟内完成；旁边的数字已是官方数据。</span></div><div class="gen-lines"><span class="sk" style="width:92%;height:14px"></span><span class="sk" style="width:76%;height:14px"></span></div>`
      : `<div class="read"><div><div class="k">它是做什么的</div><p>${esc(p.what)}</p></div><div><div class="k">解决什么问题</div><p>${esc(p.problem)}</p></div></div>`);
  // 使用条件清单：每条带类别、整理后的一句话和原文摘录（#6 验收）；核对不到的只写明丢了几条；没读到资料或还在生成时不列
  const condList = (p, page) => (!page.hasProfile || p.what == null ? '' : `<div class="conds"><span class="sec-k">使用条件${page.conditions.length ? ` · ${page.conditions.length} 条` : ''}</span>${page.conditions.length
    ? page.conditions.map((c) => `<div class="cond-i"><span class="kind">${esc(c.kind)}</span><div>${esc(c.text)}<span class="q">原文：${esc(c.quote)}</span></div></div>`).join('')
    : '<div class="cond-i"><span class="kind"></span><div>在读到的项目文档里没有找到付费、账号、密钥或特定环境的要求。</div></div>'}${page.dropped ? `<p class="src">另有 ${page.dropped} 条 AI 整理出的条件在原文里核对不到，没有列出。</p>` : ''}${page.truncatedDocs ? '<p class="src">有的文档较长，只读了开头部分，后面写到的条件可能没有列出。</p>' : ''}</div>`);
  // Skill 列表：超过 8 个先列 8 个，其余折叠；资料没读到时不列
  function skillList(p, page) {
    if (!page.hasProfile) return '';
    if (!p.skills.length) return `<div class="skills" data-key="${esc(p.repo)}"><div class="sec-k">包含的 Skill</div><p class="src">仓库里没有按 SKILL.md 约定写的 Skill。${page.skillsTruncated ? '仓库太大，Skill 列表可能不全。' : ''}</p></div>`;
    const row = (s) => `<div class="skill" id="skill-${esc(s.path)}"><code>${esc(s.name)}</code><span>${esc(s.desc)}</span><span class="acts">${favBtn(p, s)}<button class="btn btn-g btn-s" type="button" data-copy-skill="${esc(s.path)}"${p.installable ? '' : ' disabled'}>${I.copy}<span>复制安装</span></button></span></div>`;
    const head = p.skills.slice(0, FOLD), rest = p.skills.slice(FOLD);
    return `<div class="skills" data-key="${esc(p.repo)}"><div class="sec-k">包含的 Skill · ${p.skills.length} 个</div>${head.map(row).join('')}${rest.length ? `<div class="skill-more" hidden>${rest.map(row).join('')}</div><button class="btn btn-g btn-s more" type="button" aria-expanded="false" data-rest="${rest.length}"><span>展开其余 ${rest.length} 个</span></button>` : ''}${page.skillsTruncated ? '<p class="src">仓库太大，Skill 列表可能不全。</p>' : ''}</div>`;
  }
  const sources = (page) => (page.sources
    ? `<p class="src">依据：${page.sources.readme ? `<a href="${esc(page.sources.readme.url)}" target="_blank" rel="noopener">${esc(page.sources.readme.path)}</a>` : '仓库里没有 README'}${page.sources.docs.length ? `、${page.sources.docs.map(esc).join('、')}` : ''}、仓库目录和 Skill 文件，读取于 ${bjLong(page.sources.fetchedAt)}（北京时间）${page.sources.generatedAt ? `；简介和使用条件由 AI 根据项目原文生成于 ${bjLong(page.sources.generatedAt)}，每条使用条件都附原文` : ''}。所有数字来自 GitHub 官方数据。</p>`
    : '<p class="src">所有数字来自 GitHub 官方数据。</p>');
  // 日报条目：名次、头像与名字链接、两句简介、分类与总 Star、迷你走势、右侧新增数
  function ditem(r, { id, href, run }) {
    const p = P(r.repo);
    return `<li class="ditem" id="${id}"><div class="rk"><b>${r.rank}</b>${r.tie ? '<i>并列</i>' : ''}</div><div class="tx"><div class="head">${avImg(p, 48)}<div class="nm"><a href="${esc(href)}">${name(p)}</a></div></div><p>${esc(ds(p))}${p.problem ? ` ${esc(p.problem)}` : ''}</p><div class="tg">${cats(p)}<span>总 Star ${run?.total == null ? '暂缺' : wan(run.total)}</span></div>${spark(run, 1)}</div><div class="g"><small>+</small>${num(r.gain)}</div></li>`;
  }
  // 登录页：显示密码；服务端已判定失败时表单轻摆，再输入时清掉错误样式
  function wireLogin(form) {
    const err = $('.err', form), peek = $('#peek', form), pass = $('#pass', form);
    if (peek) { peek.innerHTML = I.eye; peek.addEventListener('click', () => { const show = pass.type === 'password'; pass.type = show ? 'text' : 'password'; peek.innerHTML = show ? I['eye-off'] : I.eye; peek.setAttribute('aria-label', show ? '隐藏密码' : '显示密码'); }); }
    if (!err.hidden) anim(form, [{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }], { duration: 280 });
    form.addEventListener('input', () => { if (!err.hidden) { err.hidden = true; $$('.field', form).forEach((f) => f.removeAttribute('data-error')); } });
    form.addEventListener('submit', () => { const btn = $('[type="submit"]', form); btn.disabled = true; btn.textContent = '登录中'; });
  }
  const BACK = { boards: ['/boards', '返回其他榜单', '其他榜单'], daily: ['/daily', '返回日报', '日报'], favorites: ['/favorites', '返回我的收藏', '我的收藏'] };
  const backOf = (from) => BACK[from] || ['/', '返回涨星榜', '涨星榜'];
  const phead = (title, lede) => `<div class="phead"><h1>${esc(title)}</h1><p class="lede">${lede}</p></div>`;
  return { P, project, cats, avImg, name, link, ds, when, favBtn, wireFavs, wireOpen, wireCopy, wireMore, enter, compactRow, spark, gridCard, statStrip, chartOf, readOf, condList, skillList, sources, ditem, wireLogin, backOf, phead, skillOf, FOLD };
})();
