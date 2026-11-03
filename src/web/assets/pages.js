// 我的收藏和登录页的拼装（#14，照冻结方案 t1b-pages-r1 的 design/t1b-pages/pages.js 落地；2026-11-03 白雾重设计后其余页面不再用）。组件来自 gc.js；
// 数据是页面里嵌入的项目资料（服务端 src/web/pages.js 整理）；收藏走 /api/favorites、安装指令走 /api/install（都在 gc.js 里）。
window.GP = (() => {
  const { D, I, $, $$, esc, anim, avatar, ownerOf, nameOf, favs, favSkills, toggleFav, copyInstall } = GC;
  const P = (repo) => D.projects[repo];
  const project = (repo, from) => `/p/${repo}?from=${from}`;
  const cats = (p) => p.cats.map((c) => `<span>${esc(c)}</span>`).join('');
  const avImg = (p, s) => `<img class="av" alt="" loading="lazy" referrerpolicy="no-referrer" data-key="${esc(p.repo)}" src="${avatar(p, s)}">`;
  const name = (p) => `<span class="o">${esc(ownerOf(p))}/</span><span class="n">${esc(nameOf(p))}</span>`;
  const link = (p, href, external) => `<a href="${esc(href)}"${external ? ' target="_blank" rel="noopener"' : ''}>${name(p)}</a>`;
  // 只上了分类榜的项目（#10）不生成简介，用 GitHub 上的描述
  const ds = (p) => (p.what != null ? p.what : p.catOnly ? p.desc ?? '只上了分类榜，不生成简介' : '简介生成中');
  // 北京时间：M/D HH:MM（收藏时间）
  const bj = (iso) => new Date(Date.parse(iso) + 8 * 3600e3);
  const when = (iso) => { const d = bj(iso); return `收藏于 <span class="num">${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}</span>`; };
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
  // 网格卡：项目或 Skill；warn 写明异常（Skill 已不在、项目改名、资料没读到或已不在），noCopy 时不给复制按钮，external 时名字链到 GitHub
  function gridCard(p, { href, at, skill, label, warn, noCopy, external }) {
    const head = skill
      ? `<span class="skill-ic">${I.puzzle}</span><div class="tx"><div class="nm"><a href="${esc(href)}"${external ? ' target="_blank" rel="noopener"' : ''}><code>${esc(skill.name)}</code></a></div><div class="ds">来自 ${esc(p.repo)}</div></div>`
      : `${avImg(p, 80)}<div class="tx"><div class="nm" title="${esc(p.repo)}">${link(p, href, external)}</div></div>`;
    const body = warn ? `<div class="warn">${I.warn}<span>${esc(warn)}</span></div>` : `<div class="ds">${esc(skill ? skill.desc : ds(p))}</div>`;
    return `<article class="gcard" data-key="${esc(p.repo)}"${external ? '' : ` data-href="${esc(href)}"`}><div class="head">${head}</div>${body}<div class="tg">${cats(p)}</div><div class="big"><div>${label ? `<div class="t">${label}</div>` : ''}${at ? `<span class="when">${when(at)}</span>` : ''}</div><div class="acts">${noCopy ? '' : `<button class="btn btn-g btn-s" type="button" data-copy-skill="${skill ? esc(skill.path) : ''}">${I.copy}<span>复制安装</span></button>`}${favBtn(p, skill)}</div></div></article>`;
  }
  // 登录页：显示密码；服务端已判定失败时表单轻摆，再输入时清掉错误样式
  function wireLogin(form) {
    const err = $('.err', form), peek = $('#peek', form), pass = $('#pass', form);
    if (peek) { peek.innerHTML = I.eye; peek.addEventListener('click', () => { const show = pass.type === 'password'; pass.type = show ? 'text' : 'password'; peek.innerHTML = show ? I['eye-off'] : I.eye; peek.setAttribute('aria-label', show ? '隐藏密码' : '显示密码'); }); }
    if (!err.hidden) anim(form, [{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }], { duration: 280 });
    form.addEventListener('input', () => { if (!err.hidden) { err.hidden = true; $$('.field', form).forEach((f) => f.removeAttribute('data-error')); } });
    form.addEventListener('submit', () => { const btn = $('[type="submit"]', form); btn.disabled = true; btn.textContent = '登录中'; });
  }
  return { P, project, cats, avImg, name, link, ds, when, favBtn, wireFavs, wireOpen, wireCopy, enter, gridCard, wireLogin, skillOf };
})();
