// 涨星榜首页和项目页共用（2026-11-03 白雾定稿，design/candidates/redesign/r2.js、c.js 落地）：数字格式、三种标签、柱图、右侧详情栏内容，
// 收藏（POST /api/favorites，写成功才改按钮）和复制安装指令（GET /api/install）。数据是服务端嵌进页面的真实快照与项目资料（src/web/home.js、pages.js）。
// 一句话、主要用途、使用场景、说明标签、定义标签由补资料生成（#23）；还没按新版重新生成的项目没有这些，对应位置留空，不写替代文字。
window.BW = (() => {
  const D = JSON.parse(document.getElementById('gc-data').textContent);
  const AI = Object.fromEntries(D.ais);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const num = (n) => n.toLocaleString('en-US');
  const wan = (n) => (n >= 1e4 ? `${(n / 1e4).toFixed(1)}万` : num(n));
  const k = (n) => (n >= 1e4 ? `${(n / 1e3).toFixed(0)}k` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
  const md = (day) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
  const ymd = (day) => `${day.slice(0, 4)} 年 ${Number(day.slice(5, 7))} 月 ${Number(day.slice(8, 10))} 日`;
  const shift = (day, n) => new Date(Date.parse(day) + n * 864e5).toISOString().slice(0, 10);
  const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
  const pad = (n) => String(n).padStart(2, '0');
  // GitHub 语言色（linguist）
  const LANG = { TypeScript: '#3178c6', Python: '#3572A5', Java: '#b07219', JavaScript: '#f1e05a', Rust: '#dea584', C: '#555555', Shell: '#89e051', 'C#': '#178600', 'C++': '#f34b7d', HTML: '#e34c26', Go: '#00ADD8' };
  const PER = { d1: '/天', d7: '/7天', d30: '/30天' };

  // 状态标签：每项最多一个，蝉联第 1 > 首次上榜 > 飙升 > 在榜 N 期。名次历史从 10/23 才开始记，“首次上榜”现在等于上一期不在前 20。
  // streak 是服务端给的连续期数 { kind: 'first' | 'top', n }（N≥2 才有）。
  function status(e) {
    if (e.streak?.kind === 'first') return { kind: 'crown', text: `蝉联第一 ${e.streak.n} 期` };
    if (e.mv?.kind === 'new') return { kind: 'new', text: '首次上榜' };
    if (e.mv?.kind === 'up' && e.mv.n >= 5) return { kind: 'rise', text: `飙升 ${e.mv.n} 名` };
    if (e.streak) return { kind: 'stay', text: `在榜 ${e.streak.n} 期` };
    return null;
  }
  const move = (mv) => (!mv ? { c: '', t: '' } : mv.kind === 'up' ? { c: 'up', t: `▲${mv.n}` } : mv.kind === 'down' ? { c: 'down', t: `▼${mv.n}` } : mv.kind === 'new' ? { c: 'new', t: 'NEW' } : { c: 'flat', t: '–' });
  const st = (it) => (it.st ? `<span class="tag st-${it.st.kind}">${esc(it.st.text)}</span>` : '');
  const say = (it) => (it.tag ? `<span class="tag t-say">${esc(it.tag)}</span>` : '');
  const def = (it) => (it.type ? `<span class="tag t-def" data-type="${esc(it.type)}">${esc(it.type)}</span>` : '');
  const lang = (it) => (it.lang ? `<span class="lang" style="--lc:${LANG[it.lang] ?? '#999'}"><i></i>${esc(it.lang)}</span>` : '');

  // 柱图：纵轴从零起、线性；缺数据的那天留空位，不补零。tip 为真时每根柱带悬停说明。
  function bars(series, { w = 120, h = 24, gap = 1, tip = false, day } = {}) {
    const max = Math.max(1, ...series.filter((v) => v != null));
    const bw = (w - gap * (series.length - 1)) / series.length;
    const rects = series.map((v, i) => {
      if (v == null) return '';
      const hh = Math.max(1, (v / max) * h);
      const t = tip ? `<title>${md(shift(day, i - series.length + 1))}  +${num(v)}</title>` : '';
      return `<rect x="${(i * (bw + gap)).toFixed(2)}" y="${(h - hh).toFixed(2)}" width="${bw.toFixed(2)}" height="${hh.toFixed(2)}"${i === series.length - 1 ? ' class="last"' : ''}>${t}</rect>`;
    }).join('');
    return `<svg class="bars" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none" aria-hidden="true">${rects}</svg>`;
  }
  // 行和卡上的小柱图（150×30 带小字）；没有官方星数历史就写明
  const chart = (it) => (it.series ? `<div class="ch">${bars(it.series, { w: 150, h: 30 })}<span>30 天每日新增 · 最高 +${k(it.peak)}</span></div>` : '<div class="ch"><span class="nochart">暂无走势（没有官方星数历史）</span></div>');

  // 一个项目按某次运行的读数（卡片数字和走势取这一期榜单那次运行，见 src/web/home.js）；extra 是首页这一行的名次等
  function view(repo, runId, extra = {}) {
    const p = D.projects[repo], run = (runId && p.runs[runId]) || null;
    const [owner, name] = p.repo.split('/');
    const known = run?.series?.filter((v) => v != null) ?? [];
    return {
      ...p, owner, name, series: run?.series ?? null, seriesDay: run?.seriesDay ?? null, gains: run?.gains ?? {}, total: run?.total ?? null,
      peak: known.length ? Math.max(...known) : 0,
      avatar: p.ownerId ? `https://avatars.githubusercontent.com/u/${p.ownerId}?s=80&v=4` : `https://github.com/${owner}.png?size=80`,
      ...extra,
    };
  }
  // 首页一行：快照里的名次、并列、本期新增、名次变化与连续期数（#17）
  const item = (w, e) => view(e.repo, e.run, { e, w, rank: e.rank, tie: e.tie, gain: e.gain, st: status(e), mv: move(e.mv) });
  // 简介没有时：不在各榜单前 20 的项目不生成项目资料（catOnly），如实说明；其余（从没生成成功过，#52）只给 GitHub 上的描述（ghDesc），
  // 不写“生成中”“还没读到”这类内部状态；GitHub 上也没写描述就空着。
  const gen = (it) => (it.catOnly ? `这个项目不在各榜单前 20 里，不生成简介和 Skill 列表。${it.desc ? `GitHub 上的描述：${it.desc}` : ''}` : it.ghDesc ? `GitHub 上的描述：${it.ghDesc}` : '');
  // 复制按钮：没有项目资料就不能生成安装指令，按钮禁用并写明原因（行、详情栏、Skill 行共用）
  const noCopy = (it) => (it.installable ? '' : ` disabled title="${it.catOnly ? '这个项目不生成项目资料，没有安装指令' : '这个项目暂时没有安装指令'}"`);

  // ── 右侧详情栏内容（首页详情栏和项目页共用） ──
  // 顶部照原型：名次、标签含语言、一句话、四格读数、30 天柱图；正文只有四段：主要用途、使用场景、包含 Skill、项目信息（不放做什么、解决什么问题、使用条件）。
  // o：{ cur（这一行在某个窗口的名次，项目页取它所在的第一个涨星榜；不在榜上没有）, w（四格读数高亮哪个窗口）, home, page（项目页才有：数据日期、Skill 列表是否不全） }
  function release(rel) {
    if (rel.state === 'ok') return `<a href="${esc(rel.url)}" target="_blank" rel="noopener"><code>${esc(rel.tag)}</code></a> · 发布于 ${ymd(rel.publishedAt.slice(0, 10))}`;
    return rel.state === 'none' ? '还没发过正式版' : '未知';
  }
  // 项目页顶行：数据的统计日和实际更新时间（和首页近 1 天报头同口径，需求第 23 条）
  const dataDay = (top) => `<span class="fresh${top.tone === 'ok' ? '' : ` ${top.tone}`}"><i></i>${esc(top.text)}</span>`;
  const ul = (title, list) => (list.length ? `<div class="dw-sec"><h4>${title}</h4><ul class="dw-ul">${list.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '');
  // AI 产出留痕（#69）：一句话、用途、场景和分类各是谁做的；#69 之前生成的没有记录，照实写。
  const AI_NAMES = { codex: 'Codex', claude: 'Claude' }, AI_VIAS = { cli: '本机 CLI' };
  const hm = (iso) => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  // what：「上面的一句话、用途、场景」或「分类」；did：「根据 README 整理」或「给出」。
  const aiSay = (x, what, did) => (x.by
    ? `${what}由 <b>${esc(AI_NAMES[x.by] ?? x.by)}</b>（${esc(AI_VIAS[x.via] ?? x.via)}，${esc(x.model ?? (x.by === 'codex' ? '默认模型' : '模型没取到'))}${x.relayed ? '，Codex 失败后接力' : ''}）在 ${hm(x.at)} ${did}`
    : `${what}由 AI ${did}（2026-11-08 之前生成，没有记录是哪个执行方）`);
  function aiFoot(a) {
    if (!a || (!a.profile && !a.cats)) return '';
    const parts = [];
    if (a.profile) parts.push(aiSay(a.profile, '上面的一句话、用途、场景', '根据 README 整理'));
    if (a.cats) parts.push(aiSay(a.cats, '分类', '给出'));
    return `<p class="dw-ai">${parts.join('；')}。</p>`;
  }
  function drawer(it, { cur, w, home, page } = {}) {
    const skills = it.skills.length ? `<div class="dw-sec"><h4>包含 Skill · ${it.skills.length}</h4><div class="dw-sk">${it.skills.map((s) => `<div id="skill-${esc(s.path)}"><div><code>${esc(s.name)}</code><span>${esc(s.desc)}</span></div><div class="acts"><button class="star" data-star="${esc(it.repo)}" data-skill="${esc(s.path)}" aria-label="收藏这个 Skill"></button><button class="btn sm" data-copy="${esc(it.repo)}" data-skill="${esc(s.path)}"${noCopy(it)}>复制安装</button></div></div>`).join('')}</div>${page?.skillsTruncated ? '<p class="dw-note">仓库太大，Skill 列表可能不全。</p>' : ''}</div>` : '';
    const mt = it.maint;
    return `<div class="dw-body">
    <div class="dw-top">${cur ? `<span>No.${pad(cur.rank)}${cur.tie ? '（并列）' : ''} · ${esc(D.windows[cur.w].label)}</span><span class="mv ${cur.mv.c}">${esc(cur.mv.t)}</span>${st(cur)}` : '<span>项目页</span>'}${page?.top ? dataDay(page.top) : ''}${home ? '<button class="x" data-close aria-label="关闭">✕</button>' : ''}</div>
    <div class="dw-id"><img class="av" src="${esc(it.avatar)}" width="44" height="44" alt=""><div><h2>${esc(it.name)}</h2><a href="https://github.com/${esc(it.repo)}" target="_blank" rel="noopener">${esc(it.repo)} ↗</a></div></div>
    <div class="dw-tags">${say(it)}${def(it)}${lang(it)}</div>
    ${it.line ? `<p class="dw-line">${esc(it.line)}</p>` : it.what == null && gen(it) ? `<p class="dw-gen">${esc(gen(it))}</p>` : ''}
    <div class="dw-stats">${['d1', 'd7', 'd30'].map((x) => `<div class="${x === w ? 'cur' : ''}"><b>${it.gains[x] == null ? '暂缺' : `+${num(it.gains[x])}`}</b><span>${esc(D.windows[x].label)}</span></div>`).join('')}<div><b>${it.total == null ? '暂缺' : wan(it.total)}</b><span>总 Star</span></div></div>
    ${it.series ? `<div class="dw-chart"><div class="hd"><span>近 30 天每日新增</span><span>最高一天 +${num(it.peak)}</span></div>${bars(it.series, { w: 400, h: 76, gap: 2, tip: true, day: it.seriesDay })}<div class="ax"><span>${md(shift(it.seriesDay, -29))}</span><span>${md(shift(it.seriesDay, -15))}</span><span>${md(it.seriesDay)}</span></div></div>` : ''}
    ${ul('主要用途', it.use)}
    ${ul('使用场景', it.scene)}
    ${skills}
    <div class="dw-sec"><h4>项目信息</h4><dl class="dw-meta">
      <dt>语言</dt><dd>${esc(it.lang ?? '未知')}</dd>
      <dt>创建于</dt><dd>${it.created ? `${ymd(it.created)}${it.seriesDay ? ` · 上线 ${days(it.created, it.seriesDay)} 天` : ''}` : '未知'}</dd>
      <dt>分类</dt><dd>${it.cats.length ? esc(it.cats.join('、')) : '还没归类'}</dd>
      <dt>最近更新</dt><dd>${mt.pushed ? ymd(mt.pushed) : '未知'}</dd>
      <dt>最新版本</dt><dd>${release(mt.release)}</dd>
    </dl></div>
    ${aiFoot(it.aiBy)}
    ${home ? '<div class="dw-hint"><span class="kbd">↑</span> <span class="kbd">↓</span> 切换项目 · <span class="kbd">Esc</span> 关闭</div>' : ''}
  </div>
  <div class="dw-foot"><div class="segs">${D.ais.map(([id, n]) => `<button data-ai="${esc(id)}" aria-selected="${id === target}">${esc(n)}</button>`).join('')}</div><button class="btn pri" data-copy="${esc(it.repo)}"${noCopy(it)}>复制安装指令</button><button class="star" data-star="${esc(it.repo)}" aria-label="收藏"${it.id ? '' : ' disabled title="这个项目还没核出 GitHub 编号，暂时不能收藏"'}></button></div>`;
  }

  // ── 提示气泡 ──
  let toastEl, toastTimer;
  function toast(msg) {
    if (!toastEl) { toastEl = Object.assign(document.createElement('div'), { className: 'toast' }); toastEl.setAttribute('role', 'status'); document.body.append(toastEl); }
    toastEl.textContent = msg;
    toastEl.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('on'), 2000);
  }

  // ── 收藏：写进账号，写成功才改按钮；同一个按钮请求没回来前不再发。页面上同一项目（或 Skill）的按钮一起改 ──
  const saved = new Set(Object.values(D.projects).flatMap((p) => [...(p.saved ? [p.repo] : []), ...p.savedSkills.map((s) => `${p.repo}#${s}`)]));
  const keyOf = (el) => (el.dataset.skill ? `${el.dataset.star}#${el.dataset.skill}` : el.dataset.star);
  const syncStars = (root = document) => root.querySelectorAll('[data-star]').forEach((x) => { const on = saved.has(keyOf(x)); x.setAttribute('aria-pressed', on); x.setAttribute('aria-label', on ? '取消收藏' : x.dataset.skill ? '收藏这个 Skill' : '收藏'); });
  async function toggleFav(btn) {
    const p = D.projects[btn.dataset.star], skill = btn.dataset.skill ?? '', key = keyOf(btn), on = !saved.has(key);
    if (btn.dataset.busy) return;
    btn.dataset.busy = '';
    let ok = false;
    try { ok = (await fetch('/api/favorites', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ project_id: p.id, skill, action: on ? 'add' : 'remove' }) })).ok; } catch { /* 网络错误按失败处理 */ }
    delete btn.dataset.busy;
    if (!ok) return toast(on ? '没能收藏，请稍后再试' : '没能取消收藏，请稍后再试');
    on ? saved.add(key) : saved.delete(key);
    syncStars();
    const name = skill ? `${p.repo} 的 Skill ${p.skills.find((s) => s.path === skill)?.name ?? skill}` : p.repo;
    toast(on ? `已收藏 ${name}` : `已取消收藏 ${name}`);
  }

  // ── 安装指令：由服务端按项目资料拼出，复制进剪贴板。先把剪贴板占住再等指令回来，点击的那一刻就算数 ──
  let target = D.ais[0][0];
  async function copy(btn) {
    if (btn.classList.contains('ok')) return;
    const p = D.projects[btn.dataset.copy];
    const q = new URLSearchParams({ project: p.id, ai: target, ...(btn.dataset.skill ? { skill: btn.dataset.skill } : {}) });
    const text = fetch(`/api/install?${q}`).then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))));
    try {
      if (window.ClipboardItem && navigator.clipboard.write) await navigator.clipboard.write([new ClipboardItem({ 'text/plain': text.then((t) => new Blob([t], { type: 'text/plain' })) })]);
      else await navigator.clipboard.writeText(await text);
    } catch { return toast('没能自动复制，请稍后再试'); }
    const t = btn.textContent;
    btn.classList.add('ok');
    btn.textContent = '已复制 ✓';
    setTimeout(() => { btn.classList.remove('ok'); btn.textContent = t; }, 1400);
    toast(`已复制，粘贴给 ${AI[target]} 即可安装`);
  }

  // 页面上的收藏、复制、选 AI：处理了就返回 true（首页不再把这次点击当成打开项目）
  function act(ev) {
    const t = ev.target.closest('[data-star],[data-copy],[data-ai]');
    if (!t || t.disabled) return Boolean(t);
    if (t.dataset.star) toggleFav(t);
    else if (t.dataset.copy) copy(t);
    else { target = t.dataset.ai; document.querySelectorAll('[data-ai]').forEach((x) => x.setAttribute('aria-selected', x.dataset.ai === target)); }
    return true;
  }
  // 头像读不到时藏起来，留灰底
  document.addEventListener('error', (e) => { if (e.target instanceof HTMLImageElement && e.target.classList.contains('av')) e.target.removeAttribute('src'); }, true);

  return { D, esc, num, wan, k, md, pad, PER, bars, chart, st, say, def, status, move, view, item, gen, noCopy, drawer, act, syncStars, toast };
})();
