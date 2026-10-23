// 其余页面候选（T1a 第二轮）共用的拼装函数。组件来自 app.js（冻结方案 t1b 的副本），这里只做新版式用到的组合；
// 收藏、复制只改内存和剪贴板（候选页没有账号）。
window.GP = (() => {
  const { D, I, $, $$, esc, num, wan, md, mdShort, iso, avatar, ownerOf, nameOf, projects, anim, dayAt, favs, favSkills, toggleFav, setFavBtn, WINDOWS, SPAN, AI } = GC;
  const P = (repo) => projects[repo];
  const project = (repo, from) => `project-1.html?repo=${encodeURIComponent(repo)}&from=${from}`;
  const cats = (p) => p.cats.map((c) => `<span>${esc(c)}</span>`).join('');
  const avImg = (p, s) => `<img class="av" alt="" loading="lazy" referrerpolicy="no-referrer" data-key="${esc(p.repo)}" src="${avatar(p, s)}">`;
  const name = (p) => `<span class="o">${esc(ownerOf(p))}/</span><span class="n">${esc(nameOf(p))}</span>`;
  const ds = (p) => (p.what == null ? '简介生成中' : p.what);
  const when = (at) => `收藏于 <span class="num">${GC.mdIso(at).replace(/(\d+) 月 (\d+) 日 /, '$1/$2 ')}</span>`;

  // 收藏按钮（行、卡、组里都用）
  function favBtn(p, skill) {
    const id = skill ? `${p.repo}#${skill}` : p.repo, on = (skill ? favSkills : favs).has(id);
    return `<button class="ib" type="button" data-fav="${esc(id)}" aria-pressed="${on}" aria-label="${on ? '取消收藏' : '收藏'}">${on ? I['star-fill'] : I.star}</button>`;
  }
  const wireFavs = (root) => $$('[data-fav]', root).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); toggleFav(b.dataset.fav, b); }));
  // 点行或卡进项目页（点按钮和链接不算）
  const wireOpen = (root) => $$('[data-href]', root).forEach((el) => el.addEventListener('click', (e) => { if (e.target.closest('button, a')) return; location.href = el.dataset.href; }));
  // 复制安装（整个项目或某个 Skill）
  const wireCopy = (root, target = () => 'claude') => $$('[data-copy-skill]', root).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); const repo = b.closest('[data-key]').dataset.key; GC.copyInstall(b, repo, target(), b.dataset.copySkill || undefined, true); }));
  // 列表进场：淡入上移、错峰
  const enter = (root, sel) => $$(sel, root).forEach((el, i) => anim(el, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 240, delay: Math.min(i % 20, 14) * 16, fill: 'backwards' }));

  // 紧凑行：名次、头像、名字、一句话、右侧主数字
  function compactRow(r, { number, sub, href, rank = r.rank }) {
    const p = P(r.repo);
    return `<li class="crow" data-key="${esc(r.repo)}" data-href="${href}"${rank <= 3 ? ' data-top' : ''}><div class="rk"><b>${rank}</b></div>${avImg(p, 48)}<div class="tx"><div class="nm" title="${esc(p.repo)}">${name(p)}</div><div class="ds" title="${esc(ds(p))}">${esc(ds(p))}</div></div><div class="nums"><div class="g">${number}</div>${sub ? `<div class="t">${sub}</div>` : ''}</div></li>`;
  }
  // 迷你走势：近 30 天每日新增，窗口内高亮；没有官方历史的项目写明
  function spark(p, span = 0) {
    if (!p.series) return '<div class="spark-none">暂无走势（没有这个项目的官方星数历史）</div>';
    const max = Math.max(...p.series.filter((v) => v != null), 1);
    return `<div class="spark" aria-hidden="true">${p.series.map((v, i) => `<i class="${i >= 30 - span ? 'on' : ''}" style="--h:${v == null ? 0 : (v / max) * 100}%;--m:${v > 0 ? 1 : 0}px" title="${md(dayAt(i))}：${v == null ? '缺数据' : num(v)}"></i>`).join('')}</div><div class="spark-k"><span>${mdShort(dayAt(0))}</span><span>最高一天 ${num(max)}</span><span>${mdShort(dayAt(29))}</span></div>`;
  }
  // 网格卡：项目或 Skill
  function gridCard(p, { rank, number, label, href, at, skill }) {
    const head = skill
      ? `<span class="skill-ic">${I.puzzle}</span><div class="tx"><div class="nm"><code>${esc(skill.name)}</code></div><div class="ds">来自 ${esc(p.repo)}</div></div>`
      : `${avImg(p, 80)}<div class="tx"><div class="nm" title="${esc(p.repo)}">${name(p)}</div></div>`;
    return `<article class="gcard" data-key="${esc(p.repo)}" data-href="${href}"${rank && rank <= 3 ? ' data-top' : ''}>${rank ? `<span class="rkb">第 ${rank} 名</span>` : ''}<div class="head">${head}</div><div class="ds">${esc(skill ? skill.desc : ds(p))}</div><div class="tg">${cats(p)}</div><div class="big"><div>${number ? `<div class="g">${number}</div>` : ''}${label ? `<div class="t">${label}</div>` : ''}${at ? `<span class="when">${when(at)}</span>` : ''}</div><div class="acts"><button class="btn btn-g btn-s" type="button" data-copy-skill="${skill ? esc(skill.name) : ''}">${I.copy}<span>复制安装</span></button>${favBtn(p, skill?.name)}</div></div></article>`;
  }
  // 四个统计数（三个窗口新增 + 总 Star），asButtons 时点哪个高亮哪个
  function statStrip(p, win, asButtons) {
    const tag = asButtons ? 'button' : 'div';
    const g = (w) => GC.gainOf(p, w);
    return `<div class="stats">${WINDOWS.map((w) => `<${tag} class="stat"${asButtons ? ` type="button" data-win="${w.id}" aria-pressed="${w.id === win}"` : ''}${w.id === win ? ' data-on' : ''}><span class="k">${w.label}新增</span><span class="v">${g(w.id) == null ? '暂缺' : `+${num(g(w.id))}`}</span></${tag}>`).join('')}<div class="stat"><span class="k">总 Star</span><span class="v">${p.total == null ? '暂缺' : wan(p.total)}</span></div></div>`;
  }
  // 近 30 天走势（和阅读卡同一画法）
  function chartOf(p, win) {
    if (!p.series) return '<div class="chart"><div class="chart-k"><span>近 30 天每日新增</span><span>暂缺</span></div><div class="spark-none">没有这个项目的官方星数历史。</div></div>';
    const span = win ? SPAN[win] : 0, max = Math.max(...p.series.filter((v) => v != null), 1);
    return `<div class="chart"><div class="chart-k"><span>近 30 天每日新增</span><span>最高一天 <span class="num">${num(max)}</span></span></div>
      <div class="cbars" aria-hidden="true">${p.series.map((v, i) => `<i class="${i >= 30 - span ? 'on' : ''}" style="--h:${v == null ? 0 : (v / max) * 100}%;--m:${v > 0 ? 1 : 0}px" title="${md(dayAt(i))}：${v == null ? '缺数据' : num(v)}"></i>`).join('')}</div>
      <div class="cdates" aria-hidden="true"><span>${mdShort(dayAt(0))}</span><span>${mdShort(dayAt(15))}</span><span>${mdShort(dayAt(29))}</span></div></div>`;
  }
  // 简介两句（没生成好就是“生成中”）
  const readOf = (p) => (p.what == null
    ? `<div class="gen">${I.sparkle}<span>简介生成中，通常几分钟内完成；下面的数字已是官方数据。</span></div><div class="gen-lines"><span class="sk" style="width:92%;height:14px"></span><span class="sk" style="width:76%;height:14px"></span></div>`
    : `<div class="read"><div><div class="k">它是做什么的</div><p>${esc(p.what)}</p></div><div><div class="k">解决什么问题</div><p>${esc(p.problem)}</p></div></div>`);
  // 使用条件清单：每条带类别和原文摘录
  const condList = (p) => (p.what == null ? '' : `<div class="conds"><span class="sec-k">使用条件${p.conditions.length ? ` · ${p.conditions.length} 条` : ''}</span>${p.conditions.length
    ? p.conditions.map((c) => `<div class="cond-i"><span class="kind">${esc(c.kind)}</span><div>${esc(c.text)}<span class="q">原文：${esc(c.quote)}</span></div></div>`).join('')
    : '<div class="cond-i"><span class="kind"></span><div>在读到的项目文档里没有找到付费、账号、密钥或特定环境的要求。</div></div>'}</div>`);
  // Skill 列表（和阅读卡同一结构）
  const skillList = (p, { target = () => 'claude' } = {}) => (p.skills.length ? `<div class="skills"><div class="sec-k">包含的 Skill · ${p.skills.length} 个</div>${p.skills.map((s) => {
    const id = `${p.repo}#${s.name}`, on = favSkills.has(id);
    return `<div class="skill" id="skill-${esc(s.name)}"><code>${esc(s.name)}</code><span>${esc(s.desc)}</span><span class="acts"><button class="ib" type="button" data-fav="${esc(id)}" aria-pressed="${on}" aria-label="${on ? '取消收藏' : '收藏'}">${on ? I['star-fill'] : I.star}</button><button class="btn btn-g btn-s" type="button" data-copy-skill="${esc(s.name)}">${I.copy}<span>复制安装</span></button></span></div>`;
  }).join('')}</div>` : (p.hasProfile ? '<div class="skills"><div class="sec-k">包含的 Skill</div><p class="src">仓库里没有按 SKILL.md 约定写的 Skill。</p></div>' : ''));
  const sources = (p) => (p.sources ? `<p class="src">依据：${p.sources.readme ? esc(p.sources.readme) : '仓库里没有 README'}${p.sources.docs.length ? `、${p.sources.docs.map(esc).join('、')}` : ''}、仓库目录和 Skill 文件，读取于 ${md(new Date(p.sources.fetchedAt))}${p.sources.generatedAt ? '；简介和使用条件由 AI 根据项目原文生成，每条使用条件都附原文' : ''}。所有数字来自 GitHub 官方数据。</p>` : '<p class="src">项目资料还没读到：简介、使用条件和 Skill 列表会在每天出榜后补上。所有数字来自 GitHub 官方数据。</p>');
  // 项目在三个涨星榜里的名次
  const ranksOf = (repo) => WINDOWS.map((w) => [w, D.gainers[w.id].find((r) => r.repo === repo)]).filter(([, r]) => r);
  // 日报条目：第一次出现写简介，再出现写“见上”
  function ditem(r, { id, first, href, extra = '' }) {
    const p = P(r.repo);
    const body = first ? `<div class="seeup">见上：<a href="#${first.id}">${first.label}</a></div>`
      : `<p>${esc(ds(p))}${p.problem ? ` ${esc(p.problem)}` : ''}</p><div class="tg">${cats(p)}<span>总 Star ${p.total == null ? '暂缺' : wan(p.total)}</span></div>${extra}`;
    return `<li class="ditem" id="${id}"><div class="rk"><b>${r.rank}</b></div><div class="tx"><div class="head">${avImg(p, 48)}<div class="nm"><a href="${href}">${name(p)}</a></div></div>${body}</div><div class="g"><small>+</small>${num(r.gain)}</div></li>`;
  }
  // 三个窗口的前 10，按近 1、7、30 天顺序去重
  function dailySections() {
    const seen = new Map();
    return WINDOWS.map((w) => ({ w, items: D.gainers[w.id].slice(0, 10).map((r) => {
      const first = seen.get(r.repo);
      if (!first) seen.set(r.repo, { id: `${w.id}-${r.rank}`, label: `${w.label}第 ${r.rank} 名` });
      return { r, first, id: `${w.id}-${r.rank}` };
    }) }));
  }
  const relRow = (r, from) => `<div class="rel"><span class="num">${mdShort(iso(r.date))}</span><span><a href="${project(r.repo, from)}">${esc(r.repo)}</a><code>${esc(r.tag)}</code></span><a class="out" href="${esc(r.url)}" target="_blank" rel="noopener">${I.external}<span>Release</span></a></div>`;
  // 收藏项（示例数据）配上项目
  const favItems = () => D.favorites.map((f) => ({ ...f, p: P(f.repo), skill: f.type === 'skill' ? P(f.repo).skills.find((s) => s.name === f.skill) ?? { name: f.skill, desc: '' } : null }));
  // 登录页共用：显示密码、失败摇动、提交演示
  function wireLogin(form) {
    const err = $('.err', form), btn = $('[type="submit"]', form), peek = $('#peek', form), pass = $('#pass', form), user = $('#user', form);
    if (peek) { peek.innerHTML = I.eye; peek.addEventListener('click', () => { const show = pass.type === 'password'; pass.type = show ? 'text' : 'password'; peek.innerHTML = show ? I['eye-off'] : I.eye; peek.setAttribute('aria-label', show ? '隐藏密码' : '显示密码'); }); }
    const fail = (msg) => { err.innerHTML = `${I.error}<span>${msg}</span>`; err.hidden = false; $$('.field', form).forEach((f) => f.toggleAttribute('data-error', true)); anim(form, [{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }], { duration: 280 }); };
    const reset = () => { err.hidden = true; $$('.field', form).forEach((f) => f.removeAttribute('data-error')); btn.disabled = false; btn.textContent = '登录'; };
    form.addEventListener('input', () => { if (!err.hidden) reset(); });
    // 候选页没有真实账号：提交后一律演示“登录失败”
    form.addEventListener('submit', (e) => { e.preventDefault(); if (!user.value || !pass.value) { fail('请填写用户名和密码。'); return; } btn.disabled = true; btn.textContent = '登录中'; setTimeout(() => { btn.disabled = false; btn.textContent = '登录'; fail('用户名或密码不对，请再试一次。'); }, 600); });
    if (GC.q.get('state') === 'failed') { user.value = 'changhao'; pass.value = 'xxxxxxxx'; fail('用户名或密码不对，请再试一次。'); }
  }
  const BACK = { daily: ['daily-1.html', '返回日报', '日报'], favorites: ['favorites-1.html', '返回我的收藏', '我的收藏'], boards: ['boards-1.html', '返回其他榜单', '其他榜单'] };
  const backOf = (from) => BACK[from] || ['../../t1b/index.html', '返回涨星榜', '涨星榜'];
  const pick = () => P(GC.q.get('repo')) || P(D.gainers.d1[0].repo);
  return { P, project, cats, avImg, name, ds, when, favBtn, wireFavs, wireOpen, wireCopy, enter, compactRow, spark, gridCard, statStrip, chartOf, readOf, condList, skillList, sources, ranksOf, ditem, dailySections, relRow, favItems, wireLogin, backOf, pick, AI };
})();
