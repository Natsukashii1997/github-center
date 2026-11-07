// 设置页（A 分区原版，src/web/settings.js 给数据）：报头、左边分区目录、右边设置卡。改一项就整份 POST /api/settings 存一次，
// 存成功才算数，失败就退回原来的值并提示原因。伙伴（不是所有者）看得到，控件都是灰的。
(() => {
  const D = JSON.parse(document.getElementById('gc-data').textContent);
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const md = (day) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
  const pad = (n) => String(n).padStart(2, '0');
  const when = (iso) => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const lock = D.canEdit ? '' : ' disabled';
  let S = D.settings;

  const toastEl = $('stoast');
  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('on'), 1800);
  }

  // 报头：上次更新（看日志）、下次更新、数据源在用几个
  const inUse = () => D.sources.filter((s) => s.fixed || S.sources[s.key]).length;
  function mast() {
    const r = D.run;
    const last = !r ? ['—', ''] : r.running ? [when(r.startedAt), '<small>正在更新</small>'] : [when(r.startedAt), r.failed.length ? `<small class="bad">失败 ${r.failed.length} 步</small>` : '<small class="ok">全部成功</small>'];
    const tick = [['上次更新', ...last], ['下次更新', S.daily.on ? `${D.next.today ? '今天' : '明天'} ${D.next.at}` : '已关掉', ''], ['数据源', inUse(), `<small>/ ${D.sources.length} 在用</small>`]];
    $('mast').innerHTML = `<div><div class="kick"><span>数据源 · 定时 · AI 接入</span></div><h1><span class="tt"><span class="ghost" aria-hidden="true">Settings</span><b>设置</b></span></h1></div>
      <div class="tick">${tick.map(([k, v, s]) => `<div><div class="k">${k}</div><div class="v">${v}${s}</div></div>`).join('')}</div><div class="band"></div>`;
  }

  const sw = (name, label, on, extra = '') => `<button class="ssw" type="button" data-sw="${name}" aria-label="${esc(label)}" aria-pressed="${on}"${extra}></button>`;
  const segs = (task) => `<div class="segs" role="group" aria-label="思考强度">${Object.entries(D.efforts).map(([v, t]) => `<button type="button" data-effort="${task}" data-v="${v}" aria-selected="${S.effort[task] === v}"${lock}>${t}</button>`).join('')}</div>`;
  const agentSegs = () => `<div class="segs" role="group" aria-label="默认执行方">${Object.entries(D.agents).map(([v, t]) => `<button type="button" data-agent="${v}" aria-selected="${S.agent === v}"${lock}>${esc(t)}</button>`).join('')}</div>`;

  // ── AI 接入（#69，全局规则 P-13；所有者选的 C 版：执行方、功能、对外开放、数据对象各一张卡） ──
  const A = D.ai;
  const TASKS = Object.fromEntries(A.features.map((f) => [f.task, f.name]));
  const callLine = (c) => (c ? `${when(c.at)} · ${esc(TASKS[c.task] ?? c.task)}` : '—');
  function agentRow(by) {
    const a = A.status?.agents?.[by];
    const c = A.status?.calls?.[by];
    const ok = a?.state === 'ok';
    const model = by === 'codex' ? '默认模型（Codex 不报具体名）' : c?.lastOk?.model ?? 'Sonnet（--model sonnet）';
    const state = a ? `<span class="tag ${ok ? 't-on' : 't-bad'}">${esc(A.states[a.state] ?? a.state)}</span>` : '<span class="tag t-off">没查过</span>';
    const fail = c?.lastFail && (!c.lastOk || c.lastFail.at > c.lastOk.at)
      ? `<span class="err">${callLine(c.lastFail)} · ${esc(c.lastFail.error)}</span>` : c?.lastFail ? callLine(c.lastFail) : '—';
    const head = `<span class="sdot${a ? (ok ? '' : ' bad') : ' off'}"></span>${esc(A.names[by])}${state}${a?.version ? `<span class="mono ver">${esc(a.version)}</span>` : ''}`;
    const ds = a ? `${esc(a.detail ?? '')} · 模型：${esc(model)}<br>最近成功：${callLine(c?.lastOk)}　最近失败：${fail}`
      : '每次跑补资料、归类、精选标签建议前会在本机查一次；也可以在本机跑 <code>npm run ai</code>';
    return row(head, ds, '');
  }
  // 选定的执行方用不了（没查过不算）：只用一家看那家，接力看两家是不是都用不了。和 src/ai-access.js 的 unavailable 同一规则。
  const usable = (by) => A.status?.agents?.[by]?.state === 'ok';
  const unusable = (mode) => Boolean(A.status?.agents) && (mode === 'relay' ? !usable('codex') && !usable('claude') : !usable(mode));
  const forOpts = (task) => [['default', '跟随默认'], ...Object.entries(D.agents)].map(([v, t]) => `<option value="${v}"${S.agentFor[task] === v ? ' selected' : ''}>${esc(t)}</option>`).join('');
  function featureRow(f) {
    const set = S.agentFor[f.task];
    const tag = set === 'default' ? '<span class="tag t-off">跟随默认</span>' : '<span class="tag t-blue">单独指定</span>';
    const problem = unusable(set === 'default' ? S.agent : set) ? `<div class="err fx-err">选的执行方现在用不了：下次运行这一步会报错退出，不会换另一家。在本机修好（如重新登录），或在这里换执行方。</div>` : '';
    return `<div class="srow fx"><div><details${open.has(f.task) ? ' open' : ''} data-fx="${f.task}"><summary><span class="car" aria-hidden="true">▶</span><span><span class="nm">${esc(f.name)}${tag}</span><span class="ds">${esc(f.makes)} · ${esc(A.vias[f.via])}</span></span></summary>
      <dl class="fx-body"><dt>接入方式</dt><dd>${esc(A.vias[f.via])}（在空的临时目录里跑，不给执行命令的工具，不加载 MCP 和插件）</dd><dt>读</dt><dd>${esc(f.reads)}</dd><dt>写到</dt><dd><code>${esc(f.writes)}</code></dd><dt>什么时候跑</dt><dd>${esc(f.when)}</dd></dl></details>${problem}</div>
      <div class="ct"><select class="sin" data-agentfor="${f.task}" aria-label="${esc(f.name)}的执行方"${lock}>${forOpts(f.task)}</select>思考强度${segs(f.task)}</div></div>`;
  }
  const open = new Set();
  function openRow(o) {
    return row(`<span class="sdot${o.on ? '' : ' plan'}"></span>${esc(o.who)} <span class="tag ${o.on ? 't-on' : 't-plan'}">${o.on ? '开放中' : '没有开放'}</span>`,
      `${esc(o.via)}<br>能读：${esc(o.reads)}<br>能写：${esc(o.writes)}<br>在哪关：${esc(o.off)}`, '');
  }
  const row = (nm, ds, ct, cls = '') => `<div class="srow${cls}"><div><div class="nm">${nm}</div>${ds ? `<div class="ds">${ds}</div>` : ''}</div>${ct === null ? '' : `<div class="ct">${ct}</div>`}</div>`;

  function sourceRow(s) {
    const st = s.status;
    const on = s.fixed || S.sources[s.key];
    const dot = s.unavailable || !on ? 'off' : st?.state === 'failed' ? 'bad' : st?.state === 'ok' || s.fixed ? '' : 'off';
    const state = s.unavailable ? '' : !on ? '已关' : !st ? '' : st.state === 'none' ? '还没跑过' : `${md(st.day)} ${st.state === 'failed' ? '<span class="fail">失败</span>' : st.state === 'off' ? '没抓' : '正常'}`;
    const host = s.host ? `<code>${esc(s.host)}</code> · ` : '';
    const err = on && st?.state === 'failed' && st.error ? `<br><span class="err">${esc(st.error)}</span>` : '';
    const ctl = s.fixed ? '必需' : sw(`sources.${s.key}`, s.name, on, s.required ? ' disabled title="涨星榜的基础数据，不能关"' : s.unavailable ? ' disabled title="还没接"' : lock);
    return row(`<span class="sdot ${dot}"></span>${esc(s.name)}${s.unavailable ? ' <span class="tag t-off">未接</span>' : ''}`, `${host}${esc(s.use)}${err}`, `${state}${ctl}`);
  }

  // 周报推送这一期或下一期：和猛鬼兽一样按北京时间算（用 UTC+8 的日期），今天就是设定那天就写今天（发没发要看飞书），否则下一个设定的星期
  function nextWeekly() {
    const { day, at } = S.weekly;
    const t = new Date(Date.now() + 8 * 3600e3);
    const ahead = (day - t.getUTCDay() + 7) % 7;
    t.setUTCDate(t.getUTCDate() + ahead);
    return `${ahead ? '' : '今天 '}${t.getUTCMonth() + 1}/${t.getUTCDate()} ${D.days[day]} ${at}`;
  }
  const dayOpts = () => D.days.map((t, i) => `<option value="${i}"${S.weekly.day === i ? ' selected' : ''}>每${t}</option>`).join('');
  function body() {
    const steps = '出榜 → 全站 Star 前 100 → 历史榜 → 热点榜 → 精选榜 → 补资料 → 归类 → 周报 → 校准，共 9 步，一步失败照样跑后面的';
    const cards = [
      ['s-src', '数据源', `${inUse()}/${D.sources.length}`, `数据源 <small>每天跟着每日更新一起抓；关掉的来源不再抓，网站上用到它的部分沿用最后一次的数据</small>`, D.sources.map(sourceRow).join('')],
      ['s-time', '定时与推送', '2', '定时与推送 <small>每日更新是本机 launchd 任务；周报推送由猛鬼兽按这里的设置发</small>', [
        row(`<span class="sdot${S.daily.on ? '' : ' off'}"></span>每日更新`, `${steps}。<br>统计日按 UTC 划分、北京时间 08:00 才结束，事件文件还要晚约 1 小时，所以不能早于 ${D.earliest}；按 15 分钟一档。到点时电脑睡着的，醒来后补跑。<span class="err" id="at-err"></span>`,
          `每天<input class="sin" id="daily-at" aria-label="每日更新时间" type="time" value="${S.daily.at}" min="${D.earliest}" step="900"${lock}>${sw('daily.on', '每日更新', S.daily.on, lock)}`),
        row(`<span class="sdot${S.weekly.on ? '' : ' off'}"></span>周报推送 <span class="tag t-on">已接入</span>`, `到点后 15 分钟内，由猛鬼兽（Hermes）把最新一期周报卡片（本周涨星前 10）发到你的飞书私聊；关掉就不发。当期数据还没生成会先等，最多等 3 小时，还没有就只发一句说明；电脑整天关机错过的不隔天补发。<br>${S.weekly.on ? `下次：${nextWeekly()}` : '已关掉，不会发'}`,
          `<select class="sin" id="weekly-day" aria-label="周报推送星期"${lock}>${dayOpts()}</select><input class="sin" id="weekly-at" aria-label="周报推送时间" type="time" value="${S.weekly.at}"${lock}>${sw('weekly.on', '周报推送', S.weekly.on, lock)}`),
        row('<span class="sdot"></span>网站服务', '常驻在本机，只本机能打开，出错自动重启', `<span class="mono">${esc(location.host)}</span>`),
      ].join('')],
      ['s-ai', 'AI 执行方', '2', `AI 执行方 <small>本机已登录的命令行，不另付费</small><span class="when">${A.status?.checkedAt ? `检查于 ${when(A.status.checkedAt)}` : '还没检查过'}</span>`, [
        row('默认执行方', '只用一家时，那家用不了这一步就报错、不换另一家；「接力」时 Codex 失败那次改用 Claude，一次更新里连续失败 3 次剩下的都交给 Claude。下次运行起生效，正在跑的按原来的跑完', agentSegs()),
        ...Object.keys(A.names).map(agentRow),
      ].join('')],
      ['s-aifx', 'AI 功能', String(A.features.length), 'AI 功能 <small>每个用到 AI 的功能：谁做、读什么、写到哪</small>', A.features.map(featureRow).join('')],
      ['s-open', '对外开放', String(A.openings.length), '对外开放 <small>外部 AI 连进来读写这里的数据</small>', A.openings.map(openRow).join('')],
      ['s-data', '数据对象', String(A.dataObjects.length), '数据对象 <small>只展示或采集的 AI 数据</small>', A.dataObjects.length
        ? A.dataObjects.map((d) => row(esc(d.name), esc(d.from), '')).join('')
        : row('<span class="sdot off"></span>无', '本应用不展示、不采集 AI 自己的数据（如用量）。', '')],
      ['s-acc', '账号与访问', '', '账号与访问', [
        row('访问方式', D.guest ? '现在免登录，打开的人都当作下面这个账号；对外上线后改成伙伴账号' : '要登录，每人用自己的账号', D.guest ? '免登录' : '要登录'),
        row('当前账号', D.canEdit ? '所有者，能改这一页的设置' : '伙伴，只能看，不能改设置', esc(D.me)),
      ].join('')],
    ];
    $('stoc').innerHTML = cards.map(([id, t, n], i) => `<a href="#${id}"${i ? '' : ' class="on"'}>${t}${n ? `<span>${n}</span>` : ''}</a>`).join('');
    $('smain').innerHTML = cards.map(([id, , , h, rows]) => `<section class="scard" id="${id}"><h3>${h}</h3>${rows}</section>`).join('');
  }
  function draw() {
    mast();
    body();
    spy();
  }

  // 目录跟着滚动高亮当前分区
  let observer;
  function spy() {
    observer?.disconnect();
    const links = [...$('stoc').querySelectorAll('a')];
    observer = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting) links.forEach((a) => a.classList.toggle('on', a.getAttribute('href') === `#${e.target.id}`));
    }), { rootMargin: '-80px 0px -60% 0px' });
    document.querySelectorAll('.scard').forEach((c) => observer.observe(c));
  }

  // 存整份设置；失败就退回原来的值
  const fields = (s) => ({
    ...Object.fromEntries(Object.entries(s.sources).map(([k, v]) => [`sources.${k}`, v ? 'on' : 'off'])),
    agent: s.agent,
    ...Object.fromEntries(Object.entries(s.agentFor).map(([k, v]) => [`agentFor.${k}`, v])),
    ...Object.fromEntries(Object.entries(s.effort).map(([k, v]) => [`effort.${k}`, v])),
    'daily.on': s.daily.on ? 'on' : 'off', 'daily.at': s.daily.at,
    'weekly.on': s.weekly.on ? 'on' : 'off', 'weekly.day': String(s.weekly.day), 'weekly.at': s.weekly.at,
  });
  async function save(next, done = '已保存 · 下次每日更新起生效') {
    const before = S;
    S = next;
    draw();
    try {
      const r = await fetch('/api/settings', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields(next)) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `保存失败（${r.status}）`);
      S = j.settings;
      draw();
      toast(done);
    } catch (e) {
      S = before;
      draw();
      toast(e.message);
    }
  }
  const WEEKLY_DONE = '已保存 · 猛鬼兽 15 分钟内按新设置来';
  const clone = () => JSON.parse(JSON.stringify(S));

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sw]:not(:disabled)');
    if (b) {
      const next = clone();
      const [group, key] = b.dataset.sw.split('.');
      if (group === 'sources') next.sources[key] = !next.sources[key];
      else next[group][key] = !next[group][key];
      return save(next, group === 'weekly' ? WEEKLY_DONE : undefined);
    }
    const ag = e.target.closest('[data-agent]:not(:disabled)');
    if (ag && S.agent !== ag.dataset.agent) return save({ ...clone(), agent: ag.dataset.agent });
    const seg = e.target.closest('[data-effort]:not(:disabled)');
    if (seg && S.effort[seg.dataset.effort] !== seg.dataset.v) {
      const next = clone();
      next.effort[seg.dataset.effort] = seg.dataset.v;
      save(next);
    }
  });
  // 时间框：改完（失焦或回车）才存；每日更新不合规就标红、写明原因，不存
  const dailyBad = (t) => (!/^\d\d:\d\d$/.test(t) ? '时间格式不对' : t < D.earliest ? `不能早于 ${D.earliest}` : Number(t.slice(3)) % 15 ? '按 15 分钟一档：分钟只能是 00、15、30、45' : '');
  // 功能行展开与否重画后保留
  document.addEventListener('toggle', (e) => {
    const d = e.target;
    if (d.dataset?.fx) d.open ? open.add(d.dataset.fx) : open.delete(d.dataset.fx);
  }, true);
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'daily-at') {
      const bad = dailyBad(t.value);
      t.classList.toggle('bad', Boolean(bad));
      $('at-err').textContent = bad ? `　${bad}` : '';
      if (bad || t.value === S.daily.at) return;
      const next = clone();
      next.daily.at = t.value;
      save(next);
    } else if (t.dataset.agentfor) {
      const next = clone();
      next.agentFor[t.dataset.agentfor] = t.value;
      save(next);
    } else if (t.id === 'weekly-at' || t.id === 'weekly-day') {
      if (t.id === 'weekly-at' && !/^\d\d:\d\d$/.test(t.value)) return t.classList.add('bad');
      const next = clone();
      if (t.id === 'weekly-at') next.weekly.at = t.value;
      else next.weekly.day = Number(t.value);
      save(next, WEEKLY_DONE);
    }
  });

  draw();
})();
