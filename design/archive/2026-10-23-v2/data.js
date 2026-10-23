// v2 三套候选共用的示例数据与小工具：数字与简介是占位，不是真实统计。
window.GC = (() => {
  const CATS = ['AI 应用工具', 'Agent／MCP', '工作流自动化', '知识管理与办公效率', 'Skill', '开发框架与组件库', '数据库与数据工具', '开发者工具与基础设施', '其他'];
  const P = {};
  const add = (repo, total, what, problem, cats, extra = {}) => { P[repo] = { repo, total, what, problem, cats, conditions: [], skills: [], ...extra }; };
  add('morluto/rea', 241350, '辅助分析软件与程序运行逻辑的逆向工程工具集', '想弄清一个没有源码的程序在做什么时，让 AI 帮你反编译、追踪调用和解释行为', ['Agent／MCP', '开发者工具与基础设施'], { conditions: ['需要 macOS 或 Linux', '部分功能需要本机安装 Hopper 或 JEB'] });
  add('storytold/photocraft', 38210, '支持图层、蒙版与 PSD 的图片编辑器', '不想开 Photoshop 也能处理分层图片和蒙版', ['AI 应用工具']);
  add('Ebony-Vinyl/dsh-our-free-model', 21904, '为 dsh 添加模型接入功能', '让命令行助手 dsh 能接入你自己选的模型', ['开发者工具与基础设施'], { conditions: ['需要至少一个模型服务的 API Key'] });
  add('storytold/artcraft', 30115, '编排场景，制作 AI 图像和视频', '把分镜、角色和场景串起来，批量生成风格一致的画面', ['AI 应用工具']);
  add('boykopovar/AnyPS5', 18760, '辅助将 PS5 程序移植到电脑', '在电脑上运行原本只在主机上的程序', ['其他']);
  add('debpalash/VoiceStudio', 52640, '本地运行的 AI 声音工作室，集声音克隆、配音和语音生成于一体', '给视频配音、克隆自己的声音，而且数据不出本机', ['AI 应用工具'], { conditions: ['建议有 8GB 以上显存的显卡'] });
  add('storytold/wordcraft', 14420, '编辑 DOCX 文档，处理排版和修订', '让 AI 直接改 Word 文档并保留修订痕迹', ['知识管理与办公效率']);
  add('mattpocock/skills', 275300, '把软件工程方法做成一组 Agent Skills', '让你的 AI 按“先澄清需求、再拆任务、再测试驱动”的流程写代码', ['Skill'], {
    skills: [
      { name: 'grill-me', desc: '动手前连续追问，直到需求说清楚' },
      { name: 'to-spec', desc: '把对话整理成一份可执行的规格' },
      { name: 'tdd', desc: '先写失败的测试，再让它通过' },
      { name: 'diagnosing-bugs', desc: '按固定步骤定位难查的问题' },
    ],
  });
  add('cathrynlavery/diagram-design', 9120, '绘制流程图、架构图和信息图', '一句话描述就能得到一张排版干净的图', ['Skill', '知识管理与办公效率'], { skills: [{ name: 'diagram', desc: '生成流程图与架构图' }, { name: 'infographic', desc: '生成信息图' }] });
  add('NationalSecurityAgency/ghidra', 61200, '分析二进制程序的逆向工程工具', '研究恶意软件或没有源码的程序', ['开发者工具与基础设施'], { conditions: ['需要 Java 21 运行环境'] });
  add('vectorize-io/hindsight', 45100, '给 AI Agent 增加长期记忆', '让 AI 记住你过去说过的偏好和做过的事', ['Agent／MCP']);
  add('paperclipai/paperclip', 96800, '一个多 Agent 管理平台', '像管理团队一样给多个 AI 分工、派活、看进度', ['Agent／MCP', '工作流自动化']);
  add('stablyai/orca', 82400, '多 Coding Agent 并行管理工具', '同时让几个 AI 各写一部分代码而不互相打架', ['Agent／MCP']);
  add('openshell-dev/openshell', 14700, '为 AI Agent 设计的安全运行环境', '让 AI 执行命令时不会误删你的文件', ['开发者工具与基础设施']);
  add('dream-num/univer', 22300, '让 AI Agent 操作表格、文档、PPT、PDF', '让 AI 直接生成和修改办公文件', ['知识管理与办公效率']);
  add('anthropics/claude-plugins-official', 18900, 'Claude Code 官方插件与 Skill 目录', '一处找齐官方维护的 Claude Code 扩展', ['Skill'], { skills: [{ name: 'frontend-design', desc: '做出有设计感的前端界面' }, { name: 'pdf', desc: '读取、填写和生成 PDF' }, { name: 'xlsx', desc: '处理 Excel 表格' }] });
  add('Panniantong/Agent-Reach', 89800, '给 AI Agent 接入互联网', '让 AI 能搜索并读取多个平台上的内容', ['Agent／MCP']);
  add('example-org/ai-engineering-from-scratch-handbook', 1032400, '从零开始构建 AI 工程的完整教程', '系统学会怎样做出自己的 AI 应用', ['其他']);
  add('a-very-long-organization-name/an-extremely-long-repository-name-to-test-wrapping', 3120, '一个专门用来测试最长中文简介显示效果的示例项目，简介写得特别长，用来检查换行、省略和对齐在各种宽度下是否依然优雅', '验证极端长度的名字与说明不会把版面撑坏', ['其他']);
  add('lumen-db/lumen', 7400, '嵌入式向量数据库', '在本机给几十万份文档做语义搜索', ['数据库与数据工具']);
  add('tinyui/tiny-ui', 5230, '只有 6KB 的无样式组件库', '快速搭出可访问的表单和弹窗', ['开发框架与组件库']);

  const order = {
    d1: [['morluto/rea', 31842], ['debpalash/VoiceStudio', 4210], ['storytold/photocraft', 3987], ['Ebony-Vinyl/dsh-our-free-model', 3120], ['storytold/artcraft', 2875], ['mattpocock/skills', 2510], ['boykopovar/AnyPS5', 2302], ['vectorize-io/hindsight', 2140], ['storytold/wordcraft', 1988], ['cathrynlavery/diagram-design', 1870], ['NationalSecurityAgency/ghidra', 1702], ['paperclipai/paperclip', 1655], ['stablyai/orca', 1530], ['Panniantong/Agent-Reach', 1420], ['openshell-dev/openshell', 1388], ['dream-num/univer', 1276], ['anthropics/claude-plugins-official', 1201], ['example-org/ai-engineering-from-scratch-handbook', 1150], ['a-very-long-organization-name/an-extremely-long-repository-name-to-test-wrapping', 1088], ['lumen-db/lumen', 1034], ['tinyui/tiny-ui', 1034]],
    d7: [['morluto/rea', 223708], ['storytold/photocraft', 21066], ['Ebony-Vinyl/dsh-our-free-model', 15837], ['storytold/artcraft', 15581], ['boykopovar/AnyPS5', 13599], ['debpalash/VoiceStudio', 13474], ['storytold/wordcraft', 10676], ['mattpocock/skills', 10131], ['cathrynlavery/diagram-design', 7613], ['NationalSecurityAgency/ghidra', 7502], ['vectorize-io/hindsight', 7120], ['paperclipai/paperclip', 6890], ['Panniantong/Agent-Reach', 6402], ['stablyai/orca', 6011], ['dream-num/univer', 5320], ['openshell-dev/openshell', 5102], ['example-org/ai-engineering-from-scratch-handbook', 5099], ['anthropics/claude-plugins-official', 4870], ['lumen-db/lumen', 4410], ['tinyui/tiny-ui', 4205]],
    d30: [['morluto/rea', 241002], ['paperclipai/paperclip', 41870], ['debpalash/VoiceStudio', 40112], ['stablyai/orca', 35660], ['storytold/photocraft', 33320], ['vectorize-io/hindsight', 31014], ['Panniantong/Agent-Reach', 29870], ['storytold/artcraft', 27200], ['mattpocock/skills', 25560], ['NationalSecurityAgency/ghidra', 21980], ['Ebony-Vinyl/dsh-our-free-model', 20117], ['example-org/ai-engineering-from-scratch-handbook', 19830], ['boykopovar/AnyPS5', 17940], ['dream-num/univer', 15730], ['storytold/wordcraft', 13560], ['anthropics/claude-plugins-official', 12840], ['openshell-dev/openshell', 11950], ['cathrynlavery/diagram-design', 8870], ['lumen-db/lumen', 6930], ['tinyui/tiny-ui', 5120]],
  };
  const WINDOWS = [['d1', '近 1 天'], ['d7', '近 7 天'], ['d30', '近 30 天']];
  const AI = { claude: 'Claude Code', codex: 'Codex' };

  // 名次：并列同名次；分类筛选在同一份已核数结果里重排，不足 20 个如实显示。
  function ranking(win, cat) {
    const rows = order[win].map(([repo, gain]) => ({ ...P[repo], gain })).filter((r) => !cat || r.cats.includes(cat));
    let last = null, rank = 0;
    return rows.slice(0, 20 + rows.slice(20).filter((r) => rows[19] && r.gain === rows[19].gain).length).map((r, i) => {
      if (r.gain !== last) rank = i + 1;
      last = r.gain;
      return { ...r, rank, tie: rows.filter((x) => x.gain === r.gain).length > 1 };
    });
  }

  function installText(repo, target, skill) {
    const who = AI[target];
    const what = skill ? `仓库 ${repo} 里名为「${skill}」的 Skill` : ` GitHub 项目 ${repo}`;
    return `请在你所在的这台电脑上，为 ${who} 安装${what}（https://github.com/${repo}）。\n1. 先阅读项目官方 README 和安装文档，按文档步骤安装和配置，不要猜测命令。\n2. 装好后实际调用一次，确认能正常使用。\n3. 如果需要账号、API Key 或付费，停下来告诉我缺什么，不要自行注册或付费。\n4. 最后用两三句话告诉我：它装在哪里、怎么调用、第一次可以怎么试。`;
  }

  const SPAN = { d1: 1, d7: 7, d30: 30 };
  const fmt = (n) => n.toLocaleString('en-US');
  const short = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M' : n >= 1000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, '') + 'k' : String(n));
  // 更新失败时整页显示上次成功的那一份，日期如实写上次的，不伪造。
  const meta = { statDay: '2026-10-22', statLabel: '10 月 22 日', updatedAt: '10-23 10:04', candidates: 1284, verified: 1284 };
  const lastGood = { statDay: '2026-10-21', statLabel: '10 月 21 日', updatedAt: '10-22 10:02' };
  const metaFor = (state) => (state === 'failed' ? { ...meta, ...lastGood } : meta);

  // 某窗口的新增；没进该窗口前 20 时为 null，页面写“未上榜”。
  const gainOf = (repo, win) => { const hit = order[win].find(([r]) => r === repo); return hit ? hit[1] : null; };

  // 近 30 天逐日新增（示例）：按三个窗口的数拆成 30 个日值，最后一天等于近 1 天。
  function series(repo) {
    const d1 = gainOf(repo, 'd1') ?? Math.round(P[repo].total * 0.004);
    const d7 = Math.max(gainOf(repo, 'd7') ?? d1 * 6, d1);
    const d30 = Math.max(gainOf(repo, 'd30') ?? d7 * 3, d7);
    let seed = [...repo].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    const split = (total, n, rising) => {
      const w = Array.from({ length: n }, (_, i) => (0.5 + rnd()) * (rising ? 1 + i / n : 1));
      const s = w.reduce((a, b) => a + b, 0);
      return w.map((x) => Math.round((total * x) / s));
    };
    return [...split(d30 - d7, 23, false), ...split(d7 - d1, 6, true), d1];
  }

  // 走势小图：纵轴从零开始、线性；当前窗口那一段用强调色。
  function spark(values, { w = 120, h = 32, last = 1 } = {}) {
    const max = Math.max(...values, 1), n = values.length;
    const pts = values.map((v, i) => [(i / (n - 1)) * w, h - (v / max) * h]);
    const d = (arr) => arr.map(([a, b], i) => (i ? 'L' : 'M') + a.toFixed(1) + ' ' + b.toFixed(1)).join('');
    const seg = pts.slice(n - Math.max(2, last + 1));
    const area = d(seg) + `L${w} ${h}L${seg[0][0].toFixed(1)} ${h}Z`;
    const [ex, ey] = pts[n - 1];
    return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">${last > 1 ? `<path class="a" d="${area}"/>` : ''}<path class="l" d="${d(pts)}"/><path class="w" d="${d(seg)}"/><circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="2.2"/></svg>`;
  }

  const I = {
    star: '<path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z"/>',
    bookmark: '<path d="M4 2.5h8v11l-4-2.6-4 2.6z"/>',
    copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/>',
    check: '<path d="M3.5 8.5l3 3 6-7"/>',
    sun: '<circle cx="8" cy="8" r="2.8"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1"/>',
    moon: '<path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z"/>',
    monitor: '<rect x="1.5" y="2.5" width="13" height="9" rx="1.5"/><path d="M5.5 14h5M8 11.5V14"/>',
    trend: '<path d="M1.5 11.5l4-4 3 3 6-6M10.5 4.5h4v4"/>',
    list: '<path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01"/>',
    paper: '<path d="M3.5 1.5h6l3 3v10h-9z"/><path d="M9.5 1.5v3h3M5.5 8h5M5.5 11h5"/>',
    out: '<path d="M9 2.5h4.5V7M13.5 2.5L7.5 8.5M12 9.5v4H2.5V4h4"/>',
    close: '<path d="M4 4l8 8M12 4l-8 8"/>',
    arrow: '<path d="M2.5 8h11M9.5 4l4 4-4 4"/>',
    back: '<path d="M13.5 8h-11M6.5 4l-4 4 4 4"/>',
    logout: '<path d="M6.5 2.5h-3v11h3M10.5 5l3 3-3 3M13.5 8h-7"/>',
    user: '<circle cx="8" cy="5.5" r="2.8"/><path d="M2.5 14c.8-2.6 3-4 5.5-4s4.7 1.4 5.5 4"/>',
    spark: '<path d="M8 1.5l1.4 5.1 5.1 1.4-5.1 1.4L8 14.5l-1.4-5.1L1.5 8l5.1-1.4z"/>',
  };
  const icon = (k, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 16 16" aria-hidden="true">${I[k]}</svg>`;
  const logo = (size = 20) => `<svg width="${size}" height="${size}" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.6" fill="none" stroke="var(--accent)" stroke-width="1.4"/><path d="M10 4.6l1.25 3.95L15.2 10l-3.95 1.25L10 15.4l-1.25-4.15L4.8 10l3.95-1.45z" fill="var(--accent)"/></svg>`;
  const avatar = (repo, size = 28) => `<span class="ava" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px" aria-hidden="true">${repo[0].toUpperCase()}</span>`;

  // 主题：浅色 / 跟随系统 / 深色；网址里的 ?theme= 优先，便于评审截图。
  const mq = matchMedia('(prefers-color-scheme: dark)');
  let themePref = 'system';
  try { themePref = new URLSearchParams(location.search).get('theme') || localStorage.getItem('gc-theme') || 'system'; } catch {}
  const applyTheme = () => {
    document.documentElement.dataset.theme = themePref === 'system' ? (mq.matches ? 'dark' : 'light') : themePref;
    document.querySelectorAll('.theme button').forEach((b) => b.classList.toggle('on', b.dataset.t === themePref));
  };
  mq.addEventListener('change', applyTheme);
  applyTheme();
  const themeSwitch = () => `<div class="theme" role="group" aria-label="主题">${[['light', 'sun', '浅色'], ['system', 'monitor', '跟随系统'], ['dark', 'moon', '深色']].map(([t, i, l]) => `<button data-t="${t}" title="${l}" aria-label="${l}" class="${t === themePref ? 'on' : ''}">${icon(i)}</button>`).join('')}</div>`;
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.theme button');
    if (!b) return;
    themePref = b.dataset.t;
    try { localStorage.setItem('gc-theme', themePref); } catch {}
    applyTheme();
  });

  // 分段控件：滑块常驻，切换时只改位移。
  const seg = (items, cur, attr) => {
    const i = Math.max(0, items.findIndex(([k]) => k === cur));
    return `<div class="seg">${items.map(([k, l]) => `<button data-${attr}="${k}" class="${k === cur ? 'on' : ''}">${l}</button>`).join('')}<span class="thumb" style="width:calc((100% - 6px) / ${items.length});transform:translateX(${i * 100}%)"></span></div>`;
  };
  const setSeg = (el, attr, key) => {
    const btns = [...el.querySelectorAll(`[data-${attr}]`)];
    const i = btns.findIndex((b) => b.dataset[attr] === key);
    btns.forEach((b, j) => b.classList.toggle('on', j === i));
    el.querySelector('.thumb').style.transform = `translateX(${i * 100}%)`;
  };

  // 收藏（只在本页内存中）。
  const favs = new Set(['mattpocock/skills']);
  const toggleFav = (key) => (favs.has(key) ? (favs.delete(key), false) : (favs.add(key), true));
  const bump = (el) => { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); };

  function toast(msg) {
    document.querySelector('.toast')?.remove();
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = icon('check') + msg;
    document.body.append(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 180); }, 1800);
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const ta = Object.assign(document.createElement('textarea'), { value: text });
      document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
  }

  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const transition = (fn) => (document.startViewTransition && !reduced() ? document.startViewTransition(fn) : (fn(), null));

  const NOTICE = {
    incomplete: `<div class="notice warn"><span class="dot"></span><span><b>可能不完整</b>　今天有 2 个小时的事件数据缺失，已用备用源补回 1 个；榜单可能漏掉个别项目。</span></div>`,
    failed: `<div class="notice"><span class="dot"></span><span><b>今天更新失败</b>　下面是 ${lastGood.statLabel} 的结果，下次更新会自动重试。</span></div>`,
  };

  // 评审用：切换状态。
  function demoPanel(onChange) {
    const states = [['normal', '正常'], ['loading', '加载中'], ['incomplete', '可能不完整'], ['failed', '更新失败'], ['generating', '简介生成中']];
    const el = document.createElement('div');
    el.className = 'gc-demo';
    el.innerHTML = '<b>示例数据</b>' + states.map(([k, l], i) => `<button data-state="${k}" class="${i ? '' : 'on'}">${l}</button>`).join('');
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      el.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      onChange(b.dataset.state);
    });
    document.body.append(el);
  }

  return { CATS, P, WINDOWS, SPAN, AI, ranking, installText, gainOf, series, spark, icon, logo, avatar, fmt, short, meta, metaFor, favs, toggleFav, bump, toast, copy, seg, setSeg, themeSwitch, reduced, transition, NOTICE, demoPanel };
})();
