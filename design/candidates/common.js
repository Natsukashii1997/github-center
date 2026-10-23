// v3 三版首页共用的数据整理与交互小工具。样式全部由各页面自己定义，这里只用各页面都有的语义变量。
window.GC = (() => {
  const { meta, projects } = window.GC_DATA;
  const CATS = ['AI 应用工具', 'Agent／MCP', '工作流自动化', '知识管理与办公效率', 'Skill', '开发框架与组件库', '数据库与数据工具', '开发者工具与基础设施', '其他'];
  const WINDOWS = [{ id: 'd1', label: '近 1 天', days: 1 }, { id: 'd7', label: '近 7 天', days: 7 }, { id: 'd30', label: '近 30 天', days: 30 }];
  const SPAN = { d1: 1, d7: 7, d30: 30 };
  const AI = { claude: 'Claude Code', codex: 'Codex' };
  const list = Object.values(projects);

  const sum = (a) => a.reduce((s, x) => s + x, 0);
  const gainOf = (p, win) => sum(p.series.slice(-SPAN[win]));

  // 名次：按窗口新增排序，取前 20，末位并列一并收入；并列同名次。
  function ranking(win, cat) {
    const rows = list.filter((p) => !cat || p.cats.includes(cat)).map((p) => ({ ...p, gain: gainOf(p, win) })).sort((a, b) => b.gain - a.gain);
    const cut = rows.length > 20 ? rows.filter((r) => r.gain >= rows[19].gain) : rows;
    let rank = 0;
    return cut.map((r, i) => {
      if (i === 0 || r.gain !== cut[i - 1].gain) rank = i + 1;
      return { ...r, rank, tie: cut.filter((x) => x.gain === r.gain).length > 1 };
    });
  }
  const catCount = (win, cat) => ranking(win, cat).length;

  // 日期：series 的最后一格是统计日。
  const statDate = new Date(meta.statDay + 'T00:00:00Z');
  const dayAt = (i, n = 30) => new Date(statDate.getTime() - (n - 1 - i) * 86400000);
  const md = (d) => `${d.getUTCMonth() + 1} 月 ${d.getUTCDate()} 日`;
  const mdShort = (d) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  const updated = new Date(meta.updated + ':00+08:00');
  const hm = (d) => d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Shanghai' });

  const num = (n) => n.toLocaleString('en-US');
  const wan = (n) => (n >= 10000 ? `${(n / 10000).toFixed(n >= 1000000 ? 0 : 1)} 万` : num(n));
  const avatar = (p, s = 64) => `https://avatars.githubusercontent.com/u/${p.owner}?s=${s}&v=4`;
  const [ownerOf, nameOf] = [(p) => p.repo.split('/')[0], (p) => p.repo.split('/')[1]];

  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const EASE = 'cubic-bezier(.25, 1, .5, 1)';

  // 按 key 复用节点并做位置补间（FLIP）：已有的行从旧位置滑到新位置，新出现的行淡入上移。
  function reconcile(listEl, rows, { key, create, update, stagger = 18, onEnter }) {
    const old = new Map([...listEl.children].map((n) => [n.dataset.key, n]));
    const before = new Map([...old].map(([k, n]) => [k, n.getBoundingClientRect().top]));
    const next = rows.map((r, i) => {
      const k = key(r);
      const n = old.get(k) || create(r);
      n.dataset.key = k;
      update(n, r, i);
      return n;
    });
    const keep = new Set(next);
    old.forEach((n) => { if (!keep.has(n)) n.remove(); });
    next.forEach((n) => listEl.appendChild(n));
    if (reduced()) return;
    next.forEach((n, i) => {
      const was = before.get(n.dataset.key);
      if (was === undefined) {
        n.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 240, delay: Math.min(i, 14) * stagger, easing: EASE, fill: 'backwards' });
        onEnter && onEnter(n, i);
      } else {
        const dy = was - n.getBoundingClientRect().top;
        if (Math.abs(dy) > 0.5) n.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 280, easing: EASE });
      }
    });
  }

  // 文字更新：内容变了才淡入上移一次。
  function swap(el, text) {
    if (el.textContent === text) return;
    el.textContent = text;
    if (!reduced()) el.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: EASE });
  }

  const favs = new Set(['mattpocock/skills']);
  function toggleFav(repo, btn) {
    const on = !favs.has(repo);
    on ? favs.add(repo) : favs.delete(repo);
    btn.setAttribute('aria-pressed', on);
    btn.setAttribute('aria-label', on ? '取消收藏' : '收藏');
    if (on && !reduced()) btn.firstElementChild.animate([{ transform: 'scale(.7)' }, { transform: 'scale(1.08)' }, { transform: 'scale(1)' }], { duration: 280, easing: EASE });
    toast(on ? `已收藏 ${repo}` : `已取消收藏 ${repo}`);
  }

  let toastEl, toastTimer;
  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'gc-toast'; toastEl.setAttribute('role', 'status'); document.body.appendChild(toastEl); }
    toastEl.textContent = msg;
    toastEl.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('on'), 2000);
  }

  // 主题：跟随系统 → 浅色 → 深色，只在本页内存里记住。
  const THEMES = ['system', 'light', 'dark'];
  const THEME_LABEL = { system: '跟随系统', light: '浅色', dark: '深色' };
  let theme = 'system';
  function setTheme(t) {
    theme = t;
    if (t === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  }

  // 演示面板：只用于候选对比，切换页面状态与主题；正式版没有。
  const STATES = [['ok', '正常'], ['partial', '可能不完整'], ['failed', '更新失败'], ['loading', '加载中']];
  function demo(onState) {
    const el = document.createElement('div');
    el.className = 'gc-demo';
    el.innerHTML = `<span class="gc-demo-k">示例数据</span><select aria-label="页面状态">${STATES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select><button type="button" class="gc-demo-theme">${THEME_LABEL[theme]}</button>`;
    el.querySelector('select').addEventListener('change', (e) => onState(e.target.value));
    const tb = el.querySelector('.gc-demo-theme');
    tb.addEventListener('click', () => { setTheme(THEMES[(THEMES.indexOf(theme) + 1) % 3]); tb.textContent = THEME_LABEL[theme]; });
    document.body.appendChild(el);
    const q = new URLSearchParams(location.search);
    if (q.get('theme')) { setTheme(q.get('theme')); tb.textContent = THEME_LABEL[theme]; }
    if (q.get('state')) { el.querySelector('select').value = q.get('state'); onState(q.get('state')); }
  }

  const STATUS = {
    ok: { tone: 'ok', short: '数据正常', long: '' },
    partial: { tone: 'warn', short: '可能不完整', long: `${meta.statDay.slice(5).replace('-', ' 月 ')} 日有 3 个候选项目暂时读不到官方星数，名次可能有出入。` },
    failed: { tone: 'bad', short: '更新失败', long: '10 月 23 日的更新失败，下面是上次成功的 10 月 22 日数据。' },
  };

  const css = document.createElement('style');
  css.textContent = `
  .gc-demo{position:fixed;right:16px;bottom:16px;z-index:50;display:flex;align-items:center;gap:8px;padding:6px 6px 6px 12px;border:1px solid var(--line);border-radius:999px;background:var(--surface);font:12px/1 var(--font-ui);color:var(--ink-3);box-shadow:0 1px 2px rgb(0 0 0 / .04)}
  .gc-demo select,.gc-demo button{font:inherit;color:var(--ink-2);background:var(--sunk);border:0;border-radius:999px;height:26px;padding:0 10px;cursor:pointer}
  .gc-demo-k{letter-spacing:.04em}
  .gc-toast{position:fixed;left:50%;bottom:28px;z-index:60;transform:translate(-50%,8px);opacity:0;pointer-events:none;padding:10px 16px;border-radius:999px;background:var(--ink);color:var(--bg);font:13px/1.2 var(--font-ui);transition:opacity .16s ease-in,transform .16s ease-in}
  .gc-toast.on{opacity:1;transform:translate(-50%,0);transition:opacity .24s ${EASE},transform .24s ${EASE}}
  @media (prefers-reduced-motion: reduce){.gc-toast,.gc-toast.on{transition:none}}`;
  document.head.appendChild(css);

  return { meta, projects, list, CATS, WINDOWS, SPAN, AI, ranking, catCount, gainOf, dayAt, md, mdShort, updated, hm, num, wan, avatar, ownerOf, nameOf, reduced, EASE, reconcile, swap, favs, toggleFav, toast, demo, STATUS };
})();
