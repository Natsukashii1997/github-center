// v2 共用部件：项目详情内容与收藏按钮。三套只换容器（抽屉 / 整页 / 弹窗），内容结构相同。
(() => {
  const G = window.GC;
  const { icon, fmt, avatar, spark, series, gainOf, installText, seg, setSeg, WINDOWS, SPAN, favs } = G;

  const split = (repo) => { const i = repo.indexOf('/'); return [repo.slice(0, i), repo.slice(i + 1)]; };
  const vtName = (repo) => 'r-' + repo.replace(/[^a-zA-Z0-9]/g, '-');

  const favBtn = (key, { label = false, cls = 'icon-btn' } = {}) => {
    const on = favs.has(key);
    const text = label ? `<span class="lbl">${on ? '已收藏' : '收藏'}</span>` : '';
    return `<button class="${cls} fav${on ? ' on' : ''}" data-fav="${key}" aria-pressed="${on}" title="${on ? '取消收藏' : '收藏'}">${icon('bookmark')}${text}</button>`;
  };

  const stat = (label, v, plus = true) => `<div class="pd-stat"><small>${label}</small>${v == null ? '<b class="na">未上榜</b>' : `<b class="mono">${plus ? '+' : ''}${fmt(v)}</b>`}</div>`;

  function detail(repo, { win = 'd1', state = 'normal', target = 'claude' } = {}) {
    const p = G.P[repo];
    const [owner, name] = split(repo);
    const gen = state === 'generating';
    const about = gen
      ? `<div class="pd-gen"><span class="skeleton" style="width:92%"></span><span class="skeleton" style="width:64%"></span><small>简介生成中，通常一两分钟后出现</small></div>`
      : `<p class="pd-what">${p.what}</p><p class="pd-problem"><span>能解决</span>${p.problem}</p>`;
    const conditions = p.conditions.length ? `<section class="pd-sec"><h3>使用条件</h3><ul class="pd-cond">${p.conditions.map((c) => `<li>${c}</li>`).join('')}</ul></section>` : '';
    const skills = p.skills.length ? `<section class="pd-sec"><h3>包含的 Skill<span class="mono">${p.skills.length}</span></h3><div class="pd-skills">${p.skills.map((s) => `
      <div class="pd-skill"><div><b class="mono">${s.name}</b><span>${s.desc}</span></div>${favBtn(repo + '#' + s.name)}<button class="btn sm" data-copy-skill="${s.name}">${icon('copy')}复制安装指令</button></div>`).join('')}</div></section>` : '';
    return `<article class="pd" data-repo="${repo}">
      <header class="pd-head">${avatar(repo, 44)}<div class="pd-title"><div class="pd-owner">${owner} /</div><h2 class="pd-name" style="view-transition-name:${vtName(repo)}">${name}</h2></div><div class="pd-cats">${p.cats.map((c) => `<span class="chip">${c}</span>`).join('')}</div></header>
      <div class="pd-stats">${stat('当前总 Star', p.total, false)}${WINDOWS.map(([k, l]) => stat(l + '新增', gainOf(repo, k))).join('')}</div>
      <section class="pd-trend"><div class="pd-label"><span>近 30 天每日新增</span><small>来自 GitHub 官方 Star 历史 · 高亮为${WINDOWS.find(([k]) => k === win)[1]}</small></div>${spark(series(repo), { w: 520, h: 72, last: SPAN[win] })}<div class="pd-axis mono"><span>09-23</span><span>10-22</span></div></section>
      <section class="pd-sec"><h3>它是做什么的</h3>${about}</section>
      ${conditions}${skills}
      <section class="pd-sec"><h3>安装</h3>
        <div class="pd-install-head">${seg([['claude', 'Claude Code'], ['codex', 'Codex']], target, 'target')}<small>复制后粘贴给你的 AI，它会照官方文档装好</small></div>
        <pre class="code" data-install>${installText(repo, target)}</pre>
        <div class="pd-actions"><button class="btn primary" data-copy>${icon('copy')}<span>复制安装指令</span></button>${favBtn(repo, { label: true, cls: 'btn' })}<a class="btn" href="https://github.com/${repo}" target="_blank" rel="noreferrer">在 GitHub 打开${icon('out')}</a></div>
      </section>
    </article>`;
  }

  // 详情内交互：切换目标 AI、复制、复制单个 Skill。
  function bindDetail(root) {
    root.addEventListener('click', async (e) => {
      const pd = e.target.closest('.pd');
      if (!pd) return;
      const repo = pd.dataset.repo;
      let target = pd.querySelector('[data-target].on').dataset.target;
      const t = e.target.closest('[data-target]');
      if (t) {
        target = t.dataset.target;
        setSeg(t.closest('.seg'), 'target', target);
        const pre = pd.querySelector('[data-install]');
        pre.textContent = installText(repo, target);
        pre.style.animation = 'none'; void pre.offsetWidth; pre.style.animation = 'gc-fade-in 180ms ease-out both';
        return;
      }
      const c = e.target.closest('[data-copy]');
      if (c) {
        await G.copy(installText(repo, target));
        c.classList.add('done');
        c.innerHTML = `${icon('check', 'pop')}<span>已复制</span>`;
        G.toast(`安装指令已复制，粘贴给 ${target === 'claude' ? 'Claude Code' : 'Codex'} 即可`);
        clearTimeout(c._t);
        c._t = setTimeout(() => { c.classList.remove('done'); c.innerHTML = `${icon('copy')}<span>复制安装指令</span>`; }, 1800);
        return;
      }
      const s = e.target.closest('[data-copy-skill]');
      if (s) {
        await G.copy(installText(repo, target, s.dataset.copySkill));
        G.toast(`「${s.dataset.copySkill}」的安装指令已复制`);
      }
    });
  }

  // 收藏按钮在页面任何位置都生效，同一对象的所有按钮同步。
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-fav]');
    if (!b) return;
    e.stopPropagation();
    const key = b.dataset.fav;
    const on = G.toggleFav(key);
    document.querySelectorAll(`[data-fav="${CSS.escape(key)}"]`).forEach((x) => {
      x.classList.toggle('on', on);
      x.setAttribute('aria-pressed', on);
      x.title = on ? '取消收藏' : '收藏';
      const l = x.querySelector('.lbl');
      if (l) l.textContent = on ? '已收藏' : '收藏';
    });
    G.bump(b);
    document.dispatchEvent(new CustomEvent('gc:fav', { detail: { key, on } }));
  }, true);

  Object.assign(G, { detail, bindDetail, favBtn, split, vtName });
})();
