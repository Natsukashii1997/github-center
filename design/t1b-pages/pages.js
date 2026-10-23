// 其余 5 页 T1b 共用的拼装函数。组件来自 app.js（冻结方案 t1b 的副本），这里只做这 5 页用到的组合；
// 收藏、复制只改内存和剪贴板（样稿没有账号）。页面状态用地址参数 ?state= 切换（loading / partial / failed 各页通用，
// 另有 project：generating / noprofile / missing，daily：empty，favorites：empty / edge），?theme=dark 看深色。
window.GP = (() => {
  const { D, I, $, $$, esc, num, wan, md, mdShort, iso, avatar, ownerOf, nameOf, projects, anim, dayAt, favs, favSkills, toggleFav, WINDOWS, SPAN, AI } = GC;
  const P = (repo) => projects[repo];
  const project = (repo, from) => `project.html?repo=${encodeURIComponent(repo)}&from=${from}`;
  const state = () => GC.q.get('state') || 'ok';
  const status = (st) => (GC.STATUS[st] ? st : 'ok');   // 顶栏状态点与提示条只认 ok / partial / failed，其余状态按正常
  const cats = (p) => p.cats.map((c) => `<span>${esc(c)}</span>`).join('');
  const avImg = (p, s) => `<img class="av" alt="" loading="lazy" referrerpolicy="no-referrer" data-key="${esc(p.repo)}" src="${avatar(p, s)}">`;
  const name = (p) => `<span class="o">${esc(ownerOf(p))}/</span><span class="n">${esc(nameOf(p))}</span>`;
  const link = (p, href) => `<a href="${href}">${name(p)}</a>`;
  const ds = (p) => (p.what == null ? '简介生成中' : p.what);
  const when = (at) => `收藏于 <span class="num">${GC.mdIso(at).replace(/(\d+) 月 (\d+) 日 /, '$1/$2 ')}</span>`;
  const FOLD = 8;   // Skill 列表先列几个

  // 收藏按钮（行、卡、Skill 行都用）
  function favBtn(p, skill) {
    const id = skill ? `${p.repo}#${skill}` : p.repo, on = (skill ? favSkills : favs).has(id);
    return `<button class="ib" type="button" data-fav="${esc(id)}" aria-pressed="${on}" aria-label="${on ? '取消收藏' : '收藏'}">${on ? I['star-fill'] : I.star}</button>`;
  }
  const wireFavs = (root) => $$('[data-fav]', root).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); toggleFav(b.dataset.fav, b); }));
  // 点行或卡进项目页（点按钮和链接不算；名字本身是链接，键盘用 Tab 能到）
  const wireOpen = (root) => $$('[data-href]', root).forEach((el) => el.addEventListener('click', (e) => { if (e.target.closest('button, a')) return; location.href = el.dataset.href; }));
  // 复制安装（整个项目或某个 Skill）
  const wireCopy = (root, target = () => 'claude') => $$('[data-copy-skill]', root).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); const repo = b.closest('[data-key]').dataset.key; GC.copyInstall(b, repo, target(), b.dataset.copySkill || undefined, true); }));
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
    return `<li class="crow" data-key="${esc(r.repo)}" data-href="${href}"${rank <= 3 ? ' data-top' : ''}><div class="rk"><b>${rank}</b></div>${avImg(p, 48)}<div class="tx"><div class="nm" title="${esc(p.repo)}">${link(p, href)}</div><div class="ds" title="${esc(ds(p))}">${esc(ds(p))}</div></div><div class="nums"><div class="g">${number}</div>${sub ? `<div class="t">${sub}</div>` : ''}</div></li>`;
  }
  const crowSkeleton = (n) => Array.from({ length: n }, () => `<li class="crow is-sk" aria-hidden="true"><span class="sk" style="width:14px;justify-self:end"></span><span class="av"></span><div><span class="sk" style="width:58%"></span><span class="sk" style="width:84%;height:8px;margin-top:7px"></span></div><span class="sk" style="width:44px"></span></li>`).join('');
  // 迷你走势：近 30 天每日新增，窗口内高亮；没有官方历史的项目写明
  function spark(p, span = 0) {
    if (!p.series) return '<div class="spark-none">暂无走势（没有这个项目的官方星数历史）</div>';
    const max = Math.max(...p.series.filter((v) => v != null), 1);
    return `<div class="spark" aria-hidden="true">${p.series.map((v, i) => `<i class="${i >= 30 - span ? 'on' : ''}" style="--h:${v == null ? 0 : (v / max) * 100}%;--m:${v > 0 ? 1 : 0}px" title="${md(dayAt(i))}：${v == null ? '缺数据' : num(v)}"></i>`).join('')}</div><div class="spark-k"><span>${mdShort(dayAt(0))}</span><span>最高一天 ${num(max)}</span><span>${mdShort(dayAt(29))}</span></div>`;
  }
  // 网格卡：项目或 Skill；warn 写明异常（Skill 已不在、项目改名、资料没读到），noCopy 时不给复制按钮
  function gridCard(p, { href, at, skill, label, warn, noCopy }) {
    const head = skill
      ? `<span class="skill-ic">${I.puzzle}</span><div class="tx"><div class="nm"><a href="${href}"><code>${esc(skill.name)}</code></a></div><div class="ds">来自 ${esc(p.repo)}</div></div>`
      : `${avImg(p, 80)}<div class="tx"><div class="nm" title="${esc(p.repo)}">${link(p, href)}</div></div>`;
    const body = warn ? `<div class="warn">${I.warn}<span>${esc(warn)}</span></div>` : `<div class="ds">${esc(skill ? skill.desc : ds(p))}</div>`;
    return `<article class="gcard" data-key="${esc(p.repo)}" data-href="${href}"><div class="head">${head}</div>${body}<div class="tg">${cats(p)}</div><div class="big"><div>${label ? `<div class="t">${label}</div>` : ''}${at ? `<span class="when">${when(at)}</span>` : ''}</div><div class="acts">${noCopy ? '' : `<button class="btn btn-g btn-s" type="button" data-copy-skill="${skill ? esc(skill.name) : ''}">${I.copy}<span>复制安装</span></button>`}${favBtn(p, skill?.name)}</div></div></article>`;
  }
  const gcardSkeleton = (n) => Array.from({ length: n }, () => `<article class="gcard is-sk" aria-hidden="true"><div class="head"><span class="av"></span><div style="flex:1"><span class="sk" style="width:55%"></span></div></div><span class="sk" style="width:92%"></span><span class="sk" style="width:70%"></span><div class="big"><span class="sk" style="width:90px"></span><span class="sk" style="width:110px"></span></div></article>`).join('');
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
  // 项目页骨架：正文与侧栏各一份，位置和真实内容一致
  const mainSkeleton = () => `<div class="title"><span class="av" style="width:56px;height:56px"></span><div style="flex:1"><span class="sk" style="width:40%;height:22px"></span><span class="sk" style="width:30%;margin-top:10px"></span></div></div><div class="ranks"><span class="sk" style="width:120px;height:24px;border-radius:999px"></span><span class="sk" style="width:120px;height:24px;border-radius:999px"></span></div><div class="read"><div><span class="sk" style="width:80px"></span><span class="sk" style="width:100%;height:18px;margin-top:10px"></span><span class="sk" style="width:85%;height:18px;margin-top:10px"></span></div><div><span class="sk" style="width:80px"></span><span class="sk" style="width:100%;height:18px;margin-top:10px"></span><span class="sk" style="width:60%;height:18px;margin-top:10px"></span></div></div>`;
  const sideSkeleton = () => `<div class="stats">${Array.from({ length: 4 }, () => '<div class="stat"><span class="sk" style="width:52px"></span><span class="sk" style="width:72px;height:20px;margin-top:8px"></span></div>').join('')}</div><div><span class="sk" style="width:40%"></span><span class="sk" style="width:100%;height:76px;margin-top:10px"></span></div><span class="sk" style="width:100%;height:32px"></span><span class="sk" style="width:100%;height:40px"></span><span class="sk" style="width:100%;height:36px"></span>`;
  // 简介两句；没生成好是“生成中”，资料没读到另说明
  const readOf = (p) => (p.hasProfile === false
    ? `<div class="gen" data-tone="muted">${I.inbox}<span>项目资料还没读到，简介、使用条件和 Skill 列表会在每天出榜后补上；旁边的数字已是官方数据。</span></div>`
    : p.what == null
      ? `<div class="gen">${I.sparkle}<span>简介生成中，通常几分钟内完成；旁边的数字已是官方数据。</span></div><div class="gen-lines"><span class="sk" style="width:92%;height:14px"></span><span class="sk" style="width:76%;height:14px"></span></div>`
      : `<div class="read"><div><div class="k">它是做什么的</div><p>${esc(p.what)}</p></div><div><div class="k">解决什么问题</div><p>${esc(p.problem)}</p></div></div>`);
  // 使用条件清单：每条带类别、整理后的一句话和原文摘录；没读到资料或还在生成时不列
  const condList = (p) => (p.hasProfile === false || p.what == null ? '' : `<div class="conds"><span class="sec-k">使用条件${p.conditions.length ? ` · ${p.conditions.length} 条` : ''}</span>${p.conditions.length
    ? p.conditions.map((c) => `<div class="cond-i"><span class="kind">${esc(c.kind)}</span><div>${esc(c.text)}<span class="q">原文：${esc(c.quote)}</span></div></div>`).join('')
    : '<div class="cond-i"><span class="kind"></span><div>在读到的项目文档里没有找到付费、账号、密钥或特定环境的要求。</div></div>'}</div>`);
  // Skill 列表：超过 8 个先列 8 个，其余折叠；资料没读到时不列
  function skillList(p) {
    if (p.hasProfile === false) return '';
    if (!p.skills.length) return '<div class="skills"><div class="sec-k">包含的 Skill</div><p class="src">仓库里没有按 SKILL.md 约定写的 Skill。</p></div>';
    const row = (s) => {
      const id = `${p.repo}#${s.name}`, on = favSkills.has(id);
      return `<div class="skill" id="skill-${esc(s.name)}"><code>${esc(s.name)}</code><span>${esc(s.desc)}</span><span class="acts"><button class="ib" type="button" data-fav="${esc(id)}" aria-pressed="${on}" aria-label="${on ? '取消收藏' : '收藏'}">${on ? I['star-fill'] : I.star}</button><button class="btn btn-g btn-s" type="button" data-copy-skill="${esc(s.name)}">${I.copy}<span>复制安装</span></button></span></div>`;
    };
    const head = p.skills.slice(0, FOLD), rest = p.skills.slice(FOLD);
    return `<div class="skills"><div class="sec-k">包含的 Skill · ${p.skills.length} 个</div>${head.map(row).join('')}${rest.length ? `<div class="skill-more" hidden>${rest.map(row).join('')}</div><button class="btn btn-g btn-s more" type="button" aria-expanded="false" data-rest="${rest.length}"><span>展开其余 ${rest.length} 个</span></button>` : ''}</div>`;
  }
  const sources = (p) => (p.sources ? `<p class="src">依据：${p.sources.readme ? esc(p.sources.readme) : '仓库里没有 README'}${p.sources.docs.length ? `、${p.sources.docs.map(esc).join('、')}` : ''}、仓库目录和 Skill 文件，读取于 ${md(new Date(p.sources.fetchedAt))}${p.sources.generatedAt ? '；简介和使用条件由 AI 根据项目原文生成，每条使用条件都附原文' : ''}。所有数字来自 GitHub 官方数据。</p>` : '<p class="src">所有数字来自 GitHub 官方数据。</p>');
  // 项目在三个涨星榜里的名次
  const ranksOf = (repo) => WINDOWS.map((w) => [w, D.gainers[w.id].find((r) => r.repo === repo)]).filter(([, r]) => r);
  // 日报条目：第一次出现写简介，再出现写“见上”
  function ditem(r, { id, first, href, extra = '' }) {
    const p = P(r.repo);
    const body = first ? `<div class="seeup">见上：<a href="#${first.id}">${first.label}</a></div>`
      : `<p>${esc(ds(p))}${p.problem ? ` ${esc(p.problem)}` : ''}</p><div class="tg">${cats(p)}<span>总 Star ${p.total == null ? '暂缺' : wan(p.total)}</span></div>${extra}`;
    return `<li class="ditem" id="${id}"><div class="rk"><b>${r.rank}</b></div><div class="tx"><div class="head">${avImg(p, 48)}<div class="nm"><a href="${href}">${name(p)}</a></div></div>${body}</div><div class="g"><small>+</small>${num(r.gain)}</div></li>`;
  }
  const ditemSkeleton = (n) => Array.from({ length: n }, () => `<li class="ditem is-sk" aria-hidden="true"><div class="rk"><span class="sk" style="width:14px;margin-left:auto"></span></div><div class="tx"><div class="head"><span class="av"></span><span class="sk" style="width:40%"></span></div><span class="sk" style="width:95%;height:14px;margin-top:12px"></span><span class="sk" style="width:70%;height:14px;margin-top:8px"></span><span class="sk" style="width:100%;height:22px;margin-top:12px"></span></div><span class="sk" style="width:48px"></span></li>`).join('');
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
  // 收藏项（示例数据）配上项目；Skill 在仓库里找不到时标 missing
  const favItems = () => D.favorites.map((f) => ({ ...f, p: P(f.repo), skill: f.type === 'skill' ? P(f.repo).skills.find((s) => s.name === f.skill) ?? { name: f.skill, desc: '', missing: true } : null }));
  // 三种异常收藏的示例（?state=edge 时追加）：Skill 已不在、项目资料没读到、项目已改名
  const edgeItems = () => [
    { type: 'skill', repo: 'morluto/rea', at: '2026-10-18T11:20', p: P('morluto/rea'), skill: { name: 'rea-legacy-notes', desc: '', missing: true } },
    { type: 'repo', repo: 'NousResearch/hermes-agent', at: '2026-10-17T19:05', p: P('NousResearch/hermes-agent'), skill: null },
    { type: 'repo', repo: 'storytold/photocraft', at: '2026-10-16T08:12', p: P('storytold/photocraft'), skill: null, renamed: 'storytold/photocraft-studio' },
  ];
  // 登录页共用：显示密码、失败摇动、提交演示
  function wireLogin(form) {
    const err = $('.err', form), btn = $('[type="submit"]', form), peek = $('#peek', form), pass = $('#pass', form), user = $('#user', form);
    if (peek) { peek.innerHTML = I.eye; peek.addEventListener('click', () => { const show = pass.type === 'password'; pass.type = show ? 'text' : 'password'; peek.innerHTML = show ? I['eye-off'] : I.eye; peek.setAttribute('aria-label', show ? '隐藏密码' : '显示密码'); }); }
    const fail = (msg) => { err.innerHTML = `${I.error}<span>${msg}</span>`; err.hidden = false; $$('.field', form).forEach((f) => f.toggleAttribute('data-error', true)); anim(form, [{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }], { duration: 280 }); };
    const reset = () => { err.hidden = true; $$('.field', form).forEach((f) => f.removeAttribute('data-error')); btn.disabled = false; btn.textContent = '登录'; };
    form.addEventListener('input', () => { if (!err.hidden) reset(); });
    // 样稿没有真实账号：提交后一律演示“登录失败”
    form.addEventListener('submit', (e) => { e.preventDefault(); if (!user.value || !pass.value) { fail('请填写用户名和密码。'); return; } btn.disabled = true; btn.textContent = '登录中'; setTimeout(() => { btn.disabled = false; btn.textContent = '登录'; fail('用户名或密码不对，请再试一次。'); }, 600); });
    if (GC.q.get('state') === 'failed') { user.value = 'changhao'; pass.value = 'xxxxxxxx'; fail('用户名或密码不对，请再试一次。'); }
  }
  const BACK = { daily: ['daily.html', '返回日报', '日报'], favorites: ['favorites.html', '返回我的收藏', '我的收藏'], boards: ['boards.html', '返回其他榜单', '其他榜单'] };
  const backOf = (from) => BACK[from] || ['../t1b/index.html', '返回涨星榜', '涨星榜'];
  const pick = () => P(GC.q.get('repo')) || P(D.gainers.d1[0].repo);
  return { P, project, state, status, cats, avImg, name, link, ds, when, favBtn, wireFavs, wireOpen, wireCopy, wireMore, enter, compactRow, crowSkeleton, spark, gridCard, gcardSkeleton, statStrip, chartOf, mainSkeleton, sideSkeleton, readOf, condList, skillList, sources, ranksOf, ditem, ditemSkeleton, dailySections, relRow, favItems, edgeItems, wireLogin, backOf, pick, AI, FOLD };
})();
