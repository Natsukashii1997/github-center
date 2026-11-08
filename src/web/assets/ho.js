// 决策与交接（#78、#79），涨星、发现、项目页、收藏页共用，接在 bw.js 后面加载。所有者 2026-11-08 选定批次 A 原型：详情栏用 C 版。
// - 状态胶囊：已收藏的项目或 Skill 才有；点开弹层改决策状态、收藏理由、下一步，改了就存（POST /api/favorites action=update）。
//   数据是服务端嵌进页面的 D.decisions（键"项目 id#Skill 路径"）；改了就发 ho:change，页面据此重画。
// - 详情栏底部：状态胶囊、收藏星、「交给 AI…」。点开从下往上展开编辑面板：选交接类型（研究／试用／安装）、交给谁、范围（整个项目或某个 Skill）、
//   我的需求（试用时是测试场景，不填就用收藏理由），一行风险提醒，复制前看到完整交接文字（POST /api/handoff 由服务端拼）。
// - 卡片、行、精选卡上的「交给 AI ▾」：弹出三种交接，点哪种直接复制，不打开预览。
// 复制成功且这一条已收藏时记最近交接（action=handoff，只表示复制过，不代表做完）。交接文字不是 AI 生成的，是按项目资料拼的模板。
window.HO = (() => {
  const { D, esc, toast } = BW;
  const ST = { int: '感兴趣', res: '待研究', yes: '已采用', no: '不采用' };
  const ST_ORDER = ['res', 'int', 'yes', 'no'];
  const ST_HINT = { int: '有兴趣，还没定用途', res: '准备弄清能不能用', yes: '决定用了', no: '记下原因，免得重复研究' };
  const KIND = { 研究: '只读：查资料、看仓库，不安装、不运行代码，带回证据和未知项。', 试用: '先确认环境：先检查脚本和权限、给出方案，你确认隔离环境后才执行。', 安装: '授权后执行：按文档列出步骤和环境变更，你同意后再装。' };
  const KIND_SHORT = { 研究: '只读，不安装', 试用: '先确认环境', 安装: '授权后执行' };
  const decs = D.decisions ?? {};
  const md = (iso) => { const d = new Date(Date.parse(iso) + 8 * 3600e3); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`; };
  const keyOf = (p, skill = '') => `${p.id}#${skill}`;
  const split = (key) => { const i = key.indexOf('#'); return { id: key.slice(0, i), skill: key.slice(i + 1) }; };
  const post = (url, fields) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: fields instanceof URLSearchParams ? fields : new URLSearchParams(fields) });
  const changed = (key) => document.dispatchEvent(new CustomEvent('ho:change', { detail: { key } }));
  const dec = (key) => decs[key] ?? null;
  let ai = D.ais[0][0];

  // ── 状态胶囊与理由 ──
  const chip = (key) => { const d = dec(key); return d ? `<button class="f-st" data-s="${d.status}" data-dec="${esc(key)}" aria-haspopup="dialog" aria-label="状态：${ST[d.status]}，点开改状态、理由和下一步">${ST[d.status]}</button>` : ''; };
  function lines(d) {
    const why = d.reason ? esc(d.reason) : '<span class="empty">没写，点状态补一句</span>';
    return `<dl class="f-lines"><div><dt>${d.status === 'no' ? '不适合' : '为什么'}</dt><dd>${why}</dd></div>${d.next ? `<div><dt>下一步</dt><dd class="nx">${esc(d.next)}</dd></div>` : ''}</dl>`;
  }
  const handoffNote = (d) => (d.handoff ? `<span class="f-ho">${esc(d.handoff.type)}交接 ${md(d.handoff.at)}</span>` : '');
  // 详情栏一句话下面的只读块（所有者 11-08 定）：理由、下一步、最近交接。
  const block = (key) => { const d = dec(key); return d ? `<div class="f-dec" data-deckey="${esc(key)}">${lines(d)}${d.handoff ? `<p>最近交接：${handoffNote(d)}（只表示复制过，不代表做完）</p>` : ''}</div>` : ''; };

  // ── 弹层（状态、快捷交接共用的定位）──
  const pop = () => document.querySelector('.f-pop');
  function closePop() { pop()?.remove(); }
  function place(el, btn) {
    document.body.append(el);
    const r = btn.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
    let left = r.left, top = r.bottom + 6;
    if (left + w > innerWidth - 12) left = innerWidth - w - 12;
    if (top + h > innerHeight - 12) top = r.top - h - 6;
    el.style.left = `${Math.max(8, left)}px`;
    el.style.top = `${Math.max(58, top) + scrollY}px`;
  }
  async function save(key, change) {
    const { id, skill } = split(key);
    let r;
    try { r = await post('/api/favorites', { project_id: id, skill, action: 'update', ...change }); } catch { /* 网络错误按失败处理 */ }
    const res = r && (await r.json().catch(() => null));
    if (!r?.ok || !res) { toast(res?.error ?? '没能保存，请稍后再试'); return false; }
    Object.assign(decs[key], res);
    changed(key);
    return true;
  }
  function statusBody(key) {
    const d = dec(key);
    return `<div class="f-sat">现在是「${ST[d.status]}」${d.statusAt ? ` · 状态改于 ${md(d.statusAt)}` : ''}</div>
      ${ST_ORDER.map((s) => `<button class="it" data-setst="${s}" aria-pressed="${d.status === s}"><span class="f-st" data-s="${s}">${ST[s]}</span><small>${ST_HINT[s]}</small></button>`).join('')}
      <div class="sep"></div>
      <label for="f-why">${d.status === 'no' ? '为什么不适合（以后不用再研究一遍）' : '为什么收藏'}<textarea id="f-why" rows="2" maxlength="500" data-edit="reason">${esc(d.reason)}</textarea></label>
      <label for="f-next">下一步<input id="f-next" maxlength="500" data-edit="next_step" value="${esc(d.next)}" placeholder="例：先验证是否支持断点恢复"></label>`;
  }
  function openStatus(btn, key) {
    closePop();
    const el = Object.assign(document.createElement('div'), { className: 'f-pop' });
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', '改状态、理由和下一步');
    el.dataset.key = key;
    el.innerHTML = statusBody(key);
    place(el, btn);
    el.querySelector('[aria-pressed="true"]')?.focus();
  }
  // 输入框里还没存的字：停笔 0.6 秒存，离开输入框立即存；改状态时连同没存的字一起存，免得重画弹层时丢字。
  const timers = new Map();
  const pending = (key, el) => { const d = dec(key); return Object.fromEntries([...el.querySelectorAll('[data-edit]')].map((i) => [i.dataset.edit, i.value.trim()]).filter(([f, v]) => v !== (f === 'reason' ? d.reason : d.next))); };
  function edited(input, wait = 600) {
    const el = pop(), key = el?.dataset.key;
    if (!key || !dec(key)) return;
    clearTimeout(timers.get(input.dataset.edit));
    timers.set(input.dataset.edit, setTimeout(async () => {
      timers.delete(input.dataset.edit);
      const change = pending(key, el);
      if (input.dataset.edit in change) await save(key, { [input.dataset.edit]: change[input.dataset.edit] });
    }, wait));
  }
  async function setStatus(el, s) {
    const key = el.dataset.key;
    if (!dec(key) || dec(key).status === s) return;
    timers.forEach(clearTimeout);
    timers.clear();
    if (await save(key, { ...pending(key, el), status: s })) {
      toast(`已改为「${ST[s]}」`);
      el.innerHTML = statusBody(key);
      el.querySelector('[aria-pressed="true"]')?.focus();
    }
  }

  // ── 交接文字：服务端拼，同样的参数只取一次 ──
  const cache = new Map();
  function fetchText(fields) {
    const body = new URLSearchParams(fields), k = body.toString();
    if (cache.size > 40) cache.clear();
    if (!cache.has(k)) cache.set(k, post('/api/handoff', body).then(async (r) => (r.ok ? r.text() : Promise.reject(new Error((await r.json().catch(() => null))?.error ?? String(r.status))))));
    const p = cache.get(k);
    p.catch(() => cache.delete(k));
    return p;
  }
  // 复制：先把剪贴板占住再等文字回来，点击的那一刻就算数（同 bw.js 的做法）。
  async function copyText(text) {
    try {
      if (window.ClipboardItem && navigator.clipboard.write) await navigator.clipboard.write([new ClipboardItem({ 'text/plain': Promise.resolve(text).then((t) => new Blob([t], { type: 'text/plain' })) })]);
      else await navigator.clipboard.writeText(await text);
      return true;
    } catch { return false; }
  }
  // 没复制成功：服务端拒绝了就说原因（如有的候选没有资料），否则是剪贴板不让写。
  async function failed(text) {
    const why = await text.then(() => null, (e) => e.message);
    toast(why ? `生成不了交接：${why}` : '没能自动复制，请稍后再试');
  }
  async function record(key, kind) {
    if (!dec(key)) return;
    try {
      const r = await post('/api/favorites', { ...(({ id, skill }) => ({ project_id: id, skill }))(split(key)), action: 'handoff', type: kind });
      if (r.ok && (await r.json()).recorded) { decs[key].handoff = { type: kind, at: new Date().toISOString() }; changed(key); }
    } catch { /* 记不上不影响复制 */ }
  }
  const aiName = () => D.ais.find(([id]) => id === ai)[1];
  async function handoff(p, skill, kind, need, btn) {
    const key = keyOf(p, skill);
    // 不填需求时研究、安装交接带收藏理由；试用要的是测试场景，不拿理由顶（服务端会写"用项目文档里给的示例"）。
    const ok = await copyText(fetchText({ kind, project: p.id, skill, ai, need: need ?? (kind === '试用' ? '' : dec(key)?.reason ?? '') }));
    if (!ok) return failed(fetchText({ kind, project: p.id, skill, ai, need: need ?? (kind === '试用' ? '' : dec(key)?.reason ?? '') }));
    if (btn) { const t = btn.textContent; btn.classList.add('ok'); btn.textContent = '已复制 ✓'; setTimeout(() => { btn.classList.remove('ok'); btn.textContent = t; }, 1400); }
    toast(`已复制${kind}交接，粘贴给 ${aiName()}`);
    record(key, kind);
  }
  // 定向对比（收藏页勾选 2–4 个）：items 是 [{ p, skill }]。
  async function compare(items, need, btn) {
    const body = new URLSearchParams([['kind', '对比'], ...items.map(({ p, skill }) => ['item', `${p.id}:${skill ?? ''}`]), ['need', need ?? '']]);
    const ok = await copyText(fetchText(body));
    if (!ok) return failed(fetchText(body));
    if (btn) { const t = btn.textContent; btn.textContent = '已复制 ✓'; setTimeout(() => { btn.textContent = t; }, 1400); }
    toast(`已复制对比研究交接（${items.length} 个），粘贴给你的 AI`);
  }

  // ── 快捷「交给 AI ▾」──
  const aiSegs = (attr) => `<div class="segs">${D.ais.map(([id, n]) => `<button ${attr}="${esc(id)}" aria-selected="${id === ai}">${esc(n)}</button>`).join('')}</div>`;
  const quick = (p, { skill = '', disabled = '', cls = 'lnk' } = {}) => `<button class="${cls}" data-ho="${esc(p.repo)}"${skill ? ` data-skill="${esc(skill)}"` : ''} aria-haspopup="menu"${disabled}>交给 AI ▾</button>`;
  let opener = null;   // 打开快捷菜单或编辑面板的按钮，Esc 关掉后焦点回到它
  function openQuick(btn) {
    closePop();
    opener = btn;
    const el = Object.assign(document.createElement('div'), { className: 'f-pop ho-quick' });
    el.setAttribute('role', 'menu');
    el.dataset.repo = btn.dataset.ho;
    el.dataset.skill = btn.dataset.skill ?? '';
    el.innerHTML = `${el.dataset.skill ? `<div class="f-sat">Skill · ${esc(el.dataset.skill.split('/').pop())}</div>` : ''}${Object.keys(KIND).map((k) => `<button class="it" data-hokind="${k}"><b>${k}交接</b><small>${KIND_SHORT[k]}</small></button>`).join('')}<div class="sep"></div><div class="ho-ai">${aiSegs('data-hoai')}</div>`;
    place(el, btn);
    el.querySelector('button')?.focus();
  }

  // ── 详情栏底部与编辑面板（C 版）──
  const panel = { repo: null, skill: '', kind: '研究', need: '' };
  function foot(it, noCopy) {
    const key = keyOf(it, '');
    return `<div class="dw-foot">${dec(key) ? `<span class="ho-lab">状态</span>${chip(key)}` : ''}<span class="ho-grow"></span><button class="star" data-star="${esc(it.repo)}" aria-label="收藏"${it.id ? '' : ' disabled title="这个项目还没核出 GitHub 编号，暂时不能收藏"'}></button><button class="btn pri" data-hopanel="${esc(it.repo)}"${noCopy}>交给 AI…</button></div>
    <div class="ho-panel" id="ho-panel" aria-label="交给 AI"></div>`;
  }
  const risk = (p) => `交给 AI 前先看使用条件和权限风险。使用条件已写进交接；敏感操作 AI 会停下来问你。${p.conditions?.length ? `这个项目文档提到：${esc([...new Set(p.conditions.map((c) => c.kind))].join('、'))}。` : ''}`;
  function panelHtml() {
    const p = D.projects[panel.repo], key = keyOf(p, panel.skill), d = dec(key) ?? dec(keyOf(p, ''));
    const sk = p.skills.find((s) => s.path === panel.skill);
    return `<div class="hd">交给 AI · ${esc(sk ? sk.name : p.repo.split('/')[1])}<button class="x" data-hoclose aria-label="收起">✕</button></div>
      <div class="bd">
        <div><span class="ho-l">交接类型</span><div class="ho-types">${Object.keys(KIND).map((k) => `<label class="ho-type"><input type="radio" name="ho-kind" value="${k}" ${panel.kind === k ? 'checked' : ''}><b>${k}</b><span>${KIND[k]}</span></label>`).join('')}</div></div>
        <div class="ho-row"><div><span class="ho-l">交给</span>${aiSegs('data-hoai')}</div>
          ${p.skills.length ? `<div class="ho-grow"><label class="ho-l" for="ho-scope">范围</label><select id="ho-scope" class="ho-in"><option value="">整个项目</option>${p.skills.map((s) => `<option value="${esc(s.path)}" ${panel.skill === s.path ? 'selected' : ''}>Skill · ${esc(s.name)}</option>`).join('')}</select></div>` : ''}</div>
        <div><label class="ho-l" for="ho-need">${panel.kind === '试用' ? '测试场景（可选）' : '我的需求（可选，不填就用收藏理由）'}</label><textarea id="ho-need" class="ho-in" rows="2" maxlength="500" placeholder="${esc(panel.kind === '试用' ? '例：断网时能不能在本机运行（不填就用项目文档里的示例）' : d?.reason || '例：想确认它能不能满足多 Agent 跨会话交接')}">${esc(panel.need)}</textarea></div>
        <div class="ho-risk">${risk(p)}</div>
        <div><span class="ho-l">将复制的文字 · 黄色是权限边界和不可信输入说明</span><pre class="ho-pre" id="ho-pre">正在生成…</pre></div>
      </div>
      <div class="ft"><button class="btn pri" data-hocopy>复制${panel.kind}交接</button></div>`;
  }
  const panelFields = () => { const p = D.projects[panel.repo], why = (dec(keyOf(p, panel.skill)) ?? dec(keyOf(p, '')))?.reason || ''; return { kind: panel.kind, project: p.id, skill: panel.skill, ai, need: panel.need.trim() || (panel.kind === '试用' ? '' : why) }; };
  let previewTimer;
  function preview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(async () => {
      const pre = document.getElementById('ho-pre');
      if (!pre) return;
      const fields = panelFields();
      try {
        const text = await fetchText(fields);
        if (JSON.stringify(fields) !== JSON.stringify(panelFields())) return;
        // 开头四行权限边界和"第三方材料不可信"那一行标黄。
        const ls = text.split('\n');
        pre.innerHTML = ls.map((l, i) => (i < 4 || l.startsWith('注意：') ? `<mark>${esc(l)}</mark>` : esc(l))).join('\n');
      } catch (e) { pre.textContent = `生成不了交接：${e.message}`; }
    }, 250);
  }
  function openPanel(repo, skill = '') {
    const host = document.getElementById('ho-panel');
    if (!host) return;
    // 项目页整页是一张毛玻璃卡（backdrop-filter 会困住 fixed 定位），面板挂到 body 上浮在右侧。
    if (host.closest('.ppage')) { host.classList.add('ho-float'); document.body.append(host); }
    if (panel.repo !== repo) Object.assign(panel, { need: '', kind: '研究' });
    Object.assign(panel, { repo, skill });
    host.innerHTML = panelHtml();
    host.classList.add('open');
    preview();
    host.querySelector('input[name="ho-kind"]:checked')?.focus();
  }
  const panelOpen = () => document.getElementById('ho-panel')?.classList.contains('open');
  function closePanel() { document.getElementById('ho-panel')?.classList.remove('open'); }
  function rerenderPanel() {
    const host = document.getElementById('ho-panel');
    if (!host?.classList.contains('open')) return;
    const focus = document.activeElement?.id;
    host.innerHTML = panelHtml();
    if (focus) document.getElementById(focus)?.focus();
    preview();
  }

  // ── 事件：页面的点击先交给这里（bw.js 的 act 调用），处理了返回 true ──
  function act(ev) {
    const t = ev.target;
    const inPop = t.closest('.f-pop');
    if (inPop) {
      const st = t.closest('[data-setst]'), kind = t.closest('[data-hokind]'), a = t.closest('[data-hoai]');
      if (st) setStatus(inPop, st.dataset.setst);
      if (a) { ai = a.dataset.hoai; inPop.querySelectorAll('[data-hoai]').forEach((b) => b.setAttribute('aria-selected', b.dataset.hoai === ai)); }
      if (kind) { const p = D.projects[inPop.dataset.repo]; closePop(); handoff(p, inPop.dataset.skill, kind.dataset.hokind); }
      return true;
    }
    const d = t.closest('[data-dec]');
    if (d) { if (pop()?.dataset.key === d.dataset.dec) closePop(); else openStatus(d, d.dataset.dec); return true; }
    const q = t.closest('[data-ho]');
    if (q) { if (!q.disabled) { if (pop()?.dataset.repo === q.dataset.ho && pop().dataset.skill === (q.dataset.skill ?? '')) closePop(); else openQuick(q); } return true; }
    closePop();
    const op = t.closest('[data-hopanel]');
    if (op) { if (!op.disabled) { opener = op; openPanel(op.dataset.hopanel, op.dataset.skill ?? ''); } return true; }
    if (t.closest('#ho-panel')) {
      const a = t.closest('[data-hoai]');
      if (a) { ai = a.dataset.hoai; rerenderPanel(); }
      if (t.closest('[data-hoclose]')) closePanel();
      const c = t.closest('[data-hocopy]');
      if (c) { const f = panelFields(); handoff(D.projects[panel.repo], f.skill, f.kind, f.need, c); }
      return true;
    }
    return false;
  }
  document.addEventListener('change', (ev) => {
    if (ev.target.name === 'ho-kind') { panel.kind = ev.target.value; rerenderPanel(); }
    if (ev.target.id === 'ho-scope') { panel.skill = ev.target.value; rerenderPanel(); }
  });
  document.addEventListener('input', (ev) => {
    if (ev.target.id === 'ho-need') { panel.need = ev.target.value; preview(); }
    if (ev.target.closest('.f-pop [data-edit]')) edited(ev.target);
  });
  document.addEventListener('focusout', (ev) => { if (ev.target.closest?.('.f-pop [data-edit]')) edited(ev.target, 0); });
  // Esc 依次关：弹层、编辑面板，然后才轮到页面关详情栏。
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    const back = () => (opener?.isConnected ? opener : null);
    if (pop()) { const k = pop().dataset.key; closePop(); (k ? document.querySelector(`[data-dec="${CSS.escape(k)}"]`) : back())?.focus(); ev.stopImmediatePropagation(); return; }
    if (panelOpen()) { closePanel(); back()?.focus(); ev.stopImmediatePropagation(); }
  }, true);
  // 收藏星：收藏后这一条有了默认决策，取消后没有了。
  document.addEventListener('bw:star', (ev) => {
    const p = D.projects[ev.detail.repo];
    if (!p) return;
    const key = keyOf(p, ev.detail.skill);
    if (ev.detail.on) decs[key] = { status: 'int', reason: '', next: '', statusAt: null, handoff: null };
    else delete decs[key];
    changed(key);
  });
  // 状态变了：详情栏里的胶囊、只读块跟着改（页面自己的卡片由页面听 ho:change 重画）；刚收藏或取消收藏，详情栏底部的状态跟着出现或消失。
  document.addEventListener('ho:change', (ev) => {
    const key = ev.detail.key;
    document.querySelectorAll('.dw-foot').forEach((f) => {
      const p = D.projects[f.querySelector('[data-hopanel]')?.dataset.hopanel];
      if (!p || keyOf(p, '') !== key) return;
      f.querySelectorAll('.ho-lab, .f-st').forEach((x) => x.remove());
      if (dec(key)) f.insertAdjacentHTML('afterbegin', `<span class="ho-lab">状态</span>${chip(key)}`);
    });
    document.querySelectorAll(`.drawer [data-dec="${CSS.escape(key)}"], .ppage [data-dec="${CSS.escape(key)}"]`).forEach((b) => { const h = chip(key); if (h) b.outerHTML = h; else b.remove(); });
    document.querySelectorAll(`[data-deckey="${CSS.escape(key)}"]`).forEach((b) => { b.outerHTML = block(key) || ''; });
  });

  return { ST, ST_ORDER, keyOf, dec, chip, lines, block, handoffNote, quick, foot, act, compare, closePop };
})();
